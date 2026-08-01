
use crate::error::{AppError, AppResult};

use super::types::*;

pub struct Parser<'a> {
    lines: Vec<&'a str>,
}

impl<'a> Parser<'a> {
    pub fn new(text: &'a str) -> Self {
        Parser {
            lines: text.lines().collect(),
        }
    }

    pub fn parse(&self) -> AppResult<ParsedFile> {
        let mut requests = Vec::new();
        let mut websocket_requests = Vec::new();
        let mut grpc_requests = Vec::new();
        let mut global_variables = Vec::new();

        let mut i = 0;
        while i < self.lines.len() {
            let line = self.lines[i].trim();

            if line.is_empty() {
                i += 1;
                continue;
            }

            if line.starts_with("###") {
                let sep_line = i;
                let name_str = line.trim_start_matches('#').trim();
                let name = if name_str.is_empty() { None } else { Some(name_str.to_string()) };
                let mut tags = RequestTags::default();
                let mut ws_tags = WsRequestTags::default();
                let mut grpc_tags = GrpcRequestTags::default();
                let mut block_variables: Vec<(String, String)> = Vec::new();
                let mut pending_name = name;
                i += 1;

                while i < self.lines.len() {
                    let l = self.lines[i].trim();
                    if l.is_empty() {
                        i += 1;
                        continue;
                    }
                    if is_comment(l) {
                        if let Some(tag) = parse_tag(l) {
                            apply_ws_tag(&mut ws_tags, tag.clone());
                            apply_tag(&mut tags, tag.clone());
                            apply_grpc_tag(&mut grpc_tags, tag);
                        } else if let Some((k, v)) = parse_inplace_variable(l) {
                            block_variables.push((k, v));
                        } else {
                            let n = l.trim_start_matches('#').trim_start_matches('/').trim();
                            if !n.is_empty() && pending_name.is_none() {
                                pending_name = Some(n.to_string());
                            }
                        }
                        i += 1;
                        continue;
                    }
                    if l.starts_with('@') {
                        if let Some(tag) = parse_tag(l) {
                            apply_ws_tag(&mut ws_tags, tag.clone());
                            apply_tag(&mut tags, tag.clone());
                            apply_grpc_tag(&mut grpc_tags, tag);
                        } else if let Some((k, v)) = parse_inplace_variable(l) {
                            block_variables.push((k, v));
                        }
                        i += 1;
                        continue;
                    }
                    break;
                }

                if i < self.lines.len() {
                    let first_line = self.lines[i].trim();
                    if is_websocket_line(first_line) {
                        let start = i;
                        let (ws_req, next) =
                            self.parse_websocket_block(pending_name, start, ws_tags, block_variables)?;
                        websocket_requests.push(ws_req);
                        i = next;
                    } else if is_grpc_line(first_line) {
                        let start = i;
                        let (grpc_req, next) =
                            self.parse_grpc_block(pending_name, start, grpc_tags, block_variables)?;
                        grpc_requests.push(grpc_req);
                        i = next;
                    } else {
                        let start = i;
                        let (req, next) = self.parse_request(
                            pending_name,
                            start,
                            sep_line,
                            tags,
                            block_variables,
                        )?;
                        requests.push(req);
                        i = next;
                    }
                }
                continue;
            }

            if is_comment(line) {
                if let Some((k, v)) = parse_inplace_variable(line) {
                    global_variables.push((k, v));
                }
                i += 1;
                continue;
            }

            if line.starts_with('@') {
                if let Some((k, v)) = parse_inplace_variable(line) {
                    global_variables.push((k, v));
                }
                i += 1;
                continue;
            }

            if is_websocket_line(line) {
                let (ws_req, next) = self.parse_websocket_block(None, i, WsRequestTags::default(), Vec::new())?;
                websocket_requests.push(ws_req);
                i = next;
                continue;
            }

            if is_grpc_line(line) {
                let (grpc_req, next) = self.parse_grpc_block(None, i, GrpcRequestTags::default(), Vec::new())?;
                grpc_requests.push(grpc_req);
                i = next;
                continue;
            }

            if is_method_line(line) {
                let start = i;
                let (req, next) = self.parse_request(
                    None,
                    start,
                    start,
                    RequestTags::default(),
                    Vec::new(),
                )?;
                requests.push(req);
                i = next;
                continue;
            }

            i += 1;
        }

        Ok(ParsedFile { requests, websocket_requests, grpc_requests, global_variables })
    }

    fn parse_websocket_block(
        &self,
        name: Option<String>,
        line_start: usize,
        tags: WsRequestTags,
        block_variables: Vec<(String, String)>,
    ) -> AppResult<(ParsedWebSocketRequest, usize)> {
        let mut i = line_start;
        let request_line = self.collect_continued_line(&mut i);
        let url = parse_websocket_url(&request_line)?;

        let (messages, end) = parse_websocket_body(&self.lines, i);

        Ok((
            ParsedWebSocketRequest {
                name,
                url,
                messages,
                tags,
                variables: block_variables,
                line_start,
                line_end: end,
            },
            end,
        ))
    }

    fn parse_grpc_block(
        &self,
        name: Option<String>,
        line_start: usize,
        tags: GrpcRequestTags,
        block_variables: Vec<(String, String)>,
    ) -> AppResult<(ParsedGrpcRequest, usize)> {
        let mut i = line_start;
        let request_line = self.collect_continued_line(&mut i);
        let url = parse_grpc_url(&request_line)?;
        let (package, service, method) = parse_grpc_target(&url)?;

        // Skip blank lines between the URL line and the metadata block.
        while i < self.lines.len() && self.lines[i].trim().is_empty() {
            i += 1;
        }

        // Collect metadata lines (Header-style: Key: Value), stop on blank line / ### / EOF.
        let mut metadata: Vec<HttpHeader> = Vec::new();
        while i < self.lines.len() {
            let line = self.lines[i];
            let trimmed = line.trim();

            if trimmed.is_empty() {
                break;
            }
            if trimmed.starts_with("###") {
                break;
            }
            if is_comment(trimmed) {
                i += 1;
                continue;
            }
            // JSON body (starts with `{` or `[`) or XML body (`<`) — stop metadata loop.
            if trimmed.starts_with('{') || trimmed.starts_with('[') || trimmed.starts_with('<') {
                break;
            }
            if let Some(idx) = trimmed.find(':') {
                let key = trimmed[..idx].trim().to_string();
                let value = trimmed[idx + 1..].trim().to_string();
                if !key.is_empty() {
                    metadata.push(HttpHeader { key, value });
                }
                i += 1;
                continue;
            }
            break;
        }

        // Body (JSON) — collect until blank line, ###, or EOF.
        // Skip blank lines between metadata and body.
        while i < self.lines.len() && self.lines[i].trim().is_empty() {
            i += 1;
        }
        let mut body_lines: Vec<String> = Vec::new();
        while i < self.lines.len() {
            let line = self.lines[i];
            let trimmed = line.trim();
            if trimmed.is_empty() {
                break;
            }
            if trimmed.starts_with("###") {
                break;
            }
            if is_comment(trimmed) {
                i += 1;
                continue;
            }
            body_lines.push(line.to_string());
            i += 1;
        }

        let message = if body_lines.is_empty() {
            None
        } else {
            Some(GrpcMessage {
                text: body_lines.join("\n").trim().to_string(),
            })
        };

        let line_end = if i > line_start { i } else { line_start + 1 };

        Ok((
            ParsedGrpcRequest {
                name,
                url,
                package,
                service,
                method,
                metadata,
                message,
                tags,
                variables: block_variables,
                line_start,
                line_end,
            },
            i,
        ))
    }

    fn parse_request(
        &self,
        name: Option<String>,
        start: usize,
        line_start: usize,
        tags: RequestTags,
        block_variables: Vec<(String, String)>,
    ) -> AppResult<(ParsedRequest, usize)> {
        let mut i = start;

        let request_line = self.collect_continued_line(&mut i);
        let (method, url, http_version) = parse_request_line(&request_line)?;

        let mut headers: Vec<HttpHeader> = Vec::new();
        while i < self.lines.len() {
            let line = self.lines[i];
            let trimmed = line.trim();

            if trimmed.is_empty() {
                i += 1;
                break;
            }

            if trimmed.starts_with("###") {
                break;
            }

            if is_comment(trimmed) {
                i += 1;
                continue;
            }

            if let Some(idx) = trimmed.find(':') {
                let key = trimmed[..idx].trim().to_string();
                let value = trimmed[idx + 1..].trim().to_string();
                if !key.is_empty() {
                    headers.push(HttpHeader { key, value });
                }
                i += 1;
                continue;
            }

            break;
        }

        let mut body_lines: Vec<String> = Vec::new();
        let mut body = RequestBody::None;
        let is_multipart = has_multipart_content_type(&headers);

        while i < self.lines.len() {
            let line = self.lines[i];
            let trimmed = line.trim();

            if trimmed.is_empty() {
                if is_multipart {
                    body_lines.push(line.to_string());
                    i += 1;
                    continue;
                }
                break;
            }

            if trimmed.starts_with("###") {
                break;
            }

            if trimmed.starts_with('>') || trimmed.starts_with(">>") {
                break;
            }

            if is_comment(trimmed) {
                i += 1;
                continue;
            }

            body_lines.push(line.to_string());
            i += 1;
        }

        if !body_lines.is_empty() {
            let body_text = body_lines.join("\n");
            let body_trimmed = body_text.trim();
            if body_trimmed.starts_with("< ") || body_trimmed == "<" {
                let file_path = body_trimmed.trim_start_matches('<').trim().to_string();
                body = RequestBody::File(file_path);
            } else if has_multipart_content_type(&headers) {
                body = parse_multipart(&body_text);
            } else {
                body = RequestBody::Text(body_text);
            }
        }

        let line_end = if i > start { i } else { start + 1 };

        Ok((
            ParsedRequest {
                name,
                method,
                url,
                http_version,
                headers,
                body,
                tags,
                variables: block_variables,
                line_start,
                line_end,
            },
            i,
        ))
    }

    fn collect_continued_line(&self, i: &mut usize) -> String {
        let mut parts: Vec<String> = Vec::new();

        if *i < self.lines.len() {
            parts.push(self.lines[*i].trim().to_string());
            *i += 1;
        }

        while *i < self.lines.len() {
            let line = self.lines[*i];
            if line.starts_with(' ') || line.starts_with('\t') {
                let t = line.trim();
                if t.is_empty() {
                    break;
                }
                parts.push(t.to_string());
                *i += 1;
            } else {
                break;
            }
        }

        parts.join("")
    }
}

fn is_comment(line: &str) -> bool {
    let t = line.trim();
    t.starts_with('#') || t.starts_with("//")
}

fn is_method_line(line: &str) -> bool {
    let upper = line.to_ascii_uppercase();
    let methods = ["GET ", "POST ", "PUT ", "DELETE ", "PATCH ", "HEAD ", "OPTIONS "];
    for m in methods {
        if upper.starts_with(m) {
            return true;
        }
    }
    if upper.starts_with("HTTP://") || upper.starts_with("HTTPS://") {
        return true;
    }
    let first_word = line.split_whitespace().next();
    if let Some(w) = first_word {
        if w.eq_ignore_ascii_case("CONNECT")
            || w.eq_ignore_ascii_case("TRACE")
            || w.chars().all(|c| c.is_ascii_uppercase())
            && w.len() > 1
        {
            return true;
        }
    }
    false
}

fn parse_request_line(line: &str) -> AppResult<(HttpMethod, String, Option<String>)> {
    let trimmed = line.trim_start();
    if trimmed.is_empty() {
        return Err(AppError::Parse("Empty request line".to_string()));
    }

    let first_ws = trimmed.find(char::is_whitespace).unwrap_or(trimmed.len());
    let first_token = &trimmed[..first_ws];
    let rest = trimmed[first_ws..].trim_start();

    let (url_after_first, http_version) = split_url_and_http_version(rest);

    let is_bare_url = first_token.to_ascii_lowercase().starts_with("http://")
        || first_token.to_ascii_lowercase().starts_with("https://")
        || first_token.starts_with('/');

    let url = if is_bare_url {
        if url_after_first.is_empty() {
            first_token.to_string()
        } else {
            format!("{}{}{}", first_token, " ", url_after_first.trim_end())
        }
    } else {
        if url_after_first.is_empty() {
            return Err(AppError::Parse(format!(
                "Missing URL in request line: {}",
                line
            )));
        }
        url_after_first.trim_end().to_string()
    };

    let method = if is_bare_url {
        HttpMethod::Get
    } else {
        HttpMethod::parse(first_token)
    };

    Ok((method, url, http_version))
}

fn split_url_and_http_version(s: &str) -> (String, Option<String>) {
    let s = s.trim_end();
    if let Some(idx) = s.rfind(" HTTP/") {
        let url = s[..idx].trim_end().to_string();
        let v = s[idx + 1..].trim().to_string();
        (url, Some(v))
    } else if s.starts_with("HTTP/") {
        ("".to_string(), Some(s.trim().to_string()))
    } else {
        (s.trim().to_string(), None)
    }
}

fn parse_inplace_variable(line: &str) -> Option<(String, String)> {
    let t = line.trim();
    let t = t.trim_start_matches('#').trim_start_matches('/').trim();
    if !t.starts_with('@') {
        return None;
    }
    let t = t.trim_start_matches('@');
    if let Some(eq) = t.find('=') {
        let key = t[..eq].trim().to_string();
        let value = t[eq + 1..].trim().to_string();
        if !key.is_empty() {
            return Some((key, value));
        }
    }
    None
}

fn parse_tag(line: &str) -> Option<(String, Option<String>)> {
    let t = line.trim();
    let t = t.trim_start_matches('#').trim_start_matches('/').trim();
    if !t.starts_with('@') {
        return None;
    }
    let t = t.trim_start_matches('@');
    if t.contains('=') {
        return None;
    }
    let mut parts = t.splitn(2, char::is_whitespace);
    let tag = parts.next()?.trim().to_string();
    let value = parts.next().map(|s| s.trim().to_string()).filter(|s| !s.is_empty());
    Some((tag, value))
}

fn apply_tag(tags: &mut RequestTags, (tag, value): (String, Option<String>)) {
    match tag.as_str() {
        "no-redirect" => tags.no_redirect = true,
        "no-log" => tags.no_log = true,
        "no-cookie" => tags.no_cookie = true,
        "no-auto-encoding" => tags.no_auto_encoding = true,
        "timeout" => {
            if let Some(v) = value {
                tags.timeout_ms = parse_duration(&v);
            }
        }
        "connection-timeout" => {
            if let Some(v) = value {
                tags.connection_timeout_ms = parse_duration(&v);
            }
        }
        "idle-timeout" => {
            if let Some(v) = value {
                tags.idle_timeout_ms = parse_duration(&v);
            }
        }
        _ => {}
    }
}

fn parse_duration(s: &str) -> Option<u64> {
    let s = s.trim();
    if s.is_empty() {
        return None;
    }
    if let Some(n) = s.strip_suffix("ms") {
        return n.trim().parse::<u64>().ok();
    }
    if let Some(n) = s.strip_suffix('s') {
        return n.trim().parse::<u64>().ok().map(|v| v * 1000);
    }
    if let Some(n) = s.strip_suffix('m') {
        return n.trim().parse::<u64>().ok().map(|v| v * 60 * 1000);
    }
    s.parse::<u64>().ok().map(|v| v * 1000)
}

fn has_multipart_content_type(headers: &[HttpHeader]) -> bool {
    headers.iter().any(|h| {
        h.key.eq_ignore_ascii_case("content-type")
            && h.value
                .to_ascii_lowercase()
                .starts_with("multipart/form-data")
    })
}

fn parse_multipart(body: &str) -> RequestBody {
    let boundary = body
        .lines()
        .next()
        .and_then(|l| l.trim().strip_prefix("--"))
        .unwrap_or("");

    let mut parts: Vec<MultipartPart> = Vec::new();
    let mut current_name = String::new();
    let mut current_filename: Option<String> = None;
    let mut current_ct: Option<String> = None;
    let mut current_lines: Vec<String> = Vec::new();
    let mut in_part = false;

    for line in body.lines() {
        if line.trim() == format!("--{}--", boundary) {
            if in_part {
                parts.push(finish_part(
                    &current_name,
                    &current_filename,
                    &current_ct,
                    &current_lines,
                ));
            }
            break;
        }
        if line.trim().starts_with(&format!("--{}", boundary)) {
            if in_part {
                parts.push(finish_part(
                    &current_name,
                    &current_filename,
                    &current_ct,
                    &current_lines,
                ));
            }
            in_part = true;
            current_name.clear();
            current_filename = None;
            current_ct = None;
            current_lines.clear();
            continue;
        }
        if in_part {
            if let Some(rest) = line
                .trim()
                .strip_prefix("Content-Disposition:")
                .or_else(|| line.trim().strip_prefix("content-disposition:"))
            {
                for part in rest.split(';') {
                    let part = part.trim();
                    if let Some(v) = part.strip_prefix("name=") {
                        current_name = v.trim_matches('"').to_string();
                    } else if let Some(v) = part.strip_prefix("filename=") {
                        current_filename = Some(v.trim_matches('"').to_string());
                    }
                }
                continue;
            }
            if let Some(rest) = line
                .trim()
                .strip_prefix("Content-Type:")
                .or_else(|| line.trim().strip_prefix("content-type:"))
            {
                current_ct = Some(rest.trim().to_string());
                continue;
            }
            current_lines.push(line.to_string());
        }
    }

    RequestBody::Multipart(parts)
}

fn finish_part(
    name: &str,
    filename: &Option<String>,
    content_type: &Option<String>,
    lines: &[String],
) -> MultipartPart {
    let content_text = lines.join("\n");
    let content = if content_text.trim().starts_with("< ") || content_text.trim() == "<" {
        MultipartContent::File(content_text.trim().trim_start_matches('<').trim().to_string())
    } else {
        MultipartContent::Text(content_text)
    };
    MultipartPart {
        name: name.to_string(),
        filename: filename.clone(),
        content_type: content_type.clone(),
        content,
    }
}

pub fn parse(text: &str) -> AppResult<ParsedFile> {
    Parser::new(text).parse()
}

pub fn extract_single_request(parsed_file: &ParsedFile, line_offset: usize) -> AppResult<ParsedRequest> {
    let found = parsed_file.requests.iter().find(|r| {
        line_offset >= r.line_start && (line_offset <= r.line_end || r.line_end == 0)
    });
    if let Some(r) = found {
        return Ok(r.clone());
    }
    let nearest = parsed_file
        .requests
        .iter()
        .filter(|r| line_offset >= r.line_start)
        .max_by_key(|r| r.line_start);
    nearest
        .cloned()
        .ok_or_else(|| AppError::Parse(format!(
            "No request found at line {} (requests: {})",
            line_offset + 1,
            parsed_file.requests.iter().map(|r| format!("{}-{}", r.line_start + 1, r.line_end)).collect::<Vec<_>>().join(", ")
        )))
}

pub fn extract_single_ws_request(parsed_file: &ParsedFile, line_offset: usize) -> AppResult<ParsedWebSocketRequest> {
    let found = parsed_file.websocket_requests.iter().find(|r| {
        line_offset >= r.line_start && (line_offset <= r.line_end || r.line_end == 0)
    });
    if let Some(r) = found {
        return Ok(r.clone());
    }
    let nearest = parsed_file
        .websocket_requests
        .iter()
        .filter(|r| line_offset >= r.line_start)
        .max_by_key(|r| r.line_start);
    nearest
        .cloned()
        .ok_or_else(|| AppError::Parse(format!(
            "No WebSocket request found at line {}",
            line_offset + 1
        )))
}

pub fn extract_single_grpc_request(parsed_file: &ParsedFile, line_offset: usize) -> AppResult<ParsedGrpcRequest> {
    let found = parsed_file.grpc_requests.iter().find(|r| {
        line_offset >= r.line_start && (line_offset <= r.line_end || r.line_end == 0)
    });
    if let Some(r) = found {
        return Ok(r.clone());
    }
    let nearest = parsed_file
        .grpc_requests
        .iter()
        .filter(|r| line_offset >= r.line_start)
        .max_by_key(|r| r.line_start);
    nearest
        .cloned()
        .ok_or_else(|| AppError::Parse(format!(
            "No gRPC request found at line {}",
            line_offset + 1
        )))
}

fn is_websocket_line(line: &str) -> bool {
    line.split_whitespace()
        .next()
        .map(|w| w.eq_ignore_ascii_case("WEBSOCKET"))
        .unwrap_or(false)
}

fn parse_websocket_url(line: &str) -> AppResult<String> {
    let parts: Vec<&str> = line.split_whitespace().collect();
    if parts.len() < 2 {
        return Err(AppError::Parse(format!(
            "Missing URL in WebSocket request line: {}",
            line
        )));
    }
    if !parts[0].eq_ignore_ascii_case("WEBSOCKET") {
        return Err(AppError::Parse(format!(
            "Invalid WebSocket request line: {}",
            line
        )));
    }
    Ok(parts[1].to_string())
}

fn is_grpc_line(line: &str) -> bool {
    line.split_whitespace()
        .next()
        .map(|w| w.eq_ignore_ascii_case("GRPC"))
        .unwrap_or(false)
}

fn parse_grpc_url(line: &str) -> AppResult<String> {
    let parts: Vec<&str> = line.split_whitespace().collect();
    if parts.len() < 2 {
        return Err(AppError::Parse(format!(
            "Missing URL in gRPC request line: {}",
            line
        )));
    }
    if !parts[0].eq_ignore_ascii_case("GRPC") {
        return Err(AppError::Parse(format!(
            "Invalid gRPC request line: {}",
            line
        )));
    }
    Ok(parts[1].to_string())
}

/// Parse `grpcs://host:port/Package.Service/Method` into (package, service, method).
fn parse_grpc_target(url: &str) -> AppResult<(String, String, String)> {
    let path_start = url.find("://")
        .ok_or_else(|| AppError::Parse(format!("Invalid gRPC URL (missing scheme): {}", url)))?;
    let after_scheme = &url[path_start + 3..];
    let path_idx = after_scheme.find('/').ok_or_else(|| {
        AppError::Parse(format!(
            "Invalid gRPC URL (missing service path): {}",
            url
        ))
    })?;
    let svc_path = &after_scheme[path_idx + 1..];
    if svc_path.is_empty() {
        return Err(AppError::Parse(format!(
            "Invalid gRPC URL (empty service path): {}",
            url
        )));
    }
    // Expect: Package.Service/Method  → split last '/' first
    let (service_path, method) = match svc_path.rsplit_once('/') {
        Some((s, m)) => (s, m.to_string()),
        None => {
            return Err(AppError::Parse(format!(
                "Invalid gRPC URL (missing /Method): {}",
                url
            )));
        }
    };
    let (package, service) = match service_path.rsplit_once('.') {
        Some((p, s)) => (p.to_string(), s.to_string()),
        None => {
            return Err(AppError::Parse(format!(
                "Invalid gRPC URL (missing Package.Service): {}",
                url
            )));
        }
    };
    Ok((package, service, method))
}

fn apply_grpc_tag(tags: &mut GrpcRequestTags, (tag, value): (String, Option<String>)) {
    match tag.as_str() {
        "no-log" => tags.no_log = true,
        "connection-timeout" => {
            if let Some(v) = value {
                tags.connection_timeout_ms = parse_duration(&v);
            }
        }
        "timeout" => {
            if let Some(v) = value {
                tags.timeout_ms = parse_duration(&v);
            }
        }
        "proto" => {
            if let Some(v) = value {
                tags.proto = Some(v);
            }
        }
        "proto-include" => {
            if let Some(v) = value {
                tags.proto_includes.push(v);
            }
        }
        _ => {}
    }
}

fn parse_websocket_body(lines: &[&str], mut i: usize) -> (Vec<WsMessage>, usize) {
    let mut messages: Vec<WsMessage> = Vec::new();
    let mut current_lines: Vec<String> = Vec::new();
    let mut wait_for_server = false;

    while i < lines.len() {
        let raw = lines[i];
        let trimmed = raw.trim();

        if trimmed.starts_with("###") {
            break;
        }

        if trimmed == "===" {
            flush_message(&mut messages, &mut current_lines, wait_for_server);
            wait_for_server = false;
            i += 1;
            continue;
        }

        if trimmed.eq_ignore_ascii_case("=== wait-for-server") {
            flush_message(&mut messages, &mut current_lines, wait_for_server);
            wait_for_server = true;
            i += 1;
            continue;
        }

        current_lines.push(raw.to_string());
        i += 1;
    }

    flush_message(&mut messages, &mut current_lines, wait_for_server);

    (messages, i)
}

fn flush_message(messages: &mut Vec<WsMessage>, lines: &mut Vec<String>, wait_for_server: bool) {
    let text = lines.join("\n").trim().to_string();
    lines.clear();
    if !text.is_empty() || wait_for_server {
        messages.push(WsMessage {
            text,
            wait_for_server,
        });
    }
}

fn apply_ws_tag(tags: &mut WsRequestTags, (tag, value): (String, Option<String>)) {
    match tag.as_str() {
        "no-log" => tags.no_log = true,
        "connection-timeout" => {
            if let Some(v) = value {
                tags.connection_timeout_ms = parse_duration(&v);
            }
        }
        "idle-timeout" => {
            if let Some(v) = value {
                tags.idle_timeout_ms = parse_duration(&v);
            }
        }
        _ => {}
    }
}

