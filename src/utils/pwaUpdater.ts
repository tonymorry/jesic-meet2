/**
 * JESic Meet - PWA Auto-Updater
 * 
 * Garantisce che tutti gli utenti che hanno installato la Web App sullo smartphone
 * (Android o iOS) o sul computer ricevano SEMPRE gli aggiornamenti in tempo reale
 * senza dover mai disinstallare e reinstallare l'applicazione.
 * 
 * - Registra /sw.js al caricamento dell'applicazione
 * - Controlla aggiornamenti all'avvio, ogni 10 minuti e al ritorno dell'app in primo piano (visibilitychange)
 * - Rileva il nuovo Service Worker e invia SKIP_WAITING
 * - All'evento 'controllerchange', ricarica la pagina in modo trasparente preservando la sessione utente
 */

let isRefreshing = false;

function notifyClientMode(): void {
  if (typeof window === 'undefined' || !('serviceWorker' in navigator)) return;
  const isStandalone =
    window.matchMedia('(display-mode: standalone)').matches ||
    (window.navigator as unknown as { standalone?: boolean }).standalone === true;

  if (navigator.serviceWorker.controller) {
    navigator.serviceWorker.controller.postMessage({
      type: 'PWA_CLIENT_REGISTER',
      isStandalone,
    });
  }
}

export function initPwaAutoUpdater(): void {
  if (typeof window === 'undefined' || !('serviceWorker' in navigator)) {
    return;
  }

  // Registra la modalità standalone con il Service Worker
  notifyClientMode();

  // Ascolta messaggi di navigazione inviati dal Service Worker su click di notifica
  navigator.serviceWorker.addEventListener('message', (event) => {
    if (event.data && event.data.type === 'PWA_NAVIGATE_TO_URL' && event.data.url) {
      try {
        const targetUrl = new URL(event.data.url);
        window.history.pushState({}, '', targetUrl.pathname + targetUrl.search + targetUrl.hash);
        window.dispatchEvent(new PopStateEvent('popstate'));
      } catch (e) {
        window.location.href = event.data.url;
      }
    }
  });

  // Supporto per la Launch Queue API (Chrome/Edge/WebAPK PWA Launch Handler)
  if (typeof window !== 'undefined' && 'launchQueue' in window && 'setConsumer' in (window as any).launchQueue) {
    (window as any).launchQueue.setConsumer((launchParams: any) => {
      if (launchParams && launchParams.targetURL) {
        try {
          const url = new URL(launchParams.targetURL);
          window.history.pushState({}, '', url.pathname + url.search + url.hash);
          window.dispatchEvent(new PopStateEvent('popstate'));
        } catch (e) {
          window.location.href = launchParams.targetURL;
        }
      }
    });
  }

  // 1. All'evento 'controllerchange' (il nuovo SW ha preso il controllo), aggiorna la pagina
  navigator.serviceWorker.addEventListener('controllerchange', () => {
    notifyClientMode();
    if (isRefreshing) return;
    isRefreshing = true;

    // Evita loop di refresh continui verificando l'ultimo reload
    const lastReload = sessionStorage.getItem('pwa_last_update_reload');
    const now = Date.now();
    if (lastReload && now - parseInt(lastReload, 10) < 5000) {
      return;
    }
    sessionStorage.setItem('pwa_last_update_reload', String(now));
    console.log('⚡ [PWA] Nuova versione dell\'applicazione attivata. Aggiornamento in corso...');
    window.location.reload();
  });

  // 2. Registrazione e gestione ciclo di vita del Service Worker
  window.addEventListener('load', async () => {
    try {
      const registration = await navigator.serviceWorker.register('/sw.js', {
        scope: '/',
        updateViaCache: 'none', // Impedisce al browser di cachare sw.js
      });

      console.log('📱 [PWA] Service Worker registrato con successo.');

      // Notifica lo stato standalone una volta pronto
      navigator.serviceWorker.ready.then(() => {
        notifyClientMode();
      });

      // Se c'è già un worker in attesa, chiedigli di saltare l'attesa
      if (registration.waiting) {
        registration.waiting.postMessage({ type: 'SKIP_WAITING' });
      }

      // Rileva quando viene scaricato un nuovo Service Worker
      registration.addEventListener('updatefound', () => {
        const installingWorker = registration.installing;
        if (!installingWorker) return;

        installingWorker.addEventListener('statechange', () => {
          if (installingWorker.state === 'installed') {
            if (navigator.serviceWorker.controller) {
              // C'è un controller precedente: nuova versione pronta!
              console.log('🔄 [PWA] Nuova versione pronta. Attivazione immediata...');
              installingWorker.postMessage({ type: 'SKIP_WAITING' });
            }
          }
        });
      });

      // 3. Controllo aggiornamenti quando l'utente riapre l'app dallo sfondo (smartphone)
      document.addEventListener('visibilitychange', () => {
        if (document.visibilityState === 'visible') {
          notifyClientMode();
          registration.update().catch(() => {});
        }
      });

      // 4. Controllo periodico silenzioso ogni 10 minuti
      setInterval(() => {
        registration.update().catch(() => {});
      }, 10 * 60 * 1000);
    } catch (err) {
      console.warn('⚠️ [PWA] Registrazione Service Worker non riuscita:', err);
    }
  });
}
