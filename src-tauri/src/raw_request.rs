use crate::parser::{
    GrpcRequestTags, MultipartContent, MultipartPart, ParsedGrpcRequest, ParsedRequest,
    ParsedWebSocketRequest, RequestBody, RequestTags, WsRequestTags,
};

const CRLF: &str = "\r\n";

/// 入参：解析并插值后的 HTTP 请求。
/// 出参：可直接粘贴回 `.http` 文件的原始报文字符串。
/// 作用与流程：依次渲染 `###` 请求名、标签注释、请求行、请求头、空行与请求体。
pub fn http(req: &ParsedRequest) -> String {
    let mut out = String::new();
    push_block_header(&mut out, req.name.as_deref(), &http_tags(&req.tags));
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
            push_file_body(&mut out, path);
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
/// 出参：可直接粘贴回 `.http` 文件的原始报文字符串。
/// 作用与流程：依次渲染 `###` 请求名、标签注释、GRPC 请求行、metadata 与 JSON 请求消息。
pub fn grpc(req: &ParsedGrpcRequest) -> String {
    let mut out = String::new();
    push_block_header(&mut out, req.name.as_deref(), &grpc_tags(&req.tags));
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
/// 出参：可直接粘贴回 `.http` 文件的原始报文字符串。
/// 作用与流程：依次渲染 `###` 请求名、标签注释、WEBSOCKET 请求行与初始消息，消息之间用 `===` 分隔。
pub fn websocket(req: &ParsedWebSocketRequest) -> String {
    let mut out = String::new();
    push_block_header(&mut out, req.name.as_deref(), &ws_tags(&req.tags));
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

/// 入参：输出缓冲、请求名、标签行列表。
/// 出参：无（结果写入 `out`）。
/// 作用与流程：请求名与标签都为空时不输出；否则先写 `###` 分隔行，再逐行写 `# @tag value` 注释。
fn push_block_header(out: &mut String, name: Option<&str>, tags: &[String]) {
    if name.is_none() && tags.is_empty() {
        return;
    }
    out.push_str("###");
    if let Some(name) = name {
        out.push(' ');
        out.push_str(name);
    }
    out.push_str(CRLF);
    for tag in tags {
        out.push_str("# ");
        out.push_str(tag);
        out.push_str(CRLF);
    }
}

/// 入参：HTTP 请求标签。
/// 出参：`@tag value` 形式的标签行列表。
/// 作用与流程：按解析器支持的顺序把布尔开关与超时时长还原为标签文本。
fn http_tags(tags: &RequestTags) -> Vec<String> {
    let mut out = Vec::new();
    if tags.no_redirect {
        out.push("@no-redirect".to_string());
    }
    if tags.no_log {
        out.push("@no-log".to_string());
    }
    if tags.no_cookie {
        out.push("@no-cookie".to_string());
    }
    if tags.no_auto_encoding {
        out.push("@no-auto-encoding".to_string());
    }
    push_duration_tag(&mut out, "timeout", tags.timeout_ms);
    push_duration_tag(&mut out, "connection-timeout", tags.connection_timeout_ms);
    push_duration_tag(&mut out, "idle-timeout", tags.idle_timeout_ms);
    out
}

/// 入参：gRPC 请求标签。
/// 出参：`@tag value` 形式的标签行列表。
/// 作用与流程：还原 `no-log`、超时、`proto` 与 `proto-include` 标签。
fn grpc_tags(tags: &GrpcRequestTags) -> Vec<String> {
    let mut out = Vec::new();
    if tags.no_log {
        out.push("@no-log".to_string());
    }
    push_duration_tag(&mut out, "connection-timeout", tags.connection_timeout_ms);
    push_duration_tag(&mut out, "timeout", tags.timeout_ms);
    if let Some(proto) = &tags.proto {
        out.push(format!("@proto {}", proto));
    }
    for include in &tags.proto_includes {
        out.push(format!("@proto-include {}", include));
    }
    out
}

/// 入参：WebSocket 请求标签。
/// 出参：`@tag value` 形式的标签行列表。
/// 作用与流程：还原 `no-log` 与两个超时标签。
fn ws_tags(tags: &WsRequestTags) -> Vec<String> {
    let mut out = Vec::new();
    if tags.no_log {
        out.push("@no-log".to_string());
    }
    push_duration_tag(&mut out, "connection-timeout", tags.connection_timeout_ms);
    push_duration_tag(&mut out, "idle-timeout", tags.idle_timeout_ms);
    out
}

/// 入参：标签行列表、标签名、毫秒数。
/// 出参：无（结果追加到 `out`）。
/// 作用与流程：时长存在时追加一行 `@name <时长>`。
fn push_duration_tag(out: &mut Vec<String>, name: &str, ms: Option<u64>) {
    if let Some(ms) = ms {
        out.push(format!("@{} {}", name, format_duration(ms)));
    }
}

/// 入参：毫秒数。
/// 出参：可被 `parse_duration` 解析回同一毫秒值的字符串。
/// 作用与流程：整分钟用 `m`、整秒用 `s`，其余保留 `ms`。
fn format_duration(ms: u64) -> String {
    if ms > 0 && ms % 60_000 == 0 {
        format!("{}m", ms / 60_000)
    } else if ms % 1_000 == 0 {
        format!("{}s", ms / 1_000)
    } else {
        format!("{}ms", ms)
    }
}

/// 入参：输出缓冲、文件路径。
/// 出参：无（结果写入 `out`）。
/// 作用与流程：按解析器识别的 `< path` 语法写文件请求体。
fn push_file_body(out: &mut String, path: &str) {
    out.push_str("< ");
    out.push_str(path);
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
        MultipartContent::File(path) => push_file_body(&mut out, path),
    }
    out.push_str(CRLF);
    out
}
