
use tauri::AppHandle;

use crate::config::AppConfig;
use crate::error::AppResult;

#[tauri::command]
pub async fn get_theme(app: AppHandle) -> AppResult<Option<String>> {
    Ok(AppConfig::load(&app)?.theme)
}

#[tauri::command]
pub async fn set_theme(app: AppHandle, theme: String) -> AppResult<()> {
    let mut cfg = AppConfig::load(&app)?;
    cfg.theme = Some(theme);
    cfg.save(&app)
}

#[tauri::command]
pub async fn get_last_workspace(app: AppHandle) -> AppResult<Option<String>> {
    Ok(AppConfig::load(&app)?.last_workspace)
}

#[tauri::command]
pub async fn set_last_workspace(app: AppHandle, path: Option<String>) -> AppResult<()> {
    let mut cfg = AppConfig::load(&app)?;
    cfg.last_workspace = path;
    cfg.save(&app)
}

#[tauri::command]
pub async fn get_active_environment(
    app: AppHandle,
    workspace_path: String,
) -> AppResult<Option<String>> {
    Ok(AppConfig::load(&app)?
        .workspaces
        .get(&workspace_path)
        .and_then(|w| w.active_env.clone()))
}

#[tauri::command]
pub async fn set_active_environment(
    app: AppHandle,
    workspace_path: String,
    name: Option<String>,
) -> AppResult<()> {
    let mut cfg = AppConfig::load(&app)?;
    cfg.workspaces
        .entry(workspace_path)
        .or_default()
        .active_env = name;
    cfg.save(&app)
}
