const categorySelect = document.getElementById("categorySelect");
const valueInput = document.getElementById("valueInput");
const fromUnitSelect = document.getElementById("fromUnitSelect");
const toUnitSelect = document.getElementById("toUnitSelect");
const swapBtn = document.getElementById("swapBtn");
const convertBtn = document.getElementById("convertBtn");
const copyResultBtn = document.getElementById("copyResultBtn");
const hintText = document.getElementById("hintText");
const resultText = document.getElementById("resultText");
const formulaText = document.getElementById("formulaText");
const smartResultText = document.getElementById("smartResultText");

let lastDisplayedResult = "";

const CATEGORY_DEFS = [
  {
    id: "data-size",
    label: "数据大小",
    units: [
      { id: "b", label: "b（比特）", factor: 1, group: "bit-decimal", aliases: ["bit", "bits", "比特"] },
      { id: "Kb", label: "Kb（千比特）", factor: 1e3, group: "bit-decimal", aliases: ["kbit", "kilobit"] },
      { id: "Mb", label: "Mb（兆比特）", factor: 1e6, group: "bit-decimal", aliases: ["mbit", "megabit"] },
      { id: "Gb", label: "Gb（吉比特）", factor: 1e9, group: "bit-decimal", aliases: ["gbit", "gigabit"] },
      { id: "Tb", label: "Tb（太比特）", factor: 1e12, group: "bit-decimal", aliases: ["tbit", "terabit"] },
      { id: "Pb", label: "Pb（拍比特）", factor: 1e15, group: "bit-decimal", aliases: ["pbit", "petabit"] },
      { id: "Eb", label: "Eb（艾比特）", factor: 1e18, group: "bit-decimal", aliases: ["ebit", "exabit"] },
      { id: "Zb", label: "Zb（泽比特）", factor: 1e21, group: "bit-decimal", aliases: ["zbit", "zettabit"] },
      {
        id: "B",
        label: "B（字节）",
        factor: 8,
        group: "byte-decimal",
        display: "byte",
        aliases: ["byte", "bytes", "字节"],
      },
      { id: "KB", label: "KB（千字节）", factor: 8e3, group: "byte-decimal", aliases: ["kilobyte"] },
      { id: "MB", label: "MB（兆字节）", factor: 8e6, group: "byte-decimal", aliases: ["megabyte"] },
      { id: "GB", label: "GB（吉字节）", factor: 8e9, group: "byte-decimal", aliases: ["gigabyte"] },
      {
        id: "TB",
        label: "TB（太字节）",
        factor: 8e12,
        group: "byte-decimal",
        display: "Tb",
        aliases: ["terabyte"],
      },
      { id: "KiB", label: "KiB（1024 字节）", factor: 8 * 1024, group: "byte-binary", aliases: ["kibibyte"] },
      {
        id: "MiB",
        label: "MiB（1024 KiB）",
        factor: 8 * 1024 * 1024,
        group: "byte-binary",
        aliases: ["mebibyte"],
      },
      {
        id: "GiB",
        label: "GiB（1024 MiB）",
        factor: 8 * 1024 * 1024 * 1024,
        group: "byte-binary",
        aliases: ["gibibyte"],
      },
    ],
  },
  {
    id: "time-interval",
    label: "时间间隔",
    units: [
      { id: "ns", label: "纳秒（ns）", factor: 1e-9, aliases: ["nanosecond", "纳秒"] },
      { id: "us", label: "微秒（μs）", factor: 1e-6, aliases: ["microsecond", "微秒"] },
      { id: "ms", label: "毫秒（ms）", factor: 1e-3, aliases: ["millisecond", "毫秒"] },
      { id: "s", label: "秒（s）", factor: 1, aliases: ["sec", "second", "秒"] },
      { id: "min", label: "分（min）", factor: 60, aliases: ["minute", "分钟", "分"] },
      { id: "h", label: "时（h）", factor: 3600, aliases: ["hour", "小时", "时"] },
      { id: "d", label: "天（d）", factor: 86400, aliases: ["day", "天"] },
      { id: "week", label: "周（week）", factor: 604800, aliases: ["w", "周"] },
    ],
  },
  {
    id: "time-duration",
    label: "时间戳",
    units: [
      { id: "s", label: "秒（s）", factor: 1, aliases: ["sec", "second", "秒"] },
      { id: "ms", label: "毫秒（ms）", factor: 1e-3, aliases: ["millisecond", "毫秒"] },
      { id: "us", label: "微秒（μs）", factor: 1e-6, aliases: ["microsecond", "微秒"] },
      { id: "ns", label: "纳秒（ns）", factor: 1e-9, aliases: ["nanosecond", "纳秒"] },
    ],
  },
  {
    id: "flow",
    label: "流量",
    units: [
      { id: "B/s", label: "B/s（字节每秒）", factor: 1, aliases: ["byte/s", "bytes/s", "Bps"] },
      { id: "KB/s", label: "KB/s（千字节每秒）", factor: 1e3, aliases: ["kB/s"] },
      { id: "MB/s", label: "MB/s（兆字节每秒）", factor: 1e6, aliases: ["mB/s"] },
      { id: "GB/s", label: "GB/s（吉字节每秒）", factor: 1e9, aliases: ["gB/s"] },
      { id: "TB/s", label: "TB/s（太字节每秒）", factor: 1e12, aliases: ["tB/s"] },
    ],
  },
  {
    id: "bandwidth",
    label: "带宽",
    units: [
      { id: "bps", label: "bps（比特每秒）", factor: 1, aliases: ["bit/s", "bits/s"] },
      { id: "Kbps", label: "Kbps（千比特每秒）", factor: 1e3 },
      { id: "Mbps", label: "Mbps（兆比特每秒）", factor: 1e6 },
      { id: "Gbps", label: "Gbps（吉比特每秒）", factor: 1e9 },
      { id: "Tbps", label: "Tbps（太比特每秒）", factor: 1e12 },
    ],
  },
  {
    id: "percent",
    label: "百分比",
    units: [
      { id: "ratio", label: "比例值（1 = 100%）", factor: 1, aliases: ["比例", "ratio"] },
      { id: "%", label: "百分比（%）", factor: 0.01, aliases: ["percent", "pct", "百分比"] },
      { id: "permille", label: "千分比（‰）", factor: 0.001, aliases: ["‰", "千分比"] },
      { id: "ppm", label: "百万分比（ppm）", factor: 0.000001 },
      { id: "bp", label: "基点（bp）", factor: 0.0001, aliases: ["bpspread", "basispoint", "基点"] },
    ],
  },
  {
    id: "cny",
    label: "人民币",
    units: [
      { id: "li", label: "厘", factor: 0.001, aliases: ["厘"] },
      { id: "fen", label: "分", factor: 0.01, aliases: ["分"] },
      { id: "jiao", label: "角", factor: 0.1, aliases: ["角"] },
      { id: "yuan", label: "元", factor: 1, aliases: ["rmb", "cny", "元"] },
      { id: "wanyuan", label: "万元", factor: 10000, aliases: ["万元"] },
      { id: "yi", label: "亿元", factor: 100000000, aliases: ["亿元"] },
    ],
  },
  {
    id: "currency",
    label: "货币",
    note: "仅支持同币种单位换算，不做实时汇率换算。",
    units: [
      { id: "usd-cent", label: "美元分（cent）", factor: 0.01, family: "USD", aliases: ["cent"] },
      { id: "usd", label: "美元（USD）", factor: 1, family: "USD" },
      { id: "eur-cent", label: "欧分（euro cent）", factor: 0.01, family: "EUR" },
      { id: "eur", label: "欧元（EUR）", factor: 1, family: "EUR" },
      { id: "gbp-penny", label: "便士（penny）", factor: 0.01, family: "GBP", aliases: ["penny"] },
      { id: "gbp", label: "英镑（GBP）", factor: 1, family: "GBP" },
      { id: "jpy", label: "日元（JPY）", factor: 1, family: "JPY" },
      { id: "jpy-100", label: "百日元", factor: 100, family: "JPY" },
    ],
  },
];

function normalizeToken(token) {
  return String(token || "")
    .trim()
    .replace(/µ/g, "u")
    .replace(/μ/g, "u")
    .toLowerCase();
}

function formatValue(value, options = {}) {
  const { maxFractionDigits = 15, useGrouping = false } = options;
  if (!Number.isFinite(value)) return "--";
  const abs = Math.abs(value);
  if (abs === 0) return "0";
  if (abs >= 1e21 || abs < 1e-12) {
    return value.toExponential(12).replace(/\.0+e/, "e").replace(/(\.\d*?)0+e/, "$1e");
  }

  const text = value.toLocaleString("en-US", {
    maximumFractionDigits: maxFractionDigits,
    useGrouping,
  });

  return text
    .replace(/\.(\d*?[1-9])0+$/, ".$1")
    .replace(/\.0+$/, "")
    .replace(/^-0$/, "0");
}

function getUnitSymbol(unit) {
  return unit?.display || unit?.id || "";
}

function getCategoryById(categoryId) {
  return CATEGORY_DEFS.find((item) => item.id === categoryId) || CATEGORY_DEFS[0];
}

function getSelectedCategory() {
  return getCategoryById(categorySelect.value);
}

function renderCategoryOptions() {
  categorySelect.innerHTML = CATEGORY_DEFS.map(
    (item) => `<option value="${item.id}">${item.label}</option>`
  ).join("");
}

function renderUnitOptions() {
  const category = getSelectedCategory();
  const options = category.units
    .map((unit) => `<option value="${unit.id}">${unit.label}</option>`)
    .join("");

  fromUnitSelect.innerHTML = options;
  toUnitSelect.innerHTML = options;

  if (category.units.length > 1) {
    fromUnitSelect.value = category.units[0].id;
    toUnitSelect.value = category.units[1].id;
  } else {
    fromUnitSelect.value = category.units[0].id;
    toUnitSelect.value = category.units[0].id;
  }

  clearError(category.note || "输入数值后会自动换算，也可点击“开始换算”。");
}

function findUnit(category, unitId) {
  return category.units.find((unit) => unit.id === unitId) || null;
}

function findUnitIdByToken(category, rawToken, preferredGroup) {
  const token = String(rawToken || "").trim();
  if (!token) return null;

  const exactId = category.units.find((unit) => unit.id === token);
  if (exactId) return exactId.id;

  for (const unit of category.units) {
    if ((unit.aliases || []).includes(token)) {
      return unit.id;
    }
  }

  const normalizedToken = normalizeToken(token);
  const candidates = category.units.filter((unit) => {
    if (normalizeToken(unit.id) === normalizedToken) return true;
    return (unit.aliases || []).some((alias) => normalizeToken(alias) === normalizedToken);
  });

  if (candidates.length === 1) {
    return candidates[0].id;
  }

  if (candidates.length > 1 && preferredGroup) {
    const grouped = candidates.find((candidate) => candidate.group === preferredGroup);
    if (grouped) return grouped.id;
  }

  return candidates[0]?.id || null;
}

function parseInput(raw, category, preferredGroup) {
  const text = String(raw || "").trim();
  if (!text) {
    return { value: null, matchedUnitId: null, rawToken: "" };
  }

  const compact = text.replace(/,/g, "");
  const match = compact.match(/^([+-]?(?:\d+(?:\.\d+)?|\.\d+)(?:e[+-]?\d+)?)\s*([a-zA-Z%/_\-.µμ‰\u4e00-\u9fa5]*)$/);
  if (!match) {
    return { value: null, matchedUnitId: null, rawToken: "" };
  }

  const value = Number(match[1]);
  if (!Number.isFinite(value)) {
    return { value: null, matchedUnitId: null, rawToken: "" };
  }

  const rawToken = (match[2] || "").trim();
  if (!rawToken) {
    return { value, matchedUnitId: null, rawToken: "" };
  }

  return {
    value,
    matchedUnitId: findUnitIdByToken(category, rawToken, preferredGroup),
    rawToken,
  };
}

function setError(message) {
  hintText.textContent = message;
  hintText.classList.add("error");
}

function clearError(message) {
  hintText.textContent = message;
  hintText.classList.remove("error");
}

function getSmartCandidates(category, fromUnit) {
  if (!fromUnit) return category.units;

  if (category.id === "data-size" && fromUnit.group) {
    const groupUnits = category.units.filter((unit) => unit.group === fromUnit.group);
    if (groupUnits.length) return groupUnits;
  }

  if (category.id === "currency" && fromUnit.family) {
    const familyUnits = category.units.filter((unit) => unit.family === fromUnit.family);
    if (familyUnits.length) return familyUnits;
  }

  return category.units;
}

function chooseBestUnit(baseValue, candidates, fallbackUnit) {
  if (!Array.isArray(candidates) || candidates.length === 0) {
    return fallbackUnit || null;
  }

  const sorted = [...candidates].sort((a, b) => a.factor - b.factor);
  const absBase = Math.abs(baseValue);

  if (absBase === 0) {
    if (fallbackUnit && sorted.some((unit) => unit.id === fallbackUnit.id)) {
      return fallbackUnit;
    }
    return sorted[0];
  }

  let best = sorted[0];
  for (const unit of sorted) {
    if (absBase >= unit.factor) {
      best = unit;
    }
  }
  return best;
}

function buildSmartDisplay(category, baseValue, fromUnit) {
  const candidates = getSmartCandidates(category, fromUnit);
  const bestUnit = chooseBestUnit(baseValue, candidates, fromUnit);
  if (!bestUnit) return null;

  const value = baseValue / bestUnit.factor;
  return {
    value,
    unit: bestUnit,
    text: `${formatValue(value)} ${getUnitSymbol(bestUnit)}`,
  };
}

function calculate() {
  const category = getSelectedCategory();
  const currentFromUnit = findUnit(category, fromUnitSelect.value);
  const parsed = parseInput(valueInput.value, category, currentFromUnit?.group);

  if (parsed.value === null) {
    lastDisplayedResult = "";
    resultText.textContent = "--";
    formulaText.textContent = "请输入有效数字后再换算。";
    smartResultText.textContent = "智能展示：--";
    setError("请输入有效数字，例如 1024、0.75、-5.2 或 28717740816392 byte。");
    return null;
  }

  if (parsed.matchedUnitId && parsed.matchedUnitId !== fromUnitSelect.value) {
    fromUnitSelect.value = parsed.matchedUnitId;
  }

  const fromUnit = findUnit(category, fromUnitSelect.value);
  const toUnit = findUnit(category, toUnitSelect.value);

  if (!fromUnit || !toUnit) {
    lastDisplayedResult = "";
    setError("单位选择无效，请重新选择分类。");
    return null;
  }

  if (category.id === "currency" && fromUnit.family !== toUnit.family) {
    lastDisplayedResult = "";
    resultText.textContent = "--";
    formulaText.textContent = "货币分类不做汇率换算，仅支持同币种单位换算。";
    smartResultText.textContent = "智能展示：--";
    setError("请选择同币种的源单位和目标单位。");
    return null;
  }

  const baseValue = parsed.value * fromUnit.factor;
  const converted = baseValue / toUnit.factor;
  const convertedText = `${formatValue(converted)} ${getUnitSymbol(toUnit)}`;

  resultText.textContent = convertedText;
  formulaText.textContent = `${formatValue(parsed.value)} ${getUnitSymbol(fromUnit)} = ${convertedText}`;

  const smartDisplay = buildSmartDisplay(category, baseValue, fromUnit);
  smartResultText.textContent = smartDisplay ? `智能展示：${smartDisplay.text}` : "智能展示：--";

  lastDisplayedResult = convertedText;

  if (parsed.rawToken && !parsed.matchedUnitId) {
    clearError(`未识别输入中的单位“${parsed.rawToken}”，已按当前源单位计算。`);
  } else {
    clearError(category.note || "输入数值后会自动换算，也可点击“开始换算”。");
  }

  return converted;
}

async function copyResult() {
  if (!lastDisplayedResult) {
    const calculated = calculate();
    if (calculated === null) return;
  }

  try {
    await navigator.clipboard.writeText(lastDisplayedResult);
    clearError("结果已复制到剪贴板。");
  } catch (error) {
    setError("复制失败，请手动复制结果。");
  }
}

renderCategoryOptions();
renderUnitOptions();

categorySelect.addEventListener("change", () => {
  renderUnitOptions();
  calculate();
});

[fromUnitSelect, toUnitSelect].forEach((element) => {
  element.addEventListener("change", calculate);
});

valueInput.addEventListener("input", calculate);
convertBtn.addEventListener("click", calculate);

swapBtn.addEventListener("click", () => {
  const oldFrom = fromUnitSelect.value;
  fromUnitSelect.value = toUnitSelect.value;
  toUnitSelect.value = oldFrom;
  calculate();
});

copyResultBtn.addEventListener("click", copyResult);

valueInput.value = "1024";
calculate();
