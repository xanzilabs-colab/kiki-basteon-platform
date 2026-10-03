self.addEventListener("push", (event) => {
  const payload = event.data ? event.data.json() : {};
  event.waitUntil(self.registration.showNotification(payload.title || "Basteon alert", {
    body: payload.body || "A new emergency alert needs attention.",
    tag: payload.tag || "basteon-alert",
    requireInteraction: true,
    data: { url: payload.url || "/responder" },
  }));
});

self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  event.waitUntil(clients.matchAll({ type: "window", includeUncontrolled: true }).then((windows) => {
    const existing = windows.find((windowClient) => windowClient.url.includes("/responder"));
    return existing ? existing.focus() : clients.openWindow(event.notification.data.url);
  }));
});