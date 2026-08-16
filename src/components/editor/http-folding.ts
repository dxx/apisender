import { EditorState, StateEffect, StateField, type Extension } from "@codemirror/state";
import {
  codeFolding,
  foldEffect,
  foldedRanges,
  foldKeymap,
  foldService,
  unfoldEffect,
} from "@codemirror/language";
import {
  EditorView,
  keymap,
  showTooltip,
  ViewPlugin,
  type PluginValue,
  type Tooltip,
  type ViewUpdate,
} from "@codemirror/view";

import { copyText } from "@/lib/tauri";

import { COPY_ICON_SVG_HTML, CHECK_ICON_SVG_HTML } from "./EditorIcon";

export type HttpFoldKind = "request" | "headers" | "body" | "json-object" | "json-array";

export interface HttpFoldRange {
  kind: HttpFoldKind;
  from: number;
  to: number;
  lineFrom: number;
  lineTo: number;
  label: string;
  preview: string;
}

interface HttpLine {
  number: number;
  from: number;
  to: number;
  text: string;
}

interface ParsedRequestFold {
  requestEndIndex: number;
  nextIndex: number;
  headerStartIndex: number | null;
  headerEndIndex: number | null;
  bodyStartIndex: number | null;
  bodyEndIndex: number | null;
  isJsonBody: boolean;
}

interface GrpcSections {
  requestEndIndex: number;
  headerStartIndex: number | null;
  headerEndIndex: number | null;
  bodyStartIndex: number | null;
  bodyEndIndex: number | null;
}

interface WsSections {
  requestEndIndex: number;
  bodyStartIndex: number | null;
  bodyEndIndex: number | null;
}

interface JsonToken {
  char: "{" | "[";
  pos: number;
  lineIndex: number;
}

interface FoldPlaceholderInfo {
  label: string;
  preview: string;
  kind: HttpFoldKind | "unknown";
}

interface FoldTooltipControls {
  keepOpen: () => void;
  scheduleClose: () => void;
  offsetX: number;
}

const REQUEST_LINE_RE =
  /^(GET|POST|PUT|DELETE|PATCH|HEAD|OPTIONS|CONNECT|TRACE|WEBSOCKET|GRPC|[A-Z][A-Z0-9_-]+)\s+\S+/;
const BARE_URL_RE = /^https?:\/\/\S+/i;
const HEADER_RE = /^[^:\s][^:]*:/;
const MAX_TOOLTIP_CHARS = 6000;
const HTTP_FOLD_TOOLTIP_OPEN_DELAY_MS = 200;
export const HTTP_FOLD_TOOLTIP_CLOSE_DELAY_MS = 200;

const httpFoldRangesField = StateField.define<readonly HttpFoldRange[]>({
  create: (state) => collectHttpFoldRanges(state.doc.toString()),
  update: (ranges, transaction) => {
    if (!transaction.docChanged) return ranges;
    return collectHttpFoldRanges(transaction.state.doc.toString());
  },
});

const setFoldPreviewTooltipEffect = StateEffect.define<Tooltip | null>();

const foldPreviewTooltipField = StateField.define<Tooltip | null>({
  create: () => null,
  update: (tooltip, transaction) => {
    let nextTooltip = transaction.docChanged ? null : tooltip;
    for (const effect of transaction.effects) {
      if (effect.is(setFoldPreviewTooltipEffect)) {
        nextTooltip = effect.value;
      }
    }
    return nextTooltip;
  },
  provide: (field) => showTooltip.from(field),
});

const foldPreviewPlugin = ViewPlugin.fromClass(
  class FoldPreviewPlugin implements PluginValue {
    private pendingRange: { from: number; to: number } | null = null;
    private activeRange: { from: number; to: number } | null = null;
    private openTimer: number | null = null;
    private closeTimer: number | null = null;

    constructor(private readonly view: EditorView) {
      this.view.dom.addEventListener("mousemove", this.handleEditorMouseMove);
      this.view.dom.addEventListener("mouseleave", this.handleEditorMouseLeave);
    }

    update(update: ViewUpdate): void {
      if (!update.docChanged) return;
      this.clearTimers();
      this.pendingRange = null;
      this.activeRange = null;
    }

    destroy(): void {
      this.view.dom.removeEventListener("mousemove", this.handleEditorMouseMove);
      this.view.dom.removeEventListener("mouseleave", this.handleEditorMouseLeave);
      this.clearTimers();
    }

    private handleEditorMouseMove = (event: MouseEvent): void => {
      const tooltip = closestElement(event.target, ".cm-http-fold-tooltip");
      if (tooltip) {
        this.keepOpen();
        return;
      }

      const placeholder = closestElement(event.target, ".cm-http-fold-placeholder");
      if (!placeholder || !this.view.dom.contains(placeholder)) {
        this.scheduleClose();
        return;
      }

      const folded = this.readFoldedRangeFromPlaceholder(placeholder);
      if (!folded) {
        this.scheduleClose();
        return;
      }
      this.scheduleOpen(folded);
    };

    private handleEditorMouseLeave = (): void => {
      this.scheduleClose();
    };

    private scheduleOpen(folded: { from: number; to: number }): void {
      this.clearCloseTimer();
      if (isSameFoldRange(this.activeRange, folded)) return;
      if (isSameFoldRange(this.pendingRange, folded)) return;

      this.clearOpenTimer();
      this.pendingRange = folded;
      this.openTimer = window.setTimeout(() => {
        this.openTimer = null;
        this.openFoldPreview(folded);
      }, HTTP_FOLD_TOOLTIP_OPEN_DELAY_MS);
    }

    private openFoldPreview(folded: { from: number; to: number }): void {
      this.pendingRange = null;
      const tooltip = createFoldPreviewTooltip(this.view, folded, {
        keepOpen: this.keepOpen,
        scheduleClose: this.scheduleClose,
        offsetX: getPlaceholderOffset(this.view, folded.from),
      });
      if (!tooltip) return;

      this.activeRange = folded;
      this.view.dispatch({
        effects: setFoldPreviewTooltipEffect.of(tooltip),
      });
    }

    private keepOpen = (): void => {
      this.clearCloseTimer();
    };

    private scheduleClose = (): void => {
      this.clearOpenTimer();
      this.pendingRange = null;
      if (!this.activeRange || this.closeTimer !== null) return;

      this.closeTimer = window.setTimeout(() => {
        this.closeTimer = null;
        this.closeNow();
      }, HTTP_FOLD_TOOLTIP_CLOSE_DELAY_MS);
    };

    private closeNow(): void {
      this.pendingRange = null;
      if (!this.activeRange) return;

      this.activeRange = null;
      this.view.dispatch({
        effects: setFoldPreviewTooltipEffect.of(null),
      });
    }

    private clearOpenTimer(): void {
      if (this.openTimer === null) return;
      window.clearTimeout(this.openTimer);
      this.openTimer = null;
    }

    private clearCloseTimer(): void {
      if (this.closeTimer === null) return;
      window.clearTimeout(this.closeTimer);
      this.closeTimer = null;
    }

    private clearTimers(): void {
      this.clearOpenTimer();
      this.clearCloseTimer();
    }

    private readFoldedRangeFromPlaceholder(placeholder: HTMLElement): { from: number; to: number } | null {
      try {
        const pos = this.view.posAtDOM(placeholder);
        return findFoldedRangeNear(this.view, pos);
      } catch {
        return null;
      }
    }
  },
);

export function collectHttpFoldRanges(text: string): HttpFoldRange[] {
  const lines = buildLines(text);
  const ranges: HttpFoldRange[] = [];
  let index = 0;

  while (index < lines.length) {
    const start = findNextRequestStart(lines, index);
    if (!start) break;

    const parsed = parseRequestFold(lines, start.requestLineIndex);
    addLineRange(ranges, "request", lines, start.blockStartIndex, parsed.requestEndIndex, text);
    if (parsed.headerStartIndex !== null && parsed.headerEndIndex !== null) {
      addLineRange(ranges, "headers", lines, parsed.headerStartIndex, parsed.headerEndIndex, text);
    }
    if (parsed.bodyStartIndex !== null && parsed.bodyEndIndex !== null) {
      addLineRange(ranges, "body", lines, parsed.bodyStartIndex, parsed.bodyEndIndex, text);
      if (parsed.isJsonBody) {
        ranges.push(...collectJsonFoldRanges(lines, parsed.bodyStartIndex, parsed.bodyEndIndex, text));
      }
    }

    index = Math.max(parsed.nextIndex, start.requestLineIndex + 1);
  }

  return ranges.sort(compareFoldRanges);
}

export function httpFoldingExtensions(): Extension[] {
  return [
    httpFoldRangesField,
    foldPreviewTooltipField,
    foldService.of(findHttpFoldRange),
    codeFolding({
      preparePlaceholder: (state, range): FoldPlaceholderInfo => {
        return findFoldRangeByOffsets(state, range.from, range.to) ?? fallbackPlaceholder(state.doc.toString(), range.from, range.to);
      },
      placeholderDOM: (_view, onclick, prepared) => {
        const info = isFoldPlaceholderInfo(prepared) ? prepared : null;
        const element = document.createElement("span");
        element.className = "cm-foldPlaceholder cm-http-fold-placeholder";
        element.textContent = info?.label ?? "折叠内容 ...";
        element.title = "展开折叠";
        element.onclick = onclick;
        if (info) {
          element.dataset.foldKind = info.kind;
          element.dataset.foldPreview = trimTooltipPreview(info.preview);
        }
        return element;
      },
    }),
    foldPreviewPlugin,
    keymap.of(foldKeymap),
    httpFoldingTheme,
  ];
}

export function selectHttpFoldControls(ranges: readonly HttpFoldRange[]): HttpFoldRange[] {
  const selected: HttpFoldRange[] = [];
  const usedLines = new Set<number>();
  const sorted = [...ranges].sort(compareFoldRanges);

  for (const range of sorted) {
    if (usedLines.has(range.lineFrom)) continue;
    usedLines.add(range.lineFrom);
    selected.push(range);
  }

  return selected;
}

export function refreshHttpFoldPlaceholders(view: EditorView): void {
  const restored: Array<{ from: number; to: number }> = [];
  foldedRanges(view.state).between(0, view.state.doc.length, (from, to) => {
    restored.push({ from, to });
  });
  if (restored.length === 0) return;

  view.dispatch({
    effects: restored.flatMap((range) => [
      unfoldEffect.of(range),
      foldEffect.of(range),
    ]),
  });
}

function buildLines(text: string): HttpLine[] {
  const lines: HttpLine[] = [];
  let lineStart = 0;
  let lineNumber = 1;

  for (let index = 0; index < text.length; index++) {
    if (text[index] !== "\n") continue;
    lines.push({
      number: lineNumber,
      from: lineStart,
      to: index,
      text: text.slice(lineStart, index),
    });
    lineStart = index + 1;
    lineNumber += 1;
  }

  lines.push({
    number: lineNumber,
    from: lineStart,
    to: text.length,
    text: text.slice(lineStart),
  });
  return lines;
}

function findNextRequestStart(
  lines: HttpLine[],
  fromIndex: number,
): { blockStartIndex: number; requestLineIndex: number } | null {
  for (let index = fromIndex; index < lines.length; index++) {
    const trimmed = lines[index].text.trim();

    if (isRequestSeparator(trimmed)) {
      const requestLineIndex = findRequestLineAfterSeparator(lines, index + 1);
      if (requestLineIndex !== null) {
        return { blockStartIndex: index, requestLineIndex };
      }
      continue;
    }

    if (shouldSkipBeforeRequest(trimmed)) continue;

    if (isRequestLine(trimmed)) {
      return { blockStartIndex: index, requestLineIndex: index };
    }
  }
  return null;
}

function findRequestLineAfterSeparator(lines: HttpLine[], fromIndex: number): number | null {
  for (let index = fromIndex; index < lines.length; index++) {
    const trimmed = lines[index].text.trim();
    if (isRequestSeparator(trimmed)) return null;
    if (shouldSkipBeforeRequest(trimmed)) continue;
    return isRequestLine(trimmed) ? index : null;
  }
  return null;
}

function parseRequestFold(
  lines: HttpLine[],
  requestLineIndex: number,
): ParsedRequestFold {
  const sectionLimit = findNextSeparatorIndex(lines, requestLineIndex + 1);
  let requestLineEndIndex = requestLineIndex;
  while (
    requestLineEndIndex + 1 < sectionLimit &&
    isContinuationLine(lines[requestLineEndIndex + 1].text)
  ) {
    requestLineEndIndex += 1;
  }
  const protocol = getMessageProtocol(lines[requestLineIndex].text.trim());
  if (protocol !== null) {
    if (protocol === "websocket") {
      const sections = scanWsBody(lines, requestLineEndIndex, sectionLimit);
      return {
        requestEndIndex: sections.requestEndIndex,
        nextIndex: sections.requestEndIndex + 1,
        headerStartIndex: null,
        headerEndIndex: null,
        bodyStartIndex: sections.bodyStartIndex,
        bodyEndIndex: sections.bodyEndIndex,
        isJsonBody: false,
      };
    }
    const sections = scanGrpcSections(lines, requestLineEndIndex, sectionLimit);
    const isJsonBody =
      sections.bodyStartIndex !== null &&
      sections.bodyEndIndex !== null &&
      shouldScanJsonBody(
        lines,
        sections.headerStartIndex,
        sections.headerEndIndex,
        sections.bodyStartIndex,
        sections.bodyEndIndex,
      );
    return {
      requestEndIndex: sections.requestEndIndex,
      nextIndex: sections.requestEndIndex + 1,
      headerStartIndex: sections.headerStartIndex,
      headerEndIndex: sections.headerEndIndex,
      bodyStartIndex: sections.bodyStartIndex,
      bodyEndIndex: sections.bodyEndIndex,
      isJsonBody,
    };
  }

  const headerInfo = scanHeaders(lines, requestLineEndIndex + 1, sectionLimit);
  const contentType = getContentType(lines, headerInfo.startIndex, headerInfo.endIndex);
  const bodyInfo = scanBody(lines, headerInfo.bodyCandidateIndex, sectionLimit, isMultipartContentType(contentType));
  const requestEndIndex =
    bodyInfo.endIndex ?? headerInfo.endIndex ?? requestLineEndIndex;
  const isJsonBody =
    bodyInfo.startIndex !== null &&
    bodyInfo.endIndex !== null &&
    shouldScanJsonBody(lines, headerInfo.startIndex, headerInfo.endIndex, bodyInfo.startIndex, bodyInfo.endIndex);

  return {
    requestEndIndex,
    nextIndex: requestEndIndex + 1,
    headerStartIndex: headerInfo.startIndex,
    headerEndIndex: headerInfo.endIndex,
    bodyStartIndex: bodyInfo.startIndex,
    bodyEndIndex: bodyInfo.endIndex,
    isJsonBody,
  };
}

function scanHeaders(
  lines: HttpLine[],
  fromIndex: number,
  limitIndex: number,
): {
  startIndex: number | null;
  endIndex: number | null;
  bodyCandidateIndex: number;
} {
  let startIndex: number | null = null;
  let endIndex: number | null = null;
  let index = fromIndex;

  while (index < limitIndex) {
    const trimmed = lines[index].text.trim();
    if (trimmed === "") {
      return { startIndex, endIndex, bodyCandidateIndex: index + 1 };
    }
    if (isComment(trimmed)) {
      if (startIndex !== null) endIndex = index;
      index += 1;
      continue;
    }
    if (!isHeaderLine(trimmed)) break;
    if (startIndex === null) startIndex = index;
    endIndex = index;
    index += 1;
  }

  return { startIndex, endIndex, bodyCandidateIndex: index };
}

function scanBody(
  lines: HttpLine[],
  fromIndex: number,
  limitIndex: number,
  allowBlankLines: boolean,
): { startIndex: number | null; endIndex: number | null } {
  let startIndex: number | null = null;
  let endIndex: number | null = null;

  for (let index = fromIndex; index < limitIndex; index++) {
    const trimmed = lines[index].text.trim();
    if (isRequestSeparator(trimmed) || trimmed.startsWith(">")) break;
    if (trimmed === "" && !allowBlankLines) break;
    if (isComment(trimmed) && startIndex === null) continue;
    if (startIndex === null) startIndex = index;
    endIndex = index;
  }

  return { startIndex, endIndex };
}

function collectJsonFoldRanges(
  lines: HttpLine[],
  bodyStartIndex: number,
  bodyEndIndex: number,
  text: string,
): HttpFoldRange[] {
  const ranges: HttpFoldRange[] = [];
  const bodyStart = lines[bodyStartIndex].from;
  const bodyEnd = lines[bodyEndIndex].to;
  const stack: JsonToken[] = [];
  let inString = false;
  let escaped = false;
  let lineIndex = bodyStartIndex;

  for (let pos = bodyStart; pos < bodyEnd; pos++) {
    while (lineIndex < bodyEndIndex && pos > lines[lineIndex].to) {
      lineIndex += 1;
    }

    const char = text[pos];
    if (inString) {
      if (escaped) {
        escaped = false;
      } else if (char === "\\") {
        escaped = true;
      } else if (char === "\"") {
        inString = false;
      }
      continue;
    }

    if (char === "\"") {
      inString = true;
      continue;
    }
    if (char === "{" || char === "[") {
      stack.push({ char, pos, lineIndex });
      continue;
    }
    if (char !== "}" && char !== "]") continue;

    const open = stack.pop();
    if (!open || !isMatchingJsonToken(open.char, char)) continue;
    if (lineIndex <= open.lineIndex) continue;

    ranges.push(createFoldRange(
      open.char === "{" ? "json-object" : "json-array",
      open.pos,
      pos + 1,
      lines[open.lineIndex].number,
      lines[lineIndex].number,
      text,
    ));
  }

  return ranges;
}

function addLineRange(
  ranges: HttpFoldRange[],
  kind: HttpFoldKind,
  lines: HttpLine[],
  startIndex: number,
  endIndex: number,
  text: string,
): void {
  if (endIndex < startIndex) return;
  if (endIndex === startIndex) return;
  const from = lines[startIndex].from;
  const to = lines[endIndex].to;
  if (from >= to) return;
  const title = kind === "request" ? extractRequestTitle(lines[startIndex].text) : null;
  ranges.push(createFoldRange(kind, from, to, lines[startIndex].number, lines[endIndex].number, text, title));
}

function createFoldRange(
  kind: HttpFoldKind,
  from: number,
  to: number,
  lineFrom: number,
  lineTo: number,
  text: string,
  title: string | null = null,
): HttpFoldRange {
  const lineCount = lineTo - lineFrom + 1;
  const labelTitle = title ? ` ${title}` : "";
  return {
    kind,
    from,
    to,
    lineFrom,
    lineTo,
    label: `${labelPrefix(kind)}${labelTitle} ${lineCount} 行 ...`,
    preview: text.slice(from, to),
  };
}

function extractRequestTitle(text: string): string | null {
  const trimmed = text.trim();
  if (!isRequestSeparator(trimmed)) return null;
  const title = trimmed.replace(/^###\s*/, "").trim().replace(/\s+/g, " ");
  return title === "" ? null : title;
}

function findHttpFoldRange(state: EditorState, lineStart: number, _lineEnd: number): { from: number; to: number } | null {
  const line = state.doc.lineAt(lineStart);
  const range = getHttpFoldRanges(state).find((item) => item.lineFrom === line.number);
  return range ? { from: range.from, to: range.to } : null;
}

function findFoldRangeByOffsets(state: EditorState, from: number, to: number): FoldPlaceholderInfo | null {
  const range = getHttpFoldRanges(state).find((item) => item.from === from && item.to === to);
  if (!range) return null;
  return { label: range.label, preview: range.preview, kind: range.kind };
}

function getHttpFoldRanges(state: EditorState): readonly HttpFoldRange[] {
  return state.field(httpFoldRangesField, false) ?? collectHttpFoldRanges(state.doc.toString());
}

// CM LTR tooltip 水平公式: tooltip.left = pos.left - CM_ARROW_OFFSET + offset.x
// (CM_ARROW_OFFSET = 14 来自 @codemirror/view 源码 const ArrowOffset = 14)
const CM_ARROW_OFFSET = 14;
// .cm-http-fold-tooltip-title paddingLeft = 8 (CSS padding: "6px 8px")
const TOOLTIP_TITLE_PADDING_LEFT = 8;

function getPlaceholderOffset(view: EditorView, pos: number): number {
  const posCoords = view.coordsAtPos(pos);
  if (!posCoords) return 0;
  const placeholders = view.dom.querySelectorAll(".cm-http-fold-placeholder");
  let el: HTMLElement | null = null;
  for (const p of Array.from(placeholders)) {
    try {
      if (view.posAtDOM(p) === pos) {
        el = p as HTMLElement;
        break;
      }
    } catch {}
  }
  if (!el) return 0;
  const cs = getComputedStyle(el);
  return (
    el.getBoundingClientRect().left -
    posCoords.left +
    CM_ARROW_OFFSET -
    TOOLTIP_TITLE_PADDING_LEFT +
    (parseFloat(cs.borderLeftWidth) || 0) +
    (parseFloat(cs.paddingLeft) || 0)
  );
}

function createFoldPreviewTooltip(
  view: EditorView,
  folded: { from: number; to: number },
  controls: FoldTooltipControls,
): Tooltip | null {
  const info =
    findFoldRangeByOffsets(view.state, folded.from, folded.to) ??
    fallbackPlaceholder(view.state.doc.toString(), folded.from, folded.to);

  return {
    pos: folded.from,
    above: false,
    arrow: true,
    create: () => {
      const dom = document.createElement("div");
      dom.className = "cm-http-fold-tooltip";

      const title = document.createElement("div");
      title.className = "cm-http-fold-tooltip-title";
      title.textContent = info.label;
      const pre = document.createElement("pre");
      pre.textContent = formatFoldPreview(info.preview, info.kind);

      const copyBtn = document.createElement("button");
      copyBtn.type = "button";
      copyBtn.className = "cm-http-fold-tooltip-copy";
      copyBtn.title = "复制";
      copyBtn.setAttribute("aria-label", "复制 preview 内容");
      copyBtn.innerHTML = COPY_ICON_SVG_HTML;
      copyBtn.addEventListener("mousedown", (e) => e.preventDefault());
      copyBtn.addEventListener("click", async (e) => {
        e.stopPropagation();
        await copyText(pre.textContent ?? "");
        copyBtn.innerHTML = CHECK_ICON_SVG_HTML;
        copyBtn.classList.add("cm-http-fold-tooltip-copy-checked");
        setTimeout(() => {
          copyBtn.innerHTML = COPY_ICON_SVG_HTML;
          copyBtn.classList.remove("cm-http-fold-tooltip-copy-checked");
        }, 1200);
      });

      // dom.append(title, pre);
      dom.append(copyBtn, pre);
      dom.addEventListener("mouseenter", controls.keepOpen);
      dom.addEventListener("mouseleave", controls.scheduleClose);
      dom.addEventListener("contextmenu", (e) => e.preventDefault());
      return {
        dom,
        offset: { x: controls.offsetX, y: 0 },
        destroy: () => {
          dom.removeEventListener("mouseenter", controls.keepOpen);
          dom.removeEventListener("mouseleave", controls.scheduleClose);
        },
      };
    },
  };
}

function closestElement(target: EventTarget | null, selector: string): HTMLElement | null {
  if (!(target instanceof Element)) return null;
  const closest = target.closest(selector);
  return closest instanceof HTMLElement ? closest : null;
}

function isSameFoldRange(
  left: { from: number; to: number } | null,
  right: { from: number; to: number } | null,
): boolean {
  return left !== null && right !== null && left.from === right.from && left.to === right.to;
}

function findFoldedRangeNear(
  view: EditorView,
  pos: number,
): { from: number; to: number } | null {
  let found: { from: number; to: number } | null = null;
  const from = Math.max(0, pos - 1);
  const to = Math.min(view.state.doc.length, pos + 1);
  foldedRanges(view.state).between(from, to, (rangeFrom, rangeTo) => {
    found = { from: rangeFrom, to: rangeTo };
    return false;
  });
  if (found) return found;

  foldedRanges(view.state).between(0, view.state.doc.length, (rangeFrom, rangeTo) => {
    if (pos >= rangeFrom && pos <= rangeTo) {
      found = { from: rangeFrom, to: rangeTo };
      return false;
    }
    return undefined;
  });
  return found;
}

function fallbackPlaceholder(text: string, from: number, to: number): FoldPlaceholderInfo {
  const folded = text.slice(from, to);
  const lineCount = Math.max(1, folded.split("\n").length);
  return {
    label: `折叠内容 ${lineCount} 行 ...`,
    preview: folded,
    kind: "unknown",
  };
}

function shouldScanJsonBody(
  lines: HttpLine[],
  headerStartIndex: number | null,
  headerEndIndex: number | null,
  bodyStartIndex: number,
  bodyEndIndex: number,
): boolean {
  const contentType = getContentType(lines, headerStartIndex, headerEndIndex);
  const bodyText = lines
    .slice(bodyStartIndex, bodyEndIndex + 1)
    .map((line) => line.text)
    .join("\n");
  const trimmed = bodyText.trimStart();
  if (trimmed.startsWith("{{")) return false;
  if (contentType !== null) return contentType.includes("json");
  return trimmed.startsWith("{") || trimmed.startsWith("[");
}

function getContentType(
  lines: HttpLine[],
  headerStartIndex: number | null,
  headerEndIndex: number | null,
): string | null {
  if (headerStartIndex === null || headerEndIndex === null) return null;
  for (let index = headerStartIndex; index <= headerEndIndex; index++) {
    const [key, ...rest] = lines[index].text.split(":");
    if (key.trim().toLowerCase() === "content-type") {
      return rest.join(":").trim().toLowerCase();
    }
  }
  return null;
}

function isMultipartContentType(contentType: string | null): boolean {
  return contentType?.startsWith("multipart/form-data") ?? false;
}

function scanWsBody(
  lines: HttpLine[],
  requestLineEndIndex: number,
  limitIndex: number,
): WsSections {
  let index = requestLineEndIndex + 1;
  let bodyStartIndex: number | null = null;
  let bodyEndIndex: number | null = null;
  let requestEndIndex = requestLineEndIndex;

  while (index < limitIndex && lines[index].text.trim() === "") {
    index += 1;
  }

  while (index < limitIndex) {
    const trimmed = lines[index].text.trim();
    if (isRequestSeparator(trimmed)) break;
    if (isComment(trimmed)) {
      index += 1;
      continue;
    }
    if (bodyStartIndex === null) bodyStartIndex = index;
    bodyEndIndex = index;
    requestEndIndex = index;
    index += 1;
  }

  return { requestEndIndex, bodyStartIndex, bodyEndIndex };
}

function scanGrpcSections(
  lines: HttpLine[],
  requestLineEndIndex: number,
  limitIndex: number,
): GrpcSections {
  let index = requestLineEndIndex + 1;
  let headerStartIndex: number | null = null;
  let headerEndIndex: number | null = null;
  let bodyStartIndex: number | null = null;
  let bodyEndIndex: number | null = null;
  let requestEndIndex = requestLineEndIndex;

  while (index < limitIndex && lines[index].text.trim() === "") {
    index += 1;
  }

  while (index < limitIndex) {
    const trimmed = lines[index].text.trim();
    if (trimmed === "" || isRequestSeparator(trimmed)) break;
    if (isComment(trimmed)) {
      index += 1;
      continue;
    }
    if (trimmed.startsWith("{") || trimmed.startsWith("[") || trimmed.startsWith("<")) break;
    if (!isHeaderLine(trimmed)) break;
    if (headerStartIndex === null) headerStartIndex = index;
    headerEndIndex = index;
    requestEndIndex = index;
    index += 1;
  }

  while (index < limitIndex && lines[index].text.trim() === "") {
    index += 1;
  }

  while (index < limitIndex) {
    const trimmed = lines[index].text.trim();
    if (trimmed === "" || isRequestSeparator(trimmed)) break;
    if (isComment(trimmed)) {
      index += 1;
      continue;
    }
    if (bodyStartIndex === null) bodyStartIndex = index;
    bodyEndIndex = index;
    requestEndIndex = index;
    index += 1;
  }

  return {
    requestEndIndex,
    headerStartIndex,
    headerEndIndex,
    bodyStartIndex,
    bodyEndIndex,
  };
}

function findNextSeparatorIndex(lines: HttpLine[], fromIndex: number): number {
  for (let index = fromIndex; index < lines.length; index++) {
    if (isRequestSeparator(lines[index].text.trim())) return index;
  }
  return lines.length;
}

function compareFoldRanges(a: HttpFoldRange, b: HttpFoldRange): number {
  if (a.lineFrom !== b.lineFrom) return a.lineFrom - b.lineFrom;
  const priorityDelta = foldKindPriority(a.kind) - foldKindPriority(b.kind);
  if (priorityDelta !== 0) return priorityDelta;
  return b.to - b.from - (a.to - a.from);
}

function trimTooltipPreview(preview: string): string {
  if (preview.length <= MAX_TOOLTIP_CHARS) return preview;
  return `${preview.slice(0, MAX_TOOLTIP_CHARS)}\n...`;
}

function formatFoldPreview(preview: string, kind: HttpFoldKind | "unknown"): string {
  if (kind !== "json-object" && kind !== "json-array") {
    return trimTooltipPreview(preview);
  }
  try {
    return trimTooltipPreview(JSON.stringify(JSON.parse(preview), null, 2));
  } catch {
    return trimTooltipPreview(preview);
  }
}

function labelPrefix(kind: HttpFoldKind): string {
  switch (kind) {
    case "request":
      return "接口";
    case "headers":
      return "请求头";
    case "body":
      return "请求体";
    case "json-object":
      return "JSON 对象";
    case "json-array":
      return "JSON 数组";
  }
}

function foldKindPriority(kind: HttpFoldKind): number {
  switch (kind) {
    case "request":
      return 0;
    case "headers":
      return 1;
    case "body":
      return 2;
    case "json-object":
      return 3;
    case "json-array":
      return 4;
  }
}

function isFoldPlaceholderInfo(value: unknown): value is FoldPlaceholderInfo {
  if (!value || typeof value !== "object") return false;
  const info = value as Partial<FoldPlaceholderInfo>;
  return typeof info.label === "string" && typeof info.preview === "string" && typeof info.kind === "string";
}

function isMatchingJsonToken(open: JsonToken["char"], close: "}" | "]"): boolean {
  return (open === "{" && close === "}") || (open === "[" && close === "]");
}

function shouldSkipBeforeRequest(trimmed: string): boolean {
  return trimmed === "" || isComment(trimmed) || trimmed.startsWith("@");
}

function isRequestLine(trimmed: string): boolean {
  return REQUEST_LINE_RE.test(trimmed) || BARE_URL_RE.test(trimmed);
}

function getMessageProtocol(trimmed: string): "websocket" | "grpc" | null {
  const method = trimmed.split(/\s+/, 1)[0] ?? "";
  if (method.toUpperCase() === "WEBSOCKET") return "websocket";
  if (method.toUpperCase() === "GRPC") return "grpc";
  return null;
}

function isRequestSeparator(trimmed: string): boolean {
  return trimmed.startsWith("###");
}

function isContinuationLine(text: string): boolean {
  return /^\s/.test(text) && text.trim() !== "";
}

function isHeaderLine(trimmed: string): boolean {
  return HEADER_RE.test(trimmed);
}

function isComment(trimmed: string): boolean {
  return trimmed.startsWith("#") || trimmed.startsWith("//");
}

const httpFoldingTheme = EditorView.theme({
  ".cm-http-fold-placeholder": {
    border: "1px solid var(--border)",
    borderRadius: "3px",
    backgroundColor: "var(--muted)",
    color: "var(--muted-foreground)",
    padding: "0 6px",
    margin: "0 2px",
    cursor: "pointer",
  },
  ".cm-tooltip.cm-tooltip-hover": {
    zIndex: "50",
  },
  ".cm-http-fold-tooltip.cm-tooltip": {
    zIndex: "50",
  },
  ".cm-http-fold-tooltip": {
    maxWidth: "min(720px, calc(100vw - 48px))",
    maxHeight: "220px",
    overflow: "auto",
    border: "1px solid var(--border)",
    borderRadius: "6px",
    backgroundColor: "var(--popover)",
    color: "var(--popover-foreground)",
    boxShadow: "0 12px 32px rgba(0, 0, 0, 0.18)",
    position: "relative",
  },
  ".cm-http-fold-tooltip ::selection": {
    backgroundColor: "var(--editor-selection)",
    color: "inherit",
  },
  ".cm-http-fold-tooltip-copy": {
    position: "absolute",
    top: "6px",
    right: "6px",
    width: "20px",
    height: "20px",
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    borderRadius: "4px",
    border: "1px solid transparent",
    backgroundColor: "transparent",
    color: "var(--muted-foreground)",
    cursor: "pointer",
    zIndex: "1",
    opacity: "0",
    fontSize: "14px",
    transition: "opacity 120ms, background-color 120ms, color 120ms",
  },
  ".cm-http-fold-tooltip:hover .cm-http-fold-tooltip-copy": {
    opacity: "1",
  },
  ".cm-http-fold-tooltip-copy:hover": {
    backgroundColor: "var(--accent)",
    color: "var(--accent-foreground)",
  },
  ".cm-http-fold-tooltip-copy-checked": {
    color: "hsl(140 60% 45%)",
  },
  ".cm-http-fold-tooltip-title": {
    position: "sticky",
    top: "0",
    borderBottom: "1px solid var(--border)",
    backgroundColor: "var(--popover)",
    color: "var(--muted-foreground)",
    padding: "6px 8px",
    fontSize: "12px",
    fontFamily: "var(--font-ui)",
  },
  ".cm-http-fold-tooltip pre": {
    margin: "0",
    padding: "8px",
    whiteSpace: "pre-wrap",
    wordBreak: "break-word",
    fontFamily: "var(--font-editor)",
    fontSize: "12px",
    lineHeight: "1.45",
  },
});
