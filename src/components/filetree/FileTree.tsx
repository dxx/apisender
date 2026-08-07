import { useState, useCallback, type KeyboardEvent, type MouseEvent } from "react";
import {
  ChevronRight,
  ChevronDown,
  Folder,
  FolderOpen,
  FileCode2,
  Globe,
  FilePlus,
  FolderPlus,
  RefreshCw,
  Pencil,
  Trash2,
} from "lucide-react";
import { toast } from "sonner";

import type { FileTreeNode } from "@/lib/types";
import * as api from "@/lib/tauri";
import { copyFile, pasteFiles } from "@/lib/tauri/clipboard";
import { useWorkspaceStore } from "@/stores/workspace";
import { useTabsStore } from "@/stores/tabs";
import { isRequestFile, isProtoFile } from "@/lib/file";
import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuSeparator,
  ContextMenuTrigger,
} from "@/components/ui/context-menu";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
  DialogClose,
} from "@/components/ui/dialog";
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
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Tooltip,
  TooltipArrow,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { ScrollArea } from "@/components/ui/scroll-area";

interface FileTreeProps {
  nodes: FileTreeNode[];
}

function findNode(nodes: FileTreeNode[], path: string): FileTreeNode | null {
  for (const n of nodes) {
    if (n.path === path) return n;
    if (n.children) {
      const found = findNode(n.children, path);
      if (found) return found;
    }
  }
  return null;
}

function resolveBaseDir(
  selectPath: string | null,
  nodes: FileTreeNode[],
  root: string | null,
): string | null {
  if (!root) return null;
  if (!selectPath) return root;
  const node = findNode(nodes, selectPath);
  if (!node) return root;
  if (node.type === "dir") return node.path;
  return node.path
    .substring(0, node.path.length - node.name.length)
    .replace(/\/$/, "");
}

export function FileTree({ nodes }: FileTreeProps) {
  const refreshTree = useWorkspaceStore((s) => s.refreshTree);
  const root = useWorkspaceStore((s) => s.root);

  const [rootNewOpen, setRootNewOpen] = useState(false);
  const [rootNewName, setRootNewName] = useState("");
  const [rootNewIsDir, setRootNewIsDir] = useState(false);
  const [selectPath, setSelectPath] = useState<string | null>(null);

  const handleCopy = useCallback(async () => {
    if (!selectPath) {
      toast.error("请先在文件树中选中一个节点");
      return;
    }
    const node = findNode(nodes, selectPath);
    if (!node) {
      toast.error("选中的节点已不存在");
      return;
    }
    try {
      await copyFile(node.path);
      toast.success(
        node.type === "dir" ? "已将文件夹复制到系统剪贴板" : "已复制到系统剪贴板"
      );
    } catch (e) {
      toast.error(`复制失败: ${e}`);
    }
  }, [selectPath, nodes]);

  const handlePaste = useCallback(async () => {
    if (!root) {
      toast.error("请先打开工作区");
      return;
    }
    const destDir = resolveBaseDir(selectPath, nodes, root) ?? root;
    try {
      const copied = await pasteFiles(destDir);
      if (copied.length === 0) {
        toast.info("剪贴板中没有文件");
      } else {
        await refreshTree();
        toast.success(`已粘贴 ${copied.length} 个文件`);
      }
    } catch (e) {
      toast.error(`粘贴失败: ${e}`);
    }
  }, [root, selectPath, nodes, refreshTree]);

  const handleKeyDown = useCallback(
    (e: KeyboardEvent<HTMLDivElement>) => {
      if (!(e.ctrlKey || e.metaKey)) return;
      if (e.key === "c" || e.key === "C") {
        e.preventDefault();
        void handleCopy();
      } else if (e.key === "v" || e.key === "V") {
        e.preventDefault();
        void handlePaste();
      }
    },
    [handleCopy, handlePaste],
  );

  const handleRootCreate = useCallback(async () => {
    if (!root || !rootNewName.trim()) return;
    const baseDir = resolveBaseDir(selectPath, nodes, root);
    if (!baseDir) return;
    const trimmed = rootNewName.trim();
    const lower = trimmed.toLowerCase();
    const finalName = rootNewIsDir
      ? trimmed
      : lower.endsWith(".http") ||
          lower.endsWith(".json") ||
          lower.endsWith(".proto")
        ? trimmed
        : `${trimmed}.http`;
    const newPath = `${baseDir}/${finalName}`.replace(/\\/g, "/");
    try {
      await api.createFile(newPath, rootNewIsDir);
      await refreshTree();
      setRootNewOpen(false);
      setRootNewName("");
      toast.success(rootNewIsDir ? "文件夹已创建" : "文件已创建");
    } catch (e) {
      toast.error(`创建失败: ${e}`);
    }
  }, [root, selectPath, nodes, rootNewName, rootNewIsDir, refreshTree]);

  const openRootNew = (isDir: boolean) => {
    setRootNewIsDir(isDir);
    setRootNewName(isDir ? "new-folder" : "new-request.http");
    setRootNewOpen(true);
  };

  return (
    <div className="flex h-full flex-col" tabIndex={0} onKeyDown={handleKeyDown} onClick={() => setSelectPath(null)}>
      <div className="flex items-center justify-between px-2 py-1.5">
        <span className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
          文件树
        </span>
        <div className="flex items-center gap-0.5">
          <Tooltip>
            <TooltipTrigger asChild>
              <div
                role="button"
                tabIndex={!root ? -1 : 0}
                aria-disabled={!root}
                className={`inline-flex h-6 w-6 cursor-pointer items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-accent hover:text-foreground ${!root ? "pointer-events-none opacity-50" : ""}`}
                onClick={(e) => {
                  e.stopPropagation();
                  openRootNew(false);
                }}
              >
                <FilePlus className="h-3.5 w-3.5" />
              </div>
            </TooltipTrigger>
            <TooltipContent side="bottom">
              <TooltipArrow />
              新建文件
            </TooltipContent>
          </Tooltip>
          <Tooltip>
            <TooltipTrigger asChild>
              <div
                role="button"
                tabIndex={!root ? -1 : 0}
                aria-disabled={!root}
                className={`inline-flex h-6 w-6 cursor-pointer items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-accent hover:text-foreground ${!root ? "pointer-events-none opacity-50" : ""}`}
                onClick={(e) => {
                  e.stopPropagation();
                  openRootNew(true);
                }}
              >
                <FolderPlus className="h-3.5 w-3.5" style={{ transform: "scale(1.1)" }} />
              </div>
            </TooltipTrigger>
            <TooltipContent side="bottom">
              <TooltipArrow />
              新建文件夹
            </TooltipContent>
          </Tooltip>
          <Tooltip>
            <TooltipTrigger asChild>
              <div
                role="button"
                tabIndex={0}
                className="inline-flex h-6 w-6 cursor-pointer items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
                onClick={() => refreshTree()}
              >
                <RefreshCw className="h-3.5 w-3.5" />
              </div>
            </TooltipTrigger>
            <TooltipContent side="bottom">
              <TooltipArrow />
              刷新
            </TooltipContent>
          </Tooltip>
        </div>
      </div>
      <ScrollArea className="flex-1">
        {nodes.length === 0 ? (
          <div className="px-3 py-4 text-center text-xs text-muted-foreground">
            此工作区暂无文件
            <br />
            点击上方按钮新建
          </div>
        ) : (
          
            <div className="flex flex-col">
              {nodes.map((node) => (
                <TreeItem
                  key={node.path}
                  node={node}
                  depth={0}
                  selectPath={selectPath}
                  onSelect={setSelectPath}
                />
              ))}
            </div>
        )}
      </ScrollArea>

      <Dialog
        open={rootNewOpen}
        onOpenChange={(open) => {
          setRootNewOpen(open);
          if (!open) setRootNewName("");
        }}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{rootNewIsDir ? "新建文件夹" : "新建文件"}</DialogTitle>
          </DialogHeader>
          <div className="flex flex-col gap-2 py-2">
            <Label>名称{!rootNewIsDir && "（.http 扩展名自动添加）"}</Label>
            <Input
              value={rootNewName}
              onChange={(e) => setRootNewName(e.target.value)}
              autoFocus
              autoCapitalize="none"
              autoCorrect="off"
              spellCheck={false}
              placeholder={rootNewIsDir ? "folder-name" : "request-name.http"}
              onKeyDown={(e) => {
                if (e.key === "Enter") handleRootCreate();
              }}
            />
          </div>
          <DialogFooter>
            <DialogClose asChild>
              <Button variant="outline">取消</Button>
            </DialogClose>
            <Button onClick={handleRootCreate}>创建</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

function TreeItem({
  node,
  depth,
  selectPath,
  onSelect,
}: {
  node: FileTreeNode;
  depth: number;
  selectPath: string | null;
  onSelect: (path: string) => void;
}) {
  const [expanded, setExpanded] = useState(false);
  const openFile = useTabsStore((s) => s.openFile);
  const refreshTree = useWorkspaceStore((s) => s.refreshTree);
  const [renameOpen, setRenameOpen] = useState(false);
  const [renameValue, setRenameValue] = useState("");
  const [newItemOpen, setNewItemOpen] = useState(false);
  const [newItemName, setNewItemName] = useState("");
  const [newItemIsDir, setNewItemIsDir] = useState(false);
  const [deleteOpen, setDeleteOpen] = useState(false);

  const handleClick = useCallback(
    (e: MouseEvent<HTMLDivElement>) => {
      e.stopPropagation();
      onSelect(node.path);
      if (node.type === "dir") {
        setExpanded((e) => !e);
      } else {
        openFile(node.path, node.name);
      }
    },
    [node, openFile, onSelect],
  );

  const handleDelete = useCallback(async () => {
    try {
      await api.deleteNode(node.path);
      await refreshTree();
      toast.success("已删除");
    } catch (e) {
      toast.error(`删除失败: ${e}`);
    }
  }, [node, refreshTree]);

  const handleRename = useCallback(async () => {
    if (!renameValue.trim()) return;
    const parent = node.path.substring(0, node.path.length - node.name.length);
    const newPath = parent + renameValue;
    try {
      await api.renameNode(node.path, newPath);
      await refreshTree();
      setRenameOpen(false);
      toast.success("已重命名");
    } catch (e) {
      toast.error(`重命名失败: ${e}`);
    }
  }, [node, renameValue, refreshTree]);

  const handleCreate = useCallback(async () => {
    if (!newItemName.trim()) return;
    const trimmed = newItemName.trim();
    const lower = trimmed.toLowerCase();
    const finalName = newItemIsDir
      ? trimmed
      : lower.endsWith(".http") ||
          lower.endsWith(".json") ||
          lower.endsWith(".proto")
        ? trimmed
        : `${trimmed}.http`;
    const parentPath =
      node.type === "dir"
        ? node.path
        : node.path.substring(0, node.path.length - node.name.length);
    const newPath = `${parentPath}/${finalName}`.replace(/\\/g, "/");
    try {
      await api.createFile(newPath, newItemIsDir);
      await refreshTree();
      setNewItemOpen(false);
      setNewItemName("");
      toast.success(newItemIsDir ? "文件夹已创建" : "文件已创建");
    } catch (e) {
      toast.error(`创建失败: ${e}`);
    }
  }, [node, newItemName, newItemIsDir, refreshTree]);

  const paddingLeft = 8 + depth * 14;

  return (
    <>
      <ContextMenu>
        <ContextMenuTrigger asChild>
          <div
            className={`group flex h-7 cursor-pointer items-center gap-1 pr-2 text-sm tabular-nums hover:bg-accent ${
              selectPath === node.path ? "bg-accent font-medium" : ""
            }`}
            style={{ paddingLeft }}
            onClick={handleClick}
          >
            {node.type === "dir" ? (
              <>
                {expanded ? (
                  <ChevronDown className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
                ) : (
                  <ChevronRight className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
                )}
                {expanded ? (
                  <FolderOpen className="h-4 w-4 shrink-0 text-primary" />
                ) : (
                  <Folder className="h-4 w-4 shrink-0 text-primary" />
                )}
              </>
            ) : (
              <>
                <span className="w-3.5 shrink-0" />
                {isRequestFile(node.name) ? (
                  <Globe className="h-4 w-4 shrink-0 text-emerald-500" />
                ) : isProtoFile(node.name) ? (
                  <FileCode2 className="h-4 w-4 shrink-0 text-violet-500" />
                ) : (
                  <FileCode2 className="h-4 w-4 shrink-0 text-emerald-500" />
                )}
              </>
            )}
            <Tooltip>
              <TooltipTrigger asChild>
                <span className="truncate cursor-pointer">{node.name}</span>
              </TooltipTrigger>
              <TooltipContent side="right" className="max-w-md break-all">
                {node.path}
              </TooltipContent>
            </Tooltip>
          </div>
        </ContextMenuTrigger>
        <ContextMenuContent>
          {node.type === "dir" && (
            <>
              <ContextMenuItem
                onClick={() => {
                  setNewItemIsDir(false);
                  setNewItemName("new-request.http");
                  setNewItemOpen(true);
                }}
              >
                <FilePlus className="mr-2 h-3.5 w-3.5" />
                新建文件
              </ContextMenuItem>
              <ContextMenuItem
                onClick={() => {
                  setNewItemIsDir(true);
                  setNewItemName("new-folder");
                  setNewItemOpen(true);
                }}
              >
                <FolderPlus className="mr-2 h-3.5 w-3.5" />
                新建文件夹
              </ContextMenuItem>
              <ContextMenuSeparator />
            </>
          )}
          <ContextMenuItem
            onClick={() => {
              setRenameValue(node.name);
              setRenameOpen(true);
            }}
          >
            <Pencil className="mr-2 h-3.5 w-3.5" />
            重命名
          </ContextMenuItem>
          <ContextMenuItem
            className="focus:bg-destructive/10"
            onClick={() => setDeleteOpen(true)}
          >
            <Trash2 className="mr-2 h-3.5 w-3.5 text-destructive" />
            删除
          </ContextMenuItem>
        </ContextMenuContent>
      </ContextMenu>

      {node.type === "dir" && expanded && node.children && (
        <div className="flex flex-col">
          {node.children.map((child) => (
            <TreeItem
              key={child.path}
              node={child}
              depth={depth + 1}
              selectPath={selectPath}
              onSelect={onSelect}
            />
          ))}
        </div>
      )}

      <Dialog open={renameOpen} onOpenChange={setRenameOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>重命名</DialogTitle>
          </DialogHeader>
          <div className="flex flex-col gap-2 py-2">
            <Label>新名称</Label>
            <Input
              value={renameValue}
              onChange={(e) => setRenameValue(e.target.value)}
              autoFocus
              autoCapitalize="none"
              autoCorrect="off"
              spellCheck={false}
              onKeyDown={(e) => {
                if (e.key === "Enter") handleRename();
              }}
            />
          </div>
          <DialogFooter>
            <DialogClose asChild>
              <Button variant="outline">取消</Button>
            </DialogClose>
            <Button onClick={handleRename}>确定</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={newItemOpen} onOpenChange={setNewItemOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{newItemIsDir ? "新建文件夹" : "新建文件"}</DialogTitle>
          </DialogHeader>
          <div className="flex flex-col gap-2 py-2">
            <Label>名称{!newItemIsDir && "（.http 扩展名自动添加）"}</Label>
            <Input
              value={newItemName}
              onChange={(e) => setNewItemName(e.target.value)}
              autoFocus
              autoCapitalize="none"
              autoCorrect="off"
              spellCheck={false}
              placeholder={newItemIsDir ? "folder-name" : "request-name.http"}
              onKeyDown={(e) => {
                if (e.key === "Enter") handleCreate();
              }}
            />
          </div>
          <DialogFooter>
            <DialogClose asChild>
              <Button variant="outline">取消</Button>
            </DialogClose>
            <Button onClick={handleCreate}>创建</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <AlertDialog open={deleteOpen} onOpenChange={setDeleteOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>删除确认</AlertDialogTitle>
            <AlertDialogDescription>
              确定删除 "{node.name}"？此操作不可撤销。
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>取消</AlertDialogCancel>
            <AlertDialogAction 
              onClick={handleDelete}
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
            >
              删除
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}
