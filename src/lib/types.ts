export interface FileTreeNode {
  type: "file" | "dir";
  name: string;
  path: string;
  children?: FileTreeNode[];
}

export interface RequestPreview {
  name: string | null;
  method: string;
  url: string;
  lineStart: number;
}

export interface RecentWorkspace {
  path: string;
  name: string;
  lastOpenedAt: string;
}

export interface HistoryEntry {
  id: number;
  workspacePath: string;
  filePath: string | null;
  method: string;
  url: string;
  status: number | null;
  durationMs: number | null;
  createdAt: string;
}

export interface HistoryDetail {
  entry: HistoryEntry;
  requestSnapshot: string | null;
  responseSnapshot: string | null;
}

export type ResponseBody =
  | { type: "Text"; data: string }
  | { type: "Binary"; data: string }
  | { type: "Sse"; data: SseEvent[] };

export interface HttpState {
  reqId: string | null;
  response: ExecutionResult | null;
  error: string | null;
}

export interface SseEvent {
  id: string | null;
  event: string;
  data: string;
  retry: number | null;
  index: number;
}

export interface SseStartPayload {
  reqId: string;
  status: number;
  statusText: string;
  headers: [string, string][];
  url: string;
  connectMs: number;
  cookies: string[];
}

export type SseStatus = "connecting" | "streaming" | "done" | "stop" | "error";

export interface SseState {
  reqId: string;
  status: SseStatus;
  events: SseEvent[];
  startPayload: SseStartPayload | null;
  totalMs: number | null;
  error: string | null;
}

export interface SseEndPayload {
  reqId: string;
  totalEvents: number;
  totalMs: number;
}

export interface SseErrorPayload {
  reqId: string;
  error: string;
}

export type WsStatus =
  | "connecting"
  | "open"
  | "closed"
  | "idle_timeout"
  | "error";

export type WsDirection = "in" | "out";

export interface WsMessageRecord {
  id: string;
  direction: WsDirection;
  data: string;
  ts: number;
  index: number;
}

export interface WsStartPayload {
  reqId: string;
  status: number;
  statusText: string;
  headers: [string, string][];
  url: string;
  connectMs: number;
}

export interface WsMessagePayload {
  reqId: string;
  data: string;
  index: number;
  tsMs: number;
}

export interface WsClosePayload {
  reqId: string;
  code: number;
  reason: string;
}

export interface WsIdleTimeoutPayload {
  reqId: string;
  idleMs: number;
}

export interface WsErrorPayload {
  reqId: string;
  error: string;
}

export interface WsClosedPayload {
  reqId: string;
  totalMs: number;
}

export interface GrpcStartPayload {
  reqId: string;
  url: string;
  package: string;
  service: string;
  method: string;
  streamingKind: "unary" | "server-streaming";
  connectMs: number;
}

export interface GrpcMessageRecord {
  index: number;
  data: string;
  tsMs: number;
}

export interface GrpcMessagePayload {
  reqId: string;
  index: number;
  data: string;
  tsMs: number;
}

export interface GrpcMetadataPayload {
  reqId: string;
  metadata: [string, string][];
}

export interface GrpcStatusPayload {
  reqId: string;
  code: number;
  message: string;
}

export interface GrpcErrorPayload {
  reqId: string;
  error: string;
}

export interface GrpcClosedPayload {
  reqId: string;
  totalMs: number;
  messageCount: number;
}

export type GrpcStatus = "connecting" | "streaming" | "done" | "stop" | "error";

export interface GrpcState {
  reqId: string;
  status: GrpcStatus;
  streamingKind: "unary" | "server-streaming" | null;
  startPayload: GrpcStartPayload | null;
  messages: GrpcMessageRecord[];
  initialMetadata: [string, string][];
  trailingMetadata: [string, string][];
  statusCode: number | null;
  statusMessage: string | null;
  error: string | null;
  totalMs: number | null;
  messageCount: number;
}

export interface WsState {
  reqId: string;
  status: WsStatus;
  messages: WsMessageRecord[];
  startPayload: WsStartPayload | null;
  totalMs: number | null;
  error: string | null;
  idleTimeoutMs: number | null;
  closeCode: number | null;
  closeReason: string | null;
}

export interface RawResponse {
  status: number;
  statusText: string;
  version: string;
  headers: [string, string][];
  body: ResponseBody;
  durationMs: number;
  size: number;
  url: string;
  cookies: string[];
}

export interface ExecutionResult {
  requestSnapshot: unknown;
  response: RawResponse;
  historyId: number | null;
}

export interface EnvironmentFile {
  [envName: string]: Record<string, string | number | boolean>;
}

export interface WorkspaceChangedEvent {
  eventType: "create" | "modify" | "remove";
  paths: string[];
}