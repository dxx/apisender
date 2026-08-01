
use crate::clipboard;
use crate::error::AppResult;

#[tauri::command]
pub async fn clipboard_copy_file(path: String) -> AppResult<()> {
    clipboard::copy_file(&path)
}

#[tauri::command]
pub async fn clipboard_paste_files(dest_dir: String) -> AppResult<Vec<String>> {
    clipboard::paste_files(&dest_dir)
}