# HTTP 请求

apisender 使用类似 IntelliJ HTTP Client / VSCode REST Client 的 `.http` 文件语法编写请求。一个文件可包含多个请求，点击编辑器左侧 `▶` 按钮即可发送。

## 请求结构

每个请求块由「请求行 + 头部 + 空行 + 请求体」组成：

```http
### 请求名称（可选）
<METHOD> <URL> [HTTP/<version>]
Header-Key: Header-Value

<请求体>
```

- 请求行：`方法 URL`，方法与 URL 之间用空白分隔。
- 头部：`Key: Value` 形式，每行一个。
- 空行：头部与请求体之间必须有一个空行。
- 请求体：空行之后到下一个 `###` 或文件结尾的内容。

### 简写形式

- **省略方法**：直接写 URL（`http://` / `https://` 开头）默认为 `GET`。
  ```http
  https://example.com/api/users
  ```
- **带 HTTP 版本**：可在 URL 后追加 `HTTP/1.1` 或 `HTTP/2`，会强制使用对应协议。
  ```http
  GET https://example.com/api?msg=hello world HTTP/1.1
  ```
  > URL 中可包含空格（如 query 值），解析器通过末尾的 `HTTP/` 关键字分离版本号。

### URL 续行

URL 可跨多行书写，后续行需以空格或 Tab 缩进，解析时会自动拼接：

```http
GET https://example.com
  /api
  /users
  ?id=123
```

等价于 `https://example.com/api/users?id=123`。

## 支持的 HTTP 方法

| 类别 | 方法 |
|---|---|
| 标准方法 | `GET`、`POST`、`PUT`、`DELETE`、`PATCH`、`HEAD`、`OPTIONS` |
| 自定义方法 | 任意全大写单词（如 `CONNECT`、`TRACE` 或自定义动词） |

方法不区分大小写，但约定使用大写。

## 请求体格式

### 文本体

空行后的所有非 `###`、非注释内容作为原始文本体。常用于 JSON / XML / 纯文本：

```http
POST https://example.com/api
Content-Type: application/json

{"key": "value"}
```

### 文件体

请求体写为 `< <文件路径>`，发送时读取该文件的字节作为 body：

```http
POST https://example.com/upload
Content-Type: application/octet-stream

< /path/to/file.bin
```

### Multipart 表单

当 `Content-Type` 为 `multipart/form-data; boundary=...` 时，请求体按标准 multipart 格式解析，支持文本字段和文件：

```http
POST https://example.com/upload
Content-Type: multipart/form-data; boundary=----WebKitFormBoundaryakDtw6GLACe3uOS4

------WebKitFormBoundaryakDtw6GLACe3uOS4
Content-Disposition: form-data; name="file"; filename="windows.png"
Content-Type: image/png

< /Users/dxx/Desktop/windows.png
------WebKitFormBoundaryakDtw6GLACe3uOS4--
```

- 每个 part 以 `--<boundary>` 开始，以 `--<boundary>--` 结束。
- `Content-Disposition` 中 `name=` 为字段名，`filename=` 为文件名。
- 可选 `Content-Type:` 指定该 part 的 MIME。
- part 内容若以 `< ` 开头则视为文件引用，否则为文本。
- multipart 体内的空行会被保留（与普通文本体不同）。

### form-urlencoded

无专用语法，需手动写 `Content-Type` 并在 body 写 `a=1&b=2`：

```http
POST https://example.com/login
Content-Type: application/x-www-form-urlencoded

username=admin&password=123456
```

## 请求分隔符

- `###` 是请求块分隔符。只有以三个 `#` 开头才算分隔符（`##`、`#` 不算）。
- `###` 后可跟可选的请求名称：
  ```http
  ### Get Users
  GET https://example.com/users

  ### Create User
  POST https://example.com/users
  ```
- 单个文件可混合 HTTP / WebSocket / gRPC 请求，用 `###` 分隔。
- 第一个请求前可以没有 `###`（裸写请求行即可开始）。

## 注释

支持两种行注释，注释行会被解析器忽略：

- `#` —— 行注释（HTTP 文件风格）
- `//` —— 行注释（代码风格）

`###` 之后、请求行之前的注释文本会被当作请求名。

## 标签

在 `###` 之后、请求行之前，用 `# @tag` 或 `@tag` 形式声明，控制请求行为：

| 标签 | 作用 | 默认值 |
|---|---|---|
| `@no-redirect` | 禁止跟随重定向 | 不写则最多跟随 10 次 |
| `@no-log` | 不记录到历史 | 不写则记录 |
| `@no-cookie` | 不读取/写入 Cookie | 不写则启用 Cookie |
| `@timeout <时长>` | 请求总超时 | `30s` |
| `@connection-timeout <时长>` | 连接超时 | `10s` |
| `@idle-timeout <时长>` | 空闲超时（主要用于 SSE/WS） | `30s`（`0` 表示永不超时） |

时长单位：`ms`（毫秒）、`s`（秒）、`m`（分钟），纯数字默认秒。

示例：

```http
### 不跟随重定向
# @no-redirect
# @timeout 500 ms
GET https://example.com
```

> 标签必须写在 `###` 与请求行之间；写在请求行之后的 `@xxx` 不会作为标签生效。

## Cookie 持久化

- 响应的 `Set-Cookie` 会被解析并存入 SQLite（按 domain/path/name 唯一）。
- 下次请求同 host 时自动携带 Cookie。
- 支持过期清理。
- `@no-cookie` 标签可禁用此行为。

## cURL 互转

### 导出（HTTP -> cURL）

右键菜单「复制 cURL」：将光标所在请求块转为等效 `curl` 命令并复制到剪贴板。

转换规则：
- `curl -X <METHOD>` + URL（单引号转义）。
- 每个头部 `-H 'Key: Value'`。
- 文本体用 `--data-raw`。
- 文件体用 `--data-binary @<path>`。
- multipart 用多个 `-F 'name=value;filename=...;type=...'`。
- `@timeout` 转 `--max-time`，`@connection-timeout` 转 `--connect-timeout`。
- `@no-redirect` 时不加 `-L`。
- 变量会先用当前环境/全局/块变量插值后再导出。

> WebSocket 和 gRPC 请求无法转 cURL，会报错并提示等价工具（websocat / grpcurl）。

### 导入（cURL -> HTTP）

在编辑器内粘贴（`Ctrl/⌘+V`）时，若剪贴板内容是 `curl ...` 命令，会自动转为 `.http` 格式插入。

- 转换后会以 `#` 注释保留原命令，并包裹在 `### ... ###` 块中。
- 支持的 curl 参数：`-X/--request`、`-H/--header`、`-d/--data/--data-raw/--data-binary`、`-F/--form`、`--url`、`-L/--location`（忽略）、`--compressed`（忽略）、`-k`（忽略）等。
- 支持单引号/双引号/无引号、`\` 续行。
- `-d` 会使 GET 自动变为 POST。

## 编辑器交互

### Run 按钮（Gutter Marker）

- 每个请求块的首个「方法/URL 行」的行号旁显示绿色 `▶` 按钮。
- 点击即发送该请求。
- 每次重新计算 marker，避免 RangeSet 去重问题。

### 快捷键

- `Ctrl/⌘+S`：保存当前文件。
- `Ctrl/⌘+V`：粘贴（智能识别 curl 并转换）。

## 示例

```http
# 文件级全局变量
@host = api.example.com
@contentType = application/json

### 用户列表
GET https://{{host}}/users?page=1
Authorization: Bearer {{token}}

### 创建用户
POST https://{{host}}/users
Authorization: Bearer {{token}}
Content-Type: {{contentType}}

{
  "name": "alice",
  "email": "alice@example.com"
}

### 上传文件（multipart）
# @no-redirect
POST https://{{host}}/upload
Content-Type: multipart/form-data; boundary=----boundary

------boundary
Content-Disposition: form-data; name="file"; filename="data.csv"
Content-Type: text/csv

< /path/to/data.csv
------boundary--
```
