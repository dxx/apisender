import { Channel, invoke } from "@tauri-apps/api/core";

export interface UpdateMetadata {
  version: string;
  currentVersion: string;
  notes: string | null;
  date: string | null;
  target: string;
  downloadUrl: string;
}

export interface UpdateStatus {
  phase: "idle" | "upToDate" | "available" | "downloading" | "downloaded" | "installing";
  metadata: UpdateMetadata | null;
  downloaded: number;
  total: number | null;
  progressPercent: number | null;
  canCancel: boolean;
  canInstall: boolean;
  message: string | null;
}

export type UpdateDownloadEvent =
  | {
      event: "Started";
      data: {
        contentLength: number | null;
      };
    }
  | {
      event: "Progress";
      data: {
        chunkLength: number;
        downloaded: number;
        contentLength: number | null;
        progressPercent: number | null;
      };
    }
  | {
      event: "Finished";
    }
  | {
      event: "Cancelled";
    };

export async function checkUpdate(): Promise<UpdateStatus> {
  return invoke<UpdateStatus>("check_update");
}

export async function getUpdateStatus(): Promise<UpdateStatus> {
  return invoke<UpdateStatus>("get_update_status");
}

export async function cancelUpdateDownload(): Promise<boolean> {
  return invoke<boolean>("cancel_update_download");
}

export async function installDownloadedUpdate(): Promise<void> {
  await invoke("install_downloaded_update");
}

export async function downloadUpdate(
  onDownloadEvent: (event: UpdateDownloadEvent) => void,
): Promise<UpdateStatus> {
  const onEvent = new Channel<UpdateDownloadEvent>();
  onEvent.onmessage = onDownloadEvent;
  return invoke<UpdateStatus>("download_update", { onEvent });
}
