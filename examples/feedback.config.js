/**
 * feedback-sdk 配置。复制到项目里，改 appId / appName / mode 和 endpoint。
 * backend 填哪个名字，就用哪个同名对象；每个对象自带 enabled 开关。
 */
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

  adminKey: '',
};
