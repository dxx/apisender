use apisender_lib::commands::curl::{is_grpc_line, is_websocket_line};
use apisender_lib::parser::parse;

#[test]
fn detects_websocket_line_in_block() {
    let text = "\
GET https://example.com

### ws
WEBSOCKET wss://echo.websocket.org

{\"a\":1}
";
    let f = parse(text).unwrap();
    assert!(!is_websocket_line(&f, 0), "GET 行");
    assert!(!is_websocket_line(&f, 2), "### ws 行（块分隔）");
    assert!(is_websocket_line(&f, 3), "WEBSOCKET 行");
    assert!(is_websocket_line(&f, 5), "消息行（WS 块内）");
}

#[test]
fn no_ws_when_file_has_no_websocket() {
    let text = "GET https://example.com\n";
    let f = parse(text).unwrap();
    assert!(!is_websocket_line(&f, 0));
}

#[test]
fn detects_grpc_line_in_block() {
    let text = "\
GET https://example.com

### grpc
GRPC grpc://localhost:50051/hello.Greeter/SayHello

{\"name\":\"world\"}
";
    let f = parse(text).unwrap();
    assert!(!is_grpc_line(&f, 0), "GET 行");
    assert!(!is_grpc_line(&f, 2), "### grpc 行（块分隔）");
    assert!(is_grpc_line(&f, 3), "GRPC 行");
    assert!(is_grpc_line(&f, 5), "body 行（gRPC 块内）");
}

#[test]
fn no_grpc_when_file_has_no_grpc() {
    let text = "GET https://example.com\n";
    let f = parse(text).unwrap();
    assert!(!is_grpc_line(&f, 0));
}
