const CACHE_NAME = "mentiko-v2";
const urlsToCache = ["/offline"];

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => cache.addAll(urlsToCache))
  );
  self.skipWaiting();
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) =>
        Promise.all(keys.filter((key) => key !== CACHE_NAME).map((key) => caches.delete(key)))
      )
      .then(() => self.clients.claim())
  );
});

self.addEventListener("fetch", (event) => {
  const request = event.request;
  if (request.method !== "GET") return;

  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return;
  if (url.pathname.startsWith("/api/") || url.pathname.startsWith("/_next/")) return;

  if (request.mode === "navigate") {
    event.respondWith(
      fetch(request).catch(() => caches.match("/offline"))
    );
    return;
  }

  event.respondWith(
    fetch(request).catch(() => caches.match(request))
  );
});

// push notification handler
self.addEventListener("push", (event) => {
  if (!event.data) return;

  try {
    const data = event.data.json();
    const { title, message, icon, badge, url, type } = data;

    const options = {
      body: message,
      icon: icon || "/icon-192.png",
      badge: badge || "/badge-72.png",
      tag: type || "notification",
      requireInteraction: type === "error" || type === "webhook_failed",
      data: { url },
    };

    event.waitUntil(self.registration.showNotification(title, options));
  } catch (error) {
    console.error("push handler error:", error);
  }
});

// notification click handler
self.addEventListener("notificationclick", (event) => {
  event.notification.close();

  const urlToOpen = event.notification.data?.url || "/notifications";

  event.waitUntil(
    clients.matchAll({ type: "window" }).then((clientList) => {
      // if a client is already open, focus it and navigate
      for (const client of clientList) {
        if (client.url === urlToOpen && "focus" in client) {
          return client.focus();
        }
      }
      // otherwise open a new window
      if (clients.openWindow) {
        return clients.openWindow(urlToOpen);
      }
    })
  );
});
