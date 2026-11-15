import { useEffect, useRef, useState, type ReactNode } from "react";
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
import { Slider } from "@/components/ui/slider";
import { Button } from "@/components/ui/button";
import { UpdatePanel } from "@/components/settings/UpdatePanel";

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
  { value: "updates", label: "更新" },
];

const uiPreviewLines = [
  "AaBbCc 中文 0123456789",
  "The quick brown fox jumps over the lazy dog",
  "— 项目名称 / 文件名 / 按钮标签",
];

const editorPreviewLines = [
  "POST https://api.example.com/v1/users HTTP/1.1",
  "Content-Type: application/json",
  "Accept: application/json",
  "Authorization: Bearer eyJhbGciOiJIUzI1NiJ9.xxxx.yyyy",
  "",
  "{",
  '  "name": "John Doe",',
  '  "email": "john@example.com",',
  '  "age": 30,',
  '  "role": "admin",',
  '  "tags": ["alpha", "beta"],',
  '  "active": true',
  "}",
];

const responsePreviewLines = [
  "HTTP/1.1 200 OK",
  "Content-Type: application/json; charset=utf-8",
  "Date: Wed, 21 Aug 2024 07:28:00 GMT",
  "Server: nginx/1.27.1",
  "X-Request-Id: 5b8e9a3c-7f12-4d2e-a8c1-9e3f4b7a2d6e",
  "",
  "{",
  '  "users": [',
  '    { "id": 1, "name": "Alice",   "role": "admin" },',
  '    { "id": 2, "name": "Bob",     "role": "user"  },',
  '    { "id": 3, "name": "Charlie", "role": "user"  }',
  "  ],",
  '  "total": 3,',
  '  "page": 1,',
  '  "perPage": 20',
  "}",
];

const DEFAULT_VALUE = "__default__";

interface FontSelectorProps {
  label: string;
  value: string | null;
  fonts: string[];
  onChange: (font: string | null) => void;
  previewLines: string[];
  previewSize?: number;
  aside?: ReactNode;
}

function FontSelector({
  label,
  value,
  fonts,
  onChange,
  previewLines,
  previewSize,
  aside,
}: FontSelectorProps) {
  const isLoading = fonts.length === 0;
  const selectEl = (
    <Select
      value={value ?? DEFAULT_VALUE}
      onValueChange={(v) => onChange(v === DEFAULT_VALUE ? null : v)}
      disabled={isLoading}
    >
      <SelectTrigger className="w-full">
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
  );

  return (
    <div className="flex flex-col gap-2">
      {aside ? (
        <div className="grid grid-cols-[1fr_auto] items-stretch gap-4">
          <div className="flex min-w-0 flex-col gap-2">
            <Label className="text-sm">{label}</Label>
            {selectEl}
          </div>
          {aside}
        </div>
      ) : (
        <>
          <Label className="text-sm">{label}</Label>
          {selectEl}
        </>
      )}
      <pre
        className="rounded-md border bg-[var(--editor-bg)] px-3 py-2 text-xs whitespace-pre-wrap break-all max-h-40 overflow-auto"
        style={{
          fontFamily: value ? `"${value}"` : undefined,
          fontSize: previewSize !== undefined ? `${previewSize}px` : undefined,
        }}
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

interface FontSizeSelectorProps {
  label: string;
  value: number | null;
  onChange: (size: number | null) => void;
  min: number;
  max: number;
  defaultValue: number;
  cssVar: string;
}

function FontSizeSelector({
  label,
  value,
  onChange,
  min,
  max,
  defaultValue,
  cssVar,
}: FontSizeSelectorProps) {
  const initial = value ?? defaultValue;
  const [draft, setDraft] = useState(initial);
  const debounceRef = useRef<number | null>(null);
  const lastCommittedRef = useRef<number | null>(null);
  const isDefault = value === null;

  useEffect(() => {
    setDraft(initial);
  }, [initial]);

  useEffect(() => {
    return () => {
      if (debounceRef.current) clearTimeout(debounceRef.current);
    };
  }, []);

  return (
    <div className="flex h-full w-[200px] flex-col gap-2">
      <div className="flex items-center justify-between">
        <Label className="text-sm">{label}</Label>
        <div className="flex items-center gap-2">
          <span className="tabular-nums text-xs text-muted-foreground">{draft}px</span>
          <Button
            variant="ghost"
            size="sm"
            className="h-5 px-1.5 text-xs"
            disabled={isDefault}
            onClick={() => {
              if (debounceRef.current) clearTimeout(debounceRef.current);
              lastCommittedRef.current = null;
              onChange(null);
            }}
          >
            默认
          </Button>
        </div>
      </div>
      <div className="flex flex-1 items-center">
        <Slider
          className="w-full"
          value={[draft]}
          min={min}
          max={max}
          step={1}
          onValueChange={(v) => {
            const s = v[0];
            setDraft(s);
            document.documentElement.style.setProperty(cssVar, `${s}px`);
            if (debounceRef.current) clearTimeout(debounceRef.current);
            debounceRef.current = window.setTimeout(() => {
              if (lastCommittedRef.current !== s) {
                lastCommittedRef.current = s;
                onChange(s);
              }
            }, 250);
          }}
          onValueCommit={(v) => {
            const s = v[0];
            if (debounceRef.current) clearTimeout(debounceRef.current);
            if (lastCommittedRef.current !== s) {
              lastCommittedRef.current = s;
              onChange(s);
            }
          }}
        />
      </div>
    </div>
  );
}

/**
 * 入参：打开状态和状态变更回调。
 * 出参：设置弹窗 React 节点。
 * 作用与流程：按垂直标签页组织外观、编辑器和更新设置，并把延迟安装动作映射为关闭弹窗。
 */
export function SettingsDialog({ open, onOpenChange }: SettingsDialogProps) {
  const theme = useThemeStore((s) => s.theme);
  const setTheme = useThemeStore((s) => s.setTheme);

  const editorFontFamily = useFontStore((s) => s.editorFontFamily);
  const setEditorFontFamily = useFontStore((s) => s.setEditorFontFamily);
  const uiFontFamily = useFontStore((s) => s.uiFontFamily);
  const setUiFontFamily = useFontStore((s) => s.setUiFontFamily);
  const responseFontFamily = useFontStore((s) => s.responseFontFamily);
  const setResponseFontFamily = useFontStore((s) => s.setResponseFontFamily);
  const editorFontSize = useFontStore((s) => s.editorFontSize);
  const setEditorFontSize = useFontStore((s) => s.setEditorFontSize);
  const responseFontSize = useFontStore((s) => s.responseFontSize);
  const setResponseFontSize = useFontStore((s) => s.setResponseFontSize);
  const systemFonts = useFontStore((s) => s.systemFonts);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
        <DialogContent className="w-[70vw] h-[75vh] max-w-6xl gap-0 p-0 overflow-hidden flex flex-col">
        <DialogHeader className="pl-4 pt-3 pb-3 pr-14 border-b">
          <DialogTitle>设置</DialogTitle>
        </DialogHeader>

        <Tabs
          defaultValue="appearance"
          orientation="vertical"
          className="flex flex-1 min-h-0"
        >
          <TabsList className="flex flex-col items-stretch justify-start h-auto w-40 shrink-0 border-r bg-muted/20 pt-4 px-2 pb-2 gap-1 rounded-none">
            {sections.map((s) => (
              <TabsTrigger
                key={s.value}
                value={s.value}
                className="w-full justify-start px-3 py-1.5 rounded-md hover:text-foreground data-[state=active]:bg-primary data-[state=active]:text-primary-foreground data-[state=active]:shadow-none"
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
                previewSize={editorFontSize ?? 16}
                aside={
                  <FontSizeSelector
                    label="编辑器字号"
                    value={editorFontSize}
                    onChange={setEditorFontSize}
                    min={10}
                    max={32}
                    defaultValue={16}
                    cssVar="--text-editor-size-custom"
                  />
                }
              />
              <FontSelector
                label="响应内容字体"
                value={responseFontFamily}
                fonts={systemFonts}
                onChange={setResponseFontFamily}
                previewLines={responsePreviewLines}
                previewSize={responseFontSize ?? 14}
                aside={
                  <FontSizeSelector
                    label="响应内容字号"
                    value={responseFontSize}
                    onChange={setResponseFontSize}
                    min={10}
                    max={32}
                    defaultValue={14}
                    cssVar="--text-response-size-custom"
                  />
                }
              />
            </TabsContent>

            <TabsContent value="updates" className="mt-0 space-y-4">
              <UpdatePanel onDelayInstall={() => onOpenChange(false)} />
            </TabsContent>
          </div>
        </Tabs>
      </DialogContent>
    </Dialog>
  );
}
