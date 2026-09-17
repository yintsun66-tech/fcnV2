const HTML2CANVAS_URL = new URL("./vendor/html2canvas-1.4.1.min.js", import.meta.url).href;
const DEFAULT_TIMEOUT_MS = 12_000;

let loaderPromise = null;

function availableRenderer() {
  return typeof window.html2canvas === "function" ? window.html2canvas : null;
}

export function loadHtml2Canvas(timeoutMs = DEFAULT_TIMEOUT_MS) {
  const ready = availableRenderer();
  if (ready) return Promise.resolve(ready);
  if (loaderPromise) return loaderPromise;

  loaderPromise = new Promise((resolve, reject) => {
    // Always start from a fresh element. A script left in the document by an earlier attempt has
    // already fired its load or error event, and neither fires a second time, so reusing it would
    // attach listeners that can never run — and because the element is already connected it would
    // not be re-fetched either. The only reachable outcome then is the timeout below. That is what
    // the client telemetry recorded: renders either finished under a second or burned the full
    // twelve seconds, with almost nothing in between, and the failure removed the stale element so
    // the next attempt succeeded immediately.
    document.querySelectorAll("script[data-html2canvas-loader]").forEach(stale => stale.remove());

    const script = document.createElement("script");
    script.src = HTML2CANVAS_URL;
    script.async = true;
    script.dataset.html2canvasLoader = "1";
    let timeoutId = null;

    const cleanup = () => {
      clearTimeout(timeoutId);
      script.removeEventListener("load", onLoad);
      script.removeEventListener("error", onError);
    };
    const fail = message => {
      cleanup();
      script.remove();
      loaderPromise = null;
      reject(new Error(message));
    };
    const onLoad = () => {
      const renderer = availableRenderer();
      if (!renderer) {
        fail("報價圖元件載入完成但無法啟動，請重新整理後再試。");
        return;
      }
      cleanup();
      resolve(renderer);
    };
    const onError = () => fail("報價圖元件載入失敗，請確認網路連線後再試。");

    script.addEventListener("load", onLoad, { once: true });
    script.addEventListener("error", onError, { once: true });
    timeoutId = setTimeout(
      () => fail("報價圖元件載入逾時，請確認網路連線後再試。"),
      Math.max(1_000, Number(timeoutMs) || DEFAULT_TIMEOUT_MS)
    );
    document.head.append(script);
  });

  return loaderPromise;
}
