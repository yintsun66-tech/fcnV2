// Draw the existing export table directly: no iframe, DOM screenshot, or external assets.
export const TABLE_PIXEL_LIMIT = 4_000_000;
const FONT = 'Arial, "Microsoft JhengHei", "Noto Sans TC", sans-serif';
const PAD = 24;
// The sheet is read scaled to a phone's width, where 18px text came out too small, so the type was
// raised on 2026-10-22. The quoted value of the requested term -- the line under the issuer in each
// rank cell -- is the figure the reader looks for: it is the largest, bold and black.
const TEXT = { body: 22, header: 20, value: 28, title: 36, meta: 20, foot: 18 };
const LINE = { body: 30, header: 26, value: 36, meta: 28, foot: 26 };

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

// Breaks at spaces where it can, so a header such as "Guaranteed Periods (m)" wraps by word; a word
// wider than the column (a long ticker or reference) still breaks by character without clipping.
export function wrapTableText(value, width, measure) {
  return String(value ?? "—").split(/\r?\n/u).flatMap(paragraph => {
    const lines = [];
    let line = "";
    for (const word of paragraph.match(/\S+\s*|\s+/gu) ?? [""]) {
      if (line && measure((line + word).trimEnd()) > width) { lines.push(line.trimEnd()); line = ""; }
      if (measure(word.trimEnd()) <= width) { line += word; continue; }
      for (const character of word) {
        if (line && measure(line + character) > width) { lines.push(line.trimEnd()); line = ""; }
        line += character;
      }
    }
    lines.push(line.trimEnd());
    return lines;
  });
}

const lineHeight = line => line.value ? LINE.value : line.header ? LINE.header : LINE.body;
const cellHeight = lines => lines.reduce((sum, line) => sum + lineHeight(line), 0) + 20;

// measure(text, fontSize) returns the bold width of text at that size.
export function layoutQuoteTable(model, measure) {
  const count = model.headers?.length;
  if (!count || count > 25 || !Array.isArray(model.rows) || !model.rows.length || model.rows.length > 20
      || model.rows.some(row => row.length !== count)) throw new Error("表格資料格式錯誤。");
  // In a rank column every paragraph after the issuer is the quoted value.
  const paragraphs = (cell, i) => String(cell.text).split("\n")
    .map((text, n) => ({ text, value: Boolean(model.headers[i].rank) && n > 0 }));
  const size = line => line.header ? TEXT.header : line.value ? TEXT.value : TEXT.body;
  // A header only claims the width of its longest word and wraps below it; sizing columns to whole
  // labels such as "Coupon p.a. (%)" made the sheet wide, and so its text small once scaled to a screen.
  const widths = model.headers.map((header, i) => Math.min(header.rank ? 240 : 220,
    Math.max(i === 0 ? 62 : header.rank ? 140 : 88,
      ...String(header.text).split(/\s+/u).map(word => measure(word, TEXT.header) + 24),
      ...model.rows.flatMap(row => paragraphs(row[i], i).map(line => measure(line.text, size(line)) + 24)))));
  const width = widths.reduce((sum, n) => sum + n, PAD * 2);
  const wrapLines = (lines, i) => lines.flatMap(line =>
    wrapTableText(line.text, widths[i] - 24, text => measure(text, size(line))).map(text => ({ ...line, text })));
  const wrapRow = cells => cells.map((cell, i) => ({ ...cell, lines: wrapLines(paragraphs(cell, i), i) }));
  const headers = model.headers.map((cell, i) => ({ ...cell, lines: wrapLines([{ text: cell.text, header: true }], i) }));
  const headerHeight = Math.max(...headers.map(cell => cellHeight(cell.lines)));
  const meta = wrapTableText(model.meta, width - PAD * 2, text => measure(text, TEXT.meta));
  const top = 84 + meta.length * LINE.meta;
  const footer = wrapTableText(model.footer, width - PAD * 2, text => measure(text, TEXT.foot));
  const bottom = 56 + footer.length * LINE.foot;
  const pages = [];
  let rows = [], used = top + headerHeight + bottom;
  for (const source of model.rows) {
    const cells = wrapRow(source);
    const height = Math.max(...cells.map(cell => cellHeight(cell.lines)));
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
  const measure = (text, fontSize = TEXT.body) => {
    measuring.font = `700 ${fontSize}px ${FONT}`;
    return measuring.measureText(text).width;
  };
  let layout;
  try { layout = layoutQuoteTable(model, measure); }
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
      const text = (value, x, y, color = "#1c1c1e", bold = false, fontSize = TEXT.body) => {
        ctx.font = `${bold ? 700 : 400} ${fontSize}px ${FONT}`; ctx.fillStyle = color; ctx.fillText(value, x, y);
      };
      text(model.title, PAD, 52, "#2a6f78", true, TEXT.title);
      layout.meta.forEach((line, i) => text(line, PAD, 92 + i * LINE.meta, "#55555c", false, TEXT.meta));
      let y = layout.top;
      const drawRow = (cells, height, header = false, rowIndex = 0) => {
        let x = PAD;
        cells.forEach((cell, i) => {
          ctx.fillStyle = header ? cell.rank ? "#0a7c8a" : "#2a6f78" : rowIndex % 2 ? "#f2f7f8" : "#ffffff";
          ctx.fillRect(x, y, layout.widths[i], height);
          ctx.strokeStyle = "#dcdcdd"; ctx.lineWidth = 1; ctx.strokeRect(x, y, layout.widths[i], height);
          let lineTop = y + 10;
          for (const line of cell.lines) {
            const fontSize = header ? TEXT.header : line.value ? TEXT.value : TEXT.body;
            const color = header ? "#ffffff" : line.value ? "#000000" : cell.target ? "#06626e" : "#1c1c1e";
            // Bold: headers, the trade code, and in a rank cell both the issuer and its quoted value.
            const bold = header || i === 0 || Boolean(layout.headers[i].rank);
            text(line.text, x + 12, lineTop + (lineHeight(line) + fontSize * 0.7) / 2, color, bold, fontSize);
            lineTop += lineHeight(line);
          }
          x += layout.widths[i];
        });
        y += height;
      };
      drawRow(layout.headers, layout.headerHeight, true);
      page.rows.forEach((row, index) => drawRow(row.cells, row.height, false, index));
      layout.footer.forEach((line, i) => text(line, PAD, y + 34 + i * LINE.foot, "#55555c", false, TEXT.foot));
      text(`第 ${pageIndex + 1} / ${layout.pages.length} 頁`, PAD, page.height - 16, "#55555c", false, TEXT.foot);
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
