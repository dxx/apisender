
use std::collections::HashMap;
use std::sync::Mutex;

use serde::{Deserialize, Serialize};
use tauri::{AppHandle, Manager};
use tokio_util::sync::CancellationToken;

use crate::error::{AppError, AppResult};
use crate::executor;
use crate::parser::{self, RequestPreview};
use crate::storage;
use crate::transport::RawResponse;
use crate::variables::merge_variables;
use crate::workspace;

#[derive(Default)]
pub struct HttpState {
    pub entries: Mutex<HashMap<String, CancellationToken>>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ExecuteHttpArgs {
    pub req_id: String,
    pub raw_text: String,
    pub line_offset: Option<usize>,
    pub env_name: Option<String>,
    pub file_path: Option<String>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ExecutionResult {
    pub request_snapshot: serde_json::Value,
    pub response: RawResponse,
    pub history_id: Option<i64>,
}

#[tauri::command]
pub async fn execute_http(
    app: AppHandle,
    args: ExecuteHttpArgs,
) -> AppResult<ExecutionResult> {
    let parsed_file = parser::parse(&args.raw_text).map_err(|e| {
        log::error!("[execute_http] parse error: {}", e);
        e
    })?;

    let request = if let Some(offset) = args.line_offset {
        parser::extract_single_request(&parsed_file, offset).map_err(|e| {
            log::error!("[execute_http] extract_single_request error: {}", e);
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
                log::error!("[execute_http] env error: {}", e);
                e
            })?;
        }
    }

    let variables = merge_variables(
        &env_vars,
        &parsed_file.global_variables,
        &request.variables,
    );

    let workspace_root = workspace::get_workspace_root(&app).unwrap_or_default();

    let db = storage::get_db(&app)?;

    let cancel = CancellationToken::new();
    {
        let state = app.state::<HttpState>();
        let mut entries = state.entries.lock().unwrap();
        entries.insert(args.req_id.clone(), cancel.clone());
    }

    let exec = executor::create_default_executor();
    let execute_fut = exec.execute(&request, &variables, db);
    let response = tokio::select! {
        r = execute_fut => {
            r.map_err(|e| {
                log::error!("[execute_http] execute error: {}", e);
                e
            })?
        }
        _ = cancel.cancelled() => {
            return Err(AppError::Cancelled);
        }
    };

    {
        let state = app.state::<HttpState>();
        state.entries.lock().unwrap().remove(&args.req_id);
    }

    let request_snapshot = serde_json::to_value(&request)?;

    let history_id = if !request.tags.no_log {
        let db = storage::get_db(&app)?;
        let req_snap = serde_json::to_string_pretty(&request)?;
        let resp_snap = serde_json::to_string_pretty(&response)?;
        Some(db.with_handle(|conn| {
            storage::history::insert(
                conn,
                &storage::history::NewHistoryEntry {
                    workspace_path: workspace_root.clone(),
                    file_path: args.file_path.clone(),
                    method: request.method.as_str().to_string(),
                    url: response.url.clone(),
                    status: Some(response.status as i64),
                    duration_ms: Some(response.duration_ms as i64),
                    request_snapshot: Some(req_snap),
                    response_snapshot: Some(resp_snap),
                },
            )
        })?)
    } else {
        None
    };

    Ok(ExecutionResult {
        request_snapshot,
        response,
        history_id,
    })
}

#[tauri::command]
pub async fn parse_preview(raw_text: String) -> AppResult<Vec<RequestPreview>> {
    let parsed = parser::parse(&raw_text)?;
    Ok(parsed.requests.iter().map(RequestPreview::from).collect())
}

#[tauri::command]
pub async fn cancel_http(app: AppHandle, req_id: String) -> AppResult<()> {
    let cancel = {
        let state = app.state::<HttpState>();
        state.entries.lock().unwrap().remove(&req_id)
    };
    if let Some(c) = cancel {
        c.cancel();
        log::info!("[cancel_http] cancel: {}", req_id);
    } else {
        log::warn!("[cancel_http] not found: {}", req_id);
    }
    Ok(())
}
