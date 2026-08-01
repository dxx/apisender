# 环境

环境（Environment）是一组**命名的变量集合**，用于在不同运行上下文（如 dev / staging / prod）之间快速切换请求中的可变参数（host、token、账号密码等），避免在多个请求文件里反复手动改值。

- 每个环境是一份 key-value 变量表。
- 同一时刻只能激活一个环境（或选择"无环境"）。
- 激活的环境变量会在请求执行时被注入，用于替换请求文本中的 `{{变量}}` 占位符。
- 环境是**工作区级别**的：每个工作区独立维护自己的环境文件。

## 定义环境

环境定义在**工作区根目录**下，由两个 JSON 文件组成：

| 文件名 | 用途 | 版本控制建议 |
|---|---|---|
| `env.json` | 公开环境变量（可共享） | 建议提交到 git |
| `env.private.json` | 私有/敏感变量（如 token、密钥） | **应自行加入 `.gitignore`** |

### 文件格式

纯 JSON 对象，**顶层 key 是环境名**，value 是该环境的变量 map：

```json
{
  "$shared": {
    "apiBase": "/api/v1"
  },
  "dev": {
    "host": "http://localhost:1420",
    "token": "dev-token-123"
  },
  "staging": {
    "host": "https://staging.example.com",
    "token": "staging-token-xxx"
  },
  "prod": {
    "host": "https://api.example.com",
    "token": "{{$env PROD_TOKEN}}"
  }
}
```

- 值支持字符串、数字、布尔；非字符串值会被序列化为字符串后参与插值。
- 环境名是用户自定义字符串（建议用 `dev`/`staging`/`prod` 等简短标识）。

### 公私文件合并

`env.json` 与 `env.private.json` 会被合并读取：

- 结构相同（都是「环境名 -> 变量 map」）。
- `env.private.json` 中的变量会**覆盖** `env.json` 同环境同名的变量（private 优先）。
- 任一文件不存在时按空对象处理，不会报错。

## 特殊环境 `$shared`

名为 `$shared` 的环境是**共享/基础环境**：

- 不会被列入可选环境列表（不在环境选择器中显示）。
- 任何被激活的环境，其变量都会**先继承 `$shared` 的全部变量，再用自身变量覆盖同名项**。
- 相当于"默认环境/环境继承"机制：把所有环境通用的变量放进 `$shared` 即可。
- 若没有 `$shared`，则只有当前环境自身的变量生效。

## 切换环境

通过侧边栏的 **EnvSelector**（环境下拉选择器）切换：

- 占位符为"无环境"。
- 列表内容来自 `env.json` + `env.private.json` 中所有环境名（`$shared` 除外），按字母升序排列。
- 第一项固定为"无环境"，选中后不注入任何环境变量。
- 选择环境后立即持久化，并刷新变量预览。
- 左侧有折叠箭头，点击可展开查看当前激活环境的变量预览（最多显示 8 个，超出显示 `+N 更多...`）。

## 持久化

激活的环境名**不存放在工作区目录**，而是存在应用配置文件中：

- 路径：`<app_data_dir>/config.json`。
- 按**工作区路径**分别记录每个工作区的激活环境：

```json
{
  "workspaces": {
    "/User/dxx/Private/apisender": { "activeEnv": "dev" },
    "/User/dxx/other-project": { "activeEnv": "prod" }
  }
}
```

- 切换工作区时自动恢复该工作区上次选择的环境。
- 选中"无环境"时 `activeEnv` 写入 `null`。

## 热更新

- 打开工作区时，后端递归监听整个工作区根目录的文件变化。
- 当 `env.json` 或 `env.private.json` 被外部编辑保存后，apisender 会**自动刷新**环境下拉与变量预览，无需手动重启。
- 切换/打开工作区时也会重新加载该工作区的环境。

## 在请求中引用环境变量

环境变量通过双花括号语法在请求中引用，详见[变量使用](./variables.md)：

```http
### 登录请求
POST {{host}}/login
Content-Type: application/json

{
  "token": "{{token}}"
}
```

切换到 `dev` 时 `{{host}}` -> `http://localhost:1420`；切换到 `prod` 时 `{{token}}` 取系统环境变量 `PROD_TOKEN`。

## 环境与工作区的关系

- 环境文件必须位于**工作区根目录**，子目录中的同名文件不会被识别。
- 激活状态按工作区路径独立持久化，切换工作区自动恢复。
- 没有打开工作区时，所有环境相关命令会返回错误 `"No workspace open"`。
- 关闭工作区不会删除 `env.json`，仅清空内存中的环境状态。

## 示例

### `env.json`（提交到版本库）

```json
{
  "$shared": {
    "apiBase": "/api/v1",
    "timeout": "30000"
  },
  "dev": {
    "host": "http://localhost:1420",
    "token": "dev-secret"
  },
  "prod": {
    "host": "https://api.example.com",
    "token": "{{$env PROD_API_TOKEN}}"
  }
}
```

### `env.private.json`（本地敏感值，加入 .gitignore）

```json
{
  "dev": {
    "token": "real-local-token-overrides-public"
  }
}
```

### `requests.http`（请求文件）

```http
# 文件级全局变量
@contentType = application/json

### 用户列表
# 块级变量
@page = 1
GET {{host}}{{apiBase}}/users?page={{page}}
Authorization: Bearer {{token}}
Content-Type: {{contentType}}
```
