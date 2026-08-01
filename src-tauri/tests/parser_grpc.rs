use std::collections::HashMap;

use apisender_lib::parser::{parse, extract_single_grpc_request};
use apisender_lib::variables::interpolator::{interpolate_grpc_request, merge_variables};

#[test]
fn test_grpc_basic() {
    let text = "\
GRPC grpc://localhost:50051/hello.Greeter/SayHello

{\"name\":\"world\"}
";
    let file = parse(text).unwrap();
    assert_eq!(file.grpc_requests.len(), 1);
    assert_eq!(file.requests.len(), 0);
    assert_eq!(file.websocket_requests.len(), 0);
    let req = &file.grpc_requests[0];
    assert_eq!(req.url, "grpc://localhost:50051/hello.Greeter/SayHello");
    assert_eq!(req.package, "hello");
    assert_eq!(req.service, "Greeter");
    assert_eq!(req.method, "SayHello");
    assert!(req.message.is_some());
    assert_eq!(req.message.as_ref().unwrap().text, "{\"name\":\"world\"}");
}

#[test]
fn test_grpc_grpcs_scheme() {
    let text = "\
GRPC grpcs://api.example.com:443/foo.Bar/Baz

{\"x\":1}
";
    let file = parse(text).unwrap();
    let req = &file.grpc_requests[0];
    assert_eq!(req.url, "grpcs://api.example.com:443/foo.Bar/Baz");
    assert_eq!(req.package, "foo");
    assert_eq!(req.service, "Bar");
    assert_eq!(req.method, "Baz");
    assert_eq!(req.message.as_ref().unwrap().text, "{\"x\":1}");
}

#[test]
fn test_grpc_block_with_name_and_tags() {
    let text = "\
### Greeter sayHello
# @connection-timeout 3s
# @timeout 10s
# @proto protos/hello.proto
GRPC grpc://localhost:50051/hello.Greeter/SayHello

authorization: Bearer abc123
x-custom: foo

{\"name\":\"world\"}
";
    let file = parse(text).unwrap();
    let req = &file.grpc_requests[0];
    assert_eq!(req.name.as_deref(), Some("Greeter sayHello"));
    assert_eq!(req.tags.connection_timeout_ms, Some(3000));
    assert_eq!(req.tags.timeout_ms, Some(10000));
    assert_eq!(req.tags.proto.as_deref(), Some("protos/hello.proto"));
    assert_eq!(req.metadata.len(), 2);
    assert_eq!(req.metadata[0].key, "authorization");
    assert_eq!(req.metadata[0].value, "Bearer abc123");
    assert_eq!(req.metadata[1].key, "x-custom");
    assert_eq!(req.metadata[1].value, "foo");
    assert_eq!(req.message.as_ref().unwrap().text, "{\"name\":\"world\"}");
}

#[test]
fn test_grpc_no_log() {
    let text = "\
###
# @no-log
GRPC grpc://localhost:50051/hello.Greeter/SayHello

{}
";
    let file = parse(text).unwrap();
    let req = &file.grpc_requests[0];
    assert!(req.tags.no_log);
}

#[test]
fn test_grpc_no_message() {
    let text = "GRPC grpc://localhost:50051/hello.Greeter/SayHello\n";
    let file = parse(text).unwrap();
    let req = &file.grpc_requests[0];
    assert_eq!(req.url, "grpc://localhost:50051/hello.Greeter/SayHello");
    assert!(req.message.is_none());
    assert!(req.metadata.is_empty());
}

#[test]
fn test_grpc_metadata_only() {
    let text = "\
GRPC grpc://localhost:50051/hello.Greeter/SayHello

authorization: Bearer xyz
";
    let file = parse(text).unwrap();
    let req = &file.grpc_requests[0];
    assert_eq!(req.metadata.len(), 1);
    assert_eq!(req.metadata[0].key, "authorization");
    assert_eq!(req.metadata[0].value, "Bearer xyz");
    assert!(req.message.is_none());
}

#[test]
fn test_grpc_block_timeout_tag() {
    let text = "\
###
# @timeout 5s
GRPC grpc://localhost:50051/hello.Greeter/SayHello

{\"name\":\"world\"}
";
    let file = parse(text).unwrap();
    let req = &file.grpc_requests[0];
    assert_eq!(req.tags.timeout_ms, Some(5000));
}

#[test]
fn test_parse_single_grpc_request() {
    let text = "\
GRPC grpc://localhost:50051/hello.Greeter/SayHello

{\"name\":\"world\"}
";
    let parsed = parse(text).unwrap();
    let req = extract_single_grpc_request(&parsed, 0).unwrap();
    assert_eq!(req.url, "grpc://localhost:50051/hello.Greeter/SayHello");
    assert_eq!(req.package, "hello");
    assert_eq!(req.service, "Greeter");
    assert_eq!(req.method, "SayHello");
    assert_eq!(req.message.as_ref().unwrap().text, "{\"name\":\"world\"}");
}

#[test]
fn test_grpc_and_http_and_ws_mixed() {
    let text = "\
### HTTP
GET https://example.com

### WS
WEBSOCKET ws://localhost:8080/echo
{\"a\":1}

### gRPC
GRPC grpc://localhost:50051/hello.Greeter/SayHello

{\"name\":\"world\"}
";
    let file = parse(text).unwrap();
    assert_eq!(file.requests.len(), 1);
    assert_eq!(file.websocket_requests.len(), 1);
    assert_eq!(file.grpc_requests.len(), 1);
    assert_eq!(file.requests[0].url, "https://example.com");
    assert_eq!(file.websocket_requests[0].url, "ws://localhost:8080/echo");
    assert_eq!(file.grpc_requests[0].url, "grpc://localhost:50051/hello.Greeter/SayHello");
}

#[test]
fn test_grpc_global_variables_and_interpolation() {
    let text = "\
@host = api.example.com
@port = 50051

GRPC grpc://{{host}}:{{port}}/hello.Greeter/SayHello

{\"name\":\"world\"}
";
    let file = parse(text).unwrap();
    assert_eq!(file.global_variables.len(), 2);
    let req = &file.grpc_requests[0];
    assert_eq!(req.url, "grpc://{{host}}:{{port}}/hello.Greeter/SayHello");
    assert_eq!(req.message.as_ref().unwrap().text, "{\"name\":\"world\"}");

    let merged = merge_variables(&HashMap::new(), &file.global_variables, &req.variables);
    let resolved = interpolate_grpc_request(req, &merged).unwrap();
    assert_eq!(resolved.url, "grpc://api.example.com:50051/hello.Greeter/SayHello");
    assert_eq!(resolved.package, "hello");
    assert_eq!(resolved.service, "Greeter");
    assert_eq!(resolved.method, "SayHello");
    assert_eq!(resolved.message.as_ref().unwrap().text, "{\"name\":\"world\"}");
}

#[test]
fn test_grpc_block_var_overrides_global() {
    let text = "\
@host = from-global

###
@host = from-block
GRPC grpc://{{host}}:50051/hello.Greeter/SayHello
";
    let file = parse(text).unwrap();
    let req = &file.grpc_requests[0];
    let merged = merge_variables(&HashMap::new(), &file.global_variables, &req.variables);
    let resolved = interpolate_grpc_request(req, &merged).unwrap();
    assert_eq!(resolved.url, "grpc://from-block:50051/hello.Greeter/SayHello");
}

#[test]
fn test_grpc_invalid_url_errors() {
    let text = "GRPC grpc://host:80/noslash\n";
    let result = parse(text);
    assert!(result.is_err(), "missing /Method should be a parse error");
}

#[test]
fn grpc_block_proto_include_accumulates() {
    let text = "\
### t
# @proto ./protos/a.proto
# @proto-include ./googleapis
# @proto-include ./third_party/proto
GRPC grpcs://x:50051/pkg.Svc/M

{}
";
    let file = parse(text).unwrap();
    let r = &file.grpc_requests[0];
    assert_eq!(r.tags.proto.as_deref(), Some("./protos/a.proto"));
    assert_eq!(
        r.tags.proto_includes,
        vec!["./googleapis".to_string(), "./third_party/proto".to_string()]
    );
}

#[test]
fn grpc_without_block_separator() {
    let text = "GRPC grpc://h:80/a.b/C\n\n{\"x\":1}\n";
    let file = parse(text).unwrap();
    assert_eq!(file.grpc_requests.len(), 1);
    let r = &file.grpc_requests[0];
    assert!(r.name.is_none());
    assert_eq!(r.package, "a");
    assert_eq!(r.service, "b");
    assert_eq!(r.method, "C");
}

#[test]
fn grpc_parse_single_by_line_offset() {
    let text = "\
### a
GRPC grpcs://x:1/pkg.Svc/M1

### b
GRPC grpcs://x:2/pkg.Svc/M2

";
    let parsed = parse(text).unwrap();
    let req = extract_single_grpc_request(&parsed, 6).unwrap();
    assert_eq!(req.method, "M2");
}