# 项目总结：视频号/头条号/抖音/小红书批量截图助手（Chrome MV3 扩展）

> 本文档基于源码实际内容整理（manifest.json 版本 0.1.0），供二次开发时快速定位思路与代码位置。
> 文档与代码不一致时以代码为准，并请追加更新本文档末尾的「变更记录」。

## 目录

- 1. 项目概览
- 2. 架构说明
  - 2.1 运行组件与消息流
  - 2.2 后台全局状态与任务状态机
- 3. 模块与职责表
- 4. 关键流程说明
  - 4.1 任务导入与解析（popup）
  - 4.2 任务调度（workerLoop / nextTask / 并发控制）
  - 4.3 抖音专用保守流程
  - 4.4 截图管线（loadTaskUrl 到缓存）
  - 4.5 收尾流程（finalizeRun）
  - 4.6 自动 PPT 生成流程（双路径）
  - 4.7 手动 PPT 生成流程与四种模式
  - 4.8 带截图 Excel / 纠错修正 Excel 生成流程
  - 4.9 精准补充模式与修复版 ZIP
  - 4.10 Reflo 发布信息增强与 Excel 纠错
- 5. 消息接口清单
  - 5.1 chrome.runtime.onMessage（一次性消息）
  - 5.2 长连接 Port 协议
- 6. 存储结构
  - 6.1 chrome.storage.local 键
  - 6.2 IndexedDB 库表
- 7. 设计思路与关键约束
- 8. 交叉引用（功能 -> 文件:函数）
- 9. 测试与辅助脚本
- 10. 变更记录

---

## 1. 项目概览

- 名称：视频号/头条号/抖音/小红书批量截图助手（manifest.json）。
- 形态：Chrome Manifest V3 扩展，service worker 后台 + popup 弹窗 + content script + 若干扩展内页面。
- 核心能力：
  - 从 Excel/CSV 任务表提取平台链接，批量打开页面并截图，下载到 `下载目录/截图/时间戳_源文件名_截图/`。
  - 可选导出：带截图 Excel、失败清单 CSV、精准补充修复版 ZIP、自动/手动 PPT（四种模式，支持自定义 .pptx 模板）。
  - 可选 Reflo API 发布信息增强与 Excel 纠错/修正（后台代理请求绕过 CORS）。
  - 抖音专用保守模式：单并发、前台加载、批次重建截图窗口、可选无痕窗口与 Clash VPN 节点轮换。
- 支持平台与链接判定：weixin（weixin.qq.com/sph、channels.weixin.qq.com）、toutiao（m.toutiao.com/is|video、toutiao.com/article|w|video）、douyin（v.douyin.com 短链、douyin.com/video|note）、xiaohongshu（xhslink.com 短链、xiaohongshu.com/explore|discovery/item）。见 `background.js:detectPlatformFromUrl` 与 `popup.js:getUrlPlatform`（两处逻辑一致）。
- 权限：`activeTab、downloads、scripting、storage、tabs`，host_permissions `<all_urls>`，`incognito: spanning`；content.js 通过 manifest 在四个平台域名 `document_idle` 注入（截图前后台还会用 scripting 再注入一次以保证存在）。

## 2. 架构说明

### 2.1 运行组件与消息流

```
popup.html/popup.js  <── chrome.runtime.sendMessage（GET_STATE 等，1.2s 轮询）──>  background.js (service worker)
       │                                                                             │
       │ chrome.runtime.connect("supplement-upload")  分块上传精准补充原图           │ chrome.scripting.executeScript
       │                                                                             ▼
       │                                                                       目标页面 tab（专用截图窗口内）
       │                                                                             │ content.js: window.shipinhaoPrepareForScreenshot
       │                                                                             ▼
       │                                                                       captureVisibleTab -> dataUrl -> downloads / IndexedDB 缓存
       │
       ├── download-workbook.html?id=xxx  <── Port "workbook-download" 分块接收 Excel/ZIP 字节，页面内触发 chrome.downloads
       └── auto-ppt.html/auto-ppt.js      <── sendMessage(CLAIM/GET_SUCCESS_SCREENSHOT_RECORDS/MARK_*)，读 IndexedDB 生成 PPT
```

- popup 是"编排端"：解析任务表、收集选项、发 START，随后每 1200ms 轮询 GET_STATE 刷新 UI（`popup.js:init/refreshState`）。
- background 是"执行端"：持有内存态 `state`，负责调度、导航、截图、下载、Excel/ZIP 打包；不直接操作 DOM。
- content.js 是"页面准备端"：只暴露一个全局函数 `shipinhaoPrepareForScreenshot`，由后台 executeScript 调用，返回结构化校验结果。
- 大二进制传输不走 sendMessage（消息体积限制），改走 Port 分块 base64：导出方向用 `workbook-download`，上传方向用 `supplement-upload`。
- PPT 生成全部在扩展页面（popup 或 auto-ppt.html）内完成，因为需要 DOMParser/Image/canvas，service worker 没有这些能力。

### 2.2 后台全局状态与任务状态机

`background.js` 顶部 `DEFAULT_STATE` 定义了全部运行态，`startRun` 时 `structuredClone` 重置。

- 运行级 `state.status` 状态机：
  - `idle -> running`（START）
  - `running <-> paused`（PAUSE / RESUME）
  - `running|paused -> stopping`（STOP，等 worker 退出）
  - worker 全部结束后 `finalizeRun`：`stopped=true` 时 -> `stopped`；否则 -> `finalizing` -> `done`
- 任务级 `task.status` 状态机（本项目约定的五态）：
  - `PENDING -> RUNNING -> SUCCESS`
  - `RUNNING -> FAILED`（attempts >= 2 后判定失败；`FAILED` 计入 state.failed）
  - `RUNNING -> PENDING`（可重试：attempts < 2 且未停止；或非抖音任务因截图窗口重建导致 tab 销毁，不消耗重试次数）
  - `RUNNING|PENDING -> STOPPED`（用户停止，`markStoppedTasks`）
  - 收尾时仍处于 PENDING/RUNNING 的任务由 `markUnfinishedTasksFailed` 强制置 FAILED。
- 每个任务的 `attempts` 上限 2（即 1 次初始 + 1 次重试），见 `workerLoop` 的 catch 分支。
- `getPublicState` 输出给 popup 的公开状态（任务列表瘦身字段 + 最近 100 条日志 + 隐去 Clash secret）。
- 空闲时若存在未过期的 `autoPptSession`（storage），`GET_STATE` 会用 `buildPublicStateFromSession` 伪造一个 `done` 状态，让重开的 popup 能继续补生成自动 PPT。

## 3. 模块与职责表

| 文件 | 行数（约） | 职责 | 关键函数/入口 |
| --- | --- | --- | --- |
| manifest.json | 54 | MV3 声明：权限、后台 worker、content script 注入域名 | - |
| background.js | 2267 | service worker：消息路由、任务调度、专用截图窗口、抖音批次/代理轮换、截图节流与串行、下载、失败 CSV、带截图/纠错 Excel（手写 xlsx XML + ZIP）、修复版 ZIP、Reflo 代理请求、autoPptSession | `handleMessage`、`startRun`、`workerLoop`、`nextTask`、`processTask`、`loadTaskUrl`、`ensureCaptureWindow`、`captureTabSerial`、`restartDouyinBatchWindowIfNeeded`、`rotateClashProxy`、`finalizeRun`、`buildScreenshotWorkbook`、`buildCorrectedWorkbook`、`createZip`、`fetchRefloReleaseInfoBatchInBackground` |
| content.js | 174 | 页面准备与弹窗清理：等待有效内容、多轮移除遮挡弹窗（登录/扫码/下载 App/验证码等）、静音播视频、按平台校验页面有效性（风控文案检测） | `shipinhaoPrepareForScreenshot`、`stabilizeBlockingOverlays`、`removeBlockingOverlays`、`shouldRemoveElement`、`waitForVideoPlayback`、`validatePage`、`validateXiaohongshuPage` |
| popup.js | 3713 | 弹窗全部逻辑：多文件导入合并（自带 zip/xlsx/CSV 解析器）、链接列智能识别、任务构建、Reflo 增强、Excel 纠错/修正、四种 PPT 模式与自定义模板、粉丝量截图来源（手动/Excel 内嵌 DISPIMG）、精准补充、启动/暂停/停止、状态轮询渲染 | `init`、`handleTaskFiles`、`mergeParsedFiles`、`parseXlsx`、`parseSheetRows`、`buildTasks`、`analyzeImportRows`、`startRun`、`applyState`、`enrichTasksWithReflo`、`runExcelCorrectionWorkflow`、`buildExcelCorrectionReport`、`generatePpt`、`buildPptByMode`、`autoGeneratePptFromCompletedRun`、`uploadSupplementRepairSource`、`extractFanImagesFromCellImages`、`persistFanSourceForAutoPpt` |
| popup.html / popup.css | 357 / - | 弹窗 UI 结构与样式（元素 id 与 popup.js `elements` 表一一对应） | - |
| pptx-builder.js | 1548 | PPT 生成引擎（`window.PptxClippings`）：解析模板 pptx（zip + XML DOM）、按四种模式克隆模板页并插图/改文字、图片规范化（webp 转 png、取宽高）、模板模式自动识别、打包下载 | `buildFromZipFile/buildFromImageFiles`（剪报）、`buildLinkScreenshot*`、`buildReleaseInfoScreenshot*`、`buildDawanqu*`、`analyzeTemplateFile`、`detectTemplateMode`、`createPagePlan/chooseLayout`、`buildReleaseInfoTemplateSlideXml`、`normalizeImage`、`createZip`、`downloadResult` |
| screenshot-cache.js | 301 | 两个独立 IndexedDB 封装：ScreenshotCache（截图缓存）与 TemplateCache（自定义 PPT 模板缓存），均带 3 天过期清理；被 background（importScripts）和扩展页面（script 标签）复用 | `ScreenshotCache.putScreenshot/getScreenshot/getScreenshotsByRun/cleanupOld/dataUrlToBlob/blobToBytes`；`TemplateCache.putTemplate/getTemplate/cleanupOldTemplates` |
| fan-source-cache.js | 123 | FanSourceCache：粉丝量截图来源缓存（IndexedDB，3 天过期），供截图完成后的自动 PPT 按 id 取回 | `putFanSource/getFanSource/deleteFanSource/cleanupOldFanSources` |
| auto-ppt.html / auto-ppt.js | 39 / 131 | 后台在任务完成后打开的内部页面：认领自动 PPT 生成权、从缓存读成功截图、按模式生成 PPT 并下载、上报结果后自关闭（兜底 popup 已关闭的场景） | `runAutoPptGeneration`、`receiveSuccessScreenshots`、`buildPptByMode`、`loadAutoPptTemplateBytes` |
| download-workbook.html / download-workbook.js | - / 75 | 通过 Port 分块接收后台的 Excel/ZIP 字节，拼 Blob 后用 chrome.downloads 触发下载并自关闭 | `downloadWorkbook` |
| tests/ | - | Node 复现脚本（非浏览器） | `window_concurrency_repro.mjs`（加载真实 background.js + chrome 桩，统计并发窗口峰值与孤儿窗口）、`analyze_xlsx_links.mjs`（用真实 xlsx 验证链接提取正则） |
| tools/ | - | 本地辅助脚本（xlsx 检查、pptx 生成/校验等 Python/JS 工具，非扩展运行时代码） | - |
| 根目录 4 个 .pptx | - | 内置 PPT 模板（web_accessible 方式随扩展打包，由 pptx-builder fetch 读取） | 发布剪报-模板(1)(1).pptx、链接截图单图单页-模板.pptx、新单图单页-模板.pptx、【模版】AIGC-奕境X9粤港澳大湾区车展传播汇总.pptx |

## 4. 关键流程说明

### 4.1 任务导入与解析（popup）

1. `handleTaskFiles`：支持多选与拖拽，逐个 `parseInputFile`（.csv 走 `parseCsv`；.xlsx 走自带解析器 `parseXlsx`：手写 ZIP 中央目录解析 + DecompressionStream(deflate-raw) + DOMParser 解析 sheet/sharedStrings/styles/hyperlinks）。同名文件视为更新替换，其余追加到 `importedTaskFiles` 累积。
2. 附加解析产物：
   - `fillMarks`：由 styles.xml 判定每行是否有背景填充（`parseStyleFillMarks`，排除 none/gray125），供「只处理背景标记行」用；CSV 为 null（选项被忽略）。
   - `cellImages`：WPS「单元格图片」DISPIMG 内嵌图（`resolveCellImageRefs` + `loadCellImages`），从中提取粉丝量截图列（表头含「粉丝」，`extractFanImagesFromCellImages`），生成「序号_昵称.ext」命名的兜底粉丝量图。
3. 多文件时 `mergeParsedFiles` 按首文件表头对齐合并（列名不存在则取并集追加），产出合并 rows + fillMarks。
4. `applyParsedRows` -> `buildTasks`：`analyzeImportRows` 打分选出链接列（`scoreLinkColumn`：支持链接数量、占比、表头关键词加分，素材/短链扣分），识别昵称/序号/发布账号/平台/标题/链接/时间列；每行按 `extractVideoUrls` 提取多条链接生成多个任务。序号模式两种：`sequence`（全局连续重排，起始取首个有效行序号）与 `row`（Excel 行号 - 1）。文件名 `序号_昵称.png` 去重（`buildUniqueFileName`）。
5. 精准补充模式下 `getTasksForCurrentCaptureMode` 只保留「已有截图文件夹中按文件名找不到」的任务。

### 4.2 任务调度（workerLoop / nextTask / 并发控制）

- `startRun(tasks, options, ...)`（background）：拒绝并行运行；清理过期截图缓存与 autoPptSession；重置 state；`normalizeOptions`（concurrency 1-8 默认 2，delayMs 最小 500，waitMs 默认 12000，存在抖音任务时强制 waitMs >= 60000 并自动开启 `douyinConservativeMode`）；启动 `concurrency` 个 `workerLoop`，`Promise.allSettled(workers).then(finalizeRun)`。
- `nextTask()` 是唯一取活入口，实现「抖音全局单并发」：
  - 若 `state.runningDouyinCount > 0`：优先返回一个非抖音 PENDING 任务；没有则返回 `{ __wait: true }` 让 worker 睡 500ms 再试。
  - 否则返回第一个 PENDING 任务（抖音或非抖音）。因此任一时刻最多只有 1 个抖音任务在 RUNNING，非抖音任务仍按 concurrency 并行。
- `workerLoop(workerId)`：循环 `waitWhilePaused -> nextTask -> ensureWorkerTabForTask -> processTask`；成功计 success，异常按 4.2 状态机重试/失败；每条任务后按 `getTaskDelayMs` 间隔（抖音最小 3000ms 冷却，其余用 delayMs）；抖音任务终局（SUCCESS 或 FAILED）后调用 `restartDouyinBatchWindowIfNeeded` 计批次。
- 所有 worker 的 tab 共用一个「专用截图窗口」（`ensureCaptureWindow` 单例，`captureWindowPromise` 防并发重复创建）；窗口无痕属性与任务需要不一致时先关旧窗重建。

### 4.3 抖音专用保守流程

存在抖音任务时自动进入保守模式（`normalizeOptions:douyinConservativeMode`），要点：

- 串行并发 1：由 `nextTask` 的 `runningDouyinCount` 门控实现（见 4.2）。
- 前台加载：`loadTaskUrl` 抖音分支会 `focusCaptureWindow` + `tabs.update({active:true})`，然后 `waitForNavigationStart`（5s）、`waitForTabDomReady`（30s，容忍超时）、`waitForDouyinContentUrl`（最长 60s，轮询判定 URL 已到 douyin.com/video|note；根路径视为「作品不存在或已删除」；5s 后仍跳到非抖音域名视为风控/失效；每 5s 打一条进度日志）。
- 等待参数：加载后等 2500ms（`DOUYIN_POST_LOAD_WAIT_MS`）；prepare 后等 1500ms，若视频页但 `videoReady=false` 加长到 3000ms（`getPostPrepareWaitMs`）。
- 任务间冷却：`getTaskDelayMs` 对抖音取 `max(delayMs, 3000)`。
- 批次重建：`restartDouyinBatchWindowIfNeeded`，每完成 `douyinBatchSize`（固定 20）条抖音终局任务且仍有待处理抖音任务时：关 tab、`closeCaptureWindow`、重置截图节流与串行链、可选 VPN 轮换、冷却 3s、重建窗口。
- 窗口模式：`douyinWindowMode` regular/incognito；无痕创建失败自动回退普通窗口并记录 `douyinIncognitoFallbackUsed`（`createCaptureWindow`）。
- VPN 轮换（可选，`douyinProxyRotation.enabled`）：`rotateDouyinProxyIfEnabled` 每批次触发：
  1. `logPublicIpProbe` 记录轮换前出口 IP（api.ipify.org / api64.ipify.org / icanhazip.com，8s 超时，逐个降级）。
  2. `rotateClashProxyUntilIpChanges`：调 Clash 控制器 REST API（默认 http://127.0.0.1:9090，GET/PUT `/proxies/{groupName}`，可带 Bearer secret）切到候选列表下一个节点；候选来自策略组 all/proxies，剔除 DIRECT/REJECT/GLOBAL/自动测速类（`isRotatableClashProxyName`），用户可用 `nodeNames` 指定白名单；每次切换后等 settleMs（默认 3000）再探测 IP，未变化则继续切下一个，最多尝试「指定节点数（上限 12）」次。
  3. 失败只告警不阻断（`state.douyinProxyRotation.failures` 计数）。
- 注意：插件只切换本机 Clash 节点，Chrome 是否实际走该代理取决于系统/浏览器代理设置（startRun 日志中有明确提示）。

### 4.4 截图管线（loadTaskUrl 到缓存）

`processTask(tabId, task)` 全程记录 perf 耗时（load/wait1/prepare/wait2/lock/throttle/activate/capture/download），单条与汇总日志分别由 `logTaskPerf`、`logPerfSummary` 输出：

1. `loadTaskUrl`：非抖音走 `tabs.update(active:false)` + `waitForTabComplete(waitMs)` + `waitForPlatformNavigation`（抖音/小红书短链跳转等待；小红书 404 跳转页可自动从 redirectPath 修复真实笔记链接，或识别 error_code=300031「Web 端暂不可浏览」直接失败）。抖音见 4.3。
2. `sleep(getPostLoadWaitMs)`：非抖音 1200ms。
3. `prepareTab`：executeScript 注入 content.js（幂等）后调用 `window.shipinhaoPrepareForScreenshot({platform,url})`；`validatePreparedPage` 对 `ok:false` 直接抛错（含风控/未登录/短链未跳转等 message）。
4. `sleep(getPostPrepareWaitMs)`：非抖音 800ms。
5. `captureTabSerial(tabId, useIncognito)`：所有截图排入全局 `captureChain` 串行执行——
   - `throttleCapture`：保证相邻两次 captureVisibleTab 间隔 >= 650ms；
   - `ensureCaptureWindow` + `activateTabForCapture`：聚焦窗口（最小化则先恢复）、激活目标 tab、`ensureViewportCalibrated`（非 current 模式按预设/自定义宽高微调窗口尺寸使视口达标，每种尺寸只校准一次）、等 650ms 渲染，再校验活动 tab 确为目标 tab，3 次失败抛「未能激活目标标签页」以避免错页保存；
   - `captureVisibleTab(windowId, png)`；`describeCaptureError` 翻译常见错误（view is invisible / image readback failed）。
6. 数据校验：dataUrl 长度 < 5000 视为空白页/弹窗遮挡，抛错触发重试。
7. `downloadScreenshot`：chrome.downloads 存到 `sessionDownloadDir/文件名`（`buildSessionDownloadDir` = `截图/YYYY-MM-DD_HH-mm-ss_源文件名_截图`），冲突 uniquify。
8. `cacheTaskScreenshot`：当开启带截图 Excel / 修复 ZIP / 自动 PPT 任一时，把截图 Blob 写入 ScreenshotCache（key = `runId:taskId`），失败会让该任务整体失败（因为后续导出依赖缓存）。

截图尺寸预设（`CAPTURE_SIZE_PRESETS`）：current 1440x1200、vertical 720x1280、horizontal 1280x720、square 1080x1080、custom（360-1920 x 360-2160）。

### 4.5 收尾流程（finalizeRun）

顺序：标记未完成任务 -> 输出统计与耗时汇总 -> 失败清单 CSV（有失败时）-> 带截图 Excel（开启且有 sourceRows）-> 修复版 ZIP（精准补充开启）-> 关闭截图窗口 -> status=done -> 保存 autoPptSession（自动 PPT 开启时）-> 打开 auto-ppt.html（若还没生成）。停止场景则只标记 STOPPED、关窗、status=stopped。

### 4.6 自动 PPT 生成流程（双路径）

生成权由后台统一仲裁（`CLAIM_AUTO_PPT_GENERATION`，用 `autoPptInProgress/Generated/Failed` 标志防止双端重复生成）：

- 路径 A（popup 仍开着）：`applyState` 检测到 `status=done && autoGeneratePpt && 未生成` 时调 `autoGeneratePptFromCompletedRun`：CLAIM -> `receiveAutoPptSuccessScreenshots`（GET_SUCCESS_SCREENSHOT_RECORDS 拿轻量记录，再逐条从 ScreenshotCache 取 Blob 组 File）-> `buildPptByMode`（tasks 元数据随截图记录带回；自定义模板优先内存 bytes，其次按 `autoPptTemplateId` 读 TemplateCache；粉丝量图按 `autoPptFanSourceId` 读 FanSourceCache）-> 下载 -> MARK_AUTO_PPT_GENERATED。
- 路径 B（popup 已关）：finalizeRun 打开 auto-ppt.html，auto-ppt.js 执行同样的 CLAIM/读缓存/生成/MARK 流程，完成或未启动时 1.5s 后自关标签页；失败则 MARK_AUTO_PPT_FAILED 并停留显示错误。
- `autoPptSession`（storage，3 天有效）保证 service worker 被回收或浏览器重启后，重开 popup 仍能看到 done 状态并补生成。

### 4.7 手动 PPT 生成流程与四种模式

popup「生成并下载 PPT」：来源为 ZIP 或文件夹（`inspectZipFile/inspectImageFiles` 预检）-> 可选先 Reflo 增强 -> `buildPptByMode` -> `PptxClippings.downloadResult`。模式（`PPT_MODES`）：

| 模式 | 内置模板 | 生成方式（pptx-builder.js） |
| --- | --- | --- |
| clippings 发布剪报多图铺页 | 发布剪报-模板(1)(1).pptx | `createPagePlan/chooseLayout` 按图片中位宽高比选网格（最多 3 行 x 15 列、每页上限 15 张），克隆「发布剪报」页铺图 |
| link-screenshot 链接截图单图单页 | 链接截图单图单页-模板.pptx | 取模板第 4 页（索引 3），替换「视频-序号」与链接文本框，移除原图后按 7 英寸宽插入截图 |
| release-info-screenshot 发布信息截图单图单页 | 新单图单页-模板.pptx | 重建页面：大标题 + 发布账号/平台/标题/链接/时间五行文本（自适应行高与字号 14/13/12/11）+ 截图；有粉丝量图时左右分栏放两图 |
| dawanqu 大湾区崭新模版 | 【模版】AIGC-奕境X9粤港澳大湾区车展传播汇总.pptx | 走 release-info 流程但 `preserveTemplateLayout=true`：保留模板大标题与 logo，占位图（含「截图参考」类提示图形）替换为真实截图 |

- 截图与任务匹配：`buildLinkScreenshotItems` 先按文件名（去扩展名小写）精确匹配任务，再按顺序兜底；只有精确匹配的页才尝试配粉丝量截图（`resolveFanImageForTask`，key = `序号_昵称`，序号优先 importSequence）。
- 自定义模板：`analyzeTemplateFile` 解析 pptx 并 `detectTemplateMode` 启发式识别模式（含发布账号等字段 -> release-info；含发布剪报/一页贴 -> clippings；含链接文本 -> link-screenshot；单页多图 -> clippings；否则默认 link-screenshot），识别后锁定模式下拉框；模板字节持久化到 TemplateCache 供自动 PPT 复用。
- 限制：源 ZIP <= 2GB、图片 <= 5000 张、单图 <= 25MB、产物 <= 2.6GB；webp 自动经 canvas 转 png。输出目录 `截图/时间戳_源名_PPT/`。

### 4.8 带截图 Excel / 纠错修正 Excel 生成流程

- 带截图 Excel（`downloadScreenshotWorkbook`）：从 ScreenshotCache 取成功截图字节 -> `buildScreenshotWorkbook` 在源表右侧追加「截图」列（同行多图追加截图2...），图片用 drawing oneCellAnchor 锚到对应行 -> `buildXlsxFiles` 手写全套 xlsx XML -> `createZip`（STORE 不压缩，ZIP32 上限校验）-> `queueBinaryDownload` 打开 download-workbook.html 分块传输下载。限制：<= 200 张图、<= 300MB。
- 纠错/修正 Excel（`DOWNLOAD_CORRECTED_WORKBOOK` -> `buildCorrectedWorkbook`）：popup 传 rows + rowStyles/cellStyles，样式 id 映射 red=1/purple=2/yellow=3/blue=4/orange=5（styles.xml 五种底色填充），sheet 名「纠错结果/修正结果」，文件名 `源名_纠错结果.xlsx / 源名_修正结果.xlsx`。

### 4.9 精准补充模式与修复版 ZIP

1. popup 选「精准补充」并上传已有截图文件夹（`collectSupplementImageEntries`，仅 png/jpg/jpeg/webp，总量 <= 2GB）；任务列表过滤为缺失文件名的任务。
2. 启动前 `uploadSupplementRepairSource` 经 Port "supplement-upload" 把原图分块（512KB base64）传给后台暂存（`pendingSupplementUploads`），拿到 uploadId 随 START 传入；后台 `resolveSupplementRepairSource` 认领。
3. 收尾 `downloadSupplementRepairZip`：`buildSupplementRepairZip` 以补拍成功截图按 sequenceKey（文件名前缀数字，`deriveSequenceKey`）替换同序号原图 + 同名覆盖，打成 `源文件夹名_修复版_时间戳.zip` 走分块下载。

### 4.10 Reflo 发布信息增强与 Excel 纠错

- 请求路径：popup `fetchRefloReleaseInfoBatch` -> sendMessage(REFLO_RELEASE_INFO_BATCH) -> background `fetchRefloReleaseInfoBatchInBackground` 实际 fetch（MV3 下仅后台可凭 host_permissions 绕过 CORS）。批大小 50，超时 600s；5xx/429/网络中断标记 retryable，popup 侧指数退避重试（共 4 次尝试，2s/4s/8s，上限 15s）；超时（AbortError）不重试。
- 增强（`enrichTasksWithReflo`）：把返回的 account/platform/title/link/time（含 timeWithSeconds）、播放/点赞/评论/收藏/分享/粉丝数、anomaly 合并进 task.releaseInfo（`mergeReleaseInfo`，非空字段覆盖 Excel 值），供 release-info 类 PPT 填充。触发时机：启动截图前（勾选增强 + 自动 PPT + release-info 类模式）或手动生成 PPT 前。
- Excel 纠错/修正（`runExcelCorrectionWorkflow -> buildExcelCorrectionReport`）：
  - 本地检查：链接可提取性（红，整行）、链接重复（紫，整行）、账号重复（蓝，单元格，以 Reflo 正确账号为准判重）。
  - Reflo 对比：发布日期/标题/平台/账号与 Excel 不一致标黄；修正模式回填 fixValue 并计 fixedCells；标题主题异常（Reflo anomaly，AI 检测）标橙（整行）。
  - 附加输出：可选「纠错说明」列；指标列（播放量/点赞数/评论量/收藏量/分享数，可选粉丝数）；视频号/小红书无真实播放量时按互动总量在用户给定 [min,max] 区间线性估算播放量（`estimatePlayCountsForRange`）；发布日期整列归一化（Excel 序列号 46171 一类统一转 `YYYY-MM-DD`，可选精确到时分秒）；多文件合并时序号列全局重排；「只处理背景标记行」按 fillMarks 过滤。
  - 报告持久化到 storage（`refloReleaseInfoCorrectionMemory`），重开 popup 可看上次结果。

## 5. 消息接口清单

### 5.1 chrome.runtime.onMessage（background `handleMessage`，均返回 `{ ok, ... }`，异常统一 `{ ok:false, error }`）

| type | 方向 | 参数 | 返回 |
| --- | --- | --- | --- |
| GET_STATE | popup -> bg | 无 | `{ ok, state }`（idle 且有 autoPptSession 时返回会话伪造的 done 态） |
| START | popup -> bg | `tasks, options, sourceRows, sourceFileName, sourceHeaderRowIndex, supplementRepairUploadId` | `{ ok, state }`；运行中/无任务返回错误 |
| PAUSE / RESUME / STOP | popup -> bg | 无 | `{ ok, state }` |
| GET_SUCCESS_SCREENSHOT_RECORDS | popup/auto-ppt -> bg | 无 | `{ ok, runId, sourceName, screenshots:[{id,cacheKey,fileName,task}] }`（轻量记录，Blob 由页面自行读 IndexedDB） |
| GET_SUCCESS_SCREENSHOTS | 已废弃 | 无 | 固定 `{ ok:false, error }`，提示改用 RECORDS |
| CLAIM_AUTO_PPT_GENERATION | popup/auto-ppt -> bg | 无 | 抢占成功 `{ ok, state }`；未开启/未完成/已生成/生成中/已失败/无截图各返回对应错误 |
| MARK_AUTO_PPT_GENERATED | popup/auto-ppt -> bg | `result:{fileName,imageCount,slideCount,mode}` | `{ ok, state }`；置位并清除 autoPptSession |
| MARK_AUTO_PPT_FAILED | popup/auto-ppt -> bg | `error` | `{ ok, state }` |
| DOWNLOAD_CORRECTED_WORKBOOK | popup -> bg | `rows, rowStyles, cellStyles, sourceFileName, exportMode("correction"/"fix"), headerRowIndex` | `{ ok }`；随后打开 download-workbook.html 走 Port 下载 |
| REFLO_RELEASE_INFO_BATCH | popup -> bg | `apiUrl, token, payload:{links:[{id,url}]}, timeoutMs` | 成功 `{ ok, data:{items:[...]} }`；失败 `{ ok:false, error, retryable, status? }` |

### 5.2 长连接 Port 协议

- Port `"workbook-download"`（download-workbook.js <-> background，导出带截图/纠错 Excel 与修复版 ZIP）：
  - 页面 -> 后台：`READY{id}`、`CHUNK_RECEIVED{id}`、`DOWNLOADED{id}`
  - 后台 -> 页面：`START{fileName,totalSize,mimeType,statusLabel}`、`CHUNK{id,offset,data(base64,512KB)}`、`DONE`、`ERROR{error}`
  - 数据源为 `pendingWorkbookExports`（内存 Map，`queueBinaryDownload` 写入，DOWNLOADED 后删除）。
- Port `"supplement-upload"`（popup -> background，上传精准补充原图；每条消息带 requestId，ack 原样带回）：
  - `START_UPLOAD{sourceName}` -> `UPLOAD_STARTED{id}`；`FILE_START{uploadId,name,sequenceKey}` -> `FILE_STARTED`；`CHUNK{uploadId,data}` -> `CHUNK_RECEIVED`；`FILE_DONE` -> `FILE_DONE`；`DONE` -> `UPLOAD_DONE{id}`；`CANCEL` -> `CANCELED`；异常 -> `ERROR{requestId,error}`
  - 未完成即断开时后台清理暂存（`cleanupUnfinishedSupplementUpload`）。

## 6. 存储结构

### 6.1 chrome.storage.local 键

| 键 | 写入方 | 内容 | 生命周期 |
| --- | --- | --- | --- |
| `autoPptSession` | background | `{runId, sourceName, sourceFileName, options(autoPpt 相关), screenshots(轻量记录), autoPptGenerated/InProgress/Failed/Error, createdAt}` | 3 天过期（AUTO_PPT_SESSION_MAX_AGE_MS）；生成成功或新一轮 START 时清除 |
| `douyinProxyRotationSettings` | popup | `{enabled, controllerUrl, groupName, secret, nodeNamesText, nodeNames, rotation}` | 持久 |
| `refloReleaseInfoSettings` | popup | `{enabled, apiUrl(固定默认值), token, includeCorrectionNote, excelDateIncludeTime, onlyMarkedRows, enrichFollower, playCountMin/Max, autoEnrich}` | 持久 |
| `refloReleaseInfoCorrectionMemory` | popup | 上次纠错/修正报告摘要（status/actionName/sourceFileName/completedAt/summary/previewItems） | 重新导入任务表时清除 |

### 6.2 IndexedDB 库表（均 version 1、keyPath "id"、3 天过期清理）

| 数据库 | 对象仓库 | 索引 | 记录结构 | 封装 |
| --- | --- | --- | --- | --- |
| shipinhao-screenshot-cache | screenshots | runId、createdAt | `{id:"runId:taskId", runId, taskId, fileName, task(元数据), blob, createdAt}` | ScreenshotCache（screenshot-cache.js 第一个 IIFE） |
| shipinhao-template-cache | templates | createdAt | `{id:"tpl-...", name, mode, bytes(Uint8Array), createdAt}` | TemplateCache（screenshot-cache.js 第二个 IIFE） |
| shipinhao-fan-source-cache | fanSources | createdAt | `{id:"fan-...", name, files:[{fileName, blob}], createdAt}` | FanSourceCache（fan-source-cache.js） |

## 7. 设计思路与关键约束

- captureVisibleTab 必须窗口可见且聚焦：MV3 无法真正后台截图，因此专门创建「专用截图窗口」，每次截图前 `focusCaptureWindow` 拉回前台并恢复最小化；启动前 popup 会 confirm 提示用户不要关闭该窗口。
- 全局截图串行 + 650ms 节流：`captureChain` 保证同一时刻只有一次「激活 tab -> 截图」流程（多 worker 共窗时防止 A 激活的 tab 被 B 截走，即错页保存）；`throttleCapture` 650ms 间隔规避 captureVisibleTab 频控与渲染未就绪。
- 抖音风控保守策略：单并发、前台真实加载、最长 60s 作品页验证、3s 任务冷却、每 20 条销毁重建窗口（清 cookie 之外的窗口级指纹/状态）、可选无痕窗口与 Clash IP 轮换；content.js 里额外对抖音 `body.zoom=0.75` 并做三轮弹窗清理（900ms/600ms 沉降间隔），风控文案（安全验证/操作频繁等）直接判失败而非硬截。
- 截图有效性防线：prepare 结果校验（平台 URL、风控文案、空内容）+ dataUrl 最小长度 5000 + 激活 tab 二次确认，三层拦截空白/错页截图。
- 重试语义：真实失败最多重试 1 次；「窗口重建殃及无辜 tab」的非抖音任务重新排队且不消耗重试次数（按错误消息 `No tab with id` 等识别）。
- 大数据传输：sendMessage 不适合大二进制，导出与上传均走 Port + 512KB base64 分块；Excel/PPT/ZIP 全部在内存手写 OOXML + STORE ZIP（无第三方库），受 ZIP32（4GB 条目/偏移）与各自产物上限约束。
- MV3 CORS：Reflo API 与 Clash 控制器、公网 IP 探测都由后台 fetch（host_permissions `<all_urls>`）；popup 直接 fetch 会因 CORS 白名单不含 chrome-extension:// 而失败。
- 幂等与断点：自动 PPT 用 CLAIM 单飞 + autoPptSession 落盘，容忍 popup 关闭、service worker 回收；截图/模板/粉丝图三个 IndexedDB 均 3 天自动清理。
- 无后端、无构建步骤：纯原生 JS，xlsx/pptx/zip 解析生成全部自实现；`normalizeOptions` 等对所有外部输入做钳制与兜底。
- 弹窗清理策略（douyin-popup 已知问题方向）：主修方向是抓拍前最终 DOM 复核（多轮 `stabilizeBlockingOverlays`）而非 OCR。

## 8. 交叉引用（功能 -> 文件:函数）

| 功能 | 位置 |
| --- | --- |
| 消息路由 | background.js:`handleMessage`（约 199 行） |
| 启动/暂停/恢复/停止 | background.js:`startRun`/`pauseRun`/`resumeRun`/`stopRun` |
| 任务调度与抖音单并发 | background.js:`workerLoop`、`nextTask` |
| 单任务处理管线 | background.js:`processTask` |
| 页面加载与平台跳转等待 | background.js:`loadTaskUrl`、`waitForTabComplete`、`waitForPlatformNavigation`、`waitForDouyinContentUrl` |
| 专用截图窗口生命周期 | background.js:`ensureCaptureWindow`、`createCaptureWindow`、`closeCaptureWindow`、`ensureWorkerTabForTask` |
| 抖音批次重建与 VPN 轮换 | background.js:`restartDouyinBatchWindowIfNeeded`、`rotateDouyinProxyIfEnabled`、`rotateClashProxy`、`fetchPublicIpInfo` |
| 截图串行/节流/视口校准 | background.js:`captureTabSerial`、`throttleCapture`、`activateTabForCapture`、`ensureViewportCalibrated`、`captureVisibleTab` |
| 截图下载与目录规则 | background.js:`downloadScreenshot`、`buildSessionDownloadDir` |
| 截图缓存写入 | background.js:`cacheTaskScreenshot`；screenshot-cache.js:`ScreenshotCache.putScreenshot` |
| 收尾与导出编排 | background.js:`finalizeRun`、`downloadFailureReport`、`downloadScreenshotWorkbook`、`downloadSupplementRepairZip` |
| xlsx 生成（XML + ZIP） | background.js:`buildScreenshotWorkbook`、`buildXlsxFiles`、`buildSheetXml`、`buildDrawingXml`、`createZip` |
| 纠错 Excel 导出 | background.js:`downloadCorrectedWorkbook`、`buildCorrectedWorkbook`、`buildCorrectionStyleMap`、`buildStylesXml` |
| Reflo 后台代理请求 | background.js:`fetchRefloReleaseInfoBatchInBackground` |
| 自动 PPT 会话与仲裁 | background.js:`saveAutoPptSessionFromState`、`getAutoPptSession`、`claimAutoPptGeneration`、`markAutoPptGenerated`、`markAutoPptFailed`、`openAutoPptGenerator` |
| 页面准备与弹窗清理 | content.js:`shipinhaoPrepareForScreenshot`、`stabilizeBlockingOverlays`、`shouldRemoveElement`、`validatePage` |
| 任务表导入/合并/解析 | popup.js:`handleTaskFiles`、`applyImportedTaskFiles`、`mergeParsedFiles`、`parseInputFile`、`parseXlsx`、`parseSheetRows` |
| 链接列识别与任务构建 | popup.js:`analyzeImportRows`、`scoreLinkColumn`、`buildTasks`、`extractVideoUrls`、`repairUrl` |
| 背景填充标记 | popup.js:`parseStyleFillMarks`、`buildMarkedStyleIndexSet` |
| Excel 内嵌粉丝量截图（WPS DISPIMG） | popup.js:`resolveCellImageRefs`、`loadCellImages`、`extractFanImagesFromCellImages` |
| Reflo 增强与重试 | popup.js:`enrichTasksWithReflo`、`fetchRefloReleaseInfoBatch`、`mergeRefloReleaseInfo`、`normalizeRefloReleaseInfo` |
| Excel 纠错/修正 | popup.js:`runExcelCorrectionWorkflow`、`buildExcelCorrectionReport`、`buildLocalCorrectionRows`、`applyRefloCorrection`、`detectDuplicateAccounts`、`applyExcelFixes`、`estimatePlayCountsForRange`、`normalizePublishTime` |
| 精准补充 | popup.js:`handleSupplementFiles`、`filterSupplementMissingTasks`、`uploadSupplementRepairSource`；background.js:`handleSupplementUploadPortMessage`、`buildSupplementRepairZip` |
| 启动参数收集 | popup.js:`startRun`、`getCaptureSizeOptions`、`getDouyinProxyRotationOptions` |
| 状态轮询与 UI 联动 | popup.js:`refreshState`、`applyState`、`renderProgress`、`renderLogs` |
| 手动 PPT 生成 | popup.js:`generatePpt`、`buildPptByMode`、`resolveFanImagesForPpt` |
| 自动 PPT（popup 路径） | popup.js:`autoGeneratePptFromCompletedRun`、`receiveAutoPptSuccessScreenshots`、`loadAutoPptTemplateBytesFromState` |
| 自动 PPT（独立页路径） | auto-ppt.js:`runAutoPptGeneration` |
| 自定义模板评估与缓存 | popup.js:`handlePptTemplateFile`、`persistCurrentPptTemplate`；pptx-builder.js:`analyzeTemplateFile`、`detectTemplateMode`；screenshot-cache.js:`TemplateCache` |
| 粉丝量截图来源缓存 | popup.js:`persistFanSourceForAutoPpt`；fan-source-cache.js:`FanSourceCache`；pptx-builder.js:`loadFanImagesFromCacheRecord`、`resolveFanImageForTask` |
| 剪报网格布局 | pptx-builder.js:`createPagePlan`、`chooseLayout`、`buildImagePositions` |
| 单图单页/发布信息/大湾区页生成 | pptx-builder.js:`buildLinkScreenshotSlideXml`、`buildReleaseInfoScreenshotSlideXml`、`buildReleaseInfoTemplateSlideXml`、`buildReleaseInfoRows` |
| PPTX 打包与下载 | pptx-builder.js:`createZip`、`downloadResult` |
| 分块下载页 | download-workbook.js:`downloadWorkbook`；background.js:`handleWorkbookDownloadPortMessage`、`queueBinaryDownload` |

## 9. 测试与辅助脚本

- `tests/window_concurrency_repro.mjs`：Node 环境加载真实 background.js，注入带时延的 chrome.* 桩，复现/回归「抖音批量截图窗口并发峰值与孤儿窗口」问题；运行 `node tests/window_concurrency_repro.mjs`。
- `tests/analyze_xlsx_links.mjs`：用真实 xlsx（依赖根目录样例表与 npm 包 xlsx）验证 popup 同款链接提取正则与清洗逻辑。
- `tools/`：本地 Python/JS 辅助脚本（xlsx 检查、剪报 pptx 生成与校验、自定义模板校验等），不参与扩展运行时。
- 依赖（package.json，仅测试脚本用）：xlsx ^0.18.5、dotenv ^17.4.2。扩展本体零依赖、零构建。

## 10. 变更记录

| 日期 | 修改内容 | 修改前 | 修改后 |
| --- | --- | --- | --- |
| 2026-07-05 | 抖音黑播放器截图与残留弹窗漏拍修复（rVFC 首帧硬闸门 + 快门前终检，方案详见根目录《抖音截图就绪判定最佳实践方案.md》） | content.js:`waitForVideoPlayback` 仅数据级软闸门（readyState/currentTime，超时返回 false 不报错），background.js `videoReady=false` 时多等 3 秒后兜底硬截；弹窗清理止于 prepare 三轮移除；重试立即重新导航 | content.js：三重判定（数据级 + `requestVideoFrameCallback` 合成级硬判据（含 seek 逼帧补救）+ xgplayer 状态类软判据（5 秒宽限防改版误杀）），`document.hidden` 暂停计时（上限 60 秒），视频页首帧未确认返回 `ok:false [FIRST_FRAME_TIMEOUT]` 走既有重试，风控文案速判前移 `[RISK_CONTROL]`，新增 `shipinhaoFinalSweep`（移除+双 rAF+复扫）与 MutationObserver 弹窗哨兵、`/note/` 页未加载图片计数；background.js：`captureTabSerial` 增 platform 参数并在快门前调终检（脏则抛 `[POPUP_PERSISTENT]`），删除 `DOUYIN_FALLBACK_RENDER_WAIT_MS` 兜底分支，抖音重试延后 45 秒（`retryNotBeforeTs`，`nextTask` 过滤未到期并返回 `__wait`），任务间隔随机抖动 0-2 秒，`startDouyinVisibilityKeeper` 可见性守护（`captureBusy` 避让快门），SW 端 64px 降采样纯色质检（只记日志 `[PURE_COLOR_SUSPECT]`）；新增回归测试 tests/douyin_first_frame_gate_repro.mjs、tests/douyin_capture_flow_repro.mjs |
| 2026-07-05 | 首帧闸门评审修复（多智能体评审确认 4 缺陷：1 critical、1 major、2 minor） | (1) 延后重试等待期 worker 纯 setTimeout 空转，MV3 SW 约 30 秒空闲被回收会杀死整批运行；(2) hidden 暂停按名义值 500ms/轮记账（hidden 页定时器被 1 秒对齐实耗翻倍），且 confirmFirstFrame 等待中被抢占的时段零记账，混跑下健康视频可被误判超时；(3) prepareTab/runFinalPopupSweep 在页面准备函数缺失（页面刚重载）时返回 ok:true/clean:true 静默放行，构成绕过全部闸门的黑图旁路；(4) 无 video 元素的 /video/ 页（作品失效提示/图集）被无差别判死，丧失留证截图能力 | (1) `workerLoop` __wait 分支每轮 `chrome.storage.session.get("__keepalive")` 心跳重置 SW 空闲计时；(2) `waitForVideoPlayback` 改用 visibilitychange 监听 + Date.now 实测累计 hidden 时长（含进行中分段，60 秒上限不变）；(3) 准备函数缺失返回 `prepareMissing`，抖音件判失败 `[PREPARE_NOT_READY]` 走重试，终检缺失抛 `[SWEEP_NOT_READY]`；(4) 首帧闸门增加"页面确有 video 元素"前置条件，无播放器页放行留证并记 `[NO_VIDEO_ELEMENT]` 日志；另将弹窗哨兵降为纯选择器匹配（避免高频 DOM 变更页逐节点强制布局）。回归测试新增 C5b/C10/S6 用例及 hidden 定时器 1 秒对齐模型，全部通过 |
