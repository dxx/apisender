import type { Completion } from "@codemirror/autocomplete";

export const HTTP_METHODS: Completion[] = [
  "GET",
  "POST",
  "PUT",
  "DELETE",
  "PATCH",
  "HEAD",
  "OPTIONS",
  "CONNECT",
  "TRACE",
  "WEBSOCKET",
  "GRPC",
].map((label) => ({ label, type: "command", boost: 10 }));

export const SEPARATOR: Completion[] = [
  { label: "###", type: "keyword", boost: 10, apply: "### " },
  { label: "### 请求名", type: "keyword", boost: 9, apply: "### " },
];

export const HTTP_TAGS: Completion[] = [
  { label: "no-redirect", type: "tag", detail: "禁用重定向", boost: 10 },
  { label: "no-log", type: "tag", detail: "不记录历史", boost: 9 },
  { label: "no-cookie", type: "tag", detail: "禁用 Cookie", boost: 8 },
  { label: "no-auto-encoding", type: "tag", detail: "禁用响应自动解码", boost: 7 },
  { label: "timeout", type: "tag", detail: "请求超时 (ms/s/m)", boost: 6 },
  { label: "connection-timeout", type: "tag", detail: "连接超时 (ms/s/m)", boost: 5 },
  { label: "idle-timeout", type: "tag", detail: "空闲超时 (WS/SSE)", boost: 4 },
  { label: "proto", type: "tag", detail: "gRPC proto 文件路径", boost: 3 },
  { label: "proto-include", type: "tag", detail: "gRPC proto import 路径", boost: 2 },
  { label: "sse", type: "tag", detail: "标记为 SSE 请求", boost: 1 },
];

export const HTTP_HEADERS: Completion[] = [
  "Accept",
  "Accept-Charset",
  "Accept-Encoding",
  "Accept-Language",
  "Authorization",
  "Cache-Control",
  "Connection",
  "Content-Disposition",
  "Content-Encoding",
  "Content-Length",
  "Content-Type",
  "Cookie",
  "Date",
  "Host",
  "If-Match",
  "If-Modified-Since",
  "If-None-Match",
  "If-Range",
  "If-Unmodified-Since",
  "Origin",
  "Pragma",
  "Range",
  "Referer",
  "User-Agent",
  "Upgrade",
  "X-Requested-With",
  "X-Api-Key",
  "X-Auth-Token",
  "X-Forwarded-For",
  "X-Forwarded-Host",
  "X-Forwarded-Proto",
  "X-Real-IP",
].map((label) => ({ label, type: "header", boost: 8 }));

export const HEADER_VALUES: Record<string, Completion[]> = {
  "content-type": [
    { label: "application/json", type: "string", boost: 10 },
    { label: "application/json; charset=utf-8", type: "string", boost: 9 },
    { label: "application/x-www-form-urlencoded", type: "string", boost: 8 },
    { label: "multipart/form-data", type: "string", boost: 7 },
    { label: "multipart/form-data; boundary=---", type: "string", boost: 6 },
    { label: "text/plain", type: "string", boost: 5 },
    { label: "text/html", type: "string", boost: 4 },
    { label: "application/xml", type: "string", boost: 3 },
    { label: "application/octet-stream", type: "string", boost: 2 },
    { label: "application/graphql", type: "string", boost: 1 },
  ],
  accept: [
    { label: "application/json", type: "string", boost: 10 },
    { label: "*/*", type: "string", boost: 9 },
    { label: "text/html", type: "string", boost: 8 },
    { label: "application/xml", type: "string", boost: 7 },
    { label: "text/plain", type: "string", boost: 6 },
  ],
  "accept-encoding": [
    { label: "gzip, deflate, br", type: "string", boost: 10 },
    { label: "gzip", type: "string", boost: 9 },
    { label: "identity", type: "string", boost: 8 },
  ],
  "accept-language": [
    { label: "zh-CN,zh;q=0.9,en;q=0.8", type: "string", boost: 10 },
    { label: "en-US,en;q=0.9", type: "string", boost: 9 },
  ],
  authorization: [
    { label: "Bearer ", type: "string", boost: 10 },
    { label: "Basic ", type: "string", boost: 9 },
    { label: "Digest ", type: "string", boost: 8 },
  ],
  "cache-control": [
    { label: "no-cache", type: "string", boost: 10 },
    { label: "no-store", type: "string", boost: 9 },
    { label: "max-age=0", type: "string", boost: 8 },
    { label: "max-age=3600", type: "string", boost: 7 },
    { label: "public, max-age=3600", type: "string", boost: 6 },
    { label: "private, max-age=3600", type: "string", boost: 5 },
  ],
  connection: [
    { label: "keep-alive", type: "string", boost: 10 },
    { label: "close", type: "string", boost: 9 },
  ],
  upgrade: [
    { label: "websocket", type: "string", boost: 10 },
    { label: "h2c", type: "string", boost: 9 },
    { label: "HTTP/2-Over-TLS", type: "string", boost: 8 },
  ],
};

export const WS_SEPARATORS: Completion[] = [
  { label: "===", type: "operator", detail: "WS 消息分隔符", boost: 10 },
  { label: "=== wait-for-server", type: "operator", detail: "等待服务端回包", boost: 9 },
];
