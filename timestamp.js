/* global dayjs */
dayjs.extend(dayjs_plugin_utc);
dayjs.extend(dayjs_plugin_timezone);

const unitOrder = ["s", "ms", "us", "ns"];
const unitLabels = {
  s: "秒",
  ms: "毫秒",
  us: "微秒",
  ns: "纳秒",
};

const toMs = (valueStr, unit) => {
  if (!valueStr) return null;
  try {
    if (unit === "ns") {
      const ns = BigInt(valueStr);
      return Number(ns / 1_000_000n);
    }
    if (unit === "us") {
      const us = BigInt(valueStr);
      return Number(us / 1_000n);
    }
    const num = Number(valueStr);
    if (Number.isNaN(num)) return null;
    if (unit === "s") return num * 1000;
    return num;
  } catch {
    return null;
  }
};

const fromMs = (ms, unit) => {
  if (unit === "ns") return (BigInt(Math.trunc(ms)) * 1_000_000n).toString();
  if (unit === "us") return (BigInt(Math.trunc(ms)) * 1_000n).toString();
  if (unit === "s") return (ms / 1000).toFixed(3).replace(/\.?0+$/, "");
  return Math.trunc(ms).toString();
};

const formatDate = (ms, tz) => {
  if (!Number.isFinite(ms)) return "无效时间戳";
  return dayjs(ms).tz(tz).format("YYYY-MM-DD HH:mm:ss");
};

const currentTsEl = document.getElementById("currentTs");
const currentUnitLabelEl = document.getElementById("currentUnitLabel");
const toggleUnitBtn = document.getElementById("toggleUnitBtn");
const copyNowBtn = document.getElementById("copyNowBtn");
const toggleRunBtn = document.getElementById("toggleRunBtn");

const tsInput = document.getElementById("tsInput");
const tsUnitSelect = document.getElementById("tsUnitSelect");
const tzSelect = document.getElementById("tzSelect");
const tsToDateBtn = document.getElementById("tsToDateBtn");
const dateOutput = document.getElementById("dateOutput");
const copyDateBtn = document.getElementById("copyDateBtn");

const dateInput = document.getElementById("dateInput");
const tzSelect2 = document.getElementById("tzSelect2");
const tsOutput = document.getElementById("tsOutput");
const tsOutUnitSelect = document.getElementById("tsOutUnitSelect");
const dateToTsBtn = document.getElementById("dateToTsBtn");
const copyTsBtn = document.getElementById("copyTsBtn");

let currentUnitIndex = 0; // default seconds
let ticking = true;
let timerId = null;

const convertTsToDate = () => {
  const ms = toMs(tsInput.value.trim(), tsUnitSelect.value);
  if (ms === null) {
    dateOutput.value = "无效的时间戳";
    return;
  }
  dateOutput.value = formatDate(ms, tzSelect.value);
};

const convertDateToTs = () => {
  const text = dateInput.value.trim();
  if (!text) {
    tsOutput.value = "请输入日期时间";
    return;
  }
  const zoned = dayjs.tz(text, tzSelect2.value);
  if (!zoned.isValid()) {
    tsOutput.value = "无效的日期时间";
    return;
  }
  const ms = zoned.valueOf();
  tsOutput.value = fromMs(ms, tsOutUnitSelect.value);
};

const setDefaults = () => {
  const now = dayjs();
  tsUnitSelect.value = "s";
  tzSelect.value = "Asia/Shanghai";
  tzSelect2.value = "Asia/Shanghai";
  tsInput.value = Math.floor(now.valueOf() / 1000).toString();
  dateInput.value = now.tz(tzSelect2.value).format("YYYY-MM-DD HH:mm:ss");
  convertTsToDate();
  convertDateToTs();
};

const unitLabel = () => unitLabels[unitOrder[currentUnitIndex]];

const renderCurrent = () => {
  const unit = unitOrder[currentUnitIndex];
  const nowMs = Date.now();
  let display;
  if (unit === "ns") {
    display = (BigInt(nowMs) * 1_000_000n).toString();
  } else if (unit === "us") {
    display = (BigInt(nowMs) * 1_000n).toString();
  } else if (unit === "s") {
    display = Math.floor(nowMs / 1000).toString();
  } else {
    display = nowMs.toString();
  }
  currentTsEl.textContent = display;
  currentUnitLabelEl.textContent = unitLabels[unit];
};

const startTick = () => {
  if (timerId) clearInterval(timerId);
  timerId = setInterval(renderCurrent, 200);
  ticking = true;
  toggleRunBtn.textContent = "停止";
  toggleRunBtn.classList.add("danger");
};

const stopTick = () => {
  if (timerId) clearInterval(timerId);
  timerId = null;
  ticking = false;
  toggleRunBtn.textContent = "启动";
  toggleRunBtn.classList.remove("danger");
};

toggleUnitBtn.addEventListener("click", () => {
  currentUnitIndex = (currentUnitIndex + 1) % unitOrder.length;
  renderCurrent();
});

copyNowBtn.addEventListener("click", async () => {
  try {
    await navigator.clipboard.writeText(currentTsEl.textContent);
    copyNowBtn.textContent = "已复制";
    setTimeout(() => (copyNowBtn.textContent = "复制"), 1200);
  } catch {
    copyNowBtn.textContent = "复制失败";
  }
});

toggleRunBtn.addEventListener("click", () => {
  if (ticking) {
    stopTick();
  } else {
    startTick();
  }
});

tsToDateBtn.addEventListener("click", () => {
  convertTsToDate();
});

copyDateBtn.addEventListener("click", async () => {
  if (!dateOutput.value) return;
  try {
    await navigator.clipboard.writeText(dateOutput.value);
    copyDateBtn.textContent = "已复制";
    setTimeout(() => (copyDateBtn.textContent = "复制"), 1200);
  } catch {
    copyDateBtn.textContent = "复制失败";
  }
});

dateToTsBtn.addEventListener("click", () => {
  convertDateToTs();
});

copyTsBtn.addEventListener("click", async () => {
  if (!tsOutput.value) return;
  try {
    await navigator.clipboard.writeText(tsOutput.value);
    copyTsBtn.textContent = "已复制";
    setTimeout(() => (copyTsBtn.textContent = "复制"), 1200);
  } catch {
    copyTsBtn.textContent = "复制失败";
  }
});

renderCurrent();
startTick();
setDefaults();
