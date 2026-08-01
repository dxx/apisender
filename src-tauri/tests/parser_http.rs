use std::collections::HashMap;

use apisender_lib::parser::{parse, extract_single_request, HttpMethod, RequestBody};
use apisender_lib::parser::types::MultipartContent;
use apisender_lib::variables::interpolator::{interpolate, merge_variables};

#[test]
fn test_simple_get() {
    let text = "GET https://example.com/api/users\n";
    let file = parse(text).unwrap();
    assert_eq!(file.requests.len(), 1);
    assert_eq!(file.requests[0].method, HttpMethod::Get);
    assert_eq!(file.requests[0].url, "https://example.com/api/users");
}

#[test]
fn test_short_get() {
    let text = "https://example.com/\n";
    let file = parse(text).unwrap();
    assert_eq!(file.requests.len(), 1);
    assert_eq!(file.requests[0].method, HttpMethod::Get);
}

#[test]
fn test_multiple_requests() {
    let text = "### Get Users\nGET https://example.com/users\n###\n### Create User\nPOST https://example.com/users\n";
    let file = parse(text).unwrap();
    assert_eq!(file.requests.len(), 2);
    assert_eq!(file.requests[0].name.as_deref(), Some("Get Users"));
    assert_eq!(file.requests[1].name.as_deref(), Some("Create User"));
}

#[test]
fn test_headers_and_body() {
    let text = "POST https://example.com/api\nContent-Type: application/json\nAuthorization: Bearer token\n\n{\"key\": \"value\"}\n";
    let file = parse(text).unwrap();
    let req = &file.requests[0];
    assert_eq!(req.headers.len(), 2);
    assert_eq!(req.headers[0].key, "Content-Type");
    match &req.body {
        RequestBody::Text(t) => assert_eq!(t, "{\"key\": \"value\"}"),
        _ => panic!("Expected text body"),
    }
}

#[test]
fn test_tags() {
    let text = "### Test\n# @no-redirect\n# @timeout 500 ms\nGET https://example.com\n";
    let file = parse(text).unwrap();
    let req = &file.requests[0];
    assert!(req.tags.no_redirect);
    assert_eq!(req.tags.timeout_ms, Some(500));
}

#[test]
fn test_inplace_variable() {
    let text = "@host = example.com\nGET https://{{host}}/api\n";
    let file = parse(text).unwrap();
    assert_eq!(file.global_variables.len(), 1);
    assert_eq!(file.global_variables[0].0, "host");
    assert_eq!(file.global_variables[0].1, "example.com");
}

#[test]
fn test_continued_url() {
    let text = "GET https://example.com\n  /api\n  /users\n  ?id=123\n";
    let file = parse(text).unwrap();
    assert_eq!(file.requests[0].url, "https://example.com/api/users?id=123");
}

#[test]
fn test_url_with_spaces() {
    let text = "### GET request to example server\nGET https://examples.http-client.intellij.net/get?generated-in=IntelliJ IDEA\n";
    let file = parse(text).unwrap();
    assert_eq!(file.requests[0].url, "https://examples.http-client.intellij.net/get?generated-in=IntelliJ IDEA");
}

#[test]
fn test_url_with_spaces_and_http_version() {
    let text = "GET https://example.com/api?msg=hello world HTTP/1.1\n";
    let file = parse(text).unwrap();
    assert_eq!(file.requests[0].url, "https://example.com/api?msg=hello world");
    assert_eq!(file.requests[0].http_version.as_deref(), Some("HTTP/1.1"));
}

#[test]
fn test_bare_url_with_spaces() {
    let text = "https://example.com/api?msg=hello world\n";
    let file = parse(text).unwrap();
    assert_eq!(file.requests[0].method, HttpMethod::Get);
    assert_eq!(file.requests[0].url, "https://example.com/api?msg=hello world");
}

#[test]
fn test_post_block_after_double_blank() {
    let text = "### haha\nGET http://www.baidu.com\nContent-Type: application:json\n\n\n### haha\n\nGET http://www.baidu.com\nContent-Type: application:json\n\n###\nPOST https://httpbin.org/post\nContent-Type: application/json\n\n{\n  \"name\": \"你好\"\n}\n\n###\n";
    let file = parse(text).unwrap();
    for (idx, r) in file.requests.iter().enumerate() {
        eprintln!("req[{}] line_start={} line_end={} url={}", idx, r.line_start, r.line_end, r.url);
    }

    let r_post = extract_single_request(&file, 11);
    eprintln!("line_offset=11 -> {:?}", r_post.as_ref().map(|r| (r.url.as_str(), r.line_start, r.line_end)));

    let r_8 = extract_single_request(&file, 8);
    eprintln!("line_offset=8 -> {:?}", r_8.as_ref().map(|r| (r.url.as_str(), r.line_start, r.line_end)));
}

#[test]
fn test_line_range_three_blocks() {
    let text = "### a\nGET https://a.com\n\n### b\nPOST https://b.com\nContent-Type: application/json\n\n{\"a\":1}\n\n### c\nGET https://c.com\n";
    let file = parse(text).unwrap();
    assert_eq!(file.requests.len(), 3);
    assert_eq!(file.requests[0].line_start, 0);
    assert_eq!(file.requests[0].line_end, 3);
    assert_eq!(file.requests[1].line_start, 3);
    assert_eq!(file.requests[1].line_end, 8);
    assert_eq!(file.requests[2].line_start, 9);
    assert_eq!(file.requests[2].line_end, 11);

    let r0 = extract_single_request(&file, 1).unwrap();
    assert_eq!(r0.url, "https://a.com");
    let r1 = extract_single_request(&file, 5).unwrap();
    assert_eq!(r1.url, "https://b.com");
    let r2 = extract_single_request(&file, 10).unwrap();
    assert_eq!(r2.url, "https://c.com");
}

#[test]
fn test_body_no_trailing_newline() {
    let text =
        "POST https://example.com\nContent-Type: application/json\n\n{\"a\":1}\n\n\n\n";
    let file = parse(text).unwrap();
    match &file.requests[0].body {
        RequestBody::Text(t) => {
            assert_eq!(t, "{\"a\":1}");
        }
        _ => panic!("Expected text body"),
    }
}

#[test]
fn test_body_stops_at_blank_line() {
    let text = "POST https://example.com\nContent-Type: application/json\n\n{\"a\":1}\n\n### next\nGET https://example.com\n";
    let file = parse(text).unwrap();
    assert_eq!(file.requests.len(), 2);
    match &file.requests[0].body {
        RequestBody::Text(t) => assert_eq!(t, "{\"a\":1}"),
        _ => panic!("Expected text body"),
    }
}

#[test]
fn test_inplace_variable_in_block() {
    let text = "### haha\n@aa = baidu\nGET https://www.{{aa}}.com\n";
    let file = parse(text).unwrap();
    assert_eq!(file.requests.len(), 1);
    assert_eq!(file.requests[0].method, HttpMethod::Get);
    assert_eq!(file.requests[0].url, "https://www.{{aa}}.com");
    assert!(file.global_variables.is_empty());
    assert!(file.requests[0]
        .variables
        .iter()
        .any(|(k, v)| k == "aa" && v == "baidu"));
}

#[test]
fn test_inplace_variable_at_file_top() {
    let text = "@host = api.example.com\n\n### a\nGET https://{{host}}/users\n### b\nPOST https://{{host}}/orders\n";
    let file = parse(text).unwrap();
    assert_eq!(file.requests.len(), 2);
    assert!(file
        .global_variables
        .iter()
        .any(|(k, v)| k == "host" && v == "api.example.com"));
    assert_eq!(file.requests[0].url, "https://{{host}}/users");
    assert_eq!(file.requests[1].url, "https://{{host}}/orders");
    assert!(file.requests[0].variables.is_empty());
    assert!(file.requests[1].variables.is_empty());
}

#[test]
fn test_variable_priority_block_over_global() {
    let text = "@host = api.example.com\n\n### a\n@host = override.example.com\nGET https://{{host}}/users\n";
    let file = parse(text).unwrap();
    assert_eq!(file.requests.len(), 1);
    assert!(file
        .global_variables
        .iter()
        .any(|(k, v)| k == "host" && v == "api.example.com"));
    assert!(file.requests[0]
        .variables
        .iter()
        .any(|(k, v)| k == "host" && v == "override.example.com"));

    let mut env_vars = HashMap::new();
    env_vars.insert("host".to_string(), "env.example.com".to_string());
    let merged = merge_variables(
        &env_vars,
        &file.global_variables,
        &file.requests[0].variables,
    );
    assert_eq!(merged.get("host"), Some(&"override.example.com".to_string()));
}

#[test]
fn test_env_variable() {
    unsafe {
        std::env::set_var("APISEND_TEST_ENV", "hello");
    }
    let vars: HashMap<String, String> = HashMap::new();
    let result = interpolate("token={{$env APISEND_TEST_ENV}}", &vars);
    assert_eq!(result, "token=hello");
}

#[test]
fn test_env_variable_with_default() {
    let vars = HashMap::new();
    let result = interpolate(
        "token={{$env APISEND_TEST_UNSET_KEY:-fallback}}",
        &vars,
    );
    assert_eq!(result, "token=fallback");
}

#[test]
fn test_env_variable_unset_no_default() {
    let vars = HashMap::new();
    let result = interpolate(
        "token={{$env APISEND_TEST_DEFINITELY_UNSET_XYZ}}",
        &vars,
    );
    assert_eq!(result, "token=");
}

#[test]
fn test_multipart_with_file_reference() {
    let text = "### 图片上传\nPOST https://example.com/upload\nContent-Type: multipart/form-data; boundary=----WebKitFormBoundaryakDtw6GLACe3uOS4\n\n------WebKitFormBoundaryakDtw6GLACe3uOS4\nContent-Disposition: form-data; name=\"file\"; filename=\"windows.png\"\nContent-Type: image/png\n\n< /Users/dxx/Desktop/windows.png\n------WebKitFormBoundaryakDtw6GLACe3uOS4--\n";
    let file = parse(text).unwrap();
    let req = &file.requests[0];
    match &req.body {
        RequestBody::Multipart(parts) => {
            assert_eq!(parts.len(), 1);
            let p = &parts[0];
            assert_eq!(p.name, "file");
            assert_eq!(p.filename.as_deref(), Some("windows.png"));
            assert_eq!(p.content_type.as_deref(), Some("image/png"));
            match &p.content {
                MultipartContent::File(path) => {
                    assert_eq!(path, "/Users/dxx/Desktop/windows.png");
                }
                _ => panic!("Expected file content, got {:?}", p.content),
            }
        }
        _ => panic!("Expected multipart body, got {:?}", req.body),
    }
}

// 测 workspace::tree 模块的 FileTreeNode 序列化（不属于 HTTP 解析，放这里方便维护）
#[test]
fn test_file_tree_node_serde_lowercase() {
    let dir = apisender_lib::workspace::tree::FileTreeNode::Dir {
        name: "docs".to_string(),
        path: "/tmp/docs".to_string(),
        children: vec![],
    };
    let json = serde_json::to_string(&dir).unwrap();
    assert!(json.contains("\"type\":\"dir\""), "expected lowercase 'dir' in: {}", json);

    let file = apisender_lib::workspace::tree::FileTreeNode::File {
        name: "a.http".to_string(),
        path: "/tmp/a.http".to_string(),
    };
    let json = serde_json::to_string(&file).unwrap();
    assert!(json.contains("\"type\":\"file\""), "expected lowercase 'file' in: {}", json);
}