import type { RefObject } from "react";
import { ChevronDown, ChevronUp } from "lucide-react";
import type { PanelImperativeHandle } from "react-resizable-panels";

import type { Tab } from "@/stores/tabs";
import { Button } from "@/components/ui/button";
import { HttpResponse } from "@/components/response/HttpResponse";
import { SseResponse } from "@/components/response/SseResponse";
import { WebSocketResponse } from "@/components/response/WebSocketResponse";
import { GrpcResponse } from "@/components/response/GrpcResponse";

interface ResponsePanelProps {
  tab: Tab;
  panelRef: RefObject<PanelImperativeHandle | null>;
  collapsed: boolean;
}

export function ResponsePanel({ tab, panelRef, collapsed }: ResponsePanelProps) {
  const toggle = () => {
    if (collapsed) panelRef.current?.expand();
    else panelRef.current?.collapse();
  };

  const { http, loading, sse, ws, grpc } = tab;
  const response = http.response;

  if (collapsed) {
    return (
      <div className="flex h-full w-full items-center justify-between border-t bg-card px-1.5">
        <div className="flex items-center gap-2 text-xs">
          <span className="font-medium pl-2">响应</span>
          {grpc ? (
            <span className="text-muted-foreground">
              · gRPC {grpc.status === "connecting" || grpc.status === "streaming" ? `${grpc.streamingKind ?? "..."}...` : grpc.status === "done" ? (grpc.statusCode === 0 ? `OK (${grpc.messageCount})` : `status ${grpc.statusCode}`) : "error"}
            </span>
          ) : ws ? (
            <span className="text-muted-foreground">
              · WebSocket {(ws.status === "open" || ws.status === "connecting") ? "active..." : `(${ws.messages.length} messages)`}
            </span>
          ) : sse ? (
            <span className="text-muted-foreground">
              · SSE {(sse.status === "streaming" || sse.status === "connecting") ? "streaming..." : `(${sse.events.length} events)`}
            </span>
          ) : response ? (
            <span className="text-muted-foreground">
              · {response.response.status} {response.response.statusText}
            </span>
          ) : loading ? (
            <span className="text-muted-foreground">· 请求中...</span>
          ) : null}
        </div>
        <Button
          variant="ghost"
          size="icon"
          className="h-5 w-5"
          onClick={toggle}
          title="展开响应面板"
        >
          <ChevronUp className="h-3 w-3" />
        </Button>
      </div>
    );
  }

  return (
    <div className="flex h-full w-full flex-col border-t bg-card">
      <div className="flex h-8 shrink-0 items-center justify-between border-b px-1.5">
        <span className="text-xs font-medium pl-2">响应</span>
        <Button
          variant="ghost"
          size="icon"
          className="h-5 w-5"
          onClick={toggle}
          title="折叠响应面板（拖动上方分隔条调整高度）"
        >
          <ChevronDown className="h-3 w-3" />
        </Button>
      </div>

      {grpc ? (
        <GrpcResponse grpc={grpc} path={tab.path} />
      ) : ws ? (
        <WebSocketResponse ws={ws} path={tab.path} />
      ) : sse ? (
        <SseResponse sse={sse} path={tab.path} />
      ) : !response && !loading && !http.error ? (
        <div className="flex flex-1 items-center justify-center text-muted-foreground">
          <span className="text-sm">点击 ▶ 发送请求</span>
        </div>
      ) : (
        <HttpResponse http={http} loading={loading} />
      )}
    </div>
  );
}
