use std::ffi::OsString;
use std::fs;
use std::path::{Component, Path, PathBuf};
use std::process::{Command, Output};
use std::sync::Arc;
use std::sync::atomic::{AtomicBool, Ordering};

use serde::{Deserialize, Serialize};

const MINIMUM_GIT_VERSION: (u32, u32) = (2, 28);
const DIFF_OUTPUT_LIMIT: usize = 1024 * 1024;
const DEFAULT_OUTPUT_LIMIT: usize = 10 * 1024 * 1024;
const DEFAULT_IGNORE_RULES: [&str; 3] = ["env.private.json", ".apisender/", ".DS_Store"];

pub type GitResult<T> = Result<T, GitErrorPayload>;

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum GitErrorCode {
    GitNotInstalled,
    GitVersionTooOld,
    NotRepository,
    TargetNotEmpty,
    RemoteMissing,
    RemoteNotEmpty,
    RemoteAlreadyExists,
    UpstreamMissing,
    IdentityMissing,
    AuthenticationFailed,
    NonFastForward,
    Conflict,
    OperationBusy,
    OutputTooLarge,
    InvalidPath,
    InvalidBranch,
    CommandFailed,
    Io,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct GitErrorPayload {
    pub code: GitErrorCode,
    pub message: String,
    pub details: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct GitAvailability {
    pub available: bool,
    pub supported: bool,
    pub version: Option<String>,
    pub executable: Option<String>,
    pub minimum_version: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct GitRepositoryState {
    pub workspace_root: String,
    pub repository_root: String,
    pub branch: Option<String>,
    pub detached: bool,
    pub upstream: Option<String>,
    pub ahead: u32,
    pub behind: u32,
    pub remotes: Vec<String>,
    pub files: Vec<GitFileStatus>,
    pub has_conflicts: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct GitFileStatus {
    pub path: String,
    pub original_path: Option<String>,
    pub index_status: Option<String>,
    pub worktree_status: Option<String>,
    pub conflict: bool,
    pub untracked: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct GitBranch {
    pub name: String,
    pub current: bool,
    pub remote: bool,
    pub upstream: Option<String>,
    pub ahead: u32,
    pub behind: u32,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct GitCommit {
    pub sha: String,
    pub short_sha: String,
    pub author_name: String,
    pub author_email: String,
    pub authored_at: String,
    pub subject: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct GitCommitDetail {
    pub commit: GitCommit,
    pub files: Vec<String>,
    pub diff: GitDiff,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct GitDiff {
    pub content: String,
    pub binary: bool,
    pub truncated: bool,
    pub output_too_large: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct GitIdentity {
    pub name: Option<String>,
    pub email: Option<String>,
}

#[derive(Clone, Default)]
pub struct GitOperationState {
    busy: Arc<AtomicBool>,
}

#[derive(Debug)]
pub struct GitOperationGuard {
    busy: Arc<AtomicBool>,
}

impl GitOperationState {
    /// 尝试取得 Git 写操作互斥权。
    /// 入参：无。
    /// 出参：成功时返回负责释放状态的 guard，占用时返回 operation_busy。
    /// 作用与流程：通过原子 compare_exchange 保证提交、推拉和切分支不会并发执行。
    pub fn try_begin(&self) -> GitResult<GitOperationGuard> {
        self.busy
            .compare_exchange(false, true, Ordering::AcqRel, Ordering::Acquire)
            .map_err(|_| {
                error(
                    GitErrorCode::OperationBusy,
                    "另一个 Git 写操作正在进行，请稍后再试",
                    None,
                )
            })?;
        Ok(GitOperationGuard {
            busy: Arc::clone(&self.busy),
        })
    }
}

impl Drop for GitOperationGuard {
    /// 释放 Git 写操作互斥权。
    /// 入参：当前 guard 的可变引用。
    /// 出参：无。
    /// 作用与流程：guard 离开作用域时清空 busy 标记，让下一个写操作继续。
    fn drop(&mut self) {
        self.busy.store(false, Ordering::Release);
    }
}

/// 创建结构化 Git 错误。
/// 入参：错误码、用户可读消息和可选详情。
/// 出参：可由 Tauri 序列化的错误载荷。
/// 作用与流程：统一构造错误对象并对详情执行凭据脱敏。
fn error(
    code: GitErrorCode,
    message: impl Into<String>,
    details: Option<String>,
) -> GitErrorPayload {
    GitErrorPayload {
        code,
        message: message.into(),
        details: details.map(|value| redact_secrets(&value)),
    }
}

/// 对命令输出中的 URL 凭据做脱敏。
/// 入参：可能包含 HTTP 或 HTTPS 凭据的文本。
/// 出参：用户名、密码或令牌被替换后的文本。
/// 作用与流程：扫描 URL authority 和常见令牌查询参数，以 *** 代替 userinfo 或令牌值。
pub fn redact_secrets(input: &str) -> String {
    let mut result = input.to_string();
    for scheme in ["https://", "http://"] {
        let mut search_from = 0;
        loop {
            let Some(relative_start) = result[search_from..].find(scheme) else {
                break;
            };
            let authority_start = search_from + relative_start + scheme.len();
            let authority_end = result[authority_start..]
                .find(['/', ' ', '\n', '\r', '\t'])
                .map(|offset| authority_start + offset)
                .unwrap_or(result.len());
            let authority = &result[authority_start..authority_end];
            if let Some(at_offset) = authority.rfind('@') {
                let credentials_end = authority_start + at_offset + 1;
                result.replace_range(authority_start..credentials_end, "***@");
                search_from = authority_start + 4;
            } else {
                search_from = authority_end;
            }
        }
    }

    for key in [
        "access_token=",
        "private_token=",
        "oauth_token=",
        "auth_token=",
        "api_key=",
        "apikey=",
        "token=",
    ] {
        let mut search_from = 0;
        loop {
            let lower = result.to_ascii_lowercase();
            let Some(relative_start) = lower[search_from..].find(key) else {
                break;
            };
            let key_start = search_from + relative_start;
            let valid_separator =
                key_start > 0 && matches!(result.as_bytes()[key_start - 1], b'?' | b'&');
            if !valid_separator {
                search_from = key_start + key.len();
                continue;
            }
            let value_start = key_start + key.len();
            let value_end = result[value_start..]
                .find(['&', '#', ' ', '\n', '\r', '\t', '\'', '"'])
                .map(|offset| value_start + offset)
                .unwrap_or(result.len());
            result.replace_range(value_start..value_end, "***");
            search_from = value_start + 3;
        }
    }
    result
}

/// 解析 Git 版本号。
/// 入参：`git --version` 的标准输出。
/// 出参：主版本、次版本和完整版本字符串。
/// 作用与流程：提取第一个数字版本片段，并兼容 Apple Git 等带后缀格式。
fn parse_version(text: &str) -> Option<(u32, u32, String)> {
    let version = text.split_whitespace().find(|part| {
        part.chars()
            .next()
            .is_some_and(|value| value.is_ascii_digit())
    })?;
    let mut parts = version.split('.');
    let major = parts.next()?.parse().ok()?;
    let minor = parts.next()?.parse().ok()?;
    Some((major, minor, version.to_string()))
}

/// 探测系统 Git 是否可用且满足最低版本。
/// 入参：无。
/// 出参：Git 可用性、版本、可执行文件和最低版本信息。
/// 作用与流程：执行 `git --version`，区分未安装、版本过低和可用三种状态。
pub fn probe() -> GitAvailability {
    let minimum_version = format!("{}.{}", MINIMUM_GIT_VERSION.0, MINIMUM_GIT_VERSION.1);
    match Command::new("git").arg("--version").output() {
        Ok(output) if output.status.success() => {
            let text = String::from_utf8_lossy(&output.stdout);
            let parsed = parse_version(&text);
            let supported = parsed
                .as_ref()
                .is_some_and(|(major, minor, _)| (*major, *minor) >= MINIMUM_GIT_VERSION);
            GitAvailability {
                available: true,
                supported,
                version: parsed.map(|(_, _, version)| version),
                executable: Some("git".to_string()),
                minimum_version,
            }
        }
        _ => GitAvailability {
            available: false,
            supported: false,
            version: None,
            executable: None,
            minimum_version,
        },
    }
}

/// 校验 Git 可用性。
/// 入参：无。
/// 出参：可用时返回空值，否则返回结构化版本或安装错误。
/// 作用与流程：复用探测结果，在每次仓库操作前建立统一的运行环境边界。
fn ensure_git_available() -> GitResult<()> {
    let availability = probe();
    if !availability.available {
        return Err(error(
            GitErrorCode::GitNotInstalled,
            "未检测到系统 Git，请先安装 Git",
            None,
        ));
    }
    if !availability.supported {
        return Err(error(
            GitErrorCode::GitVersionTooOld,
            format!(
                "Git 版本过低，需要 {} 或更高版本",
                availability.minimum_version
            ),
            availability.version,
        ));
    }
    Ok(())
}

/// 根据 stderr 分类 Git 命令错误。
/// 入参：Git stderr 文本。
/// 出参：稳定错误码。
/// 作用与流程：按身份、认证、upstream、非快进、冲突等已知特征映射错误，其余归入命令失败。
fn classify_command_error(stderr: &str) -> GitErrorCode {
    let lower = stderr.to_ascii_lowercase();
    if lower.contains("please tell me who you are")
        || lower.contains("unable to auto-detect email address")
    {
        GitErrorCode::IdentityMissing
    } else if lower.contains("authentication failed")
        || lower.contains("permission denied")
        || lower.contains("could not read username")
        || lower.contains("repository not found")
    {
        GitErrorCode::AuthenticationFailed
    } else if lower.contains("no tracking information")
        || lower.contains("has no upstream branch")
        || lower.contains("no configured push destination")
    {
        GitErrorCode::UpstreamMissing
    } else if lower.contains("does not appear to be a git repository")
        || lower.contains("no such remote")
        || (lower.contains("repository") && lower.contains("does not exist"))
    {
        GitErrorCode::RemoteMissing
    } else if lower.contains("not possible to fast-forward")
        || lower.contains("non-fast-forward")
        || lower.contains("fetch first")
    {
        GitErrorCode::NonFastForward
    } else if lower.contains("would be overwritten")
        || lower.contains("you need to resolve your current index first")
        || lower.contains("conflict")
    {
        GitErrorCode::Conflict
    } else if lower.contains("not a git repository") {
        GitErrorCode::NotRepository
    } else {
        GitErrorCode::CommandFailed
    }
}

/// 执行系统 Git 命令并验证退出状态。
/// 入参：工作目录、参数列表和是否允许退出码 1。
/// 出参：完整进程输出。
/// 作用与流程：禁用不可见终端提示，通过参数数组启动 Git，并把失败转换为脱敏结构化错误。
fn execute_git(cwd: &Path, args: &[OsString], allow_exit_one: bool) -> GitResult<Output> {
    ensure_git_available()?;
    let output = Command::new("git")
        .current_dir(cwd)
        .env("GIT_TERMINAL_PROMPT", "0")
        .env("LC_ALL", "C")
        .env("LANG", "C")
        .args(args)
        .output()
        .map_err(|cause| error(GitErrorCode::Io, "无法启动 Git", Some(cause.to_string())))?;

    if output.status.success() || (allow_exit_one && output.status.code() == Some(1)) {
        return Ok(output);
    }

    let stderr = redact_secrets(&String::from_utf8_lossy(&output.stderr));
    Err(error(
        classify_command_error(&stderr),
        "Git 操作失败",
        Some(stderr.trim().to_string()),
    ))
}

/// 执行受 10 MiB 限制的普通 Git 命令。
/// 入参：工作目录、参数列表和是否允许退出码 1。
/// 出参：不超过普通命令上限的完整进程输出。
/// 作用与流程：复用统一执行与错误分类，再拒绝过大的 stdout/stderr，避免把无界日志传给上层。
fn run_git(cwd: &Path, args: &[OsString], allow_exit_one: bool) -> GitResult<Output> {
    let output = execute_git(cwd, args, allow_exit_one)?;
    if output.stdout.len().saturating_add(output.stderr.len()) > DEFAULT_OUTPUT_LIMIT {
        return Err(error(
            GitErrorCode::OutputTooLarge,
            "Git 命令输出超过 10 MiB 限制",
            None,
        ));
    }
    Ok(output)
}

/// 执行由差异载荷自行截断的 Git 命令。
/// 入参：工作目录、diff/show 参数和是否允许退出码 1。
/// 出参：用于计算 truncated 与 outputTooLarge 状态的原始输出。
/// 作用与流程：仅复用退出状态和脱敏错误处理，调用方必须在返回 IPC 前限制为 1 MiB。
fn run_git_diff_output(cwd: &Path, args: &[OsString], allow_exit_one: bool) -> GitResult<Output> {
    execute_git(cwd, args, allow_exit_one)
}

/// 把字符串切片转换为 Git 参数列表。
/// 入参：字符串参数切片。
/// 出参：可安全传递给 Command 的 OsString 列表。
/// 作用与流程：逐项转换参数，保证调用方不经过 shell 拼接。
fn args(values: &[&str]) -> Vec<OsString> {
    values.iter().map(OsString::from).collect()
}

/// 解析当前工作区对应的 Git 仓库根目录。
/// 入参：当前 apisender 工作区路径。
/// 出参：规范化后的父级或当前 Git 仓库根目录。
/// 作用与流程：调用 `rev-parse --show-toplevel`，从而支持打开仓库子目录的场景。
pub fn resolve_repository_root(workspace_root: &Path) -> GitResult<PathBuf> {
    let output = run_git(
        workspace_root,
        &args(&["rev-parse", "--show-toplevel"]),
        false,
    )?;
    let raw = String::from_utf8_lossy(&output.stdout).trim().to_string();
    if raw.is_empty() {
        return Err(error(
            GitErrorCode::NotRepository,
            "当前工作区不在 Git 仓库中",
            None,
        ));
    }
    fs::canonicalize(raw).map_err(|cause| {
        error(
            GitErrorCode::Io,
            "无法解析仓库根目录",
            Some(cause.to_string()),
        )
    })
}

/// 解析当前工作区对应的 Git 管理目录。
/// 入参：当前 apisender 工作区路径。
/// 出参：规范化后的实际 Git 管理目录。
/// 作用与流程：调用 `rev-parse --absolute-git-dir`，兼容普通仓库和 linked worktree 的外部管理目录。
pub fn resolve_git_dir(workspace_root: &Path) -> GitResult<PathBuf> {
    let output = run_git(
        workspace_root,
        &args(&["rev-parse", "--absolute-git-dir"]),
        false,
    )?;
    let raw = String::from_utf8_lossy(&output.stdout).trim().to_string();
    fs::canonicalize(raw).map_err(|cause| {
        error(
            GitErrorCode::Io,
            "无法解析 Git 管理目录",
            Some(cause.to_string()),
        )
    })
}

/// 将状态字符转换为可选字符串。
/// 入参：Git XY 状态中的单个字符。
/// 出参：点号和空格返回空值，其余返回字符文本。
/// 作用与流程：统一 index 与 worktree 状态的空值表达。
fn status_code(value: char) -> Option<String> {
    (!matches!(value, '.' | ' ')).then(|| value.to_string())
}

/// 解析 porcelain v2 的 XY 状态。
/// 入参：两个字符的 XY 状态文本。
/// 出参：index 状态和 worktree 状态。
/// 作用与流程：分别读取前两个字符并转换为空值或状态码。
fn parse_xy(value: &str) -> (Option<String>, Option<String>) {
    let mut chars = value.chars();
    (
        chars.next().and_then(status_code),
        chars.next().and_then(status_code),
    )
}

/// 解析 Git porcelain v2 NUL 分隔状态。
/// 入参：工作区根目录、仓库根目录和 Git 原始字节输出。
/// 出参：包含分支、ahead/behind 和文件状态的仓库快照。
/// 作用与流程：逐条读取 header、普通文件、重命名、未跟踪和冲突记录，并保留空格路径。
pub fn parse_porcelain_v2(
    workspace_root: &str,
    repository_root: &str,
    raw: &[u8],
) -> GitResult<GitRepositoryState> {
    let records: Vec<&[u8]> = raw.split(|byte| *byte == 0).collect();
    let mut branch = None;
    let mut upstream = None;
    let mut ahead = 0;
    let mut behind = 0;
    let mut files = Vec::new();
    let mut index = 0;

    while index < records.len() {
        let record = String::from_utf8_lossy(records[index]);
        if record.is_empty() {
            index += 1;
            continue;
        }
        if let Some(value) = record.strip_prefix("# branch.head ") {
            if value != "(detached)" {
                branch = Some(value.to_string());
            }
        } else if let Some(value) = record.strip_prefix("# branch.upstream ") {
            upstream = Some(value.to_string());
        } else if let Some(value) = record.strip_prefix("# branch.ab ") {
            for item in value.split_whitespace() {
                if let Some(number) = item.strip_prefix('+') {
                    ahead = number.parse().unwrap_or_default();
                } else if let Some(number) = item.strip_prefix('-') {
                    behind = number.parse().unwrap_or_default();
                }
            }
        } else if record.starts_with("1 ") {
            let fields: Vec<&str> = record.splitn(9, ' ').collect();
            if fields.len() == 9 {
                let (index_status, worktree_status) = parse_xy(fields[1]);
                files.push(GitFileStatus {
                    path: fields[8].to_string(),
                    original_path: None,
                    index_status,
                    worktree_status,
                    conflict: false,
                    untracked: false,
                });
            }
        } else if record.starts_with("2 ") {
            let fields: Vec<&str> = record.splitn(10, ' ').collect();
            if fields.len() == 10 {
                let (index_status, worktree_status) = parse_xy(fields[1]);
                let original_path = records
                    .get(index + 1)
                    .map(|value| String::from_utf8_lossy(value).into_owned());
                files.push(GitFileStatus {
                    path: fields[9].to_string(),
                    original_path,
                    index_status,
                    worktree_status,
                    conflict: false,
                    untracked: false,
                });
                index += 1;
            }
        } else if record.starts_with("u ") {
            let fields: Vec<&str> = record.splitn(11, ' ').collect();
            if fields.len() == 11 {
                let (index_status, worktree_status) = parse_xy(fields[1]);
                files.push(GitFileStatus {
                    path: fields[10].to_string(),
                    original_path: None,
                    index_status,
                    worktree_status,
                    conflict: true,
                    untracked: false,
                });
            }
        } else if let Some(path) = record.strip_prefix("? ") {
            files.push(GitFileStatus {
                path: path.to_string(),
                original_path: None,
                index_status: None,
                worktree_status: Some("?".to_string()),
                conflict: false,
                untracked: true,
            });
        }
        index += 1;
    }

    let detached = branch.is_none();
    let has_conflicts = files.iter().any(|file| file.conflict);
    Ok(GitRepositoryState {
        workspace_root: workspace_root.to_string(),
        repository_root: repository_root.to_string(),
        branch,
        detached,
        upstream,
        ahead,
        behind,
        remotes: Vec::new(),
        files,
        has_conflicts,
    })
}

/// 读取仓库当前状态。
/// 入参：当前 apisender 工作区路径，可为仓库子目录。
/// 出参：父级真实仓库根目录下的结构化状态。
/// 作用与流程：定位仓库根目录，执行 porcelain v2 分支状态命令并解析输出。
pub fn status(workspace_root: &Path) -> GitResult<GitRepositoryState> {
    let repository_root = resolve_repository_root(workspace_root)?;
    let output = run_git(
        &repository_root,
        &args(&[
            "status",
            "--porcelain=v2",
            "-z",
            "--branch",
            "--untracked-files=all",
        ]),
        false,
    )?;
    let mut state = parse_porcelain_v2(
        &workspace_root.to_string_lossy(),
        &repository_root.to_string_lossy(),
        &output.stdout,
    )?;
    let remote_output = run_git(&repository_root, &args(&["remote"]), false)?;
    state.remotes = String::from_utf8_lossy(&remote_output.stdout)
        .lines()
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .map(str::to_string)
        .collect();
    Ok(state)
}

/// 返回当前平台的空设备路径。
/// 入参：无。
/// 出参：Windows 返回 `NUL`，其他平台返回 `/dev/null`。
/// 作用与流程：为未跟踪文件生成 no-index 差异时提供跨平台空文件端点。
pub fn null_device_path() -> &'static str {
    #[cfg(target_os = "windows")]
    {
        "NUL"
    }
    #[cfg(not(target_os = "windows"))]
    {
        "/dev/null"
    }
}

/// 校验仓库相对路径列表。
/// 入参：仓库根目录和前端提交的相对路径。
/// 出参：可直接传给 Git 的安全路径参数。
/// 作用与流程：拒绝绝对路径、父目录跳转和空路径，防止暂存仓库之外的文件。
fn validate_paths(repository_root: &Path, paths: &[String]) -> GitResult<Vec<OsString>> {
    if paths.is_empty() {
        return Err(error(GitErrorCode::InvalidPath, "至少选择一个文件", None));
    }
    let mut result = Vec::with_capacity(paths.len());
    for path in paths {
        let relative = Path::new(path);
        if relative.is_absolute()
            || relative.as_os_str().is_empty()
            || relative.components().any(|component| {
                matches!(
                    component,
                    Component::ParentDir | Component::RootDir | Component::Prefix(_)
                )
            })
        {
            return Err(error(
                GitErrorCode::InvalidPath,
                "文件路径必须位于当前 Git 仓库中",
                Some(path.clone()),
            ));
        }
        let candidate = repository_root.join(relative);
        if !candidate.starts_with(repository_root) {
            return Err(error(
                GitErrorCode::InvalidPath,
                "文件路径超出当前 Git 仓库",
                Some(path.clone()),
            ));
        }
        result.push(relative.as_os_str().to_os_string());
    }
    Ok(result)
}

/// 暂存选定文件。
/// 入参：工作区路径和仓库相对路径列表。
/// 出参：成功时为空。
/// 作用与流程：定位父级仓库、校验路径后以 `git add --` 暂存新增、修改或删除。
pub fn stage(workspace_root: &Path, paths: &[String]) -> GitResult<()> {
    let repository_root = resolve_repository_root(workspace_root)?;
    let safe_paths = validate_paths(&repository_root, paths)?;
    let mut command_args = args(&["add", "--"]);
    command_args.extend(safe_paths);
    run_git(&repository_root, &command_args, false)?;
    Ok(())
}

/// 取消暂存选定文件。
/// 入参：工作区路径和仓库相对路径列表。
/// 出参：成功时为空。
/// 作用与流程：有 HEAD 时使用 restore，无提交仓库则从 index 移除新增文件。
pub fn unstage(workspace_root: &Path, paths: &[String]) -> GitResult<()> {
    let repository_root = resolve_repository_root(workspace_root)?;
    let safe_paths = validate_paths(&repository_root, paths)?;
    let has_head = run_git(
        &repository_root,
        &args(&["rev-parse", "--verify", "HEAD"]),
        false,
    )
    .is_ok();
    let mut command_args = if has_head {
        args(&["restore", "--staged", "--"])
    } else {
        args(&["rm", "--cached", "-r", "--"])
    };
    command_args.extend(safe_paths);
    run_git(&repository_root, &command_args, false)?;
    Ok(())
}

/// 生成文件或提交差异。
/// 入参：工作区、仓库相对路径、是否读取暂存区和可选提交 SHA。
/// 出参：差异文本、二进制标记和截断状态。
/// 作用与流程：按提交、暂存区或工作区选择 Git diff 命令；未跟踪文本文件回退为 no-index 差异。
pub fn diff(
    workspace_root: &Path,
    path: &str,
    staged: bool,
    commit_sha: Option<&str>,
) -> GitResult<GitDiff> {
    let repository_root = resolve_repository_root(workspace_root)?;
    let safe_path = validate_paths(&repository_root, &[path.to_string()])?.remove(0);
    let mut command_args = if let Some(sha) = commit_sha {
        vec![
            OsString::from("show"),
            OsString::from("--format="),
            OsString::from("--no-ext-diff"),
            OsString::from("--end-of-options"),
            OsString::from(sha),
            OsString::from("--"),
        ]
    } else if staged {
        args(&["diff", "--cached", "--no-ext-diff", "--"])
    } else {
        args(&["diff", "--no-ext-diff", "--"])
    };
    command_args.push(safe_path.clone());
    let mut output = run_git_diff_output(&repository_root, &command_args, false)?;

    if output.stdout.is_empty() && !staged && commit_sha.is_none() {
        let absolute_path = repository_root.join(Path::new(&safe_path));
        if absolute_path.is_file() {
            output = run_git_diff_output(
                &repository_root,
                &[
                    OsString::from("diff"),
                    OsString::from("--no-index"),
                    OsString::from("--no-ext-diff"),
                    OsString::from("--"),
                    OsString::from(null_device_path()),
                    absolute_path.into_os_string(),
                ],
                true,
            )?;
        }
    }

    let binary = output
        .stdout
        .windows(12)
        .any(|window| window == b"Binary files")
        || output
            .stdout
            .windows(16)
            .any(|window| window == b"GIT binary patch");
    let truncated = output.stdout.len() > DIFF_OUTPUT_LIMIT;
    let output_too_large =
        output.stdout.len().saturating_add(output.stderr.len()) > DEFAULT_OUTPUT_LIMIT;
    let visible = &output.stdout[..output.stdout.len().min(DIFF_OUTPUT_LIMIT)];
    Ok(GitDiff {
        content: String::from_utf8_lossy(visible).into_owned(),
        binary,
        truncated,
        output_too_large,
    })
}

/// 读取当前仓库提交身份。
/// 入参：工作区路径。
/// 出参：仓库配置继承后的姓名和邮箱。
/// 作用与流程：分别读取 user.name 与 user.email，缺失时返回空值而不是命令错误。
pub fn get_identity(workspace_root: &Path) -> GitResult<GitIdentity> {
    let repository_root = resolve_repository_root(workspace_root)?;
    let read = |key: &str| -> Option<String> {
        run_git(&repository_root, &args(&["config", "--get", key]), true)
            .ok()
            .filter(|output| output.status.success())
            .map(|output| String::from_utf8_lossy(&output.stdout).trim().to_string())
            .filter(|value| !value.is_empty())
    };
    Ok(GitIdentity {
        name: read("user.name"),
        email: read("user.email"),
    })
}

/// 设置当前仓库提交身份。
/// 入参：工作区路径、姓名和邮箱。
/// 出参：写入后的身份对象。
/// 作用与流程：校验非空值后仅写当前仓库 config，不修改全局 Git 配置。
pub fn set_identity(workspace_root: &Path, name: &str, email: &str) -> GitResult<GitIdentity> {
    let repository_root = resolve_repository_root(workspace_root)?;
    let name = name.trim();
    let email = email.trim();
    if name.is_empty() || email.is_empty() || !email.contains('@') {
        return Err(error(
            GitErrorCode::IdentityMissing,
            "请填写有效的 Git 用户名和邮箱",
            None,
        ));
    }
    run_git(
        &repository_root,
        &args(&["config", "user.name", name]),
        false,
    )?;
    run_git(
        &repository_root,
        &args(&["config", "user.email", email]),
        false,
    )?;
    get_identity(&repository_root)
}

/// 提交已暂存改动。
/// 入参：工作区路径和提交说明。
/// 出参：最新提交摘要。
/// 作用与流程：校验提交说明和身份，执行 commit 后读取最新一条日志。
pub fn commit(workspace_root: &Path, message: &str) -> GitResult<GitCommit> {
    let repository_root = resolve_repository_root(workspace_root)?;
    let message = message.trim();
    if message.is_empty() {
        return Err(error(GitErrorCode::CommandFailed, "提交说明不能为空", None));
    }
    let identity = get_identity(&repository_root)?;
    if identity.name.is_none() || identity.email.is_none() {
        return Err(error(
            GitErrorCode::IdentityMissing,
            "当前仓库尚未配置 Git 用户名和邮箱",
            None,
        ));
    }
    run_git(&repository_root, &args(&["commit", "-m", message]), false)?;
    list_commits(&repository_root, 0, 1)?
        .into_iter()
        .next()
        .ok_or_else(|| error(GitErrorCode::CommandFailed, "无法读取新提交", None))
}

/// 解析日志记录。
/// 入参：使用 NUL 分隔记录、单元分隔字段的原始字节。
/// 出参：结构化提交列表。
/// 作用与流程：逐条验证六个字段并保留包含空格或中文的提交主题。
fn parse_commits(raw: &[u8]) -> Vec<GitCommit> {
    String::from_utf8_lossy(raw)
        .split('\0')
        .filter_map(|record| {
            let fields: Vec<&str> = record.trim_start_matches('\n').split('\u{1f}').collect();
            (fields.len() == 6).then(|| GitCommit {
                sha: fields[0].to_string(),
                short_sha: fields[1].to_string(),
                author_name: fields[2].to_string(),
                author_email: fields[3].to_string(),
                authored_at: fields[4].to_string(),
                subject: fields[5].to_string(),
            })
        })
        .collect()
}

/// 分页读取提交日志。
/// 入参：工作区路径、偏移量和每页数量。
/// 出参：当前分支最多 100 条提交摘要。
/// 作用与流程：限制分页参数并使用稳定分隔符执行 git log；空仓库返回空列表。
pub fn list_commits(workspace_root: &Path, skip: usize, limit: usize) -> GitResult<Vec<GitCommit>> {
    let repository_root = resolve_repository_root(workspace_root)?;
    let count = limit.clamp(1, 100).to_string();
    let skip = skip.to_string();
    let output = run_git_diff_output(
        &repository_root,
        &[
            OsString::from("log"),
            OsString::from("-z"),
            OsString::from("--date=iso-strict"),
            OsString::from("--pretty=format:%H%x1f%h%x1f%an%x1f%ae%x1f%aI%x1f%s"),
            OsString::from("--skip"),
            OsString::from(skip),
            OsString::from("-n"),
            OsString::from(count),
        ],
        false,
    );
    match output {
        Ok(output) => Ok(parse_commits(&output.stdout)),
        Err(cause)
            if cause
                .details
                .as_deref()
                .is_some_and(|details| details.contains("does not have any commits yet")) =>
        {
            Ok(Vec::new())
        }
        Err(cause) => Err(cause),
    }
}

/// 读取单个提交详情。
/// 入参：工作区路径和完整或短 SHA。
/// 出参：提交摘要、文件列表和最多 1 MiB 的差异。
/// 作用与流程：读取指定提交元数据、name-only 文件清单和完整提交 diff 后统一截断。
pub fn show_commit(workspace_root: &Path, sha: &str) -> GitResult<GitCommitDetail> {
    let repository_root = resolve_repository_root(workspace_root)?;
    let metadata = run_git(
        &repository_root,
        &[
            OsString::from("show"),
            OsString::from("-s"),
            OsString::from("--date=iso-strict"),
            OsString::from("--format=%H%x1f%h%x1f%an%x1f%ae%x1f%aI%x1f%s%x00"),
            OsString::from("--end-of-options"),
            OsString::from(sha),
        ],
        false,
    )?;
    let commit = parse_commits(&metadata.stdout)
        .into_iter()
        .next()
        .ok_or_else(|| error(GitErrorCode::CommandFailed, "无法解析提交信息", None))?;
    let files_output = run_git(
        &repository_root,
        &[
            OsString::from("diff-tree"),
            OsString::from("--root"),
            OsString::from("--no-commit-id"),
            OsString::from("--name-only"),
            OsString::from("-r"),
            OsString::from("-z"),
            OsString::from("--end-of-options"),
            OsString::from(sha),
        ],
        false,
    )?;
    let files = files_output
        .stdout
        .split(|byte| *byte == 0)
        .filter(|value| !value.is_empty())
        .map(|value| String::from_utf8_lossy(value).into_owned())
        .collect();
    let output = run_git(
        &repository_root,
        &[
            OsString::from("show"),
            OsString::from("--format="),
            OsString::from("--no-ext-diff"),
            OsString::from("--end-of-options"),
            OsString::from(sha),
        ],
        false,
    )?;
    let binary = output
        .stdout
        .windows(12)
        .any(|window| window == b"Binary files");
    let truncated = output.stdout.len() > DIFF_OUTPUT_LIMIT;
    let output_too_large =
        output.stdout.len().saturating_add(output.stderr.len()) > DEFAULT_OUTPUT_LIMIT;
    let visible = &output.stdout[..output.stdout.len().min(DIFF_OUTPUT_LIMIT)];
    Ok(GitCommitDetail {
        commit,
        files,
        diff: GitDiff {
            content: String::from_utf8_lossy(visible).into_owned(),
            binary,
            truncated,
            output_too_large,
        },
    })
}

/// 列出本地与远端分支。
/// 入参：工作区路径。
/// 出参：分支名称、当前状态、upstream 和 ahead/behind 信息。
/// 作用与流程：使用 for-each-ref 读取稳定字段，并过滤远端 HEAD 占位引用。
pub fn list_branches(workspace_root: &Path) -> GitResult<Vec<GitBranch>> {
    let repository_root = resolve_repository_root(workspace_root)?;
    let output = run_git(
        &repository_root,
        &args(&[
            "for-each-ref",
            "--format=%(refname)%1f%(refname:short)%1f%(HEAD)%1f%(upstream:short)%1f%(upstream:track,nobracket)",
            "refs/heads",
            "refs/remotes",
        ]),
        false,
    )?;
    let mut branches = Vec::new();
    for line in String::from_utf8_lossy(&output.stdout).lines() {
        let fields: Vec<&str> = line.split('\u{1f}').collect();
        if fields.len() != 5 || fields[1].ends_with("/HEAD") {
            continue;
        }
        let mut ahead = 0;
        let mut behind = 0;
        for item in fields[4].split(',').map(str::trim) {
            if let Some(value) = item.strip_prefix("ahead ") {
                ahead = value.parse().unwrap_or_default();
            } else if let Some(value) = item.strip_prefix("behind ") {
                behind = value.parse().unwrap_or_default();
            }
        }
        branches.push(GitBranch {
            name: fields[1].to_string(),
            current: fields[2] == "*",
            remote: fields[0].starts_with("refs/remotes/"),
            upstream: (!fields[3].is_empty()).then(|| fields[3].to_string()),
            ahead,
            behind,
        });
    }
    Ok(branches)
}

/// 校验分支名称。
/// 入参：仓库根目录和候选分支名。
/// 出参：合法时为空。
/// 作用与流程：调用 Git 自身 check-ref-format，避免在前端复制不完整规则。
fn validate_branch(repository_root: &Path, name: &str) -> GitResult<()> {
    let result = run_git(
        repository_root,
        &args(&["check-ref-format", "--branch", name]),
        false,
    );
    result
        .map(|_| ())
        .map_err(|cause| error(GitErrorCode::InvalidBranch, "分支名称不合法", cause.details))
}

/// 从当前 HEAD 创建并切换分支。
/// 入参：工作区路径和新分支名。
/// 出参：成功时为空。
/// 作用与流程：校验名称后执行 switch -c，保留 Git 对工作区改动的原生保护行为。
pub fn create_branch(workspace_root: &Path, name: &str) -> GitResult<()> {
    let repository_root = resolve_repository_root(workspace_root)?;
    validate_branch(&repository_root, name)?;
    run_git(&repository_root, &args(&["switch", "-c", name]), false)?;
    Ok(())
}

/// 切换到已有本地分支。
/// 入参：工作区路径和分支名。
/// 出参：成功时为空。
/// 作用与流程：校验名称后执行 switch，由 Git 判断已保存改动能否安全保留。
pub fn switch_branch(workspace_root: &Path, name: &str) -> GitResult<()> {
    let repository_root = resolve_repository_root(workspace_root)?;
    validate_branch(&repository_root, name)?;
    run_git(&repository_root, &args(&["switch", name]), false)?;
    Ok(())
}

/// 以仅快进策略拉取 tracking branch。
/// 入参：工作区路径。
/// 出参：成功时为空。
/// 作用与流程：要求现有 upstream 并执行 pull --ff-only，不创建 merge commit 或 rebase。
pub fn pull(workspace_root: &Path) -> GitResult<()> {
    let repository_root = resolve_repository_root(workspace_root)?;
    run_git(&repository_root, &args(&["pull", "--ff-only"]), false)?;
    Ok(())
}

/// 推送当前分支。
/// 入参：工作区路径、可选远端和可选远端分支。
/// 出参：成功时为空。
/// 作用与流程：提供远端和分支时首次设置 upstream，否则使用现有 tracking branch。
pub fn push(workspace_root: &Path, remote: Option<&str>, branch: Option<&str>) -> GitResult<()> {
    let repository_root = resolve_repository_root(workspace_root)?;
    match (remote, branch) {
        (Some(remote), Some(branch)) => {
            let remotes = run_git(&repository_root, &args(&["remote"]), false)?;
            if !String::from_utf8_lossy(&remotes.stdout)
                .lines()
                .any(|name| name.trim() == remote)
            {
                return Err(error(
                    GitErrorCode::RemoteMissing,
                    "选择的 Git 远端不存在",
                    Some(remote.to_string()),
                ));
            }
            validate_branch(&repository_root, branch)?;
            run_git(
                &repository_root,
                &args(&["push", "--set-upstream", "--", remote, branch]),
                false,
            )?;
        }
        (None, None) => {
            run_git(&repository_root, &args(&["push"]), false)?;
        }
        _ => {
            return Err(error(
                GitErrorCode::UpstreamMissing,
                "首次推送必须同时指定远端和分支",
                None,
            ));
        }
    }
    Ok(())
}

/// 校验并规范化远端定位符。
/// 入参：用户提供的远端 URL 或本地仓库路径。
/// 出参：去除首尾空白后的非空定位符。
/// 作用与流程：拒绝空值，后续始终把定位符放在 `--` 后作为普通参数传给 Git。
fn validate_remote_locator(remote_url: &str) -> GitResult<&str> {
    let remote_url = remote_url.trim();
    if remote_url.is_empty() {
        return Err(error(
            GitErrorCode::RemoteMissing,
            "Git 远端地址不能为空",
            None,
        ));
    }
    Ok(remote_url)
}

/// 检查远端仓库是否为空。
/// 入参：可作为 Git remote 的 URL 或本地路径以及执行目录。
/// 出参：远端不存在任何 refs 时为空。
/// 作用与流程：执行不带 ref 过滤的 ls-remote；存在任一引用则拒绝初始化绑定，避免覆盖远端历史。
fn ensure_remote_empty(cwd: &Path, remote_url: &str) -> GitResult<()> {
    let remote_url = validate_remote_locator(remote_url)?;
    let output = run_git(cwd, &args(&["ls-remote", "--", remote_url]), false)?;
    if !output.stdout.is_empty() {
        return Err(error(
            GitErrorCode::RemoteNotEmpty,
            "远端仓库已有提交或标签，不能作为新工作区的空远端",
            None,
        ));
    }
    Ok(())
}

/// 向 .gitignore 追加安全规则。
/// 入参：工作区根目录。
/// 出参：成功时为空。
/// 作用与流程：读取现有规则，只追加缺失的私有环境、应用目录和系统文件规则。
fn append_default_ignore_rules(workspace_root: &Path) -> GitResult<()> {
    let ignore_path = workspace_root.join(".gitignore");
    let existing = match fs::read_to_string(&ignore_path) {
        Ok(existing) => existing,
        Err(cause) if cause.kind() == std::io::ErrorKind::NotFound => String::new(),
        Err(cause) => {
            return Err(error(
                GitErrorCode::Io,
                "无法安全读取现有 .gitignore，已停止追加",
                Some(cause.to_string()),
            ));
        }
    };
    let lines: Vec<&str> = existing.lines().collect();
    let missing: Vec<&str> = DEFAULT_IGNORE_RULES
        .iter()
        .copied()
        .filter(|rule| !lines.iter().any(|line| line.trim() == *rule))
        .collect();
    if missing.is_empty() {
        return Ok(());
    }
    let mut updated = existing;
    if !updated.is_empty() && !updated.ends_with('\n') {
        updated.push('\n');
    }
    if !updated.is_empty() {
        updated.push('\n');
    }
    updated.push_str("# apisender 本地与敏感文件\n");
    for rule in missing {
        updated.push_str(rule);
        updated.push('\n');
    }
    fs::write(ignore_path, updated).map_err(|cause| {
        error(
            GitErrorCode::Io,
            "无法更新 .gitignore",
            Some(cause.to_string()),
        )
    })
}

/// 初始化当前普通工作区并连接空远端。
/// 入参：工作区路径、远端 URL 和默认分支名。
/// 出参：初始化后的仓库状态。
/// 作用与流程：拒绝已有仓库，验证分支和空远端，初始化仓库、补安全忽略规则并添加 origin。
pub fn init_workspace(
    workspace_root: &Path,
    remote_url: &str,
    default_branch: &str,
) -> GitResult<GitRepositoryState> {
    if resolve_repository_root(workspace_root).is_ok() {
        return Err(error(
            GitErrorCode::CommandFailed,
            "当前工作区已经是 Git 仓库",
            None,
        ));
    }
    validate_branch(workspace_root, default_branch)?;
    ensure_remote_empty(workspace_root, remote_url)?;
    run_git(
        workspace_root,
        &args(&["init", "-b", default_branch]),
        false,
    )?;
    append_default_ignore_rules(workspace_root)?;
    run_git(
        workspace_root,
        &args(&[
            "remote",
            "add",
            "--",
            "origin",
            validate_remote_locator(remote_url)?,
        ]),
        false,
    )?;
    status(workspace_root)
}

/// 为已有本地仓库连接 origin。
/// 入参：工作区路径和远端 URL。
/// 出参：成功时为空。
/// 作用与流程：先确认 origin 不存在，再新增远端；首版不覆盖已有配置。
pub fn connect_origin(workspace_root: &Path, remote_url: &str) -> GitResult<()> {
    let repository_root = resolve_repository_root(workspace_root)?;
    let remote_url = validate_remote_locator(remote_url)?;
    let existing = run_git(&repository_root, &args(&["remote"]), false)?;
    if String::from_utf8_lossy(&existing.stdout)
        .lines()
        .any(|name| name.trim() == "origin")
    {
        return Err(error(
            GitErrorCode::RemoteAlreadyExists,
            "当前仓库已经配置 origin，首版不会覆盖现有远端",
            None,
        ));
    }
    run_git(
        &repository_root,
        &args(&["remote", "add", "--", "origin", remote_url]),
        false,
    )?;
    Ok(())
}

/// 克隆远端仓库到指定子目录。
/// 入参：父目录、目标文件夹名和远端 URL。
/// 出参：克隆后的规范化目录路径。
/// 作用与流程：校验名称与目标空状态，执行 clone；失败时只清理本次新创建的目标目录。
pub fn clone_repository(parent: &Path, folder_name: &str, remote_url: &str) -> GitResult<PathBuf> {
    let parent = fs::canonicalize(parent).map_err(|cause| {
        error(
            GitErrorCode::Io,
            "无法读取克隆父目录",
            Some(cause.to_string()),
        )
    })?;
    let relative = Path::new(folder_name);
    if relative.as_os_str().is_empty()
        || relative.is_absolute()
        || relative
            .components()
            .any(|component| !matches!(component, Component::Normal(_)))
    {
        return Err(error(
            GitErrorCode::InvalidPath,
            "克隆文件夹名称不合法",
            Some(folder_name.to_string()),
        ));
    }
    let target = parent.join(relative);
    let remote_url = validate_remote_locator(remote_url)?;
    let existed = target.exists();
    if existed {
        if !target.is_dir() {
            return Err(error(
                GitErrorCode::TargetNotEmpty,
                "克隆目标必须是空目录或不存在",
                Some(target.to_string_lossy().into_owned()),
            ));
        }
        let mut entries = fs::read_dir(&target).map_err(|cause| {
            error(
                GitErrorCode::Io,
                "无法读取克隆目标目录",
                Some(cause.to_string()),
            )
        })?;
        if entries.next().is_some() {
            return Err(error(
                GitErrorCode::TargetNotEmpty,
                "克隆目标目录必须为空或不存在",
                Some(target.to_string_lossy().into_owned()),
            ));
        }
    }
    let result = run_git(
        &parent,
        &[
            OsString::from("clone"),
            OsString::from("--"),
            OsString::from(remote_url),
            target.as_os_str().to_os_string(),
        ],
        false,
    );
    if let Err(cause) = result {
        if existed {
            return Err(error(
                cause.code,
                format!("克隆失败，原有空目录已保留，请检查：{}", target.display()),
                cause.details,
            ));
        }
        if target.exists() {
            let _ = fs::remove_dir_all(&target);
        }
        return Err(cause);
    }
    fs::canonicalize(target).map_err(|cause| {
        error(
            GitErrorCode::Io,
            "无法解析克隆目录",
            Some(cause.to_string()),
        )
    })
}
