import { create } from "zustand";

import * as api from "@/lib/tauri";

export type Theme = "light" | "dark" | "system";

interface ThemeState {
  theme: Theme;
  resolved: "light" | "dark";
  init: () => Promise<void>;
  setTheme: (t: Theme) => Promise<void>;
}

function computeResolved(theme: Theme): "light" | "dark" {
  if (theme === "system") {
    return window.matchMedia("(prefers-color-scheme: dark)").matches
      ? "dark"
      : "light";
  }
  return theme;
}

export function applyResolved(resolved: "light" | "dark") {
  document.documentElement.classList.toggle("dark", resolved === "dark");
}

export const useThemeStore = create<ThemeState>((set) => ({
  theme: "system",
  resolved: computeResolved("system"),

  init: async () => {
    try {
      const stored = await api.getTheme();
      const theme: Theme =
        stored === "light" || stored === "dark" || stored === "system"
          ? stored
          : "system";
      const resolved = computeResolved(theme);
      set({ theme, resolved });
      applyResolved(resolved);
    } catch (e) {
      console.error("[theme] init failed:", e);
    }
  },

  setTheme: async (t) => {
    const resolved = computeResolved(t);
    set({ theme: t, resolved });
    applyResolved(resolved);
    try {
      localStorage.setItem("theme", t);
    } catch {}
    try {
      await api.setTheme(t);
    } catch (e) {
      console.error("[theme] setTheme failed:", e);
    }
  },
}));
