# 更新日志

## 0.1.16 - 2026-08-16

### 新增

- 设置中新增编辑器字体大小和响应内容字体大小 ([328ae64](https://github.com/dxx/apisender/commit/328ae64))
- 响应内容字体独立于编辑器字体 ([328ae64](https://github.com/dxx/apisender/commit/328ae64))

### 修复

- 修复首次启动时 workspace 未打开的环境加载错误 ([8a54dac](https://github.com/dxx/apisender/commit/8a54dac))
- 修复 Sidebar 工作区切换按钮关闭 dropdown 后残留浏览器默认 focus outline 边框 ([299b8e1](https://github.com/dxx/apisender/commit/299b8e1))

### 变更

- 字体变量重命名 ([77eb7fc](https://github.com/dxx/apisender/commit/77eb7fc))
- 编辑器和响应视图样式分离、字号变量单独定义 ([234689b](https://github.com/dxx/apisender/commit/234689b), [da74c3e](https://github.com/dxx/apisender/commit/da74c3e))
- Toaster 样式调整 ([299b8e1](https://github.com/dxx/apisender/commit/299b8e1))
- 深色主题样式优化 ([aeb8727](https://github.com/dxx/apisender/commit/aeb8727), [2d1d1b4](https://github.com/dxx/apisender/commit/2d1d1b4))
- 进度条样式调整 ([b6a52b9](https://github.com/dxx/apisender/commit/b6a52b9))
- 预览区样式调整 ([f450627](https://github.com/dxx/apisender/commit/f450627))

## 0.1.15 - 2026-08-14

### 修复

- 修复 Windows 平台设置弹窗关闭按钮点击后出现焦点边框 ([8851966](https://github.com/dxx/apisender/commit/885196601dd34d1f80d696b1d3612237727d36c8))
- 修复编辑器中 Ctrl+V 粘贴后光标停留在原位置，应移动到粘贴内容末尾 ([7da020a](https://github.com/dxx/apisender/commit/7da020af94d346f6389bc788ec36c2ac6cc987bf))

## 0.1.14 - 2026-08-14

### 新增

- Rust updater 自动读取系统代理（macOS networksetup / Windows 注册表 / Linux gsettings），并保留 HTTPS_PROXY 环境变量覆盖 ([d87758a](https://github.com/dxx/apisender/commit/d87758a0b5b29615ab3c804337bd09250ba1319c))

### 变更

- 调整设置界面样式 ([91aaec3](https://github.com/dxx/apisender/commit/91aaec3a0499d181cef5daa5de978c441844bfbc))

## 0.1.13 - 2026-08-13

### 新增

- WebSocket 和 gRPC 编辑器支持代码折叠 ([f6c4633](https://github.com/dxx/apisender/commit/f6c463331f4205109b3b08d1031095af6de0d47d))

## 0.1.12 - 2026-08-13

### 新增

- 接入 Tauri 自动更新并发布 ([PR #2](https://github.com/dxx/apisender/pull/2) contributed by [@aaaaaaaaat](https://github.com/aaaaaaaaat))
- 实现编辑器折叠交互 ([PR #3](https://github.com/dxx/apisender/pull/3) contributed by [@aaaaaaaaat](https://github.com/aaaaaaaaat))

### 变更

- TitleBar 窗口控制按钮高度自适应父级 ([0f80e33](https://github.com/dxx/apisender/commit/0f80e3335002c87364dd299bc0836a49be8f66e5))
- CodeMirror 折叠/发送按钮字符替换为 lucide SVG 图标 ([4539b59](https://github.com/dxx/apisender/commit/4539b5922cf4e07d8647fd9f98d3267996b43cf9))
- 发送按钮去除 color transition，避免 activeLine 切换时白闪 ([4539b59](https://github.com/dxx/apisender/commit/4539b5922cf4e07d8647fd9f98d3267996b43cf9))
- 折叠按钮去除 opacity transition，避免编辑器挂载时闪烁 ([4539b59](https://github.com/dxx/apisender/commit/4539b5922cf4e07d8647fd9f98d3267996b43cf9))
- Tauri updater endpoint 配置从 Rust 硬编码迁移到 tauri.conf.json ([567ee21](https://github.com/dxx/apisender/commit/567ee21835dae91629de939f37a98114dbd93fe0))

## 0.1.11 - 2026-08-10

### 变更

- 修改文件项和标签样式 ([dc3869d](https://github.com/dxx/apisender/commit/dc3869dce9f9fa5557f06027b72d89c8df0a940f))
- 使用独立阴影 div 并对齐滚动条 ([99e8db3](https://github.com/dxx/apisender/commit/99e8db3f24a32622aec9097eed1ff4b5233eee0b))

## 0.1.10 - 2026-08-09

### 新增

- 设置中新增字体选择（界面字体、编辑器字体）([2ea06a8](https://github.com/dxx/apisender/commit/2ea06a81410f5ede840844bc90a7880369f908d1))
- 字体选择增加"默认"选项，恢复系统字体 ([dc9b4c9](https://github.com/dxx/apisender/commit/dc9b4c94c2195d2475bcbed452a497e161084388))

### 变更

- 用 APP_NAME 统一 Rust 端文件名（config / db）([1594ddf](https://github.com/dxx/apisender/commit/1594ddf3795f4ff66f0ea1c53ff8295831b65fa0))
- 主题和字体以后端 config.json 为准，后端删除字段时同步清除前端 ([25dabdb](https://github.com/dxx/apisender/commit/25dabdb0a26cf4401d4206c5c4964b6007071ee5))

## 0.1.9 - 2026-08-08

### 变更

- 添加 fg-active 和 fg-inactive 前景色变量 ([bd84811](https://github.com/dxx/apisender/commit/bd84811835b7e7140fc6ffc6b6dc4c58b7d963aa))
- 重新生成应用图标 ([cb20436](https://github.com/dxx/apisender/commit/cb20436bc5a914df6e9bb0e2a7a177b24186d117))
- 调整侧边栏工具栏和标题样式 ([7a8d786](https://github.com/dxx/apisender/commit/7a8d786c6cb22e039282c4a76fdb77194c92c7be))
- 修改 logo 图标 ([3d21c1b](https://github.com/dxx/apisender/commit/3d21c1b8bcf202a487b9d770b11729dbd8035a6b))
- 用 Tooltip 组件替换标题 ([6a437ad](https://github.com/dxx/apisender/commit/6a437ad1c9129f5e7c938b38ddf567df22b2430d))
- 调整拖放样式 ([48e7ae3](https://github.com/dxx/apisender/commit/48e7ae345c8f6c8730b4a920aee09a962dc99355))
- 修改选中样式 ([f4e79b0](https://github.com/dxx/apisender/commit/f4e79b05e2296589ef8e790e9389ad82e82df04f))
- 使用 CodeMirror 选中样式 ([0da70dc](https://github.com/dxx/apisender/commit/0da70dc6e9598ae3d9daa2536f625e8080138ef7))
- 调整行高 ([28960e7](https://github.com/dxx/apisender/commit/28960e7b8c3e2a87ed1ed5c23bfa0172189f31c7))

## 0.1.8 - 2026-08-05

### 变更

- 调整编辑器中鼠标光标样式 ([ebbc2f1](https://github.com/dxx/apisender/commit/ebbc2f14f8ae6e6d164429216458336003ad7f2c))
- 调整激活行号颜色 ([a4da06c](https://github.com/dxx/apisender/commit/a4da06c7c9738239fb68eaefd368051c5725acb6))
- 调整行号颜色 ([d0fa57b](https://github.com/dxx/apisender/commit/d0fa57bfaaf13d4ddbe4a2e30d5eb3180cb4b56e))

## 0.1.7 - 2026-08-02

### 修复

- 修复环境变量解析 ([0b5fb6a](https://github.com/dxx/apisender/commit/0b5fb6ad144620182e422f0203666be59a756b68))
- 修复首屏闪缩 ([a413553](https://github.com/dxx/apisender/commit/a41355379766ced20b5161923133744e76705419))

## 0.1.6 - 2026-08-02

第一次发布。
