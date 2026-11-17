/**
 * JESic Meet - Service Worker per PWA & Notifiche Push
 * 
 * Aggiornamento automatico istantaneo senza disinstallazione:
 * - self.skipWaiting() all'installazione
 * - self.clients.claim() all'attivazione con pulizia automatica di vecchie cache
 * - Strategia Network-First per navigazione e HTML (mai bloccare index.html su versioni vecchie)
 * - Bypass assoluto della cache per tutte le chiamate /api/, WebSocket /ws e callback OAuth
 * - Conformità rigorosa Apple WebKit userVisibleOnly: ogni evento push chiama sempre showNotification()
 * - Auto-ripristino su rotazione endpoint APNs (pushsubscriptionchange)
 */

const CACHE_NAME = 'jesic-pwa-v8';
const PUSH_META_CACHE = 'jesic-push-meta';
const PUSH_META_KEY = '/__push_meta__';

// Tracciamento dei client aperti in modalità standalone (Web App installata sullo smartphone)
const standaloneClientIds = new Set();

function urlBase64ToUint8Array(base64String) {
  const padding = '='.repeat((4 - (base64String.length % 4)) % 4);
  const base64 = (base64String + padding).replace(/-/g, '+').replace(/_/g, '/');
  const rawData = atob(base64);
  const outputArray = new Uint8Array(rawData.length);
  for (let i = 0; i < rawData.length; ++i) {
    outputArray[i] = rawData.charCodeAt(i);
  }
  return outputArray;
}

async function readPushMeta() {
  try {
    const cache = await caches.open(PUSH_META_CACHE);
    const res = await cache.match(PUSH_META_KEY);
    if (!res) return null;
    return await res.json();
  } catch {
    return null;
  }
}

// Installazione: salta l'attesa per attivarsi immediatamente
self.addEventListener('install', () => {
  self.skipWaiting();
});

// Attivazione: prende subito il controllo dei client e pulisce le vecchie cache applicative
// (Preserva PUSH_META_CACHE per mantenere i metadati di auto-ripristino Push)
self.addEventListener('activate', (event) => {
  event.waitUntil(
    Promise.all([
      self.clients.claim(),
      caches.keys().then((keys) =>
        Promise.all(
          keys.map((key) => {
            if (key !== CACHE_NAME && key !== PUSH_META_CACHE) {
              return caches.delete(key);
            }
          })
        )
      ),
    ])
  );
});

// Intercettazione messaggi dal client (SKIP_WAITING o registrazione client standalone)
self.addEventListener('message', (event) => {
  if (event.data && (event.data.type === 'SKIP_WAITING' || event.data === 'skipWaiting')) {
    self.skipWaiting();
  }
  if (event.data && event.data.type === 'PWA_CLIENT_REGISTER' && event.source && event.source.id) {
    if (event.data.isStandalone) {
      standaloneClientIds.add(event.source.id);
    } else {
      standaloneClientIds.delete(event.source.id);
    }
  }
});

// Intercettazione richieste di rete
self.addEventListener('fetch', (event) => {
  const request = event.request;
  const url = new URL(request.url);

  // 1. Non intercettare richieste esterne (Google OAuth/API), /api/, WebSocket, richieste non GET o callback OAuth
  if (
    request.method !== 'GET' ||
    url.origin !== self.location.origin ||
    url.pathname.startsWith('/api') ||
    url.pathname.startsWith('/ws') ||
    url.search.includes('code=')
  ) {
    return;
  }

  // 2. Navigazione / Documenti HTML: NETWORK-FIRST con fallback cache se offline
  if (
    request.mode === 'navigate' ||
    request.destination === 'document' ||
    url.pathname === '/' ||
    url.pathname.endsWith('.html')
  ) {
    event.respondWith(
      fetch(request, { cache: 'no-store' })
        .then((response) => {
          if (response && response.status === 200 && !url.search.includes('code=')) {
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

  // 3. Risorse statiche (JS, CSS, Font, Immagini): Network-first con fallback cache
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
// REGOLA CRITICA APPLE (WebKit/APNs): ogni evento 'push' DEVE sempre invocare showNotification(),
// altrimenti iOS/Safari revoca automaticamente la sottoscrizione e disattiva i permessi dopo 3 eventi silenziosi.
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
    (async () => {
      try {
        // Mostra SEMPRE la notifica di sistema per rispettare userVisibleOnly su Apple iOS/macOS
        await self.registration.showNotification(
          data.title || 'JESic Meet',
          notificationOptions
        );

        // Avvisa eventuali finestre aperte per mantenere la UI sincronizzata in tempo reale
        const windowClients = await self.clients.matchAll({
          type: 'window',
          includeUncontrolled: true,
        });
        windowClients.forEach((client) => {
          try {
            client.postMessage({
              type: 'PUSH_RECEIVED',
              data,
            });
          } catch {
            // Ignora errori postMessage
          }
        });

        // Aggiorna il pallino/contatore sull'icona dell'app installata (PWA App Badging API)
        try {
          if (self.navigator && typeof self.navigator.setAppBadge === 'function') {
            const rawCount = Number(data?.badgeCount || data?.unreadCount || 1);
            await self.navigator.setAppBadge(rawCount > 0 ? rawCount : 1);
          }
        } catch {
          // Ignora se non supportato
        }
      } catch {
        await self.registration.showNotification(
          data.title || 'JESic Meet',
          notificationOptions
        );
      }
    })()
  );
});

// Auto-ripristino automatico quando Apple APNs o il browser ruota/rinnova l'endpoint Push
self.addEventListener('pushsubscriptionchange', (event) => {
  event.waitUntil(
    (async () => {
      try {
        const meta = await readPushMeta();
        if (!meta || !meta.userId || meta.disabled === true) {
          return;
        }

        let newSub = event.newSubscription || null;
        if (!newSub) {
          let applicationServerKey =
            event.oldSubscription &&
            event.oldSubscription.options &&
            event.oldSubscription.options.applicationServerKey
              ? event.oldSubscription.options.applicationServerKey
              : null;

          if (!applicationServerKey) {
            let publicKey = meta.publicKey || '';
            if (!publicKey) {
              const keyRes = await fetch('/api/push/public-key', { cache: 'no-store' });
              if (keyRes.ok) {
                const keyData = await keyRes.json();
                publicKey = keyData.publicKey || '';
              }
            }
            if (publicKey) {
              applicationServerKey = urlBase64ToUint8Array(publicKey);
            }
          }

          if (applicationServerKey) {
            newSub = await self.registration.pushManager.subscribe({
              userVisibleOnly: true,
              applicationServerKey,
            });
          }
        }

        if (newSub) {
          await fetch('/api/push/subscribe', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              userId: meta.userId,
              subscription: newSub.toJSON(),
              userAgent: 'service-worker-pushsubscriptionchange',
            }),
          });
        }
      } catch (err) {
        console.warn('[SW] Errore rinnovo automatico pushsubscriptionchange:', err);
      }
    })()
  );
});

// Click sulla notifica: apre o porta in primo piano l'applicazione Web App (PWA installata sullo smartphone)
self.addEventListener('notificationclick', (event) => {
  event.notification.close();

  const rawTarget = event.notification.data?.url || '/';
  const fullTargetUrl = new URL(rawTarget, self.location.origin).href;

  event.waitUntil(
    (async () => {
      const windowClients = await self.clients.matchAll({
        type: 'window',
        includeUncontrolled: true,
      });

      const standaloneClient = windowClients.find(
        (c) =>
          standaloneClientIds.has(c.id) ||
          (c.url && (c.url.includes('source=pwa') || c.url.startsWith(self.location.origin)))
      );

      if (standaloneClient && 'focus' in standaloneClient) {
        await standaloneClient.focus();
        try {
          standaloneClient.postMessage({
            type: 'PWA_NAVIGATE_TO_URL',
            url: fullTargetUrl,
          });
        } catch {}
        if ('navigate' in standaloneClient && standaloneClient.url !== fullTargetUrl) {
          await standaloneClient.navigate(fullTargetUrl);
        }
        return;
      }

      if (self.clients.openWindow) {
        return self.clients.openWindow(fullTargetUrl);
      }

      if (windowClients.length > 0 && 'focus' in windowClients[0]) {
        const fallbackClient = windowClients[0];
        await fallbackClient.focus();
        if ('navigate' in fallbackClient) {
          await fallbackClient.navigate(fullTargetUrl);
        }
      }
    })()
  );
});
