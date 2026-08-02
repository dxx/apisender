import { create } from "zustand";

import * as api from "@/lib/tauri";
import type { HistoryEntry } from "@/lib/types";

interface HistoryState {
  entries: HistoryEntry[];

  refresh: () => Promise<void>;
  clear: () => Promise<void>;
  remove: (id: number) => Promise<void>;
}

export const useHistoryStore = create<HistoryState>((set) => ({
  entries: [],

  refresh: async () => {
    try {
      const entries = await api.listHistory(200);
      set({ entries });
    } catch {}
  },

  clear: async () => {
    await api.clearHistory();
    set({ entries: [] });
  },

  remove: async (id) => {
    const ok = await api.deleteHistory(id);
    if (ok) {
      set((s) => ({ entries: s.entries.filter((e) => e.id !== id) }));
    }
  },
}));
