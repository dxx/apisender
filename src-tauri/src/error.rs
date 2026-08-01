use serde::Serialize;
use thiserror::Error;

#[derive(Debug, Error)]
pub enum AppError {
    #[error("Parse error: {0}")]
    Parse(String),

    #[error("Variable error: {0}")]
    Variable(String),

    #[error("Transport error: {0}")]
    Transport(String),

    #[error("Storage error: {0}")]
    Storage(String),

    #[error("IO error: {0}")]
    Io(String),

    #[error("Invalid input: {0}")]
    Invalid(String),

    #[error("Workspace error: {0}")]
    Workspace(String),

    #[error("Clipboard error: {0}")]
    Clipboard(String),

    #[error("请求已取消")]
    Cancelled,

    #[error("{0}")]
    Other(String),
}

impl From<std::io::Error> for AppError {
    fn from(e: std::io::Error) -> Self {
        AppError::Io(e.to_string())
    }
}

impl From<rusqlite::Error> for AppError {
    fn from(e: rusqlite::Error) -> Self {
        AppError::Storage(e.to_string())
    }
}

impl From<reqwest::Error> for AppError {
    fn from(e: reqwest::Error) -> Self {
        if e.is_timeout() {
            AppError::Transport(format!("请求超时：{}", e))
        } else if e.is_connect() {
            AppError::Transport(format!("连接失败：{}", e))
        } else {
            AppError::Transport(e.to_string())
        }
    }
}

impl From<serde_json::Error> for AppError {
    fn from(e: serde_json::Error) -> Self {
        AppError::Other(e.to_string())
    }
}

impl From<url::ParseError> for AppError {
    fn from(e: url::ParseError) -> Self {
        AppError::Invalid(format!("Invalid URL: {}", e))
    }
}

impl Serialize for AppError {
    fn serialize<S>(&self, serializer: S) -> Result<S::Ok, S::Error>
    where
        S: serde::Serializer,
    {
        serializer.serialize_str(&self.to_string())
    }
}

pub type AppResult<T> = Result<T, AppError>;
