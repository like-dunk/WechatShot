(() => {
  const DOUYIN_OVERLAY_SETTLE_MS = 900;
  const DOUYIN_OVERLAY_FINAL_SETTLE_MS = 600;
  const DEFAULT_OVERLAY_SETTLE_MS = 600;
  // rVFC（requestVideoFrameCallback，Chrome 83+）是"帧已提交合成器"的唯一强信号；
  // readyState/currentTime 只是数据级信号，不能证明画面已上屏
  const FIRST_FRAME_RVFC_TIMEOUT_MS = 3000;
  const FIRST_FRAME_RVFC_RETRY_TIMEOUT_MS = 2000;
  // xgplayer 状态类是字节内部实现细节，只作辅助判据：rVFC 已确认首帧而状态类持续不满足时，
  // 按抖音改版处理，宽限期后放行，避免类名变化导致整批任务误杀
  const XGPLAYER_STATE_GRACE_MS = 5000;
  // hidden 暂停计时的总上限：防止截图窗口被长期最小化时 prepare 无限挂起
  const HIDDEN_PAUSE_MAX_MS = 60000;
  const BLOCKING_OVERLAY_SELECTOR = ".mask,.overlay,.xg-player-center-controls,[id*=login],[class*=login],[class*=modal],[class*=dialog],[class*=popup],[class*=qr],[class*=QRCode],[class*=qrcode],[class*=download],[class*=open-app],[class*=openApp],[class*=captcha],[class*=verify]";

  window.shipinhaoPrepareForScreenshot = async function shipinhaoPrepareForScreenshot(options = {}) {
    const startedAt = Date.now();
    const platform = options.platform || detectPlatform(location.href);
    await waitForUsefulContent(12000, platform);
    const initialText = (document.body && document.body.innerText || "").trim();
    if (platform === "douyin" && hasDouyinRiskText(initialText)) {
      // 风控文案速判前移：风控页没必要再等 20 秒首帧闸门，尽早止损减少被标记会话上的停留
      return { ok: false, code: "RISK_CONTROL", message: "抖音页面出现验证或风控提示，请降低频率并确认当前 Chrome 已正常登录 [RISK_CONTROL]", elapsedMs: Date.now() - startedAt };
    }
    installPopupSentinel(platform);
    await stabilizeBlockingOverlays(platform);
    prepareVideos();
    const videoReady = platform === "douyin" && isDouyinVideoPage() ? await waitForVideoPlayback(20000) : false;
    window.scrollTo(0, 0);
    await stabilizeBlockingOverlays(platform);
    const validation = validatePage(platform, initialText);
    if (!validation.ok) return { ...validation, elapsedMs: Date.now() - startedAt };
    const hasVideoElement = Boolean(document.querySelector("video"));
    if (platform === "douyin" && isDouyinVideoPage() && !videoReady && hasVideoElement) {
      // 首帧硬闸门：此前 videoReady=false 时上层只是多等 3 秒后兜底硬截，必然产出黑播放器图；
      // 改为拒绝放行，交由 background 既有 attempts 机制重试，坏图不再静默产出。
      // 仅在页面确有播放器时判死：无 video 元素的 /video/ 页多为"作品不存在"提示或图集，
      // 照常截图保留失效凭证，交由上层记观察日志
      return { ok: false, code: "FIRST_FRAME_TIMEOUT", message: "抖音视频首帧未完成合成渲染（疑似黑播放器），已中止本次截图待重试 [FIRST_FRAME_TIMEOUT]", elapsedMs: Date.now() - startedAt };
    }
    return {
      ok: true,
      elapsedMs: Date.now() - startedAt,
      pageType: getPageType(),
      videoCount: document.querySelectorAll("video").length,
      videoReady,
      noVideoElement: platform === "douyin" && isDouyinVideoPage() && !hasVideoElement,
      notePendingImages: countNotePendingImages(),
      textLength: (document.body && document.body.innerText || "").trim().length,
    };
  };

  window.shipinhaoFinalSweep = async function shipinhaoFinalSweep(options = {}) {
    // 快门前终检：弹窗可能在 prepare 三轮清理之后、快门之前重新弹出（漏拍主因），
    // 此处为最后一道复核，把暴露窗口从约 2-4 秒压缩到约 0.1 秒
    const platform = options.platform || detectPlatform(location.href);
    removeBlockingOverlays(platform);
    // 双 rAF：DOM 移除不等于像素已更新，等两帧渲染管线走完再复扫，
    // 防止快门拍到"节点已删但画面未刷新"的残影
    await nextPaint();
    await nextPaint();
    const residual = Array.from(document.querySelectorAll("body *")).some((element) => shouldRemoveElement(element, platform));
    return { clean: !residual };
  };

  function nextPaint() {
    // tab 在竞态下失活会让 rAF 不触发，加超时兜底避免快门链路被挂死
    return new Promise((resolve) => {
      let done = false;
      const finish = () => {
        if (!done) {
          done = true;
          resolve();
        }
      };
      requestAnimationFrame(finish);
      setTimeout(finish, 500);
    });
  }

  function installPopupSentinel(platform) {
    // 弹窗哨兵：覆盖 prepare 清理结束到快门之间的全时间窗，新弹窗挂载即删；
    // 用 window 标记防止 content.js 被重复注入时安装多份
    if (platform !== "douyin" || window.__shipinhaoPopupSentinelInstalled || !document.body) return;
    window.__shipinhaoPopupSentinelInstalled = true;
    const observer = new MutationObserver((mutations) => {
      for (const mutation of mutations) {
        for (const node of mutation.addedNodes) {
          if (!node || node.nodeType !== 1) continue;
          try {
            // 只做选择器级匹配（不读布局/样式）：抖音页 DOM 变更极频繁，逐节点跑
            // shouldRemoveElement 会强制布局造成卡顿；文案启发式弹窗由快门前终检兜底
            if (node.matches && node.matches(BLOCKING_OVERLAY_SELECTOR)) {
              removeElement(node);
              continue;
            }
            if (node.querySelectorAll) node.querySelectorAll(BLOCKING_OVERLAY_SELECTOR).forEach(removeElement);
          } catch {}
        }
      }
    });
    observer.observe(document.body, { childList: true, subtree: true });
  }

  function countNotePendingImages() {
    // /note/ 图文页本次不设硬闸门，仅统计未加载完成的图片数供上层记观察日志
    if (getPageType() !== "note") return 0;
    return Array.from(document.querySelectorAll("img")).filter((image) => !image.complete).length;
  }

  function removeBlockingOverlays(platform) {
    document.querySelectorAll(BLOCKING_OVERLAY_SELECTOR).forEach(removeElement);
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
    // 混跑批量时其他任务的快门会抢占 active tab：hidden 期间渲染停摆、rVFC 必然不触发，
    // 暂停计时避免把"被抢占"误判成首帧超时。用 visibilitychange 实测累计而非按次记名义值：
    // hidden 页的定时器被浏览器按约 1 秒对齐，名义记账会少记一半；且 confirmFirstFrame
    // 等待中途被抢占的时段也必须入账。总暂停设上限防止窗口被长期最小化时挂死。
    let hiddenAccumMs = 0;
    let hiddenSince = document.hidden ? Date.now() : 0;
    const onVisibilityChange = () => {
      if (document.hidden) {
        if (!hiddenSince) hiddenSince = Date.now();
      } else if (hiddenSince) {
        hiddenAccumMs += Date.now() - hiddenSince;
        hiddenSince = 0;
      }
    };
    document.addEventListener("visibilitychange", onVisibilityChange);
    try {
      let firstFrameConfirmed = false;
      let xgNotReadySince = 0;
      for (;;) {
        const pausedMs = Math.min(hiddenAccumMs + (hiddenSince ? Date.now() - hiddenSince : 0), HIDDEN_PAUSE_MAX_MS);
        if (Date.now() - startedAt - pausedMs >= timeoutMs) return false;
        if (document.hidden) {
          await sleep(500);
          continue;
        }
        const video = document.querySelector("video");
        if (video) {
          video.muted = true;
          video.playsInline = true;
          try {
            const result = video.play();
            if (result && result.catch) result.catch(() => {});
          } catch {}
          // 三重判定：数据级（沿用）+ 合成级 rVFC（硬判据）+ xgplayer 状态类（软判据）
          if (video.readyState >= 2 && video.videoWidth > 10 && video.currentTime > 0.5) {
            if (!firstFrameConfirmed) firstFrameConfirmed = await confirmFirstFrame(video);
            if (firstFrameConfirmed) {
              if (getXgplayerState(video) !== "not-ready") return true;
              if (!xgNotReadySince) xgNotReadySince = Date.now();
              if (Date.now() - xgNotReadySince >= XGPLAYER_STATE_GRACE_MS) return true;
            }
          }
        }
        await sleep(500);
      }
    } finally {
      document.removeEventListener("visibilitychange", onVisibilityChange);
    }
  }

  async function confirmFirstFrame(video) {
    // rVFC 回调触发即证明至少一帧已提交合成器，是"画面真的出来了"的可靠依据；
    // API 缺失（旧内核）时降级为数据级 + 状态类判定，不阻塞流程
    if (typeof video.requestVideoFrameCallback !== "function") return true;
    if (await waitForVideoFrame(video, FIRST_FRAME_RVFC_TIMEOUT_MS)) return true;
    // 子超时补救：解码器可能已就绪但恰无新帧提交（起播即暂停/瞬时卡顿），微调进度逼出一帧
    try {
      video.currentTime = video.currentTime + 0.001;
    } catch {}
    return waitForVideoFrame(video, FIRST_FRAME_RVFC_RETRY_TIMEOUT_MS);
  }

  function waitForVideoFrame(video, timeoutMs) {
    return new Promise((resolve) => {
      let done = false;
      const finish = (ok) => {
        if (!done) {
          done = true;
          resolve(ok);
        }
      };
      try {
        video.requestVideoFrameCallback(() => finish(true));
      } catch {
        finish(false);
        return;
      }
      setTimeout(() => finish(false), timeoutMs);
    });
  }

  function getXgplayerState(video) {
    const container = video.closest && video.closest(".xgplayer");
    if (!container) return "absent";
    const classes = container.classList;
    if (classes.contains("xgplayer-playing") && !classes.contains("xgplayer-isloading") && !classes.contains("xgplayer-nostart")) return "ready";
    return "not-ready";
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
