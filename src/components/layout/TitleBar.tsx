import { useEffect, useRef, useState } from "react";
import { Minus, Square, Copy, X } from "lucide-react";
import { getCurrentWindow } from "@tauri-apps/api/window";

import {
  isMac,
  DRAG_REGION_ATTR,
  DRAG_REGION_STYLE,
  NO_DRAG_STYLE,
  TITLE_BAR_HEIGHT,
} from "@/lib/platform";
import logo from "@/assets/logo.svg";

/**
 * TitleBar
 * -------
 * macOS: Tauri 配置 titleBarStyle: "Overlay"，原生标题栏被隐藏，
 *  前端通过透明 drag region 接管窗口移动。
 *  并附带两道防线（mousedown detail>=2 + selectstart）防止
 *  WKWebView 把双击 drag region 解释为 selectStart。
 *
 * Windows/Linux: tauri.conf.json 配置 decorations: false，
 *  原生标题栏与边框被移除，前端绘制整条标题栏
 *  （左 logo + 中 title + 右 最小化/最大化/关闭 三按钮）。
 *  - 拖拽区域使用 data-tauri-drag-region + WebkitAppRegion: drag
 *  - 按钮区域使用 WebkitAppRegion: no-drag，避免点按钮触发拖拽
 *  - 双击 drag region 触发 toggleMaximize（Windows/Linux 桌面惯例）
 */
export function TitleBar() {
  return <>{isMac() ? <MacTitleBar /> : <WinLinuxTitleBar />}</>;
}

function MacTitleBar() {
  const dragRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const el = dragRef.current;
    if (!el) return;

    const onMouseDown = (e: MouseEvent) => {
      if (e.detail >= 2) e.preventDefault();
    };
    const onSelectStart = (e: Event) => {
      if (!e.target) return;
      const t = e.target as Node;
      if (!el.contains(t)) return;
      const sel = window.getSelection();
      if (sel) sel.removeAllRanges();
    };

    el.addEventListener("mousedown", onMouseDown);
    el.addEventListener("selectstart", onSelectStart);
    return () => {
      el.removeEventListener("mousedown", onMouseDown);
      el.removeEventListener("selectstart", onSelectStart);
    };
  }, []);

  return (
    <>
      <div
        {...DRAG_REGION_ATTR}
        style={{ ...DRAG_REGION_STYLE, height: TITLE_BAR_HEIGHT }}
        ref={dragRef}
        className="fixed top-0 left-0 right-0 z-[60] select-none border-b bg-background"
      />

      <div
        aria-hidden
        style={{ height: TITLE_BAR_HEIGHT }}
        className="pointer-events-none fixed top-0 left-20 right-20 z-[61] flex items-center justify-center text-xs font-medium text-foreground select-none"
      >
        apisender
      </div>
    </>
  );
}

function WinLinuxTitleBar() {
  const [isMaximized, setIsMaximized] = useState(false);

  useEffect(() => {
    const win = getCurrentWindow();
    let unlisten: (() => void) | undefined;
    win.isMaximized().then(setIsMaximized).catch(() => {});
    win.onResized(() => {
      win.isMaximized().then(setIsMaximized).catch(() => {});
    }).then((fn) => {
      unlisten = fn;
    });
    return () => {
      unlisten?.();
    };
  }, []);

  const onDoubleClickDrag = () => {
    getCurrentWindow().toggleMaximize().catch(() => {});
  };

  return (
    <div
      {...DRAG_REGION_ATTR}
      style={{ ...DRAG_REGION_STYLE, height: TITLE_BAR_HEIGHT }}
      onDoubleClick={onDoubleClickDrag}
      className="fixed top-0 left-0 right-0 z-[60] flex select-none items-center justify-between border-b bg-background pl-2"
    >
      <div className="flex items-center gap-2">
        <img src={logo} alt="apisender" className="h-6 w-6" />
      </div>

      <div
        aria-hidden
        className="pointer-events-none absolute left-1/2 -translate-x-1/2 text-xs font-medium text-foreground"
      >
        apisender
      </div>

      <div
        style={NO_DRAG_STYLE}
        className="flex h-full items-center"
      >
        <button
          type="button"
          aria-label="最小化"
          className="flex h-full w-11 items-center justify-center text-muted-foreground hover:bg-accent focus:outline-none"
          onClick={() => getCurrentWindow().minimize().catch(() => {})}
        >
          <Minus className="h-3.5 w-3.5" />
        </button>
        <button
          type="button"
          aria-label={isMaximized ? "还原" : "最大化"}
          className="flex h-full w-11 items-center justify-center text-muted-foreground hover:bg-accent focus:outline-none"
          onClick={() => getCurrentWindow().toggleMaximize().catch(() => {})}
        >
          {isMaximized ? (
            <Copy className="h-3.5 w-3.5" />
          ) : (
            <Square className="h-3.5 w-3.5" />
          )}
        </button>
        <button
          type="button"
          aria-label="关闭"
          className="group flex h-full w-11 items-center justify-center text-muted-foreground hover:bg-[#e81123] hover:text-white focus:outline-none"
          onClick={() => getCurrentWindow().close().catch(() => {})}
        >
          <X className="h-3.5 w-3.5" />
        </button>
      </div>
    </div>
  );
}