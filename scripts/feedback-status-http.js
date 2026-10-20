#!/usr/bin/env node
/**
 * 更新 Deno KV 后端的反馈状态（HTTP，无依赖）。
 *
 * 用法:
 *   node scripts/feedback-status-http.js --endpoint=https://xxx.deno.dev \
 *     --id=<_id> --status=implemented --note="已修复" --key=<ADMIN_KEY>
 *
 *   node scripts/feedback-status-http.js --endpoint=... --ids=id1,id2 --status=duplicate --note="测试记录" --key=...
 *   node scripts/feedback-status-http.js --endpoint=... --id=<_id> --remove --key=...
 *
 * 状态: new / implemented / considered / rejected / duplicate
 */

const ALLOWED = ['new', 'implemented', 'considered', 'rejected', 'duplicate'];

function readArg(argv, name, fallback = '') {
  const prefix = `--${name}=`;
  const hit = argv.find((arg) => arg.startsWith(prefix));
  return hit ? hit.slice(prefix.length) : fallback;
}

async function main() {
  const argv = process.argv.slice(2);
  if (argv.includes('--help') || argv.includes('-h')) {
    console.log(`更新 Deno KV 反馈状态

用法:
  node scripts/feedback-status-http.js --endpoint=<url> --id=<_id> --status=<状态> --key=<ADMIN_KEY> [--note=]
  node scripts/feedback-status-http.js --endpoint=<url> --ids=id1,id2 --status=duplicate --key=...
  node scripts/feedback-status-http.js --endpoint=<url> --id=<_id> --remove --key=...`);
    return;
  }

  const endpoint = readArg(argv, 'endpoint').replace(/\/+$/, '');
  if (!endpoint) throw new Error('缺少 --endpoint=https://xxx.deno.dev');
  const key = readArg(argv, 'key') || process.env.FEEDBACK_ADMIN_KEY || '';
  if (!key) throw new Error('缺少 --key 或 FEEDBACK_ADMIN_KEY');
  const rawIds = `${readArg(argv, 'ids')},${readArg(argv, 'id')}`;
  const ids = [...new Set(rawIds.split(',').map((id) => id.trim()).filter(Boolean))];
  if (ids.length === 0) throw new Error('缺少 --id 或 --ids');
  const isRemove = argv.includes('--remove');

  if (isRemove) {
    const res = await fetch(`${endpoint}/remove`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ids, key }),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok || data.code !== 0) throw new Error(data.message || `HTTP ${res.status}`);
    console.log(`已删除 ${data.removed || 0} 条`);
    return;
  }

  const status = readArg(argv, 'status');
  if (!ALLOWED.includes(status)) throw new Error(`--status 不合法，可选：${ALLOWED.join(' / ')}`);
  const note = readArg(argv, 'note');
  const version = readArg(argv, 'version');

  const res = await fetch(`${endpoint}/update-status`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ ids, status, note, key, version }),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok || data.code !== 0) throw new Error(data.message || `HTTP ${res.status}`);
  console.log(`已更新 ${data.updated || 0} 条 -> ${status}${version ? `（版本 ${version}）` : ''}`);
  console.log(`ids: ${ids.join(', ')}`);
}

main().catch((err) => {
  console.error('更新失败:', err.message);
  process.exit(1);
});
