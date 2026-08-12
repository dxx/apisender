pub mod clipboard;
pub mod commands;
pub mod config;
pub mod error;
pub mod executor;
pub mod git;
pub mod parser;
pub mod sse;
pub mod storage;
pub mod transport;
pub mod variables;
pub mod version;
pub mod workspace;

use std::sync::Mutex;

use commands::grpc::GrpcState;
use commands::http::HttpState;
use commands::sse::SseState;
use commands::websocket::WsState;
use git::GitOperationState;
use tauri::Manager;
use workspace::WorkspaceState;
use workspace::watcher::WatcherState;

/// 启动 apisender Tauri 应用。
/// 入参：无。
/// 出参：无；运行失败时终止进程并输出启动错误。
/// 作用与流程：注册插件、全局状态和 IPC 命令，随后进入桌面应用事件循环。
#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    if rustls::crypto::ring::default_provider()
        .install_default()
        .is_err()
    {
        log::debug!("rustls ring crypto provider already installed");
    }

    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_clipboard_manager::init())
        .plugin(
            tauri_plugin_log::Builder::new()
                .level(log::LevelFilter::Debug)
                .timezone_strategy(tauri_plugin_log::TimezoneStrategy::UseLocal)
                .targets([
                    tauri_plugin_log::Target::new(tauri_plugin_log::TargetKind::Stdout),
                    tauri_plugin_log::Target::new(tauri_plugin_log::TargetKind::Webview),
                    tauri_plugin_log::Target::new(tauri_plugin_log::TargetKind::LogDir {
                        file_name: Some(format!("{}.log", crate::version::APP_NAME).into()),
                    }),
                ])
                .build(),
        )
        .setup(|app| {
            log::info!("apisender starting up");
            storage::init_db(app.handle())?;
            app.manage(Mutex::new(WorkspaceState::new()));
            app.manage(Mutex::new(WatcherState { _watcher: None }));
            app.manage(HttpState::default());
            app.manage(SseState::default());
            app.manage(WsState::default());
            app.manage(GrpcState::default());
            app.manage(GitOperationState::default());
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            commands::workspace::open_workspace,
            commands::workspace::close_workspace,
            commands::workspace::get_workspace_path,
            commands::workspace::get_file_tree,
            commands::workspace::create_file,
            commands::workspace::rename_node,
            commands::workspace::delete_node,
            commands::workspace::move_node,
            commands::workspace::read_file,
            commands::workspace::save_file,
            commands::workspace::list_recent_workspaces,
            commands::workspace::remove_recent_workspace,
            commands::config::get_theme,
            commands::config::set_theme,
            commands::config::get_fonts,
            commands::config::set_editor_font_family,
            commands::config::set_ui_font_family,
            commands::font::list_system_fonts,
            commands::config::get_last_workspace,
            commands::config::set_last_workspace,
            commands::env::list_environments,
            commands::env::get_environment_vars,
            commands::config::get_active_environment,
            commands::config::set_active_environment,
            commands::curl::to_curl,
            commands::history::list_history,
            commands::history::get_history_detail,
            commands::history::clear_history,
            commands::history::delete_history,
            commands::http::execute_http,
            commands::http::cancel_http,
            commands::http::parse_preview,
            commands::sse::execute_sse,
            commands::sse::stop_sse,
            commands::websocket::execute_websocket,
            commands::websocket::send_websocket,
            commands::websocket::close_websocket,
            commands::clipboard::clipboard_copy_file,
            commands::clipboard::clipboard_paste_files,
            commands::grpc::execute_grpc,
            commands::grpc::stop_grpc,
            commands::git::git_probe,
            commands::git::git_status,
            commands::git::git_diff,
            commands::git::git_list_branches,
            commands::git::git_list_commits,
            commands::git::git_show_commit,
            commands::git::git_get_identity,
            commands::git::git_stage,
            commands::git::git_unstage,
            commands::git::git_commit,
            commands::git::git_set_identity,
            commands::git::git_pull,
            commands::git::git_push,
            commands::git::git_create_branch,
            commands::git::git_switch_branch,
            commands::git::git_init_workspace,
            commands::git::git_connect_origin,
            commands::git::git_clone_workspace,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
