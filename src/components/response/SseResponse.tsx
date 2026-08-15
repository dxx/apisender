import { useState, useMemo, useRef, useEffect } from "react";
import { Copy, Square } from "lucide-react";
import { toast } from "sonner";

import type { SseEvent, SseState } from "@/lib/types";
import { useTabsStore } from "@/stores/tabs";
import { copyText, stopSse } from "@/lib/tauri";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { Button } from "@/components/ui/button";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import { ResponseView } from "@/components/editor/ResponseView";
import { statusColor } from "@/lib/utils/http";

interface SseResponseProps {
  sse: SseState;
  path: string;
}

function statusBadge(sse: SseState) {
  switch (sse.status) {
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
      const text = sse.error ?? "未知错误";
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
          {sse.totalMs != null && (
            <span className="text-muted-foreground">({sse.totalMs}ms)</span>
          )}
        </span>
      );
    case "done":
      return (
        <span className="flex items-center gap-1 text-muted-foreground">
          <span className="inline-block h-1.5 w-1.5 shrink-0 rounded-full bg-muted-foreground" />
          已结束
          {sse.totalMs != null && (
            <span className="text-muted-foreground">({sse.totalMs}ms)</span>
          )}
        </span>
      );
    default:
      return null;
  }
}

export function SseResponse({ sse, path }: SseResponseProps) {
  const start = sse.startPayload;
  const events = sse.events;
  const [view, setView] = useState<"events" | "raw" | "headers" | "cookies">("events");
  const scrollRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (view === "events" && scrollRef.current) {
      const el = scrollRef.current.querySelector("[data-radix-scroll-area-viewport]");
      if (el) el.scrollTop = el.scrollHeight;
    }
  }, [events.length, view]);

  const rawText = useMemo(() => {
    return events
      .map((e) => {
        const lines: string[] = [];
        if (e.id) lines.push(`id: ${e.id}`);
        if (e.event && e.event !== "message") lines.push(`event: ${e.event}`);
        if (e.retry != null) lines.push(`retry: ${e.retry}`);
        lines.push(`data: ${e.data}`);
        return lines.join("\n");
      })
      .join("\n\n");
  }, [events]);

  const copyAll = async () => {
    try {
      await copyText(rawText);
      toast.success("已复制 Raw 内容");
    } catch (e) {
      toast.error("复制失败: " + String(e));
    }
  };

  const onStop = async () => {
    try {
      useTabsStore.getState().setSseStop(path);
      await stopSse(sse.reqId);
      toast.success("SSE 已停止");
    } catch (e) {
      toast.error("停止失败: " + String(e));
    }
  };

  const live = sse.status === "connecting" || sse.status === "streaming";

  return (
    <div className="flex flex-1 flex-col overflow-hidden">
      <div className="flex h-8 shrink-0 items-center gap-4 border-b px-3 text-xs">
        {start ? (
          <span className={`font-semibold ${statusColor(start.status)}`}>
            {start.status} {start.statusText}
          </span>
        ) : (
          <span className="font-semibold text-muted-foreground">SSE</span>
        )}
        <span className="text-muted-foreground">{events.length} events</span>
        {statusBadge(sse)}
        <div className="flex-1" />
        {live && (
          <Button
            variant="ghost"
            size="sm"
            className="h-5 gap-1 px-1.5 text-xs"
            onClick={onStop}
            title="停止 SSE 流"
          >
            <Square className="h-3 w-3 fill-current text-destructive" />
            停止
          </Button>
        )}
      </div>

      <Tabs
        value={view}
        onValueChange={(v) => setView(v as "events" | "raw" | "headers" | "cookies")}
        className="flex flex-1 flex-col overflow-hidden"
      >
        <div className="flex h-8 shrink-0 items-center border-b px-2">
          <TabsList className="h-7">
            <TabsTrigger value="events" className="text-xs">
              Events
            </TabsTrigger>
            <TabsTrigger value="raw" className="text-xs">
              Raw
            </TabsTrigger>
            <TabsTrigger value="headers" className="text-xs">
              Headers
            </TabsTrigger>
            <TabsTrigger value="cookies" className="text-xs">
              Cookies
            </TabsTrigger>
          </TabsList>
          <div className="flex-1" />
          {view === "raw" && (
            <Button
              variant="ghost"
              size="icon"
              className="h-5 w-5"
              title="复制全部"
              onClick={copyAll}
            >
              <Copy className="h-3 w-3" />
            </Button>
          )}
        </div>

        <TabsContent value="events" className="mt-0 flex-1 overflow-hidden">
          <ScrollArea ref={scrollRef} className="h-full bg-(--editor-bg)">
            <div className="flex flex-col text-sm font-mono">
              {events.length === 0 ? (
                <div className="px-3 py-4 text-center text-muted-foreground">
                  {live ? "等待事件..." : "无事件"}
                </div>
              ) : (
                events.map((evt, i) => (
                  <MessageRow key={i} evt={evt} index={i} />
                ))
              )}
            </div>
          </ScrollArea>
        </TabsContent>

        <TabsContent value="raw" className="mt-0 flex-1 overflow-hidden">
          <ResponseView text={rawText || "[No events]"} />
        </TabsContent>

        <TabsContent value="headers" className="mt-0 flex-1 overflow-hidden">
          <ScrollArea className="h-full">
            <table className="w-full text-sm font-mono">
              <tbody>
                {start && start.headers.length > 0 ? (
                  start.headers.map(([key, value], i) => (
                    <tr key={i} className="border-b border-border/30">
                      <td className="px-3 py-1.5 align-top font-medium text-(--syntax-property)">
                        {key}
                      </td>
                      <td className="px-3 py-1.5 break-all text-(--syntax-string)">
                        {value}
                      </td>
                    </tr>
                  ))
                ) : (
                  <tr>
                    <td className="px-3 py-4 text-center text-muted-foreground">
                      No Headers
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </ScrollArea>
        </TabsContent>

        <TabsContent value="cookies" className="mt-0 flex-1 overflow-hidden">
          <ScrollArea className="h-full">
            <div className="flex flex-col text-sm font-mono">
              {start && start.cookies.length > 0 ? (
                start.cookies.map((c, i) => (
                  <div
                    key={i}
                    className="border-b border-border/30 px-3 py-1.5 break-all text-(--syntax-string)"
                  >
                    {c}
                  </div>
                ))
              ) : (
                <div className="px-3 py-4 text-center text-muted-foreground">
                  No Cookie
                </div>
              )}
            </div>
          </ScrollArea>
        </TabsContent>
      </Tabs>
    </div>
  );
}

function MessageRow({ evt, index }: { evt: SseEvent; index: number }) {
  const [copied, setCopied] = useState(false);

  const copy = async () => {
    try {
      await copyText(evt.data);
      setCopied(true);
      setTimeout(() => setCopied(false), 1200);
    } catch (e) {
      toast.error("复制失败: " + String(e));
    }
  };

  return (
    <div className="border-b border-border/30 px-3 py-1.5">
      <div className="mb-0.5 flex items-center gap-2">
        <span className="text-muted-foreground text-xs">#{index}</span>
        {evt.event !== "message" && (
          <span className="rounded bg-primary/10 px-1 font-medium text-primary">
            {evt.event}
          </span>
        )}
        {evt.id && (
          <span className="text-muted-foreground">id: {evt.id}</span>
        )}
        {evt.retry != null && (
          <span className="text-muted-foreground">retry: {evt.retry}</span>
        )}
        <div className="flex-1" />
        <TooltipProvider delayDuration={300}>
          <Tooltip>
            <TooltipTrigger asChild>
              {copied ? (
                <span className="select-none cursor-default text-[10px] text-emerald-500">已复制</span>
              ) : (
                <button
                  type="button"
                  className="rounded p-0.5 text-muted-foreground hover:bg-accent"
                  onClick={copy}
                  title="复制"
                >
                  <Copy className="h-3 w-3" />
                </button>
              )}
            </TooltipTrigger>
            <TooltipContent>复制消息内容</TooltipContent>
          </Tooltip>
        </TooltipProvider>
      </div>
      <pre className="whitespace-pre-wrap break-all text-(--syntax-string)">
        {evt.data}
      </pre>
    </div>
  );
}
