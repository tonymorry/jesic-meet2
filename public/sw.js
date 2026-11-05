/**
 * JESic Meet - Service Worker per PWA & Notifiche Push
 * 
 * Aggiornamento automatico istantaneo senza disinstallazione:
 * - self.skipWaiting() all'installazione
 * - self.clients.claim() all'attivazione con pulizia automatica di vecchie cache
 * - Strategia Network-First per navigazione e HTML (mai bloccare index.html su versioni vecchie)
 * - Bypass assoluto della cache per tutte le chiamate /api/ e WebSocket /ws
 * - Supporto Notifiche Push reali in background con click focus/navigation
 */

const CACHE_NAME = 'jesic-pwa-v5';

// Installazione: salta l'attesa per attivarsi immediatamente
self.addEventListener('install', (event) => {
  self.skipWaiting();
});

// Attivazione: prende subito il controllo dei client e pulisce le vecchie cache
self.addEventListener('activate', (event) => {
  event.waitUntil(
    Promise.all([
      self.clients.claim(),
      caches.keys().then((keys) =>
        Promise.all(
          keys.map((key) => {
            if (key !== CACHE_NAME) {
              return caches.delete(key);
            }
          })
        )
      ),
    ])
  );
});

// Intercettazione messaggi dal client (es. comando esplicito di SKIP_WAITING)
self.addEventListener('message', (event) => {
  if (event.data && (event.data.type === 'SKIP_WAITING' || event.data === 'skipWaiting')) {
    self.skipWaiting();
  }
});

// Intercettazione richieste di rete
self.addEventListener('fetch', (event) => {
  const request = event.request;
  const url = new URL(request.url);

  // 1. Non intercettare /api/, WebSocket o richieste non GET (sempre direttamente da rete)
  if (request.method !== 'GET' || url.pathname.startsWith('/api') || url.pathname.startsWith('/ws')) {
    return;
  }

  // 2. Navigazione / Documenti HTML: NETWORK-FIRST con fallback cache se offline
  // Questo garantisce che chi apre la Web App riceva SEMPRE l'ultima versione di index.html
  if (request.mode === 'navigate' || request.destination === 'document' || url.pathname === '/' || url.pathname.endsWith('.html')) {
    event.respondWith(
      fetch(request, { cache: 'no-store' })
        .then((response) => {
          if (response && response.status === 200) {
            const clone = response.clone();
            caches.open(CACHE_NAME).then((cache) => cache.put(request, clone)).catch(() => {});
          }
          return response;
        })
        .catch(() => {
          return caches.match(request).then((cached) => cached || caches.match('/'));
        })
    );
    return;
  }

  // 3. Risorse statiche (JS, CSS, Font, Immagini): Network-first o Cache con revalidation
  event.respondWith(
    fetch(request)
      .then((networkResponse) => {
        if (networkResponse && networkResponse.status === 200 && networkResponse.type === 'basic') {
          const responseToCache = networkResponse.clone();
          caches.open(CACHE_NAME).then((cache) => cache.put(request, responseToCache)).catch(() => {});
        }
        return networkResponse;
      })
      .catch(() => {
        return caches.match(request);
      })
  );
});

// Ascolto delle Notifiche Push in background
self.addEventListener('push', (event) => {
  let data = {
    title: 'JESic Meet',
    body: 'Hai una nuova notifica',
    icon: '/logo.png',
    badge: '/logo.png',
    data: { url: '/' },
    tag: 'jesic-notification',
  };

  if (event.data) {
    try {
      data = { ...data, ...event.data.json() };
    } catch (err) {
      data.body = event.data.text();
    }
  }

  const notificationOptions = {
    body: data.body,
    icon: data.icon || '/logo.png',
    badge: data.badge || '/logo.png',
    data: data.data || { url: '/' },
    tag: data.tag || 'jesic-push',
    renotify: true,
    vibrate: [200, 100, 200],
    actions: [
      {
        action: 'open',
        title: 'Apri',
      },
    ],
  };

  event.waitUntil(
    self.registration.showNotification(data.title || 'JESic Meet', notificationOptions)
  );
});

// Click sulla notifica: apre o porta in primo piano l'applicazione
self.addEventListener('notificationclick', (event) => {
  event.notification.close();

  const targetUrl = event.notification.data?.url || '/';

  event.waitUntil(
    self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then((windowClients) => {
      for (const client of windowClients) {
        if ('focus' in client) {
          if (client.url && 'navigate' in client) {
            client.navigate(targetUrl);
          }
          return client.focus();
        }
      }

      if (self.clients.openWindow) {
        return self.clients.openWindow(targetUrl);
      }
    })
  );
});
