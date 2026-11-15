import { useEffect, useState } from "react";
import { FolderOpen, GitFork } from "lucide-react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { gitCloneWorkspace, openFileDialog } from "@/lib/tauri";
import { normalizeGitError } from "@/lib/git-state";
import { useWorkspaceStore } from "@/stores/workspace";

interface CloneRepositoryDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

/**
 * 从远端 URL 推导默认文件夹名。
 * 入参：HTTPS、SSH 或本地 Git 远端文本。
 * 出参：移除 `.git` 后缀的末段名称，无法推导时为空字符串。
 * 作用与流程：统一斜杠后取末段，同时兼容 `git@host:org/repo.git` 格式。
 */
function inferFolderName(remoteUrl: string): string {
  const normalized = remoteUrl.trim().replace(/\\/g, "/").replace(/:([^/])/g, "/$1");
  return normalized.split("/").filter(Boolean).pop()?.replace(/\.git$/i, "") ?? "";
}

/**
 * 渲染克隆远端仓库对话框。
 * 入参：打开状态及状态变更回调。
 * 出参：克隆表单 React 元素。
 * 作用与流程：选择父目录、填写远端和目标名，调用后端克隆后同步前端工作区状态。
 */
export function CloneRepositoryDialog({ open, onOpenChange }: CloneRepositoryDialogProps) {
  const openFolder = useWorkspaceStore((state) => state.openFolder);
  const [remoteUrl, setRemoteUrl] = useState("");
  const [parent, setParent] = useState("");
  const [folderName, setFolderName] = useState("");
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    if (!folderName) {
      setFolderName(inferFolderName(remoteUrl));
    }
  }, [remoteUrl, folderName]);

  /**
   * 选择克隆父目录。
   * 入参：无。
   * 出参：Promise<void>。
   * 作用与流程：打开系统目录选择器，用户确认后写入父目录输入框。
   */
  const handleSelectParent = async (): Promise<void> => {
    const selected = await openFileDialog();
    if (selected) setParent(selected);
  };

  /**
   * 提交克隆请求。
   * 入参：无。
   * 出参：Promise<void>。
   * 作用与流程：校验表单、调用 Git 克隆命令，成功后让 workspace store 打开新目录并关闭对话框。
   */
  const handleClone = async (): Promise<void> => {
    const targetName = folderName.trim() || inferFolderName(remoteUrl);
    if (!remoteUrl.trim() || !parent.trim() || !targetName) {
      toast.error("请填写远端地址、父目录和文件夹名称");
      return;
    }
    setSubmitting(true);
    try {
      const path = await gitCloneWorkspace(parent.trim(), targetName, remoteUrl.trim());
      await openFolder(path);
      toast.success("仓库克隆完成");
      onOpenChange(false);
      setRemoteUrl("");
      setFolderName("");
    } catch (cause) {
      const error = normalizeGitError(cause);
      toast.error(error.message, { description: error.details ?? undefined });
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <GitFork className="h-4 w-4" />
            从 Git 克隆
          </DialogTitle>
          <DialogDescription>使用系统 Git 和现有 SSH/凭据配置克隆仓库。</DialogDescription>
        </DialogHeader>
        <div className="space-y-4 py-2">
          <div className="space-y-1.5">
            <Label htmlFor="clone-remote">远端地址</Label>
            <Input
              id="clone-remote"
              value={remoteUrl}
              onChange={(event) => setRemoteUrl(event.target.value)}
              placeholder="git@github.com:org/repo.git"
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="clone-parent">父目录</Label>
            <div className="flex gap-2">
              <Input id="clone-parent" value={parent} readOnly placeholder="选择保存位置" />
              <Button variant="outline" size="icon" onClick={handleSelectParent}>
                <FolderOpen className="h-4 w-4" />
              </Button>
            </div>
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="clone-folder">文件夹名称</Label>
            <Input
              id="clone-folder"
              value={folderName}
              onChange={(event) => setFolderName(event.target.value)}
              placeholder="repo"
            />
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={submitting}>
            取消
          </Button>
          <Button onClick={handleClone} disabled={submitting}>
            {submitting ? "克隆中…" : "克隆并打开"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
