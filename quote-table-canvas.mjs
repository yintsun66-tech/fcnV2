// Draw the existing export table directly: no iframe, DOM screenshot, or external assets.
export const TABLE_PIXEL_LIMIT = 4_000_000;
const FONT = 'Arial, "Microsoft JhengHei", "Noto Sans TC", sans-serif';
const PAD = 24;
const LINE = 24;

// Reads text the way the on-screen table lays it out. CSS is invisible here, so any element that the
// stylesheet displays as a block must be named: a rank cell is two spans, issuer and value, that the
// screen stacks with display:block, and without the break they ran together as "JPM12.85%".
export function cellText(node) {
  if (node.nodeType === 3) return node.textContent;
  if (node.nodeName === "BR") return "\n";
  const value = [...node.childNodes].map(cellText).join("");
  const block = ["DIV", "STRONG", "P"].includes(node.nodeName) || node.classList?.contains("rank-issuer");
  return block ? `${value}\n` : value;
}

export function tableModelFromDocument(html) {
  const doc = new DOMParser().parseFromString(html, "text/html");
  const table = doc.querySelector(".ranking-table");
  if (!table) throw new Error("找不到可產圖的比價表格。");
  const readCell = cell => ({ text: cellText(cell).trim(), target: cell.classList.contains("term-target") });
  return {
    title: doc.querySelector(".sheet-head h1")?.textContent || "比價結果總表",
    meta: cellText(doc.querySelector(".sheet-meta") || doc.createElement("div")).trim(),
    footer: doc.querySelector(".sheet-foot")?.textContent || "",
    headers: [...table.querySelectorAll("thead th")].map(cell => ({
      ...readCell(cell), rank: cell.classList.contains("rank-col")
    })),
    rows: [...table.querySelectorAll("tbody tr")].map(row => [...row.children].map(readCell))
  };
}

// Character-aware wrapping also preserves long ticker/reference tokens without clipping.
export function wrapTableText(value, width, measure) {
  return String(value ?? "—").split(/\r?\n/u).flatMap(paragraph => {
    const lines = [];
    let line = "";
    for (const character of paragraph) {
      if (line && measure(line + character) > width) { lines.push(line.trimEnd()); line = ""; }
      line += character;
    }
    lines.push(line.trimEnd());
    return lines;
  });
}

export function layoutQuoteTable(model, measure) {
  const count = model.headers?.length;
  if (!count || count > 25 || !Array.isArray(model.rows) || !model.rows.length || model.rows.length > 20
      || model.rows.some(row => row.length !== count)) throw new Error("表格資料格式錯誤。");
  const widths = model.headers.map((header, i) => Math.min(header.rank ? 170 : 185,
    Math.max(i === 0 ? 62 : header.rank ? 140 : 88,
      ...[header, ...model.rows.map(row => row[i])].flatMap(cell => String(cell.text).split("\n").map(text => measure(text) + 24)))));
  const width = widths.reduce((sum, n) => sum + n, PAD * 2);
  const wrapRow = cells => cells.map((cell, i) => ({ ...cell, lines: wrapTableText(cell.text, widths[i] - 24, measure) }));
  const headers = wrapRow(model.headers);
  const headerHeight = Math.max(...headers.map(cell => cell.lines.length)) * LINE + 20;
  const meta = wrapTableText(model.meta, width - PAD * 2, measure);
  const top = 80 + meta.length * LINE;
  const footer = wrapTableText(model.footer, width - PAD * 2, measure);
  const bottom = 48 + footer.length * LINE;
  const pages = [];
  let rows = [], used = top + headerHeight + bottom;
  for (const source of model.rows) {
    const cells = wrapRow(source);
    const height = Math.max(...cells.map(cell => cell.lines.length)) * LINE + 20;
    if (top + headerHeight + bottom + height > 1800) throw new Error("單筆交易文字過長，無法產出可讀表格圖。");
    if (rows.length && used + height > 1800) { pages.push({ rows, height: used }); rows = []; used = top + headerHeight + bottom; }
    rows.push({ cells, height }); used += height;
  }
  if (rows.length) pages.push({ rows, height: used });
  return { width, widths, headers, headerHeight, meta, footer, top, pages };
}

export function tableCanvasDimensions(width, height) {
  const scale = Math.min(1.5, 4096 / width, 4096 / height, Math.sqrt(TABLE_PIXEL_LIMIT / (width * height)));
  return { scale, width: Math.floor(width * scale), height: Math.floor(height * scale) };
}

export async function renderQuoteTable(model, { createCanvas = () => document.createElement("canvas"), encodeTimeoutMs = 8000 } = {}) {
  const probe = createCanvas();
  const measuring = probe.getContext("2d");
  if (!measuring) throw new Error("瀏覽器無法建立表格畫布。");
  measuring.font = `700 18px ${FONT}`;
  let layout;
  try { layout = layoutQuoteTable(model, text => measuring.measureText(text).width); }
  finally { probe.width = 0; probe.height = 0; }
  const images = [];
  for (const [pageIndex, page] of layout.pages.entries()) {
    const canvas = createCanvas();
    try {
      const size = tableCanvasDimensions(layout.width, page.height);
      canvas.width = size.width; canvas.height = size.height;
      const ctx = canvas.getContext("2d");
      if (!ctx) throw new Error("瀏覽器無法建立表格畫布。");
      ctx.scale(size.scale, size.scale);
      ctx.fillStyle = "#ffffff"; ctx.fillRect(0, 0, layout.width, page.height);
      const text = (value, x, y, color = "#1c1c1e", bold = false, fontSize = 18) => {
        ctx.font = `${bold ? 700 : 400} ${fontSize}px ${FONT}`; ctx.fillStyle = color; ctx.fillText(value, x, y);
      };
      text(model.title, PAD, 46, "#2a6f78", true, 32);
      layout.meta.forEach((line, i) => text(line, PAD, 77 + i * LINE, "#55555c"));
      let y = layout.top;
      const drawRow = (cells, height, header = false, rowIndex = 0) => {
        let x = PAD;
        cells.forEach((cell, i) => {
          ctx.fillStyle = header ? cell.rank ? "#0a7c8a" : "#2a6f78" : rowIndex % 2 ? "#f2f7f8" : "#ffffff";
          ctx.fillRect(x, y, layout.widths[i], height);
          ctx.strokeStyle = "#dcdcdd"; ctx.lineWidth = 1; ctx.strokeRect(x, y, layout.widths[i], height);
          cell.lines.forEach((line, n) => text(line, x + 12, y + 29 + n * LINE,
            header ? "#ffffff" : cell.target ? "#06626e" : "#1c1c1e", header || i === 0));
          x += layout.widths[i];
        });
        y += height;
      };
      drawRow(layout.headers, layout.headerHeight, true);
      page.rows.forEach((row, index) => drawRow(row.cells, row.height, false, index));
      layout.footer.forEach((line, i) => text(line, PAD, y + 30 + i * LINE, "#55555c", false, 16));
      text(`第 ${pageIndex + 1} / ${layout.pages.length} 頁`, PAD, page.height - 14, "#55555c", false, 16);
      const blob = await new Promise((resolve, reject) => {
        const timer = setTimeout(() => reject(Object.assign(new Error("表格圖轉檔逾時。"), { renderStep: "ENCODE" })), encodeTimeoutMs);
        try { canvas.toBlob(value => { clearTimeout(timer); value ? resolve(value) : reject(new Error("表格圖轉檔失敗。")); }, "image/png"); }
        catch (error) { clearTimeout(timer); reject(error); }
      });
      images.push({ blob, page: pageIndex + 1 });
    } finally { canvas.width = 0; canvas.height = 0; }
  }
  return images;
}
