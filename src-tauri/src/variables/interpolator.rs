
use std::collections::HashMap;

use crate::error::AppResult;
use crate::parser::{
    GrpcMessage, HttpHeader, MultipartContent, MultipartPart, ParsedGrpcRequest, ParsedRequest,
    ParsedWebSocketRequest, RequestBody, WsMessage,
};

pub fn interpolate(text: &str, variables: &HashMap<String, String>) -> String {
    let mut result = String::new();
    let mut cursor = 0;

    while let Some(start_rel) = text[cursor..].find("{{") {
        let start = cursor + start_rel;
        result.push_str(&text[cursor..start]);

        match text[start + 2..].find("}}") {
            Some(end_rel) => {
                let end = start + 2 + end_rel;
                let var_name = text[start + 2..end].trim();
                if let Some(value) = resolve_variable(var_name, variables) {
                    result.push_str(&value);
                }
                cursor = end + 2;
            }
            None => {
                result.push_str(&text[start..]);
                return result;
            }
        }
    }
    result.push_str(&text[cursor..]);
    result
}

pub fn resolve_variable(name: &str, variables: &HashMap<String, String>) -> Option<String> {
    const ENV_PREFIX: &str = "$env";
    if let Some(arg) = name.strip_prefix(ENV_PREFIX).map(str::trim_start) {
        let (key, default) = match arg.split_once(":-") {
            Some((k, d)) => (k.trim(), Some(d)),
            None => (arg.trim(), None),
        };
        if key.is_empty() {
            return None;
        }
        if let Ok(v) = std::env::var(key) {
            return Some(v);
        }
        if let Some(v) = crate::variables::system_env::get_system_env().get(key) {
            return Some(v.clone());
        }
        default.map(|d| d.to_string())
    } else {
        variables.get(name).cloned()
    }
}

pub fn interpolate_ws_request(
    req: &ParsedWebSocketRequest,
    variables: &HashMap<String, String>,
) -> AppResult<ParsedWebSocketRequest> {
    let url = interpolate(&req.url, variables);
    let messages: Vec<WsMessage> = req
        .messages
        .iter()
        .map(|m| WsMessage {
            text: interpolate(&m.text, variables),
            wait_for_server: m.wait_for_server,
        })
        .collect();

    Ok(ParsedWebSocketRequest {
        name: req.name.clone(),
        url,
        messages,
        tags: req.tags.clone(),
        variables: Vec::new(),
        line_start: req.line_start,
        line_end: req.line_end,
    })
}

pub fn interpolate_grpc_request(
    req: &ParsedGrpcRequest,
    variables: &HashMap<String, String>,
) -> AppResult<ParsedGrpcRequest> {
    let url = interpolate(&req.url, variables);
    let metadata: Vec<HttpHeader> = req
        .metadata
        .iter()
        .map(|h| HttpHeader {
            key: interpolate(&h.key, variables),
            value: interpolate(&h.value, variables),
        })
        .collect();
    let message = req.message.as_ref().map(|m| GrpcMessage {
        text: interpolate(&m.text, variables),
    });

    Ok(ParsedGrpcRequest {
        name: req.name.clone(),
        url,
        package: req.package.clone(),
        service: req.service.clone(),
        method: req.method.clone(),
        metadata,
        message,
        tags: req.tags.clone(),
        variables: Vec::new(),
        line_start: req.line_start,
        line_end: req.line_end,
    })
}

pub fn interpolate_request(
    req: &ParsedRequest,
    variables: &HashMap<String, String>,
) -> AppResult<ParsedRequest> {
    let url = interpolate(&req.url, variables);
    let headers: Vec<HttpHeader> = req
        .headers
        .iter()
        .map(|h| HttpHeader {
            key: interpolate(&h.key, variables),
            value: interpolate(&h.value, variables),
        })
        .collect();

    let body = match &req.body {
        RequestBody::None => RequestBody::None,
        RequestBody::Text(t) => RequestBody::Text(interpolate(t, variables)),
        RequestBody::File(f) => RequestBody::File(interpolate(f, variables)),
        RequestBody::Multipart(parts) => RequestBody::Multipart(
            parts
                .iter()
                .map(|p| {
                    let content = match &p.content {
                        MultipartContent::Text(t) => {
                            MultipartContent::Text(interpolate(t, variables))
                        }
                        MultipartContent::File(f) => {
                            MultipartContent::File(interpolate(f, variables))
                        }
                    };
                    MultipartPart {
                        name: interpolate(&p.name, variables),
                        filename: p.filename.as_ref().map(|f| interpolate(f, variables)),
                        content_type: p
                            .content_type
                            .as_ref()
                            .map(|c| interpolate(c, variables)),
                        content,
                    }
                })
                .collect(),
        ),
    };

    Ok(ParsedRequest {
        name: req.name.clone(),
        method: req.method.clone(),
        url,
        http_version: req.http_version.clone(),
        headers,
        body,
        tags: req.tags.clone(),
        variables: Vec::new(),
        line_start: req.line_start,
        line_end: req.line_end,
    })
}

pub fn merge_variables(
    env_vars: &HashMap<String, String>,
    global_vars: &[(String, String)],
    block_vars: &[(String, String)],
) -> HashMap<String, String> {
    let mut merged = env_vars.clone();
    for (k, v) in global_vars {
        merged.insert(k.clone(), v.clone());
    }
    for (k, v) in block_vars {
        merged.insert(k.clone(), v.clone());
    }
    merged
}
