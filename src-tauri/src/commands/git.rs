use std::path::PathBuf;

use tauri::{AppHandle, State};

use crate::git::{
    self, GitAvailability, GitBranch, GitCommit, GitCommitDetail, GitDiff, GitErrorCode,
    GitErrorPayload, GitIdentity, GitOperationState, GitRepositoryState, GitResult,
};
use crate::workspace;

/// 构造命令层错误。
/// 入参：错误码、用户消息和可选详情。
/// 出参：可通过 Tauri 返回的 Git 错误载荷。
/// 作用与流程：供命令层补充“无工作区”和异步任务失败等服务层之外的错误。
fn command_error(
    code: GitErrorCode,
    message: impl Into<String>,
    details: Option<String>,
) -> GitErrorPayload {
    GitErrorPayload {
        code,
        message: message.into(),
        details: details.map(|value| git::redact_secrets(&value)),
    }
}

/// 获取当前 apisender 工作区路径。
/// 入参：Tauri AppHandle。
/// 出参：当前工作区目录。
/// 作用与流程：从 WorkspaceState 读取路径；未打开工作区时返回 not_repository。
fn current_workspace(app: &AppHandle) -> GitResult<PathBuf> {
    workspace::get_workspace_root(app)
        .map(PathBuf::from)
        .ok_or_else(|| command_error(GitErrorCode::NotRepository, "请先打开一个工作区", None))
}

/// 在线程池中执行 Git 读取操作。
/// 入参：可在线程池执行并返回 GitResult 的闭包。
/// 出参：闭包结果或异步任务错误。
/// 作用与流程：把可能访问磁盘的 Git 命令移出 Tauri 异步调度线程。
async fn run_read<T, F>(operation: F) -> GitResult<T>
where
    T: Send + 'static,
    F: FnOnce() -> GitResult<T> + Send + 'static,
{
    tokio::task::spawn_blocking(operation)
        .await
        .map_err(|cause| {
            command_error(
                GitErrorCode::CommandFailed,
                "Git 后台任务异常结束",
                Some(cause.to_string()),
            )
        })?
}

/// 在线程池中执行互斥 Git 写操作。
/// 入参：全局写操作状态和实际操作闭包。
/// 出参：闭包结果、占用错误或异步任务错误。
/// 作用与流程：先取得原子 guard，再在阻塞线程中持有 guard 直到写操作结束。
async fn run_write<T, F>(state: &GitOperationState, operation: F) -> GitResult<T>
where
    T: Send + 'static,
    F: FnOnce() -> GitResult<T> + Send + 'static,
{
    let guard = state.try_begin()?;
    run_read(move || {
        let _guard = guard;
        operation()
    })
    .await
}

/// 探测系统 Git。
/// 入参：无。
/// 出参：安装和版本可用性。
/// 作用与流程：调用 Git 服务探测，不要求当前存在工作区。
#[tauri::command]
pub async fn git_probe() -> GitAvailability {
    git::probe()
}

/// 读取当前工作区的 Git 状态。
/// 入参：Tauri AppHandle。
/// 出参：真实仓库根目录、分支和文件状态。
/// 作用与流程：获取工作区后在线程池定位父级仓库并解析 porcelain v2。
#[tauri::command]
pub async fn git_status(app: AppHandle) -> GitResult<GitRepositoryState> {
    let root = current_workspace(&app)?;
    run_read(move || git::status(&root)).await
}

/// 读取文件差异。
/// 入参：工作区、仓库相对路径、暂存标记和可选提交 SHA。
/// 出参：最多 1 MiB 的差异载荷。
/// 作用与流程：把参数交给 Git 服务选择工作区、index 或提交差异。
#[tauri::command]
pub async fn git_diff(
    app: AppHandle,
    path: String,
    staged: bool,
    commit_sha: Option<String>,
) -> GitResult<GitDiff> {
    let root = current_workspace(&app)?;
    run_read(move || git::diff(&root, &path, staged, commit_sha.as_deref())).await
}

/// 列出当前仓库本地与远端分支。
/// 入参：Tauri AppHandle。
/// 出参：分支列表。
/// 作用与流程：在线程池调用服务层稳定分支解析。
#[tauri::command]
pub async fn git_list_branches(app: AppHandle) -> GitResult<Vec<GitBranch>> {
    let root = current_workspace(&app)?;
    run_read(move || git::list_branches(&root)).await
}

/// 分页读取当前分支提交。
/// 入参：Tauri AppHandle、偏移和每页数量。
/// 出参：最多 100 条提交摘要。
/// 作用与流程：把分页参数传给服务层 git log 读取。
#[tauri::command]
pub async fn git_list_commits(
    app: AppHandle,
    skip: usize,
    limit: usize,
) -> GitResult<Vec<GitCommit>> {
    let root = current_workspace(&app)?;
    run_read(move || git::list_commits(&root, skip, limit)).await
}

/// 读取指定提交详情。
/// 入参：Tauri AppHandle 和提交 SHA。
/// 出参：提交摘要、文件列表和差异。
/// 作用与流程：在线程池组合提交元数据与受限差异输出。
#[tauri::command]
pub async fn git_show_commit(app: AppHandle, sha: String) -> GitResult<GitCommitDetail> {
    let root = current_workspace(&app)?;
    run_read(move || git::show_commit(&root, &sha)).await
}

/// 读取当前仓库提交身份。
/// 入参：Tauri AppHandle。
/// 出参：Git 用户名和邮箱。
/// 作用与流程：读取仓库及其继承的 Git 配置，不修改全局设置。
#[tauri::command]
pub async fn git_get_identity(app: AppHandle) -> GitResult<GitIdentity> {
    let root = current_workspace(&app)?;
    run_read(move || git::get_identity(&root)).await
}

/// 暂存选定文件。
/// 入参：AppHandle、写操作状态和仓库相对路径列表。
/// 出参：成功时为空。
/// 作用与流程：取得写锁后校验并执行 git add。
#[tauri::command]
pub async fn git_stage(
    app: AppHandle,
    state: State<'_, GitOperationState>,
    paths: Vec<String>,
) -> GitResult<()> {
    let root = current_workspace(&app)?;
    run_write(&state, move || git::stage(&root, &paths)).await
}

/// 取消暂存选定文件。
/// 入参：AppHandle、写操作状态和仓库相对路径列表。
/// 出参：成功时为空。
/// 作用与流程：取得写锁后根据仓库是否有 HEAD 选择 restore 或 rm --cached。
#[tauri::command]
pub async fn git_unstage(
    app: AppHandle,
    state: State<'_, GitOperationState>,
    paths: Vec<String>,
) -> GitResult<()> {
    let root = current_workspace(&app)?;
    run_write(&state, move || git::unstage(&root, &paths)).await
}

/// 提交已暂存改动。
/// 入参：AppHandle、写操作状态和提交说明。
/// 出参：新提交摘要。
/// 作用与流程：取得写锁后校验身份和说明，创建提交并读取最新日志。
#[tauri::command]
pub async fn git_commit(
    app: AppHandle,
    state: State<'_, GitOperationState>,
    message: String,
) -> GitResult<GitCommit> {
    let root = current_workspace(&app)?;
    run_write(&state, move || git::commit(&root, &message)).await
}

/// 设置当前仓库 Git 身份。
/// 入参：AppHandle、写操作状态、姓名和邮箱。
/// 出参：写入后的身份。
/// 作用与流程：取得写锁并仅修改当前仓库 config。
#[tauri::command]
pub async fn git_set_identity(
    app: AppHandle,
    state: State<'_, GitOperationState>,
    name: String,
    email: String,
) -> GitResult<GitIdentity> {
    let root = current_workspace(&app)?;
    run_write(&state, move || git::set_identity(&root, &name, &email)).await
}

/// 仅快进拉取当前 tracking branch。
/// 入参：AppHandle 和写操作状态。
/// 出参：更新后的仓库状态。
/// 作用与流程：取得写锁执行 pull --ff-only，完成后重新读取状态。
#[tauri::command]
pub async fn git_pull(
    app: AppHandle,
    state: State<'_, GitOperationState>,
) -> GitResult<GitRepositoryState> {
    let root = current_workspace(&app)?;
    run_write(&state, move || {
        git::pull(&root)?;
        git::status(&root)
    })
    .await
}

/// 推送当前分支。
/// 入参：AppHandle、写状态及首次推送可选远端和分支。
/// 出参：更新后的仓库状态。
/// 作用与流程：首次推送设置 upstream，其余使用 tracking branch，完成后刷新状态。
#[tauri::command]
pub async fn git_push(
    app: AppHandle,
    state: State<'_, GitOperationState>,
    remote: Option<String>,
    branch: Option<String>,
) -> GitResult<GitRepositoryState> {
    let root = current_workspace(&app)?;
    run_write(&state, move || {
        git::push(&root, remote.as_deref(), branch.as_deref())?;
        git::status(&root)
    })
    .await
}

/// 创建并切换到新分支。
/// 入参：AppHandle、写状态和新分支名。
/// 出参：更新后的仓库状态。
/// 作用与流程：取得写锁后让 Git 校验、创建并切换分支，再刷新状态。
#[tauri::command]
pub async fn git_create_branch(
    app: AppHandle,
    state: State<'_, GitOperationState>,
    name: String,
) -> GitResult<GitRepositoryState> {
    let root = current_workspace(&app)?;
    run_write(&state, move || {
        git::create_branch(&root, &name)?;
        git::status(&root)
    })
    .await
}

/// 切换到已有本地分支。
/// 入参：AppHandle、写状态和分支名。
/// 出参：更新后的仓库状态。
/// 作用与流程：取得写锁后按 Git 原生规则切换分支，再刷新状态。
#[tauri::command]
pub async fn git_switch_branch(
    app: AppHandle,
    state: State<'_, GitOperationState>,
    name: String,
) -> GitResult<GitRepositoryState> {
    let root = current_workspace(&app)?;
    run_write(&state, move || {
        git::switch_branch(&root, &name)?;
        git::status(&root)
    })
    .await
}

/// 初始化当前普通工作区并连接空远端。
/// 入参：AppHandle、写状态、远端 URL 和默认分支。
/// 出参：初始化后的仓库状态。
/// 作用与流程：取得写锁后验证空远端、初始化、补忽略规则并添加 origin。
#[tauri::command]
pub async fn git_init_workspace(
    app: AppHandle,
    state: State<'_, GitOperationState>,
    remote_url: String,
    default_branch: String,
) -> GitResult<GitRepositoryState> {
    let root = current_workspace(&app)?;
    run_write(&state, move || {
        git::init_workspace(&root, &remote_url, &default_branch)
    })
    .await
}

/// 为已有本地仓库连接 origin。
/// 入参：AppHandle、写状态和远端 URL。
/// 出参：更新后的仓库状态。
/// 作用与流程：取得写锁后拒绝覆盖已有 origin，添加远端并刷新状态。
#[tauri::command]
pub async fn git_connect_origin(
    app: AppHandle,
    state: State<'_, GitOperationState>,
    remote_url: String,
) -> GitResult<GitRepositoryState> {
    let root = current_workspace(&app)?;
    run_write(&state, move || {
        git::connect_origin(&root, &remote_url)?;
        git::status(&root)
    })
    .await
}

/// 克隆远端仓库并打开为 apisender 工作区。
/// 入参：AppHandle、写状态、父目录、目标文件夹名和远端 URL。
/// 出参：新工作区绝对路径。
/// 作用与流程：互斥执行克隆，成功后启动现有工作区 watcher 并保存最近工作区。
#[tauri::command]
pub async fn git_clone_workspace(
    app: AppHandle,
    state: State<'_, GitOperationState>,
    parent: String,
    folder_name: String,
    remote_url: String,
) -> GitResult<String> {
    let path = run_write(&state, move || {
        git::clone_repository(&PathBuf::from(parent), &folder_name, &remote_url)
    })
    .await?;
    let path_text = path.to_string_lossy().into_owned();
    workspace::open_workspace(&app, &path_text).map_err(|cause| {
        command_error(
            GitErrorCode::Io,
            "仓库已克隆，但无法自动打开工作区",
            Some(cause.to_string()),
        )
    })?;
    Ok(path_text)
}
