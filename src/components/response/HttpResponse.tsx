import { useState, useMemo, useEffect } from "react";
import { Copy, Square, Loader } from "lucide-react";
import { toast } from "sonner";

import type { HttpState } from "@/lib/types";
import { copyText, cancelHttp } from "@/lib/tauri";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { Button } from "@/components/ui/button";
import { ScrollArea } from "@/components/ui/scroll-area";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { ResponseView } from "@/components/editor/ResponseView";
import { getBodyLanguage, type BodyFormat } from "@/components/editor/body-lang";
import { statusColor } from "@/lib/utils/http";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";

interface HttpResponseProps {
  http: HttpState;
  loading: boolean;
}

export function HttpResponse({ http, loading }: HttpResponseProps) {
  const { response, error: httpError, reqId } = http;
  const [bodyFormat, setBodyFormat] = useState<BodyFormat | "auto">("auto");
  const [activeTab, setActiveTab] = useState("body");

  useEffect(() => {
    setActiveTab("body");
  }, [response]);

  const r = response?.response;

  const bodyText = useMemo(() => {
    if (!r) return "";
    const body = r.body;
    if (body.type === "Text") return body.data;
    return "[Binary data, base64 encoded]\n" + body.data.slice(0, 500) + "...";
  }, [response]);

  const effectiveFormat = useMemo<BodyFormat>(() => {
    if (!r) return "text";
    if (bodyFormat !== "auto") return bodyFormat;
    const ct = r.headers.find(
      ([k]) => k.toLowerCase() === "content-type"
    )?.[1] ?? "";
    if (ct.includes("json")) return "json";
    if (ct.includes("xml")) return "xml";
    if (ct.includes("html")) return "html";
    return "text";
  }, [bodyFormat, response]);

  const formattedBody = useMemo(() => {
    if (!bodyText) return "";
    if (effectiveFormat === "json") {
      try {
        return JSON.stringify(JSON.parse(bodyText), null, 2);
      } catch {
        return bodyText;
      }
    }
    return bodyText;
  }, [bodyText, effectiveFormat]);

  const rawText = useMemo(() => {
    if (!r) return "";
    const statusLine = `${r.version} ${r.status} ${r.statusText}`;
    const headerLines = r.headers.map(([k, v]) => `${k}: ${v}`).join("\n");
    const bodyText =
      r.body.type === "Text"
        ? r.body.data
        : `[Binary data, base64 encoded]\n${r.body.data}`;
    return `${statusLine}\n${headerLines}\n\n${bodyText}`;
  }, [response]);

  const onCancel = async () => {
    if (!reqId) return;
    try {
      await cancelHttp(reqId);
      toast.success("请求已取消");
    } catch (e) {
      toast.error("取消失败: " + String(e));
    }
  };

  const copyRaw = async () => {
    try {
      await copyText(rawText);
      toast.success("已复制 Raw");
    } catch (e) {
      toast.error("复制失败: " + String(e));
    }
  };

  const copyBody = async () => {
    try {
      await copyText(formattedBody);
      toast.success("已复制 Body");
    } catch (e) {
      toast.error("复制失败: " + String(e));
    }
  };

  if (loading) {
    return (
      <div className="flex flex-1 flex-col">
        <div className="flex h-8 shrink-0 items-center gap-2 border-b px-3 text-xs">
          <span className="flex items-center gap-1 text-amber-500">
            <span className="inline-block h-1.5 w-1.5 animate-pulse rounded-full bg-amber-500" />
            等待中...
          </span>
          <div className="ml-auto" />
          <Button
            variant="ghost"
            size="sm"
            className="h-5 gap-1 px-1.5 text-xs"
            onClick={onCancel}
            title="取消请求"
          >
            <Square className="h-3 w-3 fill-current text-destructive" />
            取消
          </Button>
        </div>
        <div className="flex flex-1 items-center justify-center gap-2 text-muted-foreground">
          <Loader className="h-4 w-4 animate-spin" />
          <span className="text-sm">请求中...</span>
        </div>
      </div>
    );
  }

  if (httpError && !r) {
    return (
      <div className="flex flex-1 flex-col">
        <div className="flex h-8 shrink-0 items-center gap-2 border-b px-3 text-xs">
          <TooltipProvider delayDuration={300}>
            <Tooltip>
              <TooltipTrigger asChild>
                <span className="flex min-w-0 max-w-[500px] items-center gap-1 text-destructive">
                  <span className="inline-block h-1.5 w-1.5 shrink-0 rounded-full bg-destructive" />
                  <span className="truncate">{httpError}</span>
                </span>
              </TooltipTrigger>
              <TooltipContent side="bottom" align="start" className="max-w-[800px] break-all whitespace-pre-wrap">
                {httpError}
              </TooltipContent>
            </Tooltip>
          </TooltipProvider>
        </div>
      </div>
    );
  }

  if (!r) return null;

  return (
    <div className="flex flex-1 flex-col overflow-hidden">
      <div className="flex h-8 shrink-0 items-center gap-4 border-b px-3 text-xs">
        <span className={`font-semibold ${statusColor(r.status)}`}>
          {r.status === 0
            ? "✕ Error"
            : `${r.status} ${r.statusText}`}
        </span>
        <span className="text-muted-foreground">
          {r.durationMs}ms
        </span>
        <span className="text-muted-foreground">
          {formatSize(r.size)}
        </span>
        <span className="text-muted-foreground">
          {r.headers.length} headers
        </span>
      </div>

      <Tabs
        value={activeTab}
        onValueChange={setActiveTab}
        className="flex flex-1 flex-col overflow-hidden"
      >
        <div className="flex h-8 shrink-0 items-center border-b px-2">
          <TabsList className="h-7">
            <TabsTrigger value="body" className="text-xs">
              Body
            </TabsTrigger>
            <TabsTrigger value="headers" className="text-xs">
              Headers
            </TabsTrigger>
            <TabsTrigger value="cookies" className="text-xs">
              Cookies
            </TabsTrigger>
            <TabsTrigger value="response" className="text-xs">
              Response
            </TabsTrigger>
          </TabsList>
        </div>

        <TabsContent value="body" className="mt-0 flex-1 overflow-hidden">
          <div className="flex h-full flex-col">
            <div className="flex h-7 shrink-0 items-center gap-2 border-b px-2">
              <Select
                value={bodyFormat}
                onValueChange={(v) => setBodyFormat(v as BodyFormat | "auto")}
              >
                <SelectTrigger className="h-5 w-auto min-w-[64px] gap-1 rounded border-border/60 px-1.5 text-xs shadow-none focus:ring-0 focus:ring-offset-0 [&>span]:text-xs">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent className="min-w-[100px]">
                  <SelectItem value="auto">Auto</SelectItem>
                  <SelectItem value="json">JSON</SelectItem>
                  <SelectItem value="xml">XML</SelectItem>
                  <SelectItem value="html">HTML</SelectItem>
                  <SelectItem value="text">Text</SelectItem>
                </SelectContent>
              </Select>
              <div className="flex-1" />
              <Button
                variant="ghost"
                size="icon"
                className="h-5 w-5"
                title="复制"
                onClick={copyBody}
              >
                <Copy className="h-3 w-3" />
              </Button>
            </div>
            <div className="flex-1 overflow-hidden">
              <ResponseView
                text={formattedBody || "[Empty response body]"}
                language={getBodyLanguage(effectiveFormat)}
              />
            </div>
          </div>
        </TabsContent>

        <TabsContent value="headers" className="mt-0 flex-1 overflow-hidden">
          <ScrollArea className="h-full">
            <table className="w-full font-response text-response-size">
              <tbody>
                {r.headers.length > 0 ? (
                  r.headers.map(([key, value], i) => (
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
            <div className="flex flex-col font-response text-response-size">
              {r.cookies.length > 0 ? (
                r.cookies.map((c, i) => (
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

        <TabsContent value="response" className="mt-0 flex-1 overflow-hidden">
          <div className="flex h-full flex-col">
            <div className="flex h-7 shrink-0 items-center gap-2 border-b px-2">
              <span className="text-xs text-muted-foreground">原始响应</span>
              <div className="flex-1" />
              <Button
                variant="ghost"
                size="icon"
                className="h-5 w-5"
                title="复制"
                onClick={copyRaw}
              >
                <Copy className="h-3 w-3" />
              </Button>
            </div>
            <div className="flex-1 overflow-hidden">
              <ResponseView text={rawText || "[Empty response]"} />
            </div>
          </div>
        </TabsContent>
      </Tabs>
    </div>
  );
}

function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes}B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)}KB`;
  return `${(bytes / 1024 / 1024).toFixed(2)}MB`;
}
