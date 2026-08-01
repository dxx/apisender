use std::collections::HashMap;
use std::path::Path;

use serde::{Deserialize, Serialize};

use crate::error::{AppError, AppResult};
use crate::variables::resolve_variable;

pub const SHARED_ENV_NAME: &str = "$shared";

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct EnvironmentFile {
    #[serde(flatten)]
    pub environments: HashMap<String, HashMap<String, serde_json::Value>>,
}

pub fn read_env_file(workspace_root: &str) -> AppResult<EnvironmentFile> {
    let public_path = Path::new(workspace_root).join("env.json");
    let private_path = Path::new(workspace_root).join("env.private.json");

    let public_content = if public_path.exists() {
        std::fs::read_to_string(&public_path)?
    } else {
        "{}".to_string()
    };

    let private_content = if private_path.exists() {
        std::fs::read_to_string(&private_path)?
    } else {
        "{}".to_string()
    };

    let public_envs: HashMap<String, HashMap<String, serde_json::Value>> =
        serde_json::from_str(&public_content).map_err(|e| {
            AppError::Workspace(format!("Failed to parse env.json: {}", e))
        })?;

    let private_envs: HashMap<String, HashMap<String, serde_json::Value>> =
        serde_json::from_str(&private_content).map_err(|e| {
            AppError::Workspace(format!(
                "Failed to parse env.private.json: {}",
                e
            ))
        })?;

    let mut merged = public_envs;
    for (env_name, vars) in private_envs {
        merged
            .entry(env_name)
            .or_insert_with(HashMap::new)
            .extend(vars);
    }

    Ok(EnvironmentFile {
        environments: merged,
    })
}

pub fn list_environment_names(workspace_root: &str) -> AppResult<Vec<String>> {
    let env_file = read_env_file(workspace_root)?;
    let mut names: Vec<String> = env_file
        .environments
        .keys()
        .filter(|k| k.as_str() != SHARED_ENV_NAME)
        .cloned()
        .collect();
    names.sort();
    Ok(names)
}

pub fn get_environment_vars(
    workspace_root: &str,
    env_name: &str,
) -> AppResult<HashMap<String, String>> {
    let env_file = read_env_file(workspace_root)?;
    let shared = env_file
        .environments
        .get(SHARED_ENV_NAME)
        .cloned()
        .unwrap_or_default();
    let specific = env_file
        .environments
        .get(env_name)
        .cloned()
        .unwrap_or_default();

    let mut result = HashMap::new();
    for (k, v) in shared {
        result.insert(k, json_to_string(v));
    }
    for (k, v) in specific {
        result.insert(k, json_to_string(v));
    }

    let resolved = result
        .iter()
        .map(|(k, v)| (k.clone(), resolve_env_only(v, &result)))
        .collect();

    Ok(resolved)
}

fn resolve_env_only(text: &str, variables: &HashMap<String, String>) -> String {
    let mut result = String::new();
    let mut cursor = 0;

    while let Some(start_rel) = text[cursor..].find("{{") {
        let start = cursor + start_rel;
        result.push_str(&text[cursor..start]);

        match text[start + 2..].find("}}") {
            Some(end_rel) => {
                let end = start + 2 + end_rel;
                let var_name = text[start + 2..end].trim();
                if var_name.starts_with("$env") {
                    if let Some(value) = resolve_variable(var_name, variables) {
                        result.push_str(&value);
                    }
                } else {
                    result.push_str(&text[start..end + 2]);
                }
                cursor = end + 2;
            }
            None => {
                result.push_str(&text[start..]);
                return result;
            }
        }
    }
    result.push_str(&text[cursor..]);
    result
}

fn json_to_string(v: serde_json::Value) -> String {
    match v {
        serde_json::Value::String(s) => s,
        other => other.to_string(),
    }
}

pub fn save_env_file(workspace_root: &str, content: &str) -> AppResult<()> {
    let path = Path::new(workspace_root).join("env.json");
    std::fs::write(&path, content)?;
    Ok(())
}