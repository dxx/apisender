import { invoke } from "@tauri-apps/api/core";

import type { ExecutionResult, RequestPreview } from "@/lib/types";

export async function executeRequest(args: {
  rawText: string;
  lineOffset?: number;
  envName?: string | null;
  filePath?: string | null;
}): Promise<ExecutionResult> {
  return invoke<ExecutionResult>("execute_request", { args });
}

export async function parsePreview(rawText: string): Promise<RequestPreview[]> {
  return invoke<RequestPreview[]>("parse_preview", { rawText });
}
