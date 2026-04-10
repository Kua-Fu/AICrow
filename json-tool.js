const jsonInput = document.getElementById("jsonInput");
const statusText = document.getElementById("statusText");
const treeContainer = document.getElementById("treeContainer");
const prettyOutput = document.getElementById("prettyOutput");

const btnValidate = document.getElementById("btnValidate");
const btnFormat = document.getElementById("btnFormat");
const btnCompress = document.getElementById("btnCompress");
const btnSample = document.getElementById("btnSample");
const btnClear = document.getElementById("btnClear");
const btnCopy = document.getElementById("btnCopy");
const btnExpandAll = document.getElementById("btnExpandAll");
const btnCollapseAll = document.getElementById("btnCollapseAll");
const fileInput = document.getElementById("fileInput");

const SAMPLE_JSON = {
  project: "AICrow",
  feature: "JSON Viewer",
  enabled: true,
  version: 1,
  tags: ["format", "validate", "tree"],
  options: {
    theme: "light",
    compact: false,
    limits: {
      maxDepth: 32,
      maxItems: 10000,
    },
  },
};

btnValidate.addEventListener("click", onValidate);
btnFormat.addEventListener("click", onFormat);
btnCompress.addEventListener("click", onCompress);
btnSample.addEventListener("click", onSample);
btnClear.addEventListener("click", onClear);
btnCopy.addEventListener("click", onCopyPretty);
btnExpandAll.addEventListener("click", () => setAllDetailsOpen(true));
btnCollapseAll.addEventListener("click", () => setAllDetailsOpen(false));
fileInput.addEventListener("change", onFileChange);
jsonInput.addEventListener("input", onInputChange);

onSample();

function onInputChange() {
  setStatus("neutral", "内容已变更，点击“校验”或“格式化”查看结果。");
}

function onSample() {
  jsonInput.value = JSON.stringify(SAMPLE_JSON, null, 2);
  renderFromText();
}

function onClear() {
  jsonInput.value = "";
  treeContainer.innerHTML = "";
  prettyOutput.textContent = "";
  setStatus("neutral", "已清空。");
}

function onValidate() {
  const parsed = parseCurrent();
  if (!parsed.ok) {
    setStatus("error", parsed.errorMessage);
    return;
  }
  renderJson(parsed.value);
  setStatus("ok", `JSON 校验通过：${buildSummary(parsed.value)}`);
}

function onFormat() {
  const parsed = parseCurrent();
  if (!parsed.ok) {
    setStatus("error", parsed.errorMessage);
    return;
  }
  const pretty = JSON.stringify(parsed.value, null, 2);
  jsonInput.value = pretty;
  renderJson(parsed.value);
  setStatus("ok", `格式化成功：${buildSummary(parsed.value)}`);
}

function onCompress() {
  const parsed = parseCurrent();
  if (!parsed.ok) {
    setStatus("error", parsed.errorMessage);
    return;
  }
  jsonInput.value = JSON.stringify(parsed.value);
  renderJson(parsed.value);
  setStatus("ok", `压缩成功：${buildSummary(parsed.value)}`);
}

async function onCopyPretty() {
  const parsed = parseCurrent();
  if (!parsed.ok) {
    setStatus("error", parsed.errorMessage);
    return;
  }
  const pretty = JSON.stringify(parsed.value, null, 2);
  try {
    await navigator.clipboard.writeText(pretty);
    setStatus("ok", "已复制格式化 JSON 到剪贴板。");
  } catch (error) {
    setStatus("error", `复制失败：${error.message}`);
  }
}

async function onFileChange(event) {
  const file = event.target.files?.[0];
  if (!file) {
    return;
  }
  try {
    const text = await file.text();
    jsonInput.value = text;
    renderFromText();
    setStatus("ok", `已导入文件：${file.name}`);
  } catch (error) {
    setStatus("error", `读取文件失败：${error.message}`);
  } finally {
    fileInput.value = "";
  }
}

function renderFromText() {
  const parsed = parseCurrent();
  if (!parsed.ok) {
    treeContainer.innerHTML = "";
    prettyOutput.textContent = "";
    setStatus("error", parsed.errorMessage);
    return;
  }
  renderJson(parsed.value);
  setStatus("ok", `解析成功：${buildSummary(parsed.value)}`);
}

function parseCurrent() {
  const raw = jsonInput.value.trim();
  if (!raw) {
    return { ok: false, errorMessage: "请输入 JSON 内容。" };
  }

  try {
    const value = JSON.parse(raw);
    return { ok: true, value };
  } catch (error) {
    return { ok: false, errorMessage: formatJsonError(raw, error) };
  }
}

function formatJsonError(raw, error) {
  const message = String(error?.message || "JSON 解析失败");
  const posMatch = message.match(/position\s+(\d+)/i);
  if (!posMatch) {
    return `JSON 解析失败：${message}`;
  }

  const pos = Number(posMatch[1]);
  const start = Math.max(0, pos - 24);
  const end = Math.min(raw.length, pos + 24);
  const snippet = raw.slice(start, end).replace(/\n/g, "\\n");
  return `JSON 解析失败（位置 ${pos}）：${message}。附近片段：${snippet}`;
}

function renderJson(value) {
  prettyOutput.textContent = JSON.stringify(value, null, 2);
  treeContainer.innerHTML = "";
  treeContainer.appendChild(buildTreeNode("root", value, 0, "$"));
}

function buildTreeNode(key, value, depth, path) {
  const wrapper = document.createElement("div");
  wrapper.className = "tree-node";

  if (isComplex(value)) {
    const details = document.createElement("details");
    details.open = depth < 2;

    const summary = document.createElement("summary");
    summary.innerHTML =
      `<span class="k">${escapeHtml(key)}</span>` +
      `<span class="meta">${escapeHtml(buildTypeMeta(value))}</span>`;
    details.appendChild(summary);

    if (Array.isArray(value)) {
      value.forEach((item, idx) => {
        details.appendChild(buildTreeNode(`[${idx}]`, item, depth + 1, `${path}[${idx}]`));
      });
    } else {
      Object.keys(value).forEach((childKey) => {
        const childPath = `${path}.${childKey}`;
        details.appendChild(buildTreeNode(childKey, value[childKey], depth + 1, childPath));
      });
    }

    wrapper.appendChild(details);
    return wrapper;
  }

  const line = document.createElement("div");
  line.className = "line";
  line.innerHTML =
    `<span class="k">${escapeHtml(key)}</span>: ` +
    `<span class="${primitiveClass(value)}">${escapeHtml(formatPrimitive(value))}</span>`;
  wrapper.appendChild(line);
  return wrapper;
}

function setAllDetailsOpen(open) {
  treeContainer.querySelectorAll("details").forEach((item) => {
    item.open = open;
  });
}

function isComplex(value) {
  return typeof value === "object" && value !== null;
}

function buildTypeMeta(value) {
  if (Array.isArray(value)) {
    return `Array(${value.length})`;
  }
  if (value && typeof value === "object") {
    return `Object(${Object.keys(value).length})`;
  }
  return typeof value;
}

function formatPrimitive(value) {
  if (typeof value === "string") {
    return JSON.stringify(value);
  }
  if (value === null) {
    return "null";
  }
  return String(value);
}

function primitiveClass(value) {
  if (typeof value === "string") return "v-str";
  if (typeof value === "number") return "v-num";
  if (typeof value === "boolean") return "v-bool";
  if (value === null) return "v-null";
  return "v-null";
}

function buildSummary(value) {
  if (Array.isArray(value)) {
    return `顶层是数组，长度 ${value.length}`;
  }
  if (value && typeof value === "object") {
    return `顶层是对象，键数 ${Object.keys(value).length}`;
  }
  return `顶层是 ${typeof value}`;
}

function setStatus(kind, text) {
  statusText.className = `status ${kind}`;
  statusText.textContent = text;
}

function escapeHtml(text) {
  return String(text)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}
