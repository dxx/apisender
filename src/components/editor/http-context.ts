import { EditorState } from "@codemirror/state";

export interface CursorContext {
  segment:
    | "method"
    | "header-name"
    | "header-value"
    | "body"
    | "tag"
    | "comment"
    | "separator"
    | "variable-decl"
    | "other";
  blockVars: Map<string, string>;
  globalVars: Map<string, string>;
  contentType: string | null;
  isWs: boolean;
  isGrpc: boolean;
  blockStartLine: number;
  blockEndLine: number;
  currentLine: number;
}

const METHOD_RE =
  /^(GET|POST|PUT|DELETE|PATCH|HEAD|OPTIONS|CONNECT|TRACE|WEBSOCKET|GRPC)\b/i;

const isComment = (t: string) => t.startsWith("#") || t.startsWith("//");
const isSeparator = (t: string) => t.startsWith("###");
const isMethodLine = (t: string) => METHOD_RE.test(t) || /^https?:\/\//i.test(t);
const isTagLine = (t: string) => t.startsWith("@");
const isHeaderLine = (t: string) => /^[^:\s][^:]*:/.test(t);

function parseInplaceVar(line: string): [string, string] | null {
  const t = line.trim().replace(/^#+/, "").replace(/^\/+/, "").trim();
  if (!t.startsWith("@")) return null;
  const rest = t.slice(1);
  const eq = rest.indexOf("=");
  if (eq < 0) return null;
  const k = rest.slice(0, eq).trim();
  const v = rest.slice(eq + 1).trim();
  if (!k) return null;
  return [k, v];
}

/**
 * 独立实现，不复用 http-folding.ts。
 * 扫描整个文档，根据 `###` 块边界 + method/headers/body/tag 判定光标所在段。
 */
export function analyzeCursorContext(state: EditorState, pos: number): CursorContext {
  const doc = state.doc;
  const currentLine = doc.lineAt(pos).number;
  const lineFrom = currentLine;
  const lineText = doc.line(lineFrom).text;

  // 第一步：找当前块边界（最近的 ### 或文件开头）
  let blockStartLine = 1;
  let blockEndLine = doc.lines;
  for (let i = currentLine; i >= 1; i--) {
    const t = doc.line(i).text.trim();
    if (isSeparator(t)) {
      blockStartLine = i;
      break;
    }
  }
  // 块尾：下一个 ### 或文件末尾
  for (let i = currentLine + 1; i <= doc.lines; i++) {
    const t = doc.line(i).text.trim();
    if (isSeparator(t)) {
      blockEndLine = i - 1;
      break;
    }
  }

  // 第二步：扫描块外（blockStartLine 之前）收集全局变量
  const globalVars = new Map<string, string>();
  for (let i = 1; i < blockStartLine; i++) {
    // 全局变量定义：未被 ### 包围的 @key=value 行
    const raw = doc.line(i).text;
    const v = parseInplaceVar(raw);
    if (v) {
      // 跳过被块包围的，简单起见：块内全局也会重复收集，这里保留块外
      globalVars.set(v[0], v[1]);
    }
    // 也考虑 ### 之间的全局变量
    if (isSeparator(raw.trim())) continue;
  }

  // 第三步：扫描当前块内，定位段、收集块变量、判定 protocol / contentType
  const blockVars = new Map<string, string>();
  let inHeaders = false;
  let inBody = false;
  let isWs = false;
  let isGrpc = false;
  let contentType: string | null = null;
  let methodLineSeen = false;

  for (let i = blockStartLine; i <= blockEndLine; i++) {
    const line = doc.line(i);
    const t = line.text.trim();

    // 扫到当前光标行就停：当前行的段类型由后面的 segment 判定逻辑处理
    if (i === currentLine) break;

    // 块开头：### 行本身
    if (i === blockStartLine && isSeparator(t)) {
      continue;
    }

    if (!methodLineSeen) {
      if (t === "") continue;
      if (isComment(t)) {
        const v = parseInplaceVar(t);
        if (v) blockVars.set(v[0], v[1]);
        continue;
      }
      if (isTagLine(t)) {
        const v = parseInplaceVar(t);
        if (v) blockVars.set(v[0], v[1]);
        continue;
      }
      if (isMethodLine(t)) {
        methodLineSeen = true;
        const firstWord = t.split(/\s+/)[0]?.toUpperCase() ?? "";
        if (firstWord === "WEBSOCKET") isWs = true;
        else if (firstWord === "GRPC") isGrpc = true;
        continue;
      }
      continue;
    }

    // method 行之后
    if (isSeparator(t)) break;

    if (t === "") {
      if (inHeaders) {
        inHeaders = false;
        inBody = true;
      }
      continue;
    }

    if (isComment(t)) continue;

    if (!inBody && isHeaderLine(t)) {
      inHeaders = true;
      // 提取 content-type
      const colon = t.indexOf(":");
      if (colon > 0) {
        const key = t.slice(0, colon).trim().toLowerCase();
        const val = t.slice(colon + 1).trim();
        if (key === "content-type") contentType = val;
      }
      continue;
    }

    if (!inHeaders && !inBody && t.startsWith(">")) continue;
    if (!inBody) inBody = true;
  }

  // 第四步：根据光标当前行判定 segment
  let segment: CursorContext["segment"] = "other";
  const t = lineText.trim();

  if (isSeparator(t)) {
    segment = "separator";
  } else if (isComment(t)) {
    segment = "comment";
  } else if (!methodLineSeen && isTagLine(t)) {
    segment = t.includes("=") ? "variable-decl" : "tag";
  } else if (!methodLineSeen && isMethodLine(t)) {
    segment = "method";
  } else if (methodLineSeen && (inBody || (inHeaders && t === ""))) {
    segment = "body";
  } else if (methodLineSeen && !inBody && !t.startsWith(">")) {
    // method 行之后、空行之前都算 header 段（含正在输入还没冒号的行）
    if (isWs) {
      segment = "body";
    } else {
      const colonIdx = lineText.indexOf(":");
      if (colonIdx >= 0 && pos > colonIdx) {
        segment = "header-value";
      } else {
        segment = "header-name";
      }
    }
  } else if (methodLineSeen) {
    segment = "body";
  }

  return {
    segment,
    blockVars,
    globalVars,
    contentType,
    isWs,
    isGrpc,
    blockStartLine,
    blockEndLine: blockEndLine,
    currentLine,
  };
}

/**
 * 从文档文本中收集所有 {{...}} 占位符使用的变量名。
 * 用于 lint 校验「未定义变量」。
 */
export interface VariableRef {
  name: string;
  from: number;
  to: number;
  isEnv: boolean;
}

export function collectReferencedVariables(text: string): VariableRef[] {
  const refs: VariableRef[] = [];
  let i = 0;
  while (i < text.length) {
    const start = text.indexOf("{{", i);
    if (start < 0) break;
    const end = text.indexOf("}}", start + 2);
    if (end < 0) break;
    const raw = text.slice(start + 2, end).trim();
    const isEnv = raw.startsWith("$env");
    const name = isEnv ? raw.slice(4).trim().replace(/^:\s*/, "") : raw;
    refs.push({ name, from: start, to: end + 2, isEnv });
    i = end + 2;
  }
  return refs;
}
