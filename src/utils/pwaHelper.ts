/**
 * JESic Meet - PWA Utility Helpers
 * Rileva se l'applicazione è in esecuzione come Web App installata (PWA/Standalone)
 * su Android, iOS o Desktop, oppure se è aperta nel normale browser web.
 */

export const isInstalledPwa = (): boolean => {
  if (typeof window === 'undefined') return false;

  try {
    // 1. Standard CSS Media Query per modalità display standalone/fullscreen/minimal-ui
    if (
      window.matchMedia('(display-mode: standalone)').matches ||
      window.matchMedia('(display-mode: fullscreen)').matches ||
      window.matchMedia('(display-mode: minimal-ui)').matches
    ) {
      return true;
    }

    // 2. Proprietà nativa standalone per Safari su iPhone e iPad
    if ((window.navigator as any).standalone === true) {
      return true;
    }

    // 3. Referrer da WebAPK o Trusted Web Activity su Android
    if (document.referrer && document.referrer.includes('android-app://')) {
      return true;
    }

    // 4. Parametro query start_url configurato nel manifest.json (es. /?source=pwa)
    const urlParams = new URLSearchParams(window.location.search);
    if (
      urlParams.get('source') === 'pwa' ||
      urlParams.get('mode') === 'standalone' ||
      urlParams.get('pwa') === 'true'
    ) {
      return true;
    }
  } catch (err) {
    console.debug('Error detecting PWA standalone mode:', err);
  }

  return false;
};

/**
 * Aggiorna il pallino/badge numerico sull'icona della PWA installata (App Badging API)
 * Supportato su iOS (16.4+ PWA aggiunte alla Home), Android WebAPK e Desktop PWA.
 */
export const updatePwaAppBadge = async (count: number): Promise<void> => {
  if (typeof navigator === 'undefined') return;
  try {
    const nav = navigator as any;
    const safeCount = Math.max(0, Math.floor(count || 0));
    if (safeCount > 0) {
      if (typeof nav.setAppBadge === 'function') {
        await nav.setAppBadge(safeCount);
      }
    } else {
      if (typeof nav.clearAppBadge === 'function') {
        await nav.clearAppBadge();
      } else if (typeof nav.setAppBadge === 'function') {
        await nav.setAppBadge(0);
      }
    }
  } catch {
    // Browser/contesto senza supporto App Badging API: ignora silenziosamente
  }
};

