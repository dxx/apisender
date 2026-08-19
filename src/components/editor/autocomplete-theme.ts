import { EditorView } from "@codemirror/view";

export const autocompleteTheme = EditorView.theme({
  ".cm-tooltip.cm-tooltip-autocomplete > ul": {
    fontFamily: "var(--font-editor)",
  },
  ".cm-tooltip.cm-tooltip-autocomplete > ul > li": {
    padding: "3px 8px",
    borderRadius: "var(--radius-sm)",
    color: "var(--popover-foreground)",
  },
  ".cm-tooltip.cm-tooltip-autocomplete > ul > li[aria-selected]": {
    backgroundColor: "var(--primary)",
    color: "var(--primary-foreground)",
  },
  ".cm-tooltip.cm-tooltip-autocomplete-disabled > ul > li[aria-selected]": {
    backgroundColor: "var(--muted)",
    color: "var(--muted-foreground)",
  },
  ".cm-tooltip.cm-tooltip-autocomplete > ul > completion-section": {
    borderBottom: "1px solid var(--border)",
    color: "var(--muted-foreground)",
    opacity: "1",
    fontWeight: "500",
  },
  ".cm-completionMatchedText": {
    textDecoration: "underline",
    textDecorationColor: "var(--primary)",
    fontWeight: "600",
  },
  ".cm-completionDetail": {
    marginLeft: "0.5em",
    fontStyle: "italic",
    color: "var(--muted-foreground)",
  },
  ".cm-tooltip.cm-tooltip-autocomplete > ul > li[aria-selected] .cm-completionDetail": {
    color: "color-mix(in oklch, var(--primary-foreground) 60%, var(--muted-foreground))",
  },
  ".cm-completionIcon": {
    width: "1em",
    marginRight: "0.4em",
    opacity: "0.7",
  },
  ".cm-completionIcon-keyword:after": {
    content: "'🔑\uFE0E'",
  },
  ".cm-completionIcon-property:after": {
    content: "'□'",
  },
  ".cm-completionIcon-string:after": {
    content: "'\u201D'",
  },
  ".cm-completionIcon-operator:after": {
    content: "'\u2192'",
  },
  ".cm-tooltip.cm-completionInfo": {
    backgroundColor: "var(--popover)",
    color: "var(--popover-foreground)",
    border: "1px solid var(--border)",
    borderRadius: "var(--radius)",
    padding: "6px 10px",
    boxShadow: "0 2px 8px rgb(0 0 0 / 0.08)",
  },
  ".cm-completionListIncompleteTop:before, .cm-completionListIncompleteBottom:after": {
    color: "var(--muted-foreground)",
  },
  ".cm-snippetField": {
    backgroundColor: "color-mix(in oklch, var(--primary) 15%, transparent)",
  },
  ".cm-snippetFieldPosition": {
    borderLeft: "1.4px dotted var(--muted-foreground)",
  },
});