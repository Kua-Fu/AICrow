const pdfFileInput = document.getElementById("pdfFileInput");
const fileMeta = document.getElementById("fileMeta");
const pagesPerChunkInput = document.getElementById("pagesPerChunkInput");
const splitBtn = document.getElementById("splitBtn");
const statusText = document.getElementById("statusText");
const summaryText = document.getElementById("summaryText");
const resultWrap = document.getElementById("resultWrap");
const resultList = document.getElementById("resultList");
const logBox = document.getElementById("logBox");

const state = {
  file: null,
  splitting: false,
};

pdfFileInput.addEventListener("change", onFileChange);
splitBtn.addEventListener("click", onSplitClick);

function onFileChange(event) {
  const file = event.target.files?.[0] || null;
  state.file = file;
  resultWrap.classList.add("hidden");
  resultList.innerHTML = "";
  summaryText.textContent = "拆分结果：尚未开始";
  logBox.textContent = "";

  if (!file) {
    fileMeta.textContent = "未选择文件";
    setStatus("neutral", "等待上传 PDF。");
    return;
  }

  fileMeta.textContent = `${file.name} (${formatBytes(file.size)})`;
  setStatus("neutral", "文件已就绪，点击“开始拆分”。");
}

async function onSplitClick() {
  if (state.splitting) {
    return;
  }

  const file = state.file;
  const pagesPerChunk = Number.parseInt(pagesPerChunkInput.value, 10);

  if (!file) {
    setStatus("error", "请先选择本地 PDF 文件。");
    return;
  }
  if (!Number.isInteger(pagesPerChunk) || pagesPerChunk <= 0) {
    setStatus("error", "每个小 PDF 的页数必须是大于 0 的整数。");
    return;
  }

  state.splitting = true;
  splitBtn.disabled = true;
  splitBtn.textContent = "拆分中...";
  resultWrap.classList.add("hidden");
  resultList.innerHTML = "";
  summaryText.textContent = "拆分结果：处理中";
  logBox.textContent = "";
  setStatus("neutral", "正在上传并拆分 PDF，请稍候...");

  const startedAt = performance.now();

  try {
    const fileDataBase64 = await readFileAsDataUrl(file);
    appendLog(`已读取文件：${file.name}`);
    appendLog(`拆分规则：每份 ${pagesPerChunk} 页`);

    const response = await fetch("/api/pdf/split", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        sourceFileName: file.name,
        pagesPerChunk,
        fileDataBase64,
      }),
    });

    const payload = await response.json().catch(() => ({}));
    if (!response.ok) {
      throw new Error(payload.error || `请求失败（HTTP ${response.status}）`);
    }

    renderResult(payload);
    const elapsed = Math.max(0, performance.now() - startedAt);
    setStatus("ok", `拆分完成，用时 ${formatDuration(elapsed)}。`);
    appendLog(`输出目录：${payload.outputDir}`);
    appendLog(`已生成 ${payload.chunkCount} 个文件。`);
  } catch (error) {
    setStatus("error", `拆分失败：${error.message}`);
    summaryText.textContent = "拆分结果：失败";
    appendLog(`错误：${error.message}`);
  } finally {
    state.splitting = false;
    splitBtn.disabled = false;
    splitBtn.textContent = "开始拆分";
  }
}

function renderResult(result) {
  const files = Array.isArray(result.files) ? result.files : [];
  summaryText.textContent = `拆分结果：总页数 ${result.totalPages}，已生成 ${result.chunkCount} 个 PDF`;

  resultList.innerHTML = "";
  files.forEach((item) => {
    const li = document.createElement("li");
    const link = document.createElement("a");
    link.href = item.downloadUrl;
    link.download = item.fileName;
    link.textContent = item.fileName;

    const desc = document.createElement("span");
    desc.textContent = `  (页码 ${item.startPage}-${item.endPage}，${item.pages} 页，${formatBytes(item.sizeBytes)})`;

    li.appendChild(link);
    li.appendChild(desc);
    resultList.appendChild(li);
  });

  resultWrap.classList.toggle("hidden", files.length === 0);
}

function setStatus(kind, text) {
  statusText.className = `status ${kind}`;
  statusText.textContent = text;
}

function appendLog(text) {
  logBox.textContent += `${new Date().toLocaleTimeString()}  ${text}\n`;
  logBox.scrollTop = logBox.scrollHeight;
}

function readFileAsDataUrl(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result || ""));
    reader.onerror = () => reject(new Error("读取本地 PDF 失败"));
    reader.readAsDataURL(file);
  });
}

function formatBytes(value) {
  const bytes = Number(value) || 0;
  if (bytes < 1024) {
    return `${bytes} B`;
  }
  if (bytes < 1024 * 1024) {
    return `${(bytes / 1024).toFixed(1)} KB`;
  }
  return `${(bytes / (1024 * 1024)).toFixed(2)} MB`;
}

function formatDuration(ms) {
  if (!Number.isFinite(ms) || ms < 1000) {
    return `${Math.round(Math.max(0, ms || 0))} ms`;
  }
  const sec = ms / 1000;
  if (sec < 60) {
    return `${sec.toFixed(2)} 秒`;
  }
  const m = Math.floor(sec / 60);
  const s = (sec - m * 60).toFixed(2);
  return `${m} 分 ${s} 秒`;
}
