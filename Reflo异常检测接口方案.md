# Reflo 异常检测接口方案

## 背景

Chrome 扩展中已实现基于统计的标题主题异常检测功能，用于在 Excel 纠错时自动识别**与数据集主流主题不一致的标题**（如链接到了竞品、无关内容等）。

### 业务场景

一个 Excel 中通常包含多个方向的视频链接。同一方向的标题是**裂变标题**（不同文案但描述同一视频内容），异常标题在表述上会非常明显。

**典型示例：**
- ✅ 正常：「华为乾崑智驾技术加持，奕境X9大六座SUV实力出众」
- ✅ 正常：「探秘奕境X9技术内核，华为乾崑强强联合」
- ❌ 异常：「瑞虎8原厂状态从容跑完全程」 — 竞品
- ❌ 异常：「你还记得当年的李白吗」 — 完全无关

---

## 当前实现（扩展侧，计划废弃）

### 架构

```
扩展侧本地执行：
1. n-gram 提取全部标题的 2-6 字片段
2. 双重阈值筛选主流关键词（高频 ≥25% / 中频 ≥4次且≥8%）
3. 每条标题统计包含的主流关键词数
4. 匹配 < 3 个关键词 → 标记为可疑
```

### 现状问题

| 问题 | 说明 |
|------|------|
| **通用性不足** | 纯 n-gram 统计，对 hashtag 碎片（如「为乾」「境X」）过度依赖 |
| **无可解释性** | 只知道匹配了几个词，不知道为什么不匹配 |
| **边界误报** | 正常标题缺 hashtag 时可能被误判（实测误报率 ~1%） |
| **不可优化** | 无反馈闭环，无法基于历史数据提升 |

---

## 目标架构（Reflo 侧）

### 核心思路

将异常检测逻辑从 Chrome 扩展**迁移到 Reflo 服务端**，在现有的 `/api/v1/plugin/release-info/batch` 接口中新增 `anomaly` 字段。

### 优势

| 维度 | 扩展侧（现状） | Reflo 侧（目标） |
|------|:-----------:|:--------:|
| API Key 安全 | ❌ 需暴露给用户 | ✅ 服务端统一管理 |
| 准确率 | 单批次 n-gram | 可建立账号级主题模型 |
| 成本 | 每用户单独调用 LLM | 批处理 + 缓存复用 |
| 模型迭代 | 需发版扩展 | 服务端热更新 |
| 用户配置 | 需手动输入 API Key | 零配置，透明使用 |

---

## 📡 API 接口设计

### 接口路径

```
POST /api/v1/plugin/release-info/batch
```

### 请求（保持现有格式，无需修改）

```json
{
  "links": [
    { "id": "row-1", "url": "https://weixin.qq.com/sph/xxx" },
    { "id": "row-2", "url": "https://v.douyin.com/xxx" },
    { "id": "row-3", "url": "https://weixin.qq.com/sph/yyy" }
  ]
}
```

### 响应（新增 `anomaly` 字段）

```json
{
  "ok": true,
  "items": [
    {
      "id": "row-1",
      "url": "https://weixin.qq.com/sph/xxx",
      "data": {
        "title": "华为乾崑智驾技术加持，奕境X9大六座SUV实力出众",
        "account": "奕境汽车",
        "platform": "视频号",
        "publishTime": "2026-05-31",
        "playCount": 120000,
        "likes": 3500,
        "comments": 120,
        "shares": 45,
        "anomaly": {
          "detected": false,
          "confidence": 0.95,
          "reason": null
        }
      }
    },
    {
      "id": "row-3",
      "url": "https://weixin.qq.com/sph/yyy",
      "data": {
        "title": "碎石沙地连续考验，瑞虎8原厂状态从容跑完全程",
        "account": "奇瑞汽车",
        "platform": "视频号",
        "anomaly": {
          "detected": true,
          "confidence": 0.92,
          "reason": "竞品瑞虎8"
        }
      }
    }
  ]
}
```

### `anomaly` 字段定义

| 字段 | 类型 | 必填 | 说明 |
|------|------|:----:|------|
| `detected` | boolean | ✅ | 是否检测为异常标题 |
| `confidence` | float | ✅ | 置信度（0.0 ~ 1.0） |
| `reason` | string|null | ✅ | 异常原因。正常时为 null；异常时给简短说明（如「竞品瑞虎8」「完全无关」） |

---

## 🔧 服务端实现方案

### 推荐架构：两层检测管道

```
收到批次请求（含 N 个链接）
    ↓
┌─────────────────────────────────────────────┐
│ 第一层：统计规则（快速过滤，<10ms）           │
│                                              │
│ 1. n-gram 提取主流关键词（2-6字滑动窗口）     │
│ 2. 双重阈值：≥25% 或 (≥4次 且 ≥8%)           │
│ 3. 每条标题统计匹配数                         │
│ 4. 匹配 ≥5 → 明确正常（~90%）                │
│    匹配 0  → 明确异常（~2%）                  │
│    匹配 1-4 → 边界可疑（~8%）                │
└─────────────────────────────────────────────┘
    ↓
┌─────────────────────────────────────────────┐
│ 第二层：LLM 精细判断（仅处理边界样本）        │
│                                              │
│ 1. 动态提取 Top 10 主流标题作为上下文         │
│ 2. 通用 Prompt（LLM 自动推断主题）            │
│ 3. 批处理 20 条/请求（平衡成本与延迟）         │
│ 4. 输出：是否异常 + 原因 + 置信度             │
└─────────────────────────────────────────────┘
    ↓
返回完整响应（含 anomaly 字段）
```

### 统计规则算法（可直接参考扩展侧代码）

```javascript
// 关键词提取参数
const minKeywordLength = 2;     // 最小关键词长度
const maxKeywordLength = 6;     // 最大关键词长度
const minMatchCount = 3;        // 最少匹配数（判定阈值）
const highFreqThreshold = 0.25; // 高频词阈值（25%）
const midFreqThreshold = 0.08;  // 中频词阈值（8%）
const midFreqMinCount = 4;      // 中频词最小出现次数

// 停用词过滤
const stopWords = ['的', '是', '在', '了', '和', '有', '这', '个', '为', '与', '等', '中', '到', '从', '把'];

// 双重阈值筛选
keywordCounts.forEach((count, keyword) => {
  const frequency = count / totalTitles;
  if (frequency >= 0.25 || (count >= 4 && frequency >= 0.08)) {
    mainKeywords.push(keyword);
  }
});
```

### LLM Prompt 设计（通用，零行业知识依赖）

```javascript
const systemPrompt = `你是一个内容一致性分析专家。

**数据集主流标题样本：**
${topTitles.join('\n')}

**任务：** 观察主流标题，自动推断主题（推广什么产品/品牌/内容）。
判断待测标题是否与主流主题一致。

**判断标准：**
✅ 正常：同一产品/品牌，换个角度表述
❌ 异常：不同品牌/产品/竞品、完全无关话题

**保守策略（零误报优先）：** 不确定时判为正常。

输出 JSON 数组：[{"isAnomalous": true/false, "reason": "原因", "confidence": 0.0-1.0}, ...]`;
```

### LLM 调用建议

| 推荐模型 | 价格 | 说明 |
|----------|------|------|
| **首选：小米 MiMo-V2-Flash** | 免费 | API: `https://api.xiaomimimo.com/v1/chat/completions` |
| 备选：智谱 GLM-4-Flash | 免费 | API: `https://open.bigmodel.cn/api/paas/v4/chat/completions` |
| 备选：DeepSeek-V3 | ¥1/M tokens | API: `https://api.deepseek.com/v1/chat/completions` |

> 以上模型均兼容 OpenAI API 格式，切换成本低。

---

## 📊 性能与成本估算

### 性能

| 阶段 | 耗时 | 说明 |
|------|------|------|
| 统计规则 | <10ms | n-gram 内存计算，与标题数成正比 |
| LLM 调用 | ~1s/批 | 仅处理 5-10% 边界样本，批处理 20 条/请求 |
| **总计** | **<1.5s** | 对用户几乎无感知 |

### 成本（月度估算，100 批次，每批 500 条）

| 模型 | API 调用次数 | 月成本 |
|------|------------|--------|
| MiMo-V2-Flash | ~300 次 | **¥0** |
| 智谱 GLM-4-Flash | ~300 次 | **¥0** |
| DeepSeek-V3 | ~300 次 | ~¥0.24 |

### 实际数据验证

已用两个真实数据集在扩展侧完成原型验证：

| 数据集 | 标题数 | 统计规则标记 | 真异常 | 误报 | 误报率 |
|--------|--------|:----------:|:------:|:----:|:------:|
| 5.31视频号 | 567 | 4 | 4 | 0 | **0%** |
| PPT发布信息 | 65 | 1 | 1 | 0 | **0%** |

---

## 🚀 增强方向（可后续迭代）

### Phase 2: 账号级主题模型

```
基于账号的历史发布记录建立主题分布：
  - 账号 A 90% 内容为「奕境X9」→ 出现「问界M9」马上识别
  - 账号 B 综合汽车号 → 不同品牌不判定为异常
  → 准确率远超单一批次的 n-gram
```

### Phase 3: 用户反馈闭环

```
扩展侧接收用户对异常标记的反馈（正确/误判）
  → 回传 Reflo 累积标注数据
  → 微调小模型或优化 Prompt
  → 逐步减少 LLM 调用，成本趋向零
```

### Phase 4: 多语言/多平台扩展

```
当前仅处理中文标题
  → 加入英文、日文等停用词
  → 适配不同平台的内容特征
```

---

## 📝 扩展侧改动（Reflo 侧接口就绪后）

扩展侧改动极小，只需读取 `anomaly` 字段：

```javascript
// 现有代码（popup.js）
rowReports.forEach((rowReport) => applyRefloCorrection(rowReport, refloMap, rows, analysis));

// 新增：读取 Reflo 返回的 anomaly 字段
if (rowReport.refloData && rowReport.refloData.anomaly) {
  const anomaly = rowReport.refloData.anomaly;
  if (anomaly.detected) {
    rowReport.issues.push({
      type: 'title-anomaly',
      style: 'orange',
      columnIndex: analysis.publishTitleIndex,
      message: `标题主题异常：「${rowReport.refloData.title}」- ${anomaly.reason}（AI 判断，置信度 ${Math.round(anomaly.confidence * 100)}%）`
    });
  }
}

// 可删除的代码（约 160 行）：
//   extractMainKeywords()、detectAnomalousTitle()
//   api-config.js、llm-detector.js、
//   LLM UI 配置面板
```

---

## 📞 联系与协作

- **扩展侧异常检测文档**：`ANOMALY_DETECTION.md`、`IMPLEMENTATION_SUMMARY.md`
- **测试数据与脚本**：`tools/llm_prompt_test/`
- **现有统计规则代码参考**：`popup.js:1477-1557`

---

**文档版本**：v1.0  
**日期**：2026-06-05  
**写给**：Reflo AI 同事
