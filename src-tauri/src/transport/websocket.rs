
use std::collections::VecDeque;
use std::time::{Duration, SystemTime, UNIX_EPOCH};

use futures_util::{future::Either, stream::StreamExt, SinkExt};
use tokio::time::Instant;
use tokio_tungstenite::tungstenite::protocol::{
    frame::coding::CloseCode, CloseFrame, Message,
};
use tokio_util::sync::CancellationToken;

use crate::error::{AppError, AppResult};
use crate::parser::WsMessage;


/// 外部控制 WebSocket 连接的句柄：上行消息通道 + 取消令牌。
#[derive(Debug)]
pub struct WsHandle {
    pub to_ws_rx: tokio::sync::mpsc::Receiver<String>,
    pub cancel: CancellationToken,
}

/// 连接成功时回执当前握手响应头（其它字段暂时不在此暴露）。
#[derive(Debug, Clone)]
pub struct WsConnectAck {
    pub response_headers: Vec<(String, String)>,
}

/// 推给上层的事件流：Open → Message* → Close/IdleTimeout/Error → Closed。
#[derive(Debug, Clone)]
pub enum WsEvent {
    /// 握手完成，已确认状态码与响应头。
    Open {
        status: u16,
        status_text: String,
        response_headers: Vec<(String, String)>,
    },
    /// 服务端发来的文本帧。
    Message {
        data: String,
        index: u64,
        ts_ms: u64,
    },
    /// 收到 close 帧或握手后主动 close。
    Close {
        code: u16,
        reason: String,
    },
    /// 在指定时间内既无收到帧也无发帧时触发。
    IdleTimeout {
        idle_ms: u64,
    },
    /// 任意阶段的协议/网络错误。
    Error {
        message: String,
    },
    /// 事件流收尾，与 Open 严格一一对应。
    Closed,
}

/// WebSocket 传输层统一入口。
pub struct WebSocketTransport;

impl Default for WebSocketTransport {
    fn default() -> Self {
        WebSocketTransport::new()
    }
}

impl WebSocketTransport {
    pub fn new() -> Self {
        WebSocketTransport
    }

    /// 发起握手并循环跑读写任务。
    /// 作用与流程：握手（带超时）→ 解析 `Open` 事件 → 拆 `initial_messages` 为立即发送 / wait-for-server 队列 →
    /// 进入四路 select（读帧 / 写用户消息 / 取消 / 空闲超时），任意分支终止后输出 `Closed`。
    pub async fn connect(
        &self,
        url: &str,
        initial_messages: Vec<WsMessage>,
        handle: WsHandle,
        handshake_timeout: Option<Duration>,
        idle_timeout: Option<Duration>,
        on_event: impl Fn(WsEvent) + Send + 'static,
    ) -> AppResult<WsConnectAck> {
        log::info!("[ws] connecting to {}", url);

        let connect_fut = tokio_tungstenite::connect_async(url);
        let (ws_stream, response) = match handshake_timeout {
            Some(d) => match tokio::time::timeout(d, connect_fut).await {
                Ok(r) => r.map_err(map_ws_err)?,
                Err(_) => {
                    return Err(AppError::Invalid(format!(
                        "WebSocket handshake timeout after {:?}",
                        d
                    )));
                }
            },
            None => connect_fut.await.map_err(map_ws_err)?,
        };

        let response_status = response.status().as_u16();
        let response_status_text = response
            .status()
            .canonical_reason()
            .unwrap_or("")
            .to_string();
        let ack_headers: Vec<(String, String)> = response
            .headers()
            .iter()
            .map(|(k, v)| (k.as_str().to_string(), v.to_str().unwrap_or("").to_string()))
            .collect();

        let mut ws = ws_stream;

        let mut pending_waits: VecDeque<String> = VecDeque::new();
        let mut immediate: Vec<String> = Vec::new();
        // 区分立即发送和等待服务端响应后再发的消息：标记 `wait_for_server` 的进入队列，其余连发。
        for m in initial_messages {
            if m.wait_for_server {
                pending_waits.push_back(m.text);
            } else if !m.text.is_empty() {
                immediate.push(m.text);
            }
        }

        let mut last_frame = Instant::now();
        let mut index: u64 = 0;

        for text in &immediate {
            log::debug!("[ws] sending initial message ({} bytes)", text.len());
            ws.send(Message::Text(text.clone().into()))
                .await
                .map_err(map_ws_err)?;
            last_frame = Instant::now();
        }

        on_event(WsEvent::Open {
            status: response_status,
            status_text: response_status_text,
            response_headers: ack_headers.clone(),
        });

        let mut handle = handle;
        loop {
            let idle_fut: Either<tokio::time::Sleep, std::future::Pending<()>> = match idle_timeout {
                Some(d) => Either::Left(tokio::time::sleep_until(last_frame + d)),
                None => Either::Right(std::future::pending()),
            };

            tokio::select! {
                msg = ws.next() => {
                    match msg {
                        Some(Ok(Message::Text(t))) => {
                            let data = t.to_string();
                            index += 1;
                            last_frame = Instant::now();
                            let ts_ms = now_ms();
                            log::debug!("[ws] received text frame ({} bytes, index={})", data.len(), index);
                            on_event(WsEvent::Message {
                                data: data.clone(),
                                index,
                                ts_ms,
                            });
                            // 收到服务端响应后立刻出队一条 wait-for-server 消息继续发送。
                            if let Some(next) = pending_waits.pop_front() {
                                log::debug!("[ws] wait-for-server resolved, sending next message");
                                ws.send(Message::Text(next.into())).await.map_err(map_ws_err)?;
                                last_frame = Instant::now();
                            }
                        }
                        Some(Ok(Message::Binary(_))) => {
                            last_frame = Instant::now();
                            log::debug!("[ws] ignoring binary frame (text-only mode)");
                        }
                        Some(Ok(Message::Ping(_))) => {
                            last_frame = Instant::now();
                        }
                        Some(Ok(Message::Pong(_))) => {
                            last_frame = Instant::now();
                        }
                        Some(Ok(Message::Close(c))) => {
                            let (code, reason) = c
                                .as_ref()
                                .map(|c| (u16::from(c.code), c.reason.to_string()))
                                .unwrap_or((1000, String::new()));
                            log::info!("[ws] received close frame code={} reason={}", code, reason);
                            on_event(WsEvent::Close { code, reason });
                            break;
                        }
                        Some(Ok(Message::Frame(_))) => {
                            last_frame = Instant::now();
                        }
                        Some(Err(e)) => {
                            log::error!("[ws] stream error: {}", e);
                            on_event(WsEvent::Error {
                                message: e.to_string(),
                            });
                            break;
                        }
                        None => {
                            log::info!("[ws] stream ended");
                            break;
                        }
                    }
                }
                Some(text) = handle.to_ws_rx.recv() => {
                    log::debug!("[ws] sending user message ({} bytes)", text.len());
                    ws.send(Message::Text(text.into())).await.map_err(map_ws_err)?;
                    last_frame = Instant::now();
                }
                _ = handle.cancel.cancelled() => {
                    log::info!("[ws] cancel requested, closing");
                    on_event(WsEvent::Close {
                        code: u16::from(CloseCode::Normal),
                        reason: "client cancel".to_string(),
                    });
                    let _ = ws
                        .close(Some(CloseFrame {
                            code: CloseCode::Normal,
                            reason: "client cancel".into(),
                        }))
                        .await;

                    break;
                }
                _ = idle_fut => {
                    let idle_ms = idle_timeout.map(|d| d.as_millis() as u64).unwrap_or(0);
                    if !handle.cancel.is_cancelled() {
                        log::warn!("[ws] idle timeout after {}ms, closing connection", idle_ms);
                    }
                    on_event(WsEvent::IdleTimeout { idle_ms });
                    let _ = ws
                        .close(Some(CloseFrame {
                            code: CloseCode::Away,
                            reason: "idle timeout".into(),
                        }))
                        .await;
                    break;
                }
            }
        }

        on_event(WsEvent::Closed);

        Ok(WsConnectAck {
            response_headers: ack_headers,
        })
    }
}

/// 当前 Unix 毫秒时间戳，给事件 `ts_ms` 字段使用。
fn now_ms() -> u64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_millis() as u64)
        .unwrap_or(0)
}

/// 把 tungstenite 错误统一包装成 `AppError::Invalid`，附带协议前缀。
fn map_ws_err(e: tokio_tungstenite::tungstenite::Error) -> AppError {
    AppError::Invalid(format!("WebSocket error: {}", e))
}
