import { createGitStore, type GitStoreApi } from "./git";
import type { GitRepositoryState } from "@/lib/types";

/**
 * 断言两个值严格相等。
 * 入参：实际值、期望值和失败说明。
 * 出参：无；不相等时抛出异常。
 * 作用与流程：为 Git store 异步测试提供明确失败信息。
 */
function expectEqual<T>(actual: T, expected: T, message: string): void {
  if (actual !== expected) {
    throw new Error(`${message}: expected ${String(expected)}, got ${String(actual)}`);
  }
}

const repository: GitRepositoryState = {
  workspaceRoot: "/repo/subdir",
  repositoryRoot: "/repo",
  branch: "main",
  detached: false,
  upstream: "origin/main",
  ahead: 0,
  behind: 0,
  remotes: ["origin"],
  files: [],
  hasConflicts: false,
};

let statusReads = 0;
let stagedPaths: string[] = [];
let commitSkip = -1;
const api: GitStoreApi = {
  probe: async () => ({
    available: true,
    supported: true,
    version: "2.50.1",
    executable: "git",
    minimumVersion: "2.28",
  }),
  status: async () => {
    statusReads += 1;
    return repository;
  },
  listBranches: async () => [],
  listCommits: async (skip = 0) => {
    commitSkip = skip;
    return [];
  },
  getIdentity: async () => ({ name: "Test", email: "test@example.com" }),
  stage: async (paths) => {
    stagedPaths = paths;
  },
  unstage: async () => undefined,
  commit: async () => ({
    sha: "abcdef",
    shortSha: "abcdef",
    authorName: "Test",
    authorEmail: "test@example.com",
    authoredAt: "2026-08-12T00:00:00Z",
    subject: "测试提交",
  }),
  setIdentity: async (name, email) => ({ name, email }),
  pull: async () => repository,
  push: async () => repository,
  createBranch: async () => repository,
  switchBranch: async () => repository,
  initWorkspace: async () => repository,
  connectOrigin: async () => repository,
};

const store = createGitStore(api);
await store.getState().refresh();
expectEqual(store.getState().repository?.repositoryRoot, "/repo", "refresh should load repository state");
expectEqual(store.getState().identity?.email, "test@example.com", "refresh should load repository identity");

await store.getState().stage(["request.http"]);
expectEqual(stagedPaths.join(","), "request.http", "stage should forward selected paths");
expectEqual(statusReads, 2, "successful writes should refresh repository state");
expectEqual(store.getState().writing, false, "write flag should reset after completion");

await store.getState().loadMoreCommits();
expectEqual(commitSkip, 0, "empty history should request the first offset when loading more");

const missingRepositoryStore = createGitStore({
  ...api,
  status: async () => {
    throw { code: "not_repository", message: "not a repository", details: null };
  },
});
await missingRepositoryStore.getState().refresh();
expectEqual(
  missingRepositoryStore.getState().availability?.available,
  true,
  "successful probe state should survive a non-repository status error",
);
expectEqual(
  missingRepositoryStore.getState().error?.code,
  "not_repository",
  "status errors should remain available to repository setup routing",
);

console.log("git store tests passed");
