/**
 * JESic Meet - Chat Cache & Pre-fetch Service
 * 
 * - Gestione cache sincrona in memoria (0ms render) + persistenza in localStorage
 * - Pre-fetch in background all'ingresso nel gruppo (elimina qualsiasi caricamento lento)
 * - Riconciliazione ottimistica dei messaggi inviati
 * - Formattazione divisori di data in stile WhatsApp ("Oggi", "Ieri", Giorno, Data)
 */

import { ChatMessage } from '../types';

export interface ChatCacheEntry {
  messages: ChatMessage[];
  hasMore: boolean;
  nextCursor?: string | null;
  lastUpdated: number;
}

// Cache sincrona in memoria per render immediato (0 millisecondi)
const memoryCache = new Map<string, ChatCacheEntry>();

export function getChatCacheKey(groupId: string, subgroupId?: string | null): string {
  const cleanSub =
    subgroupId && subgroupId !== 'null' && subgroupId !== 'undefined' && String(subgroupId).trim() !== ''
      ? String(subgroupId).trim()
      : 'root';
  return `jesic_chat_${groupId}_${cleanSub}`;
}

/**
 * Recupera i messaggi dalla cache (memoria prima, poi localStorage)
 */
export function getCachedChat(groupId: string, subgroupId?: string | null): ChatCacheEntry | null {
  const key = getChatCacheKey(groupId, subgroupId);

  // 1. Memoria (istantaneo, 0 millisecondi)
  if (memoryCache.has(key)) {
    return memoryCache.get(key)!;
  }

  // 2. localStorage
  if (typeof window !== 'undefined') {
    try {
      const raw = localStorage.getItem(key);
      if (raw) {
        const parsed = JSON.parse(raw);
        if (parsed && Array.isArray(parsed.messages)) {
          const entry: ChatCacheEntry = {
            messages: parsed.messages,
            hasMore: Boolean(parsed.hasMore),
            nextCursor: parsed.nextCursor || null,
            lastUpdated: parsed.lastUpdated || Date.now(),
          };
          memoryCache.set(key, entry);
          return entry;
        }
      }
    } catch {
      // Ignore JSON parse error
    }
  }

  return null;
}

/**
 * Salva i messaggi in cache (memoria e localStorage)
 */
export function setCachedChat(
  groupId: string,
  subgroupId: string | null | undefined,
  data: { messages: ChatMessage[]; hasMore?: boolean; nextCursor?: string | null }
): void {
  const key = getChatCacheKey(groupId, subgroupId);
  const entry: ChatCacheEntry = {
    messages: data.messages,
    hasMore: Boolean(data.hasMore),
    nextCursor: data.nextCursor || null,
    lastUpdated: Date.now(),
  };

  memoryCache.set(key, entry);

  if (typeof window !== 'undefined') {
    try {
      // Salva al massimo gli ultimi 100 messaggi in localStorage per non saturare lo storage
      const toPersist = {
        messages: entry.messages.slice(-100),
        hasMore: entry.hasMore,
        nextCursor: entry.nextCursor,
        lastUpdated: entry.lastUpdated,
      };
      localStorage.setItem(key, JSON.stringify(toPersist));
    } catch (err) {
      console.warn('[ChatCache] Errore salvataggio localStorage:', err);
    }
  }
}

/**
 * Aggiunge o aggiorna un messaggio nella cache (per Optimistic UI e WebSocket)
 */
export function updateMessageInCache(
  groupId: string,
  subgroupId: string | null | undefined,
  message: ChatMessage,
  tempIdToReplace?: string
): void {
  const cached = getCachedChat(groupId, subgroupId);
  const currentMessages = cached ? [...cached.messages] : [];

  let updatedMessages: ChatMessage[];
  if (tempIdToReplace) {
    const idx = currentMessages.findIndex((m) => m.id === tempIdToReplace);
    if (idx >= 0) {
      currentMessages[idx] = message;
      updatedMessages = currentMessages;
    } else {
      updatedMessages = [...currentMessages.filter((m) => m.id !== message.id), message];
    }
  } else {
    const existingIdx = currentMessages.findIndex((m) => m.id === message.id);
    if (existingIdx >= 0) {
      currentMessages[existingIdx] = { ...currentMessages[existingIdx], ...message };
      updatedMessages = currentMessages;
    } else {
      updatedMessages = [...currentMessages, message];
    }
  }

  setCachedChat(groupId, subgroupId, {
    messages: updatedMessages,
    hasMore: cached?.hasMore,
    nextCursor: cached?.nextCursor,
  });
}

/**
 * Rimuove un messaggio dalla cache
 */
export function removeMessageFromCache(
  groupId: string,
  subgroupId: string | null | undefined,
  messageId: string
): void {
  const cached = getCachedChat(groupId, subgroupId);
  if (!cached) return;

  const nextMessages = cached.messages.filter((m) => m.id !== messageId);
  setCachedChat(groupId, subgroupId, {
    messages: nextMessages,
    hasMore: cached.hasMore,
    nextCursor: cached.nextCursor,
  });
}

/**
 * Pre-carica silenziosamente in background i messaggi della chat di un gruppo / sottogruppo.
 * Se la cache ha già messaggi, usa una richiesta delta (?after=...) ultra-leggera in modo
 * da non riscaricare ogni volta tutti i messaggi ma solo gli eventuali nuovi!
 */
export async function prefetchChat(
  groupId: string,
  subgroupId?: string | null
): Promise<ChatMessage[]> {
  try {
    const cleanSub =
      subgroupId && subgroupId !== 'null' && subgroupId !== 'undefined' && String(subgroupId).trim() !== ''
        ? String(subgroupId).trim()
        : null;

    const cached = getCachedChat(groupId, cleanSub);
    const lastMsg = cached?.messages && cached.messages.length > 0
      ? cached.messages[cached.messages.length - 1]
      : null;

    let url: string;
    if (lastMsg?.createdAt) {
      // Delta sync ultra-leggero (1-2 ms): scarica solo se sono arrivati nuovi messaggi
      url = cleanSub
        ? `/api/groups/${groupId}/chat?subgroupId=${encodeURIComponent(cleanSub)}&after=${encodeURIComponent(lastMsg.createdAt)}`
        : `/api/groups/${groupId}/chat?after=${encodeURIComponent(lastMsg.createdAt)}`;
    } else {
      url = cleanSub
        ? `/api/groups/${groupId}/chat?subgroupId=${encodeURIComponent(cleanSub)}&limit=50`
        : `/api/groups/${groupId}/chat?limit=50`;
    }

    const res = await fetch(url);
    if (res.ok) {
      const data = await res.json();
      if (data && Array.isArray(data.messages)) {
        if (data.isDelta) {
          if (data.messages.length > 0) {
            // Evita duplicazioni
            const existingIds = new Set((cached?.messages || []).map((m) => m.id));
            const newOnly = data.messages.filter((m: any) => !existingIds.has(m.id));
            if (newOnly.length > 0) {
              const combined = [...(cached?.messages || []), ...newOnly];
              setCachedChat(groupId, cleanSub, {
                messages: combined,
                hasMore: cached?.hasMore,
                nextCursor: cached?.nextCursor,
              });
              return combined;
            }
          }
          return cached?.messages || [];
        } else {
          setCachedChat(groupId, cleanSub, {
            messages: data.messages,
            hasMore: Boolean(data.hasMore),
            nextCursor: data.nextCursor,
          });
          return data.messages;
        }
      }
    }
  } catch (err) {
    // Fail silently in background
  }
  return [];
}

/**
 * Pre-carica in background le chat di tutti i gruppi dell'utente appena effettua l'accesso e carica i gruppi
 */
export async function prefetchAllUserGroupsChats(groups: any[]): Promise<void> {
  if (!Array.isArray(groups) || groups.length === 0) return;

  // Esegue in background senza intasare il thread principale
  setTimeout(() => {
    groups.forEach((g) => {
      if (g && g.id) {
        prefetchChat(g.id, null);
      }
    });
  }, 150);
}

/**
 * Estrae una chiave univoca di giorno (YYYY-MM-DD) per raggruppare i messaggi per data
 */
export function getMessageDateKey(isoString?: string): string {
  if (!isoString) return '';
  try {
    const d = new Date(isoString);
    if (isNaN(d.getTime())) return '';
    const year = d.getFullYear();
    const month = String(d.getMonth() + 1).padStart(2, '0');
    const day = String(d.getDate()).padStart(2, '0');
    return `${year}-${month}-${day}`;
  } catch {
    return '';
  }
}

/**
 * Logica WhatsApp in italiano per i divisori di data:
 * - Oggi
 * - Ieri
 * - Negli ultimi 6 giorni: nome del giorno ("Lunedì", "Martedì", ecc.)
 * - Più vecchio: data formattata in italiano (es. "24 Ottobre 2026")
 */
export function getMessageDateLabel(isoString?: string): string {
  if (!isoString) return '';
  try {
    const d = new Date(isoString);
    if (isNaN(d.getTime())) return '';

    const now = new Date();
    const targetDate = new Date(d.getFullYear(), d.getMonth(), d.getDate());
    const todayDate = new Date(now.getFullYear(), now.getMonth(), now.getDate());

    const diffMs = todayDate.getTime() - targetDate.getTime();
    const diffDays = Math.round(diffMs / (1000 * 60 * 60 * 24));

    if (diffDays === 0) {
      return 'Oggi';
    }
    if (diffDays === 1) {
      return 'Ieri';
    }
    if (diffDays > 1 && diffDays <= 6) {
      const weekday = new Intl.DateTimeFormat('it-IT', { weekday: 'long' }).format(d);
      return weekday.charAt(0).toUpperCase() + weekday.slice(1);
    }

    const day = d.getDate();
    const month = new Intl.DateTimeFormat('it-IT', { month: 'long' }).format(d);
    const capitalizedMonth = month.charAt(0).toUpperCase() + month.slice(1);
    const year = d.getFullYear();

    return `${day} ${capitalizedMonth} ${year}`;
  } catch {
    return '';
  }
}
