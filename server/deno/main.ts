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

async function dashboard() {
  const html = `<!DOCTYPE html>
<html lang="zh-CN">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Feedback SDK — 意见管理</title>
<style>
  * { box-sizing: border-box; margin: 0; padding: 0; }
  body { font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif; background: #f8f9fa; color: #333; padding: 24px; max-width: 800px; margin: 0 auto; }
  h1 { font-size: 22px; margin-bottom: 6px; }
  .subtitle { color: #666; font-size: 14px; margin-bottom: 24px; }
  .card { background: #fff; border-radius: 10px; box-shadow: 0 1px 4px rgba(0,0,0,0.08); padding: 20px; margin-bottom: 20px; }
  .card h2 { font-size: 16px; margin-bottom: 14px; display: flex; align-items: center; gap: 8px; }
  label { display: block; font-size: 13px; color: #555; margin-bottom: 4px; font-weight: 500; }
  input, select, textarea { width: 100%; padding: 9px 12px; border: 1px solid #ddd; border-radius: 8px; font-size: 14px; outline: none; transition: border-color .15s; }
  input:focus, select:focus, textarea:focus { border-color: #4ade80; }
  textarea { resize: vertical; min-height: 100px; }
  .row { display: flex; gap: 10px; align-items: flex-end; }
  .row > * { flex: 1; }
  button { padding: 9px 18px; border: none; border-radius: 8px; font-size: 14px; cursor: pointer; font-weight: 500; transition: opacity .15s; }
  button:hover { opacity: 0.85; }
  .btn-green { background: linear-gradient(135deg, #4ade80, #16a34a); color: #fff; }
  .btn-blue { background: linear-gradient(135deg, #60a5fa, #2563eb); color: #fff; }
  .btn-gray { background: #e5e7eb; color: #333; }
  .btn-sm { padding: 6px 12px; font-size: 12px; }
  .appid-list { display: flex; flex-wrap: wrap; gap: 8px; margin-top: 10px; }
  .appid-tag { display: inline-flex; align-items: center; gap: 6px; background: #f0f4ff; border: 1px solid #d0d8f0; border-radius: 6px; padding: 4px 10px; font-size: 13px; cursor: pointer; transition: all .15s; }
  .appid-tag:hover { background: #e0e8ff; }
  .appid-tag.active { background: #22c55e; color: #fff; border-color: #16a34a; }
  .appid-tag .remove { font-size: 11px; color: #999; cursor: pointer; margin-left: 2px; }
  .appid-tag .remove:hover { color: #e33; }
  .appid-tag.active .remove { color: rgba(255,255,255,0.7); }
  .appid-tag.active .remove:hover { color: #fff; }
  .form-group { margin-bottom: 14px; }
  .hint { font-size: 12px; color: #888; margin-top: 4px; }
  .msg { padding: 10px 14px; border-radius: 8px; font-size: 14px; margin-bottom: 14px; display: none; }
  .msg.success { background: #dcfce7; color: #166534; display: block; }
  .msg.error { background: #fee2e2; color: #991b1b; display: block; }
  table { width: 100%; border-collapse: collapse; }
  th { background: #f8f9fa; text-align: left; padding: 8px 10px; font-size: 12px; color: #666; border-bottom: 2px solid #e5e7eb; }
  td { padding: 8px 10px; border-bottom: 1px solid #f0f0f0; font-size: 13px; max-width: 260px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  tr:hover td { background: #fafafa; }
  .status-badge { padding: 2px 8px; border-radius: 4px; font-size: 11px; color: #fff; font-weight: 500; }
  .empty { text-align: center; padding: 30px; color: #aaa; font-size: 14px; }
  .flex-between { display: flex; justify-content: space-between; align-items: center; }
  .filter-bar { display: flex; gap: 10px; margin-bottom: 14px; flex-wrap: wrap; }
  .filter-bar select, .filter-bar input { width: auto; min-width: 140px; padding: 7px 10px; font-size: 13px; }
  .table-wrap { overflow-x: auto; -webkit-overflow-scrolling: touch; }
  @media (max-width: 640px) {
    body { padding: 14px; }
    h1 { font-size: 18px; }
    .card { padding: 14px; }
    .card h2 { font-size: 15px; }
    .row { flex-direction: column; gap: 10px; }
    .row > * { flex: 1 1 100%; }
    .filter-bar { flex-direction: column; gap: 8px; }
    .filter-bar select, .filter-bar input { width: 100%; min-width: 0; }
    table { font-size: 12px; }
    th, td { padding: 6px 8px; }
    td { max-width: 140px; }
  }
</style>
</head>
<body>
<h1>Feedback SDK 意见管理</h1>
<p class="subtitle">管理 AppID、提交和查看反馈意见</p>

<!-- AppID 管理 -->
<div class="card">
  <h2>📌 AppID 管理</h2>
  <div class="row">
    <div>
      <label>添加新 AppID</label>
      <input id="newAppId" type="text" placeholder="输入英文标识，如 crm-dashboard" pattern="[a-zA-Z0-9\\-]+" />
      <p class="hint">英文字母、数字、连字符，如 my-app</p>
    </div>
    <div style="flex:0 0 auto">
      <button class="btn-blue" onclick="addAppId()">添加 AppID</button>
    </div>
  </div>
  <div class="appid-list" id="appidList"></div>
</div>

<!-- 提交意见 -->
<div class="card">
  <h2>✏️ 提交意见</h2>
  <div id="submitMsg" class="msg"></div>
  <div class="form-group">
    <label>选择 AppID</label>
    <select id="submitAppId">
      <option value="">— 请先添加或选择 AppID —</option>
    </select>
  </div>
  <div class="row" style="margin-bottom:14px">
    <div>
      <label>应用名称（显示用）</label>
      <input id="submitAppName" type="text" placeholder="如：CRM 系统" />
    </div>
    <div>
      <label>页面名称（英文）</label>
      <input id="submitPage" type="text" placeholder="如 user/list" />
    </div>
    <div>
      <label>模式</label>
      <select id="submitMode">
        <option value="test">test</option>
        <option value="dev">dev</option>
        <option value="prod">prod</option>
      </select>
    </div>
  </div>
  <div class="form-group">
    <label>意见内容</label>
    <textarea id="submitContent" maxlength="1000" placeholder="说说遇到的问题或建议…"></textarea>
  </div>
  <div style="display:flex;justify-content:flex-end">
    <button class="btn-green" id="submitBtn" onclick="doSubmit()">提交意见</button>
  </div>
</div>

<!-- 反馈列表 -->
<div class="card">
  <div class="flex-between" style="margin-bottom:14px">
    <h2 style="margin:0">📋 反馈列表</h2>
    <button class="btn-gray btn-sm" onclick="loadList()">刷新</button>
  </div>
  <div class="filter-bar">
    <select id="filterAppId" onchange="loadList()">
      <option value="">全部应用</option>
    </select>
    <select id="filterStatus" onchange="loadList()">
      <option value="">全部状态</option>
      <option value="new">未处理</option>
      <option value="implemented">已实现</option>
      <option value="considered">已采纳</option>
      <option value="rejected">已驳回</option>
      <option value="duplicate">重复</option>
    </select>
    <select id="filterMode" onchange="loadList()">
      <option value="">全部模式</option>
      <option value="test">test</option>
      <option value="dev">dev</option>
      <option value="prod">prod</option>
    </select>
  </div>
  <div id="feedbackList"></div>
</div>

<script>
const STORAGE_KEY = 'feedback_sdk_appids';
const ENDPOINT = location.origin;

const statusLabels = { new: '未处理', implemented: '已实现', considered: '已采纳', rejected: '已驳回', duplicate: '重复' };
const statusColors = { new: '#3b82f6', implemented: '#22c55e', considered: '#f59e0b', rejected: '#ef4444', duplicate: '#6b7280' };

function getAppIds() {
  try { return JSON.parse(localStorage.getItem(STORAGE_KEY) || '[]'); } catch { return []; }
}
function saveAppIds(ids) {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(ids));
}

let selectedAppId = '';

function render() {
  const ids = getAppIds();
  // 渲染 AppID 标签列表
  const listEl = document.getElementById('appidList');
  if (ids.length === 0) {
    listEl.innerHTML = '<p class="hint">还没有 AppID，请在上方添加</p>';
  } else {
    listEl.innerHTML = ids.map(id =>
      '<span class="appid-tag' + (id === selectedAppId ? ' active' : '') + '" onclick="selectAppId(\\'' + esc(id) + '\\')">' +
        esc(id) +
        '<span class="remove" onclick="event.stopPropagation();removeAppId(\\'' + esc(id) + '\\')">✕</span>' +
      '</span>'
    ).join('');
  }

  // 更新提交区的 AppID 下拉
  const submitSelect = document.getElementById('submitAppId');
  submitSelect.innerHTML = '<option value="">— 选择 AppID —</option>' +
    ids.map(id => '<option value="' + esc(id) + '"' + (id === selectedAppId ? ' selected' : '') + '>' + esc(id) + '</option>').join('');

  // 更新过滤区的 AppID 下拉
  const filterSelect = document.getElementById('filterAppId');
  const currentFilter = filterSelect.value;
  filterSelect.innerHTML = '<option value="">全部应用</option>' +
    ids.map(id => '<option value="' + esc(id) + '"' + (id === currentFilter ? ' selected' : '') + '>' + esc(id) + '</option>').join('');
}

function selectAppId(id) {
  selectedAppId = (selectedAppId === id) ? '' : id;
  document.getElementById('submitAppId').value = selectedAppId;
  render();
}

function addAppId() {
  const input = document.getElementById('newAppId');
  const val = input.value.trim().replace(/[^a-zA-Z0-9\\-]/g, '');
  if (!val) { alert('请输入有效的 AppID（英文字母、数字、连字符）'); return; }
  const ids = getAppIds();
  if (!ids.includes(val)) ids.push(val);
  saveAppIds(ids);
  input.value = '';
  selectedAppId = val;
  render();
}

function removeAppId(id) {
  const ids = getAppIds().filter(x => x !== id);
  saveAppIds(ids);
  if (selectedAppId === id) selectedAppId = '';
  render();
}

function showMsg(type, text) {
  const el = document.getElementById('submitMsg');
  el.className = 'msg ' + type;
  el.textContent = text;
  setTimeout(() => { el.className = 'msg'; el.textContent = ''; }, 3000);
}

async function doSubmit() {
  const appId = document.getElementById('submitAppId').value;
  const appName = document.getElementById('submitAppName').value.trim();
  const page = document.getElementById('submitPage').value.trim();
  const mode = document.getElementById('submitMode').value;
  const content = document.getElementById('submitContent').value.trim();

  if (!appId) { showMsg('error', '请选择 AppID'); return; }
  if (!appName) { showMsg('error', '请输入应用名称'); return; }
  if (!page) { showMsg('error', '请输入页面名称（英文）'); return; }
  if (!content) { showMsg('error', '请输入意见内容'); return; }
  if (content.length > 1000) { showMsg('error', '意见内容不能超过 1000 字'); return; }

  const btn = document.getElementById('submitBtn');
  btn.disabled = true;
  btn.textContent = '提交中…';
  try {
    const res = await fetch(ENDPOINT + '/submit', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ appId, appName, mode, page, content, submittedAt: Date.now() }),
    });
    const data = await res.json();
    if (data.code === 0) {
      showMsg('success', '提交成功！');
      document.getElementById('submitContent').value = '';
      loadList();
    } else {
      showMsg('error', data.message || '提交失败');
    }
  } catch (err) {
    showMsg('error', '网络错误：' + err.message);
  } finally {
    btn.disabled = false;
    btn.textContent = '提交意见';
  }
}

async function loadList() {
  const appId = document.getElementById('filterAppId').value;
  const status = document.getElementById('filterStatus').value;
  const mode = document.getElementById('filterMode').value;

  const body = { page: 1, pageSize: 100 };
  if (appId) body.appId = appId;
  if (status) body.status = status;
  if (mode) body.mode = mode;

  try {
    const res = await fetch(ENDPOINT + '/list', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
    const data = await res.json();
    const container = document.getElementById('feedbackList');

    if (data.code !== 0) {
      container.innerHTML = '<div class="empty">加载失败</div>';
      return;
    }
    if (!data.items || data.items.length === 0) {
      container.innerHTML = '<div class="empty">暂无反馈</div>';
      return;
    }

    const fmtTime = (ts) => {
      if (!ts) return '-';
      return new Date(Number(ts)).toLocaleString('zh-CN', { timeZone: 'Asia/Shanghai' });
    };

    let html = '<div class="table-wrap"><table><thead><tr><th>内容</th><th>页面</th><th>应用</th><th>状态</th><th>时间</th></tr></thead><tbody>';
    for (const item of data.items) {
      const color = statusColors[item.status] || '#6b7280';
      const label = statusLabels[item.status] || item.status;
      html += '<tr>' +
        '<td title="' + esc(item.content) + '">' + esc(item.content) + '</td>' +
        '<td>' + esc(item.page || '-') + '</td>' +
        '<td>' + esc(item.appName || item.appId) + '</td>' +
        '<td><span class="status-badge" style="background:' + color + '">' + esc(label) + '</span></td>' +
        '<td>' + fmtTime(item.createdAt) + '</td>' +
        '</tr>';
    }
    html += '</tbody></table></div>';
    if (data.total > 100) html += '<p class="hint" style="text-align:center;margin-top:10px">显示最新 100 条，共 ' + data.total + ' 条</p>';
    container.innerHTML = html;
  } catch (err) {
    document.getElementById('feedbackList').innerHTML = '<div class="empty">加载失败：' + esc(err.message) + '</div>';
  }
}

function esc(s) {
  return String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

// 初始化
render();
loadList();
</script>
</body>
</html>`;

  return new Response(html, {
    headers: { 'Content-Type': 'text/html; charset=utf-8' },
  });
}

Deno.serve({ port: Number(Deno.env.get('PORT')) || 8787 }, async (req, info) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { status: 204, headers: CORS });
  }

  const url = new URL(req.url);
  if (req.method === 'GET' && url.pathname === '/health') {
    return json({ ok: true, service: 'feedback-sdk' });
  }
  if (req.method === 'GET' && url.pathname === '/feedback') {
    return await dashboard();
  }
  if (req.method === 'GET' && url.pathname === '/') {
    return new Response(null, { status: 302, headers: { Location: '/feedback' } });
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
