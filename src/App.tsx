import { useEffect, useState } from "react";
import { listen } from "@tauri-apps/api/event";
import { Group, Panel, Separator } from "react-resizable-panels";

import { useWorkspaceStore } from "@/stores/workspace";
import { useEnvironmentStore } from "@/stores/environment";
import { useHistoryStore } from "@/stores/history";
import { useTabsStore } from "@/stores/tabs";
import { useThemeStore } from "@/stores/theme";
import { useFontStore } from "@/stores/font";
import { useGitStore } from "@/stores/git";
import { useSystemThemeListener } from "@/hooks/useSystemTheme";
import type { WorkspaceChangedEvent } from "@/lib/types";

import { Welcome } from "@/components/Welcome";
import { Sidebar } from "@/components/layout/Sidebar";
import { MainPane } from "@/components/layout/MainPane";
import { TitleBar } from "@/components/layout/TitleBar";
import { SettingsDialog } from "@/components/settings/dialog";
import { Toaster } from "@/components/ui/sonner";
import { TooltipProvider } from "@/components/ui/tooltip";
import { TITLE_BAR_HEIGHT } from "@/lib/platform";

/**
 * 渲染并协调 apisender 根应用。
 * 入参：无。
 * 出参：欢迎页或已打开工作区的完整应用界面。
 * 作用与流程：初始化各 store，监听普通工作区与 Git 管理目录变化，并协调文件树、环境、标签页和 Git 状态刷新。
 */
function App() {
  const root = useWorkspaceStore((s) => s.root);
  const isInitialized = useWorkspaceStore((s) => s.isInitialized);
  const initWorkspace = useWorkspaceStore((s) => s.init);
  const refreshTree = useWorkspaceStore((s) => s.refreshTree);
  const openWorkspaceDialog = useWorkspaceStore((s) => s.openDialog);
  const initEnv = useEnvironmentStore((s) => s.init);
  const refreshEnv = useEnvironmentStore((s) => s.refresh);
  const refreshHistory = useHistoryStore((s) => s.refresh);
  const tabs = useTabsStore((s) => s.tabs);
  const reloadTab = useTabsStore((s) => s.reloadFromDisk);
  const initTheme = useThemeStore((s) => s.init);
  const initFont = useFontStore((s) => s.init);
  const refreshGit = useGitStore((s) => s.refresh);
  const clearGit = useGitStore((s) => s.clear);
  const [settingsOpen, setSettingsOpen] = useState(false);

  useSystemThemeListener();

  useEffect(() => {
    initTheme();
    initWorkspace();
    initEnv();
    initFont();
  }, [initTheme, initWorkspace, initEnv, initFont]);

  useEffect(() => {
    if (root) {
      refreshHistory();
      refreshEnv();
      refreshGit();
    } else {
      clearGit();
    }
  }, [root, refreshHistory, refreshEnv, refreshGit, clearGit]);

  useEffect(() => {
    const unlisten = listen<WorkspaceChangedEvent>(
      "workspace-changed",
      (event) => {
        const { paths } = event.payload;
        refreshTree();
        const envChanged = paths.some(
          (p) => p.endsWith("env.json") || p.endsWith("env.private.json")
        );
        if (envChanged) {
          refreshEnv();
        }
        for (const p of paths) {
          const tab = tabs.find((t) => t.path === p);
          if (tab && !tab.isDirty) {
            reloadTab(p);
          }
        }
      }
    );
    return () => {
      unlisten.then((fn) => fn());
    };
  }, [refreshTree, refreshEnv, tabs, reloadTab]);

  useEffect(() => {
    let timer: ReturnType<typeof setTimeout> | null = null;
    const unlisten = listen<WorkspaceChangedEvent>("git-changed", () => {
      if (timer) clearTimeout(timer);
      timer = setTimeout(() => {
        void refreshGit();
      }, 250);
    });
    return () => {
      if (timer) clearTimeout(timer);
      unlisten.then((fn) => fn());
    };
  }, [refreshGit]);

  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && (e.key === "o" || e.key === "O")) {
        e.preventDefault();
        openWorkspaceDialog();
      }
      if ((e.ctrlKey || e.metaKey) && e.key === ",") {
        e.preventDefault();
        setSettingsOpen(true);
      }
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [openWorkspaceDialog]);

  if (!isInitialized) {
    return (
      <>
        <Toaster />
        <TitleBar />
        <div
          className="flex h-screen w-screen overflow-hidden bg-background text-foreground"
          style={{ paddingTop: TITLE_BAR_HEIGHT }}
        />
      </>
    );
  }

  if (!root) {
    return (
      <>
        <Toaster />
        <TitleBar />
        <div
          className="flex h-screen w-screen overflow-hidden bg-background text-foreground"
          style={{ paddingTop: TITLE_BAR_HEIGHT }}
        >
          <Welcome />
        </div>
      </>
    );
  }

  return (
    <>
      <Toaster />
      <TooltipProvider delayDuration={700}>
        <TitleBar />
        <div
          className="flex h-screen w-screen overflow-hidden bg-background text-foreground"
          style={{ paddingTop: TITLE_BAR_HEIGHT }}
        >
          <Group id="sidebar-main" orientation="horizontal" className="flex-1 overflow-hidden">
            <Panel id="sidebar" defaultSize="18%" minSize="15%" maxSize="60%">
              <Sidebar onSettingsClick={() => setSettingsOpen(true)} />
            </Panel>
            <Separator className="relative z-[2] -ml-1 w-1 cursor-col-resize bg-transparent transition-colors hover:bg-primary/50 data-[resize-handle-state=drag]:bg-primary" />
            <Panel id="main" minSize="40%">
              <MainPane />
            </Panel>
          </Group>
        </div>
      <SettingsDialog open={settingsOpen} onOpenChange={setSettingsOpen} />
    </TooltipProvider>
    </>
  );
}

export default App;
