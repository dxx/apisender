import { useEffect, useRef } from "react";
import { EditorState, type Extension } from "@codemirror/state";
import { EditorView, keymap, lineNumbers, highlightActiveLine, highlightActiveLineGutter, drawSelection } from "@codemirror/view";
import { defaultKeymap, history, historyKeymap, indentWithTab, historyField } from "@codemirror/commands";
import { searchKeymap, highlightSelectionMatches, search } from "@codemirror/search";
import { json } from "@codemirror/lang-json";

import type { Tab } from "@/stores/tabs";
import { useTabsStore } from "@/stores/tabs";
import { syntaxHighlightingExt } from "./syntax-theme";
import { searchPanelTheme, searchAutocompleteDisabler } from "./search-panel-theme";
import { protoLanguage } from "./proto-lang";

const MAX_HISTORY_DEPTH = 100;
const STATE_FIELDS = { history: historyField };

function truncateEditorHistory(state: any, maxDepth: number) {
  const history = state?.history;
  if (history?.undo && Array.isArray(history.undo) && history.undo.length > maxDepth) {
    history.undo = history.undo.slice(-maxDepth);
  }
  if (history?.redo && Array.isArray(history.redo) && history.redo.length > maxDepth) {
    history.redo = history.redo.slice(-maxDepth);
  }
}

function languageFor(name: string): Extension[] {
  const lower = name.toLowerCase();
  if (lower.endsWith(".json")) return [json()];
  if (lower.endsWith(".proto") || lower.endsWith(".proto.text") || lower.endsWith(".prototxt")) {
    return [protoLanguage];
  }
  return [];
}

interface PlainEditorProps {
  tab: Tab;
}

export function PlainEditor({ tab }: PlainEditorProps) {
  const editorRef = useRef<HTMLDivElement>(null);
  const viewRef = useRef<EditorView | null>(null);
  const updateContent = useTabsStore((s) => s.updateContent);

  useEffect(() => {
    if (!editorRef.current) return;

    const updateListener = EditorView.updateListener.of((update) => {
      if (update.docChanged) {
        updateContent(tab.path, update.state.doc.toString());
      }
    });

    let view: EditorView;
    try {
      const extensions = [
        lineNumbers(),
        history(),
        syntaxHighlightingExt,
        highlightSelectionMatches(),
        search(),
        searchPanelTheme,
        searchAutocompleteDisabler,
        highlightActiveLine(),
        highlightActiveLineGutter(),
        drawSelection(),
        ...languageFor(tab.name),
        keymap.of([
          indentWithTab,
          ...defaultKeymap,
          ...historyKeymap,
          ...searchKeymap,
          {
            key: "Mod-s",
            preventDefault: true,
            run: () => {
              useTabsStore.getState().saveTab(tab.path);
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
            backgroundColor: "var(--editor-gutter-bg)",
            borderRight: "1px solid var(--border)",
            color: "var(--editor-gutter-fg)",
          },
          ".cm-lineNumbers .cm-gutterElement": {
            padding: "1px 5px 1px 5px",
            userSelect: "none",
          },
          ".cm-gutterElement:first-child": {
            display: "none"
          },
          ".cm-line": {
            padding: "0 3px",
          },
          ".cm-activeLine": {
            backgroundColor: "var(--editor-gutter-active-bg)",
          },
          ".cm-activeLineGutter": {
            backgroundColor: "var(--editor-gutter-active-bg)",
            color: "var(--editor-gutter-active-fg)",
          },
          "&.cm-focused": {
            outline: "none",
          },
        }),
      ];

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
      console.error("[PlainEditor] failed to create EditorView:", e);
      return;
    }

    return () => {
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

  return <div ref={editorRef} className="h-full overflow-auto" />;
}
