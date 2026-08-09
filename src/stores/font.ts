import { create } from "zustand";

import * as api from "@/lib/tauri";

interface FontState {
  editorFontFamily: string | null;
  uiFontFamily: string | null;
  systemFonts: string[];
  loaded: boolean;
  init: () => Promise<void>;
  setEditorFontFamily: (font: string) => Promise<void>;
  setUiFontFamily: (font: string) => Promise<void>;
}

function applyEditorFontFamily(font: string) {
  document.documentElement.style.setProperty("--font-mono-custom", `"${font}"`);
}

function clearEditorFontFamily() {
  document.documentElement.style.removeProperty("--font-mono-custom");
}

function applyUiFontFamily(font: string) {
  document.documentElement.style.setProperty("--font-sans-custom", `"${font}"`);
}

function clearUiFontFamily() {
  document.documentElement.style.removeProperty("--font-sans-custom");
}

export const useFontStore = create<FontState>((set, get) => ({
  editorFontFamily: null,
  uiFontFamily: null,
  systemFonts: [],
  loaded: false,

  init: async () => {
    if (get().loaded) return;

    let editorFontFamily: string | null = null;
    let uiFontFamily: string | null = null;
    try {
      editorFontFamily = localStorage.getItem("editorFontFamily");
      uiFontFamily = localStorage.getItem("uiFontFamily");
    } catch {}

    set({ editorFontFamily, uiFontFamily, loaded: true });

    try {
      const fonts = await api.listSystemFonts();
      set({ systemFonts: fonts });
    } catch (e) {
      console.error("[font] listSystemFonts failed:", e);
    }

    try {
      const fonts = await api.getFonts();
      if (fonts.editorFontFamily !== editorFontFamily) {
        if (fonts.editorFontFamily) {
          applyEditorFontFamily(fonts.editorFontFamily);
          try {
            localStorage.setItem("editorFontFamily", fonts.editorFontFamily);
          } catch {}
        } else {
          clearEditorFontFamily();
          try {
            localStorage.removeItem("editorFontFamily");
          } catch {}
        }
        set({ editorFontFamily: fonts.editorFontFamily });
      }
      if (fonts.uiFontFamily !== uiFontFamily) {
        if (fonts.uiFontFamily) {
          applyUiFontFamily(fonts.uiFontFamily);
          try {
            localStorage.setItem("uiFontFamily", fonts.uiFontFamily);
          } catch {}
        } else {
          clearUiFontFamily();
          try {
            localStorage.removeItem("uiFontFamily");
          } catch {}
        }
        set({ uiFontFamily: fonts.uiFontFamily });
      }
    } catch (e) {
      console.error("[font] getFonts failed:", e);
    }
  },

  setEditorFontFamily: async (font) => {
    applyEditorFontFamily(font);
    try {
      localStorage.setItem("editorFontFamily", font);
    } catch {}
    set({ editorFontFamily: font });
    try {
      await api.setEditorFontFamily(font);
    } catch (e) {
      console.error("[font] setEditorFontFamily IPC failed:", e);
    }
  },

  setUiFontFamily: async (font) => {
    applyUiFontFamily(font);
    try {
      localStorage.setItem("uiFontFamily", font);
    } catch {}
    set({ uiFontFamily: font });
    try {
      await api.setUiFontFamily(font);
    } catch (e) {
      console.error("[font] setUiFontFamily IPC failed:", e);
    }
  },
}));