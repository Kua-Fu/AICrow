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
  getPdfPageCount,
  splitPdfByPages,
};
