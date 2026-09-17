import { loadHtml2Canvas } from "./html2canvas-loader.mjs?v=render-fix-v1";

const CARD_RENDER_STEP_TIMEOUT_MS = 12_000;
const CARD_RENDER_TOTAL_TIMEOUT_MS = 24_000;
const CARD_FONT_TIMEOUT_MS = 1_500;
const CARD_OUTPUT_CANVAS_PIXELS = 4e6;
const CARD_OUTPUT_MAX_SCALE = 1.5;

function escapeHtml(value) {
  return String(value ?? "").replace(/[&<>"']/g, character => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;"
  })[character]);
}

// Each step carries an ASCII code beside its message. Recording only that a render failed made the
// 12-second hang in the loader take a browser reproduction to find; the code says which step ran
// out of time, and the backend only stores it after checking it against this same set.
const RENDER_STEPS = {
  CARD_FETCH: { code: "CARD_FETCH", label: "取得報價資料" },
  LOADER: { code: "LOADER", label: "載入圖片元件" },
  FRAME: { code: "FRAME", label: "載入" },
  FONTS: { code: "FONTS", label: "字型" },
  DRAW: { code: "DRAW", label: "繪製" },
  ENCODE: { code: "ENCODE", label: "轉檔" },
  SERVER_FALLBACK: { code: "SERVER_FALLBACK", label: "啟動伺服器備援" }
};

function renderError(message, step) {
  return Object.assign(new Error(message), { renderStep: step?.code ?? "UNKNOWN" });
}

function withRenderTimeout(value, step, timeoutMs = CARD_RENDER_STEP_TIMEOUT_MS) {
  let timer;
  return Promise.race([
    Promise.resolve(value).finally(() => clearTimeout(timer)),
    new Promise((_, reject) => {
      timer = setTimeout(() => reject(renderError(`產圖逾時（${step.label}）`, step)), timeoutMs);
    })
  ]);
}

function withRenderDeadline(start, step, deadlineAt, maximumMs = CARD_RENDER_STEP_TIMEOUT_MS) {
  const remainingMs = deadlineAt - Date.now();
  if (remainingMs <= 0) return Promise.reject(renderError(`產圖逾時（${step.label}）`, step));
  return withRenderTimeout(Promise.resolve().then(start), step, Math.min(maximumMs, remainingMs));
}

export function createImageController({
  getRfqId,
  request,
  resetSnapshot,
  scheduleResultRefresh,
  buildTableSheet
}) {
  const progressDialog = document.querySelector("#backendProgress");

  async function requestForRender(path, options, step, deadlineAt) {
    const controller = new AbortController();
    try {
      return await withRenderDeadline(
        () => request(path, { ...options, signal: controller.signal, timeoutMs: CARD_RENDER_STEP_TIMEOUT_MS }),
        step,
        deadlineAt
      );
    } catch (error) {
      if (error?.name === "AbortError") throw renderError(`產圖逾時（${step.label}）`, step);
      throw error;
    } finally {
      controller.abort();
    }
  }

  function showCardImage(blob, filename) {
    const url = URL.createObjectURL(blob);
    progressDialog.querySelector("[data-card-preview] [data-card-close]")?.click();
    const preview = document.createElement("section");
    preview.className = "backend-card-preview";
    preview.dataset.cardPreview = "";
    preview.setAttribute("role", "dialog");
    preview.setAttribute("aria-modal", "true");
    preview.setAttribute("aria-label", "報價圖預覽");
    preview.innerHTML = `<section class="backend-panel">
      <div class="backend-results-heading"><div><p class="eyebrow">QUOTE IMAGE</p><h2>報價圖</h2></div><button type="button" class="secondary" data-card-close>關閉</button></div>
      <p class="backend-archive-note">手機或平板請「長按圖片 → 儲存影像」；電腦可在新頁面檢視，圖片會依螢幕大小縮放。</p>
      <div class="backend-card-preview-frame"><img alt="報價圖" src="${url}"></div>
      <div class="backend-card-preview-actions">
        <a class="artifact-link backend-card-open-link" href="${url}" target="_blank" rel="noopener">在新頁面檢視</a>
        <a class="artifact-link" href="${url}" download="${escapeHtml(filename)}">下載 PNG</a>
      </div>
    </section>`;
    progressDialog.append(preview);
    const onKeydown = event => {
      if (event.key === "Escape") {
        event.preventDefault();
        close();
      }
    };
    const close = () => {
      document.removeEventListener("keydown", onKeydown, true);
      preview.remove();
      URL.revokeObjectURL(url);
    };
    preview.querySelector("[data-card-close]").addEventListener("click", close);
    document.addEventListener("keydown", onKeydown, true);
    preview.querySelector("[data-card-close]").focus();
  }

  // Rasterizing inside a sandboxed iframe is what keeps an export light-themed: the document is
  // self-contained, so neither styles-dark.css nor the theme picker can reach it. `autoWidth` is for
  // the row-view sheet, whose width depends on how many rank columns the user kept.
  async function rasterizeDocument(html, width, deadlineAt, html2canvas, { autoWidth = false } = {}) {
    const frame = document.createElement("iframe");
    frame.setAttribute("sandbox", "allow-same-origin");
    frame.setAttribute("aria-hidden", "true");
    frame.setAttribute("tabindex", "-1");
    frame.style.cssText = `position:fixed;left:0;top:0;width:${width}px;height:10px;border:0;opacity:0;pointer-events:none;z-index:0`;
    document.body.append(frame);
    try {
      await withRenderDeadline(() => new Promise((resolve, reject) => {
        frame.addEventListener("load", resolve, { once: true });
        frame.addEventListener("error", () => reject(new Error("報價圖載入失敗。")), { once: true });
        frame.srcdoc = html;
      }), RENDER_STEPS.FRAME, deadlineAt);
      const frameDocument = frame.contentDocument;
      if (!frameDocument?.body) throw renderError("無法讀取報價圖內容。", RENDER_STEPS.FRAME);
      if (frameDocument.fonts?.ready) {
        try {
          await withRenderDeadline(() => frameDocument.fonts.ready, RENDER_STEPS.FONTS, deadlineAt, CARD_FONT_TIMEOUT_MS);
        } catch {
          // Rendering with the resolved fallback font is preferable to failing the export.
        }
      }
      // The sheet keeps its cells on one line, so the content already overflows the narrow starting
      // frame and scrollWidth reports the true width before the frame is widened to match.
      const renderWidth = autoWidth
        ? Math.max(width, Math.ceil(Math.max(frameDocument.body.scrollWidth, frameDocument.documentElement.scrollWidth)))
        : width;
      if (renderWidth !== width) frame.style.width = `${renderWidth}px`;
      const height = Math.max(frameDocument.body.scrollHeight, frameDocument.documentElement.scrollHeight);
      if (!height) throw renderError("報價圖版面尚未完成，請再試一次。", RENDER_STEPS.DRAW);
      frame.style.height = `${height}px`;
      const scale = Math.max(
        0.5,
        Math.min(CARD_OUTPUT_MAX_SCALE, Math.sqrt(CARD_OUTPUT_CANVAS_PIXELS / (renderWidth * height)))
      );
      const canvas = await withRenderDeadline(() => html2canvas(frameDocument.body, {
        backgroundColor: null,
        scale,
        logging: false,
        useCORS: false,
        width: renderWidth,
        height,
        windowWidth: renderWidth,
        windowHeight: height
      }), RENDER_STEPS.DRAW, deadlineAt);
      const blob = await withRenderDeadline(
        () => new Promise(resolve => canvas.toBlob(resolve, "image/png")),
        RENDER_STEPS.ENCODE,
        deadlineAt
      );
      if (!blob) throw renderError("報價圖轉檔失敗。", RENDER_STEPS.ENCODE);
      return blob;
    } finally {
      frame.remove();
    }
  }

  async function renderCardLocally(rfqId, tradeCode, quoteId) {
    const deadlineAt = Date.now() + CARD_RENDER_TOTAL_TIMEOUT_MS;
    const [{ card }, html2canvas] = await Promise.all([
      requestForRender(
        `/rfqs/${rfqId}/trades/${encodeURIComponent(tradeCode)}/quotes/${encodeURIComponent(quoteId)}/card`,
        {},
        RENDER_STEPS.CARD_FETCH,
        deadlineAt
      ),
      withRenderDeadline(() => loadHtml2Canvas(), RENDER_STEPS.LOADER, deadlineAt)
    ]);
    const blob = await rasterizeDocument(card.html, card.width, deadlineAt, html2canvas);
    showCardImage(blob, `${rfqId}-${card.tradeCode}-${card.issuer}.png`);
  }

  function clientDeviceClass() {
    if (matchMedia("(max-width: 700px)").matches) return "PHONE";
    if (matchMedia("(max-width: 1100px)").matches) return "TABLET";
    return "DESKTOP";
  }

  function reportClientImageEvent(rfqId, outcome, startedAt, failureStep) {
    const elapsedMs = Math.max(0, Math.min(120_000, Math.round(performance.now() - startedAt)));
    const body = { outcome, elapsedMs, deviceClass: clientDeviceClass() };
    // Only sent on failure, and only ever one of the known codes -- the backend rejects anything
    // else rather than storing a string this browser chose.
    if (outcome === "LOCAL_FAILED") {
      // hasOwnProperty.call rather than Object.hasOwn: this runs inside the fallback path, and a
      // TypeError from a newer built-in on older mobile WebKit would break the fallback as well.
      body.failureStep = Object.prototype.hasOwnProperty.call(RENDER_STEPS, failureStep)
        ? failureStep
        : "UNKNOWN";
    }
    void request(`/rfqs/${rfqId}/image-events`, {
      method: "POST",
      body: JSON.stringify(body),
      timeoutMs: 4_000
    }).catch(() => {});
  }

  async function requestArtifact(target) {
    const rfqId = getRfqId();
    if (!target || !rfqId || !target.dataset.artifactQuote) return;
    const originalLabel = target.textContent;
    const { artifactTrade, artifactQuote } = target.dataset;
    const status = document.querySelector("#backendCountdown");
    target.disabled = true;
    target.textContent = "產圖中…";
    const localRenderStartedAt = performance.now();
    try {
      try {
        await renderCardLocally(rfqId, artifactTrade, artifactQuote);
        reportClientImageEvent(rfqId, "LOCAL_READY", localRenderStartedAt);
        return;
      } catch (localError) {
        reportClientImageEvent(rfqId, "LOCAL_FAILED", localRenderStartedAt, localError?.renderStep);
        const message = localError instanceof Error ? localError.message : "本機產圖失敗。";
        status.textContent = `${message} 改用伺服器產圖…`;
      }
      await requestForRender(
        `/rfqs/${rfqId}/trades/${encodeURIComponent(artifactTrade)}/quotes/${encodeURIComponent(artifactQuote)}/artifact`,
        { method: "POST", body: "{}" },
        RENDER_STEPS.SERVER_FALLBACK,
        Date.now() + CARD_RENDER_STEP_TIMEOUT_MS
      );
      resetSnapshot();
      status.textContent = "已交由伺服器備援產圖；按鈕已恢復，完成後會顯示「查看報價圖」。";
      scheduleResultRefresh(1_000);
    } catch (error) {
      status.textContent = error instanceof Error ? error.message : "產圖失敗，請稍後再試。";
    } finally {
      target.disabled = false;
      target.textContent = originalLabel;
    }
  }

  // The row-view export. Nothing is fetched: the caller builds the sheet from the results payload
  // this browser already received and is already displaying, so no additional quote is authorized
  // and no raw quote leaves the page. There is deliberately no server fallback -- no row renderer
  // exists server-side, and adding one would push this onto the metered Browser Rendering path that
  // ADR 0016 moved away from. A failure here leaves the on-screen table untouched.
  async function requestTableImage(target) {
    if (!target || typeof buildTableSheet !== "function") return;
    const status = document.querySelector("#backendCountdown");
    const originalLabel = target.textContent;
    target.disabled = true;
    target.textContent = "產圖中…";
    try {
      const sheet = buildTableSheet();
      if (!sheet) throw new Error("目前沒有可產圖的正式排名結果。");
      const deadlineAt = Date.now() + CARD_RENDER_TOTAL_TIMEOUT_MS;
      const html2canvas = await withRenderDeadline(() => loadHtml2Canvas(), RENDER_STEPS.LOADER, deadlineAt);
      const blob = await rasterizeDocument(sheet.html, sheet.width, deadlineAt, html2canvas, { autoWidth: true });
      showCardImage(blob, sheet.filename);
    } catch (error) {
      if (status) status.textContent = error instanceof Error ? error.message : "表格圖產出失敗，請稍後再試。";
    } finally {
      target.disabled = false;
      target.textContent = originalLabel;
    }
  }

  return { requestArtifact, requestTableImage };
}
