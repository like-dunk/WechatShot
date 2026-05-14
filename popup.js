const VIDEO_URL_PATTERNS = [
  /(?:https?|ttps?|tps|ps):\/\/weixin\.qq\.com\/sph\/[A-Za-z0-9_-]+/gi,
  /(?:https?|ttps?|tps|ps):\/\/channels\.weixin\.qq\.com\/[^\s"'<>，。；;、]+/gi,
  /(?:https?|ttps?|tps|ps):\/\/m\.toutiao\.com\/is\/[A-Za-z0-9_-]+\/?/gi,
  /(?:https?|ttps?|tps|ps):\/\/(?:www\.)?toutiao\.com\/(?:article|w|video)\/[^\s"'<>，。；;、]+/gi,
  /(?:https?|ttps?|tps|ps):\/\/v\.douyin\.com\/[A-Za-z0-9_-]+\/?/gi,
  /(?:https?|ttps?|tps|ps):\/\/(?:www\.)?douyin\.com\/(?:video|note)\/\d+[^\s"'<>，。；;、]*/gi,
  /(?:^|[\s"'<>，。；;、])(?:v\.douyin\.com\/[A-Za-z0-9_-]+\/?|(?:www\.)?douyin\.com\/(?:video|note)\/\d+[^\s"'<>，。；;、]*)/gi,
  /(?:https?|ttps?|tps|ps):\/\/(?:www\.)?xiaohongshu\.com\/(?:explore|discovery\/item)\/[A-Za-z0-9_-]+[^\s"'<>，。；;、]*/gi,
  /(?:https?|ttps?|tps|ps):\/\/xhslink\.com\/[^\s"'<>，。；;、]+/gi,
  /(?:^|[\s"'<>，。；;、])(?:(?:www\.)?xiaohongshu\.com\/(?:explore|discovery\/item)\/[A-Za-z0-9_-]+[^\s"'<>，。；;、]*|xhslink\.com\/[^\s"'<>，。；;、]+)/gi,
];
const HTTP_URL_PATTERN = /(?:https?|ttps?|tps|ps):\/\/[^\s"'<>，。；;、）)】\]]+/gi;
const SHORT_LINK_PATTERN = /^https?:\/\/(?:www\.)?pinhaojian\.com\/redirect\//i;
const ASSET_LINK_PATTERN = /(?:\.(?:mp4|mov|m4v|avi|webm)(?:[?#]|$)|aliyuncs\.com|myqcloud\.com|qcloud|cos\.|oss-|\/stodownload)/i;
const TRAILING_PUNCTUATION = /[.,;!?，。；！？、）)】\]]+$/;
const ILLEGAL_FILENAME_CHARS = /[\\/:*?"<>|\r\n\t]+/g;
const PLATFORM_LABELS = {
  weixin: "视频号",
  toutiao: "头条号",
  douyin: "抖音",
  xiaohongshu: "小红书",
};

const CAPTURE_SIZE_PRESETS = {
  current: { width: 1440, height: 1200 },
  vertical: { width: 720, height: 1280 },
  horizontal: { width: 1280, height: 720 },
  square: { width: 1080, height: 1080 },
};
const CUSTOM_CAPTURE_SIZE_LIMITS = {
  minWidth: 360,
  maxWidth: 1920,
  minHeight: 360,
  maxHeight: 2160,
};
const DOUYIN_BATCH_SIZE = 20;
const DOUYIN_PROXY_ROTATION_INTERVAL = DOUYIN_BATCH_SIZE;
const DOUYIN_PROXY_SETTINGS_KEY = "douyinProxyRotationSettings";
const REFLO_ENRICHMENT_SETTINGS_KEY = "refloReleaseInfoSettings";
const REFLO_DEFAULT_API_URL = "https://reflo-dashboard.pinhaojian.com/api/v1/plugin/release-info/batch";
const REFLO_BATCH_SIZE = 50;
const REFLO_REQUEST_TIMEOUT_MS = 45000;
const CLASH_DEFAULT_CONTROLLER_URL = "http://127.0.0.1:9090";
const CLASH_DEFAULT_GROUP_NAME = "Proxy";
const DOUYIN_DEFAULT_PROXY_NODE_NAMES = "🇭🇰 香港 IEPL 08,🇭🇰 香港 IEPL 12,🇨🇳 台湾 IEPL 01,🇸🇬 新加坡 IEPL 01,🇯🇵 日本 IEPL 01,🇰🇷 韩国 IEPL 01";
const PPT_MODES = {
  clippings: {
    label: "发布剪报多图铺页",
    info: "使用内置模板自动铺满发布剪报页；支持 ZIP 压缩包或截图文件夹，插件内生成建议 ≤2000 张、ZIP ≤2GB。",
  },
  "link-screenshot": {
    label: "链接截图单图单页",
    info: "使用内置链接截图模板，每张截图生成一页；优先匹配已导入任务的序号、昵称和链接，缺失时按截图文件名兜底。",
  },
  "release-info-screenshot": {
    label: "发布信息截图单图单页",
    info: "使用内置发布信息截图模板，每张截图生成一页；优先匹配已导入任务，并填充账号、平台、标题、链接和时间。",
  },
};
const SUPPLEMENT_IMAGE_PATTERN = /\.(?:png|jpe?g|webp)$/i;
const SUPPLEMENT_ZIP_SOURCE_LIMIT = 500 * 1024 * 1024;

let allParsedTasks = [];
let parsedTasks = [];
let currentState = null;
let currentRows = null;
let currentFileName = "";
let currentImportAnalysis = null;
let currentPptSource = null;
let currentSupplementSource = null;
let pptSourceReadToken = 0;
let isGeneratingPpt = false;
let isAutoGeneratingPpt = false;
let supplementSourceReadToken = 0;
let isPreparingSupplementStart = false;
let isRefloEnriching = false;
let isExcelCorrecting = false;

const elements = {
  fileInput: document.getElementById("fileInput"),
  fileInfo: document.getElementById("fileInfo"),
  captureModeInput: document.getElementById("captureModeInput"),
  supplementSourcePicker: document.getElementById("supplementSourcePicker"),
  supplementFolderInput: document.getElementById("supplementFolderInput"),
  supplementFolderInfo: document.getElementById("supplementFolderInfo"),
  refloEnrichmentInput: document.getElementById("refloEnrichmentInput"),
  refloEnrichmentPanel: document.getElementById("refloEnrichmentPanel"),
  refloApiUrlInput: document.getElementById("refloApiUrlInput"),
  refloApiTokenInput: document.getElementById("refloApiTokenInput"),
  refloEnrichmentInfo: document.getElementById("refloEnrichmentInfo"),
  excelCorrectionButton: document.getElementById("excelCorrectionButton"),
  excelFixButton: document.getElementById("excelFixButton"),
  excelCorrectionPreview: document.getElementById("excelCorrectionPreview"),
  pptModeInput: document.getElementById("pptModeInput"),
  pptReleaseTitleField: document.getElementById("pptReleaseTitleField"),
  pptReleaseTitleInput: document.getElementById("pptReleaseTitleInput"),
  pptZipInput: document.getElementById("pptZipInput"),
  pptFolderInput: document.getElementById("pptFolderInput"),
  pptZipInfo: document.getElementById("pptZipInfo"),
  generatePptButton: document.getElementById("generatePptButton"),
  statusBadge: document.getElementById("statusBadge"),
  concurrencyInput: document.getElementById("concurrencyInput"),
  delayInput: document.getElementById("delayInput"),
  waitInput: document.getElementById("waitInput"),
  limitInput: document.getElementById("limitInput"),
  sequenceModeInput: document.getElementById("sequenceModeInput"),
  douyinWindowModeInput: document.getElementById("douyinWindowModeInput"),
  douyinProxyRotationInput: document.getElementById("douyinProxyRotationInput"),
  douyinProxyRotationPanel: document.getElementById("douyinProxyRotationPanel"),
  douyinProxyControllerInput: document.getElementById("douyinProxyControllerInput"),
  douyinProxyGroupInput: document.getElementById("douyinProxyGroupInput"),
  douyinProxySecretInput: document.getElementById("douyinProxySecretInput"),
  douyinProxyNodeNamesInput: document.getElementById("douyinProxyNodeNamesInput"),
  captureSizeModeInput: document.getElementById("captureSizeModeInput"),
  captureWidthInput: document.getElementById("captureWidthInput"),
  captureHeightInput: document.getElementById("captureHeightInput"),
  screenshotWorkbookInput: document.getElementById("screenshotWorkbookInput"),
  autoGeneratePptInput: document.getElementById("autoGeneratePptInput"),
  startButton: document.getElementById("startButton"),
  pauseButton: document.getElementById("pauseButton"),
  resumeButton: document.getElementById("resumeButton"),
  stopButton: document.getElementById("stopButton"),
  totalCount: document.getElementById("totalCount"),
  successCount: document.getElementById("successCount"),
  failedCount: document.getElementById("failedCount"),
  pendingCount: document.getElementById("pendingCount"),
  progressText: document.getElementById("progressText"),
  progressPercent: document.getElementById("progressPercent"),
  progressFill: document.getElementById("progressFill"),
  previewList: document.getElementById("previewList"),
  logList: document.getElementById("logList"),
  copyLogButton: document.getElementById("copyLogButton"),
};

init();

function init() {
  elements.fileInput.addEventListener("change", handleFileChange);
  elements.captureModeInput.addEventListener("change", handleCaptureModeChange);
  elements.supplementFolderInput.addEventListener("change", handleSupplementFolderChange);
  elements.refloEnrichmentInput.addEventListener("change", handleRefloSettingsChange);
  elements.refloApiTokenInput.addEventListener("input", saveRefloEnrichmentSettings);
  elements.excelCorrectionButton.addEventListener("click", runExcelCorrection);
  elements.excelFixButton.addEventListener("click", runExcelFix);
  elements.pptModeInput.addEventListener("change", handlePptModeChange);
  elements.pptZipInput.addEventListener("change", handlePptZipChange);
  elements.pptFolderInput.addEventListener("change", handlePptFolderChange);
  elements.generatePptButton.addEventListener("click", generatePpt);
  elements.startButton.addEventListener("click", startRun);
  elements.pauseButton.addEventListener("click", () => sendAction("pause"));
  elements.resumeButton.addEventListener("click", () => sendAction("resume"));
  elements.stopButton.addEventListener("click", () => sendAction("stop"));
  elements.copyLogButton.addEventListener("click", copyLogsToClipboard);
  elements.sequenceModeInput.addEventListener("change", rebuildTasksFromCurrentRows);
  elements.limitInput.addEventListener("change", rebuildTasksFromCurrentRows);
  elements.captureSizeModeInput.addEventListener("change", syncCaptureSizeInputs);
  elements.douyinProxyRotationInput.addEventListener("change", handleDouyinProxyRotationSettingsChange);
  elements.douyinProxyControllerInput.addEventListener("input", saveDouyinProxyRotationSettings);
  elements.douyinProxyGroupInput.addEventListener("input", saveDouyinProxyRotationSettings);
  elements.douyinProxySecretInput.addEventListener("input", saveDouyinProxyRotationSettings);
  elements.douyinProxyNodeNamesInput.addEventListener("input", saveDouyinProxyRotationSettings);
  setupUploadDropZones();
  handleCaptureModeChange();
  syncCaptureSizeInputs();
  syncDouyinProxyRotationUi();
  loadDouyinProxyRotationSettings();
  syncRefloEnrichmentUi();
  loadRefloEnrichmentSettings();
  handlePptModeChange();
  refreshState();
  setInterval(refreshState, 1200);
}

function handleCaptureModeChange() {
  syncCaptureModeUi();
  rebuildTasksFromCurrentRows();
}

function syncCaptureModeUi() {
  const isSupplementMode = getCurrentCaptureMode() === "supplement";
  elements.supplementSourcePicker.hidden = !isSupplementMode;
}

function setupUploadDropZones() {
  setupUploadDropZone(elements.fileInput.closest(".file-picker"), {
    input: elements.fileInput,
    multiple: false,
    onDrop: (files) => handleTaskFile(files[0]),
  });
  setupUploadDropZone(elements.supplementSourcePicker, {
    input: elements.supplementFolderInput,
    directory: true,
    onDrop: handleSupplementFiles,
  });
  setupUploadDropZone(elements.pptZipInput.closest(".ppt-source-action"), {
    input: elements.pptZipInput,
    multiple: false,
    onDrop: (files) => handlePptZipFile(files[0]),
  });
  setupUploadDropZone(elements.pptFolderInput.closest(".ppt-source-action"), {
    input: elements.pptFolderInput,
    directory: true,
    onDrop: handlePptFolderFiles,
  });
}

function setupUploadDropZone(zone, options) {
  if (!zone || !options || !options.input) return;
  const clearActive = () => zone.classList.remove("drop-active");
  zone.addEventListener("dragenter", (event) => {
    if (!event.dataTransfer || isUploadInputDisabled(options.input)) return;
    event.preventDefault();
    zone.classList.add("drop-active");
  });
  zone.addEventListener("dragover", (event) => {
    if (!event.dataTransfer || isUploadInputDisabled(options.input)) return;
    event.preventDefault();
    event.dataTransfer.dropEffect = "copy";
    zone.classList.add("drop-active");
  });
  zone.addEventListener("dragleave", (event) => {
    if (!zone.contains(event.relatedTarget)) clearActive();
  });
  zone.addEventListener("drop", async (event) => {
    clearActive();
    if (!event.dataTransfer || isUploadInputDisabled(options.input)) return;
    event.preventDefault();
    try {
      const files = await getDroppedFiles(event.dataTransfer, options);
      if (!files.length) return;
      await options.onDrop(files);
    } catch (error) {
      addLog(`拖拽上传失败：${error.message}`, "failed");
      if (options.input === elements.fileInput) elements.fileInfo.textContent = `拖拽上传失败：${error.message}`;
      else if (options.input === elements.supplementFolderInput) elements.supplementFolderInfo.textContent = `拖拽上传失败：${error.message}`;
      else if (options.input === elements.pptZipInput || options.input === elements.pptFolderInput) elements.pptZipInfo.textContent = `拖拽上传失败：${error.message}`;
    }
  });
}

function isUploadInputDisabled(input) {
  return !input || input.disabled || input.closest("[hidden]");
}

async function getDroppedFiles(dataTransfer, options) {
  if (options.directory) {
    const files = await readDroppedDirectoryFiles(dataTransfer.items);
    return files.length ? files : Array.from(dataTransfer.files || []);
  }
  const files = Array.from(dataTransfer.files || []).filter((file) => file && file.name);
  return options.multiple === false ? files.slice(0, 1) : files;
}

async function readDroppedDirectoryFiles(items) {
  const entries = Array.from(items || [])
    .map((item) => item && typeof item.webkitGetAsEntry === "function" ? item.webkitGetAsEntry() : null)
    .filter(Boolean);
  if (!entries.length) return [];
  const files = [];
  for (const entry of entries) {
    await collectDroppedEntryFiles(entry, "", files);
  }
  return files;
}

async function collectDroppedEntryFiles(entry, parentPath, files) {
  if (!entry) return;
  const entryPath = parentPath ? `${parentPath}/${entry.name}` : entry.name;
  if (entry.isFile) {
    const file = await readDroppedEntryFile(entry);
    files.push(withRelativePath(file, entryPath));
    return;
  }
  if (!entry.isDirectory) return;
  const reader = entry.createReader();
  while (true) {
    const entries = await readDroppedDirectoryEntries(reader);
    if (!entries.length) break;
    for (const child of entries) {
      await collectDroppedEntryFiles(child, entryPath, files);
    }
  }
}

function readDroppedEntryFile(entry) {
  return new Promise((resolve, reject) => {
    entry.file(resolve, reject);
  });
}

function readDroppedDirectoryEntries(reader) {
  return new Promise((resolve, reject) => {
    reader.readEntries(resolve, reject);
  });
}

function withRelativePath(file, relativePath) {
  if (!file || !relativePath) return file;
  try {
    Object.defineProperty(file, "webkitRelativePath", {
      value: relativePath,
      configurable: true,
    });
  } catch (error) {
    return file;
  }
  return file;
}

async function handleFileChange(event) {
  const file = event.target.files && event.target.files[0];
  await handleTaskFile(file);
}

async function handleTaskFile(file) {
  if (!file) return;
  try {
    setBadge("解析中", "running");
    addLog(`开始解析：${file.name}`);
    currentRows = await parseInputFile(file);
    currentFileName = file.name;
    applyParsedRows(currentRows, currentFileName, { logDiagnostics: true });
  } catch (error) {
    allParsedTasks = [];
    parsedTasks = [];
    currentRows = null;
    currentFileName = "";
    currentImportAnalysis = null;
    elements.startButton.disabled = true;
    elements.fileInfo.textContent = `解析失败：${error.message}`;
    renderPreview([]);
    renderCounts({ total: 0, success: 0, failed: 0, pending: 0 });
    setBadge("解析失败", "");
    addLog(`解析失败：${error.message}`, "failed");
  }
}

async function handleSupplementFolderChange(event) {
  await handleSupplementFiles(Array.from(event.target.files || []));
}

async function handleSupplementFiles(files) {
  const readToken = ++supplementSourceReadToken;
  currentSupplementSource = null;
  if (!files.length) {
    elements.supplementFolderInfo.textContent = "精准补充模式会按完整文件名找缺失截图。";
    rebuildTasksFromCurrentRows();
    return;
  }
  const folderName = getPptFolderName(files);
  try {
    const entries = collectSupplementImageEntries(files);
    if (readToken !== supplementSourceReadToken) return;
    if (!entries.length) throw new Error("文件夹中没有找到 png、jpg、jpeg 或 webp 图片");
    const totalBytes = entries.reduce((total, entry) => total + entry.size, 0);
    if (totalBytes > SUPPLEMENT_ZIP_SOURCE_LIMIT) throw new Error(`精准补充修复版 ZIP 暂支持原截图总大小不超过 ${formatBytesForSupplement(SUPPLEMENT_ZIP_SOURCE_LIMIT)}`);
    currentSupplementSource = { name: folderName, entries, imageCount: entries.length, totalBytes };
    elements.supplementFolderInfo.textContent = buildSupplementSourceInfo();
    addLog(`已有截图文件夹读取完成：${entries.length} 张图片`, "success");
    rebuildTasksFromCurrentRows();
  } catch (error) {
    if (readToken !== supplementSourceReadToken) return;
    currentSupplementSource = null;
    elements.supplementFolderInfo.textContent = `读取失败：${error.message}`;
    addLog(`已有截图文件夹读取失败：${error.message}`, "failed");
    rebuildTasksFromCurrentRows();
  }
}

function handlePptModeChange() {
  syncPptModeUi();
  if (currentPptSource) {
    elements.pptZipInfo.textContent = buildPptSourceInfo(currentPptSource.name, currentPptSource.imageCount);
    return;
  }
  elements.pptZipInfo.textContent = getCurrentPptMode().info;
}

function syncPptModeUi() {
  const isReleaseInfoMode = elements.pptModeInput.value === "release-info-screenshot";
  if (elements.pptReleaseTitleField) {
    elements.pptReleaseTitleField.hidden = !isReleaseInfoMode;
    elements.pptReleaseTitleField.style.display = isReleaseInfoMode ? "" : "none";
  }
  updateRefloEnrichmentInfo();
}

async function handlePptZipChange(event) {
  const file = event.target.files && event.target.files[0];
  await handlePptZipFile(file);
}

async function handlePptZipFile(file) {
  if (isGeneratingPpt) return;
  const readToken = ++pptSourceReadToken;
  currentPptSource = null;
  elements.generatePptButton.disabled = true;
  if (!file) {
    elements.pptZipInfo.textContent = getCurrentPptMode().info;
    return;
  }
  try {
    if (!/\.zip$/i.test(file.name)) throw new Error("请选择 .zip 压缩包");
    elements.pptZipInfo.textContent = `正在读取：${file.name}`;
    addLog(`开始读取截图压缩包：${file.name}`);
    const analysis = await window.PptxClippings.inspectZipFile(file);
    if (readToken !== pptSourceReadToken) return;
    if (!analysis.imageCount) throw new Error("压缩包中没有找到 png、jpg、jpeg 或 webp 图片");
    currentPptSource = { type: "zip", name: file.name, file, imageCount: analysis.imageCount };
    elements.pptFolderInput.value = "";
    elements.pptZipInfo.textContent = buildPptSourceInfo(file.name, analysis.imageCount);
    elements.generatePptButton.disabled = false;
    addLog(`截图压缩包读取完成：${analysis.imageCount} 张图片`, "success");
  } catch (error) {
    if (readToken !== pptSourceReadToken) return;
    currentPptSource = null;
    elements.pptZipInfo.textContent = `读取失败：${error.message}`;
    elements.generatePptButton.disabled = true;
    addLog(`截图压缩包读取失败：${error.message}`, "failed");
  }
}

async function handlePptFolderChange(event) {
  await handlePptFolderFiles(Array.from(event.target.files || []));
}

async function handlePptFolderFiles(files) {
  if (isGeneratingPpt) return;
  const readToken = ++pptSourceReadToken;
  currentPptSource = null;
  elements.generatePptButton.disabled = true;
  if (!files.length) {
    elements.pptZipInfo.textContent = getCurrentPptMode().info;
    return;
  }
  const folderName = getPptFolderName(files);
  try {
    elements.pptZipInfo.textContent = `正在读取：${folderName}`;
    addLog(`开始读取截图文件夹：${folderName}`);
    const analysis = await window.PptxClippings.inspectImageFiles(files);
    if (readToken !== pptSourceReadToken) return;
    if (!analysis.imageCount) throw new Error("文件夹中没有找到 png、jpg、jpeg 或 webp 图片");
    currentPptSource = { type: "folder", name: folderName, files, imageCount: analysis.imageCount };
    elements.pptZipInput.value = "";
    elements.pptZipInfo.textContent = buildPptSourceInfo(folderName, analysis.imageCount);
    elements.generatePptButton.disabled = false;
    addLog(`截图文件夹读取完成：${analysis.imageCount} 张图片`, "success");
  } catch (error) {
    if (readToken !== pptSourceReadToken) return;
    currentPptSource = null;
    elements.pptZipInfo.textContent = `读取失败：${error.message}`;
    elements.generatePptButton.disabled = true;
    addLog(`截图文件夹读取失败：${error.message}`, "failed");
  }
}

async function generatePpt() {
  const source = currentPptSource;
  if (!source || isGeneratingPpt) return;
  const mode = getCurrentPptMode();
  try {
    isGeneratingPpt = true;
    elements.generatePptButton.disabled = true;
    elements.pptZipInput.disabled = true;
    elements.pptFolderInput.disabled = true;
    elements.pptModeInput.disabled = true;
    if (elements.pptReleaseTitleInput) elements.pptReleaseTitleInput.disabled = true;
    elements.generatePptButton.textContent = "正在生成...";
    addLog(`开始生成${mode.label} PPT：${source.name}`);
    if (shouldEnrichReleaseInfoForManualPpt(mode.value)) {
      await enrichCurrentTasksWithReflo({ auto: true });
    }
    const result = await buildPptByMode(source, mode.value);
    await window.PptxClippings.downloadResult(result);
    elements.pptZipInfo.textContent = buildPptResultInfo(mode, result);
    addLog(`${mode.label} PPT 已触发下载：${result.imageCount} 张图片，${result.slideCount} 页`, "success");
  } catch (error) {
    elements.pptZipInfo.textContent = `生成失败：${error.message}`;
    addLog(`${mode.label} PPT 生成失败：${error.message}`, "failed");
  } finally {
    isGeneratingPpt = false;
    const running = currentState && (currentState.status === "running" || currentState.status === "paused" || currentState.status === "stopping" || currentState.status === "finalizing");
    elements.pptZipInput.disabled = Boolean(running);
    elements.pptFolderInput.disabled = Boolean(running);
    elements.pptModeInput.disabled = Boolean(running);
    if (elements.pptReleaseTitleInput) elements.pptReleaseTitleInput.disabled = Boolean(running);
    elements.generatePptButton.disabled = Boolean(running) || !currentPptSource;
    elements.generatePptButton.textContent = "生成并下载 PPT";
  }
}

function getCurrentPptMode() {
  const value = elements.pptModeInput.value;
  const mode = PPT_MODES[value] || PPT_MODES.clippings;
  return { value, ...mode };
}

function shouldUseReleaseInfoEnrichmentForStart() {
  return Boolean(
    elements.refloEnrichmentInput.checked
    && elements.autoGeneratePptInput
    && elements.autoGeneratePptInput.checked
    && elements.pptModeInput.value === "release-info-screenshot"
  );
}

function shouldEnrichReleaseInfoForManualPpt(modeValue) {
  return Boolean(elements.refloEnrichmentInput.checked && modeValue === "release-info-screenshot");
}

async function buildPptByMode(source, modeValue, options = {}) {
  const matchingTasks = options.tasks || (allParsedTasks.length ? allParsedTasks : parsedTasks);
  if (modeValue === "link-screenshot") {
    return source.type === "zip"
      ? window.PptxClippings.buildLinkScreenshotFromZipFile(source.file, matchingTasks)
      : window.PptxClippings.buildLinkScreenshotFromImageFiles(source.files, source.name, matchingTasks);
  }
  if (modeValue === "release-info-screenshot") {
    const title = options.title != null ? options.title : elements.pptReleaseTitleInput ? elements.pptReleaseTitleInput.value : "";
    return source.type === "zip"
      ? window.PptxClippings.buildReleaseInfoScreenshotFromZipFile(source.file, matchingTasks, { title })
      : window.PptxClippings.buildReleaseInfoScreenshotFromImageFiles(source.files, source.name, matchingTasks, { title });
  }
  return source.type === "zip"
    ? window.PptxClippings.buildFromZipFile(source.file)
    : window.PptxClippings.buildFromImageFiles(source.files, source.name);
}

function buildPptSourceInfo(name, imageCount) {
  const mode = getCurrentPptMode();
  const matchingTaskCount = allParsedTasks.length || parsedTasks.length;
  const taskText = (mode.value === "link-screenshot" || mode.value === "release-info-screenshot") && matchingTaskCount ? `，将优先匹配 ${matchingTaskCount} 条已导入任务` : "";
  return `${name}，识别到 ${imageCount} 张图片，将生成${mode.label} PPT${taskText}`;
}

function buildPptResultInfo(mode, result) {
  if (mode.value === "link-screenshot") {
    return `已生成：${result.imageCount} 张图片，${result.slideCount} 页链接截图单图单页`;
  }
  if (mode.value === "release-info-screenshot") {
    return `已生成：${result.imageCount} 张图片，${result.slideCount} 页发布信息截图单图单页`;
  }
  return `已生成：${result.imageCount} 张图片，${result.slideCount} 页发布剪报，每页 ${result.imagesPerSlide} 张，布局 ${result.grid}`;
}

function getPptFolderName(files) {
  const first = files.find((file) => file.webkitRelativePath);
  const relativePath = first ? first.webkitRelativePath : "";
  const name = relativePath.split("/").filter(Boolean)[0];
  return name || "截图文件夹";
}

function applyParsedRows(rows, fileName, options = {}) {
  const limit = parsePositiveInteger(elements.limitInput.value, 0);
  const result = buildTasks(rows, limit || null, elements.sequenceModeInput.value);
  allParsedTasks = result.tasks;
  parsedTasks = getTasksForCurrentCaptureMode(allParsedTasks);
  currentImportAnalysis = result.analysis;
  const foundCount = result.analysis.summary.selectedVideoUrlCount;
  const limitedText = allParsedTasks.length < foundCount ? `，准备处理 ${allParsedTasks.length} 条` : "";
  const supplementText = getCurrentCaptureMode() === "supplement" && currentSupplementSource ? `；精准补充缺失 ${parsedTasks.length} 条` : "";
  const sequenceText = elements.sequenceModeInput.value === "row" ? "文件名前缀使用 Excel 行号 - 1" : "文件名前缀自动校正为全局连续序号";
  elements.fileInfo.textContent = `${fileName}，识别到 ${foundCount} 条支持链接${limitedText}；已选择 ${result.analysis.summary.selectedColumnLabel}；${sequenceText}`;
  if (supplementText) elements.fileInfo.textContent += supplementText;
  updateStartButtonDisabled();
  renderPreview(parsedTasks);
  renderCounts({ total: parsedTasks.length, success: 0, failed: 0, pending: parsedTasks.length });
  setBadge(parsedTasks.length ? "已就绪" : "无任务", parsedTasks.length ? "done" : "");
  if (currentPptSource) elements.pptZipInfo.textContent = buildPptSourceInfo(currentPptSource.name, currentPptSource.imageCount);
  if (currentSupplementSource) elements.supplementFolderInfo.textContent = buildSupplementSourceInfo();
  renderExcelCorrectionPreview(null);
  updateRefloEnrichmentInfo();
  if (options.logDiagnostics) renderImportDiagnostics(result.analysis);
  addLog(`解析完成：${allParsedTasks.length} 条任务${getCurrentCaptureMode() === "supplement" ? `，精准补充待处理 ${parsedTasks.length} 条` : ""}`, parsedTasks.length ? "success" : "warning");
}

function rebuildTasksFromCurrentRows() {
  if (!currentRows) return;
  try {
    applyParsedRows(currentRows, currentFileName);
  } catch (error) {
    allParsedTasks = [];
    parsedTasks = [];
    currentImportAnalysis = null;
    elements.startButton.disabled = true;
    elements.fileInfo.textContent = `解析失败：${error.message}`;
    renderPreview([]);
    renderCounts({ total: 0, success: 0, failed: 0, pending: 0 });
    setBadge("解析失败", "");
    addLog(`解析失败：${error.message}`, "failed");
  }
}

function handleRefloSettingsChange() {
  syncRefloEnrichmentUi();
  saveRefloEnrichmentSettings();
  updateStartButtonDisabled();
}

function syncRefloEnrichmentUi(running = false) {
  const enabled = elements.refloEnrichmentInput.checked;
  elements.refloEnrichmentPanel.hidden = !enabled;
  elements.refloApiUrlInput.disabled = running || !enabled || isRefloEnriching;
  elements.refloApiTokenInput.disabled = running || !enabled || isRefloEnriching;
  syncExcelCorrectionUi(running);
  updateRefloEnrichmentInfo();
}

function syncExcelCorrectionUi(running = false) {
  if (!elements.excelCorrectionButton) return;
  const disabled = Boolean(running) || isRefloEnriching || isExcelCorrecting || !currentRows || !elements.refloEnrichmentInput.checked;
  elements.excelCorrectionButton.disabled = disabled;
  elements.excelCorrectionButton.textContent = isExcelCorrecting ? "纠错中..." : "Excel 纠错";
  if (elements.excelFixButton) {
    elements.excelFixButton.disabled = disabled;
    elements.excelFixButton.textContent = isExcelCorrecting ? "修正中..." : "Excel 修正";
  }
}

async function loadRefloEnrichmentSettings() {
  const settings = await readStorageValue(REFLO_ENRICHMENT_SETTINGS_KEY);
  if (settings && typeof settings === "object") {
    elements.refloEnrichmentInput.checked = Boolean(settings.enabled);
    elements.refloApiUrlInput.value = REFLO_DEFAULT_API_URL;
    elements.refloApiTokenInput.value = settings.token || "";
  }
  syncRefloEnrichmentUi(currentState && (currentState.status === "running" || currentState.status === "paused" || currentState.status === "stopping" || currentState.status === "finalizing"));
}

function saveRefloEnrichmentSettings() {
  writeStorageValue(REFLO_ENRICHMENT_SETTINGS_KEY, getRefloEnrichmentSettings());
}

function getRefloEnrichmentSettings() {
  return {
    enabled: elements.refloEnrichmentInput.checked,
    apiUrl: REFLO_DEFAULT_API_URL,
    token: normalizeRefloApiToken(elements.refloApiTokenInput.value),
    autoEnrich: true,
  };
}

function normalizeRefloApiToken(value) {
  return String(value || "").trim().replace(/^Bearer\s+/i, "").trim();
}

function updateRefloEnrichmentInfo(message = "") {
  if (!elements.refloEnrichmentInfo) return;
  if (message) {
    elements.refloEnrichmentInfo.textContent = message;
    return;
  }
  if (!elements.refloEnrichmentInput.checked) {
    elements.refloEnrichmentInfo.textContent = "仅发布信息 PPT 模式使用。";
    return;
  }
  if (elements.pptModeInput.value !== "release-info-screenshot") {
    elements.refloEnrichmentInfo.textContent = "当前 PPT 模式不会调用。";
    return;
  }
  if (!allParsedTasks.length) {
    elements.refloEnrichmentInfo.textContent = "生成发布信息 PPT 时自动获取。";
    return;
  }
  const enrichedCount = allParsedTasks.filter((task) => task.releaseInfo && task.releaseInfo.source === "reflo").length;
  elements.refloEnrichmentInfo.textContent = `生成发布信息 PPT 时自动获取；已增强 ${enrichedCount}/${allParsedTasks.length} 条。`;
}

async function enrichCurrentTasksWithReflo(options = {}) {
  const settings = getRefloEnrichmentSettings();
  if (!settings.enabled) return { ok: true, skipped: true };
  if (!allParsedTasks.length) {
    if (options.manual) addLog("没有可增强的任务，请先导入 Excel/CSV", "warning");
    return { ok: true, skipped: true };
  }
  if (!settings.apiUrl) {
    const message = "Reflo API 地址未配置";
    if (options.manual || options.auto) addLog(`${message}；本次将继续使用 Excel/CSV 字段`, "warning");
    updateRefloEnrichmentInfo(message);
    return { ok: false, error: message };
  }
  if (!settings.token) {
    const message = "请先填写 Reflo API Token";
    if (options.manual || options.auto) addLog(`${message}；本次将继续使用 Excel/CSV 字段`, "warning");
    updateRefloEnrichmentInfo(message);
    return { ok: false, error: message };
  }
  return enrichTasksWithReflo(allParsedTasks, settings, options);
}

async function enrichTasksWithReflo(tasks, settings, options = {}) {
  if (isRefloEnriching) return { ok: false, error: "发布信息正在获取中" };
  isRefloEnriching = true;
  syncRefloEnrichmentUi();
  updateStartButtonDisabled();
  let successCount = 0;
  let failedCount = 0;
  let lastError = "";
  try {
    addLog(`开始通过 Reflo 获取发布信息：${tasks.length} 条`);
    const batches = chunkArray(tasks, REFLO_BATCH_SIZE);
    for (let index = 0; index < batches.length; index += 1) {
      const batch = batches[index];
      updateRefloEnrichmentInfo(`正在获取发布信息：第 ${index + 1}/${batches.length} 批，${batch.length} 条...`);
      const response = await fetchRefloReleaseInfoBatch(settings, batch);
      const result = mergeRefloReleaseInfo(batch, response);
      successCount += result.successCount;
      failedCount += result.failedCount;
      if (result.failedCount && result.errors.length) lastError = result.errors[0];
      if (batches.length > 1) addLog(`Reflo 第 ${index + 1}/${batches.length} 批完成：成功 ${result.successCount}，失败 ${result.failedCount}`, result.failedCount ? "warning" : "success");
    }
    parsedTasks = getTasksForCurrentCaptureMode(allParsedTasks);
    renderPreview(parsedTasks);
    if (currentPptSource) elements.pptZipInfo.textContent = buildPptSourceInfo(currentPptSource.name, currentPptSource.imageCount);
    const message = `Reflo 发布信息获取完成：成功 ${successCount} 条，失败 ${failedCount} 条${failedCount ? "，失败项继续使用 Excel 字段" : ""}`;
    addLog(message, failedCount ? "warning" : "success");
    updateRefloEnrichmentInfo(message);
    return { ok: true, successCount, failedCount };
  } catch (error) {
    lastError = error.message;
    addLog(`Reflo 发布信息获取失败：${error.message}；将继续使用 Excel 字段`, options.manual ? "failed" : "warning");
    updateRefloEnrichmentInfo(`Reflo 获取失败：${error.message}；将继续使用 Excel 字段。`);
    return { ok: false, error: error.message, successCount, failedCount: tasks.length - successCount };
  } finally {
    isRefloEnriching = false;
    syncRefloEnrichmentUi();
    updateStartButtonDisabled();
    if (lastError && options.manual) addLog(`Reflo 失败示例：${lastError}`, "warning");
  }
}

async function runExcelCorrection() {
  return runExcelCorrectionWorkflow({ applyFixes: false });
}

async function runExcelFix() {
  return runExcelCorrectionWorkflow({ applyFixes: true });
}

async function runExcelCorrectionWorkflow(options = {}) {
  if (isExcelCorrecting) return;
  const applyFixes = Boolean(options.applyFixes);
  const actionName = applyFixes ? "修正" : "纠错";
  try {
    if (!currentRows || !currentImportAnalysis) throw new Error("请先导入 Excel/CSV");
    const settings = getRefloEnrichmentSettings();
    if (!settings.enabled) throw new Error("请先启用发布信息增强");
    if (!settings.token) throw new Error("请先填写发布信息增强 Token");
    isExcelCorrecting = true;
    syncRefloEnrichmentUi();
    renderExcelCorrectionPreview({ status: "running", message: applyFixes ? "正在修正 Excel..." : "正在校验 Excel..." });
    addLog(`开始 Excel ${actionName}：检查链接、重复项并核对正确发布信息`);
    const report = await buildExcelCorrectionReport(settings, { applyFixes });
    renderExcelCorrectionPreview(report);
    const response = await sendMessage({
      type: "DOWNLOAD_CORRECTED_WORKBOOK",
      rows: report.exportRows,
      sourceFileName: currentFileName,
      exportMode: applyFixes ? "fix" : "correction",
      headerRowIndex: report.headerRowIndex,
      rowStyles: report.rowStyles,
      cellStyles: report.cellStyles,
    });
    if (!response || !response.ok) throw new Error(response && response.error ? response.error : `导出${actionName} Excel 失败`);
    addLog(`Excel ${actionName}完成：问题行 ${report.summary.issueRows}/${report.summary.checkedRows}${applyFixes ? `，已自动修正 ${report.summary.fixedCells} 处` : ""}，已触发下载`, report.summary.issueRows ? "warning" : "success");
  } catch (error) {
    renderExcelCorrectionPreview({ status: "failed", message: error.message });
    addLog(`Excel ${actionName}失败：${error.message}`, "failed");
  } finally {
    isExcelCorrecting = false;
    syncRefloEnrichmentUi();
  }
}

async function buildExcelCorrectionReport(settings, options = {}) {
  const applyFixes = Boolean(options.applyFixes);
  const rows = cloneRowsForCorrection(currentRows);
  const analysis = currentImportAnalysis || analyzeImportRows(rows);
  const headerRowIndex = analysis.headerRowIndex;
  const noteColumnIndex = applyFixes ? -1 : Math.max(1, getMaxColumnCount(rows));
  if (!applyFixes) {
    ensureCorrectionRow(rows, headerRowIndex);
    rows[headerRowIndex][noteColumnIndex] = "纠错说明";
  }
  const rowReports = buildLocalCorrectionRows(rows, analysis, noteColumnIndex);
  const refloMap = await fetchRefloCorrectionInfo(settings, rowReports.filter((row) => row.primaryUrl));
  rowReports.forEach((rowReport) => applyRefloCorrection(rowReport, refloMap, rows, analysis));
  const fixedCells = applyFixes ? applyExcelFixes(rowReports, rows) : 0;
  const rowStyles = [];
  const cellStyles = [];
  const issueRows = [];
  rowReports.forEach((rowReport) => {
    if (!rowReport.issues.length) return;
    if (!applyFixes) rows[rowReport.rowIndex][noteColumnIndex] = rowReport.issues.map((issue) => issue.message).join("；");
    issueRows.push(rowReport);
    rowReport.issues.filter((issue) => issue.style === "blue" && issue.columnIndex >= 0).forEach((issue) => {
      cellStyles.push({ rowIndex: rowReport.rowIndex, columnIndex: issue.columnIndex, style: "blue" });
    });
    if (rowReport.hasInvalidLink) {
      rowStyles.push({ rowIndex: rowReport.rowIndex, style: "red" });
      return;
    }
    if (rowReport.hasDuplicateLink) {
      rowStyles.push({ rowIndex: rowReport.rowIndex, style: "purple" });
      return;
    }
    rowReport.issues.filter((issue) => issue.style === "yellow" && issue.columnIndex >= 0 && !issue.fixed).forEach((issue) => {
      cellStyles.push({ rowIndex: rowReport.rowIndex, columnIndex: issue.columnIndex, style: "yellow" });
    });
  });
  const summary = {
    checkedRows: rowReports.length,
    issueRows: issueRows.length,
    invalidLinks: rowReports.filter((row) => row.hasInvalidLink).length,
    duplicateRows: rowReports.filter((row) => row.hasDuplicateLink).length,
    duplicateAccountCells: rowReports.reduce((total, row) => total + row.issues.filter((issue) => issue.style === "blue").length, 0),
    fieldMismatches: rowReports.reduce((total, row) => total + row.issues.filter((issue) => issue.style === "yellow").length, 0),
    fixedCells,
  };
  return {
    headerRowIndex,
    exportRows: rows,
    rowStyles,
    cellStyles,
    summary,
    previewItems: buildExcelCorrectionPreviewItems(issueRows),
  };
}

function cloneRowsForCorrection(rows) {
  return (Array.isArray(rows) ? rows : []).map((row) => Array.isArray(row) ? row.map((value) => value == null ? "" : String(value)) : []);
}

function ensureCorrectionRow(rows, rowIndex) {
  while (rows.length <= rowIndex) rows.push([]);
}

function buildLocalCorrectionRows(rows, analysis, noteColumnIndex) {
  const duplicateMap = new Map();
  const duplicateAccountMap = new Map();
  const rowReports = [];
  for (let rowIndex = analysis.headerRowIndex + 1; rowIndex < rows.length; rowIndex += 1) {
    const row = rows[rowIndex] || [];
    if (!hasCellValue(row)) continue;
    ensureCorrectionRow(rows, rowIndex);
    const urls = extractVideoUrls(row[analysis.linkIndex]);
    const normalizedUrls = urls.map(normalizeCorrectionLink).filter(Boolean);
    const report = {
      rowIndex,
      rowNumber: rowIndex + 1,
      primaryUrl: urls[0] || "",
      normalizedUrl: normalizedUrls[0] || "",
      noteColumnIndex,
      issues: [],
      hasInvalidLink: false,
      hasDuplicateLink: false,
    };
    const accountValue = analysis.publishAccountIndex >= 0 ? normalizeTaskText(row[analysis.publishAccountIndex]) : "";
    const normalizedAccount = normalizeStrictCompareText(accountValue);
    if (!urls.length) {
      report.hasInvalidLink = true;
      report.issues.push({ type: "invalid-link", style: "red", message: "链接列无法提取支持平台发布链接" });
    }
    normalizedUrls.forEach((url) => {
      if (!duplicateMap.has(url)) duplicateMap.set(url, []);
      duplicateMap.get(url).push(report);
    });
    if (normalizedAccount) {
      if (!duplicateAccountMap.has(normalizedAccount)) duplicateAccountMap.set(normalizedAccount, { accountValue, reports: [] });
      duplicateAccountMap.get(normalizedAccount).reports.push(report);
    }
    rowReports.push(report);
  }
  duplicateMap.forEach((reports, url) => {
    if (reports.length < 2) return;
    reports.forEach((report) => {
      report.hasDuplicateLink = true;
      report.issues.push({ type: "duplicate-link", style: "purple", message: `重复链接：${url}` });
    });
  });
  duplicateAccountMap.forEach((entry) => {
    if (entry.reports.length < 2) return;
    entry.reports.forEach((report) => {
      report.issues.push({
        type: "duplicate-account",
        style: "blue",
        columnIndex: analysis.publishAccountIndex,
        message: `发布账号重复：${entry.accountValue}`,
      });
    });
  });
  return rowReports;
}

function normalizeCorrectionLink(url) {
  return cleanUrl(url).replace(/\/+$/, "").toLowerCase();
}

async function fetchRefloCorrectionInfo(settings, rowReports) {
  const taskMap = new Map();
  const tasks = rowReports.map((rowReport) => {
    const task = { id: `row-${rowReport.rowNumber}`, url: rowReport.primaryUrl, fileName: `第 ${rowReport.rowNumber} 行` };
    taskMap.set(task.id, rowReport);
    return task;
  });
  const result = new Map();
  const batches = chunkArray(tasks, REFLO_BATCH_SIZE);
  for (let index = 0; index < batches.length; index += 1) {
    renderExcelCorrectionPreview({ status: "running", message: `正在校验正确发布信息：第 ${index + 1}/${batches.length} 批...` });
    const response = await fetchRefloReleaseInfoBatch(settings, batches[index]);
    (response.items || []).forEach((item) => {
      const rowReport = taskMap.get(item && item.id);
      if (!rowReport) return;
      result.set(rowReport.rowIndex, item && item.ok && item.data ? { ok: true, data: normalizeRefloReleaseInfo(item.data) } : { ok: false, error: item && item.error ? item.error : "未获取到正确发布信息" });
    });
  }
  rowReports.forEach((rowReport) => {
    if (!result.has(rowReport.rowIndex)) result.set(rowReport.rowIndex, { ok: false, error: "未获取到正确发布信息" });
  });
  return result;
}

function applyRefloCorrection(rowReport, refloMap, rows, analysis) {
  if (!rowReport.primaryUrl) return;
  const reflo = refloMap.get(rowReport.rowIndex);
  if (!reflo || !reflo.ok) {
    rowReport.hasInvalidLink = true;
    rowReport.issues.push({ type: "reflo-missing", style: "red", message: `链接无法获取正确发布信息${reflo && reflo.error ? `：${reflo.error}` : ""}` });
    return;
  }
  const row = rows[rowReport.rowIndex] || [];
  compareCorrectionField(rowReport, row, analysis.publishTimeIndex, "发布日期", normalizePublishTime(row[analysis.publishTimeIndex]), normalizePublishTime(reflo.data.time), reflo.data.time);
  compareCorrectionField(rowReport, row, analysis.publishTitleIndex, "发布标题", normalizeStrictCompareText(row[analysis.publishTitleIndex]), normalizeStrictCompareText(reflo.data.title), reflo.data.title);
  compareCorrectionField(rowReport, row, analysis.publishPlatformIndex, "发布平台", normalizeStrictCompareText(normalizeRefloPlatformLabel(row[analysis.publishPlatformIndex])), normalizeStrictCompareText(reflo.data.platform), reflo.data.platform);
  compareCorrectionField(rowReport, row, analysis.publishAccountIndex, "发布账号", normalizeStrictCompareText(row[analysis.publishAccountIndex]), normalizeStrictCompareText(reflo.data.account), reflo.data.account);
}

function compareCorrectionField(rowReport, row, columnIndex, label, excelValue, refloValue, rawRefloValue = refloValue) {
  if (columnIndex < 0) return;
  if (!refloValue) return;
  if (excelValue === refloValue) return;
  const rawExcel = normalizeTaskText(row[columnIndex]);
  const correctLabel = getCorrectionReferenceLabel(label);
  rowReport.issues.push({
    type: "field-mismatch",
    style: "yellow",
    columnIndex,
    fixValue: buildCorrectionFixValue(label, rawRefloValue || refloValue),
    message: `${label}不一致：当前「${rawExcel || "空"}」；${correctLabel}「${rawRefloValue || refloValue}」`,
  });
}

function buildCorrectionFixValue(label, value) {
  if (label === "发布日期") return normalizePublishTime(value);
  return value;
}

function getCorrectionReferenceLabel(label) {
  const mapping = {
    发布日期: "正确日期",
    发布标题: "正确标题",
    发布平台: "正确平台",
    发布账号: "正确账号",
  };
  return mapping[label] || `正确${label}`;
}

function applyExcelFixes(rowReports, rows) {
  let fixedCells = 0;
  rowReports.forEach((rowReport) => {
    if (rowReport.hasInvalidLink || rowReport.hasDuplicateLink) return;
    const row = rows[rowReport.rowIndex] || [];
    const manualColumns = new Set(rowReport.issues.filter((issue) => issue.type === "duplicate-account" && issue.columnIndex >= 0).map((issue) => issue.columnIndex));
    rowReport.issues.filter((issue) => issue.style === "yellow" && issue.columnIndex >= 0 && issue.fixValue).forEach((issue) => {
      if (manualColumns.has(issue.columnIndex)) return;
      row[issue.columnIndex] = issue.fixValue;
      issue.fixed = true;
      issue.message = `${issue.message}；已自动修正`;
      fixedCells += 1;
    });
  });
  return fixedCells;
}

function normalizeStrictCompareText(value) {
  return normalizeTaskText(value).replace(/\s+/g, "");
}

function buildExcelCorrectionPreviewItems(issueRows) {
  return issueRows.slice(0, 8).map((rowReport) => ({
    rowNumber: rowReport.rowNumber,
    message: rowReport.issues.slice(0, 3).map((issue) => issue.message).join("；"),
  }));
}

function renderExcelCorrectionPreview(report) {
  if (!elements.excelCorrectionPreview) return;
  if (!report) {
    elements.excelCorrectionPreview.hidden = true;
    elements.excelCorrectionPreview.innerHTML = "";
    return;
  }
  elements.excelCorrectionPreview.hidden = false;
  if (report.status === "running" || report.status === "failed") {
    elements.excelCorrectionPreview.textContent = report.status === "failed" ? `纠错失败：${report.message}` : report.message;
    return;
  }
  const previewItems = report.previewItems || [];
  elements.excelCorrectionPreview.innerHTML = `
    <div class="excel-correction-summary">
      <span>检查 ${report.summary.checkedRows} 行</span>
      <span>问题 ${report.summary.issueRows} 行</span>
      <span>红色 ${report.summary.invalidLinks} 行</span>
      <span>紫色 ${report.summary.duplicateRows} 行</span>
      <span>蓝色 ${report.summary.duplicateAccountCells} 处</span>
      <span>黄色 ${report.summary.fieldMismatches} 处</span>
      <span>已修正 ${report.summary.fixedCells} 处</span>
    </div>
    <div class="excel-correction-legend">
      <span class="red">红：链接无法获取</span>
      <span class="purple">紫：重复链接</span>
      <span class="blue">蓝：账号重复</span>
      <span class="yellow">黄：字段不一致</span>
    </div>
    <div class="excel-correction-list"></div>
  `;
  const list = elements.excelCorrectionPreview.querySelector(".excel-correction-list");
  if (!previewItems.length) {
    list.textContent = "未发现问题，已导出检查结果。";
    return;
  }
  previewItems.forEach((item) => {
    const row = document.createElement("div");
    row.className = "excel-correction-item";
    row.textContent = `第 ${item.rowNumber} 行：${item.message}`;
    list.appendChild(row);
  });
}

async function fetchRefloReleaseInfoBatch(settings, tasks) {
  const payload = {
    links: tasks.map((task) => ({ id: task.id, url: task.url })),
  };
  const response = await fetchWithTimeout(settings.apiUrl, {
    method: "POST",
    headers: {
      "Authorization": `Bearer ${settings.token}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(payload),
  }, REFLO_REQUEST_TIMEOUT_MS);
  if (!response.ok) {
    const text = await response.text().catch(() => "");
    throw new Error(`Reflo API 请求失败：${response.status} ${response.statusText}${text ? `，${text.slice(0, 160)}` : ""}`);
  }
  const data = await response.json();
  if (!data || !Array.isArray(data.items)) throw new Error("Reflo API 响应格式无效");
  return data;
}

async function fetchWithTimeout(url, init, timeoutMs) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(url, { ...init, signal: controller.signal });
  } catch (error) {
    if (error && error.name === "AbortError") throw new Error(`Reflo API 请求超时（${Math.round(timeoutMs / 1000)} 秒）`);
    throw error;
  } finally {
    clearTimeout(timer);
  }
}

function mergeRefloReleaseInfo(tasks, response) {
  const taskMap = new Map(tasks.map((task) => [task.id, task]));
  let successCount = 0;
  let failedCount = 0;
  const errors = [];
  (response.items || []).forEach((item) => {
    const task = taskMap.get(item && item.id);
    if (!task) return;
    if (item.ok && item.data) {
      task.releaseInfo = mergeReleaseInfo(task, normalizeRefloReleaseInfo(item.data));
      successCount += 1;
      return;
    }
    failedCount += 1;
    if (item && item.error) errors.push(item.error);
  });
  const returnedIds = new Set((response.items || []).map((item) => item && item.id).filter(Boolean));
  tasks.forEach((task) => {
    if (!returnedIds.has(task.id)) {
      failedCount += 1;
      errors.push(`${task.fileName || task.id} 未返回结果`);
    }
  });
  return { successCount, failedCount, errors };
}

function normalizeRefloReleaseInfo(data) {
  const account = normalizeTaskText(data.account);
  const platform = normalizeRefloPlatformLabel(data.platformLabel || data.platform);
  const title = normalizeTaskText(data.title);
  const link = normalizeTaskText(data.resolvedUrl) || normalizeTaskText(data.url);
  const time = normalizePublishTime(data.publishTime || data.publish_time || data.createTime || data.create_time || data.createtime);
  return {
    account,
    platform,
    title,
    link,
    time,
    source: normalizeTaskText(data.source) || "reflo",
    confidence: normalizeTaskText(data.confidence),
    coverUrl: normalizeTaskText(coalesceRefloValue(data.coverUrl, data.cover_url)),
    avatarUrl: normalizeTaskText(coalesceRefloValue(data.avatarUrl, data.headImgUrl, data.head_img_url)),
    diggCount: normalizeMetricValue(coalesceRefloValue(data.diggCount, data.digg_count)),
    commentCount: normalizeMetricValue(coalesceRefloValue(data.commentCount, data.comment_count)),
    shareCount: normalizeMetricValue(coalesceRefloValue(data.shareCount, data.share_count)),
    collectCount: normalizeMetricValue(coalesceRefloValue(data.collectCount, data.collect_count)),
  };
}

function coalesceRefloValue(...values) {
  return values.find((value) => value !== undefined && value !== null && value !== "");
}

function normalizeRefloPlatformLabel(value) {
  const text = normalizeTaskText(value);
  const normalized = text.toLowerCase();
  const labels = {
    douyin: "抖音",
    toutiao: "头条号",
    weixin: "视频号",
    wechat: "视频号",
    wechat_channels: "视频号",
    channels: "视频号",
    xiaohongshu: "小红书",
    xhs: "小红书",
    weibo: "微博",
  };
  return labels[normalized] || text;
}

function mergeReleaseInfo(task, refloInfo) {
  const existing = task.releaseInfo || {};
  return {
    ...existing,
    ...Object.fromEntries(Object.entries(refloInfo).filter(([, value]) => value !== "" && value != null)),
    link: refloInfo.link || existing.link || task.url,
  };
}

function normalizeMetricValue(value) {
  if (value == null || value === "") return "";
  const number = Number(value);
  return Number.isFinite(number) ? number : String(value).trim();
}

function chunkArray(items, size) {
  const chunks = [];
  for (let index = 0; index < items.length; index += size) {
    chunks.push(items.slice(index, index + size));
  }
  return chunks;
}

async function parseInputFile(file) {
  const lowerName = file.name.toLowerCase();
  if (lowerName.endsWith(".csv")) {
    return parseCsv(await file.text());
  }
  if (lowerName.endsWith(".xlsx")) {
    return parseXlsx(await file.arrayBuffer());
  }
  throw new Error("请选择 .xlsx 或 .csv 文件");
}

function parseCsv(text) {
  const rows = [];
  let row = [];
  let cell = "";
  let inQuotes = false;
  for (let i = 0; i < text.length; i += 1) {
    const char = text[i];
    const next = text[i + 1];
    if (char === '"' && inQuotes && next === '"') {
      cell += '"';
      i += 1;
      continue;
    }
    if (char === '"') {
      inQuotes = !inQuotes;
      continue;
    }
    if (char === "," && !inQuotes) {
      row.push(cell);
      cell = "";
      continue;
    }
    if ((char === "\n" || char === "\r") && !inQuotes) {
      if (char === "\r" && next === "\n") i += 1;
      row.push(cell);
      rows.push(row);
      row = [];
      cell = "";
      continue;
    }
    cell += char;
  }
  if (cell || row.length) {
    row.push(cell);
    rows.push(row);
  }
  while (rows.length && !hasCellValue(rows[rows.length - 1])) rows.pop();
  return rows;
}

async function parseXlsx(arrayBuffer) {
  const entries = parseZipEntries(arrayBuffer);
  const workbookXml = await readZipText(entries, "xl/workbook.xml");
  const workbookRels = await readZipText(entries, "xl/_rels/workbook.xml.rels");
  const sharedStringsXml = entries.has("xl/sharedStrings.xml") ? await readZipText(entries, "xl/sharedStrings.xml") : "";
  const sheetPath = getFirstSheetPath(workbookXml, workbookRels);
  const sheetXml = await readZipText(entries, sheetPath);
  const sheetRelsPath = getSheetRelsPath(sheetPath);
  const sheetRelsXml = entries.has(sheetRelsPath) ? await readZipText(entries, sheetRelsPath) : "";
  const sharedStrings = parseSharedStrings(sharedStringsXml);
  const hyperlinkTargets = parseRelationshipTargets(sheetRelsXml);
  return parseSheetRows(sheetXml, sharedStrings, hyperlinkTargets);
}

function parseZipEntries(arrayBuffer) {
  const view = new DataView(arrayBuffer);
  const bytes = new Uint8Array(arrayBuffer);
  let eocdOffset = -1;
  for (let offset = bytes.length - 22; offset >= Math.max(0, bytes.length - 66000); offset -= 1) {
    if (view.getUint32(offset, true) === 0x06054b50) {
      eocdOffset = offset;
      break;
    }
  }
  if (eocdOffset < 0) throw new Error("不是有效的 xlsx 文件");
  const entryCount = view.getUint16(eocdOffset + 10, true);
  const centralDirOffset = view.getUint32(eocdOffset + 16, true);
  const entries = new Map();
  let offset = centralDirOffset;
  for (let i = 0; i < entryCount; i += 1) {
    if (view.getUint32(offset, true) !== 0x02014b50) throw new Error("xlsx 中央目录损坏");
    const method = view.getUint16(offset + 10, true);
    const compressedSize = view.getUint32(offset + 20, true);
    const uncompressedSize = view.getUint32(offset + 24, true);
    const fileNameLength = view.getUint16(offset + 28, true);
    const extraLength = view.getUint16(offset + 30, true);
    const commentLength = view.getUint16(offset + 32, true);
    const localHeaderOffset = view.getUint32(offset + 42, true);
    const nameBytes = bytes.slice(offset + 46, offset + 46 + fileNameLength);
    const name = new TextDecoder().decode(nameBytes);
    entries.set(name, { method, compressedSize, uncompressedSize, localHeaderOffset, arrayBuffer });
    offset += 46 + fileNameLength + extraLength + commentLength;
  }
  return entries;
}

async function readZipText(entries, name) {
  const entry = entries.get(name);
  if (!entry) throw new Error(`xlsx 缺少文件：${name}`);
  const view = new DataView(entry.arrayBuffer);
  const bytes = new Uint8Array(entry.arrayBuffer);
  const localOffset = entry.localHeaderOffset;
  if (view.getUint32(localOffset, true) !== 0x04034b50) throw new Error(`xlsx 本地文件头损坏：${name}`);
  const fileNameLength = view.getUint16(localOffset + 26, true);
  const extraLength = view.getUint16(localOffset + 28, true);
  const dataStart = localOffset + 30 + fileNameLength + extraLength;
  const compressed = bytes.slice(dataStart, dataStart + entry.compressedSize);
  let data;
  if (entry.method === 0) {
    data = compressed;
  } else if (entry.method === 8) {
    data = await inflateRaw(compressed);
  } else {
    throw new Error(`xlsx 压缩格式不支持：${entry.method}`);
  }
  if (entry.uncompressedSize && data.length !== entry.uncompressedSize) {
    data = data.slice(0, entry.uncompressedSize);
  }
  return new TextDecoder("utf-8").decode(data);
}

async function inflateRaw(bytes) {
  if (!globalThis.DecompressionStream) throw new Error("当前 Chrome 版本不支持解析 xlsx，请改用 CSV");
  const stream = new Blob([bytes]).stream().pipeThrough(new DecompressionStream("deflate-raw"));
  return new Uint8Array(await new Response(stream).arrayBuffer());
}

function getFirstSheetPath(workbookXml, relsXml) {
  const workbook = new DOMParser().parseFromString(workbookXml, "application/xml");
  const rels = new DOMParser().parseFromString(relsXml, "application/xml");
  const sheet = workbook.querySelector("sheet");
  if (!sheet) throw new Error("xlsx 未找到工作表");
  const relId = sheet.getAttribute("r:id") || sheet.getAttribute("id");
  const relationship = Array.from(rels.querySelectorAll("Relationship")).find((item) => item.getAttribute("Id") === relId);
  if (!relationship) throw new Error("xlsx 未找到工作表关系");
  const target = relationship.getAttribute("Target");
  if (!target) throw new Error("xlsx 工作表路径为空");
  return target.startsWith("/") ? target.slice(1) : `xl/${target}`.replace(/\/[^/]+\/\.\.\//g, "/");
}

function getSheetRelsPath(sheetPath) {
  const slashIndex = sheetPath.lastIndexOf("/");
  const directory = slashIndex >= 0 ? sheetPath.slice(0, slashIndex) : "";
  const fileName = slashIndex >= 0 ? sheetPath.slice(slashIndex + 1) : sheetPath;
  return `${directory}/_rels/${fileName}.rels`;
}

function parseRelationshipTargets(xml) {
  if (!xml) return new Map();
  const doc = new DOMParser().parseFromString(xml, "application/xml");
  return new Map(Array.from(doc.querySelectorAll("Relationship")).map((relationship) => [relationship.getAttribute("Id"), relationship.getAttribute("Target") || ""]));
}

function parseSharedStrings(xml) {
  if (!xml) return [];
  const doc = new DOMParser().parseFromString(xml, "application/xml");
  return Array.from(doc.querySelectorAll("si")).map((si) => Array.from(si.querySelectorAll("t")).map((t) => t.textContent || "").join(""));
}

function parseSheetRows(xml, sharedStrings, hyperlinkTargets) {
  const doc = new DOMParser().parseFromString(xml, "application/xml");
  const hyperlinks = parseSheetHyperlinks(doc, hyperlinkTargets);
  const rows = [];
  Array.from(doc.querySelectorAll("sheetData row")).forEach((row) => {
    const rowRef = Number.parseInt(row.getAttribute("r"), 10);
    const rowIndex = Number.isFinite(rowRef) && rowRef > 0 ? rowRef - 1 : rows.length;
    const values = [];
    Array.from(row.querySelectorAll("c")).forEach((cell) => {
      const ref = cell.getAttribute("r") || "A1";
      const colIndex = columnNameToIndex(ref.replace(/[0-9]/g, ""));
      values[colIndex] = appendHyperlinkTarget(readCellValue(cell, sharedStrings), hyperlinks.get(ref));
    });
    rows[rowIndex] = values.map((value) => value == null ? "" : value);
  });
  while (rows.length && !hasCellValue(rows[rows.length - 1])) rows.pop();
  return Array.from({ length: rows.length }, (_, index) => rows[index] || []);
}

function parseSheetHyperlinks(doc, hyperlinkTargets) {
  const hyperlinks = new Map();
  Array.from(doc.querySelectorAll("hyperlink")).forEach((hyperlink) => {
    const ref = hyperlink.getAttribute("ref");
    if (!ref || ref.includes(":")) return;
    const relId = hyperlink.getAttribute("r:id") || hyperlink.getAttribute("id");
    const target = hyperlinkTargets.get(relId) || hyperlink.getAttribute("location") || "";
    if (target) hyperlinks.set(ref, target);
  });
  return hyperlinks;
}

function appendHyperlinkTarget(value, target) {
  if (!target) return value;
  const text = String(value || "").trim();
  if (!text || text === target || text.includes(target)) return target;
  return `${text} ${target}`;
}

function readCellValue(cell, sharedStrings) {
  const type = cell.getAttribute("t");
  if (type === "inlineStr") {
    return Array.from(cell.querySelectorAll("is t")).map((t) => t.textContent || "").join("");
  }
  const value = cell.querySelector("v");
  if (!value) return "";
  const text = value.textContent || "";
  if (type === "s") return sharedStrings[Number(text)] || "";
  return text;
}

function columnNameToIndex(name) {
  let result = 0;
  for (const char of name.toUpperCase()) {
    result = result * 26 + char.charCodeAt(0) - 64;
  }
  return Math.max(0, result - 1);
}

function buildTasks(rows, limit, sequenceMode = "sequence") {
  const analysis = analyzeImportRows(rows);
  const tasks = [];
  const usedNames = new Set();
  const sequenceState = createSequenceState(sequenceMode, determineSequenceStartNumber(rows, analysis, sequenceMode));
  for (let rowIndex = analysis.headerRowIndex + 1; rowIndex < rows.length; rowIndex += 1) {
    const row = rows[rowIndex] || [];
    const urlItems = extractVideoUrls(row[analysis.linkIndex])
      .map((url) => ({ url, platform: getUrlPlatform(url) }))
      .filter((item) => item.platform);
    if (!urlItems.length) continue;
    const nickname = sanitizeFilenamePart(row[analysis.nicknameIndex], `昵称-${tasks.length + 1}`);
    const account = normalizeTaskText(row[analysis.publishAccountIndex]) || nickname;
    const sequence = sequenceMode === "row" ? String(rowIndex) : "";
    const continuousSequenceMode = sequenceMode === "sequence";
    urlItems.forEach((item, urlIndex) => {
      const displaySequence = resolveSequenceForPlatform(sequence, sequenceState);
      const sequenceForFile = continuousSequenceMode || urlItems.length === 1 ? displaySequence : `${displaySequence}-${urlIndex + 1}`;
      const fileName = buildUniqueFileName(`${sequenceForFile}_${nickname}`, usedNames);
      tasks.push({
        id: `${rowIndex + 1}-${urlIndex + 1}-${Date.now()}-${tasks.length}`,
        listIndex: tasks.length,
        rowNumber: rowIndex + 1,
        sequence: sequenceForFile,
        nickname,
        url: item.url,
        platform: item.platform,
        platformLabel: getPlatformLabel(item.platform),
        releaseInfo: {
          account,
          platform: normalizeTaskText(row[analysis.publishPlatformIndex]) || getPlatformLabel(item.platform),
          title: normalizeTaskText(row[analysis.publishTitleIndex]),
          link: normalizeTaskText(row[analysis.publishLinkIndex]) || item.url,
          time: normalizePublishTime(row[analysis.publishTimeIndex]),
        },
        fileName,
        status: "PENDING",
      });
    });
    if (limit && tasks.length >= limit) return { tasks: tasks.slice(0, limit), analysis };
  }
  return { tasks, analysis };
}

function createSequenceState(sequenceMode, startNumber = 1) {
  return {
    enabled: sequenceMode === "sequence",
    expectedNumber: sequenceMode === "sequence" ? startNumber : null,
  };
}

function resolveSequenceForPlatform(sequence, state) {
  if (!state.enabled) return sequence;
  const adjustedNumber = state.expectedNumber;
  state.expectedNumber += 1;
  return String(adjustedNumber);
}

function determineSequenceStartNumber(rows, analysis, sequenceMode) {
  if (sequenceMode !== "sequence" || analysis.sequenceIndex < 0) return 1;
  for (let rowIndex = analysis.headerRowIndex + 1; rowIndex < rows.length; rowIndex += 1) {
    const row = rows[rowIndex] || [];
    const hasTask = extractVideoUrls(row[analysis.linkIndex]).some((url) => getUrlPlatform(url));
    if (!hasTask) continue;
    const number = parseSequenceNumber(row[analysis.sequenceIndex]);
    if (number != null) return number;
  }
  return 1;
}

function parseSequenceNumber(sequence) {
  const text = String(sequence == null ? "" : sequence).trim();
  if (!/^\d+$/.test(text)) return null;
  const number = Number(text);
  return Number.isSafeInteger(number) ? number : null;
}

function analyzeImportRows(rows) {
  const headerRowIndex = findLikelyHeaderRowIndex(rows);
  const headerRow = rows[headerRowIndex] || [];
  const maxColumnCount = getMaxColumnCount(rows);
  const columns = [];
  for (let columnIndex = 0; columnIndex < maxColumnCount; columnIndex += 1) {
    const header = String(headerRow[columnIndex] || "").trim();
    const stats = scanColumn(rows, headerRowIndex, columnIndex);
    const headerScore = scoreHeader(header);
    const score = scoreLinkColumn(stats, headerScore);
    columns.push({ columnIndex, header, headerScore, score, ...stats });
  }
  const selected = columns
    .filter((column) => column.videoUrlCount > 0)
    .sort((left, right) => right.score - left.score || right.videoUrlCount - left.videoUrlCount || left.columnIndex - right.columnIndex)[0];
  if (!selected) throw new Error(buildNoVideoLinkError(columns));
  return {
    headerRowIndex,
    linkIndex: selected.columnIndex,
    nicknameIndex: findNicknameIndex(headerRow),
    sequenceIndex: findSequenceIndex(rows, headerRowIndex, headerRow),
    publishAccountIndex: findPublishAccountIndex(headerRow),
    publishPlatformIndex: findPublishPlatformIndex(headerRow),
    publishTitleIndex: findPublishTitleIndex(headerRow),
    publishLinkIndex: findPublishLinkIndex(headerRow, selected.columnIndex),
    publishTimeIndex: findPublishTimeIndex(headerRow),
    selectedColumn: selected,
    columns: columns.filter(shouldReportColumn),
    summary: buildImportSummary(columns, selected),
  };
}

function findLikelyHeaderRowIndex(rows) {
  let best = { rowIndex: -1, score: -1 };
  for (let rowIndex = 0; rowIndex < Math.min(rows.length, 20); rowIndex += 1) {
    const row = rows[rowIndex] || [];
    let score = 0;
    row.forEach((cell) => {
      score += scoreHeaderRowCell(cell);
    });
    if (score > best.score) best = { rowIndex, score };
  }
  if (best.rowIndex >= 0 && best.score > 0) return best.rowIndex;
  return 0;
}

function scoreHeaderRowCell(value) {
  const header = normalizeHeader(value);
  if (!header) return 0;
  let score = 0;
  if (header.includes("链接") || header.includes("url") || header.includes("地址")) score += 5;
  if (header.includes("昵称") || header.includes("账号") || header.includes("作者")) score += 3;
  if (header.includes("序号") || header.includes("编号")) score += 2;
  if (/标题|文案|话题|状态|日期|描述|tag/.test(header)) score += 1;
  return score;
}

function getMaxColumnCount(rows) {
  return rows.reduce((max, row) => Math.max(max, (row || []).length), 0);
}

function scanColumn(rows, headerRowIndex, columnIndex) {
  const stats = {
    rowCount: 0,
    nonEmptyCount: 0,
    httpCount: 0,
    videoUrlCount: 0,
    videoUrlRowCount: 0,
    shortLinkCount: 0,
    assetLinkCount: 0,
    otherLinkCount: 0,
  };
  for (let rowIndex = headerRowIndex + 1; rowIndex < rows.length; rowIndex += 1) {
    const row = rows[rowIndex] || [];
    if (!hasCellValue(row)) continue;
    stats.rowCount += 1;
    const value = String(row[columnIndex] || "").trim();
    if (!value) continue;
    stats.nonEmptyCount += 1;
    const urls = extractCandidateUrls(value);
    stats.httpCount += urls.length;
    const videoUrlCountBefore = stats.videoUrlCount;
    urls.forEach((url) => {
      if (isVideoUrl(url)) stats.videoUrlCount += 1;
      else if (isShortLink(url)) stats.shortLinkCount += 1;
      else if (isAssetLink(url)) stats.assetLinkCount += 1;
      else stats.otherLinkCount += 1;
    });
    if (stats.videoUrlCount > videoUrlCountBefore) stats.videoUrlRowCount += 1;
  }
  return stats;
}

function scoreLinkColumn(stats, headerScore) {
  if (!stats.videoUrlCount) return headerScore - stats.assetLinkCount * 4 - stats.shortLinkCount * 2;
  const videoRatio = stats.nonEmptyCount ? stats.videoUrlCount / stats.nonEmptyCount : 0;
  return stats.videoUrlCount * 20 + videoRatio * 80 + headerScore - stats.assetLinkCount * 8 - stats.shortLinkCount * 4 - stats.otherLinkCount;
}

function scoreHeader(value) {
  const header = normalizeHeader(value);
  if (!header) return 0;
  let score = 0;
  if (/发布链接|视频号链接|头条链接|头条号链接|抖音链接|小红书链接|作品链接|笔记链接|页面链接|分享链接/.test(header)) score += 60;
  if (/链接|url|地址/.test(header)) score += 15;
  if (/视频链接|素材链接|源视频|下载链接|视频id|主页id|视频号主页id/.test(header)) score -= 35;
  return score;
}

function normalizeHeader(value) {
  return String(value || "").trim().toLowerCase().replace(/\s+/g, "");
}

function normalizeTaskText(value) {
  return String(value == null ? "" : value).trim();
}

function normalizePublishTime(value) {
  const text = normalizeTaskText(value);
  if (!text) return "";
  if (/^\d{1,5}(?:\.\d+)?$/.test(text)) {
    const number = Number(text);
    if (number > 20000 && number < 80000) {
      const date = new Date(Math.round((number - 25569) * 86400000));
      if (!Number.isNaN(date.getTime())) {
        return formatPublishDateParts(date.getUTCFullYear(), date.getUTCMonth() + 1, date.getUTCDate());
      }
    }
  }
  let match = /^(\d{4})[./年-](\d{1,2})[./月-](\d{1,2})(?:日)?(?:\s+\d{1,2}:\d{1,2}(?::\d{1,2})?)?$/.exec(text);
  if (match) return formatPublishDateParts(match[1], match[2], match[3]);
  match = /^(\d{1,2})[./月-](\d{1,2})日?$/.exec(text);
  if (match) return formatPublishDateParts(2026, match[1], match[2]);
  return text;
}

function formatPublishDateParts(year, month, day) {
  const normalizedYear = Number(year);
  const normalizedMonth = Number(month);
  const normalizedDay = Number(day);
  if (!normalizedYear || normalizedMonth < 1 || normalizedMonth > 12 || normalizedDay < 1 || normalizedDay > 31) return "";
  const pad = (part) => String(part).padStart(2, "0");
  return `${normalizedYear}-${pad(normalizedMonth)}-${pad(normalizedDay)}`;
}

function findNicknameIndex(headerRow) {
  return findBestHeaderIndex(headerRow, ["昵称", "账号", "作者", "达人", "博主"]);
}

function findPublishAccountIndex(headerRow) {
  return findHeaderIndexContaining(headerRow, ["账号", "昵称"]);
}

function findPublishPlatformIndex(headerRow) {
  return findHeaderIndexContaining(headerRow, ["平台"]);
}

function findPublishTitleIndex(headerRow) {
  return findHeaderIndexContaining(headerRow, ["标题"]);
}

function findPublishLinkIndex(headerRow, fallbackIndex) {
  const index = findBestHeaderIndex(headerRow, ["发布链接", "链接"]);
  return index >= 0 ? index : fallbackIndex;
}

function findPublishTimeIndex(headerRow) {
  return findBestHeaderIndex(headerRow, ["发布时间", "发布日期", "日期"]);
}

function findSequenceIndex(rows, headerRowIndex, headerRow) {
  const headerIndex = findBestHeaderIndex(headerRow, ["序号", "编号"]);
  if (headerIndex >= 0) return headerIndex;
  return findNumericSequenceColumn(rows, headerRowIndex);
}

function findBestHeaderIndex(headerRow, keywords) {
  const normalized = Array.from({ length: getMaxColumnCount([headerRow]) }, (_, index) => normalizeHeader(headerRow[index]));
  for (const keyword of keywords) {
    const target = normalizeHeader(keyword);
    const exactIndex = normalized.findIndex((header) => header === target);
    if (exactIndex >= 0) return exactIndex;
  }
  for (const keyword of keywords) {
    const target = normalizeHeader(keyword);
    const partialIndex = normalized.findIndex((header) => header.includes(target));
    if (partialIndex >= 0) return partialIndex;
  }
  return -1;
}

function findHeaderIndexContaining(headerRow, keywords) {
  const normalized = Array.from({ length: getMaxColumnCount([headerRow]) }, (_, index) => normalizeHeader(headerRow[index]));
  return normalized.findIndex((header) => keywords.some((keyword) => header.includes(normalizeHeader(keyword))));
}

function findNumericSequenceColumn(rows, headerRowIndex) {
  const maxColumnCount = Math.min(getMaxColumnCount(rows), 5);
  let best = { columnIndex: -1, score: 0 };
  for (let columnIndex = 0; columnIndex < maxColumnCount; columnIndex += 1) {
    let numericCount = 0;
    let checkedCount = 0;
    for (let rowIndex = headerRowIndex + 1; rowIndex < rows.length && checkedCount < 80; rowIndex += 1) {
      const value = String((rows[rowIndex] || [])[columnIndex] || "").trim();
      if (!value) continue;
      checkedCount += 1;
      if (/^\d+$/.test(value)) numericCount += 1;
    }
    const score = checkedCount ? numericCount / checkedCount : 0;
    if (checkedCount >= 3 && score > best.score) best = { columnIndex, score };
  }
  return best.score >= 0.8 ? best.columnIndex : -1;
}

function buildImportSummary(columns, selected) {
  const skippedRows = Math.max(0, selected.rowCount - selected.videoUrlRowCount);
  return {
    selectedColumnLabel: formatColumnLabel(selected),
    selectedVideoUrlCount: selected.videoUrlCount,
    skippedRows,
    shortLinkCount: columns.reduce((total, column) => total + column.shortLinkCount, 0),
    assetLinkCount: columns.reduce((total, column) => total + column.assetLinkCount, 0),
  };
}

function shouldReportColumn(column) {
  return column.httpCount > 0 || column.videoUrlCount > 0 || column.shortLinkCount > 0 || column.assetLinkCount > 0 || scoreHeader(column.header) > 0;
}

function buildNoVideoLinkError(columns) {
  const shortLinkCount = columns.reduce((total, column) => total + column.shortLinkCount, 0);
  const assetLinkCount = columns.reduce((total, column) => total + column.assetLinkCount, 0);
  const suffix = [];
  if (assetLinkCount) suffix.push(`发现 ${assetLinkCount} 个素材/下载链接`);
  if (shortLinkCount) suffix.push(`发现 ${shortLinkCount} 个不支持的第三方短链`);
  return `未找到包含 weixin.qq.com/sph、channels.weixin.qq.com、toutiao.com、douyin.com 或 xiaohongshu.com 的支持链接列${suffix.length ? `（${suffix.join("，")}）` : ""}`;
}

function formatColumnLabel(column) {
  const header = column.header || "无表头";
  return `${columnIndexToName(column.columnIndex)}列「${header}」`;
}

function columnIndexToName(index) {
  let name = "";
  let current = index + 1;
  while (current > 0) {
    const remainder = (current - 1) % 26;
    name = String.fromCharCode(65 + remainder) + name;
    current = Math.floor((current - 1) / 26);
  }
  return name;
}

function hasCellValue(row) {
  return (row || []).some((value) => String(value || "").trim());
}

function extractHttpUrls(value) {
  if (value == null) return [];
  const text = String(value).trim();
  const urls = [];
  const seen = new Set();
  HTTP_URL_PATTERN.lastIndex = 0;
  for (const match of text.matchAll(HTTP_URL_PATTERN)) {
    const url = cleanUrl(match[0]);
    if (!seen.has(url)) {
      urls.push(url);
      seen.add(url);
    }
  }
  return urls;
}

function extractCandidateUrls(value) {
  const urls = [];
  const seen = new Set();
  extractHttpUrls(value).concat(extractVideoUrls(value)).forEach((url) => {
    if (!seen.has(url)) {
      urls.push(url);
      seen.add(url);
    }
  });
  return urls;
}

function isShortLink(url) {
  return SHORT_LINK_PATTERN.test(url);
}

function isAssetLink(url) {
  return ASSET_LINK_PATTERN.test(url);
}

function extractVideoUrls(value) {
  if (value == null) return [];
  const text = String(value).trim();
  const urls = [];
  const seen = new Set();
  VIDEO_URL_PATTERNS.forEach((pattern) => {
    pattern.lastIndex = 0;
    for (const match of text.matchAll(pattern)) {
      const url = cleanUrl(match[0].replace(/^[\s"'<>，。；;、]+/, ""));
      if (!seen.has(url)) {
        urls.push(url);
        seen.add(url);
      }
    }
  });
  return urls;
}

function cleanUrl(url) {
  const text = String(url || "").trim().replace(TRAILING_PUNCTUATION, "");
  return repairUrl(text);
}

function repairUrl(url) {
  const text = String(url || "")
    .replace(/^ttps:\/\//i, "https://")
    .replace(/^tps:\/\//i, "https://")
    .replace(/^ps:\/\//i, "https://")
    .replace(/^ttp:\/\//i, "http://")
    .replace(/^https:\/([^/])/i, "https://$1")
    .replace(/^http:\/([^/])/i, "http://$1")
    .replace(/^https\/\//i, "https://")
    .replace(/^http\/\//i, "http://");
  if (/^(?:v\.douyin\.com|www\.douyin\.com|douyin\.com|www\.xiaohongshu\.com|xiaohongshu\.com|xhslink\.com)\//i.test(text)) return `https://${text}`;
  return text
    .replace(/^https:\/\/douyin\.com\//i, "https://www.douyin.com/")
    .replace(/^https:\/\/xiaohongshu\.com\//i, "https://www.xiaohongshu.com/");
}

function isVideoUrl(url) {
  return Boolean(getUrlPlatform(url));
}

function getUrlPlatform(url) {
  try {
    const parsed = new URL(url);
    const host = parsed.hostname.toLowerCase();
    const path = parsed.pathname.toLowerCase();
    if ((host === "weixin.qq.com" && path.startsWith("/sph/")) || host === "channels.weixin.qq.com") return "weixin";
    if ((host === "m.toutiao.com" && path.startsWith("/is/")) || ((host === "toutiao.com" || host === "www.toutiao.com") && ["/article/", "/w/", "/video/"].some((prefix) => path.startsWith(prefix)))) return "toutiao";
    if (host === "v.douyin.com" || ((host === "douyin.com" || host === "www.douyin.com") && ["/video/", "/note/"].some((prefix) => path.startsWith(prefix)))) return "douyin";
    if (host === "xhslink.com" || ((host === "xiaohongshu.com" || host === "www.xiaohongshu.com") && ["/explore/", "/discovery/item/"].some((prefix) => path.startsWith(prefix)))) return "xiaohongshu";
    return "";
  } catch {
    return "";
  }
}

function getPlatformLabel(platform) {
  return PLATFORM_LABELS[platform] || "支持平台";
}

function sanitizeFilenamePart(value, fallback) {
  let text = value == null ? "" : String(value).trim();
  text = text.replace(ILLEGAL_FILENAME_CHARS, "").replace(/\s+/g, "_").replace(/^[._ ]+|[._ ]+$/g, "");
  return (text || fallback).slice(0, 80);
}

function buildUniqueFileName(baseName, usedNames) {
  let candidate = `${baseName}.png`;
  let counter = 2;
  while (usedNames.has(candidate)) {
    candidate = `${baseName}_${counter}.png`;
    counter += 1;
  }
  usedNames.add(candidate);
  return candidate;
}

function getCurrentCaptureMode() {
  return elements.captureModeInput.value === "supplement" ? "supplement" : "full";
}

function getTasksForCurrentCaptureMode(tasks) {
  if (getCurrentCaptureMode() !== "supplement") return tasks;
  if (!currentSupplementSource) return [];
  return filterSupplementMissingTasks(tasks, currentSupplementSource.entries);
}

function filterSupplementMissingTasks(tasks, entries) {
  const existingNames = new Set((entries || []).map((entry) => normalizeSupplementFileName(entry.fileName || entry.name)));
  return (tasks || []).filter((task) => !existingNames.has(normalizeSupplementFileName(task.fileName)));
}

function collectSupplementImageEntries(files) {
  const collator = new Intl.Collator("zh-CN", { numeric: true, sensitivity: "base" });
  return Array.from(files || [])
    .map((file) => {
      const name = file.webkitRelativePath || file.name;
      const fileName = getBaseFileName(name);
      return {
        name,
        fileName,
        sequenceKey: deriveSequenceKey(fileName),
        file,
        size: file.size,
      };
    })
    .filter((entry) => entry.fileName && !entry.fileName.startsWith(".") && SUPPLEMENT_IMAGE_PATTERN.test(entry.fileName))
    .sort((left, right) => collator.compare(left.fileName, right.fileName));
}

function buildSupplementSourceInfo() {
  if (!currentSupplementSource) return "精准补充模式会按完整文件名找缺失截图。";
  const missingCount = currentSupplementSource && allParsedTasks.length ? getTasksForCurrentCaptureMode(allParsedTasks).length : 0;
  const missingText = allParsedTasks.length ? `，缺失 ${missingCount}/${allParsedTasks.length} 条` : "";
  return `${currentSupplementSource.name}，已有 ${currentSupplementSource.imageCount} 张图片，原图 ${formatBytesForSupplement(currentSupplementSource.totalBytes)}${missingText}`;
}

async function uploadSupplementRepairSource() {
  if (!currentSupplementSource || !currentSupplementSource.entries.length) throw new Error("没有可用于合成修复版 ZIP 的原截图");
  const port = chrome.runtime.connect({ name: "supplement-upload" });
  const send = createPortRequester(port);
  let uploadId = "";
  try {
    const started = await send({ type: "START_UPLOAD", sourceName: currentSupplementSource.name });
    uploadId = started.id;
    for (const entry of currentSupplementSource.entries) {
      const bytes = new Uint8Array(await entry.file.arrayBuffer());
      const dataBase64 = bytesToBase64(bytes);
      await send({ type: "FILE_START", uploadId, name: entry.fileName, sequenceKey: entry.sequenceKey });
      const chunkSize = 512 * 1024;
      for (let offset = 0; offset < dataBase64.length; offset += chunkSize) {
        await send({ type: "CHUNK", uploadId, data: dataBase64.slice(offset, offset + chunkSize) });
      }
      await send({ type: "FILE_DONE", uploadId });
    }
    const done = await send({ type: "DONE", uploadId });
    port.disconnect();
    return done.id || uploadId;
  } catch (error) {
    if (uploadId) {
      try {
        await send({ type: "CANCEL", uploadId });
      } catch {}
    }
    port.disconnect();
    throw error;
  }
}

function createPortRequester(port) {
  let requestId = 0;
  const pending = new Map();
  port.onMessage.addListener((message) => {
    const entry = pending.get(message.requestId);
    if (!entry) return;
    pending.delete(message.requestId);
    if (message.type === "ERROR") entry.reject(new Error(message.error || "上传失败"));
    else entry.resolve(message);
  });
  port.onDisconnect.addListener(() => {
    pending.forEach((entry) => entry.reject(new Error("精准补充原图上传中断")));
    pending.clear();
  });
  return (message) => new Promise((resolve, reject) => {
    const id = `${Date.now()}-${++requestId}`;
    pending.set(id, { resolve, reject });
    port.postMessage({ ...message, requestId: id });
  });
}

function updateStartButtonDisabled() {
  const running = currentState && (currentState.status === "running" || currentState.status === "paused" || currentState.status === "stopping" || currentState.status === "finalizing");
  elements.startButton.disabled = Boolean(running) || !parsedTasks.length || (getCurrentCaptureMode() === "supplement" && !currentSupplementSource) || isPreparingSupplementStart || isRefloEnriching || isExcelCorrecting;
}

function getBaseFileName(name) {
  return String(name || "").replace(/\\/g, "/").split("/").pop() || "";
}

function normalizeSupplementFileName(name) {
  return getBaseFileName(name).toLowerCase();
}

function deriveSequenceKey(name) {
  const match = /^(\d+(?:-\d+)?)(?=_|\.|$)/.exec(getBaseFileName(name));
  return match ? match[1] : "";
}

function bytesToBase64(bytes) {
  let binary = "";
  const chunkSize = 0x8000;
  for (let offset = 0; offset < bytes.length; offset += chunkSize) {
    binary += String.fromCharCode(...bytes.subarray(offset, offset + chunkSize));
  }
  return btoa(binary);
}

function formatBytesForSupplement(bytes) {
  const MB = 1024 * 1024;
  if (bytes >= MB) return `${Math.round(bytes / MB)} MB`;
  if (bytes >= 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${bytes} B`;
}

function syncCaptureSizeInputs() {
  const mode = elements.captureSizeModeInput.value;
  const preset = CAPTURE_SIZE_PRESETS[mode] || CAPTURE_SIZE_PRESETS.current;
  const custom = mode === "custom";
  elements.captureWidthInput.disabled = !custom;
  elements.captureHeightInput.disabled = !custom;
  if (!custom) {
    elements.captureWidthInput.value = preset.width;
    elements.captureHeightInput.value = preset.height;
  }
}

function getCaptureSizeOptions() {
  return {
    captureSizeMode: elements.captureSizeModeInput.value,
    captureWidth: clamp(parsePositiveInteger(elements.captureWidthInput.value, CAPTURE_SIZE_PRESETS.current.width), CUSTOM_CAPTURE_SIZE_LIMITS.minWidth, CUSTOM_CAPTURE_SIZE_LIMITS.maxWidth),
    captureHeight: clamp(parsePositiveInteger(elements.captureHeightInput.value, CAPTURE_SIZE_PRESETS.current.height), CUSTOM_CAPTURE_SIZE_LIMITS.minHeight, CUSTOM_CAPTURE_SIZE_LIMITS.maxHeight),
  };
}

function handleDouyinProxyRotationSettingsChange() {
  syncDouyinProxyRotationUi();
  saveDouyinProxyRotationSettings();
}

function syncDouyinProxyRotationUi(running = false) {
  const enabled = elements.douyinProxyRotationInput.checked;
  elements.douyinProxyRotationPanel.hidden = !enabled;
  elements.douyinProxyControllerInput.disabled = running || !enabled;
  elements.douyinProxyGroupInput.disabled = running || !enabled;
  elements.douyinProxySecretInput.disabled = running || !enabled;
  elements.douyinProxyNodeNamesInput.disabled = running || !enabled;
}

function getDouyinProxyRotationOptions() {
  const nodeNamesText = elements.douyinProxyNodeNamesInput.value.trim();
  return {
    enabled: elements.douyinProxyRotationInput.checked,
    controllerUrl: normalizeClashControllerUrl(elements.douyinProxyControllerInput.value),
    groupName: elements.douyinProxyGroupInput.value.trim() || CLASH_DEFAULT_GROUP_NAME,
    secret: elements.douyinProxySecretInput.value.trim(),
    nodeNamesText,
    nodeNames: parseProxyNodeNames(nodeNamesText),
    rotation: DOUYIN_PROXY_ROTATION_INTERVAL,
  };
}

async function loadDouyinProxyRotationSettings() {
  const settings = await readStorageValue(DOUYIN_PROXY_SETTINGS_KEY);
  if (settings && typeof settings === "object") {
    elements.douyinProxyRotationInput.checked = Boolean(settings.enabled);
    elements.douyinProxyControllerInput.value = settings.controllerUrl || CLASH_DEFAULT_CONTROLLER_URL;
    elements.douyinProxyGroupInput.value = settings.groupName || CLASH_DEFAULT_GROUP_NAME;
    elements.douyinProxySecretInput.value = settings.secret || "";
    elements.douyinProxyNodeNamesInput.value = settings.nodeNamesText || (Array.isArray(settings.nodeNames) ? settings.nodeNames.join(",") : DOUYIN_DEFAULT_PROXY_NODE_NAMES);
  }
  syncDouyinProxyRotationUi(currentState && (currentState.status === "running" || currentState.status === "paused" || currentState.status === "stopping" || currentState.status === "finalizing"));
}

function saveDouyinProxyRotationSettings() {
  writeStorageValue(DOUYIN_PROXY_SETTINGS_KEY, getDouyinProxyRotationOptions());
}

function normalizeClashControllerUrl(value) {
  const text = String(value || CLASH_DEFAULT_CONTROLLER_URL).trim() || CLASH_DEFAULT_CONTROLLER_URL;
  const withProtocol = /^https?:\/\//i.test(text) ? text : `http://${text}`;
  return withProtocol.replace(/\/+$/, "");
}

function parseProxyNodeNames(text) {
  const seen = new Set();
  return String(text || "")
    .split(/[\n,，]+/)
    .map((name) => name.trim())
    .filter((name) => {
      if (!name || seen.has(name)) return false;
      seen.add(name);
      return true;
    });
}

async function startRun() {
  if (!parsedTasks.length) return;
  const hasDouyinTask = parsedTasks.some((task) => task.platform === "douyin");
  const douyinTaskCount = parsedTasks.filter((task) => task.platform === "douyin").length;
  const nonDouyinTaskCount = parsedTasks.length - douyinTaskCount;
  const useDouyinIncognito = hasDouyinTask && elements.douyinWindowModeInput.value === "incognito";
  const douyinProxyRotation = getDouyinProxyRotationOptions();
  const douyinProxyNotice = hasDouyinTask && douyinProxyRotation.enabled ? `已启用 VPN IP 轮换，每 ${douyinProxyRotation.rotation} 条会同时尝试切换 Clash 策略组 ${douyinProxyRotation.groupName}。` : "";
  const douyinNotice = hasDouyinTask ? `抖音任务会单并发执行，并每 ${DOUYIN_BATCH_SIZE} 条重建截图窗口${nonDouyinTaskCount > 0 ? `；其他 ${nonDouyinTaskCount} 条非抖音任务按设置并发执行` : ""}。${douyinProxyNotice}` : "";
  const incognitoNotice = useDouyinIncognito ? "你已选择无痕窗口，请确认已在扩展详情中允许无痕运行，并已在无痕窗口登录抖音。" : "";
  const supplementNotice = getCurrentCaptureMode() === "supplement" ? "精准补充完成后会自动下载修复版 ZIP。" : "";
  const confirmLines = [
    "截图期间会创建专用 Chrome 窗口，并在每次截图前自动拉回前台。",
    "普通 Chrome 插件无法真正后台截图或锁定置顶，请不要关闭该窗口。",
    douyinNotice,
    incognitoNotice,
    supplementNotice,
    "是否继续？",
  ].filter(Boolean);
  const confirmed = window.confirm(confirmLines.join("\n\n"));
  if (!confirmed) return;
  let supplementRepairUploadId = "";
  saveRefloEnrichmentSettings();
  if (shouldUseReleaseInfoEnrichmentForStart()) {
    await enrichCurrentTasksWithReflo({ auto: true });
  }
  const options = {
    concurrency: clamp(parsePositiveInteger(elements.concurrencyInput.value, 2), 1, 8),
    delayMs: Math.max(500, Number(elements.delayInput.value || 0.8) * 1000),
    waitMs: Math.max(3000, Number(elements.waitInput.value || 12) * 1000),
    includeScreenshotWorkbook: elements.screenshotWorkbookInput.checked,
    autoGeneratePpt: elements.autoGeneratePptInput ? elements.autoGeneratePptInput.checked : true,
    autoPptMode: elements.pptModeInput.value,
    autoPptTitle: elements.pptReleaseTitleInput ? elements.pptReleaseTitleInput.value : "",
    enableSupplementRepairZip: getCurrentCaptureMode() === "supplement",
    douyinBatchSize: DOUYIN_BATCH_SIZE,
    douyinWindowMode: elements.douyinWindowModeInput.value,
    douyinProxyRotation,
    ...getCaptureSizeOptions(),
  };
  addLog(`自动 PPT：${options.autoGeneratePpt ? `已开启（${getCurrentPptMode().label}）` : "已关闭"}`);
  saveDouyinProxyRotationSettings();
  if (options.enableSupplementRepairZip) {
    try {
      isPreparingSupplementStart = true;
      updateStartButtonDisabled();
      addLog("正在准备精准补充修复版 ZIP 原图数据...");
      supplementRepairUploadId = await uploadSupplementRepairSource();
      addLog("精准补充原图数据已准备完成", "success");
    } catch (error) {
      addLog(`精准补充原图准备失败：${error.message}`, "failed");
      isPreparingSupplementStart = false;
      updateStartButtonDisabled();
      return;
    }
    isPreparingSupplementStart = false;
  }
  const response = await sendMessage({
    type: "START",
    tasks: parsedTasks,
    options,
    sourceRows: currentRows || [],
    sourceFileName: currentFileName,
    sourceHeaderRowIndex: currentImportAnalysis ? currentImportAnalysis.headerRowIndex : 0,
    supplementRepairUploadId,
  });
  if (!response || !response.ok) {
    addLog(response && response.error ? response.error : "启动失败", "failed");
    isPreparingSupplementStart = false;
    updateStartButtonDisabled();
    return;
  }
  const effectiveOptions = response.state && response.state.options ? response.state.options : options;
  addLog(`已启动：${parsedTasks.length} 条，并发 ${effectiveOptions.concurrency}`);
  await refreshState();
}

async function sendAction(action) {
  const response = await sendMessage({ type: action.toUpperCase() });
  if (!response || !response.ok) addLog(response && response.error ? response.error : `${action} 失败`, "failed");
  await refreshState();
}

async function refreshState() {
  const response = await sendMessage({ type: "GET_STATE" });
  if (!response || !response.ok) return;
  currentState = response.state;
  applyState(currentState);
}

function applyState(state) {
  const total = state.tasks.length || parsedTasks.length;
  const success = state.success || 0;
  const failed = state.failed || 0;
  const stopped = state.stopped || 0;
  const pending = Math.max(0, total - success - failed - stopped - (state.runningCount || 0));
  renderCounts({ total, success, failed, pending, stopped, running: state.runningCount || 0, status: state.status, autoPptGenerated: state.autoPptGenerated, autoPptInProgress: state.autoPptInProgress, autoPptFailed: state.autoPptFailed });
  if (state.status === "running") setBadge("运行中", "running");
  else if (state.status === "paused") setBadge("已暂停", "paused");
  else if (state.status === "stopping") setBadge("正在停止", "paused");
  else if (state.status === "finalizing") setBadge("收尾中", "running");
  else if (state.status === "done") setBadge("已完成", "done");
  else if (parsedTasks.length) setBadge("已就绪", "done");
  else setBadge("待导入", "");
  const running = state.status === "running" || state.status === "paused" || state.status === "stopping" || state.status === "finalizing";
  const pptBusy = isGeneratingPpt || isAutoGeneratingPpt;
  updateStartButtonDisabled();
  elements.pauseButton.disabled = state.status !== "running";
  elements.resumeButton.disabled = state.status !== "paused";
  elements.stopButton.disabled = state.status !== "running" && state.status !== "paused";
  elements.fileInput.disabled = running;
  elements.captureModeInput.disabled = running;
  elements.supplementFolderInput.disabled = running;
  elements.refloEnrichmentInput.disabled = running || isRefloEnriching || isExcelCorrecting;
  syncRefloEnrichmentUi(running);
  elements.pptModeInput.disabled = running || pptBusy;
  elements.pptZipInput.disabled = running || pptBusy;
  elements.pptFolderInput.disabled = running || pptBusy;
  elements.generatePptButton.disabled = running || pptBusy || !currentPptSource;
  elements.limitInput.disabled = running;
  elements.sequenceModeInput.disabled = running;
  elements.douyinWindowModeInput.disabled = running;
  elements.douyinProxyRotationInput.disabled = running;
  syncDouyinProxyRotationUi(running);
  elements.screenshotWorkbookInput.disabled = running;
  if (elements.autoGeneratePptInput) elements.autoGeneratePptInput.disabled = running;
  elements.captureSizeModeInput.disabled = running;
  elements.captureWidthInput.disabled = running || elements.captureSizeModeInput.value !== "custom";
  elements.captureHeightInput.disabled = running || elements.captureSizeModeInput.value !== "custom";
  renderLogs(state.logs || []);
  if (state.status === "done" && state.options && state.options.autoGeneratePpt && !state.autoPptGenerated && !state.autoPptInProgress && !state.autoPptFailed && !isAutoGeneratingPpt) {
    autoGeneratePptFromCompletedRun(state);
  }
}

async function receiveAutoPptSuccessScreenshots() {
  const response = await sendMessage({ type: "GET_SUCCESS_SCREENSHOT_RECORDS" });
  if (!response || !response.ok) throw new Error(response && response.error ? response.error : "无法读取成功截图记录");
  const records = response.screenshots || [];
  const screenshots = [];
  addLog(`正在从缓存读取本次成功截图：${records.length} 张`);
  for (const record of records) {
    const cached = await window.ScreenshotCache.getScreenshot(record.cacheKey);
    if (!cached || !cached.blob) throw new Error(`截图缓存缺失：${record.fileName || record.cacheKey}`);
    screenshots.push({
      fileName: record.fileName || cached.fileName || "截图.png",
      task: record.task || cached.task || null,
      file: new File([cached.blob], record.fileName || cached.fileName || "截图.png", { type: cached.blob.type || "image/png" }),
    });
    if (screenshots.length % 20 === 0) addLog(`已读取 ${screenshots.length} 张截图...`);
  }
  return { screenshots, sourceName: response.sourceName || "本次截图" };
}

async function autoGeneratePptFromCompletedRun(state) {
  let claimed = false;
  try {
    isAutoGeneratingPpt = true;
    const claim = await sendMessage({ type: "CLAIM_AUTO_PPT_GENERATION" });
    if (!claim || !claim.ok) {
      if (claim && claim.error && claim.error !== "自动 PPT 已生成" && claim.error !== "自动 PPT 正在生成中") addLog(`自动生成 PPT 未启动：${claim.error}`, "warning");
      return;
    }
    claimed = true;
    addLog("正在使用本次成功截图自动生成 PPT...");
    const screenshotsResponse = await receiveAutoPptSuccessScreenshots();
    const screenshots = screenshotsResponse.screenshots || [];
    if (!screenshots.length) {
      addLog("本次没有可用于生成 PPT 的成功截图", "warning");
      await sendMessage({ type: "MARK_AUTO_PPT_GENERATED" });
      return;
    }
    const files = screenshots.map((item) => item.file);
    const source = { type: "files", files, name: screenshotsResponse.sourceName || "本次截图" };
    const modeValue = state.options.autoPptMode || elements.pptModeInput.value;
    const mode = { value: modeValue, ...(PPT_MODES[modeValue] || PPT_MODES.clippings) };
    const tasks = screenshots.map((item) => item.task).filter(Boolean);
    const result = await buildPptByMode(source, mode.value, { tasks, title: state.options.autoPptTitle || "" });
    await window.PptxClippings.downloadResult(result);
    elements.pptZipInfo.textContent = buildPptResultInfo(mode, result);
    await sendMessage({ type: "MARK_AUTO_PPT_GENERATED", result: { fileName: result.fileName, imageCount: result.imageCount, slideCount: result.slideCount, mode: mode.value } });
    addLog(`${mode.label} PPT 已自动生成并触发下载：${result.imageCount} 张图片，${result.slideCount} 页，保存到 ${result.fileName}`, "success");
    await refreshState();
  } catch (error) {
    if (claimed) await sendMessage({ type: "MARK_AUTO_PPT_FAILED", error: error.message });
    addLog(`自动生成 PPT 失败：${error.message}`, "failed");
  } finally {
    isAutoGeneratingPpt = false;
  }
}

function renderImportDiagnostics(analysis) {
  const selected = analysis.selectedColumn;
  addLog(`链接列：${analysis.summary.selectedColumnLabel}，支持链接 ${selected.videoUrlCount}/${selected.nonEmptyCount || 0} 个`, "success");
  const reportColumns = analysis.columns
    .filter((column) => column.columnIndex !== selected.columnIndex && (column.httpCount > 0 || column.shortLinkCount > 0 || column.assetLinkCount > 0))
    .sort((left, right) => right.httpCount - left.httpCount || left.columnIndex - right.columnIndex)
    .slice(0, 6);
  reportColumns.forEach((column) => {
    const parts = [];
    if (column.videoUrlCount) parts.push(`${column.videoUrlCount} 个支持链接`);
    if (column.assetLinkCount) parts.push(`${column.assetLinkCount} 个素材/下载链接`);
    if (column.shortLinkCount) parts.push(`${column.shortLinkCount} 个短链`);
    if (column.otherLinkCount) parts.push(`${column.otherLinkCount} 个其他链接`);
    addLog(`未选 ${formatColumnLabel(column)}：${parts.join("，") || "无可处理链接"}`, column.videoUrlCount ? "warning" : "");
  });
  if (analysis.summary.shortLinkCount) addLog(`发现 ${analysis.summary.shortLinkCount} 个短链，按当前设置仅提示不处理`, "warning");
  if (analysis.summary.skippedRows) addLog(`跳过 ${analysis.summary.skippedRows} 行：选中列为空或不是支持链接`, "warning");
}

function renderCounts({ total, success, failed, pending, stopped = 0, running = 0, status = "", autoPptGenerated = false, autoPptInProgress = false, autoPptFailed = false }) {
  elements.totalCount.textContent = total;
  elements.successCount.textContent = success;
  elements.failedCount.textContent = failed;
  elements.pendingCount.textContent = pending;
  renderProgress({ total, success, failed, pending, stopped, running, status, autoPptGenerated, autoPptInProgress, autoPptFailed });
}

function renderProgress({ total, success, failed, pending, stopped, running, status, autoPptGenerated, autoPptInProgress, autoPptFailed }) {
  const completed = Math.min(total, success + failed + stopped);
  const percent = total > 0 ? Math.round((completed / total) * 100) : 0;
  if (elements.progressFill) elements.progressFill.style.width = `${percent}%`;
  if (elements.progressPercent) elements.progressPercent.textContent = `${percent}%`;
  if (!elements.progressText) return;
  if (!total) {
    elements.progressText.textContent = "导入任务表后显示进度";
  } else if (status === "running") {
    elements.progressText.textContent = `运行中：已完成 ${completed}/${total}，正在处理 ${running}，待处理 ${pending}`;
  } else if (status === "paused") {
    elements.progressText.textContent = `已暂停：已完成 ${completed}/${total}，待处理 ${pending}`;
  } else if (status === "stopping") {
    elements.progressText.textContent = `正在停止：已完成 ${completed}/${total}`;
  } else if (status === "finalizing") {
    elements.progressText.textContent = "截图已结束，正在导出结果或准备自动 PPT";
  } else if (status === "done" && autoPptInProgress) {
    elements.progressText.textContent = "截图已完成，正在生成自动 PPT";
  } else if (status === "done" && autoPptFailed) {
    elements.progressText.textContent = `截图已完成，自动 PPT 生成失败；成功 ${success}，失败 ${failed}`;
  } else if (status === "done" && autoPptGenerated) {
    elements.progressText.textContent = `全部完成：成功 ${success}，失败 ${failed}，自动 PPT 已触发下载`;
  } else if (status === "done") {
    elements.progressText.textContent = `全部完成：成功 ${success}，失败 ${failed}`;
  } else if (status === "stopped") {
    elements.progressText.textContent = `已停止：成功 ${success}，失败 ${failed}，停止 ${stopped}`;
  } else {
    elements.progressText.textContent = `已就绪：共 ${total} 条任务`;
  }
}

function renderPreview(tasks) {
  if (!tasks.length) {
    elements.previewList.className = "preview empty";
    elements.previewList.textContent = "暂无任务";
    return;
  }
  elements.previewList.className = "preview";
  elements.previewList.innerHTML = "";
  tasks.slice(0, 20).forEach((task) => {
    const row = document.createElement("div");
    row.className = "task-row";
    row.innerHTML = `<div class="task-name"></div><div class="task-url"></div>`;
    row.querySelector(".task-name").textContent = `${task.rowNumber} · ${task.platformLabel || getPlatformLabel(task.platform)} · ${task.fileName}`;
    row.querySelector(".task-url").textContent = task.url;
    elements.previewList.appendChild(row);
  });
  if (tasks.length > 20) {
    const more = document.createElement("div");
    more.className = "task-url";
    more.textContent = `还有 ${tasks.length - 20} 条未显示`;
    elements.previewList.appendChild(more);
  }
}

function renderLogs(logs) {
  elements.logList.innerHTML = "";
  logs.slice(-80).forEach((log) => {
    const row = document.createElement("div");
    row.className = `log-row ${log.level || ""}`;
    row.textContent = log.message;
    elements.logList.appendChild(row);
  });
  elements.copyLogButton.disabled = !logs.length;
  elements.logList.scrollTop = elements.logList.scrollHeight;
}

function addLog(message, level = "") {
  const row = document.createElement("div");
  row.className = `log-row ${level}`;
  row.textContent = message;
  elements.logList.appendChild(row);
  elements.copyLogButton.disabled = false;
  elements.logList.scrollTop = elements.logList.scrollHeight;
}

async function copyLogsToClipboard() {
  const text = Array.from(elements.logList.querySelectorAll(".log-row"))
    .map((row) => row.textContent.trim())
    .filter(Boolean)
    .join("\n");
  if (!text) {
    addLog("暂无可复制日志", "warning");
    return;
  }
  try {
    await navigator.clipboard.writeText(text);
    addLog("已复制运行日志到剪贴板", "success");
  } catch (error) {
    addLog(`复制日志失败：${error.message}`, "failed");
  }
}

function setBadge(text, className) {
  elements.statusBadge.textContent = text;
  elements.statusBadge.className = `badge ${className || ""}`.trim();
}

function parsePositiveInteger(value, fallback) {
  const number = Number.parseInt(value, 10);
  return Number.isFinite(number) && number > 0 ? number : fallback;
}

function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value));
}

function sendMessage(message) {
  return new Promise((resolve) => {
    chrome.runtime.sendMessage(message, (response) => {
      if (chrome.runtime.lastError) {
        resolve({ ok: false, error: chrome.runtime.lastError.message });
        return;
      }
      resolve(response);
    });
  });
}

function readStorageValue(key) {
  return new Promise((resolve) => {
    if (!chrome.storage || !chrome.storage.local) {
      resolve(null);
      return;
    }
    chrome.storage.local.get(key, (result) => {
      if (chrome.runtime.lastError) {
        resolve(null);
        return;
      }
      resolve(result ? result[key] : null);
    });
  });
}

function writeStorageValue(key, value) {
  if (!chrome.storage || !chrome.storage.local) return;
  chrome.storage.local.set({ [key]: value });
}
