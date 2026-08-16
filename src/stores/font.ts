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

    set({ editorFontFamily, uiFontFamily, responseFontFamily, editorFontSize, responseFontSize, loaded: true });

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
      if (fonts.responseFontFamily !== responseFontFamily) {
        if (fonts.responseFontFamily) {
          applyResponseFontFamily(fonts.responseFontFamily);
          try {
            localStorage.setItem("responseFontFamily", fonts.responseFontFamily);
          } catch {}
        } else {
          clearResponseFontFamily();
          try {
            localStorage.removeItem("responseFontFamily");
          } catch {}
        }
        set({ responseFontFamily: fonts.responseFontFamily });
      }
    } catch (e) {
      console.error("[font] getFonts failed:", e);
    }

    try {
      const sizes = await api.getFontSizes();
      if (sizes.editorFontSize !== editorFontSize) {
        if (sizes.editorFontSize !== null) {
          applyEditorFontSize(sizes.editorFontSize);
          try {
            localStorage.setItem("editorFontSize", String(sizes.editorFontSize));
          } catch {}
        } else {
          clearEditorFontSize();
          try {
            localStorage.removeItem("editorFontSize");
          } catch {}
        }
        set({ editorFontSize: sizes.editorFontSize });
      }
      if (sizes.responseFontSize !== responseFontSize) {
        if (sizes.responseFontSize !== null) {
          applyResponseFontSize(sizes.responseFontSize);
          try {
            localStorage.setItem("responseFontSize", String(sizes.responseFontSize));
          } catch {}
        } else {
          clearResponseFontSize();
          try {
            localStorage.removeItem("responseFontSize");
          } catch {}
        }
        set({ responseFontSize: sizes.responseFontSize });
      }
    } catch (e) {
      console.error("[font] getFontSizes failed:", e);
    }
  },

  setEditorFontFamily: async (font) => {
    if (font) {
      applyEditorFontFamily(font);
      try {
        localStorage.setItem("editorFontFamily", font);
      } catch {}
    } else {
      clearEditorFontFamily();
      try {
        localStorage.removeItem("editorFontFamily");
      } catch {}
    }
    set({ editorFontFamily: font });
    try {
      await api.setEditorFontFamily(font);
    } catch (e) {
      console.error("[font] setEditorFontFamily IPC failed:", e);
    }
  },

  setUiFontFamily: async (font) => {
    if (font) {
      applyUiFontFamily(font);
      try {
        localStorage.setItem("uiFontFamily", font);
      } catch {}
    } else {
      clearUiFontFamily();
      try {
        localStorage.removeItem("uiFontFamily");
      } catch {}
    }
    set({ uiFontFamily: font });
    try {
      await api.setUiFontFamily(font);
    } catch (e) {
      console.error("[font] setUiFontFamily IPC failed:", e);
    }
  },

  setResponseFontFamily: async (font) => {
    if (font) {
      applyResponseFontFamily(font);
      try {
        localStorage.setItem("responseFontFamily", font);
      } catch {}
    } else {
      clearResponseFontFamily();
      try {
        localStorage.removeItem("responseFontFamily");
      } catch {}
    }
    set({ responseFontFamily: font });
    try {
      await api.setResponseFontFamily(font);
    } catch (e) {
      console.error("[font] setResponseFontFamily IPC failed:", e);
    }
  },

  setEditorFontSize: async (size) => {
    if (size !== null) {
      applyEditorFontSize(size);
      try {
        localStorage.setItem("editorFontSize", String(size));
      } catch {}
    } else {
      clearEditorFontSize();
      try {
        localStorage.removeItem("editorFontSize");
      } catch {}
    }
    set({ editorFontSize: size });
    try {
      await api.setEditorFontSize(size);
    } catch (e) {
      console.error("[font] setEditorFontSize IPC failed:", e);
    }
  },

  setResponseFontSize: async (size) => {
    if (size !== null) {
      applyResponseFontSize(size);
      try {
        localStorage.setItem("responseFontSize", String(size));
      } catch {}
    } else {
      clearResponseFontSize();
      try {
        localStorage.removeItem("responseFontSize");
      } catch {}
    }
    set({ responseFontSize: size });
    try {
      await api.setResponseFontSize(size);
    } catch (e) {
      console.error("[font] setResponseFontSize IPC failed:", e);
    }
  },
}));