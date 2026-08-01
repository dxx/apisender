import { invoke } from "@tauri-apps/api/core";

export async function executeSse(args: {
  reqId: string;
  rawText: string;
  lineOffset?: number;
  envName?: string | null;
  filePath?: string | null;
}): Promise<void> {
  return invoke<void>("execute_sse", { args });
}

export async function stopSse(reqId: string): Promise<void> {
  return invoke<void>("stop_sse", { reqId });
}
