/* Service worker (ADR 0061). It shows the operational alerts the Worker pushes to ADMIN and PS
   devices, and opens the page when one is clicked. It is registered only when an operator turns
   alerts on, never for other visitors.
   It deliberately has no fetch handler: every request still goes to the network, so the ?v= tokens
   stay the only cache control and no stale copy can outlive a deploy.
   A classic script, not a module: module service workers are not supported by every browser. */

var DEFAULT_TITLE = "FCN 詢價系統";
var DEFAULT_BODY = "系統狀態有新的告警，點此查看。";

self.addEventListener("install", function () {
  self.skipWaiting();
});

self.addEventListener("activate", function (event) {
  event.waitUntil(self.clients.claim());
});

function readPayload(event) {
  try {
    var data = event.data ? event.data.json() : null;
    return data && typeof data === "object" ? data : {};
  } catch (error) {
    return {};
  }
}

// Only a page of this origin can be opened from a notification; anything else opens the start page.
function targetUrl(value) {
  var home = new URL("./", self.registration.scope).href;
  if (typeof value !== "string") return home;
  try {
    var url = new URL(value, self.location.origin);
    return url.origin === self.location.origin ? url.href : home;
  } catch (error) {
    return home;
  }
}

self.addEventListener("push", function (event) {
  var data = readPayload(event);
  var options = {
    body: typeof data.body === "string" ? data.body : DEFAULT_BODY,
    icon: new URL("./apple-touch-icon.png", self.registration.scope).href,
    lang: "zh-Hant",
    data: { url: targetUrl(data.url) }
  };
  if (typeof data.tag === "string" && data.tag) options.tag = data.tag;
  // Every push shows a notification, even an unreadable one: browsers withdraw the permission of a
  // site whose pushes stay silent.
  event.waitUntil(self.registration.showNotification(
    typeof data.title === "string" && data.title ? data.title : DEFAULT_TITLE, options));
});

self.addEventListener("notificationclick", function (event) {
  event.notification.close();
  var url = targetUrl(event.notification.data && event.notification.data.url);
  event.waitUntil(self.clients.matchAll({ type: "window", includeUncontrolled: true }).then(function (windows) {
    var open = windows.find(function (client) {
      return new URL(client.url).origin === self.location.origin;
    });
    // An open page is only brought forward: navigating it could discard an RFQ being typed.
    return open ? open.focus() : self.clients.openWindow(url);
  }));
});
