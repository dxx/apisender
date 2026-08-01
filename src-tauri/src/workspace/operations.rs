
use std::path::{Path, PathBuf};

use crate::error::{AppError, AppResult};

pub fn create_file(path: &str, is_dir: bool) -> AppResult<()> {
    let p = Path::new(path);
    if p.exists() {
        return Err(AppError::Workspace(format!("Path already exists: {}", path)));
    }
    if is_dir {
        std::fs::create_dir_all(p)?;
    } else {
        if let Some(parent) = p.parent() {
            std::fs::create_dir_all(parent)?;
        }
        std::fs::write(p, "")?;
    }
    Ok(())
}

pub fn rename_node(old_path: &str, new_path: &str) -> AppResult<()> {
    let old = Path::new(old_path);
    let new = Path::new(new_path);
    if !old.exists() {
        return Err(AppError::Workspace(format!("Source not found: {}", old_path)));
    }
    if new.exists() {
        return Err(AppError::Workspace(format!(
            "Destination already exists: {}",
            new_path
        )));
    }
    if let Some(parent) = new.parent() {
        std::fs::create_dir_all(parent)?;
    }
    std::fs::rename(old, new)?;
    Ok(())
}

pub fn delete_node(path: &str) -> AppResult<()> {
    let p = Path::new(path);
    if !p.exists() {
        return Err(AppError::Workspace(format!("Path not found: {}", path)));
    }
    if p.is_dir() {
        std::fs::remove_dir_all(p)?;
    } else {
        std::fs::remove_file(p)?;
    }
    Ok(())
}

pub fn move_node(src: &str, dest_dir: &str) -> AppResult<()> {
    let src_path = Path::new(src);
    let file_name = src_path
        .file_name()
        .ok_or_else(|| AppError::Workspace(format!("Invalid source path: {}", src)))?;
    let dest_path = PathBuf::from(dest_dir).join(file_name);
    if dest_path.exists() {
        return Err(AppError::Workspace(format!(
            "Destination already exists: {}",
            dest_path.display()
        )));
    }
    std::fs::rename(src_path, &dest_path)?;
    Ok(())
}

pub fn read_file(path: &str) -> AppResult<String> {
    Ok(std::fs::read_to_string(path)?)
}

pub fn save_file(path: &str, content: &str) -> AppResult<()> {
    let p = Path::new(path);
    if let Some(parent) = p.parent() {
        std::fs::create_dir_all(parent)?;
    }
    std::fs::write(p, content)?;
    Ok(())
}
