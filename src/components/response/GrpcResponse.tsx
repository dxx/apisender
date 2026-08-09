import { useState, useEffect, useRef } from "react";
import { Square } from "lucide-react";
import { toast } from "sonner";

import type { GrpcState, GrpcMessageRecord } from "@/lib/types";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { Button } from "@/components/ui/button";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import { formatTime } from "@/lib/utils/time";
import { stopGrpc } from "@/lib/tauri";
import { useTabsStore } from "@/stores/tabs";

interface GrpcResponseProps {
  grpc: GrpcState;
  path: string;
}

function formatJson(data: string): string {
  try {
    return JSON.stringify(JSON.parse(data), null, 2);
  } catch {
    return data;
  }
}

function statusBadge(grpc: GrpcState) {
  switch (grpc.status) {
    case "connecting":
      return (
        <span className="flex items-center gap-1 text-amber-500">
          <span className="inline-block h-1.5 w-1.5 animate-pulse rounded-full bg-amber-500" />
          连接中…
        </span>
      );
    case "streaming":
      return (
        <span className="flex items-center gap-1 text-emerald-500">
          <span className="inline-block h-1.5 w-1.5 animate-pulse rounded-full bg-emerald-500" />
          等待中...
        </span>
      );
    case "error": {
      const text = grpc.error ?? "未知错误";
      return (
        <TooltipProvider delayDuration={300}>
          <Tooltip>
            <TooltipTrigger asChild>
              <span className="flex min-w-0 max-w-[500px] items-center gap-1 text-destructive">
                <span className="inline-block h-1.5 w-1.5 shrink-0 rounded-full bg-destructive" />
                <span className="truncate">{text}</span>
              </span>
            </TooltipTrigger>
            <TooltipContent className="max-w-[500px] break-all">{text}</TooltipContent>
          </Tooltip>
        </TooltipProvider>
      );
    }
    case "stop":
      return (
        <span className="flex items-center gap-1 text-muted-foreground">
          <span className="inline-block h-1.5 w-1.5 shrink-0 rounded-full bg-muted-foreground" />
          已停止
          {grpc.totalMs != null && (
            <span className="text-muted-foreground">({grpc.totalMs}ms)</span>
          )}
        </span>
      );
    case "done": {
      const codeColor = grpc.statusCode === 0 ? "text-green-600" : "text-amber-500";
      return (
        <span className="flex items-center gap-1 text-muted-foreground">
          <span className="inline-block h-1.5 w-1.5 shrink-0 rounded-full bg-muted-foreground" />
          已结束
          {grpc.totalMs != null && (
            <span className="text-muted-foreground">({grpc.totalMs}ms)</span>
          )}
          {grpc.statusCode != null && (
            <span className={codeColor}>
              status {grpc.statusCode}{grpc.statusMessage ? `: ${grpc.statusMessage}` : ""}
            </span>
          )}
        </span>
      );
    }
    default:
      return null;
  }
}

export function GrpcResponse({ grpc, path }: GrpcResponseProps) {
  const [tab, setTab] = useState("messages");
  const scrollRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (tab === "messages" && scrollRef.current) {
      const el = scrollRef.current.querySelector("[data-radix-scroll-area-viewport]");
      if (el) el.scrollTop = el.scrollHeight;
    }
  }, [grpc.messages.length, tab]);

  const target = grpc.startPayload
    ? `${grpc.startPayload.package}.${grpc.startPayload.service}/${grpc.startPayload.method}`
    : null;

  // 出错且没有消息时，强制停留在 messages tab 显示错误
  useEffect(() => {
    if (grpc.error && grpc.messages.length === 0) {
      setTab("messages");
    }
  }, [grpc.error, grpc.messages.length]);

  const live = grpc.status === "connecting" || grpc.status === "streaming";

  const onStop = async () => {
    try {
      useTabsStore.getState().setGrpcStop(path);
      await stopGrpc(grpc.reqId);
      toast.success("gRPC 已停止");
    } catch (e) {
      toast.error("停止失败: " + String(e));
    }
  };

  return (
    <div className="flex flex-1 flex-col overflow-hidden">
      <div className="flex h-8 shrink-0 items-center gap-2 border-b px-3 text-xs">
        <span className="font-medium">gRPC</span>
        {grpc.streamingKind && (
          <span className="rounded bg-muted px-1.5 py-0.5 text-[10px] font-medium text-muted-foreground">
            {grpc.streamingKind}
          </span>
        )}
        {target && (
          <span className="text-muted-foreground truncate">{target}</span>
        )}
        {grpc.messageCount > 0 && (
          <span className="text-muted-foreground">{grpc.messageCount} msg</span>
        )}
        {statusBadge(grpc)}
        <div className="ml-auto" />
        {live && (
          <Button
            variant="ghost"
            size="sm"
            className="h-5 gap-1 px-1.5 text-xs"
            onClick={onStop}
            title="停止 gRPC 流"
          >
            <Square className="h-3 w-3 fill-current text-destructive" />
            停止
          </Button>
        )}
      </div>

      <Tabs
        value={tab}
        onValueChange={setTab}
        className="flex flex-1 flex-col overflow-hidden"
      >
        <div className="flex h-7 shrink-0 items-center border-b px-2">
          <TabsList className="h-6">
            <TabsTrigger value="messages" className="text-xs">
              Messages ({grpc.messageCount})
            </TabsTrigger>
            <TabsTrigger value="metadata" className="text-xs">
              Metadata ({grpc.initialMetadata.length + grpc.trailingMetadata.length})
            </TabsTrigger>
          </TabsList>
        </div>

        <TabsContent value="messages" className="mt-0 flex-1 overflow-hidden font-mono text-xs">
          <ScrollArea ref={scrollRef} className="h-full  bg-(--editor-bg)">
            {grpc.messages.length === 0 ? (
              <div className="text-muted-foreground text-center text-sm px-3 py-4">
                {grpc.status === "connecting" || grpc.status === "streaming" ? "等待中..." : "没有消息"}
              </div>
            ) : (
              <div className="flex flex-col gap-3">
                {grpc.messages.map((msg) => (
                  <MessageRow key={msg.index} msg={msg} />
                ))}
              </div>
            )}
          </ScrollArea>
        </TabsContent>

        <TabsContent value="metadata" className="mt-0 flex-1 overflow-auto font-mono text-xs">
          {grpc.initialMetadata.length === 0 && grpc.trailingMetadata.length === 0 ? (
            <div className="text-muted-foreground text-sm px-3 py-1.5">No metadata</div>
          ) : (
            <ScrollArea className="h-full">
              {grpc.initialMetadata.length > 0 && (
                <div className="px-3 py-1">
                  <div className="bg-muted/40 text-[10px] font-medium text-muted-foreground">
                    Initial ({grpc.initialMetadata.length})
                  </div>
                  <table className="w-full text-sm">
                    <tbody>
                      {grpc.initialMetadata.map((kv: [string, string], i: number) => (
                        <tr key={`i-${i}`} className="align-top">
                          <td className="pr-3 text-(--syntax-property)">{kv[0]}</td>
                          <td className="text-(--syntax-string) break-all">{kv[1]}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
              {grpc.trailingMetadata.length > 0 && (
                <div className="px-3 py-1">
                  <div className="bg-muted/40 text-[10px] font-medium text-muted-foreground">
                    Trailing ({grpc.trailingMetadata.length})
                  </div>
                  <table className="w-full text-sm">
                    <tbody>
                      {grpc.trailingMetadata.map((kv: [string, string], i: number) => (
                        <tr key={`t-${i}`} className="align-top">
                          <td className="pr-3 text-muted-foreground">{kv[0]}</td>
                          <td className="break-all">{kv[1]}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </ScrollArea>
          )}
        </TabsContent>
      </Tabs>
    </div>
  );
}

function MessageRow({ msg }: { msg: GrpcMessageRecord }) {
  return (
    <div className="border-b border-border/30 border-primary/30 px-3 py-1.5">
      <div className="mb-1 text-xs text-muted-foreground">
        msg #{msg.index + 1} · {formatTime(msg.tsMs)}
      </div>
      <pre className="whitespace-pre-wrap break-all text-sm text-(--syntax-string)">
        {formatJson(msg.data)}
      </pre>
    </div>
  );
}
