// 复现/回归脚本：在 Node 中以真实 background.js 驱动完整任务流程，验证抖音截图管线的
// "快门前终检中止重试"、"首帧超时判死不产坏图"、"延后重试不阻塞其他任务" 三条集成行为。
//
// 为什么这样测：这些行为由 background.js 的 workerLoop/nextTask/processTask/captureTabSerial
// 协作决定，content.js 的返回值契约用桩模拟（其自身逻辑由 douyin_first_frame_gate_repro.mjs 覆盖）。
// 修复前运行：S2/S3/S4 出现 FAIL 即为缺口复现；修复后运行：必须全部 PASS。
//
// 运行：node tests/douyin_capture_flow_repro.mjs

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const BG_PATH = path.resolve(__dirname, "..", "background.js");

function later(ms, fn) {
  return new Promise((resolve, reject) => {
    setTimeout(() => {
      try { resolve(fn()); } catch (e) { reject(e); }
    }, ms);
  });
}

// 每个场景独立的 chrome 桩环境；hooks 由场景注入 prepare/终检的返回值
function buildEnv(hooks) {
  let winSeq = 0;
  let tabSeq = 0;
  const windows = new Map();
  const tabs = new Map();
  const updatedListeners = [];
  const events = { prepares: [], sweeps: [], downloads: [], captures: [], sessionGets: 0 };
  const startedAt = Date.now();
  const t = () => Date.now() - startedAt;

  const chrome = {
    runtime: {
      lastError: undefined,
      onConnect: { addListener() {} },
      onMessage: { addListener() {} },
      onInstalled: { addListener() {} },
    },
    storage: {
      local: {
        get: (key, cb) => setTimeout(() => { chrome.runtime.lastError = undefined; cb({}); }, 1),
        set: (obj, cb) => setTimeout(() => { chrome.runtime.lastError = undefined; cb && cb(); }, 1),
        remove: (key, cb) => setTimeout(() => { chrome.runtime.lastError = undefined; cb && cb(); }, 1),
      },
      session: {
        get: (key, cb) => { events.sessionGets += 1; return new Promise((resolve) => setTimeout(() => { chrome.runtime.lastError = undefined; cb && cb({}); resolve({}); }, 1)); },
        set: (obj, cb) => setTimeout(() => { chrome.runtime.lastError = undefined; cb && cb(); }, 1),
        remove: (key, cb) => setTimeout(() => { chrome.runtime.lastError = undefined; cb && cb(); }, 1),
      },
    },
    windows: {
      create(opts = {}) {
        return later(20, () => {
          const id = (winSeq += 1) + 1000;
          const w = { id, incognito: !!opts.incognito, state: "normal", width: opts.width || 1440, height: opts.height || 1200 };
          windows.set(id, w);
          return { ...w };
        });
      },
      remove(id) { return later(10, () => { windows.delete(id); for (const [tid, tb] of [...tabs]) if (tb.windowId === id) tabs.delete(tid); }); },
      get(id) {
        return later(2, () => {
          const w = windows.get(id);
          if (!w) throw new Error("No window with id: " + id);
          return { ...w };
        });
      },
      update(id, info = {}) {
        return later(3, () => {
          const w = windows.get(id);
          if (!w) throw new Error("No window with id: " + id);
          Object.assign(w, info.state ? { state: info.state } : {}, info.width ? { width: info.width } : {}, info.height ? { height: info.height } : {});
          return { ...w };
        });
      },
    },
    tabs: {
      onUpdated: {
        addListener(fn) { updatedListeners.push(fn); },
        removeListener(fn) { const i = updatedListeners.indexOf(fn); if (i >= 0) updatedListeners.splice(i, 1); },
      },
      create({ windowId, url, active } = {}) {
        return later(5, () => {
          const id = (tabSeq += 1);
          const tab = { id, windowId, url: url || "about:blank", status: "complete", active: !!active };
          tabs.set(id, tab);
          if (active) for (const [, o] of tabs) if (o.windowId === windowId && o.id !== id) o.active = false;
          return { ...tab };
        });
      },
      get(id) {
        return later(2, () => {
          const tab = tabs.get(id);
          if (!tab) throw new Error("No tab with id: " + id);
          return { ...tab };
        });
      },
      update(id, info = {}) {
        return later(3, () => {
          const tab = tabs.get(id);
          if (!tab) throw new Error("No tab with id: " + id);
          if (info.url !== undefined) { tab.url = info.url; tab.status = "complete"; }
          if (info.active !== undefined) {
            tab.active = info.active;
            if (info.active) for (const [, o] of tabs) if (o.windowId === tab.windowId && o.id !== id) o.active = false;
          }
          for (const fn of [...updatedListeners]) { try { fn(id, { status: "complete" }, { ...tab }); } catch {} }
          return { ...tab };
        });
      },
      remove(id) { return later(2, () => { tabs.delete(id); }); },
      query({ windowId, active } = {}) {
        return later(2, () => {
          let arr = [...tabs.values()];
          if (windowId !== undefined) arr = arr.filter((x) => x.windowId === windowId);
          if (active !== undefined) arr = arr.filter((x) => x.active === active);
          return arr.map((x) => ({ ...x }));
        });
      },
      captureVisibleTab(windowId, opts, cb) {
        setTimeout(() => {
          chrome.runtime.lastError = undefined;
          events.captures.push({ t: t() });
          cb("data:image/png;base64," + "A".repeat(8000));
        }, 30);
      },
    },
    scripting: {
      executeScript(injection = {}) {
        return later(5, () => {
          const tabId = injection.target && injection.target.tabId;
          const tab = tabs.get(tabId);
          const url = tab ? tab.url : "";
          const fnStr = injection.func ? injection.func.toString() : "";
          if (injection.files) return [{ result: undefined }];
          if (fnStr.includes("shipinhaoPrepareForScreenshot")) {
            const result = hooks.onPrepare(url, events.prepares.filter((p) => p.url === url).length);
            events.prepares.push({ t: t(), url });
            return [{ result }];
          }
          if (fnStr.includes("shipinhaoFinalSweep")) {
            const result = hooks.onSweep ? hooks.onSweep(url, events.sweeps.filter((s) => s.url === url).length) : { clean: true };
            events.sweeps.push({ t: t(), url });
            return [{ result }];
          }
          if (fnStr.includes("readyState")) return [{ result: "complete" }];
          if (fnStr.includes("innerWidth")) return [{ result: { width: 1440, height: 1200 } }];
          return [{ result: undefined }];
        });
      },
    },
    downloads: {
      download(opts, cb) {
        setTimeout(() => {
          chrome.runtime.lastError = undefined;
          events.downloads.push({ t: t(), filename: opts.filename });
          cb(events.downloads.length);
        }, 5);
      },
    },
  };

  const ScreenshotCache = {
    cleanupOld: async () => {},
    putScreenshot: async () => "cache-key",
    dataUrlToBlob: async () => ({ size: 8000 }),
  };

  return { chrome, ScreenshotCache, events };
}

function loadBackground(env) {
  let src = fs.readFileSync(BG_PATH, "utf8");
  src = src.replace('importScripts("screenshot-cache.js");', "");
  // 仅为加速测试：缩短与本次断言无关的固定等待（逻辑路径不变）
  src = src.replace("const DOUYIN_POST_LOAD_WAIT_MS = 2500;", "const DOUYIN_POST_LOAD_WAIT_MS = 40;");
  src = src.replace("const DOUYIN_POST_PREPARE_WAIT_MS = 1500;", "const DOUYIN_POST_PREPARE_WAIT_MS = 40;");
  src = src.replace("const DOUYIN_FALLBACK_RENDER_WAIT_MS = 3000;", "const DOUYIN_FALLBACK_RENDER_WAIT_MS = 40;");
  src = src.replace("const DOUYIN_COOLDOWN_MS = 3000;", "const DOUYIN_COOLDOWN_MS = 60;");
  // 延后重试与抖动：缩短到可测量但不拖慢脚本的量级（修复前源码无此常量，replace 自动跳过）
  src = src.replace("const DOUYIN_RETRY_DELAY_MS = 45000;", "const DOUYIN_RETRY_DELAY_MS = 1200;");
  src = src.replace("const DOUYIN_DELAY_JITTER_MS = 2000;", "const DOUYIN_DELAY_JITTER_MS = 10;");
  const epilogue = "\n;return { startRun, getState: () => state };\n";
  const factory = new Function("chrome", "ScreenshotCache", "console", src + epilogue);
  const silentConsole = { log() {}, warn() {}, error() {} };
  return factory(env.chrome, env.ScreenshotCache, silentConsole);
}

async function runScenario(tasks, hooks, { timeoutMs = 60000 } = {}) {
  const env = buildEnv(hooks);
  const bg = loadBackground(env);
  await bg.startRun(tasks, {
    concurrency: 2,
    delayMs: 0,
    captureSizeMode: "current",
    douyinWindowMode: "regular",
    includeScreenshotWorkbook: false,
    autoGeneratePpt: false,
    enableSupplementRepairZip: false,
    douyinProxyRotation: { enabled: false },
  });
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const status = bg.getState().status;
    if (status === "done" || status === "stopped" || status === "idle") break;
    await new Promise((r) => setTimeout(r, 100));
  }
  return { state: bg.getState(), events: env.events };
}

const DY_URL_A = "https://www.douyin.com/video/7000000000000000001";
const DY_URL_B = "https://www.douyin.com/video/7000000000000000002";
const WX_URL = "https://channels.weixin.qq.com/abc";

const PREPARE_OK = { ok: true, pageType: "video", videoReady: true, videoCount: 1, textLength: 200 };
const PREPARE_FIRST_FRAME_TIMEOUT = { ok: false, code: "FIRST_FRAME_TIMEOUT", message: "抖音视频首帧未完成合成渲染（疑似黑播放器），已中止本次截图待重试 [FIRST_FRAME_TIMEOUT]" };

const failures = [];
function check(name, cond, detail = "") {
  const status = cond ? "PASS" : "FAIL";
  if (!cond) failures.push(name);
  console.log(`  [${status}] ${name}${detail ? `  (${detail})` : ""}`);
}

async function main() {
  console.log("== S2 正常抖音件：快门前必须执行终检，SUCCESS 且仅 1 次下载 ==");
  {
    const { state, events } = await runScenario(
      [{ url: DY_URL_A, platform: "douyin", fileName: "dy_normal.png" }],
      { onPrepare: () => PREPARE_OK, onSweep: () => ({ clean: true }) },
    );
    const task = state.tasks[0];
    check("S2 任务 SUCCESS", task.status === "SUCCESS", `status=${task.status} error=${task.error || ""}`);
    check("S2 下载 1 次", events.downloads.length === 1, `downloads=${events.downloads.length}`);
    check("S2 快门前执行了终检（修复前 sweeps=0 即为终检缺口复现）", events.sweeps.length === 1, `sweeps=${events.sweeps.length}`);
  }

  console.log("== S3 快门前发现顽固弹窗：第一次快门中止并重试，第二次干净后成功 ==");
  {
    const { state, events } = await runScenario(
      [{ url: DY_URL_A, platform: "douyin", fileName: "dy_popup.png" }],
      { onPrepare: () => PREPARE_OK, onSweep: (url, calls) => ({ clean: calls >= 1 }) },
    );
    const task = state.tasks[0];
    check("S3 最终 SUCCESS", task.status === "SUCCESS", `status=${task.status} error=${task.error || ""}`);
    check("S3 终检执行 2 次（第一次中止）", events.sweeps.length === 2, `sweeps=${events.sweeps.length}`);
    check("S3 只下载 1 次（弹窗那次没有产图）", events.downloads.length === 1, `downloads=${events.downloads.length}`);
    check("S3 消耗 1 次重试（attempts=2）", task.attempts === 2, `attempts=${task.attempts}`);
  }

  console.log("== S4 首帧超时判死：延后重试、期间不阻塞其他任务、二次失败明确 FAILED 零下载 ==");
  {
    const { state, events } = await runScenario(
      [
        { url: DY_URL_A, platform: "douyin", fileName: "dy_black.png" },
        { url: DY_URL_B, platform: "douyin", fileName: "dy_ok.png" },
      ],
      {
        onPrepare: (url) => (url.includes("0000001") ? PREPARE_FIRST_FRAME_TIMEOUT : PREPARE_OK),
        onSweep: () => ({ clean: true }),
      },
      { timeoutMs: 90000 },
    );
    const black = state.tasks.find((x) => x.fileName === "dy_black.png");
    const ok = state.tasks.find((x) => x.fileName === "dy_ok.png");
    check("S4 黑屏件明确 FAILED（不产坏图）", black.status === "FAILED", `status=${black.status}`);
    check("S4 黑屏件错误含 FIRST_FRAME_TIMEOUT", /FIRST_FRAME_TIMEOUT/.test(black.error || ""), `error=${black.error || ""}`);
    check("S4 黑屏件消耗 2 次尝试", black.attempts === 2, `attempts=${black.attempts}`);
    check("S4 正常件 SUCCESS", ok.status === "SUCCESS", `status=${ok.status} error=${ok.error || ""}`);
    const pngDownloads = events.downloads.filter((d) => (d.filename || "").endsWith(".png"));
    check("S4 仅正常件产生截图下载（png=1，失败清单 csv 不计）", pngDownloads.length === 1 && !pngDownloads.some((d) => d.filename.includes("dy_black")), `png下载=${pngDownloads.map((d) => d.filename).join(",")}`);
    const blackPrepares = events.prepares.filter((p) => p.url.includes("0000001")).map((p) => p.t);
    check("S4 黑屏件重试被延后（两次 prepare 间隔 >= 1200ms，修复前立即 reload）",
      blackPrepares.length === 2 && blackPrepares[1] - blackPrepares[0] >= 1200,
      `prepare 时刻=${blackPrepares.join(",")}`);
    const okPrepare = events.prepares.find((p) => p.url.includes("0000002"));
    check("S4 延后期间正常件先被调度（不空转等待）",
      Boolean(okPrepare) && blackPrepares.length === 2 && okPrepare.t < blackPrepares[1],
      `正常件 prepare=${okPrepare ? okPrepare.t : "无"} 黑屏件二次 prepare=${blackPrepares[1] || "无"}`);
    check("S4 运行正常结束（延后重试不会让 worker 提前退出）", state.status === "done", `status=${state.status}`);
    check("S4 延后等待期间有扩展 API 心跳（防 MV3 SW 空闲回收）", events.sessionGets >= 2, `sessionGets=${events.sessionGets}`);
  }

  console.log("== S6 页面重载竞态：准备函数缺失不再静默放行（绕闸门旁路已封死）==");
  {
    const { state, events } = await runScenario(
      [{ url: DY_URL_A, platform: "douyin", fileName: "dy_reload.png" }],
      { onPrepare: () => ({ ok: true, prepareMissing: true, message: "页面准备函数未加载" }), onSweep: () => ({ clean: true }) },
      { timeoutMs: 90000 },
    );
    const task = state.tasks[0];
    check("S6 任务 FAILED（修复前 ok:true 直接绕过全部闸门去截图）", task.status === "FAILED", `status=${task.status}`);
    check("S6 错误含 PREPARE_NOT_READY", /PREPARE_NOT_READY/.test(task.error || ""), `error=${task.error || ""}`);
    const pngDownloads = events.downloads.filter((d) => (d.filename || "").endsWith(".png"));
    check("S6 零截图下载（不产坏图）", pngDownloads.length === 0, `png下载=${pngDownloads.length}`);
  }

  console.log("== S5 非抖音回归：视频号任务不受影响，不执行抖音终检 ==");
  {
    const { state, events } = await runScenario(
      [{ url: WX_URL, platform: "weixin", fileName: "wx.png" }],
      { onPrepare: () => ({ ok: true, pageType: "", videoReady: false }), onSweep: () => ({ clean: true }) },
    );
    const task = state.tasks[0];
    check("S5 视频号任务 SUCCESS", task.status === "SUCCESS", `status=${task.status} error=${task.error || ""}`);
    check("S5 下载 1 次", events.downloads.length === 1, `downloads=${events.downloads.length}`);
    check("S5 未执行抖音终检", events.sweeps.length === 0, `sweeps=${events.sweeps.length}`);
  }

  console.log("\n==================== 结果 ====================");
  if (failures.length) {
    console.log(`FAIL ${failures.length} 项：`);
    for (const f of failures) console.log(`  - ${f}`);
    console.log("（修复前运行出现 FAIL 即为缺口复现；修复后运行必须全部 PASS）");
    process.exitCode = 1;
  } else {
    console.log("全部 PASS");
  }
}

main().catch((error) => {
  console.error("脚本执行异常：", error);
  process.exitCode = 1;
});
