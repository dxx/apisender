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

/**
 * 入参：无。
 * 出参：当前更新状态。
 * 作用与流程：调用后端检查 GitHub Release 更新源，并返回 idle/upToDate/available 等状态。
 */
export async function checkUpdate(): Promise<UpdateStatus> {
  return invoke<UpdateStatus>("check_update");
}

/**
 * 入参：无。
 * 出参：后端内存中的当前更新状态。
 * 作用与流程：读取已检查、下载中或已下载的 updater 状态，用于设置页打开时恢复界面。
 */
export async function getUpdateStatus(): Promise<UpdateStatus> {
  return invoke<UpdateStatus>("get_update_status");
}

/**
 * 入参：无。
 * 出参：是否成功触发取消。
 * 作用与流程：通知后端取消正在进行的下载；没有下载任务时返回 false。
 */
export async function cancelUpdateDownload(): Promise<boolean> {
  return invoke<boolean>("cancel_update_download");
}

/**
 * 入参：无。
 * 出参：安装完成后 resolve，失败时抛出后端错误。
 * 作用与流程：安装已经下载并通过签名验证的更新包，前端随后负责重启应用。
 */
export async function installDownloadedUpdate(): Promise<void> {
  await invoke("install_downloaded_update");
}

/**
 * 入参：下载事件回调。
 * 出参：下载结束后的更新状态。
 * 作用与流程：创建 Tauri IPC Channel 接收下载进度、完成或取消事件，并调用后端下载命令。
 */
export async function downloadUpdate(
  onDownloadEvent: (event: UpdateDownloadEvent) => void,
): Promise<UpdateStatus> {
  const onEvent = new Channel<UpdateDownloadEvent>();
  onEvent.onmessage = onDownloadEvent;
  return invoke<UpdateStatus>("download_update", { onEvent });
}
