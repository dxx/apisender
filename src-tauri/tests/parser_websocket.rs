use std::collections::HashMap;

use apisender_lib::parser::{parse, extract_single_ws_request};
use apisender_lib::variables::interpolator::{interpolate_ws_request, merge_variables};

#[test]
fn test_websocket_basic() {
    let text = "WEBSOCKET ws://localhost:8080/echo\n{\"hello\": \"world\"}\n";
    let file = parse(text).unwrap();
    assert_eq!(file.websocket_requests.len(), 1);
    assert_eq!(file.requests.len(), 0);
    let req = &file.websocket_requests[0];
    assert_eq!(req.url, "ws://localhost:8080/echo");
    assert_eq!(req.messages.len(), 1);
    assert_eq!(req.messages[0].text, "{\"hello\": \"world\"}");
    assert!(!req.messages[0].wait_for_server);
}

#[test]
fn test_websocket_multi_message_with_separator() {
    let text = "WEBSOCKET ws://localhost:8080/echo\n{\"a\": 1}\n===\n{\"b\": 2}\n===\n{\"c\": 3}\n";
    let file = parse(text).unwrap();
    let req = &file.websocket_requests[0];
    assert_eq!(req.messages.len(), 3);
    assert_eq!(req.messages[0].text, "{\"a\": 1}");
    assert_eq!(req.messages[1].text, "{\"b\": 2}");
    assert_eq!(req.messages[2].text, "{\"c\": 3}");
    assert!(req.messages.iter().all(|m| !m.wait_for_server));
}

#[test]
fn test_websocket_wait_for_server() {
    let text = "WEBSOCKET ws://localhost:8080/echo\n{\"a\": 1}\n=== wait-for-server\n{\"after-resp\": true}\n=== wait-for-server\n=== wait-for-server\n{\"after-3\": true}\n";
    let file = parse(text).unwrap();
    let req = &file.websocket_requests[0];
    assert_eq!(req.messages.len(), 4);
    assert!(!req.messages[0].wait_for_server);
    assert!(req.messages[1].wait_for_server);
    assert!(req.messages[2].wait_for_server);
    assert!(req.messages[3].wait_for_server);
}

#[test]
fn test_websocket_block_with_name_and_tags() {
    let text = "### WS Echo\n# @connection-timeout 5s\n# @idle-timeout 30s\n# @no-log\nWEBSOCKET ws://localhost:8080/echo\n{\"hello\": \"world\"}\n";
    let file = parse(text).unwrap();
    let req = &file.websocket_requests[0];
    assert_eq!(req.name.as_deref(), Some("WS Echo"));
    assert_eq!(req.tags.connection_timeout_ms, Some(5000));
    assert_eq!(req.tags.idle_timeout_ms, Some(30000));
    assert!(req.tags.no_log);
}

#[test]
fn test_parse_single_ws_request() {
    let text = "WEBSOCKET ws://localhost:8080/echo\n{\"hello\": \"world\"}\n";
    let parsed = parse(text).unwrap();
    let req = extract_single_ws_request(&parsed, 0).unwrap();
    assert_eq!(req.url, "ws://localhost:8080/echo");
    assert_eq!(req.messages.len(), 1);
}

#[test]
fn test_websocket_and_http_mixed() {
    let text = "### HTTP\nGET https://example.com\n\n### WS\nWEBSOCKET ws://localhost:8080/echo\n{\"a\": 1}\n";
    let file = parse(text).unwrap();
    assert_eq!(file.requests.len(), 1);
    assert_eq!(file.websocket_requests.len(), 1);
    assert_eq!(file.requests[0].url, "https://example.com");
    assert_eq!(file.websocket_requests[0].url, "ws://localhost:8080/echo");
}

#[test]
fn test_websocket_inline_tags_after_method_line() {
    let text = "WEBSOCKET ws://localhost:8080/echo\n@idle-timeout 30s\n@connection-timeout 5s\n{\"hello\": \"world\"}\n===\n{\"second\": \"msg\"}\n";
    let file = parse(text).unwrap();
    let req = &file.websocket_requests[0];
    assert_eq!(
        req.tags.idle_timeout_ms, None,
        "URL 之后的 @tag 不再生效，与 HTTP 块行为一致"
    );
    assert_eq!(req.tags.connection_timeout_ms, None);
    assert_eq!(req.messages.len(), 2);
    assert!(req.messages[0].text.contains("@idle-timeout 30s"));
    assert!(req.messages[0].text.contains("@connection-timeout 5s"));
    assert!(req.messages[0].text.contains("{\"hello\": \"world\"}"));
    assert_eq!(req.messages[1].text, "{\"second\": \"msg\"}");
}

#[test]
fn test_websocket_global_variables_collected() {
    let text = "@host = ws.example.com\n@token = abc123\n\nWEBSOCKET ws://{{host}}/echo\n{\"a\": 1}\n";
    let file = parse(text).unwrap();
    assert_eq!(file.global_variables.len(), 2);
    assert_eq!(file.global_variables[0], ("host".to_string(), "ws.example.com".to_string()));
    assert_eq!(file.global_variables[1], ("token".to_string(), "abc123".to_string()));
    let req = &file.websocket_requests[0];
    assert_eq!(req.url, "ws://{{host}}/echo");
    assert_eq!(req.messages[0].text, "{\"a\": 1}");

    let mut env_vars = HashMap::new();
    env_vars.insert("envvar".to_string(), "envvalue".to_string());
    let merged = merge_variables(&env_vars, &file.global_variables, &req.variables);
    let resolved = interpolate_ws_request(req, &merged).unwrap();
    assert_eq!(resolved.url, "ws://ws.example.com/echo");
}

#[test]
fn test_websocket_global_var_priority_over_env() {
    let text = "@host = from-global\n\nWEBSOCKET ws://{{host}}/path\n";
    let file = parse(text).unwrap();
    let req = &file.websocket_requests[0];
    let mut env_vars = HashMap::new();
    env_vars.insert("host".to_string(), "from-env".to_string());
    let merged = merge_variables(&env_vars, &file.global_variables, &req.variables);
    let resolved = interpolate_ws_request(req, &merged).unwrap();
    assert_eq!(resolved.url, "ws://from-global/path");
}

#[test]
fn test_websocket_block_var_overrides_global() {
    let text = "@host = from-global\n\n###\n@host = from-block\nWEBSOCKET ws://{{host}}/path\n";
    let file = parse(text).unwrap();
    let req = &file.websocket_requests[0];
    let merged = merge_variables(&HashMap::new(), &file.global_variables, &req.variables);
    let resolved = interpolate_ws_request(req, &merged).unwrap();
    assert_eq!(resolved.url, "ws://from-block/path");
}

// ---- WS tag position tests

#[test]
fn ws_tag_position_a_immediately_after_method() {
    let text = "WEBSOCKET ws://localhost/echo\n@idle-timeout 30s\n{\"a\":1}\n";
    let parsed = parse(text).unwrap();
    let req = extract_single_ws_request(&parsed, 0).unwrap();
    assert_eq!(
        req.tags.idle_timeout_ms, None,
        "URL 之后的 @tag 不再生效，与 HTTP 块行为一致"
    );
    assert_eq!(req.messages.len(), 1);
    assert!(req.messages[0].text.contains("@idle-timeout"));
    assert!(req.messages[0].text.contains("{\"a\":1}"));
}

#[test]
fn ws_tag_position_b_after_body() {
    let text = "WEBSOCKET ws://localhost/echo\n{\"a\":1}\n@idle-timeout 30s\n===\n{\"b\":2}\n";
    let parsed = parse(text).unwrap();
    let req = extract_single_ws_request(&parsed, 0).unwrap();
    assert_eq!(req.tags.idle_timeout_ms, None, "tag in body must NOT apply");
    assert_eq!(req.messages.len(), 2);
    assert!(req.messages[0].text.contains("@idle-timeout"));
}

#[test]
fn ws_tag_position_c_in_body_middle() {
    let text = "WEBSOCKET ws://localhost/echo\n{\"a\":1}\n@idle-timeout 30s\n{\"b\":2}\n";
    let parsed = parse(text).unwrap();
    let req = extract_single_ws_request(&parsed, 0).unwrap();
    assert_eq!(req.tags.idle_timeout_ms, None);
    assert_eq!(req.messages.len(), 1);
    assert!(req.messages[0].text.contains("@idle-timeout"));
}

#[test]
fn ws_tag_position_d_in_block_header() {
    let text = "### Echo\n# @idle-timeout 30s\nWEBSOCKET ws://localhost/echo\n{\"a\":1}\n";
    let parsed = parse(text).unwrap();
    let req = extract_single_ws_request(&parsed, 2).unwrap();
    assert_eq!(req.tags.idle_timeout_ms, Some(30000));
}