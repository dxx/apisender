import {
  getDirtyTabPaths,
  getGitOperationPaths,
  groupGitFiles,
  normalizeGitError,
  shouldShowRepositorySetup,
  validateCommit,
} from "./git-state";
import type { GitFileStatus } from "./types";

/**
 * 断言两个值严格相等。
 * 入参：实际值、期望值和失败说明。
 * 出参：无；不相等时抛出异常。
 * 作用与流程：为无测试框架的轻量脚本提供明确失败信息。
 */
function expectEqual<T>(actual: T, expected: T, message: string): void {
  if (actual !== expected) {
    throw new Error(`${message}: expected ${String(expected)}, got ${String(actual)}`);
  }
}

/**
 * 创建 Git 文件状态测试对象。
 * 入参：需要覆盖的状态字段。
 * 出参：字段完整的 GitFileStatus。
 * 作用与流程：补齐默认路径和空状态，降低分组测试重复内容。
 */
function file(patch: Partial<GitFileStatus> & Pick<GitFileStatus, "path">): GitFileStatus {
  return {
    originalPath: null,
    indexStatus: null,
    worktreeStatus: null,
    conflict: false,
    untracked: false,
    ...patch,
  };
}

const both = file({ path: "both.http", indexStatus: "M", worktreeStatus: "M" });
const groups = groupGitFiles([
  both,
  file({ path: "staged.json", indexStatus: "A" }),
  file({ path: "new.proto", worktreeStatus: "?", untracked: true }),
  file({ path: "conflict.http", indexStatus: "U", worktreeStatus: "U", conflict: true }),
]);

expectEqual(groups.staged.length, 2, "partially staged files should remain in staged group");
expectEqual(groups.unstaged.length, 1, "partially staged files should also remain in unstaged group");
expectEqual(groups.untracked[0]?.path, "new.proto", "untracked files should have their own group");
expectEqual(groups.conflicts[0]?.path, "conflict.http", "conflicts should have the highest-priority group");

expectEqual(
  getGitOperationPaths([
    file({ path: "renamed.http", originalPath: "old.http", indexStatus: "R" }),
    file({ path: "plain.http", indexStatus: "M" }),
  ]).join(","),
  "renamed.http,old.http,plain.http",
  "rename operations should include both current and original paths",
);

const dirty = getDirtyTabPaths([
  { path: "/repo/saved.http", isDirty: false },
  { path: "/repo/dirty.http", isDirty: true },
]);
expectEqual(dirty.join(","), "/repo/dirty.http", "only unsaved tabs should block Git writes");

expectEqual(validateCommit("", 1), "提交说明不能为空", "empty commit messages should be rejected");
expectEqual(validateCommit("同步接口", 0), "请先暂存至少一个文件", "empty index should be rejected");
expectEqual(validateCommit("同步接口", 1), null, "valid commits should pass validation");

expectEqual(
  normalizeGitError({ code: "authentication_failed", message: "认证失败", details: null }).code,
  "authentication_failed",
  "structured backend errors should preserve their code",
);
expectEqual(
  normalizeGitError("plain failure").message,
  "plain failure",
  "plain invocation errors should remain readable",
);
expectEqual(
  shouldShowRepositorySetup({ code: "not_repository", message: "not repo", details: null }),
  true,
  "non-repository workspaces should show setup",
);
expectEqual(
  shouldShowRepositorySetup({ code: "io", message: "permission denied", details: null }),
  false,
  "unexpected status errors should not be presented as setup",
);

console.log("git state tests passed");
