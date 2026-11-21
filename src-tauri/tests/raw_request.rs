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
