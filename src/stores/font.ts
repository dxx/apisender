import { create } from "zustand";

import * as api from "@/lib/tauri";

interface FontState {
  editorFontFamily: string | null;
  uiFontFamily: string | null;
  responseFontFamily: string | null;
  editorFontSize: number | null;
  responseFontSize: number | null;
  systemFonts: string[];
  loaded: boolean;
  init: () => Promise<void>;
  setEditorFontFamily: (font: string | null) => Promise<void>;
  setUiFontFamily: (font: string | null) => Promise<void>;
  setResponseFontFamily: (font: string | null) => Promise<void>;
  setEditorFontSize: (size: number | null) => Promise<void>;
  setResponseFontSize: (size: number | null) => Promise<void>;
}

function applyEditorFontFamily(font: string) {
  document.documentElement.style.setProperty("--font-editor-custom", `"${font}"`);
}

function clearEditorFontFamily() {
  document.documentElement.style.removeProperty("--font-editor-custom");
}

function applyUiFontFamily(font: string) {
  document.documentElement.style.setProperty("--font-ui-custom", `"${font}"`);
}

function clearUiFontFamily() {
  document.documentElement.style.removeProperty("--font-ui-custom");
}

function applyResponseFontFamily(font: string) {
  document.documentElement.style.setProperty("--font-response-custom", `"${font}"`);
}

function clearResponseFontFamily() {
  document.documentElement.style.removeProperty("--font-response-custom");
}

function applyEditorFontSize(size: number) {
  document.documentElement.style.setProperty("--text-editor-size-custom", `${size}px`);
}

function clearEditorFontSize() {
  document.documentElement.style.removeProperty("--text-editor-size-custom");
}

function applyResponseFontSize(size: number) {
  document.documentElement.style.setProperty("--text-response-size-custom", `${size}px`);
}

function clearResponseFontSize() {
  document.documentElement.style.removeProperty("--text-response-size-custom");
}

function applyFamily(
  value: string | null,
  apply: (font: string) => void,
  clear: () => void,
) {
  if (value) {
    apply(value);
  } else {
    clear();
  }
}

function applySize(
  value: number | null,
  apply: (size: number) => void,
  clear: () => void,
) {
  if (value !== null) {
    apply(value);
  } else {
    clear();
  }
}

function syncFontFamily(
  value: string | null,
  apply: (font: string) => void,
  clear: () => void,
  storageKey: string,
) {
  applyFamily(value, apply, clear);
  try {
    if (value) {
      localStorage.setItem(storageKey, value);
    } else {
      localStorage.removeItem(storageKey);
    }
  } catch {}
}

function syncFontSize(
  value: number | null,
  apply: (size: number) => void,
  clear: () => void,
  storageKey: string,
) {
  applySize(value, apply, clear);
  try {
    if (value !== null) {
      localStorage.setItem(storageKey, String(value));
    } else {
      localStorage.removeItem(storageKey);
    }
  } catch {}
}

export const useFontStore = create<FontState>((set, get) => ({
  editorFontFamily: null,
  uiFontFamily: null,
  responseFontFamily: null,
  editorFontSize: null,
  responseFontSize: null,
  systemFonts: [],
  loaded: false,

  init: async () => {
    if (get().loaded) return;

    let editorFontFamily: string | null = null;
    let uiFontFamily: string | null = null;
    let responseFontFamily: string | null = null;
    let editorFontSize: number | null = null;
    let responseFontSize: number | null = null;
    try {
      editorFontFamily = localStorage.getItem("editorFontFamily");
      uiFontFamily = localStorage.getItem("uiFontFamily");
      responseFontFamily = localStorage.getItem("responseFontFamily");
      const editorSizeRaw = localStorage.getItem("editorFontSize");
      const responseSizeRaw = localStorage.getItem("responseFontSize");
      editorFontSize = editorSizeRaw ? Number(editorSizeRaw) : null;
      responseFontSize = responseSizeRaw ? Number(responseSizeRaw) : null;
      if (editorFontSize !== null && Number.isNaN(editorFontSize)) editorFontSize = null;
      if (responseFontSize !== null && Number.isNaN(responseFontSize)) responseFontSize = null;
    } catch {}

    // 立即把 localStorage 里的值应用到 CSS 变量，避免页面加载后编辑器/响应区域使用默认字体
    applyFamily(editorFontFamily, applyEditorFontFamily, clearEditorFontFamily);
    applyFamily(uiFontFamily, applyUiFontFamily, clearUiFontFamily);
    applyFamily(responseFontFamily, applyResponseFontFamily, clearResponseFontFamily);
    applySize(editorFontSize, applyEditorFontSize, clearEditorFontSize);
    applySize(responseFontSize, applyResponseFontSize, clearResponseFontSize);

    set({ editorFontFamily, uiFontFamily, responseFontFamily, editorFontSize, responseFontSize, loaded: true });

    try {
      const fonts = await api.listSystemFonts();
      set({ systemFonts: fonts });
    } catch (e) {
      console.error("[font] listSystemFonts failed:", e);
    }

    try {
      const fonts = await api.getFonts();
      // 始终以 Rust 端配置为准，重新应用 CSS 变量并同步 localStorage
      editorFontFamily = fonts.editorFontFamily;
      uiFontFamily = fonts.uiFontFamily;
      responseFontFamily = fonts.responseFontFamily;
      syncFontFamily(editorFontFamily, applyEditorFontFamily, clearEditorFontFamily, "editorFontFamily");
      syncFontFamily(uiFontFamily, applyUiFontFamily, clearUiFontFamily, "uiFontFamily");
      syncFontFamily(responseFontFamily, applyResponseFontFamily, clearResponseFontFamily, "responseFontFamily");
      set({ editorFontFamily, uiFontFamily, responseFontFamily });
    } catch (e) {
      console.error("[font] getFonts failed:", e);
    }

    try {
      const sizes = await api.getFontSizes();
      editorFontSize = sizes.editorFontSize;
      responseFontSize = sizes.responseFontSize;
      syncFontSize(editorFontSize, applyEditorFontSize, clearEditorFontSize, "editorFontSize");
      syncFontSize(responseFontSize, applyResponseFontSize, clearResponseFontSize, "responseFontSize");
      set({ editorFontSize, responseFontSize });
    } catch (e) {
      console.error("[font] getFontSizes failed:", e);
    }
  },

  setEditorFontFamily: async (font) => {
    syncFontFamily(font, applyEditorFontFamily, clearEditorFontFamily, "editorFontFamily");
    set({ editorFontFamily: font });
    try {
      await api.setEditorFontFamily(font);
    } catch (e) {
      console.error("[font] setEditorFontFamily IPC failed:", e);
    }
  },

  setUiFontFamily: async (font) => {
    syncFontFamily(font, applyUiFontFamily, clearUiFontFamily, "uiFontFamily");
    set({ uiFontFamily: font });
    try {
      await api.setUiFontFamily(font);
    } catch (e) {
      console.error("[font] setUiFontFamily IPC failed:", e);
    }
  },

  setResponseFontFamily: async (font) => {
    syncFontFamily(font, applyResponseFontFamily, clearResponseFontFamily, "responseFontFamily");
    set({ responseFontFamily: font });
    try {
      await api.setResponseFontFamily(font);
    } catch (e) {
      console.error("[font] setResponseFontFamily IPC failed:", e);
    }
  },

  setEditorFontSize: async (size) => {
    syncFontSize(size, applyEditorFontSize, clearEditorFontSize, "editorFontSize");
    set({ editorFontSize: size });
    try {
      await api.setEditorFontSize(size);
    } catch (e) {
      console.error("[font] setEditorFontSize IPC failed:", e);
    }
  },

  setResponseFontSize: async (size) => {
    syncFontSize(size, applyResponseFontSize, clearResponseFontSize, "responseFontSize");
    set({ responseFontSize: size });
    try {
      await api.setResponseFontSize(size);
    } catch (e) {
      console.error("[font] setResponseFontSize IPC failed:", e);
    }
  },
}));