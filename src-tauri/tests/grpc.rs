use apisender_lib::commands::grpc::build_reflection_endpoint;

#[test]
fn resolve_proto_explicit_tag() {
    assert!(build_reflection_endpoint("grpc://localhost:50051/foo").is_some());
    assert!(build_reflection_endpoint("grpcs://example.com:443/foo").is_some());
}
