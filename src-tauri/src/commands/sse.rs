
use std::collections::HashMap;
use std::sync::Mutex;
use std::time::{Duration, Instant};

use futures_util::StreamExt;
use tauri::{AppHandle, Emitter, Manager};
use tokio_util::sync::CancellationToken;

use crate::error::{AppError, AppResult};
use crate::executor;
use crate::parser::{self};
use crate::sse;
use crate::storage;
use crate::transport::{RawResponse, ResponseBody, StreamChunk};
use crate::variables::merge_variables;
use crate::workspace;

#[derive(Default)]
pub struct SseState {
    pub entries: Mutex<HashMap<String, SseEntry>>,
}

pub struct SseEntry {
    pub cancel: CancellationToken,
    pub task: Option<tokio::task::JoinHandle<()>>,
}

#[derive(Debug, serde::Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ExecuteSseArgs {
    pub req_id: String,
    pub raw_text: String,
    pub line_offset: Option<usize>,
    pub env_name: Option<String>,
    pub file_path: Option<String>,
}

#[derive(Debug, Clone, serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SseStartPayload {
    pub req_id: String,
    pub status: u16,
    pub status_text: String,
    pub headers: Vec<(String, String)>,
    pub url: String,
    pub connect_ms: u64,
    pub cookies: Vec<String>,
}

#[derive(Debug, Clone, serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SseEventPayload {
    pub req_id: String,
    pub event: sse::SseEvent,
}

#[derive(Debug, Clone, serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SseEndPayload {
    pub req_id: String,
    pub total_events: usize,
    pub total_ms: u64,
}

#[derive(Debug, Clone, serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SseErrorPayload {
    pub req_id: String,
    pub error: String,
}

#[tauri::command]
pub async fn execute_sse(
    app: AppHandle,
    args: ExecuteSseArgs,
) -> AppResult<()> {
    let req_id = args.req_id.clone();

    let parsed_file = parser::parse(&args.raw_text).map_err(|e| {
        log::error!("[execute_sse] parse error: {}", e);
        e
    })?;

    let request = if let Some(offset) = args.line_offset {
        parser::extract_single_request(&parsed_file, offset).map_err(|e| {
            log::error!("[execute_sse] extract_single_request error: {}", e);
            e
        })?
    } else {
        parsed_file
            .requests
            .first()
            .cloned()
            .ok_or_else(|| AppError::Parse("No request found in file".to_string()))?
    };

    let mut env_vars: HashMap<String, String> = HashMap::new();
    if let Some(env_name) = &args.env_name {
        if !env_name.is_empty() {
            let root = workspace::get_workspace_root(&app).ok_or_else(|| {
                AppError::Workspace("No workspace open for environment variables".to_string())
            })?;
            env_vars = workspace::env_file::get_environment_vars(&root, env_name).map_err(|e| {
                log::error!("[execute_sse] env error: {}", e);
                e
            })?;
        }
    }

    let variables = merge_variables(
        &env_vars,
        &parsed_file.global_variables,
        &request.variables,
    );

    let db = storage::get_db(&app)?;
    let exec = executor::create_default_executor();

    let cancel = CancellationToken::new();
    {
        let state = app.state::<SseState>();
        let mut entries = state.entries.lock().unwrap();
        entries.insert(req_id.clone(), SseEntry {
            cancel: cancel.clone(),
            task: None,
        });
    }

    let (partial, mut stream) = tokio::select! {
        r = exec.execute_stream(&request, &variables, db) => r.map_err(|e| {
            log::error!("[execute_sse] stream error: {}", e);
            e
        })?,
        _ = cancel.cancelled() => {
            log::info!("[execute_sse] cancelled before connect: {}", req_id);
            let state = app.state::<SseState>();
            let mut entries = state.entries.lock().unwrap();
            entries.remove(&req_id);
            return Ok(());
        }
    };

    if cancel.is_cancelled() {
        log::info!("[execute_sse] cancelled after connect: {}", req_id);
        let state = app.state::<SseState>();
        let mut entries = state.entries.lock().unwrap();
        entries.remove(&req_id);
        return Ok(());
    }

    let _ = app.emit("sse-start", SseStartPayload {
        req_id: req_id.clone(),
        status: partial.status,
        status_text: partial.status_text.clone(),
        headers: partial.headers.clone(),
        url: partial.url.clone(),
        connect_ms: partial.duration_ms,
        cookies: partial.cookies.clone(),
    });

    let app2 = app.clone();
    let req_id2 = req_id.clone();
    let connect_ms = partial.duration_ms;
    let stream_start = Instant::now();
    let cancel2 = cancel.clone();
    let workspace_root = workspace::get_workspace_root(&app).unwrap_or_default();
    let file_path = args.file_path.clone();
    let request_for_history = request.clone();
    let partial_for_history = partial.clone();
    let no_log = request.tags.no_log;
    // 默认 30s idle 超时；用户可用 @idle-timeout 覆盖（设为 0 表示永不超时）
    let idle_timeout = match request.tags.idle_timeout_ms {
        Some(0) => None,
        Some(ms) => Some(Duration::from_millis(ms)),
        None => Some(Duration::from_secs(30)),
    };

    let task = tokio::spawn(async move {
        let mut parser = sse::SseParser::new();
        let mut total = 0usize;
        let mut all_events: Vec<crate::sse::SseEvent> = Vec::new();
        let mut last_chunk_at = Instant::now();

        loop {
            // idle timer：超过指定间隔未收到任何 chunk 则断开。每次收到数据后顺延。
            let idle_fut: futures_util::future::Either<tokio::time::Sleep, std::future::Pending<()>> = match idle_timeout {
                Some(d) => futures_util::future::Either::Left(tokio::time::sleep_until((last_chunk_at + d).into())),
                None => futures_util::future::Either::Right(std::future::pending()),
            };

            tokio::select! {
                _ = cancel2.cancelled() => {
                    log::info!("[sse] cancel requested, closing");
                    break;
                }
                _ = idle_fut => {
                    log::warn!("[sse] idle timeout after {:?}", idle_timeout);
                    let _ = app2.emit("sse-error", SseErrorPayload {
                        req_id: req_id2.clone(),
                        error: format!("idle timeout after {:?}", idle_timeout),
                    });
                    break;
                }
                chunk = stream.next() => {
                    match chunk {
                        Some(StreamChunk::Data(bytes)) => {
                            last_chunk_at = Instant::now();
                            let events = parser.feed(&bytes);
                            for evt in events {
                                total += 1;
                                all_events.push(evt.clone());
                                let _ = app2.emit("sse-event", SseEventPayload {
                                    req_id: req_id2.clone(),
                                    event: evt,
                                });
                            }
                        }
                        Some(StreamChunk::Error(err)) => {
                            log::error!("[sse] stream error: {}", err);
                            let _ = app2.emit("sse-error", SseErrorPayload {
                                req_id: req_id2.clone(),
                                error: err,
                            });
                            break;
                        }
                        None => {
                            let remaining = parser.finish();
                            for evt in remaining {
                                total += 1;
                                all_events.push(evt.clone());
                                let _ = app2.emit("sse-event", SseEventPayload {
                                    req_id: req_id2.clone(),
                                    event: evt,
                                });
                            }
                            break;
                        }
                    }
                }
            }
        }

        let total_ms = connect_ms + stream_start.elapsed().as_millis() as u64;
        let _ = app2.emit("sse-end", SseEndPayload {
            req_id: req_id2.clone(),
            total_events: total,
            total_ms,
        });

        if !no_log {
            let response = RawResponse {
                status: partial_for_history.status,
                status_text: partial_for_history.status_text.clone(),
                version: partial_for_history.version.clone(),
                headers: partial_for_history.headers.clone(),
                body: ResponseBody::Sse(all_events),
                duration_ms: total_ms,
                size: 0,
                url: partial_for_history.url.clone(),
                cookies: partial_for_history.cookies.clone(),
            };
            if let Ok(db) = storage::get_db(&app2) {
                let req_snap = serde_json::to_string_pretty(&request_for_history).unwrap_or_default();
                let resp_snap = serde_json::to_string_pretty(&response).unwrap_or_default();
                let _ = db.with_handle(|conn| {
                    storage::history::insert(
                        conn,
                        &storage::history::NewHistoryEntry {
                            workspace_path: workspace_root.clone(),
                            file_path: file_path.clone(),
                            method: request_for_history.method.as_str().to_string(),
                            url: response.url.clone(),
                            status: Some(response.status as i64),
                            duration_ms: Some(response.duration_ms as i64),
                            request_snapshot: Some(req_snap),
                            response_snapshot: Some(resp_snap),
                        },
                    )
                });
            }
        }

        let state = app2.state::<SseState>();
        let mut entries = state.entries.lock().unwrap();
        entries.remove(&req_id2);
    });

    {
        let state = app.state::<SseState>();
        let mut entries = state.entries.lock().unwrap();
        if let Some(entry) = entries.get_mut(&req_id) {
            entry.task = Some(task);
        }
    }

    Ok(())
}

#[tauri::command]
pub async fn stop_sse(app: AppHandle, req_id: String) -> AppResult<()> {
    let state = app.state::<SseState>();
    let mut entries = state.entries.lock().unwrap();
    if let Some(mut entry) = entries.remove(&req_id) {
        entry.cancel.cancel();
        if let Some(task) = entry.task.take() {
            task.abort();
        }
        log::info!("[stop_sse] stop: {}", req_id);
    } else {
        log::warn!("[stop_sse] req_id not found: {}", req_id);
    }
    Ok(())
}
