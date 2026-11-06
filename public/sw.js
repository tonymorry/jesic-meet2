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

const CACHE_NAME = 'jesic-pwa-v6';

// Tracciamento dei client aperti in modalità standalone (Web App installata sullo smartphone)
const standaloneClientIds = new Set();

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
    (async () => {
      try {
        // Verifica se l'utente ha finestre o schede dell'app/sito attualmente aperte
        const windowClients = await self.clients.matchAll({
          type: 'window',
          includeUncontrolled: true,
        });

        // L'utente sta già usando l'app o il sito se almeno una finestra è visibile e/o focalizzata
        const isUserActiveInApp = windowClients.some(
          (client) => client.focused || client.visibilityState === 'visible'
        );

        // Se l'utente ha la pagina aperta sullo schermo e sta già usando l'app,
        // NON mostrare alcuna notifica di sistema (arriverà solo a schermo spento, app chiusa o in background)
        if (isUserActiveInApp) {
          // Opzionale: invia un messaggio interno silenzioso per aggiornare la UI in tempo reale
          windowClients.forEach((client) => {
            try {
              client.postMessage({
                type: 'PUSH_SUPPRESSED_ACTIVE_APP',
                data,
              });
            } catch (postErr) {
              // Ignore postMessage error
            }
          });
          return;
        }

        // Se l'app/sito sono chiusi, ridotti in background o con telefono bloccato, mostra la notifica
        await self.registration.showNotification(
          data.title || 'JESic Meet',
          notificationOptions
        );
      } catch (err) {
        // Fallback in caso di errori di matchAll
        await self.registration.showNotification(
          data.title || 'JESic Meet',
          notificationOptions
        );
      }
    })()
  );
});

// Click sulla notifica: apre o porta in primo piano l'applicazione Web App (PWA installata sullo smartphone)
self.addEventListener('notificationclick', (event) => {
  event.notification.close();

  // Costruisci SEMPRE l'URL assoluto completo con protocollo e host corrispondenti allo scope della PWA.
  // Su iOS Safari e Android WebAPK, i link relativi non vengono associati alla PWA installata
  // e causano l'apertura errata del browser normale.
  const rawTarget = event.notification.data?.url || '/';
  const fullTargetUrl = new URL(rawTarget, self.location.origin).href;

  event.waitUntil(
    (async () => {
      const windowClients = await self.clients.matchAll({
        type: 'window',
        includeUncontrolled: true,
      });

      // 1. Cerca prima se una finestra dell'app PWA standalone è già aperta
      const standaloneClient = windowClients.find(
        (c) =>
          standaloneClientIds.has(c.id) ||
          (c.url && (c.url.includes('source=pwa') || c.url.startsWith(self.location.origin)))
      );

      // 2. Se una finestra dell'app è aperta, portala in primo piano e naviga
      if (standaloneClient && 'focus' in standaloneClient) {
        await standaloneClient.focus();
        try {
          standaloneClient.postMessage({
            type: 'PWA_NAVIGATE_TO_URL',
            url: fullTargetUrl,
          });
        } catch (postErr) {}
        if ('navigate' in standaloneClient && standaloneClient.url !== fullTargetUrl) {
          await standaloneClient.navigate(fullTargetUrl);
        }
        return;
      }

      // 3. Se l'app non è aperta (telefono bloccato, app chiusa o in background):
      // clients.openWindow con URL assoluto corrispondente allo scope del manifest
      // indica al sistema operativo mobile (Android WebAPK e iOS Standalone) di aprire l'applicazione scaricata!
      if (self.clients.openWindow) {
        return self.clients.openWindow(fullTargetUrl);
      }

      // 4. Fallback se openWindow non è disponibile
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
