# gRPC 请求

apisender 支持 gRPC 的 **Unary**（一元调用）和 **Server Streaming**（服务端流）两种模式，并支持通过本地 `.proto` 文件或服务器反射（Server Reflection）加载服务定义。

## 请求语法

```http
GRPC <grpc://|grpcs://host:port>/<Package>.<Service>/<Method>

<metadata-key>: <metadata-value>

<JSON 请求体>
```

- 关键字 `GRPC` 不区分大小写。
- URL 协议：`grpc://`（明文 HTTP/2）、`grpcs://`（TLS）。
- URL 路径必须为 `<Package>.<Service>/<Method>` 三段式，例如 `helloworld.Greeter/SayHello`，否则解析报错。
- 请求行支持续行。

路径解析规则：
1. 取 `://` 后第一个 `/` 之后的部分作为 service path。
2. 用最后一个 `/` 切出 `Method`。
3. 用最后一个 `.` 切出 `Package` 和 `Service`。

## 标签

gRPC 专属标签（写在 `###` 与请求行之间）：

| 标签 | 作用 | 默认值 |
|---|---|---|
| `@proto <路径>` | 显式指定 `.proto` 文件路径 | - |
| `@proto-include <路径>` | proto import 搜索目录（可多次） | - |
| `@timeout <时长>` | 整体调用超时 | `30s` |
| `@connection-timeout <时长>` | 连接建立超时 | `10s` |
| `@no-log` | 不写入历史记录 | - |

时长单位：`ms`（毫秒）、`s`（秒）、`m`（分钟），纯数字默认秒。

## Metadata（请求头）

请求行后空一行，写 `Key: Value` 形式的 metadata，与 HTTP header 写法一致：

```http
GRPC grpc://localhost:50051/helloworld.Greeter/SayHello
authorization: Bearer {{token}}
x-custom-header: my-value
```

- 以 `:` 分隔 key 和 value，trim 后存入。
- 空行、`###`、以 `{`/`[`/`<` 开头的行会结束 metadata 块。
- `#` 或 `//` 开头的注释行会被跳过。
- key 转小写存储。
- 全部按 **ASCII metadata** 处理，**不支持 binary metadata**（如 `key-bin`）。
- 支持 `{{变量}}` 插值。

## 消息体（请求消息，JSON）

metadata 后空一行，写 JSON 消息体：

```http
GRPC grpc://localhost:50051/helloworld.Greeter/SayHello

{
  "name": "World"
}
```

- 支持 JSON 对象（`{`）和数组（`[`）。
- **消息体为空**：发送默认空消息，适用于无入参方法。
- JSON 解析失败会返回错误；字段不匹配 proto 会报错。
- 支持 `{{变量}}` 插值。

## 调用模式

调用模式（Unary / Server Streaming）**不需要用户显式声明**，由后端从 proto 描述符的 `is_server_streaming()` 自动判定：

- **Unary**：单个请求、单个响应。
- **Server Streaming**：单个请求、多个响应（流式）。

## Proto 文件加载

按以下**优先级顺序**尝试加载，任一成功即用，全部失败才报错：

### 1. 显式 `@proto` 标签

```http
### Say Hello
# @proto protos/hello.proto
GRPC grpc://localhost:50051/helloworld.Greeter/SayHello
```

路径解析规则：
- 绝对路径直接使用。
- 相对路径先相对当前请求文件所在目录解析；不存在则相对工作区根目录。
- include 目录自动包含：proto 文件所在父目录、所有祖先目录（向上遍历到工作区根）、`@proto-include` 指定的目录。

### 2. 服务器反射（Server Reflection）

无需任何 proto 文件，直接从服务器反射获取服务定义：

- 自动向同一 endpoint 发起 reflection 请求，查询 `FileContainingSymbol(<Package.Service>)`。
- 收集 `FileDescriptorProto` 并装入 `DescriptorPool`。
- 即使用户指定了 `@proto`，反射仍作为后备；`@proto` 成功则不会触发反射。

### 3. 工作区扫描

- 扫描工作区根目录**顶层**（仅一层，不递归）所有 `.proto` 文件。
- 适用于 proto 文件直接放在工作区根目录的场景。

## 状态流转

```
发起请求 -> connecting
收到 grpc-start -> streaming（server-streaming）或保持 connecting（unary）
收到 grpc-message -> streaming（消息追加）
收到 grpc-status -> gRPC 状态码（0 = OK）
用户点停止 -> stop
收到 grpc-error -> error
收到 grpc-closed -> done
```

## 示例

### Unary 调用

```http
### Say Hello
# @proto protos/hello.proto
# @timeout 30s
GRPC grpc://localhost:50051/helloworld.Greeter/SayHello
authorization: Bearer {{token}}

{
  "name": "World"
}
```

### Server Streaming 调用

```http
### Subscribe Events
# @proto protos/events.proto
# @idle-timeout 0
GRPC grpc://localhost:50051/events.EventService/Subscribe

{
  "topic": "orders",
  "since": "2026-01-01T00:00:00Z"
}
```

### 使用服务器反射（无需 proto 文件）

```http
### 通过反射调用
GRPC grpc://localhost:50051/helloworld.Greeter/SayHello

{
  "name": "Reflection"
}
```

### 无入参方法

```http
### 健康检查
GRPC grpc://localhost:50051/grpc.health.v1.Health/Check

{}
```
