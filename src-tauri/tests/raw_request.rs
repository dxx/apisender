use apisender_lib::parser::parse;
use apisender_lib::raw_request;

#[test]
fn renders_http_request() {
    let text = "\
POST https://api.example.com/v1/users HTTP/1.1
Content-Type: application/json

{\"name\":\"John\"}
";
    let file = parse(text).unwrap();
    let req = &file.requests[0];
    let rendered = raw_request::http(req);
    assert_eq!(
        rendered,
        "POST https://api.example.com/v1/users HTTP/1.1\r\n\
         Content-Type: application/json\r\n\
         \r\n\
         {\"name\":\"John\"}"
    );
}

#[test]
fn renders_http_request_without_body() {
    let text = "\
GET https://api.example.com/v1/users
";
    let file = parse(text).unwrap();
    let req = &file.requests[0];
    let rendered = raw_request::http(req);
    assert_eq!(
        rendered,
        "GET https://api.example.com/v1/users HTTP/1.1\r\n"
    );
}

#[test]
fn renders_http_name_and_tags() {
    let text = "\
### 获取用户
# @no-log
# @no-redirect
# @timeout 30s
# @connection-timeout 5s
# @idle-timeout 1500ms
GET https://api.example.com/v1/users
";
    let file = parse(text).unwrap();
    let req = &file.requests[0];
    let rendered = raw_request::http(req);
    assert_eq!(
        rendered,
        "### 获取用户\r\n\
         # @no-redirect\r\n\
         # @no-log\r\n\
         # @timeout 30s\r\n\
         # @connection-timeout 5s\r\n\
         # @idle-timeout 1500ms\r\n\
         GET https://api.example.com/v1/users HTTP/1.1\r\n"
    );
}

#[test]
fn renders_http_file_body() {
    let text = "\
POST https://api.example.com/v1/users

< ./data.json
";
    let file = parse(text).unwrap();
    let req = &file.requests[0];
    let rendered = raw_request::http(req);
    assert_eq!(
        rendered,
        "POST https://api.example.com/v1/users HTTP/1.1\r\n\r\n< ./data.json"
    );
}

#[test]
fn renders_grpc_request() {
    let text = "\
GRPC grpc://localhost:50051/hello.Greeter/SayHello
authorization: Bearer abc123

{\"name\":\"world\"}
";
    let file = parse(text).unwrap();
    let req = &file.grpc_requests[0];
    let rendered = raw_request::grpc(req);
    assert_eq!(
        rendered,
        "GRPC grpc://localhost:50051/hello.Greeter/SayHello\r\n\
         authorization: Bearer abc123\r\n\
         \r\n\
         {\"name\":\"world\"}"
    );
}

#[test]
fn renders_grpc_tags() {
    let text = "\
### 打招呼
# @no-log
# @proto ./hello.proto
# @proto-include ./common.proto
# @timeout 2m
GRPC grpc://localhost:50051/hello.Greeter/SayHello
";
    let file = parse(text).unwrap();
    let req = &file.grpc_requests[0];
    let rendered = raw_request::grpc(req);
    assert_eq!(
        rendered,
        "### 打招呼\r\n\
         # @no-log\r\n\
         # @timeout 2m\r\n\
         # @proto ./hello.proto\r\n\
         # @proto-include ./common.proto\r\n\
         GRPC grpc://localhost:50051/hello.Greeter/SayHello\r\n"
    );
}

#[test]
fn renders_websocket_request_with_messages() {
    let text = "\
WEBSOCKET wss://echo.websocket.org
{\"a\":1}
===
{\"b\":2}
=== wait-for-server
{\"c\":3}
";
    let file = parse(text).unwrap();
    let req = &file.websocket_requests[0];
    let rendered = raw_request::websocket(req);
    assert_eq!(
        rendered,
        "WEBSOCKET wss://echo.websocket.org\r\n\
         {\"a\":1}\r\n\
         ===\r\n\
         {\"b\":2}\r\n\
         === wait-for-server\r\n\
         {\"c\":3}"
    );
}

#[test]
fn renders_websocket_tags() {
    let text = "\
### socket
# @no-log
# @connection-timeout 3s
WEBSOCKET wss://echo.websocket.org
{\"a\":1}
";
    let file = parse(text).unwrap();
    let req = &file.websocket_requests[0];
    let rendered = raw_request::websocket(req);
    assert_eq!(
        rendered,
        "### socket\r\n\
         # @no-log\r\n\
         # @connection-timeout 3s\r\n\
         WEBSOCKET wss://echo.websocket.org\r\n\
         {\"a\":1}"
    );
}
