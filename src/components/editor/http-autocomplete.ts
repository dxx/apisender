import type { Completion, CompletionContext, CompletionResult } from "@codemirror/autocomplete";
import { autocompletion } from "@codemirror/autocomplete";

import { useEnvironmentStore } from "@/stores/environment";

import { analyzeCursorContext } from "./http-context";
import {
  HTTP_METHODS,
  SEPARATOR,
  HTTP_TAGS,
  HTTP_HEADERS,
  HEADER_VALUES,
  WS_SEPARATORS,
} from "./http-static-data";

function envVarsCompletions(vars: Record<string, string>, label: string): CompletionLike[] {
  return Object.keys(vars).map((k) => ({
    label: k,
    type: "variable",
    detail: `${label}: ${truncate(vars[k], 40)}`,
    boost: 12,
  }));
}

function mapVarsCompletions(vars: Map<string, string>, label: string): CompletionLike[] {
  return Array.from(vars.keys()).map((k) => ({
    label: k,
    type: "variable",
    detail: `${label}: ${truncate(vars.get(k) ?? "", 40)}`,
    boost: 11,
  }));
}

interface CompletionLike {
  label: string;
  type: string;
  detail?: string;
  info?: string;
  boost?: number;
  apply?: string;
}

function truncate(s: string, n: number): string {
  return s.length <= n ? s : s.slice(0, n) + "...";
}

function toCompletion(c: CompletionLike): Completion {
  return c;
}

function httpCompletionSource(ctx: CompletionContext): CompletionResult | null {
  if (!ctx.explicit && !ctx.matchBefore(/\S/)) return null;

  const state = ctx.state;
  const pos = ctx.pos;
  const cx = analyzeCursorContext(state, pos);

  // 1. 变量补全：输入 {{
  const before = state.doc.sliceString(Math.max(0, pos - 2), pos);
  if (before === "{{") {
    const envState = useEnvironmentStore.getState();
    const completions: CompletionLike[] = [
      ...envVarsCompletions(envState.vars, "env"),
      ...mapVarsCompletions(cx.blockVars, "block"),
      ...mapVarsCompletions(cx.globalVars, "global"),
    ];
    return {
      from: pos,
      to: pos,
      options: completions.map(toCompletion),
      validFor: /^[^}]*$/,
    };
  }

  // 2. 通用变量补全：{{xxx 后续输入
  const varWord = ctx.matchBefore(/\{\{[\w$.-]*/);
  if (varWord) {
    const envState = useEnvironmentStore.getState();
    const completions: CompletionLike[] = [
      ...envVarsCompletions(envState.vars, "env"),
      ...mapVarsCompletions(cx.blockVars, "block"),
      ...mapVarsCompletions(cx.globalVars, "global"),
    ];
    return {
      from: varWord.from + 2,
      to: pos,
      options: completions.map(toCompletion),
      validFor: /^[\w$.-]*$/,
    };
  }

  switch (cx.segment) {
    case "separator": {
      const word = ctx.matchBefore(/#+/);
      // 输入超过 3 个 # 不再补全（#### 等视为误操作）
      if (word && word.text.length > 3) return null;
      return {
        from: word ? word.from : pos,
        to: pos,
        options: SEPARATOR,
        validFor: /^#*$/,
      };
    }

    case "method":
      return {
        from: pos,
        to: pos,
        options: HTTP_METHODS,
        validFor: /^[A-Z]*$/i,
      };

    case "tag": {
      // from 设为 @ 之后，候选 label（如 "no-redirect"）才能正确匹配用户输入
      const word = ctx.matchBefore(/@[\w-]*/);
      if (!word) return null;
      return {
        from: word.from + 1,
        to: ctx.pos,
        options: HTTP_TAGS,
        validFor: /^[\w-]*$/,
      };
    }

    case "header-name": {
      const word = ctx.matchBefore(/[A-Za-z0-9-]*/);
      const from = word ? word.from : pos;
      return {
        from,
        to: pos,
        options: HTTP_HEADERS,
        validFor: /^[A-Za-z0-9-]*$/,
      };
    }

    case "header-value": {
      // 提取当前 header 名
      const line = state.doc.lineAt(pos);
      const colonIdx = line.text.indexOf(":");
      if (colonIdx < 0) return null;
      const headerName = line.text.slice(0, colonIdx).trim().toLowerCase();
      const candidates = HEADER_VALUES[headerName];
      if (!candidates || candidates.length === 0) return null;
      const word = ctx.matchBefore(/\S*/);
      const from = word ? word.from : pos;
      return {
        from,
        to: pos,
        options: candidates,
        validFor: /^\S*$/,
      };
    }

    case "body": {
      // WS body：补全 ===
      if (cx.isWs) {
        const word = ctx.matchBefore(/==?=?[\w-]*/);
        const from = word ? word.from : pos;
        return {
          from,
          to: pos,
          options: WS_SEPARATORS,
          validFor: /^=?=?[\w-]*$/,
        };
      }
      return null;
    }

    default:
      return null;
  }
}

export function httpAutocomplete() {
  return autocompletion({
    override: [httpCompletionSource],
    activateOnTyping: true,
    closeOnBlur: false,
    defaultKeymap: true,
  });
}
