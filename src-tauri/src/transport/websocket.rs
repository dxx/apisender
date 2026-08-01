
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


#[derive(Debug)]
pub struct WsHandle {
    pub to_ws_rx: tokio::sync::mpsc::Receiver<String>,
    pub cancel: CancellationToken,
}

#[derive(Debug, Clone)]
pub struct WsConnectAck {
    pub response_headers: Vec<(String, String)>,
}

#[derive(Debug, Clone)]
pub enum WsEvent {
    Open {
        status: u16,
        status_text: String,
        response_headers: Vec<(String, String)>,
    },
    Message {
        data: String,
        index: u64,
        ts_ms: u64,
    },
    Close {
        code: u16,
        reason: String,
    },
    IdleTimeout {
        idle_ms: u64,
    },
    Error {
        message: String,
    },
    Closed,
}

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

fn now_ms() -> u64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_millis() as u64)
        .unwrap_or(0)
}

fn map_ws_err(e: tokio_tungstenite::tungstenite::Error) -> AppError {
    AppError::Invalid(format!("WebSocket error: {}", e))
}
