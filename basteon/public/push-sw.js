self.addEventListener("push", (event) => {
  const payload = event.data ? event.data.json() : {};
  event.waitUntil(self.registration.showNotification(payload.title || "Basteon alert", {
    body: payload.body || "A new emergency alert needs attention.",
    tag: payload.tag || "basteon-alert",
    requireInteraction: true,
    actions: payload.actions || [],
    data: { url: payload.url || "/responder", tripId: payload.tripId, pendingId: payload.data?.pendingId ?? payload.pendingId, recordId: payload.data?.recordId },
  }));
});

self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  if (event.action === "acknowledge-safety-alert" && event.notification.data.recordId) {
    event.waitUntil(
      fetch("/api/safety-intel/acknowledge", {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ recordId: event.notification.data.recordId }),
      }).then(async (response) => {
        await self.registration.showNotification("Kiki community alert", {
          body: response.ok ? "This report is acknowledged. Reminders have stopped." : "Could not acknowledge this report. Open Kiki and try again.",
          tag: `kiki-safety-intel-ack-${event.notification.data.recordId}`,
          data: { url: "/account/buddies" },
        });
      }).catch(async () => {
        await self.registration.showNotification("Kiki community alert", {
          body: "Could not acknowledge this report. Open Kiki and try again.",
          tag: `kiki-safety-intel-ack-${event.notification.data.recordId}`,
          data: { url: "/account/buddies" },
        });
      })
    );
    return;
  }
  if (event.action === "check-in" && event.notification.data.tripId) {
    event.waitUntil(fetch(`/api/trips/${event.notification.data.tripId}/check-in`, { method: "POST", credentials: "include" }));
    return;
  }
  if (event.action === "cancel-alert" && event.notification.data.pendingId) {
    event.waitUntil(
      fetch("/api/trigger/cancel-user", {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ pendingId: event.notification.data.pendingId }),
      }).then(async (response) => {
        const message = response.ok
          ? "The pending Kiki alert was cancelled."
          : "The Kiki alert could not be cancelled. Check the app now.";
        await self.registration.showNotification("Kiki", {
          body: message,
          tag: `kiki-trigger-cancel-${event.notification.data.pendingId}`,
          data: { url: "/account" },
        });
      }).catch(async () => {
        await self.registration.showNotification("Kiki", {
          body: "Could not reach Kiki to cancel the alert. Open the app and check its status.",
          tag: `kiki-trigger-cancel-${event.notification.data.pendingId}`,
          data: { url: "/account" },
        });
      })
    );
    return;
  }
  event.waitUntil(clients.matchAll({ type: "window", includeUncontrolled: true }).then((windows) => {
    const existing = windows.find((windowClient) => windowClient.url.includes(event.notification.data.url));
    return existing ? existing.focus() : clients.openWindow(event.notification.data.url);
  }));
});