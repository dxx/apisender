import { create, type StoreApi, type UseBoundStore } from "zustand";

import * as tauri from "../lib/tauri/git";
import { normalizeGitError } from "../lib/git-state";
import type {
  GitAvailability,
  GitBranch,
  GitCommit,
  GitErrorPayload,
  GitIdentity,
  GitRepositoryState,
} from "../lib/types";

export interface GitStoreApi {
  probe: () => Promise<GitAvailability>;
  status: () => Promise<GitRepositoryState>;
  listBranches: () => Promise<GitBranch[]>;
  listCommits: (skip?: number, limit?: number) => Promise<GitCommit[]>;
  getIdentity: () => Promise<GitIdentity>;
  stage: (paths: string[]) => Promise<void>;
  unstage: (paths: string[]) => Promise<void>;
  commit: (message: string) => Promise<GitCommit>;
  setIdentity: (name: string, email: string) => Promise<GitIdentity>;
  pull: () => Promise<GitRepositoryState>;
  push: (remote?: string, branch?: string) => Promise<GitRepositoryState>;
  createBranch: (name: string) => Promise<GitRepositoryState>;
  switchBranch: (name: string) => Promise<GitRepositoryState>;
  initWorkspace: (remoteUrl: string, defaultBranch: string) => Promise<GitRepositoryState>;
  connectOrigin: (remoteUrl: string) => Promise<GitRepositoryState>;
}

export interface GitStoreState {
  availability: GitAvailability | null;
  repository: GitRepositoryState | null;
  branches: GitBranch[];
  commits: GitCommit[];
  identity: GitIdentity | null;
  loading: boolean;
  writing: boolean;
  error: GitErrorPayload | null;
  hasMoreCommits: boolean;
  refresh: () => Promise<void>;
  refreshStatus: () => Promise<void>;
  loadMoreCommits: () => Promise<void>;
  stage: (paths: string[]) => Promise<void>;
  unstage: (paths: string[]) => Promise<void>;
  commit: (message: string) => Promise<GitCommit>;
  setIdentity: (name: string, email: string) => Promise<GitIdentity>;
  pull: () => Promise<void>;
  push: (remote?: string, branch?: string) => Promise<void>;
  createBranch: (name: string) => Promise<void>;
  switchBranch: (name: string) => Promise<void>;
  initWorkspace: (remoteUrl: string, defaultBranch: string) => Promise<void>;
  connectOrigin: (remoteUrl: string) => Promise<void>;
  clear: () => void;
  clearError: () => void;
}

const defaultApi: GitStoreApi = {
  probe: tauri.gitProbe,
  status: tauri.gitStatus,
  listBranches: tauri.gitListBranches,
  listCommits: tauri.gitListCommits,
  getIdentity: tauri.gitGetIdentity,
  stage: tauri.gitStage,
  unstage: tauri.gitUnstage,
  commit: tauri.gitCommit,
  setIdentity: tauri.gitSetIdentity,
  pull: tauri.gitPull,
  push: tauri.gitPush,
  createBranch: tauri.gitCreateBranch,
  switchBranch: tauri.gitSwitchBranch,
  initWorkspace: tauri.gitInitWorkspace,
  connectOrigin: tauri.gitConnectOrigin,
};

/**
 * 创建可注入 IPC 实现的 Git Zustand store。
 * 入参：Git IPC 适配器，默认使用真实 Tauri 命令。
 * 出参：可供 React 使用或测试直接调用的 Zustand store。
 * 作用与流程：集中管理探测、状态读取、写操作互斥 UI 标记、错误规范化及写后刷新。
 */
export function createGitStore(
  api: GitStoreApi = defaultApi,
): UseBoundStore<StoreApi<GitStoreState>> {
  return create<GitStoreState>((set, get) => {
    /**
     * 执行 Git 写操作并统一刷新。
     * 入参：写操作闭包和是否刷新完整分支/日志数据。
     * 出参：原写操作结果。
     * 作用与流程：设置 writing，捕获结构化错误，成功后刷新状态，最终恢复按钮可用性。
     */
    async function performWrite<T>(operation: () => Promise<T>, fullRefresh: boolean): Promise<T> {
      set({ writing: true, error: null });
      try {
        const result = await operation();
        if (fullRefresh) {
          await get().refresh();
        } else {
          await get().refreshStatus();
        }
        return result;
      } catch (cause) {
        const normalized = normalizeGitError(cause);
        set({ error: normalized });
        throw normalized;
      } finally {
        set({ writing: false });
      }
    }

    return {
      availability: null,
      repository: null,
      branches: [],
      commits: [],
      identity: null,
      loading: false,
      writing: false,
      error: null,
      hasMoreCommits: true,

      /**
       * 完整刷新 Git 面板数据。
       * 入参：无；出参：Promise<void>。
       * 作用与流程：探测 Git 后依次读取仓库状态，并行加载分支、首批提交和身份，失败时保留结构化错误。
       */
      refresh: async () => {
        set({ loading: true, error: null });
        try {
          const availability = await api.probe();
          set({ availability });
          if (!availability.available || !availability.supported) {
            set({
              availability,
              repository: null,
              branches: [],
              commits: [],
              identity: null,
              hasMoreCommits: false,
            });
            return;
          }
          const repository = await api.status();
          const [branches, commits, identity] = await Promise.all([
            api.listBranches(),
            api.listCommits(0, 50),
            api.getIdentity(),
          ]);
          set({
            availability,
            repository,
            branches,
            commits,
            identity,
            hasMoreCommits: commits.length === 50,
          });
        } catch (cause) {
          const normalized = normalizeGitError(cause);
          set({
            repository: null,
            branches: [],
            commits: [],
            identity: null,
            hasMoreCommits: false,
            error: normalized,
          });
        } finally {
          set({ loading: false });
        }
      },

      /**
       * 只刷新仓库文件与分支跟踪状态。
       * 入参：无；出参：Promise<void>。
       * 作用与流程：用于暂存等轻量写操作后重新读取 status，不重复加载提交历史。
       */
      refreshStatus: async () => {
        try {
          const repository = await api.status();
          set({ repository, error: null });
        } catch (cause) {
          const normalized = normalizeGitError(cause);
          set({ repository: null, error: normalized });
          throw normalized;
        }
      },

      /**
       * 加载下一页提交记录。
       * 入参：无；出参：Promise<void>。
       * 作用与流程：以当前提交数为偏移读取 50 条，追加到列表并更新是否还有更多记录。
       */
      loadMoreCommits: async () => {
        if (get().loading || !get().hasMoreCommits) return;
        set({ loading: true, error: null });
        try {
          const current = get().commits;
          const next = await api.listCommits(current.length, 50);
          set({ commits: [...current, ...next], hasMoreCommits: next.length === 50 });
        } catch (cause) {
          const normalized = normalizeGitError(cause);
          set({ error: normalized });
          throw normalized;
        } finally {
          set({ loading: false });
        }
      },

      /** 入参：仓库相对路径；出参：Promise<void>；作用与流程：暂存路径后刷新 status。 */
      stage: (paths) => performWrite(() => api.stage(paths), false),
      /** 入参：仓库相对路径；出参：Promise<void>；作用与流程：取消暂存后刷新 status。 */
      unstage: (paths) => performWrite(() => api.unstage(paths), false),
      /** 入参：提交说明；出参：新提交；作用与流程：创建提交后完整刷新仓库、分支和历史。 */
      commit: (message) => performWrite(() => api.commit(message), true),
      /** 入参：姓名和邮箱；出参：仓库身份；作用与流程：仅写仓库配置后完整刷新身份与面板数据。 */
      setIdentity: (name, email) => performWrite(() => api.setIdentity(name, email), true),
      /** 入参：无；出参：Promise<void>；作用与流程：仅快进拉取并完整刷新面板。 */
      pull: async () => {
        await performWrite(() => api.pull(), true);
      },
      /** 入参：首次推送可选远端和分支；出参：Promise<void>；作用与流程：推送并完整刷新 tracking 状态。 */
      push: async (remote, branch) => {
        await performWrite(() => api.push(remote, branch), true);
      },
      /** 入参：新分支名；出参：Promise<void>；作用与流程：创建并切换后完整刷新。 */
      createBranch: async (name) => {
        await performWrite(() => api.createBranch(name), true);
      },
      /** 入参：本地分支名；出参：Promise<void>；作用与流程：切换后完整刷新状态与历史。 */
      switchBranch: async (name) => {
        await performWrite(() => api.switchBranch(name), true);
      },
      /** 入参：空远端地址和默认分支；出参：Promise<void>；作用与流程：初始化后加载新仓库数据。 */
      initWorkspace: async (remoteUrl, defaultBranch) => {
        await performWrite(() => api.initWorkspace(remoteUrl, defaultBranch), true);
      },
      /** 入参：origin 地址；出参：Promise<void>；作用与流程：连接远端后刷新远端与 tracking 信息。 */
      connectOrigin: async (remoteUrl) => {
        await performWrite(() => api.connectOrigin(remoteUrl), true);
      },
      /** 入参：无；出参：无；作用与流程：关闭工作区时清空所有仓库相关状态。 */
      clear: () => {
        set({
          repository: null,
          branches: [],
          commits: [],
          identity: null,
          error: null,
          hasMoreCommits: true,
        });
      },
      /** 入参：无；出参：无；作用与流程：用户关闭提示后只清除当前结构化错误。 */
      clearError: () => set({ error: null }),
    };
  });
}

export const useGitStore = createGitStore();
