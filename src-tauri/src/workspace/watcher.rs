
use std::path::PathBuf;
use std::sync::Mutex;
use std::time::Duration;

use notify::{Config, EventKind, RecommendedWatcher, RecursiveMode, Watcher};
use tauri::{AppHandle, Emitter, Manager};

use crate::error::{AppError, AppResult};

pub struct WatcherState {
    pub _watcher: Option<RecommendedWatcher>,
}

pub fn start_watcher(app: &AppHandle, root: &str) -> AppResult<()> {
    let root_path = PathBuf::from(root);
    let app_handle = app.clone();

    let watcher = notify::recommended_watcher(move |res: Result<notify::Event, _>| {
        if let Ok(event) = res {
            let event_kind = match event.kind {
                EventKind::Create(_) => "create",
                EventKind::Modify(_) => "modify",
                EventKind::Remove(_) => "remove",
                _ => return,
            };

            let paths: Vec<String> = event
                .paths
                .iter()
                .map(|p| p.to_string_lossy().to_string())
                .collect();

            if paths.is_empty() {
                return;
            }

            let _ = app_handle.emit(
                "workspace-changed",
                serde_json::json!({
                    "eventType": event_kind,
                    "paths": paths,
                }),
            );
        }
    })
    .map_err(|e| AppError::Workspace(e.to_string()))?;

    let mut watcher = watcher;
    watcher
        .watch(&root_path, RecursiveMode::Recursive)
        .map_err(|e| AppError::Workspace(e.to_string()))?;

    let config = Config::default().with_poll_interval(Duration::from_secs(1));
    watcher.configure(config).ok();

    let state: tauri::State<'_, Mutex<WatcherState>> = app.state();
    let mut s = state.lock().unwrap();
    s._watcher = Some(watcher);

    Ok(())
}

pub fn stop_watcher(app: &AppHandle) {
    let state: tauri::State<'_, Mutex<WatcherState>> = app.state();
    let mut s = state.lock().unwrap();
    s._watcher = None;
}
