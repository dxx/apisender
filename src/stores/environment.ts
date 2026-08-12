import { create } from "zustand";
import { toast } from "sonner";

import * as api from "@/lib/tauri";
import { useWorkspaceStore } from "@/stores/workspace";

const TOAST_DEDUP_WINDOW_MS = 5000;
let lastErrorMessage: string | null = null;
let lastErrorTime = 0;

interface EnvironmentState {
  names: string[];
  activeEnv: string | null;
  vars: Record<string, string>;
  error: string | null;

  init: () => Promise<void>;
  refresh: () => Promise<void>;
  setActive: (name: string | null) => Promise<void>;
}

/**
 * 判断当前是否应向后端请求工作区环境数据。
 * 入参：workspace store 中的当前根目录，未打开工作区时为 null。
 * 出参：存在非空工作区根目录时返回 true。
 * 作用与流程：在欢迎页和工作区恢复完成前阻止环境 IPC，避免把正常的“未打开工作区”显示成错误。
 */
export function shouldRequestEnvironmentData(root: string | null): root is string {
  return typeof root === "string" && root.length > 0;
}

export const useEnvironmentStore = create<EnvironmentState>((set, get) => ({
  names: [],
  activeEnv: null,
  vars: {},
  error: null,

  init: async () => {
    await get().refresh();
  },

  /**
   * 刷新当前工作区的环境配置。
   * 入参：无；出参：Promise<void>。
   * 作用与流程：无工作区时清空本地状态并停止；有工作区时读取环境列表、当前选择及对应变量，失败时去重提示错误。
   */
  refresh: async () => {
    const root = useWorkspaceStore.getState().root;
    if (!shouldRequestEnvironmentData(root)) {
      set({ names: [], activeEnv: null, vars: {}, error: null });
      return;
    }
    try {
      const [names, activeEnv] = await Promise.all([
        api.listEnvironments(),
        api.getActiveEnvironment(root),
      ]);
      let vars: Record<string, string> = {};
      if (activeEnv) {
        vars = await api.getEnvironmentVars(activeEnv);
      }
      set({ names, activeEnv, vars });
    } catch (e) {
      const msg = String(e);
      set({ error: msg });
      const now = Date.now();
      if (msg !== lastErrorMessage || now - lastErrorTime > TOAST_DEDUP_WINDOW_MS) {
        toast.error(msg);
        lastErrorMessage = msg;
        lastErrorTime = now;
      }
    }
  },

  setActive: async (name) => {
    const root = useWorkspaceStore.getState().root;
    if (!root) return;
    await api.setActiveEnvironment(root, name);
    await get().refresh();
  },
}));
