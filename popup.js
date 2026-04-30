const VIDEO_URL_PATTERNS = [
  /(?:https?|ttps?|https?):\/\/weixin\.qq\.com\/sph\/[A-Za-z0-9_-]+/gi,
  /(?:https?|ttps?|https?):\/\/channels\.weixin\.qq\.com\/[^\s"'<>，。；;、]+/gi,
  /(?:https?|ttps?|https?):\/\/m\.toutiao\.com\/is\/[A-Za-z0-9_-]+\/?/gi,
  /(?:https?|ttps?|https?):\/\/(?:www\.)?toutiao\.com\/(?:article|w|video)\/[^\s"'<>，。；;、]+/gi,
];
const HTTP_URL_PATTERN = /(?:https?|ttps?|https?):\/\/[^\s"'<>，。；;、）)】\]]+/gi;
const SHORT_LINK_PATTERN = /^https?:\/\/(?:www\.)?pinhaojian\.com\/redirect\//i;
const ASSET_LINK_PATTERN = /(?:\.(?:mp4|mov|m4v|avi|webm)(?:[?#]|$)|aliyuncs\.com|myqcloud\.com|qcloud|cos\.|oss-|\/stodownload)/i;
const TRAILING_PUNCTUATION = /[.,;!?，。；！？、）)】\]]+$/;
const ILLEGAL_FILENAME_CHARS = /[\\/:*?"<>|\r\n\t]+/g;

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

let parsedTasks = [];
let currentState = null;
let currentRows = null;
let currentFileName = "";

const elements = {
  fileInput: document.getElementById("fileInput"),
  fileInfo: document.getElementById("fileInfo"),
  statusBadge: document.getElementById("statusBadge"),
  concurrencyInput: document.getElementById("concurrencyInput"),
  delayInput: document.getElementById("delayInput"),
  waitInput: document.getElementById("waitInput"),
  limitInput: document.getElementById("limitInput"),
  sequenceModeInput: document.getElementById("sequenceModeInput"),
  captureSizeModeInput: document.getElementById("captureSizeModeInput"),
  captureWidthInput: document.getElementById("captureWidthInput"),
  captureHeightInput: document.getElementById("captureHeightInput"),
  screenshotWorkbookInput: document.getElementById("screenshotWorkbookInput"),
  startButton: document.getElementById("startButton"),
  pauseButton: document.getElementById("pauseButton"),
  resumeButton: document.getElementById("resumeButton"),
  stopButton: document.getElementById("stopButton"),
  totalCount: document.getElementById("totalCount"),
  successCount: document.getElementById("successCount"),
  failedCount: document.getElementById("failedCount"),
  pendingCount: document.getElementById("pendingCount"),
  previewList: document.getElementById("previewList"),
  logList: document.getElementById("logList"),
};

init();

function init() {
  elements.fileInput.addEventListener("change", handleFileChange);
  elements.startButton.addEventListener("click", startRun);
  elements.pauseButton.addEventListener("click", () => sendAction("pause"));
  elements.resumeButton.addEventListener("click", () => sendAction("resume"));
  elements.stopButton.addEventListener("click", () => sendAction("stop"));
  elements.sequenceModeInput.addEventListener("change", rebuildTasksFromCurrentRows);
  elements.limitInput.addEventListener("change", rebuildTasksFromCurrentRows);
  elements.captureSizeModeInput.addEventListener("change", syncCaptureSizeInputs);
  syncCaptureSizeInputs();
  refreshState();
  setInterval(refreshState, 1200);
}

async function handleFileChange(event) {
  const file = event.target.files && event.target.files[0];
  if (!file) return;
  try {
    setBadge("解析中", "running");
    addLog(`开始解析：${file.name}`);
    currentRows = await parseInputFile(file);
    currentFileName = file.name;
    applyParsedRows(currentRows, currentFileName, { logDiagnostics: true });
  } catch (error) {
    parsedTasks = [];
    currentRows = null;
    currentFileName = "";
    elements.startButton.disabled = true;
    elements.fileInfo.textContent = `解析失败：${error.message}`;
    renderPreview([]);
    renderCounts({ total: 0, success: 0, failed: 0, pending: 0 });
    setBadge("解析失败", "");
    addLog(`解析失败：${error.message}`, "failed");
  }
}
function applyParsedRows(rows, fileName, options = {}) {
  const limit = parsePositiveInteger(elements.limitInput.value, 0);
  const result = buildTasks(rows, limit || null, elements.sequenceModeInput.value);
  parsedTasks = result.tasks;
  const foundCount = result.analysis.summary.selectedVideoUrlCount;
  const limitedText = parsedTasks.length < foundCount ? `，准备处理 ${parsedTasks.length} 条` : "";
  const sequenceText = elements.sequenceModeInput.value === "row" ? "文件名前缀使用 Excel 行号 - 1" : "文件名前缀优先使用 Excel 序号列";
  elements.fileInfo.textContent = `${fileName}，识别到 ${foundCount} 条支持链接${limitedText}；已选择 ${result.analysis.summary.selectedColumnLabel}；${sequenceText}`;
  elements.startButton.disabled = parsedTasks.length === 0;
  renderPreview(parsedTasks);
  renderCounts({ total: parsedTasks.length, success: 0, failed: 0, pending: parsedTasks.length });
  setBadge(parsedTasks.length ? "已就绪" : "无任务", parsedTasks.length ? "done" : "");
  if (options.logDiagnostics) renderImportDiagnostics(result.analysis);
  addLog(`解析完成：${parsedTasks.length} 条任务`, parsedTasks.length ? "success" : "warning");
}

function rebuildTasksFromCurrentRows() {
  if (!currentRows) return;
  try {
    applyParsedRows(currentRows, currentFileName);
  } catch (error) {
    parsedTasks = [];
    elements.startButton.disabled = true;
    elements.fileInfo.textContent = `解析失败：${error.message}`;
    renderPreview([]);
    renderCounts({ total: 0, success: 0, failed: 0, pending: 0 });
    setBadge("解析失败", "");
    addLog(`解析失败：${error.message}`, "failed");
  }
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
  return rows.filter((item) => item.some((value) => String(value || "").trim()));
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
  return Array.from(doc.querySelectorAll("sheetData row")).map((row) => {
    const values = [];
    Array.from(row.querySelectorAll("c")).forEach((cell) => {
      const ref = cell.getAttribute("r") || "A1";
      const colIndex = columnNameToIndex(ref.replace(/[0-9]/g, ""));
      values[colIndex] = appendHyperlinkTarget(readCellValue(cell, sharedStrings), hyperlinks.get(ref));
    });
    return values.map((value) => value == null ? "" : value);
  });
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
  for (let rowIndex = analysis.headerRowIndex + 1; rowIndex < rows.length; rowIndex += 1) {
    const row = rows[rowIndex] || [];
    const urls = extractVideoUrls(row[analysis.linkIndex]).filter(isVideoUrl);
    if (!urls.length) continue;
    const nickname = sanitizeFilenamePart(row[analysis.nicknameIndex], `昵称-${tasks.length + 1}`);
    const excelRowNumber = String(rowIndex + 1);
    const sequence = sequenceMode === "row" ? String(rowIndex) : sanitizeFilenamePart(row[analysis.sequenceIndex], excelRowNumber);
    urls.forEach((url, urlIndex) => {
      const sequenceForFile = urls.length === 1 ? sequence : `${sequence}-${urlIndex + 1}`;
      const fileName = buildUniqueFileName(`${sequenceForFile}_${nickname}`, usedNames);
      tasks.push({
        id: `${rowIndex + 1}-${urlIndex + 1}-${Date.now()}-${tasks.length}`,
        listIndex: tasks.length,
        rowNumber: rowIndex + 1,
        sequence: sequenceForFile,
        nickname,
        url,
        fileName,
        status: "PENDING",
      });
    });
    if (limit && tasks.length >= limit) return { tasks: tasks.slice(0, limit), analysis };
  }
  return { tasks, analysis };
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
    const urls = extractHttpUrls(value);
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
  if (/发布链接|视频号链接|头条链接|头条号链接|作品链接|页面链接|分享链接/.test(header)) score += 60;
  if (/链接|url|地址/.test(header)) score += 15;
  if (/视频链接|素材链接|源视频|下载链接|视频id|主页id|视频号主页id/.test(header)) score -= 35;
  return score;
}

function normalizeHeader(value) {
  return String(value || "").trim().toLowerCase().replace(/\s+/g, "");
}

function findNicknameIndex(headerRow) {
  return findBestHeaderIndex(headerRow, ["昵称", "账号", "作者", "达人", "博主"]);
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
  if (shortLinkCount) suffix.push(`发现 ${shortLinkCount} 个短链但本次不自动处理`);
  return `未找到包含 weixin.qq.com/sph、channels.weixin.qq.com 或 m.toutiao.com/is 的支持链接列${suffix.length ? `（${suffix.join("，")}）` : ""}`;
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
      const url = cleanUrl(match[0]);
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
  return String(url || "")
    .replace(/^ttps:\/\//i, "https://")
    .replace(/^ttp:\/\//i, "http://")
    .replace(/^https:\/([^/])/i, "https://$1")
    .replace(/^http:\/([^/])/i, "http://$1")
    .replace(/^https\/\//i, "https://")
    .replace(/^http\/\//i, "http://");
}

function isVideoUrl(url) {
  try {
    const parsed = new URL(url);
    const host = parsed.hostname.toLowerCase();
    const path = parsed.pathname.toLowerCase();
    return (host === "weixin.qq.com" && path.startsWith("/sph/"))
      || host === "channels.weixin.qq.com"
      || (host === "m.toutiao.com" && path.startsWith("/is/"))
      || ((host === "toutiao.com" || host === "www.toutiao.com") && ["/article/", "/w/", "/video/"].some((prefix) => path.startsWith(prefix)));
  } catch {
    return false;
  }
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

async function startRun() {
  if (!parsedTasks.length) return;
  const confirmed = window.confirm("截图期间会创建专用 Chrome 窗口，并在每次截图前自动拉回前台。普通 Chrome 插件无法真正后台截图或锁定置顶，请不要关闭该窗口。是否继续？");
  if (!confirmed) return;
  const options = {
    concurrency: clamp(parsePositiveInteger(elements.concurrencyInput.value, 2), 1, 8),
    delayMs: Math.max(500, Number(elements.delayInput.value || 0.8) * 1000),
    waitMs: Math.max(3000, Number(elements.waitInput.value || 12) * 1000),
    includeScreenshotWorkbook: elements.screenshotWorkbookInput.checked,
    ...getCaptureSizeOptions(),
  };
  const response = await sendMessage({
    type: "START",
    tasks: parsedTasks,
    options,
    sourceRows: currentRows || [],
    sourceFileName: currentFileName,
  });
  if (!response || !response.ok) {
    addLog(response && response.error ? response.error : "启动失败", "failed");
    return;
  }
  addLog(`已启动：${parsedTasks.length} 条，并发 ${options.concurrency}`);
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
  const pending = Math.max(0, total - success - failed - (state.runningCount || 0));
  renderCounts({ total, success, failed, pending });
  if (state.status === "running") setBadge("运行中", "running");
  else if (state.status === "paused") setBadge("已暂停", "paused");
  else if (state.status === "done") setBadge("已完成", "done");
  else if (parsedTasks.length) setBadge("已就绪", "done");
  else setBadge("待导入", "");
  const running = state.status === "running" || state.status === "paused";
  elements.startButton.disabled = !parsedTasks.length || running;
  elements.pauseButton.disabled = state.status !== "running";
  elements.resumeButton.disabled = state.status !== "paused";
  elements.stopButton.disabled = !running;
  elements.fileInput.disabled = running;
  elements.limitInput.disabled = running;
  elements.sequenceModeInput.disabled = running;
  elements.screenshotWorkbookInput.disabled = running;
  elements.captureSizeModeInput.disabled = running;
  elements.captureWidthInput.disabled = running || elements.captureSizeModeInput.value !== "custom";
  elements.captureHeightInput.disabled = running || elements.captureSizeModeInput.value !== "custom";
  renderLogs(state.logs || []);
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

function renderCounts({ total, success, failed, pending }) {
  elements.totalCount.textContent = total;
  elements.successCount.textContent = success;
  elements.failedCount.textContent = failed;
  elements.pendingCount.textContent = pending;
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
    row.querySelector(".task-name").textContent = `${task.rowNumber} · ${task.fileName}`;
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
  elements.logList.scrollTop = elements.logList.scrollHeight;
}

function addLog(message, level = "") {
  const row = document.createElement("div");
  row.className = `log-row ${level}`;
  row.textContent = message;
  elements.logList.appendChild(row);
  elements.logList.scrollTop = elements.logList.scrollHeight;
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
