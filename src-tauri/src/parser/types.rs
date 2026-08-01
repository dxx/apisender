use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub enum HttpMethod {
    Get,
    Post,
    Put,
    Delete,
    Patch,
    Head,
    Options,
    Custom(String),
}

impl HttpMethod {
    pub fn parse(s: &str) -> Self {
        match s.to_ascii_uppercase().as_str() {
            "GET" => HttpMethod::Get,
            "POST" => HttpMethod::Post,
            "PUT" => HttpMethod::Put,
            "DELETE" => HttpMethod::Delete,
            "PATCH" => HttpMethod::Patch,
            "HEAD" => HttpMethod::Head,
            "OPTIONS" => HttpMethod::Options,
            other => HttpMethod::Custom(other.to_string()),
        }
    }

    pub fn as_str(&self) -> &str {
        match self {
            HttpMethod::Get => "GET",
            HttpMethod::Post => "POST",
            HttpMethod::Put => "PUT",
            HttpMethod::Delete => "DELETE",
            HttpMethod::Patch => "PATCH",
            HttpMethod::Head => "HEAD",
            HttpMethod::Options => "OPTIONS",
            HttpMethod::Custom(s) => s,
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct HttpHeader {
    pub key: String,
    pub value: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub enum RequestBody {
    None,
    Text(String),
    File(String),
    Multipart(Vec<MultipartPart>),
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct MultipartPart {
    pub name: String,
    pub filename: Option<String>,
    pub content_type: Option<String>,
    pub content: MultipartContent,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub enum MultipartContent {
    Text(String),
    File(String),
}

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
pub struct RequestTags {
    pub no_redirect: bool,
    pub no_log: bool,
    pub no_cookie: bool,
    pub no_auto_encoding: bool,
    pub timeout_ms: Option<u64>,
    pub connection_timeout_ms: Option<u64>,
    pub idle_timeout_ms: Option<u64>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ParsedRequest {
    pub name: Option<String>,
    pub method: HttpMethod,
    pub url: String,
    pub http_version: Option<String>,
    pub headers: Vec<HttpHeader>,
    pub body: RequestBody,
    pub tags: RequestTags,
    pub variables: Vec<(String, String)>,
    pub line_start: usize,
    pub line_end: usize,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RequestPreview {
    pub name: Option<String>,
    pub method: String,
    pub url: String,
    pub line_start: usize,
}

impl From<&ParsedRequest> for RequestPreview {
    fn from(req: &ParsedRequest) -> Self {
        RequestPreview {
            name: req.name.clone(),
            method: req.method.as_str().to_string(),
            url: req.url.clone(),
            line_start: req.line_start,
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ParsedFile {
    pub requests: Vec<ParsedRequest>,
    pub websocket_requests: Vec<ParsedWebSocketRequest>,
    pub grpc_requests: Vec<ParsedGrpcRequest>,
    pub global_variables: Vec<(String, String)>,
}

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
pub struct WsRequestTags {
    pub no_log: bool,
    pub connection_timeout_ms: Option<u64>,
    pub idle_timeout_ms: Option<u64>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct WsMessage {
    pub text: String,
    pub wait_for_server: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ParsedWebSocketRequest {
    pub name: Option<String>,
    pub url: String,
    pub messages: Vec<WsMessage>,
    pub tags: WsRequestTags,
    pub variables: Vec<(String, String)>,
    pub line_start: usize,
    pub line_end: usize,
}

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
pub struct GrpcRequestTags {
    pub no_log: bool,
    pub connection_timeout_ms: Option<u64>,
    pub timeout_ms: Option<u64>,
    pub proto: Option<String>,
    pub proto_includes: Vec<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct GrpcMessage {
    pub text: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ParsedGrpcRequest {
    pub name: Option<String>,
    pub url: String,
    pub package: String,
    pub service: String,
    pub method: String,
    pub metadata: Vec<HttpHeader>,
    pub message: Option<GrpcMessage>,
    pub tags: GrpcRequestTags,
    pub variables: Vec<(String, String)>,
    pub line_start: usize,
    pub line_end: usize,
}
