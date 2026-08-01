use std::fs;

use apisender_lib::workspace::env_file::{
    get_environment_vars, list_environment_names, read_env_file, SHARED_ENV_NAME,
};

fn write_env(dir: &std::path::Path, name: &str, json: &str) {
    fs::write(dir.join(name), json).unwrap();
}

#[test]
fn test_list_excludes_shared() {
    let dir = tempdir();
    write_env(
        &dir,
        "env.json",
        r#"{
            "$shared": { "host": "api.com" },
            "dev": { "base": "dev.com" },
            "prod": { "base": "prod.com" }
        }"#,
    );
    let names = list_environment_names(dir.to_str().unwrap()).unwrap();
    assert_eq!(names, vec!["dev".to_string(), "prod".to_string()]);
    assert!(!names.contains(&SHARED_ENV_NAME.to_string()));
}

#[test]
fn test_merge_overrides_shared() {
    let dir = tempdir();
    write_env(
        &dir,
        "env.json",
        r#"{
            "$shared": { "host": "shared.com", "token": "sh-token" },
            "dev":     { "host": "dev.com" }
        }"#,
    );
    let vars = get_environment_vars(dir.to_str().unwrap(), "dev").unwrap();
    assert_eq!(vars.get("host").unwrap(), "dev.com");
    assert_eq!(vars.get("token").unwrap(), "sh-token");
}

#[test]
fn test_merge_no_shared_backward_compat() {
    let dir = tempdir();
    write_env(
        &dir,
        "env.json",
        r#"{ "dev": { "host": "dev.com", "port": "8080" } }"#,
    );
    let vars = get_environment_vars(dir.to_str().unwrap(), "dev").unwrap();
    assert_eq!(vars.get("host").unwrap(), "dev.com");
    assert_eq!(vars.get("port").unwrap(), "8080");
    assert_eq!(vars.len(), 2);
}

#[test]
fn test_chain_ref_across_shared_stays_raw() {
    let dir = tempdir();
    write_env(
        &dir,
        "env.json",
        r#"{
            "$shared": { "base": "api.com" },
            "dev":     { "endpoint": "https://{{base}}/dev" }
        }"#,
    );
    let vars = get_environment_vars(dir.to_str().unwrap(), "dev").unwrap();
    assert_eq!(vars.get("endpoint").unwrap(), "https://{{base}}/dev");
    assert_eq!(vars.get("base").unwrap(), "api.com");
}

#[test]
fn test_private_overrides_public_shared() {
    let dir = tempdir();
    write_env(
        &dir,
        "env.json",
        r#"{ "$shared": { "token": "public" }, "dev": { "host": "x" } }"#,
    );
    write_env(
        &dir,
        "env.private.json",
        r#"{ "$shared": { "token": "private" } }"#,
    );
    let vars = get_environment_vars(dir.to_str().unwrap(), "dev").unwrap();
    assert_eq!(vars.get("token").unwrap(), "private");
}

#[test]
fn test_nonexistent_env_returns_only_shared() {
    let dir = tempdir();
    write_env(
        &dir,
        "env.json",
        r#"{
            "$shared": { "host": "shared.com" },
            "dev":     { "host": "dev.com" }
        }"#,
    );
    let vars = get_environment_vars(dir.to_str().unwrap(), "nonexistent").unwrap();
    assert_eq!(vars.get("host").unwrap(), "shared.com");
    assert_eq!(vars.len(), 1);
}

#[test]
fn test_read_env_file_still_includes_shared() {
    let dir = tempdir();
    write_env(
        &dir,
        "env.json",
        r#"{ "$shared": { "x": "1" }, "dev": { "y": "2" } }"#,
    );
    let file = read_env_file(dir.to_str().unwrap()).unwrap();
    assert!(file.environments.contains_key("$shared"));
    assert!(file.environments.contains_key("dev"));
}

#[test]
fn test_env_var_reference_resolved() {
    unsafe {
        std::env::set_var("APISEND_TEST_ENV_FILE_KEY", "env-value");
    }
    let dir = tempdir();
    write_env(
        &dir,
        "env.json",
        r#"{ "dev": { "token": "{{$env APISEND_TEST_ENV_FILE_KEY}}" } }"#,
    );
    let vars = get_environment_vars(dir.to_str().unwrap(), "dev").unwrap();
    assert_eq!(vars.get("token").unwrap(), "env-value");
}

#[test]
fn test_env_var_reference_with_default_resolved() {
    unsafe {
        std::env::remove_var("APISEND_TEST_ENV_FILE_UNSET_XYZ");
    }
    let dir = tempdir();
    write_env(
        &dir,
        "env.json",
        r#"{ "dev": { "token": "{{$env APISEND_TEST_ENV_FILE_UNSET_XYZ:-fallback}}" } }"#,
    );
    let vars = get_environment_vars(dir.to_str().unwrap(), "dev").unwrap();
    assert_eq!(vars.get("token").unwrap(), "fallback");
}

#[test]
fn test_env_var_reference_unset_no_default_strips() {
    unsafe {
        std::env::remove_var("APISEND_TEST_ENV_FILE_DEFINITELY_UNSET");
    }
    let dir = tempdir();
    write_env(
        &dir,
        "env.json",
        r#"{ "dev": { "token": "prefix-{{$env APISEND_TEST_ENV_FILE_DEFINITELY_UNSET}}-suffix" } }"#,
    );
    let vars = get_environment_vars(dir.to_str().unwrap(), "dev").unwrap();
    assert_eq!(vars.get("token").unwrap(), "prefix--suffix");
}

#[test]
fn test_plain_var_reference_stays_raw_in_env() {
    let dir = tempdir();
    write_env(
        &dir,
        "env.json",
        r#"{ "$shared": { "base": "api.com" }, "dev": { "url": "https://{{base}}/x" } }"#,
    );
    let vars = get_environment_vars(dir.to_str().unwrap(), "dev").unwrap();
    assert_eq!(vars.get("url").unwrap(), "https://{{base}}/x");
    assert_eq!(vars.get("base").unwrap(), "api.com");
}

fn tempdir() -> std::path::PathBuf {
    let dir = std::env::temp_dir().join(format!(
        "apisender_test_{}",
        std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .unwrap()
            .as_nanos()
    ));
    fs::create_dir_all(&dir).unwrap();
    dir
}