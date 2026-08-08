import { useEffect, useRef, useState, useMemo, useCallback } from "react";
import { Compartment, EditorState } from "@codemirror/state";
import { EditorView, keymap } from "@codemirror/view";
import { defaultKeymap, history, historyKeymap } from "@codemirror/commands";
import { json } from "@codemirror/lang-json";
import { xml } from "@codemirror/lang-xml";
import { html as htmlLang } from "@codemirror/lang-html";
import { Copy, Square, ArrowDown, ArrowUp, Send, ChevronDown, ChevronUp } from "lucide-react";
import { toast } from "sonner";

import type { WsDirection, WsMessageRecord, WsState } from "@/lib/types";
import { sendWebSocket, closeWebSocket, copyText } from "@/lib/tauri";
import { useTabsStore } from "@/stores/tabs";
import { Button } from "@/components/ui/button";
import { ScrollArea } from "@/components/ui/scroll-area";
import { syntaxHighlightingExt } from "@/components/editor/syntax-theme";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { formatTime } from "@/lib/utils/time";
import { statusColor } from "@/lib/utils/http";

interface WebSocketResponseProps {
  ws: WsState;
  path: string;
}

type Format = "text" | "json" | "xml" | "html";

function statusBadge(ws: WsState) {
  switch (ws.status) {
    case "connecting":
      return (
        <span className="flex items-center gap-1 text-amber-500">
          <span className="inline-block h-1.5 w-1.5 animate-pulse rounded-full bg-amber-500" />
          连接中…
        </span>
      );
    case "open":
      return (
        <span className="flex items-center gap-1 text-emerald-500">
          <span className="inline-block h-1.5 w-1.5 animate-pulse rounded-full bg-emerald-500" />
          已连接
          {ws.totalMs != null && <span className="text-muted-foreground">({ws.totalMs}ms)</span>}
        </span>
      );
    case "idle_timeout":
      return (
        <span className="flex items-center gap-1 text-orange-500">
          <span className="inline-block h-1.5 w-1.5 rounded-full bg-orange-500" />
          空闲超时
          {ws.idleTimeoutMs != null && (
            <span className="text-muted-foreground">({ws.idleTimeoutMs}ms)</span>
          )}
        </span>
      );
    case "error": {
      const text = ws.error ?? "未知错误";
      return (
        <TooltipProvider delayDuration={300}>
          <Tooltip>
            <TooltipTrigger asChild>
              <span className="flex min-w-0 max-w-[400px] items-center gap-1 text-destructive">
                <span className="inline-block h-1.5 w-1.5 shrink-0 rounded-full bg-destructive" />
                <span className="truncate">{text}</span>
              </span>
            </TooltipTrigger>
            <TooltipContent className="max-w-[500px] break-all">{text}</TooltipContent>
          </Tooltip>
        </TooltipProvider>
      );
    }
    default: {
      if (ws.closeCode != null) {
        const codeText = ws.closeReason
          ? `已关闭 (${ws.closeCode}: ${ws.closeReason})`
          : `已关闭 (${ws.closeCode})`;
        return (
          <TooltipProvider delayDuration={300}>
            <Tooltip>
              <TooltipTrigger asChild>
                <span className="flex min-w-0 max-w-[400px] items-center gap-1 text-muted-foreground">
                  <span className="inline-block h-1.5 w-1.5 shrink-0 rounded-full bg-muted-foreground" />
                  <span className="truncate">{codeText}</span>
                  {ws.totalMs != null && <span className="text-muted-foreground">({ws.totalMs}ms)</span>}
                </span>
              </TooltipTrigger>
              <TooltipContent className="max-w-[500px] break-all">{codeText}</TooltipContent>
            </Tooltip>
          </TooltipProvider>
        );
      }
      return (
        <span className="flex items-center gap-1 text-muted-foreground">
          <span className="inline-block h-1.5 w-1.5 rounded-full bg-muted-foreground" />
          已关闭
        </span>
      );
    }
  }
}

export function WebSocketResponse({ ws, path }: WebSocketResponseProps) {
  const [draft, setDraft] = useState("");
  const [format, setFormat] = useState<Format>("text");
  const [headersOpen, setHeadersOpen] = useState(false);
  const outIndexRef = useRef(0);
  const editorRef = useRef<HTMLDivElement>(null);
  const viewRef = useRef<EditorView | null>(null);
  const languageCompartment = useRef(new Compartment());
  const scrollRef = useRef<HTMLDivElement>(null);

  const appendWsMessage = useTabsStore((s) => s.appendWsMessage);

  const language = useMemo(() => {
    switch (format) {
      case "json":
        return json();
      case "xml":
        return xml();
      case "html":
        return htmlLang();
      default:
        return [];
    }
  }, [format]);

  const send = useCallback(async () => {
    const text = draft;
    if (!text.trim()) return;
    const live = ws.status === "connecting" || ws.status === "open";
    if (!live) {
      toast.error("WebSocket 已关闭，无法发送");
      return;
    }
    const ts = Date.now();
    const nextOutIndex = ++outIndexRef.current;
    appendWsMessage(path, ws.reqId, {
      id: crypto.randomUUID(),
      direction: "out" as WsDirection,
      data: text,
      ts,
      index: nextOutIndex,
    });
    try {
      await sendWebSocket(ws.reqId, text);
      setDraft("");
      if (viewRef.current) {
        viewRef.current.dispatch({
          changes: { from: 0, to: viewRef.current.state.doc.length, insert: "" },
        });
      }
    } catch (e) {
      toast.error("发送失败: " + String(e));
    }
  }, [draft, ws.status, ws.reqId, path, appendWsMessage]);

  useEffect(() => {
    if (!editorRef.current) return;
    let view: EditorView;
    try {
      const state = EditorState.create({
        doc: "",
        extensions: [
          history(),
          syntaxHighlightingExt,
          keymap.of([
            ...defaultKeymap,
            ...historyKeymap,
            {
              key: "Mod-Enter",
              run: () => {
                void send();
                return true;
              },
            },
          ]),
          languageCompartment.current.of(language),
          EditorView.lineWrapping,
          EditorView.updateListener.of((update) => {
            if (update.docChanged) {
              setDraft(update.state.doc.toString());
            }
          }),
          EditorView.theme({
            "&": {
              fontSize: "13px",
              backgroundColor: "var(--editor-bg)",
              border: "1px solid var(--border)",
              borderRadius: "4px",
            },
            ".cm-content": {
              fontFamily: "var(--font-mono)",
              fontVariantLigatures: "none",
              fontFeatureSettings: '"liga" 0, "calt" 0',
              padding: "6px 0",
              minHeight: "32px",
              caretColor: "var(--foreground)",
            },
            ".cm-cursor, .cm-dropCursor": {
              borderLeftColor: "var(--foreground)",
            },
            ".cm-line": {
              padding: "0 8px",
            },
            "&.cm-focused": {
              outline: "none",
              borderColor: "var(--ring)",
            },
          }),
        ],
      });

      view = new EditorView({
        state,
        parent: editorRef.current,
      });
      viewRef.current = view;
    } catch (e) {
      console.error("[WebSocketResponse] failed to create EditorView:", e);
      return;
    }
    return () => {
      view.destroy();
      viewRef.current = null;
    };
  }, []);

  useEffect(() => {
    const view = viewRef.current;
    if (!view) return;
    view.dispatch({
      effects: languageCompartment.current.reconfigure(language),
    });
  }, [language]);

  useEffect(() => {
    if (!scrollRef.current) return;
    const el = scrollRef.current.querySelector("[data-radix-scroll-area-viewport]");
    if (el) el.scrollTop = el.scrollHeight;
  }, [ws.messages.length]);

  const onStop = async () => {
    try {
      await closeWebSocket(ws.reqId);
      toast.success("WebSocket 已停止");
    } catch (e) {
      toast.error("停止失败: " + String(e));
    }
  };

  const live = ws.status === "connecting" || ws.status === "open";

  return (
    <div className="flex flex-1 flex-col overflow-hidden">
      <div className="flex h-8 shrink-0 items-center gap-4 border-b px-3 text-xs">
        {ws.startPayload ? (
          <span className={`font-semibold ${statusColor(ws.startPayload.status)}`}>
            {ws.startPayload.status} {ws.startPayload.statusText}
          </span>
        ) : (
          <span className="font-semibold text-muted-foreground">WebSocket</span>
        )}
        {ws.startPayload?.url && (
          <span className="text-muted-foreground truncate">{ws.startPayload.url}</span>
        )}
        <span className="text-muted-foreground">{ws.messages.length} messages</span>
        {statusBadge(ws)}
        <div className="flex-1" />
        {ws.startPayload?.headers && ws.startPayload.headers.length > 0 && (
          <Button
            variant="ghost"
            size="sm"
            className="h-5 gap-1 px-1.5 text-xs"
            onClick={() => setHeadersOpen((v) => !v)}
            title={headersOpen ? "收起握手响应头" : "展开握手响应头"}
          >
            {headersOpen ? (
              <ChevronUp className="h-3 w-3" />
            ) : (
              <ChevronDown className="h-3 w-3" />
            )}
            Headers ({ws.startPayload.headers.length})
          </Button>
        )}
        {live && (
          <Button
            variant="ghost"
            size="sm"
            className="h-5 gap-1 px-1.5 text-xs"
            onClick={onStop}
            title="关闭 WebSocket"
          >
            <Square className="h-3 w-3 fill-current text-destructive" />
            停止
          </Button>
        )}
      </div>

      {headersOpen && ws.startPayload?.headers && ws.startPayload.headers.length > 0 && (
        <div className="shrink-0 border-b bg-card max-h-48 overflow-auto">
          <table className="w-full text-xs">
            <tbody>
              {ws.startPayload.headers.map(([key, value], i) => (
                <tr key={i} className="border-b border-border/30 last:border-b-0">
                  <td className="px-3 py-1 align-top font-medium text-(--syntax-property) whitespace-nowrap">
                    {key}
                  </td>
                  <td className="px-3 py-1 break-all font-mono text-(--syntax-string)">
                    {value}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <ScrollArea
        ref={scrollRef}
        className="flex-1 bg-(--editor-bg)"
        style={{
          fontFamily: "var(--font-mono)",
          fontVariantLigatures: "none",
          fontFeatureSettings: '"liga" 0, "calt" 0',
        }}
      >
        <div className="flex flex-col">
          {ws.messages.length === 0 ? (
            <div className="px-3 py-4 text-center text-sm text-muted-foreground">
              {live ? "等待消息..." : "暂无消息"}
            </div>
          ) : (
            ws.messages.map((m) => (
              <MessageRow key={m.id} msg={m} />
            ))
          )}
        </div>
      </ScrollArea>

      <div className="flex shrink-0 items-center gap-2 border-t p-2">
        <Select value={format} onValueChange={(v) => setFormat(v as Format)}>
          <SelectTrigger className="h-7 w-[100px] text-xs">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="text">Text</SelectItem>
            <SelectItem value="json">JSON</SelectItem>
            <SelectItem value="xml">XML</SelectItem>
            <SelectItem value="html">HTML</SelectItem>
          </SelectContent>
        </Select>
        <div ref={editorRef} className="flex-1" />
        <Button
          size="sm"
          className="h-7 gap-1"
          onClick={send}
          disabled={!live}
          title="发送 (Ctrl/⌘+Enter)"
        >
          <Send className="h-3 w-3" />
          发送
        </Button>
      </div>
    </div>
  );
}

function MessageRow({ msg }: { msg: WsMessageRecord }) {
  const [copied, setCopied] = useState(false);
  const isOut = msg.direction === "out";
  const Icon = isOut ? ArrowUp : ArrowDown;
  const colorClass = isOut
    ? "border-l-emerald-500/40"
    : "border-l-blue-500/40";
  const iconColor = isOut ? "text-emerald-500" : "text-blue-500";

  const copy = async () => {
    try {
      await copyText(msg.data);
      setCopied(true);
      setTimeout(() => setCopied(false), 1200);
    } catch (e) {
      toast.error("复制失败: " + String(e));
    }
  };

  const dirPrefix = isOut ? "out" : "in";

  return (
    <div className={`border-b border-border/30 px-3 py-1.5 ${colorClass}`}>
      <div className="mb-0.5 flex items-center gap-2 text-sm">
        <Icon className={`h-3 w-3 ${iconColor}`} />
        <span className="font-mono text-xs text-muted-foreground">{formatTime(msg.ts)}</span>
        <span className="font-mono text-xs text-muted-foreground">#{dirPrefix}-{msg.index}</span>
        <span className={`text-xs font-medium ${iconColor}`}>
          {isOut ? "↑ out" : "↓ in"}
        </span>
        <div className="flex-1" />
        <TooltipProvider delayDuration={300}>
          <Tooltip>
              <TooltipTrigger asChild>
                {copied ? (
                  <span className="select-none cursor-default text-[10px] text-emerald-500 ">已复制</span>
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
      <pre className="whitespace-pre-wrap break-all font-mono text-sm text-(--syntax-string)">
        {msg.data}
      </pre>
    </div>
  );
}