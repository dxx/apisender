import { invoke } from "@tauri-apps/api/core";

export async function getTheme(): Promise<string | null> {
  return invoke<string | null>("get_theme");
}

export async function setTheme(theme: string): Promise<void> {
  await invoke("set_theme", { theme });
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
