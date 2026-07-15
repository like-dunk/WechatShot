const PPT_MODES = {
  clippings: { label: "发布剪报多图铺页" },
  "link-screenshot": { label: "链接截图单图单页" },
  "release-info-screenshot": { label: "发布信息截图单图单页" },
  dawanqu: { label: "大湾区崭新模版" },
};

const statusText = document.getElementById("statusText");

function setStatus(message) {
  if (statusText) statusText.textContent = message;
}

function sendMessage(message) {
  return new Promise((resolve) => chrome.runtime.sendMessage(message, resolve));
}

function closeSelfLater(delayMs = 1500) {
  setTimeout(() => {
    chrome.tabs.getCurrent((tab) => {
      if (tab && tab.id) chrome.tabs.remove(tab.id);
      else window.close();
    });
  }, delayMs);
}

async function receiveSuccessScreenshots() {
  const response = await sendMessage({ type: "GET_SUCCESS_SCREENSHOT_RECORDS" });
  if (!response || !response.ok) throw new Error(response && response.error ? response.error : "无法读取成功截图记录");
  const records = response.screenshots || [];
  const screenshots = [];
  setStatus(`正在从缓存读取 ${records.length} 张成功截图...`);
  for (const record of records) {
    const cached = await window.ScreenshotCache.getScreenshot(record.cacheKey);
    if (!cached || !cached.blob) throw new Error(`截图缓存缺失：${record.fileName || record.cacheKey}`);
    screenshots.push({
      fileName: record.fileName || cached.fileName || "截图.png",
      task: record.task || cached.task || null,
      file: new File([cached.blob], record.fileName || cached.fileName || "截图.png", { type: cached.blob.type || "image/png" }),
    });
    if (screenshots.length % 20 === 0) setStatus(`已读取 ${screenshots.length} 张截图...`);
  }
  return { screenshots, sourceName: response.sourceName || "本次截图" };
}

async function resolveFanImagesForPpt(options = {}) {
  if (Array.isArray(options.fanImages)) return options.fanImages;
  const id = options.autoPptFanSourceId;
  if (!id || !window.FanSourceCache) return [];
  try {
    const record = await window.FanSourceCache.getFanSource(id);
    if (record) return await window.PptxClippings.loadFanImagesFromCacheRecord(record);
  } catch (error) {
    setStatus(`读取粉丝量截图缓存失败：${error.message}`);
  }
  return [];
}

async function buildPptByMode(source, modeValue, options = {}) {
  const matchingTasks = options.tasks || [];
  const templateBytes = options.templateBytes || undefined;
  const fanImages = await resolveFanImagesForPpt(options);
  const pptOptions = { templateBytes, fanImages };
  if (modeValue === "link-screenshot") {
    return window.PptxClippings.buildLinkScreenshotFromImageFiles(source.files, source.name, matchingTasks, { templateBytes });
  }
  if (modeValue === "release-info-screenshot") {
    return window.PptxClippings.buildReleaseInfoScreenshotFromImageFiles(source.files, source.name, matchingTasks, { title: options.title || "", ...pptOptions });
  }
  if (modeValue === "dawanqu") {
    return window.PptxClippings.buildDawanquFromImageFiles(source.files, source.name, matchingTasks, { title: options.title || "", ...pptOptions });
  }
  return window.PptxClippings.buildFromImageFiles(source.files, source.name, { templateBytes });
}

// Loads custom template bytes saved by the popup when the run started. Returns
// undefined (so the builder falls back to the built-in template) if there is no
// template id, the cache is unavailable, or the bytes can't be read.
async function loadAutoPptTemplateBytes(state) {
  const templateId = state && state.options ? state.options.autoPptTemplateId : "";
  if (!templateId || !window.TemplateCache) return undefined;
  try {
    const record = await window.TemplateCache.getTemplate(templateId);
    if (record && record.bytes && record.bytes.length) {
      return record.bytes instanceof Uint8Array ? record.bytes : new Uint8Array(record.bytes);
    }
  } catch (error) {
    setStatus(`读取自定义模板失败，将使用内置模板：${error.message}`);
  }
  return undefined;
}

async function runAutoPptGeneration() {
  let claimed = false;
  try {
    const claim = await sendMessage({ type: "CLAIM_AUTO_PPT_GENERATION" });
    if (!claim || !claim.ok) {
      setStatus(claim && claim.error ? claim.error : "自动 PPT 生成未启动");
      closeSelfLater();
      return;
    }
    claimed = true;
    const state = claim.state;
    const modeValue = state.options.autoPptMode || "clippings";
    const mode = PPT_MODES[modeValue] || PPT_MODES.clippings;
    const screenshotsResponse = await receiveSuccessScreenshots();
    const screenshots = screenshotsResponse.screenshots || [];
    if (!screenshots.length) throw new Error("本次没有可用于生成 PPT 的成功截图");
    setStatus(`正在生成${mode.label} PPT...`);
    const files = screenshots.map((item) => item.file);
    const source = { type: "files", files, name: screenshotsResponse.sourceName || "本次截图" };
    const tasks = screenshots.map((item) => item.task).filter(Boolean);
    const templateBytes = await loadAutoPptTemplateBytes(state);
    if (templateBytes) setStatus(`正在使用自定义模板生成${mode.label} PPT...`);
    const result = await buildPptByMode(source, modeValue, {
      tasks,
      title: state.options.autoPptTitle || "",
      templateBytes,
      autoPptFanSourceId: state.options.autoPptFanSourceId || "",
    });
    await window.PptxClippings.downloadResult(result);
    await sendMessage({ type: "MARK_AUTO_PPT_GENERATED", result: { fileName: result.fileName, imageCount: result.imageCount, slideCount: result.slideCount, mode: modeValue } });
    setStatus(`${mode.label} PPT 已触发下载：${result.fileName}`);
    closeSelfLater();
  } catch (error) {
    if (claimed) await sendMessage({ type: "MARK_AUTO_PPT_FAILED", error: error.message });
    setStatus(`自动生成 PPT 失败：${error.message}`);
  }
}

runAutoPptGeneration();
