type Platform = "macos" | "windows" | "linux" | "web";

export function detectPlatform(): Platform {
  if (typeof navigator === "undefined") return "web";
  const ua = navigator.userAgent;
  if (ua.includes("Mac") && navigator.maxTouchPoints === 0) return "macos";
  if (ua.includes("Windows")) return "windows";
  if (ua.includes("Linux") || ua.includes("X11")) return "linux";
  return "web";
}

export const PLATFORM = detectPlatform();
export const isMac = () => PLATFORM === "macos";
export const isWindows = () => PLATFORM === "windows";
export const isLinux = () => PLATFORM === "linux";

export const DRAG_REGION_ATTR: Record<string, unknown> = {
  "data-tauri-drag-region": true,
};

export const DRAG_REGION_STYLE = { WebkitAppRegion: "drag" } as React.CSSProperties;
export const NO_DRAG_STYLE = { WebkitAppRegion: "no-drag" } as React.CSSProperties;

export const TITLE_BAR_HEIGHT = 28;