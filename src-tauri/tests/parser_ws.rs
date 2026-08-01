use apisender_lib::parser::parse;

fn parse_ok(text: &str) -> apisender_lib::parser::ParsedFile {
    parse(text).expect("parse should succeed")
}

#[test]
fn ws_url_after_at_line_becomes_first_message() {
    let text = "\
### ws
@no-log
WEBSOCKET wss://example.com/socket
@idle-timeout 30s
{\"a\":1}
===
{\"b\":2}
";
    let f = parse_ok(text);
    assert_eq!(f.websocket_requests.len(), 1);
    let r = &f.websocket_requests[0];

    assert!(r.tags.no_log, "块前置 tag 仍生效");
    assert_eq!(
        r.tags.idle_timeout_ms, None,
        "URL 之后的 @idle-timeout 不应被识别为 tag"
    );

    assert_eq!(r.messages.len(), 2);
    assert_eq!(r.messages[0].text, "@idle-timeout 30s\n{\"a\":1}");
    assert!(!r.messages[0].wait_for_server);
    assert_eq!(r.messages[1].text, "{\"b\":2}");
}

#[test]
fn ws_pre_tag_still_works() {
    let text = "\
### ws
@no-log
@connection-timeout 5s
@idle-timeout 30s
WEBSOCKET wss://example.com/socket
hi
";
    let f = parse_ok(text);
    let r = &f.websocket_requests[0];
    assert!(r.tags.no_log);
    assert_eq!(r.tags.connection_timeout_ms, Some(5_000));
    assert_eq!(r.tags.idle_timeout_ms, Some(30_000));
    assert_eq!(r.messages[0].text, "hi");
}

#[test]
fn http_after_method_at_line_still_dropped() {
    let text = "\
### t
GET https://x
@no-redirect
Content-Type: application/json
";
    let f = parse_ok(text);
    assert!(!f.requests[0].tags.no_redirect);
}

#[test]
fn ws_http_tags_mixed_are_silently_dropped() {
    let text = "\
### ws
@no-redirect
WEBSOCKET wss://x
hi
";
    let f = parse_ok(text);
    let r = &f.websocket_requests[0];
    assert!(!r.tags.no_log);
    assert_eq!(r.tags.connection_timeout_ms, None);
    assert_eq!(r.tags.idle_timeout_ms, None);
}

#[test]
fn ws_block_variable_still_works() {
    let text = "\
### ws
@userId = 42
WEBSOCKET wss://x
{\"id\":{{userId}}}
";
    let f = parse_ok(text);
    let r = &f.websocket_requests[0];
    assert_eq!(
        r.variables,
        vec![("userId".to_string(), "42".to_string())]
    );
}
