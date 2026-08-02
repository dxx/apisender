
use crate::error::{AppError, AppResult};

pub fn copy(_path: &str) -> AppResult<()> {
    Err(AppError::Clipboard(
        "暂不支持当前平台的文件剪贴板".into(),
    ))
}

pub fn paste(_dest_dir: &str) -> AppResult<Vec<String>> {
    Err(AppError::Clipboard(
        "暂不支持当前平台的文件剪贴板".into(),
    ))
}