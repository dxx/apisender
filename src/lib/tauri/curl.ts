import { invoke } from "@tauri-apps/api/core";

export async function toCurl(args: {
  rawText: string;
  lineOffset?: number;
  envName?: string | null;
}): Promise<string> {
  return invoke<string>("to_curl", { args });
}
