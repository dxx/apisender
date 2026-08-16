
use serde::Serialize;
use tauri::AppHandle;

use crate::config::AppConfig;
use crate::error::AppResult;

#[derive(Serialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct FontSettings {
    pub editor_font_family: Option<String>,
    pub ui_font_family: Option<String>,
    pub response_font_family: Option<String>,
}

#[derive(Serialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct FontSizeSettings {
    pub editor_font_size: Option<u16>,
    pub response_font_size: Option<u16>,
}

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
pub async fn get_fonts(app: AppHandle) -> AppResult<FontSettings> {
    let cfg = AppConfig::load(&app)?;
    Ok(FontSettings {
        editor_font_family: cfg.editor_font_family,
        ui_font_family: cfg.ui_font_family,
        response_font_family: cfg.response_font_family,
    })
}

#[tauri::command]
pub async fn set_editor_font_family(app: AppHandle, font: Option<String>) -> AppResult<()> {
    let mut cfg = AppConfig::load(&app)?;
    cfg.editor_font_family = font;
    cfg.save(&app)
}

#[tauri::command]
pub async fn set_ui_font_family(app: AppHandle, font: Option<String>) -> AppResult<()> {
    let mut cfg = AppConfig::load(&app)?;
    cfg.ui_font_family = font;
    cfg.save(&app)
}

#[tauri::command]
pub async fn set_response_font_family(
    app: AppHandle,
    font: Option<String>,
) -> AppResult<()> {
    let mut cfg = AppConfig::load(&app)?;
    cfg.response_font_family = font;
    cfg.save(&app)
}

#[tauri::command]
pub async fn get_font_sizes(app: AppHandle) -> AppResult<FontSizeSettings> {
    let cfg = AppConfig::load(&app)?;
    Ok(FontSizeSettings {
        editor_font_size: cfg.editor_font_size,
        response_font_size: cfg.response_font_size,
    })
}

#[tauri::command]
pub async fn set_editor_font_size(app: AppHandle, size: Option<u16>) -> AppResult<()> {
    let mut cfg = AppConfig::load(&app)?;
    cfg.editor_font_size = size;
    cfg.save(&app)
}

#[tauri::command]
pub async fn set_response_font_size(app: AppHandle, size: Option<u16>) -> AppResult<()> {
    let mut cfg = AppConfig::load(&app)?;
    cfg.response_font_size = size;
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
