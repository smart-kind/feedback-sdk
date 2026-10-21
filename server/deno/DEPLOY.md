# Deno Deploy 部署指南

## 部署命令

```bash
cd /Users/david/_projects/3_collaborative/projects/feedback-sdk
deno deploy server/deno/main.ts --org david-crazyamber --app feedback-sdk --prod --non-interactive
```

**就这一条命令。不要用 deployctl，不要用脚本。**

## 前置条件

1. **deno 版本**: 必须 >= 2.x（`deno --version` 确认）
   - Homebrew: `/opt/homebrew/bin/deno`
   - 手动安装: `~/.deno/bin/deno`

2. **登录**: 首次使用需要 `deno login`，浏览器授权后凭证存在 keychain

3. **deno.json 配置**: 必须包含 `deploy.entrypoint`

## deno.json 关键配置

```json
{
  "unstable": ["kv"],
  "deploy": {
    "org": "david-crazyamber",
    "app": "feedback-sdk",
    "entrypoint": "server/deno/main.ts"
  }
}
```

- `unstable: ["kv"]` — 启用 Deno KV（unstable API）
- `deploy.org` — Deno Deploy 组织 slug
- `deploy.app` — 应用名
- `deploy.entrypoint` — **必须写**，否则构建报 `No runtime entrypoint provided`

## 环境变量设置

部署成功后设置：

```bash
deno deploy env set ADMIN_KEY=fsdk-admin-2026 --org david-crazyamber --app feedback-sdk
deno deploy env set ALLOWED_ORIGIN=* --org david-crazyamber --app feedback-sdk
```

## 验证部署

```bash
curl https://feedback-sdk.david-crazyamber.deno.net/health
# 期望返回: {"ok":true,"service":"feedback-sdk"}
```

## 常用子命令

```bash
# 列出组织
deno deploy orgs --json --non-interactive

# 列出部署历史
deno deploy deployments list --org david-crazyamber --app feedback-sdk --json --non-interactive

# 查看日志
deno deploy logs --org david-crazyamber --app feedback-sdk

# 查看当前登录身份
deno deploy whoami --json --non-interactive
```

## 踩过的坑

| 错误 | 原因 | 解决 |
|------|------|------|
| `No runtime entrypoint provided` | deno.json 缺 `deploy.entrypoint` | 加上 `"entrypoint": "server/deno/main.ts"` |
| `TS2551: Property 'openKv' does not exist` | 缺少 unstable 配置 | deno.json 加 `"unstable": ["kv"]`，文件头加 `// @ts-nocheck` |
| `You have exceeded the deployment limit of 15 per hour` | 免费计划限频 | 等一小时再部署 |
| 用 deployctl | 工具链混乱 | **不用 deployctl**，只用 `deno deploy` |

## 本地开发

```bash
# 启动本地服务
deno task serve

# 类型检查
deno check server/deno/main.ts

# 完整检查
deno task check
```
