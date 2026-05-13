const state = {
  result: null,
  filteredRows: [],
};

const analyzeBtn = document.getElementById("analyzeBtn");
const exportSummaryBtn = document.getElementById("exportSummaryBtn");
const exportBtn = document.getElementById("exportBtn");
const sourceText = document.getElementById("sourceText");
const workspaceCount = document.getElementById("workspaceCount");
const csvFileCount = document.getElementById("csvFileCount");
const matchedMessageCount = document.getElementById("matchedMessageCount");
const targetPointCount = document.getElementById("targetPointCount");
const summaryMeta = document.getElementById("summaryMeta");
const detailMeta = document.getElementById("detailMeta");
const projectBody = document.getElementById("projectBody");
const workspaceBody = document.getElementById("workspaceBody");
const searchInput = document.getElementById("searchInput");
const projectFilter = document.getElementById("projectFilter");
const warningPanel = document.getElementById("warningPanel");
const warningText = document.getElementById("warningText");
const summaryCsvInput = document.getElementById("summaryCsvInput");
const tokenInput = document.getElementById("tokenInput");
const timeNsInput = document.getElementById("timeNsInput");
const generateCurlBtn = document.getElementById("generateCurlBtn");
const copyCurlBtn = document.getElementById("copyCurlBtn");
const curlOutput = document.getElementById("curlOutput");
const curlMeta = document.getElementById("curlMeta");

analyzeBtn.addEventListener("click", analyzeMetering);
exportSummaryBtn.addEventListener("click", exportSummaryCsv);
exportBtn.addEventListener("click", exportDetailsCsv);
searchInput.addEventListener("input", renderWorkspaceRows);
projectFilter.addEventListener("change", renderWorkspaceRows);
generateCurlBtn.addEventListener("click", generateCurlCommands);
copyCurlBtn.addEventListener("click", copyCurlCommands);

function formatInteger(value) {
  const number = Number(value);
  if (!Number.isFinite(number)) {
    return "--";
  }
  return new Intl.NumberFormat("zh-CN").format(Math.round(number));
}

function displaySubProject(value) {
  return value ? value : "-";
}

function setSummary(stats = {}) {
  workspaceCount.textContent = formatInteger(stats.workspaceIdCount);
  csvFileCount.textContent = formatInteger(stats.csvFileCount);
  matchedMessageCount.textContent = formatInteger(stats.matchedMessageCount);
  targetPointCount.textContent = formatInteger(stats.targetPointCount);
}

function setLoading(isLoading) {
  analyzeBtn.disabled = isLoading;
  analyzeBtn.textContent = isLoading ? "分析中..." : "开始分析";
}

function renderProjectRows() {
  const rows = state.result?.byProject || [];

  if (!rows.length) {
    projectBody.innerHTML = `<tr><td colspan="6" class="empty">没有匹配到计量数据</td></tr>`;
    return;
  }

  projectBody.innerHTML = rows
    .map(
      (row) => `
        <tr>
          <td>${escapeHtml(row.workspaceUUID)}</td>
          <td>${escapeHtml(row.project)}</td>
          <td>${escapeHtml(displaySubProject(row.subProject))}</td>
          <td class="numeric">${formatInteger(row.countTotal)}</td>
          <td class="numeric">${formatInteger(row.hourCountTotal)}</td>
          <td class="numeric">${formatInteger(row.pointCount)}</td>
        </tr>
      `
    )
    .join("");
}

function renderWorkspaceRows() {
  const rows = state.result?.byWorkspace || [];
  const keyword = searchInput.value.trim().toLowerCase();
  const project = projectFilter.value;

  state.filteredRows = rows.filter((row) => {
    const matchesProject = !project || row.project === project;
    const searchable = [row.workspaceUUID, row.project, row.subProject, row.statisticTime].join(" ").toLowerCase();
    return matchesProject && (!keyword || searchable.includes(keyword));
  });

  detailMeta.textContent = `显示 ${formatInteger(state.filteredRows.length)} / ${formatInteger(rows.length)} 条`;

  if (!state.filteredRows.length) {
    workspaceBody.innerHTML = `<tr><td colspan="7" class="empty">没有匹配结果</td></tr>`;
    return;
  }

  workspaceBody.innerHTML = state.filteredRows
    .map(
      (row) => `
        <tr>
          <td>${escapeHtml(row.workspaceUUID)}</td>
          <td>${escapeHtml(row.project)}</td>
          <td>${escapeHtml(displaySubProject(row.subProject))}</td>
          <td>${escapeHtml(row.statisticTime || "-")}</td>
          <td class="numeric">${formatInteger(row.countTotal)}</td>
          <td class="numeric">${formatInteger(row.hourCountTotal)}</td>
          <td class="numeric">${formatInteger(row.pointCount)}</td>
        </tr>
      `
    )
    .join("");
}

async function analyzeMetering() {
  setLoading(true);
  exportSummaryBtn.disabled = true;
  exportBtn.disabled = true;
  summaryMeta.textContent = "正在分析...";
  detailMeta.textContent = "--";
  warningPanel.classList.add("hidden");

  try {
    const resp = await fetch("/api/metering/analyze");
    const result = await resp.json();

    if (!resp.ok) {
      throw new Error(result.error || `请求失败：${resp.status}`);
    }

    state.result = result;
    sourceText.textContent = `数据源：${result.workspaceInfo.sourceFile}（${result.workspaceInfo.columnName} 列）与 ${result.csvFiles.join("、") || "无 CSV 文件"}`;
    setSummary(result.stats);
    summaryMeta.textContent = `CSV 行 ${formatInteger(result.stats.csvRowCount)}，忽略空间外日志 ${formatInteger(
      result.stats.ignoredMessageCount
    )}，无 wsuuid 日志 ${formatInteger(result.stats.messageWithoutWorkspaceCount)}`;
    renderProjectRows();
    renderWorkspaceRows();
    exportSummaryBtn.disabled = !result.byProject.length;
    exportBtn.disabled = !result.byWorkspace.length;

    if (result.warnings.length) {
      warningText.textContent = result.warnings.join("\n");
      warningPanel.classList.remove("hidden");
    }
  } catch (error) {
    state.result = null;
    setSummary({});
    exportSummaryBtn.disabled = true;
    exportBtn.disabled = true;
    projectBody.innerHTML = `<tr><td colspan="6" class="empty">${escapeHtml(error.message)}</td></tr>`;
    workspaceBody.innerHTML = `<tr><td colspan="7" class="empty">${escapeHtml(error.message)}</td></tr>`;
    summaryMeta.textContent = "分析失败";
  } finally {
    setLoading(false);
  }
}

function exportSummaryCsv() {
  const rows = state.result?.byProject || [];
  const header = ["workspaceUUID", "project", "sub_project", "count_total", "hour_count_total", "point_count"];
  const csv = [
    header.join(","),
    ...rows.map((row) =>
      [
        row.workspaceUUID,
        row.project,
        row.subProject,
        Math.round(row.countTotal),
        Math.round(row.hourCountTotal),
        row.pointCount,
      ]
        .map(csvEscape)
        .join(",")
    ),
  ].join("\n");

  downloadCsv("metering-summary.csv", csv);
}

function exportDetailsCsv() {
  const rows = state.filteredRows.length ? state.filteredRows : state.result?.byWorkspace || [];
  const header = [
    "workspaceUUID",
    "project",
    "sub_project",
    "statistic_time",
    "statistic_ns",
    "count_total",
    "hour_count_total",
    "point_count",
  ];
  const csv = [
    header.join(","),
    ...rows.map((row) =>
      [
        row.workspaceUUID,
        row.project,
        row.subProject,
        row.statisticTime,
        row.statisticNs,
        Math.round(row.countTotal),
        Math.round(row.hourCountTotal),
        row.pointCount,
      ]
        .map(csvEscape)
        .join(",")
    ),
  ].join("\n");

  downloadCsv("metering-detail.csv", csv);
}

async function generateCurlCommands() {
  const file = summaryCsvInput.files?.[0];
  const token = tokenInput.value.trim();
  const timeNs = timeNsInput.value.trim();

  copyCurlBtn.disabled = true;
  curlOutput.value = "";

  if (!file) {
    setCurlMeta("请先选择项目汇总 CSV。", true);
    return;
  }
  if (!token) {
    setCurlMeta("请输入 token。", true);
    return;
  }
  if (!/^\d{16,20}$/.test(timeNs)) {
    setCurlMeta("请输入合法的 ns 时间戳。", true);
    return;
  }

  try {
    const rows = parseCsvRows(await file.text());
    const parsed = parseSummaryRows(rows);
    const commands = buildCurlCommands(parsed.lineProtocols, token, timeNs);

    curlOutput.value = commands.join("\n\n");
    copyCurlBtn.disabled = commands.length === 0;
    setCurlMeta(
      `已读取 ${formatInteger(parsed.totalRows)} 行，生成 ${formatInteger(parsed.lineProtocols.length)} 条 line protocol，${formatInteger(commands.length)} 个 curl。跳过 ${formatInteger(parsed.skippedRows)} 行。`,
      false
    );
  } catch (error) {
    setCurlMeta(error.message, true);
  }
}

async function copyCurlCommands() {
  const text = curlOutput.value;
  if (!text) {
    return;
  }

  await navigator.clipboard.writeText(text);
  setCurlMeta("已复制全部 curl。", false);
}

function setCurlMeta(message, isError) {
  curlMeta.textContent = message;
  curlMeta.classList.toggle("error-text", Boolean(isError));
}

function parseSummaryRows(rows) {
  const header = rows[0]?.map((cell) => normalizeHeader(cell)) || [];
  const indexMap = {
    workspaceUUID: findHeaderIndex(header, ["workspaceuuid", "workspace_uuid", "wksp_uuid", "wkspuuid"]),
    project: findHeaderIndex(header, ["project", "项目"]),
    subProject: findHeaderIndex(header, ["sub_project", "subproject", "子项目"]),
    count: findHeaderIndex(header, ["count", "count_total", "count合计"]),
    hourCount: findHeaderIndex(header, ["hour_count", "hourcount", "hour_count_total", "hourcounttotal", "hour_count合计"]),
  };

  if (indexMap.workspaceUUID === -1 || indexMap.project === -1) {
    throw new Error("汇总 CSV 至少需要 workspaceUUID 和 project 列。");
  }

  const lineProtocols = [];
  let skippedRows = 0;

  for (const row of rows.slice(1)) {
    if (!row.some((cell) => String(cell || "").trim())) {
      continue;
    }

    const workspaceUUID = String(row[indexMap.workspaceUUID] || "").trim();
    const project = String(row[indexMap.project] || "").trim();
    const subProject = indexMap.subProject === -1 ? "" : String(row[indexMap.subProject] || "").trim();
    const count = indexMap.count === -1 ? "" : normalizeIntegerField(row[indexMap.count]);
    const hourCount = indexMap.hourCount === -1 ? "" : normalizeIntegerField(row[indexMap.hourCount]);

    if (!workspaceUUID || !project) {
      skippedRows += 1;
      continue;
    }

    const fields = [];
    if (count) {
      fields.push(`count=${count}i`);
    }
    if (hourCount) {
      fields.push(`hour_count=${hourCount}i`);
    }
    if (!fields.length) {
      skippedRows += 1;
      continue;
    }

    const tags = [`project=${escapeLineProtocolTag(project)}`];
    if (subProject) {
      tags.push(`sub_project=${escapeLineProtocolTag(subProject)}`);
    }
    tags.push(`workspaceUUID=${escapeLineProtocolTag(workspaceUUID)}`);
    lineProtocols.push(`df_metering,${tags.join(",")} ${fields.join(",")}`);
  }

  return {
    lineProtocols,
    skippedRows,
    totalRows: Math.max(rows.length - 1, 0),
  };
}

function buildCurlCommands(lineProtocols, token, timeNs) {
  const commands = [];
  const encodedToken = encodeURIComponent(token);

  for (let index = 0; index < lineProtocols.length; index += 100) {
    const chunk = lineProtocols.slice(index, index + 100).map((line) => `${line} ${timeNs}`).join("\n");
    commands.push(`curl --request POST \\
  --url 'http://127.0.0.1:9527/v1/write/metering?token=${encodedToken}&precision=ns' \\
  --header 'Content-Type: text/plain' \\
  --data '${shellSingleQuote(chunk)}'`);
  }

  return commands;
}

function parseCsvRows(content) {
  const rows = [];
  let row = [];
  let field = "";
  let inQuotes = false;
  const text = String(content || "").replace(/^\uFEFF/, "");

  for (let index = 0; index < text.length; index += 1) {
    const char = text[index];

    if (inQuotes) {
      if (char === '"' && text[index + 1] === '"') {
        field += '"';
        index += 1;
      } else if (char === '"') {
        inQuotes = false;
      } else {
        field += char;
      }
      continue;
    }

    if (char === '"') {
      inQuotes = true;
    } else if (char === ",") {
      row.push(field);
      field = "";
    } else if (char === "\n") {
      row.push(field);
      rows.push(row);
      row = [];
      field = "";
    } else if (char === "\r") {
      if (text[index + 1] === "\n") {
        index += 1;
      }
      row.push(field);
      rows.push(row);
      row = [];
      field = "";
    } else {
      field += char;
    }
  }

  if (field || row.length) {
    row.push(field);
    rows.push(row);
  }

  return rows;
}

function normalizeHeader(value) {
  return String(value || "")
    .trim()
    .replace(/^\uFEFF/, "")
    .replace(/\s+/g, "")
    .toLowerCase();
}

function findHeaderIndex(headers, names) {
  return headers.findIndex((header) => names.includes(header));
}

function normalizeIntegerField(value) {
  const text = String(value ?? "").trim().replace(/,/g, "");
  if (!text) {
    return "";
  }

  const number = Number(text);
  if (!Number.isFinite(number)) {
    return "";
  }

  return String(Math.round(number));
}

function escapeLineProtocolTag(value) {
  return String(value).replace(/([,= ])/g, "\\$1");
}

function shellSingleQuote(value) {
  return String(value).replace(/'/g, "'\\''");
}

function downloadCsv(fileName, csv) {
  const blob = new Blob([`\uFEFF${csv}`], { type: "text/csv;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = fileName;
  document.body.appendChild(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(url);
}

function csvEscape(value) {
  const text = String(value ?? "");
  if (/[",\n\r]/.test(text)) {
    return `"${text.replace(/"/g, '""')}"`;
  }
  return text;
}

function escapeHtml(value) {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}
