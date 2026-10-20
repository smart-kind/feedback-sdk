#!/usr/bin/env node
/**
 * 读取 Deno KV 后端的反馈（HTTP，无依赖）。
 *
 * 用法:
 *   node scripts/feedback-http.js --endpoint=https://xxx.deno.dev --app=your-app-id --mode=test
 *   node scripts/feedback-http.js --endpoint=... --summary
 *   node scripts/feedback-http.js --endpoint=... --out=feedback/latest.json
 *   node scripts/feedback-http.js --endpoint=... --format=md --out=feedback/latest.md
 *
 * 可选过滤: --session --status --keyword --since --until --limit
 */

import fs from 'node:fs';
import path from 'node:path';

const PAGE_SIZE = 100;
const MAX_PAGES = 1000;

function readArg(argv, name, fallback = '') {
  const prefix = `--${name}=`;
  const hit = argv.find((arg) => arg.startsWith(prefix));
  return hit ? hit.slice(prefix.length) : fallback;
}

function parseDay(value, endOfDay) {
  if (!value) return null;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) throw new Error(`日期格式应为 YYYY-MM-DD: ${value}`);
  const date = new Date(`${value}T${endOfDay ? '23:59:59.999' : '00:00:00.000'}`);
  if (Number.isNaN(date.getTime())) throw new Error(`无效日期: ${value}`);
  return date.getTime();
}

function countBy(items, pick, fallback = '(空)') {
  const counts = new Map();
  for (const item of items) {
    const key = pick(item) || fallback;
    counts.set(key, (counts.get(key) || 0) + 1);
  }
  return [...counts.entries()].sort((a, b) => b[1] - a[1]);
}

function formatCounts(entries) {
  return entries.map(([key, count]) => `${key} ${count}`).join(' / ') || '无';
}

function summary(items) {
  return [
    `测试意见：${items.length} 条`,
    `状态：${formatCounts(countBy(items, (i) => i.status))}`,
    `应用：${formatCounts(countBy(items, (i) => i.appName, '(旧数据)'))}`,
    `模式：${formatCounts(countBy(items, (i) => i.mode, '(旧数据)'))}`,
    `页面：${formatCounts(countBy(items, (i) => i.page))}`,
    `批次：${formatCounts(countBy(items, (i) => i.session))}`,
    `版本：${formatCounts(countBy(items, (i) => i.iterationVersion, '(旧数据)'))}`,
    `未处理：${items.filter((i) => !i.status || i.status === 'new').length} 条`,
  ].join('\n');
}

function formatTime(ms) {
  if (!ms) return '';
  const d = new Date(Number(ms));
  const pad = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

function markdown(items) {
  const lines = [`# 测试意见汇总`, '', `生成时间：${formatTime(Date.now())}`, `共 ${items.length} 条`, ''];
  const groups = new Map();
  for (const item of items) {
    const key = item.session || '(无批次)';
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(item);
  }
  for (const [group, list] of groups) {
    lines.push(`## ${group}（${list.length} 条）`, '');
    list.forEach((item, index) => {
      lines.push(`### ${index + 1}. ${formatTime(item.createdAt)} · ${item.page || '(未知页面)'}`, '');
      lines.push(`- 状态：${item.status || '未标记'}`);
      lines.push(`- 账号：${item.username || '匿名'}`);
      if (item.iterationVersion) lines.push(`- 迭代版本：${item.iterationVersion}`);
      if (item.appName || item.mode) lines.push(`- 应用：${item.appName || ''}${item.mode ? ` · ${item.mode}` : ''}`);
      lines.push('- 内容：');
      for (const line of String(item.content || '').split('\n')) lines.push(`  > ${line}`);
      lines.push('');
    });
  }
  return lines.join('\n');
}

async function main() {
  const argv = process.argv.slice(2);
  if (argv.includes('--help') || argv.includes('-h')) {
    console.log(`读取 Deno KV 反馈

用法:
  node scripts/feedback-http.js --endpoint=<url> [--app=] [--mode=] [--summary] [--out=]

可选: --session --status --keyword --since --until --limit --format=json|md`);
    return;
  }

  const endpoint = readArg(argv, 'endpoint').replace(/\/+$/, '');
  if (!endpoint) throw new Error('缺少 --endpoint=https://xxx.deno.dev');
  const appId = readArg(argv, 'app');
  const mode = readArg(argv, 'mode');
  const session = readArg(argv, 'session');
  const status = readArg(argv, 'status');
  const keyword = readArg(argv, 'keyword').toLowerCase();
  const since = parseDay(readArg(argv, 'since'), false);
  const until = parseDay(readArg(argv, 'until'), true);
  const limit = parseInt(readArg(argv, 'limit', '0'), 10) || 0;
  const format = readArg(argv, 'format', 'json');
  const out = readArg(argv, 'out');
  const wantSummary = argv.includes('--summary');

  const all = [];
  let total = 0;
  for (let page = 1; page <= MAX_PAGES; page++) {
    const res = await fetch(`${endpoint}/list`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ page, pageSize: PAGE_SIZE, session, appId, mode }),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok || data.code !== 0) throw new Error(data.message || `HTTP ${res.status}`);
    total = data.total || 0;
    const batch = Array.isArray(data.items) ? data.items : [];
    all.push(...batch);
    if (batch.length === 0 || all.length >= total) break;
  }

  let items = all.filter((item) => {
    if (status && item.status !== status) return false;
    if (since !== null && Number(item.createdAt) < since) return false;
    if (until !== null && Number(item.createdAt) > until) return false;
    if (keyword) {
      const haystack = `${item.content || ''} ${item.page || ''} ${item.username || ''}`.toLowerCase();
      if (!haystack.includes(keyword)) return false;
    }
    return true;
  });
  items.sort((a, b) => Number(b.createdAt) - Number(a.createdAt));
  if (limit > 0) items = items.slice(0, limit);

  const output = wantSummary ? summary(items) : format === 'md' ? markdown(items) : JSON.stringify({ total: items.length, items }, null, 2);

  if (out) {
    const file = path.resolve(process.cwd(), out);
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, `${output}\n`, 'utf8');
    console.log(`已写入 ${file}（${items.length}/${total} 条，格式 ${wantSummary ? 'summary' : format}）`);
  } else {
    console.log(output);
  }
}

main().catch((err) => {
  console.error('读取失败:', err.message);
  process.exit(1);
});
