// 复现/回归脚本：验证 content.js 抖音"首帧就绪闸门"与"快门前终检"的行为。
//
// 背景：抖音批量截图存在两类事故——
//   a) 黑播放器截图：waitForVideoPlayback 20 秒超时后返回 false，但 prepare 仍返回 ok:true，
//      background 兜底硬截，产出 00:00/00:00 黑屏图；
//   b) 弹窗漏拍：三轮弹窗清理结束到快门之间约 2-4 秒空窗，弹窗重新弹出被拍进截图。
//
// 为什么这样测：闸门判定完全由 content.js 的纯逻辑（轮询/超时/判据组合）决定，
// 本脚本用虚拟时钟 + 假 DOM 在 Node 中驱动真实 content.js 源码，逐场景断言"修复后应有"的行为。
// 修复前运行：C1/C6/C8/C9 等场景 FAIL 即为事故复现；修复后运行：全部 PASS 即回归通过。
//
// 运行：node tests/douyin_first_frame_gate_repro.mjs

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const CONTENT_PATH = path.resolve(__dirname, "..", "content.js");

// ---- 虚拟时钟：content.js 的所有等待都经 setTimeout/Date.now，虚拟化后 20 秒闸门毫秒级跑完 ----
function createVirtualClock() {
  let now = 0;
  let seq = 0;
  const timers = [];
  const setTimeoutV = (fn, ms) => {
    timers.push({ due: now + Math.max(0, ms || 0), seq: (seq += 1), fn });
    return seq;
  };
  const drain = () => new Promise((resolve) => setImmediate(resolve));
  async function run(promise, { maxVirtualMs = 300000 } = {}) {
    let settled = false;
    let value;
    let error;
    let rejected = false;
    promise.then((v) => { settled = true; value = v; }, (e) => { settled = true; rejected = true; error = e; });
    for (;;) {
      await drain();
      await drain();
      if (settled) break;
      timers.sort((a, b) => a.due - b.due || a.seq - b.seq);
      const timer = timers.shift();
      if (!timer) throw new Error("虚拟时钟死锁：promise 未决且无待触发定时器");
      now = Math.max(now, timer.due);
      if (now > maxVirtualMs) throw new Error(`虚拟时间超过上限 ${maxVirtualMs}ms 仍未完成`);
      try { timer.fn(); } catch {}
    }
    await drain();
    if (rejected) throw error;
    return { value, elapsed: now };
  }
  return { setTimeoutV, run, nowFn: () => now };
}

// ---- 假 DOM 元素 ----
function makePopupElement({ stubborn = false } = {}) {
  return {
    nodeType: 1,
    id: "",
    className: "login-guide-mask",
    innerText: "扫码登录 抖音",
    removed: false,
    removeCalls: 0,
    stubborn,
    remove() {
      this.removeCalls += 1;
      if (!this.stubborn) this.removed = true;
    },
    matches(selector) {
      // 模拟 [class*=login] 等选择器命中
      return /login|modal|dialog|popup|qr|captcha|verify|download/i.test(this.className) && /login|modal|dialog|popup|qr|captcha|verify|download/i.test(selector);
    },
    getBoundingClientRect() { return { left: 400, right: 1000, top: 300, bottom: 800 }; },
    __style: { position: "fixed", zIndex: "9999" },
  };
}

function makeXgContainer(classes) {
  return { classList: { contains: (name) => classes.includes(name) } };
}

// ---- 假环境构建 ----
function buildSandbox(opts) {
  const clock = createVirtualClock();
  const state = {
    video: null,
    bodyElements: opts.popups ? opts.popups.slice() : [],
    images: [],
    bodyText: opts.bodyText !== undefined ? opts.bodyText : "精选 推荐 关注 朋友 我的 直播 放映厅 短剧 这是页面壳文字",
    // hidden 窗口列表 [[from, to), ...]；hiddenUntil 为旧参数的等价简写
    hiddenWindows: opts.hiddenWindows || (opts.hiddenUntil ? [[0, opts.hiddenUntil]] : []),
  };
  const isHiddenNow = () => state.hiddenWindows.some(([from, to]) => clock.nowFn() >= from && clock.nowFn() < to);
  // 与真实浏览器一致：hidden 页面的定时器被按约 1 秒对齐，名义 500ms 实际约 1000ms
  const alignedSetTimeout = (fn, ms) => clock.setTimeoutV(fn, isHiddenNow() ? Math.max(ms || 0, 1000) : ms);

  if (opts.video) {
    const cfg = opts.video;
    const effectiveReady = () => Boolean(cfg.ready) && clock.nowFn() >= (cfg.readyAfter || 0);
    const video = {
      nodeType: 1,
      muted: false,
      playsInline: false,
      _currentTime: 0,
      _seeked: false,
      get readyState() { return effectiveReady() ? 4 : 0; },
      get videoWidth() { return effectiveReady() ? 1280 : 0; },
      get currentTime() { return this._currentTime; },
      set currentTime(v) { this._currentTime = v; this._seeked = true; },
      play() {
        if (effectiveReady()) this._currentTime = Math.max(this._currentTime, 1);
        return { catch() {} };
      },
      closest(sel) { return sel === ".xgplayer" ? (cfg.xgContainer || null) : null; },
    };
    if (cfg.rvfc !== false) {
      // 与真实浏览器一致：页面 hidden（渲染停摆）期间 rVFC 不触发，恢复可见后才回调
      video.requestVideoFrameCallback = (cb) => {
        if (cfg.rvfcFires === false) return;
        const fireWhenVisible = () => {
          if (isHiddenNow() || !effectiveReady()) clock.setTimeoutV(fireWhenVisible, 500);
          else cb(clock.nowFn(), {});
        };
        clock.setTimeoutV(fireWhenVisible, 32);
      };
    }
    state.video = video;
  }

  const mutationObservers = [];
  class MutationObserverStub {
    constructor(cb) { this.cb = cb; mutationObservers.push(this); }
    observe() {}
    disconnect() {}
  }

  const visibilityListeners = [];
  const document = {
    get hidden() { return isHiddenNow(); },
    readyState: "complete",
    documentElement: { style: {} },
    body: {
      get innerText() { return state.bodyText; },
      style: {},
    },
    addEventListener(type, fn) { if (type === "visibilitychange") visibilityListeners.push(fn); },
    removeEventListener(type, fn) { const i = visibilityListeners.indexOf(fn); if (i >= 0) visibilityListeners.splice(i, 1); },
    querySelector(sel) {
      if (sel === "video") return state.video;
      return null;
    },
    querySelectorAll(sel) {
      if (sel === "video") return state.video ? [state.video] : [];
      if (sel === "img") return state.images;
      if (sel === "video,img") return [...(state.video ? [state.video] : []), ...state.images];
      if (sel === "body *") return state.bodyElements.filter((el) => !el.removed);
      return [];
    },
  };
  // 在每个 hidden 窗口边沿触发 visibilitychange（与真实浏览器一致）
  const fireVisibilityChange = () => visibilityListeners.slice().forEach((fn) => { try { fn(); } catch {} });
  for (const [from, to] of state.hiddenWindows) {
    if (from > 0) clock.setTimeoutV(fireVisibilityChange, from);
    clock.setTimeoutV(fireVisibilityChange, to);
  }

  const windowObj = { scrollTo() {} };
  const location = { href: opts.href || "https://www.douyin.com/video/7578149150840065323", hostname: "www.douyin.com", pathname: opts.pathname || "/video/7578149150840065323" };
  const getComputedStyle = (el) => el.__style || { position: "static", zIndex: "0" };
  const requestAnimationFrame = (cb) => clock.setTimeoutV(() => cb(clock.nowFn()), 16);
  const DateStub = { now: () => clock.nowFn() };

  const src = fs.readFileSync(CONTENT_PATH, "utf8");
  const factory = new Function(
    "window", "document", "location", "getComputedStyle", "innerWidth", "innerHeight",
    "MutationObserver", "requestAnimationFrame", "setTimeout", "Date",
    src,
  );
  factory(windowObj, document, location, getComputedStyle, 1440, 1200, MutationObserverStub, requestAnimationFrame, alignedSetTimeout, DateStub);

  return { clock, windowObj, document, state, mutationObservers };
}

// ---- 断言 ----
const failures = [];
function check(name, cond, detail = "") {
  const status = cond ? "PASS" : "FAIL";
  if (!cond) failures.push(name);
  console.log(`  [${status}] ${name}${detail ? `  (${detail})` : ""}`);
}

async function main() {
  console.log("== C1 黑屏复现：视频永不就绪时，prepare 必须拒绝放行（ok:false + FIRST_FRAME_TIMEOUT）==");
  {
    const sb = buildSandbox({ video: { ready: false } });
    const { value, elapsed } = await sb.clock.run(sb.windowObj.shipinhaoPrepareForScreenshot({ platform: "douyin" }));
    check("C1 ok 必须为 false（修复前为 true=兜底硬截产出黑图）", value.ok === false, `实际 ok=${value.ok} videoReady=${value.videoReady}`);
    check("C1 错误信息含 FIRST_FRAME_TIMEOUT", /FIRST_FRAME_TIMEOUT/.test(value.message || ""), `message=${value.message || "(无)"}`);
    check("C1 闸门在预算内结束（虚拟耗时 < 40s）", elapsed < 40000, `虚拟耗时=${elapsed}ms`);
  }

  console.log("== C2 正常件：数据就绪 + rVFC 触发 + xgplayer-playing，应快速放行 ==");
  {
    const sb = buildSandbox({ video: { ready: true, xgContainer: makeXgContainer(["xgplayer-playing"]) } });
    const { value } = await sb.clock.run(sb.windowObj.shipinhaoPrepareForScreenshot({ platform: "douyin" }));
    check("C2 ok=true", value.ok === true, `message=${value.message || ""}`);
    check("C2 videoReady=true", value.videoReady === true);
  }

  console.log("== C3 rVFC API 缺失：降级为数据级+状态类判定，不误杀 ==");
  {
    const sb = buildSandbox({ video: { ready: true, rvfc: false, xgContainer: makeXgContainer(["xgplayer-playing"]) } });
    const { value } = await sb.clock.run(sb.windowObj.shipinhaoPrepareForScreenshot({ platform: "douyin" }));
    check("C3 ok=true 且 videoReady=true", value.ok === true && value.videoReady === true, `ok=${value.ok} videoReady=${value.videoReady}`);
  }

  console.log("== C4 xgplayer 状态类持续不满足但 rVFC 已确认：宽限期后以 rVFC 为准放行（防改版整批误杀）==");
  {
    const sb = buildSandbox({ video: { ready: true, xgContainer: makeXgContainer(["xgplayer-isloading"]) } });
    const { value, elapsed } = await sb.clock.run(sb.windowObj.shipinhaoPrepareForScreenshot({ platform: "douyin" }));
    check("C4 ok=true 且 videoReady=true", value.ok === true && value.videoReady === true, `ok=${value.ok} videoReady=${value.videoReady}`);
    check("C4 经过了约 5s 宽限期（虚拟耗时 >= 5s）", elapsed >= 5000, `虚拟耗时=${elapsed}ms`);
  }

  console.log("== C5 混跑抢占：document.hidden 期间暂停计时，可见后恢复并成功（不误判超时）==");
  {
    const sb = buildSandbox({ hiddenUntil: 30000, video: { ready: true, xgContainer: makeXgContainer(["xgplayer-playing"]) } });
    const { value, elapsed } = await sb.clock.run(sb.windowObj.shipinhaoPrepareForScreenshot({ platform: "douyin" }));
    check("C5 hidden 30s 后仍放行成功（修复前 20s 预算被 hidden 期间烧光）", value.ok === true && value.videoReady === true, `ok=${value.ok} videoReady=${value.videoReady} 虚拟耗时=${elapsed}ms`);
  }

  console.log("== C5b 中途抢占：闸门进行中被快门抢占 25s（hidden 定时器 1s 对齐模型），实测记账不误判超时 ==");
  {
    // 视频 26s 才就绪，期间 [2s, 27s) 被抢占 hidden：名义记账（每轮+500ms）在 1s 对齐下只记一半，
    // 会在预算内误判超时；visibilitychange 实测记账应存活并成功
    const sb = buildSandbox({
      hiddenWindows: [[2000, 27000]],
      video: { ready: true, readyAfter: 26000, xgContainer: makeXgContainer(["xgplayer-playing"]) },
    });
    const { value, elapsed } = await sb.clock.run(sb.windowObj.shipinhaoPrepareForScreenshot({ platform: "douyin" }));
    check("C5b 中途 25s 抢占后仍放行成功（hidden 时间足额入账）", value.ok === true && value.videoReady === true, `ok=${value.ok} videoReady=${value.videoReady} message=${value.message || ""} 虚拟耗时=${elapsed}ms`);
  }

  console.log("== C10 无 video 元素的 /video/ 页（作品失效提示/图集）：放行留证而非误判黑屏 ==");
  {
    const sb = buildSandbox({});
    const { value } = await sb.clock.run(sb.windowObj.shipinhaoPrepareForScreenshot({ platform: "douyin" }));
    check("C10 ok=true（照常截图保留失效凭证）", value.ok === true, `ok=${value.ok} message=${value.message || ""}`);
    check("C10 noVideoElement=true（供上层记观察日志）", value.noVideoElement === true, `noVideoElement=${value.noVideoElement}`);
  }

  console.log("== C6 快门前终检（顽固弹窗）：移除失败复扫仍在，必须返回 clean:false ==");
  {
    const sb = buildSandbox({ video: { ready: true }, popups: [makePopupElement({ stubborn: true })] });
    check("C6 shipinhaoFinalSweep 已导出（修复前不存在=终检缺口复现）", typeof sb.windowObj.shipinhaoFinalSweep === "function");
    if (typeof sb.windowObj.shipinhaoFinalSweep === "function") {
      const { value } = await sb.clock.run(sb.windowObj.shipinhaoFinalSweep({ platform: "douyin" }));
      check("C6 clean=false（顽固弹窗必须中止快门）", value && value.clean === false, `clean=${value && value.clean}`);
    }
  }

  console.log("== C7 快门前终检（可清除弹窗/无弹窗）：返回 clean:true 放行 ==");
  {
    const sb = buildSandbox({ video: { ready: true }, popups: [makePopupElement()] });
    if (typeof sb.windowObj.shipinhaoFinalSweep === "function") {
      const { value } = await sb.clock.run(sb.windowObj.shipinhaoFinalSweep({ platform: "douyin" }));
      check("C7 clean=true（弹窗已清除）", value && value.clean === true, `clean=${value && value.clean}`);
    } else {
      check("C7 shipinhaoFinalSweep 已导出", false);
    }
  }

  console.log("== C8 弹窗哨兵：prepare 后新挂载的弹窗节点应被 MutationObserver 即时移除 ==");
  {
    const sb = buildSandbox({ video: { ready: true, xgContainer: makeXgContainer(["xgplayer-playing"]) } });
    await sb.clock.run(sb.windowObj.shipinhaoPrepareForScreenshot({ platform: "douyin" }));
    check("C8 哨兵已安装（修复前无 MutationObserver=空窗期复现）", sb.mutationObservers.length >= 1, `observer 数=${sb.mutationObservers.length}`);
    if (sb.mutationObservers.length >= 1) {
      const popup = makePopupElement();
      sb.mutationObservers[0].cb([{ addedNodes: [popup] }]);
      check("C8 新弹窗节点被即时移除", popup.removed === true);
    }
  }

  console.log("== C9 风控文案速判前移：风控页应在首帧闸门之前快速止损 ==");
  {
    const sb = buildSandbox({ bodyText: "安全验证 请完成下方验证后继续操作", video: { ready: false } });
    const { value, elapsed } = await sb.clock.run(sb.windowObj.shipinhaoPrepareForScreenshot({ platform: "douyin" }));
    check("C9 ok=false 且标记 RISK_CONTROL", value.ok === false && /RISK_CONTROL/.test(value.message || ""), `ok=${value.ok} message=${value.message || ""}`);
    check("C9 快速止损（虚拟耗时 < 10s，修复前约 23s）", elapsed < 10000, `虚拟耗时=${elapsed}ms`);
  }

  console.log("\n==================== 结果 ====================");
  if (failures.length) {
    console.log(`FAIL ${failures.length} 项：`);
    for (const f of failures) console.log(`  - ${f}`);
    console.log("（修复前运行出现 FAIL 即为事故复现；修复后运行必须全部 PASS）");
    process.exitCode = 1;
  } else {
    console.log("全部 PASS");
  }
}

main().catch((error) => {
  console.error("脚本执行异常：", error);
  process.exitCode = 1;
});
