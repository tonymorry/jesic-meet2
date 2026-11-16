/**
 * JESic Meet - Integrazione Reale Google Calendar & Google Meet
 * Junior Enterprise Sicilia
 * 
 * Utilizza la libreria ufficiale 'googleapis' (v3) per creare automaticamente
 * eventi con stanza Google Meet reale tramite il Google Refresh Token dell'utente.
 */

import { google } from 'googleapis';

/**
 * Inizializza l'OAuth2Client di Google per la creazione di eventi
 * Leggendo le env vars dinamicamente per evitare problemi di ordine di import ESM prima di dotenv.config().
 */
export function getOAuth2Client(
  refreshTokenOrTokens?:
    | string
    | {
        refreshToken?: string;
        accessToken?: string;
        googleRefreshToken?: string;
        googleAccessToken?: string;
      }
) {
  const clientId =
    process.env.GOOGLE_CLIENT_ID ||
    process.env.VITE_GOOGLE_CLIENT_ID ||
    '';
  const clientSecret = process.env.GOOGLE_CLIENT_SECRET || '';

  const oauth2Client = new google.auth.OAuth2(
    clientId,
    clientSecret,
    'postmessage'
  );

  if (typeof refreshTokenOrTokens === 'string') {
    oauth2Client.setCredentials({
      refresh_token: refreshTokenOrTokens,
    });
  } else if (refreshTokenOrTokens) {
    const rToken = refreshTokenOrTokens.refreshToken || refreshTokenOrTokens.googleRefreshToken;
    const aToken = refreshTokenOrTokens.accessToken || refreshTokenOrTokens.googleAccessToken;
    // Se esiste un refresh_token valido, non passare un access_token potenzialmente scaduto senza expiry_date,
    // altrimenti google-auth-library riusa il vecchio access_token invece di rinnovarlo.
    if (rToken) {
      oauth2Client.setCredentials({ refresh_token: rToken });
    } else if (aToken) {
      oauth2Client.setCredentials({ access_token: aToken });
    }
  }

  return oauth2Client;
}

async function executeWithCalendarAuth<T>(
  tokens: { refreshToken?: string; accessToken?: string },
  operation: (calendar: ReturnType<typeof google.calendar>) => Promise<T>
): Promise<T> {
  const { refreshToken, accessToken } = tokens;

  if (refreshToken) {
    try {
      const oauth2Client = getOAuth2Client({ refreshToken });
      const calendar = google.calendar({ version: 'v3', auth: oauth2Client });
      return await operation(calendar);
    } catch (refreshErr: any) {
      const status = refreshErr?.code || refreshErr?.response?.status;
      const errMsg = String(refreshErr?.message || '');
      const shouldFallbackToAccessToken =
        Boolean(accessToken) &&
        status !== 404 &&
        status !== 410 &&
        !/not found/i.test(errMsg);

      if (shouldFallbackToAccessToken && accessToken) {
        const fallbackClient = getOAuth2Client({ accessToken });
        const fallbackCalendar = google.calendar({ version: 'v3', auth: fallbackClient });
        return await operation(fallbackCalendar);
      }
      throw refreshErr;
    }
  }

  const oauth2Client = getOAuth2Client({ accessToken });
  const calendar = google.calendar({ version: 'v3', auth: oauth2Client });
  return await operation(calendar);
}

export interface CreateGoogleCalendarEventParams {
  googleRefreshToken?: string;
  refreshToken?: string;
  accessToken?: string;
  title: string;
  description?: string;
  date: string; // "YYYY-MM-DD"
  startTime: string; // "HH:mm"
  endTime: string; // "HH:mm"
  isOnline?: boolean;
  location?: string;
  meetLink?: string;
  skipConferenceCreation?: boolean;
  sendUpdates?: 'all' | 'externalOnly' | 'none';
  attendeeEmails?: string[];
}

export interface GoogleCalendarEventResult {
  success: boolean;
  eventId?: string;
  htmlLink?: string;
  meetLink?: string;
  error?: string;
}

/**
 * Converte una data 'YYYY-MM-DD' e un'ora 'HH:mm' nella stringa RFC3339 corretta
 * con l'offset preciso per il fuso orario 'Europe/Rome' (es. +01:00 d'inverno, +02:00 con ora legale).
 * Impedisce a Google Calendar di interpretare l'orario come UTC e spostarlo avanti di 1 o 2 ore.
 */
export function formatRomeDateTimeRFC3339(dateStr: string, timeStr: string): string {
  if (!dateStr) return '';
  const cleanDate = dateStr.trim().split('T')[0];
  const timeParts = (timeStr || '09:00').trim().split(':');
  const h = (timeParts[0] || '09').padStart(2, '0');
  const m = (timeParts[1] || '00').padStart(2, '0');
  const s = (timeParts[2] || '00').padStart(2, '0');
  const cleanTime = `${h}:${m}:${s}`;

  try {
    const refDate = new Date(`${cleanDate}T12:00:00Z`);
    const dtf = new Intl.DateTimeFormat('en-GB', {
      timeZone: 'Europe/Rome',
      timeZoneName: 'longOffset',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
      hour12: false,
    });
    const tzPart = dtf.formatToParts(refDate).find((p) => p.type === 'timeZoneName')?.value;
    const offset = tzPart ? tzPart.replace('GMT', '') : '+01:00';
    return `${cleanDate}T${cleanTime}${offset}`;
  } catch {
    return `${cleanDate}T${cleanTime}+01:00`;
  }
}

/**
 * Crea silente ed automaticamente l'evento su Google Calendar con conferenza Google Meet
 * tramite la vera libreria googleapis (nessun setTimeout né link finti).
 */
export async function createGoogleCalendarEvent(
  params: CreateGoogleCalendarEventParams
): Promise<GoogleCalendarEventResult> {
  const {
    googleRefreshToken,
    refreshToken,
    title,
    description,
    date,
    startTime,
    endTime,
    isOnline = true,
    location,
    meetLink,
    skipConferenceCreation = false,
    sendUpdates,
    attendeeEmails = [],
  } = params;

  const actualRefreshToken = googleRefreshToken || refreshToken;
  const actualAccessToken = params.accessToken;

  if (!actualRefreshToken && !actualAccessToken) {
    console.warn("Token Google assente, evento non inserito in Calendar");
    return {
      success: false,
      error: 'Token Google (refresh_token o access_token) non presente',
    };
  }

  try {
    // Format RFC3339 con offset Europe/Rome esatto per evitare slittamento di 1 ora
    const startDateTime = formatRomeDateTimeRFC3339(date, startTime);
    const endDateTime = formatRomeDateTimeRFC3339(date, endTime);

    const descriptionParts = [
      description || '',
      isOnline && meetLink ? `🔗 Link Google Meet: ${meetLink}` : '',
      'Organizzato tramite JESic Meet (Junior Enterprise Sicilia)',
    ]
      .filter(Boolean)
      .join('\n\n');

    const requestId = `jesic-${Date.now()}-${Math.random().toString(36).substring(2, 6)}`;

    const eventPayload: any = {
      summary: `[JESic] ${title}`,
      description: descriptionParts,
      start: {
        dateTime: startDateTime,
        timeZone: 'Europe/Rome',
      },
      end: {
        dateTime: endDateTime,
        timeZone: 'Europe/Rome',
      },
      location: isOnline ? meetLink || 'Google Meet' : location || 'Sede JESic',
      reminders: {
        useDefault: false,
        overrides: [
          { method: 'email', minutes: 24 * 60 },
          { method: 'popup', minutes: 15 },
        ],
      },
    };

    if (attendeeEmails.length > 0) {
      eventPayload.attendees = attendeeEmails.map((email) => ({ email }));
    }

    const shouldCreateConference = isOnline && !skipConferenceCreation && !meetLink;

    // Parametro obbligatorio per far generare a Google la stanza Meet reale (solo una volta per evento)
    if (shouldCreateConference) {
      eventPayload.conferenceData = {
        createRequest: {
          requestId,
          conferenceSolutionKey: { type: 'hangoutsMeet' },
        },
      };
    }

    const effectiveSendUpdates: 'all' | 'externalOnly' | 'none' =
      sendUpdates ?? (attendeeEmails.length > 0 ? 'all' : 'none');

    const response = await executeWithCalendarAuth(
      { refreshToken: actualRefreshToken, accessToken: actualAccessToken },
      (calendar) =>
        calendar.events.insert({
          calendarId: 'primary',
          conferenceDataVersion: shouldCreateConference ? 1 : 0,
          sendUpdates: effectiveSendUpdates,
          requestBody: eventPayload,
        })
    );

    const data = response.data;
    const realMeetLink =
      data.hangoutLink ||
      data.conferenceData?.entryPoints?.find((ep) => ep.entryPointType === 'video')?.uri ||
      meetLink;

    return {
      success: true,
      eventId: data.id || undefined,
      htmlLink: data.htmlLink || undefined,
      meetLink: realMeetLink || undefined,
    };
  } catch (err: any) {
    console.error('Errore creazione evento Google Calendar:', err.message || err);
    return {
      success: false,
      error: err.message || 'Errore chiamata Google Calendar API',
    };
  }
}

export interface UpdateGoogleCalendarEventData {
  title?: string;
  description?: string;
  date?: string; // "YYYY-MM-DD"
  startTime?: string; // "HH:mm"
  endTime?: string; // "HH:mm"
  isOnline?: boolean;
  location?: string;
  meetLink?: string;
  sendUpdates?: 'all' | 'externalOnly' | 'none';
}

/**
 * Aggiorna data, ora o dettagli di un evento già esistente su Google Calendar.
 */
export async function updateGoogleCalendarEvent(
  refreshTokenOrTokens:
    | string
    | {
        refreshToken?: string;
        accessToken?: string;
        googleRefreshToken?: string;
        googleAccessToken?: string;
      }
    | undefined,
  googleEventId: string,
  eventData: UpdateGoogleCalendarEventData
): Promise<{ success: boolean; eventId?: string; data?: any; error?: string }> {
  let refreshToken: string | undefined;
  let accessToken: string | undefined;

  if (typeof refreshTokenOrTokens === 'string') {
    refreshToken = refreshTokenOrTokens;
  } else if (refreshTokenOrTokens) {
    refreshToken = refreshTokenOrTokens.refreshToken || refreshTokenOrTokens.googleRefreshToken;
    accessToken = refreshTokenOrTokens.accessToken || refreshTokenOrTokens.googleAccessToken;
  }

  if (!refreshToken && !accessToken) {
    console.warn("Token Google assente, evento non aggiornato su Calendar");
    return { success: false, error: 'Google Token non presente' };
  }

  if (!googleEventId) {
    console.warn("googleEventId assente, impossibile aggiornare su Calendar");
    return { success: false, error: 'googleEventId non presente' };
  }

  try {
    const patchBody: any = {};

    if (eventData.title) {
      patchBody.summary = eventData.title.startsWith('[JESic]')
        ? eventData.title
        : `[JESic] ${eventData.title}`;
    }

    if (eventData.description !== undefined || eventData.meetLink) {
      patchBody.description = [
        eventData.description || '',
        eventData.isOnline !== false && eventData.meetLink
          ? `🔗 Link Google Meet: ${eventData.meetLink}`
          : '',
        'Organizzato tramite JESic Meet (Junior Enterprise Sicilia)',
      ]
        .filter(Boolean)
        .join('\n\n');
    }

    if (eventData.date && eventData.startTime && eventData.endTime) {
      patchBody.start = {
        dateTime: formatRomeDateTimeRFC3339(eventData.date, eventData.startTime),
        timeZone: 'Europe/Rome',
      };
      patchBody.end = {
        dateTime: formatRomeDateTimeRFC3339(eventData.date, eventData.endTime),
        timeZone: 'Europe/Rome',
      };
    }

    if (eventData.location !== undefined || eventData.isOnline !== undefined || eventData.meetLink) {
      patchBody.location = eventData.isOnline
        ? eventData.meetLink || 'Google Meet'
        : eventData.location || 'Sede JESic';
    }

    const effectiveSendUpdates: 'all' | 'externalOnly' | 'none' = eventData.sendUpdates ?? 'none';

    const response = await executeWithCalendarAuth(
      { refreshToken, accessToken },
      async (calendar) => {
        try {
          return await calendar.events.patch({
            calendarId: 'primary',
            eventId: googleEventId,
            sendUpdates: effectiveSendUpdates,
            requestBody: patchBody,
          });
        } catch (patchErr: any) {
          const status = patchErr?.code || patchErr?.response?.status;
          if (status === 401 || status === 403 || status === 404 || status === 410) {
            throw patchErr;
          }
          console.warn(
            `Patch con sendUpdates:'${effectiveSendUpdates}' non riuscito, ritento senza sendUpdates:`,
            patchErr?.message
          );
          return await calendar.events.patch({
            calendarId: 'primary',
            eventId: googleEventId,
            requestBody: patchBody,
          });
        }
      }
    );

    return {
      success: true,
      eventId: response.data.id || googleEventId,
      data: response.data,
    };
  } catch (err: any) {
    console.error('Errore aggiornamento evento Google Calendar:', err.message || err);
    return {
      success: false,
      error: err.message || 'Errore chiamata Google Calendar patch API',
    };
  }
}

/**
 * Elimina definitivamente un evento da Google Calendar tramite googleEventId.
 */
export async function deleteGoogleCalendarEvent(
  refreshTokenOrTokens:
    | string
    | {
        refreshToken?: string;
        accessToken?: string;
        googleRefreshToken?: string;
        googleAccessToken?: string;
      }
    | undefined,
  googleEventId: string
): Promise<{ success: boolean; error?: string }> {
  let refreshToken: string | undefined;
  let accessToken: string | undefined;

  if (typeof refreshTokenOrTokens === 'string') {
    refreshToken = refreshTokenOrTokens;
  } else if (refreshTokenOrTokens) {
    refreshToken = refreshTokenOrTokens.refreshToken || refreshTokenOrTokens.googleRefreshToken;
    accessToken = refreshTokenOrTokens.accessToken || refreshTokenOrTokens.googleAccessToken;
  }

  if (!refreshToken && !accessToken) {
    console.warn("Token Google assente, evento non cancellato da Calendar");
    return { success: false, error: 'Token Google non presente' };
  }

  if (!googleEventId) {
    console.warn("googleEventId assente, impossibile cancellare da Calendar");
    return { success: false, error: 'googleEventId non presente' };
  }

  try {
    await executeWithCalendarAuth({ refreshToken, accessToken }, (calendar) =>
      calendar.events.delete({
        calendarId: 'primary',
        eventId: googleEventId,
      })
    );

    return { success: true };
  } catch (err: any) {
    const status = err?.code || err?.response?.status;
    if (status === 404 || status === 410 || /not found|deleted/i.test(String(err?.message || ''))) {
      return { success: true };
    }
    console.error('Errore cancellazione evento Google Calendar:', err.message || err);
    return {
      success: false,
      error: err.message || 'Errore chiamata Google Calendar delete API',
    };
  }
}

export const GOOGLE_CALENDAR_BACKEND_CODE = `
import { google } from 'googleapis';

const oauth2Client = new google.auth.OAuth2(
  process.env.GOOGLE_CLIENT_ID,
  process.env.GOOGLE_CLIENT_SECRET,
  'postmessage'
);

export async function createGoogleCalendarEvent(params) {
  if (!params.googleRefreshToken) {
    console.warn("Token Google assente, evento non inserito in Calendar");
    return { success: false, error: 'Token assente' };
  }

  oauth2Client.setCredentials({ refresh_token: params.googleRefreshToken });
  const calendar = google.calendar({ version: 'v3', auth: oauth2Client });

  const res = await calendar.events.insert({
    calendarId: 'primary',
    conferenceDataVersion: 1,
    requestBody: {
      summary: '[JESic] ' + params.title,
      start: { dateTime: new Date(params.date + 'T' + params.startTime + ':00').toISOString(), timeZone: 'Europe/Rome' },
      end: { dateTime: new Date(params.date + 'T' + params.endTime + ':00').toISOString(), timeZone: 'Europe/Rome' },
      conferenceData: {
        createRequest: {
          requestId: 'jesic-' + Date.now(),
          conferenceSolutionKey: { type: 'hangoutsMeet' }
        }
      }
    }
  });

  return {
    success: true,
    eventId: res.data.id,
    meetLink: res.data.hangoutLink
  };
}

export async function updateGoogleCalendarEvent(refreshToken, googleEventId, eventData) {
  oauth2Client.setCredentials({ refresh_token: refreshToken });
  const calendar = google.calendar({ version: 'v3', auth: oauth2Client });
  return calendar.events.patch({
    calendarId: 'primary',
    eventId: googleEventId,
    requestBody: {
      summary: eventData.title ? '[JESic] ' + eventData.title : undefined,
      start: eventData.date ? { dateTime: new Date(eventData.date + 'T' + eventData.startTime + ':00').toISOString(), timeZone: 'Europe/Rome' } : undefined,
      end: eventData.date ? { dateTime: new Date(eventData.date + 'T' + eventData.endTime + ':00').toISOString(), timeZone: 'Europe/Rome' } : undefined,
    }
  });
}

export async function deleteGoogleCalendarEvent(refreshToken, googleEventId) {
  oauth2Client.setCredentials({ refresh_token: refreshToken });
  const calendar = google.calendar({ version: 'v3', auth: oauth2Client });
  return calendar.events.delete({ calendarId: 'primary', eventId: googleEventId });
}
`;
