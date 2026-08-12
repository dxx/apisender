import { useEffect, useMemo, useState } from "react";
import {
  AlertTriangle,
  ArrowDown,
  ArrowUp,
  ChevronDown,
  CircleDot,
  FileCode2,
  GitBranch as GitBranchIcon,
  GitCommitHorizontal,
  Minus,
  Plus,
  RefreshCw,
} from "lucide-react";
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
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { GitDiffDialog } from "@/components/git/GitDiffDialog";
import {
  GIT_DEFAULT_IGNORE_RULES,
  GIT_REMOTE_PLACEHOLDER,
  getDirtyTabPaths,
  getGitOperationPaths,
  groupGitFiles,
  normalizeGitError,
  shouldShowRepositorySetup,
  validateCommit,
} from "@/lib/git-state";
import { gitDiff, gitShowCommit } from "@/lib/tauri";
import type { GitDiff, GitErrorPayload, GitFileStatus } from "@/lib/types";
import { useGitStore } from "@/stores/git";
import { useTabsStore } from "@/stores/tabs";
import { useWorkspaceStore } from "@/stores/workspace";

interface ChangeGroupProps {
  title: string;
  files: GitFileStatus[];
  mode: "stage" | "unstage";
  disabled: boolean;
  onFile: (file: GitFileStatus) => void;
  onAll: (paths: string[]) => void;
  onOne: (paths: string[]) => void;
}

/**
 * 把仓库相对路径转换为当前平台风格的绝对路径。
 * 入参：真实仓库根目录和 Git 相对路径。
 * 出参：可交给文件读取命令的绝对路径。
 * 作用与流程：根据根目录是否使用反斜杠选择分隔符，并清理重复分隔符。
 */
function absoluteRepositoryPath(repositoryRoot: string, relativePath: string): string {
  const separator = repositoryRoot.includes("\\") ? "\\" : "/";
  return `${repositoryRoot.replace(/[\\/]+$/, "")}${separator}${relativePath.replace(/[\\/]/g, separator)}`;
}

/**
 * 返回文件状态的紧凑显示标签。
 * 入参：Git 文件状态。
 * 出参：冲突、未跟踪或 XY 状态文本。
 * 作用与流程：优先展示冲突和未跟踪语义，普通状态拼接 index/worktree 代码。
 */
function statusLabel(file: GitFileStatus): string {
  if (file.conflict) return "冲突";
  if (file.untracked) return "U";
  return `${file.indexStatus ?? "."}${file.worktreeStatus ?? "."}`;
}

/**
 * 渲染一组 Git 文件变化。
 * 入参：分组标题、文件、暂存模式和操作回调。
 * 出参：支持单项及全部暂存/取消暂存的文件列表。
 * 作用与流程：文件主体打开 diff，右侧按钮只更新 index；部分暂存文件可在不同组分别操作。
 */
function ChangeGroup({
  title,
  files,
  mode,
  disabled,
  onFile,
  onAll,
  onOne,
}: ChangeGroupProps) {
  if (files.length === 0) return null;
  const ActionIcon = mode === "stage" ? Plus : Minus;
  return (
    <section className="border-b">
      <div className="flex h-7 items-center justify-between bg-muted/30 px-2 text-[11px] font-medium">
        <span>{title} ({files.length})</span>
        <Button
          variant="ghost"
          size="xs"
          disabled={disabled}
          onClick={() => onAll(getGitOperationPaths(files))}
          title={mode === "stage" ? "全部暂存" : "全部取消暂存"}
        >
          <ActionIcon className="h-3 w-3" />
          全部
        </Button>
      </div>
      {files.map((file) => (
        <div key={`${mode}-${file.path}`} className="group flex h-7 items-center gap-1 px-2 hover:bg-accent/60">
          <button
            className="flex min-w-0 flex-1 items-center gap-1.5 text-left text-xs"
            onClick={() => onFile(file)}
          >
            {file.conflict ? (
              <AlertTriangle className="h-3.5 w-3.5 shrink-0 text-destructive" />
            ) : (
              <FileCode2 className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
            )}
            <span className="truncate" title={file.path}>{file.path}</span>
            <span className="ml-auto shrink-0 font-mono text-[10px] text-muted-foreground">
              {statusLabel(file)}
            </span>
          </button>
          <Button
            variant="ghost"
            size="icon"
            className="h-6 w-6 opacity-0 group-hover:opacity-100"
            disabled={disabled}
            onClick={() => onOne(getGitOperationPaths([file]))}
            title={mode === "stage" ? "暂存" : "取消暂存"}
          >
            <ActionIcon className="h-3 w-3" />
          </Button>
        </div>
      ))}
    </section>
  );
}

/**
 * 渲染普通文件夹的 Git 初始化向导。
 * 入参：无，使用 Git store 当前工作区。
 * 出参：远端 URL、默认分支和安全忽略项表单。
 * 作用与流程：收集初始化信息，调用后端验证空远端并创建仓库，但不自动暂存或提交。
 */
function RepositorySetup() {
  const initWorkspace = useGitStore((state) => state.initWorkspace);
  const writing = useGitStore((state) => state.writing);
  const [remoteUrl, setRemoteUrl] = useState("");
  const [branch, setBranch] = useState("main");

  /**
   * 初始化当前工作区。
   * 入参：无。
   * 出参：Promise<void>。
   * 作用与流程：校验表单后调用 store，成功提示用户在更改页核对并暂存内容。
   */
  const handleInit = async (): Promise<void> => {
    if (!remoteUrl.trim() || !branch.trim()) {
      toast.error("请填写空远端地址和默认分支");
      return;
    }
    try {
      await initWorkspace(remoteUrl.trim(), branch.trim());
      toast.success("Git 仓库已初始化，请核对并暂存需要提交的文件");
    } catch (cause) {
      const error = normalizeGitError(cause);
      toast.error(error.message, { description: error.details ?? undefined });
    }
  };

  return (
    <div className="min-w-0 max-w-full space-y-4 overflow-x-hidden p-3 text-xs">
      <div className="min-w-0">
        <h3 className="text-sm font-medium">初始化 Git 仓库</h3>
        <p className="mt-1 break-words text-muted-foreground">
          当前工作区尚未加入 Git。远端必须已创建且不包含任何 Git 引用。
        </p>
      </div>
      <div className="min-w-0 max-w-full space-y-1">
        <Label htmlFor="git-init-remote">空远端地址</Label>
        <Input
          id="git-init-remote"
          className="min-w-0 max-w-full"
          value={remoteUrl}
          onChange={(event) => setRemoteUrl(event.target.value)}
          placeholder={GIT_REMOTE_PLACEHOLDER}
        />
      </div>
      <div className="min-w-0 max-w-full space-y-1">
        <Label htmlFor="git-init-branch">默认分支</Label>
        <Input
          id="git-init-branch"
          className="min-w-0 max-w-full"
          value={branch}
          onChange={(event) => setBranch(event.target.value)}
        />
      </div>
      <div className="min-w-0 max-w-full overflow-hidden rounded border bg-muted/30 p-2 text-[11px] text-muted-foreground">
        <span className="block">将补充忽略：</span>
        <div className="mt-1 flex min-w-0 max-w-full flex-wrap gap-1">
          {GIT_DEFAULT_IGNORE_RULES.map((rule) => (
            <code key={rule} className="max-w-full break-all rounded bg-muted px-1 py-0.5">
              {rule}
            </code>
          ))}
        </div>
      </div>
      <Button className="w-full min-w-0" size="sm" onClick={handleInit} disabled={writing}>
        初始化并连接 origin
      </Button>
    </div>
  );
}

/**
 * 渲染 Git 日常开发闭环面板。
 * 入参：无，从 Git、标签页和工作区 store 读取状态。
 * 出参：状态/差异、暂存/提交、推拉、分支与历史界面。
 * 作用与流程：统一执行未保存标签保护、结构化错误提示和 Git 写后文件树/编辑器刷新。
 */
export function GitPanel() {
  const availability = useGitStore((state) => state.availability);
  const repository = useGitStore((state) => state.repository);
  const branches = useGitStore((state) => state.branches);
  const commits = useGitStore((state) => state.commits);
  const identity = useGitStore((state) => state.identity);
  const loading = useGitStore((state) => state.loading);
  const writing = useGitStore((state) => state.writing);
  const error = useGitStore((state) => state.error);
  const hasMoreCommits = useGitStore((state) => state.hasMoreCommits);
  const refresh = useGitStore((state) => state.refresh);
  const loadMoreCommits = useGitStore((state) => state.loadMoreCommits);
  const stage = useGitStore((state) => state.stage);
  const unstage = useGitStore((state) => state.unstage);
  const commit = useGitStore((state) => state.commit);
  const setIdentity = useGitStore((state) => state.setIdentity);
  const pull = useGitStore((state) => state.pull);
  const push = useGitStore((state) => state.push);
  const createBranch = useGitStore((state) => state.createBranch);
  const switchBranch = useGitStore((state) => state.switchBranch);
  const connectOrigin = useGitStore((state) => state.connectOrigin);
  const refreshTree = useWorkspaceStore((state) => state.refreshTree);
  const openFile = useTabsStore((state) => state.openFile);

  const [view, setView] = useState("changes");
  const [message, setMessage] = useState("");
  const [branchQuery, setBranchQuery] = useState("");
  const [newBranchOpen, setNewBranchOpen] = useState(false);
  const [newBranchName, setNewBranchName] = useState("");
  const [identityOpen, setIdentityOpen] = useState(false);
  const [identityName, setIdentityName] = useState("");
  const [identityEmail, setIdentityEmail] = useState("");
  const [remoteOpen, setRemoteOpen] = useState(false);
  const [remoteUrl, setRemoteUrl] = useState("");
  const [pushOpen, setPushOpen] = useState(false);
  const [pushRemote, setPushRemote] = useState("");
  const [pushBranch, setPushBranch] = useState("");
  const [diffOpen, setDiffOpen] = useState(false);
  const [diffTitle, setDiffTitle] = useState("");
  const [diffValue, setDiffValue] = useState<GitDiff | null>(null);
  const [diffPath, setDiffPath] = useState<string | null>(null);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  useEffect(() => {
    setIdentityName(identity?.name ?? "");
    setIdentityEmail(identity?.email ?? "");
  }, [identity]);

  const groups = useMemo(() => groupGitFiles(repository?.files ?? []), [repository?.files]);
  const visibleBranches = useMemo(
    () => branches.filter((branch) => !branch.remote && branch.name.toLowerCase().includes(branchQuery.toLowerCase())),
    [branches, branchQuery],
  );

  /**
   * 在会影响磁盘或提交语义的操作前检查未保存标签页。
   * 入参：即将执行的操作名称。
   * 出参：可以继续时返回 true，否则显示文件列表并返回 false。
   * 作用与流程：读取 tabs store 的 isDirty 标记，避免 Git 操作忽略编辑器内存修改。
   */
  const ensureSavedTabs = (action: string): boolean => {
    const dirtyPaths = getDirtyTabPaths(useTabsStore.getState().tabs);
    if (dirtyPaths.length === 0) return true;
    toast.error(`${action}前请先保存所有编辑器文件`, {
      description: dirtyPaths.map((path) => path.split(/[\\/]/).pop()).join("、"),
    });
    return false;
  };

  /**
   * 刷新 Git 写操作影响的文件树和所有干净标签页。
   * 入参：无。
   * 出参：Promise<void>。
   * 作用与流程：刷新当前工作区文件树，并逐个从磁盘重新加载未编辑标签页。
   */
  const syncWorkspaceFiles = async (): Promise<void> => {
    await refreshTree();
    const tabs = useTabsStore.getState().tabs.filter((tab) => !tab.isDirty);
    await Promise.all(tabs.map((tab) => useTabsStore.getState().reloadFromDisk(tab.path)));
  };

  /**
   * 展示 Git 操作错误。
   * 入参：未知错误值。
   * 出参：规范化后的 GitErrorPayload。
   * 作用与流程：身份缺失时打开仓库身份表单，其余错误通过 toast 展示摘要和脱敏详情。
   */
  const showError = (cause: unknown): GitErrorPayload => {
    const normalized = normalizeGitError(cause);
    if (normalized.code === "identity_missing") {
      setIdentityOpen(true);
    } else {
      toast.error(normalized.message, { description: normalized.details ?? undefined });
    }
    return normalized;
  };

  /**
   * 打开文件工作区或暂存区差异。
   * 入参：文件状态和是否读取暂存区。
   * 出参：Promise<void>。
   * 作用与流程：读取后端受限差异，记录路径供用户从对话框打开原文件。
   */
  const handleFileDiff = async (file: GitFileStatus, stagedDiff: boolean): Promise<void> => {
    try {
      const value = await gitDiff(file.path, stagedDiff);
      setDiffTitle(file.path);
      setDiffValue(value);
      setDiffPath(file.path);
      setDiffOpen(true);
    } catch (cause) {
      showError(cause);
    }
  };

  /**
   * 暂存一组路径。
   * 入参：仓库相对路径列表。
   * 出参：Promise<void>。
   * 作用与流程：调用 store 暂存并显示成功或结构化失败消息。
   */
  const handleStage = async (paths: string[]): Promise<void> => {
    try {
      await stage(paths);
    } catch (cause) {
      showError(cause);
    }
  };

  /**
   * 取消暂存一组路径。
   * 入参：仓库相对路径列表。
   * 出参：Promise<void>。
   * 作用与流程：调用 store 更新 index 并显示结构化失败消息。
   */
  const handleUnstage = async (paths: string[]): Promise<void> => {
    try {
      await unstage(paths);
    } catch (cause) {
      showError(cause);
    }
  };

  /**
   * 提交当前已暂存改动。
   * 入参：无，读取提交输入框。
   * 出参：Promise<void>。
   * 作用与流程：校验未保存标签、说明和暂存数量，确保身份后创建提交并清空输入。
   */
  const handleCommit = async (): Promise<void> => {
    if (!ensureSavedTabs("提交")) return;
    const validation = validateCommit(message, groups.staged.length);
    if (validation) {
      toast.error(validation);
      return;
    }
    if (!identity?.name || !identity.email) {
      setIdentityOpen(true);
      return;
    }
    try {
      await commit(message.trim());
      setMessage("");
      toast.success("提交完成");
    } catch (cause) {
      showError(cause);
    }
  };

  /**
   * 快进拉取当前分支。
   * 入参：无。
   * 出参：Promise<void>。
   * 作用与流程：阻止未保存标签，执行 ff-only pull 后刷新文件树和干净标签页。
   */
  const handlePull = async (): Promise<void> => {
    if (!ensureSavedTabs("拉取")) return;
    try {
      await pull();
      await syncWorkspaceFiles();
      toast.success("拉取完成");
    } catch (cause) {
      showError(cause);
    }
  };

  /**
   * 推送当前分支并在首次推送时设置 upstream。
   * 入参：无。
   * 出参：Promise<void>。
   * 作用与流程：已有 upstream 直接推送；首次推送打开远端和分支选择，无远端时先打开连接表单。
   */
  const handlePush = async (): Promise<void> => {
    if (!repository?.branch) return;
    if (!repository.upstream) {
      if (repository.remotes.length === 0) {
        setRemoteOpen(true);
        return;
      }
      setPushRemote(repository.remotes.includes("origin") ? "origin" : repository.remotes[0]);
      setPushBranch(repository.branch);
      setPushOpen(true);
      return;
    }
    try {
      await push();
      toast.success("推送完成");
    } catch (cause) {
      showError(cause);
    }
  };

  /**
   * 执行首次推送并设置 upstream。
   * 入参：无，读取首次推送对话框中的远端与分支。
   * 出参：Promise<void>。
   * 作用与流程：校验选择后调用 push --set-upstream，成功时关闭对话框并刷新仓库状态。
   */
  const handleInitialPush = async (): Promise<void> => {
    if (!pushRemote || !pushBranch.trim()) {
      toast.error("请选择远端并填写分支");
      return;
    }
    try {
      await push(pushRemote, pushBranch.trim());
      setPushOpen(false);
      toast.success("首次推送完成，已设置 upstream");
    } catch (cause) {
      showError(cause);
    }
  };

  /**
   * 切换已有本地分支。
   * 入参：目标分支名。
   * 出参：Promise<void>。
   * 作用与流程：阻止未保存标签，调用 Git 原生 switch 后同步文件树与标签页。
   */
  const handleSwitchBranch = async (name: string): Promise<void> => {
    if (!ensureSavedTabs("切换分支")) return;
    try {
      await switchBranch(name);
      await syncWorkspaceFiles();
      toast.success(`已切换到 ${name}`);
    } catch (cause) {
      showError(cause);
    }
  };

  /**
   * 创建并切换新分支。
   * 入参：无，读取新分支输入框。
   * 出参：Promise<void>。
   * 作用与流程：阻止未保存标签，后端校验分支名并从当前 HEAD 创建，成功后关闭表单。
   */
  const handleCreateBranch = async (): Promise<void> => {
    if (!newBranchName.trim() || !ensureSavedTabs("创建分支")) return;
    try {
      await createBranch(newBranchName.trim());
      await syncWorkspaceFiles();
      toast.success(`已创建并切换到 ${newBranchName.trim()}`);
      setNewBranchName("");
      setNewBranchOpen(false);
    } catch (cause) {
      showError(cause);
    }
  };

  /**
   * 保存仓库级 Git 用户身份。
   * 入参：无，读取姓名和邮箱输入。
   * 出参：Promise<void>。
   * 作用与流程：仅写当前仓库配置，成功后关闭身份对话框。
   */
  const handleIdentity = async (): Promise<void> => {
    try {
      await setIdentity(identityName, identityEmail);
      setIdentityOpen(false);
      toast.success("当前仓库 Git 身份已保存");
    } catch (cause) {
      showError(cause);
    }
  };

  /**
   * 连接当前仓库的 origin。
   * 入参：无，读取远端 URL 输入。
   * 出参：Promise<void>。
   * 作用与流程：拒绝覆盖已有 origin，添加远端后关闭表单并刷新状态。
   */
  const handleConnectOrigin = async (): Promise<void> => {
    if (!remoteUrl.trim()) return;
    try {
      await connectOrigin(remoteUrl.trim());
      setRemoteOpen(false);
      setRemoteUrl("");
      toast.success("origin 已连接");
    } catch (cause) {
      showError(cause);
    }
  };

  /**
   * 打开指定提交详情。
   * 入参：提交 SHA 和显示主题。
   * 出参：Promise<void>。
   * 作用与流程：读取提交文件及完整 diff，并复用统一差异对话框展示。
   */
  const handleCommitDiff = async (sha: string, subject: string): Promise<void> => {
    try {
      const detail = await gitShowCommit(sha);
      setDiffTitle(`${detail.commit.shortSha} ${subject}`);
      setDiffValue(detail.diff);
      setDiffPath(null);
      setDiffOpen(true);
    } catch (cause) {
      showError(cause);
    }
  };

  if (!availability && loading) {
    return <div className="p-3 text-xs text-muted-foreground">正在检测 Git…</div>;
  }
  if (availability && (!availability.available || !availability.supported)) {
    return (
      <div className="space-y-2 p-3 text-xs">
        <h3 className="font-medium">系统 Git 不可用</h3>
        <p className="text-muted-foreground">
          {availability.available
            ? `当前版本 ${availability.version ?? "未知"}，需要 ${availability.minimumVersion} 或更高版本。`
            : "请先安装 Git，再重新打开 Git 面板。"}
        </p>
        <Button size="sm" variant="outline" onClick={() => void refresh()}>重新检测</Button>
      </div>
    );
  }
  if (!repository) {
    if (shouldShowRepositorySetup(error)) {
      return <RepositorySetup />;
    }
    if (!error) {
      return <RepositorySetup />;
    }
    return (
      <div className="space-y-2 p-3 text-xs">
        <h3 className="font-medium">无法读取 Git 仓库</h3>
        <p className="text-destructive">{error.message}</p>
        {error.details && (
          <pre className="max-h-40 overflow-auto whitespace-pre-wrap rounded border p-2 text-[10px] text-muted-foreground">
            {error.details}
          </pre>
        )}
        <Button size="sm" variant="outline" onClick={() => void refresh()}>
          重试
        </Button>
      </div>
    );
  }

  return (
    <div className="flex h-full flex-col overflow-hidden">
      <div className="border-b p-2">
        <div className="flex items-center gap-1">
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button variant="outline" size="xs" className="min-w-0 flex-1 justify-start">
                <GitBranchIcon className="h-3 w-3" />
                <span className="truncate">{repository.branch ?? "detached HEAD"}</span>
                <ChevronDown className="ml-auto h-3 w-3" />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="start" className="w-64">
              <div className="p-2">
                <Input
                  value={branchQuery}
                  onChange={(event) => setBranchQuery(event.target.value)}
                  onKeyDown={(event) => event.stopPropagation()}
                  placeholder="搜索本地分支"
                  className="h-7 text-xs"
                />
              </div>
              {visibleBranches.map((branch) => (
                <DropdownMenuItem
                  key={branch.name}
                  disabled={branch.current || writing}
                  onClick={() => void handleSwitchBranch(branch.name)}
                >
                  <GitBranchIcon className="mr-2 h-3 w-3" />
                  <span className="truncate">{branch.name}</span>
                  {branch.current && <CircleDot className="ml-auto h-3 w-3" />}
                </DropdownMenuItem>
              ))}
              <DropdownMenuSeparator />
              <DropdownMenuItem onClick={() => setNewBranchOpen(true)}>新建分支…</DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
          <Button variant="ghost" size="icon" className="h-6 w-6" onClick={() => void refresh()} disabled={loading || writing}>
            <RefreshCw className={`h-3 w-3 ${loading ? "animate-spin" : ""}`} />
          </Button>
          <Button variant="ghost" size="icon" className="h-6 w-6" onClick={() => void handlePull()} disabled={writing || !repository.upstream} title="拉取">
            <ArrowDown className="h-3 w-3" />
          </Button>
          <Button variant="ghost" size="icon" className="h-6 w-6" onClick={() => void handlePush()} disabled={writing || !repository.branch} title="推送">
            <ArrowUp className="h-3 w-3" />
          </Button>
        </div>
        <div className="mt-1 truncate text-[10px] text-muted-foreground" title={repository.repositoryRoot}>
          {repository.repositoryRoot}
        </div>
        <div className="mt-1 flex gap-3 text-[10px] text-muted-foreground">
          <span>upstream: {repository.upstream ?? "未设置"}</span>
          <span>↑{repository.ahead} ↓{repository.behind}</span>
        </div>
        {!repository.remotes.includes("origin") && (
          <Button variant="outline" size="xs" className="mt-2 w-full" onClick={() => setRemoteOpen(true)}>
            连接 origin
          </Button>
        )}
        {error && error.code !== "not_repository" && (
          <details className="mt-2 rounded border border-destructive/30 p-1.5 text-[10px] text-destructive">
            <summary>{error.message}</summary>
            {error.details && <pre className="mt-1 whitespace-pre-wrap text-muted-foreground">{error.details}</pre>}
          </details>
        )}
      </div>

      <Tabs value={view} onValueChange={setView} className="flex min-h-0 flex-1 flex-col">
        <TabsList className="m-2 mb-0 grid grid-cols-2">
          <TabsTrigger value="changes">更改 ({repository.files.length})</TabsTrigger>
          <TabsTrigger value="history">提交记录</TabsTrigger>
        </TabsList>
        <TabsContent value="changes" className="mt-2 flex min-h-0 flex-1 flex-col">
          <ScrollArea className="min-h-0 flex-1 border-t">
            {repository.files.length === 0 ? (
              <div className="p-4 text-center text-xs text-muted-foreground">工作区没有 Git 改动</div>
            ) : (
              <>
                <ChangeGroup title="冲突" files={groups.conflicts} mode="stage" disabled={writing} onFile={(file) => void handleFileDiff(file, false)} onAll={(paths) => void handleStage(paths)} onOne={(paths) => void handleStage(paths)} />
                <ChangeGroup title="已暂存" files={groups.staged} mode="unstage" disabled={writing} onFile={(file) => void handleFileDiff(file, true)} onAll={(paths) => void handleUnstage(paths)} onOne={(paths) => void handleUnstage(paths)} />
                <ChangeGroup title="未暂存" files={groups.unstaged} mode="stage" disabled={writing} onFile={(file) => void handleFileDiff(file, false)} onAll={(paths) => void handleStage(paths)} onOne={(paths) => void handleStage(paths)} />
                <ChangeGroup title="未跟踪" files={groups.untracked} mode="stage" disabled={writing} onFile={(file) => void handleFileDiff(file, false)} onAll={(paths) => void handleStage(paths)} onOne={(paths) => void handleStage(paths)} />
              </>
            )}
          </ScrollArea>
          <div className="space-y-2 border-t p-2">
            <textarea
              className="min-h-16 w-full resize-y rounded-md border bg-background px-2 py-1.5 text-xs outline-none focus:ring-1 focus:ring-ring"
              value={message}
              onChange={(event) => setMessage(event.target.value)}
              placeholder="提交说明"
            />
            <Button className="w-full" size="sm" disabled={writing} onClick={() => void handleCommit()}>
              <GitCommitHorizontal className="h-3.5 w-3.5" />
              提交已暂存更改
            </Button>
          </div>
        </TabsContent>
        <TabsContent value="history" className="mt-2 min-h-0 flex-1 overflow-hidden border-t">
          <ScrollArea className="h-full">
            {commits.map((item) => (
              <button key={item.sha} className="flex w-full gap-2 border-b px-2 py-2 text-left hover:bg-accent/60" onClick={() => void handleCommitDiff(item.sha, item.subject)}>
                <GitCommitHorizontal className="mt-0.5 h-3.5 w-3.5 shrink-0 text-primary" />
                <div className="min-w-0 flex-1">
                  <div className="truncate text-xs">{item.subject}</div>
                  <div className="mt-0.5 flex gap-2 text-[10px] text-muted-foreground">
                    <span className="font-mono">{item.shortSha}</span>
                    <span className="truncate">{item.authorName}</span>
                    <span className="ml-auto shrink-0">{new Date(item.authoredAt).toLocaleDateString()}</span>
                  </div>
                </div>
              </button>
            ))}
            {hasMoreCommits && (
              <Button variant="ghost" size="sm" className="w-full" disabled={loading} onClick={() => void loadMoreCommits()}>
                加载更多
              </Button>
            )}
          </ScrollArea>
        </TabsContent>
      </Tabs>

      <GitDiffDialog
        open={diffOpen}
        onOpenChange={setDiffOpen}
        title={diffTitle}
        diff={diffValue}
        onOpenFile={diffPath && !diffValue?.binary ? () => {
          const absolute = absoluteRepositoryPath(repository.repositoryRoot, diffPath);
          void openFile(absolute, diffPath.split(/[\\/]/).pop() ?? diffPath);
          setDiffOpen(false);
        } : undefined}
      />

      <Dialog open={newBranchOpen} onOpenChange={setNewBranchOpen}>
        <DialogContent>
          <DialogHeader><DialogTitle>新建分支</DialogTitle><DialogDescription>从当前 HEAD 创建并立即切换。</DialogDescription></DialogHeader>
          <Input value={newBranchName} onChange={(event) => setNewBranchName(event.target.value)} placeholder="feature/name" />
          <DialogFooter><Button variant="outline" onClick={() => setNewBranchOpen(false)}>取消</Button><Button onClick={() => void handleCreateBranch()} disabled={writing}>创建并切换</Button></DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={identityOpen} onOpenChange={setIdentityOpen}>
        <DialogContent>
          <DialogHeader><DialogTitle>设置当前仓库 Git 身份</DialogTitle><DialogDescription>仅写入当前仓库，不修改全局 Git 配置。</DialogDescription></DialogHeader>
          <div className="space-y-3"><div className="space-y-1"><Label htmlFor="git-user-name">姓名</Label><Input id="git-user-name" value={identityName} onChange={(event) => setIdentityName(event.target.value)} /></div><div className="space-y-1"><Label htmlFor="git-user-email">邮箱</Label><Input id="git-user-email" value={identityEmail} onChange={(event) => setIdentityEmail(event.target.value)} /></div></div>
          <DialogFooter><Button variant="outline" onClick={() => setIdentityOpen(false)}>取消</Button><Button onClick={() => void handleIdentity()} disabled={writing}>保存</Button></DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={remoteOpen} onOpenChange={setRemoteOpen}>
        <DialogContent>
          <DialogHeader><DialogTitle>连接 origin</DialogTitle><DialogDescription>首版不会覆盖已有 origin。</DialogDescription></DialogHeader>
          <Input value={remoteUrl} onChange={(event) => setRemoteUrl(event.target.value)} placeholder="git@github.com:org/repo.git" />
          <DialogFooter><Button variant="outline" onClick={() => setRemoteOpen(false)}>取消</Button><Button onClick={() => void handleConnectOrigin()} disabled={writing}>连接</Button></DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={pushOpen} onOpenChange={setPushOpen}>
        <DialogContent>
          <DialogHeader><DialogTitle>首次推送</DialogTitle><DialogDescription>选择远端和要推送的本地分支，成功后会设置 upstream。</DialogDescription></DialogHeader>
          <div className="space-y-3">
            <div className="space-y-1">
              <Label htmlFor="git-push-remote">远端</Label>
              <Select value={pushRemote} onValueChange={setPushRemote}>
                <SelectTrigger id="git-push-remote"><SelectValue placeholder="选择远端" /></SelectTrigger>
                <SelectContent>
                  {repository.remotes.map((remote) => <SelectItem key={remote} value={remote}>{remote}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1">
              <Label htmlFor="git-push-branch">分支</Label>
              <Input id="git-push-branch" value={pushBranch} onChange={(event) => setPushBranch(event.target.value)} />
            </div>
          </div>
          <DialogFooter><Button variant="outline" onClick={() => setPushOpen(false)}>取消</Button><Button onClick={() => void handleInitialPush()} disabled={writing}>推送并设置 upstream</Button></DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
