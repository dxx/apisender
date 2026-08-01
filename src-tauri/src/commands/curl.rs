
use std::collections::HashMap;

use serde::Deserialize;
use tauri::AppHandle;

use crate::error::{AppError, AppResult};
use crate::parser::{self, MultipartContent, ParsedFile, ParsedRequest, RequestBody};
use crate::variables::{interpolate_request, merge_variables};
use crate::workspace;

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ToCurlArgs {
    pub raw_text: String,
    pub line_offset: Option<usize>,
    pub env_name: Option<String>,
}

#[tauri::command]
pub async fn to_curl(app: AppHandle, args: ToCurlArgs) -> AppResult<String> {
    let parsed_file = parser::parse(&args.raw_text)?;

    if let Some(offset) = args.line_offset {
        if is_websocket_line(&parsed_file, offset) {
            return Err(AppError::Parse(
                "WebSocket 请求不能转换为 cURL。\
                 cURL 不支持 WebSocket 协议。\n\
                 等价工具：websocat（https://github.com/vi/websocat）"
                    .to_string(),
            ));
        }
        if is_grpc_line(&parsed_file, offset) {
            return Err(AppError::Parse(
                "gRPC 请求不能转换为 cURL。\
                 cURL 不支持 gRPC 协议。\n\
                 等价工具：grpcurl（https://github.com/fullstorydev/grpcurl）"
                    .to_string(),
            ));
        }
    }

    let request = if let Some(offset) = args.line_offset {
        parser::extract_single_request(&parsed_file, offset)?
    } else {
        parsed_file
            .requests
            .first()
            .cloned()
            .ok_or_else(|| AppError::Parse("No request found in file".to_string()))?
    };

    let mut env_vars: HashMap<String, String> = HashMap::new();
    if let Some(env_name) = &args.env_name {
        if !env_name.is_empty() {
            let root = workspace::get_workspace_root(&app).ok_or_else(|| {
                AppError::Workspace("No workspace open for environment variables".to_string())
            })?;
            env_vars = workspace::env_file::get_environment_vars(&root, env_name)?;
        }
    }

    let variables = merge_variables(
        &env_vars,
        &parsed_file.global_variables,
        &request.variables,
    );

    let resolved = interpolate_request(&request, &variables)?;

    Ok(render_curl(&resolved))
}

fn render_curl(req: &ParsedRequest) -> String {
    let mut lines: Vec<String> = Vec::new();

    lines.push(format!("curl -X {}", req.method.as_str()));
    lines.push(format!("  {}", shell_quote(&req.url)));

    for h in &req.headers {
        lines.push(format!(
            "  -H {}",
            shell_quote(&format!("{}: {}", h.key, h.value))
        ));
    }

    match &req.body {
        RequestBody::Text(t) => {
            lines.push(format!("  --data-raw {}", shell_quote(t)));
        }
        RequestBody::File(f) => {
            lines.push(format!("  --data-binary {}", shell_quote(&format!("@{}", f))));
        }
        RequestBody::Multipart(parts) => {
            for p in parts {
                let mut s = p.name.clone();
                match &p.content {
                    MultipartContent::Text(t) => s.push_str(&format!("={}", t)),
                    MultipartContent::File(f) => s.push_str(&format!("=@{}", f)),
                }
                if let Some(fname) = &p.filename {
                    s.push_str(&format!(";filename={}", fname));
                }
                if let Some(ct) = &p.content_type {
                    s.push_str(&format!(";type={}", ct));
                }
                lines.push(format!("  -F {}", shell_quote(&s)));
            }
        }
        RequestBody::None => {}
    }

    if req.tags.no_redirect {
        // 不加 -L，curl 默认不跟随重定向
    }

    if let Some(ms) = req.tags.timeout_ms {
        let secs = (ms as f64) / 1000.0;
        lines.push(format!("  --max-time {:.3}", secs));
    }

    if let Some(ms) = req.tags.connection_timeout_ms {
        let secs = (ms as f64) / 1000.0;
        lines.push(format!("  --connect-timeout {:.3}", secs));
    }

    lines.join(" \\\n")
}

fn shell_quote(s: &str) -> String {
    let escaped = s.replace('\'', "'\\''");
    format!("'{}'", escaped)
}

pub fn is_websocket_line(parsed_file: &ParsedFile, line_offset: usize) -> bool {
    parsed_file.websocket_requests.iter().any(|w| {
        line_offset >= w.line_start
            && (line_offset <= w.line_end || w.line_end == 0)
    })
}

pub fn is_grpc_line(parsed_file: &ParsedFile, line_offset: usize) -> bool {
    parsed_file.grpc_requests.iter().any(|g| {
        line_offset >= g.line_start
            && (line_offset <= g.line_end || g.line_end == 0)
    })
}
