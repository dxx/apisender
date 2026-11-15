import { EditorView, ViewPlugin, type ViewUpdate } from "@codemirror/view";
import { getSearchQuery, searchPanelOpen, type SearchQuery } from "@codemirror/search";

interface MatchInfo {
  total: number;
  ranges: { from: number; to: number }[];
}

class SearchMatchCounter {
  private view: EditorView;
  private counterEl: HTMLSpanElement | null = null;
  private observer: MutationObserver;
  private cachedQuery: SearchQuery | null = null;
  private cachedDocLen = -1;
  private cachedMatch: MatchInfo | null = null;

  constructor(view: EditorView) {
    this.view = view;
    this.observer = new MutationObserver(() => {
      const wasMissing = !this.counterEl || !this.counterEl.parentElement;
      this.ensureCounter();
      if (wasMissing && this.counterEl) this.render();
    });
    this.observer.observe(view.dom, { childList: true, subtree: true });
    this.ensureCounter();
    this.render();
  }

  private ensureCounter() {
    const panel = this.view.dom.querySelector<HTMLElement>(".cm-panel.cm-search");
    if (!panel) {
      this.counterEl = null;
      return;
    }
    if (this.counterEl && this.counterEl.parentElement === panel) return;
    const existing = panel.querySelector<HTMLElement>(".cm-search-counter");
    if (existing) {
      this.counterEl = existing;
      return;
    }
    const span = document.createElement("span");
    span.className = "cm-search-counter";
    panel.appendChild(span);
    this.counterEl = span;
  }

  private computeMatchInfo(): MatchInfo | null {
    const state = this.view.state;
    if (!searchPanelOpen(state)) return null;
    const query = getSearchQuery(state);
    if (!query.valid || !query.search) return null;
    const docLen = state.doc.length;
    if (this.cachedMatch && this.cachedQuery && query.eq(this.cachedQuery) && docLen === this.cachedDocLen) {
      return this.cachedMatch;
    }
    const ranges: { from: number; to: number }[] = [];
    const cursor = query.getCursor(state);
    for (let cur = cursor.next(); !cur.done; cur = cursor.next()) {
      ranges.push({ from: cur.value.from, to: cur.value.to });
    }
    this.cachedQuery = query;
    this.cachedDocLen = docLen;
    this.cachedMatch = { total: ranges.length, ranges };
    return this.cachedMatch;
  }

  private render() {
    this.ensureCounter();
    if (!this.counterEl) return;
    const info = this.computeMatchInfo();
    if (!info) {
      this.counterEl.textContent = "";
      return;
    }
    if (info.total === 0) {
      this.counterEl.textContent = "无匹配";
      return;
    }
    const sel = this.view.state.selection.main;
    let idx = -1;
    for (let i = 0; i < info.ranges.length; i++) {
      const r = info.ranges[i];
      if (r.from === sel.from && r.to === sel.to) {
        idx = i;
        break;
      }
    }
    this.counterEl.textContent = idx >= 0 ? `${idx + 1} of ${info.total}` : `? of ${info.total}`;
  }

  update(update: ViewUpdate) {
    const queryChanged = !getSearchQuery(update.startState).eq(getSearchQuery(update.state));
    if (queryChanged || update.docChanged || update.selectionSet || update.viewportChanged) {
      this.render();
    }
  }

  destroy() {
    this.observer.disconnect();
    this.counterEl = null;
    this.cachedQuery = null;
    this.cachedMatch = null;
  }
}

export const searchMatchCounter = ViewPlugin.fromClass(SearchMatchCounter);
