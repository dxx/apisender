# 变量使用

apisender 使用双花括号 `{{变量名}}` 语法进行变量插值，在请求执行前将变量替换为实际值。变量可来自环境、文件、请求块或操作系统环境。

## 变量插值语法

```
{{变量名}}
```

- 扫描文本中的 `{{` 开始标记，找到匹配的 `}}` 结束标记，提取中间内容（会去除首尾空白）。
- 支持在文本任意位置插入，可与其他文本拼接。
- 变量名两侧的空格会被 trim，`{{ host }}` 与 `{{host}}` 等效。
- 若 `{{` 后找不到配对的 `}}`，保留原始文本不报错。

示例：

```
https://{{host}}/api/users?id={{userId}}
Authorization: Bearer {{token}}
```

## 变量来源

变量共有 **四种来源**，在请求执行前合并：

| 来源 | 定义位置 | 作用范围 |
|------|---------|---------|
| 环境变量 | 工作区根目录 `env.json` / `env.private.json` | 当前激活环境下的所有请求 |
| 文件级全局变量 | `.http` 文件顶部的 `@name = value` | 当前文件的所有请求 |
| 请求块变量 | `###` 分隔符下方、请求行上方的 `@name = value` | 仅当前请求块 |
| 系统环境变量 | 操作系统环境变量，通过 `{{$env NAME}}` 引用 | 任意位置 |

### 1. 环境变量

详见[环境](./environment.md)。通过侧边栏环境选择器切换激活环境。

```json
{
  "dev": { "host": "dev.api.com", "token": "dev-token" },
  "prod": { "host": "prod.api.com", "token": "prod-token" }
}
```

### 2. 文件级全局变量

在 `.http` 文件顶部（任何 `###` 之前）用 `@name = value` 定义，对文件内所有请求生效：

```http
@host = api.example.com
@token = abc123

### a
GET https://{{host}}/users

### b
POST https://{{host}}/orders
```

### 3. 请求块变量

在 `###` 之后、请求行之前用 `@name = value` 定义，仅对该请求块生效，会覆盖同名全局变量：

```http
@host = api.example.com

### a
@host = override.example.com
GET https://{{host}}/users
```

> 内联变量定义语法：以 `@` 开头，用 `=` 分隔键值（不是 `:`）。可写在注释行（`#` 或 `//` 开头）中，也可直接以 `@` 开头。

### 4. 系统环境变量

特殊前缀 `$env` 用于读取**操作系统级环境变量**：

| 语法 | 含义 |
|---|---|
| `{{$env VAR_NAME}}` | 读取系统环境变量 `VAR_NAME` |
| `{{$env VAR_NAME:-默认值}}` | 读取 `VAR_NAME`，不存在时用默认值 |

- `$env` 与变量名之间用空格分隔。
- `:-` 分隔符两侧空格会被 trim。
- 变量不存在且无默认值时，替换为**空字符串**。

示例：

```
Authorization: Bearer {{$env API_TOKEN}}
Database: {{$env DB_URL:-sqlite://default.db}}
```

> 在 `env.json` / `env.private.json` 的变量值中，**仅 `$env` 前缀**会被解析（普通 `{{var}}` 在环境值内不解析）。这样可以把敏感值指向系统环境变量：
> ```json
> { "prod": { "token": "{{$env PROD_TOKEN}}" } }
> ```

## 变量优先级

请求实际执行时，变量按以下顺序合并（后者覆盖前者同名项）：

**环境变量 < 文件级全局变量 < 请求块变量**

即请求块变量优先级最高，同名时覆盖全局变量，全局变量覆盖环境变量。

env.json 内部优先级：
- `$shared` < 具体环境（具体环境的同名 key 覆盖 `$shared`）。
- `env.json` < `env.private.json`（私有文件覆盖公开文件的同名值）。

## 变量可使用的位置

变量插值覆盖请求的几乎所有文本字段：

### HTTP 请求
- URL（含 query string）
- Header 的 key 和 value
- 请求体（Text）
- 请求体（File 路径）：`< {{filePath}}`
- Multipart 部分：part name、filename、content-type、text 内容、file 路径

### WebSocket 请求
- URL
- 每条消息的 text 内容

### gRPC 请求
- URL
- Metadata 的 key 和 value
- Message 的 text 内容

### cURL 转换
导出 cURL 时会先合并变量并插值，再生成 curl 命令。

> **不插值的部分**：HTTP 方法名（GET/POST 等）、gRPC 的 `package/service/method` 路径不进行变量插值。

## 变量未定义时的行为

- 找不到变量时，占位符被替换为**空字符串**。
- **不会报错**，**不会保留 `{{varName}}` 原文**。

例如 `token={{$env UNSET}}`（系统变量 `UNSET` 未设置）-> 结果为 `token=`。

## 变量嵌套

**不支持嵌套递归解析**。插值是单趟扫描，找到 `{{...}}` 后直接取值，不会对结果再次扫描。

- env.json 内**不支持**变量间互相引用（除 `$env` 外）。
- 请求文本中的变量**不支持**嵌套（如 `{{{{a}}}}` 或 `{{a{{b}}}}`）。
- 变量值本身若包含 `{{x}}`，在插值后**不会**被二次解析。

## 不支持的能力

- **动态变量**：没有 `{{$timestamp}}`、`{{$uuid}}`、`{{$randomInt}}`、`{{$guid}}`、`{{$datetime}}` 等动态生成变量。如需时间戳等动态值，需自己在 env.json 或内联变量中预先定义。
- **响应提取/变量赋值**：不支持类似 IntelliJ HTTP Client 的 `> {% client.global.set("var", response.body.id) %}` 语法，无法从响应中提取变量用于后续请求。
- **变量补全**：编辑器仅对 `{{...}}` 做语法高亮，无变量名自动补全。

## 语法速查表

| 功能 | 语法 | 示例 |
|------|------|------|
| 变量引用 | `{{name}}` | `https://{{host}}/api` |
| 变量引用（带空格） | `{{ name }}` | `{{ host }}` |
| 系统环境变量 | `{{$env NAME}}` | `{{$env API_TOKEN}}` |
| 系统环境变量带默认值 | `{{$env NAME:-default}}` | `{{$env DB:-sqlite://default.db}}` |
| 文件级变量定义 | `@name = value` | `@host = api.example.com` |
| 请求块变量定义 | （在 `###` 后、请求行前）`@name = value` | `@token = abc123` |
| 共享环境（env.json） | `"$shared": {...}` | `"$shared": {"host": "x.com"}` |

## 示例

```http
# 文件级全局变量
@host = api.example.com
@contentType = application/json

### 用户列表
# 请求块变量（覆盖全局 host）
@host = dev.api.example.com
@page = 1
GET https://{{host}}/users?page={{page}}
Authorization: Bearer {{$env API_TOKEN:-default-token}}
Content-Type: {{contentType}}

### 创建用户
POST https://{{host}}/users
Authorization: Bearer {{token}}
Content-Type: {{contentType}}

{
  "name": "alice",
  "ref": "{{$env USER_REF:-anonymous}}"
}
```
