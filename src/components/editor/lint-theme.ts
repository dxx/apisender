import { EditorView } from "@codemirror/view";

export const lintTheme = EditorView.theme({
  ".cm-tooltip": {
    border: "1px solid var(--border)",
    backgroundColor: "var(--popover)",
    color: "var(--popover-foreground)",
    borderRadius: "var(--radius)",
    padding: "4px 0",
    boxShadow: "0 2px 8px rgb(0 0 0 / 0.08)",
  },
  ".cm-tooltip-section:not(:first-child)": {
    borderTop: "1px solid var(--border)",
    marginTop: "4px",
    paddingTop: "4px",
  },
  ".cm-tooltip-arrow:before": { borderTopColor: "var(--border)" },
  ".cm-tooltip-arrow:after": { borderTopColor: "var(--popover)" },

  ".cm-tooltip-lint": {
    fontFamily: "var(--font-editor)",
    fontSize: "calc(var(--text-editor-size) - 2px)",
  },
  ".cm-tooltip-lint ::selection": {
    backgroundColor: "var(--editor-selection)",
  },
  ".cm-tooltip-lint ul": {
    margin: 0,
    padding: 0,
    listStyle: "none",
  },
  ".cm-diagnostic": {
    padding: "4px 10px",
    borderRadius: "var(--radius-sm)",
    borderLeft: "3px solid transparent",
  },
  ".cm-diagnostic-error": {
    borderLeftColor: "var(--editor-diagnostic-error)",
    backgroundColor: "color-mix(in oklch, var(--editor-diagnostic-error) 10%, transparent)",
  },
  ".cm-diagnostic-warning": {
    borderLeftColor: "var(--editor-diagnostic-warning)",
    backgroundColor: "color-mix(in oklch, var(--editor-diagnostic-warning) 10%, transparent)",
  },
  ".cm-diagnostic-info": {
    borderLeftColor: "var(--editor-diagnostic-info)",
    backgroundColor: "color-mix(in oklch, var(--editor-diagnostic-info) 10%, transparent)",
  },
  ".cm-diagnostic-hint": {
    borderLeftColor: "var(--editor-diagnostic-hint)",
    backgroundColor: "color-mix(in oklch, var(--editor-diagnostic-hint) 10%, transparent)",
  },
  ".cm-diagnosticText": {
    fontFamily: "var(--font-editor)",
    lineHeight: "1.5",
  },
});
