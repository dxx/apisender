import { open } from "@tauri-apps/plugin-dialog";

export async function openFileDialog(): Promise<string | null> {
  const selected = await open({ directory: true, multiple: false });
  return typeof selected === "string" ? selected : null;
}
