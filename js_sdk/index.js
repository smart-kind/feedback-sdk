/**
 * feedback-sdk — 通用意见收集 SDK（uni-app / uniCloud / Deno）
 *
 * 后端由 config.backend 指定：取 config 里同名的对象配置。
 *   backend: 'deno'      → config.deno      { enabled, endpoint, ... }  走 HTTP
 *   backend: 'unicloud'  → config.unicloud  { enabled, cloudObject }    走 uniCloud.importObject
 * 也可以传入自定义 transport，在任意环境里复用同一套提交参数。
 *
 * 用法:
 *   import { initFeedback, submitFeedback } from 'feedback-sdk';
 *   import config from './feedback.config.js';
 *   initFeedback(config);
 *   await submitFeedback({ content: '这里有个问题' });
 */

const DEFAULT_CLOUD_OBJECT = 'feedback-center';
const SESSION_KEY = 'feedback_session';
const ALLOWED_MODES = ['dev', 'test', 'prod'];

let activeClient = null;

function pad2(value) {
  return value < 10 ? `0${value}` : String(value);
}

function normalizeConfig(config) {
  if (!config || typeof config !== 'object') {
    throw new Error('[feedback-sdk] 缺少 config，请先调用 initFeedback(config)');
  }
  const appId = String(config.appId || '').trim();
  const appName = String(config.appName || '').trim();
  const mode = String(config.mode || '').trim();
  if (!appId) throw new Error('[feedback-sdk] config.appId 不能为空');
  if (!appName) throw new Error('[feedback-sdk] config.appName 不能为空');
  if (!ALLOWED_MODES.includes(mode)) {
    throw new Error(`[feedback-sdk] config.mode 必须是 ${ALLOWED_MODES.join(' / ')}`);
  }
  const hasCustomTransport = config.transport && typeof config.transport === 'object' &&
    typeof config.transport.submit === 'function' && typeof config.transport.list === 'function';
  const backendName = String(
    config.backend ||
      (config.deno && config.deno.enabled
        ? 'deno'
        : config.unicloud && config.unicloud.enabled
        ? 'unicloud'
        : 'unicloud'),
  );
  const backendObject = config[backendName];
  const isLegacyBackend = backendName === 'http' || backendName === 'unicloud';
  if (
    !hasCustomTransport && (!backendObject || typeof backendObject !== 'object') && !isLegacyBackend
  ) {
    throw new Error(
      `[feedback-sdk] config.backend = "${backendName}"，但缺少同名配置对象 config.${backendName}`,
    );
  }
  const backendConfig = backendObject && typeof backendObject === 'object' ? backendObject : {};
  if (!hasCustomTransport && backendConfig.enabled === false) {
    throw new Error(`[feedback-sdk] backend "${backendName}" 已禁用（enabled: false）`);
  }
  const backendType = backendConfig.type || (backendName === 'unicloud' ? 'unicloud' : 'http');

  return {
    ...config,
    appId,
    appName,
    mode,
    backend: backendName,
    backendType,
    backendConfig,
    endpoint: String(backendConfig.endpoint || config.endpoint || '').replace(/\/+$/, ''),
    headers: backendConfig.headers && typeof backendConfig.headers === 'object'
      ? backendConfig.headers
      : config.headers && typeof config.headers === 'object'
      ? config.headers
      : {},
    timeout: Number(backendConfig.timeout || config.timeout) > 0
      ? Number(backendConfig.timeout || config.timeout)
      : 15000,
    iterationVersion: String(config.iterationVersion || ''),
    cloudObject: String(backendConfig.cloudObject || config.cloudObject || DEFAULT_CLOUD_OBJECT),
  };
}

function runtimeOf(config) {
  return (config && config.runtime) || {};
}

// 不要直接用 uni / uniCloud 标识符：
// uni-app 的 H5 编译器会把 `uni.xxx` 改写成构建期 import，node_modules 里的代码会被改坏。
function globalUni() {
  const u = typeof globalThis !== 'undefined' ? globalThis.uni : undefined;
  return u && typeof u.getStorageSync === 'function' ? u : null;
}

function getUniCloud(config) {
  const runtime = runtimeOf(config);
  if (typeof runtime.getUniCloud === 'function') {
    try {
      const injected = runtime.getUniCloud();
      if (injected && typeof injected.importObject === 'function') return injected;
    } catch {
      // 注入失败时退回全局
    }
  }
  const cloud = typeof globalThis !== 'undefined' ? globalThis.uniCloud : undefined;
  return cloud && typeof cloud.importObject === 'function' ? cloud : null;
}

function readLocal(key) {
  try {
    return typeof localStorage !== 'undefined' ? localStorage.getItem(key) : null;
  } catch {
    return null;
  }
}

function writeLocal(key, value) {
  try {
    if (typeof localStorage !== 'undefined') localStorage.setItem(key, String(value));
  } catch {
    // 隐私模式下写入失败，忽略
  }
}

function getStorage(config, key) {
  const runtime = runtimeOf(config);
  if (typeof runtime.getStorage === 'function') {
    try {
      return runtime.getStorage(key);
    } catch {
      return null;
    }
  }
  const u = globalUni();
  if (u) {
    try {
      return u.getStorageSync(key);
    } catch {
      return null;
    }
  }
  return readLocal(key);
}

function setStorage(config, key, value) {
  const runtime = runtimeOf(config);
  if (typeof runtime.setStorage === 'function') {
    try {
      runtime.setStorage(key, value);
      return;
    } catch {
      // 继续走后面的方案
    }
  }
  const u = globalUni();
  if (u) {
    try {
      u.setStorageSync(key, value);
      return;
    } catch {
      // 继续走后面的方案
    }
  }
  writeLocal(key, value);
}

function getCurrentRoute(config) {
  const runtime = runtimeOf(config);
  if (typeof runtime.getCurrentRoute === 'function') {
    try {
      const route = String(runtime.getCurrentRoute() || '');
      if (route) return route;
    } catch {
      // 退回 location
    }
  }
  if (typeof location === 'undefined') return '';
  const hash = location.hash || '';
  const path = hash.startsWith('#') ? hash.slice(1) : location.pathname || '';
  return String(path).split('?')[0];
}

function createSession() {
  const now = new Date();
  const date = `${now.getFullYear()}-${pad2(now.getMonth() + 1)}-${pad2(now.getDate())}`;
  const random = Math.floor(Math.random() * 1000000)
    .toString()
    .padStart(6, '0');
  return `${date}-${random}`;
}

function getSession(config) {
  if (config.session) return String(config.session);
  const stored = getStorage(config, SESSION_KEY);
  const today = createSession().slice(0, 10);
  if (
    typeof stored === 'string' && /^\d{4}-\d{2}-\d{2}-\d{6}$/.test(stored) &&
    stored.slice(0, 10) === today
  ) {
    return stored;
  }
  const session = createSession();
  setStorage(config, SESSION_KEY, session);
  return session;
}

function getUsername(config) {
  if (typeof config.getUsername === 'function') {
    try {
      return String(config.getUsername() || '');
    } catch {
      return '';
    }
  }
  try {
    const raw = getStorage(config, 'user');
    if (raw) {
      const user = typeof raw === 'string' ? JSON.parse(raw) : raw;
      if (user && user.username) return String(user.username);
    }
  } catch {
    // 匿名
  }
  return '';
}

function getDeviceMeta(config) {
  const runtime = runtimeOf(config);
  let appVersion = '';
  let platform = '';
  if (typeof runtime.getAppVersion === 'function') {
    try {
      appVersion = runtime.getAppVersion() || '';
    } catch {
      // ignore
    }
  }
  if (typeof runtime.getPlatform === 'function') {
    try {
      platform = runtime.getPlatform() || '';
    } catch {
      // ignore
    }
  }
  const u = globalUni();
  if (u) {
    if (!appVersion) {
      try {
        appVersion = u.getAppBaseInfo?.().appVersion || '';
      } catch {
        // ignore
      }
    }
    if (!platform) {
      try {
        platform = u.getSystemInfoSync().platform || '';
      } catch {
        // ignore
      }
    }
  }
  return {
    appVersion: String(config.appVersion || appVersion || ''),
    platform: String(config.platform || platform || ''),
    iterationVersion: config.iterationVersion || '',
  };
}

function createHttpTransport(config) {
  const base = String(config.endpoint || '').replace(/\/+$/, '');
  if (!base) {
    throw new Error('[feedback-sdk] backend="http" 需要 config.endpoint');
  }
  const headers = { 'Content-Type': 'application/json', ...(config.headers || {}) };

  async function request(path, body) {
    const url = `${base}${path}`;
    if (typeof fetch === 'function') {
      const res = await fetch(url, {
        method: 'POST',
        headers,
        body: JSON.stringify(body),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.message || `HTTP ${res.status}`);
      return data;
    }
    const u = typeof globalThis !== 'undefined' ? globalThis.uni : undefined;
    if (u && typeof u.request === 'function') {
      return new Promise((resolve, reject) => {
        u.request({
          url,
          method: 'POST',
          header: headers,
          data: body,
          timeout: config.timeout,
          success: (res) => resolve(res.data),
          fail: (err) => reject(new Error(err.errMsg || 'request failed')),
        });
      });
    }
    throw new Error('[feedback-sdk] 当前环境没有 fetch/uni.request，无法使用 http backend');
  }

  return {
    submit: (payload) => request('/submit', payload),
    list: (params) => request('/list', params),
    updateStatus: (args) =>
      request('/update-status', {
        ids: args[0],
        status: args[1],
        note: args[2],
        key: args[3],
        version: args[4],
      }),
    remove: (args) => request('/remove', { ids: args[0], key: args[1] }),
  };
}

function createTransport(config) {
  if (config.transport && typeof config.transport === 'object') {
    const t = config.transport;
    if (typeof t.submit !== 'function' || typeof t.list !== 'function') {
      throw new Error('[feedback-sdk] config.transport 至少需要 submit() 和 list()');
    }
    return {
      submit: (payload) => t.submit(payload),
      list: (params) => t.list(params),
      updateStatus: t.updateStatus ? (args) => t.updateStatus(...args) : null,
      remove: t.remove ? (args) => t.remove(...args) : null,
    };
  }

  if (config.backendType === 'http') {
    return createHttpTransport(config);
  }

  if (config.backendType !== 'unicloud') {
    return createHttpTransport(config);
  }

  const cloud = getUniCloud(config);
  if (!cloud) {
    throw new Error(
      '[feedback-sdk] 当前环境没有 uniCloud.importObject；请使用 uni-app + uniCloud，或把 backend 切到 deno/http',
    );
  }

  let object = null;
  const getObject = () => {
    if (!object) object = cloud.importObject(config.cloudObject, { customUI: true });
    return object;
  };

  return {
    submit: (payload) => getObject().submit(payload),
    list: (params) => getObject().list(params),
    updateStatus: (args) => getObject().updateStatus(...args),
    remove: (args) => getObject().remove(...args),
  };
}

function createFeedbackClient(config) {
  const cfg = normalizeConfig(config);
  const transport = createTransport(cfg);

  return {
    config: cfg,

    async submit(input = {}) {
      const content = String(input.content || '').trim();
      if (!content) throw new Error('意见内容不能为空');
      if (content.length > 1000) throw new Error('意见内容不能超过 1000 字');

      const meta = { ...getDeviceMeta(cfg), ...(input.meta || {}) };
      const payload = {
        appId: cfg.appId,
        appName: cfg.appName,
        mode: cfg.mode,
        page: input.page || getCurrentRoute(cfg),
        content,
        submittedAt: Date.now(),
        username: input.username !== undefined ? String(input.username) : getUsername(cfg),
        session: input.session || getSession(cfg),
        contact: input.contact ? String(input.contact) : '',
        meta,
      };

      const res = await transport.submit(payload);
      if (!res || res.code !== 0) {
        throw new Error((res && res.message) || '提交失败，请稍后再试');
      }
      return res;
    },

    async list(params = {}) {
      const res = await transport.list(params);
      if (!res || res.code !== 0) {
        throw new Error((res && res.message) || '读取意见失败');
      }
      return res;
    },

    async updateStatus(ids, status, note = '', key) {
      if (!transport.updateStatus) throw new Error('当前 transport 不支持 updateStatus');
      const adminKey = key || cfg.adminKey || '';
      const res = await transport.updateStatus([ids, status, note, adminKey, cfg.iterationVersion]);
      if (!res || res.code !== 0) {
        throw new Error((res && res.message) || '更新状态失败');
      }
      return res;
    },

    async remove(ids, key) {
      if (!transport.remove) throw new Error('当前 transport 不支持 remove');
      const adminKey = key || cfg.adminKey || '';
      const res = await transport.remove([ids, adminKey]);
      if (!res || res.code !== 0) {
        throw new Error((res && res.message) || '删除失败');
      }
      return res;
    },
  };
}

/** 初始化全局单例；重复调用会覆盖。 */
function initFeedback(config) {
  activeClient = createFeedbackClient(config);
  return activeClient;
}

/** 取已初始化的客户端；未初始化时抛错。 */
function getFeedbackClient() {
  if (!activeClient) {
    throw new Error('[feedback-sdk] 尚未初始化，请先调用 initFeedback(config)');
  }
  return activeClient;
}

/** 提交一条意见（使用全局单例）。 */
function submitFeedback(input) {
  return getFeedbackClient().submit(input);
}

/** 读取意见（使用全局单例）。 */
function listFeedback(params) {
  return getFeedbackClient().list(params);
}

/** 更新意见状态（使用全局单例）。 */
function updateFeedbackStatus(ids, status, note, key) {
  return getFeedbackClient().updateStatus(ids, status, note, key);
}

/** 删除意见（使用全局单例）。 */
function removeFeedback(ids, key) {
  return getFeedbackClient().remove(ids, key);
}

export {
  createFeedbackClient,
  DEFAULT_CLOUD_OBJECT,
  getFeedbackClient,
  initFeedback,
  listFeedback,
  removeFeedback,
  submitFeedback,
  updateFeedbackStatus,
};

export default {
  initFeedback,
  getFeedbackClient,
  submitFeedback,
  listFeedback,
  updateFeedbackStatus,
  removeFeedback,
  createFeedbackClient,
};
