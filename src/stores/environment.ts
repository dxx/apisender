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

export const useEnvironmentStore = create<EnvironmentState>((set, get) => ({
  names: [],
  activeEnv: null,
  vars: {},
  error: null,

  init: async () => {
    await get().refresh();
  },

  refresh: async () => {
    try {
      const root = useWorkspaceStore.getState().root;
      const [names, activeEnv] = await Promise.all([
        api.listEnvironments(),
        root ? api.getActiveEnvironment(root) : Promise.resolve(null),
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
