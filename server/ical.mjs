// iCal / .ics subscription feeds (school, sports...). Read-only: fetched and parsed on the server.
import ICAL from 'ical.js';
import * as store from './store.mjs';

const CACHE_MINUTES = 30;
const MAX_BYTES = 5 * 1024 * 1024;

const httpUrl = (u) => u.replace(/^webcal:\/\//i, 'https://');

async function feedText(feed) {
  const key = 'feedcache/' + feed.id;
  const cached = await store.get(key);
  if (cached && cached.url === feed.url && Date.now() - cached.at < CACHE_MINUTES * 60000) return cached.text;
  try {
    const res = await fetch(httpUrl(feed.url), {
      headers: { accept: 'text/calendar, */*' },
      redirect: 'follow',
      signal: AbortSignal.timeout(7000),
    });
    if (!res.ok) throw new Error('status ' + res.status);
    const text = await res.text();
    if (text.length > MAX_BYTES) throw new Error('too big');
    if (!text.includes('BEGIN:VCALENDAR')) throw new Error('not a calendar');
    await store.set(key, { url: feed.url, at: Date.now(), text });
    return text;
  } catch (e) {
    if (cached && cached.url === feed.url) return cached.text; // use the last good copy
    throw e;
  }
}

function timeOut(t) {
  if (!t) return null;
  if (t.isDate) return t.toString().slice(0, 10);
  // A time with no known time zone is "wall clock" time: send it without an offset
  // so the phone shows it as written.
  if (!t.zone || t.zone.tzid === 'floating') return t.toString().slice(0, 19);
  return t.toJSDate().toISOString();
}

function occurrence(feed, item, start, end, i) {
  return {
    id: `ical-${feed.id}-${Buffer.from(item.uid || String(i)).toString('base64url').slice(0, 40)}-${start.toString().replace(/\W/g, '')}`,
    source: 'ical',
    feedId: feed.id,
    feedLabel: feed.label,
    title: item.summary || '(No title)',
    notes: (item.description || '').trim(),
    location: item.location || '',
    allDay: start.isDate,
    start: timeOut(start),
    end: timeOut(end),
    readOnly: true,
  };
}

export function parseFeed(text, feed, fromMs, toMs) {
  const root = new ICAL.Component(ICAL.parse(text));
  for (const tz of root.getAllSubcomponents('vtimezone')) {
    try { ICAL.TimezoneService.register(tz); } catch { /* skip a bad zone */ }
  }
  const masters = [];
  const exceptions = new Map();
  for (const v of root.getAllSubcomponents('vevent')) {
    const ev = new ICAL.Event(v);
    if (v.getFirstPropertyValue('status') === 'CANCELLED') continue;
    if (ev.isRecurrenceException()) {
      if (!exceptions.has(ev.uid)) exceptions.set(ev.uid, []);
      exceptions.get(ev.uid).push(ev);
    } else masters.push(ev);
  }
  const out = [];
  masters.forEach((ev, i) => {
    for (const ex of exceptions.get(ev.uid) || []) { try { ev.relateException(ex); } catch { /* ignore */ } }
    if (!ev.startDate) return;
    if (!ev.isRecurring()) {
      const s = ev.startDate.toJSDate().getTime();
      const e = (ev.endDate || ev.startDate).toJSDate().getTime();
      if (s <= toMs && e >= fromMs) out.push(occurrence(feed, ev, ev.startDate, ev.endDate, i));
      return;
    }
    const it = ev.iterator();
    let next;
    for (let n = 0; n < 5000 && (next = it.next()); n++) {
      if (next.toJSDate().getTime() > toMs) break;
      const d = ev.getOccurrenceDetails(next);
      const endMs = (d.endDate || d.startDate).toJSDate().getTime();
      if (endMs >= fromMs) out.push(occurrence(feed, d.item, d.startDate, d.endDate, i));
    }
  });
  return out;
}

// Returns { events, errors: [feed labels that couldn't load] }
export async function feedEvents(fromMs, toMs) {
  const feeds = (await store.get('feeds')) || [];
  const results = await Promise.all(feeds.map(async (feed) => {
    try {
      return { events: parseFeed(await feedText(feed), feed, fromMs, toMs) };
    } catch (e) {
      console.error('feed failed', feed.label, e.message);
      return { error: feed.label };
    }
  }));
  return {
    events: results.flatMap((r) => r.events || []),
    errors: results.filter((r) => r.error).map((r) => r.error),
  };
}
