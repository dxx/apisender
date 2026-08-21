import type { EditorView } from "@codemirror/view";

// CodeMirror 默认用整个 webview 视口作为 tooltip 可用空间，
// 但编辑器上方有标题栏/Tab 栏遮挡，导致第一行诊断 tooltip 被覆盖且不自动翻转到下方。
// 这里把可用空间限定为编辑器自身的可见区域。
export function editorTooltipSpace(view: EditorView) {
  const rect = view.dom.getBoundingClientRect();
  return { top: rect.top, left: rect.left, bottom: rect.bottom, right: rect.right };
}
