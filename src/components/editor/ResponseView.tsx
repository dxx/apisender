import { useEffect, useRef } from "react";
import { Compartment, EditorState } from "@codemirror/state";
import {
  EditorView,
  keymap,
  lineNumbers,
} from "@codemirror/view";
import { defaultKeymap, history } from "@codemirror/commands";
import type { Language } from "@codemirror/language";
import { search, searchKeymap } from "@codemirror/search";

import { responseLanguage } from "./http-lang";
import { syntaxHighlightingExt } from "./syntax-theme";
import { searchPanelTheme, searchAutocompleteDisabler } from "./search-panel-theme";

interface ResponseViewProps {
  text: string;
  language?: Language;
}

export function ResponseView({ text, language }: ResponseViewProps) {
  const editorRef = useRef<HTMLDivElement>(null);
  const viewRef = useRef<EditorView | null>(null);
  const languageCompartment = useRef(new Compartment());

  useEffect(() => {
    if (!editorRef.current) return;

    let view: EditorView;
    try {
      const state = EditorState.create({
        doc: text,
        extensions: [
          lineNumbers(),
          history(),
          search(),
          searchPanelTheme,
          searchAutocompleteDisabler,
          keymap.of([...defaultKeymap, ...searchKeymap]),
          syntaxHighlightingExt,
          languageCompartment.current.of(language ?? responseLanguage),
          EditorView.lineWrapping,
          EditorState.readOnly.of(true),
          EditorView.theme({
            "&": {
              fontSize: "16px",
              height: "100%",
              backgroundColor: "var(--editor-bg)",
            },
            ".cm-content": {
              fontFamily: "var(--font-mono)",
              fontVariantLigatures: "none",
              fontFeatureSettings: '"liga" 0, "calt" 0',
              padding: "4px 0",
            },
            ".cm-gutters": {
              fontFamily: "var(--font-mono)",
              backgroundColor: "var(--card)",
              borderRight: "1px solid var(--border)",
              color: "var(--editor-gutter-fg)",
            },
            ".cm-lineNumbers .cm-gutterElement": {
              paddingRight: "calc(var(--spacing) * 2)",
              paddingLeft: "calc(var(--spacing) * 2)",
              userSelect: "none",
            },
            ".cm-line": {
              padding: "0 6px",
              lineHeight: "1.6",
            },
            "&.cm-focused": {
              outline: "none",
            },
            ".cm-cursor": {
              display: "none",
            },
          }),
        ],
      });

      view = new EditorView({
        state,
        parent: editorRef.current,
      });
      viewRef.current = view;
    } catch (e) {
      console.error("[ResponseView] failed to create EditorView:", e);
      return;
    }

    return () => {
      view.destroy();
      viewRef.current = null;
    };
  }, []);

  useEffect(() => {
    const view = viewRef.current;
    if (!view) return;
    view.dispatch({
      effects: languageCompartment.current.reconfigure(language ?? responseLanguage),
    });
  }, [language]);

  useEffect(() => {
    const view = viewRef.current;
    if (!view) return;
    const current = view.state.doc.toString();
    if (current !== text) {
      view.dispatch({
        changes: { from: 0, to: current.length, insert: text },
      });
    }
  }, [text]);

  return <div ref={editorRef} className="h-full" />;
}