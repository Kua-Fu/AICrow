const FALLBACK_PROMPT = `你是一个专业字幕翻译助手，负责将英文字幕翻译成自然中文。
要求：
1. 保留时间轴格式（如 00:00:12,000 --> 00:00:15,000）。
2. 保留 Godot 的类名、函数名等英文术语，不要翻译。
3. 每条字幕只翻译文本内容，时间轴保持不变。
4. 输出格式严格为 .srt。
5. 翻译风格自然口语化，适合视频观众阅读。`;

const DEFAULT_OPENAI_BASE_URL = "http://one-api.dataflux.cn/v1";
const DEFAULT_OPENAI_MODEL = "glm-5";

const state = {
  fileName: "",
  sourceSrt: "",
  translatedSrt: "",
};

const fileInput = document.getElementById("fileInput");
const fileMeta = document.getElementById("fileMeta");
const openaiBaseInput = document.getElementById("openaiBaseInput");
const openaiModelInput = document.getElementById("openaiModelInput");
const batchSizeInput = document.getElementById("batchSizeInput");
const concurrencyInput = document.getElementById("concurrencyInput");
const retryInput = document.getElementById("retryInput");
const delayInput = document.getElementById("delayInput");
const promptInput = document.getElementById("promptInput");
const translateBtn = document.getElementById("translateBtn");
const downloadBtn = document.getElementById("downloadBtn");
const progressBar = document.getElementById("progressBar");
const progressText = document.getElementById("progressText");
const logBox = document.getElementById("logBox");
const outputPathText = document.getElementById("outputPathText");
const timingText = document.getElementById("timingText");

fileInput.addEventListener("change", onFileChange);
translateBtn.addEventListener("click", onTranslateClick);
downloadBtn.addEventListener("click", onDownloadClick);

initialize();

function initialize() {
  openaiBaseInput.value = DEFAULT_OPENAI_BASE_URL;
  openaiModelInput.value = DEFAULT_OPENAI_MODEL;
  promptInput.value = FALLBACK_PROMPT;
  resetRuntimeMeta();
}

function resetRuntimeMeta() {
  outputPathText.textContent = "输出：翻译完成后自动下载";
  timingText.textContent = "耗时：尚未开始";
  state.translatedSrt = "";
}

function setTiming(totalMs, batchMs = null, finished = false) {
  if (totalMs == null) {
    timingText.textContent = "耗时：尚未开始";
    return;
  }
  if (finished) {
    timingText.textContent = `总耗时：${formatDuration(totalMs)}`;
    return;
  }
  if (batchMs == null) {
    timingText.textContent = `累计耗时：${formatDuration(totalMs)}`;
    return;
  }
  timingText.textContent = `本批耗时：${formatDuration(batchMs)}，累计：${formatDuration(totalMs)}`;
}

function formatDuration(ms) {
  if (!Number.isFinite(ms) || ms < 0) return "0 ms";
  if (ms < 1000) return `${Math.round(ms)} ms`;
  const totalSeconds = ms / 1000;
  if (totalSeconds < 60) return `${totalSeconds.toFixed(2)} 秒`;
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = (totalSeconds - minutes * 60).toFixed(2);
  return `${minutes} 分 ${seconds} 秒`;
}

async function onFileChange(event) {
  const file = event.target.files?.[0];
  if (!file) {
    state.fileName = "";
    state.sourceSrt = "";
    fileMeta.textContent = "未选择文件";
    resetRuntimeMeta();
    return;
  }
  state.fileName = file.name;
  state.sourceSrt = await file.text();
  state.translatedSrt = "";
  downloadBtn.disabled = true;
  fileMeta.textContent = `${file.name} (${Math.round(file.size / 1024)} KB)`;
  logBox.textContent = "";
  setProgress(0);
  resetRuntimeMeta();
}

async function onTranslateClick() {
  const batchSize = Number(batchSizeInput.value);
  const concurrency = Number(concurrencyInput.value);
  const retryCount = Number(retryInput.value);
  const delayMs = Number(delayInput.value);
  const userPrompt = promptInput.value.trim();
  const baseUrl = openaiBaseInput.value.trim();
  const model = openaiModelInput.value.trim();

  if (!state.sourceSrt) return alert("请先上传 .srt 文件。");
  if (!baseUrl) return alert("Base URL 不能为空。");
  if (!model) return alert("模型名称不能为空。");
  if (!userPrompt) return alert("提示词不能为空。");
  if (!Number.isInteger(batchSize) || batchSize < 1) return alert("每批翻译条数必须是 >= 1 的整数。");
  if (!Number.isInteger(concurrency) || concurrency < 1) return alert("并发请求数必须是 >= 1 的整数。");
  if (!Number.isInteger(retryCount) || retryCount < 0) return alert("失败重试次数必须是 >= 0 的整数。");
  if (!Number.isFinite(delayMs) || delayMs < 0) return alert("批次间隔必须是 >= 0 的整数。");

  const entries = parseSrt(state.sourceSrt);
  if (!entries.length) return alert("未解析到有效字幕，请确认文件是标准 .srt 格式。");
  const nonEmptyEntries = entries.filter((entry) => entry.text.trim().length > 0);
  const removedEmptyCount = entries.length - nonEmptyEntries.length;
  if (!nonEmptyEntries.length) return alert("字幕内容均为空，无法翻译。");

  translateBtn.disabled = true;
  downloadBtn.disabled = true;
  logBox.textContent = "";
  setProgress(0);
  resetRuntimeMeta();
  log(`解析完成，共 ${entries.length} 条字幕。`);
  if (removedEmptyCount > 0) log(`已删除空字幕条 ${removedEmptyCount} 条（保留原始序号，不重排）。`);

  const totalStartAt = performance.now();

  try {
    const chunks = chunkArray(nonEmptyEntries, batchSize);
    log(`已切分为 ${chunks.length} 批，并发数：${concurrency}。`);

    const translated = await processChunksWithConcurrency({
      chunks,
      concurrency,
      delayMs,
      retryCount,
      baseUrl,
      model,
      systemPrompt: userPrompt,
      totalStartAt,
    });

    state.translatedSrt = composeSrt(translated);
    const totalElapsed = performance.now() - totalStartAt;
    setTiming(totalElapsed, null, true);
    log(`全部翻译完成，总耗时 ${formatDuration(totalElapsed)}。`);
    downloadBtn.disabled = false;
    autoDownload();
  } catch (error) {
    console.error(error);
    log(`翻译失败: ${error.message}`);
    alert(`翻译失败: ${error.message}`);
  } finally {
    translateBtn.disabled = false;
  }
}

function autoDownload() {
  if (!state.translatedSrt) return;
  const outputName = buildOutputName(state.fileName || "subtitle.srt");
  const blob = new Blob([state.translatedSrt], { type: "application/x-subrip;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = outputName;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
  log(`已触发下载：${outputName}`);
}

function onDownloadClick() {
  autoDownload();
}

function parseSrt(content) {
  const normalized = content.replace(/^\uFEFF/, "").replace(/\r/g, "");
  const lines = normalized.split("\n");
  const entries = [];
  let i = 0;

  while (i < lines.length) {
    while (i < lines.length && lines[i].trim() === "") i += 1;
    if (i >= lines.length) break;

    let cueIndex = entries.length + 1;
    if (/^\d+$/.test(lines[i].trim()) && i + 1 < lines.length) {
      cueIndex = Number(lines[i].trim());
      i += 1;
    }

    const timestamp = lines[i]?.trim();
    if (!timestamp || !timestamp.includes("-->")) {
      i += 1;
      continue;
    }
    i += 1;
    if (i < lines.length && lines[i].trim() === "") i += 1;

    const textLines = [];
    while (i < lines.length) {
      if (isLikelyCueBoundary(lines, i)) break;
      textLines.push(lines[i]);
      i += 1;
    }

    entries.push({
      index: Number.isInteger(cueIndex) && cueIndex > 0 ? cueIndex : entries.length + 1,
      timestamp,
      text: textLines.join("\n").trim(),
    });
  }

  return entries;
}

function isLikelyCueBoundary(lines, startIndex) {
  let j = startIndex;
  while (j < lines.length && lines[j].trim() === "") j += 1;
  if (j >= lines.length) return true;
  if (!/^\d+$/.test(lines[j].trim())) return false;
  let k = j + 1;
  while (k < lines.length && lines[k].trim() === "") k += 1;
  return k < lines.length && lines[k].includes("-->");
}

function composeSrt(entries) {
  return entries
    .map((entry, i) => {
      const outIndex = Number.isInteger(entry?.index) && entry.index > 0 ? entry.index : i + 1;
      return `${outIndex}\n${entry.timestamp}\n${entry.text}\n`;
    })
    .join("\n");
}

function chunkArray(arr, size) {
  const chunks = [];
  for (let i = 0; i < arr.length; i += size) {
    chunks.push(arr.slice(i, i + size));
  }
  return chunks;
}

async function processChunksWithConcurrency({
  chunks,
  concurrency,
  delayMs,
  retryCount,
  baseUrl,
  model,
  systemPrompt,
  totalStartAt,
}) {
  if (!Array.isArray(chunks) || chunks.length === 0) return [];

  const totalChunks = chunks.length;
  const workerCount = Math.max(1, Math.min(concurrency, totalChunks));
  const translatedChunks = new Array(totalChunks);
  const pendingByIndex = new Map();

  let nextStartIndex = 0;
  let nextWriteIndex = 0;
  let activeWorkers = 0;
  let stopped = false;
  let firstError = null;

  const donePromise = new Promise((resolve, reject) => {
    let resolved = false;
    const resolveOnce = (value) => {
      if (!resolved) {
        resolved = true;
        resolve(value);
      }
    };
    const rejectOnce = (error) => {
      if (!resolved) {
        resolved = true;
        reject(error);
      }
    };
    donePromise.resolveOnce = resolveOnce;
    donePromise.rejectOnce = rejectOnce;
  });

  const fail = (error) => {
    if (stopped) return;
    stopped = true;
    firstError = error;
    donePromise.rejectOnce(error);
  };

  const flushPending = async () => {
    while (!stopped && pendingByIndex.has(nextWriteIndex)) {
      const ready = pendingByIndex.get(nextWriteIndex);
      pendingByIndex.delete(nextWriteIndex);

      translatedChunks[ready.batchIndex] = ready.batchTranslations;
      nextWriteIndex += 1;

      const totalElapsed = performance.now() - totalStartAt;
      setProgress(Math.round((nextWriteIndex / totalChunks) * 100));
      setTiming(totalElapsed, ready.batchElapsed);

      log(
        `第 ${ready.batchIndex + 1}/${totalChunks} 批完成，批次耗时 ${formatDuration(
          ready.batchElapsed
        )}，累计耗时 ${formatDuration(totalElapsed)}。`
      );
    }

    if (!stopped && nextWriteIndex >= totalChunks && activeWorkers === 0) {
      donePromise.resolveOnce();
    }
  };

  const scheduleFlush = () => {
    Promise.resolve().then(flushPending).catch(fail);
  };

  const scheduleNext = () => {
    while (!stopped && activeWorkers < workerCount && nextStartIndex < totalChunks) {
      const batchIndex = nextStartIndex;
      nextStartIndex += 1;
      const chunk = chunks[batchIndex];
      activeWorkers += 1;

      const task = async () => {
        const batchStartAt = performance.now();
        log(`开始第 ${batchIndex + 1}/${totalChunks} 批，${chunk.length} 条（并发 ${activeWorkers}/${workerCount}）。`);

        const batchTranslations = await translateBatchWithRetry({
          baseUrl,
          model,
          systemPrompt,
          chunk,
          retryCount,
        });

        if (stopped) return;

        const batchElapsed = performance.now() - batchStartAt;
        pendingByIndex.set(batchIndex, { batchIndex, batchTranslations, batchElapsed });
        scheduleFlush();
      };

      task()
        .catch((error) => fail(error))
        .finally(() => {
          activeWorkers -= 1;
          if (stopped) return;
          if (delayMs > 0) {
            setTimeout(() => {
              if (!stopped) {
                scheduleNext();
                flushPending();
              }
            }, delayMs);
          } else {
            scheduleNext();
            flushPending();
          }
        });
    }
  };

  scheduleNext();
  await donePromise;
  if (firstError) throw firstError;
  return translatedChunks.flat();
}

async function translateBatchWithRetry({ baseUrl, model, systemPrompt, chunk, retryCount }) {
  let lastError = null;
  for (let attempt = 0; attempt <= retryCount; attempt += 1) {
    try {
      const translatedTexts = await translateBatch({ baseUrl, model, systemPrompt, chunk });
      return chunk.map((entry, i) => ({ index: entry.index, timestamp: entry.timestamp, text: translatedTexts[i] }));
    } catch (error) {
      lastError = error;
      log(`第 ${attempt + 1} 次尝试失败: ${error.message}`);
      if (attempt < retryCount) await sleep(500 * (attempt + 1));
    }
  }
  throw lastError || new Error("批量翻译失败");
}

async function translateBatch({ baseUrl, model, systemPrompt, chunk }) {
  const payloadItems = chunk.map((entry, i) => ({ id: i + 1, text: entry.text }));
  const itemsToTranslate = payloadItems.filter((item) => item.text.trim().length > 0);
  if (itemsToTranslate.length === 0) return payloadItems.map(() => "");

  const userTask = `请翻译以下 JSON 数组中的 text 字段为简体中文，并返回同结构 JSON 数组。\n规则：\n- 仅翻译 text 的内容，不要添加解释。\n- 必须保留每个 id。\n- 输出必须是 JSON 数组，不能有 Markdown 代码块。\n- 保留原文本中的换行结构（如果有多行，请在 translation 中使用 \\n 表示）。\n\n输入 JSON：\n${JSON.stringify(itemsToTranslate)}`;

  const modelRawText = await requestOpenAICompatible({ baseUrl, model, systemPrompt, userTask });
  const parsed = parseModelJson(modelRawText);
  if (!Array.isArray(parsed)) throw new Error("模型返回不是 JSON 数组。");
  if (parsed.length !== itemsToTranslate.length) throw new Error(`模型返回条数不匹配：期望 ${itemsToTranslate.length}，实际 ${parsed.length}。`);

  const map = new Map();
  for (let index = 0; index < parsed.length; index += 1) {
    const item = parsed[index];
    const id = Number(item?.id ?? index + 1);
    const translation = pickTranslationText(item).trim();
    if (!Number.isInteger(id) || id < 1 || id > payloadItems.length) throw new Error("模型返回的 id 非法。");
    if (!translation) {
      const sourceText = payloadItems[id - 1]?.text || "";
      throw new Error(`模型返回缺少翻译文本，id=${id}，source=${truncateForError(sourceText)}`);
    }
    map.set(id, translation);
  }

  const ordered = [];
  for (let i = 1; i <= payloadItems.length; i += 1) {
    const sourceText = payloadItems[i - 1]?.text || "";
    if (!sourceText.trim()) {
      ordered.push("");
      continue;
    }
    const translated = map.get(i);
    if (!translated) throw new Error(`模型返回缺少 id=${i} 的翻译结果，source=${truncateForError(sourceText)}`);
    ordered.push(translated);
  }
  return ordered;
}

async function requestOpenAICompatible({ baseUrl, model, systemPrompt, userTask }) {
  const url = `${baseUrl.replace(/\/+$/, "")}/chat/completions`;
  const apiKey = prompt("请输入 API Key", "");
  if (!apiKey) throw new Error("缺少 API Key");

  const resp = await fetch(url, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify({
      model,
      temperature: 0.2,
      messages: [
        { role: "system", content: systemPrompt },
        { role: "user", content: userTask },
      ],
    }),
  });

  if (!resp.ok) {
    const text = await resp.text();
    throw new Error(`OpenAI 兼容 API 错误(${resp.status}): ${text.slice(0, 200)}`);
  }
  const data = await resp.json();
  const text = data?.choices?.[0]?.message?.content;
  if (!text) throw new Error("OpenAI 兼容接口返回为空。");
  return text;
}

function parseModelJson(raw) {
  const stripped = raw.trim().replace(/^```json\s*/i, "").replace(/^```\s*/i, "").replace(/\s*```$/i, "");
  const candidates = [...buildModelJsonCandidates(stripped)];
  const leftBracket = stripped.indexOf("[");
  const rightBracket = stripped.lastIndexOf("]");
  if (leftBracket !== -1 && rightBracket !== -1 && rightBracket > leftBracket) {
    const bracketContent = stripped.slice(leftBracket, rightBracket + 1);
    candidates.push(...buildModelJsonCandidates(bracketContent));
  }

  const seen = new Set();
  for (const candidate of candidates) {
    if (seen.has(candidate)) {
      continue;
    }
    seen.add(candidate);

    const parsed = parseJsonWithDumpSupport(candidate);
    if (!parsed.ok) {
      continue;
    }

    const payload = extractArrayPayload(parsed.value);
    if (Array.isArray(payload)) {
      return payload;
    }
  }
  throw new Error(`无法解析模型返回为 JSON，片段: ${raw.slice(0, 120)}...`);
}

function parseJsonWithDumpSupport(raw) {
  const candidates = buildModelJsonCandidates(raw);
  let firstError = null;

  for (const candidate of candidates) {
    try {
      const value = JSON.parse(candidate);
      return { ok: true, value: unwrapStringifiedJson(value) };
    } catch (error) {
      if (!firstError) {
        firstError = error;
      }
    }
  }

  return {
    ok: false,
    error: firstError || new Error("JSON 解析失败"),
  };
}

function buildModelJsonCandidates(raw) {
  const seen = new Set();
  const candidates = [];
  const pushCandidate = (value) => {
    if (typeof value !== "string") {
      return;
    }
    const text = value.trim();
    if (!text || seen.has(text)) {
      return;
    }
    seen.add(text);
    candidates.push(text);
  };

  pushCandidate(raw);
  const trimmed = raw.trim();
  const wrapped = isWrappedByMatchingQuote(trimmed);

  if (wrapped) {
    pushCandidate(trimmed.slice(1, -1));
  }

  if (trimmed.includes('\\"')) {
    pushCandidate(trimmed.replace(/\\"/g, '"'));
    if (wrapped) {
      pushCandidate(trimmed.slice(1, -1).replace(/\\"/g, '"'));
    }
  }

  return candidates;
}

function unwrapStringifiedJson(value) {
  let current = value;
  for (let i = 0; i < 3; i += 1) {
    if (typeof current !== "string") {
      return current;
    }
    const text = current.trim();
    if (!looksLikeJsonText(text)) {
      return current;
    }
    try {
      current = JSON.parse(text);
    } catch (error) {
      void error;
      return current;
    }
  }
  return current;
}

function extractArrayPayload(parsed) {
  if (Array.isArray(parsed)) {
    return parsed;
  }
  if (!parsed || typeof parsed !== "object") {
    return null;
  }

  const arrayKeys = ["items", "data", "translations", "results"];
  for (const key of arrayKeys) {
    const value = unwrapStringifiedJson(parsed[key]);
    if (Array.isArray(value)) {
      return value;
    }
  }
  return null;
}

function isWrappedByMatchingQuote(text) {
  if (text.length < 2) {
    return false;
  }
  return (text.startsWith('"') && text.endsWith('"')) || (text.startsWith("'") && text.endsWith("'"));
}

function looksLikeJsonText(text) {
  return (text.startsWith("{") && text.endsWith("}")) || (text.startsWith("[") && text.endsWith("]"));
}

function pickTranslationText(item) {
  if (typeof item === "string") return item.trim();
  if (Array.isArray(item)) return item.filter((x) => typeof x === "string").join("\n").trim();
  if (!item || typeof item !== "object") return "";
  const candidates = [
    item.translation,
    item.translated_text,
    item.translatedText,
    item.translated,
    item.text,
    item.output,
    item.content,
    item.result,
  ];
  for (const value of candidates) {
    const normalized = normalizeTextValue(value);
    if (normalized) return normalized;
  }
  for (const [key, value] of Object.entries(item)) {
    if (["id", "idx", "index", "timestamp", "time", "start", "end"].includes(String(key).toLowerCase())) continue;
    const normalized = normalizeTextValue(value);
    if (normalized) return normalized;
  }
  return "";
}

function normalizeTextValue(value) {
  if (typeof value === "string") return value.trim();
  if (Array.isArray(value)) return value.filter((x) => typeof x === "string").join("\n").trim();
  if (value && typeof value === "object") {
    const nestedCandidates = [value.text, value.content, value.translation, value.output, value.result];
    for (const nested of nestedCandidates) {
      const normalized = normalizeTextValue(nested);
      if (normalized) return normalized;
    }
  }
  return "";
}

function truncateForError(text, maxLen = 200) {
  const normalized = String(text || "").replace(/\s+/g, " ").trim();
  if (normalized.length <= maxLen) return normalized;
  return `${normalized.slice(0, maxLen)}...`;
}

function setProgress(percent) {
  const safe = Math.max(0, Math.min(100, percent));
  progressBar.value = safe;
  progressText.textContent = `${safe}%`;
}

function log(message) {
  const now = new Date();
  const hh = String(now.getHours()).padStart(2, "0");
  const mm = String(now.getMinutes()).padStart(2, "0");
  const ss = String(now.getSeconds()).padStart(2, "0");
  logBox.textContent += `[${hh}:${mm}:${ss}] ${message}\n`;
  logBox.scrollTop = logBox.scrollHeight;
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function buildOutputName(fileName) {
  if (!fileName.toLowerCase().endsWith(".srt")) return `${fileName}_zh.srt`;
  return fileName.replace(/\.srt$/i, "_zh.srt");
}
