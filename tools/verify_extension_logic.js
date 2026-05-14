const assert = require("assert");
const fs = require("fs");
const path = require("path");
const vm = require("vm");

const ROOT = path.resolve(__dirname, "..");

function readSource(name) {
  return fs.readFileSync(path.join(ROOT, name), "utf8");
}

function createElementMock() {
  const element = {
    value: "",
    textContent: "",
    innerHTML: "",
    hidden: false,
    disabled: false,
    checked: false,
    files: [],
    className: "",
    style: {},
    classList: { add() {}, remove() {}, toggle() {} },
    dataset: {},
    addEventListener() {},
    appendChild() {},
    removeChild() {},
    querySelector() { return createElementMock(); },
    querySelectorAll() { return []; },
    closest() { return createElementMock(); },
    contains() { return false; },
    reset() {},
    scrollTop: 0,
    scrollHeight: 0,
  };
  return element;
}

function createDocumentMock() {
  return {
    getElementById() { return createElementMock(); },
    createElement() { return createElementMock(); },
    querySelector() { return createElementMock(); },
    querySelectorAll() { return []; },
    addEventListener() {},
    body: createElementMock(),
  };
}

function createChromeMock() {
  return {
    runtime: {
      lastError: null,
      onConnect: { addListener() {} },
      onMessage: { addListener() {} },
      sendMessage(_message, callback) { if (callback) callback({ ok: true }); },
      connect() { return { onMessage: { addListener() {} }, onDisconnect: { addListener() {} }, postMessage() {} }; },
    },
    storage: {
      local: {
        get(_key, callback) { callback({}); },
        set(_value, callback) { if (callback) callback(); },
        remove(_key, callback) { if (callback) callback(); },
      },
    },
    downloads: { download(_options, callback) { if (callback) callback(1); } },
    tabs: {},
    windows: {},
  };
}

function createBaseContext() {
  return {
    assert,
    console,
    URL,
    Date,
    Math,
    Intl,
    RegExp,
    String,
    Number,
    Boolean,
    Array,
    Object,
    Map,
    Set,
    Uint8Array,
    Uint32Array,
    TextEncoder,
    TextDecoder,
    structuredClone,
    setTimeout,
    clearTimeout,
    setInterval,
    clearInterval,
    btoa: (text) => Buffer.from(text, "binary").toString("base64"),
    atob: (text) => Buffer.from(text, "base64").toString("binary"),
    document: createDocumentMock(),
    navigator: { clipboard: { writeText: async () => {} } },
    chrome: createChromeMock(),
    window: {},
    importScripts() {},
  };
}

function loadPopupExports() {
  const context = vm.createContext(createBaseContext());
  const source = readSource("popup.js").replace(/\ninit\(\);\n/, "\n");
  vm.runInContext(`${source}\nglobalThis.__exports = { buildTasks, analyzeImportRows, extractVideoUrls, getUrlPlatform, repairUrl, normalizePublishTime, deriveSequenceKey };`, context, { filename: "popup.js" });
  return context.__exports;
}

function loadBackgroundExports() {
  const context = vm.createContext(createBaseContext());
  const source = readSource("background.js");
  vm.runInContext(`${source}\nglobalThis.__exports = { normalizeOptions, normalizeDouyinProxyRotationOptions, extractClashCandidateNames, extractXiaohongshuRedirectUrl, detectPlatformFromUrl, getPublicOptions, nextTask, shouldRestartDouyinBatch, setState(value) { state = value; }, getState() { return state; } };`, context, { filename: "background.js" });
  return context.__exports;
}

function loadPptxExports() {
  const context = vm.createContext(createBaseContext());
  context.window = context;
  context.fetch = async () => ({ ok: false, arrayBuffer: async () => new ArrayBuffer(0) });
  vm.runInContext(readSource("pptx-builder.js"), context, { filename: "pptx-builder.js" });
  return context.PptxClippings;
}

function plain(value) {
  return JSON.parse(JSON.stringify(value));
}

function testTaskParsing() {
  const popup = loadPopupExports();
  const rows = [
    ["序号", "昵称", "发布链接", "平台", "标题", "发布日期"],
    ["1", "抖音账号", "https://www.douyin.com/video/111", "抖音", "抖音标题", "2026-04-20 19:02:31"],
    ["", "视频号账号", "https://weixin.qq.com/sph/abc123", "视频号", "视频号标题", "4月21日"],
    ["80", "头条账号", "https://www.toutiao.com/article/222", "头条号", "头条标题", "45333"],
    ["", "小红书账号", "https://www.xiaohongshu.com/explore/6973320e000000001a026a51", "小红书", "小红书标题", "2026/04/22"],
  ];
  const { tasks, analysis } = popup.buildTasks(rows, 0, "sequence");
  assert.strictEqual(analysis.linkIndex, 2);
  assert.deepStrictEqual(plain(tasks.map((task) => task.sequence)), ["1", "2", "3", "4"]);
  assert.deepStrictEqual(plain(tasks.map((task) => task.platform)), ["douyin", "weixin", "toutiao", "xiaohongshu"]);
  assert.strictEqual(tasks[0].fileName, "1_抖音账号.png");
  assert.strictEqual(tasks[0].releaseInfo.time, "2026-04-20");
  assert.strictEqual(tasks[1].releaseInfo.time, "2026-04-21");
  assert.strictEqual(tasks[2].releaseInfo.time, "2024-02-11");
  assert.strictEqual(tasks[3].releaseInfo.time, "2026-04-22");
}

function testUrlRepairAndFallbackSequence() {
  const popup = loadPopupExports();
  assert.strictEqual(popup.repairUrl("tps://www.douyin.com/video/123"), "https://www.douyin.com/video/123");
  assert.strictEqual(popup.repairUrl("douyin.com/note/456"), "https://douyin.com/note/456");
  assert.strictEqual(popup.repairUrl("xiaohongshu.com/explore/abc"), "https://xiaohongshu.com/explore/abc");
  const rows = [["编号", "昵称", "链接"], ["非数字", "账号A", "https://weixin.qq.com/sph/a"], ["", "账号B", "https://weixin.qq.com/sph/b"]];
  const { tasks } = popup.buildTasks(rows, 0, "sequence");
  assert.deepStrictEqual(plain(tasks.map((task) => task.sequence)), ["1", "2"]);
}

function testMultiLinkAndSupplementKeys() {
  const popup = loadPopupExports();
  const rows = [["序号", "昵称", "链接"], ["7", "多链接账号", "https://weixin.qq.com/sph/a https://www.douyin.com/video/9"]];
  const { tasks } = popup.buildTasks(rows, 0, "sequence");
  assert.deepStrictEqual(plain(tasks.map((task) => task.sequence)), ["7", "8"]);
  assert.strictEqual(popup.deriveSequenceKey("101_旧头条.png"), "101");
  assert.strictEqual(popup.deriveSequenceKey("7-2_多链接.png"), "7-2");
}

function testBackgroundOptionsAndQueue() {
  const background = loadBackgroundExports();
  const options = background.normalizeOptions({ concurrency: 6, waitMs: 12000, douyinWindowMode: "incognito", douyinProxyRotation: { enabled: true, controllerUrl: "127.0.0.1:9090/", groupName: "Proxy", secret: "secret", nodeNamesText: "香港, 日本", settleMs: 999999 } }, [{ url: "https://www.douyin.com/video/1", platform: "douyin" }]);
  assert.strictEqual(options.concurrency, 6);
  assert.strictEqual(options.douyinConcurrency, 1);
  assert.strictEqual(options.waitMs, 60000);
  assert.strictEqual(options.douyinUseIncognito, true);
  assert.strictEqual(options.douyinProxyRotation.enabled, true);
  assert.strictEqual(options.douyinProxyRotation.controllerUrl, "http://127.0.0.1:9090");
  assert.deepStrictEqual(plain(options.douyinProxyRotation.nodeNames), ["香港", "日本"]);
  assert.strictEqual(options.douyinProxyRotation.settleMs, 30000);
  assert.strictEqual(background.getPublicOptions(options).douyinProxyRotation.secret, "");
  background.setState({ tasks: [{ status: "PENDING", platform: "douyin", url: "https://www.douyin.com/video/1" }, { status: "PENDING", platform: "weixin", url: "https://weixin.qq.com/sph/a" }], runningDouyinCount: 1 });
  assert.strictEqual(background.nextTask().platform, "weixin");
  background.setState({ tasks: [{ status: "PENDING", platform: "douyin", url: "https://www.douyin.com/video/1" }], runningDouyinCount: 1 });
  assert.strictEqual(background.nextTask().__wait, true);
}

function testPlatformNavigationHelpers() {
  const background = loadBackgroundExports();
  const nestedSource = encodeURIComponent(`/404/sec_xxx?redirectPath=${encodeURIComponent("https://www.xiaohongshu.com/explore/abc123")}&error_code=300031`);
  const url = `https://www.xiaohongshu.com/404?source=${nestedSource}`;
  assert.strictEqual(background.extractXiaohongshuRedirectUrl(url), "https://www.xiaohongshu.com/explore/abc123");
  assert.strictEqual(background.detectPlatformFromUrl("https://xhslink.com/a"), "xiaohongshu");
  assert.strictEqual(background.detectPlatformFromUrl("https://www.douyin.com/note/123"), "douyin");
  assert.strictEqual(background.shouldRestartDouyinBatch(20, 20, 1), true);
  assert.strictEqual(background.shouldRestartDouyinBatch(20, 20, 0), false);
  assert.deepStrictEqual(plain(background.extractClashCandidateNames({ all: ["DIRECT", "REJECT", "香港 IEPL 08", "自动选择", "日本 IEPL 01"] })), ["香港 IEPL 08", "日本 IEPL 01"]);
}

function testPptMatching() {
  const pptx = loadPptxExports();
  const images = [{ name: "2_视频号账号.png" }, { name: "1_抖音账号.png" }, { name: "未知.png" }];
  const tasks = [
    { fileName: "1_抖音账号.png", sequence: "1", nickname: "抖音账号", url: "https://www.douyin.com/video/1" },
    { fileName: "2_视频号账号.png", sequence: "2", nickname: "视频号账号", url: "https://weixin.qq.com/sph/a" },
    { fileName: "3_头条账号.png", sequence: "3", nickname: "头条账号", url: "https://www.toutiao.com/article/1" },
  ];
  const items = pptx.buildLinkScreenshotItems(images, tasks);
  assert.strictEqual(items[0].sequence, "2");
  assert.strictEqual(items[0].linkText, "https://weixin.qq.com/sph/a");
  assert.strictEqual(items[1].sequence, "1");
  assert.strictEqual(items[2].sequence, "3");
}

const tests = [
  testTaskParsing,
  testUrlRepairAndFallbackSequence,
  testMultiLinkAndSupplementKeys,
  testBackgroundOptionsAndQueue,
  testPlatformNavigationHelpers,
  testPptMatching,
];

for (const test of tests) {
  test();
  console.log(`✓ ${test.name}`);
}

console.log(`All ${tests.length} extension logic regression tests passed.`);
