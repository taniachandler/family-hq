// Service worker: shows phone notifications and opens the app when one is tapped.
// It doesn't cache anything, so the app is always the newest version.
self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', (e) => e.waitUntil(self.clients.claim()));

self.addEventListener('push', (e) => {
  let d = {};
  try { d = e.data ? e.data.json() : {}; } catch { d = { title: e.data?.text() }; }
  e.waitUntil(self.registration.showNotification(d.title || 'Family HQ', {
    body: d.body || '',
    icon: '/icon.svg',
    badge: '/icon.svg',
    tag: d.tag || undefined,
    renotify: !!d.tag,
    data: { url: d.url || '/' },
  }));
});

self.addEventListener('notificationclick', (e) => {
  e.notification.close();
  const url = new URL(e.notification.data?.url || '/', self.location.origin).href;
  e.waitUntil((async () => {
    const wins = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
    for (const w of wins) {
      if (new URL(w.url).origin === self.location.origin) {
        await w.focus();
        return w.navigate(url).catch(() => w.postMessage({ go: url }));
      }
    }
    return self.clients.openWindow(url);
  })());
});
