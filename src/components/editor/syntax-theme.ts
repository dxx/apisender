import { HighlightStyle, syntaxHighlighting } from "@codemirror/language";
import { tags as t } from "@lezer/highlight";

export const highlightStyleExt = HighlightStyle.define([
  { tag: t.keyword, color: "var(--syntax-keyword)", fontWeight: "600" },
  { tag: t.heading, color: "var(--syntax-heading)", fontWeight: "600" },
  { tag: t.propertyName, color: "var(--syntax-property)" },
  { tag: t.string, color: "var(--syntax-string)" },
  { tag: t.number, color: "var(--syntax-number)" },
  { tag: t.atom, color: "var(--syntax-atom)" },
  { tag: t.punctuation, color: "var(--syntax-punctuation)" },
  { tag: t.comment, color: "var(--syntax-comment)", fontStyle: "italic" },
  { tag: t.meta, color: "var(--syntax-comment)" },
  { tag: t.url, color: "var(--syntax-url)" },
  { tag: t.variableName, color: "var(--syntax-variable)" },
]);

export const syntaxHighlightingExt = syntaxHighlighting(highlightStyleExt, {
  fallback: true,
});