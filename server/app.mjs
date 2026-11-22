// Family HQ API. One handler for every /api/* request.
// Runs as a Netlify Function in production and inside dev-server.mjs locally.
import * as store from './store.mjs';
import { hashCode, verifyCode, newToken, sha256, randomId } from './codes.mjs';
import { SEED_PEOPLE, SEED_CHECKLISTS, SEED_CHART, DEFAULT_HOUSEHOLD } from './seed.mjs';
import * as google from './google.mjs';
import { feedEvents } from './ical.mjs';
import { migrate } from './migrations.mjs';
import { VERSION, updateInfo } from './version.mjs';
import { notify, vapid, subKey, allSubs, prefsFor, PREF_DEFAULTS } from './push.mjs';

const SESSION_HOURS = 12;
const MAX_TRIES = 5;
const LOCK_MINUTES = 5;

// ---------- helpers ----------
class HttpError extends Error {
  constructor(status, error, message, extra = {}) {
    super(message);
    Object.assign(this, { status, error, extra });
  }
}
const fail = (status, error, message, extra) => { throw new HttpError(status, error, message, extra); };
const json = (data, status = 200) =>
  new Response(JSON.stringify(data), {
    status,
    headers: { 'content-type': 'application/json', 'cache-control': 'no-store', 'x-robots-tag': 'noindex' },
  });

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const ID_RE = /^[a-z0-9-]{1,60}$/;
function date(d) { if (!DATE_RE.test(d || '')) fail(400, 'bad_date', "That date doesn't look right."); return d; }
function cid(id) { if (!ID_RE.test(id || '')) fail(400, 'bad_id', "Couldn't find that chore."); return id; }
function weekday(d) { const [y, m, dd] = d.split('-').map(Number); return (new Date(Date.UTC(y, m - 1, dd)).getUTCDay() + 6) % 7; }
function addDays(d, n) { const [y, m, dd] = d.split('-').map(Number); return new Date(Date.UTC(y, m - 1, dd + n)).toISOString().slice(0, 10); }
function text(v, max, label) {
  const s = String(v ?? '').trim();
  if (!s) fail(400, 'missing', `Please fill in ${label}.`);
  if (s.length > max) fail(400, 'too_long', `${label[0].toUpperCase() + label.slice(1)} is too long (max ${max} characters).`);
  return s;
}
function lines(arr, maxItems = 20, maxLen = 120) {
  if (!Array.isArray(arr)) return [];
  return arr.map((s) => String(s ?? '').trim()).filter(Boolean).slice(0, maxItems).map((s) => s.slice(0, maxLen));
}
const validPin = (c) => /^\d{4}$/.test(String(c ?? ''));

const baseUrl = (req) => (process.env.CHQ_BASE_URL || new URL(req.url).origin).replace(/\/$/, '');

// ---------- data ----------
async function seeded(key, seed) {
  let v = await store.get(key);
  if (!v) { v = structuredClone(seed); await store.set(key, v); }
  return v;
}
const getPeople = () => seeded('people', SEED_PEOPLE);
const getChart = () => seeded('chart', SEED_CHART);
const getChecklists = () => seeded('checklists', SEED_CHECKLISTS);
const getHousehold = async () => {
  const h = (await store.get('household')) || {};
  return { ...DEFAULT_HOUSEHOLD, ...h, notify: { ...DEFAULT_HOUSEHOLD.notify, ...(h.notify || {}) } };
};

const slugify = (name) => name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 20) || 'person';
function uniqueId(name, taken) {
  const slug = slugify(name);
  return taken.has(slug) ? `${slug}-${randomId().slice(-4)}` : slug;
}

// Job names + checklists: { "Kitchen": ["Wipe the table", ...], ... }
function cleanChecklists(obj) {
  if (!obj || typeof obj !== 'object' || Array.isArray(obj)) fail(400, 'bad_jobs', "That list of jobs doesn't look right.");
  const out = {};
  const entries = Object.entries(obj);
  if (entries.length > 40) fail(400, 'too_many', 'That’s a lot of jobs — keep it to 40 or fewer.');
  for (const [k, v] of entries) {
    const name = text(k, 60, 'the job name');
    if (Object.keys(out).some((x) => x.toLowerCase() === name.toLowerCase())) fail(409, 'dupe', `There are two jobs called “${name}”.`);
    out[name] = lines(v, 20, 120);
  }
  return out;
}

// One chart slot from the editor or setup. personId must already be resolved.
const cleanSlot = (s, ids) => {
  if (!ids.has(s.personId)) fail(400, 'bad_person', 'Every job needs a person.');
  return {
    id: ID_RE.test(s.id || '') ? s.id : 'c' + randomId(),
    personId: s.personId,
    job: text(s.job, 80, 'the job name'),
    extras: lines(s.extras, 5, 80),
    quick: !!s.quick,
  };
};

async function findPerson(id) {
  const p = (await getPeople()).find((x) => x.id === id);
  if (!p) fail(404, 'no_person', "Couldn't find that name.");
  return p;
}

// ---------- sign-in ----------
async function auth(req) {
  const h = req.headers.get('authorization') || '';
  const t = h.startsWith('Bearer ') ? h.slice(7) : '';
  if (!t) fail(401, 'session', 'Please sign in again.');
  const s = await store.get('session/' + sha256(t));
  if (!s || s.expires < Date.now()) fail(401, 'session', 'Please sign in again.');
  const me = (await getPeople()).find((p) => p.id === s.personId);
  if (!me) fail(401, 'session', 'Please sign in again.');
  return me;
}
const adultOnly = (me) => { if (me.role !== 'adult') fail(403, 'adult_only', 'Only an adult can do that.'); };

async function startSession(person) {
  const token = newToken();
  await store.set('session/' + sha256(token), {
    personId: person.id,
    created: Date.now(),
    expires: Date.now() + SESSION_HOURS * 3600e3,
  });
  return { token, person };
}

async function endSessionsFor(personId) {
  const keys = await store.list('session/');
  for (const k of keys) {
    const s = await store.get(k);
    if (!s || s.personId === personId || s.expires < Date.now()) await store.del(k);
  }
}

// Checks a code and applies the 5-tries / 5-minute lock.
async function checkCode(person, code) {
  const key = 'attempts/' + person.id;
  const a = (await store.get(key)) || { count: 0, lockedUntil: 0 };
  if (a.lockedUntil > Date.now()) {
    const mins = Math.ceil((a.lockedUntil - Date.now()) / 60000);
    fail(423, 'locked', `Too many tries. ${person.name} is locked for ${mins} more minute${mins === 1 ? '' : 's'}.`);
  }
  const rec = await store.get('code/' + person.id);
  if (!rec) fail(409, 'needs_setup', `${person.name} needs to create a code first.`);
  if (validPin(code) && verifyCode(code, rec)) {
    if (a.count || a.lockedUntil) await store.set(key, { count: 0, lockedUntil: 0 });
    return;
  }
  a.count += 1;
  if (a.count >= MAX_TRIES) {
    await store.set(key, { count: 0, lockedUntil: Date.now() + LOCK_MINUTES * 60000 });
    fail(423, 'locked', `Too many wrong tries. ${person.name} is locked for ${LOCK_MINUTES} minutes.`);
  }
  await store.set(key, a);
  fail(401, 'wrong_code', "That's not right — try again.", { triesLeft: MAX_TRIES - a.count });
}

// ---------- chores ----------
function slotToChore(slot, d, checklists) {
  return {
    id: slot.id,
    date: d,
    personId: slot.personId,
    job: slot.job,
    checklist: [...(checklists[slot.job] || []), ...(slot.extras || [])],
    quick: !!slot.quick,
    oneOff: false,
    status: 'not_done',
  };
}

async function choresFor(d) {
  const [chart, checklists, keys] = await Promise.all([getChart(), getChecklists(), store.list(`chore/${d}/`)]);
  const byId = new Map((await store.getMany(keys)).map((r) => [r.id, r]));
  const out = [];
  if (d >= chart.startDate) {
    for (const slot of chart.days[weekday(d)] || []) {
      const rec = byId.get(slot.id);
      byId.delete(slot.id);
      const c = rec || slotToChore(slot, d, checklists);
      if (!c.removed) out.push(c);
    }
  }
  for (const r of byId.values()) if (!r.removed) out.push(r);
  return out;
}

async function getChore(d, id) {
  const rec = await store.get(`chore/${d}/${id}`);
  if (rec) return rec;
  const chart = await getChart();
  if (d < chart.startDate) return null;
  const slot = (chart.days[weekday(d)] || []).find((s) => s.id === id);
  return slot ? slotToChore(slot, d, await getChecklists()) : null;
}
async function mustGetChore(d, id) {
  const c = await getChore(date(d), cid(id));
  if (!c || c.removed) fail(404, 'no_chore', "Couldn't find that chore — it may have been changed.");
  return c;
}
const saveChore = (c) => store.set(`chore/${c.date}/${c.id}`, c);
const queueKey = (c) => `queue/${c.date}/${c.id}`;

// Kids who have no regular (non-quick) job in the chart that day.
function offFor(d, chart, people) {
  if (d < chart.startDate) return [];
  const busy = new Set((chart.days[weekday(d)] || []).filter((s) => !s.quick).map((s) => s.personId));
  return people.filter((p) => p.role === 'kid' && !busy.has(p.id)).map((p) => p.id);
}

async function reviewQueue() {
  const keys = await store.list('queue/');
  const marks = await store.getMany(keys);
  const chores = (await Promise.all(marks.map((m) => getChore(m.date, m.id))))
    .filter((c) => c && !c.removed && c.status === 'submitted');
  return chores.sort((a, b) => (b.submittedAt || 0) - (a.submittedAt || 0));
}

// ---------- groceries ----------
const invTs = (t) => String(9999999999999 - t).padStart(13, '0');
async function openGroceries() {
  const items = await store.getMany(await store.list('grocery/open/'));
  return items.sort((a, b) => a.addedAt - b.addedAt);
}
async function boughtGroceries(limit = 40) {
  const keys = (await store.list('grocery/bought/')).slice(0, limit);
  return store.getMany(keys);
}

// ---------- notifications ----------
const TIME_RE = /^([01]\d|2[0-3]):[0-5]\d$/;
const toMin = (t) => { const [h, m] = t.split(':').map(Number); return h * 60 + m; };
const jobList = (cs) => [...new Set(cs.map((c) => c.job))].join(', ');

// Today's date and the time right now, in the family's time zone.
function localNow(nowMs, timeZone) {
  const parts = Object.fromEntries(new Intl.DateTimeFormat('en-CA', {
    timeZone, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hourCycle: 'h23',
  }).formatToParts(new Date(nowMs)).map((p) => [p.type, p.value]));
  return { date: `${parts.year}-${parts.month}-${parts.day}`, minutes: Number(parts.hour) * 60 + Number(parts.minute) };
}

// Runs every 15 minutes (netlify/functions/reminders.mjs). Sends "chore time" and the
// later "still to do" nudge once per person per day. A reminder that's more than
// 2 hours late (e.g. the schedule was paused) is skipped rather than sent at bedtime.
export async function runReminders(nowMs = Date.now()) {
  await migrate();
  const h = await getHousehold();
  if (!h.setupDone || !h.notify?.on) return { sent: 0 };
  let tz = h.notify.timeZone;
  try { new Intl.DateTimeFormat('en-US', { timeZone: tz }); } catch { tz = 'America/New_York'; }
  const now = localNow(nowMs, tz);
  const chores = await choresFor(now.date);
  let sent = 0;
  for (const [kind, time] of [['chores', h.notify.choreTime], ['nudge', h.notify.nudgeTime]]) {
    if (!TIME_RE.test(time || '')) continue;
    const late = now.minutes - toMin(time);
    if (late < 0 || late > 120) continue;
    const byPerson = new Map();
    for (const c of chores) {
      if (kind === 'nudge' && !['not_done', 'redo'].includes(c.status)) continue;
      byPerson.set(c.personId, [...(byPerson.get(c.personId) || []), c]);
    }
    for (const [personId, cs] of byPerson) {
      const mark = `push/sent/${now.date}/${kind}/${personId}`;
      if (await store.get(mark)) continue;
      await store.set(mark, { at: nowMs });
      const name = (await getPeople()).find((p) => p.id === personId)?.name || '';
      sent += await notify([personId], kind, kind === 'chores'
        ? { title: `Chore time${name ? ', ' + name : ''}!`, body: `Tonight: ${jobList(cs)}`, url: '/#/home', tag: 'chores' }
        : { title: `Still to do: ${jobList(cs)}`, body: 'Tick it off and send it for review.', url: '/#/home', tag: 'chores' });
    }
  }
  // tidy up old "already sent" marks
  for (const k of (await store.list('push/sent/')).filter((k) => k.slice(10, 20) < now.date)) await store.del(k);
  return { sent };
}

// ---------- router ----------
export async function handle(req) {
  try {
    const url = new URL(req.url);
    const route = req.method + ' ' + url.pathname.replace(/^\/(\.netlify\/functions\/)?api/, '').replace(/\/$/, '');
    const q = (k) => url.searchParams.get(k);
    const body = req.method === 'POST' ? await req.json().catch(() => ({})) : {};
    await migrate();
    const res = await routes(route, req, q, body);
    if (res === undefined) fail(404, 'not_found', 'Not found.');
    return res instanceof Response ? res : json(res);
  } catch (e) {
    if (e instanceof HttpError || e.expose) return json({ error: e.error, message: e.message, ...e.extra }, e.status);
    console.error(e);
    return json({ error: 'server', message: 'Something went wrong on our end — try again in a moment.' }, 500);
  }
}

async function routes(route, req, q, body) {
  switch (route) {
    // ----- household + first-run setup -----
    case 'GET /config': {
      // Public: the sign-in screen needs the household name and whether setup is done.
      const h = await getHousehold();
      return { name: h.name, setupDone: h.setupDone, version: VERSION };
    }
    case 'POST /setup': {
      // Only works once, on a brand-new install with nobody in it yet.
      const h = await getHousehold();
      if (h.setupDone || (await getPeople()).length) fail(409, 'already_setup', 'This app is already set up. Sign in instead.');
      const name = text(body.household, 40, 'your household name');
      if (!Array.isArray(body.people) || !body.people.length) fail(400, 'no_people', 'Add at least one person.');
      if (body.people.length > 20) fail(400, 'too_many', 'Keep it to 20 people or fewer.');
      const taken = new Set();
      const seen = new Set();
      const people = body.people.map((p) => {
        const pn = text(p?.name, 30, 'a name');
        if (seen.has(pn.toLowerCase())) fail(409, 'dupe', `${pn} is on the list twice.`);
        seen.add(pn.toLowerCase());
        const id = uniqueId(pn, taken);
        taken.add(id);
        return { id, name: pn, role: p.role === 'adult' ? 'adult' : 'kid' };
      });
      if (!people.some((p) => p.role === 'adult')) fail(400, 'no_adult', 'At least one person needs to be an adult — adults review chores and change settings.');
      const checklists = cleanChecklists(body.jobs || {});
      // Chart slots name people by NAME (that's what the setup screen and the Claude skill know).
      const byName = new Map(people.map((p) => [p.name.toLowerCase(), p.id]));
      const ids = new Set(people.map((p) => p.id));
      const rawDays = Array.isArray(body.days) && body.days.length === 7 ? body.days : [[], [], [], [], [], [], []];
      const days = rawDays.map((day) => (Array.isArray(day) ? day : []).slice(0, 30).map((s) => {
        const personId = byName.get(String(s?.who || '').trim().toLowerCase());
        if (!personId) fail(400, 'bad_person', `The chart mentions “${s?.who || '?'}”, who isn’t on the list of people.`);
        return cleanSlot({ ...s, personId }, ids);
      }));
      const startDate = DATE_RE.test(body.startDate || '') ? body.startDate : new Date().toISOString().slice(0, 10);
      await store.set('people', people);
      await store.set('checklists', checklists);
      await store.set('chart', { startDate, days });
      let timeZone = h.notify.timeZone;
      try { if (body.timeZone) { new Intl.DateTimeFormat('en-US', { timeZone: body.timeZone }); timeZone = body.timeZone; } } catch { /* keep default */ }
      await store.set('household', { ...h, name, setupDone: true, setupAt: Date.now(), notify: { ...h.notify, timeZone } });
      return { ok: true };
    }
    case 'POST /household': {
      const me = await auth(req);
      adultOnly(me);
      const h = await getHousehold();
      if (body.name !== undefined) h.name = text(body.name, 40, 'your household name');
      if (body.calendarName !== undefined) h.calendarName = text(body.calendarName, 80, 'the calendar name');
      await store.set('household', h);
      return { ok: true, name: h.name, calendarName: h.calendarName };
    }
    case 'GET /household': {
      await auth(req);
      const h = await getHousehold();
      return { name: h.name, calendarName: h.calendarName };
    }
    // ----- notifications -----
    case 'GET /push/key': {
      await auth(req);
      return { publicKey: (await vapid()).publicKey };
    }
    case 'POST /push/subscribe': {
      const me = await auth(req);
      const s = body.subscription || {};
      let ok = false;
      try { ok = new URL(s.endpoint).protocol === 'https:'; } catch { /* not a URL */ }
      if (!ok || !s.keys?.p256dh || !s.keys?.auth) fail(400, 'bad_sub', 'This phone didn’t give us what we need for notifications. Try again.');
      // one phone = one person: signing up again on a shared phone moves it to whoever is signed in
      await store.set(subKey(s.endpoint), {
        endpoint: String(s.endpoint).slice(0, 1000),
        keys: { p256dh: String(s.keys.p256dh).slice(0, 200), auth: String(s.keys.auth).slice(0, 100) },
        personId: me.id,
        createdAt: Date.now(),
      });
      return { ok: true };
    }
    case 'POST /push/unsubscribe': {
      await auth(req);
      if (body.endpoint) await store.del(subKey(String(body.endpoint)));
      return { ok: true };
    }
    case 'GET /push/status': {
      const me = await auth(req);
      const ep = q('endpoint');
      const subs = await allSubs();
      const h = await getHousehold();
      return {
        thisPhone: ep ? (subs.find((s) => s.endpoint === ep)?.personId || null) : null,
        phones: subs.filter((s) => s.personId === me.id).length,
        prefs: await prefsFor(me.id),
        notify: h.notify,
      };
    }
    case 'POST /push/prefs': {
      const me = await auth(req);
      const prefs = await prefsFor(me.id);
      for (const k of Object.keys(PREF_DEFAULTS)) if (typeof body[k] === 'boolean') prefs[k] = body[k];
      await store.set('push/prefs/' + me.id, prefs);
      return { prefs };
    }
    case 'POST /push/test': {
      const me = await auth(req);
      const n = await notify([me.id], 'test', { title: 'It works! 🔔', body: `Notifications are on for ${me.name}.`, url: '/#/settings/notify', tag: 'test' });
      if (!n) fail(409, 'no_phones', 'Couldn’t reach any of your phones. Turn notifications off and on again on this phone.');
      return { sent: n };
    }
    case 'POST /notify-settings': {
      const me = await auth(req);
      adultOnly(me);
      const h = await getHousehold();
      const n = { ...h.notify };
      if (typeof body.on === 'boolean') n.on = body.on;
      if (body.choreTime !== undefined) {
        if (!TIME_RE.test(body.choreTime)) fail(400, 'bad_time', 'Pick a time for the chore reminder.');
        n.choreTime = body.choreTime;
      }
      if (body.nudgeTime !== undefined) {
        if (body.nudgeTime && !TIME_RE.test(body.nudgeTime)) fail(400, 'bad_time', 'That reminder time doesn’t look right.');
        n.nudgeTime = body.nudgeTime || '';
      }
      if (body.timeZone !== undefined) {
        try { new Intl.DateTimeFormat('en-US', { timeZone: String(body.timeZone) }); } catch { fail(400, 'bad_zone', 'That time zone doesn’t look right.'); }
        n.timeZone = String(body.timeZone);
      }
      await store.set('household', { ...h, notify: n });
      return { notify: n };
    }

    case 'GET /version': {
      const me = await auth(req);
      adultOnly(me);
      return updateInfo();
    }

    // ----- people + codes -----
    case 'GET /people': {
      const people = await getPeople();
      const codes = new Set((await store.list('code/')).map((k) => k.slice(5)));
      return people.map((p) => ({ ...p, hasCode: codes.has(p.id) }));
    }
    case 'POST /setup-code': {
      const person = await findPerson(body.personId);
      if (!validPin(body.code)) fail(400, 'bad_code', 'Your code needs to be 4 numbers.');
      if (await store.get('code/' + person.id)) fail(409, 'has_code', `${person.name} already has a code. Enter it to sign in.`);
      await store.set('code/' + person.id, hashCode(body.code));
      await store.set('attempts/' + person.id, { count: 0, lockedUntil: 0 });
      return startSession(person);
    }
    case 'POST /login': {
      const person = await findPerson(body.personId);
      await checkCode(person, body.code);
      return startSession(person);
    }
    case 'POST /logout': {
      const h = req.headers.get('authorization') || '';
      if (h.startsWith('Bearer ')) await store.del('session/' + sha256(h.slice(7)));
      return { ok: true };
    }
    case 'GET /me':
      return { person: await auth(req) };
    case 'POST /change-code': {
      const me = await auth(req);
      await checkCode(me, body.oldCode);
      if (!validPin(body.newCode)) fail(400, 'bad_code', 'Your new code needs to be 4 numbers.');
      await store.set('code/' + me.id, hashCode(body.newCode));
      return { ok: true };
    }
    case 'POST /reset-code': {
      const me = await auth(req);
      adultOnly(me);
      const person = await findPerson(body.personId);
      await checkCode(me, body.adultCode); // the adult proves who they are first
      await store.del('code/' + person.id);
      await store.set('attempts/' + person.id, { count: 0, lockedUntil: 0 });
      await endSessionsFor(person.id);
      return { ok: true };
    }
    case 'POST /people/add': {
      const me = await auth(req);
      adultOnly(me);
      const people = await getPeople();
      const name = text(body.name, 30, 'a name');
      if (people.some((p) => p.name.toLowerCase() === name.toLowerCase())) fail(409, 'dupe', `${name} is already on the list.`);
      const role = body.role === 'adult' ? 'adult' : 'kid';
      const id = uniqueId(name, new Set(people.map((p) => p.id)));
      people.push({ id, name, role });
      await store.set('people', people);
      return { ok: true };
    }
    case 'POST /people/rename': {
      const me = await auth(req);
      adultOnly(me);
      const people = await getPeople();
      const p = people.find((x) => x.id === body.personId);
      if (!p) fail(404, 'no_person', "Couldn't find that name.");
      const name = text(body.name, 30, 'a name');
      if (people.some((x) => x !== p && x.name.toLowerCase() === name.toLowerCase())) fail(409, 'dupe', `${name} is already on the list.`);
      p.name = name;
      await store.set('people', people);
      return { ok: true };
    }

    // ----- home -----
    case 'GET /home': {
      const me = await auth(req);
      const d = date(q('date'));
      const [chores, chart, people, open] = await Promise.all([choresFor(d), getChart(), getPeople(), openGroceries()]);
      return {
        myChores: chores.filter((c) => c.personId === me.id),
        isOff: offFor(d, chart, people).includes(me.id),
        chartStarts: chart.startDate,
        reviewCount: me.role === 'adult' ? (await reviewQueue()).length : 0,
        groceries: { count: open.length, first: open.slice(0, 4).map((i) => i.name) },
      };
    }

    // ----- chores -----
    case 'GET /chores': {
      await auth(req);
      const from = date(q('from'));
      const [chart, people] = await Promise.all([getChart(), getPeople()]);
      const days = [];
      for (let i = 0; i < 7; i++) {
        const d = addDays(from, i);
        days.push({ date: d, chores: await choresFor(d), off: offFor(d, chart, people) });
      }
      return { days, chartStarts: chart.startDate };
    }
    case 'GET /chore': {
      await auth(req);
      return { chore: await mustGetChore(q('date'), q('id')) };
    }
    case 'POST /chore/submit': {
      const me = await auth(req);
      const c = await mustGetChore(body.date, body.id);
      if (c.personId !== me.id) fail(403, 'not_yours', 'Only the person this chore is for can submit it.');
      if (c.status === 'submitted') fail(409, 'already', 'Already submitted — waiting for review.');
      if (c.status === 'approved') fail(409, 'already', 'This one is already approved.');
      c.status = 'submitted';
      c.submittedAt = Date.now();
      c.history = [...(c.history || []), { at: c.submittedAt, by: me.id, action: 'submitted' }];
      await saveChore(c);
      await store.set(queueKey(c), { date: c.date, id: c.id });
      const adults = (await getPeople()).filter((p) => p.role === 'adult' && p.id !== me.id).map((p) => p.id);
      await notify(adults, 'reviews', {
        title: `${me.name} finished ${c.job}`,
        body: 'Ready for you to review.',
        url: '/#/review',
        tag: 'review',
      });
      return { chore: c };
    }
    case 'POST /chore/review': {
      const me = await auth(req);
      adultOnly(me);
      const c = await mustGetChore(body.date, body.id);
      if (c.status !== 'submitted') fail(409, 'not_waiting', 'This chore is not waiting for review any more.');
      const decision = body.decision === 'approve' ? 'approved' : body.decision === 'redo' ? 'redo' : null;
      if (!decision) fail(400, 'bad_decision', 'Pick Approve or Needs redo.');
      c.status = decision;
      c.reviewedBy = me.id;
      c.reviewedAt = Date.now();
      c.note = decision === 'redo' ? String(body.note || '').trim().slice(0, 200) : '';
      c.history = [...(c.history || []), { at: c.reviewedAt, by: me.id, action: decision, note: c.note || undefined }];
      await saveChore(c);
      await store.del(queueKey(c));
      if (c.personId !== me.id) {
        await notify([c.personId], 'results', decision === 'approved'
          ? { title: `${c.job} approved! 🎉`, body: `Nice work. ${me.name} checked it off.`, url: `/#/chore/${c.date}/${c.id}`, tag: 'result' }
          : { title: `${c.job} needs another go`, body: c.note || `${me.name} asked you to take another look.`, url: `/#/chore/${c.date}/${c.id}`, tag: 'result' });
      }
      return { chore: c };
    }
    case 'POST /chore/save': {
      const me = await auth(req);
      adultOnly(me);
      const job = text(body.job, 80, 'what the chore is');
      const person = await findPerson(body.personId);
      const newDate = date(body.when);
      const checklist = lines(body.checklist);
      if (!body.id) {
        const c = {
          id: 'x' + randomId(), date: newDate, personId: person.id, job, checklist,
          quick: false, oneOff: true, status: 'not_done', createdBy: me.id, createdAt: Date.now(),
        };
        await saveChore(c);
        return { chore: c };
      }
      const old = await mustGetChore(body.date, body.id);
      const updated = { ...old, job, personId: person.id, checklist, editedBy: me.id, editedAt: Date.now() };
      if (newDate === old.date) {
        await saveChore(updated);
        return { chore: updated };
      }
      // Moving to another day: keep the old record (marked moved) and create the new one.
      const moved = { ...updated, id: 'm' + randomId(), date: newDate };
      await saveChore(moved);
      await saveChore({ ...old, removed: true, movedTo: `${moved.date}/${moved.id}` });
      if (old.status === 'submitted') {
        await store.del(queueKey(old));
        await store.set(queueKey(moved), { date: moved.date, id: moved.id });
      }
      return { chore: moved };
    }
    case 'POST /chore/remove': {
      const me = await auth(req);
      adultOnly(me);
      const c = await mustGetChore(body.date, body.id);
      await saveChore({ ...c, removed: true, removedBy: me.id, removedAt: Date.now() });
      await store.del(queueKey(c));
      return { ok: true };
    }
    case 'GET /review': {
      const me = await auth(req);
      adultOnly(me);
      return { chores: await reviewQueue() };
    }
    case 'GET /review/count': {
      const me = await auth(req);
      return { count: me.role === 'adult' ? (await reviewQueue()).length : 0 };
    }
    case 'GET /checklists': {
      await auth(req);
      return { checklists: await getChecklists() };
    }
    case 'GET /chart': {
      await auth(req);
      return { chart: await getChart(), checklists: await getChecklists() };
    }
    case 'POST /chart': {
      const me = await auth(req);
      adultOnly(me);
      const chart = await getChart();
      const ids = new Set((await getPeople()).map((p) => p.id));
      if (!Array.isArray(body.days) || body.days.length !== 7) fail(400, 'bad_chart', "That chart doesn't look right.");
      const seenIds = new Set();
      chart.days = body.days.map((day) =>
        (Array.isArray(day) ? day : []).slice(0, 30).map((s) => {
          const slot = cleanSlot(s, ids);
          // a slot moved to another day keeps its id only if it's still unique
          if (seenIds.has(slot.id)) slot.id = 'c' + randomId();
          seenIds.add(slot.id);
          return slot;
        }));
      await store.set('chart', chart);
      return { chart };
    }
    case 'POST /checklists': {
      // Replace the jobs + checklists. renames: { oldName: newName } also updates the chart;
      // jobs that were deleted are taken off the chart too.
      const me = await auth(req);
      adultOnly(me);
      const before = await getChecklists();
      const checklists = cleanChecklists(body.checklists);
      const renames = body.renames && typeof body.renames === 'object' ? body.renames : {};
      const chart = await getChart();
      const gone = new Set(Object.keys(before).filter((k) => !(k in checklists) && !(k in renames)));
      chart.days = chart.days.map((day) => day
        .map((s) => (renames[s.job] && renames[s.job] in checklists ? { ...s, job: renames[s.job] } : s))
        .filter((s) => !gone.has(s.job)));
      await store.set('checklists', checklists);
      await store.set('chart', chart);
      return { ok: true, checklists, chart };
    }

    // ----- groceries -----
    case 'GET /groceries': {
      await auth(req);
      return { open: await openGroceries(), bought: await boughtGroceries() };
    }
    case 'GET /groceries/export': {
      // Plain text, one outstanding item per line — for the future shopping automation.
      await auth(req);
      const items = await openGroceries();
      return new Response(items.map((i) => i.name).join('\n'), {
        headers: { 'content-type': 'text/plain; charset=utf-8', 'cache-control': 'no-store' },
      });
    }
    case 'POST /groceries/add': {
      const me = await auth(req);
      const name = text(body.name, 80, 'an item');
      const open = await openGroceries();
      const dupe = open.find((i) => i.name.toLowerCase() === name.toLowerCase());
      if (dupe) return { item: dupe, alreadyOnList: true };
      const item = { id: randomId(), name, addedBy: me.id, addedAt: Date.now() };
      await store.set('grocery/open/' + item.id, item);
      return { item };
    }
    case 'POST /groceries/check': {
      const me = await auth(req);
      const key = 'grocery/open/' + cid(body.id);
      const item = await store.get(key);
      if (!item) fail(404, 'gone', 'Someone already checked that one off.');
      const t = Date.now();
      await store.set(`grocery/bought/${invTs(t)}-${item.id}`, { ...item, boughtBy: me.id, boughtAt: t });
      await store.del(key);
      return { ok: true };
    }
    case 'POST /groceries/remove': {
      const me = await auth(req);
      const key = 'grocery/open/' + cid(body.id);
      const item = await store.get(key);
      if (!item) fail(404, 'gone', 'That item is already off the list.');
      await store.set('grocery/removed/' + item.id, { ...item, removedBy: me.id, removedAt: Date.now() });
      await store.del(key);
      return { ok: true };
    }

    // ----- calendar -----
    case 'GET /calendar': {
      await auth(req);
      const from = Date.parse(q('timeMin') || '');
      const to = Date.parse(q('timeMax') || '');
      if (!from || !to || to <= from || to - from > 62 * 86400e3) fail(400, 'bad_range', "That date range doesn't look right.");
      const timeMin = new Date(from).toISOString();
      const timeMax = new Date(to).toISOString();
      const gStatus = await google.status();
      const [g, feeds] = await Promise.all([
        gStatus.connected
          ? google.listEvents(timeMin, timeMax).then((events) => ({ events }), (e) => ({ events: [], error: e.message }))
          : Promise.resolve({ events: [] }),
        feedEvents(from, to),
      ]);
      return {
        events: [...g.events, ...feeds.events],
        google: { ...gStatus, error: g.error || null },
        feedErrors: feeds.errors,
      };
    }
    case 'POST /calendar/add':
    case 'POST /calendar/update': {
      const me = await auth(req);
      const ev = {
        title: text(body.title, 120, 'a title'),
        date: date(body.date),
        allDay: !!body.allDay,
        time: body.allDay ? null : (/^\d{2}:\d{2}$/.test(body.time || '') ? body.time : fail(400, 'bad_time', 'Pick a start time, or choose All day.')),
        endTime: !body.allDay && /^\d{2}:\d{2}$/.test(body.endTime || '') ? body.endTime : null,
        notes: String(body.notes || '').trim().slice(0, 1000),
      };
      if (route === 'POST /calendar/add') return { event: await google.addEvent(ev, me.id) };
      if (!/^[A-Za-z0-9_-]{1,200}$/.test(body.id || '')) fail(400, 'bad_id', "Couldn't find that event.");
      return { event: await google.updateEvent(body.id, ev) };
    }
    case 'POST /calendar/delete': {
      await auth(req);
      if (!/^[A-Za-z0-9_-]{1,200}$/.test(body.id || '')) fail(400, 'bad_id', "Couldn't find that event.");
      await google.deleteEvent(body.id);
      return { ok: true };
    }
    case 'GET /google/status': {
      await auth(req);
      return google.status();
    }
    case 'POST /google/start': {
      const me = await auth(req);
      adultOnly(me);
      if (!google.configured()) fail(409, 'not_configured', 'Google sign-in is not set up on the server yet.');
      const st = newToken();
      await store.set('oauthstate/' + sha256(st), { personId: me.id, expires: Date.now() + 10 * 60000 });
      return { url: google.authUrl(baseUrl(req) + '/api/google/callback', st) };
    }
    case 'GET /google/callback': {
      // Google sends the browser back here. The one-time "state" proves an adult started it.
      const back = (result) => Response.redirect(baseUrl(req) + '/#/settings/calendar?result=' + result, 302);
      const st = q('state') || '';
      const key = 'oauthstate/' + sha256(st);
      const saved = st ? await store.get(key) : null;
      if (st) await store.del(key);
      if (!saved || saved.expires < Date.now()) return back('expired');
      if (q('error') || !q('code')) return back('cancelled');
      try {
        await google.connect(q('code'), baseUrl(req) + '/api/google/callback', saved.personId, (await getHousehold()).calendarName);
        return back('connected');
      } catch (e) {
        console.error('google connect', e.message);
        return back(e.error === 'not_found' ? 'not_found' : e.error === 'read_only' ? 'read_only' : 'failed');
      }
    }
    case 'POST /google/disconnect': {
      const me = await auth(req);
      adultOnly(me);
      await google.disconnect();
      return { ok: true };
    }

    // ----- calendar feeds -----
    case 'GET /feeds': {
      await auth(req);
      return { feeds: (await store.get('feeds')) || [] };
    }
    case 'POST /feeds/add': {
      const me = await auth(req);
      adultOnly(me);
      const label = text(body.label, 40, 'a name for the calendar');
      const url = text(body.url, 500, 'the link');
      if (!/^(https?|webcal):\/\/[^\s]+$/i.test(url)) fail(400, 'bad_url', 'That link should start with https:// or webcal://');
      const feeds = (await store.get('feeds')) || [];
      feeds.push({ id: randomId(), label, url, addedBy: me.id, addedAt: Date.now() });
      await store.set('feeds', feeds);
      return { feeds };
    }
    case 'POST /feeds/remove': {
      const me = await auth(req);
      adultOnly(me);
      const feeds = ((await store.get('feeds')) || []).filter((f) => f.id !== body.id);
      await store.set('feeds', feeds);
      if (ID_RE.test(body.id || '')) await store.del('feedcache/' + body.id);
      return { feeds };
    }
  }
  return undefined;
}
