# 更新日志

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
