import { useEffect, useMemo, useState } from "react";
import { AlertCircle, CheckCircle2, Clock, Download, Loader, RefreshCw, RotateCw, X } from "lucide-react";
import { relaunch } from "@tauri-apps/plugin-process";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import {
  cancelUpdateDownload,
  checkUpdate,
  downloadUpdate,
  getUpdateStatus,
  installDownloadedUpdate,
  type UpdateDownloadEvent,
  type UpdateStatus,
} from "@/lib/tauri";
import { cn } from "@/lib/utils";

const idleStatus: UpdateStatus = {
  phase: "idle",
  metadata: null,
  downloaded: 0,
  total: null,
  progressPercent: null,
  canCancel: false,
  canInstall: false,
  message: null,
};

/**
 * 入参：未知错误对象。
 * 出参：可展示给用户的错误文本。
 * 作用与流程：优先保留后端增强后的中文错误，其次读取 Error.message，最后给出兜底提示。
 */
function userMessage(error: unknown): string {
  if (typeof error === "string") return error;
  if (error instanceof Error) return error.message;
  return "更新失败。请稍后重试，或从 GitHub Release 手动下载安装包。";
}

/**
 * 入参：字节数。
 * 出参：B/KB/MB/GB 格式的短文本。
 * 作用与流程：按 1024 进位选择单位，并为非字节单位保留 1 位小数。
 */
function formatBytes(bytes: number): string {
  if (bytes <= 0) return "0 B";
  const units = ["B", "KB", "MB", "GB"];
  const index = Math.min(Math.floor(Math.log(bytes) / Math.log(1024)), units.length - 1);
  const value = bytes / 1024 ** index;
  return `${value.toFixed(index === 0 ? 0 : 1)} ${units[index]}`;
}

/**
 * 入参：更新状态。
 * 出参：状态标题文本。
 * 作用与流程：根据后端状态机阶段生成设置页顶部标题，包含可用版本号。
 */
function statusTitle(status: UpdateStatus): string {
  switch (status.phase) {
    case "upToDate":
      return "当前已是最新版本";
    case "available":
      return `发现新版本 ${status.metadata?.version ?? ""}`.trim();
    case "downloading":
      return "正在下载更新";
    case "downloaded":
      return `更新 ${status.metadata?.version ?? ""} 已下载`.trim();
    case "installing":
      return "正在安装更新";
    default:
      return "检查应用更新";
  }
}

/**
 * 入参：更新状态和忙碌标记。
 * 出参：用于状态标题前的图标节点。
 * 作用与流程：下载/安装/检查时显示旋转图标，其它阶段按状态显示固定图标。
 */
function statusIcon(status: UpdateStatus, busy: boolean) {
  if (busy || status.phase === "downloading" || status.phase === "installing") {
    return <Loader className="h-4 w-4 animate-spin text-primary" />;
  }
  if (status.phase === "downloaded") {
    return <Clock className="h-4 w-4 text-primary" />;
  }
  if (status.phase === "upToDate") {
    return <CheckCircle2 className="h-4 w-4 text-emerald-600" />;
  }
  if (status.phase === "available") {
    return <Download className="h-4 w-4 text-primary" />;
  }
  return <RefreshCw className="h-4 w-4 text-muted-foreground" />;
}

interface UpdatePanelProps {
  onDelayInstall?: () => void;
}

/**
 * 入参：延迟安装回调。
 * 出参：设置页更新面板 React 节点。
 * 作用与流程：读取后端更新状态，提供检查、下载、取消、稍后安装和安装重启动作，并用 toast 展示关键结果。
 */
export function UpdatePanel({ onDelayInstall }: UpdatePanelProps) {
  const [status, setStatus] = useState<UpdateStatus>(idleStatus);
  const [error, setError] = useState<string | null>(null);
  const [checking, setChecking] = useState(false);
  const [downloading, setDownloading] = useState(false);
  const [cancelling, setCancelling] = useState(false);
  const [installing, setInstalling] = useState(false);

  const busy = checking || downloading || installing;
  const progressPercent = status.progressPercent ?? 0;
  const progressText = useMemo(() => {
    if (status.total) {
      return `${formatBytes(status.downloaded)} / ${formatBytes(status.total)}`;
    }
    if (status.downloaded > 0) {
      return `${formatBytes(status.downloaded)} 已下载`;
    }
    return "等待下载进度";
  }, [status.downloaded, status.total]);

  useEffect(() => {
    let disposed = false;
    getUpdateStatus()
      .then((nextStatus) => {
        if (!disposed) setStatus(nextStatus);
      })
      .catch((err) => {
        if (!disposed) setError(userMessage(err));
      });
    return () => {
      disposed = true;
    };
  }, []);

  /**
   * 入参：无。
   * 出参：无。
   * 作用与流程：触发后端检查更新，刷新状态，并在发现新版本或已是最新版时展示提示。
   */
  const handleCheck = async () => {
    setChecking(true);
    setError(null);
    try {
      const nextStatus = await checkUpdate();
      setStatus(nextStatus);
      if (nextStatus.phase === "available") {
        toast.success(`发现新版本 ${nextStatus.metadata?.version}`);
      } else if (nextStatus.phase === "upToDate") {
        toast.success("当前已是最新版本");
      }
    } catch (err) {
      const message = userMessage(err);
      setError(message);
      toast.error(message);
    } finally {
      setChecking(false);
    }
  };

  /**
   * 入参：下载事件。
   * 出参：无。
   * 作用与流程：消费后端 Channel 推送的进度或取消事件，并同步更新进度条状态。
   */
  const handleDownloadEvent = (event: UpdateDownloadEvent) => {
    if (event.event === "Progress") {
      setStatus((current) => ({
        ...current,
        phase: "downloading",
        downloaded: event.data.downloaded,
        total: event.data.contentLength,
        progressPercent: event.data.progressPercent,
        canCancel: true,
        canInstall: false,
        message: "正在下载更新包",
      }));
    }
    if (event.event === "Cancelled") {
      toast.info("已取消下载");
    }
  };

  /**
   * 入参：无。
   * 出参：无。
   * 作用与流程：启动下载命令并绑定进度回调，完成后进入可延迟安装状态，失败时恢复后端状态。
   */
  const handleDownload = async () => {
    setDownloading(true);
    setError(null);
    setStatus((current) => ({
      ...current,
      phase: "downloading",
      canCancel: true,
      canInstall: false,
      message: "正在下载更新包",
    }));
    try {
      const nextStatus = await downloadUpdate(handleDownloadEvent);
      setStatus(nextStatus);
      if (nextStatus.phase === "downloaded") {
        toast.success("更新包已下载，可稍后安装");
      }
    } catch (err) {
      const message = userMessage(err);
      setError(message);
      toast.error(message);
      const nextStatus = await getUpdateStatus().catch(() => null);
      if (nextStatus) setStatus(nextStatus);
    } finally {
      setDownloading(false);
      setCancelling(false);
    }
  };

  /**
   * 入参：无。
   * 出参：无。
   * 作用与流程：请求后端取消当前下载，取消结果由下载命令和 Channel 事件完成状态回填。
   */
  const handleCancel = async () => {
    setCancelling(true);
    try {
      const cancelled = await cancelUpdateDownload();
      if (!cancelled) {
        toast.info("当前没有正在下载的更新");
        setCancelling(false);
      }
    } catch (err) {
      const message = userMessage(err);
      setError(message);
      toast.error(message);
      setCancelling(false);
    }
  };

  /**
   * 入参：无。
   * 出参：无。
   * 作用与流程：安装已下载更新包，安装成功后调用 process 插件重启应用，失败时恢复状态并提示原因。
   */
  const handleInstall = async () => {
    setInstalling(true);
    setError(null);
    setStatus((current) => ({
      ...current,
      phase: "installing",
      canCancel: false,
      canInstall: false,
      message: "正在安装更新",
    }));
    try {
      await installDownloadedUpdate();
      toast.success("更新已安装，正在重启应用");
      await relaunch();
    } catch (err) {
      const message = userMessage(err);
      setError(message);
      toast.error(message);
      const nextStatus = await getUpdateStatus().catch(() => null);
      if (nextStatus) setStatus(nextStatus);
    } finally {
      setInstalling(false);
    }
  };

  return (
    <div className="space-y-4">
      <div className="flex items-start justify-between gap-4 rounded-md border bg-muted/20 px-4 py-3">
        <div className="flex min-w-0 items-start gap-3">
          <div className="mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-md border bg-background">
            {statusIcon(status, busy)}
          </div>
          <div className="min-w-0 space-y-1">
            <div className="text-sm font-medium">{statusTitle(status)}</div>
            <div className="text-xs text-muted-foreground">
              当前版本 {status.metadata?.currentVersion ?? "当前构建"}
              {status.metadata?.target ? ` · ${status.metadata.target}` : ""}
            </div>
            {status.message && (
              <div className="text-xs text-muted-foreground">{status.message}</div>
            )}
          </div>
        </div>

        <Button
          type="button"
          variant="outline"
          size="sm"
          onClick={handleCheck}
          disabled={busy}
          className="shrink-0 rounded-md"
        >
          {checking ? <Loader className="h-3.5 w-3.5 animate-spin" /> : <RefreshCw className="h-3.5 w-3.5" />}
          检查更新
        </Button>
      </div>

      {(status.phase === "downloading" || status.phase === "downloaded") && (
        <div className="space-y-2">
          <div className="flex items-center justify-between gap-3 text-xs text-muted-foreground">
            <span>{progressText}</span>
            <span>{status.progressPercent == null ? "未知大小" : `${status.progressPercent}%`}</span>
          </div>
          <div className="h-2 overflow-hidden rounded-sm bg-muted">
            <div
              className={cn(
                "h-full bg-primary transition-[width] duration-300",
                status.progressPercent == null && status.phase === "downloading" ? "w-1/3 animate-pulse" : "",
              )}
              style={status.progressPercent == null ? undefined : { width: `${progressPercent}%` }}
            />
          </div>
        </div>
      )}

      {status.metadata?.notes && (
        <div className="max-h-32 overflow-auto rounded-md border bg-background px-3 py-2 text-xs leading-5 whitespace-pre-wrap">
          {status.metadata.notes}
        </div>
      )}

      {error && (
        <div className="flex items-start gap-2 rounded-md border border-destructive/30 bg-destructive/10 px-3 py-2 text-xs text-destructive">
          <AlertCircle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
          <span className="min-w-0 break-words">{error}</span>
        </div>
      )}

      <div className="flex flex-wrap justify-end gap-2">
        {status.phase === "available" && (
          <Button type="button" size="sm" className="rounded-md" onClick={handleDownload} disabled={busy}>
            <Download className="h-3.5 w-3.5" />
            下载更新
          </Button>
        )}

        {status.canCancel && (
          <Button
            type="button"
            variant="outline"
            size="sm"
            className="rounded-md"
            onClick={handleCancel}
            disabled={cancelling}
          >
            {cancelling ? <Loader className="h-3.5 w-3.5 animate-spin" /> : <X className="h-3.5 w-3.5" />}
            取消下载
          </Button>
        )}

        {status.canInstall && (
          <>
            <Button type="button" variant="outline" size="sm" className="rounded-md" onClick={onDelayInstall}>
              <Clock className="h-3.5 w-3.5" />
              稍后安装
            </Button>
            <Button type="button" size="sm" className="rounded-md" onClick={handleInstall} disabled={installing}>
              {installing ? <Loader className="h-3.5 w-3.5 animate-spin" /> : <RotateCw className="h-3.5 w-3.5" />}
              安装并重启
            </Button>
          </>
        )}
      </div>
    </div>
  );
}
