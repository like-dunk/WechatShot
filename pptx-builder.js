(() => {
  const CLIPPINGS_TEMPLATE_FILE = "发布剪报-模板(1)(1).pptx";
  const LINK_SCREENSHOT_TEMPLATE_FILE = "链接截图单图单页-模板.pptx";
  const RELEASE_INFO_SCREENSHOT_TEMPLATE_FILE = "新单图单页-模板.pptx";
  const DAWANQU_TEMPLATE_FILE = "【模版】AIGC-奕境X9粤港澳大湾区车展传播汇总.pptx";
  const OUTPUT_DIR_BASE = "截图";

  function formatLocalTimestamp(date) {
    const pad = (n) => String(n).padStart(2, "0");
    return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}_${pad(date.getHours())}-${pad(date.getMinutes())}-${pad(date.getSeconds())}`;
  }

  function getSessionOutputDir(sourceName) {
    const timestamp = formatLocalTimestamp(new Date());
    const baseName = String(sourceName || "").replace(/\.[^.]+$/, "").replace(/[\\/:*?"<>|\r\n\t]+/g, "").trim();
    const suffix = baseName ? `_${baseName}` : "";
    return `${OUTPUT_DIR_BASE}/${timestamp}${suffix}_PPT`;
  }
  const ZIP32_LIMIT = 0xffffffff;
  const MAX_SOURCE_ZIP_BYTES = 2 * 1024 * 1024 * 1024;
  const MAX_IMAGE_COUNT = 5000;
  const MAX_IMAGE_BYTES = 25 * 1024 * 1024;
  const MAX_OUTPUT_BYTES = Math.round(2.6 * 1024 * 1024 * 1024);
  const MAX_IMAGES_PER_SLIDE = 15;
  const INCH_EMU = 914400;
  const LINK_SCREENSHOT_TEMPLATE_INDEX = 3;
  const LINK_SCREENSHOT_PICTURE_WIDTH = 7 * INCH_EMU;
  const LINK_SCREENSHOT_LINK_GAP = 0.1 * INCH_EMU;
  const RELEASE_INFO_TEMPLATE_INDEX = 3;
  const RELEASE_INFO_DEFAULT_TITLE = "2026年2月华为车BU-华为乾崑&奕境马上有乾崑视频传播项目——AI扩散—社交媒体平台";
  const RELEASE_INFO_LAYOUT = {
    title: { x: 0.72 * INCH_EMU, y: 0.45 * INCH_EMU, cx: 10.9 * INCH_EMU, cy: 0.78 * INCH_EMU },
    text: { x: 0.9 * INCH_EMU, y: 1.45 * INCH_EMU, cx: 4.65 * INCH_EMU, cy: 0.5 * INCH_EMU, gap: 0.16 * INCH_EMU, lineHeight: 0.3 * INCH_EMU, charsPerLine: 25, maxBottom: 5.95 * INCH_EMU, fontSize: 14, fontSizes: [14, 13, 12, 11] },
    image: { x: 6.25 * INCH_EMU, y: 1.75 * INCH_EMU, cx: 5.55 * INCH_EMU, cy: 4.45 * INCH_EMU },
  };
  const LINK_SCREENSHOT_DEFAULT_PICTURE = {
    x: 0.8 * INCH_EMU,
    y: 2.5 * INCH_EMU,
  };
  // Annotation/placeholder labels on screenshot areas (e.g. "截图参考"). These are
  // only layout hints in custom templates and are removed before inserting the
  // real screenshot.
  const SCREENSHOT_HINT_PATTERN = /截图参考|截图位置|截图示例|此处放截图|放置截图|截图占位|示意图|参考图/;
  const RELEASE_INFO_LABEL_PATTERN = /发布账号|发布平台|发布标题|发布链接|发布时间/;
  const PML = "http://schemas.openxmlformats.org/presentationml/2006/main";
  const DML = "http://schemas.openxmlformats.org/drawingml/2006/main";
  const REL = "http://schemas.openxmlformats.org/officeDocument/2006/relationships";
  const PKG_REL = "http://schemas.openxmlformats.org/package/2006/relationships";
  const SLIDE_REL_TYPE = "http://schemas.openxmlformats.org/officeDocument/2006/relationships/slide";
  const IMAGE_REL_TYPE = "http://schemas.openxmlformats.org/officeDocument/2006/relationships/image";
  const SLIDE_CONTENT_TYPE = "application/vnd.openxmlformats-officedocument.presentationml.slide+xml";
  const LAYOUT = {
    x: 520000,
    y: 650000,
    cx: 11150000,
    cy: 5950000,
    gapX: 90000,
    gapY: 120000,
    maxRows: 3,
    maxCols: 15,
    minCellWidth: 250000,
    minCellHeight: 700000,
  };

  async function inspectZipFile(file) {
    if (file.size > MAX_SOURCE_ZIP_BYTES) throw new Error(`压缩包不能超过 ${formatBytes(MAX_SOURCE_ZIP_BYTES)}`);
    const entries = parseZipEntries(await file.arrayBuffer());
    const imageEntries = collectImageEntries(entries);
    validateImageEntries(imageEntries);
    return {
      imageCount: imageEntries.length,
      names: imageEntries.slice(0, 30).map((entry) => entry.name),
    };
  }

  async function inspectImageFiles(files) {
    const imageEntries = collectImageFileEntries(files);
    validateImageEntries(imageEntries);
    return {
      imageCount: imageEntries.length,
      names: imageEntries.slice(0, 30).map((entry) => entry.name),
    };
  }

  async function buildFromZipFile(file, options = {}) {
    const images = await readImagesFromZipFile(file);
    return buildFromImages(images, file.name, options);
  }

  async function buildFromImageFiles(files, sourceName, options = {}) {
    const { images, imageEntries } = await readImagesFromImageFiles(files);
    return buildFromImages(images, sourceName || getFolderNameFromImageEntries(imageEntries), options);
  }

  async function buildLinkScreenshotFromZipFile(file, tasks = [], options = {}) {
    const images = await readImagesFromZipFile(file);
    return buildLinkScreenshotFromImages(images, file.name, tasks, options);
  }

  async function buildLinkScreenshotFromImageFiles(files, sourceName, tasks = [], options = {}) {
    const { images, imageEntries } = await readImagesFromImageFiles(files);
    return buildLinkScreenshotFromImages(images, sourceName || getFolderNameFromImageEntries(imageEntries), tasks, options);
  }

  async function buildReleaseInfoScreenshotFromZipFile(file, tasks = [], options = {}) {
    const images = await readImagesFromZipFile(file);
    return buildReleaseInfoScreenshotFromImages(images, file.name, tasks, options);
  }

  async function buildReleaseInfoScreenshotFromImageFiles(files, sourceName, tasks = [], options = {}) {
    const { images, imageEntries } = await readImagesFromImageFiles(files);
    return buildReleaseInfoScreenshotFromImages(images, sourceName || getFolderNameFromImageEntries(imageEntries), tasks, options);
  }

  async function buildDawanquFromZipFile(file, tasks = [], options = {}) {
    const images = await readImagesFromZipFile(file);
    return buildDawanquFromImages(images, file.name, tasks, options);
  }

  async function buildDawanquFromImageFiles(files, sourceName, tasks = [], options = {}) {
    const { images, imageEntries } = await readImagesFromImageFiles(files);
    return buildDawanquFromImages(images, sourceName || getFolderNameFromImageEntries(imageEntries), tasks, options);
  }

  async function loadTemplateFiles(builtinName, templateBytes, errorMessage) {
    if (templateBytes && templateBytes.length) {
      const entries = parseZipEntries(toArrayBuffer(templateBytes));
      return readAllZipFiles(entries);
    }
    const templateResponse = await fetch(chrome.runtime.getURL(builtinName));
    if (!templateResponse.ok) throw new Error(errorMessage);
    const templateEntries = parseZipEntries(await templateResponse.arrayBuffer());
    return readAllZipFiles(templateEntries);
  }

  function toArrayBuffer(bytes) {
    if (bytes instanceof ArrayBuffer) return bytes;
    const view = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
    return view.buffer.slice(view.byteOffset, view.byteOffset + view.byteLength);
  }

  async function analyzeTemplateFile(file) {
    if (!file) throw new Error("请选择 PPT 模板文件");
    if (!/\.pptx$/i.test(file.name || "")) throw new Error("请选择 .pptx 模板文件");
    const bytes = new Uint8Array(await file.arrayBuffer());
    const entries = parseZipEntries(toArrayBuffer(bytes));
    const files = await readAllZipFiles(entries);
    if (!files.has("ppt/presentation.xml")) throw new Error("不是有效的 PPTX 模板");
    const recommendation = detectTemplateMode(files);
    return {
      name: file.name,
      bytes,
      mode: recommendation.mode,
      reason: recommendation.reason,
      slideCount: recommendation.slideCount,
    };
  }

  function detectTemplateMode(files) {
    const presentationDoc = parseXml(decodeText(files.get("ppt/presentation.xml")));
    const presentationRelsDoc = parseXml(decodeText(files.get("ppt/_rels/presentation.xml.rels")));
    const slides = getPresentationSlides(presentationDoc, presentationRelsDoc, files);
    const slideCount = slides.length;
    const allTexts = [];
    let maxPicCount = 0;
    let hasReleaseInfoFields = false;
    let hasLinkLikeText = false;
    slides.forEach((slide) => {
      const slidePath = `ppt/${slide.target}`;
      if (!files.has(slidePath)) return;
      const doc = parseXml(decodeText(files.get(slidePath)));
      const picCount = doc.getElementsByTagNameNS(PML, "pic").length;
      maxPicCount = Math.max(maxPicCount, picCount);
      const texts = getSlideTexts(files, slide.target);
      texts.forEach((text) => allTexts.push(text));
      const joined = texts.join("");
      if (/发布账号|发布平台|发布标题|发布时间/.test(joined)) hasReleaseInfoFields = true;
      if (/视频-|http|douyin\.com|发布链接/.test(joined)) hasLinkLikeText = true;
    });
    const joinedAll = allTexts.join("");
    if (hasReleaseInfoFields) {
      return { mode: "release-info-screenshot", slideCount, reason: "模板含发布账号/平台/标题/时间字段，匹配发布信息截图单图单页" };
    }
    if (/一页贴|长图|发布剪报/.test(joinedAll)) {
      return { mode: "clippings", slideCount, reason: "模板含发布剪报/一页贴长图版式，匹配发布剪报多图铺页" };
    }
    if (hasLinkLikeText) {
      return { mode: "link-screenshot", slideCount, reason: "模板含视频序号/链接文本框，匹配链接截图单图单页" };
    }
    if (maxPicCount >= 3) {
      return { mode: "clippings", slideCount, reason: "模板单页含多个图片占位，按发布剪报多图铺页处理" };
    }
    return { mode: "link-screenshot", slideCount, reason: "未识别到明确字段，默认按链接截图单图单页处理" };
  }

  async function readImagesFromZipFile(file) {
    if (file.size > MAX_SOURCE_ZIP_BYTES) throw new Error(`压缩包不能超过 ${formatBytes(MAX_SOURCE_ZIP_BYTES)}`);
    const sourceEntries = parseZipEntries(await file.arrayBuffer());
    const imageEntries = collectImageEntries(sourceEntries);
    if (!imageEntries.length) throw new Error("压缩包中没有找到 png、jpg、jpeg 或 webp 图片");
    validateImageEntries(imageEntries);
    const images = [];
    for (const entry of imageEntries) {
      const bytes = await readZipBinary(sourceEntries, entry.name, "zip");
      images.push(await normalizeImage(entry.name, bytes));
    }
    return images;
  }

  async function readImagesFromImageFiles(files) {
    const imageEntries = collectImageFileEntries(files);
    if (!imageEntries.length) throw new Error("文件夹中没有找到 png、jpg、jpeg 或 webp 图片");
    validateImageEntries(imageEntries);
    const images = [];
    for (const entry of imageEntries) {
      images.push(await normalizeImage(entry.name, new Uint8Array(await entry.file.arrayBuffer())));
    }
    return { images, imageEntries };
  }

  async function buildFromImages(images, sourceName, options = {}) {
    const pagePlan = createPagePlan(images);
    const files = await loadTemplateFiles(CLIPPINGS_TEMPLATE_FILE, options.templateBytes, "无法读取内置 PPT 模板");
    const bytes = buildPptx(files, pagePlan);
    if (bytes.length > MAX_OUTPUT_BYTES) throw new Error(`生成后的 PPT 超过 ${formatBytes(MAX_OUTPUT_BYTES)}，请减少图片数量或先压缩图片`);
    return {
      bytes,
      fileName: buildOutputFileName(sourceName),
      imageCount: images.length,
      slideCount: pagePlan.groups.length,
      imagesPerSlide: Math.max(...pagePlan.groups.map((group) => group.length)),
      grid: `${pagePlan.layout.rows}×${pagePlan.layout.cols}`,
    };
  }

  async function buildLinkScreenshotFromImages(images, sourceName, tasks = [], options = {}) {
    const files = await loadTemplateFiles(LINK_SCREENSHOT_TEMPLATE_FILE, options.templateBytes, "无法读取链接截图单图单页模板");
    const items = buildLinkScreenshotItems(images, tasks);
    const bytes = buildLinkScreenshotPptx(files, items);
    if (bytes.length > MAX_OUTPUT_BYTES) throw new Error(`生成后的 PPT 超过 ${formatBytes(MAX_OUTPUT_BYTES)}，请减少图片数量或先压缩图片`);
    return {
      bytes,
      fileName: buildLinkScreenshotOutputFileName(sourceName),
      imageCount: images.length,
      slideCount: items.length,
      imagesPerSlide: 1,
      grid: "1×1",
    };
  }

  async function buildReleaseInfoScreenshotFromImages(images, sourceName, tasks = [], options = {}) {
    const files = await loadTemplateFiles(RELEASE_INFO_SCREENSHOT_TEMPLATE_FILE, options.templateBytes, "无法读取发布信息截图单图单页模板");
    const preserveTemplateLayout = Boolean(options.templateBytes);
    const items = buildReleaseInfoScreenshotItems(images, tasks, options);
    const bytes = buildReleaseInfoScreenshotPptx(files, items, { preserveTemplateLayout });
    if (bytes.length > MAX_OUTPUT_BYTES) throw new Error(`生成后的 PPT 超过 ${formatBytes(MAX_OUTPUT_BYTES)}，请减少图片数量或先压缩图片`);
    return {
      bytes,
      fileName: buildReleaseInfoScreenshotOutputFileName(sourceName),
      imageCount: images.length,
      slideCount: items.length,
      imagesPerSlide: 1,
      grid: "1×1",
      fanMatchedCount: items.filter((item) => item.fanImage).length,
      playbackMatchedCount: items.filter((item) => item.playbackImage).length,
    };
  }

  async function buildDawanquFromImages(images, sourceName, tasks = [], options = {}) {
    const files = await loadTemplateFiles(DAWANQU_TEMPLATE_FILE, options.templateBytes, "无法读取大湾区崭新模版");
    const items = buildReleaseInfoScreenshotItems(images, tasks, options);
    const bytes = buildReleaseInfoScreenshotPptx(files, items, { preserveTemplateLayout: true });
    if (bytes.length > MAX_OUTPUT_BYTES) throw new Error(`生成后的 PPT 超过 ${formatBytes(MAX_OUTPUT_BYTES)}，请减少图片数量或先压缩图片`);
    return {
      bytes,
      fileName: buildDawanquOutputFileName(sourceName),
      imageCount: images.length,
      slideCount: items.length,
      imagesPerSlide: 1,
      grid: "1×1",
      fanMatchedCount: items.filter((item) => item.fanImage).length,
      playbackMatchedCount: items.filter((item) => item.playbackImage).length,
    };
  }

  async function downloadResult(result) {
    const blob = new Blob([result.bytes], { type: "application/vnd.openxmlformats-officedocument.presentationml.presentation" });
    const url = URL.createObjectURL(blob);
    try {
      await downloadBlobUrl(url, result.fileName);
    } finally {
      setTimeout(() => URL.revokeObjectURL(url), 60000);
    }
  }

  function validateImageEntries(imageEntries) {
    if (imageEntries.length > MAX_IMAGE_COUNT) throw new Error(`插件内生成最多支持 ${MAX_IMAGE_COUNT} 张图片；更多图片建议使用本地脚本生成`);
    const oversized = imageEntries.find((entry) => entry.uncompressedSize > MAX_IMAGE_BYTES);
    if (oversized) throw new Error(`单张图片不能超过 ${formatBytes(MAX_IMAGE_BYTES)}：${oversized.name}`);
  }

  function formatBytes(bytes) {
    const GB = 1024 * 1024 * 1024;
    if (bytes >= GB) return `${(bytes / GB).toFixed(bytes >= 10 * GB ? 0 : 1)} GB`;
    if (bytes >= 1024 * 1024) return `${Math.round(bytes / 1024 / 1024)} MB`;
    if (bytes >= 1024) return `${Math.round(bytes / 1024)} KB`;
    return `${bytes} B`;
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
    if (eocdOffset < 0) throw new Error("不是有效的 zip 文件");
    const entryCount = view.getUint16(eocdOffset + 10, true);
    const centralDirOffset = view.getUint32(eocdOffset + 16, true);
    const entries = new Map();
    let offset = centralDirOffset;
    for (let index = 0; index < entryCount; index += 1) {
      if (view.getUint32(offset, true) !== 0x02014b50) throw new Error("zip 中央目录损坏");
      const flags = view.getUint16(offset + 8, true);
      const method = view.getUint16(offset + 10, true);
      const compressedSize = view.getUint32(offset + 20, true);
      const uncompressedSize = view.getUint32(offset + 24, true);
      const fileNameLength = view.getUint16(offset + 28, true);
      const extraLength = view.getUint16(offset + 30, true);
      const commentLength = view.getUint16(offset + 32, true);
      const localHeaderOffset = view.getUint32(offset + 42, true);
      const nameBytes = bytes.slice(offset + 46, offset + 46 + fileNameLength);
      const name = new TextDecoder(flags & 0x0800 ? "utf-8" : "utf-8").decode(nameBytes);
      entries.set(name, { name, method, compressedSize, uncompressedSize, localHeaderOffset, arrayBuffer });
      offset += 46 + fileNameLength + extraLength + commentLength;
    }
    return entries;
  }

  async function readZipBinary(entries, name, label) {
    const entry = entries.get(name);
    if (!entry) throw new Error(`${label || "zip"} 缺少文件：${name}`);
    const view = new DataView(entry.arrayBuffer);
    const bytes = new Uint8Array(entry.arrayBuffer);
    const localOffset = entry.localHeaderOffset;
    if (view.getUint32(localOffset, true) !== 0x04034b50) throw new Error(`${label || "zip"} 本地文件头损坏：${name}`);
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
      throw new Error(`zip 压缩格式不支持：${entry.method}`);
    }
    if (entry.uncompressedSize && data.length !== entry.uncompressedSize) {
      data = data.slice(0, entry.uncompressedSize);
    }
    return data;
  }

  async function inflateRaw(bytes) {
    if (!globalThis.DecompressionStream) throw new Error("当前 Chrome 版本不支持解析 zip");
    const stream = new Blob([bytes]).stream().pipeThrough(new DecompressionStream("deflate-raw"));
    return new Uint8Array(await new Response(stream).arrayBuffer());
  }

  function collectImageEntries(entries) {
    const items = Array.from(entries.values()).filter((entry) => isImageZipEntry(entry.name));
    return sortImageEntries(items);
  }

  function collectImageFileEntries(files) {
    const items = Array.from(files || [])
      .map((file) => ({
        name: file.webkitRelativePath || file.name,
        file,
        uncompressedSize: file.size,
      }))
      .filter((entry) => isImageZipEntry(entry.name));
    return sortImageEntries(items);
  }

  function sortImageEntries(items) {
    const collator = new Intl.Collator("zh-CN", { numeric: true, sensitivity: "base" });
    return items.sort((left, right) => collator.compare(left.name, right.name));
  }

  function isImageZipEntry(name) {
    const normalized = String(name || "").replace(/\\/g, "/");
    const fileName = normalized.split("/").pop() || "";
    if (!fileName || normalized.endsWith("/") || normalized.startsWith("__MACOSX/") || fileName.startsWith(".")) return false;
    return /\.(?:png|jpe?g|webp)$/i.test(fileName);
  }

  function getFolderNameFromImageEntries(imageEntries) {
    const normalized = String(imageEntries[0] && imageEntries[0].name || "").replace(/\\/g, "/");
    const parts = normalized.split("/").filter(Boolean);
    return parts.length > 1 ? parts[0] : "截图文件夹";
  }

  async function normalizeImage(name, bytes) {
    const original = getImageType(name);
    const blob = new Blob([bytes], { type: original.mime });
    const loaded = await loadImage(blob);
    try {
      if (original.ext === "webp") {
        const canvas = document.createElement("canvas");
        canvas.width = loaded.image.naturalWidth;
        canvas.height = loaded.image.naturalHeight;
        const context = canvas.getContext("2d");
        context.drawImage(loaded.image, 0, 0);
        const pngBlob = await new Promise((resolve, reject) => {
          canvas.toBlob((result) => result ? resolve(result) : reject(new Error("WebP 转 PNG 失败")), "image/png");
        });
        return {
          name,
          data: new Uint8Array(await pngBlob.arrayBuffer()),
          ext: "png",
          mime: "image/png",
          width: loaded.image.naturalWidth,
          height: loaded.image.naturalHeight,
        };
      }
      return {
        name,
        data: bytes,
        ext: original.mime === "image/jpeg" ? "jpeg" : original.ext,
        mime: original.mime,
        width: loaded.image.naturalWidth,
        height: loaded.image.naturalHeight,
      };
    } finally {
      URL.revokeObjectURL(loaded.url);
    }
  }

  function getImageType(name) {
    const extension = String(name || "").split(".").pop().toLowerCase();
    if (extension === "jpg" || extension === "jpeg") return { ext: extension, mime: "image/jpeg" };
    if (extension === "webp") return { ext: "webp", mime: "image/webp" };
    return { ext: "png", mime: "image/png" };
  }

  function loadImage(blob) {
    return new Promise((resolve, reject) => {
      const url = URL.createObjectURL(blob);
      const image = new Image();
      image.onload = () => resolve({ image, url });
      image.onerror = () => {
        URL.revokeObjectURL(url);
        reject(new Error("图片读取失败"));
      };
      image.src = url;
    });
  }

  async function readAllZipFiles(entries) {
    const files = new Map();
    for (const entry of entries.values()) {
      files.set(entry.name, await readZipBinary(entries, entry.name, "pptx"));
    }
    return files;
  }

  function createPagePlan(images) {
    const maxPerSlideLayout = chooseLayout(images, Math.min(images.length, MAX_IMAGES_PER_SLIDE));
    const pageCount = Math.ceil(images.length / maxPerSlideLayout.count);
    const groupSizes = distributeGroupSizes(images.length, pageCount);
    const layout = chooseLayout(images, Math.max(...groupSizes));
    const groups = [];
    let offset = 0;
    groupSizes.forEach((size) => {
      groups.push(images.slice(offset, offset + size));
      offset += size;
    });
    return { layout, groups };
  }

  function distributeGroupSizes(total, groupCount) {
    const base = Math.floor(total / groupCount);
    const extra = total % groupCount;
    return Array.from({ length: groupCount }, (_, index) => base + (index < extra ? 1 : 0));
  }

  function chooseLayout(images, targetCount) {
    const aspect = median(images.map((image) => image.width && image.height ? image.width / image.height : 1));
    const total = Math.max(1, Math.min(targetCount || images.length, MAX_IMAGES_PER_SLIDE));
    let best = null;
    for (let rows = 1; rows <= LAYOUT.maxRows; rows += 1) {
      for (let cols = 1; cols <= LAYOUT.maxCols; cols += 1) {
        const count = rows * cols;
        if (count > MAX_IMAGES_PER_SLIDE) continue;
        if (count < total) continue;
        const cellWidth = (LAYOUT.cx - (cols - 1) * LAYOUT.gapX) / cols;
        const cellHeight = (LAYOUT.cy - (rows - 1) * LAYOUT.gapY) / rows;
        if (cellWidth < LAYOUT.minCellWidth || cellHeight < LAYOUT.minCellHeight) continue;
        const cellAspect = cellWidth / cellHeight;
        const aspectPenalty = Math.min(2, Math.abs(Math.log(cellAspect / aspect)));
        const emptySlots = total <= count ? count - total : 0;
        const onePageBonus = total <= count ? 0.35 : 0;
        const countScore = total > count ? count * 0.055 : Math.min(total, count) * 0.055;
        const score = countScore + onePageBonus - emptySlots * 0.03 - aspectPenalty * 0.45;
        if (!best || score > best.score) {
          best = { ...LAYOUT, rows, cols, count, cellWidth, cellHeight, score };
        }
      }
    }
    return best || { ...LAYOUT, rows: 2, cols: 5, count: 10, cellWidth: (LAYOUT.cx - 4 * LAYOUT.gapX) / 5, cellHeight: (LAYOUT.cy - LAYOUT.gapY) / 2 };
  }

  function median(values) {
    const numbers = values.filter((value) => Number.isFinite(value) && value > 0).sort((left, right) => left - right);
    if (!numbers.length) return 1;
    return numbers[Math.floor(numbers.length / 2)];
  }

  function buildPptx(files, pagePlan) {
    const { groups, layout } = pagePlan;
    const presentationDoc = parseXml(decodeText(files.get("ppt/presentation.xml")));
    const presentationRelsDoc = parseXml(decodeText(files.get("ppt/_rels/presentation.xml.rels")));
    const contentTypesDoc = parseXml(decodeText(files.get("[Content_Types].xml")));
    const slides = getPresentationSlides(presentationDoc, presentationRelsDoc, files);
    const releaseIndex = findReleaseSlideIndex(slides, files);
    const releaseSlide = slides[releaseIndex];
    const baseSlideXml = decodeText(files.get(`ppt/${releaseSlide.target}`));
    const baseSlideFileName = releaseSlide.target.split("/").pop();
    const baseRelsPath = `ppt/slides/_rels/${baseSlideFileName}.rels`;
    const baseRelsXml = decodeText(files.get(baseRelsPath));
    const title = "发布剪报";
    let nextSlideNumber = getNextSlideNumber(files);
    let nextSlideId = getMaxSlideId(presentationDoc) + 1;
    let nextPresentationRelId = getNextRelNumber(presentationRelsDoc);
    let nextMediaNumber = getNextMediaNumber(files);
    let slideInsertAnchor = releaseSlide.node;
    for (let pageIndex = 0; pageIndex < groups.length; pageIndex += 1) {
      const pageImages = groups[pageIndex];
      const isFirst = pageIndex === 0;
      const slideTarget = isFirst ? releaseSlide.target : `slides/slide${nextSlideNumber}.xml`;
      const slideFileName = slideTarget.split("/").pop();
      const relsPath = `ppt/slides/_rels/${slideFileName}.rels`;
      const imageLinks = pageImages.map((image) => {
        const mediaName = `image${nextMediaNumber}.${image.ext}`;
        nextMediaNumber += 1;
        files.set(`ppt/media/${mediaName}`, image.data);
        return { ...image, relId: "", target: `../media/${mediaName}` };
      });
      const slideRels = buildSlideRelationships(baseRelsXml, imageLinks);
      const slideXml = buildSlideXml(baseSlideXml, imageLinks, layout, title);
      files.set(`ppt/${slideTarget}`, encodeText(slideXml));
      files.set(relsPath, encodeText(slideRels));
      ensureSlideOverride(contentTypesDoc, `/ppt/${slideTarget}`);
      if (!isFirst) {
        const relId = `rId${nextPresentationRelId}`;
        nextPresentationRelId += 1;
        addPresentationRelationship(presentationRelsDoc, relId, slideTarget);
        slideInsertAnchor = addPresentationSlideId(presentationDoc, slideInsertAnchor, nextSlideId, relId);
        nextSlideId += 1;
        nextSlideNumber += 1;
      }
    }
    ensureImageContentTypes(contentTypesDoc);
    files.set("ppt/presentation.xml", encodeText(serializeXml(presentationDoc)));
    files.set("ppt/_rels/presentation.xml.rels", encodeText(serializeXml(presentationRelsDoc)));
    files.set("[Content_Types].xml", encodeText(serializeXml(contentTypesDoc)));
    updateAppSlideCount(files, slides.length + groups.length - 1);
    return createZip(Array.from(files.entries()).map(([name, data]) => ({ name, data })));
  }

  function buildLinkScreenshotItems(images, tasks) {
    const availableTasks = Array.isArray(tasks) ? tasks : [];
    const usedTaskIndexes = new Set();
    const taskNameMap = new Map();
    availableTasks.forEach((task, index) => {
      const key = normalizeBaseName(task && task.fileName);
      if (key && !taskNameMap.has(key)) taskNameMap.set(key, index);
    });
    return images.map((image, index) => {
      const match = findTaskIndexForImage(image, index, availableTasks, usedTaskIndexes, taskNameMap);
      const taskIndex = match.index;
      const task = taskIndex >= 0 ? availableTasks[taskIndex] : null;
      if (taskIndex >= 0) usedTaskIndexes.add(taskIndex);
      const fallbackName = getBaseFileName(image.name);
      return {
        image,
        task,
        exactTaskMatch: Boolean(match.exact && task),
        sequence: normalizeLinkScreenshotText(task && task.sequence) || deriveSequenceFromImageName(image.name) || String(index + 1),
        linkText: normalizeLinkScreenshotText(task && task.url) || fallbackName,
        nickname: normalizeLinkScreenshotText(task && task.nickname) || fallbackName,
      };
    });
  }

  function buildReleaseInfoScreenshotItems(images, tasks, options = {}) {
    const title = normalizeLinkScreenshotText(options.title) || RELEASE_INFO_DEFAULT_TITLE;
    const availableTasks = Array.isArray(tasks) ? tasks : [];
    const fanMap = buildAuxImageMap(options.fanImages || [], availableTasks);
    const playbackMap = buildAuxImageMap(options.playbackImages || [], availableTasks);
    return buildLinkScreenshotItems(images, availableTasks).map((item) => {
      const task = item.task || {};
      const releaseInfo = task.releaseInfo || {};
      const fanImage = item.task
        ? resolveAuxImageForTask(item.task, fanMap) || resolveAuxImageFromImageName(item.image, fanMap)
        : null;
      const playbackImage = item.task
        ? resolveAuxImageForTask(item.task, playbackMap) || resolveAuxImageFromImageName(item.image, playbackMap)
        : null;
      return {
        image: item.image,
        fanImage,
        playbackImage,
        title,
        account: normalizeLinkScreenshotText(releaseInfo.account) || normalizeLinkScreenshotText(task.nickname) || item.nickname,
        platform: normalizeLinkScreenshotText(releaseInfo.platform) || normalizeLinkScreenshotText(task.platformLabel),
        publishTitle: normalizeLinkScreenshotText(releaseInfo.title),
        link: normalizeLinkScreenshotText(releaseInfo.link) || normalizeLinkScreenshotText(task.url) || item.linkText,
        time: normalizeLinkScreenshotText(releaseInfo.time),
      };
    });
  }

  function normalizeAuxSequence(sequence) {
    const text = String(sequence == null ? "" : sequence).trim();
    if (/^\d+(\.0+)?$/.test(text)) return String(parseInt(text, 10));
    return text;
  }

  function getTaskAuxSequence(task) {
    if (task && task.importSequence != null && String(task.importSequence).trim() !== "") {
      return task.importSequence;
    }
    return task && task.sequence;
  }

  function findTaskForAuxParsed(parsed, tasks) {
    if (!parsed || !Array.isArray(tasks) || !tasks.length) return null;
    const targetSeq = normalizeAuxSequence(parsed.sequence);
    const targetNick = sanitizeFilenamePart(parsed.nickname, "").toLowerCase();
    return tasks.find((task) => {
      if (!task) return false;
      const nick = sanitizeFilenamePart(task.nickname, "").toLowerCase();
      if (nick !== targetNick) return false;
      const fileSeq = parseAuxImageKey(getBaseFileName(task.fileName));
      const candidates = [task.importSequence, task.sequence, fileSeq && fileSeq.sequence];
      return candidates.some((seq) => seq != null && String(seq).trim() !== "" && normalizeAuxSequence(seq) === targetSeq);
    }) || null;
  }

  function sanitizeFilenamePart(value) {
    let text = value == null ? "" : String(value).trim();
    // Windows 版 Chrome downloads API 禁止 ASCII ~，全角 ～（U+FF5E）视觉一致且跨平台可下载
    text = text.replace(/~/g, "\uFF5E").replace(/[\\/:*?"<>|\r\n\t]+/g, "").replace(/\s+/g, "_").replace(/^[._ ]+|[._ ]+$/g, "");
    return text.slice(0, 80);
  }

  function normalizeAuxMatchKey(sequence, nickname) {
    const seq = normalizeAuxSequence(sequence);
    const nick = sanitizeFilenamePart(nickname, "").toLowerCase();
    return `${seq}_${nick}`;
  }

  function parseAuxImageKey(name) {
    const base = getBaseFileName(name);
    const index = base.indexOf("_");
    if (index < 0) return null;
    return {
      sequence: base.slice(0, index).trim(),
      nickname: base.slice(index + 1).trim(),
    };
  }

  // 通用「序号_昵称」辅助图匹配算法，粉丝量截图与后台播放数据截图共用同一份实现。
  function buildAuxImageMap(auxImages, tasks = []) {
    const map = new Map();
    const availableTasks = Array.isArray(tasks) ? tasks : [];
    (auxImages || []).forEach((image) => {
      const parsed = parseAuxImageKey(image && image.name);
      if (!parsed) return;
      const fileKey = normalizeAuxMatchKey(parsed.sequence, parsed.nickname);
      if (fileKey && !map.has(fileKey)) map.set(fileKey, image);
      // 与 Excel 内嵌路径一致：手动上传的「序号_昵称」若能对应到某条任务，
      // 再按该任务权威的 importSequence+昵称 注册一份，避免 Excel 序号列与插件连续编号不一致时对不上。
      const task = findTaskForAuxParsed(parsed, availableTasks);
      if (task) {
        const taskKey = normalizeAuxMatchKey(getTaskAuxSequence(task), task.nickname);
        if (taskKey && !map.has(taskKey)) map.set(taskKey, image);
      }
    });
    return map;
  }

  function resolveAuxImageFromImageName(image, auxMap) {
    if (!image || !auxMap || !auxMap.size) return null;
    const parsed = parseAuxImageKey(image.name);
    if (!parsed) return null;
    return auxMap.get(normalizeAuxMatchKey(parsed.sequence, parsed.nickname)) || null;
  }

  function resolveAuxImageForTask(task, auxMap) {
    if (!task || !auxMap || !auxMap.size) return null;
    const key = normalizeAuxMatchKey(getTaskAuxSequence(task), task.nickname);
    return auxMap.get(key) || null;
  }

  async function loadImagesFromPptSource(source) {
    if (!source) return [];
    if (source.type === "zip") return readImagesFromZipFile(source.file);
    const { images } = await readImagesFromImageFiles(source.files);
    return images;
  }

  async function loadImagesFromCacheRecord(record) {
    if (!record || !Array.isArray(record.files) || !record.files.length) return [];
    const images = [];
    for (const file of record.files) {
      const bytes = new Uint8Array(await file.blob.arrayBuffer());
      images.push(await normalizeImage(file.fileName, bytes));
    }
    return images;
  }

  function findTaskIndexForImage(image, index, tasks, usedTaskIndexes, taskNameMap) {
    const key = normalizeBaseName(image && image.name);
    const exactIndex = taskNameMap.has(key) ? taskNameMap.get(key) : -1;
    if (exactIndex >= 0 && !usedTaskIndexes.has(exactIndex)) return { index: exactIndex, exact: true };
    if (tasks[index] && !usedTaskIndexes.has(index)) return { index, exact: false };
    const fallbackIndex = tasks.findIndex((task, taskIndex) => task && !usedTaskIndexes.has(taskIndex));
    return { index: fallbackIndex, exact: false };
  }

  function buildLinkScreenshotPptx(files, items) {
    const presentationDoc = parseXml(decodeText(files.get("ppt/presentation.xml")));
    const presentationRelsDoc = parseXml(decodeText(files.get("ppt/_rels/presentation.xml.rels")));
    const contentTypesDoc = parseXml(decodeText(files.get("[Content_Types].xml")));
    const slides = getPresentationSlides(presentationDoc, presentationRelsDoc, files);
    if (!slides.length) throw new Error("链接截图单图单页模板中没有幻灯片");
    const templateIndex = Math.min(LINK_SCREENSHOT_TEMPLATE_INDEX, slides.length - 1);
    const templateSlide = slides[templateIndex];
    const baseSlideXml = decodeText(files.get(`ppt/${templateSlide.target}`));
    const baseSlideFileName = templateSlide.target.split("/").pop();
    const baseRelsPath = `ppt/slides/_rels/${baseSlideFileName}.rels`;
    const baseRelsXml = files.has(baseRelsPath) ? decodeText(files.get(baseRelsPath)) : emptyRelationshipsXml();
    let nextSlideNumber = getNextSlideNumber(files);
    let nextSlideId = getMaxSlideId(presentationDoc) + 1;
    let nextPresentationRelId = getNextRelNumber(presentationRelsDoc);
    let nextMediaNumber = getNextMediaNumber(files);
    let slideInsertAnchor = templateSlide.node;
    items.forEach((item, index) => {
      const isFirst = index === 0;
      const slideTarget = isFirst ? templateSlide.target : `slides/slide${nextSlideNumber}.xml`;
      const slideFileName = slideTarget.split("/").pop();
      const relsPath = `ppt/slides/_rels/${slideFileName}.rels`;
      const mediaName = `image${nextMediaNumber}.${item.image.ext}`;
      nextMediaNumber += 1;
      const imageLink = {
        ...item.image,
        relId: "",
        target: `../media/${mediaName}`,
      };
      files.set(`ppt/media/${mediaName}`, item.image.data);
      const slideRels = buildLinkScreenshotRelationships(baseRelsXml, imageLink);
      const slideXml = buildLinkScreenshotSlideXml(baseSlideXml, imageLink, item);
      files.set(`ppt/${slideTarget}`, encodeText(slideXml));
      files.set(relsPath, encodeText(slideRels));
      ensureSlideOverride(contentTypesDoc, `/ppt/${slideTarget}`);
      if (!isFirst) {
        const relId = `rId${nextPresentationRelId}`;
        nextPresentationRelId += 1;
        addPresentationRelationship(presentationRelsDoc, relId, slideTarget);
        slideInsertAnchor = addPresentationSlideId(presentationDoc, slideInsertAnchor, nextSlideId, relId);
        nextSlideId += 1;
        nextSlideNumber += 1;
      }
    });
    ensureImageContentTypes(contentTypesDoc);
    files.set("ppt/presentation.xml", encodeText(serializeXml(presentationDoc)));
    files.set("ppt/_rels/presentation.xml.rels", encodeText(serializeXml(presentationRelsDoc)));
    files.set("[Content_Types].xml", encodeText(serializeXml(contentTypesDoc)));
    updateAppSlideCount(files, slides.length + items.length - 1);
    return createZip(Array.from(files.entries()).map(([name, data]) => ({ name, data })));
  }

  function buildReleaseInfoScreenshotPptx(files, items, options = {}) {
    const preserveTemplateLayout = Boolean(options.preserveTemplateLayout);
    const presentationDoc = parseXml(decodeText(files.get("ppt/presentation.xml")));
    const presentationRelsDoc = parseXml(decodeText(files.get("ppt/_rels/presentation.xml.rels")));
    const contentTypesDoc = parseXml(decodeText(files.get("[Content_Types].xml")));
    const slides = getPresentationSlides(presentationDoc, presentationRelsDoc, files);
    if (!slides.length) throw new Error("发布信息截图单图单页模板中没有幻灯片");
    const templateIndex = preserveTemplateLayout
      ? findReleaseInfoTemplateSlideIndex(slides, files)
      : Math.min(RELEASE_INFO_TEMPLATE_INDEX, slides.length - 1);
    const templateSlide = slides[templateIndex];
    const baseSlideXml = decodeText(files.get(`ppt/${templateSlide.target}`));
    const baseSlideFileName = templateSlide.target.split("/").pop();
    const baseRelsPath = `ppt/slides/_rels/${baseSlideFileName}.rels`;
    const baseRelsXml = files.has(baseRelsPath) ? decodeText(files.get(baseRelsPath)) : emptyRelationshipsXml();
    let nextSlideNumber = getNextSlideNumber(files);
    let nextSlideId = getMaxSlideId(presentationDoc) + 1;
    let nextPresentationRelId = getNextRelNumber(presentationRelsDoc);
    let nextMediaNumber = getNextMediaNumber(files);
    let slideInsertAnchor = templateSlide.node;
    items.forEach((item, index) => {
      const isFirst = index === 0;
      const slideTarget = isFirst ? templateSlide.target : `slides/slide${nextSlideNumber}.xml`;
      const slideFileName = slideTarget.split("/").pop();
      const relsPath = `ppt/slides/_rels/${slideFileName}.rels`;
      const registerMedia = (image) => {
        const mediaName = `image${nextMediaNumber}.${image.ext}`;
        nextMediaNumber += 1;
        const link = { ...image, relId: "", target: `../media/${mediaName}` };
        files.set(`ppt/media/${mediaName}`, image.data);
        return link;
      };
      // imageLinks 用 kind 显式区分 main/fan/playback，不能再用数组下标隐式代表某一种辅助图：
      // 辅助图现在可能是「仅粉丝」「仅播放」「两者都有」三种情况之一，位置下标 1 在
      // 「仅播放、无粉丝」时会指向播放图而非粉丝图，若渲染层继续假定下标 1 恒为粉丝图，
      // 会把播放图错误地渲染成粉丝图占位（标签、位置都会用错）。
      const imageLinks = { main: registerMedia(item.image) };
      if (item.fanImage) imageLinks.fan = registerMedia(item.fanImage);
      if (item.playbackImage) imageLinks.playback = registerMedia(item.playbackImage);
      const slideRels = buildReleaseInfoSlideRelationships(baseRelsXml, Object.values(imageLinks));
      const slideXml = preserveTemplateLayout
        ? buildReleaseInfoTemplateSlideXml(baseSlideXml, imageLinks, item)
        : buildReleaseInfoScreenshotSlideXml(baseSlideXml, imageLinks, item);
      files.set(`ppt/${slideTarget}`, encodeText(slideXml));
      files.set(relsPath, encodeText(slideRels));
      ensureSlideOverride(contentTypesDoc, `/ppt/${slideTarget}`);
      if (!isFirst) {
        const relId = `rId${nextPresentationRelId}`;
        nextPresentationRelId += 1;
        addPresentationRelationship(presentationRelsDoc, relId, slideTarget);
        slideInsertAnchor = addPresentationSlideId(presentationDoc, slideInsertAnchor, nextSlideId, relId);
        nextSlideId += 1;
        nextSlideNumber += 1;
      }
    });
    ensureImageContentTypes(contentTypesDoc);
    files.set("ppt/presentation.xml", encodeText(serializeXml(presentationDoc)));
    files.set("ppt/_rels/presentation.xml.rels", encodeText(serializeXml(presentationRelsDoc)));
    files.set("[Content_Types].xml", encodeText(serializeXml(contentTypesDoc)));
    updateAppSlideCount(files, slides.length + items.length - 1);
    return createZip(Array.from(files.entries()).map(([name, data]) => ({ name, data })));
  }

  function buildReleaseInfoSlideRelationships(baseRelsXml, images) {
    const doc = parseXml(baseRelsXml || emptyRelationshipsXml());
    const root = doc.documentElement;
    Array.from(root.getElementsByTagNameNS(PKG_REL, "Relationship")).forEach((rel) => {
      if (shouldRemoveLinkScreenshotRelationship(rel)) rel.parentNode.removeChild(rel);
    });
    (images || []).forEach((image) => {
      const relId = `rId${getNextRelNumber(doc)}`;
      image.relId = relId;
      const rel = doc.createElementNS(PKG_REL, "Relationship");
      rel.setAttribute("Id", relId);
      rel.setAttribute("Type", IMAGE_REL_TYPE);
      rel.setAttribute("Target", image.target);
      root.appendChild(rel);
    });
    return serializeXml(doc);
  }

  function buildLinkScreenshotRelationships(baseRelsXml, image) {
    return buildReleaseInfoSlideRelationships(baseRelsXml, [image]);
  }

  function shouldRemoveLinkScreenshotRelationship(rel) {
    const type = rel.getAttribute("Type") || "";
    return type === IMAGE_REL_TYPE || /\/(?:notesSlide|tags)$/i.test(type);
  }

  function buildLinkScreenshotSlideXml(baseSlideXml, image, item) {
    const doc = parseXml(baseSlideXml);
    const linkGeometry = updateLinkScreenshotTexts(doc, item);
    const pictureOrigin = removeLinkScreenshotPictures(doc, linkGeometry);
    const spTree = doc.getElementsByTagNameNS(PML, "spTree")[0];
    const position = buildLinkScreenshotPicturePosition(image, pictureOrigin);
    const pic = createPictureNode(doc, getMaxShapeId(doc) + 1, item.nickname || "链接截图", image.relId, position);
    spTree.appendChild(pic);
    return serializeXml(doc);
  }

  function updateLinkScreenshotTexts(doc, item) {
    let linkGeometry = null;
    Array.from(doc.getElementsByTagNameNS(PML, "sp")).forEach((shape) => {
      const text = getTextContent(shape);
      if (!text) return;
      if (text.includes("视频-")) setShapeText(shape, `视频-${item.sequence}`);
      if (/http|douyin\.com/i.test(text)) {
        setShapeText(shape, item.linkText);
        linkGeometry = getShapeGeometry(shape);
      }
    });
    return linkGeometry;
  }

  function removeLinkScreenshotPictures(doc, linkGeometry) {
    const pictures = Array.from(doc.getElementsByTagNameNS(PML, "pic"));
    const pictureGeometry = pictures.length ? getShapeGeometry(pictures[0]) : null;
    pictures.forEach((picture) => picture.parentNode.removeChild(picture));
    if (pictureGeometry) return { x: pictureGeometry.x, y: pictureGeometry.y };
    if (linkGeometry) return { x: linkGeometry.x, y: linkGeometry.y + linkGeometry.cy + LINK_SCREENSHOT_LINK_GAP };
    return { ...LINK_SCREENSHOT_DEFAULT_PICTURE };
  }

  function buildLinkScreenshotPicturePosition(image, origin) {
    const aspect = image.width && image.height ? image.height / image.width : 9 / 16;
    return {
      x: Math.round(origin.x),
      y: Math.round(origin.y),
      cx: Math.round(LINK_SCREENSHOT_PICTURE_WIDTH),
      cy: Math.round(LINK_SCREENSHOT_PICTURE_WIDTH * aspect),
    };
  }

  function buildReleaseInfoScreenshotSlideXml(baseSlideXml, imageLinks, item) {
    const doc = parseXml(baseSlideXml);
    Array.from(doc.getElementsByTagNameNS(PML, "sp")).forEach((shape) => shape.parentNode.removeChild(shape));
    Array.from(doc.getElementsByTagNameNS(PML, "pic")).forEach((picture) => picture.parentNode.removeChild(picture));
    const spTree = doc.getElementsByTagNameNS(PML, "spTree")[0];
    let nextShapeId = getMaxShapeId(doc) + 1;
    spTree.appendChild(createTextBoxNode(doc, nextShapeId, "PPT 大标题", item.title, RELEASE_INFO_LAYOUT.title, { fontSize: 20, bold: true, borderColor: "e15252" }));
    nextShapeId += 1;
    buildReleaseInfoRows(item).forEach((row, index) => {
      spTree.appendChild(createTextBoxNode(doc, nextShapeId, `发布信息 ${index + 1}`, row.text, row.position, { fontSize: row.fontSize }));
      nextShapeId += 1;
    });
    const mainImage = imageLinks.main;
    const auxImages = [imageLinks.fan, imageLinks.playback].filter(Boolean);
    if (auxImages.length) {
      const [leftBox, rightBox] = splitBoxHorizontally(RELEASE_INFO_LAYOUT.image);
      spTree.appendChild(createPictureNode(doc, nextShapeId, item.account || "发布截图", mainImage.relId, fitPictureIntoBox(mainImage, leftBox)));
      nextShapeId += 1;
      layoutAuxImages(auxImages, rightBox).forEach(({ image, position }) => {
        const label = image === imageLinks.fan ? "粉丝量截图" : "后台播放数据截图";
        spTree.appendChild(createPictureNode(doc, nextShapeId, label, image.relId, position));
        nextShapeId += 1;
      });
    } else {
      const pic = createPictureNode(doc, nextShapeId, item.account || "发布截图", mainImage.relId, buildReleaseInfoPicturePosition(mainImage));
      spTree.appendChild(pic);
    }
    return serializeXml(doc);
  }

  function findReleaseInfoTemplateSlideIndex(slides, files) {
    const withFields = slides.findIndex((slide) => getSlideTexts(files, slide.target).join("").match(/发布账号|发布平台|发布标题|发布时间/));
    if (withFields >= 0) return withFields;
    return Math.min(RELEASE_INFO_TEMPLATE_INDEX, slides.length - 1);
  }

  // Custom-template path: keep the uploaded template's top title box and non-screenshot
  // images (e.g. logo). Middle slot labels are removed and rebuilt with the built-in
  // RELEASE_INFO_LAYOUT rows; screenshot placeholders are swapped for real images.
  function buildReleaseInfoTemplateSlideXml(baseSlideXml, imageLinks, item) {
    const doc = parseXml(baseSlideXml);
    const shapes = Array.from(doc.getElementsByTagNameNS(PML, "sp"));
    const titleShape = findReleaseInfoTitleShape(shapes);
    removeReleaseInfoMiddleShapes(doc, titleShape);
    const pictures = Array.from(doc.getElementsByTagNameNS(PML, "pic"));
    const mainPlaceholder = pictures[0] || null;
    const fanPlaceholder = pictures[1] || null;
    const mainImage = imageLinks.main;
    const auxImages = [imageLinks.fan, imageLinks.playback].filter(Boolean);
    const spTree = doc.getElementsByTagNameNS(PML, "spTree")[0];
    let nextShapeId = getMaxShapeId(doc) + 1;
    buildReleaseInfoRows(item).forEach((row, index) => {
      spTree.appendChild(createTextBoxNode(doc, nextShapeId, `发布信息 ${index + 1}`, row.text, row.position, { fontSize: row.fontSize }));
      nextShapeId += 1;
    });
    // 只移除我们实际要替换的主图/辅助图占位图形，模板里其余图片（如 logo）保持不动。
    [mainPlaceholder, fanPlaceholder].forEach((picture) => { if (picture) picture.parentNode.removeChild(picture); });
    const mainBox = mainPlaceholder ? getShapeGeometry(mainPlaceholder) : buildReleaseInfoPicturePosition(mainImage);
    if (!auxImages.length) {
      spTree.appendChild(createPictureNode(doc, getMaxShapeId(doc) + 1, item.account || "发布截图", mainImage.relId, fitPictureIntoBox(mainImage, mainBox)));
    } else {
      // 模板只保留了 1 个辅助图占位（fanPlaceholder）：占位存在时把它自身几何框当作辅助区，
      // 主图铺满 mainBox 不收缩；占位不存在时对 mainBox 做左右二分。辅助区内若同时有
      // 粉丝图与播放图，再由 layoutAuxImages 对辅助区上下二分——不需要模板里新增第 3 个占位。
      const [mainRenderBox, auxBox] = fanPlaceholder
        ? [mainBox, getShapeGeometry(fanPlaceholder)]
        : splitBoxHorizontally(mainBox);
      spTree.appendChild(createPictureNode(doc, getMaxShapeId(doc) + 1, item.account || "发布截图", mainImage.relId, fitPictureIntoBox(mainImage, mainRenderBox)));
      layoutAuxImages(auxImages, auxBox).forEach(({ image, position }) => {
        const label = image === imageLinks.fan ? "粉丝量截图" : "后台播放数据截图";
        spTree.appendChild(createPictureNode(doc, getMaxShapeId(doc) + 1, label, image.relId, position));
      });
    }
    return serializeXml(doc);
  }

  function splitBoxHorizontally(box) {
    const halfCx = Math.round(box.cx / 2);
    return [
      { x: box.x, y: box.y, cx: halfCx, cy: box.cy },
      { x: box.x + halfCx, y: box.y, cx: box.cx - halfCx, cy: box.cy },
    ];
  }

  function splitBoxVertically(box) {
    const halfCy = Math.round(box.cy / 2);
    return [
      { x: box.x, y: box.y, cx: box.cx, cy: halfCy },
      { x: box.x, y: box.y + halfCy, cx: box.cx, cy: box.cy - halfCy },
    ];
  }

  // auxImages 固定顺序 [粉丝图, 播放图]（由调用方过滤 null 后传入）：单张辅助图铺满整个
  // auxBox（与改动前"仅粉丝图"时的效果一致）；两张辅助图时对 auxBox 上下二分，粉丝图在上、
  // 播放数据图在下。
  function layoutAuxImages(auxImages, auxBox) {
    if (auxImages.length <= 1) {
      return auxImages.map((image) => ({ image, position: fitPictureIntoBox(image, auxBox) }));
    }
    const [topBox, bottomBox] = splitBoxVertically(auxBox);
    return [
      { image: auxImages[0], position: fitPictureIntoBox(auxImages[0], topBox) },
      { image: auxImages[1], position: fitPictureIntoBox(auxImages[1], bottomBox) },
    ];
  }

  function isReleaseInfoLabelText(text) {
    return RELEASE_INFO_LABEL_PATTERN.test(String(text || ""));
  }

  function findReleaseInfoTitleShape(shapes) {
    const candidates = shapes.filter((shape) => {
      const text = getTextContent(shape);
      if (!text) return false;
      if (isReleaseInfoLabelText(text)) return false;
      if (SCREENSHOT_HINT_PATTERN.test(text)) return false;
      return true;
    });
    if (!candidates.length) return null;
    return candidates.reduce((top, shape) => (
      getShapeGeometry(shape).y < getShapeGeometry(top).y ? shape : top
    ));
  }

  function removeReleaseInfoMiddleShapes(doc, titleShape) {
    Array.from(doc.getElementsByTagNameNS(PML, "sp")).forEach((shape) => {
      if (shape === titleShape) return;
      const text = getTextContent(shape);
      if (text && (isReleaseInfoLabelText(text) || SCREENSHOT_HINT_PATTERN.test(text))) {
        shape.parentNode.removeChild(shape);
      }
    });
  }

  function fitPictureIntoBox(image, box) {
    const aspect = image.width && image.height ? image.width / image.height : 16 / 9;
    const fit = fitInsideCell(aspect, box.cx, box.cy);
    return {
      x: Math.round(box.x + (box.cx - fit.cx) / 2),
      y: Math.round(box.y + (box.cy - fit.cy) / 2),
      cx: Math.round(fit.cx),
      cy: Math.round(fit.cy),
    };
  }

  function buildReleaseInfoRows(item) {
    const layout = RELEASE_INFO_LAYOUT.text;
    const fields = [
      `发布账号：${item.account || ""}`,
      `发布平台：${item.platform || ""}`,
      `发布标题：${item.publishTitle || ""}`,
      `发布链接：${item.link || ""}`,
      `发布时间：${item.time || ""}`,
    ];
    const heights = buildReleaseInfoRowHeights(fields, layout);
    let y = layout.y;
    return fields.map((text, index) => {
      const cy = heights[index] || layout.cy;
      const fontSize = getReleaseInfoFontSizeForHeight(text, layout, cy);
      const row = { text, fontSize, position: { x: layout.x, y, cx: layout.cx, cy } };
      y += cy + layout.gap;
      return row;
    });
  }

  function buildReleaseInfoRowHeights(fields, layout) {
    const availableHeight = Math.max(fields.length * layout.cy, layout.maxBottom - layout.y - Math.max(0, fields.length - 1) * layout.gap);
    const desiredHeights = fields.map((text) => buildReleaseInfoTextHeight(text, layout, layout.fontSize || 14));
    const minHeights = fields.map(() => layout.cy);
    const extraHeight = Math.max(0, availableHeight - minHeights.reduce((total, height) => total + height, 0));
    const needs = desiredHeights.map((height, index) => Math.max(0, height - minHeights[index]));
    const totalNeed = needs.reduce((total, need) => total + need, 0);
    if (!totalNeed) return minHeights;
    return minHeights.map((height, index) => height + extraHeight * (needs[index] / totalNeed));
  }

  function getReleaseInfoFontSizeForHeight(text, layout, maxHeight) {
    const sizes = Array.isArray(layout.fontSizes) && layout.fontSizes.length ? layout.fontSizes : [layout.fontSize || 14];
    return sizes.find((fontSize) => buildReleaseInfoTextHeight(text, layout, fontSize) <= maxHeight) || sizes[sizes.length - 1];
  }

  function buildReleaseInfoTextHeight(text, layout, fontSize = layout.fontSize || 14) {
    const baseFontSize = layout.fontSize || 14;
    const lineCount = String(text || "").split(/\r?\n/).reduce((count, line) => {
      const width = Math.max(1, layout.charsPerLine * (baseFontSize / fontSize));
      return count + Math.max(1, Math.ceil(getReleaseInfoTextUnits(line) / width));
    }, 0);
    const scale = fontSize / baseFontSize;
    return Math.max(layout.cy, lineCount * layout.lineHeight * scale + 0.16 * INCH_EMU * scale);
  }

  function getReleaseInfoTextUnits(text) {
    return Array.from(String(text || "")).reduce((total, char) => total + (/[\x00-\x7f]/.test(char) ? 0.55 : 1), 0);
  }

  function buildReleaseInfoPicturePosition(image) {
    const layout = RELEASE_INFO_LAYOUT.image;
    const aspect = image.width && image.height ? image.width / image.height : 16 / 9;
    const fit = fitInsideCell(aspect, layout.cx, layout.cy);
    return {
      x: Math.round(layout.x + (layout.cx - fit.cx) / 2),
      y: Math.round(layout.y + (layout.cy - fit.cy) / 2),
      cx: Math.round(fit.cx),
      cy: Math.round(fit.cy),
    };
  }

  function getPresentationSlides(presentationDoc, presentationRelsDoc, files) {
    const relMap = new Map(Array.from(presentationRelsDoc.getElementsByTagNameNS(PKG_REL, "Relationship")).map((rel) => [rel.getAttribute("Id"), rel.getAttribute("Target") || ""]));
    return Array.from(presentationDoc.getElementsByTagNameNS(PML, "sldId")).map((node) => {
      const relId = node.getAttributeNS(REL, "id");
      const target = relMap.get(relId) || "";
      return { node, relId, target, text: files.has(`ppt/${target}`) ? getSlideText(decodeText(files.get(`ppt/${target}`))) : "" };
    });
  }

  function findReleaseSlideIndex(slides, files) {
    const exact = slides.findIndex((slide) => getSlideTexts(files, slide.target).some((text) => text === "发布剪报"));
    if (exact >= 0) return exact;
    const placeholder = slides.findIndex((slide) => getSlideTexts(files, slide.target).some((text) => /一页贴|长图|占位/.test(text)));
    if (placeholder >= 0) return placeholder;
    const templateThirdPage = slides.findIndex((slide) => slide.target === "slides/slide3.xml");
    if (templateThirdPage >= 0) return templateThirdPage;
    // Custom template fallback: use the slide that carries an image placeholder,
    // otherwise the last slide.
    const withPicture = slides.findIndex((slide) => slideHasPicture(files, slide.target));
    if (withPicture >= 0) return withPicture;
    if (slides.length) return slides.length - 1;
    throw new Error("模板中找不到发布剪报页");
  }

  function slideHasPicture(files, target) {
    if (!files.has(`ppt/${target}`)) return false;
    const doc = parseXml(decodeText(files.get(`ppt/${target}`)));
    return doc.getElementsByTagNameNS(PML, "pic").length > 0;
  }

  function getSlideTexts(files, target) {
    if (!files.has(`ppt/${target}`)) return [];
    const doc = parseXml(decodeText(files.get(`ppt/${target}`)));
    return Array.from(doc.getElementsByTagNameNS(PML, "sp")).map((node) => getTextContent(node)).filter(Boolean);
  }

  function getSlideText(xml) {
    return getTextContent(parseXml(xml).documentElement);
  }

  function buildSlideRelationships(baseRelsXml, imageLinks) {
    const doc = parseXml(baseRelsXml);
    const root = doc.documentElement;
    Array.from(root.getElementsByTagNameNS(PKG_REL, "Relationship")).forEach((rel) => {
      if (rel.getAttribute("Type") === IMAGE_REL_TYPE) rel.parentNode.removeChild(rel);
    });
    let nextRelNumber = getNextRelNumber(doc);
    imageLinks.forEach((image) => {
      const relId = `rId${nextRelNumber}`;
      nextRelNumber += 1;
      image.relId = relId;
      const rel = doc.createElementNS(PKG_REL, "Relationship");
      rel.setAttribute("Id", relId);
      rel.setAttribute("Type", IMAGE_REL_TYPE);
      rel.setAttribute("Target", image.target);
      root.appendChild(rel);
    });
    return serializeXml(doc);
  }

  function buildSlideXml(baseSlideXml, imageLinks, layout, title) {
    const doc = parseXml(baseSlideXml);
    removePlaceholderShapes(doc);
    updateTitle(doc, title);
    const spTree = doc.getElementsByTagNameNS(PML, "spTree")[0];
    let nextShapeId = getMaxShapeId(doc) + 1;
    const positions = buildImagePositions(imageLinks, layout);
    imageLinks.forEach((image, index) => {
      const position = positions[index];
      const pic = createPictureNode(doc, nextShapeId, `截图 ${index + 1}`, image.relId, position);
      nextShapeId += 1;
      spTree.appendChild(pic);
    });
    return serializeXml(doc);
  }

  function removePlaceholderShapes(doc) {
    Array.from(doc.getElementsByTagNameNS(PML, "sp")).forEach((shape) => {
      const text = getTextContent(shape);
      if (/一页贴|长图|占位/.test(text)) shape.parentNode.removeChild(shape);
    });
  }

  function updateTitle(doc, title) {
    const shapes = Array.from(doc.getElementsByTagNameNS(PML, "sp"));
    const titleShape = shapes.find((shape) => getTextContent(shape) === "发布剪报") || shapes.find((shape) => getTextContent(shape).includes("发布剪报"));
    if (!titleShape) return;
    const textNodes = Array.from(titleShape.getElementsByTagNameNS(DML, "t"));
    if (!textNodes.length) return;
    textNodes[0].textContent = title;
    textNodes.slice(1).forEach((node) => {
      node.textContent = "";
    });
  }

  function buildImagePositions(images, layout) {
    return images.map((image, index) => {
      const row = Math.floor(index / layout.cols);
      const col = index % layout.cols;
      const rowCount = Math.min(layout.cols, images.length - row * layout.cols);
      const rowOffset = Math.max(0, (layout.cols - rowCount) * (layout.cellWidth + layout.gapX) / 2);
      const cellX = layout.x + rowOffset + col * (layout.cellWidth + layout.gapX);
      const cellY = layout.y + row * (layout.cellHeight + layout.gapY);
      const aspect = image.width && image.height ? image.width / image.height : 1;
      const fit = fitInsideCell(aspect, layout.cellWidth, layout.cellHeight);
      return {
        x: Math.round(cellX + (layout.cellWidth - fit.cx) / 2),
        y: Math.round(cellY + (layout.cellHeight - fit.cy) / 2),
        cx: Math.round(fit.cx),
        cy: Math.round(fit.cy),
      };
    });
  }

  function fitInsideCell(imageAspect, cellWidth, cellHeight) {
    if (!Number.isFinite(imageAspect) || imageAspect <= 0) return { cx: cellWidth, cy: cellHeight };
    const cellAspect = cellWidth / cellHeight;
    if (imageAspect > cellAspect) return { cx: cellWidth, cy: cellWidth / imageAspect };
    return { cx: cellHeight * imageAspect, cy: cellHeight };
  }

  function createPictureNode(doc, id, name, relId, position) {
    const fragment = parseXml(`<root xmlns:p="${PML}" xmlns:a="${DML}" xmlns:r="${REL}"><p:pic><p:nvPicPr><p:cNvPr id="${id}" name="${xmlEscape(name)}"/><p:cNvPicPr><a:picLocks noChangeAspect="1"/></p:cNvPicPr><p:nvPr/></p:nvPicPr><p:blipFill><a:blip r:embed="${relId}"/><a:stretch><a:fillRect/></a:stretch></p:blipFill><p:spPr><a:xfrm><a:off x="${position.x}" y="${position.y}"/><a:ext cx="${position.cx}" cy="${position.cy}"/></a:xfrm><a:prstGeom prst="rect"><a:avLst/></a:prstGeom></p:spPr></p:pic></root>`);
    return doc.importNode(fragment.documentElement.firstElementChild, true);
  }

  function createTextBoxNode(doc, id, name, text, position, options = {}) {
    const fontSize = Math.round((options.fontSize || 12) * 100);
    const bold = options.bold ? ' b="1"' : "";
    const border = options.borderColor ? `<a:ln w="12700"><a:solidFill><a:srgbClr val="${xmlEscape(options.borderColor)}"/></a:solidFill></a:ln>` : "<a:ln><a:noFill/></a:ln>";
    const paragraphs = String(text == null ? "" : text).split(/\r?\n/).map((line) => `<a:p><a:r><a:rPr lang="zh-CN" sz="${fontSize}"${bold}/><a:t>${xmlEscape(line)}</a:t></a:r><a:endParaRPr lang="zh-CN" sz="${fontSize}"/></a:p>`).join("");
    const fragment = parseXml(`<root xmlns:p="${PML}" xmlns:a="${DML}"><p:sp><p:nvSpPr><p:cNvPr id="${id}" name="${xmlEscape(name)}"/><p:cNvSpPr txBox="1"/><p:nvPr/></p:nvSpPr><p:spPr><a:xfrm><a:off x="${Math.round(position.x)}" y="${Math.round(position.y)}"/><a:ext cx="${Math.round(position.cx)}" cy="${Math.round(position.cy)}"/></a:xfrm><a:prstGeom prst="rect"><a:avLst/></a:prstGeom><a:noFill/>${border}</p:spPr><p:txBody><a:bodyPr wrap="square" lIns="60000" tIns="30000" rIns="60000" bIns="30000"/><a:lstStyle/>${paragraphs}</p:txBody></p:sp></root>`);
    return doc.importNode(fragment.documentElement.firstElementChild, true);
  }

  function addPresentationRelationship(doc, relId, target) {
    const rel = doc.createElementNS(PKG_REL, "Relationship");
    rel.setAttribute("Id", relId);
    rel.setAttribute("Type", SLIDE_REL_TYPE);
    rel.setAttribute("Target", target);
    doc.documentElement.appendChild(rel);
  }

  function addPresentationSlideId(doc, insertAfterNode, slideId, relId) {
    const slideList = doc.getElementsByTagNameNS(PML, "sldIdLst")[0];
    const node = doc.createElementNS(PML, "p:sldId");
    node.setAttribute("id", String(slideId));
    node.setAttributeNS(REL, "r:id", relId);
    slideList.insertBefore(node, insertAfterNode.nextSibling);
    return node;
  }

  function ensureImageContentTypes(doc) {
    ensureDefaultContentType(doc, "png", "image/png");
    ensureDefaultContentType(doc, "jpg", "image/jpeg");
    ensureDefaultContentType(doc, "jpeg", "image/jpeg");
    ensureDefaultContentType(doc, "webp", "image/webp");
  }

  function ensureDefaultContentType(doc, extension, contentType) {
    const exists = Array.from(doc.getElementsByTagNameNS(PKG_REL.replace("relationships", "content-types"), "Default"))
      .some((node) => String(node.getAttribute("Extension") || "").toLowerCase() === extension.toLowerCase());
    if (exists) return;
    const node = doc.createElementNS("http://schemas.openxmlformats.org/package/2006/content-types", "Default");
    node.setAttribute("Extension", extension);
    node.setAttribute("ContentType", contentType);
    doc.documentElement.insertBefore(node, doc.documentElement.firstChild);
  }

  function ensureSlideOverride(doc, partName) {
    const namespace = "http://schemas.openxmlformats.org/package/2006/content-types";
    const exists = Array.from(doc.getElementsByTagNameNS(namespace, "Override")).some((node) => node.getAttribute("PartName") === partName);
    if (exists) return;
    const node = doc.createElementNS(namespace, "Override");
    node.setAttribute("PartName", partName);
    node.setAttribute("ContentType", SLIDE_CONTENT_TYPE);
    doc.documentElement.appendChild(node);
  }

  function updateAppSlideCount(files, count) {
    const path = "docProps/app.xml";
    if (!files.has(path)) return;
    try {
      const doc = parseXml(decodeText(files.get(path)));
      Array.from(doc.getElementsByTagName("Slides")).forEach((node) => {
        node.textContent = String(count);
      });
      files.set(path, encodeText(serializeXml(doc)));
    } catch {}
  }

  function getNextSlideNumber(files) {
    let max = 0;
    for (const name of files.keys()) {
      const match = /^ppt\/slides\/slide(\d+)\.xml$/i.exec(name);
      if (match) max = Math.max(max, Number(match[1]));
    }
    return max + 1;
  }

  function getMaxSlideId(doc) {
    return Math.max(255, ...Array.from(doc.getElementsByTagNameNS(PML, "sldId")).map((node) => Number(node.getAttribute("id") || 0)));
  }

  function getNextMediaNumber(files) {
    let max = 0;
    for (const name of files.keys()) {
      const match = /^ppt\/media\/image(\d+)\.[^.]+$/i.exec(name);
      if (match) max = Math.max(max, Number(match[1]));
    }
    return max + 1;
  }

  function getNextRelNumber(doc) {
    let max = 0;
    Array.from(doc.getElementsByTagNameNS(PKG_REL, "Relationship")).forEach((node) => {
      const match = /^rId(\d+)$/i.exec(node.getAttribute("Id") || "");
      if (match) max = Math.max(max, Number(match[1]));
    });
    return max + 1;
  }

  function getMaxShapeId(doc) {
    let max = 0;
    Array.from(doc.getElementsByTagNameNS(PML, "cNvPr")).forEach((node) => {
      max = Math.max(max, Number(node.getAttribute("id") || 0));
    });
    return max;
  }

  function setShapeText(shape, value) {
    const textNodes = Array.from(shape.getElementsByTagNameNS(DML, "t"));
    if (!textNodes.length) return;
    textNodes[0].textContent = String(value == null ? "" : value);
    textNodes.slice(1).forEach((node) => {
      node.textContent = "";
    });
  }

  // Rewrite a text box so each provided line becomes its own paragraph, reusing
  // the template run's formatting (font size, color) when available.
  function setShapeParagraphs(shape, lines) {
    const doc = shape.ownerDocument;
    const txBody = shape.getElementsByTagNameNS(DML, "txBody")[0];
    if (!txBody) {
      setShapeText(shape, lines.join("\n"));
      return;
    }
    const sampleRun = txBody.getElementsByTagNameNS(DML, "r")[0] || null;
    const sampleRPr = sampleRun ? sampleRun.getElementsByTagNameNS(DML, "rPr")[0] : null;
    Array.from(txBody.getElementsByTagNameNS(DML, "p")).forEach((paragraph) => paragraph.parentNode.removeChild(paragraph));
    lines.forEach((line) => {
      const paragraph = doc.createElementNS(DML, "a:p");
      const run = doc.createElementNS(DML, "a:r");
      if (sampleRPr) {
        run.appendChild(sampleRPr.cloneNode(true));
      } else {
        run.appendChild(doc.createElementNS(DML, "a:rPr")).setAttribute("lang", "zh-CN");
      }
      const text = doc.createElementNS(DML, "a:t");
      text.textContent = String(line == null ? "" : line);
      run.appendChild(text);
      paragraph.appendChild(run);
      txBody.appendChild(paragraph);
    });
  }

  function getShapeGeometry(shape) {
    const off = shape.getElementsByTagNameNS(DML, "off")[0];
    const ext = shape.getElementsByTagNameNS(DML, "ext")[0];
    return {
      x: Number(off && off.getAttribute("x") || 0),
      y: Number(off && off.getAttribute("y") || 0),
      cx: Number(ext && ext.getAttribute("cx") || 0),
      cy: Number(ext && ext.getAttribute("cy") || 0),
    };
  }

  function getBaseFileName(name) {
    const normalized = String(name || "").replace(/\\/g, "/");
    const fileName = normalized.split("/").pop() || normalized;
    return fileName.replace(/\.[^.]+$/, "").trim();
  }

  function normalizeBaseName(name) {
    return getBaseFileName(name).toLowerCase();
  }

  function deriveSequenceFromImageName(name) {
    const base = getBaseFileName(name);
    const match = /^(\d+(?:-\d+)?)/.exec(base);
    return match ? match[1] : base;
  }

  function normalizeLinkScreenshotText(value) {
    return String(value == null ? "" : value).trim();
  }

  function buildOutputFileName(sourceName) {
    const base = String(sourceName || "发布剪报").replace(/\.[^.]+$/, "").replace(/[\\/:*?"<>|\r\n\t]+/g, "").trim() || "发布剪报";
    const timestamp = new Date().toISOString().replace(/[:.]/g, "-").slice(0, 19);
    return `${getSessionOutputDir(sourceName)}/${base}_发布剪报_${timestamp}.pptx`;
  }

  function buildLinkScreenshotOutputFileName(sourceName) {
    const base = String(sourceName || "链接截图单图单页").replace(/\.[^.]+$/, "").replace(/[\\/:*?"<>|\r\n\t]+/g, "").trim() || "链接截图单图单页";
    const timestamp = new Date().toISOString().replace(/[:.]/g, "-").slice(0, 19);
    return `${getSessionOutputDir(sourceName)}/${base}_链接截图单图单页_${timestamp}.pptx`;
  }

  function buildReleaseInfoScreenshotOutputFileName(sourceName) {
    const base = String(sourceName || "发布信息截图单图单页").replace(/\.[^.]+$/, "").replace(/[\\/:*?"<>|\r\n\t]+/g, "").trim() || "发布信息截图单图单页";
    const timestamp = new Date().toISOString().replace(/[:.]/g, "-").slice(0, 19);
    return `${getSessionOutputDir(sourceName)}/${base}_发布信息截图单图单页_${timestamp}.pptx`;
  }

  function buildDawanquOutputFileName(sourceName) {
    const base = String(sourceName || "大湾区崭新模版").replace(/\.[^.]+$/, "").replace(/[\\/:*?"<>|\r\n\t]+/g, "").trim() || "大湾区崭新模版";
    const timestamp = new Date().toISOString().replace(/[:.]/g, "-").slice(0, 19);
    return `${getSessionOutputDir(sourceName)}/${base}_大湾区崭新模版_${timestamp}.pptx`;
  }

  function parseXml(text) {
    const doc = new DOMParser().parseFromString(text, "application/xml");
    const error = doc.getElementsByTagName("parsererror")[0];
    if (error) throw new Error("XML 解析失败");
    return doc;
  }

  function serializeXml(doc) {
    return new XMLSerializer().serializeToString(doc);
  }

  function getTextContent(node) {
    return Array.from(node.getElementsByTagNameNS(DML, "t")).map((item) => item.textContent || "").join("").trim();
  }

  function encodeText(text) {
    return new TextEncoder().encode(String(text));
  }

  function decodeText(bytes) {
    return new TextDecoder("utf-8").decode(bytes);
  }

  function xmlEscape(value) {
    return String(value == null ? "" : value)
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;");
  }

  function emptyRelationshipsXml() {
    return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="${PKG_REL}"/>`;
  }

  function createZip(files) {
    const chunks = [];
    const centralDirectory = [];
    let offset = 0;
    files.forEach((file) => {
      const name = encodeText(file.name);
      const data = file.data instanceof Uint8Array ? file.data : new Uint8Array(file.data || []);
      if (data.length > ZIP32_LIMIT) throw new Error(`PPTX 内部文件过大：${file.name}`);
      const crc = crc32(data);
      const local = new Uint8Array(30 + name.length);
      const view = new DataView(local.buffer);
      view.setUint32(0, 0x04034b50, true);
      view.setUint16(4, 20, true);
      view.setUint16(6, 0x0800, true);
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
      if (offset > ZIP32_LIMIT) throw new Error("PPTX 过大，请减少图片数量或尺寸后重试");
    });
    const centralStart = offset;
    centralDirectory.forEach((entry) => {
      const central = new Uint8Array(46 + entry.name.length);
      const view = new DataView(central.buffer);
      view.setUint32(0, 0x02014b50, true);
      view.setUint16(4, 20, true);
      view.setUint16(6, 20, true);
      view.setUint16(8, 0x0800, true);
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
    if (centralSize > ZIP32_LIMIT || centralStart > ZIP32_LIMIT) throw new Error("PPTX 过大，请减少图片数量或尺寸后重试");
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
    for (let index = 0; index < bytes.length; index += 1) {
      crc = (crc >>> 8) ^ CRC_TABLE[(crc ^ bytes[index]) & 0xff];
    }
    return (crc ^ 0xffffffff) >>> 0;
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

  const CRC_TABLE = (() => {
    const table = new Uint32Array(256);
    for (let index = 0; index < 256; index += 1) {
      let value = index;
      for (let bit = 0; bit < 8; bit += 1) {
        value = value & 1 ? 0xedb88320 ^ (value >>> 1) : value >>> 1;
      }
      table[index] = value >>> 0;
    }
    return table;
  })();

  window.PptxClippings = {
    inspectZipFile,
    inspectImageFiles,
    analyzeTemplateFile,
    buildFromZipFile,
    buildFromImageFiles,
    buildLinkScreenshotFromZipFile,
    buildLinkScreenshotFromImageFiles,
    buildReleaseInfoScreenshotFromZipFile,
    buildReleaseInfoScreenshotFromImageFiles,
    buildDawanquFromZipFile,
    buildDawanquFromImageFiles,
    buildLinkScreenshotItems,
    loadImagesFromPptSource,
    loadImagesFromCacheRecord,
    normalizeImage,
    isImageZipEntry,
    downloadResult,
  };
})();
