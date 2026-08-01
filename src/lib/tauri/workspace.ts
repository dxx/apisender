import { invoke } from "@tauri-apps/api/core";

import type { FileTreeNode, RecentWorkspace } from "@/lib/types";

export async function openWorkspace(path: string): Promise<void> {
  await invoke("open_workspace", { path });
}

export async function closeWorkspace(): Promise<void> {
  await invoke("close_workspace");
}

export async function getWorkspacePath(): Promise<string | null> {
  return invoke<string | null>("get_workspace_path");
}

export async function getFileTree(): Promise<FileTreeNode[]> {
  return invoke<FileTreeNode[]>("get_file_tree");
}

export async function createFile(path: string, isDir: boolean): Promise<void> {
  await invoke("create_file", { path, isDir });
}

export async function renameNode(oldPath: string, newPath: string): Promise<void> {
  await invoke("rename_node", { oldPath, newPath });
}

export async function deleteNode(path: string): Promise<void> {
  await invoke("delete_node", { path });
}

export async function moveNode(src: string, destDir: string): Promise<void> {
  await invoke("move_node", { src, destDir });
}

export async function readFile(path: string): Promise<string> {
  return invoke<string>("read_file", { path });
}

export async function saveFile(path: string, content: string): Promise<void> {
  await invoke("save_file", { path, content });
}

export async function listRecentWorkspaces(): Promise<RecentWorkspace[]> {
  return invoke<RecentWorkspace[]>("list_recent_workspaces");
}

export async function removeRecentWorkspace(path: string): Promise<void> {
  await invoke("remove_recent_workspace", { path });
}
