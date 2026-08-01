/// 应用名，编译期常量。
pub const APP_NAME: &str = env!("CARGO_PKG_NAME");

/// 应用版本号，编译期常量，编译期从 Cargo.toml 注入版本号。
pub const APP_VERSION: &str = env!("CARGO_PKG_VERSION");

/// User-Agent 字符串，格式 `<app_name>/<version>`，编译期从 Cargo.toml 注入。
pub const USER_AGENT: &str = concat!(env!("CARGO_PKG_NAME"), "/", env!("CARGO_PKG_VERSION"));
