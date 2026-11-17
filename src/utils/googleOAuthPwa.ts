/**
 * JESic Meet - Google OAuth2 Redirect & Handoff per PWA (Apple iOS / Android)
 * 
 * Su iOS Home Screen PWA (modalità standalone), i popup OAuth (`ux_mode: 'popup'`)
 * vengono bloccati o perdono la comunicazione postMessage con window.opener
 * a causa dell'isolamento WebKit/SFSafariViewController.
 * 
 * Questo modulo implementa il flusso OAuth2 Authorization Code tramite redirect
 * con `access_type=offline` e `prompt=consent select_account` per garantire
 * sempre il rilascio del Google Refresh Token permanente e sincronizzare
 * l'account/calendario tra SFSafariViewController e la PWA installata.
 */

export const GOOGLE_CALENDAR_SCOPE =
  'openid email profile https://www.googleapis.com/auth/calendar.events.owned';

const PENDING_OAUTH_TX_KEY = 'jesic_pending_oauth_tx';
const TX_TTL_MS = 15 * 60 * 1000;

export interface GoogleOAuthStatePayload {
  flow: 'jesic_google_oauth';
  nonce: string;
  mode: 'login' | 'link_calendar';
  linkToUserId?: string;
  redirectUri?: string;
  fromPwa: boolean;
}

export interface PendingOAuthTransaction {
  nonce: string;
  mode: 'login' | 'link_calendar';
  linkToUserId?: string;
  redirectUri: string;
  startedAt: number;
}

function encodeStateBase64Url(obj: GoogleOAuthStatePayload): string {
  const json = JSON.stringify(obj);
  const bytes = new TextEncoder().encode(json);
  let binary = '';
  for (let i = 0; i < bytes.length; i++) {
    binary += String.fromCharCode(bytes[i]);
  }
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

export function decodeGoogleOAuthState(rawState: string | null): GoogleOAuthStatePayload | null {
  if (!rawState) return null;
  try {
    const b64 = rawState.replace(/-/g, '+').replace(/_/g, '/');
    const pad = '='.repeat((4 - (b64.length % 4)) % 4);
    const binary = atob(b64 + pad);
    const bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i++) {
      bytes[i] = binary.charCodeAt(i);
    }
    const json = new TextDecoder().decode(bytes);
    const parsed = JSON.parse(json);
    if (parsed && parsed.flow === 'jesic_google_oauth' && parsed.nonce) {
      return parsed as GoogleOAuthStatePayload;
    }
  } catch {
    // Non è uno state JESic
  }
  return null;
}

function createNonce(): string {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID();
  }
  return `jesic-${Date.now()}-${Math.random().toString(36).substring(2, 10)}`;
}

export async function resolveGoogleOAuthConfig(): Promise<{ clientId: string; redirectUri: string }> {
  const envClientId =
    (typeof import.meta !== 'undefined' && (import.meta as any).env?.VITE_GOOGLE_CLIENT_ID) ||
    '';

  let clientId = envClientId && envClientId !== 'jesic-meet-client-id' ? String(envClientId) : '';
  let redirectUri = typeof window !== 'undefined' ? window.location.origin : '';

  try {
    const res = await fetch('/api/auth/google/config', { cache: 'no-store' });
    if (res.ok) {
      const data = await res.json();
      if (!clientId && data?.clientId) {
        clientId = String(data.clientId);
      }
      if (data?.redirectUri && typeof window !== 'undefined') {
        try {
          const parsed = new URL(String(data.redirectUri), window.location.origin);
          if (parsed.origin === window.location.origin && parsed.href !== 'postmessage') {
            redirectUri = String(data.redirectUri).trim();
          }
        } catch {}
      }
    }
  } catch {}

  return { clientId, redirectUri };
}

export async function resolveGoogleClientId(): Promise<string> {
  const { clientId } = await resolveGoogleOAuthConfig();
  return clientId;
}

export function getPendingOAuthTransaction(): PendingOAuthTransaction | null {
  if (typeof window === 'undefined') return null;
  try {
    const raw = localStorage.getItem(PENDING_OAUTH_TX_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as PendingOAuthTransaction;
    if (!parsed?.nonce || Date.now() - (parsed.startedAt || 0) > TX_TTL_MS) {
      localStorage.removeItem(PENDING_OAUTH_TX_KEY);
      return null;
    }
    return parsed;
  } catch {
    return null;
  }
}

export function clearPendingOAuthTransaction(): void {
  if (typeof window === 'undefined') return;
  try {
    localStorage.removeItem(PENDING_OAUTH_TX_KEY);
  } catch {}
}

export async function startGoogleOAuthRedirect(options: {
  mode: 'login' | 'link_calendar';
  linkToUserId?: string;
  loginHint?: string;
  fromPwa?: boolean;
}): Promise<void> {
  const { clientId, redirectUri } = await resolveGoogleOAuthConfig();
  if (!clientId) {
    throw new Error('GOOGLE_CLIENT_ID non configurato sul server.');
  }

  const nonce = createNonce();
  const fromPwa = Boolean(options.fromPwa);

  const tx: PendingOAuthTransaction = {
    nonce,
    mode: options.mode,
    linkToUserId: options.linkToUserId,
    redirectUri,
    startedAt: Date.now(),
  };

  try {
    localStorage.setItem(PENDING_OAUTH_TX_KEY, JSON.stringify(tx));
  } catch {}

  const statePayload: GoogleOAuthStatePayload = {
    flow: 'jesic_google_oauth',
    nonce,
    mode: options.mode,
    linkToUserId: options.linkToUserId,
    redirectUri,
    fromPwa,
  };

  const params = new URLSearchParams({
    client_id: clientId,
    redirect_uri: redirectUri,
    response_type: 'code',
    scope: GOOGLE_CALENDAR_SCOPE,
    access_type: 'offline',
    prompt: 'consent select_account',
    include_granted_scopes: 'true',
    state: encodeStateBase64Url(statePayload),
  });

  if (options.loginHint) {
    params.set('login_hint', options.loginHint);
  }

  window.location.assign(`https://accounts.google.com/o/oauth2/v2/auth?${params.toString()}`);
}
