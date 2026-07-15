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
  vm.runInContext(`${source}\nglobalThis.__exports = { buildTasks, analyzeImportRows, buildLocalCorrectionRows, detectDuplicateAccounts, isCorrectionSummaryRow, extractVideoUrls, getUrlPlatform, repairUrl, normalizePublishTime, deriveSequenceKey, applyExcelFixes, buildCorrectionNoteRows, writeCorrectionNotes, buildCorrectionIssueExportText, getCorrectionIssueExportMessage, mergeParsedFiles, renumberSequenceColumn, normalizeExportPublishTimeColumn, buildMarkedStyleIndexSet, isMarkFillPatternType, applyRefloPublishTimeSeconds };`, context, { filename: "popup.js" });
  return context.__exports;
}

function loadBackgroundExports() {
  const context = vm.createContext(createBaseContext());
  const source = readSource("background.js");
  vm.runInContext(`${source}\nglobalThis.__exports = { normalizeOptions, normalizeDouyinProxyRotationOptions, extractClashCandidateNames, extractXiaohongshuRedirectUrl, detectPlatformFromUrl, getPublicOptions, nextTask, shouldRestartDouyinBatch, buildSessionDownloadDir, setState(value) { state = value; }, getState() { return state; } };`, context, { filename: "background.js" });
  return context.__exports;
}

function loadPopupRefloContext(overrides = {}) {
  // 专用于 Reflo 批量请求重试测试：返回完整 context，便于按需替换 chrome.runtime.sendMessage 与 setTimeout。
  const base = createBaseContext();
  Object.assign(base, overrides);
  const context = vm.createContext(base);
  const source = readSource("popup.js").replace(/\ninit\(\);\n/, "\n");
  vm.runInContext(`${source}\nglobalThis.__exports = { fetchRefloReleaseInfoBatch };`, context, { filename: "popup.js" });
  return context;
}

function loadBackgroundRefloContext() {
  // 返回完整 context，测试时直接替换 context.fetch 以模拟不同 HTTP 状态与网络错误。
  const context = vm.createContext(createBaseContext());
  vm.runInContext(`${readSource("background.js")}\nglobalThis.__exports = { fetchRefloReleaseInfoBatchInBackground };`, context, { filename: "background.js" });
  return context;
}

function loadPptxExports() {
  const context = vm.createContext(createBaseContext());
  context.window = context;
  context.fetch = async () => ({ ok: false, arrayBuffer: async () => new ArrayBuffer(0) });
  const source = readSource("pptx-builder.js").replace("  window.PptxClippings = {", "  window.__testGetSessionOutputDir = getSessionOutputDir;\n  window.PptxClippings = {");
  vm.runInContext(source, context, { filename: "pptx-builder.js" });
  context.PptxClippings.__testGetSessionOutputDir = context.__testGetSessionOutputDir;
  return context.PptxClippings;
}

// Minimal in-memory IndexedDB sufficient for TemplateCache.put/get/delete.
// createIndex / openCursor are stubbed since the round-trip test does not exercise cleanup.
function createFakeIndexedDB() {
  const databases = new Map();
  function makeRequest(resultFactory) {
    const request = { onsuccess: null, onerror: null, result: undefined, error: null };
    Promise.resolve().then(() => {
      try {
        request.result = resultFactory ? resultFactory() : undefined;
        if (request.onsuccess) request.onsuccess({ target: request });
      } catch (error) {
        request.error = error;
        if (request.onerror) request.onerror({ target: request });
      }
    });
    return request;
  }
  return {
    open(name) {
      const request = { onsuccess: null, onerror: null, onupgradeneeded: null, result: null, error: null, transaction: null };
      Promise.resolve().then(() => {
        let store = databases.get(name);
        const isNew = !store;
        if (isNew) {
          store = new Map();
          databases.set(name, store);
        }
        const objectStore = {
          put(value) { store.set(value.id, value); return makeRequest(() => value.id); },
          get(id) { return makeRequest(() => store.get(id)); },
          delete(id) { store.delete(id); return makeRequest(); },
          createIndex() {},
          index() { return { openCursor() { return makeRequest(() => null); } }; },
          indexNames: { contains() { return true; } },
        };
        const db = {
          objectStoreNames: { contains() { return !isNew; } },
          createObjectStore() { return objectStore; },
          transaction() {
            const tx = { oncomplete: null, onerror: null, onabort: null, objectStore() { return objectStore; } };
            Promise.resolve().then(() => { if (tx.oncomplete) tx.oncomplete(); });
            return tx;
          },
          close() {},
        };
        request.result = db;
        request.transaction = { objectStore() { return objectStore; } };
        if (isNew && request.onupgradeneeded) request.onupgradeneeded({ target: request });
        if (request.onsuccess) request.onsuccess({ target: request });
      });
      return request;
    },
  };
}

function loadTemplateCacheExports() {
  const context = vm.createContext(createBaseContext());
  context.window = context;
  context.indexedDB = createFakeIndexedDB();
  context.IDBKeyRange = { upperBound: (value) => ({ value }) };
  // screenshot-cache.js holds two IIFEs (screenshot store + template store); we only need TemplateCache.
  vm.runInContext(readSource("screenshot-cache.js"), context, { filename: "screenshot-cache.js" });
  return { TemplateCache: context.TemplateCache };
}

function loadPlaybackSourceCacheExports() {
  const context = vm.createContext(createBaseContext());
  context.window = context;
  context.indexedDB = createFakeIndexedDB();
  context.IDBKeyRange = { upperBound: (value) => ({ value }) };
  vm.runInContext(readSource("playback-source-cache.js"), context, { filename: "playback-source-cache.js" });
  return { PlaybackSourceCache: context.PlaybackSourceCache };
}

function loadPptxExportsWithInternals() {
  const context = vm.createContext(createBaseContext());
  context.window = context;
  let fetchImpl = async () => ({ ok: false, arrayBuffer: async () => new ArrayBuffer(0) });
  context.fetch = (url) => fetchImpl(url);
  context.chrome = { runtime: { getURL: (name) => `chrome-extension://test/${name}` } };
  const source = readSource("pptx-builder.js").replace(
    "  window.PptxClippings = {",
    [
      "  window.__loadTemplateFiles = loadTemplateFiles;",
      "  window.__buildReleaseInfoScreenshotItems = buildReleaseInfoScreenshotItems;",
      "  window.__buildAuxImageMap = buildAuxImageMap;",
      "  window.__resolveAuxImageForTask = resolveAuxImageForTask;",
      "  window.__resolveAuxImageFromImageName = resolveAuxImageFromImageName;",
      "  window.__splitBoxVertically = splitBoxVertically;",
      "  window.__layoutAuxImages = layoutAuxImages;",
      "  window.PptxClippings = {",
    ].join("\n")
  );
  vm.runInContext(source, context, { filename: "pptx-builder.js" });
  return {
    __loadTemplateFiles: context.__loadTemplateFiles,
    __buildReleaseInfoScreenshotItems: context.__buildReleaseInfoScreenshotItems,
    __buildAuxImageMap: context.__buildAuxImageMap,
    __resolveAuxImageForTask: context.__resolveAuxImageForTask,
    __resolveAuxImageFromImageName: context.__resolveAuxImageFromImageName,
    __splitBoxVertically: context.__splitBoxVertically,
    __layoutAuxImages: context.__layoutAuxImages,
    __setFetch: (impl) => { fetchImpl = impl; },
  };
}

// Builds the bytes of an empty (zero-entry) zip: a single 22-byte End Of Central Directory record.
function buildEmptyZipArrayBuffer() {
  const buffer = new ArrayBuffer(22);
  const view = new DataView(buffer);
  view.setUint32(0, 0x06054b50, true); // EOCD signature
  // remaining fields stay zero (no entries, empty central directory)
  return buffer;
}

function plain(value) {
  return JSON.parse(JSON.stringify(value));
}

function testMergeMultipleFilesSameSchema() {
  const popup = loadPopupExports();
  const fileA = {
    fileName: "外观向.xlsx",
    rows: [
      ["序号", "昵称", "发布链接", "平台", "标题", "发布日期"],
      ["1", "账号A", "https://weixin.qq.com/sph/a", "视频号", "标题A", "2026-04-20"],
      ["2", "账号B", "https://www.douyin.com/video/2", "抖音", "标题B", "2026-04-21"],
    ],
  };
  const fileB = {
    fileName: "技术向.xlsx",
    rows: [
      ["序号", "昵称", "发布链接", "平台", "标题", "发布日期"],
      ["1", "账号C", "https://www.toutiao.com/article/3", "头条号", "标题C", "2026-04-22"],
    ],
  };
  const merged = popup.mergeParsedFiles([fileA, fileB]);
  assert.strictEqual(merged.fileName, "外观向.xlsx");
  assert.strictEqual(merged.dataRowCount, 3);
  assert.strictEqual(merged.realignedFiles.length, 0);
  const { tasks } = popup.buildTasks(merged.rows, 0, "sequence");
  // 后表序号顺延接前表，跨文件连续。
  assert.deepStrictEqual(plain(tasks.map((task) => task.sequence)), ["1", "2", "3"]);
  assert.deepStrictEqual(plain(tasks.map((task) => task.nickname)), ["账号A", "账号B", "账号C"]);
  assert.strictEqual(tasks[2].fileName, "3_账号C.png");
}

function testMergeMultipleFilesDifferentColumnOrder() {
  const popup = loadPopupExports();
  const fileA = {
    fileName: "first.xlsx",
    rows: [
      ["序号", "昵称", "发布链接", "标题"],
      ["1", "账号A", "https://weixin.qq.com/sph/a", "标题A"],
    ],
  };
  // 列顺序不同 + 多一列「备注」，应按表头对齐并把备注追加到末尾。
  const fileB = {
    fileName: "second.xlsx",
    rows: [
      ["发布链接", "昵称", "序号", "标题", "备注"],
      ["https://www.douyin.com/video/2", "账号B", "1", "标题B", "补充说明"],
    ],
  };
  const merged = popup.mergeParsedFiles([fileA, fileB]);
  assert.strictEqual(merged.fileName, "first.xlsx");
  assert.deepStrictEqual(plain(merged.realignedFiles), ["second.xlsx"]);
  assert.deepStrictEqual(plain(merged.appendedHeaders), ["备注"]);
  // 合并后表头：基准列 + 末尾追加「备注」。
  assert.deepStrictEqual(plain(merged.rows[0]), ["序号", "昵称", "发布链接", "标题", "备注"]);
  // 第二个文件的数据被正确对齐到基准列位置。
  assert.deepStrictEqual(plain(merged.rows[2]), ["1", "账号B", "https://www.douyin.com/video/2", "标题B", "补充说明"]);
  const { tasks } = popup.buildTasks(merged.rows, 0, "sequence");
  assert.deepStrictEqual(plain(tasks.map((task) => task.sequence)), ["1", "2"]);
  assert.deepStrictEqual(plain(tasks.map((task) => task.url)), ["https://weixin.qq.com/sph/a", "https://www.douyin.com/video/2"]);
}

function testMergeMultipleFilesCrossFileDuplicate() {
  const popup = loadPopupExports();
  const fileA = {
    fileName: "a.xlsx",
    rows: [
      ["序号", "昵称", "发布链接"],
      ["1", "账号A", "https://weixin.qq.com/sph/dup"],
    ],
  };
  const fileB = {
    fileName: "b.xlsx",
    rows: [
      ["序号", "昵称", "发布链接"],
      ["1", "账号B", "https://weixin.qq.com/sph/dup"],
    ],
  };
  const merged = popup.mergeParsedFiles([fileA, fileB]);
  const analysis = popup.analyzeImportRows(merged.rows);
  const reports = popup.buildLocalCorrectionRows(merged.rows, analysis, -1);
  // 跨文件相同链接应被识别为重复。
  assert.strictEqual(reports.length, 2);
  assert.strictEqual(reports[0].hasDuplicateLink, true);
  assert.strictEqual(reports[1].hasDuplicateLink, true);
}

function testRenumberSequenceColumnForMergedFiles() {
  const popup = loadPopupExports();
  // 模拟两个文件合并后的表：序号列各自 1、2，合并后应重排为 1、2、3、4。
  const fileA = {
    fileName: "外观向.xlsx",
    rows: [
      ["序号", "昵称", "发布链接"],
      ["1", "账号A", "https://weixin.qq.com/sph/a"],
      ["2", "账号B", "https://www.douyin.com/video/2"],
    ],
  };
  const fileB = {
    fileName: "技术向.xlsx",
    rows: [
      ["序号", "昵称", "发布链接"],
      ["1", "账号C", "https://www.toutiao.com/article/3"],
      ["2", "账号D", "https://www.xiaohongshu.com/explore/abc"],
    ],
  };
  const merged = popup.mergeParsedFiles([fileA, fileB]);
  const analysis = popup.analyzeImportRows(merged.rows);
  const renumbered = popup.renumberSequenceColumn(merged.rows, analysis);
  assert.strictEqual(renumbered, 4);
  const sequenceCol = analysis.sequenceIndex;
  const sequences = merged.rows.slice(analysis.headerRowIndex + 1).map((row) => row[sequenceCol]);
  assert.deepStrictEqual(plain(sequences), ["1", "2", "3", "4"]);
}

function testRenumberSequenceFollowsFirstFileStart() {
  const popup = loadPopupExports();
  // 起点跟随合并表第一行的原序号（这里从 80 开始），顺延全局连续。
  const rows = [
    ["序号", "昵称", "发布链接"],
    ["80", "账号A", "https://weixin.qq.com/sph/a"],
    ["81", "账号B", "https://www.douyin.com/video/2"],
    ["1", "账号C", "https://www.toutiao.com/article/3"],
  ];
  const analysis = popup.analyzeImportRows(rows);
  const renumbered = popup.renumberSequenceColumn(rows, analysis);
  assert.strictEqual(renumbered, 3);
  const sequences = rows.slice(1).map((row) => row[analysis.sequenceIndex]);
  assert.deepStrictEqual(plain(sequences), ["80", "81", "82"]);
}

function testRenumberSequenceSkipsSummaryRows() {
  const popup = loadPopupExports();
  // 「合计」汇总行不参与编号，且不打断连续序号。
  const rows = [
    ["序号", "昵称", "发布链接"],
    ["1", "账号A", "https://weixin.qq.com/sph/a"],
    ["合计", "总计 2 条", ""],
    ["1", "账号B", "https://www.douyin.com/video/2"],
  ];
  const analysis = popup.analyzeImportRows(rows);
  const renumbered = popup.renumberSequenceColumn(rows, analysis);
  assert.strictEqual(renumbered, 2);
  assert.strictEqual(rows[1][analysis.sequenceIndex], "1");
  assert.strictEqual(rows[2][analysis.sequenceIndex], "合计");
  assert.strictEqual(rows[3][analysis.sequenceIndex], "2");
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

function testExcelCorrectionSkipsSummaryRows() {
  const popup = loadPopupExports();
  const rows = [
    ["序号", "昵称", "发布链接", "平台", "标题", "发布日期"],
    ["1", "账号A", "https://weixin.qq.com/sph/a", "视频号", "标题A", "2026-04-20"],
    ["合计", "", "", "", "", ""],
    ["合计说明", "总计 2 条", "", "", "", ""],
    ["合计", "账号B", "https://weixin.qq.com/sph/b", "视频号", "标题B", "2026-04-21"],
  ];
  const analysis = popup.analyzeImportRows(rows);
  const reports = popup.buildLocalCorrectionRows(rows, analysis, -1);
  assert.strictEqual(popup.isCorrectionSummaryRow(rows[2]), true);
  assert.strictEqual(popup.isCorrectionSummaryRow(rows[4]), false);
  assert.deepStrictEqual(plain(reports.map((report) => report.rowNumber)), [2, 5]);
}

function testExcelCorrectionRedExportMessage() {
  const popup = loadPopupExports();
  assert.strictEqual(popup.getCorrectionIssueExportMessage({ style: "red", message: "链接无法获取正确发布信息：preview 失败（已重试 1 次）：首次=视频号预览接口未返回 feedInfo; 重试=视频号预览接口未返回 feedInfo" }), "链接失效");
  assert.strictEqual(popup.getCorrectionIssueExportMessage({ style: "yellow", message: "发布日期不一致" }), "发布日期不一致");
}

function testExcelFixWritesFixedCorrectionNotes() {
  const popup = loadPopupExports();
  const rows = [
    ["序号", "发布链接", "发布日期"],
    ["1", "https://weixin.qq.com/sph/a", "2026-04-20"],
  ];
  const rowReports = [{
    rowIndex: 1,
    issues: [{
      type: "field-mismatch",
      style: "yellow",
      columnIndex: 2,
      fixValue: "2026-04-21",
      message: "发布日期不一致：当前「2026-04-20」；正确日期「2026-04-21」",
    }],
    hasInvalidLink: false,
    hasDuplicateLink: false,
  }];
  assert.strictEqual(popup.applyExcelFixes(rowReports, rows), 1);
  assert.strictEqual(rows[1][2], "2026-04-21");
  assert.deepStrictEqual(plain(popup.buildCorrectionNoteRows(rowReports, false)), []);
  const noteRows = popup.buildCorrectionNoteRows(rowReports, true);
  popup.writeCorrectionNotes(rows, 0, 3, noteRows);
  assert.strictEqual(rows[0][3], "纠错说明");
  assert.strictEqual(rows[1][3], "发布日期不一致：当前「2026-04-20」；正确日期「2026-04-21」；已自动修正");
}

function testNormalizePublishTimeUsesCurrentYear() {
  const popup = loadPopupExports();
  const year = new Date().getFullYear();
  // 缺年份的「月-日」按当前年份补全，而非硬编码 2026。
  assert.strictEqual(popup.normalizePublishTime("4-25"), `${year}-04-25`);
  assert.strictEqual(popup.normalizePublishTime("12月3日"), `${year}-12-03`);
  // 含完整年份时不受影响。
  assert.strictEqual(popup.normalizePublishTime("2025-04-26 20:56:42"), "2025-04-26");
}

function testNormalizePublishTimeSerialNumber() {
  const popup = loadPopupExports();
  // Excel 日期序列号（数值 + 日期格式）应被还原成可读日期，而非原样导出“46171”。
  assert.strictEqual(popup.normalizePublishTime("46171"), "2026-05-29");
  // 带小数的序列号（含具体时间）默认仍只到天。
  assert.strictEqual(popup.normalizePublishTime("46171.869953703702"), "2026-05-29");
  // 区间外的纯数字不当作日期序列号处理，原样返回。
  assert.strictEqual(popup.normalizePublishTime("100"), "100");
}

function testNormalizePublishTimeIncludeTime() {
  const popup = loadPopupExports();
  // includeTime=true 且源数据带具体时间时，输出到秒。
  assert.strictEqual(popup.normalizePublishTime("46171.869953703702", true), "2026-05-29 20:52:44");
  assert.strictEqual(popup.normalizePublishTime("2025-04-26 20:56:42", true), "2025-04-26 20:56:42");
  assert.strictEqual(popup.normalizePublishTime("2025-04-26 20:56", true), "2025-04-26 20:56:00");
  // 整数序列号、纯日期文本本无具体时间，即便开启也只输出到天，不补 00:00:00。
  assert.strictEqual(popup.normalizePublishTime("46171", true), "2026-05-29");
  assert.strictEqual(popup.normalizePublishTime("2025-04-26", true), "2025-04-26");
  // 兼容 Reflo 可能返回的 ISO「T」分隔、小数秒与时区后缀（按字面时分秒展示，不做时区换算）。
  assert.strictEqual(popup.normalizePublishTime("2026-05-31T20:52:44", true), "2026-05-31 20:52:44");
  assert.strictEqual(popup.normalizePublishTime("2026-05-31T20:52:44.000", true), "2026-05-31 20:52:44");
  assert.strictEqual(popup.normalizePublishTime("2026-05-31T20:52:44Z", true), "2026-05-31 20:52:44");
  assert.strictEqual(popup.normalizePublishTime("2026-05-31T20:52:44+08:00", true), "2026-05-31 20:52:44");
  // ISO「T」格式在关闭精确时间时仍能正确归一化到天（旧实现会原样返回）。
  assert.strictEqual(popup.normalizePublishTime("2026-05-31T20:52:44"), "2026-05-31");
}

function testApplyRefloPublishTimeSeconds() {
  const popup = loadPopupExports();
  const analysis = { headerRowIndex: 0, publishTimeIndex: 1 };
  const makeRows = () => [
    ["序号", "发布日期"],
    ["1", "46171"], // 日期一致行
    ["2", "46171"], // 日期不一致行（被标黄）
    ["3", "46171"], // 失效链接行
    ["4", "46171"], // 取不到 Reflo 的行
    ["5", "2026-05-31 09:00:00"], // 源含时间、但 Reflo 只给到天
  ];
  const makeReports = () => [
    { rowIndex: 1, hasInvalidLink: false, issues: [], refloData: { timeWithSeconds: "2026-05-29 20:52:44" } },
    { rowIndex: 2, hasInvalidLink: false, issues: [{ columnIndex: 1, style: "yellow" }], refloData: { timeWithSeconds: "2026-06-01 08:00:00" } },
    { rowIndex: 3, hasInvalidLink: true, issues: [], refloData: null },
    { rowIndex: 4, hasInvalidLink: false, issues: [], refloData: { timeWithSeconds: "" } },
    { rowIndex: 5, hasInvalidLink: false, issues: [], refloData: { timeWithSeconds: "2026-05-31" } },
  ];

  // 修正模式：一致行与不一致行都写成 Reflo 的精确时间；失效链接行、无 Reflo 时间的行保持不动。
  const fixRows = makeRows();
  popup.applyRefloPublishTimeSeconds(makeReports(), fixRows, analysis, true);
  assert.strictEqual(fixRows[1][1], "2026-05-29 20:52:44", "修正模式：日期一致行补上精确时间");
  assert.strictEqual(fixRows[2][1], "2026-06-01 08:00:00", "修正模式：日期不一致行写成 Reflo 精确时间");
  assert.strictEqual(fixRows[3][1], "46171", "失效链接行不动");
  assert.strictEqual(fixRows[4][1], "46171", "无 Reflo 时间的行不动");
  assert.strictEqual(fixRows[5][1], "2026-05-31 09:00:00", "Reflo 仅到天时不覆盖，保留源单元格时间");

  // 纠错模式：仅一致行补时分秒；被标记不一致的行保持源值不改写。
  const checkRows = makeRows();
  popup.applyRefloPublishTimeSeconds(makeReports(), checkRows, analysis, false);
  assert.strictEqual(checkRows[1][1], "2026-05-29 20:52:44", "纠错模式：日期一致行补上精确时间");
  assert.strictEqual(checkRows[2][1], "46171", "纠错模式：不一致行保持源值不改写");
}

function testNormalizeExportPublishTimeColumn() {
  const popup = loadPopupExports();
  const analysis = { headerRowIndex: 0, publishTimeIndex: 2 };
  // 第 2/3 行是序列号源，第 4 行是文本日期，第 5 行是「合计」汇总行（应跳过）。
  const rows = [
    ["序号", "昵称", "发布日期"],
    ["1", "甲", "46171"],
    ["2", "乙", "46171.869953703702"],
    ["3", "丙", "2025/4/26"],
    ["合计", "", "999"],
  ];
  popup.normalizeExportPublishTimeColumn(rows, analysis, false);
  assert.strictEqual(rows[1][2], "2026-05-29", "整数序列号应归一化为日期");
  assert.strictEqual(rows[2][2], "2026-05-29", "带时间的序列号默认只到天");
  assert.strictEqual(rows[3][2], "2025-04-26", "文本日期应归一化为标准格式");
  assert.strictEqual(rows[4][2], "999", "合计汇总行不应被改写");
  assert.strictEqual(rows[0][2], "发布日期", "表头不应被改写");

  // 开启 includeTime 后，带时间的序列号输出到秒，整数序列号仍只到天。
  const rows2 = [
    ["序号", "发布日期"],
    ["1", "46171.869953703702"],
    ["2", "46171"],
  ];
  popup.normalizeExportPublishTimeColumn(rows2, { headerRowIndex: 0, publishTimeIndex: 1 }, true);
  assert.strictEqual(rows2[1][1], "2026-05-29 20:52:44");
  assert.strictEqual(rows2[2][1], "2026-05-29");

  // 无发布日期列时不应抛错、不改动数据。
  const rows3 = [["序号", "昵称"], ["1", "甲"]];
  popup.normalizeExportPublishTimeColumn(rows3, { headerRowIndex: 0, publishTimeIndex: -1 }, false);
  assert.strictEqual(rows3[1][1], "甲");

  // 传入行谓词（只处理背景标记行）时，未命中的行保持原样。
  const rows4 = [
    ["序号", "发布日期"],
    ["1", "46171"],
    ["2", "46171"],
  ];
  popup.normalizeExportPublishTimeColumn(rows4, { headerRowIndex: 0, publishTimeIndex: 1 }, false, (rowIndex) => rowIndex === 1);
  assert.strictEqual(rows4[1][1], "2026-05-29", "标记行应归一化");
  assert.strictEqual(rows4[2][1], "46171", "未标记行应保持原始序列号不动");
}

function testBuildMarkedStyleIndexSet() {
  const popup = loadPopupExports();
  // 图案类型判定：none/gray125 是 Excel 默认占位，不算标记；solid 等算标记。
  assert.strictEqual(popup.isMarkFillPatternType("none"), false);
  assert.strictEqual(popup.isMarkFillPatternType("gray125"), false);
  assert.strictEqual(popup.isMarkFillPatternType(""), false);
  assert.strictEqual(popup.isMarkFillPatternType("solid"), true);
  assert.strictEqual(popup.isMarkFillPatternType("lightGray"), true);

  // fills[0]=none、fills[1]=gray125、fills[2]=solid（真实填充）。
  const fillPatternTypes = ["none", "gray125", "solid"];
  // 样式 0->fill0(none)、1->fill1(gray125)、2->fill2(solid 命中)、3->fill2(命中)、4->fill0(未命中)。
  const xfFillIds = [0, 1, 2, 2, 0];
  const marked = popup.buildMarkedStyleIndexSet(fillPatternTypes, xfFillIds);
  assert.strictEqual([...marked].sort((a, b) => a - b).join(","), "2,3", "仅引用 solid 填充的样式索引算作背景标记");

  // 无任何真实填充时返回空集合。
  const none = popup.buildMarkedStyleIndexSet(["none", "gray125"], [0, 1]);
  assert.strictEqual(none.size, 0);
}

function testBuildLocalCorrectionRowsRespectsRowFilter() {
  const popup = loadPopupExports();
  const rows = [
    ["序号", "昵称", "发布链接", "发布日期"],
    ["1", "甲", "https://weixin.qq.com/sph/aaa", "46171"],
    ["2", "乙", "https://weixin.qq.com/sph/bbb", "46171"],
    ["3", "丙", "https://weixin.qq.com/sph/ccc", "46171"],
  ];
  const analysis = popup.analyzeImportRows(rows);
  // 只处理第 2、4 行（rowIndex 1、3）。
  const reports = popup.buildLocalCorrectionRows(rows, analysis, -1, (rowIndex) => rowIndex === 1 || rowIndex === 3);
  assert.strictEqual(reports.length, 2, "只应为命中谓词的行生成纠错记录");
  assert.strictEqual(reports.map((r) => r.rowIndex).join(","), "1,3");
  // 未传谓词时处理全部数据行（向后兼容）。
  assert.strictEqual(popup.buildLocalCorrectionRows(rows, analysis, -1).length, 3);
}

function testMergeParsedFilesPropagatesFillMarks() {
  const popup = loadPopupExports();
  const fileA = {
    fileName: "a.xlsx",
    rows: [
      ["序号", "昵称", "发布链接"],
      ["1", "甲", "https://weixin.qq.com/sph/a1"],
      ["2", "乙", "https://weixin.qq.com/sph/a2"],
    ],
    fillMarks: [false, true, false],
  };
  const fileB = {
    fileName: "b.xlsx",
    rows: [
      ["序号", "昵称", "发布链接"],
      ["1", "丙", "https://weixin.qq.com/sph/b1"],
    ],
    fillMarks: [false, true],
  };
  const merged = popup.mergeParsedFiles([fileA, fileB]);
  // mergedRows[0] 为表头(false)，随后是 A 的两行、B 的一行。
  assert.strictEqual(merged.fillMarks.join(","), "false,true,false,true", "合并后的填充标记应与合并行对齐");
  assert.strictEqual(merged.fillMarks.length, merged.rows.length, "填充标记长度应与合并行数一致");

  // 全部文件无填充信息（CSV）时，合并结果 fillMarks 为 null（选项会被忽略）。
  const csvA = { fileName: "a.csv", rows: fileA.rows, fillMarks: null };
  const csvB = { fileName: "b.csv", rows: fileB.rows, fillMarks: null };
  assert.strictEqual(popup.mergeParsedFiles([csvA, csvB]).fillMarks, null);
}

function testColumnDetectionPrefersExactHeader() {
  const popup = loadPopupExports();
  // 同时存在「视频标题/标题」「视频平台/发布平台」时，发布字段必须命中精确表头而非靠前的源字段列。
  const rows = [
    ["序号", "视频标题", "标题", "视频平台", "发布平台", "昵称", "发布链接"],
    ["1", "源视频标题#话题", "华为乾崑发布标题", "抖音", "视频号", "作者甲", "https://weixin.qq.com/sph/aaa"],
    ["2", "源视频标题2#话题", "华为乾崑发布标题2", "抖音", "视频号", "作者乙", "https://weixin.qq.com/sph/bbb"],
  ];
  const a = popup.analyzeImportRows(rows);
  assert.strictEqual(a.publishTitleIndex, 2, "发布标题应取「标题」而非「视频标题」");
  assert.strictEqual(a.publishPlatformIndex, 4, "发布平台应取「发布平台」而非「视频平台」");
  assert.strictEqual(a.publishAccountIndex, 5, "账号应取「昵称」");
  // 账号列名为「作者」时也应识别（旧逻辑只认账号/昵称会漏）。
  const rows2 = [
    ["序号", "作者", "发布链接"],
    ["1", "张三", "https://weixin.qq.com/sph/a"],
    ["2", "李四", "https://weixin.qq.com/sph/b"],
  ];
  assert.strictEqual(popup.analyzeImportRows(rows2).publishAccountIndex, 1, "账号列名为「作者」时应识别");
}

function testDuplicateAccountUsesCorrectAccount() {
  const popup = loadPopupExports();
  const analysis = { publishAccountIndex: 11 };
  // 复刻真实文件：原始账号各不相同，但 Reflo 正确账号才决定是否重复。
  const reports = [
    { rowIndex: 1, accountValue: "生活小雷达", refloData: { account: "万象科技局" }, issues: [] },
    { rowIndex: 2, accountValue: "万象科技局", refloData: { account: "万象科技局" }, issues: [] },
    { rowIndex: 3, accountValue: "北上广驰行", refloData: { account: "狂野的大奔" }, issues: [] },
    { rowIndex: 4, accountValue: "万象科技局", refloData: { account: "狂野的大奔" }, issues: [] },
    // 拿不到 Reflo 数据，回退用原始账号值判重。
    { rowIndex: 5, accountValue: "琴子wan", refloData: null, issues: [] },
    { rowIndex: 6, accountValue: "琴子wan", refloData: null, issues: [] },
    // 正确账号唯一，不应标蓝。
    { rowIndex: 7, accountValue: "孤狼", refloData: { account: "独一份" }, issues: [] },
  ];
  popup.detectDuplicateAccounts(reports, analysis);
  const blueOf = (i) => reports.find((r) => r.rowIndex === i).issues.some((x) => x.type === "duplicate-account");
  // 按正确账号：万象科技局=行1+行2，狂野的大奔=行3+行4，琴子wan=行5+行6 → 全部标蓝。
  [1, 2, 3, 4, 5, 6].forEach((i) => assert.strictEqual(blueOf(i), true, `行${i} 应标蓝`));
  assert.strictEqual(blueOf(7), false, "唯一账号不应标蓝");
  // 蓝色提示用的是正确账号，而非原始错误值。
  const msg1 = reports[0].issues.find((x) => x.type === "duplicate-account").message;
  assert.strictEqual(msg1, "发布账号重复：万象科技局");
  // 无账号列时不标蓝。
  const noColReports = [{ rowIndex: 1, accountValue: "a", refloData: { account: "a" }, issues: [] }, { rowIndex: 2, accountValue: "a", refloData: { account: "a" }, issues: [] }];
  popup.detectDuplicateAccounts(noColReports, { publishAccountIndex: -1 });
  assert.deepStrictEqual(plain(noColReports.map((r) => r.issues)), [[], []]);
}

function testExcelFixWritesDuplicateLinkRows() {
  const popup = loadPopupExports();
  const rows = [
    ["序号", "发布链接", "发布账号"],
    ["1", "https://weixin.qq.com/sph/a", "大梦damen"],
    ["2", "https://weixin.qq.com/sph/a", "大梦damen"],
  ];
  // 两行链接重复（hasDuplicateLink=true），但账号是 Reflo 取回的同一份真实数据，应照常回填。
  const makeReport = (rowIndex) => ({
    rowIndex,
    issues: [{
      type: "field-mismatch",
      style: "yellow",
      columnIndex: 2,
      fixValue: "琴子wan",
      message: "发布账号不一致：当前「大梦damen」；正确账号「琴子wan」",
    }],
    hasInvalidLink: false,
    hasDuplicateLink: true,
  });
  const rowReports = [makeReport(1), makeReport(2)];
  assert.strictEqual(popup.applyExcelFixes(rowReports, rows), 2);
  assert.strictEqual(rows[1][2], "琴子wan");
  assert.strictEqual(rows[2][2], "琴子wan");
  // 失效链接行没有真实数据可填，仍整行跳过。
  const invalidRows = [["序号", "发布链接", "发布账号"], ["1", "", "大梦damen"]];
  const invalidReports = [{
    rowIndex: 1,
    issues: [{ type: "field-mismatch", style: "yellow", columnIndex: 2, fixValue: "琴子wan", message: "x" }],
    hasInvalidLink: true,
    hasDuplicateLink: false,
  }];
  assert.strictEqual(popup.applyExcelFixes(invalidReports, invalidRows), 0);
  assert.strictEqual(invalidRows[1][2], "大梦damen");
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

function testAuxImageMatching() {
  const pptx = loadPptxExportsWithInternals();
  const tasks = [
    { importSequence: 1, sequence: "1", nickname: "抖音账号", fileName: "1_抖音账号.png" },
    { importSequence: 2, sequence: "9", nickname: "视频号账号", fileName: "2_视频号账号.png" },
  ];
  const auxImages = [{ name: "1_抖音账号.png" }, { name: "9_视频号账号.png" }];
  const map = pptx.__buildAuxImageMap(auxImages, tasks);
  // 精确匹配：文件名本身的序号_昵称能直接命中。
  assert.strictEqual(pptx.__resolveAuxImageForTask(tasks[0], map), auxImages[0]);
  // Excel 序号列（9）与插件权威 importSequence（2）不一致时，仍应按任务反查兜底命中。
  assert.strictEqual(pptx.__resolveAuxImageForTask(tasks[1], map), auxImages[1]);
  // 无匹配任务时返回 null，不应抛异常。
  const strangerTask = { importSequence: 3, nickname: "陌生账号" };
  assert.strictEqual(pptx.__resolveAuxImageForTask(strangerTask, map), null);
  // 按截图文件名兜底匹配（item.task 为空但截图文件名本身符合 序号_昵称）。
  assert.strictEqual(pptx.__resolveAuxImageFromImageName({ name: "1_抖音账号.png" }, map), auxImages[0]);
  assert.strictEqual(pptx.__resolveAuxImageFromImageName({ name: "未知.png" }, map), null);
}

function testLayoutAuxImages() {
  const pptx = loadPptxExportsWithInternals();
  const box = { x: 100, y: 200, cx: 1000, cy: 800 };
  const [top, bottom] = pptx.__splitBoxVertically(box);
  assert.deepStrictEqual(plain(top), { x: 100, y: 200, cx: 1000, cy: 400 });
  assert.deepStrictEqual(plain(bottom), { x: 100, y: 600, cx: 1000, cy: 400 });
  // 单张辅助图：铺满整个 auxBox（等价于原有「仅粉丝图」时的效果）。
  const single = pptx.__layoutAuxImages([{ width: 16, height: 9 }], box);
  assert.strictEqual(single.length, 1);
  assert.ok(plain(single[0].position).cy <= box.cy);
  // 两张辅助图：按传入顺序上下二分，第一张（粉丝图）在上半区，第二张（播放图）在下半区。
  const fan = { width: 16, height: 9 };
  const playback = { width: 16, height: 9 };
  const both = pptx.__layoutAuxImages([fan, playback], box);
  assert.strictEqual(both.length, 2);
  assert.strictEqual(both[0].image, fan);
  assert.strictEqual(both[1].image, playback);
  assert.ok(plain(both[0].position).y < plain(both[1].position).y, "粉丝图应排在播放数据图上方");
}

function testOutputFolderNaming() {
  const background = loadBackgroundExports();
  const pptx = loadPptxExports();
  assert.match(background.buildSessionDownloadDir("客户:任务.xlsx"), /^截图\/\d{4}-\d{2}-\d{2}_\d{2}-\d{2}-\d{2}_客户任务_截图$/);
  assert.match(background.buildSessionDownloadDir(""), /^截图\/\d{4}-\d{2}-\d{2}_\d{2}-\d{2}-\d{2}_截图$/);
  assert.match(pptx.__testGetSessionOutputDir("客户:任务.xlsx"), /^截图\/\d{4}-\d{2}-\d{2}_\d{2}-\d{2}-\d{2}_客户任务_PPT$/);
  assert.match(pptx.__testGetSessionOutputDir(""), /^截图\/\d{4}-\d{2}-\d{2}_\d{2}-\d{2}-\d{2}_PPT$/);
}

function testAutoPptTemplateIdFlowsThroughOptions() {
  const background = loadBackgroundExports();
  // 自定义模板 id 必须从启动 options 一路保留到 normalizeOptions 输出，
  // 否则截图后自动生成时拿不到模板，会回退内置模板（即本次修复的 bug）。
  const withTemplate = background.normalizeOptions(
    { autoGeneratePpt: true, autoPptMode: "dawanqu", autoPptTemplateId: "tpl-abc-123" },
    [{ url: "https://weixin.qq.com/sph/a", platform: "weixin" }]
  );
  assert.strictEqual(withTemplate.autoPptTemplateId, "tpl-abc-123");
  assert.strictEqual(withTemplate.autoPptMode, "dawanqu");
  // 透传到前端的 public options 仍保留该 id（auto-ppt 页面靠它取模板）。
  assert.strictEqual(background.getPublicOptions(withTemplate).autoPptTemplateId, "tpl-abc-123");
  // 没有上传自定义模板时，字段为空字符串，保证回退到内置模板的现有行为。
  const noTemplate = background.normalizeOptions(
    { autoGeneratePpt: true, autoPptMode: "clippings" },
    [{ url: "https://weixin.qq.com/sph/a", platform: "weixin" }]
  );
  assert.strictEqual(noTemplate.autoPptTemplateId, "");
}

async function testTemplateCacheRoundTrip() {
  // 用内存版 IndexedDB 模拟，验证 TemplateCache 存取闭环：存入字节 -> 按 id 取回字节一致；
  // 取不存在的 id 返回空（对应回退到内置模板的安全路径）。
  const { TemplateCache } = loadTemplateCacheExports();
  const bytes = new Uint8Array([80, 75, 3, 4, 1, 2, 3, 4, 5]);
  const id = await TemplateCache.putTemplate({ name: "自定义.pptx", mode: "dawanqu", bytes });
  assert.ok(id && typeof id === "string");
  const record = await TemplateCache.getTemplate(id);
  assert.ok(record, "应能按 id 取回模板记录");
  assert.strictEqual(record.name, "自定义.pptx");
  assert.strictEqual(record.mode, "dawanqu");
  assert.deepStrictEqual(Array.from(record.bytes), Array.from(bytes));
  const missing = await TemplateCache.getTemplate("不存在的id");
  assert.strictEqual(missing, undefined);
  await TemplateCache.deleteTemplate(id);
  const afterDelete = await TemplateCache.getTemplate(id);
  assert.strictEqual(afterDelete, undefined);
}

async function testPlaybackSourceCacheRoundTrip() {
  // 用内存版 IndexedDB 模拟，验证 PlaybackSourceCache 存取闭环：存入文件 -> 按 id 取回一致；
  // 删除后再取应返回 undefined。
  const { PlaybackSourceCache } = loadPlaybackSourceCacheExports();
  const files = [{ fileName: "1_抖音账号.png", blob: { arrayBuffer: async () => new Uint8Array([1, 2, 3]).buffer } }];
  const id = await PlaybackSourceCache.putPlaybackSource({ name: "后台播放数据截图", files });
  assert.ok(id && typeof id === "string" && id.startsWith("playback-"));
  const record = await PlaybackSourceCache.getPlaybackSource(id);
  assert.ok(record, "应能按 id 取回播放数据截图缓存记录");
  assert.strictEqual(record.name, "后台播放数据截图");
  assert.strictEqual(record.files.length, 1);
  assert.strictEqual(record.files[0].fileName, "1_抖音账号.png");
  const missing = await PlaybackSourceCache.getPlaybackSource("不存在的id");
  assert.strictEqual(missing, undefined);
  await PlaybackSourceCache.deletePlaybackSource(id);
  const afterDelete = await PlaybackSourceCache.getPlaybackSource(id);
  assert.strictEqual(afterDelete, undefined);
}

async function testLoadTemplateFilesFallback() {
  // loadTemplateFiles 是模板生效与回退的核心分叉点：
  // 有 templateBytes -> 用自定义模板（解析传入的 zip 字节）；
  // 无 templateBytes -> fetch 内置模板。
  const pptx = loadPptxExportsWithInternals();
  const builtinFetched = [];
  pptx.__setFetch(async (urlPath) => {
    builtinFetched.push(urlPath);
    // 返回一个最小 zip（仅含 central directory 的空包），保证不会因解析失败而误判。
    return { ok: true, arrayBuffer: async () => buildEmptyZipArrayBuffer() };
  });
  // 自定义字节：用一个最小空 zip 字节，loadTemplateFiles 应直接解析它，不走 fetch。
  const customBytes = new Uint8Array(buildEmptyZipArrayBuffer());
  await pptx.__loadTemplateFiles("发布剪报-模板(1)(1).pptx", customBytes, "err");
  assert.strictEqual(builtinFetched.length, 0, "提供自定义字节时不应 fetch 内置模板");
  // 不提供字节：应回退到 fetch 内置模板。
  await pptx.__loadTemplateFiles("发布剪报-模板(1)(1).pptx", undefined, "err");
  assert.strictEqual(builtinFetched.length, 1, "未提供字节时应 fetch 内置模板");
}

async function testRefloBatchRetriesTransientErrors() {
  // 复现并验证：网关在 Reflo 后端重试期间瞬时返回 5xx / 网络中断时，插件应按退避自动重试，
  // 而非把"正在重试"误判为最终失败。前两次可重试错误后第三次成功，应最终返回数据。
  let calls = 0;
  const responses = [
    { ok: false, error: "Reflo API 请求失败：504 Gateway Timeout", retryable: true, status: 504 },
    { ok: false, error: "Reflo API 请求失败：网络错误（Failed to fetch）", retryable: true },
    { ok: true, data: { items: [{ id: "t1", ok: true, data: {} }] } },
  ];
  const chrome = createChromeMock();
  chrome.runtime.sendMessage = (_message, callback) => { callback(responses[calls]); calls += 1; };
  const context = loadPopupRefloContext({ chrome, setTimeout: (fn) => { fn(); return 0; } });
  const retries = [];
  const data = await context.__exports.fetchRefloReleaseInfoBatch(
    { apiUrl: "https://reflo/api", token: "tok", enrichFollower: false },
    [{ id: "t1", url: "https://www.douyin.com/video/1" }],
    (attempt) => retries.push(attempt)
  );
  assert.strictEqual(calls, 3, "前两次瞬时错误应触发重试，第三次成功");
  assert.deepStrictEqual(retries, [1, 2], "应在第 1、2 次失败后各回调一次重试");
  assert.ok(data && Array.isArray(data.items), "最终应返回成功数据");
}

async function testRefloBatchSkipsNonRetryableError() {
  // 鉴权等非瞬时错误（retryable=false）不应重试，应立即抛出原始错误。
  let calls = 0;
  const chrome = createChromeMock();
  chrome.runtime.sendMessage = (_message, callback) => {
    calls += 1;
    callback({ ok: false, error: "Reflo API 请求失败：401 Unauthorized", retryable: false, status: 401 });
  };
  const context = loadPopupRefloContext({ chrome, setTimeout: (fn) => { fn(); return 0; } });
  let threw = null;
  try {
    await context.__exports.fetchRefloReleaseInfoBatch(
      { apiUrl: "https://reflo/api", token: "tok" },
      [{ id: "t1", url: "u" }]
    );
  } catch (error) {
    threw = error;
  }
  assert.ok(threw && /401/.test(threw.message), "非重试类错误应直接抛出原始错误");
  assert.strictEqual(calls, 1, "非重试类错误不应重试");
}

async function testRefloBatchStopsAtMaxAttempts() {
  // 持续可重试错误时，最多尝试 REFLO_MAX_ATTEMPTS（4）次后放弃并抛出最后一次错误。
  let calls = 0;
  const chrome = createChromeMock();
  chrome.runtime.sendMessage = (_message, callback) => {
    calls += 1;
    callback({ ok: false, error: "Reflo API 请求失败：502 Bad Gateway", retryable: true, status: 502 });
  };
  const context = loadPopupRefloContext({ chrome, setTimeout: (fn) => { fn(); return 0; } });
  let threw = null;
  try {
    await context.__exports.fetchRefloReleaseInfoBatch(
      { apiUrl: "https://reflo/api", token: "tok" },
      [{ id: "t1", url: "u" }]
    );
  } catch (error) {
    threw = error;
  }
  assert.ok(threw && /502/.test(threw.message), "耗尽重试后应抛出最后一次错误");
  assert.strictEqual(calls, 4, "应尝试 1 次初始 + 3 次重试，共 4 次");
}

async function testRefloBackgroundClassifiesRetryable() {
  // 后台需正确标记错误是否可重试：5xx/429/网络中断可重试；4xx 与本端主动超时不可重试。
  const context = loadBackgroundRefloContext();
  const fetchReflo = context.__exports.fetchRefloReleaseInfoBatchInBackground;
  const baseMsg = { apiUrl: "https://reflo/api", token: "tok", payload: {}, timeoutMs: 1000 };

  context.fetch = async () => ({ ok: false, status: 504, statusText: "Gateway Timeout", text: async () => "" });
  let r = await fetchReflo(baseMsg);
  assert.strictEqual(r.ok, false);
  assert.strictEqual(r.retryable, true, "504 应标记为可重试");
  assert.strictEqual(r.status, 504);

  context.fetch = async () => ({ ok: false, status: 429, statusText: "Too Many Requests", text: async () => "" });
  r = await fetchReflo(baseMsg);
  assert.strictEqual(r.retryable, true, "429 应标记为可重试");

  context.fetch = async () => ({ ok: false, status: 401, statusText: "Unauthorized", text: async () => "" });
  r = await fetchReflo(baseMsg);
  assert.strictEqual(r.retryable, false, "401 不应重试");

  context.fetch = async () => { throw new TypeError("Failed to fetch"); };
  r = await fetchReflo(baseMsg);
  assert.strictEqual(r.retryable, true, "网络中断应标记为可重试");

  context.fetch = async () => { const error = new Error("aborted"); error.name = "AbortError"; throw error; };
  r = await fetchReflo(baseMsg);
  assert.strictEqual(r.retryable, false, "本端主动超时不应重试");
}

const tests = [
  testMergeMultipleFilesSameSchema,
  testMergeMultipleFilesDifferentColumnOrder,
  testMergeMultipleFilesCrossFileDuplicate,
  testRenumberSequenceColumnForMergedFiles,
  testRenumberSequenceFollowsFirstFileStart,
  testRenumberSequenceSkipsSummaryRows,
  testTaskParsing,
  testUrlRepairAndFallbackSequence,
  testExcelCorrectionSkipsSummaryRows,
  testExcelCorrectionRedExportMessage,
  testNormalizePublishTimeUsesCurrentYear,
  testNormalizePublishTimeSerialNumber,
  testNormalizePublishTimeIncludeTime,
  testApplyRefloPublishTimeSeconds,
  testNormalizeExportPublishTimeColumn,
  testBuildMarkedStyleIndexSet,
  testBuildLocalCorrectionRowsRespectsRowFilter,
  testMergeParsedFilesPropagatesFillMarks,
  testColumnDetectionPrefersExactHeader,
  testDuplicateAccountUsesCorrectAccount,
  testExcelFixWritesFixedCorrectionNotes,
  testExcelFixWritesDuplicateLinkRows,
  testMultiLinkAndSupplementKeys,
  testBackgroundOptionsAndQueue,
  testPlatformNavigationHelpers,
  testPptMatching,
  testAuxImageMatching,
  testLayoutAuxImages,
  testOutputFolderNaming,
  testAutoPptTemplateIdFlowsThroughOptions,
  testTemplateCacheRoundTrip,
  testPlaybackSourceCacheRoundTrip,
  testLoadTemplateFilesFallback,
  testRefloBatchRetriesTransientErrors,
  testRefloBatchSkipsNonRetryableError,
  testRefloBatchStopsAtMaxAttempts,
  testRefloBackgroundClassifiesRetryable,
];

(async () => {
  for (const test of tests) {
    await test();
    console.log(`✓ ${test.name}`);
  }
  console.log(`All ${tests.length} extension logic regression tests passed.`);
})().catch((error) => {
  console.error(error);
  process.exit(1);
});
