// @ts-nocheck
/**
 * feedback-sdk — Deno Deploy + Deno KV 后端模板
 *
 * 部署:
 *   deno deploy server/deno/main.ts --org <org> --app <app> --prod
 *   或在 Deno Deploy 控制台新建项目，入口文件指向 main.ts
 *
 * 环境变量:
 *   ADMIN_KEY       管理 key（update-status / remove 必填）
 *   ALLOWED_ORIGIN  CORS 允许的源，默认 *
 *
 * 本地运行:
 *   deno run --allow-net --allow-env --unstable-kv main.ts
 */

const kv = await Deno.openKv();

const ADMIN_KEY = Deno.env.get('ADMIN_KEY') || '';
const ALLOWED_ORIGIN = Deno.env.get('ALLOWED_ORIGIN') || '*';
const ALLOWED_MODES = ['dev', 'test', 'prod'];
const ALLOWED_STATUS = ['new', 'implemented', 'considered', 'rejected', 'duplicate'];
const MAX_CONTENT = 1000;

const CORS = {
  'Access-Control-Allow-Origin': ALLOWED_ORIGIN,
  'Access-Control-Allow-Methods': 'POST, GET, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, x-feedback-client',
  'Access-Control-Max-Age': '86400',
};

function json(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { ...CORS, 'Content-Type': 'application/json; charset=utf-8' },
  });
}

function text(value, max = 300) {
  return typeof value === 'string' ? value.trim().slice(0, max) : '';
}

function positiveInt(value, fallback, max) {
  const parsed = parseInt(String(value ?? ''), 10);
  if (!Number.isFinite(parsed) || parsed < 1) return fallback;
  return max ? Math.min(parsed, max) : parsed;
}

function clientIP(req, info) {
  const forwarded = req.headers.get('x-forwarded-for');
  if (forwarded) return forwarded.split(',')[0].trim();
  return info?.remoteAddr?.hostname || '';
}

async function readBody(req) {
  try {
    const data = await req.json();
    return data && typeof data === 'object' && !Array.isArray(data) ? data : {};
  } catch {
    return {};
  }
}

function feedbackKey(appId, mode, createdAt, id) {
  return ['feedback', appId, mode, createdAt, id];
}

async function submit(req, info) {
  const data = await readBody(req);
  const content = text(data.content, MAX_CONTENT + 1);
  const appId = text(data.appId, 64);
  const appName = text(data.appName, 64);
  const mode = text(data.mode, 16);
  const page = text(data.page, 300);

  if (!appId || !appName || !ALLOWED_MODES.includes(mode) || !page) {
    return json({ code: 400, message: '缺少 appId / appName / mode / page 参数' });
  }
  if (!content || content.length > MAX_CONTENT) {
    return json({ code: 400, message: '请填写意见内容（最多 1000 字）' });
  }

  const id = crypto.randomUUID();
  const createdAt = Date.now();
  const submittedAt = Number(data.submittedAt) > 0 ? Number(data.submittedAt) : createdAt;
  const record = {
    _id: id,
    appId,
    appName,
    mode,
    page,
    content,
    username: text(data.username, 64),
    session: text(data.session, 64),
    submittedAt,
    createdAt,
    iterationVersion: text(data.meta?.iterationVersion, 16),
    appVersion: text(data.meta?.appVersion, 64),
    platform: text(data.meta?.platform, 32),
    clientIP: clientIP(req, info),
    status: 'new',
    note: '',
    meta: data.meta && typeof data.meta === 'object' ? data.meta : {},
  };

  const key = feedbackKey(appId, mode, createdAt, id);
  await kv.atomic()
    .set(key, record)
    .set(['feedback_id', id], key)
    .commit();

  return json({ code: 0, id });
}

async function list(req) {
  const data = await readBody(req);
  const page = positiveInt(data.page, 1);
  const pageSize = positiveInt(data.pageSize, 20, 100);
  const appId = text(data.appId, 64);
  const mode = text(data.mode, 16);
  const session = text(data.session, 64);
  const status = text(data.status, 32);

  const prefix = appId ? mode ? ['feedback', appId, mode] : ['feedback', appId] : ['feedback'];

  const items = [];
  for await (const entry of kv.list({ prefix })) {
    const value = entry.value;
    if (!value || typeof value !== 'object') continue;
    if (mode && !appId && value.mode !== mode) continue;
    if (session && value.session !== session) continue;
    if (status && value.status !== status) continue;
    items.push(value);
  }

  items.sort((a, b) => Number(b.createdAt) - Number(a.createdAt));
  const total = items.length;
  const start = (page - 1) * pageSize;
  return json({ code: 0, total, items: items.slice(start, start + pageSize) });
}

async function updateStatus(req) {
  const data = await readBody(req);
  if (!ADMIN_KEY || data.key !== ADMIN_KEY) {
    return json({ code: 403, message: '无权限' });
  }
  const status = text(data.status, 32);
  if (!ALLOWED_STATUS.includes(status)) {
    return json({ code: 400, message: `状态不合法，可选：${ALLOWED_STATUS.join(' / ')}` });
  }
  const ids = (Array.isArray(data.ids) ? data.ids : [data.ids])
    .filter((id) => typeof id === 'string' && id)
    .slice(0, 100);
  const note = text(data.note, 500);
  const version = text(data.version, 16);

  let updated = 0;
  for (const id of ids) {
    const index = await kv.get(['feedback_id', id]);
    const mainKey = index.value;
    if (!mainKey) continue;
    const current = await kv.get(mainKey);
    const record = current.value;
    if (!record) continue;
    await kv.set(mainKey, {
      ...record,
      status,
      note,
      processedAt: Date.now(),
      processedVersion: version,
    });
    updated++;
  }
  return json({ code: 0, updated });
}

async function remove(req) {
  const data = await readBody(req);
  if (!ADMIN_KEY || data.key !== ADMIN_KEY) {
    return json({ code: 403, message: '无权限' });
  }
  const ids = (Array.isArray(data.ids) ? data.ids : [data.ids])
    .filter((id) => typeof id === 'string' && id)
    .slice(0, 100);

  let removed = 0;
  for (const id of ids) {
    const index = await kv.get(['feedback_id', id]);
    const mainKey = index.value;
    if (!mainKey) continue;
    await kv.atomic()
      .delete(mainKey)
      .delete(['feedback_id', id])
      .commit();
    removed++;
  }
  return json({ code: 0, removed });
}

Deno.serve({ port: Number(Deno.env.get('PORT')) || 8787 }, async (req, info) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { status: 204, headers: CORS });
  }

  const url = new URL(req.url);
  if (req.method === 'GET' && url.pathname === '/health') {
    return json({ ok: true, service: 'feedback-sdk' });
  }
  if (req.method !== 'POST') {
    return json({ code: 405, message: 'Method Not Allowed' }, 405);
  }

  try {
    switch (url.pathname) {
      case '/submit':
        return await submit(req, info);
      case '/list':
        return await list(req);
      case '/update-status':
        return await updateStatus(req);
      case '/remove':
        return await remove(req);
      default:
        return json({ code: 404, message: 'Not Found' }, 404);
    }
  } catch (err) {
    console.error('[feedback-sdk]', err);
    return json({ code: 500, message: err?.message || '服务异常' });
  }
});
