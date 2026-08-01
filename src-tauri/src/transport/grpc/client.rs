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

pub async fn invoke(req: GrpcCallRequest, loaded: LoadedMethod) -> AppResult<()> {
    let kind = GrpcStreamingKind::from_method(&loaded.method);
    let start = Instant::now();

    let endpoint = build_endpoint(&req.url, req.connection_timeout)?;

    let channel = endpoint.connect().await.map_err(|e| {
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

fn build_metadata_map(metadata: &[(String, String)]) -> MetadataMap {
    use tonic::metadata::Ascii;

    let mut map = MetadataMap::new();
    for (k, v) in metadata {
        let key_lower = k.to_ascii_lowercase();
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

fn emit_error_and_closed(on_event: &EventFn, message: &str, start: Instant) {
    (on_event)(GrpcEvent::Error {
        message: message.to_string(),
    });
    (on_event)(GrpcEvent::Closed {
        total_ms: start.elapsed().as_millis() as u64,
        message_count: 0,
    });
}

fn now_ms() -> u64 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_millis() as u64)
        .unwrap_or(0)
}

#[allow(dead_code)]
fn _unused_keep_link(_: &HashMap<String, String>) {}