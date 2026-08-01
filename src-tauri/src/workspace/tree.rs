use serde::{Deserialize, Serialize};
use std::path::Path;

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(tag = "type", rename_all = "lowercase")]
pub enum FileTreeNode {
    Dir {
        name: String,
        path: String,
        children: Vec<FileTreeNode>,
    },
    File {
        name: String,
        path: String,
    },
}

/// Returns `true` for files apisender should surface in the workspace tree.
pub fn is_workspace_file(path: &Path) -> bool {
    if let Some(ext) = path.extension() {
        let ext = ext.to_ascii_lowercase();
        return ext == "http" || ext == "rest" || ext == "json" || ext == "proto";
    }
    false
}

pub fn should_ignore(name: &str) -> bool {
    matches!(
        name,
        ".git" | "node_modules" | ".idea" | ".vscode" | "target" | "dist" | ".apisender" | "__pycache__"
    )
}

pub fn read_tree(root: &Path) -> std::io::Result<Vec<FileTreeNode>> {
    let mut nodes: Vec<FileTreeNode> = Vec::new();

    let entries = std::fs::read_dir(root)?;
    let mut entries: Vec<_> = entries.filter_map(|e| e.ok()).collect();
    entries.sort_by(|a, b| {
        let a_name = a.file_name();
        let b_name = b.file_name();
        a_name.cmp(&b_name)
    });

    for entry in entries {
        let name = entry.file_name().to_string_lossy().to_string();
        if should_ignore(&name) || name.starts_with('.') {
            continue;
        }

        let path = entry.path();
        let path_str = path.to_string_lossy().to_string();

        let file_type = match entry.file_type() {
            Ok(t) => t,
            Err(_) => continue,
        };

        if file_type.is_dir() {
            let children = read_tree(&path).unwrap_or_default();
            nodes.push(FileTreeNode::Dir {
                name,
                path: path_str,
                children,
            });
        } else if file_type.is_file() && is_workspace_file(&path) {
            nodes.push(FileTreeNode::File {
                name,
                path: path_str,
            });
        }
    }

    nodes.sort_by(|a, b| match (a, b) {
        (FileTreeNode::Dir { .. }, FileTreeNode::File { .. }) => std::cmp::Ordering::Less,
        (FileTreeNode::File { .. }, FileTreeNode::Dir { .. }) => std::cmp::Ordering::Greater,
        (FileTreeNode::Dir { name: a, .. }, FileTreeNode::Dir { name: b, .. }) => a.cmp(b),
        (FileTreeNode::File { name: a, .. }, FileTreeNode::File { name: b, .. }) => a.cmp(b),
    });

    Ok(nodes)
}

pub fn normalize_path(path: &str) -> std::io::Result<std::path::PathBuf> {
    let p = Path::new(path);
    Ok(p.to_path_buf())
}
