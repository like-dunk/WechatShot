importScripts("screenshot-cache.js");

const DOWNLOAD_DIR_BASE = "截图";
let sessionDownloadDir = DOWNLOAD_DIR_BASE;
const MAX_WORKBOOK_IMAGES = 200;
const MAX_WORKBOOK_BYTES = 300 * 1024 * 1024;
const ZIP32_LIMIT = 0xffffffff;
const DEFAULT_CAPTURE_SIZE = { mode: "current", width: 1440, height: 1200, label: "当前默认" };
const CAPTURE_SIZE_PRESETS = {
  current: DEFAULT_CAPTURE_SIZE,
  vertical: { mode: "vertical", width: 720, height: 1280, label: "9:16 竖屏" },
  horizontal: { mode: "horizontal", width: 1280, height: 720, label: "16:9 横屏" },
  square: { mode: "square", width: 1080, height: 1080, label: "1:1 方图" },
};
const DOUYIN_NAVIGATION_TIMEOUT_MS = 60000;
const DOUYIN_DOM_LOAD_TIMEOUT_MS = 30000;
const DOUYIN_POST_LOAD_WAIT_MS = 2500;
const DOUYIN_POST_PREPARE_WAIT_MS = 1500;
const DOUYIN_FALLBACK_RENDER_WAIT_MS = 3000;
const DOUYIN_COOLDOWN_MS = 3000;
const DOUYIN_BATCH_SIZE = 20;
const DOUYIN_PROXY_ROTATION_INTERVAL = DOUYIN_BATCH_SIZE;
const CLASH_DEFAULT_CONTROLLER_URL = "http://127.0.0.1:9090";
const CLASH_DEFAULT_GROUP_NAME = "Proxy";
const CLASH_DEFAULT_SETTLE_MS = 3000;
const PUBLIC_IP_CHECK_URLS = ["https://api.ipify.org?format=json", "https://api64.ipify.org?format=json", "https://icanhazip.com/"];

function getPublicIpCheckUrls() {
  const cacheBuster = `_t=${Date.now()}`;
  return PUBLIC_IP_CHECK_URLS.map((url) => url.includes("?") ? `${url}&${cacheBuster}` : `${url}?${cacheBuster}`);
}
const PUBLIC_IP_CHECK_TIMEOUT_MS = 8000;
const CLASH_MAX_IP_CHANGE_ATTEMPTS = 12;
const PLATFORM_LABELS = {
  weixin: "视频号",
  toutiao: "头条号",
  douyin: "抖音",
  xiaohongshu: "小红书",
};
const CUSTOM_CAPTURE_SIZE_LIMITS = {
  minWidth: 360,
  maxWidth: 1920,
  minHeight: 360,
  maxHeight: 2160,
};
const DEFAULT_STATE = {
  status: "idle",
  tasks: [],
  options: { concurrency: 2, douyinConcurrency: 1, delayMs: 800, waitMs: 12000, captureSize: DEFAULT_CAPTURE_SIZE, includeScreenshotWorkbook: false, autoGeneratePpt: true, autoPptMode: "clippings", autoPptTitle: "", douyinBatchSize: DOUYIN_BATCH_SIZE, douyinWindowMode: "regular", douyinUseIncognito: false, douyinProxyRotation: { enabled: false, controllerUrl: CLASH_DEFAULT_CONTROLLER_URL, groupName: CLASH_DEFAULT_GROUP_NAME, secret: "", nodeNames: [], rotation: DOUYIN_PROXY_ROTATION_INTERVAL, settleMs: CLASH_DEFAULT_SETTLE_MS } },
  sourceRows: [],
  sourceFileName: "",
  sourceHeaderRowIndex: 0,
  runId: "",
  supplementRepairSource: null,
  cursor: 0,
  success: 0,
  failed: 0,
  runningCount: 0,
  runningDouyinCount: 0,
  autoPptGenerated: false,
  autoPptInProgress: false,
  autoPptLauncherOpened: false,
  autoPptFailed: false,
  autoPptError: "",
  logs: [],
  stopped: false,
  paused: false,
  douyinBatchProcessed: 0,
  douyinIncognitoFallbackUsed: false,
  douyinProxyRotation: { candidates: [], nextIndex: 0, currentName: "", failures: 0, lastTargetName: "" },
};

let state = structuredClone(DEFAULT_STATE);
let workers = [];
let nextCaptureAt = 0;
let captureChain = Promise.resolve();
let captureWindowId = null;
let captureWindowPromise = null;
let captureWindowUseIncognito = false;
let calibratedCaptureSizeKey = null;

let pendingWorkbookExports = new Map();
let pendingSupplementUploads = new Map();
const AUTO_PPT_SESSION_KEY = "autoPptSession";
const AUTO_PPT_SESSION_MAX_AGE_MS = 3 * 24 * 60 * 60 * 1000;

chrome.runtime.onConnect.addListener((port) => {
  if (port.name === "workbook-download") {
    port.onMessage.addListener((message) => handleWorkbookDownloadPortMessage(port, message));
    return;
  }
  if (port.name === "supplement-upload") {
    port.onMessage.addListener((message) => handleSupplementUploadPortMessage(port, message));
    port.onDisconnect.addListener(() => cleanupUnfinishedSupplementUpload(port));
    return;
  }
});

function handleWorkbookDownloadPortMessage(port, message) {
  if (!message || !message.id) return;
  const entry = pendingWorkbookExports.get(message.id);
  if (!entry) {
    port.postMessage({ type: "ERROR", error: "带截图 Excel 数据已失效，请重新运行导出" });
    return;
  }
  if (message.type === "READY") {
    entry.offset = 0;
    port.postMessage({ type: "START", fileName: entry.fileName, totalSize: entry.bytes.length, mimeType: entry.mimeType, statusLabel: entry.statusLabel });
    sendNextWorkbookChunk(port, message.id, entry);
    return;
  }
  if (message.type === "CHUNK_RECEIVED") {
    sendNextWorkbookChunk(port, message.id, entry);
    return;
  }
  if (message.type === "DOWNLOADED") {
    pendingWorkbookExports.delete(message.id);
    log(`${entry.logLabel || "文件"}下载已触发：${entry.fileName}`, "success");
  }
}

function handleSupplementUploadPortMessage(port, message) {
  try {
    if (!message || !message.type) return;
    if (message.type === "START_UPLOAD") {
      const id = `${Date.now()}-${Math.random().toString(36).slice(2)}`;
      pendingSupplementUploads.set(id, { sourceName: message.sourceName || "截图文件夹", files: [], current: null, ready: false });
      port.supplementUploadId = id;
      postSupplementUploadAck(port, message, { type: "UPLOAD_STARTED", id });
      return;
    }
    const entry = pendingSupplementUploads.get(message.uploadId || port.supplementUploadId);
    if (!entry) throw new Error("精准补充原图数据已失效，请重新选择截图文件夹");
    if (message.type === "FILE_START") {
      entry.current = { name: sanitizeZipFileName(message.name || "截图.png"), sequenceKey: String(message.sequenceKey || ""), chunks: [] };
      postSupplementUploadAck(port, message, { type: "FILE_STARTED" });
      return;
    }
    if (message.type === "CHUNK") {
      if (!entry.current) throw new Error("未开始接收文件");
      entry.current.chunks.push(base64ToBytes(message.data || ""));
      postSupplementUploadAck(port, message, { type: "CHUNK_RECEIVED" });
      return;
    }
    if (message.type === "FILE_DONE") {
      if (!entry.current) throw new Error("未开始接收文件");
      entry.files.push({ name: entry.current.name, sequenceKey: entry.current.sequenceKey, data: concatBytes(entry.current.chunks) });
      entry.current = null;
      postSupplementUploadAck(port, message, { type: "FILE_DONE" });
      return;
    }
    if (message.type === "DONE") {
      entry.ready = true;
      postSupplementUploadAck(port, message, { type: "UPLOAD_DONE", id: message.uploadId || port.supplementUploadId });
      return;
    }
    if (message.type === "CANCEL") {
      pendingSupplementUploads.delete(message.uploadId || port.supplementUploadId);
      postSupplementUploadAck(port, message, { type: "CANCELED" });
    }
  } catch (error) {
    port.postMessage({ type: "ERROR", requestId: message && message.requestId, error: error.message });
  }
}

function postSupplementUploadAck(port, message, payload) {
  port.postMessage({ ...payload, requestId: message.requestId });
}

function cleanupUnfinishedSupplementUpload(port) {
  const id = port.supplementUploadId;
  if (!id) return;
  const entry = pendingSupplementUploads.get(id);
  if (entry && !entry.ready) pendingSupplementUploads.delete(id);
}

function sendNextWorkbookChunk(port, id, entry) {
  const chunkSize = 512 * 1024;
  if (entry.offset >= entry.bytes.length) {
    port.postMessage({ type: "DONE" });
    return;
  }
  const start = entry.offset;
  const end = Math.min(entry.bytes.length, start + chunkSize);
  entry.offset = end;
  port.postMessage({
    type: "CHUNK",
    id,
    offset: start,
    data: bytesToBase64(entry.bytes.subarray(start, end)),
  });
}

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  handleMessage(message).then(sendResponse).catch((error) => sendResponse({ ok: false, error: error.message }));
  return true;
});

async function handleMessage(message) {
  if (message.type === "GET_STATE") return getStateResponse();
  if (message.type === "GET_SUCCESS_SCREENSHOTS") return getSuccessScreenshots();
  if (message.type === "GET_SUCCESS_SCREENSHOT_RECORDS") return getSuccessScreenshotRecords();
  if (message.type === "CLAIM_AUTO_PPT_GENERATION") return claimAutoPptGeneration();
  if (message.type === "MARK_AUTO_PPT_GENERATED") return markAutoPptGenerated(message.result || null);
  if (message.type === "MARK_AUTO_PPT_FAILED") return markAutoPptFailed(message.error || "");
  if (message.type === "START") return startRun(message.tasks || [], message.options || {}, message.sourceRows || [], message.sourceFileName || "", message.sourceHeaderRowIndex || 0, message.supplementRepairUploadId || "");
  if (message.type === "PAUSE") return pauseRun();
  if (message.type === "RESUME") return resumeRun();
  if (message.type === "STOP") return stopRun();
  if (message.type === "DOWNLOAD_CORRECTED_WORKBOOK") return downloadCorrectedWorkbook(message);
  if (message.type === "REFLO_RELEASE_INFO_BATCH") return fetchRefloReleaseInfoBatchInBackground(message);
  return { ok: false, error: "未知操作" };
}

// 在后台 service worker 中发起 Reflo API 请求。
// MV3 下只有后台 worker 能凭借 host_permissions 绕过 CORS；popup 页面直接 fetch 会因服务器 CORS 白名单不含 chrome-extension:// 而抛出 "Failed to fetch"。
async function fetchRefloReleaseInfoBatchInBackground(message) {
  const apiUrl = message && message.apiUrl;
  const token = message && message.token;
  const payload = message && message.payload;
  const timeoutMs = Number(message && message.timeoutMs) > 0 ? Number(message.timeoutMs) : 600000;
  if (!apiUrl) return { ok: false, error: "Reflo API 地址未配置" };
  if (!token) return { ok: false, error: "请先填写 Reflo API Token" };

  const hasAbortController = typeof AbortController === "function";
  const controller = hasAbortController ? new AbortController() : null;
  let timer = null;
  try {
    if (controller && typeof setTimeout === "function") timer = setTimeout(() => controller.abort(), timeoutMs);
    const init = {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${token}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(payload || {}),
    };
    if (controller) init.signal = controller.signal;
    const response = await fetch(apiUrl, init);
    if (!response.ok) {
      const text = await response.text().catch(() => "");
      // 5xx 多为网关/反向代理在 Reflo 后端重试期间超时返回（502/503/504），429 为限流；
      // 这类属瞬时错误，标记 retryable 交由调用方按退避重试，避免把"正在重试"误判为最终失败。
      const retryable = response.status >= 500 || response.status === 429;
      return { ok: false, error: `Reflo API 请求失败：${response.status} ${response.statusText}${text ? `，${text.slice(0, 160)}` : ""}`, retryable, status: response.status };
    }
    const data = await response.json();
    if (!data || !Array.isArray(data.items)) return { ok: false, error: "Reflo API 响应格式无效", retryable: false };
    return { ok: true, data };
  } catch (error) {
    // 本端主动 abort（已等满 timeoutMs）说明服务端长时间无响应，再重试也会再等满，故不重试。
    if (error && error.name === "AbortError") return { ok: false, error: `Reflo API 请求超时（${Math.round(timeoutMs / 1000)} 秒）`, retryable: false };
    // 连接中断 / Failed to fetch 等网络层错误属瞬时故障，标记为可重试。
    return { ok: false, error: `Reflo API 请求失败：${error && error.message ? error.message : "网络错误（Failed to fetch）"}`, retryable: true };
  } finally {
    if (timer !== null && typeof clearTimeout === "function") clearTimeout(timer);
  }
}

async function getStateResponse() {
  if (state.status === "idle") {
    const session = await getAutoPptSession();
    if (session) return { ok: true, state: buildPublicStateFromSession(session) };
  }
  return { ok: true, state: getPublicState() };
}

async function startRun(tasks, options, sourceRows = [], sourceFileName = "", sourceHeaderRowIndex = 0, supplementRepairUploadId = "") {
  if (state.status === "running" || state.status === "paused" || state.status === "stopping" || state.status === "finalizing") return { ok: false, error: "已有任务正在运行" };
  if (!tasks.length) return { ok: false, error: "没有可处理的任务" };
  const supplementRepairSource = resolveSupplementRepairSource(options, supplementRepairUploadId);
  await ScreenshotCache.cleanupOld();
  await clearAutoPptSession();
  state = structuredClone(DEFAULT_STATE);
  state.status = "running";
  state.runId = buildRunId();
  sessionDownloadDir = buildSessionDownloadDir(sourceFileName);
  state.tasks = tasks.map((task, index) => ({ ...task, listIndex: index, platform: task.platform || detectPlatformFromUrl(task.url), status: "PENDING", attempts: 0, screenshotCacheKey: "" }));
  state.options = normalizeOptions(options, state.tasks);
  state.sourceRows = Array.isArray(sourceRows) ? sourceRows : [];
  state.sourceFileName = sourceFileName || "";
  state.sourceHeaderRowIndex = clampInteger(sourceHeaderRowIndex, 0, 0, Math.max(0, state.sourceRows.length - 1));
  state.supplementRepairSource = supplementRepairSource;
  nextCaptureAt = 0;
  captureChain = Promise.resolve();
  captureWindowPromise = null;
  captureWindowId = null;
  captureWindowUseIncognito = false;
  calibratedCaptureSizeKey = null;
  log(`开始处理 ${state.tasks.length} 条任务，并发 ${state.options.concurrency}，截图窗口 ${state.options.captureSize.width}×${state.options.captureSize.height}（${state.options.captureSize.label}）${state.options.includeScreenshotWorkbook ? "，将导出带截图 Excel" : ""}${state.options.autoGeneratePpt ? "，完成后将生成 PPT" : ""}${state.options.enableSupplementRepairZip ? "，将导出修复版 ZIP" : ""}`);
  if (state.options.douyinConservativeMode) {
    const douyinCount = state.tasks.filter((t) => t.platform === "douyin").length;
    const nonDouyinCount = state.tasks.length - douyinCount;
    const rotationText = isDouyinProxyRotationEnabled() ? `、每 ${state.options.douyinProxyRotation.rotation} 条尝试轮换 VPN IP` : "";
    log(`检测到 ${douyinCount} 条抖音任务，已启用保守模式：抖音任务单并发执行、前台加载、最长 60 秒作品页验证、任务间冷却 3 秒、每 ${state.options.douyinBatchSize} 条重建${getDouyinWindowModeLabel()}截图窗口${rotationText}${nonDouyinCount > 0 ? `；其他 ${nonDouyinCount} 条非抖音任务按并发 ${state.options.concurrency} 执行` : ""}`, "warning");
    if (isDouyinProxyRotationEnabled()) {
      const proxyOptions = state.options.douyinProxyRotation;
      log(`抖音 VPN 轮换配置：Clash 控制器 ${proxyOptions.controllerUrl}，策略组 ${proxyOptions.groupName}，周期 ${proxyOptions.rotation} 条，密钥${proxyOptions.secret ? "已填写" : "未填写"}；插件将切换本机 Clash 节点，Chrome 是否经由该代理取决于当前系统/浏览器代理设置`, "warning");
      if (proxyOptions.nodeNames.length) log(`抖音 VPN 指定轮换节点 ${proxyOptions.nodeNames.length} 个：${proxyOptions.nodeNames.join("，")}`, "warning");
    }
  }
  workers = [];
  for (let i = 0; i < state.options.concurrency; i += 1) {
    workers.push(workerLoop(i + 1));
  }
  Promise.allSettled(workers).then(finalizeRun);
  return { ok: true, state: getPublicState() };
}

function pauseRun() {
  if (state.status !== "running") return { ok: false, error: "当前没有运行中的任务" };
  state.paused = true;
  state.status = "paused";
  log("任务已暂停", "warning");
  return { ok: true, state: getPublicState() };
}

function resumeRun() {
  if (state.status !== "paused") return { ok: false, error: "当前没有暂停的任务" };
  state.paused = false;
  state.status = "running";
  log("任务已继续", "success");
  return { ok: true, state: getPublicState() };
}

async function stopRun() {
  if (state.status !== "running" && state.status !== "paused") return { ok: false, error: "当前没有可停止的任务" };
  state.stopped = true;
  state.paused = false;
  state.status = "stopping";
  log("正在停止任务", "warning");
  return { ok: true, state: getPublicState() };
}

async function workerLoop(workerId) {
  let tab = null;
  try {
    while (!state.stopped) {
      await waitWhilePaused();
      const task = nextTask();
      if (!task) break;
      if (task.__wait) {
        await sleep(500);
        continue;
      }
      state.runningCount += 1;
      const isDouyin = isDouyinTask(task);
      if (isDouyin) {
        state.runningDouyinCount += 1;
      }
      task.status = "RUNNING";
      let shouldCountDouyinBatch = false;
      const attemptsBefore = task.attempts;
      log(`[${task.listIndex + 1}/${state.tasks.length}] Worker ${workerId} 打开 ${getTaskPlatformLabel(task)} ${task.fileName}`);
      try {
        tab = await ensureWorkerTabForTask(tab, task);
        await processTask(tab.id, task);
        task.status = "SUCCESS";
        state.success += 1;
        shouldCountDouyinBatch = isDouyinTask(task);
        log(`[${task.listIndex + 1}/${state.tasks.length}] SUCCESS ${task.fileName}`, "success");
        logTaskPerf(task, "success");
      } catch (error) {
        const isTabDestroyed = /No tab with id|tab.*not found|tab.*closed/i.test(error.message);
        if (isTabDestroyed && !isDouyin) {
          // 非抖音任务因窗口重建导致 tab 被销毁，不消耗重试次数
          task.status = "PENDING";
          task.attempts = attemptsBefore;
          tab = null;
          log(`[${task.listIndex + 1}/${state.tasks.length}] 截图窗口重建，重新排队 ${task.fileName}`, "warning");
        } else {
          if (task.attempts === attemptsBefore) task.attempts += 1;
          const shouldRetry = task.attempts < 2 && !state.stopped;
          if (shouldRetry) {
            task.status = "PENDING";
            log(`[${task.listIndex + 1}/${state.tasks.length}] 重试 ${task.fileName}: ${error.message}`, "warning");
          } else if (state.stopped) {
            task.status = "STOPPED";
            task.error = "任务已停止";
            log(`[${task.listIndex + 1}/${state.tasks.length}] STOPPED ${task.fileName}`, "warning");
          } else {
            task.status = "FAILED";
            task.error = error.message;
            state.failed += 1;
            shouldCountDouyinBatch = isDouyinTask(task);
            log(`[${task.listIndex + 1}/${state.tasks.length}] FAILED ${task.fileName}: ${error.message}`, "failed");
          }
          logTaskPerf(task, shouldRetry || state.stopped ? "warning" : "failed");
        }
      } finally {
        state.runningCount = Math.max(0, state.runningCount - 1);
        if (isDouyin) {
          state.runningDouyinCount = Math.max(0, state.runningDouyinCount - 1);
        }
      }
      const restartResult = shouldCountDouyinBatch ? await restartDouyinBatchWindowIfNeeded(tab, workerId) : { tab, restarted: false };
      tab = restartResult.tab;
      const taskDelayMs = restartResult.restarted ? 0 : getTaskDelayMs(task);
      if (taskDelayMs > 0) await sleep(taskDelayMs);
    }
  } finally {
    if (tab && tab.id) {
      try {
        await chrome.tabs.remove(tab.id);
      } catch {}
    }
  }
}

async function processTask(tabId, task) {
  const perf = {};
  const totalStartedAt = Date.now();
  task.perf = perf;
  try {
    task.attempts += 1;
    task.platform = task.platform || detectPlatformFromUrl(task.url);
    task.platformLabel = task.platformLabel || getTaskPlatformLabel(task);
    const loadStartedAt = Date.now();
    await loadTaskUrl(tabId, task);
    perf.loadMs = Date.now() - loadStartedAt;
    const postLoadWaitStartedAt = Date.now();
    await sleep(getPostLoadWaitMs(task));
    perf.postLoadWaitMs = Date.now() - postLoadWaitStartedAt;
    const prepareStartedAt = Date.now();
    const prepareResult = await prepareTab(tabId, task);
    validatePreparedPage(prepareResult, task);
    perf.prepareMs = Date.now() - prepareStartedAt;
    const postPrepareWaitStartedAt = Date.now();
    await sleep(getPostPrepareWaitMs(task, prepareResult));
    perf.postPrepareWaitMs = Date.now() - postPrepareWaitStartedAt;
    const captureResult = await captureTabSerial(tabId, getTaskUseIncognito(task));
    Object.assign(perf, captureResult.perf);
    const dataUrl = captureResult.dataUrl;
    if (!dataUrl || dataUrl.length < 5000) throw new Error("截图数据过小，可能是页面空白、未登录、加载失败或弹窗遮挡");
    const downloadStartedAt = Date.now();
    await downloadScreenshot(dataUrl, task.fileName);
    perf.downloadMs = Date.now() - downloadStartedAt;
    if (state.options.includeScreenshotWorkbook || state.options.enableSupplementRepairZip || state.options.autoGeneratePpt) {
      try {
        await cacheTaskScreenshot(task, dataUrl);
      } catch (error) {
        throw new Error(`截图已下载，但写入缓存失败，无法用于自动 PPT/Excel/修复 ZIP：${error.message}`);
      }
    }
  } finally {
    perf.totalMs = Date.now() - totalStartedAt;
  }
}

async function cacheTaskScreenshot(task, dataUrl) {
  const blob = await ScreenshotCache.dataUrlToBlob(dataUrl);
  const cacheKey = await ScreenshotCache.putScreenshot({
    runId: state.runId,
    taskId: task.id,
    fileName: task.fileName || "截图.png",
    task: buildScreenshotTaskMeta(task),
    blob,
  });
  task.screenshotCacheKey = cacheKey;
}

async function createWorkerTab() {
  const windowId = await ensureCaptureWindow(false);
  return chrome.tabs.create({ windowId, url: "about:blank", active: false });
}

async function createWorkerTabForTask(task) {
  const windowId = await ensureCaptureWindow(getTaskUseIncognito(task));
  return chrome.tabs.create({ windowId, url: "about:blank", active: false });
}

async function ensureWorkerTabForTask(tab, task) {
  const useIncognito = getTaskUseIncognito(task);
  const shouldReplaceWindow = captureWindowId && captureWindowUseIncognito !== useIncognito;
  if (shouldReplaceWindow) {
    if (tab && tab.id) {
      try {
        await chrome.tabs.remove(tab.id);
      } catch {}
    }
    await closeCaptureWindow();
    return createWorkerTabForTask(task);
  }
  if (tab && tab.id && captureWindowId) {
    try {
      await chrome.tabs.get(tab.id);
      return tab;
    } catch {}
  }
  return createWorkerTabForTask(task);
}

async function restartDouyinBatchWindowIfNeeded(tab, workerId) {
  state.douyinBatchProcessed += 1;
  const batchSize = state.options.douyinBatchSize || DOUYIN_BATCH_SIZE;
  const pendingDouyinCount = countPendingDouyinTasks();
  if (!shouldRestartDouyinBatch(state.douyinBatchProcessed, batchSize, pendingDouyinCount)) return { tab, restarted: false };
  const completedBatch = Math.floor(state.douyinBatchProcessed / batchSize);
  const rotationText = isDouyinProxyRotationEnabled() ? "并尝试轮换 VPN IP" : "";
  log(`抖音批次 ${completedBatch} 已完成 ${batchSize} 条，正在重建${getDouyinWindowModeLabel()}截图窗口${rotationText ? `，${rotationText}` : ""}...`, "warning");
  if (tab && tab.id) {
    try {
      await chrome.tabs.remove(tab.id);
    } catch {}
  }
  await closeCaptureWindow();
  nextCaptureAt = 0;
  captureChain = Promise.resolve();
  if (state.stopped) return { tab: null, restarted: true };
  await rotateDouyinProxyIfEnabled(completedBatch);
  if (state.stopped) return { tab: null, restarted: true };
  await sleep(DOUYIN_COOLDOWN_MS);
  if (state.stopped) return { tab: null, restarted: true };
  const nextTab = await createWorkerTabForTask({ platform: "douyin" });
  log(`抖音批次 ${completedBatch + 1} 已启动，Worker ${workerId} 使用新的${getDouyinWindowModeLabel()}截图窗口`, "success");
  return { tab: nextTab, restarted: true };
}

async function loadTaskUrl(tabId, task) {
  if (task.platform === "douyin") {
    const windowId = await ensureCaptureWindow(getTaskUseIncognito(task));
    const previousTab = await chrome.tabs.get(tabId);
    const previousUrl = previousTab.url || "";
    await focusCaptureWindow(windowId);
    await chrome.tabs.update(tabId, { url: task.url, active: true });
    await focusCaptureWindow(windowId);
    await waitForNavigationStart(tabId, previousUrl, 5000);
    try {
      await waitForTabDomReady(tabId, DOUYIN_DOM_LOAD_TIMEOUT_MS);
    } catch {}
    await waitForDouyinContentUrl(tabId, DOUYIN_NAVIGATION_TIMEOUT_MS);
    try {
      await waitForTabDomReady(tabId, 10000);
    } catch {}
    return;
  }
  await chrome.tabs.update(tabId, { url: task.url, active: false });
  await waitForTabComplete(tabId, state.options.waitMs);
  await waitForPlatformNavigation(tabId, task, state.options.waitMs);
}

async function ensureCaptureWindow(useIncognito = false) {
  const captureSize = state.options.captureSize || DEFAULT_CAPTURE_SIZE;
  if (captureWindowId) {
    try {
      await chrome.windows.get(captureWindowId);
      if (captureWindowUseIncognito !== useIncognito) {
        await closeCaptureWindow();
      } else {
        return captureWindowId;
      }
    } catch {
      captureWindowId = null;
      captureWindowUseIncognito = false;
      calibratedCaptureSizeKey = null;
    }
  }
  if (!captureWindowPromise) {
    captureWindowPromise = createCaptureWindow(captureSize, useIncognito).then((window) => {
      captureWindowId = window.id;
      captureWindowUseIncognito = Boolean(window.incognito || (useIncognito && state.options.douyinUseIncognito));
      calibratedCaptureSizeKey = null;
      log(`已创建${getDouyinWindowModeLabel(captureWindowUseIncognito)}专用截图窗口：${captureSize.width}×${captureSize.height}（${captureSize.label}）`, "success");
      return captureWindowId;
    }).finally(() => {
      captureWindowPromise = null;
    });
  }
  return captureWindowPromise;
}

async function createCaptureWindow(captureSize, useIncognito = false) {
  try {
    return await chrome.windows.create(buildCaptureWindowCreateOptions(captureSize, useIncognito));
  } catch (error) {
    if (!useIncognito) throw error;
    state.options.douyinUseIncognito = false;
    state.options.douyinWindowMode = "regular";
    state.douyinIncognitoFallbackUsed = true;
    log(`无痕截图窗口创建失败，已回退普通窗口：${error.message || error}。如需无痕模式，请在 chrome://extensions/ 中允许本扩展在无痕模式下运行，并先在无痕窗口登录抖音。`, "warning");
    return chrome.windows.create(buildCaptureWindowCreateOptions(captureSize, false));
  }
}

function buildCaptureWindowCreateOptions(captureSize, useIncognito) {
  const options = {
    url: "about:blank",
    focused: true,
    state: "normal",
    width: captureSize.width,
    height: captureSize.height,
  };
  if (useIncognito) options.incognito = true;
  return options;
}

function nextTask() {
  const pendingTasks = state.tasks.filter((item) => item.status === "PENDING");
  if (!pendingTasks.length) return null;

  const douyinRunning = state.runningDouyinCount > 0;

  if (douyinRunning) {
    const nonDouyinTask = pendingTasks.find((item) => !isDouyinTask(item));
    if (nonDouyinTask) return nonDouyinTask;
    return { __wait: true };
  }

  return pendingTasks[0];
}

function shouldRestartDouyinBatch(processedCount, batchSize, pendingDouyinCount) {
  return batchSize > 0 && processedCount > 0 && processedCount % batchSize === 0 && pendingDouyinCount > 0;
}

function countPendingDouyinTasks() {
  return state.tasks.filter((task) => task.status === "PENDING" && isDouyinTask(task)).length;
}

function isDouyinProxyRotationEnabled(options = state.options) {
  return Boolean(options && options.douyinProxyRotation && options.douyinProxyRotation.enabled);
}

async function rotateDouyinProxyIfEnabled(completedBatch) {
  if (!isDouyinProxyRotationEnabled()) return;
  try {
    const proxyOptions = state.options.douyinProxyRotation;
    const beforeIp = await logPublicIpProbe(`抖音批次 ${completedBatch} 轮换前`);
    log(`抖音批次 ${completedBatch} 开始 VPN 轮换：读取 Clash ${proxyOptions.controllerUrl} 的 ${proxyOptions.groupName} 策略组...`, "warning");
    const result = await rotateClashProxyUntilIpChanges(state.options.douyinProxyRotation, state.douyinProxyRotation, beforeIp, completedBatch);
    state.douyinProxyRotation = {
      ...state.douyinProxyRotation,
      candidates: result.candidates,
      nextIndex: result.nextIndex,
      currentName: result.targetName,
      lastTargetName: result.targetName,
      lastRotatedAt: Date.now(),
    };
    const fromText = result.previousName ? `${result.previousName} -> ` : "";
    const confirmedText = result.confirmedName ? `，确认当前节点：${result.confirmedName}` : "";
    log(`抖音批次 ${completedBatch} VPN 轮换成功：${fromText}${result.targetName}（候选 ${result.candidateCount} 个，目标序号 ${result.targetPosition}/${result.candidateCount}${confirmedText}）`, "success");
    const afterIp = result.afterIp || await logPublicIpProbe(`抖音批次 ${completedBatch} 轮换后`);
    if (beforeIp && afterIp) {
      const changed = beforeIp.ip !== afterIp.ip;
      log(`抖音批次 ${completedBatch} 出口 IP ${changed ? "已变化" : "未变化"}：${beforeIp.ip} -> ${afterIp.ip}`, changed ? "success" : "warning");
    }
  } catch (error) {
    state.douyinProxyRotation.failures += 1;
    log(`抖音批次 ${completedBatch} VPN 轮换失败，继续使用当前网络：${error.message}`, "warning");
  }
}

async function rotateClashProxyUntilIpChanges(options, rotationState, beforeIp, completedBatch) {
  const candidateState = { ...rotationState };
  const maxAttempts = getClashIpChangeMaxAttempts(options);
  let lastResult = null;
  let lastAfterIp = null;
  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    const result = await rotateClashProxy(options, candidateState);
    lastResult = result;
    candidateState.nextIndex = result.nextIndex;
    candidateState.currentName = result.targetName;
    if (options.settleMs > 0) await sleep(options.settleMs);
    const afterIp = await logPublicIpProbe(`抖音批次 ${completedBatch} 轮换后${attempt > 1 ? `尝试 ${attempt}` : ""}`);
    lastAfterIp = afterIp;
    if (!beforeIp || !afterIp) return { ...result, afterIp };
    if (beforeIp.ip !== afterIp.ip) return { ...result, afterIp };
    if (attempt < maxAttempts) log(`抖音批次 ${completedBatch} 出口 IP 仍未变化，继续尝试下一个 VPN 节点（${attempt}/${maxAttempts}）`, "warning");
  }
  return { ...lastResult, afterIp: lastAfterIp };
}

function getClashIpChangeMaxAttempts(options) {
  const requestedCount = normalizeProxyNodeNames(options && options.nodeNames).length;
  if (!requestedCount) return 1;
  return clampInteger(requestedCount, 1, 1, CLASH_MAX_IP_CHANGE_ATTEMPTS);
}

async function logPublicIpProbe(label) {
  try {
    const result = await fetchPublicIpInfo();
    log(`${label}出口 IP：${formatPublicIpInfo(result)}`, "warning");
    return result;
  } catch (error) {
    log(`${label}出口 IP 检测失败：${error.message}`, "warning");
    return null;
  }
}

async function fetchPublicIpInfo(urls = getPublicIpCheckUrls()) {
  if (typeof fetch !== "function") throw new Error("当前环境不支持出口 IP 检测");
  let lastError = null;
  for (const url of urls) {
    try {
      const response = await fetchWithTimeout(url, PUBLIC_IP_CHECK_TIMEOUT_MS);
      if (!response || !response.ok) {
        const status = response ? `${response.status || ""} ${response.statusText || ""}`.trim() : "无响应";
        throw new Error(`IP 查询请求失败：${status}`);
      }
      const result = await parsePublicIpResponse(response);
      if (!result.ip) throw new Error("IP 查询响应中没有可识别的 IP");
      return { ...result, source: url };
    } catch (error) {
      lastError = error;
    }
  }
  throw new Error(lastError ? lastError.message : "所有 IP 查询服务均不可用");
}

async function fetchWithTimeout(url, timeoutMs) {
  const hasAbortController = typeof AbortController === "function";
  const controller = hasAbortController ? new AbortController() : null;
  const init = controller ? { cache: "no-store", signal: controller.signal } : { cache: "no-store" };
  let timer = null;
  try {
    if (controller && typeof setTimeout === "function") timer = setTimeout(() => controller.abort(), timeoutMs);
    return await fetch(url, init);
  } finally {
    if (timer !== null && typeof clearTimeout === "function") clearTimeout(timer);
  }
}

async function parsePublicIpResponse(response) {
  if (typeof response.text === "function") return parsePublicIpPayload(await response.text());
  if (typeof response.json === "function") return parsePublicIpPayload(await response.json());
  return {};
}

function parsePublicIpPayload(payload) {
  if (payload && typeof payload === "object") {
    return {
      ip: extractPublicIp(payload.ip || payload.query || payload.origin || payload.address),
      country: String(payload.country || payload.country_name || "").trim(),
      org: String(payload.org || payload.asn || payload.isp || "").trim(),
    };
  }
  const text = String(payload || "").trim();
  try {
    return parsePublicIpPayload(JSON.parse(text));
  } catch {}
  return { ip: extractPublicIp(text), country: "", org: "" };
}

function extractPublicIp(value) {
  const text = String(value || "").trim();
  const ipv4 = text.match(/\b(?:\d{1,3}\.){3}\d{1,3}\b/);
  if (ipv4) return ipv4[0];
  const ipv6 = text.match(/\b(?:[0-9a-f]{1,4}:){2,}[0-9a-f:]*\b/i);
  return ipv6 ? ipv6[0] : "";
}

function formatPublicIpInfo(info) {
  const extra = [info.country, info.org].filter(Boolean).join(" / ");
  return `${info.ip}${extra ? `（${extra}）` : ""}`;
}

async function rotateClashProxy(options, rotationState = {}) {
  const group = await fetchClashProxyGroup(options);
  const candidates = getClashRotationCandidates(group, options);
  if (candidates.length < 2) throw new Error(`策略组 ${options.groupName} 可轮换节点不足`);
  const previousName = group.now || rotationState.currentName || "";
  let nextIndex = Number.isInteger(rotationState.nextIndex) ? rotationState.nextIndex : 0;
  if (nextIndex < 0 || nextIndex >= candidates.length) nextIndex = 0;
  if (previousName && candidates.includes(previousName)) nextIndex = (candidates.indexOf(previousName) + 1) % candidates.length;
  let targetName = candidates[nextIndex];
  if (targetName === previousName && candidates.length > 1) {
    nextIndex = (nextIndex + 1) % candidates.length;
    targetName = candidates[nextIndex];
  }
  log(`Clash 策略组 ${options.groupName} 当前节点：${previousName || "未知"}；可轮换节点 ${candidates.length} 个；本次目标：${targetName}`, "warning");
  await updateClashProxyGroup(options, targetName);
  let confirmedName = "";
  try {
    const confirmedGroup = await fetchClashProxyGroup(options);
    confirmedName = confirmedGroup && confirmedGroup.now ? confirmedGroup.now : "";
  } catch (error) {
    log(`Clash 节点切换后确认失败：${error.message}`, "warning");
  }
  return {
    previousName,
    targetName,
    confirmedName,
    candidateCount: candidates.length,
    candidates,
    targetPosition: nextIndex + 1,
    nextIndex: (nextIndex + 1) % candidates.length,
  };
}

function getClashRotationCandidates(group, options = {}) {
  const available = extractClashCandidateNames(group);
  const requested = normalizeProxyNodeNames(options.nodeNames);
  if (!requested.length) return available;
  const availableSet = new Set(available);
  const matched = requested.filter((name) => availableSet.has(name));
  const missing = requested.filter((name) => !availableSet.has(name));
  if (missing.length) log(`Clash 策略组 ${options.groupName} 未找到指定节点：${missing.join("，")}`, "warning");
  if (matched.length < 2) throw new Error(`指定轮换节点可用数量不足：${matched.length}/${requested.length}`);
  return matched;
}

async function fetchClashProxyGroup(options) {
  return requestClashApi(options, `/proxies/${encodeURIComponent(options.groupName)}`);
}

async function updateClashProxyGroup(options, targetName) {
  return requestClashApi(options, `/proxies/${encodeURIComponent(options.groupName)}`, {
    method: "PUT",
    body: JSON.stringify({ name: targetName }),
  });
}

async function requestClashApi(options, path, init = {}) {
  if (typeof fetch !== "function") throw new Error("当前环境不支持访问 Clash 控制器");
  const headers = { ...(init.headers || {}) };
  if (options.secret) headers.Authorization = `Bearer ${options.secret}`;
  if (init.body) headers["Content-Type"] = headers["Content-Type"] || "application/json";
  const response = await fetch(`${options.controllerUrl}${path}`, { ...init, headers });
  if (!response || !response.ok) {
    const detail = response ? await readClashResponseText(response) : "";
    const status = response ? `${response.status || ""} ${response.statusText || ""}`.trim() : "无响应";
    throw new Error(`Clash 控制器请求失败：${status}${detail ? `，${detail}` : ""}`);
  }
  if (response.status === 204) return {};
  if (typeof response.json !== "function") return {};
  try {
    return await response.json();
  } catch {
    return {};
  }
}

async function readClashResponseText(response) {
  try {
    if (typeof response.text === "function") return await response.text();
  } catch {}
  return "";
}

function extractClashCandidateNames(group) {
  const names = Array.isArray(group && group.all) ? group.all : Array.isArray(group && group.proxies) ? group.proxies : [];
  return names.map((name) => String(name || "").trim()).filter(isRotatableClashProxyName);
}

function normalizeProxyNodeNames(names) {
  const values = Array.isArray(names) ? names : String(names || "").split(/[\n,，]+/);
  const seen = new Set();
  return values
    .map((name) => String(name || "").trim())
    .filter((name) => {
      if (!name || seen.has(name)) return false;
      seen.add(name);
      return true;
    });
}

function isRotatableClashProxyName(name) {
  if (!name) return false;
  const upperName = name.toUpperCase();
  if (upperName === "DIRECT" || upperName === "REJECT" || upperName === "GLOBAL") return false;
  if (/AUTO|URLTEST|URL-TEST|FALLBACK|LOAD-BALANCE|负载|自动/.test(upperName)) return false;
  return true;
}

function waitWhilePaused() {
  return new Promise((resolve) => {
    const timer = setInterval(() => {
      if (!state.paused || state.stopped) {
        clearInterval(timer);
        resolve();
      }
    }, 300);
  });
}

function waitForTabComplete(tabId, timeoutMs) {
  return new Promise((resolve, reject) => {
    let done = false;
    const timeout = setTimeout(() => finish(new Error("页面加载超时")), timeoutMs);
    const listener = (updatedTabId, changeInfo) => {
      if (updatedTabId === tabId && changeInfo.status === "complete") finish();
    };
    const finish = (error) => {
      if (done) return;
      done = true;
      clearTimeout(timeout);
      chrome.tabs.onUpdated.removeListener(listener);
      if (error) reject(error);
      else resolve();
    };
    chrome.tabs.onUpdated.addListener(listener);
    chrome.tabs.get(tabId).then((tab) => {
      if (tab.status === "complete") finish();
    }).catch((error) => finish(error));
  });
}

async function waitForNavigationStart(tabId, previousUrl, timeoutMs) {
  const startedAt = Date.now();
  while (Date.now() - startedAt < timeoutMs) {
    const tab = await chrome.tabs.get(tabId);
    if ((tab.url || "") !== previousUrl || tab.status === "loading") return;
    await sleep(200);
  }
}

function waitForTabDomReady(tabId, timeoutMs) {
  const startedAt = Date.now();
  return new Promise((resolve, reject) => {
    const check = async () => {
      try {
        const [{ result } = {}] = await chrome.scripting.executeScript({
          target: { tabId },
          func: () => document.readyState,
        });
        if (result === "interactive" || result === "complete") {
          resolve();
          return;
        }
      } catch {}
      if (Date.now() - startedAt >= timeoutMs) {
        reject(new Error("页面加载超时"));
        return;
      }
      setTimeout(check, 300);
    };
    check();
  });
}

async function waitForPlatformNavigation(tabId, task, timeoutMs) {
  if (task.platform !== "douyin" && task.platform !== "xiaohongshu") return;
  const startedAt = Date.now();
  const maxWaitMs = Math.max(5000, Math.min(timeoutMs || 12000, 30000));
  let repairedXiaohongshuRedirect = false;
  while (Date.now() - startedAt < maxWaitMs) {
    const tab = await chrome.tabs.get(tabId);
    const currentUrl = tab.url || "";
    if (task.platform === "xiaohongshu" && !repairedXiaohongshuRedirect) {
      const repairedUrl = extractXiaohongshuRedirectUrl(currentUrl);
      if (repairedUrl) {
        repairedXiaohongshuRedirect = true;
        log(`小红书 404 跳转页已自动修复为真实笔记链接：${repairedUrl}`, "warning");
        await chrome.tabs.update(tabId, { url: repairedUrl, active: false });
        await sleep(500);
        continue;
      }
    }
    if (task.platform === "xiaohongshu" && isXiaohongshuUnavailableNavigationUrl(currentUrl)) {
      throw new Error(`小红书页面显示 Web 端暂不可浏览或需要 App 扫码查看；最后地址：${currentUrl || "空"}`);
    }
    const platform = detectPlatformFromUrl(currentUrl);
    if (platform === "douyin" && isResolvedDouyinUrl(currentUrl)) return;
    if (platform === "douyin" && !isDouyinShortUrl(currentUrl)) return;
    if (platform === "xiaohongshu" && isResolvedXiaohongshuUrl(currentUrl)) return;
    if (platform === "xiaohongshu" && !isXiaohongshuShortUrl(currentUrl)) return;
    await sleep(500);
  }
}

async function waitForDouyinContentUrl(tabId, timeoutMs) {
  const startedAt = Date.now();
  let lastLoggedSecond = -1;
  while (Date.now() - startedAt < timeoutMs) {
    const tab = await chrome.tabs.get(tabId);
    const url = tab.url || "";
    if (isResolvedDouyinUrl(url)) return;
    if (isDouyinGoneUrl(url)) throw new Error("抖音作品不存在或已删除");
    if (isUnsupportedDouyinNavigation(url, startedAt)) throw new Error("抖音链接未跳转到支持的作品页，可能已失效或被风控拦截");
    const elapsedSecond = Math.floor((Date.now() - startedAt) / 1000);
    if (elapsedSecond > 0 && elapsedSecond % 5 === 0 && elapsedSecond !== lastLoggedSecond) {
      lastLoggedSecond = elapsedSecond;
      log(`抖音作品页验证中... 剩余 ${Math.max(0, Math.ceil((timeoutMs - (Date.now() - startedAt)) / 1000))} 秒`);
    }
    await sleep(1000);
  }
  throw new Error("抖音作品页验证超时，可能需要登录、短链失效或被风控拦截");
}

async function prepareTab(tabId, task = {}) {
  try {
    await chrome.scripting.executeScript({
      target: { tabId },
      files: ["content.js"],
    });
  } catch {}
  const [{ result } = {}] = await chrome.scripting.executeScript({
    target: { tabId },
    args: [{ platform: task.platform || detectPlatformFromUrl(task.url), url: task.url }],
    func: (options) => {
      if (window.shipinhaoPrepareForScreenshot) return window.shipinhaoPrepareForScreenshot(options);
      return { ok: true, message: "页面准备函数未加载" };
    },
  });
  return result;
}

function validatePreparedPage(result, task) {
  if (!result) return;
  if (result.ok === false) throw new Error(result.message || `${getTaskPlatformLabel(task)} 页面准备失败`);
}

function detectPlatformFromUrl(url) {
  try {
    const parsed = new URL(url);
    const host = parsed.hostname.toLowerCase();
    const path = parsed.pathname.toLowerCase();
    if ((host === "weixin.qq.com" && path.startsWith("/sph/")) || host === "channels.weixin.qq.com") return "weixin";
    if ((host === "m.toutiao.com" && ["/is/", "/video/"].some((prefix) => path.startsWith(prefix))) || ((host === "toutiao.com" || host === "www.toutiao.com") && ["/article/", "/w/", "/video/"].some((prefix) => path.startsWith(prefix)))) return "toutiao";
    if (host === "v.douyin.com" || ((host === "douyin.com" || host === "www.douyin.com") && ["/video/", "/note/"].some((prefix) => path.startsWith(prefix)))) return "douyin";
    if (host === "xhslink.com" || ((host === "xiaohongshu.com" || host === "www.xiaohongshu.com") && ["/explore/", "/discovery/item/"].some((prefix) => path.startsWith(prefix)))) return "xiaohongshu";
    return "";
  } catch {
    return "";
  }
}

function isResolvedXiaohongshuUrl(url) {
  try {
    const parsed = new URL(url);
    const host = parsed.hostname.toLowerCase();
    const path = parsed.pathname.toLowerCase();
    return (host === "xiaohongshu.com" || host === "www.xiaohongshu.com") && ["/explore/", "/discovery/item/"].some((prefix) => path.startsWith(prefix));
  } catch {
    return false;
  }
}

function isXiaohongshuShortUrl(url) {
  try {
    return new URL(url).hostname.toLowerCase() === "xhslink.com";
  } catch {
    return false;
  }
}

function extractXiaohongshuRedirectUrl(url) {
  try {
    const parsed = new URL(url);
    const host = parsed.hostname.toLowerCase();
    const path = parsed.pathname.toLowerCase();
    if ((host !== "xiaohongshu.com" && host !== "www.xiaohongshu.com") || path !== "/404") return "";
    const redirectPath = parsed.searchParams.get("redirectPath") || extractNestedQueryParam(parsed.searchParams.get("source"), "redirectPath");
    if (!redirectPath) return "";
    const target = new URL(redirectPath, parsed.origin);
    const targetUrl = target.href;
    if (!isResolvedXiaohongshuUrl(targetUrl)) return "";
    return targetUrl === parsed.href ? "" : targetUrl;
  } catch {
    return "";
  }
}

function extractNestedQueryParam(url, name) {
  const match = new RegExp(`[?&]${name}=([^&]+)`).exec(String(url || ""));
  return match ? decodeURIComponent(match[1].replace(/\+/g, "%20")) : "";
}

function isXiaohongshuUnavailableNavigationUrl(url) {
  try {
    const parsed = new URL(url);
    const host = parsed.hostname.toLowerCase();
    const path = parsed.pathname.toLowerCase();
    if (host !== "xiaohongshu.com" && host !== "www.xiaohongshu.com") return false;
    return path === "/404" || parsed.searchParams.get("error_code") === "300031";
  } catch {
    return false;
  }
}

function isResolvedDouyinUrl(url) {
  try {
    const parsed = new URL(url);
    const host = parsed.hostname.toLowerCase();
    const path = parsed.pathname.toLowerCase();
    return (host === "douyin.com" || host === "www.douyin.com") && ["/video/", "/note/"].some((prefix) => path.startsWith(prefix));
  } catch {
    return false;
  }
}

function isDouyinShortUrl(url) {
  try {
    return new URL(url).hostname.toLowerCase() === "v.douyin.com";
  } catch {
    return false;
  }
}

function isDouyinGoneUrl(url) {
  try {
    const parsed = new URL(url);
    const host = parsed.hostname.toLowerCase();
    const path = parsed.pathname.replace(/\/+$/, "");
    return (host === "douyin.com" || host === "www.douyin.com") && path === "";
  } catch {
    return false;
  }
}

function isUnsupportedDouyinNavigation(url, startedAt) {
  try {
    const parsed = new URL(url);
    const host = parsed.hostname.toLowerCase();
    if (host === "v.douyin.com" || host === "douyin.com" || host === "www.douyin.com") return false;
    return Date.now() - startedAt > 5000;
  } catch {
    return false;
  }
}

function getTaskPlatformLabel(task) {
  return task.platformLabel || PLATFORM_LABELS[task.platform] || "支持平台";
}

function isDouyinTask(task) {
  return task && (task.platform === "douyin" || detectPlatformFromUrl(task.url) === "douyin");
}

function getDouyinWindowModeLabel(useIncognito = state.options.douyinUseIncognito) {
  return useIncognito ? "无痕" : "普通";
}

function getTaskUseIncognito(task, options = state.options) {
  return isDouyinTask(task) && Boolean(options && options.douyinUseIncognito);
}

function getTaskDelayMs(task) {
  if (task.platform === "douyin") return Math.max(state.options.delayMs || 0, DOUYIN_COOLDOWN_MS);
  return state.options.delayMs;
}

function getPostLoadWaitMs(task) {
  return task.platform === "douyin" ? DOUYIN_POST_LOAD_WAIT_MS : 1200;
}

function getPostPrepareWaitMs(task, prepareResult) {
  if (task.platform !== "douyin") return 800;
  if (prepareResult && prepareResult.pageType === "video" && !prepareResult.videoReady) return DOUYIN_FALLBACK_RENDER_WAIT_MS;
  return DOUYIN_POST_PREPARE_WAIT_MS;
}

async function throttleCapture() {
  const now = Date.now();
  const waitMs = Math.max(0, nextCaptureAt - now);
  if (waitMs > 0) await sleep(waitMs);
  nextCaptureAt = Date.now() + 650;
  return waitMs;
}

function captureTabSerial(tabId, useIncognito = false) {
  const queuedAt = Date.now();
  const job = captureChain.then(async () => {
    const lockStartedAt = Date.now();
    const perf = { waitCaptureLockMs: lockStartedAt - queuedAt };
    if (state.stopped) throw new Error("任务已停止");
    const throttleStartedAt = Date.now();
    perf.throttleMs = await throttleCapture();
    perf.throttleTotalMs = Date.now() - throttleStartedAt;
    if (state.stopped) throw new Error("任务已停止");
    const windowId = await ensureCaptureWindow(useIncognito);
    const activateStartedAt = Date.now();
    await activateTabForCapture(tabId, windowId);
    perf.activateMs = Date.now() - activateStartedAt;
    if (state.stopped) throw new Error("任务已停止");
    const captureStartedAt = Date.now();
    const dataUrl = await captureVisibleTab(windowId);
    perf.captureMs = Date.now() - captureStartedAt;
    perf.captureLockMs = Date.now() - lockStartedAt;
    return { dataUrl, perf };
  });
  captureChain = job.catch(() => {});
  return job;
}

async function activateTabForCapture(tabId, windowId) {
  for (let attempt = 1; attempt <= 3; attempt += 1) {
    await focusCaptureWindow(windowId);
    await chrome.tabs.update(tabId, { active: true });
    await focusCaptureWindow(windowId);
    await ensureViewportCalibrated(tabId, windowId);
    await sleep(650);
    const activeTab = await getActiveTab(windowId);
    if (activeTab && activeTab.id === tabId) return;
    await sleep(250);
  }
  throw new Error("截图前未能激活目标标签页，已停止本次截图以避免错页保存");
}

async function focusCaptureWindow(windowId = captureWindowId) {
  if (!windowId) throw new Error("专用截图窗口不存在");
  const window = await chrome.windows.get(windowId);
  if (window.state === "minimized") {
    await chrome.windows.update(windowId, { state: "normal" });
    await sleep(300);
  }
  await chrome.windows.update(windowId, { focused: true });
  await sleep(300);
}

async function ensureViewportCalibrated(tabId, windowId) {
  const captureSize = state.options.captureSize || DEFAULT_CAPTURE_SIZE;
  if (captureSize.mode === "current") return;
  const key = getCaptureSizeKey(captureSize);
  if (calibratedCaptureSizeKey === key) return;
  await resizeWindowForViewport(tabId, windowId);
  calibratedCaptureSizeKey = key;
}

function getCaptureSizeKey(captureSize) {
  return `${captureSize.mode}:${captureSize.width}x${captureSize.height}`;
}

async function resizeWindowForViewport(tabId, windowId) {
  const captureSize = state.options.captureSize || DEFAULT_CAPTURE_SIZE;
  if (captureSize.mode === "current") return;
  for (let attempt = 0; attempt < 4; attempt += 1) {
    const viewport = await getViewportSize(tabId);
    if (!viewport.width || !viewport.height) return;
    const widthDelta = captureSize.width - viewport.width;
    const heightDelta = captureSize.height - viewport.height;
    if (Math.abs(widthDelta) <= 2 && Math.abs(heightDelta) <= 2) {
      log(`截图视口：${viewport.width}×${viewport.height}（${captureSize.label}）`);
      return;
    }
    const window = await chrome.windows.get(windowId);
    const currentWidth = window.width || captureSize.width;
    const currentHeight = window.height || captureSize.height;
    await chrome.windows.update(windowId, {
      state: "normal",
      width: Math.max(CUSTOM_CAPTURE_SIZE_LIMITS.minWidth, currentWidth + widthDelta),
      height: Math.max(CUSTOM_CAPTURE_SIZE_LIMITS.minHeight, currentHeight + heightDelta),
    });
    await sleep(250);
  }
  const viewport = await getViewportSize(tabId);
  if (viewport.width && viewport.height) log(`截图视口：${viewport.width}×${viewport.height}（目标 ${captureSize.width}×${captureSize.height}）`, "warning");
}

async function getViewportSize(tabId) {
  const [{ result } = {}] = await chrome.scripting.executeScript({
    target: { tabId },
    func: () => ({ width: window.innerWidth, height: window.innerHeight }),
  });
  return result || { width: 0, height: 0 };
}

async function getActiveTab(windowId) {
  const tabs = await chrome.tabs.query({ windowId, active: true });
  return tabs[0] || null;
}

function captureVisibleTab(windowId) {
  return new Promise((resolve, reject) => {
    chrome.tabs.captureVisibleTab(windowId, { format: "png" }, (dataUrl) => {
      if (chrome.runtime.lastError) {
        reject(new Error(describeCaptureError(chrome.runtime.lastError.message)));
        return;
      }
      resolve(dataUrl);
    });
  });
}

function describeCaptureError(message) {
  const text = message || "截图失败";
  if (/view is invisible/i.test(text)) return `${text}：截图窗口不可见或被系统隐藏`;
  if (/image readback failed/i.test(text)) return `${text}：Chrome 渲染画面读取失败，通常与窗口最小化、遮挡或显卡渲染有关`;
  return text;
}

function downloadScreenshot(dataUrl, fileName) {
  return new Promise((resolve, reject) => {
    chrome.downloads.download({
      url: dataUrl,
      filename: `${sessionDownloadDir}/${fileName}`,
      saveAs: false,
      conflictAction: "uniquify",
    }, (downloadId) => {
      if (chrome.runtime.lastError) {
        reject(new Error(chrome.runtime.lastError.message));
        return;
      }
      if (!downloadId) {
        reject(new Error("下载未启动"));
        return;
      }
      resolve(downloadId);
    });
  });
}

async function finalizeRun() {
  if (state.status === "idle") return;
  if (state.stopped) {
    markStoppedTasks();
    state.runningCount = 0;
    log("任务已停止", "warning");
    await closeCaptureWindow();
    state.status = "stopped";
    return;
  }
  state.status = "finalizing";
  markUnfinishedTasksFailed();
  log(`全部完成：成功 ${state.success}，失败 ${state.failed}`, state.failed ? "warning" : "success");
  logPerfSummary();
  if (state.options.autoGeneratePpt) {
    const screenshotCount = getSuccessfulCachedTaskCount();
    log(`自动 PPT 已开启：可用成功截图 ${screenshotCount} 张，模式 ${getAutoPptModeLabel(state.options.autoPptMode)}`, screenshotCount ? "success" : "warning");
  }
  if (state.failed > 0) {
    try {
      await downloadFailureReport();
      log("已导出失败清单 CSV", "warning");
    } catch (error) {
      log(`失败清单导出失败：${error.message}`, "failed");
    }
  }
  if (state.options.includeScreenshotWorkbook && state.sourceRows.length) {
    try {
      await downloadScreenshotWorkbook();
      const screenshotCount = getSuccessfulCachedTaskCount();
      log(`已导出带截图 Excel：${screenshotCount} 张截图`, "success");
    } catch (error) {
      log(`带截图 Excel 导出失败：${error.message}`, "failed");
    }
  }
  if (state.options.enableSupplementRepairZip && state.supplementRepairSource) {
    try {
      await downloadSupplementRepairZip();
    } catch (error) {
      log(`修复版 ZIP 导出失败：${error.message}`, "failed");
    }
  }
  await closeCaptureWindow();
  state.status = "done";
  if (state.options.autoGeneratePpt) await saveAutoPptSessionFromState();
  if (state.options.autoGeneratePpt && !state.autoPptGenerated) {
    await openAutoPptGenerator();
  }
}

async function openAutoPptGenerator() {
  if (state.autoPptLauncherOpened) return;
  state.autoPptLauncherOpened = true;
  const screenshotCount = getSuccessfulCachedTaskCount();
  if (!screenshotCount) {
    log("自动 PPT 未启动：本次没有可用于生成 PPT 的成功截图", "warning");
    return;
  }
  try {
    await chrome.tabs.create({ url: chrome.runtime.getURL("auto-ppt.html"), active: false });
    log("已打开内部自动 PPT 生成页，生成完成后会自动关闭", "success");
  } catch (error) {
    log(`自动 PPT 生成页打开失败：${error.message}；请打开插件弹窗触发生成`, "failed");
  }
}

async function closeCaptureWindow() {
  const windowId = captureWindowId;
  captureWindowId = null;
  captureWindowPromise = null;
  captureWindowUseIncognito = false;
  calibratedCaptureSizeKey = null;
  if (!windowId) return;
  try {
    await chrome.windows.remove(windowId);
  } catch {}
}

function markStoppedTasks() {
  state.tasks.forEach((task) => {
    if (task.status === "PENDING" || task.status === "RUNNING") {
      task.status = "STOPPED";
      task.error = "任务已停止";
    }
  });
}

function markUnfinishedTasksFailed() {
  const unfinishedTasks = state.tasks.filter((task) => task.status === "PENDING" || task.status === "RUNNING");
  if (!unfinishedTasks.length) return;
  unfinishedTasks.forEach((task) => {
    task.status = "FAILED";
    task.error = "任务未执行完成，worker 可能异常退出";
  });
  state.failed += unfinishedTasks.length;
  state.runningCount = 0;
  log(`发现 ${unfinishedTasks.length} 条未完成任务，已标记为失败`, "failed");
}

function normalizeOptions(options, tasks = []) {
  const hasDouyinTask = tasks.some((task) => task.platform === "douyin" || detectPlatformFromUrl(task.url) === "douyin");
  const concurrency = Math.min(8, Math.max(1, Number.parseInt(options.concurrency, 10) || 2));
  const douyinWindowMode = hasDouyinTask ? normalizeDouyinWindowMode(options.douyinWindowMode) : "regular";
  return {
    concurrency,
    douyinConcurrency: 1,
    delayMs: Math.max(500, Number(options.delayMs) || 800),
    waitMs: hasDouyinTask ? Math.max(DOUYIN_NAVIGATION_TIMEOUT_MS, Number(options.waitMs) || 12000) : Math.max(3000, Number(options.waitMs) || 12000),
    douyinConservativeMode: hasDouyinTask,
    douyinBatchSize: hasDouyinTask ? DOUYIN_BATCH_SIZE : 0,
    douyinWindowMode,
    douyinUseIncognito: hasDouyinTask && douyinWindowMode === "incognito",
    douyinProxyRotation: normalizeDouyinProxyRotationOptions(options, hasDouyinTask),
    includeScreenshotWorkbook: Boolean(options.includeScreenshotWorkbook),
    autoGeneratePpt: options.autoGeneratePpt !== false,
    autoPptMode: normalizeAutoPptMode(options.autoPptMode),
    autoPptTitle: String(options.autoPptTitle || ""),
    autoPptTemplateId: String(options.autoPptTemplateId || ""),
    enableSupplementRepairZip: Boolean(options.enableSupplementRepairZip),
    captureSize: normalizeCaptureSize(options),
  };
}

function resolveSupplementRepairSource(options, uploadId) {
  if (!options || !options.enableSupplementRepairZip) return null;
  const entry = pendingSupplementUploads.get(uploadId);
  if (!entry || !entry.ready) throw new Error("精准补充原图未上传完成，请重新选择截图文件夹");
  pendingSupplementUploads.delete(uploadId);
  return entry;
}

function normalizeAutoPptMode(value) {
  return value === "link-screenshot" || value === "release-info-screenshot" || value === "dawanqu" ? value : "clippings";
}

function normalizeDouyinWindowMode(value) {
  return value === "incognito" ? "incognito" : "regular";
}

function normalizeDouyinProxyRotationOptions(options, hasDouyinTask) {
  const raw = options && typeof options.douyinProxyRotation === "object" ? options.douyinProxyRotation : {};
  const nodeNames = normalizeProxyNodeNames(raw.nodeNames || raw.nodeNamesText || options.douyinProxyNodeNames || "");
  return {
    enabled: hasDouyinTask && Boolean(raw.enabled || options.douyinProxyRotationEnabled),
    controllerUrl: normalizeClashControllerUrl(raw.controllerUrl || options.douyinProxyControllerUrl || CLASH_DEFAULT_CONTROLLER_URL),
    groupName: String(raw.groupName || options.douyinProxyGroupName || CLASH_DEFAULT_GROUP_NAME).trim() || CLASH_DEFAULT_GROUP_NAME,
    secret: String(raw.secret || options.douyinProxySecret || "").trim(),
    nodeNames,
    rotation: hasDouyinTask ? DOUYIN_PROXY_ROTATION_INTERVAL : 0,
    settleMs: clampInteger(raw.settleMs || options.douyinProxySettleMs, CLASH_DEFAULT_SETTLE_MS, 0, 30000),
  };
}

function normalizeClashControllerUrl(value) {
  const text = String(value || CLASH_DEFAULT_CONTROLLER_URL).trim() || CLASH_DEFAULT_CONTROLLER_URL;
  const withProtocol = /^https?:\/\//i.test(text) ? text : `http://${text}`;
  return withProtocol.replace(/\/+$/, "");
}

function normalizeCaptureSize(options) {
  const mode = options.captureSizeMode || "current";
  if (mode === "custom") {
    return {
      mode,
      width: clampInteger(options.captureWidth, DEFAULT_CAPTURE_SIZE.width, CUSTOM_CAPTURE_SIZE_LIMITS.minWidth, CUSTOM_CAPTURE_SIZE_LIMITS.maxWidth),
      height: clampInteger(options.captureHeight, DEFAULT_CAPTURE_SIZE.height, CUSTOM_CAPTURE_SIZE_LIMITS.minHeight, CUSTOM_CAPTURE_SIZE_LIMITS.maxHeight),
      label: "自定义",
    };
  }
  return CAPTURE_SIZE_PRESETS[mode] || DEFAULT_CAPTURE_SIZE;
}

function clampInteger(value, fallback, min, max) {
  const number = Number.parseInt(value, 10);
  const normalized = Number.isFinite(number) ? number : fallback;
  return Math.min(max, Math.max(min, normalized));
}

function getPublicState() {
  const stoppedCount = state.tasks.filter((task) => task.status === "STOPPED").length;
  return {
    status: state.status,
    runId: state.runId,
    sourceFileName: state.sourceFileName || "",
    tasks: state.tasks.map((task) => ({
      id: task.id,
      listIndex: task.listIndex,
      rowNumber: task.rowNumber,
      fileName: task.fileName,
      url: task.url,
      status: task.status,
      error: task.error || "",
      screenshotCacheKey: task.screenshotCacheKey || "",
    })),
    options: getPublicOptions(state.options),
    success: state.success,
    failed: state.failed,
    stopped: stoppedCount,
    runningCount: state.runningCount,
    autoPptGenerated: Boolean(state.autoPptGenerated),
    autoPptInProgress: Boolean(state.autoPptInProgress),
    autoPptFailed: Boolean(state.autoPptFailed),
    autoPptError: state.autoPptError || "",
    logs: state.logs.slice(-100),
  };
}

function getSuccessScreenshots() {
  return { ok: false, error: "成功截图已改为 IndexedDB 缓存，请使用 GET_SUCCESS_SCREENSHOT_RECORDS 获取轻量记录" };
}

async function getSuccessScreenshotRecords() {
  const session = await getAutoPptSession();
  if (session && Array.isArray(session.screenshots) && session.screenshots.length) {
    return {
      ok: true,
      runId: session.runId || state.runId,
      sourceName: session.sourceName || state.sourceFileName || "本次截图",
      screenshots: session.screenshots,
    };
  }
  return {
    ok: true,
    runId: state.runId,
    sourceName: state.sourceFileName || "本次截图",
    screenshots: buildSuccessScreenshotRecords(),
  };
}

function buildSuccessScreenshotRecords() {
  return state.tasks
    .filter((task) => task.status === "SUCCESS" && task.screenshotCacheKey)
    .map((task) => ({
      id: task.id,
      cacheKey: task.screenshotCacheKey,
      fileName: task.fileName || "截图.png",
      task: buildScreenshotTaskMeta(task),
    }));
}

function getSuccessfulCachedTaskCount() {
  return state.tasks.filter((task) => task.status === "SUCCESS" && task.screenshotCacheKey).length;
}

function buildScreenshotTaskMeta(task) {
  return {
    id: task.id,
    listIndex: task.listIndex,
    rowNumber: task.rowNumber,
    sequence: task.sequence,
    nickname: task.nickname,
    url: task.url,
    platform: task.platform,
    platformLabel: task.platformLabel,
    releaseInfo: task.releaseInfo,
    fileName: task.fileName,
  };
}

async function claimAutoPptGeneration() {
  const session = await getAutoPptSession();
  const options = session && session.options ? session.options : state.options;
  const status = session ? "done" : state.status;
  const generated = session ? Boolean(session.autoPptGenerated) : state.autoPptGenerated;
  const inProgress = Boolean(state.autoPptInProgress) || Boolean(session && session.autoPptInProgress);
  const failed = session ? Boolean(session.autoPptFailed) : state.autoPptFailed;
  const error = session ? session.autoPptError : state.autoPptError;
  const screenshotCount = session && Array.isArray(session.screenshots) ? session.screenshots.length : getSuccessfulCachedTaskCount();
  if (!options.autoGeneratePpt) return { ok: false, error: "本次任务未开启自动 PPT" };
  if (status !== "done") return { ok: false, error: "任务尚未完成，暂不能生成自动 PPT" };
  if (generated) return { ok: false, error: "自动 PPT 已生成" };
  if (inProgress) return { ok: false, error: "自动 PPT 正在生成中" };
  if (failed) return { ok: false, error: error || "自动 PPT 上次生成失败，请手动生成或重新运行" };
  if (!screenshotCount) return { ok: false, error: "本次没有可用于生成 PPT 的成功截图" };
  state.autoPptInProgress = true;
  state.autoPptFailed = false;
  state.autoPptError = "";
  await updateAutoPptSession({ autoPptInProgress: true, autoPptFailed: false, autoPptError: "" });
  log(`开始自动生成 PPT：${getAutoPptModeLabel(options.autoPptMode)}，${screenshotCount} 张截图`);
  return { ok: true, state: session ? buildPublicStateFromSession({ ...session, autoPptInProgress: true, autoPptFailed: false, autoPptError: "" }) : getPublicState() };
}

async function markAutoPptGenerated(result = null) {
  state.autoPptGenerated = true;
  state.autoPptInProgress = false;
  state.autoPptFailed = false;
  state.autoPptError = "";
  await updateAutoPptSession({ autoPptGenerated: true, autoPptInProgress: false, autoPptFailed: false, autoPptError: "", result });
  await clearAutoPptSession();
  if (result && result.fileName) {
    log(`自动 PPT 已触发下载：${result.fileName}`, "success");
  }
  return { ok: true, state: getPublicState() };
}

async function markAutoPptFailed(error) {
  state.autoPptInProgress = false;
  state.autoPptFailed = true;
  state.autoPptError = error || "未知错误";
  const session = await updateAutoPptSession({ autoPptInProgress: false, autoPptFailed: true, autoPptError: error || "未知错误" });
  log(`自动 PPT 生成失败：${error || "未知错误"}`, "failed");
  return { ok: true, state: session && state.status === "idle" ? buildPublicStateFromSession(session) : getPublicState() };
}

function getAutoPptModeLabel(value) {
  if (value === "link-screenshot") return "链接截图单图单页";
  if (value === "release-info-screenshot") return "发布信息截图单图单页";
  if (value === "dawanqu") return "大湾区崭新模版";
  return "发布剪报多图铺页";
}

async function saveAutoPptSessionFromState() {
  const session = {
    runId: state.runId,
    sourceName: state.sourceFileName || "本次截图",
    sourceFileName: state.sourceFileName || "",
    options: {
      autoGeneratePpt: Boolean(state.options.autoGeneratePpt),
      autoPptMode: state.options.autoPptMode || "clippings",
      autoPptTitle: state.options.autoPptTitle || "",
      autoPptTemplateId: state.options.autoPptTemplateId || "",
    },
    screenshots: buildSuccessScreenshotRecords(),
    autoPptGenerated: Boolean(state.autoPptGenerated),
    autoPptInProgress: Boolean(state.autoPptInProgress),
    autoPptFailed: Boolean(state.autoPptFailed),
    autoPptError: state.autoPptError || "",
    createdAt: Date.now(),
  };
  await writeStorageValue(AUTO_PPT_SESSION_KEY, session);
  return session;
}

async function getAutoPptSession() {
  const session = await readStorageValue(AUTO_PPT_SESSION_KEY);
  if (!session || typeof session !== "object") return null;
  if (Date.now() - Number(session.createdAt || 0) > AUTO_PPT_SESSION_MAX_AGE_MS) {
    await clearAutoPptSession();
    return null;
  }
  if (!Array.isArray(session.screenshots) || !session.screenshots.length) return null;
  return session;
}

async function updateAutoPptSession(patch) {
  const session = await getAutoPptSession();
  if (!session) return null;
  const nextSession = { ...session, ...patch };
  await writeStorageValue(AUTO_PPT_SESSION_KEY, nextSession);
  return nextSession;
}

function buildPublicStateFromSession(session) {
  return {
    status: "done",
    runId: session.runId || "",
    sourceFileName: session.sourceFileName || session.sourceName || "",
    tasks: (session.screenshots || []).map((item, index) => ({
      id: item.id || item.cacheKey || `${index}`,
      listIndex: item.task && Number.isFinite(Number(item.task.listIndex)) ? Number(item.task.listIndex) : index,
      rowNumber: item.task ? item.task.rowNumber : "",
      fileName: item.fileName || "截图.png",
      url: item.task ? item.task.url : "",
      status: "SUCCESS",
      error: "",
      screenshotCacheKey: item.cacheKey || "",
    })),
    options: session.options || {},
    success: (session.screenshots || []).length,
    failed: 0,
    stopped: 0,
    runningCount: 0,
    autoPptGenerated: Boolean(session.autoPptGenerated),
    autoPptInProgress: Boolean(session.autoPptInProgress),
    autoPptFailed: Boolean(session.autoPptFailed),
    autoPptError: session.autoPptError || "",
    logs: state.logs.slice(-100),
  };
}

function readStorageValue(key) {
  return new Promise((resolve, reject) => {
    chrome.storage.local.get(key, (result) => {
      if (chrome.runtime.lastError) reject(new Error(chrome.runtime.lastError.message));
      else resolve(result ? result[key] : undefined);
    });
  });
}

function writeStorageValue(key, value) {
  return new Promise((resolve, reject) => {
    chrome.storage.local.set({ [key]: value }, () => {
      if (chrome.runtime.lastError) reject(new Error(chrome.runtime.lastError.message));
      else resolve();
    });
  });
}

function clearAutoPptSession() {
  return new Promise((resolve, reject) => {
    chrome.storage.local.remove(AUTO_PPT_SESSION_KEY, () => {
      if (chrome.runtime.lastError) reject(new Error(chrome.runtime.lastError.message));
      else resolve();
    });
  });
}

function getPublicOptions(options) {
  const publicOptions = { ...options };
  if (options && options.douyinProxyRotation) {
    publicOptions.douyinProxyRotation = { ...options.douyinProxyRotation, secret: "" };
  }
  return publicOptions;
}

function log(message, level = "") {
  const time = new Date().toLocaleTimeString("zh-CN", { hour12: false });
  const entry = { message: `${time} ${message}`, level };
  state.logs.push(entry);
  if (state.logs.length > 200) state.logs = state.logs.slice(-200);
  const consoleMessage = `[截图助手]${level ? `[${level}]` : ""} ${entry.message}`;
  if (level === "failed") console.error(consoleMessage);
  else if (level === "warning") console.warn(consoleMessage);
  else console.log(consoleMessage);
}

function logTaskPerf(task, level = "") {
  const perf = task.perf;
  if (!perf || !Number.isFinite(perf.totalMs)) return;
  const pageMs = sumPerf(perf, ["loadMs", "postLoadWaitMs", "prepareMs", "postPrepareWaitMs"]);
  log(`[耗时] ${task.fileName} total=${formatMs(perf.totalMs)} page=${formatMs(pageMs)} load=${formatMs(perf.loadMs)} wait1=${formatMs(perf.postLoadWaitMs)} prepare=${formatMs(perf.prepareMs)} wait2=${formatMs(perf.postPrepareWaitMs)} waitLock=${formatMs(perf.waitCaptureLockMs)} lock=${formatMs(perf.captureLockMs)} throttle=${formatMs(perf.throttleMs)} activate=${formatMs(perf.activateMs)} capture=${formatMs(perf.captureMs)} download=${formatMs(perf.downloadMs)}`, level);
}

function logPerfSummary() {
  const successfulSamples = state.tasks.filter((task) => task.status === "SUCCESS" && task.perf && Number.isFinite(task.perf.totalMs)).map((task) => task.perf);
  const samples = successfulSamples.length ? successfulSamples : state.tasks.filter((task) => task.perf && Number.isFinite(task.perf.totalMs)).map((task) => task.perf);
  if (!samples.length) return;
  const avgTotal = averagePerf(samples, (perf) => perf.totalMs);
  const avgPage = averagePerf(samples, (perf) => sumPerf(perf, ["loadMs", "postLoadWaitMs", "prepareMs", "postPrepareWaitMs"]));
  const avgWaitLock = averagePerf(samples, (perf) => perf.waitCaptureLockMs);
  const avgLock = averagePerf(samples, (perf) => perf.captureLockMs);
  const avgActivate = averagePerf(samples, (perf) => perf.activateMs);
  const avgCapture = averagePerf(samples, (perf) => perf.captureMs);
  const avgDownload = averagePerf(samples, (perf) => perf.downloadMs);
  log(`[耗时汇总] samples=${samples.length} avgTotal=${formatMs(avgTotal)} avgPage=${formatMs(avgPage)} avgWaitLock=${formatMs(avgWaitLock)} avgLock=${formatMs(avgLock)} avgActivate=${formatMs(avgActivate)} avgCapture=${formatMs(avgCapture)} avgDownload=${formatMs(avgDownload)}`, successfulSamples.length ? "success" : "warning");
}

function sumPerf(perf, keys) {
  return keys.reduce((total, key) => total + (Number.isFinite(perf[key]) ? perf[key] : 0), 0);
}

function averagePerf(samples, readValue) {
  const values = samples.map(readValue).filter((value) => Number.isFinite(value));
  if (!values.length) return 0;
  return values.reduce((total, value) => total + value, 0) / values.length;
}

function formatMs(value) {
  if (!Number.isFinite(value)) return "-";
  return `${Math.round(value)}ms`;
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function downloadFailureReport() {
  const failedTasks = state.tasks.filter((task) => task.status === "FAILED");
  const rows = [
    ["序号", "昵称", "链接", "文件名", "错误"],
    ...failedTasks.map((task) => [task.sequence || "", task.nickname || "", task.url || "", task.fileName || "", task.error || ""]),
  ];
  const csv = `\ufeff${rows.map((row) => row.map(csvEscape).join(",")).join("\n")}`;
  const dataUrl = `data:text/csv;charset=utf-8,${encodeURIComponent(csv)}`;
  const timestamp = new Date().toISOString().replace(/[:.]/g, "-").slice(0, 19);
  return new Promise((resolve, reject) => {
    chrome.downloads.download({
      url: dataUrl,
      filename: `${sessionDownloadDir}/失败清单_${timestamp}.csv`,
      saveAs: false,
      conflictAction: "uniquify",
    }, (downloadId) => {
      if (chrome.runtime.lastError) {
        reject(new Error(chrome.runtime.lastError.message));
        return;
      }
      resolve(downloadId);
    });
  });
}

async function downloadSupplementRepairZip() {
  const successfulTasks = await getSuccessfulTasksWithScreenshotBytes();
  if (!successfulTasks.length) throw new Error("没有可写入修复版 ZIP 的成功补拍截图");
  const result = buildSupplementRepairZip(state.supplementRepairSource, successfulTasks);
  const fileName = `${sessionDownloadDir}/${buildSupplementRepairZipFileName(result.sourceName)}`;
  await queueBinaryDownload(fileName, result.bytes, "application/zip", "修复版 ZIP", "正在接收修复版 ZIP");
  log(`已导出修复版 ZIP：原图 ${result.originalCount} 张，补拍 ${result.replacedCount} 张，最终 ${result.finalCount} 张`, "success");
}

function buildSupplementRepairZip(source, successfulTasks) {
  const files = new Map();
  const replacedSequenceKeys = new Set(successfulTasks.map((task) => deriveSequenceKey(task.fileName)).filter(Boolean));
  (source.files || []).forEach((file) => {
    if (file.sequenceKey && replacedSequenceKeys.has(file.sequenceKey)) return;
    files.set(normalizeZipFileName(file.name), { name: normalizeZipFileName(file.name), data: file.data });
  });
  successfulTasks.forEach((task) => {
    const name = sanitizeZipFileName(task.fileName || "补拍截图.png");
    files.set(normalizeZipFileName(name), { name, data: task.screenshotBytes });
  });
  return {
    sourceName: source.sourceName || "截图文件夹",
    originalCount: (source.files || []).length,
    replacedCount: successfulTasks.length,
    finalCount: files.size,
    bytes: createZip(Array.from(files.values())),
  };
}

function buildSupplementRepairZipFileName(sourceName) {
  const safeName = String(sourceName || "截图文件夹").replace(/\.[^.]+$/, "").replace(/[\\/:*?"<>|\r\n\t]+/g, "").trim() || "截图文件夹";
  const timestamp = new Date().toISOString().replace(/[:.]/g, "-").slice(0, 19);
  return `${safeName}_修复版_${timestamp}.zip`;
}

function queueBinaryDownload(fileName, bytes, mimeType, logLabel, statusLabel) {
  const id = `${Date.now()}-${Math.random().toString(36).slice(2)}`;
  pendingWorkbookExports.set(id, { fileName, bytes, offset: 0, mimeType, logLabel, statusLabel });
  return chrome.tabs.create({ url: chrome.runtime.getURL(`download-workbook.html?id=${encodeURIComponent(id)}`), active: false });
}

function csvEscape(value) {
  const text = String(value == null ? "" : value);
  return `"${text.replace(/"/g, '""')}"`;
}

async function downloadCorrectedWorkbook(message) {
  const rows = Array.isArray(message.rows) ? message.rows : [];
  if (!rows.length) throw new Error("没有可导出的纠错数据");
  const workbook = buildCorrectedWorkbook(rows, message.rowStyles || [], message.cellStyles || [], message.exportMode);
  if (workbook.length > MAX_WORKBOOK_BYTES) throw new Error(`纠错 Excel 已超过 ${formatBytes(MAX_WORKBOOK_BYTES)}，请减少数据量后重试`);
  const fileName = buildCorrectedWorkbookFileName(message.sourceFileName, message.exportMode);
  const label = message.exportMode === "fix" ? "修正 Excel" : "纠错 Excel";
  await queueBinaryDownload(fileName, workbook, "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet", label, `正在接收${label}`);
  return { ok: true };
}

function buildCorrectedWorkbookFileName(sourceFileName, exportMode = "correction") {
  const name = String(sourceFileName || "Excel").replace(/\.[^.]+$/, "").replace(/[\\/:*?"<>|\r\n\t]+/g, "").trim() || "Excel";
  return `${name}_${exportMode === "fix" ? "修正结果" : "纠错结果"}.xlsx`;
}

function buildCorrectedWorkbook(rows, rowStyles = [], cellStyles = [], exportMode = "correction") {
  const safeRows = cloneRows(rows);
  const rowCount = Math.max(safeRows.length, 1);
  const columnCount = Math.max(1, ...safeRows.map((row) => row.length));
  const files = buildXlsxFiles(safeRows, [], rowCount, columnCount, columnCount, 0, {
    sheetName: exportMode === "fix" ? "修正结果" : "纠错结果",
    rowStyles,
    cellStyles,
  });
  return createZip(files);
}

async function downloadScreenshotWorkbook() {
  const successfulTasks = await getSuccessfulTasksWithScreenshotBytes();
  if (!successfulTasks.length) throw new Error("没有可写入 Excel 的成功截图");
  if (successfulTasks.length > MAX_WORKBOOK_IMAGES) throw new Error(`带截图 Excel 最多支持 ${MAX_WORKBOOK_IMAGES} 张截图，请减少处理条数后重试`);
  const workbook = buildScreenshotWorkbook(state.sourceRows, successfulTasks, state.sourceHeaderRowIndex);
  if (workbook.length > MAX_WORKBOOK_BYTES) throw new Error(`带截图 Excel 已超过 ${formatBytes(MAX_WORKBOOK_BYTES)}，请减少处理条数或截图尺寸后重试`);
  const fileName = `${sessionDownloadDir}/${buildWorkbookFileName(state.sourceFileName)}`;
  await queueBinaryDownload(fileName, workbook, "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet", "带截图 Excel", "正在接收带截图 Excel");
}

async function getSuccessfulTasksWithScreenshotBytes() {
  const tasks = state.tasks.filter((task) => task.status === "SUCCESS" && task.screenshotCacheKey);
  const result = [];
  for (const task of tasks) {
    const record = await ScreenshotCache.getScreenshot(task.screenshotCacheKey);
    if (!record || !record.blob) continue;
    result.push({ ...task, screenshotBytes: await ScreenshotCache.blobToBytes(record.blob) });
  }
  return result;
}

function bytesToBase64(bytes) {
  let binary = "";
  const chunkSize = 0x8000;
  for (let offset = 0; offset < bytes.length; offset += chunkSize) {
    const chunk = bytes.subarray(offset, offset + chunkSize);
    binary += String.fromCharCode(...chunk);
  }
  return btoa(binary);
}

function base64ToBytes(base64) {
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i += 1) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

function buildWorkbookFileName(sourceFileName) {
  const name = String(sourceFileName || "截图结果").replace(/\.[^.]+$/, "").replace(/[\\/:*?"<>|\r\n\t]+/g, "").trim() || "截图结果";
  return `${name}_带截图.xlsx`;
}

function buildSessionDownloadDir(sourceFileName) {
  const timestamp = formatLocalTimestamp(new Date());
  const baseName = String(sourceFileName || "").replace(/\.[^.]+$/, "").replace(/[\\/:*?"<>|\r\n\t]+/g, "").trim();
  const suffix = baseName ? `_${baseName}` : "";
  return `${DOWNLOAD_DIR_BASE}/${timestamp}${suffix}_截图`;
}

function buildRunId() {
  return `${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

function formatLocalTimestamp(date) {
  const pad = (n) => String(n).padStart(2, "0");
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}_${pad(date.getHours())}-${pad(date.getMinutes())}-${pad(date.getSeconds())}`;
}

function sanitizeZipFileName(name) {
  const fileName = String(name || "截图.png").replace(/\\/g, "/").split("/").pop() || "截图.png";
  return fileName.replace(/[\\/:*?"<>|\r\n\t]+/g, "").trim() || "截图.png";
}

function normalizeZipFileName(name) {
  return sanitizeZipFileName(name).toLowerCase();
}

function deriveSequenceKey(name) {
  const match = /^(\d+(?:-\d+)?)(?=_|\.|$)/.exec(sanitizeZipFileName(name));
  return match ? match[1] : "";
}

function formatBytes(bytes) {
  return `${Math.round(bytes / 1024 / 1024)} MB`;
}

function downloadBlobUrl(url, fileName) {
  return new Promise((resolve, reject) => {
    chrome.downloads.download({
      url,
      filename: fileName,
      saveAs: false,
      conflictAction: "uniquify",
    }, (downloadId) => {
      if (chrome.runtime.lastError) {
        reject(new Error(chrome.runtime.lastError.message));
        return;
      }
      if (!downloadId) {
        reject(new Error("下载未启动"));
        return;
      }
      resolve(downloadId);
    });
  });
}

function buildScreenshotWorkbook(sourceRows, tasks, headerRowIndex = 0) {
  const rows = cloneRows(sourceRows);
  const imageSlots = buildImageSlots(tasks);
  const screenshotColumnCount = Math.max(1, ...Array.from(imageSlots.values(), (items) => items.length));
  const baseColumnCount = Math.max(1, ...rows.map((row) => row.length));
  const imageColumnStart = baseColumnCount;
  const safeHeaderRowIndex = clampInteger(headerRowIndex, 0, 0, Math.max(0, rows.length - 1));
  ensureRow(rows, safeHeaderRowIndex);
  for (let index = 0; index < screenshotColumnCount; index += 1) {
    rows[safeHeaderRowIndex][imageColumnStart + index] = index === 0 ? "截图" : `截图${index + 1}`;
  }
  for (const [rowIndex, items] of imageSlots.entries()) {
    ensureRow(rows, rowIndex);
    for (let index = 0; index < items.length; index += 1) {
      rows[rowIndex][imageColumnStart + index] = items[index].fileName || "截图";
    }
  }
  const images = [];
  for (const [rowIndex, items] of imageSlots.entries()) {
    items.forEach((task, slotIndex) => {
      images.push({
        rowIndex,
        columnIndex: imageColumnStart + slotIndex,
        bytes: task.screenshotBytes,
      });
    });
  }
  const rowCount = Math.max(rows.length, ...images.map((image) => image.rowIndex + 1), 1);
  const columnCount = Math.max(baseColumnCount + screenshotColumnCount, 1);
  const files = buildXlsxFiles(rows, images, rowCount, columnCount, imageColumnStart, screenshotColumnCount);
  return createZip(files);
}

function cloneRows(rows) {
  return (Array.isArray(rows) && rows.length ? rows : [[]]).map((row) => Array.isArray(row) ? row.map((value) => value == null ? "" : String(value)) : []);
}

function buildImageSlots(tasks) {
  const slots = new Map();
  tasks.forEach((task) => {
    const rowIndex = Math.max(1, Number(task.rowNumber || 1)) - 1;
    if (!slots.has(rowIndex)) slots.set(rowIndex, []);
    slots.get(rowIndex).push(task);
  });
  return slots;
}

function ensureRow(rows, rowIndex) {
  while (rows.length <= rowIndex) rows.push([]);
}

function buildXlsxFiles(rows, images, rowCount, columnCount, imageColumnStart, screenshotColumnCount, options = {}) {
  const hasStyles = Boolean((options.rowStyles && options.rowStyles.length) || (options.cellStyles && options.cellStyles.length));
  const files = [
    { name: "[Content_Types].xml", data: encodeText(buildContentTypes(images.length, hasStyles)) },
    { name: "_rels/.rels", data: encodeText(buildRootRels()) },
    { name: "xl/workbook.xml", data: encodeText(buildWorkbookXml(options.sheetName || "截图结果")) },
    { name: "xl/_rels/workbook.xml.rels", data: encodeText(buildWorkbookRels(hasStyles)) },
    { name: "xl/worksheets/sheet1.xml", data: encodeText(buildSheetXml(rows, rowCount, columnCount, imageColumnStart, screenshotColumnCount, images.length > 0, options)) },
  ];
  if (hasStyles) files.push({ name: "xl/styles.xml", data: encodeText(buildStylesXml()) });
  if (images.length) {
    files.push({ name: "xl/worksheets/_rels/sheet1.xml.rels", data: encodeText(buildSheetRels()) });
    files.push({ name: "xl/drawings/drawing1.xml", data: encodeText(buildDrawingXml(images)) });
    files.push({ name: "xl/drawings/_rels/drawing1.xml.rels", data: encodeText(buildDrawingRels(images.length)) });
    images.forEach((image, index) => {
      files.push({ name: `xl/media/image${index + 1}.png`, data: image.bytes });
    });
  }
  return files;
}

function buildContentTypes(imageCount, hasStyles = false) {
  const imageOverrides = Array.from({ length: imageCount }, (_, index) => `<Override PartName="/xl/media/image${index + 1}.png" ContentType="image/png"/>`).join("");
  const drawingOverride = imageCount ? '<Override PartName="/xl/drawings/drawing1.xml" ContentType="application/vnd.openxmlformats-officedocument.drawing+xml"/>' : "";
  const stylesOverride = hasStyles ? '<Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/>' : "";
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/><Override PartName="/xl/worksheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>${stylesOverride}${drawingOverride}${imageOverrides}</Types>`;
}

function buildRootRels() {
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/></Relationships>`;
}

function buildWorkbookXml(sheetName = "截图结果") {
  const safeSheetName = String(sheetName || "截图结果").replace(/[\[\]:*?/\\]/g, "").slice(0, 31) || "截图结果";
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets><sheet name="${xmlEscape(safeSheetName)}" sheetId="1" r:id="rId1"/></sheets></workbook>`;
}

function buildWorkbookRels(hasStyles = false) {
  const stylesRel = hasStyles ? '<Relationship Id="rId2" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/>' : "";
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet1.xml"/>${stylesRel}</Relationships>`;
}

function buildSheetXml(rows, rowCount, columnCount, imageColumnStart, screenshotColumnCount, hasDrawing, options = {}) {
  const dimension = `A1:${columnIndexToNameForXlsx(columnCount - 1)}${rowCount}`;
  const columns = buildSheetColumns(columnCount, imageColumnStart, screenshotColumnCount);
  const styleMap = buildCorrectionStyleMap(options.rowStyles || [], options.cellStyles || [], columnCount);
  const sheetRows = [];
  for (let rowIndex = 0; rowIndex < rowCount; rowIndex += 1) {
    const row = rows[rowIndex] || [];
    const height = hasDrawing ? (rowIndex === 0 ? 24 : 180) : 24;
    const cells = [];
    for (let columnIndex = 0; columnIndex < columnCount; columnIndex += 1) {
      const value = row[columnIndex];
      const styleId = styleMap.get(`${rowIndex}:${columnIndex}`) || 0;
      if ((value == null || value === "") && !styleId) continue;
      const cellXml = buildCellXml(columnIndex, rowIndex, value, styleId);
      cells.push(cellXml);
    }
    sheetRows.push(`<row r="${rowIndex + 1}" ht="${height}" customHeight="1">${cells.join("")}</row>`);
  }
  const drawing = hasDrawing ? '<drawing r:id="rId1"/>' : "";
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><dimension ref="${dimension}"/>${columns}<sheetData>${sheetRows.join("")}</sheetData>${drawing}</worksheet>`;
}

function buildCellXml(columnIndex, rowIndex, value, styleId) {
  const cellRef = `${columnIndexToNameForXlsx(columnIndex)}${rowIndex + 1}`;
  const styleAttr = styleId ? ` s="${styleId}"` : "";

  // Check if value is a number
  if (typeof value === 'number' && Number.isFinite(value)) {
    // Numeric cell: <c r="A1"><v>12345</v></c>
    return `<c r="${cellRef}"${styleAttr}><v>${value}</v></c>`;
  }

  // String cell (existing behavior): <c r="A1" t="inlineStr"><is><t>text</t></is></c>
  return `<c r="${cellRef}"${styleAttr} t="inlineStr"><is><t>${xmlEscape(value)}</t></is></c>`;
}

function buildCorrectionStyleMap(rowStyles, cellStyles, columnCount) {
  const styleIds = { red: 1, purple: 2, yellow: 3, blue: 4, orange: 5 };
  const styleMap = new Map();
  rowStyles.forEach((entry) => {
    const rowIndex = Number(entry.rowIndex);
    const styleId = styleIds[entry.style] || 0;
    if (!Number.isInteger(rowIndex) || !styleId) return;
    for (let columnIndex = 0; columnIndex < columnCount; columnIndex += 1) {
      styleMap.set(`${rowIndex}:${columnIndex}`, styleId);
    }
  });
  cellStyles.forEach((entry) => {
    const rowIndex = Number(entry.rowIndex);
    const columnIndex = Number(entry.columnIndex);
    const styleId = styleIds[entry.style] || 0;
    if (!Number.isInteger(rowIndex) || !Number.isInteger(columnIndex) || !styleId) return;
    styleMap.set(`${rowIndex}:${columnIndex}`, styleId);
  });
  return styleMap;
}

function buildStylesXml() {
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><fonts count="1"><font><sz val="11"/><color theme="1"/><name val="Arial"/><family val="2"/></font></fonts><fills count="7"><fill><patternFill patternType="none"/></fill><fill><patternFill patternType="gray125"/></fill><fill><patternFill patternType="solid"><fgColor rgb="FFFFC7CE"/><bgColor indexed="64"/></patternFill></fill><fill><patternFill patternType="solid"><fgColor rgb="FFE4D7FF"/><bgColor indexed="64"/></patternFill></fill><fill><patternFill patternType="solid"><fgColor rgb="FFFFF2CC"/><bgColor indexed="64"/></patternFill></fill><fill><patternFill patternType="solid"><fgColor rgb="FFD9EAF7"/><bgColor indexed="64"/></patternFill></fill><fill><patternFill patternType="solid"><fgColor rgb="FFFFE0B2"/><bgColor indexed="64"/></patternFill></fill></fills><borders count="1"><border><left/><right/><top/><bottom/><diagonal/></border></borders><cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs><cellXfs count="6"><xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"/><xf numFmtId="0" fontId="0" fillId="2" borderId="0" xfId="0" applyFill="1"/><xf numFmtId="0" fontId="0" fillId="3" borderId="0" xfId="0" applyFill="1"/><xf numFmtId="0" fontId="0" fillId="4" borderId="0" xfId="0" applyFill="1"/><xf numFmtId="0" fontId="0" fillId="5" borderId="0" xfId="0" applyFill="1"/><xf numFmtId="0" fontId="0" fillId="6" borderId="0" xfId="0" applyFill="1"/></cellXfs><cellStyles count="1"><cellStyle name="Normal" xfId="0" builtinId="0"/></cellStyles></styleSheet>`;
}

function buildSheetColumns(columnCount, imageColumnStart, screenshotColumnCount) {
  const columns = [];
  if (!screenshotColumnCount) {
    columns.push(`<col min="1" max="${columnCount}" width="18" customWidth="1"/>`);
    return `<cols>${columns.join("")}</cols>`;
  }
  if (imageColumnStart > 0) columns.push(`<col min="1" max="${imageColumnStart}" width="18" customWidth="1"/>`);
  columns.push(`<col min="${imageColumnStart + 1}" max="${imageColumnStart + screenshotColumnCount}" width="36" customWidth="1"/>`);
  if (imageColumnStart + screenshotColumnCount < columnCount) {
    columns.push(`<col min="${imageColumnStart + screenshotColumnCount + 1}" max="${columnCount}" width="18" customWidth="1"/>`);
  }
  return `<cols>${columns.join("")}</cols>`;
}

function buildSheetRels() {
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/drawing" Target="../drawings/drawing1.xml"/></Relationships>`;
}

function buildDrawingXml(images) {
  const anchors = images.map((image, index) => {
    const id = index + 1;
    const row = image.rowIndex;
    const col = image.columnIndex;
    return `<xdr:oneCellAnchor><xdr:from><xdr:col>${col}</xdr:col><xdr:colOff>95250</xdr:colOff><xdr:row>${row}</xdr:row><xdr:rowOff>95250</xdr:rowOff></xdr:from><xdr:ext cx="3048000" cy="1714500"/><xdr:pic><xdr:nvPicPr><xdr:cNvPr id="${id}" name="截图${id}"/><xdr:cNvPicPr><a:picLocks noChangeAspect="1"/></xdr:cNvPicPr></xdr:nvPicPr><xdr:blipFill><a:blip r:embed="rId${id}"/><a:stretch><a:fillRect/></a:stretch></xdr:blipFill><xdr:spPr><a:prstGeom prst="rect"><a:avLst/></a:prstGeom></xdr:spPr></xdr:pic><xdr:clientData/></xdr:oneCellAnchor>`;
  }).join("");
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<xdr:wsDr xmlns:xdr="http://schemas.openxmlformats.org/drawingml/2006/spreadsheetDrawing" xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">${anchors}</xdr:wsDr>`;
}

function buildDrawingRels(imageCount) {
  const rels = Array.from({ length: imageCount }, (_, index) => `<Relationship Id="rId${index + 1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/image" Target="../media/image${index + 1}.png"/>`).join("");
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">${rels}</Relationships>`;
}

function createZip(files) {
  const chunks = [];
  const centralDirectory = [];
  let offset = 0;
  files.forEach((file) => {
    const name = encodeText(file.name);
    const data = file.data instanceof Uint8Array ? file.data : new Uint8Array(file.data || []);
    if (data.length > ZIP32_LIMIT) throw new Error(`Excel 内部文件过大：${file.name}`);
    const crc = crc32(data);
    const local = new Uint8Array(30 + name.length);
    const view = new DataView(local.buffer);
    view.setUint32(0, 0x04034b50, true);
    view.setUint16(4, 20, true);
    view.setUint16(6, 0, true);
    view.setUint16(8, 0, true);
    view.setUint16(10, 0, true);
    view.setUint16(12, 0, true);
    view.setUint32(14, crc, true);
    view.setUint32(18, data.length, true);
    view.setUint32(22, data.length, true);
    view.setUint16(26, name.length, true);
    local.set(name, 30);
    chunks.push(local, data);
    centralDirectory.push({ name, data, crc, offset });
    offset += local.length + data.length;
    if (offset > ZIP32_LIMIT) throw new Error("带截图 Excel 过大，请减少处理条数或截图尺寸后重试");
  });
  const centralStart = offset;
  centralDirectory.forEach((entry) => {
    const central = new Uint8Array(46 + entry.name.length);
    const view = new DataView(central.buffer);
    view.setUint32(0, 0x02014b50, true);
    view.setUint16(4, 20, true);
    view.setUint16(6, 20, true);
    view.setUint16(8, 0, true);
    view.setUint16(10, 0, true);
    view.setUint16(12, 0, true);
    view.setUint16(14, 0, true);
    view.setUint32(16, entry.crc, true);
    view.setUint32(20, entry.data.length, true);
    view.setUint32(24, entry.data.length, true);
    view.setUint16(28, entry.name.length, true);
    view.setUint32(42, entry.offset, true);
    central.set(entry.name, 46);
    chunks.push(central);
    offset += central.length;
  });
  const centralSize = offset - centralStart;
  if (centralSize > ZIP32_LIMIT || centralStart > ZIP32_LIMIT) throw new Error("带截图 Excel 过大，请减少处理条数或截图尺寸后重试");
  const end = new Uint8Array(22);
  const view = new DataView(end.buffer);
  view.setUint32(0, 0x06054b50, true);
  view.setUint16(8, centralDirectory.length, true);
  view.setUint16(10, centralDirectory.length, true);
  view.setUint32(12, centralSize, true);
  view.setUint32(16, centralStart, true);
  chunks.push(end);
  return concatBytes(chunks);
}

function concatBytes(chunks) {
  const size = chunks.reduce((total, chunk) => total + chunk.length, 0);
  const result = new Uint8Array(size);
  let offset = 0;
  chunks.forEach((chunk) => {
    result.set(chunk, offset);
    offset += chunk.length;
  });
  return result;
}

function crc32(bytes) {
  let crc = 0xffffffff;
  for (let i = 0; i < bytes.length; i += 1) {
    crc = (crc >>> 8) ^ CRC_TABLE[(crc ^ bytes[i]) & 0xff];
  }
  return (crc ^ 0xffffffff) >>> 0;
}

const CRC_TABLE = (() => {
  const table = new Uint32Array(256);
  for (let i = 0; i < 256; i += 1) {
    let value = i;
    for (let bit = 0; bit < 8; bit += 1) {
      value = value & 1 ? 0xedb88320 ^ (value >>> 1) : value >>> 1;
    }
    table[i] = value >>> 0;
  }
  return table;
})();

function encodeText(text) {
  return new TextEncoder().encode(String(text));
}

function xmlEscape(value) {
  return String(value == null ? "" : value)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function columnIndexToNameForXlsx(index) {
  let name = "";
  let current = index + 1;
  while (current > 0) {
    const remainder = (current - 1) % 26;
    name = String.fromCharCode(65 + remainder) + name;
    current = Math.floor((current - 1) / 26);
  }
  return name;
}
