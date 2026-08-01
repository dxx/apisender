use std::collections::HashMap;

use prost_reflect::MethodDescriptor;

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum GrpcStreamingKind {
    Unary,
    ServerStreaming,
}

impl GrpcStreamingKind {
    pub fn from_method(method: &MethodDescriptor) -> Self {
        if method.is_server_streaming() {
            GrpcStreamingKind::ServerStreaming
        } else {
            GrpcStreamingKind::Unary
        }
    }
}

#[derive(Debug, Clone)]
pub enum GrpcEvent {
    Open {
        url: String,
        package: String,
        service: String,
        method: String,
        streaming_kind: GrpcStreamingKind,
        connect_ms: u64,
    },
    InitialMetadata {
        metadata: Vec<(String, String)>,
    },
    Message {
        index: u32,
        data: String,
        ts_ms: u64,
    },
    TrailingMetadata {
        metadata: Vec<(String, String)>,
    },
    Status {
        code: i32,
        message: String,
    },
    Error {
        message: String,
    },
    Closed {
        total_ms: u64,
        message_count: u32,
    },
}

pub type EventCallback = Box<dyn Fn(GrpcEvent) + Send + Sync>;

pub fn metadata_from_map(map: &HashMap<String, String>) -> Vec<(String, String)> {
    let mut out: Vec<(String, String)> = map.iter().map(|(k, v)| (k.clone(), v.clone())).collect();
    out.sort_by(|a, b| a.0.cmp(&b.0));
    out
}