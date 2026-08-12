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

export type GitErrorCode =
  | "git_not_installed"
  | "git_version_too_old"
  | "not_repository"
  | "target_not_empty"
  | "remote_missing"
  | "remote_not_empty"
  | "remote_already_exists"
  | "upstream_missing"
  | "identity_missing"
  | "authentication_failed"
  | "non_fast_forward"
  | "conflict"
  | "operation_busy"
  | "output_too_large"
  | "invalid_path"
  | "invalid_branch"
  | "command_failed"
  | "io";

export interface GitErrorPayload {
  code: GitErrorCode;
  message: string;
  details: string | null;
}

export interface GitAvailability {
  available: boolean;
  supported: boolean;
  version: string | null;
  executable: string | null;
  minimumVersion: string;
}

export interface GitRepositoryState {
  workspaceRoot: string;
  repositoryRoot: string;
  branch: string | null;
  detached: boolean;
  upstream: string | null;
  ahead: number;
  behind: number;
  remotes: string[];
  files: GitFileStatus[];
  hasConflicts: boolean;
}

export interface GitFileStatus {
  path: string;
  originalPath: string | null;
  indexStatus: string | null;
  worktreeStatus: string | null;
  conflict: boolean;
  untracked: boolean;
}

export interface GitBranch {
  name: string;
  current: boolean;
  remote: boolean;
  upstream: string | null;
  ahead: number;
  behind: number;
}

export interface GitCommit {
  sha: string;
  shortSha: string;
  authorName: string;
  authorEmail: string;
  authoredAt: string;
  subject: string;
}

export interface GitDiff {
  content: string;
  binary: boolean;
  truncated: boolean;
  outputTooLarge: boolean;
}

export interface GitCommitDetail {
  commit: GitCommit;
  files: string[];
  diff: GitDiff;
}

export interface GitIdentity {
  name: string | null;
  email: string | null;
}
