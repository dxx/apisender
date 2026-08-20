import { linter, type Diagnostic } from "@codemirror/lint";
import type { Extension } from "@codemirror/state";
import { EditorView } from "@codemirror/view";

import { useEnvironmentStore } from "@/stores/environment";

import { collectReferencedVariables } from "./http-context";

interface LintOptions {
  envVars: Record<string, string>;
}

function isGrpcTarget(url: string): boolean {
  // grpc://host:port/Package.Service/Method
  const m = url.match(/^grpcs?:\/\/[^/]+\/[^/]+\/[^/]+$/);
  if (!m) return false;
  const path = url.replace(/^grpcs?:\/\/[^/]+\//, "");
  const slashIdx = path.lastIndexOf("/");
  if (slashIdx < 0) return false;
  const servicePath = path.slice(0, slashIdx);
  return servicePath.includes(".");
}

function checkDuration(value: string): boolean {
  const v = value.trim();
  if (!v) return false;
  const num = v.replace(/(ms|s|m)$/, "").trim();
  return num !== "" && Number.isFinite(Number(num));
}

function collectDiagnostics(view: EditorView, opts: LintOptions): Diagnostic[] {
  const state = view.state;
  const text = state.doc.toString();
  const diags: Diagnostic[] = [];

  // 第一遍：逐块扫描，找请求行、headers、body、@key
  const lines: { from: number; to: number; text: string }[] = [];
  let lineStart = 0;
  for (let i = 0; i < text.length; i++) {
    if (text[i] === "\n") {
      lines.push({ from: lineStart, to: i, text: text.slice(lineStart, i) });
      lineStart = i + 1;
    }
  }
  lines.push({ from: lineStart, to: text.length, text: text.slice(lineStart) });

  const envVars = new Map<string, string>();
  for (const [k, v] of Object.entries(opts.envVars)) {
    envVars.set(k, v);
  }

  // 块遍历
  let i = 0;
  while (i < lines.length) {
    const trimmed = lines[i].text.trim();
    // 跳过注释 / 空行 / 顶层 @key=value
    if (trimmed === "" || trimmed.startsWith("#") || trimmed.startsWith("//")) {
      i++;
      continue;
    }

    // 顶层 @key=value：作为全局变量（不报错）
    if (trimmed.startsWith("@") && trimmed.includes("=")) {
      i++;
      continue;
    }

    // 顶层 @tag（无 =）：校验值格式
    if (trimmed.startsWith("@") && !trimmed.includes("=")) {
      checkTag(trimmed, lines[i].from, diags);
      i++;
      continue;
    }

    // 块开始：### 或裸 method 行
    if (trimmed.startsWith("###")) {
      i = processBlock(lines, i, diags);
      continue;
    }

    if (isMethodLine(trimmed)) {
      i = processRequest(lines, i, diags);
      continue;
    }

    i++;
  }

  // 变量引用校验：扫描 {{...}} 占位符
  const refs = collectReferencedVariables(text);
  // 收集全部变量名（块外 + 所有块内）
  const allVars = new Set<string>(envVars.keys());
  // 扫描所有 @key=value
  for (const line of lines) {
    const v = parseInplaceVar(line.text);
    if (v) allVars.add(v[0]);
  }

  for (const ref of refs) {
    // $env.XXX 跳过：系统环境变量不校验（前端拿不到完整 OS env）
    if (ref.isEnv) continue;
    if (ref.name && !allVars.has(ref.name)) {
      diags.push({
        from: ref.from,
        to: ref.to,
        severity: "warning",
        message: `变量 "${ref.name}" 未定义`,
      });
    }
  }

  return diags;
}

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

function isMethodLine(t: string): boolean {
  return /^(GET|POST|PUT|DELETE|PATCH|HEAD|OPTIONS|CONNECT|TRACE|WEBSOCKET|GRPC)\b/i.test(t)
    || /^https?:\/\//i.test(t);
}

function processBlock(
  lines: { from: number; to: number; text: string }[],
  sepIdx: number,
  diags: Diagnostic[],
): number {
  let i = sepIdx + 1;
  const blockVars = new Map<string, string>();

  // 吃 ### 之后的注释 / @tag / @key=value
  while (i < lines.length) {
    const t = lines[i].text.trim();
    if (t === "") {
      i++;
      continue;
    }
    if (t.startsWith("#") || t.startsWith("//")) {
      const v = parseInplaceVar(t);
      if (v) blockVars.set(v[0], v[1]);
      i++;
      continue;
    }
    if (t.startsWith("@")) {
      // @tag
      if (t.includes("=")) {
        const v = parseInplaceVar(t);
        if (v) blockVars.set(v[0], v[1]);
      } else {
        checkTag(t, lines[i].from, diags);
      }
      i++;
      continue;
    }
    break;
  }

  if (i < lines.length && isMethodLine(lines[i].text.trim())) {
    return processRequest(lines, i, diags);
  }

  return i;
}

function checkTag(t: string, offset: number, diags: Diagnostic[]) {
  const m = t.match(/^@([\w-]+)(\s+(.+))?$/);
  if (!m) return;
  const tagName = m[1];
  const value = m[3];

  switch (tagName) {
    case "timeout":
    case "connection-timeout":
    case "idle-timeout":
      if (value && !checkDuration(value)) {
        diags.push({
          from: offset,
          to: offset + t.length,
          severity: "warning",
          message: `@${tagName} 值 "${value}" 格式非法，应为 数字 + ms/s/m 或纯数字`,
        });
      }
      break;
    case "no-redirect":
    case "no-log":
    case "no-cookie":
    case "no-auto-encoding":
      // 无值标签
      break;
    case "proto":
    case "proto-include":
      // 路径字符串，不校验
      break;
  }
}

function processRequest(
  lines: { from: number; to: number; text: string }[],
  methodIdx: number,
  diags: Diagnostic[],
): number {
  let i = methodIdx;

  // 合并续行
  const methodLine = lines[i].text.trim();
  i++;
  while (i < lines.length && /^\s+\S/.test(lines[i].text)) {
    i++;
  }

  // 校验请求行
  checkRequestLine(methodLine, lines[methodIdx].from, diags);

  const isWs = /^WEBSOCKET\b/i.test(methodLine);
  const isGrpc = /^GRPC\b/i.test(methodLine);

  if (isWs) {
    // WS 请求：body 段是消息
    // 跳过空行
    while (i < lines.length && lines[i].text.trim() === "") i++;
    // 收集消息直到 ###
    while (i < lines.length) {
      const t = lines[i].text.trim();
      if (t.startsWith("###")) break;
      i++;
    }
    return i;
  }

  if (isGrpc) {
    // gRPC：URL 校验
    checkGrpcUrl(methodLine, lines[methodIdx].from, diags);
    // 跳过 metadata + body
    while (i < lines.length) {
      const t = lines[i].text.trim();
      if (t.startsWith("###")) break;
      i++;
    }
    return i;
  }

  // 普通 HTTP：收集 headers
  const headers: { key: string; value: string; lineIdx: number }[] = [];
  while (i < lines.length) {
    const t = lines[i].text.trim();
    if (t === "") { i++; break; }
    if (t.startsWith("###")) break;
    if (t.startsWith("#") || t.startsWith("//")) { i++; continue; }
    const colon = t.indexOf(":");
    if (colon < 0) {
      diags.push({
        from: lines[i].from,
        to: lines[i].to,
        severity: "warning",
        message: "非 header 行（缺少冒号），已结束 headers 段",
      });
      break;
    }
    const key = t.slice(0, colon).trim();
    const value = t.slice(colon + 1).trim();
    if (!key) {
      diags.push({
        from: lines[i].from,
        to: lines[i].to,
        severity: "error",
        message: "Header 名为空",
      });
    } else if (!/^[A-Za-z0-9!#$%&'*+.^_`|~-]+$/.test(key)) {
      diags.push({
        from: lines[i].from,
        to: lines[i].from + key.length,
        severity: "error",
        message: `Header 名 "${key}" 含非法字符`,
      });
    }
    headers.push({ key, value, lineIdx: i });
    i++;
  }

  // Header 重复检查
  const seenHeaders = new Map<string, number>();
  for (const h of headers) {
    const lower = h.key.toLowerCase();
    if (seenHeaders.has(lower)) {
      diags.push({
        from: lines[h.lineIdx].from,
        to: lines[h.lineIdx].to,
        severity: "warning",
        message: `Header "${h.key}" 重复`,
      });
    } else {
      seenHeaders.set(lower, h.lineIdx);
    }
    // 空 value
    if (h.value === "") {
      diags.push({
        from: lines[h.lineIdx].from,
        to: lines[h.lineIdx].to,
        severity: "warning",
        message: `Header "${h.key}" 的值为空`,
      });
    }
  }

  // Body 段
  const bodyStartIdx = i;
  while (i < lines.length) {
    const t = lines[i].text.trim();
    if (t.startsWith("###")) break;
    if (t.startsWith(">")) break;
    i++;
  }
  const bodyEndIdx = i;

  // JSON body 校验
  if (bodyEndIdx > bodyStartIdx) {
    const bodyLines = lines.slice(bodyStartIdx, bodyEndIdx).map((l) => l.text);
    const bodyText = bodyLines.join("\n").trim();
    if (bodyText.startsWith("{") || bodyText.startsWith("[")) {
      try {
        JSON.parse(bodyText);
      } catch (e) {
        const bodyFrom = lines[bodyStartIdx].from;
        diags.push({
          from: bodyFrom,
          to: bodyFrom + bodyText.length,
          severity: "error",
          message: `JSON body 语法错误: ${(e as Error).message}`,
        });
      }
    }
  }

  return i;
}

function checkRequestLine(line: string, offset: number, diags: Diagnostic[]) {
  const parts = line.split(/\s+/);
  if (parts.length < 2 && !/^https?:\/\//i.test(line)) {
    diags.push({
      from: offset,
      to: offset + line.length,
      severity: "error",
      message: "请求行缺少 URL",
    });
    return;
  }

  // HTTP 版本
  const versionMatch = line.match(/\s+(HTTP\/[^\s]*)\s*$/i);
  if (versionMatch) {
    const version = versionMatch[1];
    if (!/^HTTP\/(1\.1|2)$/.test(version)) {
      diags.push({
        from: offset + line.length - version.length,
        to: offset + line.length,
        severity: "warning",
        message: `HTTP 版本 "${version}" 格式不规范（应为 HTTP/1.1 或 HTTP/2）`,
      });
    }
  }
}

function checkGrpcUrl(line: string, offset: number, diags: Diagnostic[]) {
  const parts = line.split(/\s+/);
  if (parts.length < 2) return;
  const url = parts[1];
  if (!/^grpcs?:\/\//i.test(url)) {
    diags.push({
      from: offset + line.indexOf(url),
      to: offset + line.indexOf(url) + url.length,
      severity: "error",
      message: `gRPC URL 应以 grpc:// 或 grpcs:// 开头`,
    });
    return;
  }
  if (!isGrpcTarget(url)) {
    diags.push({
      from: offset + line.indexOf(url),
      to: offset + line.indexOf(url) + url.length,
      severity: "error",
      message: `gRPC URL 路径应为 /Package.Service/Method 格式`,
    });
  }
}

export function httpLinter(_options: LintOptions): Extension {
  return linter((view) => {
    const { vars } = useEnvironmentStore.getState();
    return collectDiagnostics(view, { envVars: vars });
  }, {
    delay: 350,
  });
}
