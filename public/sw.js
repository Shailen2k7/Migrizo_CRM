/* Migrizo service worker — push notifications + click-through */
self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', (e) => e.waitUntil(self.clients.claim()));

self.addEventListener('push', (event) => {
  let data = {};
  try { data = event.data ? event.data.json() : {}; } catch { data = { title: 'Migrizo', body: event.data && event.data.text() }; }
  const title = data.title || 'Migrizo CRM';
  const isWhatsApp = typeof data.tag === 'string' && data.tag.indexOf('wa-') === 0;
  const options = {
    body: data.body || '',
    icon: '/icons/icon-192.png',
    badge: '/icons/icon-192.png',
    tag: data.tag || undefined,
    renotify: !!data.tag,
    data: { url: data.url || '/daily-tracker' },
    // WhatsApp messages get a longer, unmistakable buzz — this is the event
    // the business runs on. (Custom notification SOUNDS are an OS decision on
    // the web; the in-app chime covers open tabs, this covers pockets.)
    vibrate: isWhatsApp ? [120, 60, 120, 60, 200] : [80, 40, 80],
  };
  event.waitUntil(
    Promise.all([
      self.registration.showNotification(title, options),
      // Badge count on the app icon where the OS supports it.
      'setAppBadge' in navigator ? navigator.setAppBadge().catch(() => {}) : Promise.resolve(),
    ])
  );
});

self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  const url = (event.notification.data && event.notification.data.url) || '/daily-tracker';
  event.waitUntil(
    self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then((list) => {
      for (const c of list) {
        if ('focus' in c) { c.navigate(url); return c.focus(); }
      }
      return self.clients.openWindow(url);
    })
  );
});
