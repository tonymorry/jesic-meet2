/**
 * JESic Meet - GroupChatView (Chat avanzata in stile WhatsApp)
 * 
 * - Chat persistita in tempo reale su MongoDB per Gruppo Generale e Sottogruppi
 * - Invio messaggi di testo
 * - Invio Immagini (con anteprima e lightbox zoom)
 * - Invio Note Vocali / Audio (registratore vocale con microfono + timer live, riproduzione in bolla)
 * - Invio File / Documenti (con icona, nome, peso in KB/MB e download)
 * - Richiamo / Risposta ai messaggi (Quote / Reply stile WhatsApp con scroll al messaggio citato)
 */

import React, { useState, useEffect, useRef, useLayoutEffect, useMemo } from 'react';
import { Group, Subgroup, User, ChatMessage, ChatAttachment, ChatReplyTo, ChatReadReceipt } from '../types';
import { UserAvatar } from './UserAvatar';
import { useRealtimeSubscription } from '../utils/realtime';
import {
  Send,
  MessageSquare,
  FolderOpen,
  Clock,
  Paperclip,
  Image as ImageIcon,
  Mic,
  Square,
  Trash2,
  X,
  CornerUpLeft,
  Download,
  FileText,
  Play,
  Pause,
  Volume2,
  CheckCheck,
  Maximize2,
  Edit2,
  Check,
  ArrowLeft,
  Copy,
  Loader2,
  Info,
} from 'lucide-react';
import {
  getCachedChat,
  setCachedChat,
  updateMessageInCache,
  removeMessageFromCache,
  getMessageDateKey,
  getMessageDateLabel,
  isChatMessageExpired,
} from '../utils/chatCache';
import { optimizeImageToUltraLight } from '../utils/imageOptimizer';

/**
 * Rileva il miglior formato audio supportato dal browser per la registrazione vocale.
 * Su iPhone/iOS e Safari predilige 'audio/mp4' (AAC), mentre su Chrome/Android 'audio/webm;codecs=opus'.
 */
const getBestAudioMimeType = (): string => {
  if (typeof MediaRecorder === 'undefined' || !MediaRecorder.isTypeSupported) {
    return '';
  }
  const candidates = [
    'audio/mp4;codecs=mp4a.40.2',
    'audio/mp4',
    'audio/aac',
    'audio/webm;codecs=opus',
    'audio/webm',
    'audio/ogg;codecs=opus',
    'audio/wav',
  ];
  for (const candidate of candidates) {
    if (MediaRecorder.isTypeSupported(candidate)) {
      return candidate;
    }
  }
  return '';
};

/**
 * Converte in modo sicuro una stringa data URL (base64) in un oggetto Blob reale.
 * Fondamentale per Safari/iOS che non supporta data URL lunghe con new Audio().
 */
const base64ToBlob = (base64DataUrl: string): Blob => {
  try {
    const parts = base64DataUrl.split(',');
    const mimeMatch = parts[0]?.match(/:(.*?);/);
    const mime = mimeMatch ? mimeMatch[1] : 'audio/mp4';
    const base64Str = parts[1] || parts[0];
    const byteCharacters = atob(base64Str);
    const byteNumbers = new Array(byteCharacters.length);
    for (let i = 0; i < byteCharacters.length; i++) {
      byteNumbers[i] = byteCharacters.charCodeAt(i);
    }
    const byteArray = new Uint8Array(byteNumbers);
    return new Blob([byteArray], { type: mime });
  } catch (err) {
    console.warn('Errore conversione base64ToBlob:', err);
    return new Blob([], { type: 'audio/mp4' });
  }
};

/**
 * Rimpicciolisce e comprime automaticamente qualsiasi immagine entro 40-50 KB
 * garantendo risparmio massimo sul limite di 500 MB del database senza perdita visiva su mobile.
 */
const compressAndOptimizeImage = async (file: File): Promise<{ url: string; size: number }> => {
  return await optimizeImageToUltraLight(file, {
    maxDimension: 900,
    targetMaxKB: 50,
  });
};

export interface GroupChatViewProps {
  activeGroup: Group;
  activeSubgroup: Subgroup | null;
  currentUser: User;
  allUsers?: User[];
  onBackToDashboard?: () => void;
}

export const GroupChatView: React.FC<GroupChatViewProps> = ({
  activeGroup,
  activeSubgroup,
  currentUser,
  allUsers = [],
  onBackToDashboard,
}) => {
  const subgroupId = activeSubgroup ? activeSubgroup.id : null;
  const contextName = activeSubgroup ? activeSubgroup.name : `${activeGroup.name} (Generale)`;
  const chatColor = activeSubgroup?.color || (activeSubgroup ? '#8b5cf6' : '#f23e2e');

  // Inizializzazione sincrona istantanea da Cache in memoria o localStorage (0 millisecondi)
  const initialCached = getCachedChat(activeGroup.id, subgroupId);
  const [messages, setMessages] = useState<ChatMessage[]>(() =>
    (initialCached?.messages || []).filter((m) => !isChatMessageExpired(m.createdAt))
  );
  const [hasMore, setHasMore] = useState<boolean>(() => Boolean(initialCached?.hasMore));
  const [nextCursor, setNextCursor] = useState<string | null>(() => initialCached?.nextCursor || null);
  const [isLoading, setIsLoading] = useState<boolean>(
    () => !initialCached || (initialCached.messages || []).filter((m) => !isChatMessageExpired(m.createdAt)).length === 0
  );
  const [isLoadingOlder, setIsLoadingOlder] = useState(false);

  // Messaggi attivi deduplicati e non scaduti (garantisce zero duplicati visivi e scadenza a 50 giorni)
  const activeMessages = React.useMemo(() => {
    const valid = messages.filter((m) => !isChatMessageExpired(m.createdAt));
    const seenIds = new Set<string>();
    const seenClientMsgIds = new Set<string>();
    const deduplicated: ChatMessage[] = [];

    for (const m of valid) {
      if (!m || !m.id) continue;

      // Se è un messaggio provvisorio (msg-opt-), verifica se nella lista c'è già il messaggio reale corrispondente
      if (m.id.startsWith('msg-opt-')) {
        const hasRealCounterpart = valid.some(
          (other) =>
            other.id !== m.id &&
            !other.id.startsWith('msg-opt-') &&
            ((other.clientMessageId && other.clientMessageId === m.id) ||
              (other.authorId === m.authorId &&
                other.content === m.content &&
                Math.abs(new Date(other.createdAt).getTime() - new Date(m.createdAt).getTime()) < 20000))
        );
        if (hasRealCounterpart) {
          continue; // Salta la bolla provvisoria: il messaggio reale del server è già visualizzato
        }
      }

      if (seenIds.has(m.id)) continue;
      seenIds.add(m.id);

      if (m.clientMessageId) {
        if (seenClientMsgIds.has(m.clientMessageId)) continue;
        seenClientMsgIds.add(m.clientMessageId);
      }

      deduplicated.push(m);
    }

    return deduplicated;
  }, [messages]);

  const [inputText, setInputText] = useState('');
  const [isSending, setIsSending] = useState(false);

  // Modifica e Cancellazione Messaggio (Stile WhatsApp - Elimina per tutti)
  const [editingMessageId, setEditingMessageId] = useState<string | null>(null);
  const [editingText, setEditingText] = useState('');
  const [isSavingEdit, setIsSavingEdit] = useState(false);
  const [deletingMessageId, setDeletingMessageId] = useState<string | null>(null);

  // Risposta / Richiamo a un messaggio (WhatsApp Quote)
  const [replyingTo, setReplyingTo] = useState<ChatMessage | null>(null);

  // Selezione Messaggio per Pressione Prolungata (Long Press stile WhatsApp su smartphone)
  const [selectedMessage, setSelectedMessage] = useState<ChatMessage | null>(null);
  const [infoModalMessage, setInfoModalMessage] = useState<ChatMessage | null>(null);
  const [copiedToast, setCopiedToast] = useState(false);
  const longPressTimerRef = useRef<NodeJS.Timeout | null>(null);
  const touchStartPosRef = useRef<{ x: number; y: number } | null>(null);
  const isLongPressActiveRef = useRef(false);
  const pendingMarkReadIdsRef = useRef<Set<string>>(new Set());
  const lastSendTimeRef = useRef<number>(0);

  // Elenco partecipanti effettivi della conversazione (Gruppo Generale o Sottogruppo)
  const targetMemberIds = useMemo<string[]>(() => {
    const groupMemberIds = (activeGroup.members || []).map((m: any) =>
      typeof m === 'string' ? m : m.userId
    );
    if (activeSubgroup) {
      const subMembers = Array.isArray(activeSubgroup.members) ? activeSubgroup.members : [];
      if (activeSubgroup.isPublic) {
        return Array.from(
          new Set(
            [
              activeGroup.creatorId,
              ...groupMemberIds,
              activeSubgroup.createdBy,
              ...subMembers,
            ].filter(Boolean)
          )
        );
      }
      return Array.from(
        new Set([activeSubgroup.createdBy, ...subMembers].filter(Boolean))
      );
    }
    return Array.from(new Set([activeGroup.creatorId, ...groupMemberIds].filter(Boolean)));
  }, [activeGroup.creatorId, activeGroup.members, activeSubgroup]);

  // Formattazione data e ora per ricevute di lettura in stile WhatsApp
  const formatReceiptDateTime = (isoString?: string) => {
    if (!isoString) return '';
    try {
      const d = new Date(isoString);
      const now = new Date();
      const isToday = d.toDateString() === now.toDateString();
      const timeStr = new Intl.DateTimeFormat('it-IT', {
        hour: '2-digit',
        minute: '2-digit',
      }).format(d);

      if (isToday) {
        return `Oggi alle ${timeStr}`;
      }
      const yesterday = new Date();
      yesterday.setDate(now.getDate() - 1);
      if (d.toDateString() === yesterday.toDateString()) {
        return `Ieri alle ${timeStr}`;
      }
      const dateStr = new Intl.DateTimeFormat('it-IT', {
        day: '2-digit',
        month: '2-digit',
        year: 'numeric',
      }).format(d);
      return `${dateStr} alle ${timeStr}`;
    } catch {
      return '';
    }
  };

  // Ruolo per moderazione
  const isGroupAdmin =
    activeGroup.creatorId === currentUser.id ||
    activeGroup.members?.some((m) => m.userId === currentUser.id && m.role === 'admin');

  // Allegato in preparazione & Stato Compressione
  const [pendingAttachment, setPendingAttachment] = useState<ChatAttachment | null>(null);
  const [isOptimizingImage, setIsOptimizingImage] = useState(false);

  // Registrazione Audio / Nota Vocale (con timestamp preciso)
  const [isRecording, setIsRecording] = useState(false);
  const [recordingSeconds, setRecordingSeconds] = useState(0);
  const recordingStartTimeRef = useRef<number>(0);
  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const audioChunksRef = useRef<Blob[]>([]);
  const recordingTimerRef = useRef<any>(null);

  // Riproduzione Audio in-chat (supporto universale iOS Safari + Android + Web Audio fallback)
  const [playingAudioId, setPlayingAudioId] = useState<string | null>(null);
  const audioPlayerRef = useRef<HTMLAudioElement | null>(null);
  const [audioProgress, setAudioProgress] = useState(0);
  const audioBlobUrlsCache = useRef<Map<string, string>>(new Map());
  const webAudioContextRef = useRef<AudioContext | null>(null);
  const webAudioSourceRef = useRef<AudioBufferSourceNode | null>(null);
  const webAudioAnimRef = useRef<any>(null);

  // Anteprima Immagine a schermo intero (Lightbox)
  const [previewImage, setPreviewImage] = useState<{ url: string; name?: string } | null>(null);

  const fileInputRef = useRef<HTMLInputElement>(null);
  const imageInputRef = useRef<HTMLInputElement>(null);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const messagesContainerRef = useRef<HTMLDivElement>(null);

  const initialScrollDoneRef = useRef(false);
  const previousMessagesLengthRef = useRef(0);
  const isAtBottomRef = useRef(true);

  // Calcolo percorso gerarchico per la chat (Gruppo ➔ Sottogruppo ➔ Sotto-sottogruppo...)
  const chatBreadcrumbs: string[] = [activeGroup.name];
  if (activeSubgroup) {
    const chain: string[] = [];
    let curr: any = activeSubgroup;
    const visited = new Set<string>();
    while (curr && !visited.has(curr.id)) {
      visited.add(curr.id);
      chain.unshift(curr.name);
      if (curr.parentId) {
        curr = activeGroup.subgroups?.find((s) => s.id === curr!.parentId);
      } else {
        curr = undefined;
      }
    }
    chain.forEach((name) => chatBreadcrumbs.push(name));
  }

  // Caricamento silenzioso e sincronizzazione in background con MongoDB (Delta Sync basato su after)
  const fetchMessages = async (forceFull: boolean = false) => {
    try {
      const cached = getCachedChat(activeGroup.id, subgroupId);
      const lastMsg = !forceFull && cached?.messages && cached.messages.length > 0
        ? cached.messages[cached.messages.length - 1]
        : null;

      let url: string;
      if (lastMsg?.createdAt) {
        // Delta sync ultra-leggero (1-2 ms): scarica SOLO i nuovi messaggi successivi all'ultimo messaggio in cache
        url = subgroupId
          ? `/api/groups/${activeGroup.id}/chat?subgroupId=${encodeURIComponent(subgroupId)}&after=${encodeURIComponent(lastMsg.createdAt)}`
          : `/api/groups/${activeGroup.id}/chat?after=${encodeURIComponent(lastMsg.createdAt)}`;
      } else {
        url = subgroupId
          ? `/api/groups/${activeGroup.id}/chat?subgroupId=${encodeURIComponent(subgroupId)}&limit=50`
          : `/api/groups/${activeGroup.id}/chat?limit=50`;
      }

      const res = await fetch(url);
      if (res.ok) {
        const data = await res.json();
        if (data && Array.isArray(data.messages)) {
          if (data.isDelta) {
            if (data.messages.length > 0) {
              setMessages((prev) => {
                // Sostituisci eventuali messaggi provvisori con i messaggi reali corrispondenti
                const replaced = prev.map((m) => {
                  if (!m.id.startsWith('msg-opt-')) return m;
                  const match = data.messages.find(
                    (sm: any) =>
                      (sm.clientMessageId && sm.clientMessageId === m.id) ||
                      (sm.authorId === m.authorId && sm.content === m.content)
                  );
                  return match || m;
                });

                const existingIds = new Set(replaced.map((m) => m.id));
                const newOnly = data.messages.filter((m: any) => !existingIds.has(m.id));
                const merged = [...replaced, ...newOnly];

                // Deduplica rigorosamente per ID univoco
                const seen = new Set<string>();
                const deduped = merged.filter((m) => {
                  if (!m || !m.id || seen.has(m.id)) return false;
                  seen.add(m.id);
                  return true;
                });

                setCachedChat(activeGroup.id, subgroupId, {
                  messages: deduped,
                  hasMore: cached?.hasMore,
                  nextCursor: cached?.nextCursor,
                });
                return deduped;
              });
            }
          } else {
            setMessages((prev) => {
              // Preserva i messaggi ottimistici in corso di invio non ancora confermati dal server
              const pendingOptimistic = prev.filter((m) => m.id.startsWith('msg-opt-'));
              const unconfirmed = pendingOptimistic.filter(
                (opt) =>
                  !data.messages.some(
                    (sm: any) =>
                      sm.id === opt.id ||
                      (sm.clientMessageId && sm.clientMessageId === opt.id) ||
                      (sm.authorId === opt.authorId && sm.content === opt.content)
                  )
              );
              const all = [...data.messages, ...unconfirmed];

              // Deduplica per ID
              const seen = new Set<string>();
              const deduped = all.filter((m) => {
                if (!m || !m.id || seen.has(m.id)) return false;
                seen.add(m.id);
                return true;
              });

              setCachedChat(activeGroup.id, subgroupId, {
                messages: deduped,
                hasMore: Boolean(data.hasMore),
                nextCursor: data.nextCursor,
              });
              return deduped;
            });
            setHasMore(Boolean(data.hasMore));
            setNextCursor(data.nextCursor || null);
          }
        }
      }
    } catch (err) {
      console.warn('Errore lettura chat MongoDB:', err);
    } finally {
      setIsLoading(false);
    }
  };

  // Polling leggero delta sync ogni 6 secondi per garantire aggiornamenti istantanei ovunque
  useEffect(() => {
    const timer = setInterval(() => {
      fetchMessages();
    }, 6000);
    return () => clearInterval(timer);
  }, [activeGroup.id, subgroupId]);

  // Caricamento paginato dei messaggi più vecchi (quando si scorre in alto)
  const loadOlderMessages = async () => {
    if (isLoadingOlder || !hasMore || !nextCursor) return;
    setIsLoadingOlder(true);

    const container = messagesContainerRef.current;
    const previousScrollHeight = container?.scrollHeight || 0;
    const previousScrollTop = container?.scrollTop || 0;

    try {
      const url = subgroupId
        ? `/api/groups/${activeGroup.id}/chat?subgroupId=${encodeURIComponent(subgroupId)}&limit=50&before=${encodeURIComponent(nextCursor)}`
        : `/api/groups/${activeGroup.id}/chat?limit=50&before=${encodeURIComponent(nextCursor)}`;
      
      const res = await fetch(url);
      if (res.ok) {
        const data = await res.json();
        if (data && Array.isArray(data.messages) && data.messages.length > 0) {
          setMessages((prev) => {
            const existingIds = new Set(prev.map((m) => m.id));
            const olderNew = data.messages.filter((m: any) => !existingIds.has(m.id));
            const nextList = [...olderNew, ...prev];
            setCachedChat(activeGroup.id, subgroupId, {
              messages: nextList,
              hasMore: Boolean(data.hasMore),
              nextCursor: data.nextCursor,
            });
            return nextList;
          });
          setHasMore(Boolean(data.hasMore));
          setNextCursor(data.nextCursor || null);

          // Ripristina la posizione dello scroll senza salti improvvisi
          requestAnimationFrame(() => {
            if (container) {
              const newScrollHeight = container.scrollHeight;
              container.scrollTop = previousScrollTop + (newScrollHeight - previousScrollHeight);
            }
          });
        } else {
          setHasMore(false);
        }
      }
    } catch (err) {
      console.warn('Errore caricamento messaggi precedenti:', err);
    } finally {
      setIsLoadingOlder(false);
    }
  };

  // Cambio di gruppo o sottogruppo: legge subito dalla cache in 0ms senza schermate lente
  useEffect(() => {
    const cached = getCachedChat(activeGroup.id, subgroupId);
    const validCached = (cached?.messages || []).filter((m) => !isChatMessageExpired(m.createdAt));
    if (validCached.length > 0) {
      setMessages(validCached);
      setHasMore(cached?.hasMore || false);
      setNextCursor(cached?.nextCursor || null);
      setIsLoading(false);
    } else {
      setMessages([]);
      setHasMore(false);
      setNextCursor(null);
      setIsLoading(true);
    }
    initialScrollDoneRef.current = false;
    fetchMessages();
  }, [activeGroup.id, subgroupId]);

  // Ascolto real-time via WebSocket: Nuovi messaggi con isolamento rigoroso
  useRealtimeSubscription('chat:message_created', (payload) => {
    if (!payload || payload.groupId !== activeGroup.id) return;

    const currentSub = subgroupId ? String(subgroupId).trim() : null;
    const msgSub = payload.subgroupId && payload.subgroupId !== 'null' ? String(payload.subgroupId).trim() : null;

    if (currentSub !== msgSub) return;

    if (payload.message) {
      setMessages((prev) => {
        // Se il messaggio con ID reale è già presente, ignora (nessuna duplicazione)
        if (prev.some((m) => m.id === payload.message.id)) {
          return prev;
        }

        // Cerca se esiste una bolla provvisoria corrispondente a questo messaggio inviato
        const optIdx = prev.findIndex(
          (m) =>
            (payload.message.clientMessageId && m.id === payload.message.clientMessageId) ||
            (m.id.startsWith('msg-opt-') &&
              m.authorId === payload.message.authorId &&
              m.content === payload.message.content)
        );

        let next: ChatMessage[];
        if (optIdx >= 0) {
          next = [...prev];
          next[optIdx] = payload.message;
        } else {
          next = [...prev, payload.message];
        }

        // Deduplica rigorosamente per ID univoco
        const seen = new Set<string>();
        const deduped = next.filter((m) => {
          if (!m || !m.id || seen.has(m.id)) return false;
          seen.add(m.id);
          return true;
        });

        updateMessageInCache(activeGroup.id, currentSub, payload.message, payload.message.clientMessageId || undefined);
        return deduped;
      });
    }
  });

  // Ascolto real-time: Messaggio modificato
  useRealtimeSubscription('chat:message_updated', (payload) => {
    if (!payload || payload.groupId !== activeGroup.id) return;
    const currentSub = subgroupId ? String(subgroupId).trim() : null;
    const msgSub = payload.subgroupId && payload.subgroupId !== 'null' ? String(payload.subgroupId).trim() : null;

    if (currentSub !== msgSub) return;

    if (payload.message) {
      setMessages((prev) => {
        const next = prev.map((m) => (m.id === payload.message.id ? { ...m, ...payload.message } : m));
        updateMessageInCache(activeGroup.id, currentSub, payload.message);
        return next;
      });
    }
  });

  // Ascolto real-time: Messaggio cancellato per tutti
  useRealtimeSubscription('chat:message_deleted', (payload) => {
    if (!payload || payload.groupId !== activeGroup.id) return;
    if (payload.messageId) {
      const currentSub = subgroupId ? String(subgroupId).trim() : null;
      setMessages((prev) => prev.filter((m) => m.id !== payload.messageId));
      removeMessageFromCache(activeGroup.id, currentSub, payload.messageId);
    }
  });

  // Ascolto real-time: Ricevute di lettura messaggi (Doppia spunta blu istantanea stile WhatsApp)
  useRealtimeSubscription('chat:messages_read', (payload) => {
    if (!payload || payload.groupId !== activeGroup.id) return;
    const currentSub = subgroupId ? String(subgroupId).trim() : null;
    const msgSub = payload.subgroupId && payload.subgroupId !== 'null' ? String(payload.subgroupId).trim() : null;
    if (currentSub !== msgSub) return;

    setMessages((prev) => {
      let hasChanged = false;
      const updated = prev.map((msg) => {
        if (
          Array.isArray(payload.messageIds) &&
          payload.messageIds.length > 0 &&
          !payload.messageIds.includes(msg.id)
        ) {
          return msg;
        }
        const existingRead = Array.isArray(msg.readBy) ? msg.readBy : [];
        if (existingRead.some((r) => r.userId === payload.userId)) {
          return msg;
        }
        hasChanged = true;
        const newReadBy = [...existingRead, { userId: payload.userId, readAt: payload.readAt }];
        const nextMsg = { ...msg, readBy: newReadBy };
        updateMessageInCache(activeGroup.id, currentSub, nextMsg);
        return nextMsg;
      });

      if (hasChanged && infoModalMessage) {
        const refreshedInfo = updated.find((m) => m.id === infoModalMessage.id);
        if (refreshedInfo) setInfoModalMessage(refreshedInfo);
      }

      return hasChanged ? updated : prev;
    });
  });

  // Segna automaticamente come letti i messaggi ricevuti quando la chat è aperta
  useEffect(() => {
    if (!currentUser?.id || messages.length === 0) return;

    const unreadMsgIds = messages
      .filter(
        (m) =>
          !m.id.startsWith('msg-opt-') &&
          m.authorId !== currentUser.id &&
          !m.readBy?.some((r) => r.userId === currentUser.id)
      )
      .map((m) => m.id)
      .filter((id) => !pendingMarkReadIdsRef.current.has(id));

    if (unreadMsgIds.length === 0) return;

    unreadMsgIds.forEach((id) => pendingMarkReadIdsRef.current.add(id));

    // Chiamata backend per registrare la lettura
    fetch(`/api/groups/${activeGroup.id}/chat/mark-read`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        subgroupId: subgroupId || undefined,
        userId: currentUser.id,
        messageIds: unreadMsgIds,
      }),
    }).catch((err) => console.warn('[Chat] Errore invio mark-read:', err));

    // Aggiornamento ottimistico locale
    const now = new Date().toISOString();
    setMessages((prev) =>
      prev.map((msg) => {
        if (unreadMsgIds.includes(msg.id)) {
          const existing = Array.isArray(msg.readBy) ? msg.readBy : [];
          if (!existing.some((r) => r.userId === currentUser.id)) {
            const nextMsg = {
              ...msg,
              readBy: [...existing, { userId: currentUser.id, readAt: now }],
            };
            updateMessageInCache(activeGroup.id, subgroupId, nextMsg);
            return nextMsg;
          }
        }
        return msg;
      })
    );
  }, [messages, currentUser?.id, activeGroup.id, subgroupId]);

  // Gestione scroll della vista messaggi
  const handleContainerScroll = () => {
    const el = messagesContainerRef.current;
    if (!el) return;
    const distanceToBottom = el.scrollHeight - el.scrollTop - el.clientHeight;
    isAtBottomRef.current = distanceToBottom < 120;

    // Se l'utente scorre in cima alla chat, carica i messaggi più vecchi
    if (el.scrollTop < 25 && hasMore && !isLoadingOlder) {
      loadOlderMessages();
    }
  };

  // Posizionamento istantaneo (0 ms) sull'ultimo messaggio con useLayoutEffect prima del paint a schermo
  useLayoutEffect(() => {
    if (messages.length === 0) return;

    if (!initialScrollDoneRef.current) {
      initialScrollDoneRef.current = true;
      if (messagesContainerRef.current) {
        messagesContainerRef.current.scrollTop = messagesContainerRef.current.scrollHeight;
        try {
          messagesContainerRef.current.scrollTo({
            top: messagesContainerRef.current.scrollHeight,
            behavior: 'instant' as ScrollBehavior,
          });
        } catch {}
      }
      previousMessagesLengthRef.current = messages.length;
      return;
    }

    // Per nuovi messaggi arrivati: scroll fluido solo se l'utente era già in fondo
    if (messages.length > previousMessagesLengthRef.current) {
      if (isAtBottomRef.current) {
        requestAnimationFrame(() => {
          messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
        });
      }
    }

    previousMessagesLengthRef.current = messages.length;
  }, [messages.length]);

  // Gestione Selezione Immagine con Compressione Automatica per Smartphone (anche foto 48MP o 20MB)
  const handleImageSelect = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    // Reset input così da poter selezionare la stessa foto se necessario
    e.target.value = '';

    // Accetta file anche fino a 50MB (scatti ad altissima risoluzione da fotocamera)
    if (file.size > 50 * 1024 * 1024) {
      alert("Il file immagine non può superare 50MB.");
      return;
    }

    setIsOptimizingImage(true);
    try {
      const { url, size } = await compressAndOptimizeImage(file);
      setPendingAttachment({
        type: 'image',
        url,
        name: file.name.replace(/\.[^/.]+$/, '') + '.jpg',
        size,
      });
    } catch (err) {
      console.error('Errore elaborazione immagine:', err);
      alert('Impossibile elaborare questa immagine. Riprova con un altro scatto.');
    } finally {
      setIsOptimizingImage(false);
    }
  };

  // Gestione Selezione File / Documento
  const handleFileSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    if (file.size > 30 * 1024 * 1024) {
      alert('Il file non può superare 30MB.');
      return;
    }

    const reader = new FileReader();
    reader.onload = (event) => {
      const url = event.target?.result as string;
      setPendingAttachment({
        type: 'file',
        url,
        name: file.name,
        size: file.size,
      });
    };
    reader.readAsDataURL(file);
    e.target.value = '';
  };

  // Registrazione Vocale (MediaRecorder con supporto universale iOS/Apple e Android)
  // Registrazione vocale ultra-leggera ottimizzata per la voce con limite di 60 secondi
  const MAX_RECORDING_SECONDS = 60;

  const startRecording = async () => {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: {
          channelCount: 1, // Canale mono: dimezza il peso dei dati audio
          sampleRate: 24000, // Frequenza di campionamento perfetta per il parlato
          echoCancellation: true,
          noiseSuppression: true,
          autoGainControl: true,
        },
      });

      audioChunksRef.current = [];
      const preferredMime = getBestAudioMimeType();
      // Bitrate vocale ottimizzato leggerissimo (20 kbps: circa 2.5 KB al secondo, 10s = ~25 KB)
      const recorderOptions: MediaRecorderOptions = {
        audioBitsPerSecond: 20000,
      };
      if (preferredMime) {
        recorderOptions.mimeType = preferredMime;
      }

      let mediaRecorder: MediaRecorder;
      try {
        mediaRecorder = new MediaRecorder(stream, recorderOptions);
      } catch {
        mediaRecorder = new MediaRecorder(stream);
      }
      mediaRecorderRef.current = mediaRecorder;
      recordingStartTimeRef.current = Date.now();

      mediaRecorder.ondataavailable = (event) => {
        if (event.data && event.data.size > 0) {
          audioChunksRef.current.push(event.data);
        }
      };

      mediaRecorder.onstop = () => {
        // Usa il mimetype effettivo registrato dal browser (su iPhone 'audio/mp4', su Android 'audio/webm')
        const actualMime = mediaRecorder.mimeType || preferredMime || 'audio/mp4';
        const audioBlob = new Blob(audioChunksRef.current, { type: actualMime });
        stream.getTracks().forEach((track) => track.stop());

        const durationSec = Math.min(
          MAX_RECORDING_SECONDS,
          Math.max(1, Math.round((Date.now() - recordingStartTimeRef.current) / 1000))
        );

        const reader = new FileReader();
        reader.onloadend = () => {
          const base64Audio = reader.result as string;
          sendAudioMessage(base64Audio, durationSec);
        };
        reader.readAsDataURL(audioBlob);
      };

      // Timeslice di 250ms fondamentale per Safari iOS per raccogliere buffer continui
      mediaRecorder.start(250);
      setIsRecording(true);
      setRecordingSeconds(0);
      recordingTimerRef.current = setInterval(() => {
        setRecordingSeconds((prev) => {
          const next = prev + 1;
          if (next >= MAX_RECORDING_SECONDS) {
            // Limite massimo di 60s raggiunto: stop e invio automatico immediato
            if (recordingTimerRef.current) clearInterval(recordingTimerRef.current);
            if (mediaRecorderRef.current && mediaRecorderRef.current.state === 'recording') {
              mediaRecorderRef.current.stop();
            }
            setIsRecording(false);
            return MAX_RECORDING_SECONDS;
          }
          return next;
        });
      }, 1000);
    } catch (err) {
      console.warn('Errore accesso microfono:', err);
      alert('Impossibile accedere al microfono per registrare la nota vocale. Verifica i permessi nelle impostazioni del browser.');
    }
  };

  const stopAndSendRecording = () => {
    if (mediaRecorderRef.current && isRecording) {
      clearInterval(recordingTimerRef.current);
      mediaRecorderRef.current.stop();
      setIsRecording(false);
    }
  };

  const cancelRecording = () => {
    if (mediaRecorderRef.current && isRecording) {
      clearInterval(recordingTimerRef.current);
      mediaRecorderRef.current.stream.getTracks().forEach((track) => track.stop());
      mediaRecorderRef.current = null;
      setIsRecording(false);
      setRecordingSeconds(0);
      audioChunksRef.current = [];
    }
  };

  // Invio diretto di una nota vocale con limite max 60s
  const sendAudioMessage = async (audioDataUrl: string, durationSec: number) => {
    const safeDuration = Math.min(durationSec || 1, 60);
    const attachment: ChatAttachment = {
      type: 'audio',
      url: audioDataUrl,
      duration: safeDuration,
      name: `Nota vocale (${safeDuration}s)`,
    };

    sendMessagePayload('', attachment);
  };

  // Invio Messaggio Principale - ISTANTANEO (Optimistic UI con protezione anti-duplicato)
  const handleSendMessage = (e?: React.FormEvent) => {
    if (e) e.preventDefault();
    const cleanText = inputText.trim();
    if (!cleanText && !pendingAttachment) return;

    // Protezione doppio click/tap rapido accidentale su mobile
    const now = Date.now();
    if (now - lastSendTimeRef.current < 250) {
      return;
    }
    lastSendTimeRef.current = now;

    const attachmentToSend = pendingAttachment;
    setPendingAttachment(null);
    setInputText('');

    // Invio asincrono immediato: il testo scompare subito dal campo e il messaggio appare istantaneamente
    sendMessagePayload(cleanText, attachmentToSend || undefined);
  };

  const sendMessagePayload = async (content: string, attachment?: ChatAttachment) => {
    const hasQuotedContent =
      Boolean(replyingTo?.content?.trim()) ||
      Boolean(replyingTo?.attachment?.type);

    const replyPayload: ChatReplyTo | undefined =
      replyingTo && hasQuotedContent
        ? {
            messageId: replyingTo.id,
            authorName: `${replyingTo.authorName} ${replyingTo.authorSurname || ''}`.trim() || 'Membro',
            content: replyingTo.content || (replyingTo.attachment ? `[${replyingTo.attachment.type}]` : ''),
            attachmentType: replyingTo.attachment?.type,
          }
        : undefined;

    setReplyingTo(null);

    // ID temporaneo univoco per visualizzazione ottimistica istantanea (0 millisecondi)
    const tempId = `msg-opt-${Date.now()}-${Math.random().toString(36).substring(2, 6)}`;
    const optimisticMsg: ChatMessage = {
      id: tempId,
      groupId: activeGroup.id,
      subgroupId: subgroupId,
      authorId: currentUser.id,
      authorName: currentUser.name,
      authorSurname: currentUser.surname,
      authorAvatar: null,
      content,
      attachment,
      replyTo: replyPayload,
      clientMessageId: tempId,
      createdAt: new Date().toISOString(),
    };

    // 1. Inserimento ISTANTANEO nella vista e nella cache locale
    setMessages((prev) => [...prev, optimisticMsg]);
    updateMessageInCache(activeGroup.id, subgroupId, optimisticMsg);

    // 2. Scroll istantaneo verso il nuovo messaggio
    requestAnimationFrame(() => {
      messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
    });

    // 3. Salvataggio in background su MongoDB con clientMessageId per riconciliazione univoca
    try {
      const res = await fetch(`/api/groups/${activeGroup.id}/chat`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          clientMessageId: tempId,
          subgroupId,
          authorId: currentUser.id,
          authorName: currentUser.name,
          authorSurname: currentUser.surname,
          authorAvatar: null,
          content,
          attachment,
          replyTo: replyPayload,
        }),
      });

      if (res.ok) {
        const data = await res.json();
        if (data && data.message) {
          setMessages((prev) => {
            // Se il messaggio è già stato inserito con l'ID reale (es. ricevuto via WebSocket in anticipo)
            const alreadyHasReal = prev.some((m) => m.id === data.message.id);
            let next: ChatMessage[];
            if (alreadyHasReal) {
              // Rimuovi semplicemente la bolla provvisoria tempId per non sdoppiare
              next = prev.filter((m) => m.id !== tempId);
            } else {
              // Sostituisci la bolla provvisoria con quella ufficiale convalidata
              next = prev.map((m) => (m.id === tempId ? data.message : m));
            }

            // Deduplicazione di sicurezza per ID univoco
            const seen = new Set<string>();
            return next.filter((m) => {
              if (!m || !m.id || seen.has(m.id)) return false;
              seen.add(m.id);
              return true;
            });
          });
          updateMessageInCache(activeGroup.id, subgroupId, data.message, tempId);
        }
      }
    } catch (err) {
      console.error('Errore sincronizzazione messaggio in background:', err);
    }
  };

  // Modifica messaggio (Stile WhatsApp)
  const handleStartEdit = (msg: ChatMessage) => {
    setEditingMessageId(msg.id);
    setEditingText(msg.content || '');
  };

  const handleCancelEdit = () => {
    setEditingMessageId(null);
    setEditingText('');
  };

  const handleSaveEdit = async (messageId: string) => {
    const trimmed = editingText.trim();
    if (!trimmed) return;
    setIsSavingEdit(true);
    try {
      const editedAt = new Date().toISOString();
      setMessages((prev) =>
        prev.map((m) =>
          m.id === messageId
            ? { ...m, content: trimmed, isEdited: true, editedAt }
            : m
        )
      );
      const targetMsg = messages.find((m) => m.id === messageId);
      if (targetMsg) {
        updateMessageInCache(activeGroup.id, subgroupId, {
          ...targetMsg,
          content: trimmed,
          isEdited: true,
          editedAt,
        });
      }
      setEditingMessageId(null);

      await fetch(`/api/groups/${activeGroup.id}/chat/${messageId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          userId: currentUser.id,
          content: trimmed,
        }),
      });
    } catch (err) {
      console.error('Errore modifica messaggio chat:', err);
    } finally {
      setIsSavingEdit(false);
    }
  };

  // Cancellazione messaggio per tutti (Stile WhatsApp)
  const handleDeleteMessage = async (messageId: string) => {
    const confirmed = window.confirm(
      'Vuoi davvero eliminare questo messaggio per tutti? Non sarà più visibile a nessun membro.'
    );
    if (!confirmed) return;

    setDeletingMessageId(messageId);
    try {
      // Rimozione ottimistica immediata per tutti
      setMessages((prev) => prev.filter((m) => m.id !== messageId));
      removeMessageFromCache(activeGroup.id, subgroupId, messageId);

      await fetch(`/api/groups/${activeGroup.id}/chat/${messageId}`, {
        method: 'DELETE',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          userId: currentUser.id,
        }),
      });
    } catch (err) {
      console.error('Errore eliminazione messaggio chat:', err);
    } finally {
      setDeletingMessageId(null);
    }
  };

  // Gestione Pressione Prolungata (Long Press) per Smartphone (Stile WhatsApp)
  const handleTouchStart = (msg: ChatMessage, e: React.TouchEvent) => {
    // Se questo messaggio è già selezionato, non riavviare il timer
    if (selectedMessage?.id === msg.id) return;
    isLongPressActiveRef.current = false;
    const touch = e.touches[0];
    touchStartPosRef.current = { x: touch.clientX, y: touch.clientY };

    if (longPressTimerRef.current) {
      clearTimeout(longPressTimerRef.current);
    }

    longPressTimerRef.current = setTimeout(() => {
      isLongPressActiveRef.current = true;
      if (typeof navigator !== 'undefined' && navigator.vibrate) {
        try {
          navigator.vibrate(40);
        } catch {
          // ignora
        }
      }
      setSelectedMessage(msg);
    }, 420);
  };

  const handleTouchMove = (e: React.TouchEvent) => {
    if (!touchStartPosRef.current) return;
    const touch = e.touches[0];
    const dx = Math.abs(touch.clientX - touchStartPosRef.current.x);
    const dy = Math.abs(touch.clientY - touchStartPosRef.current.y);
    if (dx > 10 || dy > 10) {
      if (longPressTimerRef.current) {
        clearTimeout(longPressTimerRef.current);
        longPressTimerRef.current = null;
      }
    }
  };

  const handleTouchEnd = () => {
    if (longPressTimerRef.current) {
      clearTimeout(longPressTimerRef.current);
      longPressTimerRef.current = null;
    }
    touchStartPosRef.current = null;
  };

  const handleContextMenu = (e: React.MouseEvent, msg: ChatMessage) => {
    e.preventDefault();
    setSelectedMessage(msg);
  };

  const handleCopyMessage = async (text?: string) => {
    if (!text) return;
    try {
      if (navigator.clipboard) {
        await navigator.clipboard.writeText(text);
        setCopiedToast(true);
        setTimeout(() => setCopiedToast(false), 2000);
      }
    } catch {
      // ignora
    }
  };

  // Scroll al messaggio citato quando si clicca sul quote
  const scrollToMessage = (messageId: string) => {
    const el = document.getElementById(`chat-msg-${messageId}`);
    if (el) {
      el.scrollIntoView({ behavior: 'smooth', block: 'center' });
      el.classList.add('ring-2', 'ring-[#f23e2e]', 'transition-all');
      setTimeout(() => {
        el.classList.remove('ring-2', 'ring-[#f23e2e]');
      }, 1500);
    }
  };

  // Pulizia audio all'unmount
  useEffect(() => {
    return () => {
      if (audioPlayerRef.current) {
        audioPlayerRef.current.pause();
        audioPlayerRef.current = null;
      }
      if (webAudioSourceRef.current) {
        try { webAudioSourceRef.current.stop(); } catch {}
        webAudioSourceRef.current = null;
      }
      if (webAudioContextRef.current && webAudioContextRef.current.state !== 'closed') {
        try { webAudioContextRef.current.close(); } catch {}
      }
      if (webAudioAnimRef.current) {
        cancelAnimationFrame(webAudioAnimRef.current);
      }
      audioBlobUrlsCache.current.forEach((url) => {
        try { URL.revokeObjectURL(url); } catch {}
      });
      audioBlobUrlsCache.current.clear();
    };
  }, []);

  // Gestione Riproduzione Audio in-chat (supporto universale iOS Safari + Android + PC con Web Audio fallback)
  const handleTogglePlayAudio = async (messageId: string, audioUrl: string) => {
    if (playingAudioId === messageId) {
      if (audioPlayerRef.current) {
        audioPlayerRef.current.pause();
      }
      if (webAudioSourceRef.current) {
        try { webAudioSourceRef.current.stop(); } catch {}
        webAudioSourceRef.current = null;
      }
      if (webAudioAnimRef.current) {
        cancelAnimationFrame(webAudioAnimRef.current);
      }
      setPlayingAudioId(null);
      return;
    }

    if (audioPlayerRef.current) {
      audioPlayerRef.current.pause();
      audioPlayerRef.current = null;
    }
    if (webAudioSourceRef.current) {
      try { webAudioSourceRef.current.stop(); } catch {}
      webAudioSourceRef.current = null;
    }
    if (webAudioAnimRef.current) {
      cancelAnimationFrame(webAudioAnimRef.current);
    }

    setPlayingAudioId(messageId);
    setAudioProgress(0);

    // Risolvi l'URL riproducibile (per iOS Safari crea e memorizza in cache un Blob Object URL)
    let playableUrl = audioUrl;
    if (audioUrl.startsWith('data:')) {
      const cached = audioBlobUrlsCache.current.get(audioUrl);
      if (cached) {
        playableUrl = cached;
      } else {
        const blob = base64ToBlob(audioUrl);
        const objUrl = URL.createObjectURL(blob);
        audioBlobUrlsCache.current.set(audioUrl, objUrl);
        playableUrl = objUrl;
      }
    }

    try {
      const audio = new Audio();
      audioPlayerRef.current = audio;
      audio.preload = 'auto';
      audio.setAttribute('playsinline', 'true');
      (audio as any).playsInline = true;
      audio.src = playableUrl;

      audio.ontimeupdate = () => {
        if (audio.duration && !isNaN(audio.duration) && audio.duration > 0) {
          setAudioProgress((audio.currentTime / audio.duration) * 100);
        }
      };

      audio.onended = () => {
        setPlayingAudioId(null);
        setAudioProgress(0);
      };

      await audio.play();
    } catch (playErr) {
      console.warn('Riproduzione HTML5 Audio fallita, fallback Web Audio per Apple/iOS:', playErr);

      // Fallback avanzato Web Audio API (decodifica buffer audio per browser o versioni iOS restrittive)
      try {
        const AudioContextClass = window.AudioContext || (window as any).webkitAudioContext;
        if (!AudioContextClass) throw new Error('Web Audio non supportato');
        if (!webAudioContextRef.current || webAudioContextRef.current.state === 'closed') {
          webAudioContextRef.current = new AudioContextClass();
        }
        const ctx = webAudioContextRef.current;
        if (ctx.state === 'suspended') {
          await ctx.resume();
        }

        const res = await fetch(playableUrl);
        const arrayBuffer = await res.arrayBuffer();
        const audioBuffer = await ctx.decodeAudioData(arrayBuffer);

        const source = ctx.createBufferSource();
        source.buffer = audioBuffer;
        source.connect(ctx.destination);
        webAudioSourceRef.current = source;

        const startTime = ctx.currentTime;
        const duration = audioBuffer.duration;

        source.onended = () => {
          setPlayingAudioId(null);
          setAudioProgress(0);
          if (webAudioAnimRef.current) {
            cancelAnimationFrame(webAudioAnimRef.current);
          }
        };

        source.start(0);

        const trackProgress = () => {
          if (!webAudioContextRef.current || !webAudioSourceRef.current) return;
          const elapsed = webAudioContextRef.current.currentTime - startTime;
          if (elapsed < duration) {
            setAudioProgress((elapsed / duration) * 100);
            webAudioAnimRef.current = requestAnimationFrame(trackProgress);
          } else {
            setAudioProgress(100);
          }
        };
        webAudioAnimRef.current = requestAnimationFrame(trackProgress);
      } catch (fallbackErr) {
        console.error('Errore riproduzione anche con Web Audio API:', fallbackErr);
        setPlayingAudioId(null);
        setAudioProgress(0);
      }
    }
  };

  const formatMessageTime = (isoString?: string) => {
    if (!isoString) return '';
    try {
      const d = new Date(isoString);
      return new Intl.DateTimeFormat('it-IT', {
        hour: '2-digit',
        minute: '2-digit',
      }).format(d);
    } catch {
      return '';
    }
  };

  const formatFileSize = (bytes?: number) => {
    if (!bytes) return '';
    if (bytes < 1024) return `${bytes} B`;
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
    return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  };

  const formatSeconds = (sec: number) => {
    const m = Math.floor(sec / 60);
    const s = sec % 60;
    return `${m}:${s < 10 ? '0' : ''}${s}`;
  };

  return (
    <div className="fixed inset-x-0 top-[56px] bottom-0 z-30 flex flex-col bg-[#efeae2] dark:bg-neutral-950 md:static md:inset-auto md:z-auto md:h-[calc(100vh-210px)] md:max-h-[780px] md:min-h-[490px] md:max-w-4xl lg:max-w-6xl xl:max-w-7xl md:mx-auto md:rounded-3xl md:border md:border-neutral-200/90 md:dark:border-neutral-800 md:shadow-sm overflow-hidden animate-in fade-in">
      
      {/* Hidden File Inputs per Immagini e Documenti */}
      <input
        ref={imageInputRef}
        type="file"
        accept="image/*"
        onChange={handleImageSelect}
        className="hidden"
      />
      <input
        ref={fileInputRef}
        type="file"
        onChange={handleFileSelect}
        className="hidden"
      />

      {/* Header Chat / Barra Azioni Selezione Messaggio WhatsApp */}
      {selectedMessage ? (
        <div className="px-3 sm:px-4 py-2.5 sm:py-3 bg-neutral-900 text-white border-b border-neutral-800 flex items-center justify-between shadow-md z-30 shrink-0 animate-in fade-in">
          <div className="flex items-center gap-3">
            <button
              type="button"
              onClick={() => setSelectedMessage(null)}
              className="p-1.5 rounded-xl hover:bg-neutral-800 active:bg-neutral-700 text-neutral-300 hover:text-white transition-colors cursor-pointer"
              title="Annulla selezione"
            >
              <X className="w-5 h-5 stroke-[2.2px]" />
            </button>
            <span className="text-xs sm:text-sm font-black tracking-wide">
              1 selezionato
            </span>
          </div>

          <div className="flex items-center gap-1 sm:gap-2">
            {/* Tasto Rispondi */}
            <button
              type="button"
              onClick={() => {
                setReplyingTo(selectedMessage);
                setSelectedMessage(null);
              }}
              title="Rispondi al messaggio"
              className="p-2 rounded-xl hover:bg-neutral-800 active:bg-neutral-700 text-neutral-300 hover:text-white transition-colors cursor-pointer"
            >
              <CornerUpLeft className="w-4 h-4" />
            </button>

            {/* Tasto Copia (se testo presente) */}
            {selectedMessage.content && (
              <button
                type="button"
                onClick={() => {
                  handleCopyMessage(selectedMessage.content);
                  setSelectedMessage(null);
                }}
                title="Copia testo"
                className="p-2 rounded-xl hover:bg-neutral-800 active:bg-neutral-700 text-neutral-300 hover:text-white transition-colors cursor-pointer"
              >
                <Copy className="w-4 h-4" />
              </button>
            )}

            {/* Tasto Info Messaggio (Chi ha visualizzato / letto) */}
            <button
              type="button"
              onClick={() => {
                setInfoModalMessage(selectedMessage);
                setSelectedMessage(null);
              }}
              title="Info messaggio (Visualizzazioni)"
              className="flex items-center gap-1 px-2.5 py-1.5 rounded-xl bg-neutral-800 hover:bg-sky-600 active:bg-sky-700 text-white text-xs font-bold transition-all cursor-pointer shadow-xs"
            >
              <Info className="w-3.5 h-3.5 text-sky-400" />
              <span className="hidden sm:inline">Info</span>
            </button>

            {/* Se è un messaggio inviato dall'utente attuale: Modifica ed Elimina */}
            {selectedMessage.authorId === currentUser.id && (
              <>
                <button
                  type="button"
                  onClick={() => {
                    handleStartEdit(selectedMessage);
                    setSelectedMessage(null);
                  }}
                  title="Modifica messaggio"
                  className="flex items-center gap-1 px-2.5 py-1.5 rounded-xl bg-neutral-800 hover:bg-[#00a884] active:bg-[#008f6f] text-white text-xs font-bold transition-all cursor-pointer shadow-xs"
                >
                  <Edit2 className="w-3.5 h-3.5 text-emerald-400" />
                  <span className="hidden sm:inline">Modifica</span>
                </button>

                <button
                  type="button"
                  onClick={() => {
                    const idToDelete = selectedMessage.id;
                    setSelectedMessage(null);
                    handleDeleteMessage(idToDelete);
                  }}
                  title="Elimina per tutti"
                  className="flex items-center gap-1 px-2.5 py-1.5 rounded-xl bg-red-950/80 hover:bg-red-900 active:bg-red-800 text-red-400 text-xs font-bold transition-all cursor-pointer shadow-xs"
                >
                  <Trash2 className="w-3.5 h-3.5" />
                  <span className="hidden sm:inline">Elimina</span>
                </button>
              </>
            )}

            {/* Se non è mio ma sono admin del gruppo: Elimina */}
            {selectedMessage.authorId !== currentUser.id && isGroupAdmin && (
              <button
                type="button"
                onClick={() => {
                  const idToDelete = selectedMessage.id;
                  setSelectedMessage(null);
                  handleDeleteMessage(idToDelete);
                }}
                title="Elimina messaggio come Admin"
                className="p-2 rounded-xl hover:bg-red-950 text-red-400 transition-colors cursor-pointer"
              >
                <Trash2 className="w-4 h-4" />
              </button>
            )}
          </div>
        </div>
      ) : (
        <div
          className="px-3 sm:px-4 py-2.5 sm:py-3 bg-white dark:bg-neutral-900 border-b border-neutral-200/80 dark:border-neutral-800 flex items-center justify-between shadow-2xs z-10 shrink-0 transition-colors"
          style={
            activeSubgroup
              ? {
                  borderTop: `3px solid ${chatColor}`,
                  borderBottomColor: `${chatColor}30`,
                  backgroundImage: `linear-gradient(to right, ${chatColor}14, transparent 65%)`,
                }
              : undefined
          }
        >
          <div className="flex items-center gap-2 sm:gap-2.5 min-w-0">
            {onBackToDashboard && (
              <button
                type="button"
                onClick={onBackToDashboard}
                className="p-1.5 rounded-xl bg-neutral-100 hover:bg-neutral-200 dark:bg-neutral-800 dark:hover:bg-neutral-700 text-[#f23e2e] md:hidden cursor-pointer shrink-0 transition-colors"
                title="Torna alla Dashboard"
                aria-label="Torna indietro"
              >
                <ArrowLeft className="w-4 h-4 stroke-[2.5px]" />
              </button>
            )}
            <div
              className="w-8 h-8 sm:w-9 sm:h-9 rounded-2xl flex items-center justify-center shrink-0 shadow-xs text-white"
              style={{
                backgroundColor: chatColor,
                boxShadow: `0 2px 8px ${chatColor}40`,
              }}
            >
              {activeSubgroup ? (
                <FolderOpen className="w-4 h-4 sm:w-5 sm:h-5 stroke-[2.2px]" />
              ) : (
                <MessageSquare className="w-4 h-4 sm:w-5 sm:h-5 stroke-[2.2px]" />
              )}
            </div>
            <div className="min-w-0">
              <div className="flex items-center gap-1.5">
                <h2
                  className="text-xs sm:text-sm font-black truncate text-neutral-900 dark:text-white"
                  style={activeSubgroup ? { color: chatColor } : undefined}
                >
                  {activeSubgroup ? activeSubgroup.name : 'Chat Generale'}
                </h2>
                <span
                  className="text-[9px] font-black uppercase tracking-wider px-2 py-0.2 rounded-full"
                  style={
                    activeSubgroup
                      ? {
                          backgroundColor: `${chatColor}20`,
                          color: chatColor,
                          border: `1px solid ${chatColor}45`,
                        }
                      : {
                          backgroundColor: '#fee2e2',
                          color: '#f23e2e',
                        }
                  }
                >
                  {activeSubgroup ? (activeSubgroup.parentId ? 'Sotto-sottogruppo' : 'Sottogruppo') : 'Generale'}
                </span>
              </div>
              <p className="text-[10px] text-neutral-500 dark:text-neutral-400 truncate">
                {activeSubgroup
                  ? (chatBreadcrumbs.length > 2
                      ? chatBreadcrumbs.join(' ➔ ')
                      : `Chat del sottogruppo ${activeSubgroup.name}`)
                  : `Chat del gruppo ${activeGroup.name}`}
              </p>
            </div>
          </div>

          <div className="flex items-center gap-2">
            {activeSubgroup?.code && (
              <span
                className="text-[10px] font-mono font-bold px-2 py-0.5 rounded-lg border"
                style={{
                  backgroundColor: `${chatColor}15`,
                  borderColor: `${chatColor}40`,
                  color: chatColor,
                }}
              >
                🔑 {activeSubgroup.code}
              </span>
            )}
          </div>
        </div>
      )}

      {/* Toast Notifica di Copia negli Appunti */}
      {copiedToast && (
        <div className="absolute top-16 left-1/2 -translate-x-1/2 z-50 px-3.5 py-1.5 rounded-full bg-neutral-900/95 text-white text-xs font-bold shadow-xl border border-neutral-700/80 animate-in fade-in zoom-in-95 pointer-events-none">
          Messaggio copiato negli appunti
        </div>
      )}

      {/* Area Messaggi in stile WhatsApp (Sfondo chat con bolle) */}
      <div
        ref={messagesContainerRef}
        onScroll={handleContainerScroll}
        onClick={() => {
          if (selectedMessage) setSelectedMessage(null);
        }}
        className="flex-1 overflow-y-auto p-3 sm:p-4 pb-8 space-y-3 bg-[#efeae2]/80 dark:bg-neutral-950/80"
        style={{
          backgroundImage:
            'radial-gradient(circle, rgba(0,0,0,0.04) 1px, transparent 1px)',
          backgroundSize: '20px 20px',
        }}
      >
        {/* Pulsante Carica Messaggi Precedenti */}
        {hasMore && (
          <div className="flex justify-center pt-1 pb-2">
            <button
              type="button"
              onClick={loadOlderMessages}
              disabled={isLoadingOlder}
              className="px-3.5 py-1.5 rounded-full text-xs font-bold bg-white/95 dark:bg-neutral-800/95 text-[#00a884] dark:text-[#25d366] hover:bg-neutral-100 dark:hover:bg-neutral-700 shadow-2xs border border-neutral-200/80 dark:border-neutral-700/80 transition-all flex items-center gap-1.5 cursor-pointer disabled:opacity-60"
            >
              {isLoadingOlder ? (
                <>
                  <Loader2 className="w-3.5 h-3.5 animate-spin" />
                  <span>Caricamento messaggi precedenti...</span>
                </>
              ) : (
                <span>Carica messaggi precedenti</span>
              )}
            </button>
          </div>
        )}

        {isLoading && messages.length === 0 ? (
          <div className="flex items-center justify-center h-full">
            <p className="text-xs text-neutral-500 dark:text-neutral-400 animate-pulse font-medium bg-white/80 dark:bg-neutral-900/80 px-3 py-1.5 rounded-xl shadow-xs">
              Caricamento messaggi da MongoDB...
            </p>
          </div>
        ) : activeMessages.length === 0 ? (
          <div className="flex flex-col items-center justify-center h-full text-center px-4 space-y-2">
            <div className="w-12 h-12 rounded-2xl bg-white dark:bg-neutral-800 flex items-center justify-center text-neutral-400 shadow-sm">
              <MessageSquare className="w-6 h-6 stroke-[1.8px]" />
            </div>
            <p className="text-xs sm:text-sm font-bold text-neutral-800 dark:text-neutral-200">
              Nessun messaggio ancora in questa chat
            </p>
            <p className="text-[11px] text-neutral-500 dark:text-neutral-400 max-w-xs bg-white/70 dark:bg-neutral-900/70 p-2 rounded-xl">
              Invia messaggi di testo, foto, note vocali o documenti. I messaggi si eliminano automaticamente dopo 50 giorni di vita per mantenere la chat veloce e pulita per i membri di{' '}
              <strong>{contextName}</strong>.
            </p>
          </div>
        ) : (
          activeMessages.map((msg, idx) => {
            const prevMsg = idx > 0 ? activeMessages[idx - 1] : null;
            const currentDateKey = getMessageDateKey(msg.createdAt);
            const prevDateKey = prevMsg ? getMessageDateKey(prevMsg.createdAt) : null;
            const showDateSeparator = idx === 0 || currentDateKey !== prevDateKey;
            const dateLabel = showDateSeparator ? getMessageDateLabel(msg.createdAt) : '';

            const isMe = msg.authorId === currentUser.id;
            const authorUser = allUsers.find((u) => u.id === msg.authorId);
            const isPlayingThisAudio = playingAudioId === msg.id;
            const isSelected = selectedMessage?.id === msg.id;
            const isFirstMessage = idx === 0;

            return (
              <React.Fragment key={msg.id}>
                {/* Divisore Data in stile WhatsApp (Oggi, Ieri, Giorno o Data estesa) */}
                {showDateSeparator && dateLabel && (
                  <div className="flex justify-center my-3 select-none pointer-events-none sticky top-1 z-10">
                    <span className="px-3.5 py-1 rounded-lg text-[10.5px] font-bold bg-white/95 dark:bg-neutral-800/95 text-neutral-600 dark:text-neutral-300 shadow-2xs border border-neutral-200/80 dark:border-neutral-700/80 backdrop-blur-xs tracking-wide">
                      {dateLabel}
                    </span>
                  </div>
                )}

                <div
                  id={`chat-msg-${msg.id}`}
                  className={`group flex items-end gap-1.5 transition-colors ${
                    isMe ? 'justify-end' : 'justify-start'
                  } ${
                    isSelected
                      ? 'bg-sky-500/15 dark:bg-sky-500/20 -mx-2 sm:-mx-3 px-2 sm:px-3 py-1 rounded-2xl'
                      : ''
                  }`}
                >
                  <div className={`max-w-[85%] sm:max-w-[70%] space-y-0.5 ${isMe ? 'items-end' : 'items-start'}`}>
                  {!isMe && (
                    <span className="text-[10px] font-bold text-[#f23e2e] dark:text-red-400 px-1">
                      {msg.authorName} {msg.authorSurname}
                    </span>
                  )}

                  {/* Riga con Bolla Messaggio e Pulsanti Azione Affiancati */}
                  <div className={`flex items-end gap-1.5 ${isMe ? 'flex-row-reverse' : 'flex-row'}`}>
                    {/* Bolla Messaggio con supporto Pressione Prolungata (Long Press stile WhatsApp) */}
                    <div
                      onTouchStart={(e) => handleTouchStart(msg, e)}
                      onTouchMove={handleTouchMove}
                      onTouchEnd={handleTouchEnd}
                      onContextMenu={(e) => handleContextMenu(e, msg)}
                      onClick={(e) => {
                        if (selectedMessage) {
                          e.stopPropagation();
                          if (selectedMessage.id === msg.id) {
                            setSelectedMessage(null);
                          } else {
                            setSelectedMessage(msg);
                          }
                        }
                      }}
                      className={`relative rounded-2xl p-2.5 sm:p-3 text-xs shadow-xs transition-all break-words select-none sm:select-text cursor-pointer sm:cursor-default ${
                        isMe
                          ? 'bg-[#d9fdd3] dark:bg-[#005c4b] text-neutral-900 dark:text-neutral-100 rounded-br-xs'
                          : 'bg-white dark:bg-neutral-900 text-neutral-900 dark:text-neutral-100 rounded-bl-xs border border-neutral-200/80 dark:border-neutral-800'
                      } ${
                        isSelected
                          ? 'ring-2 ring-[#00a884] dark:ring-[#25d366]'
                          : ''
                      }`}
                    >
                      {/* BOX CITAZIONE / RICHIAMO MESSAGGIO (WhatsApp Style Quote pulito) */}
                      {msg.replyTo && (msg.replyTo.content || msg.replyTo.attachmentType) && (
                        <div
                          onClick={(e) => {
                            e.stopPropagation();
                            scrollToMessage(msg.replyTo!.messageId);
                          }}
                          className={`mb-2 p-2 rounded-xl text-[11px] border-l-4 cursor-pointer transition-all hover:opacity-90 ${
                            isMe
                              ? 'bg-black/10 dark:bg-black/25 border-[#00a884] dark:border-[#25d366]'
                              : 'bg-neutral-100 dark:bg-neutral-800 border-[#f23e2e]'
                          }`}
                        >
                          <div className="flex items-center gap-1 font-bold text-[10px] text-[#00a884] dark:text-[#25d366]">
                            <CornerUpLeft className="w-3 h-3 stroke-[2.5px]" />
                            <span>{msg.replyTo.authorName || 'Membro'}</span>
                          </div>
                          <p className="truncate text-neutral-600 dark:text-neutral-300 text-[10.5px] mt-0.5">
                            {msg.replyTo.attachmentType === 'image' && '📷 Foto'}
                            {msg.replyTo.attachmentType === 'audio' && '🎙️ Nota vocale'}
                            {msg.replyTo.attachmentType === 'file' && '📄 Documento'}
                            {msg.replyTo.content && ` ${msg.replyTo.content}`}
                          </p>
                        </div>
                      )}

                    {/* 1. ALLEGATO IMMAGINE */}
                    {msg.attachment?.type === 'image' && (
                      <div className="mb-2 rounded-xl overflow-hidden relative group/img cursor-pointer">
                        <img
                          src={msg.attachment.url}
                          alt={msg.attachment.name || 'Immagine allegata'}
                          onClick={() =>
                            setPreviewImage({
                              url: msg.attachment!.url,
                               name: msg.attachment!.name,
                            })
                          }
                          className="w-full max-h-72 object-cover rounded-xl hover:scale-101 transition-transform"
                        />
                        {/* Indicatore visivo durante il caricamento/invio della foto su MongoDB */}
                        {msg.id.startsWith('msg-opt-') && (
                          <div className="absolute inset-0 bg-black/45 backdrop-blur-[1px] flex items-center justify-center gap-2 text-white text-xs font-bold rounded-xl pointer-events-none">
                            <Loader2 className="w-5 h-5 animate-spin text-white" />
                            <span>Invio foto in corso...</span>
                          </div>
                        )}
                        <div
                          onClick={() =>
                            setPreviewImage({
                              url: msg.attachment!.url,
                              name: msg.attachment!.name,
                            })
                          }
                          className="absolute bottom-2 right-2 p-1.5 rounded-lg bg-black/60 text-white opacity-0 group-hover/img:opacity-100 transition-opacity"
                        >
                          <Maximize2 className="w-3.5 h-3.5" />
                        </div>
                      </div>
                    )}

                    {/* 2. ALLEGATO NOTA VOCALE / AUDIO */}
                    {msg.attachment?.type === 'audio' && (
                      <div className="mb-2 p-2 rounded-xl bg-black/5 dark:bg-white/5 flex items-center gap-3 relative">
                        <button
                          type="button"
                          onClick={() =>
                            handleTogglePlayAudio(msg.id, msg.attachment!.url)
                          }
                          className="w-9 h-9 rounded-full bg-[#00a884] hover:bg-[#008f6f] text-white flex items-center justify-center shrink-0 shadow-2xs cursor-pointer active:scale-95 transition-transform"
                        >
                          {isPlayingThisAudio ? (
                            <Pause className="w-4 h-4 fill-white" />
                          ) : (
                            <Play className="w-4 h-4 fill-white ml-0.5" />
                          )}
                        </button>

                        <div className="flex-1 min-w-0">
                          {/* Barra audio stile WhatsApp */}
                          <div className="h-1.5 w-full bg-neutral-300 dark:bg-neutral-700 rounded-full overflow-hidden">
                            <div
                              className="h-full bg-[#00a884] transition-all duration-150"
                              style={{
                                width: isPlayingThisAudio ? `${audioProgress}%` : '0%',
                              }}
                            />
                          </div>
                          <div className="flex items-center justify-between text-[10px] text-neutral-500 dark:text-neutral-400 mt-1">
                            <span className="flex items-center gap-1 font-mono">
                              <Volume2 className="w-3 h-3 text-[#00a884]" />
                              <span>Nota Vocale</span>
                              {msg.id.startsWith('msg-opt-') && (
                                <span className="text-[9px] text-[#00a884] font-bold flex items-center gap-1 ml-1.5">
                                  <Loader2 className="w-2.5 h-2.5 animate-spin" />
                                  <span>Invio audio...</span>
                                </span>
                              )}
                            </span>
                            <span className="font-mono">
                              {msg.attachment.duration
                                ? formatSeconds(msg.attachment.duration)
                                : '0:00'}
                            </span>
                          </div>
                        </div>
                      </div>
                    )}

                    {/* 3. ALLEGATO FILE / DOCUMENTO */}
                    {msg.attachment?.type === 'file' && (
                      <div className="mb-2 p-2.5 rounded-xl bg-black/5 dark:bg-white/5 flex items-center justify-between gap-3 border border-neutral-200/50 dark:border-neutral-700/50">
                        <div className="flex items-center gap-2.5 min-w-0">
                          <div className="w-8 h-8 rounded-lg bg-red-100 dark:bg-red-950/60 text-[#f23e2e] flex items-center justify-center shrink-0">
                            <FileText className="w-4 h-4" />
                          </div>
                          <div className="min-w-0">
                            <p className="text-xs font-bold text-neutral-900 dark:text-white truncate">
                              {msg.attachment.name || 'Documento'}
                            </p>
                            <p className="text-[10px] text-neutral-500 dark:text-neutral-400">
                              {formatFileSize(msg.attachment.size)}
                            </p>
                          </div>
                        </div>

                        <a
                          href={msg.attachment.url}
                          download={msg.attachment.name || 'documento'}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="p-2 rounded-xl bg-neutral-200 dark:bg-neutral-800 hover:bg-[#f23e2e] hover:text-white text-neutral-700 dark:text-neutral-200 transition-colors shrink-0 cursor-pointer"
                          title="Scarica file"
                        >
                          <Download className="w-4 h-4" />
                        </a>
                      </div>
                    )}

                    {/* Contenuto di testo del messaggio o Editor Inline */}
                    {editingMessageId === msg.id ? (
                      <div className="space-y-1.5 py-1 min-w-[200px]">
                        <textarea
                          value={editingText}
                          onChange={(e) => setEditingText(e.target.value)}
                          disabled={isSavingEdit}
                          rows={2}
                          className="w-full text-xs p-2 rounded-xl border border-[#00a884] bg-white dark:bg-neutral-800 text-neutral-900 dark:text-white focus:outline-none resize-none"
                          autoFocus
                          onKeyDown={(e) => {
                            if (e.key === 'Enter' && !e.shiftKey) {
                              e.preventDefault();
                              handleSaveEdit(msg.id);
                            } else if (e.key === 'Escape') {
                              handleCancelEdit();
                            }
                          }}
                        />
                        <div className="flex items-center justify-end gap-1.5">
                          <button
                            type="button"
                            onClick={handleCancelEdit}
                            disabled={isSavingEdit}
                            className="px-2 py-1 rounded-lg text-[10px] font-bold bg-neutral-200 dark:bg-neutral-700 text-neutral-700 dark:text-neutral-300 hover:bg-neutral-300 cursor-pointer"
                          >
                            Annulla
                          </button>
                          <button
                            type="button"
                            onClick={() => handleSaveEdit(msg.id)}
                            disabled={isSavingEdit || !editingText.trim()}
                            className="px-2.5 py-1 rounded-lg text-[10px] font-black bg-[#00a884] hover:bg-[#008f6f] text-white flex items-center gap-1 cursor-pointer shadow-xs disabled:opacity-50"
                          >
                            <Check className="w-3 h-3 stroke-[3px]" />
                            <span>Salva</span>
                          </button>
                        </div>
                      </div>
                    ) : (
                      msg.content && (
                        <p className="whitespace-pre-wrap leading-relaxed">
                          {msg.content}
                        </p>
                      )
                    )}

                    {/* Orario, badge (modificato) e spunta di invio */}
                    <div
                      className={`text-[9px] mt-1 flex items-center gap-1 justify-end select-none ${
                        isMe ? 'text-neutral-600 dark:text-neutral-400' : 'text-neutral-400'
                      }`}
                    >
                      {msg.isEdited && (
                        <span className="italic text-[9px] text-neutral-500 dark:text-neutral-400 mr-0.5">
                          (modificato)
                        </span>
                      )}
                      <span>{formatMessageTime(msg.createdAt)}</span>
                      {isMe && (
                        msg.id.startsWith('msg-opt-') ? (
                          <span title="Invio in corso su MongoDB..." className="flex items-center text-neutral-400">
                            <Clock className="w-3 h-3 animate-pulse" />
                          </span>
                        ) : (() => {
                          const otherMembers = targetMemberIds.filter((id) => id !== currentUser.id);
                          const readCount = otherMembers.filter((id) =>
                            msg.readBy?.some((r) => r.userId === id)
                          ).length;
                          const isReadByAll = otherMembers.length > 0 && readCount === otherMembers.length;

                          return (
                            <span
                              title={
                                isReadByAll
                                  ? `Letto da tutti (${readCount}/${otherMembers.length})`
                                  : readCount > 0
                                  ? `Letto da ${readCount} su ${otherMembers.length} partecipanti`
                                  : 'Consegnato (in attesa di lettura)'
                              }
                              className="flex items-center ml-0.5"
                            >
                              <CheckCheck
                                className={`w-3.5 h-3.5 transition-colors ${
                                  isReadByAll
                                    ? 'text-[#53bdeb]'
                                    : 'text-neutral-400 dark:text-neutral-500'
                                }`}
                              />
                            </span>
                          );
                        })()
                      )}
                    </div>
                  </div>

                  {/* Pulsanti Azione Messaggio per Desktop su mouse hover (Nascosti su mobile) */}
                  <div className="hidden md:flex opacity-0 group-hover:opacity-100 items-center gap-0.5 p-1 rounded-xl bg-white/95 dark:bg-neutral-800/95 border border-neutral-200/70 dark:border-neutral-700/70 shadow-xs transition-opacity shrink-0 mb-1">
                    <button
                      type="button"
                      onClick={() => setReplyingTo(msg)}
                      title="Rispondi / Richiama questo messaggio"
                      className="p-1 rounded-lg hover:bg-neutral-100 dark:hover:bg-neutral-700 text-neutral-600 dark:text-neutral-300 transition-colors cursor-pointer"
                    >
                      <CornerUpLeft className="w-3.5 h-3.5" />
                    </button>

                    {/* Tasto Info Messaggio Desktop */}
                    <button
                      type="button"
                      onClick={() => setInfoModalMessage(msg)}
                      title="Info messaggio (Visualizzazioni)"
                      className="p-1 rounded-lg hover:bg-neutral-100 dark:hover:bg-neutral-700 text-neutral-600 dark:text-neutral-300 hover:text-sky-500 transition-colors cursor-pointer"
                    >
                      <Info className="w-3.5 h-3.5" />
                    </button>

                    {isMe && (
                      <>
                        <button
                          type="button"
                          onClick={() => handleStartEdit(msg)}
                          title="Modifica messaggio"
                          className="p-1 rounded-lg hover:bg-neutral-100 dark:hover:bg-neutral-700 text-neutral-600 dark:text-neutral-300 transition-colors cursor-pointer"
                        >
                          <Edit2 className="w-3.5 h-3.5" />
                        </button>
                        <button
                          type="button"
                          onClick={() => handleDeleteMessage(msg.id)}
                          disabled={deletingMessageId === msg.id}
                          title="Elimina per tutti"
                          className="p-1 rounded-lg hover:bg-red-500 hover:text-white text-neutral-600 dark:text-neutral-300 transition-colors cursor-pointer"
                        >
                          <Trash2 className="w-3.5 h-3.5" />
                        </button>
                      </>
                    )}
                  </div>
                </div>
              </div>
            </div>
          </React.Fragment>
        );
      })
    )}
    <div ref={messagesEndRef} />
  </div>

      {/* BANNER RISPOSTA ATTIVA (Quote Stile WhatsApp) */}
      {replyingTo && (
        <div className="px-4 py-2 bg-neutral-100 dark:bg-neutral-800 border-t border-neutral-200 dark:border-neutral-700 flex items-center justify-between animate-in slide-in-from-bottom-2">
          <div className="flex items-center gap-2.5 min-w-0 border-l-4 border-[#00a884] pl-2.5">
            <div className="min-w-0">
              <p className="text-[11px] font-bold text-[#00a884]">
                Rispondi a {replyingTo.authorName} {replyingTo.authorSurname}:
              </p>
              <p className="text-xs text-neutral-600 dark:text-neutral-300 truncate">
                {replyingTo.attachment?.type === 'image' && '📷 Foto'}
                {replyingTo.attachment?.type === 'audio' && '🎙️ Nota vocale'}
                {replyingTo.attachment?.type === 'file' && '📄 Documento'}
                {replyingTo.content && ` ${replyingTo.content}`}
              </p>
            </div>
          </div>
          <button
            type="button"
            onClick={() => setReplyingTo(null)}
            className="p-1 rounded-lg text-neutral-400 hover:text-neutral-700 dark:hover:text-neutral-200"
          >
            <X className="w-4 h-4" />
          </button>
        </div>
      )}

      {/* INDICATORE OTTIMIZZAZIONE FOTO IN CORSO */}
      {isOptimizingImage && (
        <div className="px-4 py-2.5 bg-amber-50 dark:bg-amber-950/40 border-t border-amber-200 dark:border-amber-800/60 flex items-center gap-2.5 animate-in slide-in-from-bottom-2">
          <Loader2 className="w-4 h-4 animate-spin text-[#f23e2e] shrink-0" />
          <div className="min-w-0">
            <p className="text-xs font-bold text-neutral-900 dark:text-white">
              Ottimizzazione e compressione foto in corso...
            </p>
            <p className="text-[10px] text-neutral-500 dark:text-neutral-400">
              Conversione in formato standard leggero ad alta definizione
            </p>
          </div>
        </div>
      )}



      {/* ANTEPRIMA ALLEGATO IN CODA PRIMA DELL'INVIO */}
      {pendingAttachment && (
        <div className="px-4 py-2 bg-neutral-100 dark:bg-neutral-800 border-t border-neutral-200 dark:border-neutral-700 flex items-center justify-between animate-in slide-in-from-bottom-2">
          <div className="flex items-center gap-3 min-w-0">
            {pendingAttachment.type === 'image' && (
              <img
                src={pendingAttachment.url}
                alt="Anteprima"
                className="w-10 h-10 object-cover rounded-lg border border-neutral-300 dark:border-neutral-700 shrink-0"
              />
            )}
            {pendingAttachment.type === 'file' && (
              <div className="w-10 h-10 rounded-lg bg-red-100 dark:bg-red-950/60 text-[#f23e2e] flex items-center justify-center shrink-0">
                <FileText className="w-5 h-5" />
              </div>
            )}
            <div className="min-w-0">
              <p className="text-xs font-bold text-neutral-900 dark:text-white truncate">
                {pendingAttachment.name || 'Allegato pronto'}
              </p>
              <p className="text-[10px] text-neutral-500">
                {formatFileSize(pendingAttachment.size)} &bull; Clicca Invia per confermare
              </p>
            </div>
          </div>
          <button
            type="button"
            onClick={() => setPendingAttachment(null)}
            className="p-1 rounded-lg text-neutral-400 hover:text-red-500"
          >
            <X className="w-4 h-4" />
          </button>
        </div>
      )}

      {/* BARRA INSERIMENTO MESSAGGIO & REGISTRAZIONE VOCALE */}
      <div className="w-full max-w-full px-2.5 py-2 sm:px-3.5 sm:py-3 bg-white dark:bg-neutral-900 border-t border-neutral-200/80 dark:border-neutral-800 pb-[calc(0.75rem+env(safe-area-inset-bottom,0px))] sm:pb-3.5 shrink-0 box-border overflow-hidden">
        {isRecording ? (
          /* Interfaccia Registratore Vocale in Corso con limite 60 secondi */
          <div className="w-full max-w-full flex items-center justify-between gap-2 bg-red-50 dark:bg-red-950/40 border border-red-200 dark:border-red-900/60 px-3.5 py-2 min-h-[44px] rounded-2xl animate-pulse box-border">
            <div className="flex items-center gap-2 min-w-0">
              <div className="w-2.5 h-2.5 rounded-full bg-red-600 animate-ping shrink-0" />
              <span className={`text-xs font-mono font-bold shrink-0 ${recordingSeconds >= 50 ? 'text-amber-600 dark:text-amber-400 font-black' : 'text-red-600 dark:text-red-400'}`}>
                {formatSeconds(recordingSeconds)} / 1:00
              </span>
              <span className="text-xs font-medium text-neutral-700 dark:text-neutral-300 truncate">
                {recordingSeconds >= 50 ? `Limite 60s (mancano ${60 - recordingSeconds}s)` : 'Registrazione vocale leggera...'}
              </span>
            </div>

            <div className="flex items-center gap-1.5 shrink-0">
              <button
                type="button"
                onClick={cancelRecording}
                className="w-9 h-9 rounded-xl bg-white dark:bg-neutral-800 text-neutral-600 hover:text-red-600 shadow-2xs flex items-center justify-center cursor-pointer transition-colors"
                title="Annulla registrazione"
              >
                <Trash2 className="w-4 h-4" />
              </button>
              <button
                type="button"
                onClick={stopAndSendRecording}
                className="px-3 py-1.5 sm:px-3.5 sm:py-2 rounded-xl bg-[#00a884] hover:bg-[#008f6f] text-white text-xs font-bold flex items-center gap-1.5 shadow-2xs cursor-pointer active:scale-95 transition-all"
                title="Invia nota vocale"
              >
                <Send className="w-3.5 h-3.5" />
                <span>Invia</span>
              </button>
            </div>
          </div>
        ) : (
          /* Normale Barra di Input con Tasti Allegati e Microfono (Ottimizzata per mobile e invio istantaneo senza blocchi) */
          <form onSubmit={handleSendMessage} className="w-full max-w-full flex items-center gap-1.5 sm:gap-2 box-border">
            
            {/* Tasto Invia Immagine */}
            <button
              type="button"
              onClick={() => imageInputRef.current?.click()}
              className="w-9 h-9 sm:w-10 sm:h-10 rounded-2xl flex items-center justify-center text-neutral-500 hover:text-[#f23e2e] hover:bg-neutral-100 dark:hover:bg-neutral-800 transition-colors cursor-pointer shrink-0"
              title="Invia Foto (Compressione automatica ultra-leggera)"
            >
              <ImageIcon className="w-4.5 h-4.5 sm:w-5 sm:h-5" />
            </button>

            {/* Tasto Invia File / Documento */}
            <button
              type="button"
              onClick={() => fileInputRef.current?.click()}
              className="w-9 h-9 sm:w-10 sm:h-10 rounded-2xl flex items-center justify-center text-neutral-500 hover:text-[#f23e2e] hover:bg-neutral-100 dark:hover:bg-neutral-800 transition-colors cursor-pointer shrink-0"
              title="Invia Documento o File"
            >
              <Paperclip className="w-4.5 h-4.5 sm:w-5 sm:h-5" />
            </button>

            {/* Campo Testo (con min-w-0 per evitare overflow flexbox su mobile, mai disabilitato per permettere digitazione continua) */}
            <input
              type="text"
              value={inputText}
              onChange={(e) => setInputText(e.target.value)}
              placeholder={`Scrivi un messaggio in ${contextName}...`}
              className="flex-1 min-w-0 min-h-[44px] sm:min-h-[44px] px-3.5 py-2.5 sm:px-4 bg-neutral-100 dark:bg-neutral-800 border border-neutral-200 dark:border-neutral-700 rounded-2xl text-xs sm:text-xs text-neutral-900 dark:text-white placeholder:text-neutral-400 focus:outline-none focus:ring-2 focus:ring-red-500/20 focus:border-[#f23e2e] transition-all"
            />

            {/* Se c'è testo o allegato pronto: Tasto INVIA. Altrimenti: Tasto MICROFONO */}
            {inputText.trim() || pendingAttachment ? (
              <button
                type="submit"
                className="w-10 h-10 sm:w-11 sm:h-11 rounded-2xl bg-[#00a884] hover:bg-[#008f6f] text-white shadow-md shadow-emerald-600/30 transition-all flex items-center justify-center cursor-pointer active:scale-95 shrink-0"
                aria-label="Invia messaggio istantaneamente"
              >
                <Send className="w-4.5 h-4.5 sm:w-5 sm:h-5 stroke-[2.2px]" />
              </button>
            ) : (
              <button
                type="button"
                onClick={startRecording}
                className="w-10 h-10 sm:w-11 sm:h-11 rounded-2xl bg-neutral-100 dark:bg-neutral-800 hover:bg-[#00a884] hover:text-white text-neutral-600 dark:text-neutral-300 transition-all flex items-center justify-center cursor-pointer active:scale-95 shrink-0 shadow-2xs"
                title="Registra nota vocale (max 60s, compressione voce ultra-leggera)"
              >
                <Mic className="w-4.5 h-4.5 sm:w-5 sm:h-5 stroke-[2.2px]" />
              </button>
            )}
          </form>
        )}
      </div>

      {/* MODALE ANTEPRIMA IMMAGINE A SCHERMO INTERO (Lightbox) */}
      {previewImage && (
        <div
          onClick={() => setPreviewImage(null)}
          className="fixed inset-0 z-50 bg-black/85 backdrop-blur-md flex items-center justify-center p-4 animate-in fade-in"
        >
          <div
            onClick={(e) => e.stopPropagation()}
            className="max-w-3xl max-h-[90vh] flex flex-col items-center gap-3 relative"
          >
            <button
              type="button"
              onClick={() => setPreviewImage(null)}
              className="absolute -top-10 right-0 text-white/80 hover:text-white p-1"
            >
              <X className="w-6 h-6" />
            </button>
            <img
              src={previewImage.url}
              alt={previewImage.name || 'Immagine a schermo intero'}
              className="max-w-full max-h-[80vh] object-contain rounded-2xl shadow-2xl"
            />
            {previewImage.name && (
              <p className="text-xs text-white/70 font-medium">
                {previewImage.name}
              </p>
            )}
          </div>
        </div>
      )}

      {/* MODALE INFO MESSAGGIO (Visualizzazioni e ricevute di lettura stile WhatsApp) */}
      {infoModalMessage && (() => {
        const otherMembers = targetMemberIds.filter((id) => id !== infoModalMessage.authorId);
        const readEntries = Array.isArray(infoModalMessage.readBy) ? infoModalMessage.readBy : [];

        // Membri che hanno letto il messaggio
        const readMembers = otherMembers
          .map((memberId) => {
            const user = allUsers.find((u) => u.id === memberId);
            const receipt = readEntries.find((r) => r.userId === memberId);
            return {
              id: memberId,
              user,
              readAt: receipt?.readAt,
              isRead: Boolean(receipt),
            };
          })
          .filter((item) => item.isRead)
          .sort((a, b) => new Date(b.readAt || 0).getTime() - new Date(a.readAt || 0).getTime());

        // Membri che non hanno ancora visualizzato
        const unreadMembers = otherMembers
          .map((memberId) => {
            const user = allUsers.find((u) => u.id === memberId);
            const isRead = readEntries.some((r) => r.userId === memberId);
            return {
              id: memberId,
              user,
              isRead,
            };
          })
          .filter((item) => !item.isRead);

        const isReadByAll = otherMembers.length > 0 && readMembers.length === otherMembers.length;

        return (
          <div
            onClick={() => setInfoModalMessage(null)}
            className="fixed inset-0 z-50 bg-black/60 backdrop-blur-xs flex items-center justify-center p-3 sm:p-4 animate-in fade-in"
          >
            <div
              onClick={(e) => e.stopPropagation()}
              className="bg-white dark:bg-neutral-900 w-full max-w-md rounded-3xl border border-neutral-200 dark:border-neutral-800 shadow-2xl overflow-hidden flex flex-col max-h-[85vh] animate-in zoom-in-95"
            >
              {/* Header Modale */}
              <div className="px-4 py-3 border-b border-neutral-200/80 dark:border-neutral-800 flex items-center justify-between bg-neutral-50 dark:bg-neutral-900/80 shrink-0">
                <div className="flex items-center gap-2">
                  <div className="w-8 h-8 rounded-xl bg-sky-100 dark:bg-sky-950 text-sky-600 dark:text-sky-400 flex items-center justify-center">
                    <Info className="w-4 h-4 stroke-[2.2px]" />
                  </div>
                  <div>
                    <h3 className="text-sm font-black text-neutral-900 dark:text-white">
                      Info messaggio
                    </h3>
                    <p className="text-[11px] text-neutral-500 dark:text-neutral-400">
                      Stato di lettura e visualizzazione
                    </p>
                  </div>
                </div>
                <button
                  type="button"
                  onClick={() => setInfoModalMessage(null)}
                  className="p-1.5 rounded-xl hover:bg-neutral-200 dark:hover:bg-neutral-800 text-neutral-400 hover:text-neutral-700 dark:hover:text-neutral-200 transition-colors cursor-pointer"
                >
                  <X className="w-5 h-5" />
                </button>
              </div>

              {/* Corpo Modale Scrollabile */}
              <div className="p-4 overflow-y-auto space-y-4 flex-1">
                {/* Anteprima del messaggio */}
                <div className="p-3 rounded-2xl bg-[#d9fdd3] dark:bg-[#005c4b] border border-emerald-200/60 dark:border-emerald-700/40 text-neutral-900 dark:text-white text-xs space-y-1.5 shadow-2xs">
                  <div className="flex items-center justify-between text-[10px] text-neutral-500 dark:text-neutral-300 font-semibold pb-1 border-b border-emerald-300/40 dark:border-emerald-600/30">
                    <span>
                      {infoModalMessage.authorName} {infoModalMessage.authorSurname}
                    </span>
                    <span>{formatReceiptDateTime(infoModalMessage.createdAt)}</span>
                  </div>
                  {infoModalMessage.attachment && (
                    <div className="text-[11px] font-bold text-emerald-800 dark:text-emerald-200 flex items-center gap-1.5">
                      {infoModalMessage.attachment.type === 'image' && '📷 Foto allegata'}
                      {infoModalMessage.attachment.type === 'audio' && '🎙️ Nota vocale'}
                      {infoModalMessage.attachment.type === 'file' &&
                        `📄 ${infoModalMessage.attachment.name || 'Documento'}`}
                    </div>
                  )}
                  {infoModalMessage.content && (
                    <p className="whitespace-pre-wrap break-words">{infoModalMessage.content}</p>
                  )}
                </div>

                {/* Statistiche WhatsApp */}
                <div className="grid grid-cols-2 gap-2">
                  <div className="p-2.5 rounded-2xl bg-sky-50 dark:bg-sky-950/40 border border-sky-200/80 dark:border-sky-800/60 flex items-center gap-2.5">
                    <div className="w-7 h-7 rounded-lg bg-sky-500 text-white flex items-center justify-center shrink-0">
                      <CheckCheck className="w-4 h-4 stroke-[2.5px]" />
                    </div>
                    <div className="min-w-0">
                      <p className="text-[10px] uppercase font-black tracking-wider text-sky-700 dark:text-sky-300">
                        Letti
                      </p>
                      <p className="text-sm font-black text-neutral-900 dark:text-white">
                        {readMembers.length}{' '}
                        <span className="text-[11px] font-normal text-neutral-500">
                          / {otherMembers.length}
                        </span>
                      </p>
                    </div>
                  </div>

                  <div className="p-2.5 rounded-2xl bg-neutral-100 dark:bg-neutral-800/60 border border-neutral-200 dark:border-neutral-700 flex items-center gap-2.5">
                    <div className="w-7 h-7 rounded-lg bg-neutral-400 text-white flex items-center justify-center shrink-0">
                      <CheckCheck className="w-4 h-4 text-white stroke-[2.5px]" />
                    </div>
                    <div className="min-w-0">
                      <p className="text-[10px] uppercase font-black tracking-wider text-neutral-600 dark:text-neutral-400">
                        In attesa
                      </p>
                      <p className="text-sm font-black text-neutral-900 dark:text-white">
                        {unreadMembers.length}{' '}
                        <span className="text-[11px] font-normal text-neutral-500">rimanenti</span>
                      </p>
                    </div>
                  </div>
                </div>

                {/* SEZIONE 1: Letto da */}
                <div className="space-y-2">
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-1.5">
                      <CheckCheck className="w-4 h-4 text-[#53bdeb]" />
                      <h4 className="text-xs font-black uppercase tracking-wider text-neutral-700 dark:text-neutral-300">
                        Letto da ({readMembers.length})
                      </h4>
                    </div>
                    {isReadByAll && (
                      <span className="text-[9px] font-black uppercase px-2 py-0.5 rounded-full bg-emerald-100 dark:bg-emerald-950 text-emerald-700 dark:text-emerald-300">
                        Tutti
                      </span>
                    )}
                  </div>

                  {readMembers.length === 0 ? (
                    <div className="p-3 rounded-2xl bg-neutral-50 dark:bg-neutral-800/40 border border-dashed border-neutral-200 dark:border-neutral-700 text-center">
                      <p className="text-[11px] text-neutral-400">
                        Nessun membro ha ancora visualizzato questo messaggio.
                      </p>
                    </div>
                  ) : (
                    <div className="divide-y divide-neutral-100 dark:divide-neutral-800 rounded-2xl border border-neutral-200/80 dark:border-neutral-800 bg-neutral-50/50 dark:bg-neutral-900/50 overflow-hidden">
                      {readMembers.map((m) => {
                        const name = m.user ? `${m.user.name} ${m.user.surname}` : 'Membro';
                        return (
                          <div key={m.id} className="p-2.5 flex items-center justify-between gap-2.5">
                            <div className="flex items-center gap-2.5 min-w-0">
                              <UserAvatar
                                user={m.user}
                                size="sm"
                                className="w-8 h-8 text-xs shrink-0"
                              />
                              <div className="min-w-0">
                                <p className="text-xs font-bold text-neutral-900 dark:text-white truncate">
                                  {name}
                                </p>
                                <p className="text-[10px] text-emerald-600 dark:text-emerald-400 font-medium">
                                  {formatReceiptDateTime(m.readAt)}
                                </p>
                              </div>
                            </div>
                            <span className="text-[#53bdeb] shrink-0">
                              <CheckCheck className="w-4 h-4" />
                            </span>
                          </div>
                        );
                      })}
                    </div>
                  )}
                </div>

                {/* SEZIONE 2: Non ancora letto da */}
                <div className="space-y-2">
                  <div className="flex items-center gap-1.5">
                    <CheckCheck className="w-4 h-4 text-neutral-400 dark:text-neutral-500" />
                    <h4 className="text-xs font-black uppercase tracking-wider text-neutral-700 dark:text-neutral-300">
                      Non ancora letto da ({unreadMembers.length})
                    </h4>
                  </div>

                  {unreadMembers.length === 0 ? (
                    <div className="p-2.5 rounded-2xl bg-emerald-50 dark:bg-emerald-950/40 border border-emerald-200/60 dark:border-emerald-800/40 text-center flex items-center justify-center gap-1.5 text-emerald-700 dark:text-emerald-300 text-xs font-bold">
                      <Check className="w-4 h-4 stroke-[3px]" />
                      <span>Visualizzato da tutti i membri del gruppo</span>
                    </div>
                  ) : (
                    <div className="divide-y divide-neutral-100 dark:divide-neutral-800 rounded-2xl border border-neutral-200/80 dark:border-neutral-800 bg-neutral-50/50 dark:bg-neutral-900/50 overflow-hidden">
                      {unreadMembers.map((m) => {
                        const name = m.user ? `${m.user.name} ${m.user.surname}` : 'Membro';
                        return (
                          <div key={m.id} className="p-2.5 flex items-center justify-between gap-2.5 opacity-85">
                            <div className="flex items-center gap-2.5 min-w-0">
                              <UserAvatar
                                user={m.user}
                                size="sm"
                                className="w-8 h-8 text-xs shrink-0 grayscale-[30%]"
                              />
                              <div className="min-w-0">
                                <p className="text-xs font-semibold text-neutral-900 dark:text-white truncate">
                                  {name}
                                </p>
                                <p className="text-[10px] text-neutral-400">In attesa di lettura</p>
                              </div>
                            </div>
                            <span className="text-neutral-400 dark:text-neutral-500 shrink-0">
                              <CheckCheck className="w-4 h-4" />
                            </span>
                          </div>
                        );
                      })}
                    </div>
                  )}
                </div>
              </div>

              {/* Footer */}
              <div className="p-3 border-t border-neutral-100 dark:border-neutral-800 bg-neutral-50 dark:bg-neutral-900/80 flex items-center justify-end">
                <button
                  type="button"
                  onClick={() => setInfoModalMessage(null)}
                  className="px-4 py-2 rounded-xl text-xs font-bold bg-neutral-200 dark:bg-neutral-800 text-neutral-700 dark:text-neutral-300 hover:bg-neutral-300 cursor-pointer"
                >
                  Chiudi
                </button>
              </div>
            </div>
          </div>
        );
      })()}

    </div>
  );
};
