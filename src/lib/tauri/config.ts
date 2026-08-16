import { invoke } from "@tauri-apps/api/core";

export interface FontSettings {
  editorFontFamily: string | null;
  uiFontFamily: string | null;
  responseFontFamily: string | null;
}

export interface FontSizeSettings {
  editorFontSize: number | null;
  responseFontSize: number | null;
}

export async function getTheme(): Promise<string | null> {
  return invoke<string | null>("get_theme");
}

export async function setTheme(theme: string): Promise<void> {
  await invoke("set_theme", { theme });
}

export async function getFonts(): Promise<FontSettings> {
  return invoke<FontSettings>("get_fonts");
}

export async function setEditorFontFamily(font: string | null): Promise<void> {
  await invoke("set_editor_font_family", { font });
}

export async function setUiFontFamily(font: string | null): Promise<void> {
  await invoke("set_ui_font_family", { font });
}

export async function setResponseFontFamily(font: string | null): Promise<void> {
  await invoke("set_response_font_family", { font });
}

export async function getFontSizes(): Promise<FontSizeSettings> {
  return invoke<FontSizeSettings>("get_font_sizes");
}

export async function setEditorFontSize(size: number | null): Promise<void> {
  await invoke("set_editor_font_size", { size });
}

export async function setResponseFontSize(size: number | null): Promise<void> {
  await invoke("set_response_font_size", { size });
}

export async function getLastWorkspace(): Promise<string | null> {
  return invoke<string | null>("get_last_workspace");
}

export async function setLastWorkspace(path: string | null): Promise<void> {
  await invoke("set_last_workspace", { path });
}

export async function getActiveEnvironment(workspacePath: string): Promise<string | null> {
  return invoke<string | null>("get_active_environment", { workspacePath });
}

export async function setActiveEnvironment(
  workspacePath: string,
  name: string | null,
): Promise<void> {
  await invoke("set_active_environment", { workspacePath, name });
}
