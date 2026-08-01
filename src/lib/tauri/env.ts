import { invoke } from "@tauri-apps/api/core";

export async function listEnvironments(): Promise<string[]> {
  return invoke<string[]>("list_environments");
}

export async function getEnvironmentVars(name: string): Promise<Record<string, string>> {
  return invoke<Record<string, string>>("get_environment_vars", { name });
}
