import { useEffect, useState } from "react";
import { Copy, Trash2 } from "lucide-react";
import { toast } from "sonner";

import { useHistoryStore } from "@/stores/history";
import { Button } from "@/components/ui/button";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuSeparator,
  ContextMenuTrigger,
} from "@/components/ui/context-menu";
import { ScrollArea } from "@/components/ui/scroll-area";
import {
  Tooltip,
  TooltipArrow,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { getMethodColor } from "@/lib/method-colors";
import { copyText } from "@/lib/tauri";

function formatTime(iso: string): string {
  const d = new Date(iso.replace(" ", "T") + "Z");
  const now = Date.now();
  const diff = now - d.getTime();
  const min = Math.floor(diff / 60000);
  if (min < 1) return "刚刚";
  if (min < 60) return `${min} 分钟前`;
  const hr = Math.floor(min / 60);
  if (hr < 24) return `${hr} 小时前`;
  const day = Math.floor(hr / 24);
  return `${day} 天前`;
}

export function HistoryList() {
  const entries = useHistoryStore((s) => s.entries);
  const refresh = useHistoryStore((s) => s.refresh);
  const clear = useHistoryStore((s) => s.clear);
  const remove = useHistoryStore((s) => s.remove);
  const [clearOpen, setClearOpen] = useState(false);
  const [pendingDelete, setPendingDelete] = useState<number | null>(null);

  useEffect(() => {
    refresh();
  }, [refresh]);

  const handleClear = () => {
    clear();
    setClearOpen(false);
    toast.success("历史已清空");
  };

  const handleDeleteOne = async () => {
    if (pendingDelete == null) return;
    const id = pendingDelete;
    setPendingDelete(null);
    await remove(id);
    toast.success("已删除");
  };

  const handleCopyUrl = async (url: string) => {
    try {
      await copyText(url);
      toast.success("URL 已复制");
    } catch {
      toast.error("复制失败");
    }
  };

  return (
    <div className="flex h-full flex-col">
      <div className="flex shrink-0 items-center justify-between border-b px-2 py-1.5">
        <span className="text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
          历史{entries.length > 0 && ` (${entries.length})`}
        </span>
        <Tooltip>
          <TooltipTrigger asChild>
            <Button
              variant="ghost"
              size="icon"
              className="h-6 w-6 text-muted-foreground hover:text-destructive hover:bg-destructive/10 disabled:opacity-30"
              disabled={entries.length === 0}
              onClick={() => setClearOpen(true)}
            >
              <Trash2 className="h-3 w-3" />
            </Button>
          </TooltipTrigger>
          <TooltipContent side="bottom">
            <TooltipArrow />
            清空历史
          </TooltipContent>
        </Tooltip>
      </div>

      <ScrollArea className="flex-1">
        {entries.length === 0 ? (
          <div className="px-3 py-4 text-center text-xs text-muted-foreground">
            暂无请求历史
          </div>
        ) : (
          <div className="flex flex-col">
            {entries.map((entry) => {
              const statusColor = getStatusColor(entry.status);
              return (
                <ContextMenu key={entry.id}>
                  <ContextMenuTrigger asChild>
                    <div
                      className="flex flex-col gap-0.5 px-2 py-1.5 hover:bg-accent cursor-default border-b border-border/30"
                    >
                      <div className="flex items-center gap-1.5">
                        <span
                          className={`shrink-0 rounded px-1 text-[10px] font-bold ${getMethodColor(entry.method)}`}
                        >
                          {entry.method}
                        </span>
                        <Tooltip>
                          <TooltipTrigger asChild>
                            <span className="truncate text-xs cursor-default">
                              {entry.url}
                            </span>
                          </TooltipTrigger>
                          <TooltipContent side="right" className="max-w-md break-all">
                            {entry.url}
                          </TooltipContent>
                        </Tooltip>
                      </div>
                      <div className="flex items-center gap-2 pl-1 text-[10px] text-muted-foreground">
                        <span className={statusColor}>
                          {entry.status ?? "ERR"}
                        </span>
                        {entry.durationMs != null && <span>{entry.durationMs}ms</span>}
                        <span>{formatTime(entry.createdAt)}</span>
                      </div>
                    </div>
                  </ContextMenuTrigger>
                  <ContextMenuContent>
                    <ContextMenuItem onSelect={() => handleCopyUrl(entry.url)}>
                      <Copy className="mr-2 h-3.5 w-3.5" />
                      复制 URL
                    </ContextMenuItem>
                    <ContextMenuSeparator />
                    <ContextMenuItem
                      className="focus:bg-destructive/10"
                      onSelect={() => setPendingDelete(entry.id)}
                    >
                      <Trash2 className="mr-2 h-3.5 w-3.5 text-destructive" />
                      删除该条
                    </ContextMenuItem>
                  </ContextMenuContent>
                </ContextMenu>
              );
            })}
          </div>
        )}
      </ScrollArea>

      <AlertDialog open={clearOpen} onOpenChange={setClearOpen}>
        <AlertDialogContent className="max-w-md">
          <AlertDialogHeader>
            <AlertDialogTitle>清空历史记录</AlertDialogTitle>
            <AlertDialogDescription>
              确定清空所有历史记录？此操作不可撤销。
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>取消</AlertDialogCancel>
            <AlertDialogAction
              onClick={handleClear}
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
            >
              清空
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <AlertDialog
        open={pendingDelete != null}
        onOpenChange={(o) => !o && setPendingDelete(null)}
      >
        <AlertDialogContent className="max-w-md">
          <AlertDialogHeader>
            <AlertDialogTitle>删除该条历史</AlertDialogTitle>
            <AlertDialogDescription>
              确定删除这条历史记录？此操作不可撤销。
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>取消</AlertDialogCancel>
            <AlertDialogAction
              onClick={handleDeleteOne}
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
            >
              删除
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}

function getStatusColor(status: number | null): string {
  if (status == null) return "text-destructive font-medium";
  if (status < 300) return "text-emerald-500 font-medium";
  if (status < 400) return "text-amber-500 font-medium";
  if (status < 500) return "text-orange-500 font-medium";
  return "text-destructive font-medium";
}