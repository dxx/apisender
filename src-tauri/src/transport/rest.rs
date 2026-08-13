
use std::collections::HashMap;
use std::time::{Duration, Instant};

use async_trait::async_trait;
use futures_util::StreamExt;
use reqwest::{Client, ClientBuilder, redirect::Policy as RedirectPolicy};
use serde::{Deserialize, Serialize};

use crate::error::{AppError, AppResult};
use crate::parser::{HttpMethod, MultipartContent, ParsedRequest, RequestBody};
use crate::version::USER_AGENT;

use super::{RawResponse, ResponseBody, StreamChunk, Transport};

/// HTTP/HTTPS 传输层：负责构造 reqwest 客户端、组装请求并把响应回包成 `RawResponse`。
pub struct RestTransport;

impl RestTransport {
    pub fn new() -> Self {
        RestTransport
    }

    /// 按请求标签和 HTTP 版本构造 reqwest `Client`。
    /// 行为：忽略证书校验（调试用）、开启 gzip/brotli/deflate 解压；
    /// SSE / 流式场景不设默认总超时（避免长连接被 30s 强制断开），但仍尊重显式 `@timeout`。
    fn build_client(&self, req: &ParsedRequest, is_stream: bool) -> AppResult<Client> {
        let mut builder = ClientBuilder::new()
            .danger_accept_invalid_certs(true)
            .gzip(true)
            .brotli(true)
            .deflate(true)
            .user_agent(USER_AGENT);

        match req.http_version.as_deref() {
            Some("HTTP/1.1") => builder = builder.http1_only(),
            Some("HTTP/2") => builder = builder.http2_prior_knowledge(),
            _ => {}
        }

        let redirect_policy = if req.tags.no_redirect {
            RedirectPolicy::none()
        } else {
            RedirectPolicy::limited(10)
        };
        builder = builder.redirect(redirect_policy);

        // SSE / 流式场景不设默认总超时（避免长连接被 30s 强制断开），但仍尊重显式 @timeout
        // SSE / 流式场景不设默认总超时（避免长连接被 30s 强制断开），但仍尊重显式 @timeout。
        if let Some(ms) = req.tags.timeout_ms {
            builder = builder.timeout(Duration::from_millis(ms));
        } else if !is_stream {
            builder = builder.timeout(Duration::from_secs(30));
        }

        if let Some(ms) = req.tags.connection_timeout_ms {
            builder = builder.connect_timeout(Duration::from_millis(ms));
        } else {
            builder = builder.connect_timeout(Duration::from_secs(10));
        }

        Ok(builder.build()?)
    }

    /// 把 `ParsedRequest` 转换成 `reqwest::RequestBuilder`，含 method/headers/cookies/body。
    /// body 三种形态：None / Text / File（读文件）/ Multipart（按段读取）。
    fn build_request(
        &self,
        client: &Client,
        req: &ParsedRequest,
        cookies: &HashMap<String, String>,
    ) -> AppResult<reqwest::RequestBuilder> {
        let method = match &req.method {
            HttpMethod::Get => reqwest::Method::GET,
            HttpMethod::Post => reqwest::Method::POST,
            HttpMethod::Put => reqwest::Method::PUT,
            HttpMethod::Delete => reqwest::Method::DELETE,
            HttpMethod::Patch => reqwest::Method::PATCH,
            HttpMethod::Head => reqwest::Method::HEAD,
            HttpMethod::Options => reqwest::Method::OPTIONS,
            HttpMethod::Custom(m) => reqwest::Method::from_bytes(m.as_bytes())
                .map_err(|e| AppError::Invalid(format!("Invalid method: {}", e)))?,
        };

        let mut builder = client.request(method, &req.url);

        for header in &req.headers {
            builder = builder.header(&header.key, &header.value);
        }

        if !cookies.is_empty() {
            let cookie_str = cookies
                .iter()
                .map(|(k, v)| format!("{}={}", k, v))
                .collect::<Vec<_>>()
                .join("; ");
            if !cookie_str.is_empty() {
                builder = builder.header("Cookie", cookie_str);
            }
        }

        builder = match &req.body {
            RequestBody::None => builder,
            RequestBody::Text(t) => builder.body(t.clone()),
            RequestBody::File(path) => {
                let content = std::fs::read(path)
                    .map_err(|e| AppError::Io(format!("Failed to read body file {}: {}", path, e)))?;
                builder.body(content)
            }
            RequestBody::Multipart(parts) => {
                let mut form = reqwest::multipart::Form::new();
                for part in parts {
                    let bytes: Vec<u8> = match &part.content {
                        MultipartContent::Text(t) => t.as_bytes().to_vec(),
                        MultipartContent::File(path) => {
                            std::fs::read(path).map_err(|e| {
                                AppError::Io(format!("Failed to read file {}: {}", path, e))
                            })?
                        }
                    };
                    let mut p = reqwest::multipart::Part::bytes(bytes);
                    if let Some(filename) = &part.filename {
                        p = p.file_name(filename.clone());
                    }
                    if let Some(ct) = &part.content_type {
                        p = p.mime_str(ct)
                            .map_err(|e| AppError::Invalid(format!("Invalid mime: {}", e)))?;
                    }
                    form = form.part(part.name.clone(), p);
                }
                builder.multipart(form)
            }
        };

        Ok(builder)
    }
}

#[async_trait]
impl Transport for RestTransport {
    /// 同步执行一次 HTTP 请求：构造客户端 → 发请求 → 收集 header + set-cookie + body。
    /// body 超 10MB 时用占位文本代替，二进制响应统一 base64 编码。
    async fn execute(
        &self,
        request: &ParsedRequest,
        cookies: &HashMap<String, String>,
    ) -> AppResult<RawResponse> {
        let client = self.build_client(request, false)?;
        let req_builder = self.build_request(&client, request, cookies)?;

        let start = Instant::now();
        let response = req_builder.send().await?;
        let duration_ms = start.elapsed().as_millis() as u64;

        let status = response.status().as_u16();
        let status_text = response
            .status()
            .canonical_reason()
            .unwrap_or("")
            .to_string();
        let final_url = response.url().to_string();
        let version = version_to_string(response.version());

        let mut headers: Vec<(String, String)> = Vec::new();
        let mut set_cookies: Vec<String> = Vec::new();
        for (key, value) in response.headers().iter() {
            let key_str = key.as_str().to_string();
            let val_str = value.to_str().unwrap_or("").to_string();
            if key_str.eq_ignore_ascii_case("set-cookie") {
                set_cookies.push(val_str.clone());
            }
            headers.push((key_str, val_str));
        }

        let content_type = response
            .headers()
            .get("content-type")
            .and_then(|v| v.to_str().ok())
            .unwrap_or("")
            .to_string();

        let body_bytes = response.bytes().await?;
        let size = body_bytes.len() as u64;

        const MAX_BODY_SIZE: usize = 10 * 1024 * 1024;
        let body = if body_bytes.len() > MAX_BODY_SIZE {
            ResponseBody::Text(format!(
                "[Response body too large: {} bytes, truncated]",
                body_bytes.len()
            ))
        } else if is_text_content_type(&content_type) {
            let text = String::from_utf8_lossy(&body_bytes).to_string();
            ResponseBody::Text(text)
        } else {
            use base64::{engine::general_purpose, Engine};
            ResponseBody::Binary(general_purpose::STANDARD.encode(&body_bytes))
        };

        Ok(RawResponse {
            status,
            status_text,
            version,
            headers,
            body,
            duration_ms,
            size,
            url: final_url,
            cookies: set_cookies,
        })
    }

    /// 流式执行：先发请求拿到首包 + headers（partial RawResponse），再把后续字节流交给上层消费。
    /// 主要服务于 SSE / 大文件下载；超时错误会被归类为 `请求超时`，连接错误归为 `连接失败`。
    async fn execute_stream(
        &self,
        request: &ParsedRequest,
        cookies: &HashMap<String, String>,
    ) -> AppResult<(RawResponse, super::ByteStream)> {
        let client = self.build_client(request, true)?;
        let req_builder = self.build_request(&client, request, cookies)?;

        let start = Instant::now();
        let response = req_builder.send().await?;
        let duration_ms = start.elapsed().as_millis() as u64;

        let status = response.status().as_u16();
        let status_text = response
            .status()
            .canonical_reason()
            .unwrap_or("")
            .to_string();
        let final_url = response.url().to_string();
        let version = version_to_string(response.version());

        let mut headers: Vec<(String, String)> = Vec::new();
        let mut set_cookies: Vec<String> = Vec::new();
        for (key, value) in response.headers().iter() {
            let key_str = key.as_str().to_string();
            let val_str = value.to_str().unwrap_or("").to_string();
            if key_str.eq_ignore_ascii_case("set-cookie") {
                set_cookies.push(val_str.clone());
            }
            headers.push((key_str, val_str));
        }

        let partial = RawResponse {
            status,
            status_text,
            version,
            headers,
            body: ResponseBody::Sse(vec![]),
            duration_ms,
            size: 0,
            url: final_url,
            cookies: set_cookies,
        };

        let stream = response
            .bytes_stream()
            .map(|result| match result {
                Ok(bytes) => StreamChunk::Data(bytes.to_vec()),
                Err(e) => {
                    let msg = if e.is_timeout() {
                        format!("请求超时：{}", e)
                    } else if e.is_connect() {
                        format!("连接失败：{}", e)
                    } else {
                        e.to_string()
                    };
                    StreamChunk::Error(msg)
                }
            })
            .boxed();

        Ok((partial, stream))
    }
}

/// 把 reqwest 内部版本枚举映射成 UI 友好的字符串。
fn version_to_string(v: reqwest::Version) -> String {
    match v {
        reqwest::Version::HTTP_11 => "HTTP/1.1".to_string(),
        reqwest::Version::HTTP_2 => "HTTP/2".to_string(),
        _ => format!("{:?}", v),
    }
}

/// 粗粒度判断响应是否应按文本解码：常见 text / JSON / XML / HTML / YAML / form-urlencoded 都算文本；空 content-type 也按文本展示。
fn is_text_content_type(ct: &str) -> bool {
    let ct = ct.to_ascii_lowercase();
    ct.contains("text")
        || ct.contains("json")
        || ct.contains("xml")
        || ct.contains("html")
        || ct.contains("javascript")
        || ct.contains("yaml")
        || ct.contains("form-urlencoded")
        || ct.is_empty()
}

/// 解析后的 `Set-Cookie` 单条字段，结构化给前端展示与持久化使用。
#[derive(Debug, Serialize, Deserialize)]
pub struct ParsedSetCookie {
    pub name: String,
    pub value: String,
    pub domain: Option<String>,
    pub path: Option<String>,
    pub expires: Option<String>,
    pub secure: bool,
    pub http_only: bool,
    pub same_site: Option<String>,
}

/// 解析单条 `Set-Cookie` 头：拆 `name=value` + 属性段；空 `domain` / `path` 时按请求主机补 `"."` 域和 `/` 路径。
pub fn parse_set_cookie(header_value: &str, request_host: &str) -> ParsedSetCookie {
    let mut parts = header_value.split(';');
    let nv = parts.next().unwrap_or("").trim();
    let (name, value) = if let Some(idx) = nv.find('=') {
        (nv[..idx].to_string(), nv[idx + 1..].to_string())
    } else {
        (nv.to_string(), String::new())
    };

    let mut domain = None;
    let mut path = None;
    let mut expires = None;
    let mut secure = false;
    let mut http_only = false;
    let mut same_site = None;

    for attr in parts {
        let attr = attr.trim();
        let (attr_name, attr_val) = if let Some(idx) = attr.find('=') {
            (attr[..idx].trim(), attr[idx + 1..].trim())
        } else {
            (attr, "")
        };
        match attr_name.to_ascii_lowercase().as_str() {
            "domain" => domain = Some(attr_val.to_string()),
            "path" => path = Some(attr_val.to_string()),
            "expires" => expires = Some(attr_val.to_string()),
            "max-age" => {
                if let Ok(secs) = attr_val.parse::<i64>() {
                    if secs >= 0 {
                        expires = Some(format!("+{}s", secs));
                    }
                }
            }
            "secure" => secure = true,
            "httponly" => http_only = true,
            "samesite" => same_site = Some(attr_val.to_string()),
            _ => {}
        }
    }

    if domain.is_none() {
        domain = Some(request_host.to_string());
    }
    if path.is_none() {
        path = Some("/".to_string());
    }

    ParsedSetCookie {
        name,
        value,
        domain,
        path,
        expires,
        secure,
        http_only,
        same_site,
    }
}
