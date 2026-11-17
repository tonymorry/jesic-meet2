/**
 * JESic Meet - Gestore Notifiche Push Reali lato Client (Browser Web Push API)
 * Registrazione Service Worker, persistenza preferenza utente, auto-ripristino Apple/APNs
 * e sincronizzazione con MongoDB
 */

const PUSH_PREF_PREFIX = 'jesic_push_pref_';
const PUSH_META_CACHE = 'jesic-push-meta';
const PUSH_META_KEY = '/__push_meta__';

let lastSyncTimestampByUser: Record<string, number> = {};

function urlBase64ToUint8Array(base64String: string): Uint8Array {
  const padding = '='.repeat((4 - (base64String.length % 4)) % 4);
  const base64 = (base64String + padding).replace(/-/g, '+').replace(/_/g, '/');
  const rawData = window.atob(base64);
  const outputArray = new Uint8Array(rawData.length);
  for (let i = 0; i < rawData.length; ++i) {
    outputArray[i] = rawData.charCodeAt(i);
  }
  return outputArray;
}

export function getPushUserPreference(userId?: string | null): 'enabled' | 'disabled' | null {
  if (typeof window === 'undefined' || !userId) return null;
  try {
    const val = localStorage.getItem(`${PUSH_PREF_PREFIX}${userId}`);
    if (val === 'enabled' || val === 'disabled') return val;
  } catch {}
  return null;
}

export function setPushUserPreference(userId: string, pref: 'enabled' | 'disabled'): void {
  if (typeof window === 'undefined' || !userId) return;
  try {
    localStorage.setItem(`${PUSH_PREF_PREFIX}${userId}`, pref);
  } catch {}
}

export function isPushExplicitlyDisabled(userId?: string | null): boolean {
  return getPushUserPreference(userId) === 'disabled';
}

async function savePushMetaForSw(userId: string, publicKey?: string): Promise<void> {
  if (typeof caches === 'undefined') return;
  try {
    const cache = await caches.open(PUSH_META_CACHE);
    const payload = JSON.stringify({
      userId,
      publicKey: publicKey || '',
      disabled: false,
      updatedAt: Date.now(),
    });
    await cache.put(
      PUSH_META_KEY,
      new Response(payload, { headers: { 'Content-Type': 'application/json' } })
    );
  } catch {}
}

async function clearPushMetaForSw(): Promise<void> {
  if (typeof caches === 'undefined') return;
  try {
    const cache = await caches.open(PUSH_META_CACHE);
    await cache.delete(PUSH_META_KEY);
  } catch {}
}

/**
 * Verifica se il browser supporta le Notifiche Push e i Service Worker
 */
export function isPushNotificationSupported(): boolean {
  return (
    typeof window !== 'undefined' &&
    'serviceWorker' in navigator &&
    'PushManager' in window &&
    'Notification' in window
  );
}

/**
 * Registra il Service Worker /sw.js
 */
export async function registerServiceWorker(): Promise<ServiceWorkerRegistration | null> {
  if (!isPushNotificationSupported()) return null;

  try {
    const registration = await navigator.serviceWorker.register('/sw.js', {
      scope: '/',
      updateViaCache: 'none',
    });
    return registration;
  } catch (err) {
    console.warn('[PushManager] Registrazione Service Worker non riuscita:', err);
    return null;
  }
}

/**
 * Ottiene la sottoscrizione push attiva per questo browser
 */
export async function getExistingPushSubscription(): Promise<PushSubscription | null> {
  if (!isPushNotificationSupported()) return null;

  try {
    const registration = await navigator.serviceWorker.ready;
    return await registration.pushManager.getSubscription();
  } catch (err) {
    console.warn('[PushManager] Errore verifica sottoscrizione esistente:', err);
    return null;
  }
}

async function fetchVapidPublicKey(): Promise<string> {
  const keyRes = await fetch('/api/push/public-key', { cache: 'no-store' });
  if (!keyRes.ok) {
    throw new Error('Impossibile ottenere la chiave pubblica VAPID dal server');
  }
  const { publicKey } = await keyRes.json();
  if (!publicKey) {
    throw new Error('Chiave pubblica VAPID assente');
  }
  return publicKey;
}

async function syncSubscriptionToBackend(userId: string, subscription: PushSubscription): Promise<void> {
  const subJSON = subscription.toJSON();
  const saveRes = await fetch('/api/push/subscribe', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      userId,
      subscription: subJSON,
      userAgent: navigator.userAgent,
    }),
  });

  if (!saveRes.ok) {
    const errData = await saveRes.json().catch(() => ({}));
    throw new Error(errData.error || 'Errore salvataggio sottoscrizione su MongoDB');
  }
}

/**
 * Attiva le notifiche push per l'utente su questo dispositivo:
 * 1. Richiede il permesso al browser
 * 2. Recupera la chiave pubblica VAPID dal backend
 * 3. Iscrive il dispositivo al Push Service
 * 4. Salva l'endpoint in MongoDB e persiste la preferenza 'enabled'
 */
export async function subscribeToPushNotifications(userId: string): Promise<{
  success: boolean;
  permission: NotificationPermission;
  error?: string;
}> {
  if (!isPushNotificationSupported()) {
    return {
      success: false,
      permission: 'denied',
      error: 'Il tuo browser non supporta le notifiche push web.',
    };
  }

  try {
    // 1. Richiedi permesso all'utente
    const permission = await Notification.requestPermission();
    if (permission !== 'granted') {
      return {
        success: false,
        permission,
        error:
          permission === 'denied'
            ? 'Permesso notifiche negato nelle impostazioni del browser o di iOS.'
            : 'Permesso notifiche non concesso.',
      };
    }

    // 2. Registra o ottieni il service worker
    const registration = await registerServiceWorker();
    if (!registration) {
      return {
        success: false,
        permission,
        error: 'Impossibile inizializzare il Service Worker.',
      };
    }
    const readyReg = await navigator.serviceWorker.ready;

    // 3. Recupera la VAPID public key dal backend e salvala nei metadati SW
    const publicKey = await fetchVapidPublicKey();
    await savePushMetaForSw(userId, publicKey);

    // 4. Iscrivi al PushManager (se presente ma con chiave obsoleta, rigenera)
    const applicationServerKey = urlBase64ToUint8Array(publicKey);
    let subscription = await readyReg.pushManager.getSubscription();
    if (!subscription) {
      subscription = await readyReg.pushManager.subscribe({
        userVisibleOnly: true,
        applicationServerKey: applicationServerKey as any,
      });
    }

    // 5. Salva la sottoscrizione nel database MongoDB
    await syncSubscriptionToBackend(userId, subscription);

    setPushUserPreference(userId, 'enabled');
    lastSyncTimestampByUser[userId] = Date.now();

    return { success: true, permission: 'granted' };
  } catch (err: any) {
    console.error('[PushManager] Errore attivazione notifiche push:', err);
    return {
      success: false,
      permission: typeof Notification !== 'undefined' ? Notification.permission : 'denied',
      error: err.message || 'Errore imprevisto durante l\'attivazione delle notifiche push.',
    };
  }
}

/**
 * Sincronizza e ripristina silenziosamente le notifiche push se l'utente le aveva attivate
 * e NON ha premuto esplicitamente il tasto per disattivarle.
 * Risolve i casi Apple iOS/APNs in cui l'endpoint viene ruotato o temporaneamente sganciato.
 */
export async function syncOrRestorePushSubscription(
  userId: string,
  options?: { force?: boolean }
): Promise<{
  isSubscribed: boolean;
  permission: NotificationPermission;
}> {
  const currentPermission: NotificationPermission =
    typeof Notification !== 'undefined' ? Notification.permission : 'default';

  if (!isPushNotificationSupported() || !userId) {
    return { isSubscribed: false, permission: currentPermission };
  }

  // Rispetta sempre la scelta esplicita dell'utente di disattivare
  if (isPushExplicitlyDisabled(userId)) {
    return { isSubscribed: false, permission: currentPermission };
  }

  if (currentPermission !== 'granted') {
    return { isSubscribed: false, permission: currentPermission };
  }

  const pref = getPushUserPreference(userId);
  const now = Date.now();
  const lastSync = lastSyncTimestampByUser[userId] || 0;

  try {
    await registerServiceWorker();
    const readyReg = await navigator.serviceWorker.ready;
    let subscription = await readyReg.pushManager.getSubscription();

    // Se l'utente aveva attivato le push (pref === 'enabled') ma iOS/browser ha perso la subscription,
    // ricreala silenziosamente senza disturbare l'utente (il permesso è già 'granted').
    if (!subscription && pref === 'enabled') {
      try {
        const publicKey = await fetchVapidPublicKey();
        await savePushMetaForSw(userId, publicKey);
        subscription = await readyReg.pushManager.subscribe({
          userVisibleOnly: true,
          applicationServerKey: urlBase64ToUint8Array(publicKey) as any,
        });
      } catch (reSubErr) {
        console.warn('[PushManager] Ripristino silenzioso subscription non riuscito:', reSubErr);
      }
    }

    if (!subscription) {
      return { isSubscribed: false, permission: currentPermission };
    }

    // Se l'utente aveva già una subscription attiva ma nessuna preferenza salvata, fissala su 'enabled'
    if (!pref) {
      setPushUserPreference(userId, 'enabled');
    }

    // Sincronizza con il server se forzato o se non sincronizzato negli ultimi 20 secondi
    if (options?.force || now - lastSync > 20_000) {
      lastSyncTimestampByUser[userId] = now;
      try {
        const statusRes = await fetch(
          `/api/push/status?userId=${encodeURIComponent(userId)}&endpoint=${encodeURIComponent(subscription.endpoint)}`,
          { cache: 'no-store' }
        );
        const statusData = statusRes.ok ? await statusRes.json() : null;
        if (!statusData?.subscribed || options?.force) {
          const publicKey = await fetchVapidPublicKey().catch(() => '');
          await savePushMetaForSw(userId, publicKey);
          await syncSubscriptionToBackend(userId, subscription);
        }
      } catch (syncErr) {
        console.warn('[PushManager] Sync background stato push:', syncErr);
      }
    }

    return { isSubscribed: true, permission: currentPermission };
  } catch (err) {
    console.warn('[PushManager] Errore syncOrRestorePushSubscription:', err);
    return { isSubscribed: false, permission: currentPermission };
  }
}

/**
 * Disattiva ESPLICITAMENTE le notifiche push su questo dispositivo e le rimuove da MongoDB
 */
export async function unsubscribeFromPushNotifications(userId: string): Promise<boolean> {
  if (!isPushNotificationSupported()) return false;

  setPushUserPreference(userId, 'disabled');
  await clearPushMetaForSw();
  delete lastSyncTimestampByUser[userId];

  try {
    const registration = await navigator.serviceWorker.ready;
    const subscription = await registration.pushManager.getSubscription();

    if (subscription) {
      const endpoint = subscription.endpoint;
      await subscription.unsubscribe();

      await fetch('/api/push/unsubscribe', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ userId, endpoint }),
      });
    }

    return true;
  } catch (err) {
    console.error('[PushManager] Errore disiscrizione push:', err);
    return false;
  }
}

/**
 * Invia una notifica di prova reale al dispositivo corrente dell'utente
 */
export async function sendTestNotification(userId: string): Promise<{
  success: boolean;
  message: string;
}> {
  try {
    const res = await fetch('/api/push/test', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ userId }),
    });
    const data = await res.json();
    return {
      success: data.success && data.sent > 0,
      message: data.message || 'Notifica di prova inviata!',
    };
  } catch (err: any) {
    return {
      success: false,
      message: err.message || 'Errore invio notifica di prova',
    };
  }
}
