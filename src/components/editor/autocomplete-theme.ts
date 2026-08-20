import { EditorView } from "@codemirror/view";

const SVG_WRAP = (body: string) =>
  `%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 24 24' fill='none' stroke='black' stroke-width='2' stroke-linecap='round' stroke-linejoin='round'%3E${body}%3C/svg%3E`;

function iconMask(svgBody: string): { maskImage: string; WebkitMaskImage: string } {
  const url = `url("data:image/svg+xml,${SVG_WRAP(svgBody)}")`;
  return { maskImage: url, WebkitMaskImage: url };
}

const ICON = {
  // lucide key-round：用于 keyword（如 ### 分隔符）
  keyword: "<path d='M2.586 17.414A2 2 0 0 0 2 18.828V21a1 1 0 0 0 1 1h3a1 1 0 0 0 1-1v-1a1 1 0 0 1 1-1h1a1 1 0 0 0 1-1v-1a1 1 0 0 1 1-1h.172a2 2 0 0 0 1.414-.586l.814-.814a6.5 6.5 0 1 0-4-4z'/><circle cx='16.5' cy='7.5' r='.5' fill='black'/>",
  // lucide command：用于 command（HTTP method）
  command: "<path d='M15 6v12a3 3 0 1 0 3-3H6a3 3 0 1 0 3 3V6a3 3 0 1 0-3 3h12a3 3 0 1 0-3-3'/>",
  // lucide tag：用于 tag（@tag 标签）
  tag: "<path d='M12.586 2.586A2 2 0 0 0 11.172 2H4a2 2 0 0 0-2 2v7.172a2 2 0 0 0 .586 1.414l8.704 8.704a2.426 2.426 0 0 0 3.42 0l6.58-6.58a2.426 2.426 0 0 0 0-3.42z'/><circle cx='7.5' cy='7.5' r='.5' fill='black'/>",
  // lucide type：用于 property（保留兼容）
  type: "<path d='M12 4v16'/><path d='M4 7V5a1 1 0 0 1 1-1h14a1 1 0 0 1 1 1v2'/><path d='M9 20h6'/>",
  // lucide heading：用于 header（HTTP header 名）
  heading: "<path d='M6 12h12'/><path d='M6 20V4'/><path d='M18 20V4'/>",
  // lucide quote：用于 string（header 值）
  quote: "<path d='M16 3a2 2 0 0 0-2 2v6a2 2 0 0 0 2 2 1 1 0 0 1 1 1v1a2 2 0 0 1-2 2 1 1 0 0 0-1 1v2a1 1 0 0 0 1 1 6 6 0 0 0 6-6V5a2 2 0 0 0-2-2z'/><path d='M5 3a2 2 0 0 0-2 2v6a2 2 0 0 0 2 2 1 1 0 0 1 1 1v1a2 2 0 0 1-2 2 1 1 0 0 0-1 1v2a1 1 0 0 0 1 1 6 6 0 0 0 6-6V5a2 2 0 0 0-2-2z'/>",
  // lucide arrow-right：用于 operator（=== 等）
  arrow: "<path d='M5 12h14'/><path d='m12 5 7 7-7 7'/>",
  // lucide braces：用于 variable（{{变量}}）
  braces: "<path d='M8 3H7a2 2 0 0 0-2 2v5a2 2 0 0 1-2 2 2 2 0 0 1 2 2v5c0 1.1.9 2 2 2h1'/><path d='M16 21h1a2 2 0 0 0 2-2v-5c0-1.1.9-2 2-2a2 2 0 0 1-2-2V5a2 2 0 0 0-2-2h-1'/>",
};

export const autocompleteTheme = EditorView.theme({
  ".cm-tooltip.cm-tooltip-autocomplete": {
    border: "1px solid var(--border)",
    backgroundColor: "var(--popover)",
    color: "var(--popover-foreground)",
    borderRadius: "var(--radius)",
    padding: "4px 0",
    boxShadow: "0 2px 8px rgb(0 0 0 / 0.08)",
  },
  ".cm-tooltip.cm-tooltip-autocomplete > ul": {
    fontFamily: "var(--font-editor)",
    fontSize: "calc(var(--text-editor-size) - 2px)",
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
    height: "1em",
    opacity: "0.7",
  },
  ".cm-completionIcon:after": {
    content: "''",
    display: "inline-block",
    width: "1em",
    height: "1em",
    backgroundColor: "currentColor",
    maskSize: "contain",
    maskRepeat: "no-repeat",
    WebkitMaskSize: "contain",
    WebkitMaskRepeat: "no-repeat",
    verticalAlign: "middle",
  },
  ".cm-completionIcon-keyword:after": iconMask(ICON.keyword),
  ".cm-completionIcon-command:after": iconMask(ICON.command),
  ".cm-completionIcon-tag:after": iconMask(ICON.tag),
  ".cm-completionIcon-header:after": iconMask(ICON.heading),
  ".cm-completionIcon-property:after": iconMask(ICON.type),
  ".cm-completionIcon-string:after": iconMask(ICON.quote),
  ".cm-completionIcon-operator:after": iconMask(ICON.arrow),
  ".cm-completionIcon-variable:after": iconMask(ICON.braces),
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
