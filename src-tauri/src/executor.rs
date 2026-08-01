
use std::collections::HashMap;

use crate::error::AppResult;
use crate::parser::ParsedRequest;
use crate::storage::{self};
use crate::transport::{rest::parse_set_cookie, rest::RestTransport, ByteStream, RawResponse, Transport};
use crate::variables::interpolate_request;

pub mod cookies;

pub struct Executor<T: Transport> {
    transport: T,
}

impl<T: Transport> Executor<T> {
    pub fn new(transport: T) -> Self {
        Executor { transport }
    }

    pub async fn execute(
        &self,
        request: &ParsedRequest,
        variables: &HashMap<String, String>,
        db: &storage::Db,
    ) -> AppResult<RawResponse> {
        cookies::cleanup_expired(db)?;

        let request_host = extract_host(&request.url);
        let stored_cookies = if !request.tags.no_cookie {
            cookies::get_cookies_for_host(db, &request_host)?
        } else {
            HashMap::new()
        };

        let resolved = interpolate_request(request, variables)?;
        let response = self.transport.execute(&resolved, &stored_cookies).await?;

        if !request.tags.no_cookie {
            for (key, value) in &response.headers {
                if key.eq_ignore_ascii_case("set-cookie") {
                    let parsed = parse_set_cookie(value, &request_host);
                    let expires_at = if parsed.expires.as_deref() == Some("-1") {
                        None
                    } else {
                        parsed.expires.as_deref()
                    };
                    cookies::upsert_cookie(
                        db,
                        parsed
                            .domain
                            .as_deref()
                            .unwrap_or(&request_host),
                        parsed.path.as_deref().unwrap_or("/"),
                        &parsed.name,
                        &parsed.value,
                        expires_at,
                        parsed.secure,
                        parsed.http_only,
                        parsed.same_site.as_deref(),
                    )?;
                }
            }
        }

        Ok(response)
    }

    pub async fn execute_stream(
        &self,
        request: &ParsedRequest,
        variables: &HashMap<String, String>,
        db: &storage::Db,
    ) -> AppResult<(RawResponse, ByteStream)> {
        cookies::cleanup_expired(db)?;

        let request_host = extract_host(&request.url);
        let stored_cookies = if !request.tags.no_cookie {
            cookies::get_cookies_for_host(db, &request_host)?
        } else {
            HashMap::new()
        };

        let resolved = interpolate_request(request, variables)?;
        let (partial, stream) = self.transport.execute_stream(&resolved, &stored_cookies).await?;

        if !request.tags.no_cookie {
            for (key, value) in &partial.headers {
                if key.eq_ignore_ascii_case("set-cookie") {
                    let parsed = parse_set_cookie(value, &request_host);
                    let expires_at = if parsed.expires.as_deref() == Some("-1") {
                        None
                    } else {
                        parsed.expires.as_deref()
                    };
                    cookies::upsert_cookie(
                        db,
                        parsed
                            .domain
                            .as_deref()
                            .unwrap_or(&request_host),
                        parsed.path.as_deref().unwrap_or("/"),
                        &parsed.name,
                        &parsed.value,
                        expires_at,
                        parsed.secure,
                        parsed.http_only,
                        parsed.same_site.as_deref(),
                    )?;
                }
            }
        }

        Ok((partial, stream))
    }
}

fn extract_host(url: &str) -> String {
    if let Ok(parsed) = url::Url::parse(url) {
        parsed.host_str().unwrap_or("").to_string()
    } else {
        String::new()
    }
}

pub fn extract_host_pub(url: &str) -> String {
    extract_host(url)
}

pub fn create_default_executor() -> Executor<RestTransport> {
    Executor::new(RestTransport::new())
}