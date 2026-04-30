(() => {
  window.shipinhaoPrepareForScreenshot = async function shipinhaoPrepareForScreenshot() {
    const startedAt = Date.now();
    await waitForUsefulContent(12000);
    removeBlockingOverlays();
    prepareVideos();
    window.scrollTo(0, 0);
    await sleep(600);
    removeBlockingOverlays();
    return {
      ok: true,
      elapsedMs: Date.now() - startedAt,
      videoCount: document.querySelectorAll("video").length,
      textLength: (document.body && document.body.innerText || "").trim().length,
    };
  };

  function removeBlockingOverlays() {
    document.querySelectorAll(".mask,.overlay,[id*=login],[class*=login],[class*=modal],[class*=dialog],[class*=popup],[class*=qr],[class*=QRCode],[class*=qrcode],[class*=download],[class*=open-app],[class*=openApp]").forEach(removeElement);
    Array.from(document.querySelectorAll("body *")).filter(shouldRemoveElement).forEach(removeElement);
    document.documentElement.style.overflow = "auto";
    document.body.style.overflow = "auto";
  }

  function removeElement(element) {
    if (element && element.remove) element.remove();
  }

  function shouldRemoveElement(element) {
    const text = (element.innerText || element.textContent || "").trim();
    const rect = element.getBoundingClientRect();
    const style = getComputedStyle(element);
    const zIndex = Number(style.zIndex || 0);
    const fixedOrHigh = style.position === "fixed" || zIndex >= 10;
    const blocksCenter = rect.left < innerWidth * 0.65 && rect.right > innerWidth * 0.35 && rect.top < innerHeight * 0.7 && rect.bottom > innerHeight * 0.25;
    const blocksBottom = rect.left < innerWidth * 0.9 && rect.right > innerWidth * 0.1 && rect.top < innerHeight && rect.bottom > innerHeight * 0.65;
    return fixedOrHigh && (blocksCenter || blocksBottom) && /扫码|前往微信|微信观看|观看此内容|取消|登录|打开.{0,4}APP|打开.{0,4}App|打开今日头条|下载.{0,4}APP|下载.{0,4}App|立即打开|立即下载|阅读全文/.test(text);
  }

  function prepareVideos() {
    Array.from(document.querySelectorAll("video")).forEach((video) => {
      video.muted = true;
      video.playsInline = true;
      try {
        video.play();
      } catch {}
    });
  }

  async function waitForUsefulContent(timeoutMs) {
    const startedAt = Date.now();
    while (Date.now() - startedAt < timeoutMs) {
      const bodyText = (document.body && document.body.innerText || "").trim();
      const videoCount = document.querySelectorAll("video").length;
      if (videoCount > 0 || bodyText.length > 10) return;
      await sleep(500);
    }
  }

  function sleep(ms) {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }
})();
