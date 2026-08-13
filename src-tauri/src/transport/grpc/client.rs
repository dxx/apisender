use crate::transport::grpc as grpc;

use std::collections::HashMap;
use std::time::{Duration, Instant};

use http::uri::PathAndQuery;
use tokio_util::sync::CancellationToken;
use tonic::metadata::MetadataMap;
use tonic::transport::Endpoint;
use tonic::{Request, Status};

use crate::error::{AppError, AppResult};
use crate::version::USER_AGENT;
use grpc::codec::{
    dynamic_message_to_json, json_to_dynamic_message, DynamicGrpcCodec,
};
use grpc::event::{GrpcEvent, GrpcStreamingKind};
use grpc::proto_loader::LoadedMethod;

pub type EventFn = Box<dyn Fn(GrpcEvent) + Send + Sync>;

/// gRPC 调用所需的全部入参；事件回调与取消令牌让上层能控制生命周期。
pub struct GrpcCallRequest {
    pub url: String,
    pub package: String,
    pub service: String,
    pub method: String,
    pub metadata: Vec<(String, String)>,
    pub body_json: String,
    pub connection_timeout: Option<Duration>,
    pub timeout: Option<Duration>,
    pub on_event: EventFn,
    pub cancel: CancellationToken,
}

/// 一次完整的 gRPC 调用入口：构造 endpoint → 编译消息 → 发请求 → 推事件。
/// 作用与流程：先建立连接 → Open 事件 → 按 Unary / ServerStreaming 分支调用 tonic → 在循环里消费响应；
/// 任意阶段出错都会发 Error + Closed 事件，保持前端事件流自洽。
pub async fn invoke(req: GrpcCallRequest, loaded: LoadedMethod) -> AppResult<()> {
    let kind = GrpcStreamingKind::from_method(&loaded.method);
    let start = Instant::now();

    let endpoint = build_endpoint(&req.url, req.connection_timeout)?;

    let channel = endpoint.connect().await.map_err(|e| {
        // 连接失败时一次性把 Error + Closed 都发出去，避免前端等不到 Closed。
        emit_error_and_closed(&req.on_event, &format!("gRPC connect error: {}", e), start);
        AppError::Invalid(format!("Failed to connect to gRPC endpoint: {}", e))
    })?;

    let connect_ms = start.elapsed().as_millis() as u64;

    let method_path = {
        let svc_name = loaded.method.parent_service().full_name();
        format!("/{}/{}", svc_name, loaded.method.name())
    };

    (req.on_event)(GrpcEvent::Open {
        url: req.url.clone(),
        package: req.package.clone(),
        service: req.service.clone(),
        method: req.method.clone(),
        streaming_kind: kind,
        connect_ms,
    });

    let codec = DynamicGrpcCodec::new(
        loaded.method.input().clone(),
        loaded.method.output().clone(),
    );

    let req_msg = match json_to_dynamic_message(loaded.method.input().clone(), &req.body_json) {
        Ok(m) => m,
        Err(e) => {
            // 请求体构建失败：还没发 Open？这里已经发了，所以只发 Error + Closed，不发 Open。
            emit_error_and_closed(&req.on_event, &format!("request body: {}", e), start);
            return Err(AppError::Invalid(e));
        }
    };

    let mut tonic_req = Request::new(req_msg);
    let md_map = build_metadata_map(&req.metadata);
    *tonic_req.metadata_mut() = md_map;

    if let Some(d) = req.timeout {
        tonic_req.set_timeout(d);
    }

    let mut grpc = tonic::client::Grpc::new(channel);

    let path = PathAndQuery::try_from(method_path.as_str())
        .map_err(|e| AppError::Invalid(format!("bad gRPC path '{}': {}", method_path, e)))?;

    let mut msg_count: u32 = 0;

    match kind {
        GrpcStreamingKind::Unary => {
            if let Err(e) = grpc.ready().await {
                emit_transport_error(&req.on_event, &e);
                (req.on_event)(GrpcEvent::Closed {
                    total_ms: start.elapsed().as_millis() as u64,
                    message_count: msg_count,
                });
                return Err(AppError::Invalid(format!("gRPC not ready: {}", e)));
            }
            match grpc.unary(tonic_req, path, codec).await {
                Ok(resp) => {
                    // Unary 场景下 tonic 一次性返回响应；用 select 等取消令牌，避免关闭延迟。
                    let resp = tokio::select! {
                        r = async move { Ok::<_, std::convert::Infallible>(resp) } => r.unwrap(),
                        _ = req.cancel.cancelled() => {
                            (req.on_event)(GrpcEvent::Closed {
                                total_ms: start.elapsed().as_millis() as u64,
                                message_count: msg_count,
                            });
                            return Ok(());
                        }
                    };
                    let initial_meta = metadata_to_vec(resp.metadata());
                    if !initial_meta.is_empty() {
                        (req.on_event)(GrpcEvent::InitialMetadata {
                            metadata: initial_meta,
                        });
                    }
                    let resp_msg = resp.into_inner();
                    let json = dynamic_message_to_json(&resp_msg);
                    (req.on_event)(GrpcEvent::Message {
                        index: 0,
                        data: json,
                        ts_ms: now_ms(),
                    });
                    msg_count = 1;
                    (req.on_event)(GrpcEvent::Status {
                        code: 0,
                        message: "OK".to_string(),
                    });
                    (req.on_event)(GrpcEvent::Closed {
                        total_ms: start.elapsed().as_millis() as u64,
                        message_count: msg_count,
                    });
                    Ok(())
                }
                Err(status) => {
                    emit_status_error(&req.on_event, &status);
                    (req.on_event)(GrpcEvent::Closed {
                        total_ms: start.elapsed().as_millis() as u64,
                        message_count: msg_count,
                    });
                    Err(AppError::Invalid(format!(
                        "gRPC call failed: {} {}",
                        status.code() as i32,
                        status.message()
                    )))
                }
            }
        }
        GrpcStreamingKind::ServerStreaming => {
            if let Err(e) = grpc.ready().await {
                emit_transport_error(&req.on_event, &e);
                (req.on_event)(GrpcEvent::Closed {
                    total_ms: start.elapsed().as_millis() as u64,
                    message_count: msg_count,
                });
                return Err(AppError::Invalid(format!("gRPC not ready: {}", e)));
            }
            match grpc.server_streaming(tonic_req, path, codec).await {
                Ok(resp) => {
                    let initial_meta = metadata_to_vec(resp.metadata());
                    if !initial_meta.is_empty() {
                        (req.on_event)(GrpcEvent::InitialMetadata {
                            metadata: initial_meta,
                        });
                    }
                    let mut stream = resp.into_inner();
                    loop {
                        let msg = tokio::select! {
                            m = stream.message() => m,
                            _ = req.cancel.cancelled() => {
                                (req.on_event)(GrpcEvent::Closed {
                                    total_ms: start.elapsed().as_millis() as u64,
                                    message_count: msg_count,
                                });
                                return Ok(());
                            }
                        };
                        match msg {
                            Ok(Some(msg)) => {
                                let json = dynamic_message_to_json(&msg);
                                (req.on_event)(GrpcEvent::Message {
                                    index: msg_count,
                                    data: json,
                                    ts_ms: now_ms(),
                                });
                                msg_count += 1;
                            }
                            Ok(None) => {
                                // 流结束：拉一次 trailers 提取 status / 剩余 metadata。
                                let trailers = stream.trailers().await.ok().flatten();
                                let (code, msg_text, trailing_meta) =
                                    extract_status_from_trailers(trailers.as_ref());

                                if !trailing_meta.is_empty() {
                                    (req.on_event)(GrpcEvent::TrailingMetadata {
                                        metadata: trailing_meta,
                                    });
                                }
                                (req.on_event)(GrpcEvent::Status {
                                    code,
                                    message: msg_text.clone(),
                                });
                                if code != 0 {
                                    (req.on_event)(GrpcEvent::Error {
                                        message: format!("gRPC status {}: {}", code, msg_text),
                                    });
                                }
                                (req.on_event)(GrpcEvent::Closed {
                                    total_ms: start.elapsed().as_millis() as u64,
                                    message_count: msg_count,
                                });
                                return if code == 0 {
                                    Ok(())
                                } else {
                                    Err(AppError::Invalid(format!(
                                        "gRPC call failed: status {}",
                                        code
                                    )))
                                };
                            }
                            Err(status) => {
                                emit_status_error(&req.on_event, &status);
                                (req.on_event)(GrpcEvent::Closed {
                                    total_ms: start.elapsed().as_millis() as u64,
                                    message_count: msg_count,
                                });
                                return Err(AppError::Invalid(format!(
                                    "gRPC stream error: {} {}",
                                    status.code() as i32,
                                    status.message()
                                )));
                            }
                        }
                    }
                }
                Err(status) => {
                    emit_status_error(&req.on_event, &status);
                    (req.on_event)(GrpcEvent::Closed {
                        total_ms: start.elapsed().as_millis() as u64,
                        message_count: msg_count,
                    });
                    Err(AppError::Invalid(format!(
                        "gRPC call failed: {} {}",
                        status.code() as i32,
                        status.message()
                    )))
                }
            }
        }
    }
}

/// 把 `grpc(s)://` URL 转成 tonic 期望的 `http(s)://`，并写入连接超时与 UA。
fn build_endpoint(url: &str, connect_timeout: Option<Duration>) -> AppResult<Endpoint> {
    let http_url = url
        .replacen("grpcs://", "https://", 1)
        .replacen("grpc://", "http://", 1);

    let mut endpoint = Endpoint::from_shared(http_url)
        .map_err(|e| AppError::Invalid(format!("invalid gRPC endpoint URL '{}': {}", url, e)))?;

    if let Some(to) = connect_timeout {
        endpoint = endpoint.connect_timeout(to);
    }
    endpoint = endpoint.user_agent(USER_AGENT).unwrap();

    Ok(endpoint)
}

/// 把 `(name, value)` 列表转成 tonic `MetadataMap`：跳过大写 / 非法 key，非 ASCII 字符单独留底层处理。
fn build_metadata_map(metadata: &[(String, String)]) -> MetadataMap {
    use tonic::metadata::Ascii;

    let mut map = MetadataMap::new();
    for (k, v) in metadata {
        let key_lower = k.to_ascii_lowercase();
        // 空 key 或以 `:` 开头（HTTP/2 伪 header）一律跳过。
        if key_lower.is_empty() || key_lower.starts_with(':') {
            continue;
        }
        if let Ok(key) = tonic::metadata::MetadataKey::<Ascii>::from_bytes(key_lower.as_bytes()) {
            if let Ok(val) = v.parse() {
                map.insert(key, val);
            }
        }
    }
    map
}

/// 从 gRPC trailers 中提取 `(status code, message, 剩余 metadata)`。
/// 没有 trailers 或缺 `grpc-status` 时按 OK 0 处理。
fn extract_status_from_trailers(
    map: Option<&MetadataMap>,
) -> (i32, String, Vec<(String, String)>) {
    let map = match map {
        Some(m) => m,
        None => return (0, "OK".to_string(), Vec::new()),
    };
    let code = map
        .get("grpc-status")
        .and_then(|v| v.to_str().ok())
        .and_then(|s| s.parse::<i32>().ok())
        .unwrap_or(0);
    let msg = map
        .get("grpc-message")
        .and_then(|v| v.to_str().ok())
        .unwrap_or(if code == 0 { "OK" } else { "" })
        .to_string();
    let trailing_meta = metadata_to_vec(map)
        .into_iter()
        .filter(|(k, _)| k != "grpc-status" && k != "grpc-message")
        .collect();
    (code, msg, trailing_meta)
}

/// 把 tonic `MetadataMap` 拍成 `(name, value)` 列表；ASCII 值用原始字符串，二进制值用 `{:?}` 兜底。
fn metadata_to_vec(map: &MetadataMap) -> Vec<(String, String)> {
    use tonic::metadata::KeyAndValueRef;
    let mut out: Vec<(String, String)> = Vec::new();
    for kv in map.iter() {
        match kv {
            KeyAndValueRef::Ascii(k, v) => {
                out.push((k.as_str().to_string(), v.to_str().unwrap_or("").to_string()));
            }
            KeyAndValueRef::Binary(k, v) => {
                out.push((k.as_str().to_string(), format!("{:?}", v)));
            }
        }
    }
    out
}

/// transport 出错时统一发 Status + Error：使用 14（Unavailable）作为 transport 失败的 code。
fn emit_status_error(on_event: &EventFn, status: &Status) {
    let code = status.code() as i32;
    let message = status.message().to_string();
    (on_event)(GrpcEvent::Status {
        code,
        message: message.clone(),
    });
    if code != 0 {
        (on_event)(GrpcEvent::Error {
            message: format!("gRPC status {}: {}", code, message),
        });
    }
}

/// tonic 传输层错误：用 `gRPC code 14 = UNAVAILABLE` 标注。
fn emit_transport_error(on_event: &EventFn, err: &tonic::transport::Error) {
    let message = err.to_string();
    (on_event)(GrpcEvent::Status {
        code: 14,
        message: message.clone(),
    });
    (on_event)(GrpcEvent::Error {
        message: format!("gRPC transport error: {}", message),
    });
}

/// 在还没发 Open 前失败时使用：同时发 Error + Closed，前端事件流立即收尾。
fn emit_error_and_closed(on_event: &EventFn, message: &str, start: Instant) {
    (on_event)(GrpcEvent::Error {
        message: message.to_string(),
    });
    (on_event)(GrpcEvent::Closed {
        total_ms: start.elapsed().as_millis() as u64,
        message_count: 0,
    });
}

/// 当前 Unix 毫秒时间戳，用于事件 `ts_ms` 字段。
fn now_ms() -> u64 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_millis() as u64)
        .unwrap_or(0)
}

#[allow(dead_code)]
fn _unused_keep_link(_: &HashMap<String, String>) {}