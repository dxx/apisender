import { invoke } from "@tauri-apps/api/core";
import { writeText, readText } from "@tauri-apps/plugin-clipboard-manager";

export async function copyText(text: string): Promise<void> {
  await writeText(text);
}

export async function pasteText(): Promise<string> {
  return readText();
}

export async function copyFile(path: string): Promise<void> {
  await invoke("clipboard_copy_file", { path });
}

export async function pasteFiles(destDir: string): Promise<string[]> {
  return invoke<string[]>("clipboard_paste_files", { destDir });
}