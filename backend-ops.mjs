// 「系統狀態」 for ADMIN and PS (ADR 0061): what the half-hourly patrol sees right now, the alerts of
// the last two weeks, and the switch that turns alert notifications on for this device.
// Loaded only when the dialog is first opened, so nothing here can slow or break the quoting flow.

// ---------------------------------------------------------------------------------------------
// Pure helpers (tested in backend/test/backend-ops.test.mjs)

// iPhone and iPad, including iPadOS, which reports itself as a Mac with a touch screen.
export function isAppleMobile({ userAgent = "", platform = "", maxTouchPoints = 0 } = {}) {
  return /\b(iPhone|iPad|iPod)\b/u.test(userAgent) || (platform === "MacIntel" && maxTouchPoints > 1);
}

// "ok", "needs-home-screen" (iPhone and iPad offer Web Push only to an app on the Home Screen) or
// "unsupported".
export function pushSupport({ navigator: nav = {}, hasPushManager = false, hasNotification = false, standalone = false } = {}) {
  if (isAppleMobile(nav) && !standalone) return "needs-home-screen";
  return "serviceWorker" in nav && hasPushManager && hasNotification ? "ok" : "unsupported";
}

export function base64UrlToBytes(value) {
  const base64 = String(value).replaceAll("-", "+").replaceAll("_", "/");
  const binary = atob(base64.padEnd(Math.ceil(base64.length / 4) * 4, "="));
  return Uint8Array.from(binary, character => character.charCodeAt(0));
}

// Whether a subscription was made under the server's current key; one made under an older key no
// longer receives anything and must be replaced.
export function sameKey(applicationServerKey, publicKey) {
  if (!applicationServerKey || !publicKey) return false;
  const left = new Uint8Array(applicationServerKey);
  const right = base64UrlToBytes(publicKey);
  return left.length === right.length && left.every((byte, index) => byte === right[index]);
}

// What the notification row says and offers, from everything that can stand in the way.
export function describePush({ support, serverEnabled, permission, subscribed, devices = 0, deviceLimit = 5 }) {
  const others = subscribed ? Math.max(0, devices - 1) : devices;
  const elsewhere = others > 0 ? `你的帳號另有 ${others} 台裝置已開啟（上限 ${deviceLimit} 台）。` : "";
  if (support === "needs-home-screen") {
    return { action: null, canTest: false,
      text: "iPhone／iPad 要先把網頁加入主畫面：按「分享」→「加入主畫面」，再從主畫面開啟、登入，回到這裡開啟通知。" };
  }
  if (support !== "ok") {
    return { action: null, canTest: false, text: "這個瀏覽器不支援通知。iPhone 請用 iOS 16.4 以上，並從主畫面開啟。" };
  }
  if (!serverEnabled) return { action: null, canTest: false, text: "伺服器尚未設定通知金鑰，告警只會記錄在下方，不會推播。" };
  if (permission === "denied") {
    return { action: null, canTest: false, text: "通知已被封鎖。請到瀏覽器或裝置設定允許這個網站的通知，再回來開啟。" };
  }
  if (subscribed) return { action: "disable", canTest: true, text: `這台裝置已開啟告警通知。${elsewhere}` };
  return { action: "enable", canTest: false, text: `這台裝置尚未開啟告警通知。${elsewhere}` };
}

// Failing checks first, the most serious on top; passing ones keep the server's order.
export function sortChecks(checks) {
  const rank = check => (check.ok ? 2 : check.severity === "CRITICAL" ? 0 : 1);
  return [...checks].sort((left, right) => rank(left) - rank(right));
}

// ---------------------------------------------------------------------------------------------
// The controller

const READY_TIMEOUT_MS = 10_000;

function withTimeout(promise, ms, message) {
  let timer;
  return Promise.race([
    promise.finally(() => clearTimeout(timer)),
    new Promise((_, reject) => { timer = setTimeout(() => reject(new Error(message)), ms); })
  ]);
}

export function createOpsController({ request, escapeHtml, formatDateTime, win = window }) {
  const doc = win.document;
  const dialog = doc.querySelector("#backendOps");
  const errorText = doc.querySelector("#backendOpsError");
  const summaryText = doc.querySelector("#backendOpsSummary");
  const checksBox = doc.querySelector("#backendOpsChecks");
  const alertsBox = doc.querySelector("#backendOpsAlerts");
  const pushText = doc.querySelector("#backendOpsPushStatus");
  const pushError = doc.querySelector("#backendOpsPushError");
  const toggleButton = doc.querySelector("#backendOpsPushToggle");
  const testButton = doc.querySelector("#backendOpsPushTest");
  let config = null;
  let busy = false;

  const support = () => pushSupport({
    navigator: win.navigator,
    hasPushManager: "PushManager" in win,
    hasNotification: "Notification" in win,
    standalone: win.navigator.standalone === true || win.matchMedia?.("(display-mode: standalone)").matches === true
  });

  // iPhone reads the manifest when the page is added to the Home Screen. It is linked only here, for
  // an operator who opened this dialog, so other visitors' Home Screen shortcuts keep behaving as before.
  function linkManifest() {
    if (doc.querySelector('link[rel="manifest"]')) return;
    const link = doc.createElement("link");
    link.rel = "manifest";
    link.href = "./manifest.webmanifest";
    doc.head.append(link);
  }

  // sw.js carries no ?v= token, so the browser must revalidate it on every update check.
  async function registration() {
    await win.navigator.serviceWorker.register("./sw.js", { scope: "./", updateViaCache: "none" });
    return withTimeout(win.navigator.serviceWorker.ready, READY_TIMEOUT_MS, "通知元件尚未就緒，請重新整理後再試。");
  }

  async function currentSubscription() {
    if (support() !== "ok") return null;
    const existing = await win.navigator.serviceWorker.getRegistration();
    return existing ? existing.pushManager.getSubscription() : null;
  }

  async function subscribeUnderCurrentKey() {
    const pushManager = (await registration()).pushManager;
    const existing = await pushManager.getSubscription();
    if (existing && sameKey(existing.options?.applicationServerKey, config.publicKey)) return existing;
    if (existing) await existing.unsubscribe();
    return pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: base64UrlToBytes(config.publicKey) });
  }

  async function renderPush() {
    const subscription = await currentSubscription().catch(() => null);
    const view = describePush({
      support: support(),
      serverEnabled: Boolean(config?.enabled),
      permission: "Notification" in win ? win.Notification.permission : "default",
      subscribed: Boolean(subscription && config?.enabled && sameKey(subscription.options?.applicationServerKey, config.publicKey)),
      devices: config?.devices ?? 0,
      deviceLimit: config?.deviceLimit ?? 5
    });
    pushText.textContent = view.text;
    toggleButton.hidden = !view.action;
    toggleButton.textContent = view.action === "disable" ? "關閉通知" : "開啟通知";
    toggleButton.dataset.action = view.action ?? "";
    testButton.hidden = !view.canTest;
    toggleButton.disabled = busy;
    testButton.disabled = busy;
  }

  async function run(work, doneMessage = "") {
    if (busy) return;
    busy = true;
    pushError.textContent = "";
    toggleButton.disabled = true;
    testButton.disabled = true;
    try {
      await work();
      busy = false;
      await renderPush();
      if (doneMessage) pushText.textContent = `${pushText.textContent} ${doneMessage}`.trim();
    } catch (error) {
      busy = false;
      await renderPush().catch(() => {});
      pushError.textContent = error instanceof Error && error.message ? error.message : "操作失敗，請稍後再試。";
    }
  }

  async function enable() {
    // The permission prompt must come straight from the tap, before any other await.
    const permission = win.Notification.permission === "default"
      ? await win.Notification.requestPermission()
      : win.Notification.permission;
    if (permission !== "granted") return;
    let subscription;
    try {
      subscription = await subscribeUnderCurrentKey();
    } catch {
      throw new Error("這個瀏覽器無法登記通知，請改用 Chrome、Edge、Firefox 或 iPhone 主畫面 App。");
    }
    const saved = await request("/push/subscriptions", { method: "POST", body: JSON.stringify(subscription.toJSON()) });
    if (config) config.devices = saved.devices;
  }

  async function disable() {
    const subscription = await currentSubscription();
    if (!subscription) return;
    await request("/push/subscriptions/delete", { method: "POST", body: JSON.stringify({ endpoint: subscription.endpoint }) });
    if (config) config.devices = Math.max(0, (config.devices ?? 1) - 1);
    await subscription.unsubscribe();
  }

  async function sendTest() {
    const subscription = await currentSubscription();
    if (!subscription) throw new Error("這台裝置還沒開啟通知。");
    await request("/push/test", { method: "POST", body: JSON.stringify({ endpoint: subscription.endpoint }) });
  }

  function renderStatus(view) {
    const failing = view.checks.filter(check => !check.ok);
    summaryText.textContent = failing.length
      ? `${failing.length} 項需要留意（${formatDateTime(view.checkedAt)} 檢查）`
      : `全部正常（${formatDateTime(view.checkedAt)} 檢查）`;
    if (!view.patrolEnabled) summaryText.textContent += "。自動巡檢目前關閉。";
    checksBox.innerHTML = `<table><thead><tr><th>項目</th><th>狀態</th><th>說明</th></tr></thead><tbody>${sortChecks(view.checks).map(check => `<tr>
        <td>${escapeHtml(check.label)}</td>
        <td>${check.ok ? "正常" : `<strong>${check.severity === "CRITICAL" ? "需要處理" : "請留意"}</strong>`}</td>
        <td>${escapeHtml(check.summary)}</td>
      </tr>`).join("")}</tbody></table>`;
    alertsBox.innerHTML = view.alerts.length
      ? `<table><thead><tr><th>時間</th><th>等級</th><th>內容</th></tr></thead><tbody>${view.alerts.map(alert => `<tr>
          <td>${escapeHtml(formatDateTime(alert.createdAt))}</td>
          <td>${alert.severity === "CRITICAL" ? "需要處理" : "請留意"}</td>
          <td>${escapeHtml(alert.summary)}</td>
        </tr>`).join("")}</tbody></table>`
      : "<p>近兩週沒有告警。</p>";
  }

  async function load() {
    errorText.textContent = "";
    summaryText.textContent = "檢查中…";
    try {
      renderStatus(await request("/admin/ops-status"));
    } catch (error) {
      summaryText.textContent = "";
      errorText.textContent = error instanceof Error ? error.message : "無法讀取系統狀態。";
    }
    try {
      config = await request("/push/config");
    } catch {
      config = null;
    }
    await renderPush();
  }

  toggleButton.addEventListener("click", () => {
    void run(toggleButton.dataset.action === "disable" ? disable : enable);
  });
  testButton.addEventListener("click", () => {
    void run(sendTest, "測試通知已送出，幾秒內應會出現。");
  });
  doc.querySelector("#backendOpsRefresh").addEventListener("click", () => { void load(); });
  doc.querySelector("#closeBackendOps").addEventListener("click", () => dialog.close());
  dialog.addEventListener("click", event => {
    if (event.target === dialog) dialog.close();
  });

  return {
    async openOpsStatus() {
      linkManifest();
      pushError.textContent = "";
      toggleButton.hidden = true;
      testButton.hidden = true;
      if (!dialog.open) dialog.showModal();
      await load();
    }
  };
}
