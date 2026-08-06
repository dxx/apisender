import { useState } from "react";
import { FileText, History, Settings, ChevronDown, FolderOpen, X } from "lucide-react";

import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Button } from "@/components/ui/button";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Separator } from "@/components/ui/separator";
import {
  DropdownMenu,
  DropdownMenuTrigger,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
} from "@/components/ui/dropdown-menu";
import { FileTree } from "@/components/filetree/FileTree";
import { HistoryList } from "@/components/sidebar/HistoryList";
import { EnvSelector } from "@/components/sidebar/EnvSelector";
import { useWorkspaceStore } from "@/stores/workspace";

interface SidebarProps {
  onSettingsClick: () => void;
}

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

export function Sidebar({ onSettingsClick }: SidebarProps) {
  const [tab, setTab] = useState("files");
  const root = useWorkspaceStore((s) => s.root);
  const tree = useWorkspaceStore((s) => s.tree);
  const recent = useWorkspaceStore((s) => s.recentWorkspaces);
  const openDialog = useWorkspaceStore((s) => s.openDialog);
  const openFolder = useWorkspaceStore((s) => s.openFolder);
  const closeWorkspace = useWorkspaceStore((s) => s.closeWorkspace);
  const removeRecent = useWorkspaceStore((s) => s.removeRecent);

  const rootName = root
    ? root.split(/[\\/]/).pop() ?? root
    : "workspace";

  return (
    <aside className="flex h-full w-full shrink-0 flex-col border-r-2 bg-card">
      <div className="flex h-9 items-center justify-between border-b px-3">
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <button className="flex min-w-0 flex-1 items-center gap-1 text-xs font-medium hover:text-primary">
              <span className="truncate uppercase">{rootName}</span>
              <ChevronDown className="h-4 w-4 shrink-0 text-muted-foreground" />
            </button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="start" className="w-[240px]">
            <div className="px-2 py-1.5">
              <div className="truncate text-xs font-medium lowercase">{rootName}</div>
              <div className="truncate text-[10px] text-muted-foreground">{root}</div>
            </div>
            <DropdownMenuItem
              className="text-xs"
              onClick={() => closeWorkspace()}
            >
              <X className="mr-2 h-3 w-3  text-destructive focus:text-destructive" />
              关闭工作区
            </DropdownMenuItem>
            {recent.length > 0 && (
              <>
                <DropdownMenuSeparator />
                <div className="px-2 py-1 text-[10px] text-muted-foreground">
                  最近打开
                </div>
                <ScrollArea className="max-h-[280px]">
                  {recent.slice(0, 8).map((w) => {
                    const isCurrent = w.path === root;
                    return (
                      <DropdownMenuItem
                        key={w.path}
                        className="group flex items-center justify-between gap-2"
                        disabled={isCurrent}
                        onClick={() => openFolder(w.path)}
                      >
                        <div className="flex min-w-0 flex-1 flex-col">
                          <span className={`truncate text-xs lowercase ${isCurrent ? "text-muted-foreground" : ""}`}>
                            {w.name}
                          </span>
                          <span className="truncate text-[10px] text-muted-foreground">
                            {w.path}
                          </span>
                          <span className="text-[10px] text-muted-foreground">
                            {isCurrent ? "当前工作区" : formatTime(w.lastOpenedAt)}
                          </span>
                        </div>
                        {!isCurrent && (
                          <button
                            className="shrink-0 rounded-sm p-1 opacity-0 group-hover:opacity-100 hover:bg-accent-foreground/10"
                            onClick={(e) => {
                              e.stopPropagation();
                              removeRecent(w.path);
                            }}
                          >
                            <X className="h-3 w-3" />
                          </button>
                        )}
                      </DropdownMenuItem>
                    );
                  })}
                </ScrollArea>
              </>
            )}
            <DropdownMenuSeparator />
            <DropdownMenuItem
              className="text-xs"
              onClick={() => openDialog()}
            >
              <FolderOpen className="mr-2 h-3 w-3" />
              打开文件夹...
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
        <Button
          variant="ghost"
          size="icon"
          className="h-6 w-6 shrink-0 text-muted-foreground"
          title="设置"
          onClick={onSettingsClick}
        >
          <Settings className="h-3.5 w-3.5" />
        </Button>
      </div>

      <div className="flex-1 overflow-hidden">
        <Tabs value={tab} onValueChange={setTab} className="flex h-full flex-col">
          <div className="flex items-center justify-between border-b px-2 py-1">
            <TabsList className="h-7">
              <TabsTrigger value="files" className="text-xs">
                <FileText className="mr-1 h-3 w-3" />
                文件
              </TabsTrigger>
              <TabsTrigger value="history" className="text-xs">
                <History className="mr-1 h-3 w-3" />
                历史
              </TabsTrigger>
            </TabsList>
          </div>

          <TabsContent value="files" className="mt-0 flex-1 overflow-hidden">
            <FileTree nodes={tree} />
          </TabsContent>

          <TabsContent value="history" className="mt-0 flex-1 overflow-hidden">
            <HistoryList />
          </TabsContent>
        </Tabs>
      </div>

      <Separator />
      <div className="shrink-0 p-2">
        <EnvSelector />
      </div>
    </aside>
  );
}
