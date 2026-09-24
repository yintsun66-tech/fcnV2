// One bounded canvas per trade; no hidden iframe, DOM screenshot, remote font or image.
export const CANVAS_PIXEL_LIMIT = 4_000_000;
export function cardCanvasDimensions(scale = 1.5) {
  const width = 720, height = 1280;
  const safeScale = Math.min(1.5, Math.max(1, Number(scale) || 1), Math.sqrt(CANVAS_PIXEL_LIMIT / (width * height)));
  return { width, height, scale: safeScale, pixelWidth: Math.floor(width * safeScale), pixelHeight: Math.floor(height * safeScale) };
}

export function drawQuoteCard(canvas, model, trade) {
  if (model?.version !== 1 || !trade || !Array.isArray(trade.underlyings)) throw new Error("不支援的報價圖資料格式。");
  const size = cardCanvasDimensions();
  canvas.width = size.pixelWidth; canvas.height = size.pixelHeight;
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("瀏覽器無法建立圖片畫布。");
  ctx.scale(size.scale, size.scale);
  const theme = model.theme;
  const text = (value, x, y, fontSize = 26, color = "#153445", weight = 400, maxWidth = 608) => {
    ctx.fillStyle = color;
    ctx.font = `${weight} ${fontSize}px Arial, "Microsoft JhengHei", "Noto Sans TC", sans-serif`;
    ctx.fillText(String(value ?? "—"), x, y, maxWidth);
  };
  const rect = (x, y, w, h, color) => { ctx.fillStyle = color; ctx.fillRect(x, y, w, h); };
  const line = y => rect(18, y, 684, 1, "#bdd7de");
  const pct = value => typeof value === "number" && Number.isFinite(value) ? `${Number(value.toFixed(4))}%` : "—";
  const months = value => typeof value === "number" && Number.isFinite(value) ? `${value} 個月` : "—";
  const pair = (y, leftLabel, leftValue, rightLabel, rightValue, highlight = false) => {
    text(leftLabel, 50, y, 26); text(rightLabel, 392, y, 26, "#286174", 400, 278);
    text(leftValue, 50, y + 64, 40, "#153445", 700, 278);
    text(rightValue, 392, y + 64, 40, highlight ? theme.primary : "#153445", 700, 278);
  };
  rect(0, 0, 720, 1280, "#edf5f6"); rect(18, 18, 684, 1244, "#fff");
  const gradient = ctx.createLinearGradient(18, 18, 702, 218);
  gradient.addColorStop(0, theme.primary); gradient.addColorStop(1, theme.accent);
  rect(18, 18, 684, 200, gradient);
  text(`#${trade.sequence}`, 50, 62, 27, "#fff", 700);
  text(`${trade.product} 報價`, 50, 126, 48, "#fff", 700, 420);
  text(trade.issuer, 500, 126, 30, "#fff", 700, 170);
  text(`（${trade.currency} 本金）`, 50, 181, 29, "#fff");
  rect(18, 218, 684, 174, theme.soft);
  pair(263, "期間", months(trade.tenorMonths), "年化收益率", pct(trade.couponPaPct), true);
  line(392); text("連結標的", 50, 438, 26, "#286174");
  let x = 50, y = 468;
  for (const underlying of trade.underlyings) {
    const label = String(underlying).trim().split(/\s+/u)[0];
    ctx.font = '700 32px Arial, "Microsoft JhengHei", sans-serif';
    const width = Math.min(608, ctx.measureText(label).width + 32);
    if (x + width > 670) { x = 50; y += 66; }
    rect(x, y, width, 54, "#e7f2f4"); text(label, x + 16, y + 38, 32, "#153f54", 700, width - 32);
    x += width + 16;
  }
  if (y > 534) throw new Error("連結標的文字過長，請使用伺服器產圖。");
  line(606); pair(654, "執行價", pct(trade.strikePct), "觸及生效價 KI", pct(trade.kiBarrierPct));
  text(trade.barrierType || "—", 392, 766, 26, theme.primary, 400, 278);
  line(806); pair(854, "保證配息期間", months(trade.guaranteedPeriodsMonths), "提前出場價 KO", pct(trade.koBarrierPct));
  text(trade.koType || "—", 392, 966, 26, theme.primary, 400, 278);
  if (["DAC", "DRA", "WRA"].includes(trade.product) && Number.isFinite(trade.guaranteedPeriodsMonths)) {
    text(`*DAC/DRA第${trade.guaranteedPeriodsMonths + 1}個月起為浮動收益`, 50, 1006, 19, "#b45309", 700);
  }
  rect(18, 1034, 684, 228, theme.soft);
  text(`發行機構：${trade.issuerDisplayName}`, 50, 1074, 22);
  text(`報價日期：${trade.tradeDate || "—"}`, 50, 1112, 22);
  text(`RFQ 編號：${model.rfqCode ? `[RFQ:${model.rfqCode}]` : "—"}`, 50, 1170, 19, "#286174", 700);
  if (model.makerEmployeeNumber) text(`製圖行編：${model.makerEmployeeNumber}`, 50, 1225, 19, "#286174", 700);
  return canvas;
}

export async function renderQuoteCards(model, { createCanvas = () => document.createElement("canvas"), encodeTimeoutMs = 8000 } = {}) {
  if (model?.version !== 1 || !Array.isArray(model.trades) || model.trades.length < 1 || model.trades.length > 20) throw new Error("報價圖資料格式錯誤。");
  const images = [];
  for (const trade of model.trades) {
    const canvas = createCanvas();
    try {
      drawQuoteCard(canvas, model, trade);
      const blob = await new Promise((resolve, reject) => {
        const timer = setTimeout(() => reject(Object.assign(new Error("報價圖轉檔逾時。"), { renderStep: "ENCODE" })), encodeTimeoutMs);
        try { canvas.toBlob(value => { clearTimeout(timer); value ? resolve(value) : reject(new Error("報價圖轉檔失敗。")); }, "image/png"); }
        catch (error) { clearTimeout(timer); reject(error); }
      });
      images.push({ blob, tradeCode: trade.tradeCode });
    } finally { canvas.width = 0; canvas.height = 0; }
  }
  return images;
}
