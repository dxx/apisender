
use std::path::{Path, PathBuf};

use crate::clipboard::copy_dir;
use crate::error::{AppError, AppResult};

pub fn copy(path: &str) -> AppResult<()> {
    let abs = std::fs::canonicalize(path)
        .map_err(|e| AppError::Clipboard(format!("解析路径失败: {}", e)))?;

    let mut cb = arboard::Clipboard::new()
        .map_err(|e| AppError::Clipboard(format!("剪贴板初始化失败: {}", e)))?;

    cb.set_file_list(&[abs])
        .map_err(|e| AppError::Clipboard(format!("写入剪贴板失败: {}", e)))?;

    Ok(())
}

pub fn paste(dest_dir: &str) -> AppResult<Vec<String>> {
    let mut cb = arboard::Clipboard::new()
        .map_err(|e| AppError::Clipboard(format!("剪贴板初始化失败: {}", e)))?;

    let sources = cb
        .get()
        .file_list()
        .map_err(|e| AppError::Clipboard(format!("读取剪贴板失败: {}", e)))?;

    let mut copied = Vec::new();
    for src in sources {
        let Some(name) = src.file_name().map(|s| s.to_string_lossy().to_string()) else {
            continue;
        };
        if name.is_empty() {
            continue;
        }
        let dest = unique_dest_path(dest_dir, &name);
        let dest_str = dest.to_string_lossy().to_string();
        if src == dest {
            continue;
        }
        let result = if src.is_dir() {
            copy_dir(&src, &dest)
        } else {
            std::fs::copy(&src, &dest).map(|_| ())
        };
        if let Err(e) = result {
            log::warn!("粘贴失败 {} -> {}: {}", src.display(), dest_str, e);
            continue;
        }
        copied.push(dest_str);
    }
    Ok(copied)
}

fn unique_dest_path(dest_dir: &str, file_name: &str) -> PathBuf {
    let dir = PathBuf::from(dest_dir);
    let original = dir.join(file_name);
    if !original.exists() {
        return original;
    }
    let stem = original
        .file_stem()
        .map(|s| s.to_string_lossy().to_string())
        .unwrap_or_else(|| file_name.to_string());
    let ext = original.extension().map(|e| e.to_string_lossy().to_string());
    for n in 1..1000 {
        let new_name = match &ext {
            Some(e) => format!("{} ({}).{}", stem, n, e),
            None => format!("{} ({})", stem, n),
        };
        let p = dir.join(&new_name);
        if !p.exists() {
            return p;
        }
    }
    original
}
