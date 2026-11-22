// Google Calendar: OAuth connection + reading/writing events on ONE named calendar only
// (the name is set in Settings > Google Calendar, saved in the household settings).
// The client ID/secret live in Netlify environment variables. Tokens live server-side in the store.
import * as store from './store.mjs';

const AUTH_URL = 'https://accounts.google.com/o/oauth2/v2/auth';
const TOKEN_URL = 'https://oauth2.googleapis.com/token';
const API = 'https://www.googleapis.com/calendar/v3';
const SCOPES = [
  'https://www.googleapis.com/auth/calendar.calendarlist.readonly', // to find the family calendar by name
  'https://www.googleapis.com/auth/calendar.events', // to read/add/edit/delete its events
].join(' ');

export class GoogleError extends Error {
  constructor(status, error, message) { super(message); Object.assign(this, { status, error, extra: {}, expose: true }); }
}

export const configured = () => !!(process.env.GOOGLE_CLIENT_ID && process.env.GOOGLE_CLIENT_SECRET);

export function authUrl(redirectUri, state) {
  const p = new URLSearchParams({
    client_id: process.env.GOOGLE_CLIENT_ID,
    redirect_uri: redirectUri,
    response_type: 'code',
    scope: SCOPES,
    access_type: 'offline',
    prompt: 'consent',
    state,
  });
  return `${AUTH_URL}?${p}`;
}

async function tokenRequest(params) {
  const res = await fetch(TOKEN_URL, {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      client_id: process.env.GOOGLE_CLIENT_ID,
      client_secret: process.env.GOOGLE_CLIENT_SECRET,
      ...params,
    }),
    signal: AbortSignal.timeout(8000),
  });
  const data = await res.json().catch(() => ({}));
  return { ok: res.ok, data };
}

// Called once when an adult connects. Finds the calendar with that name and saves the connection.
export async function connect(code, redirectUri, personId, calendarName) {
  const want = String(calendarName || '').trim().toLowerCase();
  const { ok, data } = await tokenRequest({ code, redirect_uri: redirectUri, grant_type: 'authorization_code' });
  if (!ok || !data.refresh_token) throw new GoogleError(502, 'google_token', 'Google did not finish the sign-in. Try connecting again.');
  const token = data.access_token;
  let pageToken = '';
  let found = null;
  do {
    const res = await fetch(`${API}/users/me/calendarList?maxResults=250${pageToken ? `&pageToken=${pageToken}` : ''}`, {
      headers: { authorization: `Bearer ${token}` }, signal: AbortSignal.timeout(8000),
    });
    const list = await res.json();
    if (!res.ok) throw new GoogleError(502, 'google_list', "Couldn't read the list of calendars from Google.");
    found = (list.items || []).find((c) =>
      [c.summary, c.summaryOverride].some((n) => (n || '').trim().toLowerCase() === want));
    pageToken = list.nextPageToken || '';
  } while (!found && pageToken);
  if (!found) throw new GoogleError(404, 'not_found', 'not_found');
  if (!['owner', 'writer'].includes(found.accessRole)) throw new GoogleError(403, 'read_only', 'read_only');
  await store.set('google', {
    refreshToken: data.refresh_token,
    accessToken: token,
    expiresAt: Date.now() + (data.expires_in || 3000) * 1000,
    calendarId: found.id,
    calendarName: found.summaryOverride || found.summary,
    timeZone: found.timeZone || 'America/New_York',
    connectedBy: personId,
    connectedAt: Date.now(),
  });
}

export async function status() {
  const g = await store.get('google');
  return {
    configured: configured(),
    connected: !!g && !g.broken,
    needsReconnect: !!g?.broken,
    calendarName: g?.calendarName || null,
    timeZone: g?.timeZone || null,
  };
}

export async function disconnect() {
  const g = await store.get('google');
  if (g?.refreshToken) {
    // best effort: also tell Google to forget the permission
    await fetch(`https://oauth2.googleapis.com/revoke?token=${encodeURIComponent(g.refreshToken)}`, { method: 'POST', signal: AbortSignal.timeout(5000) }).catch(() => {});
  }
  await store.del('google');
}

async function conn() {
  const g = await store.get('google');
  if (!g) throw new GoogleError(409, 'not_connected', 'Google Calendar is not connected yet.');
  if (g.broken) throw new GoogleError(409, 'reconnect', 'Google Calendar needs to be reconnected — an adult can do it in Settings.');
  if (g.expiresAt > Date.now() + 60000) return g;
  const { ok, data } = await tokenRequest({ refresh_token: g.refreshToken, grant_type: 'refresh_token' });
  if (!ok) {
    if (data.error === 'invalid_grant') {
      await store.set('google', { ...g, broken: true });
      throw new GoogleError(409, 'reconnect', 'Google Calendar needs to be reconnected — an adult can do it in Settings.');
    }
    throw new GoogleError(502, 'google_down', "Couldn't reach Google Calendar — check your connection and try again.");
  }
  const fresh = { ...g, accessToken: data.access_token, expiresAt: Date.now() + (data.expires_in || 3000) * 1000 };
  await store.set('google', fresh);
  return fresh;
}

// Every call uses the saved calendarId — there is no way to write anywhere else.
async function call(method, path, { query, body } = {}) {
  const g = await conn();
  const url = `${API}/calendars/${encodeURIComponent(g.calendarId)}/events${path}${query ? `?${new URLSearchParams(query)}` : ''}`;
  let res;
  try {
    res = await fetch(url, {
      method,
      headers: { authorization: `Bearer ${g.accessToken}`, ...(body ? { 'content-type': 'application/json' } : {}) },
      body: body ? JSON.stringify(body) : undefined,
      signal: AbortSignal.timeout(8000),
    });
  } catch {
    throw new GoogleError(502, 'google_down', "Couldn't reach Google Calendar — check your connection and try again.");
  }
  if (res.status === 204) return { g, data: null };
  const data = await res.json().catch(() => ({}));
  if (res.status === 404 || res.status === 410) throw new GoogleError(404, 'gone', 'That event is no longer on the calendar.');
  if (!res.ok) throw new GoogleError(502, 'google_error', "Google Calendar didn't accept that — try again in a moment.");
  return { g, data };
}

const stripHtml = (s) => String(s || '').replace(/<br\s*\/?>/gi, '\n').replace(/<[^>]+>/g, '').replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').trim();

function toEvent(e) {
  const allDay = !!e.start?.date;
  return {
    id: e.id,
    source: 'google',
    title: e.summary || '(No title)',
    notes: stripHtml(e.description),
    location: e.location || '',
    allDay,
    start: allDay ? e.start.date : e.start?.dateTime,
    end: allDay ? e.end?.date : e.end?.dateTime,
    recurring: !!e.recurringEventId,
    addedBy: e.extendedProperties?.private?.chqBy || null,
  };
}

export async function listEvents(timeMin, timeMax) {
  const out = [];
  let pageToken;
  for (let i = 0; i < 5; i++) {
    const { data } = await call('GET', '', {
      query: { timeMin, timeMax, singleEvents: 'true', orderBy: 'startTime', maxResults: '250', ...(pageToken ? { pageToken } : {}) },
    });
    out.push(...(data.items || []).filter((e) => e.status !== 'cancelled').map(toEvent));
    pageToken = data.nextPageToken;
    if (!pageToken) break;
  }
  return out;
}

function addDays(d, n) { const [y, m, dd] = d.split('-').map(Number); return new Date(Date.UTC(y, m - 1, dd + n)).toISOString().slice(0, 10); }

// Builds Google's start/end from the app's simple form (date, optional times).
function times({ date, allDay, time, endTime }, tz) {
  if (allDay) return { start: { date }, end: { date: addDays(date, 1) } };
  const [h, m] = time.split(':').map(Number);
  let endDate = date;
  let end = endTime;
  if (!end || end <= time) {
    let mins = h * 60 + m + 60;
    if (mins >= 1440) { mins -= 1440; endDate = addDays(date, 1); }
    end = `${String(Math.floor(mins / 60)).padStart(2, '0')}:${String(mins % 60).padStart(2, '0')}`;
  }
  return {
    start: { dateTime: `${date}T${time}:00`, timeZone: tz },
    end: { dateTime: `${endDate}T${end}:00`, timeZone: tz },
  };
}

export async function addEvent(ev, personId) {
  const g = await conn();
  const { data } = await call('POST', '', {
    body: {
      summary: ev.title,
      description: ev.notes || undefined,
      ...times(ev, g.timeZone),
      extendedProperties: { private: { chqBy: personId } },
    },
  });
  return toEvent(data);
}

export async function updateEvent(id, ev) {
  const g = await conn();
  const { data } = await call('PATCH', `/${encodeURIComponent(id)}`, {
    body: { summary: ev.title, description: ev.notes || '', ...times(ev, g.timeZone) },
  });
  return toEvent(data);
}

export async function deleteEvent(id) {
  await call('DELETE', `/${encodeURIComponent(id)}`);
}
