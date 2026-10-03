self.addEventListener("push", (event) => {
  const payload = event.data ? event.data.json() : {};
  event.waitUntil(self.registration.showNotification(payload.title || "Basteon alert", {
    body: payload.body || "A new emergency alert needs attention.",
    tag: payload.tag || "basteon-alert",
    requireInteraction: true,
    actions: payload.actions || [],
    data: { url: payload.url || "/responder", tripId: payload.tripId },
  }));
});

self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  if (event.action === "check-in" && event.notification.data.tripId) {
    event.waitUntil(fetch(`/api/trips/${event.notification.data.tripId}/check-in`, { method: "POST", credentials: "include" }));
    return;
  }
  event.waitUntil(clients.matchAll({ type: "window", includeUncontrolled: true }).then((windows) => {
    const existing = windows.find((windowClient) => windowClient.url.includes(event.notification.data.url));
    return existing ? existing.focus() : clients.openWindow(event.notification.data.url);
  }));
});