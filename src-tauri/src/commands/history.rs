
use tauri::AppHandle;

use crate::error::{AppError, AppResult};
use crate::storage::{self, history::{HistoryDetail, HistoryEntry}};
use crate::workspace;

#[tauri::command]
pub async fn list_history(
    app: AppHandle,
    limit: Option<i64>,
) -> AppResult<Vec<HistoryEntry>> {
    let db = storage::get_db(&app)?;
    let root = workspace::get_workspace_root(&app)
        .ok_or_else(|| AppError::Workspace("No workspace open".to_string()))?;
    db.with_handle(|conn| storage::history::list_by_workspace(conn, &root, limit))
}

#[tauri::command]
pub async fn get_history_detail(app: AppHandle, id: i64) -> AppResult<HistoryDetail> {
    let db = storage::get_db(&app)?;
    db.with_handle(|conn| storage::history::get_detail(conn, id))
}

#[tauri::command]
pub async fn clear_history(app: AppHandle) -> AppResult<()> {
    let db = storage::get_db(&app)?;
    let root = workspace::get_workspace_root(&app)
        .ok_or_else(|| AppError::Workspace("No workspace open".to_string()))?;
    db.with_handle(|conn| storage::history::clear_by_workspace(conn, &root))
}

#[tauri::command]
pub async fn delete_history(app: AppHandle, id: i64) -> AppResult<bool> {
    let db = storage::get_db(&app)?;
    let root = workspace::get_workspace_root(&app)
        .ok_or_else(|| AppError::Workspace("No workspace open".to_string()))?;
    db.with_handle(|conn| storage::history::delete_by_id(conn, id, &root))
}
