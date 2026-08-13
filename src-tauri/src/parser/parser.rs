
use crate::error::{AppError, AppResult};

use super::types::*;

/// HTTP Client / WebSocket / gRPC 文本格式的解析器入口。
/// 作用与流程：把原文按行切好交给后续 `parse` 线性扫描，识别 `###` 块、独立 method/URL 请求和顶层变量声明。
pub struct Parser<'a> {
    lines: Vec<&'a str>,
}

impl<'a> Parser<'a> {
    pub fn new(text: &'a str) -> Self {
        Parser {
            lines: text.lines().collect(),
        }
    }

    /// 入参：无（借用 `self.lines`）。
    /// 出参：完整的 `ParsedFile`，包含 HTTP、WS、gRPC 三类请求和全局变量。
    /// 作用与流程：线性扫描文本；先识别 `###` 块再分派到对应解析器；块之外的 method/URL 行也独立成请求；顶层 `@key=value` 视为全局变量。
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
                // 分隔符行尾部的文本作为请求名；空则保留为 None，由后续注释行补齐。
                let name = if name_str.is_empty() { None } else { Some(name_str.to_string()) };
                let mut tags = RequestTags::default();
                let mut ws_tags = WsRequestTags::default();
                let mut grpc_tags = GrpcRequestTags::default();
                let mut block_variables: Vec<(String, String)> = Vec::new();
                let mut pending_name = name;
                i += 1;

                // 吃掉分隔符与请求行之间的元数据：注释、标签、块级变量；首个非空非注释行视为请求行。

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
                            // 纯注释里若携带标题文本，紧跟在分隔符后时升级为请求名。
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

            // 顶层（没有 ### 包围）的注释行：仅收集 `@key=value` 形式的全局变量。
            if is_comment(line) {
                if let Some((k, v)) = parse_inplace_variable(line) {
                    global_variables.push((k, v));
                }
                i += 1;
                continue;
            }

            // 顶层 `@key=value` 一律视为全局变量。
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

    /// 入参：候选请求名、起始行下标、已解析的 WS 标签、块级变量。
    /// 出参：解析得到的 `ParsedWebSocketRequest` 和下一轮扫描起始行。
    /// 作用与流程：先合并 URL 续行得到完整请求行，再委派 `parse_websocket_body` 收集消息列表。
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

    /// 入参：候选请求名、起始行下标、已解析的 gRPC 标签、块级变量。
    /// 出参：解析得到的 `ParsedGrpcRequest` 和下一轮扫描起始行。
    /// 作用与流程：合并 URL 续行 → 拆 `package.service/method` → 顺序收集 metadata 头 → 收集 JSON/XML 消息体；metadata 与 body 间允许空行分隔。
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

        // URL 行与 metadata 段之间允许空行；这里跳过仅含空白的行。
        while i < self.lines.len() && self.lines[i].trim().is_empty() {
            i += 1;
        }

        // 收集 metadata 行：每个非空非注释行要求包含冒号，键非空才记录；遇到空行 / `###` / JSON/XML 起始行视为 metadata 结束。
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

        // 跳过 metadata 与 body 之间的空行。
        while i < self.lines.len() && self.lines[i].trim().is_empty() {
            i += 1;
        }
        // 收集 body：整段原始行直到空行 / `###` / EOF，注释行直接跳过。
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

        // 空块时让 `line_end` 至少大于 `line_start`，避免后续消费同一行。
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

    /// 入参：候选请求名、起始行下标、SEP 所在行下标、已解析标签、块级变量。
    /// 出参：解析得到的 `ParsedRequest` 和下一轮扫描起始行。
    /// 作用与流程：合并请求行续行 → 顺序收集 header（首个非 Header 行后切换）→ 收集 body；body 末尾根据 `Content-Type` 决定是 multipart 还是纯文本。
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

        // Headers 段：遇到首个非 `Key: Value` 行（空行 / `###` / `>` 重定向 / 注释后的内容）即终止。
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

        // Body 段：遇到 `###` / `>` / `>>` 终止；multipart 需要保留内部空行，普通 body 遇空行终止。
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
            // `< path` 与单独的 `<` 视为从本地文件读取 body。
            if body_trimmed.starts_with("< ") || body_trimmed == "<" {
                let file_path = body_trimmed.trim_start_matches('<').trim().to_string();
                body = RequestBody::File(file_path);
            } else if has_multipart_content_type(&headers) {
                body = parse_multipart(&body_text);
            } else {
                body = RequestBody::Text(body_text);
            }
        }

        // 与 gRPC 块保持一致：空 body 时也要保证 `line_end > line_start`，避免后续条目复用同一行。
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

    /// 入参：当前行下标的可变引用。
    /// 出参：合并后的请求行字符串（已 trim），同时把 `i` 推进到最后一个被消费行的下一行。
    /// 作用与流程：把首行 trim 后拼接；后续以空格或 Tab 开头（且非空白行）的行视为续行；空行则中断合并。
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

/// 判断一行是否可作为 HTTP 请求行：常见方法 + 裸 URL + 自定义大写方法。
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
        // CONNECT / TRACE 通过显式列举；其他全大写且长度 > 1 的词也视为自定义方法。
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

/// 入参：合并后的请求行原文。
/// 出参：HTTP 方法、URL、可选 HTTP 版本（裸 URL 请求方法固定为 GET）。
/// 作用与流程：拆出首个 token 判定是 method 还是裸 URL；剩余部分再按 ` HTTP/x.y` 切出可选版本。
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
            // 裸 URL 后接其它内容时，把后半段作为 continuation 拼接回去。
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

/// 入参：去掉首位空白后的请求行文本。
/// 出参：URL 部分与可选 HTTP 版本。
/// 作用与流程：优先从右侧匹配 ` HTTP/`，命中即切分；否则整段视作 URL。
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

/// 解析 `@key=value` 形式的内联变量声明。
/// 入参：一行原文（可带 `#` 或 `//` 注释前缀）。
/// 出参：解析出的 `(key, value)`；非变量或格式非法时返回 None。
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

/// 解析 `@tag value` 形式的标签；含 `=` 视为变量而非标签。
/// 入参：一行原文（可带 `#` 或 `//` 注释前缀）。
/// 出参：`(tag, value)`；非标签时返回 None。
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

/// 把 `(tag, value)` 应用到 HTTP 请求标签；未识别的标签忽略。
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

/// 解析带单位的时长：`ms`（毫秒）、`s`（秒）、`m`（分钟）、纯数字（按秒）。
/// 入参：原始字符串。
/// 出参：毫秒数；解析失败返回 None。
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

/// 判断一组 header 是否声明 `multipart/form-data`。
fn has_multipart_content_type(headers: &[HttpHeader]) -> bool {
    headers.iter().any(|h| {
        h.key.eq_ignore_ascii_case("content-type")
            && h.value
                .to_ascii_lowercase()
                .starts_with("multipart/form-data")
    })
}

/// 解析 multipart body：以首行的 boundary 为分隔符，逐段读取
/// `Content-Disposition` / `Content-Type` 元数据与正文。分段前先调用 `finish_part` 收尾。
/// 入参：multipart 原始 body（已合并行）。
/// 出参：`RequestBody::Multipart`，含各段 name/filename/content_type/content。
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
                // 解析 `name="..."` / `filename="..."`；值两端的双引号统一剥掉。
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

/// 收尾一段 multipart：合并正文行，识别 `< path` 文件路径。
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

/// 文本解析的便捷入口。
pub fn parse(text: &str) -> AppResult<ParsedFile> {
    Parser::new(text).parse()
}

/// 从已解析结果中按行号定位 HTTP 请求。
/// 行为：先精确匹配 `line_offset` 落在 `[line_start, line_end]` 内的请求；找不到时降级到 `line_start <= line_offset` 中起始行最大的请求，再找不到则报错。
/// 入参：已解析文件与 0 基行号。
/// 出参：命中的 `ParsedRequest`（克隆副本）。
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

/// WS 单请求定位，行为同 `extract_single_request`。
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

/// gRPC 单请求定位，行为同 `extract_single_request`。
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

/// 从 `WEBSOCKET <url>` 形式中取出 URL；格式错误时返回 `Parse` 错误。
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

/// 从 `GRPC <url>` 形式中取出 URL；格式错误时返回 `Parse` 错误。
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
/// 解析 `grpcs://host:port/Package.Service/Method` URL 得到 `(package, service, method)`。
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
    // 期望 `Package.Service/Method`，先按最后一个 `/` 切开得到 method，再按 `.` 拆 package/service。
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

/// 把 `(tag, value)` 应用到 gRPC 标签；未识别的标签忽略。
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

/// 解析 WebSocket body：以 `===` 单行作为消息分隔，`=== wait-for-server` 标记下一条消息需要先等服务端回包。
/// 入参：全文行切片与起始下标。
/// 出参：消息列表（含 `wait_for_server` 标记）和扫描终点。
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

/// 把累积的行合并为一条 WS 消息并清空累积缓冲；空消息只在 `wait_for_server` 时保留（占位等待）。
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

/// 把 `(tag, value)` 应用到 WS 标签；未识别的标签忽略。
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

