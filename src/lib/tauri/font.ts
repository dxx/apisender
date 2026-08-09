import { invoke } from "@tauri-apps/api/core";

export async function listSystemFonts(): Promise<string[]> {
  return invoke<string[]>("list_system_fonts");
}