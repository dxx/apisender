
use std::collections::HashMap;

use tauri::AppHandle;

use crate::error::{AppError, AppResult};
use crate::workspace::{self, env_file};

#[tauri::command]
pub async fn list_environments(app: AppHandle) -> AppResult<Vec<String>> {
    let root = workspace::get_workspace_root(&app)
        .ok_or_else(|| AppError::Workspace("No workspace open".to_string()))?;
    env_file::list_environment_names(&root)
}

#[tauri::command]
pub async fn get_environment_vars(
    app: AppHandle,
    name: String,
) -> AppResult<HashMap<String, String>> {
    let root = workspace::get_workspace_root(&app)
        .ok_or_else(|| AppError::Workspace("No workspace open".to_string()))?;
    env_file::get_environment_vars(&root, &name)
}
