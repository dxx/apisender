import { invoke } from "@tauri-apps/api/core";

import type { HistoryDetail, HistoryEntry } from "@/lib/types";

export async function listHistory(limit?: number): Promise<HistoryEntry[]> {
  return invoke<HistoryEntry[]>("list_history", { limit: limit ?? null });
}

export async function getHistoryDetail(id: number): Promise<HistoryDetail> {
  return invoke<HistoryDetail>("get_history_detail", { id });
}

export async function clearHistory(): Promise<void> {
  await invoke("clear_history");
}

export async function deleteHistory(id: number): Promise<boolean> {
  return invoke<boolean>("delete_history", { id });
}
