use crate::transport::grpc as grpc;

use std::collections::HashMap;
use std::sync::{Arc, Mutex};
use std::time::Instant;

use serde::Deserialize;
use tauri::{AppHandle, Emitter, Manager};
use tokio_util::sync::CancellationToken;

use crate::error::{AppError, AppResult};
use crate::parser::{self};
use grpc::{
    invoke_grpc, resolve_method, GrpcCallRequest, GrpcEvent, ReflectionChannel,
};
use crate::storage;
use crate::variables::{interpolate_grpc_request, merge_variables};
use crate::version::USER_AGENT;
use crate::workspace;

#[derive(Default)]
pub struct GrpcState {
    pub entries: Mutex<HashMap<String, CancellationToken>>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ExecuteGrpcArgs {
    pub req_id: String,
    pub raw_text: String,
    pub line_offset: Option<usize>,
    pub env_name: Option<String>,
    pub file_path: Option<String>,
}

#[derive(Debug, Clone, serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct GrpcStartPayload {
    pub req_id: String,
    pub url: String,
    pub package: String,
    pub service: String,
    pub method: String,
    pub streaming_kind: String,
    pub connect_ms: u64,
}

#[derive(Debug, Clone, serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct GrpcMessagePayload {
    pub req_id: String,
    pub index: u32,
    pub data: String,
    pub ts_ms: u64,
}

#[derive(Debug, Clone, serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct GrpcMetadataPayload {
    pub req_id: String,
    pub metadata: Vec<(String, String)>,
}

#[derive(Debug, Clone, serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct GrpcStatusPayload {
    pub req_id: String,
    pub code: i32,
    pub message: String,
}

#[derive(Debug, Clone, serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct GrpcErrorPayload {
    pub req_id: String,
    pub error: String,
}

#[derive(Debug, Clone, serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct GrpcClosedPayload {
    pub req_id: String,
    pub total_ms: u64,
    pub message_count: u32,
}

#[tauri::command]
pub async fn execute_grpc(app: AppHandle, args: ExecuteGrpcArgs) -> AppResult<String> {
    let req_id = args.req_id;
    let line_offset = args.line_offset.unwrap_or(0);

    let parsed_file = parser::parse(&args.raw_text).map_err(|e| {
        log::error!("[execute_grpc] parse error: {}", e);
        e
    })?;

    let grpc_req = parser::extract_single_grpc_request(&parsed_file, line_offset).map_err(|e| {
        log::error!("[execute_grpc] extract_single_grpc_request error: {}", e);
        e
    })?;

    let mut env_vars: HashMap<String, String> = HashMap::new();
    if let Some(env_name) = &args.env_name {
        if !env_name.is_empty() {
            let root = workspace::get_workspace_root(&app).ok_or_else(|| {
                AppError::Workspace("No workspace open for environment variables".to_string())
            })?;
            env_vars = workspace::env_file::get_environment_vars(&root, env_name).map_err(|e| {
                log::error!("[execute_grpc] env error: {}", e);
                e
            })?;
        }
    }

    let merged = merge_variables(
        &env_vars,
        &parsed_file.global_variables,
        &grpc_req.variables,
    );
    let resolved = interpolate_grpc_request(&grpc_req, &merged)?;

    let cancel = CancellationToken::new();
    {
        let state = app.state::<GrpcState>();
        let mut entries = state.entries.lock().unwrap();
        entries.insert(req_id.clone(), cancel.clone());
    }

    let connection_timeout = std::time::Duration::from_millis(
        resolved.tags.connection_timeout_ms.unwrap_or(10_000),
    );
    let timeout =
        std::time::Duration::from_millis(resolved.tags.timeout_ms.unwrap_or(30_000));

    let req_id_for_task = req_id.clone();
    let url = resolved.url.clone();
    let package = resolved.package.clone();
    let service = resolved.service.clone();
    let method = resolved.method.clone();
    let proto_path = resolved.tags.proto.clone();
    let proto_includes = resolved.tags.proto_includes.clone();
    let metadata = resolved
        .metadata
        .iter()
        .map(|h| (h.key.clone(), h.value.clone()))
        .collect::<Vec<_>>();
    let body_json = resolved
        .message
        .as_ref()
        .map(|m| m.text.clone())
        .unwrap_or_default();
    let app_handle = app.clone();
    let workspace_root = workspace::get_workspace_root(&app).unwrap_or_default();
    let file_path = args.file_path.clone();
    let no_log = resolved.tags.no_log;
    let status_code_shared = Arc::new(Mutex::new(None::<i32>));

    tokio::spawn(async move {
        let start = Instant::now();
        let app_for_event = app_handle.clone();
        let app_for_closed = app_handle.clone();
        let req_id_for_event = req_id_for_task.clone();
        let workspace_root_closed = workspace_root.clone();
        let file_path_closed = file_path.clone();
        let url_closed = url.clone();
        let status_code_for_closed = status_code_shared.clone();
        let no_log_closed = no_log;
        let url_owned = url.clone();
        let package_owned = package.clone();
        let service_owned = service.clone();
        let method_owned = method.clone();

        let on_event_box: grpc::client::EventFn = {
            let cb = move |event: GrpcEvent| {
                match event {
                    GrpcEvent::Open {
                        url: open_url,
                        package: _,
                        service: _,
                        method: _,
                        streaming_kind,
                        connect_ms,
                    } => {
                        let kind_label = match streaming_kind {
                            grpc::GrpcStreamingKind::Unary => "unary",
                            grpc::GrpcStreamingKind::ServerStreaming => {
                                "server-streaming"
                            }
                        };
                        let _ = app_for_event.emit(
                            "grpc-start",
                            GrpcStartPayload {
                                req_id: req_id_for_event.clone(),
                                url: open_url,
                                package: package_owned.clone(),
                                service: service_owned.clone(),
                                method: method_owned.clone(),
                                streaming_kind: kind_label.to_string(),
                                connect_ms,
                            },
                        );
                    }
                    GrpcEvent::InitialMetadata { metadata } => {
                        let _ = app_for_event.emit(
                            "grpc-initial-metadata",
                            GrpcMetadataPayload {
                                req_id: req_id_for_event.clone(),
                                metadata,
                            },
                        );
                    }
                    GrpcEvent::Message {
                        index,
                        data,
                        ts_ms,
                    } => {
                        let _ = app_for_event.emit(
                            "grpc-message",
                            GrpcMessagePayload {
                                req_id: req_id_for_event.clone(),
                                index,
                                data,
                                ts_ms,
                            },
                        );
                    }
                    GrpcEvent::TrailingMetadata { metadata } => {
                        let _ = app_for_event.emit(
                            "grpc-trailing-metadata",
                            GrpcMetadataPayload {
                                req_id: req_id_for_event.clone(),
                                metadata,
                            },
                        );
                    }
                    GrpcEvent::Status { code, message } => {
                        if let Ok(mut c) = status_code_for_closed.lock() {
                            *c = Some(code);
                        }
                        let _ = app_for_event.emit(
                            "grpc-status",
                            GrpcStatusPayload {
                                req_id: req_id_for_event.clone(),
                                code,
                                message,
                            },
                        );
                    }
                    GrpcEvent::Error { message } => {
                        let _ = app_for_event.emit(
                            "grpc-error",
                            GrpcErrorPayload {
                                req_id: req_id_for_event.clone(),
                                error: message,
                            },
                        );
                    }
                    GrpcEvent::Closed {
                        total_ms,
                        message_count,
                    } => {
                        let _ = app_for_event.emit(
                            "grpc-closed",
                            GrpcClosedPayload {
                                req_id: req_id_for_event.clone(),
                                total_ms,
                                message_count,
                            },
                        );

                        if !no_log_closed {
                            let status_opt = status_code_for_closed.lock().ok().and_then(|c| *c);
                            if let Ok(db) = storage::get_db(&app_for_closed) {
                                let _ = db.with_handle(|conn| {
                                    storage::history::insert(
                                        conn,
                                        &storage::history::NewHistoryEntry {
                                            workspace_path: workspace_root_closed.clone(),
                                            file_path: file_path_closed.clone(),
                                            method: "GRPC".to_string(),
                                            url: url_closed.clone(),
                                            status: status_opt.map(|c| c as i64),
                                            duration_ms: Some(total_ms as i64),
                                            request_snapshot: None,
                                            response_snapshot: None,
                                        },
                                    )
                                });
                            }
                        }
                    }
                }
            };
            Box::new(cb)
        };

        let file_path_pb = file_path
            .as_deref()
            .map(std::path::Path::new);

        let reflection_endpoint = build_reflection_endpoint(&url);
        let reflection_channel = match reflection_endpoint {
            Some(ep) => Some(ReflectionChannel { endpoint: ep }),
            None => None,
        };

        let loaded = match resolve_method(
            &package,
            &service,
            &method,
            proto_path.as_deref(),
            &proto_includes,
            file_path_pb,
            std::path::Path::new(&workspace_root),
            reflection_channel.as_ref(),
        )
        .await
        {
            Ok(m) => m,
            Err(e) => {
                log::error!("[execute_grpc] resolve_method error: {}", e);
                let total_ms = start.elapsed().as_millis() as u64;
                let _ = app_handle.emit(
                    "grpc-error",
                    GrpcErrorPayload {
                        req_id: req_id_for_task.clone(),
                        error: e.to_string(),
                    },
                );
                let _ = app_handle.emit(
                    "grpc-closed",
                    GrpcClosedPayload {
                        req_id: req_id_for_task.clone(),
                        total_ms,
                        message_count: 0,
                    },
                );

                if !no_log {
                    if let Ok(db) = storage::get_db(&app_handle) {
                        let _ = db.with_handle(|conn| {
                            storage::history::insert(
                                conn,
                                &storage::history::NewHistoryEntry {
                                    workspace_path: workspace_root.clone(),
                                    file_path: file_path.clone(),
                                    method: "GRPC".to_string(),
                                    url: url.clone(),
                                    status: None,
                                    duration_ms: Some(total_ms as i64),
                                    request_snapshot: None,
                                    response_snapshot: None,
                                },
                            )
                        });
                    }
                }

                let state = app_handle.state::<GrpcState>();
                let mut entries = state.entries.lock().unwrap();
                entries.remove(&req_id_for_task);
                return;
            }
        };

        let req = GrpcCallRequest {
            url: url_owned,
            package,
            service,
            method,
            metadata,
            body_json,
            connection_timeout: Some(connection_timeout),
            timeout: Some(timeout),
            on_event: on_event_box,
            cancel: cancel.clone(),
        };

        if let Err(e) = invoke_grpc(req, loaded).await {
            log::error!("[execute_grpc] invoke error: {}", e);
        }

        let state = app_handle.state::<GrpcState>();
        let mut entries = state.entries.lock().unwrap();
        entries.remove(&req_id_for_task);
    });

    Ok(req_id)
}

#[tauri::command]
pub async fn stop_grpc(app: AppHandle, req_id: String) -> AppResult<()> {
    let state = app.state::<GrpcState>();
    let cancel = {
        let mut entries = state.entries.lock().unwrap();
        entries.remove(&req_id)
    };
    if let Some(c) = cancel {
        c.cancel();
        log::info!("[stop_grpc] stop: {}", req_id);
    } else {
        log::warn!("[stop_grpc] req_id not found: {}", req_id);
    }
    Ok(())
}

pub fn build_reflection_endpoint(url: &str) -> Option<tonic::transport::Endpoint> {
    let http_url = url
        .replacen("grpcs://", "https://", 1)
        .replacen("grpc://", "http://", 1);

    tonic::transport::Endpoint::from_shared(http_url)
        .ok()
        .and_then(|ep| ep.user_agent(USER_AGENT).ok())
}