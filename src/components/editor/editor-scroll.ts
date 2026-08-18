import type { EditorView } from "@codemirror/view";

export interface ScrollCache {
  scrollTop: number;
  scrollLeft: number;
}

export interface SavedScroll {
  scrollTop?: number;
  scrollLeft?: number;
}

export interface EditorScrollController {
  readonly cache: ScrollCache;
  sync(): void;
  applySaved(saved: SavedScroll | null): void;
  dispose(): void;
}

export function createEditorScrollController(view: EditorView): EditorScrollController {
  const cache: ScrollCache = { scrollTop: 0, scrollLeft: 0 };

  const sync = () => {
    const dom = view.scrollDOM;
    if (!dom) return;
    cache.scrollTop = dom.scrollTop;
    cache.scrollLeft = dom.scrollLeft;
  };

  const onScroll = () => sync();
  view.scrollDOM.addEventListener("scroll", onScroll, { passive: true });

  const applySaved = (saved: SavedScroll | null) => {
    const top = saved?.scrollTop ?? null;
    const left = saved?.scrollLeft ?? null;
    if (
      (typeof top === "number" && top > 0) ||
      (typeof left === "number" && left > 0)
    ) {
      const apply = () => {
        const dom = view.scrollDOM;
        if (!dom) return;
        if (typeof top === "number") dom.scrollTop = top;
        if (typeof left === "number") dom.scrollLeft = left;
        sync();
      };
      view.requestMeasure({ read: () => null, write: apply });
    }
  };

  const dispose = () => {
    view.scrollDOM.removeEventListener("scroll", onScroll);
  };

  return { cache, sync, applySaved, dispose };
}
