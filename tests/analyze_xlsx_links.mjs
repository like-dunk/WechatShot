import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import XLSX from "xlsx";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const filePath = path.resolve(__dirname, "../6.29双平台87条（猛士）(1).xlsx");

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
const TRAILING_PUNCTUATION = /[.,;!?，。；！？、）)】\]]+$/;

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
function getUrlPlatform(url) {
  try {
    const parsed = new URL(url);
    const host = parsed.hostname.toLowerCase();
    const pathName = parsed.pathname.toLowerCase();
    if ((host === "weixin.qq.com" && pathName.startsWith("/sph/")) || host === "channels.weixin.qq.com") return "weixin";
    if ((host === "m.toutiao.com" && ["/is/", "/video/"].some((p) => pathName.startsWith(p))) || ((host === "toutiao.com" || host === "www.toutiao.com") && ["/article/", "/w/", "/video/"].some((p) => pathName.startsWith(p)))) return "toutiao";
    if (host === "v.douyin.com" || ((host === "douyin.com" || host === "www.douyin.com") && ["/video/", "/note/"].some((p) => pathName.startsWith(p)))) return "douyin";
    if (host === "xhslink.com" || ((host === "xiaohongshu.com" || host === "www.xiaohongshu.com") && ["/explore/", "/discovery/item/"].some((p) => pathName.startsWith(p)))) return "xiaohongshu";
    return "";
  } catch {
    return "";
  }
}
function hasCellValue(row) {
  return (row || []).some((value) => String(value || "").trim());
}
function normalizeHeader(value) {
  return String(value || "").trim().toLowerCase().replace(/\s+/g, "");
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
function findLikelyHeaderRowIndex(rows) {
  let best = { rowIndex: -1, score: -1 };
  for (let rowIndex = 0; rowIndex < Math.min(rows.length, 20); rowIndex += 1) {
    const row = rows[rowIndex] || [];
    let score = 0;
    row.forEach((cell) => { score += scoreHeaderRowCell(cell); });
    if (score > best.score) best = { rowIndex, score };
  }
  if (best.rowIndex >= 0 && best.score > 0) return best.rowIndex;
  return 0;
}
function scanColumn(rows, headerRowIndex, columnIndex) {
  const stats = { rowCount: 0, nonEmptyCount: 0, videoUrlCount: 0, videoUrlRowCount: 0 };
  for (let rowIndex = headerRowIndex + 1; rowIndex < rows.length; rowIndex += 1) {
    const row = rows[rowIndex] || [];
    if (!hasCellValue(row)) continue;
    stats.rowCount += 1;
    const value = String(row[columnIndex] || "").trim();
    if (!value) continue;
    stats.nonEmptyCount += 1;
    const urls = extractVideoUrls(value).filter((url) => getUrlPlatform(url));
    stats.videoUrlCount += urls.length;
    if (urls.length) stats.videoUrlRowCount += 1;
  }
  return stats;
}
function scoreLinkColumn(stats, headerScore) {
  if (!stats.videoUrlCount) return headerScore;
  const videoRatio = stats.nonEmptyCount ? stats.videoUrlCount / stats.nonEmptyCount : 0;
  return stats.videoUrlCount * 20 + videoRatio * 80 + headerScore;
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

const workbook = XLSX.read(fs.readFileSync(filePath), { type: "buffer", cellHyperlinks: true });
const sheetName = workbook.SheetNames[0];
const sheet = workbook.Sheets[sheetName];
const range = XLSX.utils.decode_range(sheet["!ref"] || "A1");
const rows = [];
for (let r = range.s.r; r <= range.e.r; r += 1) {
  const row = [];
  for (let c = range.s.c; c <= range.e.c; c += 1) {
    const addr = XLSX.utils.encode_cell({ r, c });
    const cell = sheet[addr];
    if (!cell) { row[c - range.s.c] = ""; continue; }
    let value = cell.w != null ? cell.w : (cell.v != null ? String(cell.v) : "");
    if (cell.l && cell.l.Target) {
      const target = cell.l.Target;
      const text = String(value || "").trim();
      if (!text || text === target || text.includes(target)) value = target;
      else if (extractVideoUrls(text).some((url) => getUrlPlatform(url))) value = text;
      else value = `${text} ${target}`;
    }
    row[c - range.s.c] = value;
  }
  rows.push(row);
}
while (rows.length && !hasCellValue(rows[rows.length - 1])) rows.pop();

const headerRowIndex = findLikelyHeaderRowIndex(rows);
const headerRow = rows[headerRowIndex] || [];
const maxCols = rows.reduce((m, row) => Math.max(m, (row || []).length), 0);

console.log(`总行数(含表头): ${rows.length}, 表头行: ${headerRowIndex + 1}`);
console.log("表头:", headerRow.map((h, i) => `${columnIndexToName(i)}=${h}`).filter((x) => !x.endsWith("=")).join(" | "));

const columns = [];
for (let columnIndex = 0; columnIndex < maxCols; columnIndex += 1) {
  const header = String(headerRow[columnIndex] || "").trim();
  const stats = scanColumn(rows, headerRowIndex, columnIndex);
  const headerScore = scoreHeader(header);
  const score = scoreLinkColumn(stats, headerScore);
  columns.push({ columnIndex, header, headerScore, score, ...stats });
}
const selected = columns
  .filter((c) => c.videoUrlCount > 0)
  .sort((a, b) => b.score - a.score || b.videoUrlCount - a.videoUrlCount || b.columnIndex - a.columnIndex)[0];

console.log("\n各列链接统计(有视频链接的列):");
columns.filter((c) => c.videoUrlCount > 0).sort((a, b) => b.videoUrlCount - a.videoUrlCount).forEach((c) => {
  console.log(`  ${columnIndexToName(c.columnIndex)}列「${c.header}」: ${c.videoUrlCount} 条链接 / ${c.videoUrlRowCount} 行 / score=${c.score}`);
});
console.log(`\n插件会选中: ${columnIndexToName(selected.columnIndex)}列「${selected.header}」=> ${selected.videoUrlCount} 条支持链接`);

const linkIndex = selected.columnIndex;
const taskRows = [];
for (let rowIndex = headerRowIndex + 1; rowIndex < rows.length; rowIndex += 1) {
  const row = rows[rowIndex] || [];
  if (!hasCellValue(row)) continue;
  const raw = String(row[linkIndex] || "").trim();
  const urls = extractVideoUrls(raw).map((url) => ({ url, platform: getUrlPlatform(url) })).filter((x) => x.platform);
  if (!urls.length) continue;
  const seq = row[0];
  const nickname = row[1] || row[2] || "";
  taskRows.push({ excelRow: rowIndex + 1, seq, nickname, raw, urls });
}

console.log(`\nbuildTasks 会生成 ${taskRows.reduce((n, r) => n + r.urls.length, 0)} 条任务, 来自 ${taskRows.length} 行`);

const multiLinkRows = taskRows.filter((r) => r.urls.length > 1);
if (multiLinkRows.length) {
  console.log("\n⚠️ 单行含多个链接的行:");
  multiLinkRows.forEach((r) => {
    console.log(`  第 ${r.excelRow} 行 序号=${r.seq} 昵称=${r.nickname} => ${r.urls.length} 条`);
    r.urls.forEach((u, i) => console.log(`    [${i + 1}] ${u.platform}: ${u.url}`));
    console.log(`    原始单元格: ${r.raw.slice(0, 200)}${r.raw.length > 200 ? "..." : ""}`);
  });
}

console.log("\n所有含链接的行:");
taskRows.forEach((r, i) => {
  const flag = r.urls.length > 1 ? " [多链接]" : "";
  console.log(`  ${i + 1}. Excel第${r.excelRow}行 序号=${r.seq} 链接数=${r.urls.length}${flag}`);
});

// Check sequence column
const seqValues = taskRows.map((r) => String(r.seq || "").trim()).filter(Boolean);
const numericSeqs = seqValues.filter((s) => /^\d+$/.test(s)).map(Number);
if (numericSeqs.length) {
  console.log(`\n序号列范围: ${Math.min(...numericSeqs)} - ${Math.max(...numericSeqs)}, 共 ${numericSeqs.length} 个`);
  const dup = numericSeqs.filter((s, i, arr) => arr.indexOf(s) !== i);
  if (dup.length) console.log("重复序号:", [...new Set(dup)]);
}

// Rows without links but with data
console.log("\n有数据但无支持链接的行:");
for (let rowIndex = headerRowIndex + 1; rowIndex < rows.length; rowIndex += 1) {
  const row = rows[rowIndex] || [];
  if (!hasCellValue(row)) continue;
  const urls = extractVideoUrls(String(row[linkIndex] || "")).filter((u) => getUrlPlatform(u));
  if (!urls.length) {
    console.log(`  第 ${rowIndex + 1} 行: 序号=${row[0]} 首列=${JSON.stringify(row.slice(0, 5))}`);
  }
}
