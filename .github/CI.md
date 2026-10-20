# feedback-sdk — CI

推 main：check + deploy preview
打 tag `v*.*.*`：check + deploy prod

## 必需配置

### GitHub Repo → Settings → Secrets and variables

Secrets:

- `ADMIN_KEY` — 管理 key（用于 /update-status /remove）

Variables（可选，有默认值）:

- `DENO_PROJECT` — Deno Deploy 项目名，默认 `feedback-sdk`
- `ALLOWED_ORIGIN` — CORS 允许源，默认 `*`

### Deno Deploy

本 workflow 使用 OIDC（`id-token: write`），不需要 `DEPLOY_TOKEN`。
首次部署前，到 https://dash.deno.com 新建项目 `feedback-sdk`，
并在项目 Settings → GitHub Repository 里关联这个仓库。
