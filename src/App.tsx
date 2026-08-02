import { useEffect, useState } from "react";
import { listen } from "@tauri-apps/api/event";
import { Group, Panel, Separator } from "react-resizable-panels";

import { useWorkspaceStore } from "@/stores/workspace";
import { useEnvironmentStore } from "@/stores/environment";
import { useHistoryStore } from "@/stores/history";
import { useTabsStore } from "@/stores/tabs";
import { useThemeStore } from "@/stores/theme";
import type { WorkspaceChangedEvent } from "@/lib/types";

import { WelcomeScreen } from "@/components/WelcomeScreen";
import { Sidebar } from "@/components/layout/Sidebar";
import { MainPane } from "@/components/layout/MainPane";
import { TitleBar } from "@/components/layout/TitleBar";
import { SettingsDialog } from "@/components/SettingsDialog";
import { Toaster } from "@/components/ui/sonner";
import { TooltipProvider } from "@/components/ui/tooltip";
import { TITLE_BAR_HEIGHT } from "@/lib/platform";

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
  const [settingsOpen, setSettingsOpen] = useState(false);

  useEffect(() => {
    initTheme();
    initWorkspace();
    initEnv();
  }, [initTheme, initWorkspace, initEnv]);

  useEffect(() => {
    if (root) {
      refreshHistory();
      refreshEnv();
    }
  }, [root, refreshHistory, refreshEnv]);

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
        <div
          className="flex h-screen w-screen overflow-hidden bg-background text-foreground"
          style={{ paddingTop: TITLE_BAR_HEIGHT }}
        />
        <TitleBar />
      </>
    );
  }

  if (!root) {
    return (
      <>
        <div
          className="flex h-screen w-screen overflow-hidden bg-background text-foreground"
          style={{ paddingTop: TITLE_BAR_HEIGHT }}
        >
          <WelcomeScreen />
        </div>
        <TitleBar />
      </>
    );
  }

  return (
    <>
      <Toaster />
      <TooltipProvider delayDuration={700}>
        <div
          className="flex h-screen w-screen overflow-hidden bg-background text-foreground"
          style={{ paddingTop: TITLE_BAR_HEIGHT }}
        >
          <Group id="sidebar-main" orientation="horizontal" className="flex-1 overflow-hidden">
            <Panel id="sidebar" defaultSize="18%" minSize="12%" maxSize="32%">
              <Sidebar onSettingsClick={() => setSettingsOpen(true)} />
            </Panel>
            <Separator className="w-px cursor-col-resize bg-transparent transition-colors hover:bg-primary/50 data-[resize-handle-state=drag]:bg-primary" />
            <Panel id="main" minSize="40%">
              <MainPane />
            </Panel>
          </Group>
        </div>
<TitleBar />
      <SettingsDialog open={settingsOpen} onOpenChange={setSettingsOpen} />
    </TooltipProvider>
    </>
  );
}

export default App;
