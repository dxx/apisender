<p align="center">
    <a href="https://github.com/dxx/apisender">
        <img src="./public/logo.png" alt="apisender" width="128" height="128"/>
    </a>
</p>
<p align="center"><font size="6"><b>apisender</b></font></p>

<p align="center">
HTTP / WebSocket / SSE / gRPC 请求客户端，类似 IntelliJ HTTP Client / VSCode REST Client 的桌面应用，基于 Tauri 2 构建。
</p>

![HTTP Get](./docs/images/http-get.png)

点击[查看](./docs/screenshots.md)更多截图。

## 功能

- HTTP 请求（GET/POST/PUT/DELETE/PATCH 等，支持 multipart、变量插值）
- SSE 长连接，事件流实时渲染
- WebSocket 双向通信，支持多消息发送与 idle 超时
- gRPC（Unary + Server Streaming），支持 server reflection / proto 文件加载
- 工作区文件树管理、环境变量、历史记录、cURL 互转
- 跨平台：Windows / macOS / Linux

## 环境依赖

- [Node.js](https://nodejs.org/) ≥ 20
- [pnpm](https://pnpm.io/) ≥ 9
- [Rust](https://www.rust-lang.org/) ≥ 1.85（edition 2024）
- [Tauri 2 前置依赖](https://tauri.app/start/prerequisites/)（Windows: WebView2 + MSVC；macOS: Xcode CLT；Linux: webkit2gtk 等）

## 快速开始

```bash
# 安装前端依赖
pnpm install

# 启动开发模式（自动跑 Vite + Tauri）
pnpm tauri dev

# 类型检查
pnpm exec tsc --noEmit

# 打包发布
pnpm tauri build
```

## 文档

详细文档说明：[docs](./docs/)。
