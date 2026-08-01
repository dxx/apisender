use apisender_lib::sse::SseParser;

#[test]
fn test_basic_event() {
    let mut parser = SseParser::new();
    let events = parser.feed(b"data: hello\n\n");
    assert_eq!(events.len(), 1);
    assert_eq!(events[0].data, "hello");
    assert_eq!(events[0].event, "message");
    assert_eq!(events[0].index, 0);
}

#[test]
fn test_multi_line_data() {
    let mut parser = SseParser::new();
    let events = parser.feed(b"data: line1\ndata: line2\n\n");
    assert_eq!(events.len(), 1);
    assert_eq!(events[0].data, "line1\nline2");
}

#[test]
fn test_event_type_and_id() {
    let mut parser = SseParser::new();
    let events = parser.feed(b"event: update\nid: 42\ndata: payload\n\n");
    assert_eq!(events.len(), 1);
    assert_eq!(events[0].event, "update");
    assert_eq!(events[0].id.as_deref(), Some("42"));
}

#[test]
fn test_comment_ignored() {
    let mut parser = SseParser::new();
    let events = parser.feed(b": this is a comment\ndata: hi\n\n");
    assert_eq!(events.len(), 1);
    assert_eq!(events[0].data, "hi");
}

#[test]
fn test_split_chunks() {
    let mut parser = SseParser::new();
    let e1 = parser.feed(b"data: hel");
    assert!(e1.is_empty());
    let e2 = parser.feed(b"lo\n\n");
    assert_eq!(e2.len(), 1);
    assert_eq!(e2[0].data, "hello");
}

#[test]
fn test_crlf_line_endings() {
    let mut parser = SseParser::new();
    let events = parser.feed(b"data: hi\r\n\r\n");
    assert_eq!(events.len(), 1);
    assert_eq!(events[0].data, "hi");
}

#[test]
fn test_retry_field() {
    let mut parser = SseParser::new();
    let events = parser.feed(b"retry: 3000\ndata: test\n\n");
    assert_eq!(events.len(), 1);
    assert_eq!(events[0].retry, Some(3000));
}
