import { invoke } from "@tauri-apps/api/core";

export interface ExecuteWebSocketArgs {
  reqId: string;
  rawText: string;
  lineOffset?: number;
  envName?: string | null;
  filePath?: string | null;
}

export async function executeWebSocket(args: ExecuteWebSocketArgs): Promise<string> {
  return invoke<string>("execute_websocket", { args });
}

export async function sendWebSocket(reqId: string, message: string): Promise<void> {
  return invoke<void>("send_websocket", { reqId, message });
}

export async function closeWebSocket(reqId: string): Promise<void> {
  return invoke<void>("close_websocket", { reqId });
}