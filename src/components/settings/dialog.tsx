import { useThemeStore, type Theme } from "@/stores/theme";
import { useFontStore } from "@/stores/font";
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

const uiPreviewLines = [
  "AaBbCc 中文 0123456789",
  "The quick brown fox jumps over the lazy dog",
  "— 项目名称 / 文件名 / 按钮标签",
];

const editorPreviewLines = [
  "GET https://api.example.com/v1/users/123 HTTP/1.1",
  "Accept: application/json",
  "Authorization: Bearer eyJhbGciOiJIUzI1NiJ9.xxxx.yyyy",
  "",
  "###",
  "",
  "HTTP/1.1 200 OK",
  "Content-Type: application/json; charset=utf-8",
  "X-Request-Id: 5b8e9a3c-7f12-4d2e-a8c1-9e3f4b7a2d6e",
  "",
  "{",
  '  "id": 123,',
  '  "name": "John Doe",',
  '  "email": "john@example.com",',
  '  "active": true,',
  '  "score": 98.5',
  "}",
];

const DEFAULT_VALUE = "__default__";

interface FontSelectorProps {
  label: string;
  value: string | null;
  fonts: string[];
  onChange: (font: string | null) => void;
  previewLines: string[];
}

function FontSelector({
  label,
  value,
  fonts,
  onChange,
  previewLines,
}: FontSelectorProps) {
  const isLoading = fonts.length === 0;
  return (
    <div className="flex flex-col gap-2">
      <Label className="text-sm">{label}</Label>
      <Select
        value={value ?? DEFAULT_VALUE}
        onValueChange={(v) => onChange(v === DEFAULT_VALUE ? null : v)}
        disabled={isLoading}
      >
        <SelectTrigger>
          <SelectValue placeholder={isLoading ? "加载中…" : "选择字体"} />
        </SelectTrigger>
        <SelectContent
          position="popper"
          side="bottom"
          align="start"
          style={{ width: "var(--radix-select-trigger-width)", maxHeight: "300px" }}
        >
          <SelectItem value={DEFAULT_VALUE}>默认</SelectItem>
          {fonts.map((font) => (
            <SelectItem key={font} value={font}>
              <span style={{ fontFamily: `"${font}", sans-serif` }}>{font}</span>
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
      <pre
        className="rounded-md border bg-muted/30 px-3 py-2 text-xs whitespace-pre-wrap break-all max-h-40 overflow-auto"
        style={{ fontFamily: value ? `"${value}"` : undefined }}
      >
        {previewLines.map((line, i) => (
          <span key={i} className="block">
            {line || "\u00A0"}
          </span>
        ))}
      </pre>
    </div>
  );
}

export function SettingsDialog({ open, onOpenChange }: SettingsDialogProps) {
  const theme = useThemeStore((s) => s.theme);
  const setTheme = useThemeStore((s) => s.setTheme);

  const editorFontFamily = useFontStore((s) => s.editorFontFamily);
  const setEditorFontFamily = useFontStore((s) => s.setEditorFontFamily);
  const uiFontFamily = useFontStore((s) => s.uiFontFamily);
  const setUiFontFamily = useFontStore((s) => s.setUiFontFamily);
  const systemFonts = useFontStore((s) => s.systemFonts);

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

              <FontSelector
                label="界面字体"
                value={uiFontFamily}
                fonts={systemFonts}
                onChange={setUiFontFamily}
                previewLines={uiPreviewLines}
              />
            </TabsContent>

            <TabsContent value="editor" className="mt-0 space-y-4">
              <FontSelector
                label="编辑器字体"
                value={editorFontFamily}
                fonts={systemFonts}
                onChange={setEditorFontFamily}
                previewLines={editorPreviewLines}
              />
            </TabsContent>
          </div>
        </Tabs>
      </DialogContent>
    </Dialog>
  );
}