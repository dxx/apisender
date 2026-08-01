# AGENTS.md

## 项目
Tauri 2 桌面应用 `apisender` —— HTTP 请求客户端（类似 IntelliJ HTTP Client / VSCode REST Client）。

- **前端**: React 19 + TypeScript 5.8 + Vite 7，Tailwind CSS 4
- **后端**: Rust（Tauri 2，crate 名 `apisender_lib`）
- **状态**: Zustand（前端）/ `Mutex<T>` + `app.manage`（后端）
- **UI**: shadcn/ui（new-york 风格，lucide 图标，路径别名 `@/`）
- **编辑器**: CodeMirror 6（`HttpEditor.tsx`）
- **通知**: Sonner（`<Toaster />` 已在 `App.tsx` 注册）

## 关键命令

```bash
# 纯前端
pnpm dev                          # Vite dev server (:1420, strict)
pnpm build                        # tsc && vite build
pnpm exec tsc --noEmit            # 仅类型检查

# 完整 Tauri 应用
pnpm tauri dev                    # 自动跑 beforeDevCommand="pnpm dev"
pnpm tauri build                  # 自动跑 beforeBuildCommand="pnpm build"

# Rust 端
cd src-tauri
cargo test                        # 12 个单元测试：parser 5 + sse 7
cargo build                       # 编译 Rust
```

## 命名约定（项目特有）

| 类别 | 风格 | 示例 |
|---|---|---|
| shadcn UI 组件 | kebab-case | `button.tsx`, `dropdown-menu.tsx` |
| 业务 React 组件 | PascalCase | `HttpEditor.tsx`, `FileTree.tsx` |
| 工具/类型 .ts | 自由 | `tauri.ts`, `method-colors.ts` |
| 目录 | 全小写 | `editor/`, `ui/`, `lib/` |

不要手动重命名 shadcn 组件文件（kebab-case 是 CLI 规范）。

## 关键架构约定

### 后端 → 前端事件
- `workspace-changed` 事件 → `App.tsx:37-60` 监听，自动刷新文件树/env/已打开 tab
- 监听器用 `app.state::<T>()` 拿 `Mutex<T>` 全局状态（`WorkspaceState`, `WatcherState`, `Db`）

### Tauri 2 webview 限制
**禁用 `window.alert` / `window.confirm` / `window.prompt`** —— 直接调用会"没反应"。
替代：
- 确认弹窗 → shadcn `AlertDialog`（已有 `src/components/ui/alert-dialog.tsx`）
- 输入框 → shadcn `Dialog` + `Input`
- 错误提示 → `toast.error()` from `sonner`
- 成功提示 → `toast.success()`

### 日志
- 使用 `tauri-plugin-log`（已在 `lib.rs:21-33` 配置）
- 时区: `TimezoneStrategy::UseLocal`（系统本地时间）
- 输出: Stdout + Webview + `apisender.log` 文件
- **永远用 `log::{info,debug,warn,error}!`，不要 `eprintln!`**

### Rust 模块引用规范
- **非必要不允许内联 `crate::a::b::c` 方式调用**，必须先在文件顶部 `use` 引入再使用
- 模块路径**最多三层**，例如 `aa::bb::cc`；超过三层的需在 `use` 处别名或重新组织
- 示例：
  ```rust
  // 好
  use crate::error::AppResult;
  use crate::clipboard::copy_dir;

  // 坏（内联长路径）
  fn foo() -> crate::error::AppResult<()> { ... }
  ```

## 添加新 UI 组件

```bash
npx shadcn@latest add <component>
# 安装后立刻跑：
pnpm exec tsc --noEmit
# 把生成的 React.ElementRef 替换成 React.ComponentRef（React 19）
```

## 添加新 Tauri 命令

1. 在 `src-tauri/src/commands/<area>.rs` 加 `#[tauri::command]`
2. 在 `src-tauri/src/lib.rs:41-67` 的 `invoke_handler` 数组里注册
3. 在 `src/lib/tauri.ts` 加 TS 包装（保持 IPC 单点）
4. 在 `src-tauri/capabilities/default.json` 确认权限（默认无需改）

## 测试

- **Rust**: `cd src-tauri && cargo test`（12 个测试：parser 5 + sse 7）
- **前端**: 无测试框架，暂无
- **类型检查**: `pnpm exec tsc --noEmit`（strict + noUnusedLocals + noUnusedParameters）
- **构建验证**: `pnpm build`（含 tsc + vite）

## 已知坑

1. **shadcn CLI 生成的代码可能用旧 React 类型** → 替换 `React.ElementRef` 为 `React.ComponentRef`
2. **Tauri 2 移除 DevTools 默认开启** → 需要时手动加 `"devtools": true` 到 `tauri.conf.json` windows 配置
3. **CodeMirror gutter marker 单例** → 每次 `new RunGutterMarker()`，避免 RangeSet 去重

## 环境

- 包管理：**pnpm**（不要混用 npm/yarn）
- Rust edition: 2024
- Tauri dev port: 1420（strict）
- 文件监听: `notify` crate，macOS 用 FSEvents，Linux 用 inotify