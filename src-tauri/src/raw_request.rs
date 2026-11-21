
use crate::parser::{
    MultipartContent, MultipartPart, ParsedGrpcRequest, ParsedRequest, ParsedWebSocketRequest,
    RequestBody,
};

const CRLF: &str = "\r\n";

/// 入参：解析并插值后的 HTTP 请求。
/// 出参：可直接粘贴的原始报文字符串。
/// 作用与流程：按请求行、请求头、空行、请求体的顺序渲染 HTTP 报文。
pub fn http(req: &ParsedRequest) -> String {
    let mut out = String::new();
    let version = req.http_version.as_deref().unwrap_or("HTTP/1.1");
    out.push_str(&format!(
        "{} {} {}{}",
        req.method.as_str(),
        req.url,
        version,
        CRLF
    ));
    for header in &req.headers {
        out.push_str(&format!("{}: {}{}", header.key, header.value, CRLF));
    }
    match &req.body {
        RequestBody::None => {}
        RequestBody::Text(text) => {
            out.push_str(CRLF);
            out.push_str(text);
        }
        RequestBody::File(path) => {
            out.push_str(CRLF);
            out.push_str(&format!("@file: {}", path));
        }
        RequestBody::Multipart(parts) => {
            out.push_str(CRLF);
            for part in parts {
                out.push_str(&multipart_part(part));
            }
        }
    }
    out
}

/// 入参：解析并插值后的 gRPC 请求。
/// 出参：可直接粘贴的原始报文字符串。
/// 作用与流程：渲染 GRPC 请求行、metadata 与 JSON 请求消息。
pub fn grpc(req: &ParsedGrpcRequest) -> String {
    let mut out = String::new();
    out.push_str(&format!("GRPC {}{}", req.url, CRLF));
    for header in &req.metadata {
        out.push_str(&format!("{}: {}{}", header.key, header.value, CRLF));
    }
    if let Some(message) = &req.message {
        out.push_str(CRLF);
        out.push_str(&message.text);
    }
    out
}

/// 入参：解析并插值后的 WebSocket 请求。
/// 出参：可直接粘贴的原始报文字符串。
/// 作用与流程：渲染 WEBSOCKET 请求行与初始消息，消息之间用 `===` 分隔。
pub fn websocket(req: &ParsedWebSocketRequest) -> String {
    let mut out = String::new();
    out.push_str(&format!("WEBSOCKET {}{}", req.url, CRLF));
    for (index, message) in req.messages.iter().enumerate() {
        if index > 0 {
            out.push_str(CRLF);
            if message.wait_for_server {
                out.push_str("=== wait-for-server");
            } else {
                out.push_str("===");
            }
            out.push_str(CRLF);
        }
        out.push_str(&message.text);
    }
    out
}

fn multipart_part(part: &MultipartPart) -> String {
    let mut out = String::new();
    out.push_str("--<boundary>");
    out.push_str(CRLF);
    out.push_str(&format!(
        "Content-Disposition: form-data; name=\"{}\"",
        part.name
    ));
    if let Some(filename) = &part.filename {
        out.push_str(&format!("; filename=\"{}\"", filename));
    }
    out.push_str(CRLF);
    if let Some(content_type) = &part.content_type {
        out.push_str(&format!("Content-Type: {}", content_type));
        out.push_str(CRLF);
    }
    out.push_str(CRLF);
    match &part.content {
        MultipartContent::Text(text) => out.push_str(text),
        MultipartContent::File(path) => out.push_str(&format!("@file: {}", path)),
    }
    out.push_str(CRLF);
    out
}
