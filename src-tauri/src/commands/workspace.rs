
use tauri::AppHandle;

use crate::config::AppConfig;
use crate::error::{AppError, AppResult};
use crate::storage::{self, recent_workspaces::RecentWorkspace};
use crate::workspace::{self, tree::FileTreeNode};

#[tauri::command]
pub async fn open_workspace(app: AppHandle, path: String) -> AppResult<()> {
    workspace::open_workspace(&app, &path)
}

#[tauri::command]
pub async fn close_workspace(app: AppHandle) -> AppResult<()> {
    workspace::close_workspace(&app);
    Ok(())
}

#[tauri::command]
pub async fn get_workspace_path(app: AppHandle) -> AppResult<Option<String>> {
    Ok(workspace::get_workspace_root(&app))
}

#[tauri::command]
pub async fn get_file_tree(app: AppHandle) -> AppResult<Vec<FileTreeNode>> {
    let root = workspace::get_workspace_root(&app)
        .ok_or_else(|| AppError::Workspace("No workspace open".to_string()))?;
    let root_path = std::path::PathBuf::from(&root);
    let nodes = workspace::tree::read_tree(&root_path)
        .map_err(|e| AppError::Workspace(e.to_string()))?;
    Ok(nodes)
}

#[tauri::command]
pub async fn create_file(path: String, is_dir: bool) -> AppResult<()> {
    workspace::operations::create_file(&path, is_dir)
}

#[tauri::command]
pub async fn rename_node(old_path: String, new_path: String) -> AppResult<()> {
    workspace::operations::rename_node(&old_path, &new_path)
}

#[tauri::command]
pub async fn delete_node(path: String) -> AppResult<()> {
    workspace::operations::delete_node(&path)
}

#[tauri::command]
pub async fn move_node(src: String, dest_dir: String) -> AppResult<()> {
    workspace::operations::move_node(&src, &dest_dir)
}

#[tauri::command]
pub async fn read_file(path: String) -> AppResult<String> {
    workspace::operations::read_file(&path)
}

#[tauri::command]
pub async fn save_file(path: String, content: String) -> AppResult<()> {
    workspace::operations::save_file(&path, &content)
}

#[tauri::command]
pub async fn list_recent_workspaces(app: AppHandle) -> AppResult<Vec<RecentWorkspace>> {
    let db = storage::get_db(&app)?;
    db.with_handle(|conn| storage::recent_workspaces::list(conn, Some(10)))
}

#[tauri::command]
pub async fn remove_recent_workspace(app: AppHandle, path: String) -> AppResult<()> {
    let db = storage::get_db(&app)?;
    db.with_handle(|conn| {
        storage::recent_workspaces::remove(conn, &path)?;
        storage::history::clear_by_workspace(conn, &path)
    })?;

    let mut cfg = AppConfig::load(&app)?;
    cfg.workspaces.remove(&path);
    if cfg.last_workspace.as_deref() == Some(&path) {
        cfg.last_workspace = None;
    }
    cfg.save(&app)?;

    Ok(())
}
