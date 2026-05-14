(() => {
  const CLIPPINGS_TEMPLATE_FILE = "发布剪报-模板(1)(1).pptx";
  const LINK_SCREENSHOT_TEMPLATE_FILE = "链接截图单图单页-模板.pptx";
  const RELEASE_INFO_SCREENSHOT_TEMPLATE_FILE = "新单图单页-模板.pptx";
  const OUTPUT_DIR_BASE = "截图";

  function formatLocalTimestamp(date) {
    const pad = (n) => String(n).padStart(2, "0");
    return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}_${pad(date.getHours())}-${pad(date.getMinutes())}-${pad(date.getSeconds())}`;
  }

  function getSessionOutputDir(sourceName) {
    const timestamp = formatLocalTimestamp(new Date());
    const baseName = String(sourceName || "").replace(/\.[^.]+$/, "").replace(/[\\/:*?"<>|\r\n\t]+/g, "").trim();
    const suffix = baseName ? `_${baseName}` : "";
    return `${OUTPUT_DIR_BASE}/${timestamp}${suffix}`;
  }
  const ZIP32_LIMIT = 0xffffffff;
  const MAX_SOURCE_ZIP_BYTES = 2 * 1024 * 1024 * 1024;
  const MAX_IMAGE_COUNT = 2000;
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
    text: { x: 0.9 * INCH_EMU, y: 1.45 * INCH_EMU, cx: 4.65 * INCH_EMU, cy: 0.5 * INCH_EMU, gap: 0.16 * INCH_EMU, lineHeight: 0.3 * INCH_EMU, charsPerLine: 25, maxBottom: 5.95 * INCH_EMU },
    image: { x: 6.25 * INCH_EMU, y: 1.75 * INCH_EMU, cx: 5.55 * INCH_EMU, cy: 4.45 * INCH_EMU },
  };
  const LINK_SCREENSHOT_DEFAULT_PICTURE = {
    x: 0.8 * INCH_EMU,
    y: 2.5 * INCH_EMU,
  };
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

  async function buildFromZipFile(file) {
    const images = await readImagesFromZipFile(file);
    return buildFromImages(images, file.name);
  }

  async function buildFromImageFiles(files, sourceName) {
    const { images, imageEntries } = await readImagesFromImageFiles(files);
    return buildFromImages(images, sourceName || getFolderNameFromImageEntries(imageEntries));
  }

  async function buildLinkScreenshotFromZipFile(file, tasks = []) {
    const images = await readImagesFromZipFile(file);
    return buildLinkScreenshotFromImages(images, file.name, tasks);
  }

  async function buildLinkScreenshotFromImageFiles(files, sourceName, tasks = []) {
    const { images, imageEntries } = await readImagesFromImageFiles(files);
    return buildLinkScreenshotFromImages(images, sourceName || getFolderNameFromImageEntries(imageEntries), tasks);
  }

  async function buildReleaseInfoScreenshotFromZipFile(file, tasks = [], options = {}) {
    const images = await readImagesFromZipFile(file);
    return buildReleaseInfoScreenshotFromImages(images, file.name, tasks, options);
  }

  async function buildReleaseInfoScreenshotFromImageFiles(files, sourceName, tasks = [], options = {}) {
    const { images, imageEntries } = await readImagesFromImageFiles(files);
    return buildReleaseInfoScreenshotFromImages(images, sourceName || getFolderNameFromImageEntries(imageEntries), tasks, options);
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

  async function buildFromImages(images, sourceName) {
    const pagePlan = createPagePlan(images);
    const templateResponse = await fetch(chrome.runtime.getURL(CLIPPINGS_TEMPLATE_FILE));
    if (!templateResponse.ok) throw new Error("无法读取内置 PPT 模板");
    const templateEntries = parseZipEntries(await templateResponse.arrayBuffer());
    const files = await readAllZipFiles(templateEntries);
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

  async function buildLinkScreenshotFromImages(images, sourceName, tasks = []) {
    const templateResponse = await fetch(chrome.runtime.getURL(LINK_SCREENSHOT_TEMPLATE_FILE));
    if (!templateResponse.ok) throw new Error("无法读取链接截图单图单页模板");
    const templateEntries = parseZipEntries(await templateResponse.arrayBuffer());
    const files = await readAllZipFiles(templateEntries);
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
    const templateResponse = await fetch(chrome.runtime.getURL(RELEASE_INFO_SCREENSHOT_TEMPLATE_FILE));
    if (!templateResponse.ok) throw new Error("无法读取发布信息截图单图单页模板");
    const templateEntries = parseZipEntries(await templateResponse.arrayBuffer());
    const files = await readAllZipFiles(templateEntries);
    const items = buildReleaseInfoScreenshotItems(images, tasks, options);
    const bytes = buildReleaseInfoScreenshotPptx(files, items);
    if (bytes.length > MAX_OUTPUT_BYTES) throw new Error(`生成后的 PPT 超过 ${formatBytes(MAX_OUTPUT_BYTES)}，请减少图片数量或先压缩图片`);
    return {
      bytes,
      fileName: buildReleaseInfoScreenshotOutputFileName(sourceName),
      imageCount: images.length,
      slideCount: items.length,
      imagesPerSlide: 1,
      grid: "1×1",
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
      const taskIndex = findTaskIndexForImage(image, index, availableTasks, usedTaskIndexes, taskNameMap);
      const task = taskIndex >= 0 ? availableTasks[taskIndex] : null;
      if (taskIndex >= 0) usedTaskIndexes.add(taskIndex);
      const fallbackName = getBaseFileName(image.name);
      return {
        image,
        task,
        sequence: normalizeLinkScreenshotText(task && task.sequence) || deriveSequenceFromImageName(image.name) || String(index + 1),
        linkText: normalizeLinkScreenshotText(task && task.url) || fallbackName,
        nickname: normalizeLinkScreenshotText(task && task.nickname) || fallbackName,
      };
    });
  }

  function buildReleaseInfoScreenshotItems(images, tasks, options = {}) {
    const title = normalizeLinkScreenshotText(options.title) || RELEASE_INFO_DEFAULT_TITLE;
    return buildLinkScreenshotItems(images, tasks).map((item) => {
      const task = item.task || {};
      const releaseInfo = task.releaseInfo || {};
      return {
        image: item.image,
        title,
        account: normalizeLinkScreenshotText(releaseInfo.account) || normalizeLinkScreenshotText(task.nickname) || item.nickname,
        platform: normalizeLinkScreenshotText(releaseInfo.platform) || normalizeLinkScreenshotText(task.platformLabel),
        publishTitle: normalizeLinkScreenshotText(releaseInfo.title),
        link: normalizeLinkScreenshotText(releaseInfo.link) || normalizeLinkScreenshotText(task.url) || item.linkText,
        time: normalizeLinkScreenshotText(releaseInfo.time),
      };
    });
  }

  function findTaskIndexForImage(image, index, tasks, usedTaskIndexes, taskNameMap) {
    const key = normalizeBaseName(image && image.name);
    const exactIndex = taskNameMap.has(key) ? taskNameMap.get(key) : -1;
    if (exactIndex >= 0 && !usedTaskIndexes.has(exactIndex)) return exactIndex;
    if (tasks[index] && !usedTaskIndexes.has(index)) return index;
    return tasks.findIndex((task, taskIndex) => task && !usedTaskIndexes.has(taskIndex));
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

  function buildReleaseInfoScreenshotPptx(files, items) {
    const presentationDoc = parseXml(decodeText(files.get("ppt/presentation.xml")));
    const presentationRelsDoc = parseXml(decodeText(files.get("ppt/_rels/presentation.xml.rels")));
    const contentTypesDoc = parseXml(decodeText(files.get("[Content_Types].xml")));
    const slides = getPresentationSlides(presentationDoc, presentationRelsDoc, files);
    if (!slides.length) throw new Error("发布信息截图单图单页模板中没有幻灯片");
    const templateIndex = Math.min(RELEASE_INFO_TEMPLATE_INDEX, slides.length - 1);
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
      const slideXml = buildReleaseInfoScreenshotSlideXml(baseSlideXml, imageLink, item);
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

  function buildLinkScreenshotRelationships(baseRelsXml, image) {
    const doc = parseXml(baseRelsXml || emptyRelationshipsXml());
    const root = doc.documentElement;
    Array.from(root.getElementsByTagNameNS(PKG_REL, "Relationship")).forEach((rel) => {
      if (shouldRemoveLinkScreenshotRelationship(rel)) rel.parentNode.removeChild(rel);
    });
    const relId = `rId${getNextRelNumber(doc)}`;
    image.relId = relId;
    const rel = doc.createElementNS(PKG_REL, "Relationship");
    rel.setAttribute("Id", relId);
    rel.setAttribute("Type", IMAGE_REL_TYPE);
    rel.setAttribute("Target", image.target);
    root.appendChild(rel);
    return serializeXml(doc);
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

  function buildReleaseInfoScreenshotSlideXml(baseSlideXml, image, item) {
    const doc = parseXml(baseSlideXml);
    Array.from(doc.getElementsByTagNameNS(PML, "sp")).forEach((shape) => shape.parentNode.removeChild(shape));
    Array.from(doc.getElementsByTagNameNS(PML, "pic")).forEach((picture) => picture.parentNode.removeChild(picture));
    const spTree = doc.getElementsByTagNameNS(PML, "spTree")[0];
    let nextShapeId = getMaxShapeId(doc) + 1;
    spTree.appendChild(createTextBoxNode(doc, nextShapeId, "PPT 大标题", item.title, RELEASE_INFO_LAYOUT.title, { fontSize: 20, bold: true, borderColor: "e15252" }));
    nextShapeId += 1;
    buildReleaseInfoRows(item).forEach((row, index) => {
      spTree.appendChild(createTextBoxNode(doc, nextShapeId, `发布信息 ${index + 1}`, row.text, row.position, { fontSize: 14 }));
      nextShapeId += 1;
    });
    const pic = createPictureNode(doc, nextShapeId, item.account || "发布截图", image.relId, buildReleaseInfoPicturePosition(image));
    spTree.appendChild(pic);
    return serializeXml(doc);
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
    let y = layout.y;
    return fields.map((text, index) => {
      const isLast = index === fields.length - 1;
      const cy = Math.min(buildReleaseInfoTextHeight(text, layout), Math.max(layout.cy, layout.maxBottom - y - (isLast ? 0 : layout.gap)));
      const row = { text, position: { x: layout.x, y, cx: layout.cx, cy } };
      y += cy + layout.gap;
      return row;
    });
  }

  function buildReleaseInfoTextHeight(text, layout) {
    const lineCount = String(text || "").split(/\r?\n/).reduce((count, line) => {
      const width = Math.max(1, layout.charsPerLine);
      return count + Math.max(1, Math.ceil(getReleaseInfoTextUnits(line) / width));
    }, 0);
    return Math.max(layout.cy, lineCount * layout.lineHeight + 0.16 * INCH_EMU);
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
    const templateThirdPage = slides.findIndex((slide) => slide.target === "slides/slide3.xml");
    if (templateThirdPage >= 0) return templateThirdPage;
    throw new Error("模板中找不到发布剪报页");
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
    buildFromZipFile,
    buildFromImageFiles,
    buildLinkScreenshotFromZipFile,
    buildLinkScreenshotFromImageFiles,
    buildReleaseInfoScreenshotFromZipFile,
    buildReleaseInfoScreenshotFromImageFiles,
    buildLinkScreenshotItems,
    downloadResult,
  };
})();
