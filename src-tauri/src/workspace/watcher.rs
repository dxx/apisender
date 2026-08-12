use std::path::PathBuf;
use std::sync::Mutex;
use std::time::Duration;

use notify::{Config, EventKind, RecommendedWatcher, RecursiveMode, Watcher};
use tauri::{AppHandle, Emitter, Manager};

use crate::error::{AppError, AppResult};
use crate::git;

pub struct WatcherState {
    pub _watcher: Option<RecommendedWatcher>,
}

/// 判断文件事件是否来自 Git 管理目录。
/// 入参：事件文件路径和实际 Git 管理目录。
/// 出参：事件位于 Git 内部时返回 true。
/// 作用与流程：使用路径层级判断，避免把 `.gitignore` 等普通工作区文件误判为 Git 内部事件。
pub fn is_git_internal_path(path: &std::path::Path, git_dir: &std::path::Path) -> bool {
    path.starts_with(git_dir)
}

/// 启动当前工作区文件监听器。
/// 入参：Tauri AppHandle 和 apisender 工作区路径。
/// 出参：成功时为空，创建或监听失败时返回工作区错误。
/// 作用与流程：Git 工作区监听真实父级仓库及外部管理目录；Git 内部变化仅发 git-changed，普通文件同时发 workspace-changed 与 git-changed。
pub fn start_watcher(app: &AppHandle, root: &str) -> AppResult<()> {
    let workspace_path = PathBuf::from(root);
    let root_path = git::resolve_repository_root(&workspace_path).unwrap_or(workspace_path);
    let git_dir = git::resolve_git_dir(&root_path).ok();
    let app_handle = app.clone();
    let event_git_dir = git_dir.clone();

    let watcher = notify::recommended_watcher(move |res: Result<notify::Event, _>| {
        if let Ok(event) = res {
            let event_kind = match event.kind {
                EventKind::Create(_) => "create",
                EventKind::Modify(_) => "modify",
                EventKind::Remove(_) => "remove",
                _ => return,
            };

            let git_paths: Vec<String> = event
                .paths
                .iter()
                .filter(|path| {
                    event_git_dir
                        .as_deref()
                        .is_some_and(|git_dir| is_git_internal_path(path, git_dir))
                })
                .map(|p| p.to_string_lossy().to_string())
                .collect();
            let workspace_paths: Vec<String> = event
                .paths
                .iter()
                .filter(|path| {
                    !event_git_dir
                        .as_deref()
                        .is_some_and(|git_dir| is_git_internal_path(path, git_dir))
                })
                .map(|p| p.to_string_lossy().to_string())
                .collect();

            if git_paths.is_empty() && workspace_paths.is_empty() {
                return;
            }

            if !workspace_paths.is_empty() {
                let _ = app_handle.emit(
                    "workspace-changed",
                    serde_json::json!({
                        "eventType": event_kind,
                        "paths": workspace_paths,
                    }),
                );
            }
            let git_event_paths = if git_paths.is_empty() {
                workspace_paths
            } else {
                git_paths
            };
            let _ = app_handle.emit(
                "git-changed",
                serde_json::json!({
                    "eventType": event_kind,
                    "paths": git_event_paths,
                }),
            );
        }
    })
    .map_err(|e| AppError::Workspace(e.to_string()))?;

    let mut watcher = watcher;
    watcher
        .watch(&root_path, RecursiveMode::Recursive)
        .map_err(|e| AppError::Workspace(e.to_string()))?;

    if let Some(git_dir) = git_dir
        && !git_dir.starts_with(&root_path)
    {
        watcher
            .watch(&git_dir, RecursiveMode::Recursive)
            .map_err(|e| AppError::Workspace(e.to_string()))?;
    }

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
