const VIDEO_URL_PATTERNS = [
  /(?:https?|ttps?|tps|ps):\/\/weixin\.qq\.com\/sph\/[A-Za-z0-9_-]+/gi,
  /(?:https?|ttps?|tps|ps):\/\/channels\.weixin\.qq\.com\/[^\s"'<>，。；;、]+/gi,
  /(?:https?|ttps?|tps|ps):\/\/m\.toutiao\.com\/(?:is|video)\/[A-Za-z0-9_-]+\/?/gi,
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
const REFLO_CORRECTION_MEMORY_KEY = "refloReleaseInfoCorrectionMemory";
const REFLO_DEFAULT_API_URL = "https://reflo-dashboard.pinhaojian.com/api/v1/plugin/release-info/batch";
const REFLO_BATCH_SIZE = 50;
const REFLO_REQUEST_TIMEOUT_MS = 600000;
// Reflo 后端遇到上游异常会自行重试，期间网关可能瞬时返回 5xx/429 或连接中断；
// 这里在插件侧对后台标记为可重试（retryable）的错误做有限次指数退避重试，
// 避免把"Reflo 正在重试"误判为最终失败。共 1 次初始 + 3 次重试，退避 2s/4s/8s。
const REFLO_MAX_ATTEMPTS = 4;
const REFLO_RETRY_BASE_DELAY_MS = 2000;
const REFLO_RETRY_MAX_DELAY_MS = 15000;
const CLASH_DEFAULT_CONTROLLER_URL = "http://127.0.0.1:9090";
const CLASH_DEFAULT_GROUP_NAME = "Proxy";
const DOUYIN_DEFAULT_PROXY_NODE_NAMES = "🇭🇰 香港 IEPL 08,🇭🇰 香港 IEPL 12,🇨🇳 台湾 IEPL 01,🇸🇬 新加坡 IEPL 01,🇯🇵 日本 IEPL 01,🇰🇷 韩国 IEPL 01";
const PPT_MODES = {
  clippings: {
    label: "发布剪报多图铺页",
    info: "使用内置模板自动铺满发布剪报页；支持 ZIP 压缩包或截图文件夹，插件内生成建议 ≤5000 张、ZIP ≤2GB。",
  },
  "link-screenshot": {
    label: "链接截图单图单页",
    info: "使用内置链接截图模板，每张截图生成一页；优先匹配已导入任务的序号、昵称和链接，缺失时按截图文件名兜底。",
  },
  "release-info-screenshot": {
    label: "发布信息截图单图单页",
    info: "使用内置发布信息截图模板，每张截图生成一页；优先匹配已导入任务，并填充账号、平台、标题、链接和时间。",
  },
  dawanqu: {
    label: "大湾区崭新模版",
    info: "使用大湾区崭新模版，每张截图生成一页；保留模版自带大标题与截图占位图，并填充账号、平台、标题、链接和时间。",
  },
};
const SUPPLEMENT_IMAGE_PATTERN = /\.(?:png|jpe?g|webp)$/i;
const SUPPLEMENT_ZIP_SOURCE_LIMIT = 2 * 1024 * 1024 * 1024;

let allParsedTasks = [];
let parsedTasks = [];
let currentState = null;
let currentRows = null;
let currentFileName = "";
let currentImportAnalysis = null;
let currentImportIsMerged = false;
// 与 currentRows 行号对齐的「背景填充标记」：fillMarks[rowIndex]=true 表示该行有单元格颜色填充。
// 仅 xlsx 能解析到填充信息；CSV 或无填充信息时为 null（此时「只处理背景标记行」选项会被忽略）。
let currentImportFillMarks = null;
// 已导入的任务表文件（按上传顺序累积）：[{ fileName, rows, fillMarks }]
// 选择与拖拽都会追加到这里再统一合并，避免后一次导入覆盖前一次。
let importedTaskFiles = [];
let currentPptSource = null;
let currentPptFanSource = null;
// 未手动上传粉丝量截图时的兜底来源：从已导入 Excel 里模糊匹配到「粉丝」的列中提取内嵌截图，
// 已按「序号_昵称.ext」命名，可直接当作 fanImages 使用。手动上传的 currentPptFanSource 始终优先。
let currentExcelFanImages = [];
let currentPptTemplate = null;
let currentSupplementSource = null;
let pptSourceReadToken = 0;
let pptFanSourceReadToken = 0;
let isGeneratingPpt = false;
let isAutoGeneratingPpt = false;
let supplementSourceReadToken = 0;
let isPreparingSupplementStart = false;
let isRefloEnriching = false;
let isExcelCorrecting = false;

const elements = {
  fileInput: document.getElementById("fileInput"),
  fileInfo: document.getElementById("fileInfo"),
  clearFilesButton: document.getElementById("clearFilesButton"),
  captureModeInput: document.getElementById("captureModeInput"),
  supplementSourcePicker: document.getElementById("supplementSourcePicker"),
  supplementFolderInput: document.getElementById("supplementFolderInput"),
  supplementFolderInfo: document.getElementById("supplementFolderInfo"),
  refloEnrichmentInput: document.getElementById("refloEnrichmentInput"),
  refloEnrichmentPanel: document.getElementById("refloEnrichmentPanel"),
  refloApiUrlInput: document.getElementById("refloApiUrlInput"),
  refloApiTokenInput: document.getElementById("refloApiTokenInput"),
  playCountMinInput: document.getElementById("playCountMinInput"),
  playCountMaxInput: document.getElementById("playCountMaxInput"),
  refloEnrichmentInfo: document.getElementById("refloEnrichmentInfo"),
  excelCorrectionNoteInput: document.getElementById("excelCorrectionNoteInput"),
  excelDateIncludeTimeInput: document.getElementById("excelDateIncludeTimeInput"),
  excelOnlyMarkedRowsInput: document.getElementById("excelOnlyMarkedRowsInput"),
  enrichFollowerInput: document.getElementById("enrichFollowerInput"),
  excelCorrectionButton: document.getElementById("excelCorrectionButton"),
  excelFixButton: document.getElementById("excelFixButton"),
  excelCorrectionPreview: document.getElementById("excelCorrectionPreview"),
  pptModeInput: document.getElementById("pptModeInput"),
  pptTemplateSourceInput: document.getElementById("pptTemplateSourceInput"),
  pptTemplateUpload: document.getElementById("pptTemplateUpload"),
  pptTemplateInput: document.getElementById("pptTemplateInput"),
  pptTemplateInfo: document.getElementById("pptTemplateInfo"),
  pptReleaseTitleField: document.getElementById("pptReleaseTitleField"),
  pptReleaseTitleInput: document.getElementById("pptReleaseTitleInput"),
  pptZipInput: document.getElementById("pptZipInput"),
  pptFolderInput: document.getElementById("pptFolderInput"),
  pptFanSourcePicker: document.getElementById("pptFanSourcePicker"),
  pptFanZipInput: document.getElementById("pptFanZipInput"),
  pptFanFolderInput: document.getElementById("pptFanFolderInput"),
  pptFanSourceInfo: document.getElementById("pptFanSourceInfo"),
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
  if (elements.clearFilesButton) elements.clearFilesButton.addEventListener("click", clearImportedTaskFiles);
  elements.captureModeInput.addEventListener("change", handleCaptureModeChange);
  elements.supplementFolderInput.addEventListener("change", handleSupplementFolderChange);
  elements.refloEnrichmentInput.addEventListener("change", handleRefloSettingsChange);
  elements.excelCorrectionNoteInput.addEventListener("change", saveRefloEnrichmentSettings);
  elements.excelDateIncludeTimeInput.addEventListener("change", saveRefloEnrichmentSettings);
  elements.excelOnlyMarkedRowsInput.addEventListener("change", saveRefloEnrichmentSettings);
  elements.enrichFollowerInput.addEventListener("change", saveRefloEnrichmentSettings);
  elements.refloApiTokenInput.addEventListener("input", saveRefloEnrichmentSettings);
  elements.playCountMinInput.addEventListener("input", saveRefloEnrichmentSettings);
  elements.playCountMaxInput.addEventListener("input", saveRefloEnrichmentSettings);
  elements.excelCorrectionButton.addEventListener("click", runExcelCorrection);
  elements.excelFixButton.addEventListener("click", runExcelFix);
  elements.pptModeInput.addEventListener("change", handlePptModeChange);
  elements.pptTemplateSourceInput.addEventListener("change", handlePptTemplateSourceChange);
  elements.pptTemplateInput.addEventListener("change", handlePptTemplateChange);
  elements.pptZipInput.addEventListener("change", handlePptZipChange);
  elements.pptFolderInput.addEventListener("change", handlePptFolderChange);
  elements.pptFanZipInput.addEventListener("change", handlePptFanZipChange);
  elements.pptFanFolderInput.addEventListener("change", handlePptFanFolderChange);
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
    multiple: true,
    onDrop: (files) => handleTaskFiles(files),
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
  if (elements.pptFanZipInput) {
    setupUploadDropZone(elements.pptFanZipInput.closest(".ppt-source-action"), {
      input: elements.pptFanZipInput,
      multiple: false,
      onDrop: (files) => handlePptFanZipFile(files[0]),
    });
  }
  if (elements.pptFanFolderInput) {
    setupUploadDropZone(elements.pptFanFolderInput.closest(".ppt-source-action"), {
      input: elements.pptFanFolderInput,
      directory: true,
      onDrop: handlePptFanFolderFiles,
    });
  }
  setupUploadDropZone(elements.pptTemplateInput.closest(".ppt-source-action"), {
    input: elements.pptTemplateInput,
    multiple: false,
    onDrop: (files) => handlePptTemplateFile(files[0]),
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
  const files = Array.from((event.target && event.target.files) || []);
  await handleTaskFiles(files);
  // 允许再次选择同一文件触发 change，并避免原生 input 残留状态干扰累积逻辑。
  if (event.target) event.target.value = "";
}

async function handleTaskFiles(files) {
  const list = Array.from(files || []).filter((file) => file && file.name);
  if (!list.length) return;
  // 把本次选择/拖拽的文件追加到已导入列表，再整体重新解析合并。
  // 同名文件视为更新：用新文件替换旧的，位置保持原顺序。
  const incoming = [];
  for (const file of list) {
    let parsed;
    try {
      parsed = await parseInputFile(file);
    } catch (error) {
      addLog(`解析失败，已跳过「${file.name}」：${error.message}`, "failed");
      continue;
    }
    const fanImages = await extractFanImagesFromCellImages(parsed.rows, parsed.cellImages, file.name);
    incoming.push({ fileName: file.name, rows: parsed.rows, fillMarks: parsed.fillMarks, fanImages });
  }
  if (!incoming.length) {
    if (!importedTaskFiles.length) elements.fileInfo.textContent = "解析失败：没有可导入的有效表格";
    return;
  }
  for (const entry of incoming) {
    const existingIndex = importedTaskFiles.findIndex((item) => item.fileName === entry.fileName);
    if (existingIndex >= 0) {
      addLog(`已更新同名文件「${entry.fileName}」`, "warning");
      importedTaskFiles[existingIndex] = entry;
    } else {
      importedTaskFiles.push(entry);
    }
  }
  await applyImportedTaskFiles();
}

async function applyImportedTaskFiles() {
  if (!importedTaskFiles.length) {
    clearImportedTaskFiles();
    return;
  }
  try {
    setBadge("解析中", "running");
    currentExcelFanImages = importedTaskFiles.flatMap((file) => file.fanImages || []);
    if (currentExcelFanImages.length) {
      addLog(`已从 Excel 内嵌图片自动识别到 ${currentExcelFanImages.length} 张粉丝量截图，未手动上传时将按 Excel 序号+昵称自动匹配`, "success");
    }
    syncPptFanSourceInfo();
    if (importedTaskFiles.length === 1) {
      const only = importedTaskFiles[0];
      addLog(`开始解析：${only.fileName}`);
      currentRows = only.rows;
      currentFileName = only.fileName;
      currentImportIsMerged = false;
      currentImportFillMarks = Array.isArray(only.fillMarks) ? only.fillMarks : null;
      applyParsedRows(currentRows, currentFileName, { logDiagnostics: true, clearCorrectionMemory: true });
      renderImportedFilesInfo();
      return;
    }
    addLog(`开始合并解析 ${importedTaskFiles.length} 个文件：${importedTaskFiles.map((file) => file.fileName).join("、")}`);
    const merged = mergeParsedFiles(importedTaskFiles);
    currentRows = merged.rows;
    currentFileName = merged.fileName;
    currentImportIsMerged = true;
    currentImportFillMarks = Array.isArray(merged.fillMarks) ? merged.fillMarks : null;
    if (merged.realignedFiles.length) {
      addLog(`已按表头对齐合并：${merged.realignedFiles.join("、")} 的列顺序与首个文件不同，已自动对齐`, "warning");
    }
    if (merged.appendedHeaders.length) {
      addLog(`合并时新增列（取并集，保留数据）：${merged.appendedHeaders.join("、")}`, "warning");
    }
    addLog(`合并完成：共 ${importedTaskFiles.length} 个文件，${merged.dataRowCount} 条数据行，文件名取「${merged.fileName}」`, "success");
    applyParsedRows(currentRows, currentFileName, { logDiagnostics: true, clearCorrectionMemory: true });
    renderImportedFilesInfo();
  } catch (error) {
    resetImportState();
    importedTaskFiles = [];
    elements.fileInfo.textContent = `合并解析失败：${error.message}`;
    renderPreview([]);
    renderCounts({ total: 0, success: 0, failed: 0, pending: 0 });
    renderExcelCorrectionPreview(null);
    clearExcelCorrectionMemory();
    setBadge("解析失败", "");
    addLog(`合并解析失败：${error.message}`, "failed");
  }
}

function renderImportedFilesInfo() {
  updateClearFilesButton();
  if (importedTaskFiles.length <= 1) return;
  const names = importedTaskFiles.map((file, index) => `${index + 1}.${file.fileName}`).join("　");
  elements.fileInfo.textContent += `；已合并 ${importedTaskFiles.length} 个文件（${names}）。再次选择/拖拽将继续追加`;
}

function updateClearFilesButton() {
  if (!elements.clearFilesButton) return;
  elements.clearFilesButton.hidden = importedTaskFiles.length === 0;
}

function clearImportedTaskFiles() {
  importedTaskFiles = [];
  resetImportState();
  elements.fileInfo.textContent = "等待导入任务表。可一次选择多个表格，按上传顺序合并。只生成“发布剪报多图铺页”PPT 时，可跳过这一步。";
  renderPreview([]);
  renderCounts({ total: 0, success: 0, failed: 0, pending: 0 });
  renderExcelCorrectionPreview(null);
  clearExcelCorrectionMemory();
  setBadge("待导入", "");
  if (elements.fileInput) elements.fileInput.value = "";
  updateClearFilesButton();
}

function resetImportState() {
  allParsedTasks = [];
  parsedTasks = [];
  currentRows = null;
  currentFileName = "";
  currentImportAnalysis = null;
  currentImportIsMerged = false;
  currentImportFillMarks = null;
  currentExcelFanImages = [];
  syncPptFanSourceInfo();
  elements.startButton.disabled = true;
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
  syncPptFanSourceInfo();
  if (currentPptSource) {
    elements.pptZipInfo.textContent = buildPptSourceInfo(currentPptSource.name, currentPptSource.imageCount);
    return;
  }
  elements.pptZipInfo.textContent = getCurrentPptMode().info;
}

function syncPptModeUi() {
  const isReleaseInfoMode = elements.pptModeInput.value === "release-info-screenshot";
  const isCustomTemplate = elements.pptTemplateSourceInput.value === "custom" && Boolean(currentPptTemplate);
  const showFanSource = isReleaseInfoLikeMode(elements.pptModeInput.value);
  if (elements.pptFanSourcePicker) {
    elements.pptFanSourcePicker.hidden = !showFanSource;
    elements.pptFanSourcePicker.style.display = showFanSource ? "" : "none";
  }
  if (elements.pptFanSourceInfo) {
    elements.pptFanSourceInfo.hidden = !showFanSource;
    elements.pptFanSourceInfo.style.display = showFanSource ? "" : "none";
  }
  if (!showFanSource) {
    currentPptFanSource = null;
    // 让此刻仍在进行中的 ZIP/文件夹异步读取失效，避免它稍后 resolve 时把刚清空的
    // currentPptFanSource 又悄悄写回去（handlePptFanZipFile/handlePptFanFolderFiles
    // 的过期检查依赖这个 token 递增）。
    pptFanSourceReadToken += 1;
    if (elements.pptFanZipInput) elements.pptFanZipInput.value = "";
    if (elements.pptFanFolderInput) elements.pptFanFolderInput.value = "";
  }
  // With a custom template the title box is preserved from the template itself,
  // so the editable title field only applies to built-in templates.
  const showTitleField = isReleaseInfoMode && !isCustomTemplate;
  if (elements.pptReleaseTitleField) {
    elements.pptReleaseTitleField.hidden = !showTitleField;
    elements.pptReleaseTitleField.style.display = showTitleField ? "" : "none";
  }
  updateRefloEnrichmentInfo();
}

function handlePptTemplateSourceChange() {
  const isCustom = elements.pptTemplateSourceInput.value === "custom";
  if (elements.pptTemplateUpload) {
    elements.pptTemplateUpload.hidden = !isCustom;
    elements.pptTemplateUpload.style.display = isCustom ? "" : "none";
  }
  if (!isCustom) {
    currentPptTemplate = null;
    if (elements.pptTemplateInput) elements.pptTemplateInput.value = "";
  }
  // In custom mode the mode is auto-detected from the uploaded template.
  elements.pptModeInput.disabled = isCustom && Boolean(currentPptTemplate);
  syncPptModeUi();
  handlePptModeChange();
}

async function handlePptTemplateChange(event) {
  await handlePptTemplateFile(event.target.files && event.target.files[0]);
}

async function handlePptTemplateFile(file) {
  if (isGeneratingPpt) return;
  currentPptTemplate = null;
  elements.pptModeInput.disabled = false;
  if (!file) {
    elements.pptTemplateInfo.textContent = "上传 .pptx 模板后，插件会自动评估它与三种内置模式的匹配关系；发布信息类模板会保留顶部大标题和 logo，中间发布信息由插件按内置布局生成。";
    return;
  }
  try {
    elements.pptTemplateInfo.textContent = `正在评估模板：${file.name}`;
    addLog(`开始评估自定义 PPT 模板：${file.name}`);
    const analysis = await window.PptxClippings.analyzeTemplateFile(file);
    currentPptTemplate = { name: analysis.name, bytes: analysis.bytes, mode: analysis.mode, id: "" };
    // Persist the template bytes so the post-run auto-PPT generator (which runs in a
    // separate page / after the popup may have been closed) can reuse them. Failure to
    // persist is non-fatal: manual generation still works from the in-memory bytes.
    await persistCurrentPptTemplate();
    elements.pptModeInput.value = analysis.mode;
    elements.pptModeInput.disabled = true;
    const modeLabel = (PPT_MODES[analysis.mode] || PPT_MODES.clippings).label;
    elements.pptTemplateInfo.textContent = `已识别为「${modeLabel}」：${analysis.reason}（${analysis.slideCount} 页）`;
    addLog(`自定义模板评估完成：${modeLabel} — ${analysis.reason}`, "success");
    syncPptModeUi();
    if (currentPptSource) {
      elements.pptZipInfo.textContent = buildPptSourceInfo(currentPptSource.name, currentPptSource.imageCount);
    }
  } catch (error) {
    currentPptTemplate = null;
    elements.pptModeInput.disabled = false;
    elements.pptTemplateInfo.textContent = `模板评估失败：${error.message}`;
    addLog(`自定义 PPT 模板评估失败：${error.message}`, "failed");
  }
}

// Stores the current custom template bytes into the template IndexedDB cache and
// records the generated id on currentPptTemplate. Non-fatal on failure so that
// manual generation keeps working from the in-memory bytes.
async function persistCurrentPptTemplate() {
  if (!currentPptTemplate || !currentPptTemplate.bytes || !window.TemplateCache) return;
  try {
    await window.TemplateCache.cleanupOldTemplates();
    const id = await window.TemplateCache.putTemplate({
      name: currentPptTemplate.name,
      mode: currentPptTemplate.mode,
      bytes: currentPptTemplate.bytes,
    });
    currentPptTemplate.id = id;
  } catch (error) {
    currentPptTemplate.id = "";
    addLog(`自定义模板缓存失败，自动生成时将回退内置模板：${error.message}`, "warning");
  }
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

async function handlePptFanZipChange(event) {
  const file = event.target.files && event.target.files[0];
  await handlePptFanZipFile(file);
}

async function handlePptFanZipFile(file) {
  if (isGeneratingPpt) return;
  const readToken = ++pptFanSourceReadToken;
  currentPptFanSource = null;
  if (!file) {
    syncPptFanSourceInfo();
    return;
  }
  try {
    if (!/\.zip$/i.test(file.name)) throw new Error("请选择 .zip 压缩包");
    elements.pptFanSourceInfo.textContent = `正在读取粉丝量截图：${file.name}`;
    addLog(`开始读取粉丝量截图压缩包：${file.name}`);
    const analysis = await window.PptxClippings.inspectZipFile(file);
    if (readToken !== pptFanSourceReadToken) return;
    if (!analysis.imageCount) throw new Error("压缩包中没有找到 png、jpg、jpeg 或 webp 图片");
    currentPptFanSource = { type: "zip", name: file.name, file, imageCount: analysis.imageCount };
    if (elements.pptFanFolderInput) elements.pptFanFolderInput.value = "";
    syncPptFanSourceInfo();
    addLog(`粉丝量截图压缩包读取完成：${analysis.imageCount} 张图片`, "success");
  } catch (error) {
    if (readToken !== pptFanSourceReadToken) return;
    currentPptFanSource = null;
    elements.pptFanSourceInfo.textContent = `读取失败：${error.message}`;
    addLog(`粉丝量截图压缩包读取失败：${error.message}`, "failed");
  }
}

async function handlePptFanFolderChange(event) {
  await handlePptFanFolderFiles(Array.from(event.target.files || []));
}

async function handlePptFanFolderFiles(files) {
  if (isGeneratingPpt) return;
  const readToken = ++pptFanSourceReadToken;
  currentPptFanSource = null;
  if (!files.length) {
    syncPptFanSourceInfo();
    return;
  }
  const folderName = getPptFolderName(files);
  try {
    elements.pptFanSourceInfo.textContent = `正在读取粉丝量截图：${folderName}`;
    addLog(`开始读取粉丝量截图文件夹：${folderName}`);
    const analysis = await window.PptxClippings.inspectImageFiles(files);
    if (readToken !== pptFanSourceReadToken) return;
    if (!analysis.imageCount) throw new Error("文件夹中没有找到 png、jpg、jpeg 或 webp 图片");
    currentPptFanSource = { type: "folder", name: folderName, files, imageCount: analysis.imageCount };
    if (elements.pptFanZipInput) elements.pptFanZipInput.value = "";
    syncPptFanSourceInfo();
    addLog(`粉丝量截图文件夹读取完成：${analysis.imageCount} 张图片`, "success");
  } catch (error) {
    if (readToken !== pptFanSourceReadToken) return;
    currentPptFanSource = null;
    elements.pptFanSourceInfo.textContent = `读取失败：${error.message}`;
    addLog(`粉丝量截图文件夹读取失败：${error.message}`, "failed");
  }
}

function syncPptFanSourceInfo() {
  if (!elements.pptFanSourceInfo || !isReleaseInfoLikeMode(elements.pptModeInput.value)) return;
  if (currentPptFanSource) {
    elements.pptFanSourceInfo.textContent = `${currentPptFanSource.name}，识别到 ${currentPptFanSource.imageCount} 张粉丝量截图，将按 Excel 序号+昵称精确匹配`;
    return;
  }
  if (currentExcelFanImages.length) {
    elements.pptFanSourceInfo.textContent = `未手动上传，已从 Excel 内嵌图片自动识别到 ${currentExcelFanImages.length} 张粉丝量截图，将按 Excel 序号+昵称精确匹配（手动上传可覆盖）`;
    return;
  }
  elements.pptFanSourceInfo.textContent = "粉丝量截图按 Excel 序号+昵称命名（如 1_车源凯.png）；勾选自动 PPT 时需在开始截图前选好。若 Excel 表格里已内嵌粉丝量截图（列名含“粉丝”），无需上传即可自动识别。";
}

// 从某个已解析 Excel 文件的 cellImages（parseXlsx 提取出的 {row, col, bytes, ext}）中，
// 挑出实际内嵌了截图、且表头模糊匹配「粉丝」的那一列，按该行 buildTasks 会生成的
// 序号+昵称生成与手动上传文件夹同名规则一致的 fanImages 条目（如「1_车源凯.png」），
// 供 resolveFanImagesForPpt 在用户未手动上传时兜底使用。
//
// 这里刻意直接调用 buildTasks（而不是自己重新猜一遍序号规则）：当 Excel 没有显式的
// 序号/编号列时，任务的 importSequence 是由 buildTasks 内部按「有效任务行」顺序自动编号的，
// 只有 buildTasks 自己的计算结果才是权威值——重新实现一遍容易在这类无序号列的表格上和
// 真正的任务对不上号，导致粉丝量截图永远匹配不到任何一页。
async function extractFanImagesFromCellImages(rows, cellImages, fileName = "") {
  if (!Array.isArray(cellImages) || !cellImages.length || !Array.isArray(rows)) return [];
  const headerRowIndex = findLikelyHeaderRowIndex(rows);
  const headerRow = rows[headerRowIndex] || [];
  const fanColumnIndex = resolveFanColumnIndex(headerRow, cellImages);
  if (fanColumnIndex < 0) return [];
  const sequenceMode = elements.sequenceModeInput ? elements.sequenceModeInput.value : "sequence";
  const { tasks: rowTasks } = buildTasks(rows, null, sequenceMode);
  const taskByRow = new Map();
  rowTasks.forEach((task) => {
    if (!taskByRow.has(task.rowNumber - 1)) taskByRow.set(task.rowNumber - 1, task);
  });
  const usedNames = new Set();
  const images = [];
  for (const cellImage of cellImages) {
    if (cellImage.col !== fanColumnIndex || cellImage.row <= headerRowIndex) continue;
    const task = taskByRow.get(cellImage.row);
    if (!task || !task.nickname) continue; // 该行没有生成有效任务（如链接缺失），无法与任务精确匹配。
    const baseName = `${task.importSequence}_${task.nickname}`;
    let name = `${baseName}.${cellImage.ext}`;
    let counter = 2;
    while (usedNames.has(name)) {
      // 去重后缀必须加在序号段而非昵称段：pptx-builder.js 的 parseAuxImageKey 按第一个下划线
      // 切分「序号_昵称」，若把 _2 加在昵称后面会被解析成「昵称_2」，导致这张图再也匹配不到任何任务。
      // 加在序号段虽然（对真正序号+昵称完全重复的行）也无法保证匹配到正确的那一页——
      // 这种情况本身就是 (序号,昵称) 匹配方案的固有局限——但至少不会破坏昵称、便于人工排查。
      name = `${task.importSequence}-${counter}_${task.nickname}.${cellImage.ext}`;
      counter += 1;
    }
    usedNames.add(name);
    try {
      images.push(await window.PptxClippings.normalizeImage(name, cellImage.bytes));
    } catch (error) {
      addLog(`解析「${fileName}」内嵌粉丝量截图失败（${task.nickname}）：${error.message}`, "warning");
    }
  }
  return images;
}

// 表头模糊匹配「粉丝」的列可能不止一个（如同时有人工填写的「粉丝数」和 WPS 内嵌截图的
// 「粉丝量截图」两列），此时优先选真正承载内嵌图片的那一列，而不是简单取第一个文本匹配列。
function resolveFanColumnIndex(headerRow, cellImages) {
  const candidateCols = [];
  for (let col = 0; col < getMaxColumnCount([headerRow]); col += 1) {
    if (normalizeHeader(headerRow[col]).includes("粉丝")) candidateCols.push(col);
  }
  if (!candidateCols.length) return -1;
  if (candidateCols.length === 1) return candidateCols[0];
  const imageColCounts = new Map();
  cellImages.forEach((image) => {
    if (candidateCols.includes(image.col)) imageColCounts.set(image.col, (imageColCounts.get(image.col) || 0) + 1);
  });
  if (!imageColCounts.size) return candidateCols[0];
  return Array.from(imageColCounts.entries()).sort((a, b) => b[1] - a[1])[0][0];
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
    if (elements.pptFanZipInput) elements.pptFanZipInput.disabled = true;
    if (elements.pptFanFolderInput) elements.pptFanFolderInput.disabled = true;
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
    if (elements.pptFanZipInput) elements.pptFanZipInput.disabled = Boolean(running);
    if (elements.pptFanFolderInput) elements.pptFanFolderInput.disabled = Boolean(running);
    elements.pptModeInput.disabled = Boolean(running) || isPptModeLockedByTemplate();
    if (elements.pptTemplateSourceInput) elements.pptTemplateSourceInput.disabled = Boolean(running);
    if (elements.pptTemplateInput) elements.pptTemplateInput.disabled = Boolean(running);
    if (elements.pptReleaseTitleInput) elements.pptReleaseTitleInput.disabled = Boolean(running);
    elements.generatePptButton.disabled = Boolean(running) || !currentPptSource;
    elements.generatePptButton.textContent = "生成并下载 PPT";
  }
}

function isPptModeLockedByTemplate() {
  return elements.pptTemplateSourceInput.value === "custom" && Boolean(currentPptTemplate);
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
    && isReleaseInfoLikeMode(elements.pptModeInput.value)
  );
}

function shouldEnrichReleaseInfoForManualPpt(modeValue) {
  return Boolean(elements.refloEnrichmentInput.checked && isReleaseInfoLikeMode(modeValue));
}

// Modes that fill the 发布账号/平台/标题/链接/时间 info fields and therefore
// benefit from Reflo enrichment and per-task matching.
function isReleaseInfoLikeMode(modeValue) {
  return modeValue === "release-info-screenshot" || modeValue === "dawanqu";
}

async function buildPptByMode(source, modeValue, options = {}) {
  const matchingTasks = options.tasks || (allParsedTasks.length ? allParsedTasks : parsedTasks);
  const templateBytes = options.templateBytes || (currentPptTemplate && currentPptTemplate.bytes) || undefined;
  const fanImages = await resolveFanImagesForPpt(options);
  const pptOptions = { templateBytes, fanImages };
  if (modeValue === "link-screenshot") {
    return source.type === "zip"
      ? window.PptxClippings.buildLinkScreenshotFromZipFile(source.file, matchingTasks, { templateBytes })
      : window.PptxClippings.buildLinkScreenshotFromImageFiles(source.files, source.name, matchingTasks, { templateBytes });
  }
  if (modeValue === "release-info-screenshot") {
    const title = options.title != null ? options.title : elements.pptReleaseTitleInput ? elements.pptReleaseTitleInput.value : "";
    return source.type === "zip"
      ? window.PptxClippings.buildReleaseInfoScreenshotFromZipFile(source.file, matchingTasks, { title, ...pptOptions })
      : window.PptxClippings.buildReleaseInfoScreenshotFromImageFiles(source.files, source.name, matchingTasks, { title, ...pptOptions });
  }
  if (modeValue === "dawanqu") {
    const title = options.title != null ? options.title : elements.pptReleaseTitleInput ? elements.pptReleaseTitleInput.value : "";
    return source.type === "zip"
      ? window.PptxClippings.buildDawanquFromZipFile(source.file, matchingTasks, { title, ...pptOptions })
      : window.PptxClippings.buildDawanquFromImageFiles(source.files, source.name, matchingTasks, { title, ...pptOptions });
  }
  return source.type === "zip"
    ? window.PptxClippings.buildFromZipFile(source.file, { templateBytes })
    : window.PptxClippings.buildFromImageFiles(source.files, source.name, { templateBytes });
}

async function resolveFanImagesForPpt(options = {}) {
  if (Array.isArray(options.fanImages)) return options.fanImages;
  if (options.autoPptFanSourceId && window.FanSourceCache) {
    try {
      const record = await window.FanSourceCache.getFanSource(options.autoPptFanSourceId);
      if (record) return await window.PptxClippings.loadImagesFromCacheRecord(record);
    } catch (error) {
      addLog(`读取粉丝量截图缓存失败，尝试改用当前弹窗内仍保留的来源：${error.message}`, "warning");
    }
    // 缓存读取失败/记录缺失（如 IndexedDB 异常）时，若弹窗仍开着、本次生成用的来源其实还在
    // 内存里，就不要直接放弃——继续往下走手动来源/Excel 内嵌截图的兜底逻辑。
  }
  if (!isReleaseInfoLikeMode(options.modeValue || elements.pptModeInput.value)) return [];
  const fanSource = options.fanSource || currentPptFanSource;
  if (fanSource) {
    try {
      return await window.PptxClippings.loadImagesFromPptSource(fanSource);
    } catch (error) {
      addLog(`读取粉丝量截图来源失败：${error.message}`, "warning");
      return [];
    }
  }
  // 用户未手动上传粉丝量截图来源时，兜底使用从 Excel 内嵌图片自动识别到的截图。
  return currentExcelFanImages;
}

async function persistFanSourceForAutoPpt() {
  if (!window.FanSourceCache) return "";
  await window.FanSourceCache.cleanupOldFanSources();
  const files = [];
  if (currentPptFanSource && currentPptFanSource.type === "zip") {
    const images = await window.PptxClippings.loadImagesFromPptSource(currentPptFanSource);
    images.forEach((image) => {
      files.push({
        fileName: getBaseFileName(image.name),
        blob: new Blob([image.data], { type: image.mime || "image/png" }),
      });
    });
  } else if (currentPptFanSource) {
    // 过滤掉非图片文件（如 macOS Finder 打开过文件夹后留下的 .DS_Store）：
    // loadImagesFromCacheRecord 后续会对缓存里每个文件调用 normalizeImage 且没有单文件容错，
    // 混入一个无法解码的文件会导致该次读取把全部粉丝量截图一起丢弃。
    for (const file of currentPptFanSource.files || []) {
      const relativePath = file.webkitRelativePath || file.name;
      if (!window.PptxClippings.isImageZipEntry(relativePath)) continue;
      files.push({
        fileName: relativePath,
        blob: file,
      });
    }
  } else {
    // 未手动上传时，把从 Excel 内嵌图片自动识别到的截图缓存下来，
    // 使截图完成后的自动 PPT（含弹窗已关闭走 auto-ppt.html 的情形）也能按 autoPptFanSourceId 取到。
    currentExcelFanImages.forEach((image) => {
      files.push({
        fileName: getBaseFileName(image.name),
        blob: new Blob([image.data], { type: image.mime || "image/png" }),
      });
    });
  }
  if (!files.length) return "";
  return window.FanSourceCache.putFanSource({
    name: currentPptFanSource ? currentPptFanSource.name : "Excel 内嵌粉丝量截图",
    files,
  });
}

function shouldPersistFanSourceForAutoPpt(options) {
  return Boolean(
    options.autoGeneratePpt
    && isReleaseInfoLikeMode(options.autoPptMode || elements.pptModeInput.value)
    && (currentPptFanSource || currentExcelFanImages.length)
  );
}

function buildPptSourceInfo(name, imageCount) {
  const mode = getCurrentPptMode();
  const matchingTaskCount = allParsedTasks.length || parsedTasks.length;
  const taskText = (mode.value === "link-screenshot" || isReleaseInfoLikeMode(mode.value)) && matchingTaskCount ? `，将优先匹配 ${matchingTaskCount} 条已导入任务` : "";
  const fanCount = currentPptFanSource ? currentPptFanSource.imageCount : currentExcelFanImages.length;
  const fanText = isReleaseInfoLikeMode(mode.value) && fanCount ? `，粉丝量截图 ${fanCount} 张将按 Excel 序号+昵称匹配` : "";
  return `${name}，识别到 ${imageCount} 张图片，将生成${mode.label} PPT${taskText}${fanText}`;
}

function buildPptResultInfo(mode, result) {
  const fanText = result.fanMatchedCount ? `，其中 ${result.fanMatchedCount} 页含粉丝量截图` : "";
  if (mode.value === "link-screenshot") {
    return `已生成：${result.imageCount} 张图片，${result.slideCount} 页链接截图单图单页`;
  }
  if (mode.value === "release-info-screenshot") {
    return `已生成：${result.imageCount} 张图片，${result.slideCount} 页发布信息截图单图单页${fanText}`;
  }
  if (mode.value === "dawanqu") {
    return `已生成：${result.imageCount} 张图片，${result.slideCount} 页大湾区崭新模版${fanText}`;
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
  if (options.clearCorrectionMemory) {
    renderExcelCorrectionPreview(null);
    clearExcelCorrectionMemory();
  }
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
  elements.playCountMinInput.disabled = running || !enabled || isRefloEnriching;
  elements.playCountMaxInput.disabled = running || !enabled || isRefloEnriching;
  elements.excelCorrectionNoteInput.disabled = running || isExcelCorrecting || !enabled;
  elements.enrichFollowerInput.disabled = running || isExcelCorrecting || !enabled;
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
    elements.playCountMinInput.value = settings.playCountMin != null ? settings.playCountMin : "";
    elements.playCountMaxInput.value = settings.playCountMax != null ? settings.playCountMax : "";
    elements.excelCorrectionNoteInput.checked = settings.includeCorrectionNote !== false;
    elements.excelDateIncludeTimeInput.checked = Boolean(settings.excelDateIncludeTime);
    elements.excelOnlyMarkedRowsInput.checked = Boolean(settings.onlyMarkedRows);
    elements.enrichFollowerInput.checked = Boolean(settings.enrichFollower);
  }
  syncRefloEnrichmentUi(currentState && (currentState.status === "running" || currentState.status === "paused" || currentState.status === "stopping" || currentState.status === "finalizing"));
  loadExcelCorrectionMemory();
}

function saveRefloEnrichmentSettings() {
  writeStorageValue(REFLO_ENRICHMENT_SETTINGS_KEY, getRefloEnrichmentSettings());
}

function getRefloEnrichmentSettings() {
  return {
    enabled: elements.refloEnrichmentInput.checked,
    apiUrl: REFLO_DEFAULT_API_URL,
    token: normalizeRefloApiToken(elements.refloApiTokenInput.value),
    includeCorrectionNote: elements.excelCorrectionNoteInput.checked,
    excelDateIncludeTime: elements.excelDateIncludeTimeInput.checked,
    onlyMarkedRows: elements.excelOnlyMarkedRowsInput.checked,
    enrichFollower: elements.enrichFollowerInput.checked,
    playCountMin: parsePlayCountRangeValue(elements.playCountMinInput.value),
    playCountMax: parsePlayCountRangeValue(elements.playCountMaxInput.value),
    autoEnrich: true,
  };
}

function parsePlayCountRangeValue(value) {
  const text = String(value == null ? "" : value).trim();
  if (!text) return null;
  const number = Number(text);
  return Number.isFinite(number) && number >= 0 ? Math.round(number) : null;
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
  if (!isReleaseInfoLikeMode(elements.pptModeInput.value)) {
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
      const response = await fetchRefloReleaseInfoBatch(settings, batch, (attempt, maxAttempts, error, waitMs) => {
        addLog(`Reflo 第 ${index + 1}/${batches.length} 批请求失败（第 ${attempt} 次，${error}），${Math.round(waitMs / 1000)} 秒后自动重试（共 ${maxAttempts - 1} 次）`, "warning");
      });
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
    const runningReport = { status: "running", actionName, sourceFileName: currentFileName, message: applyFixes ? "正在修正 Excel..." : "正在校验 Excel..." };
    renderExcelCorrectionPreview(runningReport);
    await saveExcelCorrectionMemory(runningReport);
    addLog(`开始 Excel ${actionName}：检查链接、重复项并核对正确发布信息`);
    const report = await buildExcelCorrectionReport(settings, { applyFixes, includeCorrectionNote: settings.includeCorrectionNote, includeTime: settings.excelDateIncludeTime, onlyMarkedRows: settings.onlyMarkedRows });
    report.status = "done";
    report.actionName = actionName;
    report.sourceFileName = currentFileName;
    report.completedAt = Date.now();
    renderExcelCorrectionPreview(report);
    await saveExcelCorrectionMemory(report);
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
    const failedReport = { status: "failed", actionName, sourceFileName: currentFileName, completedAt: Date.now(), message: error.message };
    renderExcelCorrectionPreview(failedReport);
    await saveExcelCorrectionMemory(failedReport);
    addLog(`Excel ${actionName}失败：${error.message}`, "failed");
  } finally {
    isExcelCorrecting = false;
    syncRefloEnrichmentUi();
  }
}

async function buildExcelCorrectionReport(settings, options = {}) {
  const applyFixes = Boolean(options.applyFixes);
  const includeCorrectionNote = options.includeCorrectionNote !== false;
  const includeTime = Boolean(options.includeTime);
  const onlyMarkedRows = Boolean(options.onlyMarkedRows);
  const rows = cloneRowsForCorrection(currentRows);
  const analysis = { ...(currentImportAnalysis || analyzeImportRows(rows)) };
  const headerRowIndex = analysis.headerRowIndex;
  // 「只处理背景标记行」：仅当能解析到填充信息（xlsx）时生效；CSV 等无填充信息时忽略并提示。
  // fillMarks 与 currentRows 行号对齐，rows 是其克隆且行号不变，故可直接按 rowIndex 判定。
  const hasFillInfo = Array.isArray(currentImportFillMarks);
  const restrictToMarked = onlyMarkedRows && hasFillInfo;
  if (onlyMarkedRows && !hasFillInfo) addLog("当前文件无单元格填充信息（如 CSV），已忽略「只处理背景标记行」，按全部行处理", "warning");
  const shouldIncludeRow = restrictToMarked ? (rowIndex) => Boolean(currentImportFillMarks[rowIndex]) : null;
  // 多文件合并时，序号列重写为跨文件全局连续编号（1-200 + 201-400）；单文件保持原样不动。
  const renumberedCount = currentImportIsMerged ? renumberSequenceColumn(rows, analysis) : 0;
  if (renumberedCount > 0) addLog(`多文件合并：已将序号列重排为全局连续编号，共 ${renumberedCount} 行`, "success");
  if (applyFixes) ensureExcelFixColumns(rows, analysis);
  const rowReports = buildLocalCorrectionRows(rows, analysis, -1, shouldIncludeRow);
  if (restrictToMarked) addLog(`只处理背景标记行：命中 ${rowReports.length} 个有背景填充的记录行`, rowReports.length ? "success" : "warning");
  const refloMap = await fetchRefloCorrectionInfo(settings, rowReports.filter((row) => row.primaryUrl));
  rowReports.forEach((rowReport) => applyRefloCorrection(rowReport, refloMap, rows, analysis));
  // 账号重复用「正确账号」判定，须在 applyRefloCorrection 拿到 refloData 之后执行。
  detectDuplicateAccounts(rowReports, analysis);

  // 从 Reflo 返回的 anomaly 字段读取异常检测结果（后端已完成统计规则 + LLM 两层检测管道）
  let anomalyTotal = 0;
  let anomalyDetected = 0;
  rowReports.forEach((rowReport) => {
    if (!rowReport.refloData) return;
    anomalyTotal += 1;
    if (!rowReport.refloData.anomaly) return;
    if (!rowReport.refloData.anomaly.detected) return;
    anomalyDetected += 1;

    const anomaly = rowReport.refloData.anomaly;
    const preview =
      rowReport.refloData.title.length > 30
        ? rowReport.refloData.title.substring(0, 30) + "..."
        : rowReport.refloData.title;
    rowReport.issues.push({
      type: "title-anomaly",
      style: "orange",
      columnIndex: analysis.publishTitleIndex,
      message: `标题主题异常：「${preview}」- ${anomaly.reason}（AI 判断，置信度 ${Math.round(anomaly.confidence * 100)}%）`,
    });
  });
  if (anomalyTotal > 0) {
    addLog(`异常检测：${anomalyTotal} 条标题已由 Reflo 后端检测，其中 ${anomalyDetected} 条为异常`, anomalyDetected > 0 ? "warning" : "success");
  }

  // Add and populate metric columns
  if (settings.enabled) {
    ensureMetricColumns(rows, analysis, settings);
    populateMetricColumns(rows, analysis, rowReports);
    estimatePlayCountsForRange(rows, analysis, rowReports, settings);
  }

  // Calculate note column index AFTER adding metric columns
  const noteColumnIndex = includeCorrectionNote ? Math.max(1, getMaxColumnCount(rows)) : -1;

  const fixedCells = applyFixes ? applyExcelFixes(rowReports, rows) : 0;
  // 「精确到时分秒」开启时，先用 Reflo 的完整发布时间覆盖发布日期列（源序列号通常只有日期、没有时分秒，
  // 时分秒只能来自 Reflo），再做整列归一化。
  if (includeTime) applyRefloPublishTimeSeconds(rowReports, rows, analysis, applyFixes);
  // 发布日期整列统一归一化：源文件可能把日期存成 Excel 序列号(如 46171)、文本日期或已被修正的值，
  // 此前仅「修正」模式回填的行会被处理，未修正/纠错模式的行会原样导出序列号。这里对整列再做一次
  // 归一化，确保序列号源、文本源、已改/未改行、纠错/修正两种模式统统输出为一致日期，消除“46171”。
  normalizeExportPublishTimeColumn(rows, analysis, includeTime, shouldIncludeRow);
  const correctionNoteRows = includeCorrectionNote ? buildCorrectionNoteRows(rowReports, applyFixes) : [];
  const rowStyles = [];
  const cellStyles = [];
  const issueRows = [];
  rowReports.forEach((rowReport) => {
    const unresolvedIssues = getUnresolvedCorrectionIssues(rowReport);
    if (!unresolvedIssues.length) return;
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
    // Check for anomalous title (orange row style)
    const hasAnomalousTitle = rowReport.issues.some((issue) => issue.type === "title-anomaly");
    if (hasAnomalousTitle) {
      rowStyles.push({ rowIndex: rowReport.rowIndex, style: "orange" });
      return;
    }
    rowReport.issues.filter((issue) => issue.style === "yellow" && issue.columnIndex >= 0 && !issue.fixed).forEach((issue) => {
      cellStyles.push({ rowIndex: rowReport.rowIndex, columnIndex: issue.columnIndex, style: "yellow" });
    });
  });
  if (includeCorrectionNote && correctionNoteRows.length) writeCorrectionNotes(rows, headerRowIndex, noteColumnIndex, correctionNoteRows);
  const summary = {
    checkedRows: rowReports.length,
    issueRows: issueRows.length,
    invalidLinks: rowReports.filter((row) => row.hasInvalidLink).length,
    duplicateRows: rowReports.filter((row) => row.hasDuplicateLink).length,
    duplicateAccountCells: rowReports.reduce((total, row) => total + row.issues.filter((issue) => issue.style === "blue").length, 0),
    fieldMismatches: rowReports.reduce((total, row) => total + row.issues.filter((issue) => issue.style === "yellow").length, 0),
    anomalousTitleRows: rowReports.filter((row) => row.issues.some((issue) => issue.type === "title-anomaly")).length,
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

function getUnresolvedCorrectionIssues(rowReport) {
  return (rowReport.issues || []).filter((issue) => !issue.fixed);
}

function getCorrectionNoteIssues(rowReport, includeFixedIssues = false) {
  const issues = rowReport && Array.isArray(rowReport.issues) ? rowReport.issues : [];
  return includeFixedIssues ? issues : issues.filter((issue) => !issue.fixed);
}

function buildCorrectionNoteRows(rowReports, includeFixedIssues = false) {
  return (Array.isArray(rowReports) ? rowReports : []).map((rowReport) => ({
    rowReport,
    issues: getCorrectionNoteIssues(rowReport, includeFixedIssues),
  })).filter((entry) => entry.issues.length);
}

function writeCorrectionNotes(rows, headerRowIndex, noteColumnIndex, noteRows) {
  ensureCorrectionRow(rows, headerRowIndex);
  rows[headerRowIndex][noteColumnIndex] = "纠错说明";
  noteRows.forEach((entry) => {
    ensureCorrectionRow(rows, entry.rowReport.rowIndex);
    rows[entry.rowReport.rowIndex][noteColumnIndex] = buildCorrectionIssueExportText(entry.issues);
  });
}

function buildCorrectionIssueExportText(issues) {
  return (Array.isArray(issues) ? issues : []).map(getCorrectionIssueExportMessage).filter(Boolean).join("；");
}

function getCorrectionIssueExportMessage(issue) {
  if (!issue || issue.style !== "red") return issue && issue.message ? issue.message : "";
  return "链接失效";
}

function cloneRowsForCorrection(rows) {
  return (Array.isArray(rows) ? rows : []).map((row) => Array.isArray(row) ? row.map((value) => value == null ? "" : String(value)) : []);
}

function ensureCorrectionRow(rows, rowIndex) {
  while (rows.length <= rowIndex) rows.push([]);
}

function ensureExcelFixColumns(rows, analysis) {
  ensureExcelFixColumn(rows, analysis, "publishAccountIndex", "发布账号");
  ensureExcelFixColumn(rows, analysis, "publishTimeIndex", "发布日期");
  ensureExcelFixColumn(rows, analysis, "publishPlatformIndex", "发布平台");
  ensureExcelFixColumn(rows, analysis, "publishTitleIndex", "发布标题");
}

function ensureExcelFixColumn(rows, analysis, analysisKey, headerLabel) {
  if (analysis[analysisKey] >= 0) return;
  const columnIndex = findEmptyCorrectionColumnIndex(rows, analysis.headerRowIndex);
  ensureCorrectionRow(rows, analysis.headerRowIndex);
  rows[analysis.headerRowIndex][columnIndex] = headerLabel;
  analysis[analysisKey] = columnIndex;
}

function findEmptyCorrectionColumnIndex(rows, headerRowIndex) {
  const columnCount = Math.max(1, getMaxColumnCount(rows));
  for (let columnIndex = 0; columnIndex < columnCount; columnIndex += 1) {
    const hasValue = rows.some((row, rowIndex) => rowIndex >= headerRowIndex && normalizeTaskText((row || [])[columnIndex]));
    if (!hasValue) return columnIndex;
  }
  return columnCount;
}

function formatMetricForExcel(value) {
  if (value == null || value === "") return "";
  const number = Number(value);
  return Number.isFinite(number) && number >= 0 ? number : "";
}

function findMetricColumnInsertionIndex(rows, analysis) {
  // Find the rightmost publish column
  const publishIndices = [
    analysis.publishAccountIndex,
    analysis.publishPlatformIndex,
    analysis.publishTitleIndex,
    analysis.publishLinkIndex,
    analysis.publishTimeIndex
  ].filter(index => index >= 0);

  if (publishIndices.length === 0) {
    // No publish columns found, insert after link column
    return analysis.linkIndex + 1;
  }

  // Insert after the rightmost publish column
  return Math.max(...publishIndices) + 1;
}

function ensureMetricColumns(rows, analysis, settings) {
  if (!settings.enabled) return; // Only add if Reflo enrichment enabled

  // Find insertion point (after publish columns, before correction note)
  const insertionIndex = findMetricColumnInsertionIndex(rows, analysis);

  // Store indices in analysis object for later use
  analysis.playCountIndex = insertionIndex;
  analysis.diggCountIndex = insertionIndex + 1;
  analysis.commentCountIndex = insertionIndex + 2;
  analysis.collectCountIndex = insertionIndex + 3;
  analysis.shareCountIndex = insertionIndex + 4;

  // Add headers to header row
  ensureCorrectionRow(rows, analysis.headerRowIndex);
  rows[analysis.headerRowIndex][analysis.playCountIndex] = "播放量";
  rows[analysis.headerRowIndex][analysis.diggCountIndex] = "点赞数";
  rows[analysis.headerRowIndex][analysis.commentCountIndex] = "评论量";
  rows[analysis.headerRowIndex][analysis.collectCountIndex] = "收藏量";
  rows[analysis.headerRowIndex][analysis.shareCountIndex] = "分享数";

  if (settings.enrichFollower) {
    analysis.followerCountIndex = insertionIndex + 5;
    rows[analysis.headerRowIndex][analysis.followerCountIndex] = "粉丝数";
  }
}

function populateMetricColumns(rows, analysis, rowReports) {
  if (analysis.playCountIndex === undefined) return; // Columns not added

  rowReports.forEach((rowReport) => {
    if (!rowReport.refloData) return; // No Reflo data for this row

    const row = rows[rowReport.rowIndex] || [];
    ensureCorrectionRow(rows, rowReport.rowIndex);

    // All metrics from Reflo data
    row[analysis.playCountIndex] = formatMetricForExcel(rowReport.refloData.playCount);
    row[analysis.diggCountIndex] = formatMetricForExcel(rowReport.refloData.diggCount);
    row[analysis.commentCountIndex] = formatMetricForExcel(rowReport.refloData.commentCount);
    row[analysis.collectCountIndex] = formatMetricForExcel(rowReport.refloData.collectCount);
    row[analysis.shareCountIndex] = formatMetricForExcel(rowReport.refloData.shareCount);
    if (analysis.followerCountIndex !== undefined) {
      row[analysis.followerCountIndex] = formatMetricForExcel(rowReport.refloData.followerCount);
    }
  });
}

// 视频号 / 小红书 抓不到真实播放量：按 Reflo 返回的互动总量（点赞+评论+收藏+分享）
// 在用户给定的 [min, max] 区间内从高到低线性映射，互动最高取最大值，依次递减。
function estimatePlayCountsForRange(rows, analysis, rowReports, settings) {
  if (analysis.playCountIndex === undefined) return; // Columns not added
  const min = settings.playCountMin;
  const max = settings.playCountMax;
  if (min == null || max == null) return; // 范围留空则不估算
  const rangeMin = Math.min(min, max);
  const rangeMax = Math.max(min, max);

  const candidates = rowReports
    .filter((rowReport) => rowReport.refloData && isPlayCountEstimatePlatform(rowReport) && !hasRealPlayCount(rowReport.refloData))
    .map((rowReport) => ({ rowReport, engagement: getRefloEngagementSum(rowReport.refloData) }));
  if (!candidates.length) return;

  const engagements = candidates.map((entry) => entry.engagement);
  const minEngagement = Math.min(...engagements);
  const maxEngagement = Math.max(...engagements);
  const span = maxEngagement - minEngagement;

  candidates.forEach((entry) => {
    let estimated;
    if (span <= 0) {
      // 所有行互动相同：有互动时给最大值，全为 0 时给最小值
      estimated = maxEngagement > 0 ? rangeMax : rangeMin;
    } else {
      const ratio = (entry.engagement - minEngagement) / span;
      estimated = rangeMin + ratio * (rangeMax - rangeMin);
    }
    const value = Math.round(estimated);
    ensureCorrectionRow(rows, entry.rowReport.rowIndex);
    const row = rows[entry.rowReport.rowIndex];
    row[analysis.playCountIndex] = value;
  });
}

function isPlayCountEstimatePlatform(rowReport) {
  const platform = getUrlPlatform(rowReport.primaryUrl);
  if (platform === "weixin" || platform === "xiaohongshu") return true;
  // 兜底：链接无法解析时用 Reflo 返回的平台标签判断
  const label = rowReport.refloData ? rowReport.refloData.platform : "";
  return label === "视频号" || label === "小红书";
}

function getRefloEngagementSum(refloData) {
  if (!refloData) return 0;
  return ["diggCount", "commentCount", "collectCount", "shareCount"].reduce((total, key) => {
    const number = Number(refloData[key]);
    return total + (Number.isFinite(number) && number > 0 ? number : 0);
  }, 0);
}

function hasRealPlayCount(refloData) {
  if (!refloData) return false;
  const number = Number(refloData.playCount);
  return Number.isFinite(number) && number > 0;
}

// shouldIncludeRow 为可选谓词：返回 false 的行不参与纠错（用于「只处理背景标记行」），
// 未传时处理全部数据行。被跳过的行不进入 rowReports，因此不参与查重、回填、标色与纠错说明。
function buildLocalCorrectionRows(rows, analysis, noteColumnIndex, shouldIncludeRow = null) {
  const duplicateMap = new Map();
  const rowReports = [];
  for (let rowIndex = analysis.headerRowIndex + 1; rowIndex < rows.length; rowIndex += 1) {
    const row = rows[rowIndex] || [];
    if (!hasCellValue(row)) continue;
    if (isCorrectionSummaryRow(row)) continue;
    if (shouldIncludeRow && !shouldIncludeRow(rowIndex)) continue;
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
    // 留存原始账号值；账号重复改为在 Reflo 应用后用「正确账号」判定（见 detectDuplicateAccounts）。
    report.accountValue = analysis.publishAccountIndex >= 0 ? normalizeTaskText(row[analysis.publishAccountIndex]) : "";
    if (!urls.length) {
      report.hasInvalidLink = true;
      report.issues.push({ type: "invalid-link", style: "red", message: "链接列无法提取支持平台发布链接" });
    }
    normalizedUrls.forEach((url) => {
      if (!duplicateMap.has(url)) duplicateMap.set(url, []);
      duplicateMap.get(url).push(report);
    });
    rowReports.push(report);
  }
  duplicateMap.forEach((reports, url) => {
    if (reports.length < 2) return;
    reports.forEach((report) => {
      report.hasDuplicateLink = true;
      report.issues.push({ type: "duplicate-link", style: "purple", message: `重复链接：${url}` });
    });
  });
  return rowReports;
}

// 账号重复检测：必须在 Reflo 应用之后调用，用「正确账号」（reflo.data.account）判重；
// 拿不到 Reflo 数据的行回退用 Excel 原始账号值。这样判重基准与导出后单元格展示的值一致，
// 避免「原始值不同但回填后相同」或「原始值相同但回填后不同」导致的漏标/错标。
function detectDuplicateAccounts(rowReports, analysis) {
  if (analysis.publishAccountIndex < 0) return;
  const duplicateAccountMap = new Map();
  rowReports.forEach((report) => {
    const correctAccount = (report.refloData && report.refloData.account) || report.accountValue || "";
    const key = normalizeStrictCompareText(correctAccount);
    if (!key) return;
    if (!duplicateAccountMap.has(key)) duplicateAccountMap.set(key, { accountValue: correctAccount, reports: [] });
    duplicateAccountMap.get(key).reports.push(report);
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
    const response = await fetchRefloReleaseInfoBatch(settings, batches[index], (attempt, _maxAttempts, _error, waitMs) => {
      renderExcelCorrectionPreview({ status: "running", message: `第 ${index + 1}/${batches.length} 批请求失败（第 ${attempt} 次），${Math.round(waitMs / 1000)} 秒后自动重试...` });
    });
    (response.items || []).forEach((item, itemIdx) => {
      const rowReport = taskMap.get(item && item.id);
      if (!rowReport) return;
      // 临时诊断日志：打印第一个包含 anomaly 的 item，确认 Reflo 返回的数据结构
      if (itemIdx === 0 && item && item.data) {
        console.log("[anomaly-debug] 首个 item.data 的 key:", Object.keys(item.data));
        console.log("[anomaly-debug] item.data.anomaly:", JSON.stringify(item.data.anomaly));
      }
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

  // Store complete Reflo data for later metric extraction
  rowReport.refloData = reflo.data;

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
    // 失效链接拿不到 Reflo 数据，黄色字段没有 fixValue，无值可回填，整行跳过。
    // 重复链接指向同一条内容，其账号/日期/标题/平台是 Reflo 按链接取回的同一份真实数据，
    // 照常回填才能保证导出结果准确（重复本身仍由紫色整行 + 纠错说明保留提示）。
    if (rowReport.hasInvalidLink) return;
    const row = rows[rowReport.rowIndex] || [];
    rowReport.issues.filter((issue) => issue.style === "yellow" && issue.columnIndex >= 0 && issue.fixValue).forEach((issue) => {
      row[issue.columnIndex] = issue.fixValue;
      issue.fixed = true;
      issue.message = `${issue.message}；已自动修正`;
      fixedCells += 1;
    });
  });
  return fixedCells;
}

// 「Excel 日期精确到时分秒」开启时，用 Reflo 返回的完整发布时间（含时分秒）覆盖发布日期列。
// 比对仍按天级，避免秒级差异把每行误判为不一致；这里只负责把权威的精确时间写进导出单元格：
//   - 修正模式：所有取到 Reflo 数据的行都写成 Reflo 的精确时间（与「以 Reflo 为准」的修正语义一致）；
//   - 纠错模式：仅对「日期天级一致、未被标记不一致」的行补上时分秒（同一天、只加时间，属展示增强，
//     不改写被标记为不一致的行，保持纠错「只检查不修改日期」的语义）。
function applyRefloPublishTimeSeconds(rowReports, rows, analysis, applyFixes) {
  const columnIndex = analysis.publishTimeIndex;
  if (columnIndex < 0) return;
  rowReports.forEach((rowReport) => {
    if (rowReport.hasInvalidLink) return;
    const refloTime = rowReport.refloData && rowReport.refloData.timeWithSeconds;
    if (!refloTime) return;
    // Reflo 只给到天时不覆盖，避免把源单元格里本就带的时分秒「降级」抹掉（此时交给整列归一化保留源时间）。
    if (!/\d:\d/.test(refloTime)) return;
    const hasDateMismatch = rowReport.issues.some((issue) => issue.columnIndex === columnIndex && issue.style === "yellow");
    if (!applyFixes && hasDateMismatch) return;
    const row = rows[rowReport.rowIndex];
    if (Array.isArray(row)) row[columnIndex] = refloTime;
  });
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
    const actionName = report.actionName || "纠错";
    elements.excelCorrectionPreview.textContent = report.status === "failed" ? `${actionName}失败：${report.message}` : report.message;
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
      <span>橙色 ${report.summary.anomalousTitleRows || 0} 行</span>
      <span>已修正 ${report.summary.fixedCells} 处</span>
    </div>
    <div class="excel-correction-legend">
      <span class="red">红：链接失效（整行）</span>
      <span class="purple">紫：重复链接（整行）</span>
      <span class="blue">蓝：账号重复</span>
      <span class="yellow">黄：字段不一致</span>
      <span class="orange">橙：主题异常（整行）</span>
    </div>
    <div class="excel-correction-list"></div>
  `;
  renderExcelCorrectionMeta(report);
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

function renderExcelCorrectionMeta(report) {
  if (!report || (!report.actionName && !report.sourceFileName && !report.completedAt)) return;
  const meta = document.createElement("div");
  meta.className = "excel-correction-item";
  const parts = [];
  if (report.actionName) parts.push(`${report.restored ? "上次" : ""}${report.actionName}报告`);
  if (report.sourceFileName) parts.push(report.sourceFileName);
  if (report.completedAt) parts.push(formatExcelCorrectionMemoryTime(report.completedAt));
  meta.textContent = parts.join(" · ");
  elements.excelCorrectionPreview.insertBefore(meta, elements.excelCorrectionPreview.firstChild);
}

function formatExcelCorrectionMemoryTime(value) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "";
  return date.toLocaleString("zh-CN", { hour12: false });
}

async function loadExcelCorrectionMemory() {
  const memory = await readStorageValue(REFLO_CORRECTION_MEMORY_KEY);
  if (!memory || typeof memory !== "object") return;
  const report = normalizeExcelCorrectionMemory(memory);
  if (!report) return;
  renderExcelCorrectionPreview(report);
}

function saveExcelCorrectionMemory(report) {
  const memory = buildExcelCorrectionMemory(report);
  if (!memory) return;
  return writeStorageValue(REFLO_CORRECTION_MEMORY_KEY, memory);
}

function clearExcelCorrectionMemory() {
  return removeStorageValue(REFLO_CORRECTION_MEMORY_KEY);
}

function buildExcelCorrectionMemory(report) {
  if (!report || typeof report !== "object") return null;
  return {
    status: report.status || "done",
    actionName: report.actionName || "",
    sourceFileName: report.sourceFileName || "",
    completedAt: report.completedAt || Date.now(),
    message: report.message || "",
    summary: sanitizeExcelCorrectionSummary(report.summary),
    previewItems: sanitizeExcelCorrectionPreviewItems(report.previewItems),
  };
}

function normalizeExcelCorrectionMemory(memory) {
  const status = memory.status === "running" ? "failed" : memory.status;
  const message = memory.status === "running" ? "上次操作未完成，可能是插件弹窗被关闭，请重新导入后再执行。" : memory.message;
  const summary = sanitizeExcelCorrectionSummary(memory.summary);
  if (status !== "failed" && !summary) return null;
  return {
    status: status || "done",
    actionName: memory.actionName || "",
    sourceFileName: memory.sourceFileName || "",
    completedAt: memory.completedAt || 0,
    message: message || "",
    summary,
    previewItems: sanitizeExcelCorrectionPreviewItems(memory.previewItems),
    restored: true,
  };
}

function sanitizeExcelCorrectionSummary(summary) {
  if (!summary || typeof summary !== "object") return null;
  return {
    checkedRows: Number(summary.checkedRows) || 0,
    issueRows: Number(summary.issueRows) || 0,
    invalidLinks: Number(summary.invalidLinks) || 0,
    duplicateRows: Number(summary.duplicateRows) || 0,
    duplicateAccountCells: Number(summary.duplicateAccountCells) || 0,
    fieldMismatches: Number(summary.fieldMismatches) || 0,
    fixedCells: Number(summary.fixedCells) || 0,
  };
}

function sanitizeExcelCorrectionPreviewItems(items) {
  return (Array.isArray(items) ? items : []).slice(0, 8).map((item) => ({
    rowNumber: item && item.rowNumber != null ? item.rowNumber : "",
    message: item && item.message != null ? String(item.message) : "",
  }));
}

// 发起单批 Reflo 请求，并对瞬时错误（网关 5xx/429、网络中断）做有限次指数退避重试。
// onRetry(attempt, maxAttempts, error, waitMs) 为可选回调，供调用方向用户提示"正在自动重试"。
async function fetchRefloReleaseInfoBatch(settings, tasks, onRetry) {
  const payload = {
    links: tasks.map((task) => ({ id: task.id, url: task.url })),
  };
  // 按需开启粉丝数查询（抖音链接会额外调用用户主页 API，约 +0.3-0.5s/条）
  let apiUrl = settings.apiUrl;
  if (settings.enrichFollower) {
    apiUrl = apiUrl.includes("?")
      ? `${apiUrl}&enrich_follower=true`
      : `${apiUrl}?enrich_follower=true`;
  }
  let lastError = "Reflo API 请求失败";
  for (let attempt = 1; attempt <= REFLO_MAX_ATTEMPTS; attempt += 1) {
    // 通过后台 service worker 发起请求：MV3 下只有后台 worker 能凭 host_permissions 绕过 CORS，
    // 在 popup 页面直接 fetch 会被服务器 CORS 白名单拒绝（chrome-extension:// 不在白名单），导致 "Failed to fetch"。
    const response = await sendMessage({
      type: "REFLO_RELEASE_INFO_BATCH",
      apiUrl,
      token: settings.token,
      payload,
      timeoutMs: REFLO_REQUEST_TIMEOUT_MS,
    });
    if (response && response.ok) return response.data;
    lastError = response && response.error ? response.error : "Reflo API 请求失败";
    // 仅对后台标记为瞬时（5xx/429/网络中断）的错误重试；鉴权、参数、超时等错误重试无益。
    const retryable = Boolean(response && response.retryable);
    if (!retryable || attempt >= REFLO_MAX_ATTEMPTS) break;
    const waitMs = Math.min(REFLO_RETRY_BASE_DELAY_MS * 2 ** (attempt - 1), REFLO_RETRY_MAX_DELAY_MS);
    if (typeof onRetry === "function") onRetry(attempt, REFLO_MAX_ATTEMPTS, lastError, waitMs);
    await delay(waitMs);
  }
  throw new Error(lastError);
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
  // 后端可能用 publishTime / publish_date 等不同键返回带时分秒的发布时间，这里全部兜底读取。
  const rawPublishTime = normalizeTaskText(data.publishTime || data.publish_time || data.publishDate || data.publish_date || data.createTime || data.create_time || data.createtime);
  const time = normalizePublishTime(rawPublishTime);
  // 含时分秒的版本，供「Excel 日期精确到时分秒」导出使用；Reflo 只返回到天时与 time 相同。
  const timeWithSeconds = normalizePublishTime(rawPublishTime, true);
  return {
    account,
    platform,
    title,
    link,
    time,
    timeWithSeconds,
    source: normalizeTaskText(data.source) || "reflo",
    confidence: normalizeTaskText(data.confidence),
    coverUrl: normalizeTaskText(coalesceRefloValue(data.coverUrl, data.cover_url)),
    avatarUrl: normalizeTaskText(coalesceRefloValue(data.avatarUrl, data.headImgUrl, data.head_img_url)),
    playCount: normalizeMetricValue(coalesceRefloValue(data.playCount, data.play_count)),
    diggCount: normalizeMetricValue(coalesceRefloValue(data.diggCount, data.digg_count)),
    commentCount: normalizeMetricValue(coalesceRefloValue(data.commentCount, data.comment_count)),
    shareCount: normalizeMetricValue(coalesceRefloValue(data.shareCount, data.share_count)),
    collectCount: normalizeMetricValue(coalesceRefloValue(data.collectCount, data.collect_count)),
    followerCount: normalizeMetricValue(coalesceRefloValue(data.followerCount, data.follower_count)),
    anomaly: data.anomaly || null,
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

function mergeParsedFiles(parsedFiles) {
  const files = (Array.isArray(parsedFiles) ? parsedFiles : [])
    .filter((entry) => entry && Array.isArray(entry.rows) && entry.rows.some((row) => hasCellValue(row)));
  if (!files.length) throw new Error("没有可合并的有效表格");

  const base = files[0];
  const baseAnalysis = analyzeImportRows(base.rows);
  const baseHeaderRowIndex = baseAnalysis.headerRowIndex;
  const mergedHeader = (base.rows[baseHeaderRowIndex] || []).map((cell) => (cell == null ? "" : String(cell)));

  // 以首个文件表头为基准列；记录「规范化表头 -> 合并表列号」用于按名对齐后续文件。
  const headerKeyToIndex = new Map();
  mergedHeader.forEach((header, index) => {
    const key = normalizeHeader(header);
    if (key && !headerKeyToIndex.has(key)) headerKeyToIndex.set(key, index);
  });

  const mergedRows = [mergedHeader];
  const realignedFiles = [];
  const appendedHeaders = [];
  // 背景填充标记与 mergedRows 行号对齐；表头行不参与处理，标记为 false。
  // 只要有一个文件能解析到填充信息（xlsx），合并结果就给出标记数组；全部无填充信息（如纯 CSV）则为 null。
  const mergedFillMarks = [false];
  const anyFillInfo = files.some((file) => Array.isArray(file.fillMarks));

  // 首个文件的数据行原样保留（与单文件路径一致，仅丢弃表头以上的标题行）。
  for (let rowIndex = baseHeaderRowIndex + 1; rowIndex < base.rows.length; rowIndex += 1) {
    if (!hasCellValue(base.rows[rowIndex])) continue;
    mergedRows.push((base.rows[rowIndex] || []).map((cell) => (cell == null ? "" : String(cell))));
    mergedFillMarks.push(Boolean(base.fillMarks && base.fillMarks[rowIndex]));
  }

  // 后续文件按表头名对齐到基准列，列名不存在则取并集追加到末尾。
  for (let fileIndex = 1; fileIndex < files.length; fileIndex += 1) {
    const file = files[fileIndex];
    const analysis = analyzeImportRows(file.rows);
    const headerRow = (file.rows[analysis.headerRowIndex] || []).map((cell) => (cell == null ? "" : String(cell)));
    const colMap = new Array(headerRow.length);
    let needsRealign = false;
    for (let col = 0; col < headerRow.length; col += 1) {
      const key = normalizeHeader(headerRow[col]);
      if (key && headerKeyToIndex.has(key)) {
        colMap[col] = headerKeyToIndex.get(key);
        if (colMap[col] !== col) needsRealign = true;
      } else if (key) {
        const newIndex = mergedHeader.length;
        mergedHeader[newIndex] = headerRow[col];
        headerKeyToIndex.set(key, newIndex);
        colMap[col] = newIndex;
        appendedHeaders.push(headerRow[col]);
        needsRealign = true;
      } else {
        colMap[col] = col; // 无表头列：按位置兜底对齐。
      }
    }
    if (needsRealign) realignedFiles.push(file.fileName);
    for (let rowIndex = analysis.headerRowIndex + 1; rowIndex < file.rows.length; rowIndex += 1) {
      const sourceRow = file.rows[rowIndex] || [];
      if (!hasCellValue(sourceRow)) continue;
      const targetRow = new Array(mergedHeader.length).fill("");
      for (let col = 0; col < sourceRow.length; col += 1) {
        const value = sourceRow[col];
        if (value == null || value === "") continue;
        const targetCol = colMap[col] != null ? colMap[col] : col;
        targetRow[targetCol] = String(value);
      }
      mergedRows.push(targetRow);
      mergedFillMarks.push(Boolean(file.fillMarks && file.fillMarks[rowIndex]));
    }
  }

  return {
    rows: mergedRows,
    fileName: base.fileName,
    fillMarks: anyFillInfo ? mergedFillMarks : null,
    realignedFiles: Array.from(new Set(realignedFiles)),
    appendedHeaders: Array.from(new Set(appendedHeaders)),
    dataRowCount: mergedRows.length - 1,
  };
}

// 统一返回 { rows, fillMarks }：fillMarks 与 rows 行号对齐，标记该行是否有单元格背景填充；
// CSV 无填充概念，fillMarks 返回 null。
async function parseInputFile(file) {
  const lowerName = file.name.toLowerCase();
  if (lowerName.endsWith(".csv")) {
    return { rows: parseCsv(await file.text()), fillMarks: null };
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
  const stylesXml = entries.has("xl/styles.xml") ? await readZipText(entries, "xl/styles.xml") : "";
  const sheetPath = getFirstSheetPath(workbookXml, workbookRels);
  const sheetXml = await readZipText(entries, sheetPath);
  const sheetRelsPath = getSheetRelsPath(sheetPath);
  const sheetRelsXml = entries.has(sheetRelsPath) ? await readZipText(entries, sheetRelsPath) : "";
  const sharedStrings = parseSharedStrings(sharedStringsXml);
  const hyperlinkTargets = parseRelationshipTargets(sheetRelsXml);
  const markedStyleIndexes = parseStyleFillMarks(stylesXml);
  let cellImageRefs = null;
  try {
    cellImageRefs = await resolveCellImageRefs(entries);
  } catch (error) {
    // 内嵌粉丝量截图是锦上添花的能力，cellimages.xml/rels 本身损坏不应影响任务表其余数据的正常导入。
  }
  const result = parseSheetRows(sheetXml, sharedStrings, hyperlinkTargets, markedStyleIndexes, cellImageRefs);
  const cellImageTargets = result.cellImageTargets || [];
  delete result.cellImageTargets;
  result.cellImages = await loadCellImages(entries, cellImageTargets);
  return result;
}

// 解析 WPS/金山表格「插入单元格图片」内嵌截图的 ID -> 媒体文件映射：xl/cellimages.xml（WPS 扩展部件）
// 里的 <etc:cellImage> 块给出 name(ID_xxx) -> r:embed(rId) 映射，xl/_rels/cellimages.xml.rels 给出
// rId -> media 路径映射（复用 parseRelationshipTargets，与属性顺序无关）。微软原生 Excel「在单元格中
// 插入图片」用的是另一套 richValue/richValueRel 结构，本函数不识别，返回 null（不影响其余正常解析）。
async function resolveCellImageRefs(entries) {
  if (!entries.has("xl/cellimages.xml") || !entries.has("xl/_rels/cellimages.xml.rels")) return null;
  const cellImagesXml = await readZipText(entries, "xl/cellimages.xml");
  const cellImagesRelsXml = await readZipText(entries, "xl/_rels/cellimages.xml.rels");
  const idToRid = new Map();
  for (const match of cellImagesXml.matchAll(/<etc:cellImage>([\s\S]*?)<\/etc:cellImage>/g)) {
    const nameMatch = match[1].match(/<xdr:cNvPr[^>]*\sname="([^"]+)"/);
    const embedMatch = match[1].match(/r:embed="([^"]+)"/);
    if (nameMatch && embedMatch) idToRid.set(nameMatch[1], embedMatch[1]);
  }
  if (!idToRid.size) return null;
  const ridToTarget = parseRelationshipTargets(cellImagesRelsXml);
  if (!ridToTarget.size) return null;
  return { idToRid, ridToTarget };
}

// 按 parseSheetRows 收集到的 {row, col, mediaPath} 逐个读取图片字节。单张图片读取失败
// （压缩方式异常、关联的 media 文件缺失/损坏等）只静默跳过该图，不影响其余图片和整份 Excel 的解析。
async function loadCellImages(entries, targets) {
  const images = [];
  for (const target of targets) {
    if (!entries.has(target.mediaPath)) continue;
    try {
      const bytes = await readZipBinary(entries, target.mediaPath);
      const ext = (target.mediaPath.split(".").pop() || "png").toLowerCase();
      images.push({ row: target.row, col: target.col, bytes, ext: ext === "jpg" ? "jpeg" : ext });
    } catch (error) {
      // 静默跳过单张损坏/格式异常的内嵌截图。
    }
  }
  return images;
}

// 解析 xl/styles.xml，返回「带真实背景填充」的单元格样式索引集合（对应 <c s="..">、<row s="..">）。
function parseStyleFillMarks(xml) {
  if (!xml) return new Set();
  const doc = new DOMParser().parseFromString(xml, "application/xml");
  // fills 按文档顺序即为 fillId；记录每个 fill 的 patternType。
  const fillPatternTypes = Array.from(doc.querySelectorAll("fills > fill")).map((fill) => {
    const pattern = fill.querySelector("patternFill");
    return pattern ? (pattern.getAttribute("patternType") || "") : "";
  });
  // cellXfs 按文档顺序即为单元格样式索引；记录每个 xf 引用的 fillId。
  const xfFillIds = Array.from(doc.querySelectorAll("cellXfs > xf")).map((xf) => Number.parseInt(xf.getAttribute("fillId"), 10));
  return buildMarkedStyleIndexSet(fillPatternTypes, xfFillIds);
}

// 纯逻辑：根据 fill 的 patternType 列表与 xf 的 fillId 列表，算出「算作背景标记」的样式索引集合。
// 排除 none 与 Excel 默认占位的 gray125，其余有图案的填充（solid 等）视为用户手动标记。
function buildMarkedStyleIndexSet(fillPatternTypes, xfFillIds) {
  const filledFillIds = new Set();
  (Array.isArray(fillPatternTypes) ? fillPatternTypes : []).forEach((type, fillId) => {
    if (isMarkFillPatternType(type)) filledFillIds.add(fillId);
  });
  const markedStyleIndexes = new Set();
  (Array.isArray(xfFillIds) ? xfFillIds : []).forEach((fillId, styleIndex) => {
    if (Number.isFinite(fillId) && filledFillIds.has(fillId)) markedStyleIndexes.add(styleIndex);
  });
  return markedStyleIndexes;
}

function isMarkFillPatternType(type) {
  const normalized = String(type || "").trim().toLowerCase();
  return Boolean(normalized) && normalized !== "none" && normalized !== "gray125";
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
  const data = await readZipBinary(entries, name);
  return new TextDecoder("utf-8").decode(data);
}

async function readZipBinary(entries, name) {
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
  return data;
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

function parseSheetRows(xml, sharedStrings, hyperlinkTargets, markedStyleIndexes = null, cellImageRefs = null) {
  const doc = new DOMParser().parseFromString(xml, "application/xml");
  const hyperlinks = parseSheetHyperlinks(doc, hyperlinkTargets);
  const detectFill = Boolean(markedStyleIndexes && markedStyleIndexes.size);
  const rows = [];
  const fillMarks = [];
  // 与 rows/fillMarks 用同一套行号计算（含缺失 r 属性时的 rows.length 兜底），
  // 保证「内嵌粉丝量截图所在行」与「该行任务数据」引用的是同一行，不会因为各自独立计算行号而错位。
  const cellImageTargets = [];
  Array.from(doc.querySelectorAll("sheetData row")).forEach((row) => {
    const rowRef = Number.parseInt(row.getAttribute("r"), 10);
    const rowIndex = Number.isFinite(rowRef) && rowRef > 0 ? rowRef - 1 : rows.length;
    const values = [];
    // 行级填充：整行选中后填色时，Excel 会在 <row> 上写 customFormat + s。
    let marked = detectFill && row.getAttribute("customFormat") === "1" && markedStyleIndexes.has(Number.parseInt(row.getAttribute("s"), 10));
    Array.from(row.querySelectorAll("c")).forEach((cell) => {
      const ref = cell.getAttribute("r") || "A1";
      const colIndex = columnNameToIndex(ref.replace(/[0-9]/g, ""));
      values[colIndex] = appendHyperlinkTarget(readCellValue(cell, sharedStrings), hyperlinks.get(ref));
      // 单元格级填充：任一单元格命中标记样式即视为该行有背景标记。
      if (detectFill && !marked && markedStyleIndexes.has(Number.parseInt(cell.getAttribute("s"), 10))) marked = true;
      if (cellImageRefs) {
        const formula = cell.querySelector("f");
        const idMatch = formula && (formula.textContent || "").match(/DISPIMG\("([^"]+)"/);
        const rid = idMatch && cellImageRefs.idToRid.get(idMatch[1]);
        const target = rid && cellImageRefs.ridToTarget.get(rid);
        if (target) cellImageTargets.push({ row: rowIndex, col: colIndex, mediaPath: `xl/${target.replace(/^\.\.\//, "")}` });
      }
    });
    rows[rowIndex] = values.map((value) => value == null ? "" : value);
    fillMarks[rowIndex] = marked;
  });
  while (rows.length && !hasCellValue(rows[rows.length - 1])) {
    rows.pop();
    fillMarks.pop();
  }
  // xlsx 始终返回 fillMarks 数组（无任何填充时为全 false），以便与 CSV 的 null（无填充信息）区分：
  // 全 false 表示「确实没有标记行」，选项生效时不处理任何行；null 表示「无法判断填充」，选项被忽略。
  return {
    rows: Array.from({ length: rows.length }, (_, index) => rows[index] || []),
    fillMarks: Array.from({ length: rows.length }, (_, index) => Boolean(fillMarks[index])),
    cellImageTargets: cellImageTargets.filter((target) => target.row < rows.length),
  };
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
  // 单元格文本已是支持平台链接时，优先信任文本，避免 Excel 复用 rId 导致错误 target 被拼接进来。
  if (extractVideoUrls(text).some((url) => getUrlPlatform(url))) return text;
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
      const importSequence = analysis.sequenceIndex >= 0
        ? normalizeTaskText(row[analysis.sequenceIndex])
        : sequenceForFile;
      tasks.push({
        id: `${rowIndex + 1}-${urlIndex + 1}-${Date.now()}-${tasks.length}`,
        listIndex: tasks.length,
        rowNumber: rowIndex + 1,
        sequence: sequenceForFile,
        importSequence,
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

function renumberSequenceColumn(rows, analysis) {
  if (!analysis || analysis.sequenceIndex < 0) return 0;
  const sequenceIndex = analysis.sequenceIndex;
  const headerRowIndex = analysis.headerRowIndex;
  // 与 buildLocalCorrectionRows 的行选择保持一致：跳过空行与「合计」汇总行，
  // 其余数据行（含链接无效的行）都参与连续编号，避免与导出行集合错位。
  let next = findSequenceRenumberStart(rows, analysis);
  let renumbered = 0;
  for (let rowIndex = headerRowIndex + 1; rowIndex < rows.length; rowIndex += 1) {
    const row = rows[rowIndex] || [];
    if (!hasCellValue(row)) continue;
    if (isCorrectionSummaryRow(row)) continue;
    ensureCorrectionRow(rows, rowIndex);
    rows[rowIndex][sequenceIndex] = String(next);
    next += 1;
    renumbered += 1;
  }
  return renumbered;
}

function findSequenceRenumberStart(rows, analysis) {
  for (let rowIndex = analysis.headerRowIndex + 1; rowIndex < rows.length; rowIndex += 1) {
    const row = rows[rowIndex] || [];
    if (!hasCellValue(row)) continue;
    if (isCorrectionSummaryRow(row)) continue;
    const number = parseSequenceNumber(row[analysis.sequenceIndex]);
    return number != null ? number : 1;
  }
  return 1;
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

// includeTime 为 true 时，若源数据本身带有具体时分秒，则输出「日期 时:分:秒」，否则仍只输出到天；
// 默认（false）只精确到天，对应「内部配置-日期精确到时分秒」开关，默认关闭。
function normalizePublishTime(value, includeTime = false) {
  const text = normalizeTaskText(value);
  if (!text) return "";
  if (/^\d{1,5}(?:\.\d+)?$/.test(text)) {
    const number = Number(text);
    if (number > 20000 && number < 80000) {
      // 按秒取整，规避 Excel 日期序列号的浮点误差（否则 20:52:44 可能被解析成 20:52:43）。
      const date = new Date(Math.round((number - 25569) * 86400) * 1000);
      if (!Number.isNaN(date.getTime())) {
        const day = formatPublishDateParts(date.getUTCFullYear(), date.getUTCMonth() + 1, date.getUTCDate());
        if (!includeTime) return day;
        return appendPublishTimeParts(day, date.getUTCHours(), date.getUTCMinutes(), date.getUTCSeconds());
      }
    }
  }
  // 时间分隔符兼容空格与 ISO 的「T」，秒后可带小数（如 .000）及时区后缀（Z 或 +08:00），按字面时分秒展示、不做时区换算，
  // 以便解析 Reflo 返回的各种完整时间戳格式。
  let match = /^(\d{4})[./年-](\d{1,2})[./月-](\d{1,2})(?:日)?(?:[\sT]+(\d{1,2}):(\d{1,2})(?::(\d{1,2}))?(?:\.\d+)?(?:\s*(?:Z|[+-]\d{1,2}:?\d{0,2}))?)?$/.exec(text);
  if (match) {
    const day = formatPublishDateParts(match[1], match[2], match[3]);
    if (!includeTime) return day;
    return appendPublishTimeParts(day, match[4], match[5], match[6]);
  }
  match = /^(\d{1,2})[./月-](\d{1,2})日?$/.exec(text);
  if (match) return formatPublishDateParts(getDefaultPublishYear(), match[1], match[2]);
  return text;
}

// 将时分秒拼接到日期串后面。三者皆 0 或缺省时，视为源数据本无具体时间（整数日期序列号或纯日期文本），仍只输出到天。
function appendPublishTimeParts(day, hours, minutes, seconds) {
  if (!day) return day;
  const h = Number(hours) || 0;
  const m = Number(minutes) || 0;
  const s = Number(seconds) || 0;
  if (h === 0 && m === 0 && s === 0) return day;
  if (h > 23 || m > 59 || s > 59) return day;
  const pad = (part) => String(part).padStart(2, "0");
  return `${day} ${pad(h)}:${pad(m)}:${pad(s)}`;
}

// 导出前对「发布日期」整列统一归一化。仅处理表头以下的数据行，跳过「合计」等汇总行；
// normalizePublishTime 对非日期文本是无操作（原样返回），因此对非日期单元格安全。
// shouldIncludeRow 为可选谓词：返回 false 的行保持原样不归一化（与「只处理背景标记行」一致）。
function normalizeExportPublishTimeColumn(rows, analysis, includeTime = false, shouldIncludeRow = null) {
  const columnIndex = analysis ? analysis.publishTimeIndex : -1;
  if (columnIndex < 0 || !Array.isArray(rows)) return;
  const headerRowIndex = analysis.headerRowIndex;
  for (let rowIndex = headerRowIndex + 1; rowIndex < rows.length; rowIndex += 1) {
    const row = rows[rowIndex];
    if (!Array.isArray(row)) continue;
    if (isCorrectionSummaryRow(row)) continue;
    if (shouldIncludeRow && !shouldIncludeRow(rowIndex)) continue;
    const raw = row[columnIndex];
    if (raw == null || raw === "") continue;
    const normalized = normalizePublishTime(raw, includeTime);
    if (normalized) row[columnIndex] = normalized;
  }
}

// 仅含「月-日」、缺省年份时，按处理当时的当前年份补全（此前硬编码 2026，跨年会判错）。
function getDefaultPublishYear() {
  return new Date().getFullYear();
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
  // findBestHeaderIndex 先精确后包含，避免在「视频标题/标题」这类多列含同一关键词时选错；
  // 词表与 findNicknameIndex 对齐（含作者/达人/博主），避免账号列名非「账号/昵称」时漏识别。
  return findBestHeaderIndex(headerRow, ["发布账号", "账号", "昵称", "作者", "达人", "博主"]);
}

function findPublishPlatformIndex(headerRow) {
  return findBestHeaderIndex(headerRow, ["发布平台", "平台"]);
}

function findPublishTitleIndex(headerRow) {
  // 必须精确优先：表中常同时存在「视频标题」(源标题) 与「标题」(发布标题)，发布标题取后者。
  return findBestHeaderIndex(headerRow, ["发布标题", "标题"]);
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

function isCorrectionSummaryRow(row) {
  const firstCell = normalizeTaskText((row || [])[0]);
  if (!firstCell.includes("合计")) return false;
  return !(row || []).some((value) => extractVideoUrls(value).length);
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
    if ((host === "m.toutiao.com" && ["/is/", "/video/"].some((prefix) => path.startsWith(prefix))) || ((host === "toutiao.com" || host === "www.toutiao.com") && ["/article/", "/w/", "/video/"].some((prefix) => path.startsWith(prefix)))) return "toutiao";
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
  // Windows 版 Chrome downloads API 禁止 ASCII ~，全角 ～（U+FF5E）视觉一致且跨平台可下载
  text = text.replace(/~/g, "\uFF5E").replace(ILLEGAL_FILENAME_CHARS, "").replace(/\s+/g, "_").replace(/^[._ ]+|[._ ]+$/g, "");
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
  return getBaseFileName(name).replace(/~/g, "\uFF5E").toLowerCase();
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
  const GB = MB * 1024;
  if (bytes >= GB) return `${Math.round(bytes / GB)} GB`;
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
    autoPptTemplateId: isPptModeLockedByTemplate() && currentPptTemplate ? currentPptTemplate.id || "" : "",
    autoPptFanSourceId: "",
    enableSupplementRepairZip: getCurrentCaptureMode() === "supplement",
    douyinBatchSize: DOUYIN_BATCH_SIZE,
    douyinWindowMode: elements.douyinWindowModeInput.value,
    douyinProxyRotation,
    ...getCaptureSizeOptions(),
  };
  addLog(`自动 PPT：${options.autoGeneratePpt ? `已开启（${getCurrentPptMode().label}）` : "已关闭"}`);
  saveDouyinProxyRotationSettings();
  if (shouldPersistFanSourceForAutoPpt(options)) {
    try {
      isPreparingSupplementStart = true;
      updateStartButtonDisabled();
      addLog("正在缓存粉丝量截图来源，供截图完成后自动 PPT 使用...");
      options.autoPptFanSourceId = await persistFanSourceForAutoPpt();
      const fanCount = currentPptFanSource ? currentPptFanSource.imageCount : currentExcelFanImages.length;
      const fanOrigin = currentPptFanSource ? "" : "（来自 Excel 内嵌图片自动识别）";
      addLog(`粉丝量截图来源已缓存：${fanCount} 张${fanOrigin}，将在自动 PPT 中按 Excel 序号+昵称匹配`, "success");
    } catch (error) {
      // 粉丝量截图只是自动 PPT 的锦上添花项，缓存失败不应该阻断本次与它无关的整批截图任务——
      // 继续执行，只是自动生成的 PPT 里不会带粉丝量截图（等同于没有提供来源时的效果）。
      addLog(`粉丝量截图缓存失败，本次截图任务仍会继续，自动生成的 PPT 将不含粉丝量截图：${error.message}`, "warning");
      options.autoPptFanSourceId = "";
    }
    isPreparingSupplementStart = false;
    updateStartButtonDisabled();
  }
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
  if (elements.clearFilesButton) elements.clearFilesButton.disabled = running;
  elements.captureModeInput.disabled = running;
  elements.supplementFolderInput.disabled = running;
  elements.refloEnrichmentInput.disabled = running || isRefloEnriching || isExcelCorrecting;
  syncRefloEnrichmentUi(running);
  elements.pptModeInput.disabled = running || pptBusy || isPptModeLockedByTemplate();
  if (elements.pptTemplateSourceInput) elements.pptTemplateSourceInput.disabled = running || pptBusy;
  if (elements.pptTemplateInput) elements.pptTemplateInput.disabled = running || pptBusy;
  elements.pptZipInput.disabled = running || pptBusy;
  elements.pptFolderInput.disabled = running || pptBusy;
  if (elements.pptFanZipInput) elements.pptFanZipInput.disabled = running || pptBusy;
  if (elements.pptFanFolderInput) elements.pptFanFolderInput.disabled = running || pptBusy;
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

// Resolves the custom template bytes for the post-run auto-PPT path. Prefers the
// in-memory template (popup still open), then falls back to the IndexedDB cache via
// the template id carried in the run options. Returns undefined to use the built-in
// template.
async function loadAutoPptTemplateBytesFromState(state) {
  if (currentPptTemplate && currentPptTemplate.bytes) return currentPptTemplate.bytes;
  const templateId = state && state.options ? state.options.autoPptTemplateId : "";
  if (!templateId || !window.TemplateCache) return undefined;
  try {
    const record = await window.TemplateCache.getTemplate(templateId);
    if (record && record.bytes && record.bytes.length) {
      return record.bytes instanceof Uint8Array ? record.bytes : new Uint8Array(record.bytes);
    }
  } catch (error) {
    addLog(`读取自定义模板缓存失败，将使用内置模板：${error.message}`, "warning");
  }
  return undefined;
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
    const templateBytes = await loadAutoPptTemplateBytesFromState(state);
    const result = await buildPptByMode(source, mode.value, {
      tasks,
      title: state.options.autoPptTitle || "",
      templateBytes,
      autoPptFanSourceId: state.options.autoPptFanSourceId || "",
      modeValue: mode.value,
    });
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

function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
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
  return new Promise((resolve) => {
    if (!chrome.storage || !chrome.storage.local) {
      resolve();
      return;
    }
    chrome.storage.local.set({ [key]: value }, () => resolve());
  });
}

function removeStorageValue(key) {
  return new Promise((resolve) => {
    if (!chrome.storage || !chrome.storage.local) {
      resolve();
      return;
    }
    chrome.storage.local.remove(key, () => resolve());
  });
}

