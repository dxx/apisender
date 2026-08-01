# WebSocket 请求

WebSocket 用于双向实时通信。apisender 用 `WEBSOCKET` 关键字标记 WebSocket 请求，支持多条消息发送、`wait-for-server` 问答机制和空闲超时。

## 请求语法

```http
WEBSOCKET <ws://|wss://URL>
<消息1>
===
<消息2>
=== wait-for-server
<消息3（等服务器响应后再发）>
```

- 请求行：`WEBSOCKET ws://host/path`。
- 消息之间用单独一行的 `===` 分隔。
- `=== wait-for-server`：标记下一条消息需等待服务器响应后再发送。
- 请求行支持续行（下一行以空格或 Tab 开头会拼接）。

### URL 格式

- 支持 `ws://`（明文）和 `wss://`（TLS）。
- 支持 `{{变量名}}` 插值。

### 标签

| 标签 | 作用 | 默认值 |
|---|---|---|
| `@no-log` | 不写入历史记录 | - |
| `@connection-timeout <时长>` | 握手超时 | `10s` |
| `@idle-timeout <时长>` | 空闲超时（无任何帧收发）；设为 `0` 表示永不超时 | `30s` |

时长单位：`ms`（毫秒）、`s`（秒）、`m`（分钟），纯数字默认秒。

## 发送消息

### 初始消息

请求行之后的所有非 `###` 行被视为初始消息，可以包含**多条消息**，用 `===` 分隔：

```http
### WS Echo
# @connection-timeout 5s
# @idle-timeout 30s
WEBSOCKET ws://localhost:8080/echo
{"hello": "world"}
===
{"second": "msg"}
```

### wait-for-server 机制

用 `=== wait-for-server` 标记后续消息需排队等待：

```http
WEBSOCKET ws://localhost:8080/rpc
{"action": "login"}
=== wait-for-server
{"action": "fetchData"}
=== wait-for-server
{"action": "logout"}
```

- `=== wait-for-server` 之后的消息进入待发送队列。
- 每当收到一条服务器消息后，自动从队列取出下一条发送。
- 实现"一问一答"式的请求/响应序列。

### 消息文本规则

- 消息文本会 trim（去除首尾空白），空消息不会被发送。
- 消息支持多行（消息内部换行被保留，分隔靠 `===`）。
- 消息文本支持 `{{变量}}` 插值。
- **仅支持文本消息**，不支持发送二进制。
- 收到服务器的二进制帧会被静默忽略。

## 连接与生命周期

### 连接状态

| 状态 | 说明 |
|---|---|
| `connecting` | 握手中 |
| `open` | 握手成功（状态码 `101 Switching Protocols`） |
| `idle_timeout` | 空闲超时（橙色徽标） |
| `closed` | 服务器或客户端关闭（显示 closeCode 和 reason） |
| `error` | 出错 |

### 握手

- 使用标准 WebSocket 握手。
- 握手超时默认 `10s`，可用 `@connection-timeout` 覆盖。
- 握手成功后，握手响应的状态码、状态文本、响应头都会展示。

### idle 超时

- 默认 **30 秒**。
- 可用 `@idle-timeout` 覆盖；**设为 `0` 表示永不超时**。
- "idle" 指自上次收发任何帧（含 Text/Binary/Ping/Pong）起计时。任何帧的收发都会刷新计时。
- 触发后发送 CloseFrame（code `1001 Away`，reason `idle timeout`），连接关闭。

### 主动断开

- 点击"停止"按钮 -> 发送 CloseFrame（code `1000 Normal`，reason `client cancel`）。
- 对已有活跃 WebSocket 的 tab 再次点击运行，会先关闭旧连接再发起新连接。

## 不支持的能力

- **自定义握手头 / Subprotocol**：无法在编辑器中指定自定义请求头或 `Sec-WebSocket-Protocol`。握手响应头可被读取展示，但请求头不可定制。
- **发送二进制消息**：仅支持文本。
- **整体导出**：无导出为文件功能，仅支持逐条复制消息。

## 示例

```http
### 简单回显
# @idle-timeout 30s
WEBSOCKET ws://localhost:8080/echo
{"msg": "ping"}
===
{"msg": "ping again"}

### 一问一答 RPC
# @idle-timeout 0
WEBSOCKET wss://api.example.com/ws
{"action": "subscribe", "channel": "orders"}
=== wait-for-server
{"action": "getSnapshot"}
=== wait-for-server
{"action": "unsubscribe"}
```
