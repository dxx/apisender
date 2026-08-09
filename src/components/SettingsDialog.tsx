import { useThemeStore, type Theme } from "@/stores/theme";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Label } from "@/components/ui/label";
import {
  Tabs,
  TabsList,
  TabsTrigger,
  TabsContent,
} from "@/components/ui/tabs";

interface SettingsDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

const themeOptions: { value: Theme; label: string }[] = [
  { value: "system", label: "跟随系统" },
  { value: "light", label: "浅色" },
  { value: "dark", label: "深色" },
];

const sections = [
  { value: "appearance", label: "外观" },
  { value: "editor", label: "编辑器" },
];

export function SettingsDialog({ open, onOpenChange }: SettingsDialogProps) {
  const theme = useThemeStore((s) => s.theme);
  const setTheme = useThemeStore((s) => s.setTheme);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="w-[60vw] h-[60vh] max-w-5xl gap-0 p-0 overflow-hidden flex flex-col">
        <DialogHeader className="pl-4 pt-3 pb-3 pr-14 border-b">
          <DialogTitle>设置</DialogTitle>
        </DialogHeader>

        <Tabs
          defaultValue="appearance"
          orientation="vertical"
          className="flex flex-1 min-h-0"
        >
          <TabsList className="flex flex-col items-stretch justify-start h-auto w-48 shrink-0 border-r bg-muted/20 pt-4 px-2 pb-2 gap-1 rounded-none">
            {sections.map((s) => (
              <TabsTrigger
                key={s.value}
                value={s.value}
                className="w-full justify-start px-3 py-1.5 hover:text-foreground data-[state=active]:bg-primary data-[state=active]:text-primary-foreground data-[state=active]:shadow-none"
              >
                {s.label}
              </TabsTrigger>
            ))}
          </TabsList>

          <div className="flex-1 overflow-auto p-6">
            <TabsContent value="appearance" className="mt-0 space-y-4">
              <div className="flex flex-col gap-2">
                <Label className="text-sm">主题</Label>
                <Select
                  value={theme}
                  onValueChange={(v) => setTheme(v as Theme)}
                >
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent
                    position="popper"
                    side="bottom"
                    align="start"
                    style={{ width: "var(--radix-select-trigger-width)" }}
                  >
                    {themeOptions.map((opt) => (
                      <SelectItem key={opt.value} value={opt.value}>
                        {opt.label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            </TabsContent>

            <TabsContent value="editor" className="mt-0">
              <p className="text-sm text-muted-foreground">暂无设置</p>
            </TabsContent>
          </div>
        </Tabs>
      </DialogContent>
    </Dialog>
  );
}