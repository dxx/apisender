
use std::collections::HashMap;
use std::sync::Mutex;
use std::time::{Duration, Instant};

use serde::Deserialize;
use tauri::{AppHandle, Emitter, Manager};
use tokio::sync::mpsc;
use tokio_util::sync::CancellationToken;

use crate::error::{AppError, AppResult};
use crate::parser::{self};
use crate::storage;
use crate::transport::websocket::{WsEvent, WsHandle, WebSocketTransport};
use crate::variables::{interpolate_ws_request, merge_variables};
use crate::workspace;

#[derive(Default)]
pub struct WsState {
    pub entries: Mutex<HashMap<String, WsEntry>>,
}

pub struct WsEntry {
    pub to_ws_tx: mpsc::Sender<String>,
    pub cancel: CancellationToken,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ExecuteWsArgs {
    pub req_id: String,
    pub raw_text: String,
    pub line_offset: Option<usize>,
    pub env_name: Option<String>,
    pub file_path: Option<String>,
}

#[derive(Debug, Clone, serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct WsStartPayload {
    pub req_id: String,
    pub status: u16,
    pub status_text: String,
    pub headers: Vec<(String, String)>,
    pub url: String,
    pub connect_ms: u64,
}

#[derive(Debug, Clone, serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct WsMessagePayload {
    pub req_id: String,
    pub data: String,
    pub index: u64,
    pub ts_ms: u64,
}

#[derive(Debug, Clone, serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct WsClosePayload {
    pub req_id: String,
    pub code: u16,
    pub reason: String,
}

#[derive(Debug, Clone, serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct WsIdleTimeoutPayload {
    pub req_id: String,
    pub idle_ms: u64,
}

#[derive(Debug, Clone, serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct WsErrorPayload {
    pub req_id: String,
    pub error: String,
}

#[derive(Debug, Clone, serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct WsClosedPayload {
    pub req_id: String,
    pub total_ms: u64,
}

#[tauri::command]
pub async fn execute_websocket(app: AppHandle, args: ExecuteWsArgs) -> AppResult<String> {
    let req_id = args.req_id;
    let line_offset = args.line_offset.unwrap_or(0);

    let parsed_file = parser::parse(&args.raw_text).map_err(|e| {
        log::error!("[execute_websocket] parse error: {}", e);
        e
    })?;
    let ws_req = parser::extract_single_ws_request(&parsed_file, line_offset).map_err(|e| {
        log::error!("[execute_websocket] extract_single_ws_request error: {}", e);
        e
    })?;

    let mut env_vars: HashMap<String, String> = HashMap::new();
    if let Some(env_name) = &args.env_name {
        if !env_name.is_empty() {
            let root = workspace::get_workspace_root(&app).ok_or_else(|| {
                AppError::Workspace("No workspace open for environment variables".to_string())
            })?;
            env_vars = workspace::env_file::get_environment_vars(&root, env_name).map_err(|e| {
                log::error!("[execute_websocket] env error: {}", e);
                e
            })?;
        }
    }

    let merged = merge_variables(
        &env_vars,
        &parsed_file.global_variables,
        &ws_req.variables,
    );
    let resolved = interpolate_ws_request(&ws_req, &merged)?;

    let (tx, rx) = mpsc::channel::<String>(32);
    let cancel = CancellationToken::new();

    {
        let state = app.state::<WsState>();
        let mut entries = state.entries.lock().unwrap();
        entries.insert(
            req_id.clone(),
            WsEntry {
                to_ws_tx: tx,
                cancel: cancel.clone(),
            },
        );
    }

    let handshake_timeout = Some(Duration::from_millis(
        resolved.tags.connection_timeout_ms.unwrap_or(10_000),
    ));
    // 默认 30s idle 超时；用户可用 @idle-timeout 覆盖（设为 0 表示永不超时）
    let idle_timeout = match resolved.tags.idle_timeout_ms {
        Some(0) => None,
        Some(ms) => Some(Duration::from_millis(ms)),
        None => Some(Duration::from_secs(30)),
    };

    let no_log = resolved.tags.no_log;
    let workspace_root = workspace::get_workspace_root(&app).unwrap_or_default();
    let file_path = args.file_path.clone();

    let req_id_for_task = req_id.clone();
    let url = resolved.url.clone();
    let initial = resolved.messages.clone();
    let app_handle = app.clone();

    tokio::spawn(async move {
        let start = Instant::now();
        let app_for_event = app_handle.clone();
        let req_id_for_event = req_id_for_task.clone();
        let url_for_event = url.clone();

        let on_event = move |event: WsEvent| match event {
            WsEvent::Open { status, status_text, response_headers } => {
                let connect_ms = start.elapsed().as_millis() as u64;
                let _ = app_for_event.emit(
                    "ws-open",
                    WsStartPayload {
                        req_id: req_id_for_event.clone(),
                        status,
                        status_text,
                        headers: response_headers,
                        url: url_for_event.clone(),
                        connect_ms,
                    },
                );
            }
            WsEvent::Message { data, index, ts_ms } => {
                let _ = app_for_event.emit(
                    "ws-message",
                    WsMessagePayload {
                        req_id: req_id_for_event.clone(),
                        data,
                        index,
                        ts_ms,
                    },
                );
            }
            WsEvent::Close { code, reason } => {
                let _ = app_for_event.emit(
                    "ws-close",
                    WsClosePayload {
                        req_id: req_id_for_event.clone(),
                        code,
                        reason,
                    },
                );
            }
            WsEvent::IdleTimeout { idle_ms } => {
                let _ = app_for_event.emit(
                    "ws-idle-timeout",
                    WsIdleTimeoutPayload {
                        req_id: req_id_for_event.clone(),
                        idle_ms,
                    },
                );
            }
            WsEvent::Error { message } => {
                let _ = app_for_event.emit(
                    "ws-error",
                    WsErrorPayload {
                        req_id: req_id_for_event.clone(),
                        error: message,
                    },
                );
            }
            WsEvent::Closed => {
                let total_ms = start.elapsed().as_millis() as u64;
                let _ = app_for_event.emit(
                    "ws-closed",
                    WsClosedPayload {
                        req_id: req_id_for_event.clone(),
                        total_ms,
                    },
                );
            }
        };

        let handle = WsHandle {
            to_ws_rx: rx,
            cancel: cancel.clone(),
        };

        let transport = WebSocketTransport::new();
        let url_for_log = url.clone();
        let app_for_error = app_handle.clone();
        let req_id_for_error = req_id_for_task.clone();
        let start_for_error = start;
        let result = transport
            .connect(
                &url,
                initial,
                handle,
                handshake_timeout,
                idle_timeout,
                on_event,
            )
            .await;

        if let Err(e) = result {
            log::error!("[ws] connect to {} failed: {}", url_for_log, e);
            let _ = app_for_error.emit(
                "ws-error",
                WsErrorPayload {
                    req_id: req_id_for_error.clone(),
                    error: format!("{}", e),
                },
            );
            let _ = app_for_error.emit(
                "ws-closed",
                WsClosedPayload {
                    req_id: req_id_for_error.clone(),
                    total_ms: start_for_error.elapsed().as_millis() as u64,
                },
            );
        }

        if !no_log {
            let total_ms = start_for_error.elapsed().as_millis() as u64;
            if let Ok(db) = storage::get_db(&app_for_error) {
                let _ = db.with_handle(|conn| {
                    storage::history::insert(
                        conn,
                        &storage::history::NewHistoryEntry {
                            workspace_path: workspace_root.clone(),
                            file_path: file_path.clone(),
                            method: "WEBSOCKET".to_string(),
                            url: url.clone(),
                            status: Some(101),
                            duration_ms: Some(total_ms as i64),
                            request_snapshot: None,
                            response_snapshot: None,
                        },
                    )
                });
            }
        }

        if let Some(state) = app_handle.try_state::<WsState>() {
            let mut entries = state.entries.lock().unwrap();
            entries.remove(&req_id_for_task);
        }
    });

    Ok(req_id)
}

#[tauri::command]
pub async fn send_websocket(
    app: AppHandle,
    req_id: String,
    message: String,
) -> AppResult<()> {
    let tx = {
        let state = app.state::<WsState>();
        let entries = state.entries.lock().unwrap();
        entries
            .get(&req_id)
            .map(|e| e.to_ws_tx.clone())
            .ok_or_else(|| AppError::Invalid(format!("WebSocket {} not found", req_id)))?
    };
    tx.send(message)
        .await
        .map_err(|e| AppError::Invalid(format!("Failed to send WebSocket message: {}", e)))?;
    Ok(())
}

#[tauri::command]
pub async fn close_websocket(app: AppHandle, req_id: String) -> AppResult<()> {
    let cancel = {
        let state = app.state::<WsState>();
        let entries = state.entries.lock().unwrap();
        entries
            .get(&req_id)
            .map(|e| e.cancel.clone())
            .ok_or_else(|| AppError::Invalid(format!("WebSocket {} not found", req_id)))?
    };
    cancel.cancel();
    log::info!("[close_websocket] close: {}", req_id);
    Ok(())
}