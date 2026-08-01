import { invoke } from "@tauri-apps/api/core";

import type { ExecutionResult, RequestPreview } from "@/lib/types";

export async function executeHttp(args: {
  reqId: string;
  rawText: string;
  lineOffset?: number;
  envName?: string | null;
  filePath?: string | null;
}): Promise<ExecutionResult> {
  return invoke<ExecutionResult>("execute_http", { args });
}

export async function cancelHttp(reqId: string): Promise<void> {
  return invoke<void>("cancel_http", { reqId });
}

export async function parsePreview(rawText: string): Promise<RequestPreview[]> {
  return invoke<RequestPreview[]>("parse_preview", { rawText });
}
