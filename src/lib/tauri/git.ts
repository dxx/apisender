import { invoke } from "@tauri-apps/api/core";

import type {
  GitAvailability,
  GitBranch,
  GitCommit,
  GitCommitDetail,
  GitDiff,
  GitIdentity,
  GitRepositoryState,
} from "../types";

/**
 * 探测系统 Git 环境。
 * 入参：无。
 * 出参：Git 安装、版本支持和最低版本信息。
 * 作用与流程：调用后端探测命令，不依赖当前是否已打开工作区。
 */
export async function gitProbe(): Promise<GitAvailability> {
  return invoke<GitAvailability>("git_probe");
}

/**
 * 读取当前工作区仓库状态。
 * 入参：无，后端使用当前工作区。
 * 出参：真实仓库根目录、分支、远端和文件状态。
 * 作用与流程：调用后端 porcelain v2 状态解析接口。
 */
export async function gitStatus(): Promise<GitRepositoryState> {
  return invoke<GitRepositoryState>("git_status");
}

/**
 * 读取文件差异。
 * 入参：仓库相对路径、是否读取暂存区、可选提交 SHA。
 * 出参：受大小限制的文本或二进制差异元数据。
 * 作用与流程：按工作区、index 或提交上下文调用统一后端 diff。
 */
export async function gitDiff(
  path: string,
  staged: boolean,
  commitSha?: string,
): Promise<GitDiff> {
  return invoke<GitDiff>("git_diff", { path, staged, commitSha: commitSha ?? null });
}

/**
 * 列出本地与远端分支。
 * 入参：无，后端使用当前工作区。
 * 出参：分支及其当前、upstream、ahead/behind 信息。
 * 作用与流程：调用后端 for-each-ref 解析接口。
 */
export async function gitListBranches(): Promise<GitBranch[]> {
  return invoke<GitBranch[]>("git_list_branches");
}

/**
 * 分页读取当前分支提交记录。
 * 入参：跳过数量和每页数量。
 * 出参：最多 100 条提交摘要。
 * 作用与流程：把分页参数传给后端稳定格式的 git log。
 */
export async function gitListCommits(skip = 0, limit = 50): Promise<GitCommit[]> {
  return invoke<GitCommit[]>("git_list_commits", { skip, limit });
}

/**
 * 读取单个提交详情。
 * 入参：提交 SHA。
 * 出参：提交元数据、文件列表和差异。
 * 作用与流程：调用后端组合后的只读提交详情接口。
 */
export async function gitShowCommit(sha: string): Promise<GitCommitDetail> {
  return invoke<GitCommitDetail>("git_show_commit", { sha });
}

/**
 * 读取当前仓库提交身份。
 * 入参：无。
 * 出参：Git 用户名和邮箱。
 * 作用与流程：读取仓库配置及其继承值，不修改全局设置。
 */
export async function gitGetIdentity(): Promise<GitIdentity> {
  return invoke<GitIdentity>("git_get_identity");
}

/**
 * 暂存选定文件。
 * 入参：仓库相对路径列表。
 * 出参：无。
 * 作用与流程：由后端校验路径并执行 git add --。
 */
export async function gitStage(paths: string[]): Promise<void> {
  await invoke("git_stage", { paths });
}

/**
 * 取消暂存选定文件。
 * 入参：仓库相对路径列表。
 * 出参：无。
 * 作用与流程：由后端根据仓库是否有 HEAD 安全更新 index。
 */
export async function gitUnstage(paths: string[]): Promise<void> {
  await invoke("git_unstage", { paths });
}

/**
 * 提交已暂存改动。
 * 入参：非空提交说明。
 * 出参：新提交摘要。
 * 作用与流程：调用后端校验身份并创建提交。
 */
export async function gitCommit(message: string): Promise<GitCommit> {
  return invoke<GitCommit>("git_commit", { message });
}

/**
 * 设置当前仓库提交身份。
 * 入参：Git 用户名和邮箱。
 * 出参：写入后的仓库身份。
 * 作用与流程：仅写当前仓库 config，不修改系统全局配置。
 */
export async function gitSetIdentity(name: string, email: string): Promise<GitIdentity> {
  return invoke<GitIdentity>("git_set_identity", { name, email });
}

/**
 * 以仅快进策略拉取当前分支。
 * 入参：无。
 * 出参：更新后的仓库状态。
 * 作用与流程：调用后端 pull --ff-only 后重新读取状态。
 */
export async function gitPull(): Promise<GitRepositoryState> {
  return invoke<GitRepositoryState>("git_pull");
}

/**
 * 推送当前分支。
 * 入参：首次推送时可选远端和远端分支；已有 upstream 时均省略。
 * 出参：更新后的仓库状态。
 * 作用与流程：首次设置 upstream，后续沿用 tracking branch。
 */
export async function gitPush(remote?: string, branch?: string): Promise<GitRepositoryState> {
  return invoke<GitRepositoryState>("git_push", {
    remote: remote ?? null,
    branch: branch ?? null,
  });
}

/**
 * 创建并切换新分支。
 * 入参：新分支名。
 * 出参：切换后的仓库状态。
 * 作用与流程：由后端调用 Git 校验名称，并从当前 HEAD 创建分支。
 */
export async function gitCreateBranch(name: string): Promise<GitRepositoryState> {
  return invoke<GitRepositoryState>("git_create_branch", { name });
}

/**
 * 切换已有本地分支。
 * 入参：本地分支名。
 * 出参：切换后的仓库状态。
 * 作用与流程：调用后端 git switch，已保存改动由 Git 原生规则保护。
 */
export async function gitSwitchBranch(name: string): Promise<GitRepositoryState> {
  return invoke<GitRepositoryState>("git_switch_branch", { name });
}

/**
 * 初始化当前普通工作区并连接空远端。
 * 入参：远端 URL 和默认分支名。
 * 出参：初始化后的仓库状态。
 * 作用与流程：后端验证空远端、创建仓库、补充安全忽略项并添加 origin。
 */
export async function gitInitWorkspace(
  remoteUrl: string,
  defaultBranch: string,
): Promise<GitRepositoryState> {
  return invoke<GitRepositoryState>("git_init_workspace", { remoteUrl, defaultBranch });
}

/**
 * 为已有仓库连接 origin。
 * 入参：远端 URL。
 * 出参：更新后的仓库状态。
 * 作用与流程：后端拒绝覆盖已有 origin，成功添加后刷新状态。
 */
export async function gitConnectOrigin(remoteUrl: string): Promise<GitRepositoryState> {
  return invoke<GitRepositoryState>("git_connect_origin", { remoteUrl });
}

/**
 * 克隆远端并打开新工作区。
 * 入参：父目录、目标文件夹名和远端 URL。
 * 出参：新工作区绝对路径。
 * 作用与流程：后端校验目标、执行克隆并切换 WorkspaceState。
 */
export async function gitCloneWorkspace(
  parent: string,
  folderName: string,
  remoteUrl: string,
): Promise<string> {
  return invoke<string>("git_clone_workspace", { parent, folderName, remoteUrl });
}
