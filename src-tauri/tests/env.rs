use apisender_lib::variables::get_system_env;

#[test]
fn test_system_env_is_cached() {
    let a = get_system_env();
    let b = get_system_env();
    assert!(std::ptr::eq(a, b), "get_system_env should return cached reference");
}

#[test]
fn test_system_env_returns_hashmap() {
    // 不强断言内容：Windows 无 Git Bash 时返回空，Unix 走 shell source。
    // 仅验证调用成功且返回的是 'static 引用（OnceLock 语义）。
    let env: &std::collections::HashMap<String, String> = get_system_env();
    let _ = env.len();
}
