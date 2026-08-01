
use std::collections::HashMap;

use async_trait::async_trait;
use futures_util::stream::BoxStream;
use serde::{Deserialize, Serialize};

use crate::error::{AppError, AppResult};
use crate::parser::ParsedRequest;
use crate::sse::SseEvent;

pub mod grpc;
pub mod rest;
pub mod websocket;

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RawResponse {
    pub status: u16,
    pub status_text: String,
    pub version: String,
    pub headers: Vec<(String, String)>,
    pub body: ResponseBody,
    pub duration_ms: u64,
    pub size: u64,
    pub url: String,
    pub cookies: Vec<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(tag = "type", content = "data")]
pub enum ResponseBody {
    Text(String),
    Binary(String),
    Sse(Vec<SseEvent>),
}

#[derive(Debug, Clone)]
pub enum StreamChunk {
    Data(Vec<u8>),
    Error(String),
}

pub type ByteStream = BoxStream<'static, StreamChunk>;

#[async_trait]
pub trait Transport: Send + Sync {
    async fn execute(
        &self,
        request: &ParsedRequest,
        cookies: &HashMap<String, String>,
    ) -> AppResult<RawResponse>;

    async fn execute_stream(
        &self,
        _request: &ParsedRequest,
        _cookies: &HashMap<String, String>,
    ) -> AppResult<(RawResponse, ByteStream)> {
        Err(AppError::Invalid(
            "streaming not supported by this transport".to_string(),
        ))
    }
}