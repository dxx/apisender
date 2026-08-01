import { invoke } from "@tauri-apps/api/core";

export interface ExecuteGrpcArgs {
  reqId: string;
  rawText: string;
  lineOffset?: number;
  envName?: string | null;
  filePath?: string | null;
}

export async function executeGrpc(args: ExecuteGrpcArgs): Promise<string> {
  return invoke<string>("execute_grpc", { args });
}

export async function stopGrpc(reqId: string): Promise<void> {
  return invoke<void>("stop_grpc", { reqId });
}