const DOWNLOAD_DIR = "视频号截图";
const DEFAULT_CAPTURE_SIZE = { mode: "current", width: 1440, height: 1200, label: "当前默认" };
const CAPTURE_SIZE_PRESETS = {
  current: DEFAULT_CAPTURE_SIZE,
  vertical: { mode: "vertical", width: 720, height: 1280, label: "9:16 竖屏" },
  horizontal: { mode: "horizontal", width: 1280, height: 720, label: "16:9 横屏" },
  square: { mode: "square", width: 1080, height: 1080, label: "1:1 方图" },
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
  options: { concurrency: 2, delayMs: 800, waitMs: 12000, captureSize: DEFAULT_CAPTURE_SIZE, includeScreenshotWorkbook: false },
  sourceRows: [],
  sourceFileName: "",
  cursor: 0,
  success: 0,
  failed: 0,
  runningCount: 0,
  logs: [],
  stopped: false,
  paused: false,
};

let state = structuredClone(DEFAULT_STATE);
let workers = [];
let nextCaptureAt = 0;
let captureChain = Promise.resolve();
let captureWindowId = null;
let captureWindowPromise = null;
let calibratedCaptureSizeKey = null;

let pendingWorkbookExports = new Map();

chrome.runtime.onConnect.addListener((port) => {
  if (port.name !== "workbook-download") return;
  port.onMessage.addListener((message) => handleWorkbookDownloadPortMessage(port, message));
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
    port.postMessage({ type: "START", fileName: entry.fileName, totalSize: entry.bytes.length });
    sendNextWorkbookChunk(port, message.id, entry);
    return;
  }
  if (message.type === "CHUNK_RECEIVED") {
    sendNextWorkbookChunk(port, message.id, entry);
    return;
  }
  if (message.type === "DOWNLOADED") {
    pendingWorkbookExports.delete(message.id);
    log(`带截图 Excel 下载已触发：${entry.fileName}`, "success");
  }
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
  if (message.type === "GET_STATE") return { ok: true, state: getPublicState() };
  if (message.type === "START") return startRun(message.tasks || [], message.options || {}, message.sourceRows || [], message.sourceFileName || "");
  if (message.type === "PAUSE") return pauseRun();
  if (message.type === "RESUME") return resumeRun();
  if (message.type === "STOP") return stopRun();
  return { ok: false, error: "未知操作" };
}

async function startRun(tasks, options, sourceRows = [], sourceFileName = "") {
  if (state.status === "running" || state.status === "paused") return { ok: false, error: "已有任务正在运行" };
  if (!tasks.length) return { ok: false, error: "没有可处理的任务" };
  state = structuredClone(DEFAULT_STATE);
  state.status = "running";
  state.tasks = tasks.map((task, index) => ({ ...task, listIndex: index, status: "PENDING", attempts: 0 }));
  state.options = normalizeOptions(options);
  state.sourceRows = Array.isArray(sourceRows) ? sourceRows : [];
  state.sourceFileName = sourceFileName || "";
  nextCaptureAt = 0;
  captureChain = Promise.resolve();
  captureWindowPromise = null;
  calibratedCaptureSizeKey = null;
  log(`开始处理 ${state.tasks.length} 条任务，并发 ${state.options.concurrency}，截图窗口 ${state.options.captureSize.width}×${state.options.captureSize.height}（${state.options.captureSize.label}）${state.options.includeScreenshotWorkbook ? "，将导出带截图 Excel" : ""}`);
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
    tab = await createWorkerTab();
    while (!state.stopped) {
      await waitWhilePaused();
      const task = nextTask();
      if (!task) break;
      state.runningCount += 1;
      task.status = "RUNNING";
      log(`[${task.listIndex + 1}/${state.tasks.length}] Worker ${workerId} 打开 ${task.fileName}`);
      try {
        await processTask(tab.id, task);
        task.status = "SUCCESS";
        state.success += 1;
        log(`[${task.listIndex + 1}/${state.tasks.length}] SUCCESS ${task.fileName}`, "success");
      } catch (error) {
        const shouldRetry = task.attempts < 2 && !state.stopped;
        if (shouldRetry) {
          task.status = "PENDING";
          log(`[${task.listIndex + 1}/${state.tasks.length}] 重试 ${task.fileName}: ${error.message}`, "warning");
        } else {
          task.status = "FAILED";
          task.error = error.message;
          state.failed += 1;
          log(`[${task.listIndex + 1}/${state.tasks.length}] FAILED ${task.fileName}: ${error.message}`, "failed");
        }
      } finally {
        state.runningCount = Math.max(0, state.runningCount - 1);
      }
      if (state.options.delayMs > 0) await sleep(state.options.delayMs);
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
  task.attempts += 1;
  await chrome.tabs.update(tabId, { url: task.url, active: false });
  await waitForTabComplete(tabId, state.options.waitMs);
  await sleep(1200);
  await prepareTab(tabId);
  await sleep(800);
  const dataUrl = await captureTabSerial(tabId);
  if (!dataUrl || dataUrl.length < 5000) throw new Error("截图数据过小，可能是页面空白、未登录、加载失败或弹窗遮挡");
  if (state.options.includeScreenshotWorkbook) task.screenshotDataUrl = dataUrl;
  await downloadScreenshot(dataUrl, task.fileName);
}

async function createWorkerTab() {
  const windowId = await ensureCaptureWindow();
  return chrome.tabs.create({ windowId, url: "about:blank", active: false });
}

async function ensureCaptureWindow() {
  const captureSize = state.options.captureSize || DEFAULT_CAPTURE_SIZE;
  if (captureWindowId) {
    try {
      await chrome.windows.get(captureWindowId);
      return captureWindowId;
    } catch {
      captureWindowId = null;
      calibratedCaptureSizeKey = null;
    }
  }
  if (!captureWindowPromise) {
    captureWindowPromise = chrome.windows.create({
      url: "about:blank",
      focused: true,
      state: "normal",
      width: captureSize.width,
      height: captureSize.height,
    }).then((window) => {
      captureWindowId = window.id;
      calibratedCaptureSizeKey = null;
      log(`已创建专用截图窗口：${captureSize.width}×${captureSize.height}（${captureSize.label}）`, "success");
      return captureWindowId;
    }).finally(() => {
      captureWindowPromise = null;
    });
  }
  return captureWindowPromise;
}

function nextTask() {
  const task = state.tasks.find((item) => item.status === "PENDING");
  if (!task) return null;
  return task;
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

async function prepareTab(tabId) {
  try {
    await chrome.scripting.executeScript({
      target: { tabId },
      files: ["content.js"],
    });
  } catch {}
  const [{ result } = {}] = await chrome.scripting.executeScript({
    target: { tabId },
    func: () => {
      if (window.shipinhaoPrepareForScreenshot) return window.shipinhaoPrepareForScreenshot();
      return { ok: true, message: "页面准备函数未加载" };
    },
  });
  return result;
}

async function throttleCapture() {
  const now = Date.now();
  const waitMs = Math.max(0, nextCaptureAt - now);
  if (waitMs > 0) await sleep(waitMs);
  nextCaptureAt = Date.now() + 650;
}

function captureTabSerial(tabId) {
  const job = captureChain.then(async () => {
    if (state.stopped) throw new Error("任务已停止");
    await throttleCapture();
    if (state.stopped) throw new Error("任务已停止");
    const windowId = await ensureCaptureWindow();
    await activateTabForCapture(tabId, windowId);
    if (state.stopped) throw new Error("任务已停止");
    return captureVisibleTab(windowId);
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
      filename: `${DOWNLOAD_DIR}/${fileName}`,
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
    state.status = "stopped";
    log("任务已停止", "warning");
    await closeCaptureWindow();
    return;
  }
  state.status = "done";
  log(`全部完成：成功 ${state.success}，失败 ${state.failed}`, state.failed ? "warning" : "success");
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
      const screenshotCount = state.tasks.filter((task) => task.status === "SUCCESS" && task.screenshotDataUrl).length;
      log(`已导出带截图 Excel：${screenshotCount} 张截图`, "success");
    } catch (error) {
      log(`带截图 Excel 导出失败：${error.message}`, "failed");
    }
  }
  await closeCaptureWindow();
}

async function closeCaptureWindow() {
  captureWindowId = null;
  calibratedCaptureSizeKey = null;
}

function normalizeOptions(options) {
  return {
    concurrency: Math.min(8, Math.max(1, Number.parseInt(options.concurrency, 10) || 2)),
    delayMs: Math.max(500, Number(options.delayMs) || 800),
    waitMs: Math.max(3000, Number(options.waitMs) || 12000),
    includeScreenshotWorkbook: Boolean(options.includeScreenshotWorkbook),
    captureSize: normalizeCaptureSize(options),
  };
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
  return {
    status: state.status,
    tasks: state.tasks.map((task) => ({
      id: task.id,
      listIndex: task.listIndex,
      rowNumber: task.rowNumber,
      fileName: task.fileName,
      url: task.url,
      status: task.status,
      error: task.error || "",
    })),
    options: state.options,
    success: state.success,
    failed: state.failed,
    runningCount: state.runningCount,
    logs: state.logs.slice(-100),
  };
}

function log(message, level = "") {
  const time = new Date().toLocaleTimeString("zh-CN", { hour12: false });
  state.logs.push({ message: `${time} ${message}`, level });
  if (state.logs.length > 200) state.logs = state.logs.slice(-200);
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
      filename: `${DOWNLOAD_DIR}/失败清单_${timestamp}.csv`,
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

function csvEscape(value) {
  const text = String(value == null ? "" : value);
  return `"${text.replace(/"/g, '""')}"`;
}

async function downloadScreenshotWorkbook() {
  const successfulTasks = state.tasks.filter((task) => task.status === "SUCCESS" && task.screenshotDataUrl);
  if (!successfulTasks.length) throw new Error("没有可写入 Excel 的成功截图");
  const workbook = buildScreenshotWorkbook(state.sourceRows, successfulTasks);
  const fileName = `${DOWNLOAD_DIR}/${buildWorkbookFileName(state.sourceFileName)}`;
  const id = `${Date.now()}-${Math.random().toString(36).slice(2)}`;
  pendingWorkbookExports.set(id, { fileName, bytes: workbook, offset: 0 });
  await chrome.tabs.create({ url: chrome.runtime.getURL(`download-workbook.html?id=${encodeURIComponent(id)}`), active: false });
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

function buildWorkbookFileName(sourceFileName) {
  const name = String(sourceFileName || "截图结果").replace(/\.[^.]+$/, "").replace(/[\\/:*?"<>|\r\n\t]+/g, "").trim() || "截图结果";
  return `${name}_带截图.xlsx`;
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

function buildScreenshotWorkbook(sourceRows, tasks) {
  const rows = cloneRows(sourceRows);
  const headerRowIndex = rows.length ? 0 : -1;
  const imageSlots = buildImageSlots(tasks);
  const screenshotColumnCount = Math.max(1, ...Array.from(imageSlots.values(), (items) => items.length));
  const baseColumnCount = Math.max(1, ...rows.map((row) => row.length));
  const imageColumnStart = baseColumnCount;
  ensureRow(rows, 0);
  for (let index = 0; index < screenshotColumnCount; index += 1) {
    rows[0][imageColumnStart + index] = index === 0 ? "截图" : `截图${index + 1}`;
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
        bytes: dataUrlToBytes(task.screenshotDataUrl),
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

function dataUrlToBytes(dataUrl) {
  const base64 = String(dataUrl || "").split(",")[1] || "";
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i += 1) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

function buildXlsxFiles(rows, images, rowCount, columnCount, imageColumnStart, screenshotColumnCount) {
  const files = [
    { name: "[Content_Types].xml", data: encodeText(buildContentTypes(images.length)) },
    { name: "_rels/.rels", data: encodeText(buildRootRels()) },
    { name: "xl/workbook.xml", data: encodeText(buildWorkbookXml()) },
    { name: "xl/_rels/workbook.xml.rels", data: encodeText(buildWorkbookRels()) },
    { name: "xl/worksheets/sheet1.xml", data: encodeText(buildSheetXml(rows, rowCount, columnCount, imageColumnStart, screenshotColumnCount, images.length > 0)) },
  ];
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

function buildContentTypes(imageCount) {
  const imageOverrides = Array.from({ length: imageCount }, (_, index) => `<Override PartName="/xl/media/image${index + 1}.png" ContentType="image/png"/>`).join("");
  const drawingOverride = imageCount ? '<Override PartName="/xl/drawings/drawing1.xml" ContentType="application/vnd.openxmlformats-officedocument.drawing+xml"/>' : "";
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/><Override PartName="/xl/worksheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>${drawingOverride}${imageOverrides}</Types>`;
}

function buildRootRels() {
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/></Relationships>`;
}

function buildWorkbookXml() {
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets><sheet name="截图结果" sheetId="1" r:id="rId1"/></sheets></workbook>`;
}

function buildWorkbookRels() {
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet1.xml"/></Relationships>`;
}

function buildSheetXml(rows, rowCount, columnCount, imageColumnStart, screenshotColumnCount, hasDrawing) {
  const dimension = `A1:${columnIndexToNameForXlsx(columnCount - 1)}${rowCount}`;
  const columns = buildSheetColumns(columnCount, imageColumnStart, screenshotColumnCount);
  const sheetRows = [];
  for (let rowIndex = 0; rowIndex < rowCount; rowIndex += 1) {
    const row = rows[rowIndex] || [];
    const height = rowIndex === 0 ? 24 : 180;
    const cells = [];
    for (let columnIndex = 0; columnIndex < columnCount; columnIndex += 1) {
      const value = row[columnIndex];
      if (value == null || value === "") continue;
      cells.push(`<c r="${columnIndexToNameForXlsx(columnIndex)}${rowIndex + 1}" t="inlineStr"><is><t>${xmlEscape(value)}</t></is></c>`);
    }
    sheetRows.push(`<row r="${rowIndex + 1}" ht="${height}" customHeight="1">${cells.join("")}</row>`);
  }
  const drawing = hasDrawing ? '<drawing r:id="rId1"/>' : "";
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><dimension ref="${dimension}"/>${columns}<sheetData>${sheetRows.join("")}</sheetData>${drawing}</worksheet>`;
}

function buildSheetColumns(columnCount, imageColumnStart, screenshotColumnCount) {
  const columns = [];
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
