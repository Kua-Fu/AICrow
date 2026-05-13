const express = require("express");
const path = require("path");
const https = require("https");
const http = require("http");
const fs = require("fs");
const crypto = require("crypto");
const os = require("os");
const { execFile } = require("child_process");
const { promisify } = require("util");

const app = express();
const PORT = process.env.PORT || 3000;
const OUTPUT_DIR = path.join(__dirname, "outputs");
const PDF_SPLIT_OUTPUT_DIR = path.join(OUTPUT_DIR, "pdf-split");
const CSV_DIR = path.join(__dirname, "csvs");
const WKSP_FILE_NAME = "wksp.xlsx";
const METERING_PROJECTS = new Set(["logging", "tracing", "tracing_span"]);
const translationSessions = new Map();
const execFileAsync = promisify(execFile);

function ensureOutputDir() {
  fs.mkdirSync(OUTPUT_DIR, { recursive: true });
  fs.mkdirSync(PDF_SPLIT_OUTPUT_DIR, { recursive: true });
}

function loadConfig() {
  const configPath = path.join(__dirname, "config.env");
  const config = {};

  if (fs.existsSync(configPath)) {
    const content = fs.readFileSync(configPath, "utf-8");
    const lines = content.split("\n");
    let inPrompt = false;

    for (const line of lines) {
      const normalizedLine = line.replace(/\r$/, "");
      const trimmed = normalizedLine.trim();

      if (!trimmed || trimmed.startsWith("#")) continue;

      // 支持 PROMPT 的多行写法：
      // PROMPT=第一行
      // 第二行
      // 第三行
      const keyValueMatch = normalizedLine.match(/^([A-Z0-9_]+)\s*=(.*)$/);
      if (keyValueMatch) {
        const key = keyValueMatch[1].trim();
        const value = keyValueMatch[2].trim();
        config[key] = value;
        inPrompt = key === "PROMPT";
        continue;
      }

      if (inPrompt) {
        config.PROMPT = config.PROMPT ? `${config.PROMPT}\n${normalizedLine}` : normalizedLine;
      }
    }
  }
  return config;
}

function sanitizeFileStem(sourceFileName) {
  const parsed = path.parse(sourceFileName || "subtitle.srt");
  const rawStem = parsed.name || "subtitle";
  const safeStem = rawStem.replace(/[^\w.-]+/g, "_").replace(/^_+|_+$/g, "");
  return safeStem || "subtitle";
}

function buildOutputPath(sourceFileName) {
  const stamp = new Date()
    .toISOString()
    .replace(/[-:]/g, "")
    .replace(/\.\d{3}Z$/, "Z")
    .replace("T", "_");
  return path.join(OUTPUT_DIR, `${sanitizeFileStem(sourceFileName)}_zh_${stamp}.srt`);
}

function composeSrtBlock(entry, index) {
  const indexFromEntry = Number(entry?.index);
  const outputIndex = Number.isInteger(indexFromEntry) && indexFromEntry > 0 ? indexFromEntry : index;
  const timestamp = String(entry?.timestamp || "").trim();
  const text = String(entry?.text || "").replace(/\r/g, "").trim();
  return `${outputIndex}\n${timestamp}\n${text}\n\n`;
}

function safeDecodeBase64(base64Data) {
  const raw = String(base64Data || "").trim();
  if (!raw) {
    return Buffer.alloc(0);
  }
  const normalized = raw.includes(",") ? raw.split(",").pop() : raw;
  return Buffer.from(normalized, "base64");
}

function postScriptEscape(filePath) {
  return String(filePath)
    .replaceAll("\\", "\\\\")
    .replaceAll("(", "\\(")
    .replaceAll(")", "\\)");
}

function toWebPath(filePath) {
  const relative = path.relative(__dirname, filePath).split(path.sep).join("/");
  return `/${relative}`;
}

function decodeXmlEntities(value) {
  return String(value || "")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&amp;/g, "&");
}

function getXmlAttribute(tag, name) {
  const match = String(tag || "").match(new RegExp(`\\b${name}="([^"]*)"`));
  return match ? decodeXmlEntities(match[1]) : "";
}

function getXmlValue(xml, tagName) {
  const match = String(xml || "").match(new RegExp(`<${tagName}\\b[^>]*>([\\s\\S]*?)<\\/${tagName}>`));
  return match ? decodeXmlEntities(match[1]) : "";
}

function parseSharedStrings(xml) {
  const strings = [];
  const itemPattern = /<si\b[^>]*>([\s\S]*?)<\/si>/g;
  let itemMatch;

  while ((itemMatch = itemPattern.exec(xml)) !== null) {
    const textParts = [];
    const textPattern = /<t\b[^>]*>([\s\S]*?)<\/t>/g;
    let textMatch;

    while ((textMatch = textPattern.exec(itemMatch[1])) !== null) {
      textParts.push(decodeXmlEntities(textMatch[1]));
    }

    strings.push(textParts.join(""));
  }

  return strings;
}

function columnIndexFromCellRef(cellRef) {
  const letters = String(cellRef || "").match(/^[A-Z]+/i)?.[0] || "";
  if (!letters) {
    return 0;
  }

  let index = 0;
  for (const letter of letters.toUpperCase()) {
    index = index * 26 + letter.charCodeAt(0) - 64;
  }
  return index - 1;
}

function columnNameFromIndex(index) {
  let value = Number(index) + 1;
  let name = "";

  while (value > 0) {
    const remainder = (value - 1) % 26;
    name = String.fromCharCode(65 + remainder) + name;
    value = Math.floor((value - 1) / 26);
  }

  return name || "A";
}

function parseWorksheetRows(xml, sharedStrings) {
  const rows = [];
  const rowPattern = /<row\b[^>]*>([\s\S]*?)<\/row>/g;
  let rowMatch;

  while ((rowMatch = rowPattern.exec(xml)) !== null) {
    const row = [];
    const cellPattern = /<c\b([^>]*)>([\s\S]*?)<\/c>/g;
    let cellMatch;

    while ((cellMatch = cellPattern.exec(rowMatch[1])) !== null) {
      const attrs = cellMatch[1];
      const body = cellMatch[2];
      const cellRef = getXmlAttribute(attrs, "r");
      const type = getXmlAttribute(attrs, "t");
      const columnIndex = columnIndexFromCellRef(cellRef);
      const rawValue = getXmlValue(body, "v");

      if (type === "s") {
        row[columnIndex] = sharedStrings[Number(rawValue)] || "";
      } else if (type === "inlineStr") {
        row[columnIndex] = getXmlValue(body, "t");
      } else {
        row[columnIndex] = rawValue;
      }
    }

    rows.push(row);
  }

  return rows;
}

async function unzipTextEntry(zipPath, entryName) {
  const { stdout } = await execFileAsync("unzip", ["-p", zipPath, entryName], {
    maxBuffer: 100 * 1024 * 1024,
  });
  return String(stdout || "");
}

async function loadWorkspaceIdList() {
  const workbookPath = path.join(CSV_DIR, WKSP_FILE_NAME);

  if (!fs.existsSync(workbookPath)) {
    throw new Error(`未找到 ${path.join("csvs", WKSP_FILE_NAME)}。`);
  }

  const sharedStringsXml = await unzipTextEntry(workbookPath, "xl/sharedStrings.xml");
  const sheetXml = await unzipTextEntry(workbookPath, "xl/worksheets/sheet1.xml");
  const sharedStrings = parseSharedStrings(sharedStringsXml);
  const rows = parseWorksheetRows(sheetXml, sharedStrings);
  const normalizeHeader = (value) => String(value || "").replace(/\s+/g, "").toLowerCase();
  const headerRowIndex = rows.findIndex((row) =>
    row.some((cell) => ["空间id", "空间uuid", "workspaceuuid", "wkspuuid"].includes(normalizeHeader(cell)))
  );

  if (headerRowIndex === -1) {
    throw new Error(`${WKSP_FILE_NAME} 中未找到“空间id”列。`);
  }

  const headerRow = rows[headerRowIndex];
  const workspaceIdColumn = headerRow.findIndex((cell) =>
    ["空间id", "空间uuid", "workspaceuuid", "wkspuuid"].includes(normalizeHeader(cell))
  );
  const ids = [];
  const seen = new Set();

  for (const row of rows.slice(headerRowIndex + 1)) {
    const id = String(row[workspaceIdColumn] || "").trim();
    if (!/^wksp_[A-Za-z0-9]+$/.test(id) || seen.has(id)) {
      continue;
    }
    seen.add(id);
    ids.push(id);
  }

  return {
    ids,
    sourceFile: path.join("csvs", WKSP_FILE_NAME),
    rowCount: rows.length,
    columnName: columnNameFromIndex(workspaceIdColumn),
  };
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

function extractMessageWorkspaceId(message) {
  return String(message || "").match(/\bwsuuid:\s*(wksp_[A-Za-z0-9]+)/)?.[1] || "";
}

function extractPointSegments(message) {
  const text = String(message || "");
  const starts = [];
  const pattern = /\bdf_metering\b/g;
  let match;

  while ((match = pattern.exec(text)) !== null) {
    starts.push(match.index);
  }

  return starts.map((start, index) => {
    const end = starts[index + 1] || text.length;
    return text.slice(start, end).trim();
  });
}

function extractLastNsTimestamp(message) {
  const matches = [...String(message || "").matchAll(/\b(\d{16,20})\b/g)];
  return matches.length ? matches[matches.length - 1][1] : "";
}

function formatNsTimestamp(nsTimestamp) {
  const ns = Number(nsTimestamp);
  if (!Number.isFinite(ns) || ns <= 0) {
    return "";
  }

  const date = new Date(Math.floor(ns / 1000000));
  const parts = new Intl.DateTimeFormat("zh-CN", {
    timeZone: "Asia/Shanghai",
    hour12: false,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  })
    .formatToParts(date)
    .reduce((acc, part) => {
      acc[part.type] = part.value;
      return acc;
    }, {});

  return `${parts.year}-${parts.month}-${parts.day} ${parts.hour}:${parts.minute}:${parts.second}`;
}

function extractLineProtocolValue(segment, key) {
  const text = String(segment || "");
  const needle = `${key}=`;
  let position = 0;

  while ((position = text.indexOf(needle, position)) !== -1) {
    const before = text[position - 1];
    if (position > 0 && before !== "," && before !== " " && before !== "\t") {
      position += needle.length;
      continue;
    }

    let cursor = position + needle.length;
    if (text[cursor] === '"') {
      cursor += 1;
      let value = "";
      while (cursor < text.length) {
        const char = text[cursor];
        if (char === "\\" && cursor + 1 < text.length) {
          value += text[cursor + 1];
          cursor += 2;
          continue;
        }
        if (char === '"') {
          return value;
        }
        value += char;
        cursor += 1;
      }
      return value;
    }

    let end = cursor;
    while (end < text.length && text[end] !== "," && !/\s/.test(text[end])) {
      end += 1;
    }
    return text.slice(cursor, end).replace(/^"+|"+$/g, "");
  }

  return "";
}

function parseMeteringNumber(value) {
  const normalized = String(value || "")
    .trim()
    .replace(/^"+|"+$/g, "")
    .replace(/i$/, "");
  const number = Number(normalized);
  return Number.isFinite(number) ? number : 0;
}

function addMeteringAggregate(map, key, base, count, hourCount, fileName) {
  let item = map.get(key);
  if (!item) {
    item = {
      ...base,
      countTotal: 0,
      hourCountTotal: 0,
      pointCount: 0,
      workspaces: new Set(),
      files: new Set(),
    };
    map.set(key, item);
  }

  item.countTotal += count;
  item.hourCountTotal += hourCount;
  item.pointCount += 1;
  item.workspaces.add(base.workspaceUUID);
  item.files.add(fileName);
}

function serializeAggregate(item) {
  return {
    ...item,
    countTotal: Math.round(item.countTotal),
    hourCountTotal: Math.round(item.hourCountTotal),
    workspaceCount: item.workspaces.size,
    fileCount: item.files.size,
    workspaces: undefined,
    files: undefined,
  };
}

function hasMeteringValue(item) {
  return Number(item.countTotal) !== 0 || Number(item.hourCountTotal) !== 0;
}

async function analyzeMeteringFiles() {
  const workspaceInfo = await loadWorkspaceIdList();
  const workspaceIds = new Set(workspaceInfo.ids);

  if (!fs.existsSync(CSV_DIR)) {
    throw new Error("未找到 csvs 目录。");
  }

  const csvFiles = fs
    .readdirSync(CSV_DIR)
    .filter((fileName) => /^export-.*\.csv$/i.test(fileName))
    .sort();

  const totalsByProject = new Map();
  const totalsByWorkspace = new Map();
  const stats = {
    workspaceIdCount: workspaceInfo.ids.length,
    csvFileCount: csvFiles.length,
    csvRowCount: 0,
    matchedMessageCount: 0,
    ignoredMessageCount: 0,
    messageWithoutWorkspaceCount: 0,
    meteringPointCount: 0,
    targetPointCount: 0,
  };
  const warnings = [];

  for (const fileName of csvFiles) {
    const filePath = path.join(CSV_DIR, fileName);
    const csvRows = parseCsvRows(fs.readFileSync(filePath, "utf-8"));
    const headers = (csvRows[0] || []).map((header) => String(header || "").replace(/^\uFEFF/, "").trim());
    const messageIndex = headers.findIndex((header) => header.toLowerCase() === "message");

    if (messageIndex === -1) {
      warnings.push(`${fileName} 缺少 Message 列，已跳过。`);
      continue;
    }

    for (const row of csvRows.slice(1)) {
      if (!row.some((cell) => String(cell || "").trim())) {
        continue;
      }

      stats.csvRowCount += 1;
      const message = String(row[messageIndex] || "");
      const messageWorkspaceId = extractMessageWorkspaceId(message);

      if (!messageWorkspaceId) {
        stats.messageWithoutWorkspaceCount += 1;
        continue;
      }
      if (!workspaceIds.has(messageWorkspaceId)) {
        stats.ignoredMessageCount += 1;
        continue;
      }

      stats.matchedMessageCount += 1;
      const statisticNs = extractLastNsTimestamp(message);
      const statisticTime = formatNsTimestamp(statisticNs);

      for (const segment of extractPointSegments(message)) {
        stats.meteringPointCount += 1;
        const project = extractLineProtocolValue(segment, "project");

        if (!METERING_PROJECTS.has(project)) {
          continue;
        }

        const workspaceUUID = extractLineProtocolValue(segment, "workspaceUUID") || messageWorkspaceId;
        if (!workspaceIds.has(workspaceUUID)) {
          continue;
        }

        const subProject = extractLineProtocolValue(segment, "sub_project");
        const count = parseMeteringNumber(extractLineProtocolValue(segment, "count"));
        const hourCount = parseMeteringNumber(extractLineProtocolValue(segment, "hour_count"));
        const projectKey = `${workspaceUUID}\0${project}\0${subProject}`;
        const workspaceKey = `${workspaceUUID}\0${project}\0${subProject}\0${statisticTime}`;

        stats.targetPointCount += 1;
        addMeteringAggregate(
          totalsByProject,
          projectKey,
          { project, subProject, workspaceUUID },
          count,
          hourCount,
          fileName
        );
        addMeteringAggregate(
          totalsByWorkspace,
          workspaceKey,
          { workspaceUUID, project, subProject, statisticTime, statisticNs },
          count,
          hourCount,
          fileName
        );
      }
    }
  }

  const byProject = [...totalsByProject.values()]
    .map(serializeAggregate)
    .filter(hasMeteringValue)
    .sort(
      (a, b) =>
        a.workspaceUUID.localeCompare(b.workspaceUUID) ||
        a.project.localeCompare(b.project) ||
        a.subProject.localeCompare(b.subProject)
    );
  const byWorkspace = [...totalsByWorkspace.values()]
    .map(serializeAggregate)
    .filter(hasMeteringValue)
    .sort(
      (a, b) =>
        a.workspaceUUID.localeCompare(b.workspaceUUID) ||
        a.project.localeCompare(b.project) ||
        a.subProject.localeCompare(b.subProject) ||
        String(a.statisticTime || "").localeCompare(String(b.statisticTime || ""))
    );

  return {
    generatedAt: new Date().toISOString(),
    workspaceInfo,
    csvFiles,
    projects: [...METERING_PROJECTS],
    stats,
    byProject,
    byWorkspace,
    warnings,
  };
}

async function ensureGhostscriptAvailable() {
  try {
    await execFileAsync("gs", ["--version"]);
  } catch (error) {
    throw new Error(
      "未检测到 Ghostscript（gs）。请先安装后重试，例如 macOS 可使用 `brew install ghostscript`。"
    );
  }
}

async function getPdfPageCount(pdfPath) {
  const escapedPath = postScriptEscape(pdfPath);
  const { stdout } = await execFileAsync("gs", [
    "-q",
    "-dNODISPLAY",
    `--permit-file-read=${pdfPath}`,
    "-c",
    `(${escapedPath}) (r) file runpdfbegin pdfpagecount = quit`,
  ]);
  const pageCount = Number.parseInt(String(stdout || "").trim(), 10);
  if (!Number.isInteger(pageCount) || pageCount <= 0) {
    throw new Error("无法识别 PDF 页数，请确认文件未损坏且为标准 PDF。");
  }
  return pageCount;
}

function buildPdfSplitJobDir(sourceFileName) {
  const stamp = new Date()
    .toISOString()
    .replace(/[-:]/g, "")
    .replace(/\.\d{3}Z$/, "Z")
    .replace("T", "_");
  const jobName = `${sanitizeFileStem(sourceFileName)}_split_${stamp}_${crypto.randomUUID().slice(0, 8)}`;
  return path.join(PDF_SPLIT_OUTPUT_DIR, jobName);
}

async function splitPdfByPages({ inputPdfPath, sourceFileName, pagesPerChunk }) {
  const totalPages = await getPdfPageCount(inputPdfPath);
  const outputDir = buildPdfSplitJobDir(sourceFileName);
  fs.mkdirSync(outputDir, { recursive: true });

  const stem = sanitizeFileStem(sourceFileName || "document.pdf");
  const files = [];
  let partIndex = 1;

  for (let startPage = 1; startPage <= totalPages; startPage += pagesPerChunk) {
    const endPage = Math.min(startPage + pagesPerChunk - 1, totalPages);
    const outputName = `${stem}_part${partIndex}_p${startPage}-${endPage}.pdf`;
    const outputPath = path.join(outputDir, outputName);

    await execFileAsync("gs", [
      "-q",
      "-dNOPAUSE",
      "-dBATCH",
      "-dSAFER",
      "-sDEVICE=pdfwrite",
      "-dCompatibilityLevel=1.4",
      `-dFirstPage=${startPage}`,
      `-dLastPage=${endPage}`,
      `-sOutputFile=${outputPath}`,
      inputPdfPath,
    ]);

    const stat = fs.statSync(outputPath);
    if (!stat.size) {
      throw new Error(`拆分失败：${outputName} 未生成有效内容。`);
    }

    files.push({
      fileName: outputName,
      startPage,
      endPage,
      pages: endPage - startPage + 1,
      sizeBytes: stat.size,
      outputPath,
      downloadUrl: toWebPath(outputPath),
    });
    partIndex += 1;
  }

  return {
    sourceFileName: sourceFileName || "document.pdf",
    totalPages,
    pagesPerChunk,
    chunkCount: files.length,
    outputDir,
    files,
  };
}

app.use(express.json({ limit: "130mb" }));
app.use(express.static(__dirname));

async function proxyRequest(req, res) {
  const { url, method, headers, body } = req.body;

  if (!url) {
    return res.status(400).json({ error: "Missing url parameter" });
  }

  try {
    const targetUrl = new URL(url);
    const isHttps = targetUrl.protocol === "https:";
    const lib = isHttps ? https : http;

    const requestBody = JSON.stringify(body || {});
    const options = {
      hostname: targetUrl.hostname,
      port: targetUrl.port || (isHttps ? 443 : 80),
      path: targetUrl.pathname + targetUrl.search,
      method: method || "POST",
      headers: {
        "Content-Type": "application/json",
        "Content-Length": Buffer.byteLength(requestBody),
      },
    };

    const authHeader = headers?.authorization || headers?.Authorization;
    if (authHeader) {
      options.headers.Authorization = authHeader;
    }

    const proxyReq = lib.request(options, (proxyRes) => {
      let data = "";
      proxyRes.on("data", (chunk) => (data += chunk));
      proxyRes.on("end", () => {
        res.status(proxyRes.statusCode || 500).send(data);
      });
    });

    proxyReq.on("error", (error) => {
      console.error("Proxy error:", error.message);
      res.status(502).json({ error: `Proxy error: ${error.message}` });
    });

    proxyReq.write(requestBody);
    proxyReq.end();
  } catch (error) {
    console.error("Request error:", error.message);
    res.status(400).json({ error: `Invalid request: ${error.message}` });
  }
}

app.post("/api/proxy", proxyRequest);

app.get("/api/config", (req, res) => {
  const envConfig = loadConfig();
  res.json({
    apiKey: envConfig.API_KEY || "",
    openaiBaseUrl: envConfig.OPENAI_BASE_URL || "",
    openaiModel: envConfig.OPENAI_MODEL || "",
    batchSize: parseInt(envConfig.BATCH_SIZE, 10) || 40,
    concurrency: parseInt(envConfig.CONCURRENCY, 10) || 4,
    retryCount: parseInt(envConfig.RETRY_COUNT, 10) || 2,
    delayMs: parseInt(envConfig.DELAY_MS, 10) || 300,
    prompt: envConfig.PROMPT || "",
  });
});

app.get("/api/metering/analyze", async (req, res) => {
  try {
    const result = await analyzeMeteringFiles();
    res.json(result);
  } catch (error) {
    console.error("Metering analyze error:", error.message);
    res.status(500).json({ error: `计量分析失败: ${error.message}` });
  }
});

app.post("/api/translation/start", (req, res) => {
  try {
    ensureOutputDir();

    const sourceFileName = String(req.body?.sourceFileName || "subtitle.srt");
    const sessionId = crypto.randomUUID();
    const outputPath = buildOutputPath(sourceFileName);

    fs.writeFileSync(outputPath, "", "utf-8");
    translationSessions.set(sessionId, {
      outputPath,
      nextIndex: 1,
      createdAt: Date.now(),
      updatedAt: Date.now(),
    });

    res.json({ sessionId, outputPath });
  } catch (error) {
    console.error("Start translation file error:", error.message);
    res.status(500).json({ error: `创建输出文件失败: ${error.message}` });
  }
});

app.post("/api/translation/append", (req, res) => {
  const sessionId = String(req.body?.sessionId || "");
  const entries = req.body?.entries;

  if (!sessionId) {
    return res.status(400).json({ error: "缺少 sessionId。" });
  }
  if (!Array.isArray(entries) || entries.length === 0) {
    return res.status(400).json({ error: "entries 必须是非空数组。" });
  }

  const session = translationSessions.get(sessionId);
  if (!session) {
    return res.status(404).json({ error: "翻译会话不存在或已结束。" });
  }

  try {
    const normalized = entries.map((entry) => ({
      index: Number(entry?.index),
      timestamp: String(entry?.timestamp || "").trim(),
      text: String(entry?.text || "").replace(/\r/g, "").trim(),
    }));

    for (const entry of normalized) {
      if (!entry.timestamp || !entry.timestamp.includes("-->")) {
        return res.status(400).json({ error: "字幕时间轴格式非法。" });
      }
    }

    const chunkText = normalized
      .map((entry, offset) => composeSrtBlock(entry, session.nextIndex + offset))
      .join("");

    fs.appendFileSync(session.outputPath, chunkText, "utf-8");
    session.nextIndex += normalized.length;
    session.updatedAt = Date.now();

    res.json({
      outputPath: session.outputPath,
      written: normalized.length,
      nextIndex: session.nextIndex,
    });
  } catch (error) {
    console.error("Append translation file error:", error.message);
    res.status(500).json({ error: `写入翻译文件失败: ${error.message}` });
  }
});

app.post("/api/translation/finalize", (req, res) => {
  const sessionId = String(req.body?.sessionId || "");

  if (!sessionId) {
    return res.status(400).json({ error: "缺少 sessionId。" });
  }

  const session = translationSessions.get(sessionId);
  if (!session) {
    return res.status(404).json({ error: "翻译会话不存在或已结束。" });
  }

  try {
    const stat = fs.statSync(session.outputPath);
    translationSessions.delete(sessionId);
    res.json({
      outputPath: session.outputPath,
      fileSize: stat.size,
      entriesWritten: session.nextIndex - 1,
    });
  } catch (error) {
    console.error("Finalize translation file error:", error.message);
    res.status(500).json({ error: `结束翻译会话失败: ${error.message}` });
  }
});

app.post("/api/pdf/split", async (req, res) => {
  const sourceFileName = String(req.body?.sourceFileName || "document.pdf").trim();
  const pagesPerChunk = Number.parseInt(String(req.body?.pagesPerChunk || ""), 10);
  const fileDataBase64 = req.body?.fileDataBase64;

  if (!Number.isInteger(pagesPerChunk) || pagesPerChunk <= 0) {
    return res.status(400).json({ error: "pagesPerChunk 必须是大于 0 的整数。" });
  }
  if (!String(fileDataBase64 || "").trim()) {
    return res.status(400).json({ error: "缺少 PDF 文件内容。" });
  }

  const pdfBuffer = safeDecodeBase64(fileDataBase64);
  if (!pdfBuffer.length) {
    return res.status(400).json({ error: "PDF 文件内容为空或编码非法。" });
  }
  if (pdfBuffer.length > 80 * 1024 * 1024) {
    return res.status(413).json({ error: "PDF 文件过大，请控制在 80MB 以内。" });
  }

  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "aicrow-pdf-split-"));
  const inputPdfPath = path.join(tempDir, `${sanitizeFileStem(sourceFileName)}.pdf`);

  try {
    await ensureGhostscriptAvailable();
    fs.writeFileSync(inputPdfPath, pdfBuffer);
    const result = await splitPdfByPages({
      inputPdfPath,
      sourceFileName,
      pagesPerChunk,
    });
    res.json(result);
  } catch (error) {
    console.error("PDF split error:", error.message);
    res.status(500).json({ error: `PDF 拆分失败: ${error.message}` });
  } finally {
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
});

app.get("/", (req, res) => {
  res.sendFile(path.join(__dirname, "timestamp.html"));
});

if (require.main === module) {
  app.listen(PORT, () => {
    ensureOutputDir();
    console.log(`AICrow 服务已启动: http://localhost:${PORT}`);
    console.log(`字幕输出目录: ${OUTPUT_DIR}`);
    console.log("按 Ctrl+C 停止服务");
  });
}

module.exports = {
  app,
  analyzeMeteringFiles,
  loadWorkspaceIdList,
  getPdfPageCount,
  splitPdfByPages,
};
