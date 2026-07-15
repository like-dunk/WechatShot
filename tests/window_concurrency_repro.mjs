// 复现脚本：在 Node 中以"真实 background.js 的调度函数"运行截图任务，统计抖音批量截图时
// 同一时刻打开的浏览器窗口数量(并发窗口峰值)与运行结束后未被关闭的"孤儿窗口"数量。
//
// 为什么这样测：是否会"并发打开多个窗口"完全由 background.js 的事件循环调度逻辑
// (workerLoop / nextTask / ensureCaptureWindow / closeCaptureWindow / restartDouyinBatchWindowIfNeeded)
// 与 chrome.windows.create/remove 的异步时延决定。本脚本加载真实源码并注入带时延的
// chrome.* 桩，按窗口生命周期(create 解析=出现、remove 解析=消失)统计窗口数。
//
// 运行：node tests/window_concurrency_repro.mjs
// 仅模拟"普通窗口(非无痕)"场景，符合用户实际使用条件。

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const BG_PATH = path.resolve(__dirname, "..", "background.js");

// ---- 工具：带时延的异步返回 ----
function later(ms, fn) {
  return new Promise((resolve, reject) => {
    setTimeout(() => {
      try { resolve(fn()); } catch (e) { reject(e); }
    }, ms);
  });
}

// ---- 构建一次完整运行的环境与桩(每个场景独立)----
function buildEnv(LAT) {
  let winSeq = 0;
  let tabSeq = 0;
  const windows = new Map(); // 当前"存在"的窗口
  const tabs = new Map();
  const liveWindows = new Set(); // create 已解析、remove 未解析 → 屏幕上可见
  const createdWindowIds = [];
  const removedWindowIds = new Set();
  const timeline = [];
  let peakLive = 0;
  let createCalls = 0;
  let removeCalls = 0;
  const startedAt = Date.now();

  function sample(reason) {
    const size = liveWindows.size;
    if (size > peakLive) peakLive = size;
    timeline.push({ t: Date.now() - startedAt, size, reason });
  }

  const updatedListeners = [];

  const chrome = {
    runtime: {
      lastError: undefined,
      onConnect: { addListener() {} },
      onMessage: { addListener() {} },
      onInstalled: { addListener() {} },
    },
    storage: {
      // 回调风格(与 background.js 的 readStorageValue/writeStorage/clearAutoPptSession 一致)
      local: {
        get: (key, cb) => setTimeout(() => { chrome.runtime.lastError = undefined; cb({}); }, 1),
        set: (obj, cb) => setTimeout(() => { chrome.runtime.lastError = undefined; cb && cb(); }, 1),
        remove: (key, cb) => setTimeout(() => { chrome.runtime.lastError = undefined; cb && cb(); }, 1),
      },
      session: {
        get: (key, cb) => setTimeout(() => { chrome.runtime.lastError = undefined; cb && cb({}); }, 1),
        set: (obj, cb) => setTimeout(() => { chrome.runtime.lastError = undefined; cb && cb(); }, 1),
        remove: (key, cb) => setTimeout(() => { chrome.runtime.lastError = undefined; cb && cb(); }, 1),
      },
    },
    windows: {
      create(opts = {}) {
        createCalls += 1;
        return later(LAT.winCreate, () => {
          const id = ++winSeq + 1000;
          const w = { id, incognito: !!opts.incognito, state: "normal", width: opts.width || 1440, height: opts.height || 1200 };
          windows.set(id, w);
          liveWindows.add(id);
          createdWindowIds.push(id);
          sample("create");
          return { ...w };
        });
      },
      remove(id) {
        removeCalls += 1;
        return later(LAT.winRemove, () => {
          windows.delete(id);
          if (liveWindows.delete(id)) sample("remove");
          removedWindowIds.add(id);
          for (const [tid, t] of [...tabs]) if (t.windowId === id) tabs.delete(tid);
          return undefined;
        });
      },
      get(id) {
        return later(LAT.winGet, () => {
          const w = windows.get(id);
          if (!w) throw new Error("No window with id: " + id);
          return { ...w };
        });
      },
      update(id, info = {}) {
        return later(LAT.winUpdate, () => {
          const w = windows.get(id);
          if (!w) throw new Error("No window with id: " + id);
          if (info.state) w.state = info.state;
          if (info.width) w.width = info.width;
          if (info.height) w.height = info.height;
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
        return later(LAT.tabCreate, () => {
          const id = ++tabSeq;
          const t = { id, windowId, url: url || "about:blank", status: "complete", active: !!active };
          tabs.set(id, t);
          if (active) for (const [, o] of tabs) if (o.windowId === windowId && o.id !== id) o.active = false;
          return { ...t };
        });
      },
      get(id) {
        return later(LAT.tabGet, () => {
          const t = tabs.get(id);
          if (!t) throw new Error("No tab with id: " + id);
          return { ...t };
        });
      },
      update(id, info = {}) {
        return later(LAT.tabUpdate, () => {
          const t = tabs.get(id);
          if (!t) throw new Error("No tab with id: " + id);
          if (info.url !== undefined) { t.url = info.url; t.status = "complete"; }
          if (info.active !== undefined) {
            t.active = info.active;
            if (info.active) for (const [, o] of tabs) if (o.windowId === t.windowId && o.id !== id) o.active = false;
          }
          for (const fn of [...updatedListeners]) { try { fn(id, { status: "complete" }, { ...t }); } catch {} }
          return { ...t };
        });
      },
      remove(id) {
        return later(LAT.small, () => { tabs.delete(id); return undefined; });
      },
      query({ windowId, active } = {}) {
        return later(LAT.tabQuery, () => {
          let arr = [...tabs.values()];
          if (windowId !== undefined) arr = arr.filter((t) => t.windowId === windowId);
          if (active !== undefined) arr = arr.filter((t) => t.active === active);
          return arr.map((t) => ({ ...t }));
        });
      },
      captureVisibleTab(windowId, opts, cb) {
        setTimeout(() => { chrome.runtime.lastError = undefined; cb("data:image/png;base64," + "A".repeat(8000)); }, LAT.capture);
      },
    },
    scripting: {
      executeScript(injection = {}) {
        return later(LAT.exec, () => {
          if (injection.files) return [{ result: undefined }];
          if (injection.args) return [{ result: { ok: true, pageType: "video", videoReady: true } }];
          return [{ result: "complete" }]; // document.readyState / viewport
        });
      },
    },
    downloads: {
      download(opts, cb) {
        setTimeout(() => { chrome.runtime.lastError = undefined; cb(1); }, LAT.download);
      },
    },
  };

  const ScreenshotCache = {
    cleanupOld: async () => {},
    putScreenshot: async () => "k",
    dataUrlToBlob: async () => ({ size: 8000 }),
  };

  const metrics = () => ({
    peakLive,
    endLive: liveWindows.size,
    createCalls,
    windowsCreated: createdWindowIds.length,
    windowsRemoved: removedWindowIds.size,
    orphans: createdWindowIds.filter((id) => !removedWindowIds.has(id)).length,
    timeline,
  });

  return { chrome, ScreenshotCache, metrics };
}

// ---- 加载真实 background.js，暴露 startRun / state / captureWindowId ----
function loadBackground(env) {
  let src = fs.readFileSync(BG_PATH, "utf8");
  // 去掉 importScripts(由桩注入 ScreenshotCache)
  src = src.replace('importScripts("screenshot-cache.js");', "");
  // 仅为加速：缩短与窗口竞态无关的"停留等待"(任务执行期间 runningDouyinCount 仍=1，不影响多窗竞态)
  src = src.replace("const DOUYIN_POST_LOAD_WAIT_MS = 2500;", "const DOUYIN_POST_LOAD_WAIT_MS = 50;");
  src = src.replace("const DOUYIN_POST_PREPARE_WAIT_MS = 1500;", "const DOUYIN_POST_PREPARE_WAIT_MS = 50;");
  src = src.replace("const DOUYIN_FALLBACK_RENDER_WAIT_MS = 3000;", "const DOUYIN_FALLBACK_RENDER_WAIT_MS = 50;");
  // 注意：DOUYIN_COOLDOWN_MS(3000) 与批次重建、任务间冷却的竞态强相关，保持真实值不改。
  const epilogue = "\n;return { startRun, getState: () => state, getCaptureWindowId: () => captureWindowId };\n";
  const factory = new Function("chrome", "ScreenshotCache", "console", src + epilogue);
  return factory(env.chrome, env.ScreenshotCache, console);
}

function buildTasks({ count, mix }) {
  const tasks = [];
  for (let i = 0; i < count; i += 1) {
    const isDouyin = mix === "douyin" ? true : (i % 2 === 0);
    if (isDouyin) {
      tasks.push({ url: `https://www.douyin.com/video/70000000000000000${i}`, platform: "douyin", fileName: `dy_${i}.png` });
    } else {
      tasks.push({ url: `https://channels.weixin.qq.com/abc${i}`, platform: "weixin", fileName: `wx_${i}.png` });
    }
  }
  return tasks;
}

async function runScenario(name, cfg) {
  const LAT = cfg.LAT;
  const env = buildEnv(LAT);
  const bg = loadBackground(env);
  const tasks = buildTasks(cfg);
  const options = {
    concurrency: cfg.concurrency,
    delayMs: 800,
    captureSizeMode: "current",
    douyinWindowMode: cfg.windowMode || "regular", // regular=普通窗口 / incognito=无痕
    includeScreenshotWorkbook: false,
    autoGeneratePpt: false,
    enableSupplementRepairZip: false,
    douyinProxyRotation: { enabled: false },
  };
  await bg.startRun(tasks, options);
  // 加速观测：可将批次大小改小以更快触发"每 N 条重建窗口"。批次=20 时用真实值。
  if (cfg.forceBatchSize) bg.getState().options.douyinBatchSize = cfg.forceBatchSize;

  const deadline = Date.now() + (cfg.timeoutMs || 200000);
  while (Date.now() < deadline) {
    const st = bg.getState().status;
    if (st === "done" || st === "stopped" || st === "idle") break;
    await new Promise((r) => setTimeout(r, 200));
  }
  // 等待 finalize 的关窗与在途 remove 落定
  await new Promise((r) => setTimeout(r, Math.max(LAT.winRemove, LAT.winCreate) + 300));

  const m = env.metrics();
  const st = bg.getState();
  const successCount = st.tasks.filter((t) => t.status === "SUCCESS").length;
  return {
    name,
    config: { concurrency: cfg.concurrency, tasks: cfg.count, mix: cfg.mix, batchSize: cfg.forceBatchSize || 20, LAT },
    status: st.status,
    successCount,
    ...m,
  };
}

function printResult(r) {
  console.log("\n==================================================");
  console.log(`场景: ${r.name}`);
  console.log(`配置: 并发=${r.config.concurrency} 任务=${r.config.tasks}条(${r.config.mix}) 批次重建阈值=${r.config.batchSize} 窗口建/关时延=${r.config.LAT.winCreate}/${r.config.LAT.winRemove}ms`);
  console.log(`结果: status=${r.status} 成功=${r.successCount}/${r.config.tasks}`);
  console.log(`>>> 同一时刻并发窗口峰值 peakLive = ${r.peakLive}`);
  console.log(`>>> 运行期间总共 create 窗口次数 = ${r.windowsCreated}，remove 次数 = ${r.windowsRemoved}`);
  console.log(`>>> 结束后仍存活(未被关闭)的孤儿窗口 orphans = ${r.orphans}`);
  const peaks = r.timeline.filter((s) => s.size >= 2);
  if (peaks.length) {
    console.log(`    出现 >=2 窗口的时刻片段(t毫秒:窗口数):`);
    console.log("    " + peaks.slice(0, 20).map((s) => `${s.t}:${s.size}`).join("  "));
  } else {
    console.log(`    全程未出现 >=2 个窗口同屏。`);
  }
}

(async () => {
  const FAST = { winCreate: 150, winRemove: 80, winGet: 5, winUpdate: 10, tabCreate: 20, tabGet: 3, tabUpdate: 8, tabQuery: 3, exec: 10, capture: 100, download: 20, small: 3 };
  const EXTREME_REMOVE = { ...FAST, winCreate: 100, winRemove: 2000 }; // 极端：关窗奇慢，逼出非无痕重叠边界

  const results = [];
  // 非无痕(用户实际场景)
  results.push(await runScenario("A. 纯抖音 · 普通窗口 · 真实批次=20", { concurrency: 8, count: 24, mix: "douyin", forceBatchSize: 0, LAT: FAST, timeoutMs: 220000 }));
  results.push(await runScenario("B. 混合(抖音+视频号) · 普通窗口 · 批次=3", { concurrency: 8, count: 16, mix: "mixed", forceBatchSize: 3, LAT: FAST, timeoutMs: 180000 }));
  results.push(await runScenario("C. 纯抖音 · 普通窗口 · 关窗极慢(2000ms) · 批次=3", { concurrency: 8, count: 12, mix: "douyin", forceBatchSize: 3, LAT: EXTREME_REMOVE, timeoutMs: 200000 }));
  // 无痕(对照：验证模拟器能复现多窗，且解释用户观察)
  results.push(await runScenario("D. 无痕 · 纯抖音 · 批次=3", { concurrency: 8, count: 12, mix: "douyin", windowMode: "incognito", forceBatchSize: 3, LAT: FAST, timeoutMs: 150000 }));
  results.push(await runScenario("E. 无痕 · 混合(抖音+视频号) · 批次=3", { concurrency: 8, count: 16, mix: "mixed", windowMode: "incognito", forceBatchSize: 3, LAT: FAST, timeoutMs: 180000 }));

  for (const r of results) printResult(r);

  console.log("\n==================== 总结 ====================");
  for (const r of results) {
    console.log(`${r.name} -> 并发窗口峰值=${r.peakLive}，孤儿窗口=${r.orphans}，建窗总数=${r.windowsCreated}`);
  }
})();
