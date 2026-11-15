# Git 刷新与初始化布局修复实施计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 阻断 Git 状态读取触发的文件监听刷新循环，并让无仓库初始化向导在窄侧栏和自定义字体下完整显示。

**Architecture:** Rust Git 命令执行器显式区分只读与写入访问；只读访问设置 `GIT_OPTIONAL_LOCKS=0`，写入访问保留 Git 默认锁语义。前端把初始化向导的占位文案和忽略规则定义为可测试数据，组件使用宽度约束和自动换行标签渲染。

**Tech Stack:** Rust 2024、系统 Git 2.28+、Tauri 2、React 19、TypeScript 5.8、Tailwind CSS 4、Vite 7。

## Global Constraints

- 所有 Git 命令继续通过参数数组启动，禁止 shell 拼接。
- 只读命令设置 `GIT_OPTIONAL_LOCKS=0`；写命令不得改变 Git 默认锁策略。
- 不过滤全部 `.git` 事件，真实 Git 和工作区变化仍需自动刷新。
- 不缩小或覆盖用户配置的全局 UI 字体。
- 所有新增或修改的方法添加中文注释，说明入参、出参、作用和处理流程。
- Commit message 必须使用中文。
- 不默认执行桌面应用 UI 冒烟测试。

---

### Task 1: 只读 Git 命令禁用 optional locks

**Files:**
- Modify: `src-tauri/src/git.rs`
- Test: `src-tauri/tests/git.rs`

**Interfaces:**
- Consumes: 现有 `execute_git(cwd, args, allow_exit_one)`、`run_git`、`run_git_diff_output` 和公开 `status(workspace_root)`。
- Produces: 私有枚举 `GitCommandAccess::{ReadOnly, Write}`、私有方法 `run_git_read(cwd, args, allow_exit_one)`；公开 Git 服务接口不变。

- [ ] **Step 1: 写入会失败的目录修改时间回归测试**

在 `src-tauri/tests/git.rs` 的标准库 import 中加入：

```rust
use std::thread;
use std::time::Duration;
```

在文件末尾加入：

```rust
#[test]
/// 校验 Git 状态读取不会触碰管理目录。
/// 入参/出参：无；断言读取状态前后的 `.git` 目录修改时间一致。
/// 作用与流程：创建含提交的临时仓库，跨过低精度文件时间窗口后调用服务层 status，防止 optional lock 再次触发 watcher。
fn status_read_does_not_touch_git_directory() {
    let root = temp_dir("status-no-optional-lock");
    run_git(&root, &["init", "-b", "main"]);
    set_identity(&root, "Test", "test@example.com").unwrap();
    fs::write(root.join("request.http"), "GET https://example.com\n").unwrap();
    stage(&root, &["request.http".to_string()]).unwrap();
    apisender_lib::git::commit(&root, "初始化测试仓库").unwrap();

    let git_dir = root.join(".git");
    thread::sleep(Duration::from_millis(1_100));
    let before = fs::metadata(&git_dir).unwrap().modified().unwrap();
    status(&root).unwrap();
    let after = fs::metadata(&git_dir).unwrap().modified().unwrap();

    assert_eq!(before, after, "只读状态查询不应创建 optional lock");
}
```

- [ ] **Step 2: 运行测试确认旧实现失败**

Run:

```bash
cd src-tauri
cargo test --test git status_read_does_not_touch_git_directory -- --exact
```

Expected: FAIL，`before` 与 `after` 不相等，证明 `git status` 修改了 `.git` 目录时间。

- [ ] **Step 3: 在命令执行器中区分只读与写入访问**

在 `src-tauri/src/git.rs` 的命令执行函数前加入：

```rust
#[derive(Clone, Copy)]
enum GitCommandAccess {
    ReadOnly,
    Write,
}
```

把 `execute_git` 改为接收 `access: GitCommandAccess`，并在启动命令前按访问类型设置环境变量：

```rust
/// 执行系统 Git 命令并验证退出状态。
/// 入参：工作目录、参数列表、是否允许退出码 1 和命令访问类型。
/// 出参：完整进程输出。
/// 作用与流程：只读命令禁用 optional locks；所有命令均禁用终端提示并把失败转换为脱敏结构化错误。
fn execute_git(
    cwd: &Path,
    args: &[OsString],
    allow_exit_one: bool,
    access: GitCommandAccess,
) -> GitResult<Output> {
    ensure_git_available()?;
    let mut command = Command::new("git");
    command
        .current_dir(cwd)
        .env("GIT_TERMINAL_PROMPT", "0")
        .env("LC_ALL", "C")
        .env("LANG", "C")
        .args(args);
    if matches!(access, GitCommandAccess::ReadOnly) {
        command.env("GIT_OPTIONAL_LOCKS", "0");
    }
    let output = command
        .output()
        .map_err(|cause| error(GitErrorCode::Io, "无法启动 Git", Some(cause.to_string())))?;

    if output.status.success() || (allow_exit_one && output.status.code() == Some(1)) {
        return Ok(output);
    }

    let stderr = redact_secrets(&String::from_utf8_lossy(&output.stderr));
    Err(error(
        classify_command_error(&stderr),
        "Git 操作失败",
        Some(stderr.trim().to_string()),
    ))
}
```

让现有普通写入路径显式使用 `Write`，并新增受 10 MiB 限制的只读路径：

```rust
/// 执行受 10 MiB 限制的普通 Git 写命令。
/// 入参：工作目录、参数列表和是否允许退出码 1。
/// 出参：不超过普通命令上限的完整进程输出。
/// 作用与流程：保留 Git 默认锁语义，复用统一错误分类后限制输出大小。
fn run_git(cwd: &Path, args: &[OsString], allow_exit_one: bool) -> GitResult<Output> {
    let output = execute_git(cwd, args, allow_exit_one, GitCommandAccess::Write)?;
    validate_default_output_size(output)
}

/// 执行受 10 MiB 限制的只读 Git 命令。
/// 入参：工作目录、参数列表和是否允许退出码 1。
/// 出参：不超过普通命令上限的完整进程输出。
/// 作用与流程：禁用 optional locks 后执行查询，再复用普通输出大小限制。
fn run_git_read(cwd: &Path, args: &[OsString], allow_exit_one: bool) -> GitResult<Output> {
    let output = execute_git(cwd, args, allow_exit_one, GitCommandAccess::ReadOnly)?;
    validate_default_output_size(output)
}

/// 校验普通 Git 命令输出大小。
/// 入参：Git 完整进程输出。
/// 出参：未超过 10 MiB 时返回原输出，否则返回 output_too_large。
/// 作用与流程：集中计算 stdout 与 stderr 总长度，供只读和写入命令复用。
fn validate_default_output_size(output: Output) -> GitResult<Output> {
    if output.stdout.len().saturating_add(output.stderr.len()) > DEFAULT_OUTPUT_LIMIT {
        return Err(error(
            GitErrorCode::OutputTooLarge,
            "Git 命令输出超过 10 MiB 限制",
            None,
        ));
    }
    Ok(output)
}
```

把 `run_git_diff_output` 改为：

```rust
fn run_git_diff_output(cwd: &Path, args: &[OsString], allow_exit_one: bool) -> GitResult<Output> {
    execute_git(cwd, args, allow_exit_one, GitCommandAccess::ReadOnly)
}
```

- [ ] **Step 4: 将所有查询调用切换到只读路径**

在 `probe` 直接执行 `git --version` 时同样设置 `.env("GIT_OPTIONAL_LOCKS", "0")`；该命令不经过 `execute_git`，但仍显式遵循只读命令约定。

在以下位置把 `run_git(...)` 替换为 `run_git_read(...)`，参数保持原样：

- `resolve_repository_root` 的 `rev-parse --show-toplevel`
- `resolve_git_dir` 的 `rev-parse --absolute-git-dir`
- `status` 的 `status --porcelain=v2` 和 `remote`
- `unstage` 的 `rev-parse --verify HEAD` 探测
- `get_identity` 的两次 `config --get`
- `show_commit` 的 metadata、files 和提交 diff 查询
- `list_branches` 的 `for-each-ref`
- `validate_branch` 的 `check-ref-format`
- `push` 中读取远端名称的 `remote`
- `ensure_remote_empty` 的 `ls-remote`
- `connect_origin` 中读取远端名称的 `remote`

保留以下写入调用为 `run_git(...)`：`add`、`restore/rm --cached`、`config user.*`、`commit`、`switch`、`pull`、`push`、`init`、`remote add` 和 `clone`。

- [ ] **Step 5: 运行聚焦测试确认通过**

Run:

```bash
cd src-tauri
cargo test --test git status_read_does_not_touch_git_directory -- --exact
cargo test --test git
```

Expected: 新回归测试 PASS，Git 集成测试 15 项全部通过。

- [ ] **Step 6: 提交后端修复**

```bash
git add src-tauri/src/git.rs src-tauri/tests/git.rs
git diff --cached --check
git commit -m "修复 Git 状态刷新循环"
```

### Task 2: 初始化向导适配窄侧栏

**Files:**
- Modify: `src/lib/git-state.ts`
- Test: `src/lib/git-state.test.ts`
- Modify: `src/components/git/GitPanel.tsx`

**Interfaces:**
- Consumes: `RepositorySetup` 组件、现有 `Input` 和 Tailwind 工具类。
- Produces: `GIT_REMOTE_PLACEHOLDER: string`、`GIT_DEFAULT_IGNORE_RULES: readonly string[]`，由测试和初始化向导共同使用。

- [ ] **Step 1: 为展示数据写入失败测试**

在 `src/lib/git-state.test.ts` import 中加入：

```ts
GIT_DEFAULT_IGNORE_RULES,
GIT_REMOTE_PLACEHOLDER,
```

在提交校验测试之前加入：

```ts
expectEqual(
  GIT_REMOTE_PLACEHOLDER,
  "请输入远端仓库地址",
  "repository setup should use a short remote placeholder",
);
expectEqual(
  GIT_DEFAULT_IGNORE_RULES.join(","),
  "env.private.json,.apisender/,.DS_Store",
  "repository setup should expose ignore rules as independent items",
);
```

- [ ] **Step 2: 运行前端测试确认缺少导出**

Run:

```bash
pnpm test:git
```

Expected: FAIL，Vite 报告 `GIT_REMOTE_PLACEHOLDER` 或 `GIT_DEFAULT_IGNORE_RULES` 未从 `git-state.ts` 导出。

- [ ] **Step 3: 添加可复用的初始化向导展示数据**

在 `src/lib/git-state.ts` 的错误码集合后加入：

```ts
/** Git 初始化向导使用的短远端地址占位文案，避免窄侧栏中长示例被裁切。 */
export const GIT_REMOTE_PLACEHOLDER = "请输入远端仓库地址";

/** Git 初始化向导逐项展示的默认忽略规则，与后端 DEFAULT_IGNORE_RULES 保持一致。 */
export const GIT_DEFAULT_IGNORE_RULES = ["env.private.json", ".apisender/", ".DS_Store"] as const;
```

- [ ] **Step 4: 让 RepositorySetup 在窄侧栏内约束宽度并换行**

在 `src/components/git/GitPanel.tsx` 从 `@/lib/git-state` 导入两个新常量，并把 `RepositorySetup` 返回内容调整为：

```tsx
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
```

- [ ] **Step 5: 运行前端测试和类型检查确认通过**

Run:

```bash
pnpm test:git
pnpm exec tsc --noEmit
```

Expected: Git/环境轻量测试全部 PASS，TypeScript 退出码为 0。

- [ ] **Step 6: 提交前端布局修复**

```bash
git add src/lib/git-state.ts src/lib/git-state.test.ts src/components/git/GitPanel.tsx
git diff --cached --check
git commit -m "修复 Git 初始化向导文本溢出"
```

### Task 3: 完整验证与交付检查

**Files:**
- Verify: `src-tauri/src/git.rs`
- Verify: `src-tauri/tests/git.rs`
- Verify: `src/components/git/GitPanel.tsx`
- Verify: `src/lib/git-state.ts`
- Verify: `src/lib/git-state.test.ts`

**Interfaces:**
- Consumes: Task 1 的只读 Git 命令路径和 Task 2 的响应式初始化向导。
- Produces: 干净的 `codex/git-sync` 分支及两项中文修复提交。

- [ ] **Step 1: 检查目标 Rust 文件格式**

```bash
cd src-tauri
rustfmt --edition 2024 --check src/git.rs tests/git.rs
```

Expected: 退出码为 0，不运行会格式化无关模块的 `cargo fmt --all`。

- [ ] **Step 2: 执行完整 Rust 测试**

```bash
cd src-tauri
cargo test
```

Expected: 所有测试通过，0 failed。

- [ ] **Step 3: 执行前端测试、类型检查和生产构建**

```bash
pnpm test:git
pnpm exec tsc --noEmit
pnpm build
```

Expected: 测试和类型检查退出码为 0；Vite 构建成功，仅允许既有的 500 kB chunk size 警告。

- [ ] **Step 4: 检查差异和工作区**

```bash
git diff --check
git status --short
git log -4 --oneline
```

Expected: `git diff --check` 无输出，`git status --short` 无输出，最近提交包含两个中文修复提交。

- [ ] **Step 5: 报告验证边界**

交付说明必须包含：刷新循环的根因与修复、初始化向导的响应式处理、自动化验证结果，以及“未执行桌面 UI 冒烟测试”的明确边界。
