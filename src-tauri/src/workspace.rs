
pub mod env_file;
pub mod operations;
pub mod tree;
pub mod watcher;

use std::sync::Mutex;

use tauri::{AppHandle, Manager};

use crate::error::{AppError, AppResult};
use crate::storage;
use crate::config::AppConfig;

pub struct WorkspaceState {
    pub root: Mutex<Option<String>>,
}

impl WorkspaceState {
    pub fn new() -> Self {
        WorkspaceState {
            root: Mutex::new(None),
        }
    }

    pub fn get_root(&self) -> Option<String> {
        self.root.lock().ok()?.clone()
    }

    pub fn set_root(&self, path: Option<String>) {
        if let Ok(mut root) = self.root.lock() {
            *root = path;
        }
    }
}

pub fn open_workspace(app: &AppHandle, path: &str) -> AppResult<()> {
    let root = std::path::PathBuf::from(path);
    if !root.exists() || !root.is_dir() {
        return Err(AppError::Workspace(format!(
            "Invalid workspace path: {}",
            path
        )));
    }

    {
        let state: tauri::State<'_, Mutex<WorkspaceState>> = app.state();
        let s = state.lock().map_err(|e| AppError::Workspace(e.to_string()))?;
        s.set_root(Some(path.to_string()));
    }

    watcher::start_watcher(app, path)?;

    let name = root
        .file_name()
        .map(|n| n.to_string_lossy().to_string())
        .unwrap_or_else(|| path.to_string());

    let db = storage::get_db(app)?;
    db.with_handle(|conn| storage::recent_workspaces::upsert(conn, path, &name))?;

    let mut cfg = AppConfig::load(app)?;
    cfg.last_workspace = Some(path.to_string());
    cfg.save(app)?;

    Ok(())
}

pub fn close_workspace(app: &AppHandle) {
    watcher::stop_watcher(app);
    let state: tauri::State<'_, Mutex<WorkspaceState>> = app.state();
    if let Ok(s) = state.lock() {
        s.set_root(None);
    }

    if let Ok(mut cfg) = AppConfig::load(app) {
        cfg.last_workspace = None;
        let _ = cfg.save(app);
    }
}

pub fn get_workspace_root(app: &AppHandle) -> Option<String> {
    let state: tauri::State<'_, Mutex<WorkspaceState>> = app.state();
    let s = state.lock().ok()?;
    s.get_root()
}