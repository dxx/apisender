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
}

const REQUEST_LINE_RE =
  /^(GET|POST|PUT|DELETE|PATCH|HEAD|OPTIONS|CONNECT|TRACE|WEBSOCKET|GRPC|[A-Z][A-Z0-9_-]+)\s+\S+/;
const BARE_URL_RE = /^https?:\/\/\S+/i;
const HEADER_RE = /^[^:\s][^:]*:/;
const MAX_TOOLTIP_CHARS = 6000;
const HTTP_FOLD_TOOLTIP_OPEN_DELAY_MS = 200;
export const HTTP_FOLD_TOOLTIP_CLOSE_DELAY_MS = 700;

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

    /**
     * constructor
     * 入参：当前 CodeMirror EditorView。
     * 出参：折叠预览插件实例。
     * 作用与流程：保存编辑器视图，并监听编辑器内鼠标移动和离开事件，
     * 后续根据折叠占位符命中情况控制预览框打开与延迟关闭。
     */
    constructor(private readonly view: EditorView) {
      this.view.dom.addEventListener("mousemove", this.handleEditorMouseMove);
      this.view.dom.addEventListener("mouseleave", this.handleEditorMouseLeave);
    }

    /**
     * update
     * 入参：CodeMirror 视图更新对象。
     * 出参：无。
     * 作用与流程：文档内容变化时清理打开/关闭计时器和当前折叠区间，
     * tooltip StateField 会在同一事务中自动移除旧预览。
     */
    update(update: ViewUpdate): void {
      if (!update.docChanged) return;
      this.clearTimers();
      this.pendingRange = null;
      this.activeRange = null;
    }

    /**
     * destroy
     * 入参：无。
     * 出参：无。
     * 作用与流程：编辑器销毁时移除鼠标事件监听并清理计时器，
     * 防止已关闭 tab 中遗留异步回调。
     */
    destroy(): void {
      this.view.dom.removeEventListener("mousemove", this.handleEditorMouseMove);
      this.view.dom.removeEventListener("mouseleave", this.handleEditorMouseLeave);
      this.clearTimers();
    }

    /**
     * handleEditorMouseMove
     * 入参：编辑器区域内的鼠标移动事件。
     * 出参：无。
     * 作用与流程：命中折叠占位符时延迟打开预览；命中预览框时保持打开；
     * 移到其它区域时启动延迟关闭，让用户有时间进入预览框查看内容。
     */
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

    /**
     * handleEditorMouseLeave
     * 入参：鼠标离开编辑器区域事件。
     * 出参：无。
     * 作用与流程：离开编辑器时不立即关闭，而是启动延迟关闭计时；
     * 如果用户移动到预览框，预览框的 mouseenter 会取消该计时。
     */
    private handleEditorMouseLeave = (): void => {
      this.scheduleClose();
    };

    /**
     * scheduleOpen
     * 入参：准备展示的折叠区间。
     * 出参：无。
     * 作用与流程：记录待打开区间，清理关闭计时，并在固定悬停时间后创建预览；
     * 已经打开或正在等待同一区间时不会重复派发事务。
     */
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

    /**
     * openFoldPreview
     * 入参：需要展示预览的折叠区间。
     * 出参：无。
     * 作用与流程：根据折叠区间生成 tooltip 描述并写入 StateField，
     * 由 CodeMirror showTooltip 负责挂载和定位真实 DOM。
     */
    private openFoldPreview(folded: { from: number; to: number }): void {
      this.pendingRange = null;
      const tooltip = createFoldPreviewTooltip(this.view, folded, {
        keepOpen: this.keepOpen,
        scheduleClose: this.scheduleClose,
      });
      if (!tooltip) return;

      this.activeRange = folded;
      this.view.dispatch({
        effects: setFoldPreviewTooltipEffect.of(tooltip),
      });
    }

    /**
     * keepOpen
     * 入参：无。
     * 出参：无。
     * 作用与流程：清理关闭计时器，供占位符或预览框继续被悬浮时调用，
     * 保证用户能把鼠标移入预览框并滚动查看内容。
     */
    private keepOpen = (): void => {
      this.clearCloseTimer();
    };

    /**
     * scheduleClose
     * 入参：无。
     * 出参：无。
     * 作用与流程：取消尚未打开的预览，并对已打开预览启动延迟关闭；
     * 延迟期间如果鼠标进入预览框，会通过 keepOpen 取消本次关闭。
     */
    private scheduleClose = (): void => {
      this.clearOpenTimer();
      this.pendingRange = null;
      if (!this.activeRange || this.closeTimer !== null) return;

      this.closeTimer = window.setTimeout(() => {
        this.closeTimer = null;
        this.closeNow();
      }, HTTP_FOLD_TOOLTIP_CLOSE_DELAY_MS);
    };

    /**
     * closeNow
     * 入参：无。
     * 出参：无。
     * 作用与流程：立即清空当前预览区间，并派发空 tooltip，
     * 让 CodeMirror 移除已经挂载的预览 DOM。
     */
    private closeNow(): void {
      this.pendingRange = null;
      if (!this.activeRange) return;

      this.activeRange = null;
      this.view.dispatch({
        effects: setFoldPreviewTooltipEffect.of(null),
      });
    }

    /**
     * clearOpenTimer
     * 入参：无。
     * 出参：无。
     * 作用与流程：如果存在等待打开预览的计时器，则取消它并重置记录。
     */
    private clearOpenTimer(): void {
      if (this.openTimer === null) return;
      window.clearTimeout(this.openTimer);
      this.openTimer = null;
    }

    /**
     * clearCloseTimer
     * 入参：无。
     * 出参：无。
     * 作用与流程：如果存在等待关闭预览的计时器，则取消它并重置记录。
     */
    private clearCloseTimer(): void {
      if (this.closeTimer === null) return;
      window.clearTimeout(this.closeTimer);
      this.closeTimer = null;
    }

    /**
     * clearTimers
     * 入参：无。
     * 出参：无。
     * 作用与流程：统一清理打开和关闭计时器，供文档变更和插件销毁时复用。
     */
    private clearTimers(): void {
      this.clearOpenTimer();
      this.clearCloseTimer();
    }

    /**
     * readFoldedRangeFromPlaceholder
     * 入参：当前鼠标命中的折叠占位符 DOM。
     * 出参：占位符对应的已折叠区间；无法映射时返回 null。
     * 作用与流程：先把 DOM 映射回文档位置，再复用已折叠区间查询逻辑，
     * 兼容不同浏览器对折叠 widget 位置的映射差异。
     */
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

/**
 * collectHttpFoldRanges
 * 入参：HTTP 编辑器完整文本。
 * 出参：可折叠区间列表，包含文档位置、行号、占位文案和悬浮预览。
 * 作用与流程：先按行建立位置索引，再逐个识别请求块；普通 HTTP 请求继续识别
 * 请求头、请求体和 JSON 子结构，WS/gRPC 只做整块折叠并分别遵守各自消息边界。
 */
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

/**
 * httpFoldingExtensions
 * 入参：无。
 * 出参：CodeMirror 扩展列表。
 * 作用与流程：注册 HTTP 折叠服务、折叠占位符、悬浮预览和快捷键；
 * 折叠按钮由 HttpEditor 的运行按钮列统一渲染，避免额外生成独立 gutter。
 */
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

/**
 * selectHttpFoldControls
 * 入参：已排序或未排序的 HTTP 折叠区间列表。
 * 出参：每个起始行最多一个可渲染为 gutter 按钮的折叠区间。
 * 作用与流程：先复用折叠服务排序规则稳定排序，再按起始行去重，
 * 让运行按钮列中同一行不会同时出现 body 与 JSON 等多个折叠按钮。
 */
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

/**
 * refreshHttpFoldPlaceholders
 * 入参：当前 CodeMirror EditorView。
 * 出参：无。
 * 作用与流程：读取已恢复的折叠区间，先展开再重新折叠同一区间，
 * 让从 editorState 反序列化出来的折叠也能使用本扩展的中文占位符和预览信息。
 */
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

/**
 * buildLines
 * 入参：编辑器完整文本。
 * 出参：带 1 基行号和绝对字符位置的行数组。
 * 作用与流程：逐个查找换行符并记录每行起止位置，最后补齐末尾行，
 * 用于让纯文本扫描结果能直接映射到 CodeMirror 文档位置。
 */
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

/**
 * findNextRequestStart
 * 入参：行索引数组和起始扫描下标。
 * 出参：下一个请求块的分隔行下标与请求行下标；找不到时返回 null。
 * 作用与流程：跳过空行、注释和变量行；遇到 ### 时继续向后找真正请求行，
 * 否则直接识别独立请求行。
 */
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

/**
 * findRequestLineAfterSeparator
 * 入参：行索引数组和 ### 分隔符之后的起始下标。
 * 出参：分隔符所属请求的请求行下标；如果下一个分隔符前没有请求行则返回 null。
 * 作用与流程：允许分隔符和请求行之间出现空行、注释、标签和变量，
 * 一旦遇到非这些内容且不是请求行，就判定该分隔块不可折叠。
 */
function findRequestLineAfterSeparator(lines: HttpLine[], fromIndex: number): number | null {
  for (let index = fromIndex; index < lines.length; index++) {
    const trimmed = lines[index].text.trim();
    if (isRequestSeparator(trimmed)) return null;
    if (shouldSkipBeforeRequest(trimmed)) continue;
    return isRequestLine(trimmed) ? index : null;
  }
  return null;
}

/**
 * parseRequestFold
 * 入参：行索引数组和请求行下标。
 * 出参：请求块、请求头、请求体的行范围和下一轮扫描下标。
 * 作用与流程：先处理请求行续行；WebSocket 折叠到下一个分隔符前，gRPC 按消息体空行结束，
 * 普通 HTTP 再扫描 header/body，multipart body 会允许内部空行。
 */
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

/**
 * scanHeaders
 * 入参：行索引数组、header 候选起点和当前请求块结束下标。
 * 出参：header 起止下标，以及 body 可开始扫描的位置。
 * 作用与流程：按连续 `Key: Value` 行识别请求头，允许中间出现注释；
 * 遇到空行时把后一行作为 body 候选起点，遇到非 header 内容时原地交给 body 扫描。
 */
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

/**
 * scanBody
 * 入参：行索引数组、body 候选起点、当前请求块结束下标，以及是否允许空行。
 * 出参：body 实际起止下标；没有 body 时起止均为 null。
 * 作用与流程：跳过 body 前置注释，收集可见 body 行；普通 body 遇空行停止，
 * multipart body 保留内部空行，统一在 ### 或响应重定向语法处停止。
 */
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

/**
 * collectJsonFoldRanges
 * 入参：行索引数组、body 起止下标和完整文本。
 * 出参：JSON 对象/数组折叠区间。
 * 作用与流程：在 body 绝对位置范围内逐字符扫描，使用栈配对 `{}` 与 `[]`，
 * 同时维护字符串和转义状态，避免把字符串中的括号当作结构括号。
 */
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

/**
 * addLineRange
 * 入参：目标数组、折叠类型、行索引数组、起止行下标和完整文本。
 * 出参：无，合法时向目标数组追加折叠区间。
 * 作用与流程：把整行范围转换为绝对字符区间，过滤空范围和单行折叠；
 * request 会额外读取 ### 后面的标题，其余类型统一生成 label、preview 等展示信息。
 */
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

/**
 * createFoldRange
 * 入参：折叠类型、绝对字符起止位置、1 基起止行号、完整文本和可选标题。
 * 出参：标准 HttpFoldRange。
 * 作用与流程：按类型、标题和行数生成中文占位符，并截取对应原文作为悬浮预览。
 */
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

/**
 * extractRequestTitle
 * 入参：请求折叠起始行原文。
 * 出参：### 后面的标题文本；没有标题或起始行不是 ### 时返回 null。
 * 作用与流程：只解析请求块分隔符行，去掉 `###` 前缀并压缩连续空白，
 * 用于让接口折叠占位符显示用户写在分隔符后的注释标题。
 */
function extractRequestTitle(text: string): string | null {
  const trimmed = text.trim();
  if (!isRequestSeparator(trimmed)) return null;
  const title = trimmed.replace(/^###\s*/, "").trim().replace(/\s+/g, " ");
  return title === "" ? null : title;
}

/**
 * findHttpFoldRange
 * 入参：CodeMirror 状态和当前 gutter 查询行的起止位置。
 * 出参：该行首个可折叠区间，找不到时返回 null。
 * 作用与流程：读取当前文档的折叠区间缓存，再按行号匹配折叠起点；同一行存在多个折叠时，
 * 按请求、header、body、JSON 的顺序返回，保持 gutter 行为稳定。
 */
function findHttpFoldRange(state: EditorState, lineStart: number, _lineEnd: number): { from: number; to: number } | null {
  const line = state.doc.lineAt(lineStart);
  const range = getHttpFoldRanges(state).find((item) => item.lineFrom === line.number);
  return range ? { from: range.from, to: range.to } : null;
}

/**
 * findFoldRangeByOffsets
 * 入参：CodeMirror 状态、折叠起止位置。
 * 出参：匹配的折叠展示信息，找不到时返回 null。
 * 作用与流程：读取缓存的折叠区间并用起止位置精确匹配，用于生成占位符和悬浮预览。
 */
function findFoldRangeByOffsets(state: EditorState, from: number, to: number): FoldPlaceholderInfo | null {
  const range = getHttpFoldRanges(state).find((item) => item.from === from && item.to === to);
  if (!range) return null;
  return { label: range.label, preview: range.preview, kind: range.kind };
}

/**
 * getHttpFoldRanges
 * 入参：CodeMirror 状态。
 * 出参：当前文档的 HTTP 折叠区间缓存。
 * 作用与流程：优先读取本扩展的 StateField；如果旧状态缺少该字段，则临时扫描全文兜底。
 */
function getHttpFoldRanges(state: EditorState): readonly HttpFoldRange[] {
  return state.field(httpFoldRangesField, false) ?? collectHttpFoldRanges(state.doc.toString());
}

/**
 * createFoldPreviewTooltip
 * 入参：CodeMirror 视图、已折叠区间和预览开关控制方法。
 * 出参：折叠预览 tooltip；折叠信息无法生成时返回 null。
 * 作用与流程：根据折叠区间读取占位符信息，创建可滚动预览 DOM，
 * 并在预览框进入/离开时分别保持打开或启动延迟关闭。
 */
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
      pre.textContent = trimTooltipPreview(info.preview);
      dom.append(title, pre);
      dom.addEventListener("mouseenter", controls.keepOpen);
      dom.addEventListener("mouseleave", controls.scheduleClose);
      return {
        dom,
        destroy: () => {
          dom.removeEventListener("mouseenter", controls.keepOpen);
          dom.removeEventListener("mouseleave", controls.scheduleClose);
        },
      };
    },
  };
}

/**
 * closestElement
 * 入参：事件目标和 CSS 选择器。
 * 出参：最近的 HTMLElement；事件目标不是元素或找不到匹配节点时返回 null。
 * 作用与流程：先确认事件目标是 DOM 元素，再调用 closest 查找目标节点，
 * 用于同时兼容占位符内部文本节点和 tooltip 内部节点的命中。
 */
function closestElement(target: EventTarget | null, selector: string): HTMLElement | null {
  if (!(target instanceof Element)) return null;
  const closest = target.closest(selector);
  return closest instanceof HTMLElement ? closest : null;
}

/**
 * isSameFoldRange
 * 入参：两个可能为空的折叠区间。
 * 出参：两个区间是否同为非空且起止位置一致。
 * 作用与流程：用 from/to 精确判断同一个折叠占位符，避免鼠标移动时重复创建预览。
 */
function isSameFoldRange(
  left: { from: number; to: number } | null,
  right: { from: number; to: number } | null,
): boolean {
  return left !== null && right !== null && left.from === right.from && left.to === right.to;
}

/**
 * findFoldedRangeNear
 * 入参：CodeMirror 视图和文档位置。
 * 出参：触达该位置的已折叠区间；没有时返回 null。
 * 作用与流程：先查找位置附近的小范围，适配占位符命中；找不到时再遍历全部折叠，
 * 兼容不同浏览器对折叠 widget 的位置映射差异。
 */
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

/**
 * fallbackPlaceholder
 * 入参：完整文本和折叠起止位置。
 * 出参：兜底占位符信息。
 * 作用与流程：当保存的折叠区间因文本变化无法精确匹配扫描结果时，
 * 仍根据当前位置计算行数和预览，保证折叠状态可展示、可悬浮。
 */
function fallbackPlaceholder(text: string, from: number, to: number): FoldPlaceholderInfo {
  const folded = text.slice(from, to);
  const lineCount = Math.max(1, folded.split("\n").length);
  return {
    label: `折叠内容 ${lineCount} 行 ...`,
    preview: folded,
    kind: "unknown",
  };
}

/**
 * shouldScanJsonBody
 * 入参：行索引数组、header 起止下标和 body 起止下标。
 * 出参：是否需要扫描 JSON 子折叠。
 * 作用与流程：优先尊重 Content-Type 中的 json 标识；没有 Content-Type 时，
 * 仅当 body 第一个非空字符是 `{` 或 `[` 且不是模板变量 `{{...}}` 时按 JSON 处理。
 */
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

/**
 * getContentType
 * 入参：行索引数组和 header 起止下标。
 * 出参：小写 Content-Type 值；没有时返回 null。
 * 作用与流程：只在已识别的 header 区间里查找 content-type，
 * 防止把 body 文本中的冒号误当作请求头。
 */
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

/**
 * isMultipartContentType
 * 入参：小写 Content-Type 值或 null。
 * 出参：是否是 multipart/form-data。
 * 作用与流程：复用后端 parser 的判断口径，只把 multipart/form-data 请求体视作允许空行。
 */
function isMultipartContentType(contentType: string | null): boolean {
  return contentType?.startsWith("multipart/form-data") ?? false;
}

/**
 * scanWsBody
 * 入参：行索引数组、请求行结束下标和当前请求块结束下标。
 * 出参：WebSocket 块 body 段行下标和请求块最后内容行下标。
 * 作用与流程：跳过 URL 后空行，收集到下一个 `###` 或文件尾的所有行；
 * WebSocket 消息体之间允许空行，不在空行处中断；跳过注释行。
 */
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

/**
 * scanGrpcSections
 * 入参：行索引数组、请求行结束下标和当前请求块结束下标。
 * 出参：gRPC 块的 metadata / body 段行下标和请求块最后内容行下标。
 * 作用与流程：跳过 URL 后空行，先扫描 `key: value` 形式的 metadata 段；
 * 再跳过 metadata/body 之间的空行，收集 JSON/XML 消息体。metadata 遇空行、
 * JSON/XML 起始行或 `###` 结束；body 遇空行或 `###` 结束。
 */
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

/**
 * findNextSeparatorIndex
 * 入参：行索引数组和起始下标。
 * 出参：下一个 ### 分隔符下标；不存在时返回行数。
 * 作用与流程：从当前位置向后线性扫描，作为当前请求块的硬边界。
 */
function findNextSeparatorIndex(lines: HttpLine[], fromIndex: number): number {
  for (let index = fromIndex; index < lines.length; index++) {
    if (isRequestSeparator(lines[index].text.trim())) return index;
  }
  return lines.length;
}

/**
 * compareFoldRanges
 * 入参：两个折叠区间。
 * 出参：排序比较值。
 * 作用与流程：按起始行、类型优先级和范围长度排序，保证同一行折叠入口稳定。
 */
function compareFoldRanges(a: HttpFoldRange, b: HttpFoldRange): number {
  if (a.lineFrom !== b.lineFrom) return a.lineFrom - b.lineFrom;
  const priorityDelta = foldKindPriority(a.kind) - foldKindPriority(b.kind);
  if (priorityDelta !== 0) return priorityDelta;
  return b.to - b.from - (a.to - a.from);
}

/**
 * trimTooltipPreview
 * 入参：原始预览文本。
 * 出参：长度受限的预览文本。
 * 作用与流程：保留前部内容并追加省略提示，避免超长请求体撑开悬浮层。
 */
function trimTooltipPreview(preview: string): string {
  if (preview.length <= MAX_TOOLTIP_CHARS) return preview;
  return `${preview.slice(0, MAX_TOOLTIP_CHARS)}\n...`;
}

/**
 * labelPrefix
 * 入参：折叠类型。
 * 出参：中文占位符前缀。
 * 作用与流程：集中维护折叠类型到展示文案的映射，避免各处拼接不一致。
 */
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

/**
 * foldKindPriority
 * 入参：折叠类型。
 * 出参：同一行多个折叠候选的优先级，数值越小越优先。
 * 作用与流程：让请求块、请求头、请求体优先于 JSON 子结构，
 * 避免同一行 gutter 在每次扫描时切换含义。
 */
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

/**
 * isFoldPlaceholderInfo
 * 入参：未知 prepared placeholder 值。
 * 出参：是否为本扩展生成的占位符信息。
 * 作用与流程：运行时检查对象字段，避免反序列化旧折叠状态时访问不存在的属性。
 */
function isFoldPlaceholderInfo(value: unknown): value is FoldPlaceholderInfo {
  if (!value || typeof value !== "object") return false;
  const info = value as Partial<FoldPlaceholderInfo>;
  return typeof info.label === "string" && typeof info.preview === "string" && typeof info.kind === "string";
}

/**
 * isMatchingJsonToken
 * 入参：栈顶左括号和当前右括号。
 * 出参：两者是否成对。
 * 作用与流程：对象只匹配 `}`，数组只匹配 `]`，避免交叉括号生成错误区间。
 */
function isMatchingJsonToken(open: JsonToken["char"], close: "}" | "]"): boolean {
  return (open === "{" && close === "}") || (open === "[" && close === "]");
}

/**
 * shouldSkipBeforeRequest
 * 入参：去除首尾空白后的行文本。
 * 出参：该行是否可在请求行前跳过。
 * 作用与流程：把空行、注释、标签和变量视作请求块前置元信息，不单独参与折叠。
 */
function shouldSkipBeforeRequest(trimmed: string): boolean {
  return trimmed === "" || isComment(trimmed) || trimmed.startsWith("@");
}

/**
 * isRequestLine
 * 入参：去除首尾空白后的行文本。
 * 出参：是否是请求起始行。
 * 作用与流程：识别常见 HTTP/WS/gRPC 方法、自定义大写方法和裸 URL 请求。
 */
function isRequestLine(trimmed: string): boolean {
  return REQUEST_LINE_RE.test(trimmed) || BARE_URL_RE.test(trimmed);
}

/**
 * getMessageProtocol
 * 入参：去除首尾空白后的请求行文本。
 * 出参：消息协议类型；普通 HTTP 请求返回 null。
 * 作用与流程：只检查请求行第一个单词，让这些协议保留整块折叠但跳过 HTTP header/body 规则。
 */
function getMessageProtocol(trimmed: string): "websocket" | "grpc" | null {
  const method = trimmed.split(/\s+/, 1)[0] ?? "";
  if (method.toUpperCase() === "WEBSOCKET") return "websocket";
  if (method.toUpperCase() === "GRPC") return "grpc";
  return null;
}

/**
 * isRequestSeparator
 * 入参：去除首尾空白后的行文本。
 * 出参：是否是请求块分隔符。
 * 作用与流程：只按 `###` 前缀识别请求分隔，保持与现有运行 gutter 的规则一致。
 */
function isRequestSeparator(trimmed: string): boolean {
  return trimmed.startsWith("###");
}

/**
 * isContinuationLine
 * 入参：原始行文本。
 * 出参：是否是请求行续行。
 * 作用与流程：非空且以空格或 tab 开头时视为 URL 续行，跟随请求行一起归入请求块。
 */
function isContinuationLine(text: string): boolean {
  return /^\s/.test(text) && text.trim() !== "";
}

/**
 * isHeaderLine
 * 入参：去除首尾空白后的行文本。
 * 出参：是否符合 `Key: Value` 请求头形态。
 * 作用与流程：只要求冒号前存在非空 key，具体合法性仍交给后端 parser。
 */
function isHeaderLine(trimmed: string): boolean {
  return HEADER_RE.test(trimmed);
}

/**
 * isComment
 * 入参：去除首尾空白后的行文本。
 * 出参：是否是 HTTP Client 注释。
 * 作用与流程：识别 `#` 和 `//` 注释，供请求前置、header 与 body 扫描复用。
 */
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
    fontSize: "12px",
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
    maxHeight: "320px",
    overflow: "auto",
    border: "1px solid var(--border)",
    borderRadius: "6px",
    backgroundColor: "var(--popover)",
    color: "var(--popover-foreground)",
    boxShadow: "0 12px 32px rgba(0, 0, 0, 0.18)",
  },
  ".cm-http-fold-tooltip-title": {
    position: "sticky",
    top: "0",
    borderBottom: "1px solid var(--border)",
    backgroundColor: "var(--popover)",
    color: "var(--muted-foreground)",
    padding: "6px 8px",
    fontSize: "12px",
    fontFamily: "var(--font-sans)",
  },
  ".cm-http-fold-tooltip pre": {
    margin: "0",
    padding: "8px",
    whiteSpace: "pre-wrap",
    wordBreak: "break-word",
    fontFamily: "var(--font-mono)",
    fontSize: "12px",
    lineHeight: "1.45",
  },
});
