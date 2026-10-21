# feedback-sdk 集成文档

> 通用意见/反馈收集 SDK，支持 uni-app、Vue、React 等任意前端项目接入。
> 部署在 Deno Deploy + Deno KV，无需自建数据库。

**GitHub 仓库：** https://github.com/smart-kind/feedback-sdk

**服务端地址：** https://feedback-sdk.david-crazyamber.deno.net

**意见管理页面：** https://feedback-sdk.david-crazyamber.deno.net/feedback

---

## 目录

1. [快速开始](#1-快速开始)
2. [配置说明](#2-配置说明)
3. [SDK API 参考](#3-sdk-api-参考)
4. [HTTP API 规范](#4-http-api-规范)
5. [状态定义与工作流](#5-状态定义与工作流)
6. [Dashboard 看板页面](#6-dashboard-看板页面)
7. [CLI 命令行工具](#7-cli-命令行工具)
8. [框架示例](#8-框架示例)

---

## 1. 快速开始

### 安装

```bash
npm install smart-kind/feedback-sdk
```

或直接引入 JS 文件：

```html
<script type="module">
  import { initFeedback, submitFeedback } from './js_sdk/index.js';
</script>
```

### 三步接入

```js
// 1. 创建配置文件 feedback.config.js（复制后修改）
import config from './feedback.config.js';

// 2. 在应用入口初始化（只调用一次）
import { initFeedback } from 'feedback-sdk';
initFeedback(config);

// 3. 在任意页面提交意见
import { submitFeedback } from 'feedback-sdk';
await submitFeedback({ content: '这个按钮的位置不太合理' });
```

---

## 2. 配置说明

每个接入项目**必须**创建自己的 `feedback.config.js`，定义唯一的应用标识和运行模式。

### 配置示例

```js
export default {
  // ===== 必填项 =====
  appId: 'my-project',           // 应用唯一标识（英文，建议用仓库名或产品名）
  appName: '我的项目',            // 应用显示名称（中文）
  mode: 'test',                  // 运行模式：dev / test / prod
  iterationVersion: '0.1',       // 迭代版本号（可选）

  // ===== 后端配置 =====
  backend: 'deno',               // 后端类型：deno（HTTP）或 unicloud

  deno: {
    enabled: true,
    endpoint: 'https://feedback-sdk.david-crazyamber.deno.net',
    timeout: 15000,
  },

  // ===== 可选项 =====
  adminKey: '',                  // 管理密钥（仅管理操作需要）
  historyScope: 'app',           // 历史记录范围
};
```

### 字段说明

| 字段 | 必填 | 说明 |
|------|------|------|
| `appId` | ✅ | 应用唯一标识，**必须是英文**（如 `crm-admin`、`website-home`） |
| `appName` | ✅ | 应用显示名称（中文），用于 Dashboard 展示 |
| `mode` | ✅ | 运行模式：`dev`（开发）、`test`（测试）、`prod`（生产） |
| `iterationVersion` | ❌ | 迭代版本号，用于追踪反馈所属版本 |
| `backend` | ✅ | 后端类型，统一填 `deno` |
| `deno.endpoint` | ✅ | 服务端地址 |

### AppID 命名规范

- **必须为英文**，支持小写字母、数字、连字符
- 建议格式：`产品名-模块名`，如 `crm-dashboard`、`website-home`
- 每个项目/子应用使用独立 AppID，便于分类管理

### Page（页面名称）命名规范

- **必须为英文**
- 建议格式：`模块名/页面名`，如 `user/list`、`order/detail`
- 如果不传 `page` 参数，SDK 会自动取当前路由路径

---

## 3. SDK API 参考

### `initFeedback(config)`

初始化全局单例，应用启动时调用一次。

```js
import { initFeedback } from 'feedback-sdk';
import config from './feedback.config.js';

initFeedback(config);
```

### `submitFeedback(input)`

提交一条意见。

```js
await submitFeedback({
  content: '这里有个问题',      // 必填，最多 1000 字
  page: 'user/profile',        // 可选，页面标识（英文）
  username: '张三',             // 可选，提交人姓名
  contact: '13800138000',      // 可选，联系方式
});
```

**Input 参数：**

| 字段 | 类型 | 必填 | 说明 |
|------|------|------|------|
| `content` | string | ✅ | 意见内容，最多 1000 字 |
| `page` | string | ❌ | 页面标识（英文），默认取当前路由 |
| `username` | string | ❌ | 提交人姓名 |
| `contact` | string | ❌ | 联系方式 |
| `session` | string | ❌ | 批次号，默认按天自动生成 |
| `meta` | object | ❌ | 自定义元数据 |

### `listFeedback(params)`

查询意见列表。

```js
const result = await listFeedback({
  appId: 'my-project',
  mode: 'test',
  status: 'new',
  page: 1,
  pageSize: 20,
});
console.log(result.items); // 意见列表
console.log(result.total); // 总数
```

**Params 参数：**

| 字段 | 类型 | 说明 |
|------|------|------|
| `appId` | string | 按应用 ID 过滤 |
| `mode` | string | 按模式过滤（dev/test/prod） |
| `status` | string | 按状态过滤 |
| `session` | string | 按批次过滤 |
| `page` | number | 页码，从 1 开始 |
| `pageSize` | number | 每页数量 |

### `updateFeedbackStatus(ids, status, note, key)`

更新意见状态（需要 `adminKey`）。

```js
await updateFeedbackStatus(
  ['id1', 'id2'],      // 意见 ID 数组
  'implemented',       // 目标状态
  '已修复',             // 备注（可选）
  'your-admin-key'     // 管理密钥（可选，优先用 config.adminKey）
);
```

**状态值：** `new` | `implemented` | `considered` | `rejected` | `duplicate`

### `removeFeedback(ids, key)`

删除意见（需要 `adminKey`）。

```js
await removeFeedback(['id1', 'id2'], 'your-admin-key');
```

### `createFeedbackClient(config)`

创建独立的客户端实例（不使用全局单例），适用于多应用共存场景。

```js
import { createFeedbackClient } from 'feedback-sdk';

const client = createFeedbackClient(config);
await client.submit({ content: '...' });
await client.list({ appId: 'my-project' });
```

---

## 4. HTTP API 规范

所有接口均为 POST 请求，JSON 格式，基础地址为：

```
https://feedback-sdk.david-crazyamber.deno.net
```

### POST /submit

提交意见。

**Request Body：**

```json
{
  "appId": "my-project",
  "appName": "我的项目",
  "mode": "test",
  "page": "user/profile",
  "content": "这里有个问题",
  "username": "张三",
  "contact": "13800138000",
  "session": "2026-10-21-000123",
  "submittedAt": 1761004800000,
  "meta": {
    "appVersion": "1.0.0",
    "platform": "ios"
  }
}
```

**必填字段：** `appId`、`appName`、`mode`、`page`、`content`

**Response：**

```json
{
  "code": 0,
  "message": "ok",
  "id": "feedback_xxxx"
}
```

### POST /list

查询意见列表。

**Request Body：**

```json
{
  "appId": "my-project",
  "mode": "test",
  "status": "new",
  "session": "2026-10-21-000123",
  "page": 1,
  "pageSize": 20
}
```

所有字段均可选，支持任意组合过滤。

**Response：**

```json
{
  "code": 0,
  "total": 42,
  "items": [
    {
      "_id": "feedback_xxxx",
      "appId": "my-project",
      "appName": "我的项目",
      "mode": "test",
      "page": "user/profile",
      "content": "这里有个问题",
      "username": "张三",
      "status": "new",
      "session": "2026-10-21-000123",
      "createdAt": 1761004800000
    }
  ]
}
```

### POST /update-status

更新意见状态（需要管理员密钥）。

**Request Body：**

```json
{
  "ids": ["feedback_xxxx", "feedback_yyyy"],
  "status": "implemented",
  "note": "已修复",
  "key": "fsdk-admin-2026",
  "version": "0.1"
}
```

**必填字段：** `ids`、`status`、`key`

**Response：**

```json
{
  "code": 0,
  "message": "ok",
  "updated": 2
}
```

### POST /remove

删除意见（需要管理员密钥）。

**Request Body：**

```json
{
  "ids": ["feedback_xxxx"],
  "key": "fsdk-admin-2026"
}
```

**Response：**

```json
{
  "code": 0,
  "message": "ok",
  "removed": 1
}
```

### GET /health

健康检查。

**Response：**

```json
{
  "ok": true,
  "service": "feedback-sdk"
}
```

---

## 5. 状态定义与工作流

每条反馈都有 `status` 字段，用于标记处理进度。

| 状态 | 含义 | 使用场景 |
|------|------|----------|
| `new` | 未处理 | 新提交的反馈，默认状态 |
| `implemented` | 已实现/已修复 | 问题已解决，功能已上线 |
| `considered` | 已采纳/待实现 | 建议合理，计划实现 |
| `rejected` | 已驳回/不采纳 | 建议不合理或不在范围内 |
| `duplicate` | 重复 | 与已有反馈重复 |

### 典型工作流

```
提交 → new（未处理）
         ↓
    评审反馈
         ↓
    ┌────┴────┬───────────┬──────────┐
    ↓         ↓           ↓          ↓
implemented  considered  rejected  duplicate
（已修复）   （待实现）   （已驳回）  （重复）
```

**处理方式：**

- 通过 SDK 代码：`updateFeedbackStatus(ids, 'implemented', '已修复')`
- 通过 CLI 工具：见下方第 7 节
- 通过 HTTP API：`POST /update-status`

---

## 6. 意见管理页面

项目提供了一个内置的 HTML 管理页面，可管理 AppID、提交意见、查看反馈列表：

```
https://feedback-sdk.david-crazyamber.deno.net/feedback
```

**功能：**
- 管理 AppID（添加、选择、删除）
- 直接提交意见（无需代码，打开即用）
- 按 AppID / 状态 / 模式过滤反馈列表
- 无需登录认证

也可以直接访问根路径，会自动跳转：

```
https://feedback-sdk.david-crazyamber.deno.net/
```

---

## 7. CLI 命令行工具

项目提供了两个 Node.js 命令行脚本，用于查询和管理反馈数据。

### 查询反馈：feedback-http.js

```bash
# 基本用法
node scripts/feedback-http.js \
  --endpoint=https://feedback-sdk.david-crazyamber.deno.net \
  --app=my-project \
  --mode=test

# 查看摘要统计
node scripts/feedback-http.js \
  --endpoint=https://feedback-sdk.david-crazyamber.deno.net \
  --app=my-project \
  --summary

# 导出为 Markdown
node scripts/feedback-http.js \
  --endpoint=https://feedback-sdk.david-crazyamber.deno.net \
  --app=my-project \
  --format=md \
  --out=feedback/latest.md

# 按条件过滤
node scripts/feedback-http.js \
  --endpoint=... \
  --status=new \
  --keyword="按钮" \
  --since=2026-10-01 \
  --until=2026-10-21 \
  --limit=50
```

**参数列表：**

| 参数 | 说明 |
|------|------|
| `--endpoint=` | 服务端地址（必填） |
| `--app=` | 按 AppID 过滤 |
| `--mode=` | 按模式过滤（dev/test/prod） |
| `--session=` | 按批次过滤 |
| `--status=` | 按状态过滤 |
| `--keyword=` | 关键词搜索 |
| `--since=` | 开始日期（YYYY-MM-DD） |
| `--until=` | 结束日期（YYYY-MM-DD） |
| `--limit=` | 限制返回数量 |
| `--format=` | 输出格式：json（默认）/ md |
| `--summary` | 输出摘要统计 |
| `--out=` | 输出到文件 |

### 管理反馈状态：feedback-status-http.js

```bash
# 更新状态
node scripts/feedback-status-http.js \
  --endpoint=https://feedback-sdk.david-crazyamber.deno.net \
  --id=feedback_xxxx \
  --status=implemented \
  --note="已修复" \
  --key=fsdk-admin-2026

# 批量更新
node scripts/feedback-status-http.js \
  --endpoint=... \
  --ids=id1,id2,id3 \
  --status=duplicate \
  --note="重复反馈" \
  --key=fsdk-admin-2026

# 删除反馈
node scripts/feedback-status-http.js \
  --endpoint=... \
  --id=feedback_xxxx \
  --remove \
  --key=fsdk-admin-2026
```

**参数列表：**

| 参数 | 说明 |
|------|------|
| `--endpoint=` | 服务端地址（必填） |
| `--id=` | 单条反馈 ID |
| `--ids=` | 多条反馈 ID（逗号分隔） |
| `--status=` | 目标状态：new / implemented / considered / rejected / duplicate |
| `--note=` | 备注 |
| `--key=` | 管理员密钥（也可设环境变量 `FEEDBACK_ADMIN_KEY`） |
| `--version=` | 迭代版本号 |
| `--remove` | 删除模式 |

---

## 8. 框架示例

### React

```jsx
import { useState } from 'react';
import { submitFeedback } from 'feedback-sdk';

export default function FeedbackButton() {
  const [content, setContent] = useState('');

  async function submit() {
    if (!content.trim()) return;
    await submitFeedback({ content: content.trim() });
    setContent('');
    alert('感谢反馈！');
  }

  return (
    <div>
      <textarea
        value={content}
        onChange={(e) => setContent(e.target.value)}
        maxLength={1000}
        placeholder="说说遇到的问题…"
      />
      <button onClick={submit}>提交</button>
    </div>
  );
}
```

### Vue 3

```vue
<template>
  <div>
    <textarea v-model="content" maxlength="1000" placeholder="说说遇到的问题…" />
    <button @click="submit">提交</button>
  </div>
</template>

<script setup>
import { ref } from 'vue';
import { submitFeedback } from 'feedback-sdk';

const content = ref('');

async function submit() {
  if (!content.value.trim()) return;
  await submitFeedback({ content: content.value.trim() });
  content.value = '';
  alert('感谢反馈！');
}
</script>
```

### uni-app

在 `App.vue` 的 `onLaunch` 中初始化，在任意页面提交：

```js
// App.vue
<script>
import { initFeedback } from 'feedback-sdk';
import config from './feedback.config.js';

export default {
  onLaunch() {
    initFeedback(config);
  },
};
</script>
```

```js
// 任意页面
<script>
import { submitFeedback } from 'feedback-sdk';

export default {
  methods: {
    async sendFeedback() {
      await submitFeedback({
        content: '这里有个问题',
        page: 'pages/order/detail',
      });
    },
  },
};
</script>
```

---

## 附录：接入清单

每个项目接入前，请确认：

- [ ] 已定义唯一的 `appId`（英文）
- [ ] 已设置 `appName`（中文，用于展示）
- [ ] 已设置 `mode`（dev / test / prod）
- [ ] 页面名称（page）使用英文标识
- [ ] 已在应用入口调用 `initFeedback(config)`
- [ ] 已验证 `submitFeedback` 能正常提交
- [ ] 已配置 `adminKey`（如需管理反馈状态）

---

## 附录：环境变量

服务端部署的环境变量：

| 变量 | 说明 |
|------|------|
| `ADMIN_KEY` | 管理员密钥，用于 `/update-status` 和 `/remove` 接口鉴权 |
| `ALLOWED_ORIGIN` | CORS 允许的来源，`*` 表示允许所有 |
