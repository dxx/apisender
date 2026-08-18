import { EditorView, ViewPlugin } from "@codemirror/view";

const autocompleteDisabler = ViewPlugin.fromClass(
  class {
    observer: MutationObserver;
    constructor(view: EditorView) {
      const disable = (el: HTMLElement) => {
        el.setAttribute("autocomplete", "off");
        el.setAttribute("spellcheck", "false");
      };
      const apply = (root: ParentNode) => {
        root.querySelectorAll?.(".cm-textfield").forEach((el) => {
          if (el instanceof HTMLElement) disable(el);
        });
      };
      this.observer = new MutationObserver((mutations) => {
        for (const m of mutations) {
          for (const node of m.addedNodes) {
            if (node instanceof HTMLElement) {
              if (node.classList.contains("cm-textfield")) disable(node);
              apply(node);
            }
          }
        }
      });
      this.observer.observe(view.dom, { childList: true, subtree: true });
      apply(view.dom);
    }
    destroy() {
      this.observer.disconnect();
    }
  },
);

export const searchPanelTheme = EditorView.theme({
  ".cm-panel.cm-search": {
    padding: "6px 10px",
    position: "relative",
    backgroundColor: "var(--search-panel-bg)",
    color: "var(--foreground)",
    fontFamily: "var(--font-ui)",
    fontSize: "12px",
  },
  ".cm-panels-top": {
    borderBottom: "1px solid var(--border)",
  },
  ".cm-panels-bottom": {
    borderTop: "1px solid var(--border)",
  },

  ".cm-panel.cm-search .cm-textfield": {
    backgroundColor: "var(--search-input-bg)",
    color: "var(--foreground)",
    border: "1px solid var(--border)",
    borderRadius: "var(--radius-sm)",
    padding: "3px 8px",
    fontSize: "12px",
    fontFamily: "var(--font-editor)",
    outline: "none",
    minWidth: "160px",
    WebkitTextFillColor: "var(--foreground)",
    caretColor: "var(--foreground)",
  },
  ".cm-panel.cm-search .cm-textfield:focus": {
    borderColor: "var(--primary)",
    boxShadow: "0 0 0 1px var(--primary)",
  },

  ".cm-panel.cm-search .cm-button": {
    backgroundColor: "var(--search-button-bg) !important",
    backgroundImage: "none !important",
    color: "var(--foreground) !important",
    WebkitTextFillColor: "var(--foreground) !important",
    border: "1px solid var(--border) !important",
    borderRadius: "var(--radius-sm)",
    padding: "3px 10px",
    fontSize: "12px",
    cursor: "pointer",
    lineHeight: "1.4",
    appearance: "none !important",
    WebkitAppearance: "none !important",
  },
  ".cm-panel.cm-search .cm-button:hover": {
    backgroundColor: "var(--accent) !important",
  },
  ".cm-panel.cm-search .cm-button:active": {
    backgroundColor: "var(--accent) !important",
  },

  ".cm-panel.cm-search label": {
    color: "var(--muted-foreground)",
    fontSize: "11px",
    display: "inline-flex",
    alignItems: "center",
    gap: "3px",
    whiteSpace: "nowrap",
  },
  ".cm-panel.cm-search input[type=checkbox]": {
    accentColor: "var(--primary)",
    cursor: "pointer",
  },

  ".cm-panel.cm-search .cm-search-counter": {
    position: "absolute",
    right: "34px",
    top: "50%",
    transform: "translateY(-50%)",
    fontSize: "12px",
    fontFamily: "var(--font-ui)",
    color: "var(--muted-foreground)",
    fontVariantNumeric: "tabular-nums",
    whiteSpace: "nowrap",
    userSelect: "none",
    pointerEvents: "none",
  },

  ".cm-panel.cm-search [name=close]": {
    color: "var(--muted-foreground)",
    fontSize: "18px",
    lineHeight: "1",
    width: "22px",
    height: "22px",
    backgroundColor: "transparent",
    borderRadius: "var(--radius-sm)",
    cursor: "pointer",
    flexShrink: "0",
  },
  ".cm-panel.cm-search [name=close]:hover": {
    color: "var(--foreground)",
    backgroundColor: "var(--accent)",
  },

  ".cm-searchMatch": {
    backgroundColor: "var(--editor-selection-match)",
  },
  ".cm-searchMatch.cm-searchMatch-selected": {
    backgroundColor: "var(--editor-selection)",
  },
});

export const searchAutocompleteDisabler = autocompleteDisabler;
