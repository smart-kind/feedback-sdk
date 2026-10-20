// feedback-center 云对象模板
// 用于收集测试意见：submit/list 免登录；updateStatus/remove 用管理 key。
// 部署到任意 uniCloud 项目后，客户端用 uniCloud.importObject('feedback-center') 调用。
//
// 提交必填：appId、appName、mode（dev|test|prod）、page、content
// 服务端会补：submittedAt（客户端时间，缺失则用服务端时间）、createdAt（服务端时间）、
//             clientIP、status='new'

const db = uniCloud.database();
const feedbackCollection = db.collection('feedbacks');
const $ = db.command.aggregate;

const MAX_CONTENT_LENGTH = 1000;
const MAX_APP_ID_LENGTH = 64;
const MAX_APP_NAME_LENGTH = 64;
const MAX_MODE_LENGTH = 16;
const MAX_USERNAME_LENGTH = 64;
const MAX_PAGE_LENGTH = 300;
const MAX_SESSION_LENGTH = 64;
const MAX_CONTACT_LENGTH = 200;
const MAX_APP_VERSION_LENGTH = 64;
const MAX_ITERATION_VERSION_LENGTH = 16;
const MAX_PLATFORM_LENGTH = 32;
const MAX_NOTE_LENGTH = 500;
const ALLOWED_MODES = ['dev', 'test', 'prod'];
const ALLOWED_STATUS = ['new', 'implemented', 'considered', 'rejected', 'duplicate'];
const MAX_PAGE_SIZE = 100;
const MAX_STATS_GROUPS = 50;

function trimString(value, maxLength) {
  if (typeof value !== 'string') return '';
  return value.trim().slice(0, maxLength);
}

function normalizeMeta(meta) {
  const source = meta && typeof meta === 'object' && !Array.isArray(meta) ? meta : {};
  return {
    appVersion: trimString(source.appVersion, MAX_APP_VERSION_LENGTH),
    platform: trimString(source.platform, MAX_PLATFORM_LENGTH),
    iterationVersion: trimString(source.iterationVersion, MAX_ITERATION_VERSION_LENGTH),
  };
}

function getClientIP(context) {
  try {
    const clientInfo = context.getClientInfo();
    return (clientInfo && clientInfo.CLIENTIP) || '';
  } catch (e) {
    return '';
  }
}

function normalizePositiveInt(value, fallback, max) {
  const parsed = parseInt(value, 10);
  if (!Number.isFinite(parsed) || parsed < 1) return fallback;
  return max ? Math.min(parsed, max) : parsed;
}

module.exports = {
  // 提交一条测试意见
  async submit(payload = {}) {
    try {
      const data = payload && typeof payload === 'object' && !Array.isArray(payload) ? payload : {};
      const content = typeof data.content === 'string' ? data.content.trim() : '';
      const appId = trimString(data.appId, MAX_APP_ID_LENGTH);
      const appName = trimString(data.appName, MAX_APP_NAME_LENGTH);
      const mode = trimString(data.mode, MAX_MODE_LENGTH);
      const page = trimString(data.page, MAX_PAGE_LENGTH);

      if (!appId || !appName || !ALLOWED_MODES.includes(mode) || !page) {
        return { code: 400, message: '缺少 appId / appName / mode / page 参数' };
      }

      if (!content || content.length > MAX_CONTENT_LENGTH) {
        return { code: 400, message: '请填写意见内容' };
      }

      const meta = normalizeMeta(data.meta);
      const submittedAt = Number(data.submittedAt) > 0 ? Number(data.submittedAt) : Date.now();
      const record = {
        appId,
        appName,
        mode,
        content,
        username: trimString(data.username, MAX_USERNAME_LENGTH),
        page,
        session: trimString(data.session, MAX_SESSION_LENGTH),
        contact: trimString(data.contact, MAX_CONTACT_LENGTH),
        appVersion: meta.appVersion,
        iterationVersion: meta.iterationVersion,
        platform: meta.platform,
        clientIP: getClientIP(this),
        submittedAt,
        createdAt: Date.now(),
        status: 'new',
        meta,
      };

      const res = await feedbackCollection.add(record);
      return { code: 0, id: res.id };
    } catch (e) {
      console.error('[feedback-center] submit error:', e.message, e.stack);
      return { code: 500, message: e.message };
    }
  },

  // 分页读取意见（测试期免授权）
  async list(params = {}) {
    try {
      const input = params && typeof params === 'object' && !Array.isArray(params) ? params : {};
      const page = normalizePositiveInt(input.page, 1);
      const pageSize = normalizePositiveInt(input.pageSize, 20, MAX_PAGE_SIZE);
      const session = trimString(input.session, MAX_SESSION_LENGTH);
      const appId = trimString(input.appId, MAX_APP_ID_LENGTH);
      const mode = trimString(input.mode, MAX_MODE_LENGTH);

      const where = {};
      if (session) where.session = session;
      if (appId) where.appId = appId;
      if (mode) where.mode = mode;

      const countRes = await feedbackCollection.where(where).count();
      const total = countRes.total || 0;

      const dataRes = await feedbackCollection
        .where(where)
        .orderBy('createdAt', 'desc')
        .skip((page - 1) * pageSize)
        .limit(pageSize)
        .get();

      return { code: 0, total, items: dataRes.data || [] };
    } catch (e) {
      console.error('[feedback-center] list error:', e.message, e.stack);
      return { code: 500, message: e.message };
    }
  },

  // 更新意见处理状态（测试期用管理 key；正式上线前应改为管理端权限）
  // 用法: feedback-center.updateStatus([id...], status, note, adminKey, version)
  async updateStatus(ids, status, note, key, version) {
    try {
      const adminKey = process.env.FEEDBACK_ADMIN_KEY || 'change-me-feedback-admin';
      if (key !== adminKey) {
        return { code: 403, message: '无权限' };
      }
      if (!ALLOWED_STATUS.includes(status)) {
        return { code: 400, message: `状态不合法，可选：${ALLOWED_STATUS.join(' / ')}` };
      }
      const list = (Array.isArray(ids) ? ids : [ids])
        .filter((id) => typeof id === 'string' && id)
        .slice(0, 100);
      const patch = {
        status,
        note: trimString(note, MAX_NOTE_LENGTH),
        processedAt: Date.now(),
        processedVersion: trimString(version, MAX_ITERATION_VERSION_LENGTH),
      };
      let updated = 0;
      for (const id of list) {
        const res = await feedbackCollection.where({ _id: id }).update(patch);
        updated += (res && (res.updated || res.updatedCount)) || 0;
      }
      return { code: 0, updated };
    } catch (e) {
      console.error('[feedback-center] updateStatus error:', e.message, e.stack);
      return { code: 500, message: e.message };
    }
  },

  // 删除指定意见（测试期清理用；正式上线前应改为管理端权限）
  // 用法: feedback-center.remove([id...], adminKey)
  async remove(ids, key) {
    try {
      const adminKey = process.env.FEEDBACK_ADMIN_KEY || 'change-me-feedback-admin';
      if (key !== adminKey) {
        return { code: 403, message: '无权限' };
      }
      const list = (Array.isArray(ids) ? ids : [ids])
        .filter((id) => typeof id === 'string' && id)
        .slice(0, 100);
      let removed = 0;
      for (const id of list) {
        const res = await feedbackCollection.where({ _id: id }).remove();
        removed += (res && (res.deleted || res.deletedCount)) || 0;
      }
      return { code: 0, removed };
    } catch (e) {
      console.error('[feedback-center] remove error:', e.message, e.stack);
      return { code: 500, message: e.message };
    }
  },

  // 总数 + 按 session 分组计数（最多 50 组），用于查看每次测试提交了多少条
  async stats() {
    try {
      const totalRes = await feedbackCollection.count();
      const groupRes = await feedbackCollection
        .aggregate()
        .group({ _id: '$session', count: $.sum(1) })
        .sort({ count: -1 })
        .limit(MAX_STATS_GROUPS)
        .end();

      const groups = (groupRes.data || []).map((item) => ({
        session: item._id || '',
        count: item.count,
      }));

      return { code: 0, total: totalRes.total || 0, groups };
    } catch (e) {
      console.error('[feedback-center] stats error:', e.message, e.stack);
      return { code: 500, message: e.message };
    }
  },
};
