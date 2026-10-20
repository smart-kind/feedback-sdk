# feedback-sdk

通用意见收集 **JS SDK**。无 UI、无框架依赖、无 npm 依赖。

页面只调用 SDK 函数：

```js
submitFeedback({ content: '这里有个问题' });
```

SDK 内部负责补 `appId / appName / mode / page / submittedAt / username / session`，
并把请求发到 Deno KV（默认）或 uniCloud（可选）。UI 由你自己的页面决定，Vue、React、原生都可以。

一条意见固定带上：

- `appId` / `appName` / `mode`
- `page`
- `content`
- `submittedAt`（客户端时间）+ `createdAt`（服务端时间）
- `username`（空则匿名）
- `session`
- `iterationVersion` / `appVersion` / `platform`
- `clientIP`（服务端补）

## 架构

```
你的页面（自己写按钮/弹窗）
        │  submitFeedback({ content })
        ▼
feedback-sdk js_sdk（自动补参数，选择 transport）
        │  HTTP /submit      或 uniCloud.importObject('feedback-center')
        ▼
Deno Deploy + Deno KV（默认） 或 uniCloud（可选）
        ▼
scripts/feedback-http.js（读回/筛选/导出）
scripts/feedback-status-http.js（状态/删除）
```

## 目录

```
feedback-sdk/
├── js_sdk/
│   ├── index.js              # initFeedback / submitFeedback / listFeedback
│   └── index.d.ts
├── server/
│   └── deno/
│       └── main.ts           # Deno Deploy + Deno KV 后端
├── scripts/
│   ├── feedback-http.js
│   └── feedback-status-http.js
├── examples/
│   ├── vue/FeedbackButton.vue
│   └── react/FeedbackButton.jsx
└── README.md
```

## 安装

### 方式 A：复制到项目

把整个 `feedback-sdk/` 复制到项目的 `uni_modules/feedback-sdk/`，然后：

```js
import { initFeedback, submitFeedback } from '@/uni_modules/feedback-sdk/js_sdk/index.js';
```

### 方式 B：npm / file 依赖

```bash
npm install ../feedback-sdk
```

```js
import { initFeedback, submitFeedback } from 'feedback-sdk';
```

## 初始化

在 `main.js` / `main.ts` / `App.vue` 里初始化一次：

```js
import { initFeedback } from 'feedback-sdk';
import config from './feedback.config.js';

initFeedback(config);
```

`feedback.config.js` 用「backend 名字 + 同名对象」的结构，每个后端自带 `enabled` 开关：

```js
export default {
  appId: 'your-app-id',
  appName: '你的应用名',
  mode: 'test',
  iterationVersion: '0.1',

  backend: 'deno',

  deno: {
    enabled: true,
    endpoint: 'https://your-feedback.deno.dev',
    headers: {},
    timeout: 15000,
  },

  unicloud: {
    enabled: false,
    cloudObject: 'feedback-center',
    spaceId: 'env-xxxxxxxx',
    spaceAppId: '2021xxxxxxxx',
    endpoint: 'https://env-xxxxxxxx.api-hz.cloudbasefunction.cn',
  },

  historyScope: 'app',
};
```

`backend: 'unicloud'` 就切到 `unicloud` 对象。把被选中的对象设成 `enabled: false` 会直接报错，
不会悄悄换后端。

## 页面里怎么用

SDK **不提供按钮或弹窗**。页面自己写 UI，点击后调用：

```js
import { submitFeedback } from 'feedback-sdk';

await submitFeedback({ content: '地点输入后一直提示输入中' });
```

Vue 示例见 `examples/vue/FeedbackButton.vue`：

```vue
<script setup>
import { submitFeedback } from 'feedback-sdk';
async function submit() {
  await submitFeedback({ content: '这里有个问题' });
}
</script>

<template>
  <button @click="submit">意见</button>
</template>
```

React 示例见 `examples/react/FeedbackButton.jsx`：

```jsx
import { submitFeedback } from 'feedback-sdk';

<button onClick={() => submitFeedback({ content: '这里有个问题' })}>
  意见
</button>;
```

如果要显示历史意见，调用 `listFeedback({ page: 1, pageSize: 20, appId, mode })`，
返回 `{ code, total, items }`，自己渲染列表即可。

## 配置项

| 字段               | 必填 | 说明                                                                    |
| ------------------ | ---- | ----------------------------------------------------------------------- |
| `appId`            | 是   | 应用唯一标识                                                            |
| `appName`          | 是   | 应用显示名                                                              |
| `mode`             | 是   | `dev` / `test` / `prod`                                                 |
| `iterationVersion` | 否   | 短版本号，随意见保存                                                    |
| `backend`          | 否   | 用哪个后端，取同名对象；默认 `unicloud`                                 |
| `deno`             | 否   | Deno 后端配置：`enabled` / `endpoint` / `headers` / `timeout`           |
| `unicloud`         | 否   | uniCloud 后端配置：`enabled` / `cloudObject` / `spaceId` / `spaceAppId` |
| `historyScope`     | 否   | `app`（默认）或 `all`，用于 list 默认范围                               |
| `adminKey`         | 否   | 仅管理工具用，不要放进 App                                              |
| `transport`        | 否   | 自定义传输层，优先级最高                                                |
| `runtime`          | 否   | 运行时桥接，见下文 uniCloud 一节                                        |

后端对象里的 `type` 不填也行：`unicloud` 默认 `unicloud`，其他名字默认 `http`。
换句话说，接 Cloudflare、Vercel、自建服务时，起一个 `cloudflare: { enabled: true, endpoint }`，
再把 `backend` 改成 `'cloudflare'` 就能用。

## Deno 后端

`server/deno/main.ts` 用 `Deno.serve` + `Deno.openKv`，零第三方依赖。

```bash
deployctl deploy --project=your-feedback server/deno/main.ts
```

环境变量：

| 变量             | 说明                                      |
| ---------------- | ----------------------------------------- |
| `ADMIN_KEY`      | 管理 key，`update-status` / `remove` 必填 |
| `ALLOWED_ORIGIN` | CORS 允许的源，默认 `*`                   |

本地运行：

```bash
PORT=8787 ADMIN_KEY=test-admin \
  deno run --allow-net --allow-env --unstable-kv server/deno/main.ts
```

接口：

| 接口                  | 用途                                     |
| --------------------- | ---------------------------------------- |
| `POST /submit`        | 提交意见                                 |
| `POST /list`          | 分页读取，支持 appId/mode/session/status |
| `POST /update-status` | 写回状态，需要 ADMIN_KEY                 |
| `POST /remove`        | 删除测试记录，需要 ADMIN_KEY             |
| `GET /health`         | 健康检查                                 |

KV key：

```js
['feedback', appId, mode, createdAt, id] -> 记录
['feedback_id', id] -> 主 key
```

## 读回与状态

```bash
node scripts/feedback-http.js --endpoint=https://xxx.deno.dev --app=your-app-id --mode=test --summary
node scripts/feedback-http.js --endpoint=https://xxx.deno.dev --app=your-app-id --mode=test --out=feedback/latest.json
node scripts/feedback-http.js --endpoint=https://xxx.deno.dev --app=your-app-id --mode=test --format=md --out=feedback/latest.md
node scripts/feedback-status-http.js --endpoint=https://xxx.deno.dev --id=<_id> --status=implemented --note="已修复 0.2" --key=<ADMIN_KEY>
node scripts/feedback-status-http.js --endpoint=https://xxx.deno.dev --id=<_id> --remove --key=<ADMIN_KEY>
```

状态：`new / implemented / considered / rejected / duplicate`。

## Deno 免费额度

Deno Deploy Free：

- 100 万请求/月
- 20 GiB 出网/月
- 10 CPU 小时/月
- Deno KV：1 GiB、100 万读单位/月、50 万写单位/月
- 10 个应用

一条意见 ≈ 1 请求 + 1 KV 写；50 万写/月 ≈ 1.6 万条/天。免费额度内 $0，超出需要主动升级。

来源：[Deno Deploy pricing](https://deno.com/deploy/pricing)

## uniCloud 后备

SDK 保留 uniCloud 后端，切法只有一行：

```js
import { initFeedback } from 'feedback-sdk';
import config from './feedback.config.js';

initFeedback({ ...config, backend: 'unicloud' });
```

此时 `config.unicloud.enabled` 要是 `true`（默认示例里是 `false`，切过去前改一下），
页面依然只调用 `submitFeedback`，不会 import `uniCloud`；依赖被封装在 SDK 的 transport 里。
云对象模板在 `uniCloud/cloudfunctions/feedback-center/`。

uni-app 的 H5 CLI 构建里，`node_modules` 中的代码拿不到构建期注入的 `uni` / `uniCloud`。
在 App 的 service 层（不是页面）把运行时能力传进去即可：

```js
initFeedback({
  ...config,
  backend: 'unicloud',
  runtime: {
    getStorage: (key) => uni.getStorageSync(key),
    setStorage: (key, value) => uni.setStorageSync(key, value),
    getCurrentRoute: () => `/${getCurrentPages().pop().route}`,
    getAppVersion: () => uni.getAppBaseInfo?.().appVersion || '',
    getPlatform: () => uni.getSystemInfoSync().platform || '',
    getUniCloud: () => uniCloud,
  },
});
```

不传 `runtime` 时，SDK 会退回 `globalThis.uni` / `globalThis.uniCloud` / `localStorage`，
原生 App 和小程序里通常不需要这段桥接。

## 自定义 HTTP / 其他后端

```js
initFeedback({
  appId: 'your-app-id',
  appName: '你的应用',
  mode: 'test',
  transport: {
    submit: (payload) => http.post('/submit', payload),
    list: (params) => http.post('/list', params),
    updateStatus: (args) => http.post('/update-status', args),
    remove: (args) => http.post('/remove', args),
  },
});
```

## 安全

- `submit` / `list` 免登录；正式上线建议给 `list` 加管理端鉴权或访问限制。
- `update-status` / `remove` 必须用 `ADMIN_KEY`，只放管理工具/服务端，不要打进 App。
- `ALLOWED_ORIGIN` 正式环境不要用 `*`。
- 开放 `submit` 建议加简单限流/防刷。
- 定期 `--out` 导出备份；Deno KV 没有自动备份。

## License

MIT
