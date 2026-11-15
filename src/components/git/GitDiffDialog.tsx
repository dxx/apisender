import type { GitDiff } from "@/lib/types";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";

interface GitDiffDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: string;
  diff: GitDiff | null;
  onOpenFile?: () => void;
}

/**
 * 渲染统一 Git 差异对话框。
 * 入参：打开状态、标题、差异载荷和可选打开文件回调。
 * 出参：可滚动展示文本差异或二进制元数据的 React 元素。
 * 作用与流程：根据 binary/truncated 状态展示说明，并为工作区文件提供进入编辑器入口。
 */
export function GitDiffDialog({
  open,
  onOpenChange,
  title,
  diff,
  onOpenFile,
}: GitDiffDialogProps) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="flex h-[78vh] w-[82vw] max-w-6xl flex-col">
        <DialogHeader>
          <DialogTitle className="truncate pr-8">{title}</DialogTitle>
          <DialogDescription>
            {diff?.binary
              ? "二进制文件不展示文本差异。"
              : diff?.outputTooLarge
                ? "差异超过 10 MiB，当前仅展示前 1 MiB。"
                : diff?.truncated
                ? "差异超过 1 MiB，当前仅展示前 1 MiB。"
                : "Git 统一差异视图"}
          </DialogDescription>
        </DialogHeader>
        <div className="min-h-0 flex-1 overflow-auto rounded-md border bg-muted/25">
          {diff?.binary ? (
            <div className="p-6 text-sm text-muted-foreground">该变更包含二进制内容。</div>
          ) : (
            <pre className="min-w-max p-4 font-mono text-xs leading-5 whitespace-pre">
              {diff?.content || "没有可展示的文本差异。"}
            </pre>
          )}
        </div>
        <DialogFooter>
          {onOpenFile && (
            <Button variant="outline" onClick={onOpenFile}>
              在编辑器中打开
            </Button>
          )}
          <Button onClick={() => onOpenChange(false)}>关闭</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
