import type { GitErrorCode, GitErrorPayload, GitFileStatus } from "./types";

const GIT_ERROR_CODES = new Set<GitErrorCode>([
  "git_not_installed",
  "git_version_too_old",
  "not_repository",
  "target_not_empty",
  "remote_missing",
  "remote_not_empty",
  "remote_already_exists",
  "upstream_missing",
  "identity_missing",
  "authentication_failed",
  "non_fast_forward",
  "conflict",
  "operation_busy",
  "output_too_large",
  "invalid_path",
  "invalid_branch",
  "command_failed",
  "io",
]);

export interface GitFileGroups {
  conflicts: GitFileStatus[];
  staged: GitFileStatus[];
  unstaged: GitFileStatus[];
  untracked: GitFileStatus[];
}

/**
 * 将仓库文件状态划分为界面分组。
 * 入参：Git 返回的文件状态列表。
 * 出参：冲突、已暂存、未暂存和未跟踪四组文件。
 * 作用与流程：冲突和未跟踪文件单独归组；普通文件按 index/worktree 状态独立加入，因此部分暂存文件可同时出现两次。
 */
export function groupGitFiles(files: GitFileStatus[]): GitFileGroups {
  const groups: GitFileGroups = {
    conflicts: [],
    staged: [],
    unstaged: [],
    untracked: [],
  };

  for (const file of files) {
    if (file.conflict) {
      groups.conflicts.push(file);
      continue;
    }
    if (file.untracked) {
      groups.untracked.push(file);
      continue;
    }
    if (file.indexStatus) {
      groups.staged.push(file);
    }
    if (file.worktreeStatus) {
      groups.unstaged.push(file);
    }
  }

  return groups;
}

/**
 * 收集暂存或取消暂存需要传给 Git 的路径。
 * 入参：一组文件状态。
 * 出参：去重后的当前路径及重命名前路径列表。
 * 作用与流程：按界面顺序加入当前路径，重命名时紧接加入原路径，避免只处理重命名的一侧。
 */
export function getGitOperationPaths(files: GitFileStatus[]): string[] {
  const paths = new Set<string>();
  for (const file of files) {
    paths.add(file.path);
    if (file.originalPath) {
      paths.add(file.originalPath);
    }
  }
  return [...paths];
}

/**
 * 收集未保存编辑器标签页路径。
 * 入参：带路径和 isDirty 标记的标签页列表。
 * 出参：所有未写入磁盘的文件路径。
 * 作用与流程：过滤未保存标签页，供提交、拉取和切分支前统一阻止危险操作。
 */
export function getDirtyTabPaths(tabs: Array<{ path: string; isDirty: boolean }>): string[] {
  return tabs.filter((tab) => tab.isDirty).map((tab) => tab.path);
}

/**
 * 校验提交输入。
 * 入参：提交说明和已暂存文件数量。
 * 出参：合法时返回 null，否则返回中文错误说明。
 * 作用与流程：先拒绝空白提交说明，再确保 index 中至少有一项改动。
 */
export function validateCommit(message: string, stagedCount: number): string | null {
  if (!message.trim()) {
    return "提交说明不能为空";
  }
  if (stagedCount < 1) {
    return "请先暂存至少一个文件";
  }
  return null;
}

/**
 * 将 Tauri invoke 拒绝值规范化为 Git 错误。
 * 入参：结构化后端错误、普通 Error、字符串或未知值。
 * 出参：始终包含稳定错误码、消息和可选详情的 GitErrorPayload。
 * 作用与流程：优先保留合法后端错误码；其他值统一映射为 command_failed 并提取可读消息。
 */
export function normalizeGitError(value: unknown): GitErrorPayload {
  if (typeof value === "object" && value !== null) {
    const candidate = value as Partial<GitErrorPayload>;
    if (
      typeof candidate.code === "string" &&
      GIT_ERROR_CODES.has(candidate.code as GitErrorCode) &&
      typeof candidate.message === "string"
    ) {
      return {
        code: candidate.code as GitErrorCode,
        message: candidate.message,
        details: typeof candidate.details === "string" ? candidate.details : null,
      };
    }
    if (value instanceof Error) {
      return { code: "command_failed", message: value.message, details: null };
    }
  }
  return {
    code: "command_failed",
    message: typeof value === "string" ? value : "Git 操作失败",
    details: null,
  };
}

/**
 * 判断 Git 面板是否应展示仓库接入向导。
 * 入参：当前 Git 错误；尚未产生错误时为 null。
 * 出参：仅在初始状态或明确判定为非仓库时返回 true。
 * 作用与流程：把“尚未初始化”与权限、读写等异常分开，避免用初始化向导掩盖真实故障。
 */
export function shouldShowRepositorySetup(error: GitErrorPayload | null): boolean {
  return error === null || error.code === "not_repository";
}
