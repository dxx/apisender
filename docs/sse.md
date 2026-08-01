# SSE 请求

SSE（Server-Sent Events）用于接收服务器的单向事件流。apisender 的 SSE 请求**完全复用普通 HTTP 请求语法**，通过标识符把一个 HTTP 请求标记为 SSE 类型，使其走流式执行路径。

## 发起 SSE 请求

满足以下**任一条件**即识别为 SSE 请求：

1. 请求块内含 `@sse` 标签。
2. 请求块内含 `Accept: text/event-stream` 头。

### 方式一：用 `@sse` 标签

```http
### SSE 示例
# @sse
GET https://api.example.com/stream
Authorization: Bearer {{token}}
```

### 方式二：用 Accept header

```http
GET https://api.example.com/events
Accept: text/event-stream
```

### 带请求体

SSE 本质是 HTTP 请求，支持 POST/PUT 等方法及请求体（Text / File / Multipart，与普通 HTTP 一致）：

```http
### SSE 带请求体
# @sse
POST https://api.example.com/chat
Content-Type: application/json
Accept: text/event-stream

{"prompt": "hello"}
```

## 标签

SSE 请求支持以下标签（写在 `###` 与请求行之间）：

| 标签 | 作用 | 默认值 |
|---|---|---|
| `@sse` | 标记为 SSE 请求（前端识别用） | 不写则按普通 HTTP 处理 |
| `@idle-timeout <时长>` | 空闲超时（两个 chunk 之间的最大间隔） | `30s`（`0` 表示永不超时） |
| `@no-log` | 不记录到历史 | 不写则记录 |
| `@no-cookie` | 不读取/写入 Cookie | 不写则启用 Cookie |
| `@timeout <时长>` | 总超时 | 无默认值（避免长连接被强制断开） |
| `@connection-timeout <时长>` | 连接超时 | `10s` |

> **空闲超时**指"两个 chunk 之间的最大空闲间隔"，每收到任意数据后顺延，不是连接总时长。

时长单位：`ms`（毫秒）、`s`（秒）、`m`（分钟），纯数字默认秒。

```http
### 永不超时的长连接
# @sse
# @idle-timeout 0
GET https://api.example.com/long-stream
```

## 能力说明

### 自定义 Headers

完全支持。SSE 请求本质是 HTTP 请求，所有普通 HTTP 请求支持的 headers 都可用：Authorization、Content-Type、自定义 header、`{{变量}}` 插值等。

`Accept: text/event-stream` 既是触发 SSE 模式的方式之一，也是正常发送的 header。

### Last-Event-ID

支持手动设置。可在 headers 区写 `Last-Event-ID: 42`，会作为普通 header 发送给服务端。

> apisender **不会自动管理 Last-Event-ID**（不自动重连，不会把上次收到的 id 自动带上），需要用户自行处理。

### 重连机制

**不自动重连**。SSE 规范中的 `retry` 字段会被解析并展示，但不会按 retry 值自动重连。连接断开后状态变为 `done` / `error` / `stop`，需用户重新点 `▶` 发起。

## 事件状态流转

```
发起请求 -> connecting
收到 sse-start -> streaming
收到 sse-event -> streaming（事件追加）
收到 sse-end -> done（带 totalMs）
用户点停止 -> stop
收到 sse-error -> error
```

> 用户点停止时，前端先置 `stop` 状态再调后端中断，即便后端 `sse-end` 晚到也不会覆盖状态。

## 示例

```http
### 实时消息流
# @sse
# @idle-timeout 60s
GET https://api.example.com/messages
Authorization: Bearer {{token}}
Last-Event-ID: 100

### AI 对话流
# @sse
POST https://api.example.com/ai/chat
Content-Type: application/json
Accept: text/event-stream

{
  "model": "gpt-4",
  "messages": [{"role": "user", "content": "hello"}]
}
```
