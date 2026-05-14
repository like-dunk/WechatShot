(() => {
  const DOUYIN_OVERLAY_SETTLE_MS = 900;
  const DOUYIN_OVERLAY_FINAL_SETTLE_MS = 600;
  const DEFAULT_OVERLAY_SETTLE_MS = 600;

  window.shipinhaoPrepareForScreenshot = async function shipinhaoPrepareForScreenshot(options = {}) {
    const startedAt = Date.now();
    const platform = options.platform || detectPlatform(location.href);
    await waitForUsefulContent(12000, platform);
    const initialText = (document.body && document.body.innerText || "").trim();
    await stabilizeBlockingOverlays(platform);
    prepareVideos();
    const videoReady = platform === "douyin" && isDouyinVideoPage() ? await waitForVideoPlayback(20000) : false;
    window.scrollTo(0, 0);
    await stabilizeBlockingOverlays(platform);
    const validation = validatePage(platform, initialText);
    if (!validation.ok) return { ...validation, elapsedMs: Date.now() - startedAt };
    return {
      ok: true,
      elapsedMs: Date.now() - startedAt,
      pageType: getPageType(),
      videoCount: document.querySelectorAll("video").length,
      videoReady,
      textLength: (document.body && document.body.innerText || "").trim().length,
    };
  };

  function removeBlockingOverlays(platform) {
    document.querySelectorAll(".mask,.overlay,.xg-player-center-controls,[id*=login],[class*=login],[class*=modal],[class*=dialog],[class*=popup],[class*=qr],[class*=QRCode],[class*=qrcode],[class*=download],[class*=open-app],[class*=openApp],[class*=captcha],[class*=verify]").forEach(removeElement);
    Array.from(document.querySelectorAll("body *")).filter((element) => shouldRemoveElement(element, platform)).forEach(removeElement);
    document.documentElement.style.overflow = "auto";
    document.body.style.overflow = "auto";
    if (platform === "douyin") document.body.style.zoom = "0.75";
  }

  async function stabilizeBlockingOverlays(platform) {
    removeBlockingOverlays(platform);
    await sleep(platform === "douyin" ? DOUYIN_OVERLAY_SETTLE_MS : DEFAULT_OVERLAY_SETTLE_MS);
    removeBlockingOverlays(platform);
    if (platform === "douyin") {
      await sleep(DOUYIN_OVERLAY_FINAL_SETTLE_MS);
      removeBlockingOverlays(platform);
    }
  }

  function removeElement(element) {
    if (element && element.remove) element.remove();
  }

  function shouldRemoveElement(element, platform) {
    const text = (element.innerText || element.textContent || "").trim();
    const rect = element.getBoundingClientRect();
    const style = getComputedStyle(element);
    const zIndex = Number(style.zIndex || 0);
    const fixedOrHigh = style.position === "fixed" || zIndex >= 10;
    const blocksCenter = rect.left < innerWidth * 0.65 && rect.right > innerWidth * 0.35 && rect.top < innerHeight * 0.7 && rect.bottom > innerHeight * 0.25;
    const blocksBottom = rect.left < innerWidth * 0.9 && rect.right > innerWidth * 0.1 && rect.top < innerHeight && rect.bottom > innerHeight * 0.65;
    const classAndId = `${element.id || ""} ${element.className || ""}`.toLowerCase();
    const douyinChrome = platform === "douyin" && /login|modal|dialog|popup|captcha|verify|download|open.?app|xg-player-center-controls/.test(classAndId);
    const xiaohongshuChrome = platform === "xiaohongshu" && /login|modal|dialog|popup|captcha|verify|download|open.?app/.test(classAndId);
    return fixedOrHigh && (blocksCenter || blocksBottom) && (douyinChrome || xiaohongshuChrome || /扫码|前往微信|微信观看|观看此内容|取消|登录|打开.{0,4}APP|打开.{0,4}App|打开今日头条|打开抖音|打开小红书|下载.{0,4}APP|下载.{0,4}App|立即打开|立即下载|阅读全文/.test(text));
  }

  function prepareVideos() {
    Array.from(document.querySelectorAll("video")).forEach((video) => {
      video.muted = true;
      video.playsInline = true;
      try {
        const result = video.play();
        if (result && result.catch) result.catch(() => {});
      } catch {}
    });
  }

  async function waitForUsefulContent(timeoutMs, platform) {
    const startedAt = Date.now();
    while (Date.now() - startedAt < timeoutMs) {
      const bodyText = (document.body && document.body.innerText || "").trim();
      const videoCount = document.querySelectorAll("video").length;
      const imageCount = document.querySelectorAll("img").length;
      if (videoCount > 0 || bodyText.length > 10 || ((platform === "douyin" || platform === "xiaohongshu") && imageCount > 0)) return;
      await sleep(500);
    }
  }

  async function waitForVideoPlayback(timeoutMs) {
    const startedAt = Date.now();
    while (Date.now() - startedAt < timeoutMs) {
      const video = document.querySelector("video");
      if (video) {
        video.muted = true;
        video.playsInline = true;
        try {
          const result = video.play();
          if (result && result.catch) result.catch(() => {});
        } catch {}
        if (video.readyState >= 2 && video.videoWidth > 10 && video.currentTime > 0.5) return true;
      }
      await sleep(500);
    }
    return false;
  }

  function validatePage(platform, initialText) {
    if (platform === "xiaohongshu") return validateXiaohongshuPage(initialText);
    if (platform !== "douyin") return { ok: true };
    const host = location.hostname.toLowerCase();
    const path = location.pathname.toLowerCase();
    const bodyText = (document.body && document.body.innerText || "").trim();
    const mediaCount = document.querySelectorAll("video,img").length;
    if (host === "v.douyin.com") return { ok: false, message: "抖音短链未完成跳转，请稍后重试或使用完整作品链接" };
    if (host !== "douyin.com" && host !== "www.douyin.com") return { ok: false, message: "抖音链接未跳转到支持的作品页，可能已失效或被风控拦截" };
    if ((host === "douyin.com" || host === "www.douyin.com") && !path.startsWith("/video/") && !path.startsWith("/note/")) return { ok: false, message: "抖音链接未进入作品页，可能已失效、需登录或被风控拦截" };
    if (hasDouyinRiskText(bodyText) || hasDouyinRiskText(initialText)) return { ok: false, message: "抖音页面出现验证或风控提示，请降低频率并确认当前 Chrome 已正常登录" };
    if (!mediaCount && bodyText.length < 10) return { ok: false, message: "抖音页面内容为空，可能未登录、加载失败或被风控拦截" };
    return { ok: true };
  }

  function hasDouyinRiskText(text) {
    return /安全验证|验证身份|环境异常|操作频繁|访问频繁|请稍后再试|请求异常|账号异常/.test(text || "");
  }

  function validateXiaohongshuPage(initialText) {
    const host = location.hostname.toLowerCase();
    const path = location.pathname.toLowerCase();
    const bodyText = (document.body && document.body.innerText || "").trim();
    const mediaCount = document.querySelectorAll("video,img").length;
    if (host === "xhslink.com") return { ok: false, message: "小红书短链未完成跳转，请稍后重试或使用完整笔记链接" };
    if (host !== "xiaohongshu.com" && host !== "www.xiaohongshu.com") return { ok: false, message: "小红书链接未跳转到支持的笔记页，可能已失效或被风控拦截" };
    if (path === "/404" || hasXiaohongshuUnavailableText(bodyText) || hasXiaohongshuUnavailableText(initialText)) return { ok: false, message: "小红书页面显示 Web 端暂不可浏览或需要 App 扫码查看" };
    if (!path.startsWith("/explore/") && !path.startsWith("/discovery/item/")) return { ok: false, message: "小红书链接未进入笔记页，可能已失效、需登录或被风控拦截" };
    if (hasXiaohongshuRiskText(bodyText) || hasXiaohongshuRiskText(initialText)) return { ok: false, message: "小红书页面出现验证或风控提示，请降低频率并确认当前 Chrome 已正常登录" };
    if (!mediaCount && bodyText.length < 10) return { ok: false, message: "小红书页面内容为空，可能未登录、加载失败或被风控拦截" };
    return { ok: true };
  }

  function hasXiaohongshuRiskText(text) {
    return /安全验证|滑块验证|验证身份|环境异常|操作频繁|访问频繁|请稍后再试|请求异常|账号异常/.test(text || "") || hasXiaohongshuUnavailableText(text);
  }

  function hasXiaohongshuUnavailableText(text) {
    return /当前笔记暂时无法浏览|请打开小红书.{0,8}扫码查看|小红书App扫码查看|扫码查看|App扫码/i.test(text || "");
  }

  function detectPlatform(url) {
    try {
      const parsed = new URL(url);
      const host = parsed.hostname.toLowerCase();
      if (host.includes("douyin.com")) return "douyin";
      if (host.includes("toutiao.com")) return "toutiao";
      if (host.includes("weixin.qq.com")) return "weixin";
      if (host.includes("xiaohongshu.com") || host.includes("xhslink.com")) return "xiaohongshu";
      return "";
    } catch {
      return "";
    }
  }

  function isDouyinVideoPage() {
    return location.pathname.toLowerCase().startsWith("/video/");
  }

  function getPageType() {
    const path = location.pathname.toLowerCase();
    if (path.startsWith("/video/")) return "video";
    if (path.startsWith("/note/")) return "note";
    if (path.startsWith("/explore/") || path.startsWith("/discovery/item/")) return "note";
    return "";
  }

  function sleep(ms) {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }
})();
