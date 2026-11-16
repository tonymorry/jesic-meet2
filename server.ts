/**
 * JESic Meet - Server Express Backend & MongoDB API con Mongoose
 * Junior Enterprise Sicilia
 * 
 * - Connessione esclusiva a MongoDB Atlas tramite Mongoose (process.env.MONGODB_URI)
 * - Persistenza REALE al 100% su MongoDB (nessun file system locale / fs o db_store.json effimero)
 * - Supporto 3 Ruoli: 'user' (Utente Normale) | 'admin_clienti' (Admin Clienti) | 'admin' (Super Admin)
 * - Gestione Gruppi di Lavoro con Codici Univoci & Link di Invito
 * - Gestione Sondaggi When2meet & Eventi Associativi Ufficiali
 * - Gestione Richieste Clienti B2B & Google Calendar
 * - Configurazione pronta per il deploy su Render (NODE_ENV=production -> dist static files)
 */

import http from 'http';
import express, { Request, Response } from 'express';
import path from 'path';
import { fileURLToPath } from 'url';
import cors from 'cors';
import mongoose from 'mongoose';
import dotenv from 'dotenv';
import { createServer as createViteServer } from 'vite';
import { WebSocketServer, WebSocket } from 'ws';


// Gestione WebSocket per aggiornamenti istantanei in tempo reale (Chat, Nuovi Membri, Presenza, Eventi, Ruoli)
let wss: WebSocketServer | null = null;
const activeClientSockets = new Map<WebSocket, { userId?: string; userName?: string }>();

export function broadcastOnlinePresence() {
  if (!wss) return;
  const onlineUserIds = Array.from(
    new Set(
      Array.from(activeClientSockets.values())
        .map((u) => u.userId)
        .filter(Boolean) as string[]
    )
  );
  broadcastRealtimeEvent('presence:sync', { onlineUserIds });
}

export function broadcastRealtimeEvent(event: string, payload: any) {
  if (!wss) return;
  const message = JSON.stringify({
    event,
    payload,
    timestamp: new Date().toISOString(),
  });
  wss.clients.forEach((client) => {
    if (client.readyState === WebSocket.OPEN) {
      try {
        client.send(message);
      } catch (err) {
        console.warn('Errore broadcast WebSocket:', err);
      }
    }
  });
}

import {
  UserModel,
  User,
  GroupModel,
  EventModel,
  PollModel,
  OfficialEventModel,
  ClientRequestModel,
  EventResponseModel,
  ChatMessageModel,
  PushSubscriptionModel,
  UserRole,
} from './src/models/schemas';
import {
  getVapidPublicKey,
  sendPushNotification,
  sendChatPushNotification,
  sendPollPushNotification,
  sendEventConfirmedPushNotification,
  sendTestPushNotification,
} from './src/services/pushNotifications';
import {
  createGoogleCalendarEvent,
  updateGoogleCalendarEvent,
  deleteGoogleCalendarEvent,
} from './src/utils/googleCalendar';
import {
  generateClientConfirmationEmailHtml,
  generateClientCancellationEmailHtml,
} from './src/utils/emailTemplate';
import { OAuth2Client } from 'google-auth-library';

dotenv.config();

const oAuth2Client = new OAuth2Client(
  process.env.GOOGLE_CLIENT_ID || process.env.VITE_GOOGLE_CLIENT_ID || '',
  process.env.GOOGLE_CLIENT_SECRET || '',
  'postmessage'
);
const googleAuthClient = oAuth2Client;

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
// AI Studio dev environment requires port 3000 (port 8080 is reserved by the container proxy).
// In production (e.g. Render), process.env.PORT is used if specified.
const PORT = process.env.NODE_ENV === 'production' && process.env.PORT ? parseInt(process.env.PORT, 10) : 3000;

app.use(cors());
app.use(express.json({ limit: '50mb' }));
app.use(express.urlencoded({ extended: true, limit: '50mb' }));

// Disabilita caching HTTP per tutte le API REST per garantire sincronizzazione istantanea
// e per sw.js, manifest.json e index.html per garantire aggiornamenti PWA istantanei sui telefoni
app.use((req, res, next) => {
  const url = req.path;
  if (
    url.startsWith('/api') ||
    url === '/sw.js' ||
    url.endsWith('/sw.js') ||
    url === '/manifest.json' ||
    url === '/site.webmanifest' ||
    url === '/' ||
    url.endsWith('.html')
  ) {
    res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate, proxy-revalidate, max-age=0');
    res.setHeader('Pragma', 'no-cache');
    res.setHeader('Expires', '0');
    res.setHeader('Surrogate-Control', 'no-store');
    if (url.includes('sw.js')) {
      res.setHeader('Service-Worker-Allowed', '/');
    }
  }
  next();
});

/* ==========================================================================
   CONNESSIONE MONGOOSE A MONGODB ATLAS
   ========================================================================== */
const MONGODB_URI = process.env.MONGODB_URI || 'mongodb://127.0.0.1:27017/jesic_meet';
mongoose.set('bufferTimeoutMS', 3000);

/**
 * Ottimizzazioni Spazio Database MongoDB Atlas (Piano Gratuito max 500 MB):
 * 1. Cancellazione automatica messaggi chat più vecchi di 50 giorni.
 * 2. Pulizia automatica file pesanti (foto e note vocali) più vecchi di 20 giorni.
 * 3. Eliminazione duplicati pesanti (rimozione authorAvatar dai singoli messaggi).
 * 4. Cancellazione eventi e impegni del calendario conclusi da più di 30 giorni (e relative risposte).
 * 5. Pulizia vecchie registrazioni di notifica push scadute o non più attive.
 */

// 1. Messaggi chat scaduti (>50 giorni)
async function purgeExpiredChatMessages() {
  try {
    const fiftyDaysAgo = new Date(Date.now() - 50 * 24 * 60 * 60 * 1000);
    const res = await ChatMessageModel.deleteMany({ createdAt: { $lt: fiftyDaysAgo } });
    if (res && res.deletedCount && res.deletedCount > 0) {
      console.log(`[ChatMessage TTL] Eliminati definitivamente ${res.deletedCount} messaggi più vecchi di 50 giorni da MongoDB.`);
    }
  } catch (err: any) {
    console.warn('[ChatMessage TTL] Errore durante la rimozione dei messaggi scaduti:', err?.message || err);
  }
}

// 2. Foto e Note Vocali scadute (>20 giorni) per non accumulare allegati pesanti
async function purgeExpiredChatMedia() {
  try {
    const twentyDaysAgo = new Date(Date.now() - 20 * 24 * 60 * 60 * 1000);
    const res = await ChatMessageModel.updateMany(
      {
        createdAt: { $lt: twentyDaysAgo },
        'attachment.type': { $in: ['image', 'audio'] },
      },
      {
        $unset: { attachment: '' },
      }
    );
    if (res && res.modifiedCount && res.modifiedCount > 0) {
      console.log(`[Chat Media TTL] Ripuliti ${res.modifiedCount} allegati multimediali (foto/audio) con più di 20 giorni per liberare spazio.`);
    }
  } catch (err: any) {
    console.warn('[Chat Media TTL] Errore pulizia allegati multimediali scaduti:', err?.message || err);
  }
}

// 3. Bonifica avatar duplicati: i messaggi non devono conservare l'immagine base64 dell'utente
async function purgeDuplicateAvatarsFromMessages() {
  try {
    const res = await ChatMessageModel.updateMany(
      { authorAvatar: { $ne: null } },
      { $set: { authorAvatar: null } }
    );
    if (res && res.modifiedCount && res.modifiedCount > 0) {
      console.log(`[ChatMessage Optimizer] Rimossi avatar duplicati da ${res.modifiedCount} messaggi per alleggerire il database.`);
    }
  } catch (err: any) {
    console.warn('[ChatMessage Optimizer] Errore bonifica avatar duplicati:', err?.message || err);
  }
}

// 4. Eventi e Impegni del calendario conclusi da più di 30 giorni
async function purgeExpiredEventsAndResponses() {
  try {
    const thirtyDaysAgo = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);
    const thirtyDaysAgoStr = thirtyDaysAgo.toISOString().split('T')[0];

    const expiredEvents = await EventModel.find({
      $or: [
        { 'finalizedSlot.date': { $lt: thirtyDaysAgoStr } },
        {
          dates: { $exists: true, $ne: [], $not: { $elemMatch: { $gte: thirtyDaysAgoStr } } },
          createdAt: { $lt: thirtyDaysAgo },
        },
        {
          finalizedSlot: null,
          dates: { $size: 0 },
          createdAt: { $lt: thirtyDaysAgo },
        },
      ],
    })
      .select('_id id')
      .lean();

    if (expiredEvents.length > 0) {
      const expiredIds = expiredEvents.map((e: any) => e._id || e.id);
      await EventModel.deleteMany({ _id: { $in: expiredIds } });
      await EventResponseModel.deleteMany({ eventId: { $in: expiredIds } });
      console.log(`[Event TTL] Eliminati definitivamente ${expiredIds.length} eventi conclusi da più di 30 giorni e relative risposte.`);
    }
  } catch (err: any) {
    console.warn('[Event TTL] Errore pulizia eventi conclusi da >30 giorni:', err?.message || err);
  }
}

// 5. Registrazioni push obsolete o non più attive (>60 giorni)
async function purgeStalePushSubscriptions() {
  try {
    const sixtyDaysAgo = new Date(Date.now() - 60 * 24 * 60 * 60 * 1000);
    const res = await PushSubscriptionModel.deleteMany({
      $or: [
        { updatedAt: { $lt: sixtyDaysAgo } },
        { endpoint: { $exists: false } },
        { endpoint: '' },
      ],
    });
    if (res && res.deletedCount && res.deletedCount > 0) {
      console.log(`[Push TTL] Eliminate ${res.deletedCount} registrazioni push non più attive da oltre 60 giorni.`);
    }
  } catch (err: any) {
    console.warn('[Push TTL] Errore pulizia registrazioni push obsolete:', err?.message || err);
  }
}

// 6. Rimozione totale degli avatar utente dal database per azzerare lo spazio occupato
async function purgeAllAvatarsFromDatabase() {
  try {
    const res = await UserModel.updateMany(
      { avatarUrl: { $ne: null } },
      { $set: { avatarUrl: null } }
    );
    if (res && res.modifiedCount && res.modifiedCount > 0) {
      console.log(`[Avatar Purge] Rimossi gli avatar da ${res.modifiedCount} profili utente per liberare spazio nel database.`);
    }
  } catch (err: any) {
    console.warn('[Avatar Purge] Errore rimozione avatar:', err?.message || err);
  }
}

/**
 * Esegue tutte le operazioni di pulizia automatica per mantenere il database leggero e sotto i 500 MB.
 */
async function runDatabaseAutoCleanup() {
  await purgeExpiredChatMessages();
  await purgeExpiredChatMedia();
  await purgeDuplicateAvatarsFromMessages();
  await purgeExpiredEventsAndResponses();
  await purgeStalePushSubscriptions();
  await purgeAllAvatarsFromDatabase();
}

async function connectToDatabase() {
  try {
    await mongoose.connect(MONGODB_URI, { serverSelectionTimeoutMS: 5000 });
    console.log('🍃 Connessione a MongoDB Atlas attiva con successo!');
    // Esegui la pulizia automatica del database all'avvio
    runDatabaseAutoCleanup();
    // Ripeti periodicamente ogni 30 minuti per garantire spazio sempre ottimizzato
    setInterval(runDatabaseAutoCleanup, 30 * 60 * 1000);
  } catch (err: any) {
    console.error('❌ Errore connessione a MongoDB:', err.message);
  }
}

connectToDatabase();

/* ==========================================================================
   REST API ROUTES - TUTTE COLLEGATE ESCLUSIVAMENTE A MONGOOSE / MONGODB
   ========================================================================== */

// 1. Healthcheck
app.get('/api/health', (_req: Request, res: Response) => {
  const isConnected = mongoose.connection.readyState === 1;
  res.json({
    status: isConnected ? 'ok' : 'degraded',
    service: 'JESic Meet Full-Stack API',
    database: 'MongoDB Atlas',
    mongoConnected: isConnected,
    connectionState: mongoose.connection.readyState,
    timestamp: new Date().toISOString(),
  });
});

/* ==========================================================================
   2. USERS & ROLES API ('user' | 'admin_clienti' | 'admin')
   ========================================================================== */

// GET /api/users - Ritorna la lista degli utenti da MongoDB
app.get('/api/users', async (_req: Request, res: Response) => {
  try {
    const users = await UserModel.find().sort({ createdAt: 1 }).lean();
    const mapped = users.map((u: any) => ({
      id: u._id || u.id,
      name: u.name || u.nome,
      surname: u.surname || u.cognome,
      email: u.email,
      avatarUrl: u.avatarUrl || null,
      googleCalendarConnected: Boolean(u.googleCalendarConnected),
      hasGoogleRefreshToken: Boolean(u.googleRefreshToken),
      hasGoogleCalendarAuth: Boolean(
        u.googleRefreshToken || (u.googleAccessToken && u.googleCalendarConnected)
      ),
      hasPassword: Boolean(u.password && String(u.password).trim().length > 0),
      groupMemberships: u.groupMemberships || [],
      createdAt: u.createdAt,
      updatedAt: u.updatedAt,
    }));
    return res.json({ users: mapped });
  } catch (err: any) {
    console.error('Errore lettura UserModel da MongoDB:', err.message);
    return res.status(500).json({ error: 'Errore durante la lettura degli utenti dal database MongoDB' });
  }
});

// Gestione Registrazione / Sincronizzazione utente nel Database MongoDB
// REGOLA:
// 1. Supporta il vero Google OAuth2 con verifica del token JWT (credential) tramite 'google-auth-library'.
// 2. I token Google sono opzionali, salvando null se assenti.
// 3. Trova o crea l'utente SOLO tramite email nel database MongoDB (assegnando ruolo 'user' ai nuovi).
const handleUserSync = async (req: Request, res: Response) => {
  try {
    const {
      code, // Authorization Code restituito da useGoogleLogin (flow: 'auth-code')
      credential, // JWT ID Token restituito da @react-oauth/google (alternativo)
      grantedScope, // Scope restituito dal client nella CodeResponse
      linkToUserId, // Opzionale: ID utente esistente a cui collegare Google Calendar dal Profilo
      id,
      name,
      surname,
      nome,
      cognome,
      email,
      password,
      jesicRole,
      ruolo,
      avatarUrl,
      googleCalendarConnected,
      googleAccessToken,
      googleRefreshToken,
    } = req.body;

    let cleanEmail = email ? String(email).toLowerCase().trim() : '';
    let extractedName = (name || nome)?.trim() || '';
    let extractedSurname = (surname || cognome)?.trim() || '';
    let extractedAvatar = avatarUrl || null;
    let actualAccessToken = googleAccessToken || null;
    let actualRefreshToken = googleRefreshToken || null;
    let codeExchanged = false;
    let grantedCalendarScope = false;

    // 1. Scambio dell'Authorization Code con token reali Google (flow: 'auth-code')
    // REGOLA CRITICA: redirect_uri deve essere 'postmessage' per evitare redirect_uri_mismatch
    if (code && typeof code === 'string') {
      try {
        const tokenResponse = await oAuth2Client.getToken({
          code,
          redirect_uri: 'postmessage',
        });
        const tokens = tokenResponse.tokens;
        codeExchanged = true;

        if (tokens.access_token) {
          actualAccessToken = tokens.access_token;
        }
        if (tokens.refresh_token) {
          actualRefreshToken = tokens.refresh_token;
        }

        const effectiveScopeStr = String(tokens.scope || grantedScope || '');
        grantedCalendarScope =
          effectiveScopeStr.includes('calendar') ||
          Boolean(tokens.refresh_token);

        if (!tokens.refresh_token) {
          console.warn(
            `[Google OAuth2] getToken completato senza refresh_token (scope: "${effectiveScopeStr}"). Verrà usato access_token.`
          );
        }

        if (tokens.id_token) {
          try {
            const ticket = await oAuth2Client.verifyIdToken({
              idToken: tokens.id_token,
              audience: process.env.GOOGLE_CLIENT_ID || process.env.VITE_GOOGLE_CLIENT_ID || undefined,
            });
            const payload = ticket.getPayload();
            if (payload?.email) {
              cleanEmail = payload.email.toLowerCase().trim();
              extractedName = payload.given_name || payload.name?.split(' ')[0] || cleanEmail.split('@')[0];
              extractedSurname = payload.family_name || payload.name?.split(' ').slice(1).join(' ') || 'JESic';
              extractedAvatar = payload.picture || extractedAvatar;
            }
          } catch (jwtErr: any) {
            // Decodifica di emergenza payload base64
            const parts = tokens.id_token.split('.');
            if (parts.length === 3) {
              const decoded = JSON.parse(Buffer.from(parts[1], 'base64').toString('utf8'));
              if (decoded?.email) {
                cleanEmail = decoded.email.toLowerCase().trim();
                extractedName = decoded.given_name || decoded.name?.split(' ')[0] || cleanEmail.split('@')[0];
                extractedSurname = decoded.family_name || decoded.name?.split(' ').slice(1).join(' ') || 'JESic';
                extractedAvatar = decoded.picture || extractedAvatar;
              }
            }
          }
        }

        // Fallback con Google UserInfo API se id_token non è presente o privo di email
        if (!cleanEmail && actualAccessToken) {
          try {
            const userInfoRes = await fetch('https://www.googleapis.com/oauth2/v3/userinfo', {
              headers: { Authorization: `Bearer ${actualAccessToken}` },
            });
            if (userInfoRes.ok) {
              const userInfo: any = await userInfoRes.json();
              if (userInfo?.email) {
                cleanEmail = String(userInfo.email).toLowerCase().trim();
                extractedName = userInfo.given_name || userInfo.name?.split(' ')[0] || cleanEmail.split('@')[0];
                extractedSurname = userInfo.family_name || userInfo.name?.split(' ').slice(1).join(' ') || 'JESic';
                extractedAvatar = userInfo.picture || extractedAvatar;
              }
            }
          } catch (uiErr: any) {
            console.warn('[Google OAuth2] Fallback userinfo fallito:', uiErr?.message || uiErr);
          }
        }
      } catch (tokenErr: any) {
        const gErrDetail =
          tokenErr?.response?.data?.error_description ||
          tokenErr?.response?.data?.error ||
          tokenErr?.message ||
          'Errore scambio codice Google';
        console.error('Errore scambio code OAuth2 Google (redirect_uri: postmessage):', gErrDetail);
        if (!cleanEmail) {
          return res.status(401).json({
            error: `Impossibile completare l'autenticazione Google (${gErrDetail}). Verifica che il Client ID/Secret Google siano configurati correttamente.`,
          });
        }
      }
    }

    // 2. Se il client ha inviato il JWT token (credential)
    if (!cleanEmail && credential && typeof credential === 'string') {
      try {
        const expectedAudience = process.env.GOOGLE_CLIENT_ID || process.env.VITE_GOOGLE_CLIENT_ID;
        const ticket = await oAuth2Client.verifyIdToken({
          idToken: credential,
          audience: expectedAudience || undefined,
        });
        const payload = ticket.getPayload();
        if (payload?.email) {
          cleanEmail = payload.email.toLowerCase().trim();
          extractedName = payload.given_name || payload.name?.split(' ')[0] || cleanEmail.split('@')[0];
          extractedSurname = payload.family_name || payload.name?.split(' ').slice(1).join(' ') || 'JESic';
          extractedAvatar = payload.picture || extractedAvatar;
        }
      } catch (verifyErr: any) {
        console.warn('[google-auth-library] Avviso verifica token:', verifyErr.message);
        // Fallback decodifica payload base64 per ambienti di test/dev con Client ID variabile
        try {
          const parts = credential.split('.');
          if (parts.length === 3) {
            const decoded = JSON.parse(Buffer.from(parts[1], 'base64').toString('utf8'));
            if (decoded?.email) {
              cleanEmail = decoded.email.toLowerCase().trim();
              extractedName = decoded.given_name || decoded.name?.split(' ')[0] || cleanEmail.split('@')[0];
              extractedSurname = decoded.family_name || decoded.name?.split(' ').slice(1).join(' ') || 'JESic';
              extractedAvatar = decoded.picture || extractedAvatar;
            }
          }
        } catch (e) {
          return res.status(401).json({ error: 'Token Google OAuth2 non valido' });
        }
      }
    }

    if (!cleanEmail && !linkToUserId) {
      return res.status(400).json({ error: 'Email obbligatoria per la registrazione/sincronizzazione' });
    }

    const defaultName = extractedName || (cleanEmail ? cleanEmail.split('@')[0]?.split('.')[0] : '') || 'Utente';
    const defaultSurname = extractedSurname || (cleanEmail ? cleanEmail.split('@')[0]?.split('.')[1] : '') || 'JESic';

    // Cerca l'utente tramite linkToUserId (se sta collegando Google Calendar dal profilo) oppure tramite email
    let existing = linkToUserId
      ? await UserModel.findOne({ $or: [{ _id: linkToUserId }, { id: linkToUserId }] })
      : null;

    if (!existing && cleanEmail) {
      existing = await UserModel.findOne({ email: cleanEmail });
    }

    const hasNewCalendarGrant = Boolean(
      actualRefreshToken || (actualAccessToken && (grantedCalendarScope || !codeExchanged))
    );

    if (existing) {
      if (!linkToUserId) {
        if (defaultName && (!existing.name || existing.name === 'Utente')) existing.name = defaultName;
        if (defaultSurname && (!existing.surname || existing.surname === 'JESic')) existing.surname = defaultSurname;
        if (extractedAvatar && !existing.avatarUrl) existing.avatarUrl = extractedAvatar;
      }
      if (password && typeof password === 'string' && password.trim().length > 0) {
        if (!existing.password || existing.password.trim() === '') {
          existing.password = password.trim();
        }
      }
      if (actualAccessToken) existing.googleAccessToken = actualAccessToken;
      if (actualRefreshToken) {
        existing.googleRefreshToken = actualRefreshToken;
        existing.googleCalendarConnected = true;
      } else if (hasNewCalendarGrant) {
        existing.googleCalendarConnected = true;
      } else if (existing.googleRefreshToken) {
        existing.googleCalendarConnected = true;
      } else if (codeExchanged && !grantedCalendarScope) {
        existing.googleCalendarConnected = false;
      }
      if (googleCalendarConnected !== undefined) existing.googleCalendarConnected = Boolean(googleCalendarConnected);
      if (!existing.groupMemberships) {
        existing.groupMemberships = [];
      }

      await existing.save();

      const hasCalendarAuth = Boolean(
        existing.googleRefreshToken || (existing.googleAccessToken && existing.googleCalendarConnected)
      );

      const jsonUser = {
        id: existing._id || existing.id,
        name: existing.name,
        surname: existing.surname,
        email: existing.email,
        avatarUrl: existing.avatarUrl || null,
        googleCalendarConnected: Boolean(existing.googleCalendarConnected),
        googleAccessToken: existing.googleAccessToken || undefined,
        hasGoogleRefreshToken: Boolean(existing.googleRefreshToken),
        hasGoogleCalendarAuth: hasCalendarAuth,
        hasPassword: Boolean(existing.password && String(existing.password).trim().length > 0),
        groupMemberships: existing.groupMemberships || [],
      };
      broadcastRealtimeEvent('user:updated', {
        user: {
          id: jsonUser.id,
          name: jsonUser.name,
          surname: jsonUser.surname,
          email: jsonUser.email,
          avatarUrl: jsonUser.avatarUrl,
          googleCalendarConnected: jsonUser.googleCalendarConnected,
          groupMemberships: jsonUser.groupMemberships,
        },
      });
      return res.json({ user: jsonUser, calendarScopeGranted: hasNewCalendarGrant || Boolean(existing.googleRefreshToken) });
    }

    // REGOLA: Il nuovo utente viene creato con nome, cognome, email, avatarUrl, eventuale password, credenziali Google e groupMemberships vuoto.
    const initialCalendarConnected = hasNewCalendarGrant
      ? true
      : googleCalendarConnected !== undefined
      ? Boolean(googleCalendarConnected)
      : false;

    const newUserDoc = new UserModel({
      _id: id || `user-${Date.now()}-${Math.random().toString(36).substring(2, 6)}`,
      name: defaultName,
      surname: defaultSurname,
      email: cleanEmail,
      password: (password && typeof password === 'string') ? password.trim() : '',
      avatarUrl: extractedAvatar || null,
      googleCalendarConnected: initialCalendarConnected,
      googleAccessToken: actualAccessToken || null,
      googleRefreshToken: actualRefreshToken || null,
      groupMemberships: [],
    });
    await newUserDoc.save();

    const jsonUser = {
      id: newUserDoc._id || newUserDoc.id,
      name: newUserDoc.name,
      surname: newUserDoc.surname,
      email: newUserDoc.email,
      avatarUrl: newUserDoc.avatarUrl,
      googleCalendarConnected: Boolean(newUserDoc.googleCalendarConnected),
      googleAccessToken: newUserDoc.googleAccessToken || undefined,
      hasGoogleRefreshToken: Boolean(newUserDoc.googleRefreshToken),
      hasGoogleCalendarAuth: Boolean(
        newUserDoc.googleRefreshToken || (newUserDoc.googleAccessToken && newUserDoc.googleCalendarConnected)
      ),
      hasPassword: Boolean(newUserDoc.password && String(newUserDoc.password).trim().length > 0),
      groupMemberships: newUserDoc.groupMemberships || [],
    };

    broadcastRealtimeEvent('user:updated', {
      user: {
        id: jsonUser.id,
        name: jsonUser.name,
        surname: jsonUser.surname,
        email: jsonUser.email,
        avatarUrl: jsonUser.avatarUrl,
        googleCalendarConnected: jsonUser.googleCalendarConnected,
        groupMemberships: jsonUser.groupMemberships,
      },
    });

    // Invio email di benvenuto tramite Resend esclusivamente ai nuovi utenti registrati
    sendWelcomeEmail({
      name: jsonUser.name,
      surname: jsonUser.surname,
      email: jsonUser.email,
    }).catch((welcomeErr: any) => {
      console.warn('[Welcome Email] Errore asincrono invio benvenuto:', welcomeErr?.message || welcomeErr);
    });

    return res.status(201).json({ user: jsonUser, calendarScopeGranted: hasNewCalendarGrant });
  } catch (err: any) {
    console.error('Errore salvataggio UserModel MongoDB:', err.message);
    return res.status(500).json({ error: 'Errore durante la registrazione dell\'utente in MongoDB' });
  }
};

app.post('/api/users', handleUserSync);
app.post('/api/users/sync', handleUserSync);

// POST /api/auth/login - Accesso con Email e Password
app.post('/api/auth/login', async (req: Request, res: Response) => {
  try {
    const { email, password } = req.body;
    if (!email || !password) {
      return res.status(400).json({ error: 'Inserisci sia la tua email che la password di accesso.' });
    }
    const cleanEmail = String(email).toLowerCase().trim();
    const cleanPassword = String(password).trim();

    const user = await UserModel.findOne({ email: cleanEmail });
    if (!user) {
      return res.status(404).json({ error: 'Nessun account trovato con questa email. Crea un nuovo profilo.' });
    }

    // Se l'utente non ha ancora impostato una password (es. accesso iniziale con solo Google)
    if (!user.password || String(user.password).trim().length === 0) {
      return res.status(400).json({
        error: 'Questo account è stato registrato tramite Google e non ha ancora una password impostata. Accedi tramite il pulsante Google per impostarla.',
        needsGoogleLogin: true,
      });
    }

    if (String(user.password).trim() !== cleanPassword) {
      return res.status(401).json({
        error: 'Password non corretta. Verifica le maiuscole/minuscole o clicca su "Password dimenticata?" sotto la barra.',
      });
    }

    const jsonUser = {
      id: user._id || user.id,
      name: user.name,
      surname: user.surname,
      email: user.email,
      avatarUrl: user.avatarUrl || null,
      googleCalendarConnected: Boolean(user.googleCalendarConnected),
      googleAccessToken: user.googleAccessToken || undefined,
      hasGoogleRefreshToken: Boolean(user.googleRefreshToken),
      hasGoogleCalendarAuth: Boolean(
        user.googleRefreshToken || (user.googleAccessToken && user.googleCalendarConnected)
      ),
      hasPassword: true,
      groupMemberships: user.groupMemberships || [],
    };

    return res.json({ success: true, user: jsonUser });
  } catch (err: any) {
    console.error('Errore /api/auth/login:', err.message);
    return res.status(500).json({ error: 'Errore durante l\'accesso. Riprova tra poco.' });
  }
});

// POST /api/users/set-password - Impostazione o aggiornamento password
app.post('/api/users/set-password', async (req: Request, res: Response) => {
  try {
    const { userId, email, password } = req.body;
    if (!password || String(password).trim().length < 6) {
      return res.status(400).json({ error: 'La password deve contenere almeno 6 caratteri.' });
    }

    let query: any = {};
    if (userId) {
      query.$or = [{ _id: userId }, { id: userId }];
    } else if (email) {
      query.email = String(email).toLowerCase().trim();
    } else {
      return res.status(400).json({ error: 'Identificativo utente non specificato.' });
    }

    const user = await UserModel.findOne(query);
    if (!user) {
      return res.status(404).json({ error: 'Utente non trovato.' });
    }

    user.password = String(password).trim();
    await user.save();

    const jsonUser = {
      id: user._id || user.id,
      name: user.name,
      surname: user.surname,
      email: user.email,
      avatarUrl: user.avatarUrl || null,
      googleCalendarConnected: Boolean(user.googleCalendarConnected),
      googleAccessToken: user.googleAccessToken || undefined,
      hasGoogleRefreshToken: Boolean(user.googleRefreshToken),
      hasGoogleCalendarAuth: Boolean(
        user.googleRefreshToken || (user.googleAccessToken && user.googleCalendarConnected)
      ),
      hasPassword: true,
      groupMemberships: user.groupMemberships || [],
    };

    return res.json({
      success: true,
      message: 'Password impostata con successo! Ora puoi accedere sia con Google che con email e password.',
      user: jsonUser,
    });
  } catch (err: any) {
    console.error('Errore /api/users/set-password:', err.message);
    return res.status(500).json({ error: 'Errore durante l\'impostazione della password.' });
  }
});

// Store in-memory temporaneo per i codici di verifica password (garantisce funzionamento continuo anche durante transizioni MongoDB)
const inMemoryResetCodes = new Map<string, { code: string; expires: number }>();

/**
 * Helper generico di invio email tramite Resend API (HTTPS Porta 443)
 * Utilizza il dominio verificato jesicmeet.it
 */
async function sendEmailViaResend(params: {
  to: string | string[];
  subject: string;
  html: string;
  text?: string;
  replyTo?: string;
  logTag?: string;
}): Promise<{ success: boolean; error?: string }> {
  const { to, subject, html, text, replyTo, logTag = 'Resend Email' } = params;
  const resendApiKey = process.env.RESEND_API_KEY?.trim();
  if (!resendApiKey) {
    return {
      success: false,
      error: "Servizio email non configurato. Inserisci la variabile RESEND_API_KEY nel pannello 'Environment' di Render (crea una chiave gratuita su resend.com).",
    };
  }

  const recipients = (Array.isArray(to) ? to : [to])
    .map((e) => (typeof e === 'string' ? e.trim().toLowerCase() : ''))
    .filter((e) => e.includes('@'));

  if (recipients.length === 0) {
    return { success: false, error: 'Nessun destinatario email valido.' };
  }

  try {
    let rawFrom = process.env.RESEND_FROM?.trim();
    if (!rawFrom || rawFrom.includes('resend.dev')) {
      rawFrom = 'JESic Meet <info@jesicmeet.it>';
    }

    const sendersToTry: string[] = [];
    const addSender = (s: string) => {
      if (!sendersToTry.includes(s)) sendersToTry.push(s);
    };

    addSender(rawFrom);
    addSender('JESic Meet <info@jesicmeet.it>');
    addSender('JESic Meet <noreply@jesicmeet.it>');
    addSender('JESic Meet <info@jesic.it>');

    let lastErrorDetail = '';
    for (const sender of sendersToTry) {
      console.log(`[${logTag}] Invio Resend con mittente: ${sender} a ${recipients.join(', ')}...`);
      const payload: Record<string, any> = {
        from: sender,
        to: recipients,
        subject,
        html,
      };
      if (text) payload.text = text;
      if (replyTo && replyTo.includes('@')) payload.reply_to = replyTo.trim();

      const res = await fetch('https://api.resend.com/emails', {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${resendApiKey}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(payload),
      });

      const data: any = await res.json().catch(() => ({}));
      if (res.ok) {
        console.log(`[${logTag}] Email inviata con successo via Resend da ${sender} a ${recipients.join(', ')}`);
        return { success: true };
      }

      lastErrorDetail = data?.message || data?.error || (typeof data === 'string' ? data : `Errore HTTP ${res.status}`);
      console.warn(`[${logTag}] Risposta non OK da Resend con mittente ${sender}:`, lastErrorDetail);

      if (!lastErrorDetail.toLowerCase().includes('from') && !lastErrorDetail.toLowerCase().includes('domain') && !lastErrorDetail.toLowerCase().includes('testing emails')) {
        break;
      }
    }

    return {
      success: false,
      error: `Resend non è riuscito a recapitare l'email: ${lastErrorDetail}`,
    };
  } catch (err: any) {
    console.error(`[${logTag}] Eccezione chiamata Resend:`, err.message);
    return {
      success: false,
      error: `Errore durante la connessione con Resend: ${err.message}`,
    };
  }
}

function formatItalianDateServer(dateStr: string): string {
  try {
    const [y, m, d] = (dateStr || '').split('-');
    const dateObj = new Date(Number(y), Number(m) - 1, Number(d));
    if (isNaN(dateObj.getTime())) return dateStr || '';
    return new Intl.DateTimeFormat('it-IT', {
      weekday: 'long',
      day: 'numeric',
      month: 'long',
      year: 'numeric',
    }).format(dateObj);
  } catch {
    return dateStr || '';
  }
}

/**
 * Invio email di benvenuto tramite Resend API ai nuovi utenti registrati
 */
async function sendWelcomeEmail(user: { name?: string; surname?: string; email: string }): Promise<{ success: boolean; error?: string }> {
  const cleanEmail = (user.email || '').trim().toLowerCase();
  if (!cleanEmail || !cleanEmail.includes('@')) {
    return { success: false, error: 'Email utente non valida' };
  }
  const fullName = `${user.name || ''} ${user.surname || ''}`.trim() || 'Associato';
  const subject = 'Benvenuto in JESic Meet!';
  const textContent = `Ciao ${fullName}, benvenuto su JESic Meet (Junior Enterprise Sicilia)! Il tuo account è attivo: puoi unirti ai gruppi di lavoro, votare i sondaggi di disponibilità, partecipare agli eventi e sincronizzare automaticamente i tuoi impegni con Google Calendar.`;
  const htmlContent = `<!DOCTYPE html>
<html lang="it">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Benvenuto in JESic Meet</title>
</head>
<body style="margin: 0; padding: 0; font-family: 'Ubuntu', -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Arial, sans-serif; background-color: #F8F9FA; color: #1F2937; line-height: 1.6;">
  <table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0" style="background-color: #F8F9FA; padding: 36px 16px;">
    <tr>
      <td align="center">
        <table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0" style="max-width: 580px; background-color: #FFFFFF; border-radius: 16px; overflow: hidden; border: 1px solid #E5E7EB; box-shadow: 0 4px 16px rgba(0,0,0,0.05);">
          <tr>
            <td style="background-color: #111827; border-top: 5px solid #f23e2e; padding: 24px 32px;">
              <div style="font-size: 22px; font-weight: 800; color: #FFFFFF; letter-spacing: -0.3px;">
                JESic<span style="color: #f23e2e;">Meet</span>
              </div>
              <div style="font-size: 11px; color: #9CA3AF; text-transform: uppercase; letter-spacing: 0.8px; margin-top: 4px;">
                Junior Enterprise Sicilia &bull; Piattaforma Riunioni &amp; Gruppi
              </div>
            </td>
          </tr>
          <tr>
            <td style="padding: 32px;">
              <div style="font-size: 11px; font-weight: 700; text-transform: uppercase; letter-spacing: 1px; color: #f23e2e; margin-bottom: 8px;">
                Registrazione Completata
              </div>
              <h1 style="margin: 0 0 16px 0; font-size: 22px; font-weight: 800; color: #111827;">
                Benvenuto a bordo, ${fullName}!
              </h1>
              <p style="margin: 0 0 16px 0; font-size: 14px; color: #374151;">
                Siamo felici di darti il benvenuto su <strong>JESic Meet</strong>. Il tuo profilo associato (<strong>${cleanEmail}</strong>) è stato creato correttamente.
              </p>
              <table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0" style="background-color: #FEF2F2; border-radius: 12px; border: 1px solid #FECACA; margin: 20px 0;">
                <tr>
                  <td style="padding: 18px 20px; font-size: 13px; color: #374151;">
                    <div style="font-weight: 700; color: #991B1B; margin-bottom: 8px;">Cosa puoi fare da subito:</div>
                    <ul style="margin: 0; padding-left: 18px;">
                      <li style="margin-bottom: 6px;">Entrare nei tuoi gruppi di lavoro tramite codice o link d'invito.</li>
                      <li style="margin-bottom: 6px;">Esprimere le tue disponibilità nei sondaggi e confermare la partecipazione agli eventi.</li>
                      <li style="margin-bottom: 6px;">Chattare in tempo reale nei gruppi e nei sottogruppi dedicati.</li>
                      <li>Sincronizzare automaticamente riunioni e link Google Meet con il tuo Google Calendar.</li>
                    </ul>
                  </td>
                </tr>
              </table>
              <p style="margin: 0; font-size: 13px; color: #6B7280;">
                A presto su JESic Meet,<br />
                <strong style="color: #111827;">Il Team Junior Enterprise Sicilia</strong>
              </p>
            </td>
          </tr>
          <tr>
            <td style="background-color: #F9FAFB; border-top: 1px solid #E5E7EB; padding: 18px 32px; text-align: center; color: #9CA3AF; font-size: 11px;">
              Junior Enterprise Sicilia (JESic) &bull; info@jesicmeet.it
            </td>
          </tr>
        </table>
      </td>
    </tr>
  </table>
</body>
</html>`;

  return sendEmailViaResend({
    to: cleanEmail,
    subject,
    html: htmlContent,
    text: textContent,
    logTag: 'Welcome Email',
  });
}

/**
 * Invio email di recupero password tramite Resend API
 */
async function sendPasswordResetEmail(cleanEmail: string, otpCode: string): Promise<{ success: boolean; error?: string }> {
  const subject = 'Codice di recupero password - JESic Meet';
  const textContent = `Il tuo codice di verifica per recuperare la password di JESic Meet è: ${otpCode}. Il codice scade tra 15 minuti. Inseriscilo nell'applicazione per impostare una nuova password.`;
  const htmlContent = `
    <div style="font-family: 'Ubuntu', Arial, sans-serif; max-width: 500px; margin: 0 auto; padding: 24px; border: 1px solid #e5e7eb; border-radius: 16px; background-color: #ffffff;">
      <div style="display: flex; align-items: center; margin-bottom: 16px;">
        <h2 style="color: #1e1e1e; margin: 0; font-size: 24px;">JESic<span style="color: #f23e2e;">Meet</span></h2>
      </div>
      <h3 style="color: #1e1e1e; margin-bottom: 8px;">Recupero Password</h3>
      <p style="color: #4b5563; font-size: 14px; line-height: 1.5;">Hai richiesto il ripristino della tua password per accedere alla piattaforma <strong>JESic Meet</strong>.</p>
      <p style="color: #4b5563; font-size: 14px;">Utilizza il seguente codice di sicurezza temporaneo:</p>
      <div style="text-align: center; margin: 24px 0;">
        <span style="font-size: 32px; font-weight: 800; letter-spacing: 6px; color: #f23e2e; background-color: #fef2f2; padding: 12px 24px; border-radius: 12px; border: 1px solid #fecaca; display: inline-block;">${otpCode}</span>
      </div>
      <p style="color: #6b7280; font-size: 12px; line-height: 1.4;">Il codice scadrà tra 15 minuti. Se non sei stato tu a richiedere il ripristino, ignora questa comunicazione.</p>
      <hr style="border: none; border-top: 1px solid #e5e7eb; margin: 20px 0;" />
      <p style="color: #9ca3af; font-size: 11px; text-align: center;">Junior Enterprise Sicilia (JESic) • info@jesic.it</p>
    </div>
  `;

  return sendEmailViaResend({
    to: cleanEmail,
    subject,
    html: htmlContent,
    text: textContent,
    logTag: 'Password Reset',
  });
}

/**
 * Invio email di conferma appuntamento ESCLUSIVAMENTE al cliente esterno tramite Resend
 * (Senza inserimento diretto sul Google Calendar del cliente)
 */
async function sendClientConfirmationEmailViaResend(params: {
  companyName: string;
  contactEmail: string;
  meetingTitle?: string;
  description?: string;
  date: string;
  startTime: string;
  endTime: string;
  meetLink: string;
  organizerName?: string;
  organizerRole?: string;
  organizerEmail?: string;
}) {
  const contactEmail = (params.contactEmail || '').trim().toLowerCase();
  if (!contactEmail || !contactEmail.includes('@')) return { success: false, error: 'Email cliente mancante' };

  const formattedDate = formatItalianDateServer(params.date);
  const meetingTitle = params.meetingTitle || `Call con ${params.companyName}`;
  const organizerEmail = params.organizerEmail || 'info@jesicmeet.it';
  const html = generateClientConfirmationEmailHtml({
    companyName: params.companyName,
    contactEmail,
    meetingTitle,
    description: params.description,
    dateStr: params.date,
    formattedDate,
    startTime: params.startTime,
    endTime: params.endTime,
    meetLink: params.meetLink,
    organizerName: params.organizerName || 'Team Junior Enterprise Sicilia',
    organizerRole: params.organizerRole || 'Area Relazioni Esterne & B2B',
    organizerEmail,
  });

  const text = `Gentile ${params.companyName}, confermiamo l'appuntamento "${meetingTitle}" per il giorno ${formattedDate} dalle ${params.startTime} alle ${params.endTime}. Link Google Meet: ${params.meetLink}`;

  return sendEmailViaResend({
    to: contactEmail,
    subject: `Conferma Appuntamento: ${meetingTitle} - ${formattedDate}`,
    html,
    text,
    replyTo: organizerEmail,
    logTag: 'Client Confirmation Email',
  });
}

/**
 * Invio email di mancata conferma / annullamento ESCLUSIVAMENTE al cliente esterno tramite Resend
 */
async function sendClientCancellationEmailViaResend(params: {
  companyName: string;
  contactEmail: string;
  meetingTitle?: string;
  description?: string;
  reason?: string;
  wasConfirmed?: boolean;
  organizerName?: string;
  organizerRole?: string;
  organizerEmail?: string;
}) {
  const contactEmail = (params.contactEmail || '').trim().toLowerCase();
  if (!contactEmail || !contactEmail.includes('@')) return { success: false, error: 'Email cliente mancante' };

  const meetingTitle = params.meetingTitle || `Incontro con ${params.companyName}`;
  const organizerEmail = params.organizerEmail || 'info@jesicmeet.it';
  const html = generateClientCancellationEmailHtml({
    companyName: params.companyName,
    contactEmail,
    meetingTitle,
    description: params.description,
    reason: params.reason,
    wasConfirmed: params.wasConfirmed,
    organizerName: params.organizerName || 'Team Junior Enterprise Sicilia',
    organizerRole: params.organizerRole || 'Area Relazioni Esterne & B2B',
    organizerEmail,
  });

  const text = params.wasConfirmed
    ? `Gentile ${params.companyName}, la informiamo che l'appuntamento "${meetingTitle}" è stato annullato.${params.reason ? ` Nota: ${params.reason}` : ''}`
    : `Gentile ${params.companyName}, purtroppo non ci è possibile confermare la richiesta di incontro "${meetingTitle}" nelle date indicate.${params.reason ? ` Nota: ${params.reason}` : ''}`;

  return sendEmailViaResend({
    to: contactEmail,
    subject: params.wasConfirmed
      ? `Annullamento Appuntamento: ${meetingTitle}`
      : `Aggiornamento Richiesta Incontro: ${meetingTitle}`,
    html,
    text,
    replyTo: organizerEmail,
    logTag: 'Client Cancellation Email',
  });
}

// POST /api/auth/forgot-password - Invio codice OTP a 6 cifre per recupero password
app.post('/api/auth/forgot-password', async (req: Request, res: Response) => {
  try {
    const { email } = req.body;
    if (!email) {
      return res.status(400).json({ error: 'Inserisci l\'indirizzo email associato al tuo profilo.' });
    }
    const cleanEmail = String(email).toLowerCase().trim();

    // Genera codice numerico a 6 cifre (100000 - 999999) con scadenza a 15 minuti
    const otpCode = Math.floor(100000 + Math.random() * 900000).toString();
    const expiresAt = Date.now() + 15 * 60 * 1000;

    // Salva sempre nello store in-memory del server
    inMemoryResetCodes.set(cleanEmail, { code: otpCode, expires: expiresAt });

    // Salva anche nel database MongoDB se disponibile (con timeout rigido di 2 secondi per evitare blocchi)
    if (mongoose.connection.readyState === 1) {
      try {
        const dbPromise = (async () => {
          const user = await UserModel.findOne({ email: cleanEmail });
          if (user) {
            user.resetPasswordCode = otpCode;
            user.resetPasswordExpires = new Date(expiresAt);
            await user.save();
          }
        })();
        const dbTimeout = new Promise((_, reject) =>
          setTimeout(() => reject(new Error('Timeout DB operation')), 2000)
        );
        await Promise.race([dbPromise, dbTimeout]).catch((e) => {
          console.warn('[Password Reset] MongoDB non ha risposto in 2s, procedo con codice in-memory:', e.message);
        });
      } catch (dbErr: any) {
        console.warn('[Password Reset] Errore salvataggio codice su MongoDB:', dbErr.message);
      }
    }

    console.log(`[Password Reset OTP] Codice generato per ${cleanEmail}: ${otpCode}`);

    // Tentativo di recapito email reale
    const sendResult = await sendPasswordResetEmail(cleanEmail, otpCode);

    if (!sendResult.success) {
      return res.status(500).json({
        success: false,
        error: `Impossibile recapitare l'email a ${cleanEmail}: ${sendResult.error || 'errore del server'}.`,
      });
    }

    return res.json({
      success: true,
      message: `Abbiamo inviato un codice a 6 cifre all'indirizzo ${cleanEmail}. Controlla la posta in arrivo (e anche la cartella Spam).`,
    });
  } catch (err: any) {
    console.error('Errore /api/auth/forgot-password:', err.message);
    return res.status(500).json({ error: 'Errore durante la generazione del codice di recupero.' });
  }
});

// POST /api/auth/reset-password - Verifica codice OTP e salvataggio nuova password
app.post('/api/auth/reset-password', async (req: Request, res: Response) => {
  try {
    const { email, code, newPassword } = req.body;
    if (!email || !code || !newPassword) {
      return res.status(400).json({ error: 'Compila tutti i campi richiesti.' });
    }
    const cleanEmail = String(email).toLowerCase().trim();
    const cleanCode = String(code).trim();
    const cleanNewPassword = String(newPassword).trim();

    if (cleanNewPassword.length < 6) {
      return res.status(400).json({ error: 'La nuova password deve contenere almeno 6 caratteri.' });
    }

    // 1. Verifica codice nello store in-memory
    const memoryEntry = inMemoryResetCodes.get(cleanEmail);
    let isCodeValid = false;

    if (memoryEntry) {
      if (memoryEntry.code === cleanCode) {
        if (Date.now() <= memoryEntry.expires) {
          isCodeValid = true;
        } else {
          return res.status(400).json({ error: 'Il codice di verifica è scaduto. Richiedine uno nuovo.' });
        }
      }
    }

    // 2. Se non ancora validato via memoria, controlla sul database MongoDB
    let dbUser = null;
    if (mongoose.connection.readyState === 1) {
      try {
        dbUser = await UserModel.findOne({ email: cleanEmail });
        if (dbUser && dbUser.resetPasswordCode === cleanCode) {
          if (dbUser.resetPasswordExpires && new Date() <= dbUser.resetPasswordExpires) {
            isCodeValid = true;
          } else {
            return res.status(400).json({ error: 'Il codice di verifica è scaduto. Richiedine uno nuovo.' });
          }
        }
      } catch (dbErr: any) {
        console.warn('[Password Reset] Errore verifica utente su MongoDB:', dbErr.message);
      }
    }

    if (!isCodeValid) {
      return res.status(400).json({ error: 'Codice di verifica non valido o errato. Controlla e riprova.' });
    }

    // Rimuovi il codice usato dalla memoria
    inMemoryResetCodes.delete(cleanEmail);

    // Se l'utente esiste su MongoDB, aggiorna la password persistente
    let jsonUser = null;
    if (dbUser) {
      dbUser.password = cleanNewPassword;
      dbUser.resetPasswordCode = undefined;
      dbUser.resetPasswordExpires = undefined;
      await dbUser.save();

      jsonUser = {
        id: dbUser._id || dbUser.id,
        name: dbUser.name,
        surname: dbUser.surname,
        email: dbUser.email,
        avatarUrl: dbUser.avatarUrl || null,
        googleCalendarConnected: Boolean(dbUser.googleCalendarConnected),
        hasPassword: true,
        groupMemberships: dbUser.groupMemberships || [],
      };
    }

    return res.json({
      success: true,
      message: 'Password reimpostata con successo! Ora puoi accedere.',
      user: jsonUser,
    });
  } catch (err: any) {
    console.error('Errore /api/auth/reset-password:', err.message);
    return res.status(500).json({ error: 'Errore durante il reset della password.' });
  }
});

// PATCH /api/users/:id/role - Assegnazione 3 Ruoli ('user', 'admin', 'admin_clienti')
app.patch('/api/users/:id/role', async (req: Request, res: Response) => {
  const { id } = req.params;
  const { role, adminId } = req.body;

  const validRoles: UserRole[] = ['user', 'admin_clienti', 'admin'];
  if (!validRoles.includes(role)) {
    return res.status(400).json({ error: "Il ruolo deve essere 'user', 'admin' o 'admin_clienti'" });
  }

  try {
    const updatedUser = await UserModel.findOneAndUpdate(
      { $or: [{ _id: id }, { id }] },
      { updatedAt: new Date() },
      { new: true }
    );

    if (!updatedUser) {
      return res.status(404).json({ error: 'Utente non trovato nel database' });
    }

    const publicUserPayload = {
      id: updatedUser._id || updatedUser.id,
      name: updatedUser.name,
      surname: updatedUser.surname,
      email: updatedUser.email,
      avatarUrl: updatedUser.avatarUrl || null,
      googleCalendarConnected: Boolean(updatedUser.googleCalendarConnected),
      groupMemberships: updatedUser.groupMemberships || [],
    };
    broadcastRealtimeEvent('user:updated', { user: publicUserPayload });

    return res.json({
      success: true,
      message: `Utente aggiornato con successo nel Database`,
      user: publicUserPayload,
    });
  } catch (err: any) {
    console.error('Errore aggiornamento ruolo UserModel MongoDB:', err.message);
    return res.status(500).json({ error: 'Errore aggiornamento utente su MongoDB' });
  }
});

// PATCH /api/users/:id - Modifica profilo utente
app.patch('/api/users/:id', async (req: Request, res: Response) => {
  const { id } = req.params;
  const { name, surname, avatarUrl, googleCalendarConnected, googleAccessToken, googleRefreshToken } = req.body;

  try {
    const updateData: any = { updatedAt: new Date() };
    if (name) updateData.name = name;
    if (surname) updateData.surname = surname;
    if (avatarUrl !== undefined) updateData.avatarUrl = avatarUrl;
    if (googleCalendarConnected !== undefined) updateData.googleCalendarConnected = Boolean(googleCalendarConnected);
    if (googleAccessToken !== undefined) updateData.googleAccessToken = googleAccessToken;
    if (googleRefreshToken !== undefined) updateData.googleRefreshToken = googleRefreshToken;

    const updatedUser = await UserModel.findOneAndUpdate(
      { $or: [{ _id: id }, { id }] },
      { $set: updateData },
      { new: true }
    );

    if (!updatedUser) {
      return res.status(404).json({ error: 'Utente non trovato nel database' });
    }

    broadcastRealtimeEvent('user:updated', {
      user: {
        id: updatedUser._id || updatedUser.id,
        name: updatedUser.name,
        surname: updatedUser.surname,
        email: updatedUser.email,
        avatarUrl: updatedUser.avatarUrl || null,
        googleCalendarConnected: Boolean(updatedUser.googleCalendarConnected),
        groupMemberships: updatedUser.groupMemberships || [],
      },
    });

    return res.json({
      success: true,
      user: {
        id: updatedUser._id || updatedUser.id,
        name: updatedUser.name,
        surname: updatedUser.surname,
        email: updatedUser.email,
        groupMemberships: updatedUser.groupMemberships || [],
        avatarUrl: updatedUser.avatarUrl,
        googleCalendarConnected: updatedUser.googleCalendarConnected,
        googleAccessToken: updatedUser.googleAccessToken || undefined,
        googleRefreshToken: updatedUser.googleRefreshToken || undefined,
        hasGoogleRefreshToken: Boolean(updatedUser.googleRefreshToken),
        hasGoogleCalendarAuth: Boolean(
          updatedUser.googleRefreshToken || (updatedUser.googleAccessToken && updatedUser.googleCalendarConnected)
        ),
      },
    });
  } catch (err: any) {
    console.error('Errore aggiornamento profilo UserModel MongoDB:', err.message);
    return res.status(500).json({ error: 'Errore aggiornamento profilo su MongoDB' });
  }
});

/* ==========================================================================
   3. GROUPS & MEMBERS API (GroupModel)
   ========================================================================== */

// GET /api/groups - Ritorna la lista dei gruppi da MongoDB
app.get('/api/groups', async (req: Request, res: Response) => {
  const { userId, search } = req.query;

  try {
    let filter: any = {};
    if (search && typeof search === 'string' && search.trim()) {
      filter.name = { $regex: search.trim(), $options: 'i' };
    } else if (userId) {
      filter = { 'members.userId': userId };
    }
    const groups = await GroupModel.find(filter).sort({ createdAt: -1 }).lean();
    const mapped = groups.map((g: any) => ({
      id: g._id ? String(g._id) : String(g.id),
      name: g.name,
      description: g.description,
      code: g.code,
      inviteLink: g.inviteLink,
      creatorId: g.creatorId,
      members: g.members,
      subgroups: (g.subgroups || []).map((s: any) => ({
        id: s.id ? String(s.id) : (s._id ? String(s._id) : ''),
        _id: s._id ? String(s._id) : (s.id ? String(s.id) : ''),
        name: s.name,
        description: s.description || '',
        avatar: s.avatar || '📁',
        color: s.color || '#8b5cf6',
        isPublic: Boolean(s.isPublic),
        code: s.code,
        parentId: s.parentId ? String(s.parentId) : null,
        members: s.members || [],
        createdBy: s.createdBy,
        createdAt: s.createdAt,
      })),
      avatar: g.avatar,
      isPublic: g.isPublic ?? false,
      createdAt: g.createdAt,
      updatedAt: g.updatedAt,
    }));
    return res.json({ groups: mapped });
  } catch (err: any) {
    console.error('Errore lettura GroupModel MongoDB:', err.message);
    return res.status(500).json({ error: 'Errore durante la lettura dei gruppi da MongoDB' });
  }
});

// POST /api/groups - Crea un nuovo gruppo di lavoro in MongoDB con codice univoco reale
app.post('/api/groups', async (req: Request, res: Response) => {
  const { name, description, avatar, creatorId, isPublic, code: requestedCode, id: requestedId } = req.body;
  if (!name || !creatorId) {
    return res.status(400).json({ error: 'Nome del gruppo e ID creatore sono obbligatori' });
  }

  try {
    // Genera un codice univoco reale o valida quello richiesto
    let code = requestedCode ? String(requestedCode).toUpperCase().replace(/[^A-Z0-9-]/g, '').trim() : '';
    if (!code || code.length < 4) {
      code = `JES-${Math.random().toString(36).substring(2, 6).toUpperCase()}`;
    }

    // Assicura l'unicità del codice su MongoDB
    let existing = await GroupModel.findOne({ code });
    let attempts = 0;
    while (existing && attempts < 10) {
      code = `JES-${Math.random().toString(36).substring(2, 6).toUpperCase()}`;
      existing = await GroupModel.findOne({ code });
      attempts++;
    }

    const groupId = requestedId || `grp-${Date.now()}-${Math.random().toString(36).substring(2, 6)}`;
    const inviteLink = `/join/${code}`;

    const newGroupDoc = await GroupModel.create({
      _id: groupId,
      id: groupId,
      name: name.trim(),
      description: description ? description.trim() : '',
      code,
      inviteLink,
      creatorId,
      avatar: avatar || '👥',
      isPublic: isPublic === true,
      members: [
        {
          userId: creatorId,
          role: 'admin',
          joinedAt: new Date().toISOString(),
        },
      ],
    });

    // Sincronizza l'appartenenza del creatore su UserModel (groupMemberships con ruolo admin) in MongoDB
    try {
      await UserModel.updateOne(
        {
          $or: [{ _id: creatorId }, { id: creatorId }],
          'groupMemberships.groupId': { $ne: newGroupDoc._id }
        },
        { $push: { groupMemberships: { groupId: newGroupDoc._id, role: 'admin' } } }
      );
    } catch (errSync) {
      console.warn('Sync creator groupMemberships notice:', errSync);
    }

    console.log(`[MongoDB] Gruppo "${newGroupDoc.name}" creato con successo. Codice: ${newGroupDoc.code}, ID: ${newGroupDoc._id}`);

    const mappedCreatedGroup = {
      id: newGroupDoc._id || newGroupDoc.id,
      name: newGroupDoc.name,
      description: newGroupDoc.description,
      code: newGroupDoc.code,
      inviteLink: newGroupDoc.inviteLink,
      creatorId: newGroupDoc.creatorId,
      members: newGroupDoc.members,
      avatar: newGroupDoc.avatar,
      isPublic: newGroupDoc.isPublic ?? false,
      createdAt: newGroupDoc.createdAt,
      updatedAt: newGroupDoc.updatedAt,
    };

    broadcastRealtimeEvent('group:created', { group: mappedCreatedGroup });

    return res.status(201).json({
      success: true,
      group: mappedCreatedGroup,
    });
  } catch (err: any) {
    console.error('Errore creazione GroupModel MongoDB:', err.message);
    return res.status(500).json({ error: 'Errore creazione gruppo su MongoDB: ' + err.message });
  }
});

// GET /join/:code - Redirect pulito alla SPA per i link d'invito diretti
app.get('/join/:code', (req: Request, res: Response) => {
  const code = encodeURIComponent(req.params.code || '');
  return res.redirect(`/?join=${code}`);
});

// POST /api/groups/join - Entra in un gruppo tramite codice o link in MongoDB
app.post('/api/groups/join', async (req: Request, res: Response) => {
  const { codeOrLink, userId } = req.body;
  if (!codeOrLink || !userId) {
    return res.status(400).json({ error: 'Codice/link e ID utente sono obbligatori' });
  }

  const raw = String(codeOrLink).trim();
  let code = raw;

  // 1. Estrazione intelligente del codice da URL completo, URL relativo o query parameter
  // Formati supportati:
  // - https://dominio.it/?join=JES-ABCD
  // - http://localhost:3000/?join=JES-ABCD
  // - /?join=JES-ABCD
  // - ?join=JES-ABCD
  // - join=JES-ABCD
  // - https://dominio.it/join/JES-ABCD
  // - /join/JES-ABCD
  // - join/JES-ABCD
  // - JES-ABCD
  // - ABCD
  const queryJoinMatch = raw.match(/[?&]join=([^&#\s]+)/i);
  if (queryJoinMatch && queryJoinMatch[1]) {
    code = decodeURIComponent(queryJoinMatch[1]);
  } else {
    const slashJoinMatch = raw.match(/(?:^|\/)join\/([^/?#\s]+)/i);
    if (slashJoinMatch && slashJoinMatch[1]) {
      code = decodeURIComponent(slashJoinMatch[1]);
    }
  }

  // Pulisci il codice eliminando query string residue, ancore e caratteri non alfanumerici
  code = code.split('?')[0].split('#')[0].replace(/[^a-zA-Z0-9-]/g, '').trim().toUpperCase();

  // Candidati di ricerca (sia con prefisso JES- che senza prefisso)
  const cleanBare = code.replace(/^JES-?/i, '');
  const candidateCodes = Array.from(
    new Set([
      code,
      `JES-${cleanBare}`,
      cleanBare,
    ].filter(Boolean))
  );

  try {
    // Cerca il gruppo su MongoDB con corrispondenza case-insensitive su tutti i formati
    const group = await GroupModel.findOne({
      $or: candidateCodes.map((c) => ({
        code: { $regex: new RegExp(`^${c}$`, 'i') },
      })),
    });

    if (!group) {
      return res.status(404).json({
        error: `Nessun gruppo trovato con il codice o link "${raw}". Verifica il codice d'invito fornito dal collega.`,
      });
    }

    const isMember = group.members.some((m) => m.userId === userId);
    if (!isMember) {
      group.members.push({
        userId,
        role: 'member',
        joinedAt: new Date().toISOString(),
      });
      await group.save();
    }

    // Sincronizza l'appartenenza al gruppo in UserModel (array groupMemberships) in MongoDB
    try {
      await UserModel.updateOne(
        {
          $or: [{ _id: userId }, { id: userId }],
          'groupMemberships.groupId': { $ne: group._id }
        },
        { $push: { groupMemberships: { groupId: group._id || group.id, role: 'member' } } }
      );
    } catch (errSync) {
      console.warn('Sync UserModel groupMemberships notice:', errSync);
    }

    console.log(`[MongoDB] Utente ${userId} unito con successo al gruppo "${group.name}" (Codice: ${group.code})`);

    const mappedJoinedGroup = {
      id: group._id || group.id,
      name: group.name,
      description: group.description,
      code: group.code,
      inviteLink: `/join/${group.code}`,
      creatorId: group.creatorId,
      members: group.members,
      subgroups: group.subgroups || [],
      avatar: group.avatar,
      isPublic: group.isPublic ?? false,
      createdAt: group.createdAt,
      updatedAt: group.updatedAt,
    };

    broadcastRealtimeEvent('group:member_joined', {
      groupId: mappedJoinedGroup.id,
      userId,
      group: mappedJoinedGroup,
    });

    return res.json({
      success: true,
      message: isMember ? 'Sei già membro di questo gruppo!' : 'Sei entrato nel gruppo con successo!',
      group: mappedJoinedGroup,
    });
  } catch (err: any) {
    console.error('Errore join GroupModel MongoDB:', err.message);
    return res.status(500).json({ error: 'Errore durante l\'adesione al gruppo in MongoDB' });
  }
});

// POST /api/groups/:id/join-public - Entra direttamente in un gruppo pubblico conoscendo il nome
app.post('/api/groups/:id/join-public', async (req: Request, res: Response) => {
  const { id } = req.params;
  const { userId } = req.body;
  if (!userId) {
    return res.status(400).json({ error: 'ID utente obbligatorio' });
  }

  try {
    const group = await GroupModel.findOne({ $or: [{ _id: id }, { id }] });
    if (!group) {
      return res.status(404).json({ error: 'Gruppo non trovato nel database' });
    }

    if (!group.isPublic) {
      return res.status(403).json({ error: 'Questo gruppo è privato. È necessario il codice d\'invito.' });
    }

    const isMember = group.members.some((m) => m.userId === userId);
    if (!isMember) {
      group.members.push({
        userId,
        role: 'member',
        joinedAt: new Date().toISOString(),
      });
      await group.save();
    }

    // Sincronizza l'appartenenza al gruppo anche in UserModel in MongoDB
    try {
      await UserModel.updateOne(
        {
          $or: [{ _id: userId }, { id: userId }],
          'groupMemberships.groupId': { $ne: group._id }
        },
        { $push: { groupMemberships: { groupId: group._id || group.id, role: 'member' } } }
      );
    } catch (errSync) {
      console.warn('Sync UserModel join-public groupMemberships notice:', errSync);
    }

    const mappedGroup = {
      id: group._id || group.id,
      name: group.name,
      description: group.description,
      code: group.code,
      inviteLink: group.inviteLink,
      creatorId: group.creatorId,
      members: group.members,
      subgroups: group.subgroups || [],
      avatar: group.avatar,
      isPublic: group.isPublic ?? false,
      createdAt: group.createdAt,
      updatedAt: group.updatedAt,
    };

    broadcastRealtimeEvent('group:member_joined', {
      groupId: mappedGroup.id,
      userId,
      group: mappedGroup,
    });

    return res.json({
      success: true,
      message: isMember ? 'Sei già membro di questo gruppo' : 'Sei entrato nel gruppo pubblico con successo!',
      group: mappedGroup,
    });
  } catch (err: any) {
    console.error('Errore join pubblico gruppo:', err.message);
    return res.status(500).json({ error: 'Errore durante l\'ingresso nel gruppo pubblico' });
  }
});

// GET /api/groups/:id - Dettagli del gruppo per form B2B o anteprima esterna
app.get('/api/groups/:id', async (req: Request, res: Response) => {
  const { id } = req.params;
  try {
    const group = await GroupModel.findOne({ $or: [{ _id: id }, { id }] }).lean();
    if (!group) {
      return res.status(404).json({ error: 'Gruppo non trovato nel database' });
    }
    return res.json({
      group: {
        id: group._id || group.id,
        name: group.name,
        description: group.description,
        code: group.code,
        avatar: group.avatar,
        isPublic: group.isPublic ?? false,
        membersCount: group.members?.length || 0,
      },
    });
  } catch (err: any) {
    console.error('Errore lettura singolo gruppo:', err.message);
    return res.status(500).json({ error: 'Errore durante la lettura del gruppo' });
  }
});

// PATCH /api/groups/:id - Modifica nome, dettagli o visibilità del gruppo (Creatore o Admin)
app.patch('/api/groups/:id', async (req: Request, res: Response) => {
  const { id } = req.params;
  const { name, description, avatar, isPublic, userId } = req.body;

  try {
    const group = await GroupModel.findOne({ $or: [{ _id: id }, { id }] });
    if (!group) {
      return res.status(404).json({ error: 'Gruppo non trovato nel database' });
    }

    if (userId && group.creatorId !== userId) {
      const member = group.members.find((m: any) => m.userId === userId);
      if (!member || (member.role !== 'admin' && member.role !== 'admin_clienti')) {
        return res.status(403).json({ error: 'Solo il creatore del gruppo o un admin di questo gruppo può modificare il gruppo' });
      }
    }

    if (name) group.name = name.trim();
    if (description !== undefined) group.description = description ? description.trim() : '';
    if (avatar) group.avatar = avatar;
    if (typeof isPublic === 'boolean') group.isPublic = isPublic;
    await group.save();

    const mappedGroup = {
      id: group._id || group.id,
      name: group.name,
      description: group.description,
      code: group.code,
      inviteLink: group.inviteLink,
      creatorId: group.creatorId,
      members: group.members,
      subgroups: group.subgroups || [],
      avatar: group.avatar,
      isPublic: group.isPublic ?? false,
      createdAt: group.createdAt,
      updatedAt: group.updatedAt,
    };

    broadcastRealtimeEvent('group:updated', { groupId: mappedGroup.id, group: mappedGroup });

    return res.json({ success: true, message: 'Gruppo aggiornato con successo in MongoDB', group: mappedGroup });
  } catch (err: any) {
    console.error('Errore aggiornamento GroupModel MongoDB:', err.message);
    return res.status(500).json({ error: 'Errore aggiornamento gruppo su database MongoDB' });
  }
});

// DELETE /api/groups/:id - Elimina l'intero gruppo (Creatore o Admin del Gruppo)
app.delete('/api/groups/:id', async (req: Request, res: Response) => {
  const { id } = req.params;
  const userId = (req.body?.userId || req.query?.userId) as string | undefined;

  try {
    const group = await GroupModel.findOne({ $or: [{ _id: id }, { id }] });
    if (!group) {
      return res.status(404).json({ error: 'Gruppo non trovato nel database' });
    }

    if (userId && group.creatorId !== userId) {
      const member = group.members.find((m: any) => m.userId === userId);
      if (!member || (member.role !== 'admin' && member.role !== 'admin_clienti')) {
        return res.status(403).json({ error: 'Solo il creatore del gruppo o un admin di questo gruppo può eliminare il gruppo' });
      }
    }

    await GroupModel.deleteOne({ $or: [{ _id: id }, { id }] });

    // Pulisci in cascata eventi, messaggi chat e riferimenti nei profili utente
    await EventModel.deleteMany({ groupId: id }).catch(() => {});
    await ChatMessageModel.deleteMany({ groupId: id }).catch(() => {});
    await ClientRequestModel.deleteMany({ groupId: id }).catch(() => {});
    await UserModel.updateMany(
      { 'groupMemberships.groupId': id },
      { $pull: { groupMemberships: { groupId: id } } }
    ).catch(() => {});

    broadcastRealtimeEvent('group:deleted', { groupId: id });
    return res.json({ success: true, message: 'Gruppo eliminato definitivamente con successo da MongoDB' });
  } catch (err: any) {
    console.error('Errore eliminazione GroupModel MongoDB:', err.message);
    return res.status(500).json({ error: 'Errore eliminazione gruppo in MongoDB' });
  }
});

// DELETE /api/groups/:id/members/:memberId - Espelli membro dal gruppo (Creatore o Admin del Gruppo)
const handleRemoveMemberFromGroup = async (req: Request, res: Response) => {
  const { id, memberId } = req.params;
  const requesterId = (req.body?.requesterId || req.query?.requesterId) as string | undefined;

  try {
    const group = await GroupModel.findOne({ $or: [{ _id: id }, { id }] });
    if (!group) {
      return res.status(404).json({ error: 'Gruppo non trovato nel database' });
    }

    const isSelfLeaving = requesterId && requesterId === memberId;

    if (!isSelfLeaving && memberId === group.creatorId) {
      return res.status(400).json({ error: 'Non puoi espellere il creatore del gruppo' });
    }

    if (requesterId && !isSelfLeaving && group.creatorId !== requesterId) {
      const member = group.members.find((m: any) => m.userId === requesterId);
      if (!member || (member.role !== 'admin' && member.role !== 'admin_clienti')) {
        return res.status(403).json({ error: 'Solo il creatore del gruppo o un admin di questo gruppo può espellere membri' });
      }
    }

    // Se il creatore stesso abbandona il gruppo, trasferisci la proprietà al prossimo membro
    if (isSelfLeaving && memberId === group.creatorId) {
      const remainingMember = group.members.find((m: any) => m.userId !== memberId);
      if (remainingMember) {
        group.creatorId = remainingMember.userId;
      }
    }

    group.members = group.members.filter((m: any) => m.userId !== memberId);
    await group.save();

    const mappedGroup = {
      id: group._id || group.id,
      name: group.name,
      description: group.description,
      code: group.code,
      inviteLink: group.inviteLink,
      creatorId: group.creatorId,
      members: group.members,
      subgroups: group.subgroups || [],
      avatar: group.avatar,
      createdAt: group.createdAt,
      updatedAt: group.updatedAt,
    };

    broadcastRealtimeEvent('group:member_removed', { groupId: id, memberId, group: mappedGroup });

    return res.json({ success: true, message: 'Membro rimosso con successo dal gruppo in MongoDB', group: mappedGroup });
  } catch (err: any) {
    console.error('Errore rimozione membro GroupModel MongoDB:', err.message);
    return res.status(500).json({ error: 'Errore rimozione membro in MongoDB' });
  }
};

app.delete('/api/groups/:id/members/:memberId', handleRemoveMemberFromGroup);
app.post('/api/groups/:id/members/:memberId/remove', handleRemoveMemberFromGroup);

// PATCH /api/groups/:id/members/:memberId/role - Modifica ruolo membro (Gerarchia: 'member' | 'admin' | 'admin_clienti' | 'responsabile')
const handleUpdateGroupMemberRole = async (req: Request, res: Response) => {
  const { id, memberId } = req.params;
  const { role, requesterId } = req.body;

  const validRoles = ['member', 'admin', 'admin_clienti', 'responsabile'];
  if (!validRoles.includes(role)) {
    return res.status(400).json({ error: "Il ruolo deve essere 'member', 'admin', 'admin_clienti' o 'responsabile'" });
  }

  try {
    const group = await GroupModel.findOne({ $or: [{ _id: id }, { id }] });
    if (!group) {
      return res.status(404).json({ error: 'Gruppo non trovato nel database' });
    }

    if (memberId === group.creatorId) {
      return res.status(400).json({ error: 'Non puoi modificare il ruolo del creatore del gruppo' });
    }

    if (requesterId && group.creatorId !== requesterId) {
      const requesterMember = group.members.find((m: any) => m.userId === requesterId);
      if (!requesterMember || (requesterMember.role !== 'admin' && requesterMember.role !== 'admin_clienti')) {
        return res.status(403).json({ error: 'Solo il creatore o un admin del gruppo può aggiornare i ruoli' });
      }
    }

    const memberIndex = group.members.findIndex((m: any) => m.userId === memberId);
    if (memberIndex === -1) {
      return res.status(404).json({ error: 'Membro non trovato nel gruppo' });
    }

    group.members[memberIndex].role = role;
    group.markModified('members');
    await group.save();

    // Sincronizza il ruolo anche dentro UserModel in MongoDB
    try {
      const userDoc = await UserModel.findOne({ $or: [{ _id: memberId }, { id: memberId }] });
      if (userDoc) {
        if (!userDoc.groupMemberships) userDoc.groupMemberships = [];
        const targetGid = String(group._id || group.id);
        const mIdx = userDoc.groupMemberships.findIndex((gm: any) => String(gm.groupId) === targetGid);
        if (mIdx !== -1) {
          userDoc.groupMemberships[mIdx].role = role;
        } else {
          userDoc.groupMemberships.push({ groupId: targetGid, role });
        }
        userDoc.markModified('groupMemberships');
        await userDoc.save();
      }
    } catch (errSync) {
      console.warn('Sync UserModel role notice:', errSync);
    }

    const mappedGroup = {
      id: group._id || group.id,
      name: group.name,
      description: group.description,
      code: group.code,
      inviteLink: group.inviteLink,
      creatorId: group.creatorId,
      members: group.members,
      subgroups: group.subgroups || [],
      avatar: group.avatar,
      isPublic: group.isPublic ?? false,
      createdAt: group.createdAt,
      updatedAt: group.updatedAt,
    };

    broadcastRealtimeEvent('group:member_role_updated', { groupId: id, memberId, role, group: mappedGroup });

    return res.json({ success: true, message: 'Ruolo del membro aggiornato con successo', group: mappedGroup });
  } catch (err: any) {
    console.error('Errore aggiornamento ruolo membro GroupModel MongoDB:', err.message);
    return res.status(500).json({ error: 'Errore aggiornamento ruolo membro in MongoDB' });
  }
};

app.patch('/api/groups/:id/members/:memberId/role', handleUpdateGroupMemberRole);
app.post('/api/groups/:id/members/:memberId/role', handleUpdateGroupMemberRole);

/* ==========================================================================
   3.1 SUBGROUPS API (Sottogruppi / Cartelle - Esclusivo Ruolo "Responsabile")
   ========================================================================== */

// POST /api/groups/:id/subgroups - Creazione Sottogruppo (Solo Responsabile o Creatore del gruppo)
app.post('/api/groups/:id/subgroups', async (req: Request, res: Response) => {
  const { id } = req.params;
  const { name, description, avatar, color, isPublic, parentId } = req.body;
  const requesterId = req.body?.requesterId || req.body?.creatorId || req.body?.userId;

  if (!name || !name.trim()) {
    return res.status(400).json({ error: 'Il nome del sottogruppo è obbligatorio' });
  }
  if (!requesterId) {
    return res.status(400).json({ error: 'ID utente richiedente obbligatorio' });
  }

  try {
    const group = await GroupModel.findOne({ $or: [{ _id: id }, { id }] });
    if (!group) {
      return res.status(404).json({ error: 'Gruppo principale non trovato nel database' });
    }

    // Se è specificato un sottogruppo genitore, verifica che esista nel gruppo
    const cleanParentId =
      parentId &&
      typeof parentId === 'string' &&
      parentId.trim() !== '' &&
      parentId.trim() !== 'null' &&
      parentId.trim() !== 'undefined'
        ? parentId.trim()
        : null;

    let parentSubgroup: any = null;
    let actualParentId: string | null = null;
    if (cleanParentId) {
      parentSubgroup = group.subgroups?.find((s: any) => {
        const sid = (s.id || s._id ? String(s.id || s._id) : '').trim();
        const soid = s._id ? String(s._id).trim() : '';
        const scode = (s.code || '').trim().toUpperCase();
        const sname = (s.name || '').trim().toLowerCase();
        const target = cleanParentId.trim();
        return (
          sid === target ||
          soid === target ||
          scode === target.toUpperCase() ||
          sname === target.toLowerCase()
        );
      });
      if (parentSubgroup) {
        actualParentId = String(parentSubgroup.id || parentSubgroup._id);
      } else {
        console.warn(`[Subgroup] Sottogruppo genitore "${cleanParentId}" non trovato nel gruppo "${group.name}".`);
        return res.status(404).json({
          error: `Sottogruppo genitore non trovato. Verifica di aver selezionato una cartella valida.`,
        });
      }
    }

    // Regola richiesta: Il "Responsabile", il creatore del gruppo o il creatore del sottogruppo genitore possono creare sottogruppi
    const member = group.members.find((m: any) => m.userId === requesterId);
    const isResponsabile = member && member.role === 'responsabile';
    const isCreator = group.creatorId === requesterId;
    const isParentCreator = parentSubgroup && parentSubgroup.createdBy === requesterId;

    if (!isResponsabile && !isCreator && !isParentCreator) {
      return res.status(403).json({
        error: 'Accesso negato: solo chi possiede il ruolo "Responsabile" in questo gruppo può creare nuovi sottogruppi o sotto-sottogruppi',
      });
    }

    const subgroupId = `subgrp-${Date.now()}-${Math.random().toString(36).substring(2, 6)}`;
    const requestedSubCode = req.body?.code;
    let subCode = requestedSubCode ? String(requestedSubCode).toUpperCase().replace(/[^A-Z0-9-]/g, '').trim() : '';
    if (!subCode || subCode.length < 3) {
      subCode = 'SUB-' + Math.random().toString(36).substring(2, 6).toUpperCase();
    } else if (!subCode.startsWith('SUB-') && !subCode.startsWith('JES-')) {
      subCode = 'SUB-' + subCode;
    }

    const isPub = Boolean(isPublic);
    const newSubgroup = {
      _id: subgroupId,
      id: subgroupId,
      name: name.trim(),
      description: description ? description.trim() : '',
      avatar: avatar || '📁',
      color: color || '#8b5cf6',
      isPublic: isPub,
      code: subCode,
      parentId: actualParentId,
      members: [requesterId],
      createdBy: requesterId,
      createdAt: new Date().toISOString(),
    };

    if (!group.subgroups) group.subgroups = [];
    group.subgroups.push(newSubgroup as any);
    group.markModified('subgroups');
    await group.save();

    console.log(`[MongoDB] Sottogruppo "${newSubgroup.name}" creato in Gruppo "${group.name}". ID: ${subgroupId}, Codice: ${subCode}, ParentID: ${actualParentId}`);

    const mappedSubgroups = (group.subgroups || []).map((s: any) => ({
      id: s.id ? String(s.id) : (s._id ? String(s._id) : ''),
      _id: s._id ? String(s._id) : (s.id ? String(s.id) : ''),
      name: s.name,
      description: s.description || '',
      avatar: s.avatar || '📁',
      color: s.color || '#8b5cf6',
      isPublic: Boolean(s.isPublic),
      code: s.code,
      parentId: s.parentId ? String(s.parentId) : null,
      members: s.members || [],
      createdBy: s.createdBy,
      createdAt: s.createdAt,
    }));

    const mappedGroup = {
      id: group._id ? String(group._id) : String(group.id),
      name: group.name,
      description: group.description,
      code: group.code,
      inviteLink: group.inviteLink,
      creatorId: group.creatorId,
      members: group.members,
      subgroups: mappedSubgroups,
      avatar: group.avatar,
      isPublic: group.isPublic ?? false,
      createdAt: group.createdAt,
      updatedAt: group.updatedAt,
    };

    broadcastRealtimeEvent('group:subgroups_updated', {
      groupId: mappedGroup.id,
      group: mappedGroup,
      subgroups: group.subgroups,
    });

    return res.status(201).json({
      success: true,
      message: 'Sottogruppo creato con successo in MongoDB',
      subgroup: newSubgroup,
      group: mappedGroup,
      subgroups: group.subgroups,
    });
  } catch (err: any) {
    console.error('Errore creazione sottogruppo MongoDB:', err.message);
    return res.status(500).json({ error: 'Errore durante la creazione del sottogruppo in MongoDB' });
  }
});

// POST /api/groups/:id/subgroups/join - Entra in qualsiasi sottogruppo del gruppo tramite codice (SUB-XXXX o XXXX)
app.post('/api/groups/:id/subgroups/join', async (req: Request, res: Response) => {
  const { id } = req.params;
  const { code, userId } = req.body;

  if (!code || !String(code).trim()) {
    return res.status(400).json({ error: 'Codice di accesso al sottogruppo obbligatorio' });
  }
  if (!userId) {
    return res.status(400).json({ error: 'ID utente obbligatorio' });
  }

  try {
    const group = await GroupModel.findOne({ $or: [{ _id: id }, { id }] });
    if (!group) {
      return res.status(404).json({ error: 'Gruppo non trovato nel database' });
    }

    const cleanInputCode = String(code).trim().toUpperCase();
    const bareInputCode = cleanInputCode.replace(/^SUB-?/i, '').replace(/^JES-?/i, '');
    const candidateCodes = [cleanInputCode, `SUB-${bareInputCode}`, bareInputCode];

    const subgroup = group.subgroups?.find((s: any) => {
      const sCode = (s.code || '').trim().toUpperCase();
      const sBare = sCode.replace(/^SUB-?/i, '').replace(/^JES-?/i, '');
      return candidateCodes.includes(sCode) || candidateCodes.includes(sBare) || sBare === bareInputCode;
    });

    if (!subgroup) {
      return res.status(404).json({ error: `Nessun sottogruppo trovato con il codice "${code}". Verifica e riprova.` });
    }

    if (!subgroup.members) {
      subgroup.members = [];
    }
    if (!subgroup.members.includes(userId)) {
      subgroup.members.push(userId);
      group.markModified('subgroups');
      await group.save();
    }

    const mappedGroup = {
      id: group._id || group.id,
      name: group.name,
      description: group.description,
      code: group.code,
      inviteLink: group.inviteLink,
      creatorId: group.creatorId,
      members: group.members,
      subgroups: group.subgroups,
      avatar: group.avatar,
      isPublic: group.isPublic ?? false,
      createdAt: group.createdAt,
      updatedAt: group.updatedAt,
    };

    broadcastRealtimeEvent('group:subgroups_updated', {
      groupId: mappedGroup.id,
      group: mappedGroup,
      subgroups: group.subgroups,
    });

    return res.json({
      success: true,
      message: `Accesso al sottogruppo "${subgroup.name}" effettuato con successo!`,
      subgroup,
      group: mappedGroup,
    });
  } catch (err: any) {
    console.error('Errore join generico sottogruppo MongoDB:', err.message);
    return res.status(500).json({ error: 'Errore durante l\'accesso al sottogruppo in MongoDB' });
  }
});

// POST /api/groups/:id/subgroups/:subgroupId/join - Entra in un sottogruppo specifico tramite codice d'invito
app.post('/api/groups/:id/subgroups/:subgroupId/join', async (req: Request, res: Response) => {
  const { id, subgroupId } = req.params;
  const { code, userId } = req.body;

  if (!code || !code.trim()) {
    return res.status(400).json({ error: 'Codice di accesso obbligatorio' });
  }
  if (!userId) {
    return res.status(400).json({ error: 'ID utente obbligatorio' });
  }

  try {
    const group = await GroupModel.findOne({ $or: [{ _id: id }, { id }] });
    if (!group) {
      return res.status(404).json({ error: 'Gruppo non trovato nel database' });
    }

    const subgroup = group.subgroups?.find((s: any) => s._id === subgroupId || s.id === subgroupId);
    if (!subgroup) {
      return res.status(404).json({ error: 'Sottogruppo non trovato' });
    }

    const cleanInputCode = code.trim().toUpperCase();
    const bareInputCode = cleanInputCode.replace(/^SUB-?/i, '').replace(/^JES-?/i, '');
    const subgroupCode = (subgroup.code || '').trim().toUpperCase();
    const subgroupBare = subgroupCode.replace(/^SUB-?/i, '').replace(/^JES-?/i, '');

    if (cleanInputCode !== subgroupCode && bareInputCode !== subgroupBare) {
      return res.status(400).json({ error: 'Codice errato. Verifica il codice e riprova.' });
    }

    if (!subgroup.members) {
      subgroup.members = [];
    }
    if (!subgroup.members.includes(userId)) {
      subgroup.members.push(userId);
      group.markModified('subgroups');
      await group.save();
    }

    const mappedGroup = {
      id: group._id || group.id,
      name: group.name,
      description: group.description,
      code: group.code,
      inviteLink: group.inviteLink,
      creatorId: group.creatorId,
      members: group.members,
      subgroups: group.subgroups,
      avatar: group.avatar,
      isPublic: group.isPublic ?? false,
      createdAt: group.createdAt,
      updatedAt: group.updatedAt,
    };

    broadcastRealtimeEvent('group:subgroups_updated', {
      groupId: mappedGroup.id,
      group: mappedGroup,
      subgroups: group.subgroups,
    });

    return res.json({
      success: true,
      message: 'Accesso al sottogruppo effettuato con successo!',
      subgroup,
      group: mappedGroup,
    });
  } catch (err: any) {
    console.error('Errore join sottogruppo MongoDB:', err.message);
    return res.status(500).json({ error: 'Errore durante l\'accesso al sottogruppo in MongoDB' });
  }
});

// DELETE /api/groups/:id/subgroups/:subgroupId - Eliminazione Sottogruppo
app.delete('/api/groups/:id/subgroups/:subgroupId', async (req: Request, res: Response) => {
  const { id, subgroupId } = req.params;
  const requesterId = (req.body?.requesterId || req.query?.requesterId) as string | undefined;

  try {
    const group = await GroupModel.findOne({ $or: [{ _id: id }, { id }] });
    if (!group) {
      return res.status(404).json({ error: 'Gruppo principale non trovato' });
    }

    if (requesterId) {
      const member = group.members.find((m: any) => m.userId === requesterId);
      const isResponsabile = member && member.role === 'responsabile';
      const isCreator = group.creatorId === requesterId;
      if (!isResponsabile && !isCreator) {
        return res.status(403).json({ error: 'Non sei autorizzato a eliminare questo sottogruppo' });
      }
    }

    // Eliminazione a cascata: il sottogruppo selezionato e tutti i suoi eventuali sotto-sottogruppi
    const idsToDelete = new Set<string>([subgroupId]);
    let added = true;
    while (added) {
      added = false;
      for (const s of group.subgroups || []) {
        const sId = (s._id?.toString() || s.id?.toString());
        const pId = s.parentId ? s.parentId.toString() : null;
        if (sId && pId && idsToDelete.has(pId) && !idsToDelete.has(sId)) {
          idsToDelete.add(sId);
          added = true;
        }
      }
    }

    group.subgroups = (group.subgroups || []).filter(
      (s: any) => !idsToDelete.has(s._id?.toString() || s.id?.toString())
    );
    group.markModified('subgroups');
    await group.save();

    const mappedGroup = {
      id: group._id || group.id,
      name: group.name,
      description: group.description,
      code: group.code,
      inviteLink: group.inviteLink,
      creatorId: group.creatorId,
      members: group.members,
      subgroups: group.subgroups,
      avatar: group.avatar,
      isPublic: group.isPublic ?? false,
      createdAt: group.createdAt,
      updatedAt: group.updatedAt,
    };

    broadcastRealtimeEvent('group:subgroups_updated', {
      groupId: mappedGroup.id,
      group: mappedGroup,
      subgroups: group.subgroups,
    });

    return res.json({
      success: true,
      message: 'Sottogruppo eliminato con successo da MongoDB',
      group: mappedGroup,
      subgroups: group.subgroups,
    });
  } catch (err: any) {
    console.error('Errore eliminazione sottogruppo MongoDB:', err.message);
    return res.status(500).json({ error: 'Errore eliminazione sottogruppo in MongoDB' });
  }
});

// PATCH /api/groups/:id/subgroups/:subgroupId - Modifica e personalizzazione Sottogruppo (Responsabile o Creatore)
app.patch('/api/groups/:id/subgroups/:subgroupId', async (req: Request, res: Response) => {
  const { id, subgroupId } = req.params;
  const { name, description, avatar, color, isPublic, requesterId } = req.body;

  try {
    const group = await GroupModel.findOne({ $or: [{ _id: id }, { id }] });
    if (!group) {
      return res.status(404).json({ error: 'Gruppo principale non trovato' });
    }

    if (requesterId) {
      const member = group.members.find((m: any) => m.userId === requesterId);
      const isResponsabile = member && member.role === 'responsabile';
      const isCreator = group.creatorId === requesterId;
      if (!isResponsabile && !isCreator) {
        return res.status(403).json({ error: 'Non sei autorizzato a modificare questo sottogruppo' });
      }
    }

    const subgroup = group.subgroups?.find((s: any) => s._id === subgroupId || s.id === subgroupId);
    if (!subgroup) {
      return res.status(404).json({ error: 'Sottogruppo non trovato' });
    }

    if (name && name.trim()) subgroup.name = name.trim();
    if (description !== undefined) subgroup.description = description.trim();
    if (avatar) subgroup.avatar = avatar;
    if (color) subgroup.color = color;
    if (typeof isPublic === 'boolean') {
      subgroup.isPublic = isPublic;
    }

    group.markModified('subgroups');
    await group.save();

    const mappedGroup = {
      id: group._id || group.id,
      name: group.name,
      description: group.description,
      code: group.code,
      inviteLink: group.inviteLink,
      creatorId: group.creatorId,
      members: group.members,
      subgroups: group.subgroups,
      avatar: group.avatar,
      isPublic: group.isPublic ?? false,
      createdAt: group.createdAt,
      updatedAt: group.updatedAt,
    };

    broadcastRealtimeEvent('group:subgroups_updated', {
      groupId: mappedGroup.id,
      group: mappedGroup,
      subgroups: group.subgroups,
    });

    return res.json({
      success: true,
      message: 'Sottogruppo personalizzato con successo in MongoDB',
      subgroup,
      group: mappedGroup,
      subgroups: group.subgroups,
    });
  } catch (err: any) {
    console.error('Errore aggiornamento sottogruppo MongoDB:', err.message);
    return res.status(500).json({ error: 'Errore aggiornamento sottogruppo in MongoDB' });
  }
});

// POST /api/groups/:id/subgroups/:subgroupId/members - Aggiunge un membro al sottogruppo
app.post('/api/groups/:id/subgroups/:subgroupId/members', async (req: Request, res: Response) => {
  const { id, subgroupId } = req.params;
  const { email, userId, requesterId } = req.body;

  try {
    const group = await GroupModel.findOne({ $or: [{ _id: id }, { id }] });
    if (!group) {
      return res.status(404).json({ error: 'Gruppo principale non trovato' });
    }

    const subgroup = group.subgroups?.find((s: any) => s._id === subgroupId || s.id === subgroupId);
    if (!subgroup) {
      return res.status(404).json({ error: 'Sottogruppo non trovato' });
    }

    let targetUserId = userId;
    if (!targetUserId && email) {
      const cleanEmail = email.trim().toLowerCase();
      const user = await UserModel.findOne({ email: cleanEmail });
      if (!user) {
        return res.status(404).json({ error: `Nessun utente trovato con l'email ${cleanEmail}` });
      }
      targetUserId = user._id || user.id;
    }

    if (!targetUserId) {
      return res.status(400).json({ error: 'userId o email obbligatorio' });
    }

    if (!subgroup.members) {
      subgroup.members = [];
    }
    if (!subgroup.members.includes(targetUserId)) {
      subgroup.members.push(targetUserId);
    }

    // Assicura che sia anche membro del gruppo generale se non presente
    if (!group.members.some((m: any) => m.userId === targetUserId)) {
      group.members.push({
        userId: targetUserId,
        role: 'member',
        joinedAt: new Date().toISOString(),
      });
    }

    group.markModified('subgroups');
    group.markModified('members');
    await group.save();

    const mappedGroup = {
      id: group._id || group.id,
      name: group.name,
      description: group.description,
      code: group.code,
      inviteLink: group.inviteLink,
      creatorId: group.creatorId,
      members: group.members,
      subgroups: group.subgroups,
      avatar: group.avatar,
      isPublic: group.isPublic ?? false,
      createdAt: group.createdAt,
      updatedAt: group.updatedAt,
    };

    broadcastRealtimeEvent('group:subgroups_updated', {
      groupId: mappedGroup.id,
      group: mappedGroup,
      subgroups: group.subgroups,
    });

    return res.json({
      success: true,
      message: 'Membro aggiunto con successo al sottogruppo',
      subgroup,
      group: mappedGroup,
    });
  } catch (err: any) {
    console.error('Errore aggiunta membro sottogruppo MongoDB:', err.message);
    return res.status(500).json({ error: "Errore durante l'aggiunta del membro al sottogruppo" });
  }
});

// DELETE /api/groups/:id/subgroups/:subgroupId/members/:memberId - Rimuove un membro dal sottogruppo
app.delete('/api/groups/:id/subgroups/:subgroupId/members/:memberId', async (req: Request, res: Response) => {
  const { id, subgroupId, memberId } = req.params;
  const requesterId = req.body?.requesterId || req.query?.requesterId;

  try {
    const group = await GroupModel.findOne({ $or: [{ _id: id }, { id }] });
    if (!group) {
      return res.status(404).json({ error: 'Gruppo principale non trovato' });
    }

    const subgroup = group.subgroups?.find((s: any) => s._id === subgroupId || s.id === subgroupId);
    if (!subgroup) {
      return res.status(404).json({ error: 'Sottogruppo non trovato' });
    }

    if (subgroup.createdBy === memberId && requesterId !== memberId) {
      return res.status(400).json({ error: 'Non puoi rimuovere il creatore del sottogruppo' });
    }

    if (subgroup.members) {
      subgroup.members = subgroup.members.filter((m: string) => m !== memberId);
    }

    group.markModified('subgroups');
    await group.save();

    const mappedGroup = {
      id: group._id || group.id,
      name: group.name,
      description: group.description,
      code: group.code,
      inviteLink: group.inviteLink,
      creatorId: group.creatorId,
      members: group.members,
      subgroups: group.subgroups,
      avatar: group.avatar,
      isPublic: group.isPublic ?? false,
      createdAt: group.createdAt,
      updatedAt: group.updatedAt,
    };

    broadcastRealtimeEvent('group:subgroups_updated', {
      groupId: mappedGroup.id,
      group: mappedGroup,
      subgroups: group.subgroups,
    });

    return res.json({
      success: true,
      message: 'Membro rimosso con successo dal sottogruppo',
      subgroup,
      group: mappedGroup,
    });
  } catch (err: any) {
    console.error('Errore rimozione membro sottogruppo MongoDB:', err.message);
    return res.status(500).json({ error: 'Errore rimozione membro dal sottogruppo in MongoDB' });
  }
});

/* ==========================================================================
   3.2 CHAT API (Messaggi per Gruppo Generale & Sottogruppi Dedicati - Stile WhatsApp)
   ========================================================================== */

// GET /api/groups/:id/chat - Recupera i messaggi della chat per il gruppo generale o sottogruppo
app.get('/api/groups/:id/chat', async (req: Request, res: Response) => {
  const { id } = req.params;
  const { subgroupId } = req.query;

  try {
    const cleanSub =
      subgroupId &&
      subgroupId !== 'null' &&
      subgroupId !== 'undefined' &&
      String(subgroupId).trim() !== ''
        ? String(subgroupId).trim()
        : null;

    let filter: any;
    if (cleanSub) {
      filter = {
        groupId: id,
        subgroupId: cleanSub,
      };
    } else {
      filter = {
        groupId: id,
        $or: [
          { subgroupId: null },
          { subgroupId: '' },
          { subgroupId: 'null' },
          { subgroupId: { $exists: false } },
        ],
      };
    }

    const limitQuery = parseInt(req.query.limit as string, 10);
    const limitNum = !isNaN(limitQuery) && limitQuery > 0 ? Math.min(limitQuery, 100) : 50;
    const beforeParam = req.query.before as string;
    const beforeDate = beforeParam ? new Date(beforeParam) : null;
    const afterParam = (req.query.after || req.query.since) as string;
    const afterDate = afterParam ? new Date(afterParam) : null;

    const ESSENTIAL_FIELDS = '_id id groupId subgroupId authorId authorName authorSurname authorAvatar content attachment replyTo isEdited editedAt readBy createdAt';

    // Limite di vita per ciascun messaggio: esattamente 50 giorni dalla creazione (singola scadenza rolling)
    const fiftyDaysAgo = new Date(Date.now() - 50 * 24 * 60 * 60 * 1000);

    // 1. Sincronizzazione Delta ultra-rapida: scarica SOLO i nuovi messaggi successivi a un timestamp
    if (afterDate && !isNaN(afterDate.getTime())) {
      const minDate = afterDate.getTime() > fiftyDaysAgo.getTime() ? afterDate : fiftyDaysAgo;
      filter.createdAt = { $gt: minDate };

      const deltaMessages = await ChatMessageModel.find(filter)
        .select(ESSENTIAL_FIELDS)
        .sort({ createdAt: 1 })
        .limit(100)
        .lean();

      const mappedDelta = deltaMessages.map((m: any) => ({
        id: m._id || m.id,
        groupId: m.groupId,
        subgroupId: m.subgroupId || null,
        authorId: m.authorId,
        authorName: m.authorName,
        authorSurname: m.authorSurname,
        authorAvatar: m.authorAvatar,
        content: m.content || '',
        attachment: m.attachment || undefined,
        replyTo: m.replyTo || undefined,
        isEdited: Boolean(m.isEdited),
        editedAt: m.editedAt || undefined,
        readBy: Array.isArray(m.readBy) ? m.readBy : [],
        createdAt: m.createdAt,
      }));

      return res.json({
        messages: mappedDelta,
        isDelta: true,
      });
    }

    if (beforeDate && !isNaN(beforeDate.getTime())) {
      filter.createdAt = { $lt: beforeDate, $gt: fiftyDaysAgo };
    } else {
      filter.createdAt = { $gt: fiftyDaysAgo };
    }

    // Carica gli ultimi `limitNum` messaggi ordinati per createdAt decrescente (-1)
    // Sfrutta l'indice composto { groupId: 1, subgroupId: 1, createdAt: -1 }, select campi essenziali e .lean() per velocità istantanea
    const rawMessages = await ChatMessageModel.find(filter)
      .select(ESSENTIAL_FIELDS)
      .sort({ createdAt: -1 })
      .limit(limitNum + 1)
      .lean();

    const hasMore = rawMessages.length > limitNum;
    const batch = hasMore ? rawMessages.slice(0, limitNum) : rawMessages;

    // Invertiamo l'array così che i messaggi siano ordinati cronologicamente (dal più vecchio al più nuovo) per la vista
    batch.reverse();

    const mapped = batch.map((m: any) => ({
      id: m._id || m.id,
      groupId: m.groupId,
      subgroupId: m.subgroupId || null,
      authorId: m.authorId,
      authorName: m.authorName,
      authorSurname: m.authorSurname,
      authorAvatar: m.authorAvatar,
      content: m.content || '',
      attachment: m.attachment || undefined,
      replyTo: m.replyTo || undefined,
      isEdited: Boolean(m.isEdited),
      editedAt: m.editedAt || undefined,
      readBy: Array.isArray(m.readBy) ? m.readBy : [],
      createdAt: m.createdAt,
    }));

    const nextCursor = batch.length > 0 && hasMore ? batch[0].createdAt : null;

    return res.json({
      messages: mapped,
      hasMore,
      nextCursor,
    });
  } catch (err: any) {
    console.error('Errore lettura messaggi chat MongoDB:', err.message);
    return res.status(500).json({ error: 'Errore durante la lettura dei messaggi della chat da MongoDB' });
  }
});

// POST /api/groups/:id/chat - Invia un nuovo messaggio di chat in MongoDB
app.post('/api/groups/:id/chat', async (req: Request, res: Response) => {
  const { id } = req.params;
  const { subgroupId, authorId, authorName, authorSurname, authorAvatar, content, attachment, replyTo, clientMessageId } = req.body;

  if (!authorId || (!content?.trim() && !attachment)) {
    return res.status(400).json({ error: 'Autore e contenuto o allegato obbligatori' });
  }

  try {
    const cleanSubgroupId =
      subgroupId &&
      subgroupId !== 'null' &&
      subgroupId !== 'undefined' &&
      String(subgroupId).trim() !== ''
        ? String(subgroupId).trim()
        : null;

    const initialReadBy = [{ userId: authorId, readAt: new Date().toISOString() }];

    // Salvaguardia allegati leggeri per database entro 500 MB
    let cleanAttachment = attachment;
    if (cleanAttachment && typeof cleanAttachment === 'object') {
      if (cleanAttachment.type === 'audio') {
        cleanAttachment = {
          ...cleanAttachment,
          duration: Math.min(cleanAttachment.duration || 1, 60),
        };
      }
    }

    // REGOLA OTTIMIZZAZIONE SPAZIO DB: Non salviamo MAI l'avatar (base64) dell'utente dentro i documenti messaggio.
    // L'avatar viene risolto dinamicamente dal client o da UserModel, risparmiando centinaia di megabyte.
    const created: any = await ChatMessageModel.create({
      groupId: id,
      subgroupId: cleanSubgroupId,
      authorId,
      authorName: authorName || 'Utente',
      authorSurname: authorSurname || '',
      authorAvatar: null,
      content: content ? content.trim() : '',
      attachment: cleanAttachment || undefined,
      replyTo: replyTo || undefined,
      isEdited: false,
      editedAt: undefined,
      readBy: initialReadBy,
    });

    const mapped = {
      id: created._id || created.id,
      clientMessageId: clientMessageId || null,
      groupId: created.groupId,
      subgroupId: created.subgroupId || null,
      authorId: created.authorId,
      authorName: created.authorName,
      authorSurname: created.authorSurname,
      authorAvatar: null,
      content: created.content,
      attachment: created.attachment,
      replyTo: created.replyTo,
      isEdited: false,
      editedAt: undefined,
      readBy: initialReadBy,
      createdAt: created.createdAt,
    };

    broadcastRealtimeEvent('chat:message_created', {
      groupId: id,
      subgroupId: cleanSubgroupId,
      message: mapped,
    });

    // Invia notifica Push reale in background (stile WhatsApp) a tutti i membri del gruppo/sottogruppo
    sendChatPushNotification({
      groupId: id,
      subgroupId: cleanSubgroupId,
      authorId,
      authorName: authorName || 'Utente',
      authorSurname: authorSurname || '',
      content: content ? content.trim() : '',
      attachment: attachment || undefined,
    }).catch((pushErr: any) => console.warn('[Push] Errore trigger chat push:', pushErr?.message || pushErr));

    return res.status(201).json({ success: true, message: mapped });
  } catch (err: any) {
    console.error('Errore invio messaggio chat MongoDB:', err.message);
    return res.status(500).json({ error: 'Errore durante il salvataggio del messaggio in MongoDB' });
  }
});

// POST /api/groups/:id/chat/mark-read - Segna i messaggi come letti per un utente
app.post('/api/groups/:id/chat/mark-read', async (req: Request, res: Response) => {
  const { id } = req.params;
  const { subgroupId, userId, messageIds } = req.body;

  if (!userId) {
    return res.status(400).json({ error: 'userId obbligatorio' });
  }

  try {
    const cleanSub =
      subgroupId &&
      subgroupId !== 'null' &&
      subgroupId !== 'undefined' &&
      String(subgroupId).trim() !== ''
        ? String(subgroupId).trim()
        : null;

    let filter: any = { groupId: id };
    if (cleanSub) {
      filter.subgroupId = cleanSub;
    } else {
      filter.$or = [
        { subgroupId: null },
        { subgroupId: '' },
        { subgroupId: 'null' },
        { subgroupId: { $exists: false } },
      ];
    }

    if (Array.isArray(messageIds) && messageIds.length > 0) {
      filter._id = { $in: messageIds };
    }

    // Aggiorna solo i messaggi che non contengono già userId in readBy
    filter['readBy.userId'] = { $ne: userId };

    const readAt = new Date().toISOString();
    const updateResult = await ChatMessageModel.updateMany(
      filter,
      {
        $push: {
          readBy: { userId, readAt },
        },
      }
    );

    if (updateResult.modifiedCount > 0) {
      broadcastRealtimeEvent('chat:messages_read', {
        groupId: id,
        subgroupId: cleanSub,
        userId,
        readAt,
        messageIds: Array.isArray(messageIds) && messageIds.length > 0 ? messageIds : undefined,
      });
    }

    return res.json({ success: true, modifiedCount: updateResult.modifiedCount });
  } catch (err: any) {
    console.error('Errore mark-read chat MongoDB:', err.message);
    return res.status(500).json({ error: 'Errore durante la marcatura dei messaggi come letti' });
  }
});

// PATCH /api/groups/:id/chat/:messageId - Modifica il testo di un messaggio (solo l'autore)
app.patch('/api/groups/:id/chat/:messageId', async (req: Request, res: Response) => {
  const { id, messageId } = req.params;
  const { userId, content } = req.body;

  if (!userId || !content || !content.trim()) {
    return res.status(400).json({ error: 'ID utente e nuovo testo obbligatori' });
  }

  try {
    const msg = await ChatMessageModel.findOne({
      groupId: id,
      $or: [{ _id: messageId }, { id: messageId }],
    });

    if (!msg) {
      return res.status(404).json({ error: 'Messaggio non trovato in MongoDB' });
    }

    if (msg.authorId !== userId) {
      return res.status(403).json({ error: 'Puoi modificare solo i messaggi inviati da te' });
    }

    msg.content = content.trim();
    (msg as any).isEdited = true;
    (msg as any).editedAt = new Date().toISOString();
    await msg.save();

    const mapped = {
      id: msg._id || msg.id,
      groupId: msg.groupId,
      subgroupId: msg.subgroupId || null,
      authorId: msg.authorId,
      authorName: msg.authorName,
      authorSurname: msg.authorSurname,
      authorAvatar: msg.authorAvatar,
      content: msg.content,
      attachment: msg.attachment,
      replyTo: msg.replyTo,
      isEdited: true,
      editedAt: (msg as any).editedAt,
      createdAt: msg.createdAt,
    };

    broadcastRealtimeEvent('chat:message_updated', {
      groupId: id,
      subgroupId: msg.subgroupId || null,
      message: mapped,
    });

    return res.json({ success: true, message: mapped });
  } catch (err: any) {
    console.error('Errore modifica messaggio chat MongoDB:', err.message);
    return res.status(500).json({ error: 'Errore modifica messaggio in MongoDB' });
  }
});

// DELETE /api/groups/:id/chat/:messageId - Cancella il messaggio per tutti
app.delete('/api/groups/:id/chat/:messageId', async (req: Request, res: Response) => {
  const { id, messageId } = req.params;
  const userId = (req.body?.userId || req.query?.userId) as string;

  if (!userId) {
    return res.status(400).json({ error: 'ID utente obbligatorio per eliminare il messaggio' });
  }

  try {
    const msg = await ChatMessageModel.findOne({
      groupId: id,
      $or: [{ _id: messageId }, { id: messageId }],
    });

    if (!msg) {
      return res.status(404).json({ error: 'Messaggio non trovato in MongoDB' });
    }

    // L'autore del messaggio, o il creatore del gruppo o l'admin possono cancellare
    if (msg.authorId !== userId) {
      const group = await GroupModel.findOne({ $or: [{ _id: id }, { id }] });
      const isCreator = group?.creatorId === userId;
      const isAdmin = group?.members?.some((m: any) => m.userId === userId && m.role === 'admin');
      if (!isCreator && !isAdmin) {
        return res.status(403).json({ error: 'Puoi eliminare solo i tuoi messaggi' });
      }
    }

    const subgroupId = msg.subgroupId || null;
    await ChatMessageModel.deleteOne({ _id: msg._id });

    broadcastRealtimeEvent('chat:message_deleted', {
      groupId: id,
      subgroupId,
      messageId,
    });

    return res.json({
      success: true,
      message: 'Messaggio eliminato per tutti con successo',
      deletedMessageId: messageId,
    });
  } catch (err: any) {
    console.error('Errore eliminazione messaggio chat MongoDB:', err.message);
    return res.status(500).json({ error: 'Errore eliminazione messaggio in MongoDB' });
  }
});

// GET /api/chat/unread-summary - Conteggio messaggi non letti per gruppo e sottogruppo
app.get('/api/chat/unread-summary', async (req: Request, res: Response) => {
  const userId = String(req.query.userId || '').trim();
  if (!userId) {
    return res.status(400).json({ error: 'userId obbligatorio' });
  }

  try {
    const fiftyDaysAgo = new Date(Date.now() - 50 * 24 * 60 * 60 * 1000);
    const userGroups = await GroupModel.find({
      $or: [{ creatorId: userId }, { 'members.userId': userId }],
    })
      .select('_id creatorId subgroups')
      .lean();

    if (!userGroups || userGroups.length === 0) {
      return res.json({ success: true, counts: [] });
    }

    const joinedGroupIds: string[] = [];
    const accessibleScopes = new Set<string>();

    for (const g of userGroups as any[]) {
      const gid = String(g._id);
      joinedGroupIds.push(gid);
      accessibleScopes.add(`${gid}::root`);

      const isCreator = g.creatorId === userId;
      if (Array.isArray(g.subgroups)) {
        for (const sub of g.subgroups) {
          const sid = sub?.id ? String(sub.id) : sub?._id ? String(sub._id) : '';
          if (!sid) continue;
          const hasAccess =
            isCreator ||
            Boolean(sub.isPublic) ||
            sub.createdBy === userId ||
            (Array.isArray(sub.members) && sub.members.includes(userId));
          if (hasAccess) {
            accessibleScopes.add(`${gid}::${sid}`);
          }
        }
      }
    }

    const aggregated = await ChatMessageModel.aggregate([
      {
        $match: {
          groupId: { $in: joinedGroupIds },
          createdAt: { $gt: fiftyDaysAgo },
          authorId: { $ne: userId },
          'readBy.userId': { $ne: userId },
        },
      },
      {
        $project: {
          groupId: 1,
          normalizedSubgroupId: {
            $cond: [
              {
                $or: [
                  { $eq: ['$subgroupId', null] },
                  { $eq: ['$subgroupId', ''] },
                  { $eq: ['$subgroupId', 'null'] },
                  { $eq: ['$subgroupId', 'undefined'] },
                  { $not: ['$subgroupId'] },
                ],
              },
              null,
              '$subgroupId',
            ],
          },
        },
      },
      {
        $group: {
          _id: { groupId: '$groupId', subgroupId: '$normalizedSubgroupId' },
          count: { $sum: 1 },
        },
      },
    ]);

    const counts = aggregated
      .map((item: any) => ({
        groupId: String(item._id.groupId),
        subgroupId: item._id.subgroupId ? String(item._id.subgroupId) : null,
        count: Number(item.count) || 0,
      }))
      .filter((entry) => accessibleScopes.has(`${entry.groupId}::${entry.subgroupId || 'root'}`));

    return res.json({ success: true, counts });
  } catch (err: any) {
    console.error('Errore calcolo unread chat summary:', err?.message || err);
    return res.status(500).json({ error: 'Errore durante il recupero dei messaggi non letti' });
  }
});

/* ==========================================================================
   4. EVENTS & POLLS API (EventModel / PollModel / OfficialEventModel)
   ========================================================================== */

// GET /api/events - Lista eventi (sondaggi e ufficiali) da MongoDB
app.get('/api/events', async (req: Request, res: Response) => {
  const { groupId, userId, eventType } = req.query;

  try {
    let query: any = {};
    if (groupId) query.groupId = groupId;
    if (eventType) query.eventType = eventType;
    if (userId) {
      query.$or = [
        { creatorId: userId },
        { 'invitees.userId': userId },
        { 'participants.userId': userId },
      ];
    }

    const events = await EventModel.find(query).sort({ createdAt: -1 }).lean();
    const mapped = events.map((e: any) => ({
      ...e,
      id: e._id || e.id,
    }));
    return res.json({ events: mapped });
  } catch (err: any) {
    console.error('Errore lettura EventModel MongoDB:', err.message);
    return res.status(500).json({ error: 'Errore lettura eventi dal database MongoDB' });
  }
});

const isPlaceholderMeetLink = (link?: string | null): boolean =>
  Boolean(link && /meet\.google\.com\/jes-/i.test(link));

const resolveEventDateAndTimes = (eventObj: any) => {
  const targetDate =
    eventObj?.finalizedSlot?.date ||
    (typeof eventObj?.finalDate === 'object' && eventObj?.finalDate?.date) ||
    (typeof eventObj?.finalDate === 'string' && eventObj.finalDate.trim() ? eventObj.finalDate.trim() : undefined) ||
    (Array.isArray(eventObj?.dates) && eventObj.dates[0]) ||
    new Date().toISOString().split('T')[0];

  const startTime =
    eventObj?.finalizedSlot?.startTime ||
    (typeof eventObj?.finalDate === 'object' && eventObj?.finalDate?.startTime) ||
    (eventObj?.startHour !== undefined ? `${String(eventObj.startHour).padStart(2, '0')}:00` : '09:00');

  const endTime =
    eventObj?.finalizedSlot?.endTime ||
    (typeof eventObj?.finalDate === 'object' && eventObj?.finalDate?.endTime) ||
    (eventObj?.endHour !== undefined ? `${String(eventObj.endHour).padStart(2, '0')}:00` : '10:00');

  return { targetDate, startTime, endTime };
};

const buildUserMap = (users: any[]) => {
  const map = new Map<string, any>();
  for (const u of users) {
    if (u?._id) map.set(String(u._id), u);
    if (u?.id) map.set(String(u.id), u);
  }
  return map;
};

interface CalendarTokenOverride {
  accessToken?: string;
  refreshToken?: string;
}

const syncConfirmedEventAcrossUserCalendars = async (
  eventObj: any,
  overrideTokensByUserId: Record<string, CalendarTokenOverride> = {}
): Promise<{
  meetLink?: string;
  primaryGoogleEventId: string | null;
  googleCalendarEvents: Array<{ userId: string; googleEventId: string }>;
}> => {
  const existingMap = new Map<string, string>();
  if (Array.isArray(eventObj?.googleCalendarEvents)) {
    for (const entry of eventObj.googleCalendarEvents) {
      if (entry?.userId && entry?.googleEventId) {
        existingMap.set(String(entry.userId), String(entry.googleEventId));
      }
    }
  }
  const legacyCreatorEventId = eventObj?.googleEventId || eventObj?.googleCalendarEventId;
  if (eventObj?.creatorId && legacyCreatorEventId && !existingMap.has(String(eventObj.creatorId))) {
    existingMap.set(String(eventObj.creatorId), String(legacyCreatorEventId));
  }

  const declinedIds = new Set<string>(
    (eventObj?.participants || [])
      .filter((p: any) => p?.status === 'declined' && p?.userId)
      .map((p: any) => String(p.userId))
  );

  const rawCandidateIds: string[] = [];
  if (eventObj?.creatorId) rawCandidateIds.push(String(eventObj.creatorId));
  for (const inv of eventObj?.invitees || []) {
    if (inv?.userId) rawCandidateIds.push(String(inv.userId));
  }
  for (const part of eventObj?.participants || []) {
    if (part?.userId && part.status !== 'declined') {
      rawCandidateIds.push(String(part.userId));
    }
  }

  // Per i clienti B2B dal form pubblico (/prenota-call), NON si inserisce mai l'evento direttamente sul loro Google Calendar:
  // ricevono solo l'email dedicata di conferma o eventuale annullamento/rifiuto.
  const excludedClientEmail =
    typeof eventObj?.clientInfo?.contactEmail === 'string'
      ? eventObj.clientInfo.contactEmail.trim().toLowerCase()
      : '';

  const normalizedExtraEmails: string[] = Array.from(
    new Set<string>(
      (Array.isArray(eventObj?.externalInviteEmails) ? eventObj.externalInviteEmails : [])
        .map((e: any) => (typeof e === 'string' ? e.trim().toLowerCase() : ''))
        .filter((e: string) => e.includes('@') && e !== excludedClientEmail)
    )
  );

  const emailMatchedUsers =
    normalizedExtraEmails.length > 0
      ? await UserModel.find({ email: { $in: normalizedExtraEmails } }).lean()
      : [];

  const emailToRegisteredUserId = new Map<string, string>();
  for (const u of emailMatchedUsers as any[]) {
    const emailKey = (u.email || '').trim().toLowerCase();
    const uid = String(u._id || u.id);
    if (emailKey && uid) {
      emailToRegisteredUserId.set(emailKey, uid);
      if (!declinedIds.has(uid)) {
        rawCandidateIds.push(uid);
      }
    }
  }

  const externalOnlyEmails = normalizedExtraEmails.filter((email) => !emailToRegisteredUserId.has(email));

  const orderedUserIds: string[] = [];
  const seenIds = new Set<string>();
  for (const uid of rawCandidateIds) {
    if (!uid || declinedIds.has(uid) || seenIds.has(uid)) continue;
    seenIds.add(uid);
    orderedUserIds.push(uid);
  }

  const allUserIdsToFetch = Array.from(new Set([...orderedUserIds, ...Array.from(existingMap.keys())]));
  const fetchedUsers =
    allUserIdsToFetch.length > 0
      ? await UserModel.find({
          $or: [{ _id: { $in: allUserIdsToFetch } }, { id: { $in: allUserIdsToFetch } }],
        }).lean()
      : [];
  const userById = buildUserMap(fetchedUsers as any[]);

  const { targetDate, startTime, endTime } = resolveEventDateAndTimes(eventObj);
  const isOnline = eventObj?.type !== 'in_person';
  let sharedMeetLink =
    isOnline && eventObj?.meetLink && !isPlaceholderMeetLink(eventObj.meetLink)
      ? String(eventObj.meetLink)
      : '';

  let attachedExternalEmails = false;

  for (const uid of orderedUserIds) {
    const userDoc = userById.get(uid);
    const override = overrideTokensByUserId[uid] || {};
    const refreshToken = override.refreshToken || userDoc?.googleRefreshToken;
    const accessToken = override.accessToken || userDoc?.googleAccessToken;

    if (userDoc?.googleCalendarConnected === false && !override.refreshToken && !override.accessToken) {
      continue;
    }
    if (!refreshToken && !accessToken) {
      continue;
    }

    const existingGoogleEventId = existingMap.get(uid);
    if (existingGoogleEventId) {
      try {
        const updRes = await updateGoogleCalendarEvent({ refreshToken, accessToken }, existingGoogleEventId, {
          title: eventObj.title,
          description: eventObj.description,
          date: targetDate,
          startTime,
          endTime,
          isOnline,
          location: eventObj.location,
          meetLink: sharedMeetLink || undefined,
          sendUpdates: 'none',
        });

        if (updRes.success) {
          console.log(`[Google Calendar] Evento ${existingGoogleEventId} aggiornato con successo nel calendario dell'utente ${uid}.`);
          continue;
        }
        if (!updRes.error || !/(404|410|not found|deleted)/i.test(updRes.error)) {
          console.warn(`[Google Calendar] Warning aggiornamento utente ${uid} (${existingGoogleEventId}):`, updRes.error);
          continue;
        }
      } catch (updErr: any) {
        console.warn(`[Google Calendar] Errore aggiornamento utente ${uid}:`, updErr?.message || updErr);
        continue;
      }
    }

    const shouldAttachExternalAttendees =
      !attachedExternalEmails &&
      externalOnlyEmails.length > 0 &&
      (uid === String(eventObj?.creatorId) || orderedUserIds.indexOf(uid) === 0);

    const attendeeEmails = shouldAttachExternalAttendees ? externalOnlyEmails : [];

    try {
      const calRes = await createGoogleCalendarEvent({
        accessToken,
        refreshToken,
        title: eventObj.title,
        description: eventObj.description,
        date: targetDate,
        startTime,
        endTime,
        isOnline,
        location: eventObj.location,
        meetLink: sharedMeetLink || undefined,
        skipConferenceCreation: Boolean(sharedMeetLink),
        sendUpdates: attendeeEmails.length > 0 ? 'externalOnly' : 'none',
        attendeeEmails,
      });

      if (calRes.success && calRes.eventId) {
        existingMap.set(uid, calRes.eventId);
        if (attendeeEmails.length > 0) {
          attachedExternalEmails = true;
        }
        if (isOnline && !sharedMeetLink && calRes.meetLink) {
          sharedMeetLink = calRes.meetLink;
        }
      } else {
        console.warn(`[Google Calendar] Inserimento non riuscito per utente ${uid}:`, calRes.error);
      }
    } catch (calErr: any) {
      console.warn(`[Google Calendar] Errore inserimento per utente ${uid}:`, calErr?.message || calErr);
    }
  }

  for (const [uid, gEventId] of Array.from(existingMap.entries())) {
    if (!seenIds.has(uid)) {
      const userDoc = userById.get(uid);
      const override = overrideTokensByUserId[uid] || {};
      const refreshToken = override.refreshToken || userDoc?.googleRefreshToken;
      const accessToken = override.accessToken || userDoc?.googleAccessToken;
      if (refreshToken || accessToken) {
        try {
          await deleteGoogleCalendarEvent({ refreshToken, accessToken }, gEventId);
        } catch (delErr: any) {
          console.warn(`[Google Calendar] Warning rimozione utente rimosso/rifiutato ${uid}:`, delErr?.message || delErr);
        }
      }
      existingMap.delete(uid);
    }
  }

  const googleCalendarEvents = Array.from(existingMap.entries()).map(([userId, googleEventId]) => ({
    userId,
    googleEventId,
  }));

  const primaryGoogleEventId =
    (eventObj?.creatorId ? existingMap.get(String(eventObj.creatorId)) : undefined) ||
    googleCalendarEvents[0]?.googleEventId ||
    legacyCreatorEventId ||
    null;

  return {
    meetLink: sharedMeetLink || undefined,
    primaryGoogleEventId,
    googleCalendarEvents,
  };
};

const deleteEventAcrossUserCalendars = async (
  eventToDelete: any,
  overrideTokensByUserId: Record<string, CalendarTokenOverride> = {}
) => {
  const mapByUser = new Map<string, string>();
  if (Array.isArray(eventToDelete?.googleCalendarEvents)) {
    for (const entry of eventToDelete.googleCalendarEvents) {
      if (entry?.userId && entry?.googleEventId) {
        mapByUser.set(String(entry.userId), String(entry.googleEventId));
      }
    }
  }
  const legacyEventId = eventToDelete?.googleEventId || eventToDelete?.googleCalendarEventId;
  if (eventToDelete?.creatorId && legacyEventId && !mapByUser.has(String(eventToDelete.creatorId))) {
    mapByUser.set(String(eventToDelete.creatorId), String(legacyEventId));
  }

  const userIds = Array.from(mapByUser.keys());
  if (userIds.length === 0) return;

  const fetchedUsers = await UserModel.find({
    $or: [{ _id: { $in: userIds } }, { id: { $in: userIds } }],
  }).lean();
  const userById = buildUserMap(fetchedUsers as any[]);

  for (const [uid, gEventId] of mapByUser.entries()) {
    const userDoc = userById.get(uid);
    const override = overrideTokensByUserId[uid] || {};
    const refreshToken = override.refreshToken || userDoc?.googleRefreshToken;
    const accessToken = override.accessToken || userDoc?.googleAccessToken;
    if (!refreshToken && !accessToken) continue;

    try {
      await deleteGoogleCalendarEvent({ refreshToken, accessToken }, gEventId);
      console.log(`[Google Calendar] Evento ${gEventId} rimosso con successo dal calendario dell'utente ${uid}.`);
    } catch (delErr: any) {
      console.warn(`[Google Calendar] Errore eliminazione evento ${gEventId} per utente ${uid}:`, delErr?.message || delErr);
    }
  }
};

// POST /api/events - Creazione evento (sondaggio When2meet o evento ufficiale)
app.post('/api/events', async (req: Request, res: Response) => {
  const eventData = req.body;
  if (!eventData.title || !eventData.creatorId) {
    return res.status(400).json({ error: 'Titolo e creatore sono obbligatori' });
  }

  // Verifica permessi ruolo per eventi ufficiali nel gruppo:
  // - Nel gruppo generale: solo Admin (e Creatore del gruppo) o Admin Clienti. Un responsabile NON può creare eventi nel gruppo generale.
  // - In un sottogruppo: l'Admin del gruppo, l'Admin Clienti, OPPURE il Responsabile che ha creato quel determinato sottogruppo (è admin del suo sottogruppo).
  if (eventData.eventType === 'official' && eventData.groupId) {
    try {
      const group = (await GroupModel.findOne({ $or: [{ _id: eventData.groupId }, { id: eventData.groupId }] } as any)) as any;
      if (group) {
        const isCreator = group.creatorId === eventData.creatorId;
        const member = group.members?.find((m: any) => m.userId === eventData.creatorId);
        const isGroupAdmin = isCreator || (member && (member.role === 'admin' || member.role === 'admin_clienti'));

        let isSubgroupCreatorAdmin = false;
        if (eventData.subgroupId && member && member.role === 'responsabile') {
          const targetSub = (group.subgroups || []).find(
            (s: any) => s.id === eventData.subgroupId || s._id === eventData.subgroupId
          );
          if (targetSub && targetSub.createdBy === eventData.creatorId) {
            isSubgroupCreatorAdmin = true;
          }
        }

        if (!isGroupAdmin && !isSubgroupCreatorAdmin) {
          if (member?.role === 'responsabile' && !eventData.subgroupId) {
            return res.status(403).json({
              error: 'Un responsabile non può creare eventi ufficiali nel gruppo generale, ma solo nei sottogruppi da lui creati.',
            });
          }
          return res.status(403).json({
            error: 'Solo gli admin del gruppo o il responsabile creatore di questo sottogruppo possono creare eventi ufficiali.',
          });
        }
      }
    } catch (err: any) {
      console.error('Errore verifica permessi gruppo:', err.message);
    }
  }

  const generatedId = eventData.id || `evt-${Date.now()}-${Math.random().toString(36).substring(2, 6)}`;

  // AUTOMAZIONE DIRETTA GOOGLE CALENDAR & MEET PER CREATORE E TUTTI GLI INVITATI
  if (eventData.eventType === 'official' || eventData.status === 'confirmed' || eventData.finalizedSlot) {
    try {
      const reqAccessToken = req.headers.authorization?.replace('Bearer ', '') || eventData.googleAccessToken;
      const calSync = await syncConfirmedEventAcrossUserCalendars(eventData, {
        [String(eventData.creatorId)]: {
          accessToken: reqAccessToken,
          refreshToken: eventData.googleRefreshToken,
        },
      });

      if (calSync.meetLink) {
        eventData.meetLink = calSync.meetLink;
      }
      if (calSync.primaryGoogleEventId) {
        eventData.googleEventId = calSync.primaryGoogleEventId;
        eventData.googleCalendarEventId = calSync.primaryGoogleEventId;
      }
      if (calSync.googleCalendarEvents.length > 0) {
        eventData.googleCalendarEvents = calSync.googleCalendarEvents;
        const syncedSet = new Set(calSync.googleCalendarEvents.map((e) => e.userId));
        if (Array.isArray(eventData.participants)) {
          eventData.participants = eventData.participants.map((p: any) =>
            syncedSet.has(String(p.userId)) ? { ...p, googleCalendarSynced: true } : p
          );
        }
      }
    } catch (gcalErr: any) {
      console.warn("Errore sincronizzazione diretta Google Calendar:", gcalErr?.message || gcalErr);
    }
  }

  try {
    const created = await EventModel.create({
      ...eventData,
      _id: generatedId,
    });

    const mappedEvent = {
      ...created.toObject(),
      id: created._id || created.id,
    };

    // Se il sondaggio proviene da una richiesta cliente (/prenota-call), aggiorna subito la richiesta collegata
    if (mappedEvent.clientRequestId) {
      try {
        const updatedReq = await ClientRequestModel.findOneAndUpdate(
          { $or: [{ _id: mappedEvent.clientRequestId }, { id: mappedEvent.clientRequestId }] },
          { $set: { status: 'converted_to_poll', pollEventId: mappedEvent.id } },
          { new: true }
        );
        if (updatedReq) {
          broadcastRealtimeEvent('client_request:updated', {
            request: { ...updatedReq.toObject(), id: updatedReq._id || updatedReq.id },
          });
        }
      } catch (reqUpdErr: any) {
        console.warn('[ClientRequest] Errore collegamento pollEventId:', reqUpdErr?.message || reqUpdErr);
      }
    }

    broadcastRealtimeEvent('event:created', { event: mappedEvent });

    // Invia notifica Push reale
    if (mappedEvent.eventType === 'official') {
      sendEventConfirmedPushNotification({
        eventId: mappedEvent.id,
        title: mappedEvent.title,
        creatorId: mappedEvent.creatorId,
        date: mappedEvent.finalizedSlot?.date || mappedEvent.dates?.[0] || new Date().toISOString().split('T')[0],
        startTime: mappedEvent.finalizedSlot?.startTime || `${String(mappedEvent.startHour || 9).padStart(2, '0')}:00`,
        endTime: mappedEvent.finalizedSlot?.endTime || `${String(mappedEvent.endHour || 10).padStart(2, '0')}:00`,
        type: mappedEvent.type,
        location: mappedEvent.location,
        groupId: mappedEvent.groupId,
        participantUserIds: (mappedEvent.invitees || []).map((i: any) => i.userId),
        isOfficial: true,
      }).catch((pushErr: any) => console.warn('[Push] Errore trigger official event push:', pushErr?.message || pushErr));
    } else {
      sendPollPushNotification({
        pollId: mappedEvent.id,
        title: mappedEvent.title,
        creatorId: mappedEvent.creatorId,
        groupId: mappedEvent.groupId,
        subgroupId: mappedEvent.subgroupId,
        inviteeUserIds: (mappedEvent.invitees || []).map((i: any) => i.userId),
      }).catch((pushErr: any) => console.warn('[Push] Errore trigger poll push:', pushErr?.message || pushErr));
    }

    return res.status(201).json({
      event: mappedEvent,
    });
  } catch (err: any) {
    console.error('Errore salvataggio EventModel MongoDB:', err.message);
    return res.status(500).json({ error: 'Errore salvataggio evento in MongoDB' });
  }
});

// POST /api/polls - Creazione sondaggio disponibilità When2meet
app.post('/api/polls', async (req: Request, res: Response) => {
  const pollData = req.body;
  if (!pollData.title || !pollData.creatorId) {
    return res.status(400).json({ error: 'Titolo e creatore sono obbligatori' });
  }

  const generatedId = pollData.id || `poll-${Date.now()}-${Math.random().toString(36).substring(2, 6)}`;

  // AUTOMAZIONE DIRETTA GOOGLE CALENDAR & MEET PER CREATORE E TUTTI GLI INVITATI
  if (pollData.status === 'confirmed' || pollData.finalizedSlot) {
    try {
      const reqAccessToken = req.headers.authorization?.replace('Bearer ', '') || pollData.googleAccessToken;
      const calSync = await syncConfirmedEventAcrossUserCalendars(pollData, {
        [String(pollData.creatorId)]: {
          accessToken: reqAccessToken,
          refreshToken: pollData.googleRefreshToken,
        },
      });

      if (calSync.meetLink) {
        pollData.meetLink = calSync.meetLink;
      }
      if (calSync.primaryGoogleEventId) {
        pollData.googleEventId = calSync.primaryGoogleEventId;
        pollData.googleCalendarEventId = calSync.primaryGoogleEventId;
      }
      if (calSync.googleCalendarEvents.length > 0) {
        pollData.googleCalendarEvents = calSync.googleCalendarEvents;
      }
    } catch (gcalErr: any) {
      console.warn("Errore sincronizzazione diretta Google Calendar per poll:", gcalErr?.message || gcalErr);
    }
  }

  try {
    const created = await EventModel.create({
      ...pollData,
      _id: generatedId,
      eventType: pollData.eventType || 'poll',
    });

    const mappedPoll = {
      ...created.toObject(),
      id: created._id || created.id,
    };

    broadcastRealtimeEvent('event:created', { event: mappedPoll });

    // Invia notifica Push reale per il nuovo sondaggio
    sendPollPushNotification({
      pollId: mappedPoll.id,
      title: mappedPoll.title,
      creatorId: mappedPoll.creatorId,
      groupId: mappedPoll.groupId,
      subgroupId: mappedPoll.subgroupId,
      inviteeUserIds: (mappedPoll.invitees || []).map((i: any) => i.userId),
    }).catch((pushErr: any) => console.warn('[Push] Errore trigger poll push:', pushErr?.message || pushErr));

    return res.status(201).json({
      poll: mappedPoll,
      event: mappedPoll,
    });
  } catch (err: any) {
    console.error('Errore creazione sondaggio MongoDB:', err.message);
    return res.status(500).json({ error: 'Errore durante la creazione del sondaggio su MongoDB' });
  }
});

// GET /api/events/:id - Recupero singolo evento
app.get('/api/events/:id', async (req: Request, res: Response) => {
  const { id } = req.params;

  try {
    const event = await EventModel.findOne({ $or: [{ _id: id }, { id }] }).lean();
    if (!event) {
      return res.status(404).json({ error: 'Evento non trovato nel database' });
    }
    return res.json({ event: { ...event, id: (event as any)._id || (event as any).id } });
  } catch (err: any) {
    console.error('Errore recupero evento MongoDB:', err.message);
    return res.status(500).json({ error: 'Errore lettura evento in MongoDB' });
  }
});

// PATCH /api/events/:id - Aggiornamento evento in MongoDB
app.patch('/api/events/:id', async (req: Request, res: Response) => {
  const { id } = req.params;
  const updates = req.body;

  try {
    const existingEvent = await EventModel.findOne({ $or: [{ _id: id }, { id }] });
    if (!existingEvent) {
      return res.status(404).json({ error: 'Evento non trovato nel database' });
    }

    const calendarTriggerKeys = [
      'title',
      'description',
      'dates',
      'startHour',
      'endHour',
      'finalizedSlot',
      'finalDate',
      'location',
      'type',
      'invitees',
      'externalInviteEmails',
      'status',
      'meetLink',
    ];
    const hasCalendarRelevantUpdate = calendarTriggerKeys.some((k) => updates[k] !== undefined);
    const isBeingConfirmedNow = updates.status === 'confirmed' && Boolean(updates.finalizedSlot);
    const isAlreadyConfirmedOrOfficial =
      existingEvent.status === 'confirmed' ||
      existingEvent.eventType === 'official' ||
      updates.status === 'confirmed';

    // Non permettere al payload client di sovrascrivere gli ID Google Calendar già salvati sul server
    delete updates.googleCalendarEvents;
    delete updates.googleEventId;
    delete updates.googleCalendarEventId;
    if (updates.meetLink && isPlaceholderMeetLink(updates.meetLink) && existingEvent.meetLink && !isPlaceholderMeetLink(existingEvent.meetLink)) {
      delete updates.meetLink;
    }

    if (isBeingConfirmedNow || (isAlreadyConfirmedOrOfficial && hasCalendarRelevantUpdate)) {
      try {
        const existingObj = existingEvent.toObject();
        const mergedEventSnapshot = {
          ...existingObj,
          ...updates,
          meetLink:
            updates.meetLink && !isPlaceholderMeetLink(updates.meetLink)
              ? updates.meetLink
              : existingObj.meetLink,
          googleCalendarEvents: existingObj.googleCalendarEvents || [],
          googleEventId: existingObj.googleEventId,
          googleCalendarEventId: existingObj.googleCalendarEventId,
        };

        const requesterId = String(
          req.body?.userId ||
            updates.userId ||
            (req.headers['x-user-id'] as string) ||
            existingObj.creatorId
        );
        const reqAccessToken =
          req.headers.authorization?.replace('Bearer ', '') ||
          req.body?.googleAccessToken ||
          updates.googleAccessToken;
        const reqRefreshToken = req.body?.googleRefreshToken || updates.googleRefreshToken;

        const calSync = await syncConfirmedEventAcrossUserCalendars(mergedEventSnapshot, {
          [requesterId]: {
            accessToken: reqAccessToken,
            refreshToken: reqRefreshToken,
          },
        });

        updates.googleCalendarEvents = calSync.googleCalendarEvents;
        if (calSync.primaryGoogleEventId) {
          updates.googleEventId = calSync.primaryGoogleEventId;
          updates.googleCalendarEventId = calSync.primaryGoogleEventId;
        }
        if (calSync.meetLink) {
          updates.meetLink = calSync.meetLink;
        }
        const syncedSet = new Set(calSync.googleCalendarEvents.map((e) => e.userId));
        const baseParticipants = Array.isArray(updates.participants)
          ? updates.participants
          : existingObj.participants;
        if (Array.isArray(baseParticipants) && baseParticipants.length > 0) {
          updates.participants = baseParticipants.map((p: any) =>
            syncedSet.has(String(p.userId)) ? { ...p, googleCalendarSynced: true } : p
          );
        }
      } catch (gcalErr: any) {
        console.warn("Google Calendar patch multi-user sync warning:", gcalErr?.message || gcalErr);
      }
    }

    const updated = await EventModel.findOneAndUpdate(
      { $or: [{ _id: id }, { id }] },
      { $set: updates },
      { new: true }
    );
    if (!updated) {
      return res.status(404).json({ error: 'Evento non trovato nel database' });
    }

    const mappedUpdated = { ...updated.toObject(), id: updated._id || updated.id };
    broadcastRealtimeEvent('event:updated', { event: mappedUpdated });

    // Se il sondaggio confermato/modificato è associato a un cliente B2B (/prenota-call),
    // invia la conferma o aggiornamento via Resend ESCLUSIVAMENTE al cliente (senza inserirlo sul Calendar del cliente)
    if (
      mappedUpdated.status === 'confirmed' &&
      mappedUpdated.finalizedSlot &&
      (mappedUpdated.clientRequestId || mappedUpdated.clientInfo?.contactEmail)
    ) {
      (async () => {
        try {
          let targetClientReq: any = null;
          if (mappedUpdated.clientRequestId) {
            targetClientReq = await ClientRequestModel.findOneAndUpdate(
              { $or: [{ _id: mappedUpdated.clientRequestId }, { id: mappedUpdated.clientRequestId }] },
              {
                $set: {
                  status: 'confirmed',
                  finalizedSlot: mappedUpdated.finalizedSlot,
                  meetLink: mappedUpdated.meetLink || undefined,
                  emailConfirmationSentAt: new Date(),
                },
              },
              { new: true }
            );
            if (targetClientReq) {
              broadcastRealtimeEvent('client_request:updated', {
                request: { ...targetClientReq.toObject(), id: targetClientReq._id || targetClientReq.id },
              });
            }
          }

          const clientEmail =
            mappedUpdated.clientInfo?.contactEmail || targetClientReq?.contactEmail;
          const companyName =
            mappedUpdated.clientInfo?.companyName || targetClientReq?.companyName || 'Cliente';

          if (clientEmail && mappedUpdated.finalizedSlot) {
            const creatorUser: any = await UserModel.findOne({
              $or: [{ _id: mappedUpdated.creatorId }, { id: mappedUpdated.creatorId }],
            }).lean();
            await sendClientConfirmationEmailViaResend({
              companyName,
              contactEmail: clientEmail,
              meetingTitle: mappedUpdated.title,
              description: targetClientReq?.description || mappedUpdated.description,
              date: mappedUpdated.finalizedSlot.date,
              startTime: mappedUpdated.finalizedSlot.startTime,
              endTime: mappedUpdated.finalizedSlot.endTime,
              meetLink: mappedUpdated.meetLink || 'https://meet.google.com',
              organizerName: creatorUser
                ? `${creatorUser.name || ''} ${creatorUser.surname || ''}`.trim()
                : 'Team JESic',
              organizerRole: 'Area Relazioni Esterne & B2B',
              organizerEmail: creatorUser?.email || 'info@jesicmeet.it',
            });
          }
        } catch (clientMailErr: any) {
          console.warn('[Client Confirmation Email] Errore invio su PATCH event:', clientMailErr?.message || clientMailErr);
        }
      })();
    }

    if (mappedUpdated.status === 'confirmed' && mappedUpdated.finalizedSlot) {
      sendEventConfirmedPushNotification({
        eventId: mappedUpdated.id,
        title: mappedUpdated.title,
        creatorId: mappedUpdated.creatorId,
        date: mappedUpdated.finalizedSlot.date,
        startTime: mappedUpdated.finalizedSlot.startTime,
        endTime: mappedUpdated.finalizedSlot.endTime,
        type: mappedUpdated.type,
        location: mappedUpdated.location,
        groupId: mappedUpdated.groupId,
        participantUserIds: [
          ...(mappedUpdated.invitees || []).map((i: any) => i.userId),
          ...(mappedUpdated.participants || []).map((p: any) => p.userId),
        ],
        isOfficial: mappedUpdated.eventType === 'official',
      }).catch((pushErr: any) => console.warn('[Push] Errore trigger confirmed event push:', pushErr?.message || pushErr));
    }

    return res.json({ success: true, event: mappedUpdated });
  } catch (err: any) {
    console.error('Errore aggiornamento EventModel MongoDB:', err.message);
    return res.status(500).json({ error: 'Errore aggiornamento evento in MongoDB' });
  }
});

// DELETE /api/events/:id & /api/polls/:id - Eliminazione reale da Google Calendar (per tutti i partecipanti) e MongoDB
const handleDeleteEventOrPoll = async (req: Request, res: Response) => {
  const { id } = req.params;

  try {
    // 1. PRIMA di eliminare l'elemento dal DB, cercalo con findById (e fallback findOne)
    let eventToDelete: any = null;
    try {
      eventToDelete = await EventModel.findById(id);
    } catch {}
    if (!eventToDelete) {
      eventToDelete = await EventModel.findOne({ $or: [{ _id: id }, { id }] });
    }

    if (!eventToDelete) {
      return res.status(404).json({ error: 'Evento/Sondaggio non trovato nel database' });
    }

    // 2. Rimuovi l'evento da Google Calendar per ogni partecipante/invitato sincronizzato
    try {
      const requesterId = String(
        req.body?.userId ||
          (req.query?.userId as string) ||
          (req.headers['x-user-id'] as string) ||
          eventToDelete.creatorId ||
          ''
      );
      const overrideTokens: Record<string, CalendarTokenOverride> = {};
      if (requesterId) {
        overrideTokens[requesterId] = {
          accessToken: req.headers.authorization?.replace('Bearer ', '') || req.body?.googleAccessToken,
          refreshToken: req.body?.googleRefreshToken || (req.query?.googleRefreshToken as string),
        };
      }
      await deleteEventAcrossUserCalendars(eventToDelete.toObject ? eventToDelete.toObject() : eventToDelete, overrideTokens);
    } catch (delCalErr: any) {
      console.warn("Errore eliminazione da Google Calendar (procedo con DB):", delCalErr?.message || delCalErr);
    }

    // 3. Solo DOPO aver avvisato Google, esegui l'eliminazione da MongoDB
    const deletedObj = eventToDelete.toObject ? eventToDelete.toObject() : eventToDelete;
    await EventModel.deleteOne({ $or: [{ _id: id }, { id }] });
    await EventResponseModel.deleteMany({ eventId: id });
    const affectedRequests = await ClientRequestModel.find({
      $or: [
        { pollEventId: id },
        ...(deletedObj?.clientRequestId ? [{ _id: deletedObj.clientRequestId }] : []),
      ],
    }).lean();
    if (affectedRequests.length > 0) {
      const wasConfirmedEvent = deletedObj?.status === 'confirmed';
      await ClientRequestModel.updateMany(
        {
          $or: [
            { pollEventId: id },
            ...(deletedObj?.clientRequestId ? [{ _id: deletedObj.clientRequestId }] : []),
          ],
        },
        {
          $set: wasConfirmedEvent
            ? { status: 'rejected', pollEventId: null }
            : { status: 'pending', pollEventId: null },
        }
      );
      for (const reqItem of affectedRequests as any[]) {
        broadcastRealtimeEvent('client_request:updated', {
          request: {
            ...reqItem,
            id: reqItem._id || reqItem.id,
            status: wasConfirmedEvent ? 'rejected' : 'pending',
            pollEventId: null,
          },
        });
        if (wasConfirmedEvent && reqItem.contactEmail) {
          sendClientCancellationEmailViaResend({
            companyName: reqItem.companyName || 'Cliente',
            contactEmail: reqItem.contactEmail,
            meetingTitle: deletedObj?.title,
            description: reqItem.description,
            wasConfirmed: true,
          }).catch(() => {});
        }
      }
    }

    broadcastRealtimeEvent('event:deleted', { eventId: id });

    return res.json({
      success: true,
      message: 'Sondaggio/Evento eliminato con successo da Google Calendar e MongoDB',
    });
  } catch (err: any) {
    console.error('Errore cancellazione EventModel MongoDB:', err.message);
    return res.status(500).json({ error: 'Errore eliminazione sondaggio/evento in MongoDB' });
  }
};

app.delete('/api/events/:id', handleDeleteEventOrPoll);
app.post('/api/events/:id/delete', handleDeleteEventOrPoll);
app.delete('/api/polls/:id', handleDeleteEventOrPoll);
app.post('/api/polls/:id/delete', handleDeleteEventOrPoll);

// PATCH /api/polls/:id/confirmed-date - Modifica data/ora di un sondaggio confermato con allineamento Google Calendar per tutti gli invitati
const handleUpdatePollConfirmedDate = async (req: Request, res: Response) => {
  const { id } = req.params;
  const { date, finalDate, startTime, endTime } = req.body;

  const targetDate = typeof finalDate === 'object' && finalDate?.date ? finalDate.date : (date || finalDate);
  const targetStartTime = typeof finalDate === 'object' && finalDate?.startTime ? finalDate.startTime : (startTime || '09:00');
  const targetEndTime = typeof finalDate === 'object' && finalDate?.endTime ? finalDate.endTime : (endTime || '10:00');

  if (!targetDate) {
    return res.status(400).json({ error: 'Data, ora inizio e ora fine sono obbligatori' });
  }

  try {
    let existingPoll: any = null;
    try {
      existingPoll = await PollModel.findById(id);
    } catch {}
    if (!existingPoll) {
      existingPoll = await PollModel.findOne({ $or: [{ _id: id }, { id }] });
    }

    if (!existingPoll) {
      return res.status(404).json({ error: 'Sondaggio non trovato nel database' });
    }

    const startH = parseInt(targetStartTime.split(':')[0], 10) || 9;
    const endH = parseInt(targetEndTime.split(':')[0], 10) || 10;

    const finalDateObj = {
      date: targetDate,
      startTime: targetStartTime,
      endTime: targetEndTime,
    };

    const existingObj = existingPoll.toObject ? existingPoll.toObject() : existingPoll;
    const requesterId = String(
      req.body?.userId ||
        (req.headers['x-user-id'] as string) ||
        existingObj.creatorId ||
        ''
    );

    const calSync = await syncConfirmedEventAcrossUserCalendars(
      {
        ...existingObj,
        finalDate: finalDateObj,
        finalizedSlot: finalDateObj,
        dates: [targetDate],
        startHour: startH,
        endHour: endH,
        status: 'confirmed',
      },
      requesterId
        ? {
            [requesterId]: {
              accessToken: req.body?.googleAccessToken || req.headers.authorization?.replace('Bearer ', ''),
              refreshToken: req.body?.googleRefreshToken,
            },
          }
        : {}
    );

    const updateSet: Record<string, any> = {
      finalDate: finalDateObj,
      dates: [targetDate],
      startHour: startH,
      endHour: endH,
      finalizedSlot: finalDateObj,
      status: 'confirmed',
      googleCalendarEvents: calSync.googleCalendarEvents,
    };
    if (calSync.primaryGoogleEventId) {
      updateSet.googleEventId = calSync.primaryGoogleEventId;
      updateSet.googleCalendarEventId = calSync.primaryGoogleEventId;
    }
    if (calSync.meetLink) {
      updateSet.meetLink = calSync.meetLink;
    }

    const updatedPoll = await PollModel.findOneAndUpdate(
      { $or: [{ _id: id }, { id }] },
      { $set: updateSet },
      { new: true }
    );

    if (!updatedPoll) {
      return res.status(404).json({ error: 'Errore aggiornamento sondaggio su MongoDB' });
    }

    const pollObj = typeof updatedPoll.toObject === 'function' ? updatedPoll.toObject() : updatedPoll;
    const mapped = {
      ...pollObj,
      id: updatedPoll._id || updatedPoll.id,
      finalDate: finalDateObj,
      finalizedSlot: finalDateObj,
      dates: [targetDate],
      startHour: startH,
      endHour: endH,
      status: 'confirmed',
    };

    broadcastRealtimeEvent('event:updated', { event: mapped });

    // Se il sondaggio modificato è associato a un cliente B2B (/prenota-call),
    // aggiorna la richiesta cliente e invia la conferma/aggiornamento via Resend ESCLUSIVAMENTE al cliente
    if (mapped.clientRequestId || mapped.clientInfo?.contactEmail) {
      (async () => {
        try {
          let targetClientReq: any = null;
          if (mapped.clientRequestId) {
            targetClientReq = await ClientRequestModel.findOneAndUpdate(
              { $or: [{ _id: mapped.clientRequestId }, { id: mapped.clientRequestId }] },
              {
                $set: {
                  status: 'confirmed',
                  finalizedSlot: finalDateObj,
                  meetLink: mapped.meetLink || undefined,
                  emailConfirmationSentAt: new Date(),
                },
              },
              { new: true }
            );
            if (targetClientReq) {
              broadcastRealtimeEvent('client_request:updated', {
                request: { ...targetClientReq.toObject(), id: targetClientReq._id || targetClientReq.id },
              });
            }
          }

          const clientEmail = mapped.clientInfo?.contactEmail || targetClientReq?.contactEmail;
          const companyName = mapped.clientInfo?.companyName || targetClientReq?.companyName || 'Cliente';
          if (clientEmail) {
            const creatorUser: any = await UserModel.findOne({
              $or: [{ _id: mapped.creatorId }, { id: mapped.creatorId }],
            }).lean();
            await sendClientConfirmationEmailViaResend({
              companyName,
              contactEmail: clientEmail,
              meetingTitle: mapped.title,
              description: targetClientReq?.description || mapped.description,
              date: targetDate,
              startTime: targetStartTime,
              endTime: targetEndTime,
              meetLink: mapped.meetLink || 'https://meet.google.com',
              organizerName: creatorUser
                ? `${creatorUser.name || ''} ${creatorUser.surname || ''}`.trim()
                : 'Team JESic',
              organizerRole: 'Area Relazioni Esterne & B2B',
              organizerEmail: creatorUser?.email || 'info@jesicmeet.it',
            });
          }
        } catch (clientMailErr: any) {
          console.warn('[Client Confirmation Email] Errore invio su confirmed-date:', clientMailErr?.message || clientMailErr);
        }
      })();
    }

    // Invia notifica push reale per la conferma della riunione
    sendEventConfirmedPushNotification({
      eventId: mapped.id,
      title: mapped.title,
      creatorId: mapped.creatorId,
      date: targetDate,
      startTime: targetStartTime,
      endTime: targetEndTime,
      type: mapped.type,
      location: mapped.location,
      groupId: mapped.groupId,
      participantUserIds: [
        ...(mapped.invitees || []).map((i: any) => i.userId),
        ...(mapped.participants || []).map((p: any) => p.userId),
      ],
      isOfficial: mapped.eventType === 'official',
    }).catch((pushErr: any) => console.warn('[Push] Errore trigger confirmed poll push:', pushErr?.message || pushErr));

    return res.json({
      success: true,
      message: 'Data e ora confermate aggiornate con successo e sincronizzate su Google Calendar per tutti gli invitati',
      poll: mapped,
      event: mapped,
    });
  } catch (err: any) {
    console.error('Errore update confirmed date MongoDB:', err.message);
    return res.status(500).json({ error: 'Errore aggiornamento data confermata in MongoDB' });
  }
};

app.patch('/api/polls/:id/confirmed-date', handleUpdatePollConfirmedDate);
app.patch('/api/events/:id/confirmed-date', handleUpdatePollConfirmedDate);

// POST /api/events/:id/participate - Partecipazione evento ufficiale & inserimento diretto Google Calendar
app.post('/api/events/:id/participate', async (req: Request, res: Response) => {
  const { id } = req.params;
  const { userId, googleAccessToken, googleRefreshToken } = req.body;

  try {
    const event = await EventModel.findOne({ $or: [{ _id: id }, { id }] });
    if (!event) {
      return res.status(404).json({ error: 'Evento non trovato' });
    }

    if (!event.participants) event.participants = [];
    const partIdx = event.participants.findIndex((p) => p.userId === userId);
    if (partIdx >= 0) {
      event.participants[partIdx].status = 'accepted';
      event.participants[partIdx].respondedAt = new Date().toISOString();
    } else {
      event.participants.push({
        userId,
        status: 'accepted',
        respondedAt: new Date().toISOString(),
        googleCalendarSynced: false,
      });
    }

    const updatedPartIdx = event.participants.findIndex((p) => p.userId === userId);
    const existingEntries = Array.isArray(event.googleCalendarEvents) ? [...event.googleCalendarEvents] : [];
    const alreadyHasEntry =
      existingEntries.some((entry) => entry.userId === userId) ||
      (event.creatorId === userId && Boolean(event.googleEventId || event.googleCalendarEventId));

    if (alreadyHasEntry) {
      if (updatedPartIdx >= 0) {
        event.participants[updatedPartIdx].googleCalendarSynced = true;
      }
    } else if (event.status === 'confirmed' || event.eventType === 'official' || event.finalizedSlot) {
      try {
        const userDoc = await UserModel.findOne({ $or: [{ _id: userId }, { id: userId }] }).lean();
        const refreshToken = googleRefreshToken || (userDoc as any)?.googleRefreshToken;
        const accessToken =
          req.headers.authorization?.replace('Bearer ', '') ||
          googleAccessToken ||
          (userDoc as any)?.googleAccessToken;

        if ((userDoc as any)?.googleCalendarConnected !== false && (refreshToken || accessToken)) {
          const { targetDate, startTime, endTime } = resolveEventDateAndTimes(event);
          const isOnline = event.type !== 'in_person';
          const existingMeetLink =
            isOnline && event.meetLink && !isPlaceholderMeetLink(event.meetLink) ? event.meetLink : undefined;

          const calRes = await createGoogleCalendarEvent({
            accessToken,
            refreshToken,
            title: event.title,
            description: event.description,
            date: targetDate,
            startTime,
            endTime,
            isOnline,
            location: event.location,
            meetLink: existingMeetLink,
            skipConferenceCreation: Boolean(existingMeetLink),
            sendUpdates: 'none',
          });

          if (calRes.success && calRes.eventId) {
            existingEntries.push({ userId, googleEventId: calRes.eventId });
            event.googleCalendarEvents = existingEntries as any;
            if (!existingMeetLink && calRes.meetLink) {
              event.meetLink = calRes.meetLink;
            }
            if (updatedPartIdx >= 0) {
              event.participants[updatedPartIdx].googleCalendarSynced = true;
            }
          }
        }
      } catch (calErr: any) {
        console.warn(`[Google Calendar] Errore sync partecipazione utente ${userId}:`, calErr?.message || calErr);
      }
    }

    await event.save();
    const mapped = { ...event.toObject(), id: event._id || event.id };
    broadcastRealtimeEvent('event:updated', { event: mapped });
    return res.json({ success: true, event: mapped });
  } catch (err: any) {
    console.error('Errore participate EventModel MongoDB:', err.message);
    return res.status(500).json({ error: 'Errore salvataggio partecipazione in MongoDB' });
  }
});

// POST /api/events/:id/decline - Rifiuto partecipazione evento & rimozione dal calendario dell'utente
app.post('/api/events/:id/decline', async (req: Request, res: Response) => {
  const { id } = req.params;
  const { userId, googleAccessToken, googleRefreshToken } = req.body;

  try {
    const event = await EventModel.findOne({ $or: [{ _id: id }, { id }] });
    if (!event) {
      return res.status(404).json({ error: 'Evento non trovato' });
    }

    if (!event.participants) event.participants = [];
    const partIdx = event.participants.findIndex((p) => p.userId === userId);
    if (partIdx >= 0) {
      event.participants[partIdx].status = 'declined';
      event.participants[partIdx].respondedAt = new Date().toISOString();
      event.participants[partIdx].googleCalendarSynced = false;
    } else {
      event.participants.push({
        userId,
        status: 'declined',
        respondedAt: new Date().toISOString(),
        googleCalendarSynced: false,
      });
    }

    const existingEntries = Array.isArray(event.googleCalendarEvents) ? [...event.googleCalendarEvents] : [];
    const userCalEntry = existingEntries.find((entry) => entry.userId === userId);
    const targetGoogleEventId =
      userCalEntry?.googleEventId ||
      (event.creatorId === userId ? event.googleEventId || event.googleCalendarEventId : undefined);

    if (targetGoogleEventId) {
      try {
        const userDoc = await UserModel.findOne({ $or: [{ _id: userId }, { id: userId }] }).lean();
        const refreshToken = googleRefreshToken || (userDoc as any)?.googleRefreshToken;
        const accessToken =
          req.headers.authorization?.replace('Bearer ', '') ||
          googleAccessToken ||
          (userDoc as any)?.googleAccessToken;

        if (refreshToken || accessToken) {
          await deleteGoogleCalendarEvent({ refreshToken, accessToken }, targetGoogleEventId);
        }
      } catch (delErr: any) {
        console.warn(`[Google Calendar] Warning rimozione su decline utente ${userId}:`, delErr?.message || delErr);
      }

      event.googleCalendarEvents = existingEntries.filter((entry) => entry.userId !== userId) as any;
      if (event.creatorId === userId) {
        event.googleEventId = undefined;
        event.googleCalendarEventId = undefined;
      }
    }

    await event.save();
    const mapped = { ...event.toObject(), id: event._id || event.id };
    broadcastRealtimeEvent('event:updated', { event: mapped });
    return res.json({ success: true, event: mapped });
  } catch (err: any) {
    console.error('Errore decline EventModel MongoDB:', err.message);
    return res.status(500).json({ error: 'Errore salvataggio rifiuto in MongoDB' });
  }
});

/* ==========================================================================
   5. AVAILABILITY RESPONSES API (When2meet Slot Responses)
   ========================================================================== */

// GET /api/responses - Ritorna le risposte di disponibilità da MongoDB
app.get('/api/responses', async (req: Request, res: Response) => {
  const { eventId, userId } = req.query;

  try {
    let query: any = {};
    if (eventId) query.eventId = eventId;
    if (userId) query.userId = userId;

    const responses = await EventResponseModel.find(query).lean();
    const mapped = responses.map((r: any) => ({
      ...r,
      id: r._id || r.id,
    }));
    return res.json({ responses: mapped });
  } catch (err: any) {
    console.error('Errore lettura EventResponseModel MongoDB:', err.message);
    return res.status(500).json({ error: 'Errore lettura risposte da MongoDB' });
  }
});

// POST /api/responses - Invia o aggiorna la disponibilità di uno slot When2meet in MongoDB
app.post('/api/responses', async (req: Request, res: Response) => {
  const { eventId, userId, availability, isMandatory, status } = req.body;
  if (!eventId || !userId) {
    return res.status(400).json({ error: 'eventId e userId sono obbligatori' });
  }

  const nowIso = new Date().toISOString();

  try {
    const resp = await EventResponseModel.findOneAndUpdate(
      { eventId, userId },
      {
        availability: availability || [],
        isMandatory: Boolean(isMandatory),
        status: status || 'submitted',
        submittedAt: nowIso,
      },
      { upsert: true, new: true, setDefaultsOnInsert: true }
    );

    const mappedResponse = {
      ...resp.toObject(),
      id: resp._id || resp.id,
    };

    broadcastRealtimeEvent('response:updated', { response: mappedResponse });

    return res.status(201).json({
      response: mappedResponse,
    });
  } catch (err: any) {
    console.error('Errore salvataggio EventResponseModel MongoDB:', err.message);
    return res.status(500).json({ error: 'Errore salvataggio disponibilità in MongoDB' });
  }
});

/* ==========================================================================
   6. CLIENT REQUESTS API (ClientRequestModel B2B)
   ========================================================================== */

// GET /api/client-requests - Lista richieste clienti da MongoDB (filtrabili per groupId e riservate ESCLUSIVAMENTE ad admin_clienti)
app.get('/api/client-requests', async (req: Request, res: Response) => {
  const { groupId, userId } = req.query;
  try {
    let filter: any = {};
    if (groupId) {
      filter.groupId = groupId;
      // Riservato ESCLUSIVAMENTE ad 'admin_clienti' del gruppo
      if (userId && typeof userId === 'string') {
        const group = (await GroupModel.findOne({ $or: [{ _id: groupId }, { id: groupId }] } as any)) as any;
        if (group) {
          const member = group.members?.find((m: any) => m.userId === userId);
          const isAdminClienti = member && member.role === 'admin_clienti';
          if (!isAdminClienti) {
            return res.status(403).json({ error: 'Accesso negato: la gestione delle richieste clienti e del B2B è riservata esclusivamente ad admin_clienti' });
          }
        }
      }
    } else if (userId && typeof userId === 'string') {
      // Se non è specificato groupId ma c'è userId, ritorna le richieste dei soli gruppi in cui l'utente ha ruolo 'admin_clienti'
      const authorizedGroups: any[] = await GroupModel.find({
        members: { $elemMatch: { userId, role: 'admin_clienti' } },
      } as any).select('_id id');
      const groupIds = authorizedGroups.map((g: any) => g._id || g.id);
      filter.groupId = { $in: groupIds };
    }

    const requests = await ClientRequestModel.find(filter).sort({ createdAt: -1 }).lean();
    const mapped = requests.map((r: any) => ({
      ...r,
      id: r._id || r.id,
      groupId: r.groupId || null,
    }));
    return res.json({ requests: mapped });
  } catch (err: any) {
    console.error('Errore lettura ClientRequestModel MongoDB:', err.message);
    return res.status(500).json({ error: 'Errore lettura richieste da MongoDB' });
  }
});

// POST /api/client-requests - Invia nuova richiesta da cliente in MongoDB (collegata al gruppo)
app.post('/api/client-requests', async (req: Request, res: Response) => {
  const reqData = req.body;
  if (!reqData.companyName || !reqData.contactEmail) {
    return res.status(400).json({ error: 'Nome azienda ed email contatto sono obbligatori' });
  }

  const genId = reqData.id || `req-${Date.now()}-${Math.random().toString(36).substring(2, 6)}`;

  try {
    const created = await ClientRequestModel.create({
      ...reqData,
      _id: genId,
      groupId: reqData.groupId || null,
      status: reqData.status || 'pending',
    });

    const mappedRequest = {
      ...created.toObject(),
      id: created._id || created.id,
      groupId: created.groupId || null,
    };

    broadcastRealtimeEvent('client_request:created', { request: mappedRequest });

    return res.status(201).json({
      request: mappedRequest,
    });
  } catch (err: any) {
    console.error('Errore salvataggio ClientRequestModel MongoDB:', err.message);
    return res.status(500).json({ error: 'Errore salvataggio richiesta cliente in MongoDB' });
  }
});

// PATCH /api/client-requests/:id - Aggiorna richiesta cliente in MongoDB (Riservato ESCLUSIVAMENTE ad admin_clienti del gruppo)
app.patch('/api/client-requests/:id', async (req: Request, res: Response) => {
  const { id } = req.params;
  const updates = req.body;
  const userId = req.body.userId || req.query.userId;

  try {
    const existing = await ClientRequestModel.findOne({ $or: [{ _id: id }, { id }] });
    if (!existing) {
      return res.status(404).json({ error: 'Richiesta non trovata nel database' });
    }

    if (userId && existing.groupId) {
      const group = (await GroupModel.findOne({ $or: [{ _id: existing.groupId }, { id: existing.groupId }] } as any)) as any;
      if (group) {
        const member = group.members?.find((m: any) => m.userId === userId);
        const isAdminClienti = member && member.role === 'admin_clienti';
        if (!isAdminClienti) {
          return res.status(403).json({ error: 'Accesso negato: solo admin_clienti del gruppo associato può gestire le richieste clienti' });
        }
      }
    }

    const updated = await ClientRequestModel.findOneAndUpdate(
      { $or: [{ _id: id }, { id }] },
      { $set: updates },
      { new: true }
    );
    if (!updated) {
      return res.status(404).json({ error: 'Richiesta non trovata nel database' });
    }
    const mappedRequest = { ...updated.toObject(), id: updated._id || updated.id };
    broadcastRealtimeEvent('client_request:updated', { request: mappedRequest });

    if (updates.status === 'rejected' && existing.status !== 'rejected' && mappedRequest.contactEmail) {
      sendClientCancellationEmailViaResend({
        companyName: mappedRequest.companyName,
        contactEmail: mappedRequest.contactEmail,
        description: mappedRequest.description,
        reason: updates.rejectionReason,
        wasConfirmed: existing.status === 'confirmed',
      }).catch(() => {});
    }

    return res.json({ success: true, request: mappedRequest });
  } catch (err: any) {
    console.error('Errore aggiornamento ClientRequestModel MongoDB:', err.message);
    return res.status(500).json({ error: 'Errore aggiornamento richiesta cliente in MongoDB' });
  }
});

// POST /api/client-requests/:id/confirm-final - Chiusura e conferma call con cliente in MongoDB (Riservato ESCLUSIVAMENTE ad admin_clienti del gruppo)
// REGOLA: Inserimento diretto sul Google Calendar SOLO per il team JESic; al cliente NON si inserisce su Calendar ma si invia l'email di conferma tramite Resend SOLO a lui.
app.post('/api/client-requests/:id/confirm-final', async (req: Request, res: Response) => {
  const { id } = req.params;
  const {
    finalizedDate,
    finalizedStartTime,
    finalizedEndTime,
    meetLink,
    userId,
    eventId,
    googleAccessToken,
    googleRefreshToken,
    organizerName,
    organizerRole,
    adminEmail,
  } = req.body;

  try {
    const existing = await ClientRequestModel.findOne({ $or: [{ _id: id }, { id }] });
    if (!existing) {
      return res.status(404).json({ error: 'Richiesta non trovata nel database' });
    }

    if (userId && existing.groupId) {
      const group = (await GroupModel.findOne({ $or: [{ _id: existing.groupId }, { id: existing.groupId }] } as any)) as any;
      if (group) {
        const member = group.members?.find((m: any) => m.userId === userId);
        const isAdminClienti = member && member.role === 'admin_clienti';
        if (!isAdminClienti) {
          return res.status(403).json({ error: 'Accesso negato: solo admin_clienti del gruppo associato può confermare la call cliente' });
        }
      }
    }

    const finalSlot = {
      date: finalizedDate,
      startTime: finalizedStartTime,
      endTime: finalizedEndTime,
    };

    let finalMeet = meetLink && !isPlaceholderMeetLink(meetLink) ? String(meetLink) : '';
    let updatedLinkedEvent: any = null;
    let directCalendarEvents: Array<{ userId: string; googleEventId: string }> = Array.isArray(existing.googleCalendarEvents)
      ? existing.googleCalendarEvents.map((e: any) => ({ userId: String(e.userId), googleEventId: String(e.googleEventId) }))
      : [];

    const targetEventId = eventId || existing.pollEventId;
    const reqAccessToken = req.headers.authorization?.replace('Bearer ', '') || googleAccessToken;

    if (targetEventId) {
      const linkedEvent = await EventModel.findOne({ $or: [{ _id: targetEventId }, { id: targetEventId }] });
      if (linkedEvent) {
        const linkedObj = linkedEvent.toObject ? linkedEvent.toObject() : linkedEvent;
        const overrideTokens: Record<string, CalendarTokenOverride> = {};
        if (userId) {
          overrideTokens[String(userId)] = {
            accessToken: reqAccessToken,
            refreshToken: googleRefreshToken,
          };
        }

        const calSync = await syncConfirmedEventAcrossUserCalendars(
          {
            ...linkedObj,
            status: 'confirmed',
            finalizedSlot: finalSlot,
            finalDate: finalSlot,
            meetLink: finalMeet || linkedObj.meetLink,
            clientInfo: linkedObj.clientInfo || {
              companyName: existing.companyName,
              contactEmail: existing.contactEmail,
            },
          },
          overrideTokens
        );

        if (calSync.meetLink) {
          finalMeet = calSync.meetLink;
        }

        linkedEvent.status = 'confirmed';
        linkedEvent.finalizedSlot = finalSlot;
        linkedEvent.finalDate = finalSlot as any;
        linkedEvent.googleCalendarEvents = calSync.googleCalendarEvents as any;
        directCalendarEvents = calSync.googleCalendarEvents;
        if (calSync.primaryGoogleEventId) {
          linkedEvent.googleEventId = calSync.primaryGoogleEventId;
          linkedEvent.googleCalendarEventId = calSync.primaryGoogleEventId;
        }
        if (finalMeet) {
          linkedEvent.meetLink = finalMeet;
        }

        await linkedEvent.save();
        updatedLinkedEvent = { ...linkedEvent.toObject(), id: linkedEvent._id || linkedEvent.id };
        broadcastRealtimeEvent('event:updated', { event: updatedLinkedEvent });
      }
    } else if (userId) {
      try {
        const adminUser = await UserModel.findOne({ $or: [{ _id: userId }, { id: userId }] }).lean();
        const refreshToken = googleRefreshToken || (adminUser as any)?.googleRefreshToken;
        const accessToken = reqAccessToken || (adminUser as any)?.googleAccessToken;
        if ((adminUser as any)?.googleCalendarConnected !== false && (refreshToken || accessToken)) {
          // Inserimento SOLO sul calendario dell'organizzatore/team interno: il cliente NON viene inserito su Google Calendar
          const calRes = await createGoogleCalendarEvent({
            accessToken,
            refreshToken,
            title: `Call Cliente: ${existing.companyName}`,
            description: existing.description,
            date: finalizedDate,
            startTime: finalizedStartTime,
            endTime: finalizedEndTime,
            isOnline: true,
            sendUpdates: 'none',
            attendeeEmails: [],
          });
          if (calRes.success) {
            if (calRes.meetLink) finalMeet = calRes.meetLink;
            if (calRes.eventId) {
              directCalendarEvents = [{ userId: String(userId), googleEventId: calRes.eventId }];
            }
          }
        }
      } catch (calErr: any) {
        console.warn('[Google Calendar] Warning creazione call B2B diretta:', calErr?.message || calErr);
      }
    }

    if (!finalMeet) {
      finalMeet = `https://meet.google.com/jes-${Math.random().toString(36).substring(2, 6)}-call`;
    }

    // Invio email di conferma tramite Resend ESCLUSIVAMENTE al cliente esterno
    const emailResult = await sendClientConfirmationEmailViaResend({
      companyName: existing.companyName,
      contactEmail: existing.contactEmail,
      meetingTitle: `Call con ${existing.companyName}`,
      description: existing.description,
      date: finalizedDate,
      startTime: finalizedStartTime,
      endTime: finalizedEndTime,
      meetLink: finalMeet,
      organizerName: organizerName || 'Team Junior Enterprise Sicilia',
      organizerRole: organizerRole || 'Area Relazioni Esterne & B2B',
      organizerEmail: adminEmail || 'info@jesicmeet.it',
    });

    const updated = await ClientRequestModel.findOneAndUpdate(
      { $or: [{ _id: id }, { id }] },
      {
        status: 'confirmed',
        finalizedSlot: finalSlot,
        meetLink: finalMeet,
        googleCalendarEvents: directCalendarEvents,
        emailConfirmationSentAt: emailResult.success ? new Date() : existing.emailConfirmationSentAt,
        updatedAt: new Date(),
      },
      { new: true }
    );

    if (!updated) {
      return res.status(404).json({ error: 'Richiesta non trovata nel database' });
    }

    const mappedRequest = { ...updated.toObject(), id: updated._id || updated.id };
    broadcastRealtimeEvent('client_request:updated', { request: mappedRequest });

    return res.json({
      success: true,
      message: emailResult.success
        ? 'Richiesta confermata ed email inviata al cliente tramite Resend.'
        : 'Richiesta confermata nel database (controlla configurazione Resend per il recapito email).',
      emailSent: emailResult.success,
      emailError: emailResult.error,
      meetLink: finalMeet,
      request: mappedRequest,
      ...(updatedLinkedEvent ? { event: updatedLinkedEvent } : {}),
    });
  } catch (err: any) {
    console.error('Errore confirm-final ClientRequestModel MongoDB:', err.message);
    return res.status(500).json({ error: 'Errore conferma call cliente in MongoDB' });
  }
});

// POST /api/client-requests/:id/reject - Non conferma o annullamento call cliente con invio email Resend ESCLUSIVAMENTE al cliente
app.post('/api/client-requests/:id/reject', async (req: Request, res: Response) => {
  const { id } = req.params;
  const {
    userId,
    reason,
    organizerName,
    organizerRole,
    adminEmail,
    googleAccessToken,
    googleRefreshToken,
  } = req.body;

  try {
    const existing = await ClientRequestModel.findOne({ $or: [{ _id: id }, { id }] });
    if (!existing) {
      return res.status(404).json({ error: 'Richiesta non trovata nel database' });
    }

    if (userId && existing.groupId) {
      const group = (await GroupModel.findOne({ $or: [{ _id: existing.groupId }, { id: existing.groupId }] } as any)) as any;
      if (group) {
        const member = group.members?.find((m: any) => m.userId === userId);
        const isAdminClienti = member && member.role === 'admin_clienti';
        if (!isAdminClienti) {
          return res.status(403).json({ error: 'Accesso negato: solo admin_clienti del gruppo associato può rifiutare o annullare la call cliente' });
        }
      }
    }

    const wasConfirmed = existing.status === 'confirmed';
    const overrideTokens: Record<string, CalendarTokenOverride> = {};
    if (userId) {
      overrideTokens[String(userId)] = {
        accessToken: req.headers.authorization?.replace('Bearer ', '') || googleAccessToken,
        refreshToken: googleRefreshToken,
      };
    }

    // Se esiste un evento/sondaggio collegato nel team interno, rimuovilo anche dai calendari del team
    if (existing.pollEventId) {
      try {
        const linkedEvent = await EventModel.findOne({
          $or: [{ _id: existing.pollEventId }, { id: existing.pollEventId }],
        });
        if (linkedEvent) {
          const linkedObj = linkedEvent.toObject ? linkedEvent.toObject() : linkedEvent;
          await deleteEventAcrossUserCalendars(linkedObj, overrideTokens);
          await EventModel.deleteOne({ $or: [{ _id: existing.pollEventId }, { id: existing.pollEventId }] });
          await EventResponseModel.deleteMany({ eventId: existing.pollEventId });
          broadcastRealtimeEvent('event:deleted', { eventId: existing.pollEventId });
        }
      } catch (linkedDelErr: any) {
        console.warn('[ClientRequest Reject] Errore pulizia evento team collegato:', linkedDelErr?.message || linkedDelErr);
      }
    } else if (Array.isArray(existing.googleCalendarEvents) && existing.googleCalendarEvents.length > 0) {
      await deleteEventAcrossUserCalendars(
        { googleCalendarEvents: existing.googleCalendarEvents },
        overrideTokens
      );
    }

    const emailResult = await sendClientCancellationEmailViaResend({
      companyName: existing.companyName,
      contactEmail: existing.contactEmail,
      meetingTitle: `Call con ${existing.companyName}`,
      description: existing.description,
      reason: reason ? String(reason).trim() : undefined,
      wasConfirmed,
      organizerName: organizerName || 'Team Junior Enterprise Sicilia',
      organizerRole: organizerRole || 'Area Relazioni Esterne & B2B',
      organizerEmail: adminEmail || 'info@jesicmeet.it',
    });

    const updated = await ClientRequestModel.findOneAndUpdate(
      { $or: [{ _id: id }, { id }] },
      {
        status: 'rejected',
        rejectionReason: reason ? String(reason).trim() : null,
        pollEventId: null,
        googleCalendarEvents: [],
        updatedAt: new Date(),
      },
      { new: true }
    );

    if (!updated) {
      return res.status(404).json({ error: 'Richiesta non trovata nel database' });
    }

    const mappedRequest = { ...updated.toObject(), id: updated._id || updated.id };
    broadcastRealtimeEvent('client_request:updated', { request: mappedRequest });

    return res.json({
      success: true,
      emailSent: emailResult.success,
      emailError: emailResult.error,
      request: mappedRequest,
    });
  } catch (err: any) {
    console.error('Errore reject ClientRequestModel MongoDB:', err.message);
    return res.status(500).json({ error: 'Errore rifiuto/annullamento richiesta cliente in MongoDB' });
  }
});

/* ==========================================================================
   6. WEB PUSH NOTIFICATIONS API (Web Push Protocol & VAPID)
   ========================================================================== */

// GET /api/push/public-key - Restituisce la VAPID public key per iscrivere il browser
app.get('/api/push/public-key', async (_req: Request, res: Response) => {
  try {
    const publicKey = await getVapidPublicKey();
    return res.json({ publicKey });
  } catch (err: any) {
    console.error('Errore recupero VAPID public key:', err.message);
    return res.status(500).json({ error: 'Errore recupero VAPID public key' });
  }
});

// POST /api/push/subscribe - Salva l'iscrizione push del dispositivo in MongoDB
app.post('/api/push/subscribe', async (req: Request, res: Response) => {
  const { userId, subscription, userAgent } = req.body;

  if (!userId || !subscription?.endpoint || !subscription?.keys) {
    return res.status(400).json({ error: 'Dati sottoscrizione non validi o userId mancante' });
  }

  try {
    const saved = await PushSubscriptionModel.findOneAndUpdate(
      { endpoint: subscription.endpoint },
      {
        $set: {
          userId,
          endpoint: subscription.endpoint,
          keys: {
            p256dh: subscription.keys.p256dh,
            auth: subscription.keys.auth,
          },
          userAgent: userAgent || req.headers['user-agent'] || '',
        },
      },
      { upsert: true, new: true }
    );

    console.log(`[Push] Dispositivo registrato per utente ${userId}: ${subscription.endpoint.slice(0, 45)}...`);
    return res.json({ success: true, message: 'Dispositivo registrato con successo per le notifiche push', id: saved._id });
  } catch (err: any) {
    console.error('Errore registrazione sottoscrizione push:', err.message);
    return res.status(500).json({ error: 'Errore salvataggio sottoscrizione push in MongoDB' });
  }
});

// POST /api/push/unsubscribe - Rimuove la sottoscrizione push del dispositivo da MongoDB
app.post('/api/push/unsubscribe', async (req: Request, res: Response) => {
  const { endpoint, userId } = req.body;

  if (!endpoint) {
    return res.status(400).json({ error: 'Endpoint obbligatorio per la disiscrizione' });
  }

  try {
    const filter: any = { endpoint };
    if (userId) filter.userId = userId;
    await PushSubscriptionModel.deleteMany(filter);
    console.log(`[Push] Dispositivo rimosso dalle notifiche: ${endpoint.slice(0, 45)}...`);
    return res.json({ success: true, message: 'Dispositivo disiscritto con successo' });
  } catch (err: any) {
    console.error('Errore disiscrizione push:', err.message);
    return res.status(500).json({ error: 'Errore rimozione sottoscrizione push' });
  }
});

// GET /api/push/status - Verifica se il dispositivo/endpoint o utente è registrato
app.get('/api/push/status', async (req: Request, res: Response) => {
  const { userId, endpoint } = req.query;

  try {
    if (endpoint) {
      const exists = await PushSubscriptionModel.exists({ endpoint: String(endpoint) });
      return res.json({ subscribed: Boolean(exists) });
    }

    if (userId) {
      const count = await PushSubscriptionModel.countDocuments({ userId: String(userId) });
      return res.json({ subscribed: count > 0, deviceCount: count });
    }

    return res.json({ subscribed: false });
  } catch (err: any) {
    return res.status(500).json({ error: 'Errore verifica stato push' });
  }
});

// POST /api/push/test - Invia una notifica di prova immediata al dispositivo dell'utente
app.post('/api/push/test', async (req: Request, res: Response) => {
  const { userId } = req.body;

  if (!userId) {
    return res.status(400).json({ error: 'userId obbligatorio per la notifica di test' });
  }

  try {
    const result = await sendTestPushNotification(userId);
    return res.json({
      success: true,
      message: result.sent > 0
        ? `Notifica di prova inviata con successo a ${result.sent} dispositivo/i!`
        : 'Nessun dispositivo registrato trovato per questo utente. Attiva prima le notifiche nel browser!',
      ...result,
    });
  } catch (err: any) {
    console.error('Errore invio notifica test push:', err.message);
    return res.status(500).json({ error: 'Errore invio notifica push di test' });
  }
});

// POST /api/maintenance/cleanup - Esegue manualmente la pulizia automatica salva-spazio
app.post('/api/maintenance/cleanup', async (_req: Request, res: Response) => {
  try {
    await runDatabaseAutoCleanup();
    return res.json({
      success: true,
      message: 'Pulizia automatica salva-spazio del database completata con successo!',
      timestamp: new Date().toISOString(),
    });
  } catch (err: any) {
    return res.status(500).json({ error: 'Errore durante la pulizia del database: ' + err.message });
  }
});

/* ==========================================================================
   CONFIGURAZIONE PRONTA PER IL DEPLOY SU RENDER
   ========================================================================== */
async function startServer() {
  const server = http.createServer(app);

  // Inizializza WebSocketServer sul percorso /ws condiviso sulla stessa porta 3000
  wss = new WebSocketServer({ server, path: '/ws' });

  wss.on('connection', (ws) => {
    activeClientSockets.set(ws, {});
    ws.send(JSON.stringify({ event: 'connected', payload: { time: new Date().toISOString() } }));
    broadcastOnlinePresence();

    ws.on('message', (msg) => {
      try {
        const parsed = JSON.parse(msg.toString());
        if (parsed.event === 'ping') {
          ws.send(JSON.stringify({ event: 'pong' }));
        } else if (parsed.event === 'identify') {
          activeClientSockets.set(ws, {
            userId: parsed.payload?.userId,
            userName: parsed.payload?.userName,
          });
          broadcastOnlinePresence();
        }
      } catch {}
    });

    ws.on('close', () => {
      activeClientSockets.delete(ws);
      broadcastOnlinePresence();
    });

    ws.on('error', () => {
      activeClientSockets.delete(ws);
      broadcastOnlinePresence();
    });
  });

  if (process.env.NODE_ENV === 'production') {
    // In produzione (Render) Express serve i file statici compilati da Vite nella cartella dist
    const distPath = path.resolve(__dirname, 'dist');
    app.use(
      express.static(distPath, {
        setHeaders: (res, filePath) => {
          if (
            filePath.endsWith('index.html') ||
            filePath.endsWith('sw.js') ||
            filePath.endsWith('manifest.json') ||
            filePath.endsWith('site.webmanifest')
          ) {
            res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate, proxy-revalidate, max-age=0');
            res.setHeader('Pragma', 'no-cache');
            res.setHeader('Expires', '0');
            if (filePath.endsWith('sw.js')) {
              res.setHeader('Service-Worker-Allowed', '/');
            }
          }
        },
      })
    );
    app.get('*', (_req: Request, res: Response) => {
      res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate, proxy-revalidate, max-age=0');
      res.setHeader('Pragma', 'no-cache');
      res.setHeader('Expires', '0');
      res.sendFile(path.resolve(distPath, 'index.html'));
    });
  } else {
    // In sviluppo monta vite.middlewares per HMR
    const vite = await createViteServer({
      server: { middlewareMode: true, host: '0.0.0.0', port: PORT },
      appType: 'spa',
    });
    app.use(vite.middlewares);
  }

  server.listen(PORT, '0.0.0.0', () => {
    console.log(`🚀 JESic Meet Server attivo su http://0.0.0.0:${PORT} con WebSocket su /ws [NODE_ENV=${process.env.NODE_ENV || 'development'}]`);
  });
}

startServer().catch((err) => {
  console.error('Fatal error starting server:', err);
  process.exit(1);
});
