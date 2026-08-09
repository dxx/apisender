import { useEffect, useState } from "react";
import { FolderOpen, Clock, X } from "lucide-react";

import logo from "@/assets/logo.svg";
import { useWorkspaceStore } from "@/stores/workspace";
import { Button } from "@/components/ui/button";
import { ScrollArea } from "@/components/ui/scroll-area";

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
  if (day < 30) return `${day} 天前`;
  return d.toLocaleDateString();
}

export function Welcome() {
  const openDialog = useWorkspaceStore((s) => s.openDialog);
  const openFolder = useWorkspaceStore((s) => s.openFolder);
  const recent = useWorkspaceStore((s) => s.recentWorkspaces);
  const removeRecent = useWorkspaceStore((s) => s.removeRecent);
  const [showRecent, setShowRecent] = useState(false);

  useEffect(() => {
    setShowRecent(recent.length > 0);
  }, [recent]);

  return (
    <div className="flex h-screen w-screen items-center justify-center bg-background">
      <div className="flex w-full max-w-md flex-col items-center gap-8 px-8">
        <div className="flex flex-col items-center gap-3">
          <div className="h-20 w-20 overflow-hidden rounded-[18px] bg-slate-800 shadow-lg shadow-black/40 ring-1 ring-white/10">
            <img
              src={logo}
              alt="apisender"
              className="h-full w-full"
            />
          </div>
          <p className="text-sm text-muted-foreground">API 请求管理工具</p>
        </div>

        <Button
          size="lg"
          className="w-full"
          onClick={() => openDialog()}
        >
          <FolderOpen className="mr-2 h-4 w-4" />
          打开文件夹
        </Button>

        {showRecent && (
          <div className="w-full">
            <div className="mb-2 flex items-center gap-2 px-1 text-xs font-medium text-muted-foreground">
              <Clock className="h-3 w-3" />
              最近打开的工作区
            </div>
            <ScrollArea className="h-[240px] w-full rounded-md border">
              <div className="flex flex-col p-1">
                {recent.map((w) => (
                  <div
                    key={w.path}
                    className="group flex items-center justify-between rounded-sm px-2 py-2 hover:bg-accent cursor-pointer"
                    onClick={() => openFolder(w.path)}
                  >
                    <div className="flex min-w-0 flex-1 items-center gap-2">
                      <FolderOpen className="h-4 w-4 shrink-0 text-primary" />
                      <div className="flex min-w-0 flex-1 flex-col">
                        <span className="truncate text-sm">{w.name}</span>
                        <span className="truncate text-xs text-muted-foreground">
                          {w.path}
                        </span>
                      </div>
                      <span className="shrink-0 text-xs text-muted-foreground">
                        {formatTime(w.lastOpenedAt)}
                      </span>
                    </div>
                    <button
                      className="ml-2 rounded-sm p-1 opacity-0 group-hover:opacity-100 hover:bg-accent-foreground/10"
                      onClick={(e) => {
                        e.stopPropagation();
                        removeRecent(w.path);
                      }}
                    >
                      <X className="h-3 w-3" />
                    </button>
                  </div>
                ))}
              </div>
            </ScrollArea>
          </div>
        )}

        <div className="text-xs text-muted-foreground">
          快捷键: Ctrl+O 打开 · Ctrl+S 保存
        </div>
      </div>
    </div>
  );
}
