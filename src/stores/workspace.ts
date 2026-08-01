import { create } from "zustand";

import * as api from "@/lib/tauri";
import type { FileTreeNode, RecentWorkspace } from "@/lib/types";
import { useTabsStore } from "@/stores/tabs";

interface WorkspaceState {
  root: string | null;
  tree: FileTreeNode[];
  recentWorkspaces: RecentWorkspace[];
  loading: boolean;
  error: string | null;

  init: () => Promise<void>;
  openFolder: (path?: string) => Promise<void>;
  openDialog: () => Promise<void>;
  closeWorkspace: () => Promise<void>;
  refreshTree: () => Promise<void>;
  removeRecent: (path: string) => Promise<void>;
  setError: (err: string | null) => void;
}

export const useWorkspaceStore = create<WorkspaceState>((set, get) => ({
  root: null,
  tree: [],
  recentWorkspaces: [],
  loading: false,
  error: null,

  init: async () => {
    set({ loading: true });
    try {
      let root = await api.getWorkspacePath();
      if (!root) {
        const last = await api.getLastWorkspace();
        if (last) {
          try {
            await api.openWorkspace(last);
            root = last;
          } catch {
            // last workspace may no longer exist
          }
        }
      }
      const recent = await api.listRecentWorkspaces();
      set({ root, recentWorkspaces: recent, loading: false });
      if (root) {
        await get().refreshTree();
      }
    } catch (e) {
      set({ loading: false, error: String(e) });
    }
  },

  openFolder: async (path?: string) => {
    set({ loading: true, error: null });
    try {
      const p = path ?? (await get().openDialog().then(() => undefined));
      if (!p) {
        set({ loading: false });
        return;
      }
      await api.openWorkspace(p);
      useTabsStore.getState().closeAllTabs(true);
      const [recent] = await Promise.all([api.listRecentWorkspaces()]);
      set({ root: p, recentWorkspaces: recent, loading: false });
      await get().refreshTree();
    } catch (e) {
      set({ loading: false, error: String(e) });
    }
  },

  openDialog: async () => {
    const path = await api.openFileDialog();
    if (path) {
      await get().openFolder(path);
    }
  },

  closeWorkspace: async () => {
    set({ loading: true });
    try {
      await api.closeWorkspace();
      useTabsStore.getState().closeAllTabs(true);
      set({ root: null, tree: [], loading: false });
    } catch (e) {
      set({ loading: false, error: String(e) });
    }
  },

  refreshTree: async () => {
    const { root } = get();
    if (!root) return;
    try {
      const tree = await api.getFileTree();
      set({ tree });
    } catch (e) {
      set({ error: String(e) });
    }
  },

  removeRecent: async (path: string) => {
    await api.removeRecentWorkspace(path);
    const recent = await api.listRecentWorkspaces();
    set({ recentWorkspaces: recent });
  },

  setError: (err) => set({ error: err }),
}));
