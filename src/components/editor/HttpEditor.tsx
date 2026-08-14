import { useEffect, useRef, useCallback } from "react";
import { EditorState, RangeSet, StateField, type Transaction } from "@codemirror/state";
import {
  EditorView,
  keymap,
  gutter,
  GutterMarker,
  lineNumbers,
  highlightActiveLine,
  highlightActiveLineGutter,
  drawSelection,
} from "@codemirror/view";
import { defaultKeymap, history, historyKeymap, indentWithTab, historyField } from "@codemirror/commands";
import {
  bracketMatching,
  foldEffect,
  foldedRanges,
  foldState,
  unfoldEffect,
} from "@codemirror/language";
import { searchKeymap, highlightSelectionMatches, search } from "@codemirror/search";
import { Terminal, Scissors, Copy, ClipboardPaste } from "lucide-react";
import { toast } from "sonner";

import type { Tab } from "@/stores/tabs";
import { useTabsStore } from "@/stores/tabs";
import { useEnvironmentStore } from "@/stores/environment";
import { executeHttp, toCurl, copyText, pasteText, executeSse, executeWebSocket, closeWebSocket, stopSse, executeGrpc, stopGrpc } from "@/lib/tauri";
import { curlToHttpText } from "@/lib/curl-parse";
import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuSeparator,
  ContextMenuTrigger,
} from "@/components/ui/context-menu";
import { httpLanguage } from "./http-lang";
import {
  collectHttpFoldRanges,
  httpFoldingExtensions,
  refreshHttpFoldPlaceholders,
  selectHttpFoldControls,
} from "./http-folding";
import { SEND_ICON_SVG_HTML } from "./SendIcon";
import { syntaxHighlightingExt } from "./syntax-theme";
import { searchPanelTheme, searchAutocompleteDisabler } from "./search-panel-theme";
import { detectSse, detectWs, detectGrpc } from "@/lib/utils/editor";

const METHOD_RE = /^(GET|POST|PUT|DELETE|PATCH|HEAD|OPTIONS|CONNECT|TRACE|WEBSOCKET|GRPC)\b/i;
const URL_RE = /^https?:\/\/\S+/i;
const MAX_HISTORY_DEPTH = 100;
const STATE_FIELDS = { history: historyField, fold: foldState };

interface FoldControlRange {
  from: number;
  to: number;
  folded: boolean;
}

interface EditorControlMarkerInfo {
  canRun: boolean;
  foldRange: FoldControlRange | null;
}

function truncateEditorHistory(state: any, maxDepth: number) {
  const history = state?.history;
  if (history?.undo && Array.isArray(history.undo) && history.undo.length > maxDepth) {
    history.undo = history.undo.slice(-maxDepth);
  }
  if (history?.redo && Array.isArray(history.redo) && history.redo.length > maxDepth) {
    history.redo = history.redo.slice(-maxDepth);
  }
}

class EditorControlGutterMarker extends GutterMarker {

  constructor(private readonly info: EditorControlMarkerInfo) {
    super();
  }

  eq(other: GutterMarker): boolean {
    if (!(other instanceof EditorControlGutterMarker)) return false;
    return (
      this.info.canRun === other.info.canRun &&
      this.info.foldRange?.from === other.info.foldRange?.from &&
      this.info.foldRange?.to === other.info.foldRange?.to &&
      this.info.foldRange?.folded === other.info.foldRange?.folded
    );
  }

  toDOM() {
    const wrapper = document.createElement("span");
    wrapper.className = "cm-editor-control-gutter";
    if (this.info.canRun) {
      wrapper.append(createRunGutterButton());
    } else if (this.info.foldRange) {
      wrapper.append(createFoldGutterButton(this.info.foldRange));
    }
    return wrapper;
  }
}

function createRunGutterButton(): HTMLElement {
  const btn = document.createElement("span");
  btn.className = "cm-run-gutter-btn";
  btn.title = "发送请求";
  btn.setAttribute("aria-hidden", "true");
  btn.innerHTML = SEND_ICON_SVG_HTML;
  return btn;
}

function createFoldGutterButton(foldRange: FoldControlRange): HTMLElement {
  const btn = document.createElement("span");
  btn.className = "cm-http-fold-gutter-btn";
  btn.title = foldRange.folded ? "展开" : "折叠";
  btn.dataset.foldFrom = String(foldRange.from);
  btn.dataset.foldTo = String(foldRange.to);
  btn.dataset.folded = foldRange.folded ? "true" : "false";
  btn.setAttribute("aria-hidden", "true");
  btn.innerHTML = foldRange.folded
    ? `<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><polyline points="9 18 15 12 9 6"/></svg>`
    : `<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><polyline points="6 9 12 15 18 9"/></svg>`;
  return btn;
}

function computeEditorControlMarkers(state: EditorState): RangeSet<GutterMarker> {
  const markers = new Map<number, EditorControlMarkerInfo>();
  addRunControls(state, markers);
  addFoldControls(state, markers);

  const ranges = Array.from(markers.entries())
    .map(([lineNumber, info]) => new EditorControlGutterMarker(info).range(state.doc.line(lineNumber).from))
    .sort((a, b) => a.from - b.from);
  return RangeSet.of(ranges);
}

function addRunControls(state: EditorState, markers: Map<number, EditorControlMarkerInfo>): void {
  const lines = state.doc.lines;
  let inBlock = false;
  let blockHasMethod = false;

  for (let i = 1; i <= lines; i++) {
    const line = state.doc.line(i);
    const text = line.text.trim();

    // 只有三个 # 开头才算块分隔符（##、# 不算）
    if (text.startsWith("###")) {
      inBlock = true;
      blockHasMethod = false;
      continue;
    }

    // 在 ### 块内，取第一个 method/URL 行
    if (
      inBlock &&
      !blockHasMethod &&
      (METHOD_RE.test(text) || URL_RE.test(text))
    ) {
      getOrCreateControlMarkerInfo(markers, line.number).canRun = true;
      blockHasMethod = true;
    }
  }
}

function addFoldControls(state: EditorState, markers: Map<number, EditorControlMarkerInfo>): void {
  const foldControls = selectHttpFoldControls(collectHttpFoldRanges(state.doc.toString()));
  for (const range of foldControls) {
    const info = getOrCreateControlMarkerInfo(markers, range.lineFrom);
    if (info.canRun) continue;
    info.foldRange = {
      from: range.from,
      to: range.to,
      folded: isFoldRangeFolded(state, range.from, range.to),
    };
  }
}

function getOrCreateControlMarkerInfo(
  markers: Map<number, EditorControlMarkerInfo>,
  lineNumber: number,
): EditorControlMarkerInfo {
  const existing = markers.get(lineNumber);
  if (existing) return existing;
  const created: EditorControlMarkerInfo = { canRun: false, foldRange: null };
  markers.set(lineNumber, created);
  return created;
}

function isFoldRangeFolded(state: EditorState, from: number, to: number): boolean {
  let folded = false;
  foldedRanges(state).between(from, to, (rangeFrom, rangeTo) => {
    if (rangeFrom === from && rangeTo === to) {
      folded = true;
      return false;
    }
    return undefined;
  });
  return folded;
}

function readFoldButtonRange(button: HTMLElement): { from: number; to: number } | null {
  const from = Number(button.dataset.foldFrom);
  const to = Number(button.dataset.foldTo);
  if (!Number.isFinite(from) || !Number.isFinite(to) || from >= to) return null;
  return { from, to };
}

function toggleFoldRange(view: EditorView, range: { from: number; to: number }): void {
  const effect = isFoldRangeFolded(view.state, range.from, range.to)
    ? unfoldEffect.of(range)
    : foldEffect.of(range);
  view.dispatch({ effects: effect });
  view.focus();
}

function shouldRefreshControlMarkers(tr: Transaction): boolean {
  return tr.docChanged || tr.effects.some((effect) => effect.is(foldEffect) || effect.is(unfoldEffect));
}

const runMarkerField = StateField.define<RangeSet<GutterMarker>>({
  create: (state) => computeEditorControlMarkers(state),
  update: (markers, tr) => {
    if (shouldRefreshControlMarkers(tr)) {
      return computeEditorControlMarkers(tr.state);
    }
    return markers;
  },
});

const runGutter = gutter({
  class: "cm-run-gutter",
  markers: (view) => view.state.field(runMarkerField),
  initialSpacer: () => new EditorControlGutterMarker({ canRun: true, foldRange: null }),
});

interface HttpEditorProps {
  tab: Tab;
}

export function HttpEditor({ tab }: HttpEditorProps) {
  const editorRef = useRef<HTMLDivElement>(null);
  const viewRef = useRef<EditorView | null>(null);
  const updateContent = useTabsStore((s) => s.updateContent);
  const setHttp = useTabsStore((s) => s.setHttp);
  const setLoading = useTabsStore((s) => s.setLoading);
  const startSse = useTabsStore((s) => s.startSse);
  const setSseError = useTabsStore((s) => s.setSseError);
  const startWs = useTabsStore((s) => s.startWs);
  const setWsError = useTabsStore((s) => s.setWsError);
  const startGrpc = useTabsStore((s) => s.startGrpc);
  const setGrpcError = useTabsStore((s) => s.setGrpcError);
  const activeEnv = useEnvironmentStore((s) => s.activeEnv);
  const tabRef = useRef(tab);
  tabRef.current = tab;
  const envRef = useRef(activeEnv);
  envRef.current = activeEnv;

  const handleRun = useCallback(
    async (lineNumber: number) => {
      const currentTab = tabRef.current;
      if (!currentTab) return;
      const isWs = detectWs(currentTab.content, lineNumber);
      const isSse = detectSse(currentTab.content, lineNumber);
      const isGrpc = detectGrpc(currentTab.content, lineNumber);
      const prevTab = useTabsStore
        .getState()
        .tabs.find((t) => t.path === currentTab.path);
      if (isWs && prevTab?.ws && (prevTab.ws.status === "connecting" || prevTab.ws.status === "open")) {
        try {
          await closeWebSocket(prevTab.ws.reqId);
        } catch {
          // 旧连接已不在后端，忽略
        }
      } else if (
        isSse &&
        prevTab?.sse &&
        (prevTab.sse.status === "connecting" || prevTab.sse.status === "streaming")
      ) {
        try {
          await stopSse(prevTab.sse.reqId);
        } catch {
          // 旧连接已不在后端，忽略
        }
      } else if (isGrpc && prevTab?.grpc &&
        (prevTab.grpc.status === "connecting" || prevTab.grpc.status === "streaming")) {
        try {
          await stopGrpc(prevTab.grpc.reqId);
        } catch {
          // 旧连接已不在后端，忽略
        }
      }
      setLoading(currentTab.path, true);
      if (isWs) {
        await runWs(currentTab, lineNumber);
        return;
      }
      if (isSse) {
        await runSse(currentTab, lineNumber);
        return;
      }
      if (isGrpc) {
        await runGrpc(currentTab, lineNumber);
        return;
      }
      try {
        const reqId = crypto.randomUUID();
        setHttp(currentTab.path, { reqId, error: null, response: null });
        const result = await executeHttp({
          reqId,
          rawText: currentTab.content,
          lineOffset: lineNumber - 1,
          envName: envRef.current,
          filePath: currentTab.path,
        });
        setHttp(currentTab.path, { response: result });
      } catch (e) {
        setHttp(currentTab.path, { error: String(e) });
      } finally {
        setLoading(currentTab.path, false);
      }
    },
    [setHttp, setLoading, startSse, startWs]
  );

  const runSse = useCallback(
    async (currentTab: Tab, lineNumber: number) => {
      const reqId = crypto.randomUUID();
      startSse(currentTab.path, { reqId, status: "connecting", events: [], startPayload: null, totalMs: null, error: null });
      try {
        await executeSse({
          reqId,
          rawText: currentTab.content,
          lineOffset: lineNumber - 1,
          envName: envRef.current,
          filePath: currentTab.path,
        });
      } catch (e) {
        setSseError(currentTab.path, reqId, String(e));
        setLoading(currentTab.path, false);
      }
    },
    [startSse, executeSse, setSseError, setLoading]
  );

  const runWs = useCallback(
    async (currentTab: Tab, lineNumber: number) => {
      const reqId = crypto.randomUUID();
      startWs(currentTab.path, {
        reqId,
        status: "connecting",
        messages: [],
        startPayload: null,
        totalMs: null,
        error: null,
        idleTimeoutMs: null,
        closeCode: null,
        closeReason: null,
      });
      try {
        await executeWebSocket({
          reqId,
          rawText: currentTab.content,
          lineOffset: lineNumber - 1,
          envName: envRef.current,
          filePath: currentTab.path,
        });
      } catch (e) {
        setWsError(currentTab.path, reqId, String(e));
      }
    },
    [startWs, executeWebSocket, setWsError]
  );

  const runGrpc = useCallback(
    async (currentTab: Tab, lineNumber: number) => {
      const reqId = crypto.randomUUID();
      startGrpc(currentTab.path, {
        reqId,
        status: "connecting",
        streamingKind: null,
        startPayload: null,
        messages: [],
        initialMetadata: [],
        trailingMetadata: [],
        statusCode: null,
        statusMessage: null,
        error: null,
        totalMs: null,
        messageCount: 0,
      });
      try {
        await executeGrpc({
          reqId,
          rawText: currentTab.content,
          lineOffset: lineNumber - 1,
          envName: envRef.current,
          filePath: currentTab.path,
        });
      } catch (e) {
        setGrpcError(currentTab.path, reqId, String(e));
      }
    },
    [startGrpc, executeGrpc, setGrpcError]
  );

  const handleCopyCurl = useCallback(async () => {
    const view = viewRef.current;
    if (!view) return;
    const lineNumber = view.state.doc.lineAt(view.state.selection.main.head).number;
    try {
      const curl = await toCurl({
        rawText: tabRef.current.content,
        lineOffset: lineNumber - 1,
        envName: envRef.current,
      });
      await copyText(curl);
      toast.success("已复制 cURL");
    } catch (e) {
      toast.error(`复制 cURL 失败: ${e}`);
    }
  }, []);

  const handleCut = useCallback(async () => {
    const view = viewRef.current;
    if (!view) return;
    const { state } = view;
    const sel = state.selection.main;
    if (sel.empty) return;
    const text = state.sliceDoc(sel.from, sel.to);
    try {
      await copyText(text);
    } catch (e) {
      toast.error(`剪切失败: ${e}`);
      return;
    }
    view.dispatch({ changes: { from: sel.from, to: sel.to, insert: "" } });
    view.focus();
  }, []);

  const handleCopy = useCallback(async () => {
    const view = viewRef.current;
    if (!view) return;
    const { state } = view;
    const sel = state.selection.main;
    if (sel.empty) return;
    const text = state.sliceDoc(sel.from, sel.to);
    try {
      await copyText(text);
    } catch (e) {
      toast.error(`复制失败: ${e}`);
      return;
    }
    view.focus();
  }, []);

  const handlePaste = useCallback(async () => {
    const view = viewRef.current;
    if (!view) return;
    try {
      const text = await pasteText();
      const sel = view.state.selection.main;

      const httpText = curlToHttpText(text);
      const insert = httpText
        ? `###\n${text.split("\n").map((l) => `# ${l}`).join("\n")}\n${httpText}\n\n###`
        : text;
      const cursor = sel.from + insert.length;
      view.dispatch({
        changes: { from: sel.from, to: sel.to, insert },
        selection: { anchor: cursor },
      });
      view.focus();
      if (httpText) toast.success("已将 cURL 转换为 HTTP 请求报文");
    } catch (e) {
      toast.error(`粘贴失败: ${e}`);
    }
  }, []);

  useEffect(() => {
    if (!editorRef.current) return;

    const updateListener = EditorView.updateListener.of((update) => {
      if (update.docChanged) {
        updateContent(tab.path, update.state.doc.toString());
      }
    });

    const extensions = [
      lineNumbers(),
      ...httpFoldingExtensions(),
      runGutter,
      runMarkerField,
      history(),
      bracketMatching(),
      syntaxHighlightingExt,
      highlightSelectionMatches(),
      search(),
      searchPanelTheme,
      searchAutocompleteDisabler,
      highlightActiveLine(),
      highlightActiveLineGutter(),
      drawSelection(),
      httpLanguage,
      keymap.of([
        indentWithTab,
        ...defaultKeymap,
        ...historyKeymap,
        ...searchKeymap,
        {
          key: "Mod-s",
          preventDefault: true,
          run: () => {
            const currentTab = tabRef.current;
            if (currentTab) {
              useTabsStore.getState().saveTab(currentTab.path);
            }
            return true;
          },
        },
        {
          key: "Mod-v",
          preventDefault: true,
          run: () => {
            handlePaste();
            return true;
          },
        },
      ]),
      updateListener,
      EditorView.lineWrapping,
      EditorView.theme({
        "&": {
          fontSize: "16px",
          height: "100%",
          backgroundColor: "var(--editor-bg)",
          caretColor: "var(--editor-cursor)",
        },
        "& ::selection": {
          backgroundColor: "transparent",
        },
        ".cm-selectionLayer": {
          zIndex: "1 !important",
          pointerEvents: "none",
        },
        ".cm-selectionBackground": {
          backgroundColor: "var(--editor-selection) !important",
        },
        ".cm-selectionMatch": {
          backgroundColor: "var(--editor-selection-match)",
        },
        ".cm-content": {
          fontFamily: "var(--font-mono)",
          fontVariantLigatures: "none",
          fontFeatureSettings: '"liga" 0, "calt" 0',
          padding: "0 0 100px 0",
          caretColor: "var(--editor-cursor)",
        },
        ".cm-scroller": {
          lineHeight: "1.4",
        },
        ".cm-cursor, .cm-dropCursor": {
          borderLeft: "2px solid var(--editor-cursor)",
          marginLeft: "-1px",
        },
        ".cm-gutters": {
          fontFamily: "var(--font-mono)",
          backgroundColor: "var(--card)",
          borderRight: "1px solid var(--border)",
          color: "var(--editor-gutter-fg)",
        },
        ".cm-lineNumbers .cm-gutterElement": {
          padding: "1px 3px 1px 20px",
          userSelect: "none",
        },
        ".cm-gutterElement:first-child": {
          display: "none"
        },
        ".cm-line": {
          padding: "0 3px",
        },
        ".cm-activeLine": {
          backgroundColor: "var(--accent)",
        },
        ".cm-activeLineGutter": {
          backgroundColor: "var(--accent)",
          color: "var(--editor-gutter-active-fg)",
        },
        ".cm-run-gutter": {
          width: "22px",
          backgroundColor: "transparent",
        },
        ".cm-run-gutter .cm-gutterElement": {
          display: "flex",
          justifyContent: "center",
          padding: "0",
        },
        ".cm-editor-control-gutter": {
          position: "relative",
          display: "inline-flex",
          alignItems: "center",
          justifyContent: "center",
          boxSizing: "border-box",
          width: "20px",
          height: "20px",
          marginTop: "1px",
          flexShrink: "0",
        },
        ".cm-run-gutter-btn, .cm-http-fold-gutter-btn": {
          cursor: "pointer",
          display: "inline-flex",
          alignItems: "center",
          justifyContent: "center",
          boxSizing: "border-box",
          width: "20px",
          height: "20px",
          textAlign: "center",
          borderRadius: "3px",
          userSelect: "none",
        },
        ".cm-run-gutter-btn": {
          color: "var(--primary)",
          transition: "background-color 80ms ease",
        },
        ".cm-http-fold-gutter-btn": {
          color: "var(--editor-gutter-fg)",
          opacity: "0",
          pointerEvents: "none",
          transition: "background-color 80ms ease, color 80ms ease",
        },
        ".cm-run-gutter .cm-gutterElement:hover .cm-http-fold-gutter-btn": {
          opacity: "1",
          pointerEvents: "auto",
        },
        // ".cm-run-gutter-btn:hover, .cm-http-fold-gutter-btn:hover": {
        //   backgroundColor: "var(--accent)",
        // },
        ".cm-http-fold-gutter-btn:hover": {
          color: "var(--foreground)",
        },
        "&.cm-focused": {
          outline: "none",
        },
      }),
    ];

    let view: EditorView;
    try {
      let state: EditorState;
      if (tab.editorState) {
        try {
          state = EditorState.fromJSON(
            tab.editorState as any,
            { extensions },
            STATE_FIELDS,
          );
        } catch {
          state = EditorState.create({ doc: tab.content, extensions });
        }
      } else {
        state = EditorState.create({ doc: tab.content, extensions });
      }

      view = new EditorView({
        state,
        parent: editorRef.current,
      });
      viewRef.current = view;
      refreshHttpFoldPlaceholders(view);

      // CodeMirror 6 内部以 \n 作为行结尾，会把磁盘读取的 \r\n 规范化为 \n。
      // 此时 view 的实际 doc 与 store 里的 tab.content 字面不一致（CRLF vs LF），
      // 若不修正，后续 reverse sync useEffect 的 view.dispatch 会触发 updateListener，
      // 把 LF 内容写到 tab.content，再与 savedContent（仍是 CRLF）比较时 isDirty 被误置为 true。
      // 因此让 savedContent 跟随 CodeMirror 规范化结果，保持两者一致。
      const normalized = view.state.doc.toString();
      if (normalized !== tab.content) {
        useTabsStore.getState().syncNormalizedContent(tab.path, normalized);
      }
    } catch (e) {
      console.error("[HttpEditor] failed to create EditorView:", e);
      return;
    }

    const container = editorRef.current;
    const onClick = (event: MouseEvent) => {
      if (!(event.target instanceof Element)) return;
      const foldButton = event.target.closest(".cm-http-fold-gutter-btn");
      if (foldButton instanceof HTMLElement) {
        event.preventDefault();
        event.stopPropagation();
        const range = readFoldButtonRange(foldButton);
        if (range) toggleFoldRange(view, range);
        return;
      }

      const runButton = event.target.closest(".cm-run-gutter-btn");
      if (!(runButton instanceof HTMLElement)) return;
      event.preventDefault();
      event.stopPropagation();
      const pos = view.posAtCoords({ x: event.clientX, y: event.clientY });
      if (pos == null) return;
      const lineNumber = view.state.doc.lineAt(pos).number;
      handleRun(lineNumber);
    };

    const onContextMenu = (event: MouseEvent) => {
      const target = event.target as HTMLElement;
      if (target.closest(".cm-gutters")) {
        event.stopPropagation();   // 仅阻断 Radix 自定义菜单
        // 不调用 preventDefault -> 保留 webview 原生菜单
      }
    };
    
    container.addEventListener("click", onClick, true);
    container.addEventListener("contextmenu", onContextMenu, true);

    return () => {
      container.removeEventListener("click", onClick, true);
      container.removeEventListener("contextmenu", onContextMenu, true);
      if (view) {
        try {
          const json = view.state.toJSON(STATE_FIELDS);
          truncateEditorHistory(json, MAX_HISTORY_DEPTH);
          useTabsStore.getState().saveEditorState(tab.path, json);
        } catch (_) {
          // 序列化失败不致命，丢弃 state
        }
        view.destroy();
        viewRef.current = null;
      }
    };
  }, [tab.path]);

  useEffect(() => {
    const view = viewRef.current;
    if (!view) return;
    const currentContent = view.state.doc.toString();
    if (tab.content !== currentContent && !tab.isDirty) {
      view.dispatch({
        changes: { from: 0, to: currentContent.length, insert: tab.content },
      });
    }
  }, [tab.content, tab.isDirty]);

  return (
    <ContextMenu>
      <ContextMenuTrigger asChild>
        <div ref={editorRef} className="h-full overflow-auto" />
      </ContextMenuTrigger>
      <ContextMenuContent>
        <ContextMenuItem onClick={handleCut}>
          <Scissors className="mr-2 h-3.5 w-3.5" />
          剪切
        </ContextMenuItem>
        <ContextMenuItem onClick={handleCopy}>
          <Copy className="mr-2 h-3.5 w-3.5" />
          复制
        </ContextMenuItem>
        <ContextMenuItem onClick={handlePaste}>
          <ClipboardPaste className="mr-2 h-3.5 w-3.5" />
          粘贴
        </ContextMenuItem>
        <ContextMenuSeparator />
        <ContextMenuItem onClick={handleCopyCurl}>
          <Terminal className="mr-2 h-3.5 w-3.5" />
          复制 cURL
        </ContextMenuItem>
      </ContextMenuContent>
    </ContextMenu>
  );
}
