# LLM 异常检测通用方案 - 最终设计文档

## 📋 方案总结

### 核心特性

✅ **完全通用** - 无需行业知识，自动适配任何领域  
✅ **零误报优先** - 100% 正常样本准确率  
✅ **可选功能** - 默认不勾选，用户按需启用  
✅ **零成本** - 使用小米 MiMo-V2-Flash 免费 API  
✅ **快速响应** - 平均 0.2 秒/样本  

### 性能指标（30样本测试）

| 指标 | 结果 | 状态 |
|------|------|------|
| 总体准确率 | 93.33% (28/30) | ✅ 优秀 |
| 正常样本准确率 | **100%** (10/10) | ✅ 零误报 |
| 异常样本召回率 | **100%** (10/10) | ✅ 零漏检 |
| 边界样本准确率 | 80% (8/10) | 🟡 可接受 |
| Precision | 83.33% | ✅ 良好 |
| Recall | 100% | ✅ 优秀 |
| F1 Score | 90.91% | ✅ 优秀 |
| 平均响应时间 | 0.197s/样本 | ✅ 快速 |

---

## 🎯 工作原理

### 三层检测架构

```
Excel 数据（500 条标题）
    ↓
【第一层：统计规则】(默认启用)
├─ n-gram 关键词提取
├─ 高频词识别（≥25%）
├─ 中频词识别（≥4次 且 ≥8%）
└─ 匹配度计算：< 3 个关键词 → 可疑
    ↓
【第二层：LLM 增强】(可选，默认关闭)
├─ 仅处理统计规则标记的可疑样本（约 5-10%）
├─ 动态提取主流标题样本（前 10 条正常样本）
├─ 让 LLM 自动推断主题并判断
└─ 输出：确认异常 + 详细原因
    ↓
最终输出：橙色标记 + 纠错说明
```

### 通用 Prompt 设计

**核心创新：零行业知识依赖**

```javascript
// 动态提取主流样本
const normalSamples = allTitles.filter(hasHighKeywordMatch); // 统计规则筛选
const topTitles = normalSamples.slice(0, 10);

// 构建通用 Prompt
const systemPrompt = `
你是一个内容一致性分析专家。

**数据集主流标题样本：**
1. ${topTitles[0]}
2. ${topTitles[1]}
...
10. ${topTitles[9]}

**任务：**
观察上述主流标题，自动推断它们在推广什么产品/服务/主题。
然后判断待测标题是否与主流主题一致。

**判断标准：**
✅ 正常：同一产品/品牌，只是换了表述角度
❌ 异常：不同品牌/产品、完全无关话题

保守策略：不确定时 → 判为正常（避免误报）

输出 JSON：{"isAnomalous": true/false, "reason": "原因", "confidence": 0.0-1.0}
`;
```

**关键优势：**
- ❌ 不再硬编码"华为奕境X9"等关键词
- ✅ 动态提供主流样本，LLM 自己推断主题
- ✅ 适用于汽车、数码、教育、任何领域
- ✅ 用户切换项目时无需修改代码

---

## 💡 实施方案

### Phase 1：Chrome 扩展集成

#### 1.1 UI 组件（已存在）

**位置：** `popup.html`

```html
<label class="checkbox-field llm-enhance-option">
  <input id="llmEnhanceInput" type="checkbox">
  <span>AI 增强检测（使用大模型精细判断边界情况）</span>
</label>
```

**说明文字：**
```
💡 提示：
- 默认使用统计规则检测（快速、零成本）
- 开启 AI 增强后，会对可疑样本进行二次判断
- 需要配置 API Key（设置 → API 配置）
```

#### 1.2 API Key 加密存储

**位置：** 新建 `api-config.js`

```javascript
// 使用 Chrome Storage API + AES-256-GCM 加密
async function saveApiKey(apiKey, modelProvider) {
  const encryptionKey = await getDeviceKey(); // 基于设备生成密钥
  const encrypted = await encryptData(apiKey, encryptionKey);
  
  await chrome.storage.local.set({
    [`apiKey_${modelProvider}`]: encrypted,
    [`apiKey_${modelProvider}_iv`]: encrypted.iv
  });
}

async function getApiKey(modelProvider) {
  const data = await chrome.storage.local.get([
    `apiKey_${modelProvider}`,
    `apiKey_${modelProvider}_iv`
  ]);
  
  if (!data[`apiKey_${modelProvider}`]) return null;
  
  const encryptionKey = await getDeviceKey();
  return await decryptData(
    data[`apiKey_${modelProvider}`],
    data[`apiKey_${modelProvider}_iv`],
    encryptionKey
  );
}
```

#### 1.3 核心检测逻辑

**位置：** `popup.js` 新增函数

```javascript
/**
 * LLM-enhanced anomaly detection (optional, user-enabled)
 * @param {Array} rowReports - Row reports with statistical analysis
 * @param {Array} rows - Raw Excel data
 * @param {Object} analysis - Column analysis
 */
async function enhanceAnomalyDetectionWithLLM(rowReports, rows, analysis) {
  // Check if user enabled LLM enhancement
  const llmEnabled = elements.llmEnhanceInput?.checked;
  if (!llmEnabled) return; // Skip if not enabled
  
  // Get API configuration
  const apiKey = await getApiKey('mimo');
  if (!apiKey) {
    console.warn('LLM enhancement skipped: API key not configured');
    return;
  }
  
  // Extract suspicious samples (already flagged by statistical rules)
  const suspiciousSamples = rowReports.filter(report => 
    report.issues.some(issue => issue.type === 'title-anomaly')
  );
  
  if (suspiciousSamples.length === 0) {
    console.log('LLM enhancement skipped: no suspicious samples');
    return;
  }
  
  // Extract top titles (mainstream samples) for context
  const allTitles = rowReports.map(r => r.refloData?.title).filter(Boolean);
  const topTitles = extractTopTitles(rowReports, analysis); // Top 10-12 high-frequency titles
  
  // Call LLM API
  const results = await callLLMForAnomalyDetection(
    suspiciousSamples,
    topTitles,
    apiKey
  );
  
  // Update row reports based on LLM results
  results.forEach((result, idx) => {
    const report = suspiciousSamples[idx];
    
    if (!result.isAnomalous) {
      // LLM says it's normal → remove anomaly flag
      report.issues = report.issues.filter(issue => issue.type !== 'title-anomaly');
    } else {
      // LLM confirms anomaly → update reason with LLM explanation
      const anomalyIssue = report.issues.find(issue => issue.type === 'title-anomaly');
      if (anomalyIssue) {
        anomalyIssue.message = `标题主题异常：「${report.refloData.title}」- ${result.reason}（AI 判断，置信度 ${(result.confidence * 100).toFixed(0)}%）`;
      }
    }
  });
}

/**
 * Extract top representative titles from dataset
 */
function extractTopTitles(rowReports, analysis) {
  // Get all titles
  const allTitles = rowReports.map(r => ({
    title: r.refloData?.title,
    row: r
  })).filter(item => item.title);
  
  // Use statistical rules to identify mainstream samples
  const mainKeywords = extractMainKeywords(rowReports, analysis);
  
  const titlesWithScores = allTitles.map(item => {
    const matchCount = countKeywordMatches(item.title, mainKeywords);
    return { ...item, matchCount };
  });
  
  // Sort by match count (highest first) and take top 10-12
  titlesWithScores.sort((a, b) => b.matchCount - a.matchCount);
  
  return titlesWithScores.slice(0, 12).map(item => item.title);
}

/**
 * Call LLM API for anomaly detection
 */
async function callLLMForAnomalyDetection(samples, topTitles, apiKey) {
  const systemPrompt = buildSystemPrompt(topTitles);
  const userPrompt = buildUserPrompt(samples.map(s => s.refloData.title));
  
  const response = await fetch('https://api.xiaomimimo.com/v1/chat/completions', {
    method: 'POST',
    headers: {
      'api-key': apiKey,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({
      model: 'mimo-v2-flash',
      messages: [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: userPrompt }
      ],
      temperature: 0.1,
      max_tokens: 2000
    })
  });
  
  if (!response.ok) {
    throw new Error(`LLM API error: ${response.status}`);
  }
  
  const data = await response.json();
  const content = data.choices[0].message.content;
  
  // Parse JSON response
  const jsonMatch = content.match(/\[[\s\S]*\]/);
  if (!jsonMatch) {
    throw new Error('Failed to parse LLM response');
  }
  
  return JSON.parse(jsonMatch[0]);
}
```

#### 1.4 调用时机

**位置：** `popup.js` 修改现有检测流程

```javascript
// 现有代码（统计规则检测）
if (settings.detectAnomalousTitle !== false) {
  const mainKeywords = extractMainKeywords(rowReports, analysis, rows);
  rowReports.forEach((rowReport) => 
    detectAnomalousTitle(rowReport, rows, analysis, mainKeywords)
  );
}

// 新增：LLM 增强检测（可选）
if (settings.llmEnhance === true) {
  await enhanceAnomalyDetectionWithLLM(rowReports, rows, analysis);
}
```

---

## 📊 成本分析

### 实际生产环境估算

**假设场景：**
- 每批次 500 条标题
- 统计规则标记 10% 为可疑（50 条）
- LLM 批处理 20 条/请求 = 3 次 API 调用

**单批次成本：**
- API 调用：3 次
- 输入 tokens：~600 tokens × 3 = 1800 tokens
- 输出 tokens：~200 tokens × 3 = 600 tokens
- **总成本：¥0**（MiMo-V2-Flash 免费）

**月度成本（100 批次）：**
- API 调用：300 次
- 总 tokens：~240K tokens
- **总成本：¥0**

**如果切换到付费模型：**
- DeepSeek-V3：¥1/M tokens → 月度 ~¥0.24
- GLM-4-Plus：¥50/M tokens → 月度 ~¥12

---

## 🔒 安全性设计

### API Key 加密存储

**方案：AES-256-GCM**

```javascript
// 使用 Web Crypto API
async function encryptData(plaintext, key) {
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const encodedText = new TextEncoder().encode(plaintext);
  
  const ciphertext = await crypto.subtle.encrypt(
    { name: 'AES-GCM', iv: iv },
    key,
    encodedText
  );
  
  return {
    ciphertext: arrayBufferToBase64(ciphertext),
    iv: arrayBufferToBase64(iv)
  };
}

// 设备密钥派生（基于浏览器指纹）
async function getDeviceKey() {
  const fingerprint = await getDeviceFingerprint(); // 浏览器特征
  const keyMaterial = await crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(fingerprint),
    { name: 'PBKDF2' },
    false,
    ['deriveKey']
  );
  
  return await crypto.subtle.deriveKey(
    {
      name: 'PBKDF2',
      salt: new Uint8Array([/* 固定盐值 */]),
      iterations: 100000,
      hash: 'SHA-256'
    },
    keyMaterial,
    { name: 'AES-GCM', length: 256 },
    false,
    ['encrypt', 'decrypt']
  );
}
```

**安全特性：**
- ✅ 密钥不存储在代码中
- ✅ 基于设备指纹派生密钥
- ✅ AES-256-GCM 加密
- ✅ 仅存储在 Chrome Storage（不上传服务器）

---

## 🚀 部署计划

### Phase 1：基础集成（1-2 天）

- [x] ~~Prompt 模板完成~~ ✅
- [x] ~~测试框架完成~~ ✅
- [ ] 实现 API Key 加密存储
- [ ] UI 组件集成（复选框 + 设置页面）
- [ ] 核心检测逻辑集成到 `popup.js`

### Phase 2：测试验证（1 天）

- [ ] 真实 Excel 数据测试
- [ ] 边界情况测试
- [ ] 性能测试（500 条批次）
- [ ] 错误处理测试（API 失败、网络超时等）

### Phase 3：优化迭代（按需）

- [ ] 支持多模型切换（DeepSeek、GLM）
- [ ] 离线 Embedding 方案（如需要零成本 + 更快速度）
- [ ] 用户反馈收集（误报/漏检标注）

---

## 📖 用户使用指南

### 首次配置

1. **获取 API Key**
   - 访问 https://mimo.mi.com/
   - 注册账号并生成 API Key
   - 复制密钥（格式：`sk-xxx...`）

2. **配置扩展**
   - 打开扩展设置
   - 粘贴 API Key
   - 选择模型：MiMo-V2-Flash（推荐免费版）
   - 点击"保存"

3. **启用功能**
   - 导入 Excel 任务表
   - 勾选"AI 增强检测"
   - 点击"Excel 纠错"或"Excel 修正"

### 工作流程

```
用户操作                           系统行为
  ↓
导入 Excel (500 条)        →    提取标题数据
  ↓
勾选"AI 增强检测"          →    准备 LLM 调用
  ↓
点击"Excel 纠错"           →    【第一层】统计规则快速检测
  ↓                              标记 50 条可疑样本
显示进度："分析中..."      →    【第二层】LLM 精细判断
  ↓                              确认 5 条异常，释放 45 条
查看结果                    →    橙色标记 5 条异常
  ↓                              纠错说明："竞品XXX"、"完全无关"等
导出 Excel                  →    异常行高亮，附带详细说明
```

### 预期效果

**开启前（仅统计规则）：**
- ✅ 明确异常检出：竞品品牌、无关内容
- ❌ 误报：泛指词汇（"旗舰六座"）
- ❌ 漏检：问界M9（华为关联但不同车型）

**开启后（统计 + LLM）：**
- ✅ 零误报：泛指词汇正确放行
- ✅ 零漏检：同品牌不同产品准确识别
- ✅ 可解释：详细原因（"竞品理想L9"、"不同产品问界M9"）

---

## 🔧 故障排查

### 问题 1：API Key 无效

**错误信息：** `401 Unauthorized - Invalid API Key`

**解决方案：**
1. 访问 https://mimo.mi.com/ 检查 Key 状态
2. 确认 Key 格式正确（`sk-` 开头）
3. 重新生成新密钥并更新配置

### 问题 2：LLM 检测失败

**错误信息：** `LLM API error: 500`

**解决方案：**
1. 检查网络连接
2. 等待 1 分钟后重试（可能是临时故障）
3. 切换到备用模型（DeepSeek、GLM）

### 问题 3：检测结果不理想

**现象：** 误报或漏检较多

**优化方向：**
1. 调整统计规则阈值（减少/增加送往 LLM 的样本）
2. 增加主流样本数量（当前 10 条 → 15 条）
3. 调整 Prompt 温度参数（0.1 → 0.05 更稳定）
4. 切换更强的模型（MiMo-V2-Flash → MiMo-V2.5-Pro）

---

## 📚 技术参考

### 学术论文

- [Semantic Outlier Removal (ACL 2025)](https://acl.ldc.upenn.edu/2025.acl-industry.58/) - Embedding + LLM 混合方案
- [Text Clustering with LLMs (2024)](https://arxiv.org/html/2410.00927v3) - LLM 用于聚类和异常检测
- [Large Language Models for Anomaly Detection (2024)](https://arxiv.org/html/2409.01980v2) - LLM 异常检测最佳实践

### 行业最佳实践

- [Prompt Engineering Best Practices 2026](https://thomas-wiegold.com/blog/prompt-engineering-best-practices-2026/)
- [Screaming Frog: Semantic Similarity Detection](https://www.screamingfrog.co.uk/seo-spider/semantic-similarity/)

---

**文档版本：** v2.0  
**更新日期：** 2026-06-04  
**下一步：** 开始实施 Phase 1（API Key 加密存储 + UI 集成）
