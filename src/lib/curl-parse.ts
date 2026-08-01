/**
 * curl 命令 -> HTTP 请求报文 解析器
 * -------------------------------
 * 支持：
 * - -X / --request 指定 method（默认 GET）
 * - URL（裸 URL 或 --url）
 * - -H / --header（可多个）
 * - -d / --data / --data-raw / --data-binary
 * - -F / --form（multipart）
 * - -L / --location（忽略，仅记录）
 * - --compressed（忽略）
 * - 单引号/双引号/无引号
 * - \ 续行
 */

interface MultipartPart {
  name: string;
  value?: string;
  file?: string;
  filename?: string;
  contentType?: string;
}

interface ParsedCurl {
  method: string;
  url: string;
  headers: [string, string][];
  body: string | null;
  multipart: MultipartPart[] | null;
}

/**
 * 将 curl 命令拆分为 token，处理引号和续行
 */
function tokenizeCurl(curl: string): string[] {
  const tokens: string[] = [];
  let i = 0;
  let current = "";
  let inSingle = false;
  let inDouble = false;
  let hasToken = false;

  while (i < curl.length) {
    const ch = curl[i];

    if (inSingle) {
      if (ch === "'") {
        inSingle = false;
      } else {
        current += ch;
      }
      i++;
      continue;
    }

    if (inDouble) {
      if (ch === '"' && curl[i - 1] !== "\\") {
        inDouble = false;
      } else {
        current += ch;
      }
      i++;
      continue;
    }

    if (ch === "\\") {
      const next = curl[i + 1];
      if (next === "\n" || next === "\r") {
        i += 2;
        continue;
      }
      current += ch;
      i++;
      hasToken = true;
      continue;
    }

    if (ch === "'") {
      inSingle = true;
      hasToken = true;
      i++;
      continue;
    }

    if (ch === '"') {
      inDouble = true;
      hasToken = true;
      i++;
      continue;
    }

    if (ch === " " || ch === "\t" || ch === "\n" || ch === "\r") {
      if (hasToken) {
        tokens.push(current);
        current = "";
        hasToken = false;
      }
      i++;
      continue;
    }

    current += ch;
    hasToken = true;
    i++;
  }

  if (hasToken) {
    tokens.push(current);
  }

  return tokens;
}

function isCurlCommand(text: string): boolean {
  const trimmed = text.trim();
  return /^curl\s/i.test(trimmed) || /^curl\s*$/.test(trimmed);
}

export function parseCurl(curl: string): ParsedCurl | null {
  const trimmed = curl.trim();
  if (!isCurlCommand(trimmed)) return null;

  const tokens = tokenizeCurl(trimmed);

  let method = "GET";
  let url = "";
  const headers: [string, string][] = [];
  let body: string | null = null;
  let multipart: ParsedCurl["multipart"] = null;

  let i = 1;
  while (i < tokens.length) {
    const tok = tokens[i];

    switch (tok) {
      case "-X":
      case "--request":
        method = tokens[++i] ?? "GET";
        break;
      case "-H":
      case "--header": {
        const header = tokens[++i] ?? "";
        const colonIdx = header.indexOf(":");
        if (colonIdx > 0) {
          const key = header.slice(0, colonIdx).trim();
          const value = header.slice(colonIdx + 1).trim();
          if (key) headers.push([key, value]);
        }
        break;
      }
      case "-d":
      case "--data":
      case "--data-raw":
      case "--data-binary": {
        const data = tokens[++i] ?? "";
        body = data;
        if (method === "GET") method = "POST";
        break;
      }
      case "-F":
      case "--form": {
        const form = tokens[++i] ?? "";
        if (!multipart) multipart = [];
        const part: MultipartPart = { name: "" };

        const semiIdx = form.indexOf(";");
        const mainPart = semiIdx >= 0 ? form.slice(0, semiIdx) : form;
        const rest = semiIdx >= 0 ? form.slice(semiIdx + 1) : "";

        const eqIdx = mainPart.indexOf("=");
        if (eqIdx > 0) {
          part.name = mainPart.slice(0, eqIdx);
          const val = mainPart.slice(eqIdx + 1);
          if (val.startsWith("@")) {
            part.file = val.slice(1);
          } else {
            part.value = val;
          }
        }

        if (rest) {
          for (const seg of rest.split(";")) {
            const s = seg.trim();
            if (s.startsWith("filename=")) {
              part.filename = s.slice("filename=".length);
            } else if (s.startsWith("type=")) {
              part.contentType = s.slice("type=".length);
            }
          }
        }

        multipart.push(part);
        break;
      }
      case "--url":
        url = tokens[++i] ?? "";
        break;
      case "-L":
      case "--location":
      case "--compressed":
      case "-k":
      case "--insecure":
      case "-s":
      case "--silent":
      case "-S":
      case "--show-error":
      case "-v":
      case "--verbose":
        break;
      default:
        if (!tok.startsWith("-") && !url) {
          url = tok;
        }
        break;
    }
    i++;
  }

  return { method, url, headers, body, multipart };
}

/**
 * 将解析后的 curl 转换为 .http 请求报文格式
 */
export function curlToHttpText(curl: string): string | null {
  const parsed = parseCurl(curl);
  if (!parsed) return null;

  const lines: string[] = [];

  lines.push(`${parsed.method} ${parsed.url}`);

  for (const [key, value] of parsed.headers) {
    lines.push(`${key}: ${value}`);
  }

  if (parsed.multipart) {
    let boundary: string | null = null;
    for (const [k, v] of parsed.headers) {
      if (k.toLowerCase() === "content-type") {
        const m = v.match(/boundary=([^;]+)/);
        if (m) boundary = m[1];
        break;
      }
    }
    if (!boundary) {
      boundary = "----WebKitFormBoundary" + Math.random().toString(36).slice(2, 14);
      lines.push(`Content-Type: multipart/form-data; boundary=${boundary}`);
    }
    lines.push("");
    for (const p of parsed.multipart) {
      lines.push(`--${boundary}`);
      let disp = `Content-Disposition: form-data; name="${p.name}"`;
      if (p.filename) disp += `; filename="${p.filename}"`;
      lines.push(disp);
      if (p.contentType) {
        lines.push(`Content-Type: ${p.contentType}`);
      }
      lines.push("");
      if (p.file) {
        lines.push(`< ${p.file}`);
      } else if (p.value !== undefined) {
        lines.push(p.value);
      }
    }
    lines.push(`--${boundary}--`);
  } else if (parsed.body !== null) {
    lines.push("");
    lines.push(parsed.body);
  }

  return lines.join("\n");
}
