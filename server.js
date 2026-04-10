const express = require("express");
const path = require("path");
const https = require("https");
const http = require("http");
const fs = require("fs");
const crypto = require("crypto");

const app = express();
const PORT = process.env.PORT || 3000;
const OUTPUT_DIR = path.join(__dirname, "outputs");
const translationSessions = new Map();

function ensureOutputDir() {
  fs.mkdirSync(OUTPUT_DIR, { recursive: true });
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

app.use(express.json({ limit: "10mb" }));
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

app.get("/", (req, res) => {
  res.sendFile(path.join(__dirname, "timestamp.html"));
});

app.listen(PORT, () => {
  ensureOutputDir();
  console.log(`AICrow 服务已启动: http://localhost:${PORT}`);
  console.log(`字幕输出目录: ${OUTPUT_DIR}`);
  console.log("按 Ctrl+C 停止服务");
});
