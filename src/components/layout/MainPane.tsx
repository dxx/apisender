import { useEffect, useRef, useState } from "react";
import { listen } from "@tauri-apps/api/event";
import { X, Circle } from "lucide-react";
import { Group, Panel, Separator, usePanelRef } from "react-resizable-panels";

import { useTabsStore } from "@/stores/tabs";
import { HttpEditor } from "@/components/editor/HttpEditor";
import { PlainEditor } from "@/components/editor/PlainEditor";
import { ResponsePanel } from "@/components/layout/ResponsePanel";
import { TabsScrollbar } from "@/components/layout/TabsScrollbar";
import { isRequestFile } from "@/lib/file";
import { useHorizontalWheelScroll } from "@/hooks/useHorizontalWheelScroll";
import type {
  SseStartPayload,
  SseEvent,
  SseEndPayload,
  SseErrorPayload,
  WsStartPayload,
  WsMessagePayload,
  WsClosePayload,
  WsIdleTimeoutPayload,
  WsErrorPayload,
  WsClosedPayload,
  GrpcStartPayload,
  GrpcMessagePayload,
  GrpcMetadataPayload,
  GrpcStatusPayload,
  GrpcErrorPayload,
  GrpcClosedPayload,
} from "@/lib/types";
import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuTrigger,
} from "@/components/ui/context-menu";
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
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";

export function MainPane() {
  const tabs = useTabsStore((s) => s.tabs);
  const hasTabs = tabs.length > 0;
  const activePath = useTabsStore((s) => s.activePath);
  const setActive = useTabsStore((s) => s.setActive);
  const closeTab = useTabsStore((s) => s.closeTab);
  const closeOtherTabs = useTabsStore((s) => s.closeOtherTabs);
  const closeAllTabs = useTabsStore((s) => s.closeAllTabs);

  const activeTab = tabs.find((t) => t.path === activePath) ?? null;

  const responsePanelRef = usePanelRef();
  const tabsScrollRef = useRef<HTMLDivElement>(null);
  const [responseCollapsed, setResponseCollapsed] = useState(false);

  useEffect(() => {
    if (
      responseCollapsed &&
      (activeTab?.http.response || activeTab?.sse || activeTab?.ws || activeTab?.grpc)
    ) {
      responsePanelRef.current?.expand();
    }
  }, [activeTab?.http.response, activeTab?.sse, activeTab?.ws, activeTab?.grpc]);

  useEffect(() => {
    const unlistens: Promise<(() => void)>[] = [];

    unlistens.push(
      listen<SseStartPayload>("sse-start", (e) => {
        const payload = e.payload;
        const state = useTabsStore.getState();
        const tab = state.tabs.find((t) => t.sse?.reqId === payload.reqId);
        if (tab) {
          state.setSseStart(tab.path, payload.reqId, {
            reqId: payload.reqId,
            status: payload.status,
            statusText: payload.statusText,
            headers: payload.headers,
            url: payload.url,
            connectMs: payload.connectMs,
            cookies: payload.cookies,
          });
        }
      })
    );

    unlistens.push(
      listen<{ reqId: string; event: SseEvent }>("sse-event", (e) => {
        const { reqId, event } = e.payload;
        const state = useTabsStore.getState();
        const tab = state.tabs.find((t) => t.sse?.reqId === reqId);
        if (tab) {
          state.appendSseEvent(tab.path, reqId, event);
        }
      })
    );

    unlistens.push(
      listen<SseEndPayload>("sse-end", (e) => {
        const { reqId, totalMs } = e.payload;
        const state = useTabsStore.getState();
        const tab = state.tabs.find((t) => t.sse?.reqId === reqId);
        if (tab) {
          state.setSseDone(tab.path, reqId, totalMs);
        }
      })
    );

    unlistens.push(
      listen<SseErrorPayload>("sse-error", (e) => {
        const { reqId, error } = e.payload;
        const state = useTabsStore.getState();
        const tab = state.tabs.find((t) => t.sse?.reqId === reqId);
        if (tab) {
          state.setSseError(tab.path, reqId, error);
        }
      })
    );

    unlistens.push(
      listen<WsStartPayload>("ws-open", (e) => {
        const payload = e.payload;
        const state = useTabsStore.getState();
        const tab = state.tabs.find((t) => t.ws?.reqId === payload.reqId);
        if (tab) {
          state.setWsOpen(tab.path, payload.reqId, {
            reqId: payload.reqId,
            status: payload.status,
            statusText: payload.statusText,
            headers: payload.headers,
            url: payload.url,
            connectMs: payload.connectMs,
          });
        }
      })
    );

    unlistens.push(
      listen<WsMessagePayload>("ws-message", (e) => {
        const { reqId, data, tsMs, index } = e.payload;
        const state = useTabsStore.getState();
        const tab = state.tabs.find((t) => t.ws?.reqId === reqId);
        if (tab) {
          state.appendWsMessage(tab.path, reqId, {
            id: crypto.randomUUID(),
            direction: "in",
            data,
            ts: tsMs,
            index,
          });
        }
      })
    );

    unlistens.push(
      listen<WsClosePayload>("ws-close", (e) => {
        const { reqId, code, reason } = e.payload;
        const state = useTabsStore.getState();
        const tab = state.tabs.find((t) => t.ws?.reqId === reqId);
        if (tab) {
          state.setWsClose(tab.path, reqId, code, reason);
        }
      })
    );

    unlistens.push(
      listen<WsIdleTimeoutPayload>("ws-idle-timeout", (e) => {
        const { reqId, idleMs } = e.payload;
        const state = useTabsStore.getState();
        const tab = state.tabs.find((t) => t.ws?.reqId === reqId);
        if (tab) {
          state.setWsIdleTimeout(tab.path, reqId, idleMs);
        }
      })
    );

    unlistens.push(
      listen<WsErrorPayload>("ws-error", (e) => {
        const { reqId, error } = e.payload;
        const state = useTabsStore.getState();
        const tab = state.tabs.find((t) => t.ws?.reqId === reqId);
        if (tab) {
          state.setWsError(tab.path, reqId, error);
        }
      })
    );

    unlistens.push(
      listen<WsClosedPayload>("ws-closed", (e) => {
        const { reqId, totalMs } = e.payload;
        const state = useTabsStore.getState();
        const tab = state.tabs.find((t) => t.ws?.reqId === reqId);
        if (tab) {
          state.setWsClosed(tab.path, reqId, totalMs);
        }
      })
    );

    unlistens.push(
      listen<GrpcStartPayload>("grpc-start", (e) => {
        const payload = e.payload;
        const state = useTabsStore.getState();
        const tab = state.tabs.find((t) => t.grpc?.reqId === payload.reqId);
        if (tab) {
          state.setGrpcStart(tab.path, payload.reqId, payload);
        }
      })
    );

    unlistens.push(
      listen<GrpcMessagePayload>("grpc-message", (e) => {
        const { reqId, index, data, tsMs } = e.payload;
        const state = useTabsStore.getState();
        const tab = state.tabs.find((t) => t.grpc?.reqId === reqId);
        if (tab) {
          state.appendGrpcMessage(tab.path, reqId, { index, data, tsMs });
        }
      })
    );

    unlistens.push(
      listen<GrpcMetadataPayload>("grpc-initial-metadata", (e) => {
        const { reqId, metadata } = e.payload;
        const state = useTabsStore.getState();
        const tab = state.tabs.find((t) => t.grpc?.reqId === reqId);
        if (tab) {
          state.setGrpcInitialMetadata(tab.path, reqId, metadata);
        }
      })
    );

    unlistens.push(
      listen<GrpcMetadataPayload>("grpc-trailing-metadata", (e) => {
        const { reqId, metadata } = e.payload;
        const state = useTabsStore.getState();
        const tab = state.tabs.find((t) => t.grpc?.reqId === reqId);
        if (tab) {
          state.setGrpcTrailingMetadata(tab.path, reqId, metadata);
        }
      })
    );

    unlistens.push(
      listen<GrpcStatusPayload>("grpc-status", (e) => {
        const { reqId, code, message } = e.payload;
        const state = useTabsStore.getState();
        const tab = state.tabs.find((t) => t.grpc?.reqId === reqId);
        if (tab) {
          state.setGrpcStatus(tab.path, reqId, code, message);
        }
      })
    );

    unlistens.push(
      listen<GrpcErrorPayload>("grpc-error", (e) => {
        const { reqId, error } = e.payload;
        const state = useTabsStore.getState();
        const tab = state.tabs.find((t) => t.grpc?.reqId === reqId);
        if (tab) {
          state.setGrpcError(tab.path, reqId, error);
        }
      })
    );

    unlistens.push(
      listen<GrpcClosedPayload>("grpc-closed", (e) => {
        const { reqId, totalMs, messageCount } = e.payload;
        const state = useTabsStore.getState();
        const tab = state.tabs.find((t) => t.grpc?.reqId === reqId);
        if (tab) {
          state.setGrpcClosed(tab.path, reqId, totalMs, messageCount);
        }
      })
    );

    return () => {
      unlistens.forEach((p) => p.then((fn) => fn()));
    };
  }, []);

  type PendingClose =
    | { kind: "single"; path: string; name: string }
    | { kind: "other"; path: string; dirtyCount: number }
    | { kind: "all"; dirtyCount: number }
    | null;

  const [pendingClose, setPendingClose] = useState<PendingClose>(null);

  useHorizontalWheelScroll(tabsScrollRef, hasTabs);

  const handleSingleClose = (tab: { path: string; name: string; isDirty: boolean }) => {
    if (tab.isDirty) {
      setPendingClose({ kind: "single", path: tab.path, name: tab.name });
    } else {
      closeTab(tab.path);
    }
  };

  const handleCloseOther = (tab: { path: string }) => {
    const others = tabs.filter((t) => t.path !== tab.path);
    const dirtyCount = others.filter((t) => t.isDirty).length;
    if (dirtyCount > 0) {
      setPendingClose({ kind: "other", path: tab.path, dirtyCount });
    } else {
      closeOtherTabs(tab.path);
    }
  };

  const handleCloseAll = () => {
    const dirtyCount = tabs.filter((t) => t.isDirty).length;
    if (dirtyCount > 0) {
      setPendingClose({ kind: "all", dirtyCount });
    } else {
      closeAllTabs();
    }
  };

  const confirmClose = () => {
    if (!pendingClose) return;
    switch (pendingClose.kind) {
      case "single":
        closeTab(pendingClose.path);
        break;
      case "other":
        closeOtherTabs(pendingClose.path, true);
        break;
      case "all":
        closeAllTabs(true);
        break;
    }
    setPendingClose(null);
  };

  if (tabs.length === 0) {
    return (
      <main className="flex h-full items-center justify-center bg-background">
        <div className="flex flex-col items-center gap-2 text-muted-foreground">
          <p className="text-lg">从左侧文件树打开一个文件开始</p>
        </div>
      </main>
    );
  }

  return (
    <main className="flex h-full flex-col overflow-hidden bg-background">
      <div className="group/tabs relative">
        <div ref={tabsScrollRef} className="tabs-scroll flex h-9 shrink-0 items-center overflow-x-auto overflow-y-hidden border-b bg-card">
          <div className="flex h-full items-stretch">
            {tabs.map((tab) => (
              <ContextMenu key={tab.path}>
                <ContextMenuTrigger asChild>
                  <div
                    className={`group relative flex h-full cursor-pointer items-center gap-1.5 px-3 text-sm ${
                      tab.path === activePath
                        ? "bg-[var(--editor-active-bg)] text-[var(--editor-active-fg)]"
                        : "hover:bg-[var(--editor-active-bg)]/50 text-[var(--editor-inactive-fg)]"
                    }`}
                    onClick={() => setActive(tab.path)}
                  >
                    <Tooltip>
                      <TooltipTrigger asChild>
                        <span className="truncate max-w-[140px]">{tab.name}</span>
                      </TooltipTrigger>
                      <TooltipContent side="bottom" align="start" className="max-w-md break-all">
                        {tab.path}
                      </TooltipContent>
                    </Tooltip>
                    {tab.isDirty && (
                      <Circle className="h-2 w-2 fill-amber-500 text-amber-500" />
                    )}
                    <button
                      className={`cursor-pointer rounded-sm p-0.5 group-hover:opacity-100 hover:bg-accent ${
                        tab.path === activePath ? "opacity-100" : "opacity-0"
                      }`}
                      onClick={(e) => {
                        e.stopPropagation();
                        handleSingleClose(tab);
                      }}
                    >
                      <X className="h-4 w-4" />
                    </button>
                    {tab.path === activePath && (
                      <div
                        aria-hidden
                        className="pointer-events-none absolute inset-x-0 bottom-0 z-30 h-0.5 bg-primary"
                      />
                    )}
                  </div>
                </ContextMenuTrigger>
                <ContextMenuContent>
                  <ContextMenuItem onClick={() => handleSingleClose(tab)}>
                    关闭
                  </ContextMenuItem>
                  <ContextMenuItem
                    disabled={tabs.length <= 1}
                    onClick={() => handleCloseOther(tab)}
                  >
                    关闭其它
                  </ContextMenuItem>
                  <ContextMenuItem onClick={handleCloseAll}>
                    关闭所有
                  </ContextMenuItem>
                </ContextMenuContent>
              </ContextMenu>
            ))}
          </div>
        </div>
        <TabsScrollbar scrollRef={tabsScrollRef} />
      </div>

      {activeTab && (() => {
        if (!isRequestFile(activeTab.name)) {
          return (
            <div className="flex-1 overflow-hidden">
              <PlainEditor tab={activeTab} />
            </div>
          );
        }

        return (
          <Group
            id="editor-response"
            orientation="vertical"
            className="flex-1 overflow-hidden"
          >
            <Panel id="editor" defaultSize="60%" minSize="20%">
              <HttpEditor tab={activeTab} />
            </Panel>
            <Separator className="relative z-[2] -mb-1 h-1 cursor-row-resize bg-transparent transition-colors hover:bg-primary/50 data-[resize-handle-state=drag]:bg-primary" />
            <Panel
              id="response"
              defaultSize="40%"
              minSize="10%"
              maxSize="80%"
              collapsible
              collapsedSize={36}
              panelRef={responsePanelRef}
              onResize={(size) => setResponseCollapsed(size.inPixels <= 40)}
            >
              <ResponsePanel
                tab={activeTab}
                panelRef={responsePanelRef}
                collapsed={responseCollapsed}
              />
            </Panel>
          </Group>
        );
      })()}

      <AlertDialog
        open={pendingClose !== null}
        onOpenChange={(open) => !open && setPendingClose(null)}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>关闭未保存的标签</AlertDialogTitle>
            <AlertDialogDescription>
              {pendingClose?.kind === "single" &&
                `"${pendingClose.name}" 有未保存修改,确定关闭?`}
              {pendingClose?.kind === "other" &&
                `将关闭 ${pendingClose.dirtyCount} 个未保存的标签,确定继续?`}
              {pendingClose?.kind === "all" &&
                `将关闭 ${pendingClose.dirtyCount} 个未保存的标签,确定继续?`}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>取消</AlertDialogCancel>
            <AlertDialogAction onClick={confirmClose}>关闭</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </main>
  );
}
