use std::collections::HashMap;

use prost_reflect::MethodDescriptor;

/// gRPC 调用形态：未流式（Unary）或服务端流（ServerStreaming）。客户端流和双向流当前未支持。
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum GrpcStreamingKind {
    Unary,
    ServerStreaming,
}

impl GrpcStreamingKind {
    /// 从 `MethodDescriptor` 判定调用形态：服务端流标记置位则为 `ServerStreaming`，否则按 `Unary` 处理。
    pub fn from_method(method: &MethodDescriptor) -> Self {
        if method.is_server_streaming() {
            GrpcStreamingKind::ServerStreaming
        } else {
            GrpcStreamingKind::Unary
        }
    }
}

/// gRPC 调用的生命周期事件，按顺序推给前端：Open → InitialMetadata → Message* → (TrailingMetadata →) Status → Closed；中间任意阶段都可能插 Error。
#[derive(Debug, Clone)]
pub enum GrpcEvent {
    /// 连接建好，发出首条请求前的事件。
    Open {
        url: String,
        package: String,
        service: String,
        method: String,
        streaming_kind: GrpcStreamingKind,
        connect_ms: u64,
    },
    /// 服务端初始 metadata（trailers 独立发）。
    InitialMetadata {
        metadata: Vec<(String, String)>,
    },
    /// 收到一条响应消息（UnarionServerStreaming 共用）。
    Message {
        index: u32,
        data: String,
        ts_ms: u64,
    },
    /// 流结束时的 trailer metadata（仅在 status 之前出现）。
    TrailingMetadata {
        metadata: Vec<(String, String)>,
    },
    /// gRPC 状态码（0 = OK）。
    Status {
        code: i32,
        message: String,
    },
    /// 任意阶段出现的协议/网络错误。
    Error {
        message: String,
    },
    /// 调用结束的事件总线收尾，包含总耗时与已收到的消息数。
    Closed {
        total_ms: u64,
        message_count: u32,
    },
}

pub type EventCallback = Box<dyn Fn(GrpcEvent) + Send + Sync>;

/// 把 `HashMap` 形式的 metadata 拍成排序稳定的 `(name, value)` 列表，方便前端展示。
pub fn metadata_from_map(map: &HashMap<String, String>) -> Vec<(String, String)> {
    let mut out: Vec<(String, String)> = map.iter().map(|(k, v)| (k.clone(), v.clone())).collect();
    out.sort_by(|a, b| a.0.cmp(&b.0));
    out
}