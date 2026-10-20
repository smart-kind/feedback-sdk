export type FeedbackMode = 'dev' | 'test' | 'prod';

export interface FeedbackTransport {
  submit(payload: FeedbackPayload): Promise<{ code: number; id?: string; message?: string }>;
  list(params?: FeedbackListParams): Promise<FeedbackListResult>;
  updateStatus?(args: any[]): Promise<{ code: number; updated?: number; message?: string }>;
  remove?(args: any[]): Promise<{ code: number; removed?: number; message?: string }>;
}

export interface DenoBackendConfig {
  /** 该后端是否启用；false 时被选为 backend 会报错 */
  enabled?: boolean;
  /** 传输类型，默认 http */
  type?: 'http';
  /** 后端地址，如 https://feedback.xxx.deno.dev */
  endpoint?: string;
  /** 公开请求头（不要放 secret） */
  headers?: Record<string, string>;
  /** 超时毫秒，默认 15000 */
  timeout?: number;
}

export interface UniCloudBackendConfig {
  /** 该后端是否启用；false 时被选为 backend 会报错 */
  enabled?: boolean;
  /** 传输类型，默认 unicloud */
  type?: 'unicloud';
  /** 云对象名，默认 feedback-center */
  cloudObject?: string;
  /** 仅记录用：uniCloud 服务空间 */
  spaceId?: string;
  spaceAppId?: string;
  endpoint?: string;
}

export interface FeedbackConfig {
  /** 应用唯一标识，如 your-app-id */
  appId: string;
  /** 应用显示名，如 Your App */
  appName: string;
  /** 环境：dev / test / prod */
  mode: FeedbackMode;
  /** 迭代短版本号，如 0.22；显示在按钮上并随意见保存 */
  iterationVersion?: string;
  /** 使用哪个后端：取 config 里同名的对象配置，如 deno / unicloud */
  backend?: string;
  /** Deno Deploy + Deno KV 后端 */
  deno?: DenoBackendConfig;
  /** uniCloud 云对象后端 */
  unicloud?: UniCloudBackendConfig;
  /** 固定测试批次；不传则按天自动生成 */
  session?: string;
  /** 覆盖 appVersion */
  appVersion?: string;
  /** 覆盖 platform */
  platform?: string;
  /** 自定义取用户名；默认读取本地 user.username */
  getUsername?: () => string;
  /** 管理 key（仅 updateStatus/remove 需要） */
  adminKey?: string;
  /** 历史意见范围：app=只看当前 appId/mode（默认），all=整个集合 */
  historyScope?: 'app' | 'all';
  /** 自定义传输层；不传则按 backend 选择 */
  transport?: FeedbackTransport;
  /** 运行时桥接：H5 CLI 构建里由 App 传入 uni / uniCloud 的能力 */
  runtime?: {
    getStorage?: (key: string) => any;
    setStorage?: (key: string, value: any) => void;
    getCurrentRoute?: () => string;
    getAppVersion?: () => string;
    getPlatform?: () => string;
    getUniCloud?: () => any;
  };
}

export interface FeedbackPayload {
  appId: string;
  appName: string;
  mode: FeedbackMode;
  page: string;
  content: string;
  submittedAt: number;
  username?: string;
  session?: string;
  contact?: string;
  meta?: Record<string, any>;
}

export interface FeedbackSubmitInput {
  content: string;
  page?: string;
  username?: string;
  session?: string;
  contact?: string;
  meta?: Record<string, any>;
}

export interface FeedbackItem {
  _id: string;
  appId?: string;
  appName?: string;
  mode?: FeedbackMode;
  page?: string;
  content: string;
  username?: string;
  session?: string;
  submittedAt?: number;
  createdAt: number;
  iterationVersion?: string;
  appVersion?: string;
  platform?: string;
  clientIP?: string;
  status: 'new' | 'implemented' | 'considered' | 'rejected' | 'duplicate';
  note?: string;
  meta?: Record<string, any>;
}

export interface FeedbackListParams {
  page?: number;
  pageSize?: number;
  session?: string;
  appId?: string;
  mode?: FeedbackMode;
}

export interface FeedbackListResult {
  code: number;
  total: number;
  items: FeedbackItem[];
}

export interface FeedbackClient {
  config: FeedbackConfig;
  submit(input: FeedbackSubmitInput): Promise<{ code: number; id?: string }>;
  list(params?: FeedbackListParams): Promise<FeedbackListResult>;
  updateStatus(ids: string | string[], status: string, note?: string, key?: string): Promise<any>;
  remove(ids: string | string[], key?: string): Promise<any>;
}

export function initFeedback(config: FeedbackConfig): FeedbackClient;
export function getFeedbackClient(): FeedbackClient;
export function submitFeedback(input: FeedbackSubmitInput): Promise<{ code: number; id?: string }>;
export function listFeedback(params?: FeedbackListParams): Promise<FeedbackListResult>;
export function updateFeedbackStatus(
  ids: string | string[],
  status: string,
  note?: string,
  key?: string,
): Promise<any>;
export function removeFeedback(ids: string | string[], key?: string): Promise<any>;
export function createFeedbackClient(config: FeedbackConfig): FeedbackClient;

declare const _default: {
  initFeedback: typeof initFeedback;
  getFeedbackClient: typeof getFeedbackClient;
  submitFeedback: typeof submitFeedback;
  listFeedback: typeof listFeedback;
  updateFeedbackStatus: typeof updateFeedbackStatus;
  removeFeedback: typeof removeFeedback;
  createFeedbackClient: typeof createFeedbackClient;
};
export default _default;
