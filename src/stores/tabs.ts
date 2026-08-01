import { create } from "zustand";

import * as api from "@/lib/tauri";
import type {
  HttpState,
  SseEvent,
  SseStartPayload,
  SseStatus,
  SseState,
  WsDirection,
  WsMessageRecord,
  WsState,
  GrpcState,
  GrpcStartPayload,
  GrpcMessageRecord,
  GrpcMetadataPayload,
} from "@/lib/types";

export interface Tab {
  path: string;
  name: string;
  content: string;
  savedContent: string;
  isDirty: boolean;
  editorState: unknown | null;
  http: HttpState;
  loading: boolean;
  sse: SseState | null;
  ws: WsState | null;
  grpc: GrpcState | null;
}

interface TabsState {
  tabs: Tab[];
  activePath: string | null;

  openFile: (path: string, name: string) => Promise<void>;
  closeTab: (path: string) => void;
  closeOtherTabs: (path: string, force?: boolean) => void;
  closeAllTabs: (force?: boolean) => void;
  setActive: (path: string) => void;
  updateContent: (path: string, content: string) => void;
  saveTab: (path: string) => Promise<void>;
  syncNormalizedContent: (path: string, content: string) => void;
  setHttp: (path: string, patch: Partial<HttpState>) => void;
  setLoading: (path: string, loading: boolean) => void;
  reloadFromDisk: (path: string) => Promise<void>;
  renameTab: (oldPath: string, newPath: string, newName: string) => void;
  getActive: () => Tab | null;
  saveEditorState: (path: string, state: unknown) => void;
  clearEditorState: (path: string) => void;
  startSse: (path: string, sse: SseState) => void;
  appendSseEvent: (path: string, reqId: string, event: SseEvent) => void;
  setSseStart: (path: string, reqId: string, startPayload: SseStartPayload) => void;
  setSseDone: (path: string, reqId: string, totalMs: number) => void;
  setSseError: (path: string, reqId: string, error: string) => void;
  setSseStop: (path: string) => void;
  startWs: (path: string, ws: WsState) => void;
  setWsOpen: (path: string, reqId: string, startPayload: WsState["startPayload"]) => void;
  appendWsMessage: (
    path: string,
    reqId: string,
    msg: { id: string; data: string; ts: number; index: number; direction: WsDirection }
  ) => void;
  setWsClose: (path: string, reqId: string, code: number, reason: string) => void;
  setWsIdleTimeout: (path: string, reqId: string, idleMs: number) => void;
  setWsError: (path: string, reqId: string, error: string) => void;
  setWsClosed: (path: string, reqId: string, totalMs: number) => void;
  startGrpc: (path: string, grpc: GrpcState) => void;
  setGrpcStart: (path: string, reqId: string, startPayload: GrpcStartPayload) => void;
  appendGrpcMessage: (path: string, reqId: string, msg: GrpcMessageRecord) => void;
  setGrpcInitialMetadata: (path: string, reqId: string, metadata: GrpcMetadataPayload["metadata"]) => void;
  setGrpcTrailingMetadata: (path: string, reqId: string, metadata: GrpcMetadataPayload["metadata"]) => void;
  setGrpcStatus: (path: string, reqId: string, code: number, message: string) => void;
  setGrpcError: (path: string, reqId: string, error: string) => void;
  setGrpcClosed: (path: string, reqId: string, totalMs: number, messageCount: number) => void;

  setGrpcStop: (path: string) => void;
}

export const useTabsStore = create<TabsState>((set, get) => ({
  tabs: [],
  activePath: null,

  openFile: async (path, name) => {
    const existing = get().tabs.find((t) => t.path === path);
    if (existing) {
      set({ activePath: path });
      return;
    }
    try {
      const content = await api.readFile(path);
      const tab: Tab = {
        path,
        name,
        content,
        savedContent: content,
        isDirty: false,
        editorState: null,
        http: { reqId: null, response: null, error: null },
        loading: false,
        sse: null,
        ws: null,
        grpc: null,
      };
      set((s) => ({ tabs: [...s.tabs, tab], activePath: path }));
    } catch (e) {
      console.error("Failed to open file:", e);
    }
  },

  closeTab: (path) => {
    set((s) => {
      const idx = s.tabs.findIndex((t) => t.path === path);
      const newTabs = s.tabs.filter((t) => t.path !== path);
      let newActive = s.activePath;
      if (s.activePath === path) {
        if (newTabs.length === 0) {
          newActive = null;
        } else if (idx >= newTabs.length) {
          newActive = newTabs[newTabs.length - 1].path;
        } else {
          newActive = newTabs[idx].path;
        }
      }
      return { tabs: newTabs, activePath: newActive };
    });
  },

  closeOtherTabs: (path, force = true) => {
    set((s) => {
      const targetIdx = s.tabs.findIndex((t) => t.path === path);
      if (targetIdx === -1) return s;
      const keep = s.tabs[targetIdx];
      const others = s.tabs.filter((t) => t.path !== path);
      const safe = others.filter((t) => t.isDirty && !force);
      const newTabs = [...safe, keep];
      return { tabs: newTabs, activePath: path };
    });
  },

  closeAllTabs: (force = true) => {
    set((s) => {
      const newTabs = s.tabs.filter((t) => t.isDirty && !force);
      return { tabs: newTabs, activePath: null };
    });
  },

  setActive: (path) => set({ activePath: path }),

  updateContent: (path, content) =>
    set((s) => ({
      tabs: s.tabs.map((t) =>
        t.path === path
          ? { ...t, content, isDirty: content !== t.savedContent }
          : t
      ),
    })),

  saveTab: async (path) => {
    const tab = get().tabs.find((t) => t.path === path);
    if (!tab) return;
    await api.saveFile(path, tab.content);
    set((s) => ({
      tabs: s.tabs.map((t) =>
        t.path === path ? { ...t, savedContent: t.content, isDirty: false } : t
      ),
    }));
  },

  syncNormalizedContent: (path, content) =>
    set((s) => ({
      tabs: s.tabs.map((t) =>
        t.path === path && !t.isDirty && t.content !== content
          ? { ...t, content, savedContent: content, isDirty: false }
          : t
      ),
    })),

  setHttp: (path, patch) =>
    set((s) => ({
      tabs: s.tabs.map((t) =>
        t.path === path ? { ...t, http: { ...t.http, ...patch } } : t
      ),
    })),

  setLoading: (path, loading) =>
    set((s) => ({
      tabs: s.tabs.map((t) =>
        t.path === path
          ? { ...t, loading, ...(loading ? { sse: null, ws: null, grpc: null } : {}) }
          : t
      ),
    })),

  reloadFromDisk: async (path) => {
    const tab = get().tabs.find((t) => t.path === path);
    if (!tab || tab.isDirty) return;
    try {
      const content = await api.readFile(path);
      set((s) => ({
        tabs: s.tabs.map((t) =>
          t.path === path
            ? { ...t, content, savedContent: content, isDirty: false, editorState: null }
            : t
        ),
      }));
    } catch {
      // File may have been deleted
    }
  },

  saveEditorState: (path, state) => {
    set((s) => ({
      tabs: s.tabs.map((t) =>
        t.path === path ? { ...t, editorState: state } : t
      ),
    }));
  },

  clearEditorState: (path) => {
    set((s) => ({
      tabs: s.tabs.map((t) =>
        t.path === path ? { ...t, editorState: null } : t
      ),
    }));
  },

  renameTab: (oldPath, newPath, newName) =>
    set((s) => ({
      tabs: s.tabs.map((t) =>
        t.path === oldPath ? { ...t, path: newPath, name: newName } : t
      ),
      activePath: s.activePath === oldPath ? newPath : s.activePath,
    })),

  getActive: () => {
    const { tabs, activePath } = get();
    return tabs.find((t) => t.path === activePath) ?? null;
  },

  startSse: (path, sse) =>
    set((s) => ({
      tabs: s.tabs.map((t) => (t.path === path ? { ...t, sse } : t)),
    })),

  appendSseEvent: (path, reqId, event) =>
    set((s) => ({
      tabs: s.tabs.map((t) =>
        t.path === path && t.sse?.reqId === reqId && (t.sse.status === "connecting" || t.sse.status === "streaming")
          ? { ...t, sse: { ...t.sse, status: "streaming" as SseStatus, events: [...t.sse.events, event] } }
          : t
      ),
    })),

  setSseStart: (path, _reqId, startPayload) =>
    set((s) => ({
      tabs: s.tabs.map((t) =>
        t.path === path && t.sse
          ? { ...t, sse: { ...t.sse, status: "streaming", startPayload } }
          : t
      ),
    })),

  setSseDone: (path, _reqId, totalMs) =>
    set((s) => ({
      tabs: s.tabs.map((t) =>
        t.path === path && t.sse
          ? {
              ...t,
              sse:
                t.sse.status === "error" || t.sse.status === "stop"
                  ? { ...t.sse, totalMs, loading: false }
                  : { ...t.sse, status: "done", totalMs, loading: false },
            }
          : t
      ),
    })),

  setSseStop: (path) =>
    set((s) => ({
      tabs: s.tabs.map((t) =>
        t.path === path && t.sse
          ? { ...t, sse: { ...t.sse, status: "stop" }, loading: false }
          : t
      ),
    })),

  setSseError: (path, _reqId, error) =>
    set((s) => ({
      tabs: s.tabs.map((t) =>
        t.path === path && t.sse
          ? { ...t, sse: { ...t.sse, status: "error", error }, loading: false }
          : t
      ),
    })),

  startWs: (path, ws) =>
    set((s) => ({
      tabs: s.tabs.map((t) => (t.path === path ? { ...t, ws } : t)),
    })),

  setWsOpen: (path, reqId, startPayload) =>
    set((s) => ({
      tabs: s.tabs.map((t) =>
        t.path === path && t.ws?.reqId === reqId
          ? { ...t, ws: { ...t.ws, status: "open", startPayload } }
          : t
      ),
    })),

  appendWsMessage: (path, reqId, msg) =>
    set((s) => ({
      tabs: s.tabs.map((t) => {
        if (t.path !== path || t.ws?.reqId !== reqId) return t;
        const live = t.ws.status === "connecting" || t.ws.status === "open";
        if (!live) return t;
        const record: WsMessageRecord = {
          id: msg.id,
          direction: msg.direction,
          data: msg.data,
          ts: msg.ts,
          index: msg.index,
        };
        return { ...t, ws: { ...t.ws, messages: [...t.ws.messages, record] } };
      }),
    })),

  setWsClose: (path, reqId, code, reason) =>
    set((s) => ({
      tabs: s.tabs.map((t) => {
        if (t.path !== path || t.ws?.reqId !== reqId) return t;
        return {
          ...t,
          ws: { ...t.ws, status: "closed", closeCode: code, closeReason: reason },
          loading: false,
        };
      }),
    })),

  setWsIdleTimeout: (path, reqId, idleMs) =>
    set((s) => ({
      tabs: s.tabs.map((t) =>
        t.path === path && t.ws?.reqId === reqId
          ? {
              ...t,
              ws: { ...t.ws, status: "idle_timeout", idleTimeoutMs: idleMs },
              loading: false,
            }
          : t
      ),
    })),

  setWsError: (path, reqId, error) =>
    set((s) => ({
      tabs: s.tabs.map((t) =>
        t.path === path && t.ws?.reqId === reqId
          ? { ...t, ws: { ...t.ws, status: "error", error }, loading: false }
          : t
      ),
    })),

  setWsClosed: (path, reqId, totalMs) =>
    set((s) => ({
      tabs: s.tabs.map((t) =>
        t.path === path && t.ws?.reqId === reqId
          ? { ...t, ws: { ...t.ws, totalMs } }
          : t
      ),
    })),

  startGrpc: (path, grpc) =>
    set((s) => ({
      tabs: s.tabs.map((t) => (t.path === path ? { ...t, grpc } : t)),
    })),

  setGrpcStart: (path, reqId, startPayload) =>
    set((s) => ({
      tabs: s.tabs.map((t) =>
        t.path === path && t.grpc?.reqId === reqId
          ? {
              ...t,
              grpc: {
                ...t.grpc,
                streamingKind: startPayload.streamingKind,
                startPayload,
                status: startPayload.streamingKind === "server-streaming" ? "streaming" : "connecting",
              },
            }
          : t
      ),
    })),

  appendGrpcMessage: (path, reqId, msg) =>
    set((s) => ({
      tabs: s.tabs.map((t) =>
        t.path === path && t.grpc?.reqId === reqId
          ? {
              ...t,
              grpc: {
                ...t.grpc,
                messages: [...t.grpc.messages, msg],
                messageCount: t.grpc.messageCount + 1,
                status: t.grpc.streamingKind === "server-streaming" ? "streaming" : t.grpc.status,
              },
            }
          : t
      ),
    })),

  setGrpcInitialMetadata: (path, reqId, metadata) =>
    set((s) => ({
      tabs: s.tabs.map((t) =>
        t.path === path && t.grpc?.reqId === reqId
          ? { ...t, grpc: { ...t.grpc, initialMetadata: metadata } }
          : t
      ),
    })),

  setGrpcTrailingMetadata: (path, reqId, metadata) =>
    set((s) => ({
      tabs: s.tabs.map((t) =>
        t.path === path && t.grpc?.reqId === reqId
          ? { ...t, grpc: { ...t.grpc, trailingMetadata: metadata } }
          : t
      ),
    })),

  setGrpcStatus: (path, reqId, code, message) =>
    set((s) => ({
      tabs: s.tabs.map((t) =>
        t.path === path && t.grpc?.reqId === reqId
          ? { ...t, grpc: { ...t.grpc, statusCode: code, statusMessage: message } }
          : t
      ),
    })),

  setGrpcError: (path, reqId, error) =>
    set((s) => ({
      tabs: s.tabs.map((t) =>
        t.path === path && t.grpc?.reqId === reqId
          ? { ...t, grpc: { ...t.grpc, status: "error", error }, loading: false }
          : t
      ),
    })),

  setGrpcClosed: (path, reqId, totalMs, messageCount) =>
    set((s) => ({
      tabs: s.tabs.map((t) =>
        t.path === path && t.grpc?.reqId === reqId
          ? {
              ...t,
              grpc:
                t.grpc.status === "error" || t.grpc.status === "stop"
                  ? { ...t.grpc, totalMs, messageCount, loading: false }
                  : { ...t.grpc, status: "done", totalMs, messageCount, loading: false },
            }
          : t
      ),
    })),

  setGrpcStop: (path) =>
    set((s) => ({
      tabs: s.tabs.map((t) =>
        t.path === path && t.grpc
          ? { ...t, grpc: { ...t.grpc, status: "stop" }, loading: false }
          : t
      ),
    })),

}));
