use crate::transport::grpc as grpc;

use std::path::{Path, PathBuf};

use prost::Message as _;
use prost_reflect::{DescriptorPool, MethodDescriptor};
use prost_types::FileDescriptorSet;
use protox::compile as protox_compile;
use tonic::Status;

use crate::error::{AppError, AppResult};

#[derive(Debug, Clone)]
pub enum ProtoSource {
    ExplicitTag(PathBuf, Vec<PathBuf>),
    WorkspaceScan(Vec<PathBuf>),
    Reflection,
}

#[derive(Debug)]
pub struct LoadedMethod {
    pub pool: DescriptorPool,
    pub method: MethodDescriptor,
    pub source: ProtoSource,
}

pub async fn resolve_method(
    package: &str,
    service: &str,
    method_name: &str,
    proto_path: Option<&str>,
    proto_includes: &[String],
    file_path: Option<&Path>,
    workspace_root: &Path,
    reflection_channel: Option<&ReflectionChannel>,
) -> AppResult<LoadedMethod> {
    let sources = candidate_sources(
        proto_path,
        proto_includes,
        file_path,
        workspace_root,
        reflection_channel,
    );

    let mut last_err: Option<AppError> = None;
    for source in sources {
        match load_from_source(&source, package, service, method_name, reflection_channel).await {
            Ok(loaded) => return Ok(loaded),
            Err(e) => {
                log::warn!(
                    "[grpc] proto source {:?} failed for {}.{}/{}: {}",
                    source, package, service, method_name, e
                );
                last_err = Some(e);
            }
        }
    }

    Err(last_err.unwrap_or_else(|| {
        AppError::Invalid(format!(
            "gRPC service '{}.{}' method '{}' not found (no proto sources succeeded)",
            package, service, method_name
        ))
    }))
}

fn candidate_sources(
    proto_path: Option<&str>,
    proto_includes: &[String],
    file_path: Option<&Path>,
    workspace_root: &Path,
    reflection_channel: Option<&ReflectionChannel>,
) -> Vec<ProtoSource> {
    let mut sources = Vec::new();
    if let Some(p) = proto_path {
        let resolved = resolve_proto_path(p, file_path, workspace_root);
        if let Some(rp) = resolved {
            let resolved_includes: Vec<PathBuf> = proto_includes
                .iter()
                .map(|inc| resolve_include_path(inc, file_path, workspace_root))
                .collect();
            sources.push(ProtoSource::ExplicitTag(rp, resolved_includes));
        }
    }

    if reflection_channel.is_some() {
        sources.push(ProtoSource::Reflection);
    }

    let scanned = scan_workspace_protos(workspace_root);
    if !scanned.is_empty() {
        sources.push(ProtoSource::WorkspaceScan(scanned));
    }

    sources
}

fn resolve_include_path(
    raw: &str,
    file_path: Option<&Path>,
    workspace_root: &Path,
) -> PathBuf {
    let p = Path::new(raw);
    if p.is_absolute() {
        return p.to_path_buf();
    }
    if let Some(fp) = file_path {
        if let Some(parent) = fp.parent() {
            let cand = parent.join(p);
            if cand.exists() {
                return cand;
            }
        }
    }
    workspace_root.join(p)
}

fn resolve_proto_path(
    raw: &str,
    file_path: Option<&Path>,
    workspace_root: &Path,
) -> Option<PathBuf> {
    let p = Path::new(raw);
    if p.is_absolute() {
        return Some(p.to_path_buf());
    }
    if let Some(fp) = file_path {
        if let Some(parent) = fp.parent() {
            let cand = parent.join(p);
            if cand.exists() {
                return Some(cand);
            }
        }
    }
    let ws_cand = workspace_root.join(p);
    if ws_cand.exists() {
        return Some(ws_cand);
    }
    Some(workspace_root.join(p))
}

pub fn scan_workspace_protos(workspace_root: &Path) -> Vec<PathBuf> {
    let mut out = Vec::new();
    let entries = match std::fs::read_dir(workspace_root) {
        Ok(e) => e,
        Err(_) => return out,
    };
    for entry in entries.flatten() {
        let p = entry.path();
        if p.is_file() && p.extension().and_then(|s| s.to_str()) == Some("proto") {
            out.push(p);
        }
    }
    out
}

/// Build include directories for `protox::compile` from a single proto file path.
/// Always includes the file's parent directory, so `import "..."` statements in
/// the file (relative to its location) resolve correctly. Also includes the
/// workspace root and the `protos/` directory shipped with the app for the
/// built-in test proto.
fn derive_include_dirs(p: &Path, user_includes: &[PathBuf]) -> Vec<String> {
    let mut dirs: Vec<PathBuf> = Vec::new();
    if let Some(parent) = p.parent() {
        dirs.push(parent.to_path_buf());
    }
    // Walk up the tree: every ancestor up to (and including) the workspace
    // root, so `import "sub/dir/x.proto"` from anywhere resolves.
    for ancestor in p.ancestors().skip(1) {
        if !dirs.iter().any(|d| d == ancestor) {
            dirs.push(ancestor.to_path_buf());
        }
    }
    // Workspace root (parent of the proto's nearest common ancestor) — heuristic:
    // if the file lives under a `protos/` folder, also add that folder.
    if let Some(parent) = p.parent() {
        if parent.file_name().and_then(|s| s.to_str()) == Some("protos") {
            if !dirs.iter().any(|d| d == parent) {
                dirs.push(parent.to_path_buf());
            }
        }
    }
    for inc in user_includes {
        if !dirs.iter().any(|d| d == inc) {
            dirs.push(inc.clone());
        }
    }
    dirs.into_iter()
        .map(|d| d.to_string_lossy().to_string())
        .collect()
}

/// Build include directories from a set of proto file paths, deduplicating
/// their parent directories (and ancestors).
fn collect_include_dirs(paths: &[PathBuf]) -> Vec<String> {
    let mut seen: std::collections::BTreeSet<PathBuf> = std::collections::BTreeSet::new();
    for p in paths {
        for d in derive_include_dirs(p, &[]).into_iter().map(PathBuf::from) {
            seen.insert(d);
        }
    }
    seen.into_iter()
        .map(|d| d.to_string_lossy().to_string())
        .collect()
}

async fn load_from_source(
    source: &ProtoSource,
    package: &str,
    service: &str,
    method_name: &str,
    reflection_channel: Option<&ReflectionChannel>,
) -> AppResult<LoadedMethod> {
    let (pool, source_label) = match source {
        ProtoSource::ExplicitTag(p, user_includes) => {
            let include_dirs = derive_include_dirs(p, user_includes);
            let fds: FileDescriptorSet = protox_compile(
                &[p.to_string_lossy().to_string()],
                &include_dirs,
            )
            .map_err(|e| {
                AppError::Invalid(format!("Failed to compile {}: {}", p.display(), e))
            })?;
            let mut pool = DescriptorPool::new();
            pool.add_file_descriptor_protos(fds.file.into_iter())
                .map_err(|e| {
                    AppError::Invalid(format!("DescriptorPool from {}: {}", p.display(), e))
                })?;
            (pool, format!("@proto {}", p.display()))
        }
        ProtoSource::WorkspaceScan(paths) => {
            let str_paths: Vec<String> = paths
                .iter()
                .map(|p| p.to_string_lossy().to_string())
                .collect();
            let include_dirs = collect_include_dirs(paths);
            let fds: FileDescriptorSet = protox_compile(&str_paths, &include_dirs)
                .map_err(|e| {
                    AppError::Invalid(format!("Failed to compile workspace .proto files: {}", e))
                })?;
            let mut pool = DescriptorPool::new();
            pool.add_file_descriptor_protos(fds.file.into_iter())
                .map_err(|e| {
                    AppError::Invalid(format!("DescriptorPool from workspace scan: {}", e))
                })?;
            (pool, format!("workspace scan ({})", paths.len()))
        }
        ProtoSource::Reflection => {
            let chan = reflection_channel.ok_or_else(|| {
                AppError::Invalid("reflection requested but no channel provided".to_string())
            })?;
            let full_service = if package.is_empty() {
                service.to_string()
            } else {
                format!("{}.{}", package, service)
            };
            let fds_bytes = chan
                .fetch_file_descriptor_set(&full_service)
                .await
                .map_err(|e| AppError::Invalid(format!("reflection failed: {}", e)))?;

            let fds = FileDescriptorSet::decode(fds_bytes.as_slice())
                .map_err(|e| AppError::Invalid(format!("reflection decode: {}", e)))?;

            let mut pool = DescriptorPool::new();
            pool.add_file_descriptor_protos(fds.file.into_iter())
                .map_err(|e| {
                    AppError::Invalid(format!("DescriptorPool from reflection: {}", e))
                })?;
            (pool, "reflection".to_string())
        }
    };

    let full_service = if package.is_empty() {
        service.to_string()
    } else {
        format!("{}.{}", package, service)
    };

    let svc_desc = pool.get_service_by_name(&full_service).ok_or_else(|| {
        AppError::Invalid(format!(
            "gRPC service '{}' not found in loaded .proto (source: {})",
            full_service, source_label
        ))
    })?;

    let method_desc = svc_desc
        .methods()
        .find(|m| m.name() == method_name)
        .ok_or_else(|| {
            AppError::Invalid(format!(
                "gRPC method '{}.{}/{}' not found (source: {})",
                package, service, method_name, source_label
            ))
        })?
        .clone();

    Ok(LoadedMethod {
        pool,
        method: method_desc,
        source: source.clone(),
    })
}

pub struct ReflectionChannel {
    pub endpoint: tonic::transport::Endpoint,
}

impl ReflectionChannel {
    pub async fn fetch_file_descriptor_set(&self, full_service: &str) -> Result<Vec<u8>, Status> {
        grpc::reflection::fetch_file_descriptor_set(
            self.endpoint.clone(),
            full_service,
        )
        .await
    }
}