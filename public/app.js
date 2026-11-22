'use strict';
/* Family HQ — the whole front end. Plain JavaScript, no build step. */

const $ = (s, el = document) => el.querySelector(s);
const $$ = (s, el = document) => [...el.querySelectorAll(s)];
const main = $('#main');

const store = {
  get: (area, k) => { try { return window[area].getItem(k); } catch { return null; } },
  set: (area, k, v) => { try { window[area].setItem(k, v); } catch { /* private mode */ } },
  del: (area, k) => { try { window[area].removeItem(k); } catch { /* ignore */ } },
};

const state = {
  // The sign-in lasts only while the app is open (sessionStorage), so the code
  // is asked for every time the app is opened fresh.
  token: store.get('sessionStorage', 'fhq_token'),
  me: null,
  people: [],
  page: 'home',
  seq: 0,
  quiet: false,
  weekOffset: 0,
  pinKey: null,
  config: null,
};

// ---------- small helpers ----------
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const pad = (n) => String(n).padStart(2, '0');
const toStr = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
const fromStr = (s) => { const [y, m, d] = s.split('-').map(Number); return new Date(y, m - 1, d); };
const today = () => toStr(new Date());
const addDays = (s, n) => { const d = fromStr(s); d.setDate(d.getDate() + n); return toStr(d); };
const mondayOf = (s) => { const d = fromStr(s); d.setDate(d.getDate() - ((d.getDay() + 6) % 7)); return toStr(d); };
const fmtDay = (s, o = { weekday: 'long', month: 'short', day: 'numeric' }) => fromStr(s).toLocaleDateString('en-US', o);
const fmtShort = (s) => fmtDay(s, { weekday: 'short', month: 'short', day: 'numeric' });
const fmtTime = (ts) => new Date(ts).toLocaleString('en-US', { weekday: 'short', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' });
function whenLabel(s) {
  const t = today();
  if (s === t) return 'Tonight';
  if (s === addDays(t, 1)) return 'Tomorrow';
  if (s === addDays(t, -1)) return 'Yesterday';
  return fmtShort(s);
}
const nameOf = (id) => state.people.find((p) => p.id === id)?.name || 'Someone';
const hqName = () => state.config?.name || 'Family HQ';
const isAdult = () => state.me?.role === 'adult';
const sortedPeople = () => [...state.people].sort((a, b) => (a.role === b.role ? 0 : a.role === 'kid' ? -1 : 1));
const plural = (n, one, many) => `${n} ${n === 1 ? one : many}`;

const ICONS = {
  home: '<path d="M3 11 12 4l9 7v9a1 1 0 0 1-1 1h-5v-6H9v6H4a1 1 0 0 1-1-1z"/>',
  chores: '<path d="M9 11l3 3 8-8"/><path d="M20 12v7a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h9"/>',
  calendar: '<rect x="3" y="5" width="18" height="16" rx="2"/><path d="M3 10h18M8 3v4M16 3v4"/>',
  groceries: '<path d="M3 4h2l2.4 11h11l2-8H6.2"/><circle cx="9" cy="20" r="1.5"/><circle cx="18" cy="20" r="1.5"/>',
  review: '<path d="M4 4h16v12H4z"/><path d="M4 16l3 4h10l3-4M9 10l2 2 4-4"/>',
  gear: '<circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.7 1.7 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-1.8-.3 1.7 1.7 0 0 0-1 1.5V21a2 2 0 1 1-4 0v-.1a1.7 1.7 0 0 0-1.1-1.5 1.7 1.7 0 0 0-1.8.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.7 1.7 0 0 0 .3-1.8 1.7 1.7 0 0 0-1.5-1H3a2 2 0 1 1 0-4h.1a1.7 1.7 0 0 0 1.5-1.1 1.7 1.7 0 0 0-.3-1.8l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.7 1.7 0 0 0 1.8.3H9a1.7 1.7 0 0 0 1-1.5V3a2 2 0 1 1 4 0v.1a1.7 1.7 0 0 0 1 1.5 1.7 1.7 0 0 0 1.8-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0-.3 1.8V9a1.7 1.7 0 0 0 1.5 1H21a2 2 0 1 1 0 4h-.1a1.7 1.7 0 0 0-1.5 1z"/>',
};
const icon = (n) => `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${ICONS[n]}</svg>`;

// ---------- server calls ----------
class ApiError extends Error {
  constructor(message, status, data) { super(message); this.status = status; this.data = data || {}; }
}
async function api(path, body) {
  let res;
  try {
    res = await fetch('/api' + path, {
      method: body ? 'POST' : 'GET',
      headers: { 'content-type': 'application/json', ...(state.token ? { authorization: 'Bearer ' + state.token } : {}) },
      body: body ? JSON.stringify(body) : undefined,
      cache: 'no-store',
    });
  } catch {
    throw new ApiError("Couldn't save — check your connection and try again.", 0);
  }
  let data = null;
  try { data = await res.json(); } catch { /* not json */ }
  if (!res.ok) {
    if (data?.error === 'session') { signedOut('Please sign in again.'); }
    throw new ApiError(data?.message || "Couldn't save — check your connection and try again.", res.status, data);
  }
  return data;
}

// ---------- toast + dialogs ----------
let toastTimer;
function toast(msg, isError = false) {
  const t = $('#toast');
  t.textContent = msg;
  t.className = 'show' + (isError ? ' error' : '');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => (t.className = ''), isError ? 5000 : 2600);
}
function openModal(html) {
  const m = $('#modal');
  m.innerHTML = `<div class="sheet" role="dialog" aria-modal="true">${html}</div>`;
  m.hidden = false;
  return m;
}
function closeModal() { const m = $('#modal'); m.hidden = true; m.innerHTML = ''; }
function confirmBox({ title, text = '', yes = 'Yes', no = 'Cancel', danger = false }) {
  return new Promise((resolve) => {
    const m = openModal(`<h2>${esc(title)}</h2>${text ? `<p>${esc(text)}</p>` : ''}
      <button class="btn ${danger ? 'pink' : ''}" data-yes>${esc(yes)}</button>
      <button class="btn ghost" data-no>${esc(no)}</button>`);
    m.onclick = (e) => {
      if (e.target.closest('[data-yes]')) { closeModal(); resolve(true); }
      else if (e.target.closest('[data-no]') || e.target === m) { closeModal(); resolve(false); }
    };
  });
}
function promptBox({ title, label, value = '', yes = 'Save' }) {
  return new Promise((resolve) => {
    const m = openModal(`<h2>${esc(title)}</h2>
      <form><label class="field">${esc(label)}<input type="text" name="v" value="${esc(value)}" maxlength="80" autocomplete="off"></label>
      <button class="btn" type="submit">${esc(yes)}</button>
      <button class="btn ghost" type="button" data-no>Cancel</button></form>`);
    const input = $('input', m);
    input.focus();
    input.select();
    $('form', m).onsubmit = (e) => { e.preventDefault(); const v = input.value.trim(); closeModal(); resolve(v || null); };
    m.onclick = (e) => { if (e.target.closest('[data-no]') || e.target === m) { closeModal(); resolve(null); } };
  });
}

// ---------- rendering helpers ----------
const isLive = (seq) => seq === state.seq;
function loading() { if (!state.quiet) main.innerHTML = '<div class="loading"><span class="spinner"></span> Loading…</div>'; }
function paint(seq, html) { if (isLive(seq)) { main.innerHTML = html; return true; } return false; }
const errorBlock = (msg) => `<div class="error-box">${esc(msg)}</div><button class="btn secondary" onclick="route()">Try again</button>`;
const backLink = (fallback, label = '‹ Back') => `<button class="back" data-back="${esc(fallback)}">${esc(label)}</button>`;

document.addEventListener('click', (e) => {
  const b = e.target.closest('[data-back]');
  if (!b) return;
  if (history.length > 1 && state.cameFromApp) history.back();
  else location.hash = b.dataset.back;
});

// ============================================================
// Sign in: name picker + code
// ============================================================
function signinMode(on) {
  document.body.classList.toggle('signin', on);
  $('#top').hidden = on;
  $('#tabs').hidden = on;
}

async function boot() {
  signinMode(true);
  try {
    state.config = await api('/config');
    document.title = state.config.name;
    if (!state.config.setupDone) return showSetup();
    state.people = await api('/people');
  } catch (e) {
    main.innerHTML = `<div class="signin-wrap"><div class="logo">${esc(hqName())}</div>${errorBlock(e.message)}</div>`;
    $('.btn', main).onclick = boot;
    return;
  }
  if (state.token) {
    try {
      const r = await api('/me');
      state.me = r.person;
      return startApp();
    } catch { clearSession(); }
  }
  const last = state.people.find((p) => p.id === store.get('localStorage', 'fhq_last'));
  if (last) showCode(last); else showPicker();
}

function clearSession() {
  state.token = null;
  state.me = null;
  store.del('sessionStorage', 'fhq_token');
}

function signedOut(msg) {
  if (!state.me) return;
  clearSession();
  boot().then(() => msg && toast(msg));
}

function showPicker() {
  state.pinKey = null;
  signinMode(true);
  main.innerHTML = `<div class="signin-wrap">
    <div class="logo">${esc(hqName())}</div>
    <h1>Who's this?</h1>
    <div class="name-grid">${state.people.map((p) => `<button class="name-btn" data-id="${esc(p.id)}">${esc(p.name)}</button>`).join('')}</div>
  </div>`;
  $$('.name-btn', main).forEach((b) => (b.onclick = () => showCode(state.people.find((p) => p.id === b.dataset.id))));
}

function showCode(person, { mode = person.hasCode ? 'enter' : 'create', first = '', msg = '' } = {}) {
  signinMode(true);
  store.set('localStorage', 'fhq_last', person.id);
  let digits = '';
  let busy = false;
  const title = {
    enter: `Hi, ${person.name} — enter your code`,
    create: `Hi, ${person.name}! Create your code`,
    confirm: 'Enter it again to confirm',
  }[mode];
  const sub = mode === 'create' ? 'Pick 4 numbers you’ll remember. You’ll use them every time.' : mode === 'confirm' ? 'Same 4 numbers one more time.' : '';
  main.innerHTML = `<div class="signin-wrap">
    <div class="logo">${esc(hqName())}</div>
    <h1>${esc(title)}</h1>
    ${sub ? `<p class="muted">${esc(sub)}</p>` : ''}
    <div class="dots" aria-hidden="true"><span></span><span></span><span></span><span></span></div>
    <div class="pin-msg" role="alert">${esc(msg)}</div>
    <div class="keypad">
      ${[1, 2, 3, 4, 5, 6, 7, 8, 9].map((n) => `<button data-d="${n}">${n}</button>`).join('')}
      <button class="blank" tabindex="-1" aria-hidden="true"></button>
      <button data-d="0">0</button>
      <button class="del" data-del aria-label="Delete">⌫ Delete</button>
    </div>
    <button class="switch-link" data-switch>Not ${esc(person.name)}? Switch</button>
  </div>`;
  const dots = $$('.dots span', main);
  const msgEl = $('.pin-msg', main);
  const draw = () => dots.forEach((d, i) => d.classList.toggle('on', i < digits.length));
  const shake = (text) => {
    digits = '';
    draw();
    msgEl.textContent = text;
    const d = $('.dots', main);
    d.classList.remove('shake');
    void d.offsetWidth;
    d.classList.add('shake');
  };

  async function done() {
    if (mode === 'create') return showCode(person, { mode: 'confirm', first: digits });
    if (mode === 'confirm' && digits !== first) {
      return showCode(person, { mode: 'create', msg: "Those didn't match — let's start again." });
    }
    busy = true;
    msgEl.className = 'pin-msg ok';
    msgEl.textContent = 'Checking…';
    try {
      const r = mode === 'confirm'
        ? await api('/setup-code', { personId: person.id, code: digits })
        : await api('/login', { personId: person.id, code: digits });
      person.hasCode = true;
      state.token = r.token;
      state.me = r.person;
      store.set('sessionStorage', 'fhq_token', r.token);
      state.pinKey = null;
      location.hash = '#/home';
      startApp();
    } catch (e) {
      busy = false;
      msgEl.className = 'pin-msg';
      const err = e.data?.error;
      if (err === 'needs_setup') { person.hasCode = false; return showCode(person, { mode: 'create', msg: 'Your code was reset — create a new one.' }); }
      if (err === 'has_code') { person.hasCode = true; return showCode(person, { mode: 'enter', msg: e.message }); }
      shake(e.message);
    }
  }

  function press(k) {
    if (busy) return;
    if (k === 'del') { digits = digits.slice(0, -1); draw(); return; }
    if (digits.length >= 4) return;
    digits += k;
    if (digits.length === 1) { msgEl.className = 'pin-msg'; msgEl.textContent = ''; }
    draw();
    if (digits.length === 4) setTimeout(done, 120);
  }
  state.pinKey = (key) => { if (/^\d$/.test(key)) press(key); else if (key === 'Backspace') press('del'); };
  $('.keypad', main).onclick = (e) => {
    const b = e.target.closest('button');
    if (!b) return;
    if (b.dataset.d !== undefined) press(b.dataset.d);
    else if (b.hasAttribute('data-del')) press('del');
  };
  $('[data-switch]', main).onclick = () => { store.del('localStorage', 'fhq_last'); showPicker(); };
}
document.addEventListener('keydown', (e) => { if (state.pinKey && !e.target.closest('input,textarea')) state.pinKey(e.key); });

async function switchPerson() {
  try { await api('/logout', {}); } catch { /* signing out locally is enough */ }
  clearSession();
  store.del('localStorage', 'fhq_last');
  history.replaceState(null, '', location.pathname);
  showPicker();
}

// ============================================================
// App shell
// ============================================================
function startApp() {
  signinMode(false);
  state.pinKey = null;
  $('#top').innerHTML = `
    <div class="brand">${esc(hqName())}<small>${esc(state.me.name)}</small></div>
    <button class="icon-btn" data-go="#/settings" aria-label="Settings">${icon('gear')}</button>
    <button data-switch-person>Switch person</button>`;
  $('[data-switch-person]').onclick = switchPerson;
  $('[data-go]').onclick = () => (location.hash = '#/settings');
  const tabs = [['home', 'Home'], ['chores', 'Chores'], ['calendar', 'Calendar'], ['groceries', 'Groceries']];
  if (isAdult()) tabs.push(['review', 'Review']);
  $('#tabs').innerHTML = tabs.map(([k, label]) =>
    `<a href="#/${k}" data-tab="${k}">${icon(k)}<span>${label}</span>${k === 'review' ? '<span class="badge" hidden></span>' : ''}</a>`).join('');
  if (!location.hash || location.hash === '#') location.hash = '#/home';
  route();
}

function setBadge(n) {
  const b = $('#tabs .badge');
  if (!b) return;
  b.hidden = !n;
  b.textContent = n > 9 ? '9+' : String(n);
}
async function refreshBadge() {
  if (!isAdult()) return;
  try { setBadge((await api('/review/count')).count); } catch { /* badge can wait */ }
}

const TAB_FOR = { home: 'home', chores: 'chores', chore: 'chores', 'chore-new': 'chores', 'chore-edit': 'chores', review: 'review', calendar: 'calendar', 'event-new': 'calendar', 'event-edit': 'calendar', groceries: 'groceries', settings: '' };

async function route({ quiet = false } = {}) {
  if (!state.me) return;
  const [path, query = ''] = location.hash.replace(/^#\/?/, '').split('?');
  state.query = new URLSearchParams(query);
  const [page = 'home', a, b] = path.split('/').map(decodeURIComponent);
  state.page = page || 'home';
  state.seq += 1;
  state.quiet = quiet;
  if (!quiet) window.scrollTo(0, 0);
  closeModal();
  main.onclick = null; // screens that need these set them again
  main.onchange = null;
  $$('#tabs a').forEach((t) => t.classList.toggle('active', t.dataset.tab === (TAB_FOR[state.page] ?? 'home')));
  refreshBadge();
  try {
    switch (state.page) {
      case 'chores': return await viewChores();
      case 'chore': return await viewChore(a, b);
      case 'chore-new': return await viewChoreForm();
      case 'chore-edit': return await viewChoreForm(a, b);
      case 'review': return await viewReview();
      case 'calendar': return await viewCalendar();
      case 'event-new': return await viewEventForm();
      case 'event-edit': return await viewEventForm(a);
      case 'groceries': return await viewGroceries();
      case 'settings': return await viewSettings(a);
      default: return await viewHome();
    }
  } catch (e) {
    if (e.data?.error === 'session') return;
    if (!quiet) main.innerHTML = errorBlock(e.message);
  } finally {
    state.quiet = false;
  }
}
window.addEventListener('hashchange', () => { state.cameFromApp = true; route(); });

// Keep things fresh: when the app comes back to the front, and every minute.
function softRefresh() {
  if (!state.me || document.visibilityState !== 'visible' || !$('#modal').hidden) return;
  if (document.activeElement?.closest('input,textarea,select')) return;
  if (['home', 'review', 'chores', 'groceries', 'chore', 'calendar'].includes(state.page)) route({ quiet: true });
}
document.addEventListener('visibilitychange', softRefresh);
setInterval(softRefresh, 60000);

// ============================================================
// Chore bits shared by Home, Chores and the detail screen
// ============================================================
const STATUS_LABEL = { not_done: 'To do', submitted: 'Waiting', approved: 'Approved', redo: 'Redo' };
const pill = (c) => `<span class="pill ${c.status}">${STATUS_LABEL[c.status] || ''}</span>`;
const choreHref = (c) => `#/chore/${c.date}/${c.id}`;

function redoNote(c) {
  return `<div class="status-box redo">Needs redo${c.note
    ? `<div class="note">“${esc(c.note)}” — ${esc(nameOf(c.reviewedBy))}</div>`
    : `<div class="note">${esc(nameOf(c.reviewedBy))} asked for another go.</div>`}</div>`;
}

function heroCard(c) {
  const items = c.checklist || [];
  const show = items.slice(0, 3);
  const more = items.length - show.length;
  let action = '';
  if (c.status === 'not_done') action = `<a class="btn" href="${choreHref(c)}">Done — submit for review</a>`;
  if (c.status === 'submitted') action = '<div class="status-box submitted">Submitted — waiting for review.</div>';
  if (c.status === 'approved') action = '<div class="status-box approved">Nice work — approved!</div>';
  if (c.status === 'redo') action = redoNote(c) + `<a class="btn" href="${choreHref(c)}">Done — submit for review</a>`;
  return `<div class="card hero">
    <div class="card-head"><span class="eyebrow">${esc(whenLabel(c.date))}${c.oneOff ? ' · extra chore' : ''}</span>
      ${c.status === 'not_done' ? '' : `<a class="link-arrow" href="${choreHref(c)}">Checklist ›</a>`}</div>
    <h2>${esc(c.job)}</h2>
    ${show.length ? `<ul class="summary-list">${show.map((i) => `<li>${esc(i)}</li>`).join('')}${more > 0 ? `<li>+ ${more} more</li>` : ''}</ul>` : ''}
    ${action}
  </div>`;
}

// ============================================================
// Screen 1 — Home
// ============================================================
async function viewHome() {
  const seq = state.seq;
  loading();
  const t = today();
  const d = await api('/home?date=' + t);
  setBadge(d.reviewCount);
  let h = `<h1>Hi, ${esc(state.me.name)}</h1><p class="muted">${esc(fmtDay(t, { weekday: 'long', month: 'long', day: 'numeric' }))}</p>`;

  if (d.myChores.length) {
    h += d.myChores.map(heroCard).join('');
  } else if (!isAdult()) {
    const line = t < d.chartStarts
      ? `The chore chart starts ${fmtDay(d.chartStarts)}. Enjoy tonight!`
      : "You're off tonight — enjoy the evening.";
    h += `<div class="card hero"><span class="eyebrow">Tonight</span><div class="status-box off">${esc(line)}</div></div>`;
  }

  if (isAdult()) {
    const n = d.reviewCount;
    h += `<a class="card" href="#/review"><div class="card-head"><h2>Review</h2><span class="link-arrow">Open ›</span></div>
      <p class="${n ? '' : 'muted'}">${n ? `<b>${plural(n, 'chore', 'chores')} waiting for review</b>` : 'Nothing waiting — all caught up.'}</p></a>`;
  }

  h += `<a class="card" href="#/calendar"><div class="card-head"><h2>Today’s calendar</h2><span class="link-arrow">Calendar ›</span></div>
    <div id="home-cal"><p class="muted">Loading…</p></div></a>`;

  const g = d.groceries;
  h += `<a class="card" href="#/groceries"><div class="card-head"><h2>Groceries</h2><span class="link-arrow">List ›</span></div>
    ${g.count
      ? `<p><b>${plural(g.count, 'item', 'items')}</b> on the list: ${esc(g.first.join(', '))}${g.count > g.first.length ? '…' : ''}</p>`
      : '<p class="muted">List is empty — add the first item.</p>'}</a>`;

  if (isAdult()) h += '<a class="btn secondary" href="#/chore-new">+ Add a one-off chore</a>';
  if (!paint(seq, h)) return;
  homeCalendar(seq);
}

async function homeCalendar(seq) {
  const t = today();
  let html;
  try {
    const d = await loadEvents(t, addDays(t, 1));
    const now = Date.now();
    const list = eventsOn(d.events, t).filter((e) => e.allDay || endMs(e) > now);
    html = list.length
      ? `<ul class="ev-mini">${list.slice(0, 3).map((e) => `<li><span class="ev-dot ${e.source}"></span><b>${esc(eventTime(e))}</b> ${esc(e.title)}</li>`).join('')}</ul>
        ${list.length > 3 ? `<p class="muted small">+ ${list.length - 3} more</p>` : ''}`
      : '<p class="muted">Nothing else on the calendar today.</p>';
    if (!d.google.connected && !d.events.length) html = '<p class="muted">Google Calendar isn’t connected yet.</p>';
  } catch {
    html = '<p class="muted">Couldn’t load the calendar right now.</p>';
  }
  if (isLive(seq)) { const el = $('#home-cal'); if (el) el.innerHTML = html; }
}

// ============================================================
// Screen 2 — Chores (this week)
// ============================================================
async function viewChores() {
  const seq = state.seq;
  loading();
  const t = today();
  const start = addDays(mondayOf(t), state.weekOffset * 7);
  const d = await api('/chores?from=' + start);
  const end = addDays(start, 6);
  const label = state.weekOffset === 0 ? 'This week' : state.weekOffset === 1 ? 'Next week' : state.weekOffset === -1 ? 'Last week' : '';
  let h = `<h1>Chores</h1>
    <div class="week-nav">
      <button data-week="-1" aria-label="Previous week">‹</button>
      <div class="label">${label ? `${label}<br>` : ''}<span class="muted small">${esc(fmtDay(start, { month: 'short', day: 'numeric' }))} – ${esc(fmtDay(end, { month: 'short', day: 'numeric' }))}</span></div>
      <button data-week="1" aria-label="Next week">›</button>
    </div>`;
  if (state.weekOffset !== 0) h += '<button class="btn ghost" data-week="0" style="margin:0 0 12px">Back to this week</button>';
  if (isAdult()) h += '<a class="btn secondary" href="#/chore-new" style="margin:0 0 14px">+ Add one-off chore</a>';

  for (const day of d.days) {
    const isToday = day.date === t;
    let rows = day.chores.map((c) => `<a class="chore-row" href="${choreHref(c)}">
        <span class="who">${esc(nameOf(c.personId))}</span>
        <span class="what">${esc(c.job)}${c.oneOff ? ' <span class="pill oneoff">extra</span>' : ''}</span>
        ${pill(c)}<span class="chev">›</span></a>`).join('');
    if (!rows) rows = `<p class="muted">${day.date < d.chartStarts ? `The chart starts ${esc(fmtShort(d.chartStarts))}.` : 'No chores this day.'}</p>`;
    const off = day.date >= d.chartStarts
      ? `<div class="off-line">${day.off.length ? `Off: ${esc(day.off.map(nameOf).join(', '))}` : 'Everyone’s on tonight'}</div>` : '';
    h += `<div class="card day${isToday ? ' today' : ''}" ${isToday ? 'id="today"' : ''}>
      <div class="day-name"><h3>${esc(fmtDay(day.date, { weekday: 'long', month: 'short', day: 'numeric' }))}</h3>${isToday ? '<span class="today-tag">Today</span>' : ''}</div>
      ${rows}${off}</div>`;
  }
  if (!paint(seq, h)) return;
  $$('[data-week]', main).forEach((b) => (b.onclick = () => {
    const v = Number(b.dataset.week);
    state.weekOffset = v === 0 ? 0 : state.weekOffset + v;
    route();
  }));
  if (state.weekOffset === 0 && !state.quiet) $('#today', main)?.scrollIntoView({ block: 'center' });
}

// ============================================================
// Screen 3 — Chore detail + submit (and Screen 4 review buttons)
// ============================================================
async function viewChore(date, id) {
  const seq = state.seq;
  loading();
  const { chore: c } = await api(`/chore?date=${encodeURIComponent(date)}&id=${encodeURIComponent(id)}`);
  const mine = c.personId === state.me.id;
  const ckKey = `fhq_ck_${state.me.id}_${c.date}_${c.id}`;
  let ticked = [];
  try { ticked = JSON.parse(store.get('localStorage', ckKey) || '[]'); } catch { /* ignore */ }

  let h = backLink(isAdult() && c.status === 'submitted' ? '#/review' : '#/chores');
  h += `<div class="card">
    <h1>${esc(c.job)}</h1>
    <p class="muted">For <b>${esc(nameOf(c.personId))}</b> · ${esc(whenLabel(c.date))}${whenLabel(c.date) === fmtShort(c.date) ? '' : `, ${esc(fmtShort(c.date))}`}</p>
    ${c.oneOff ? '<span class="pill oneoff">Extra chore</span> ' : ''}${c.quick ? '<span class="pill">Quick 2-minute task</span>' : ''}
  </div>`;

  h += '<div class="card"><h2>Checklist</h2>';
  if (c.checklist?.length) {
    h += `${mine ? '<p class="muted small">Tick things off as you go — just for you. The submit button is what counts.</p>' : ''}
      <ul class="checklist">${c.checklist.map((item, i) => `<li><label><input type="checkbox" data-i="${i}" ${ticked.includes(i) ? 'checked' : ''}><span>${esc(item)}</span></label></li>`).join('')}</ul>`;
  } else {
    h += '<p class="muted">No checklist for this one.</p>';
  }
  h += '</div>';

  // status + actions
  h += '<div class="card">';
  if (c.status === 'not_done') {
    h += mine
      ? '<button class="btn" data-submit>Done — submit for review</button>'
      : `<p class="muted">Not done yet — waiting for ${esc(nameOf(c.personId))}.</p>`;
  } else if (c.status === 'submitted') {
    h += `<div class="status-box submitted">Submitted — waiting for review</div>
      <p class="muted small" style="margin-top:8px">Submitted ${esc(fmtTime(c.submittedAt))}</p>`;
    if (isAdult()) {
      h += `<div class="btn-row"><button class="btn green" data-approve>Approve</button><button class="btn amber" data-redo>Needs redo</button></div>
        <form data-redo-form hidden style="margin-top:12px">
          <label class="field">Note for ${esc(nameOf(c.personId))} <span class="hint">(optional)</span>
            <input type="text" name="note" maxlength="200" placeholder="e.g. wipe the counters again"></label>
          <button class="btn amber" type="submit">Send back for redo</button>
        </form>`;
    }
  } else if (c.status === 'approved') {
    h += `<div class="status-box approved">Approved!</div>
      <p class="muted small" style="margin-top:8px">By ${esc(nameOf(c.reviewedBy))}, ${esc(fmtTime(c.reviewedAt))}</p>`;
  } else if (c.status === 'redo') {
    h += redoNote(c);
    h += mine ? '<button class="btn" data-submit>Done — submit for review</button>' : '';
  }
  h += '</div>';

  if (isAdult()) {
    h += `<a class="btn secondary" href="#/chore-edit/${c.date}/${c.id}">Edit / reassign</a>
      <button class="btn danger" data-remove>Remove this chore</button>`;
  }
  if (!paint(seq, h)) return;

  $$('.checklist input', main).forEach((cb) => (cb.onchange = () => {
    const now = $$('.checklist input', main).filter((x) => x.checked).map((x) => Number(x.dataset.i));
    store.set('localStorage', ckKey, JSON.stringify(now));
  }));

  const submitBtn = $('[data-submit]', main);
  if (submitBtn) submitBtn.onclick = async () => {
    submitBtn.disabled = true;
    submitBtn.textContent = 'Sending…';
    try {
      await api('/chore/submit', { date: c.date, id: c.id });
      toast('Sent for review — nice work!');
      route();
    } catch (e) {
      toast(e.message, true);
      submitBtn.disabled = false;
      submitBtn.textContent = 'Done — submit for review';
    }
  };

  const review = async (decision, note = '') => {
    $$('button', main).forEach((b) => (b.disabled = true));
    try {
      await api('/chore/review', { date: c.date, id: c.id, decision, note });
      toast(decision === 'approve' ? `Approved ${nameOf(c.personId)}’s ${c.job}` : `Sent back to ${nameOf(c.personId)}`);
      location.hash = '#/review';
    } catch (e) {
      toast(e.message, true);
      route();
    }
  };
  const ap = $('[data-approve]', main);
  if (ap) ap.onclick = () => review('approve');
  const rd = $('[data-redo]', main);
  if (rd) rd.onclick = () => {
    const f = $('[data-redo-form]', main);
    f.hidden = false;
    $('input', f).focus();
    f.onsubmit = (e) => { e.preventDefault(); review('redo', f.note.value); };
  };

  const rm = $('[data-remove]', main);
  if (rm) rm.onclick = async () => {
    const ok = await confirmBox({
      title: 'Are you sure?',
      text: `This removes “${c.job}” from ${nameOf(c.personId)}’s list for ${fmtDay(c.date)}.`,
      yes: 'Yes, remove it', danger: true,
    });
    if (!ok) return;
    try {
      await api('/chore/remove', { date: c.date, id: c.id });
      toast('Chore removed');
      location.hash = '#/chores';
    } catch (e) { toast(e.message, true); }
  };
}

// ============================================================
// Screen 4 — Review queue (adults)
// ============================================================
async function viewReview() {
  const seq = state.seq;
  if (!isAdult()) { location.hash = '#/home'; return; }
  loading();
  const { chores } = await api('/review');
  setBadge(chores.length);
  let h = '<h1>Review</h1><p class="muted">Newest first. Tap one to approve or send back.</p>';
  h += chores.length
    ? `<div class="card">${chores.map((c) => `<a class="list-row" href="${choreHref(c)}">
        <div class="grow"><b>${esc(nameOf(c.personId))}</b> — ${esc(c.job)}
          <div class="muted small">${esc(whenLabel(c.date))} · submitted ${esc(fmtTime(c.submittedAt))}</div></div>
        <span class="chev">›</span></a>`).join('')}</div>`
    : '<div class="card"><div class="empty"><span class="big">✓</span>Nothing waiting — all caught up.</div></div>';
  paint(seq, h);
}

// ============================================================
// Screen 5 — Add / edit chore (adults)
// ============================================================
async function viewChoreForm(date, id) {
  const seq = state.seq;
  if (!isAdult()) { main.innerHTML = errorBlock('Only an adult can add or change chores.'); return; }
  loading();
  const [{ checklists }, existing] = await Promise.all([
    api('/checklists'),
    id ? api(`/chore?date=${encodeURIComponent(date)}&id=${encodeURIComponent(id)}`) : null,
  ]);
  const c = existing?.chore || { job: '', personId: '', date: today(), checklist: [] };
  const t = today();
  let h = backLink(id ? `#/chore/${date}/${id}` : '#/chores', '‹ Cancel');
  h += `<h1>${id ? 'Edit chore' : 'Add a one-off chore'}</h1>
  <form class="card" data-form novalidate>
    <label class="field">What
      <input type="text" name="job" maxlength="80" value="${esc(c.job)}" placeholder="e.g. Clean out the fridge" autocomplete="off"></label>
    <div class="field" style="margin-bottom:14px"><span style="font-family:var(--head);font-weight:600">Who</span>
      <div class="chips" data-who>${sortedPeople().map((p) => `<button type="button" class="chip${p.id === c.personId ? ' on' : ''}" data-id="${esc(p.id)}">${esc(p.name)}</button>`).join('')}</div></div>
    <div class="field" style="margin-bottom:14px"><span style="font-family:var(--head);font-weight:600">When</span>
      <div class="chips" data-when>
        <button type="button" class="chip" data-d="${t}">Today</button>
        <button type="button" class="chip" data-d="${addDays(t, 1)}">Tomorrow</button>
      </div>
      <input type="date" name="when" value="${esc(c.date)}"></div>
    <label class="field">Checklist <span class="hint">(optional — one step per line)</span>
      <select name="saved"><option value="">Use a saved checklist…</option>${Object.keys(checklists).map((k) => `<option>${esc(k)}</option>`).join('')}</select>
      <textarea name="checklist" placeholder="e.g. Take everything out&#10;Wipe the shelves&#10;Throw out old food">${esc((c.checklist || []).join('\n'))}</textarea></label>
    <button class="btn" type="submit">Save</button>
  </form>`;
  if (!paint(seq, h)) return;

  const form = $('[data-form]', main);
  let who = c.personId;
  $('[data-who]', form).onclick = (e) => {
    const b = e.target.closest('.chip');
    if (!b) return;
    who = b.dataset.id;
    $$('[data-who] .chip', form).forEach((x) => x.classList.toggle('on', x === b));
  };
  const syncWhen = () => $$('[data-when] .chip', form).forEach((x) => x.classList.toggle('on', x.dataset.d === form.when.value));
  syncWhen();
  $('[data-when]', form).onclick = (e) => { const b = e.target.closest('.chip'); if (b) { form.when.value = b.dataset.d; syncWhen(); } };
  form.when.onchange = syncWhen;
  form.saved.onchange = () => {
    const list = checklists[form.saved.value];
    if (list) {
      form.checklist.value = list.join('\n');
      if (!form.job.value.trim()) form.job.value = form.saved.value;
    }
  };
  form.onsubmit = async (e) => {
    e.preventDefault();
    if (!form.job.value.trim()) { toast('Type what the chore is.', true); form.job.focus(); return; }
    if (!who) { toast('Pick who it’s for.', true); return; }
    if (!form.when.value) { toast('Pick a day.', true); return; }
    const btn = $('button[type=submit]', form);
    btn.disabled = true;
    btn.textContent = 'Saving…';
    try {
      const r = await api('/chore/save', {
        id, date, job: form.job.value, personId: who, when: form.when.value,
        checklist: form.checklist.value.split('\n'),
      });
      toast(id ? 'Saved' : `Added for ${nameOf(who)}`);
      location.replace(choreHref(r.chore));
    } catch (err) {
      toast(err.message, true);
      btn.disabled = false;
      btn.textContent = 'Save';
    }
  };
}

// ============================================================
// Screen 6 — Calendar
// ============================================================
const events = new Map(); // last loaded events, by id (used by the detail + edit screens)
const cal = { month: null, day: null };

const isoOf = (s) => fromStr(s).toISOString(); // local midnight
async function loadEvents(fromDay, toDay) {
  const d = await api(`/calendar?timeMin=${encodeURIComponent(isoOf(fromDay))}&timeMax=${encodeURIComponent(isoOf(toDay))}`);
  d.events.forEach((e) => events.set(e.id, e));
  return d;
}
const startMs = (e) => (e.allDay ? fromStr(e.start).getTime() : new Date(e.start).getTime());
const endMs = (e) => (e.end ? (e.allDay ? fromStr(e.end).getTime() : new Date(e.end).getTime()) : startMs(e) + (e.allDay ? 86400e3 : 0));
function eventDays(e) {
  if (!e.allDay) return [toStr(new Date(e.start))];
  const days = [e.start];
  for (let d = addDays(e.start, 1); e.end && d < e.end && days.length < 62; d = addDays(d, 1)) days.push(d);
  return days;
}
const eventsOn = (list, day) => list.filter((e) => eventDays(e).includes(day))
  .sort((a, b) => (b.allDay - a.allDay) || startMs(a) - startMs(b));
const fmtClock = (ms) => new Date(ms).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' });
const hhmm = (ms) => { const d = new Date(ms); return `${pad(d.getHours())}:${pad(d.getMinutes())}`; };
const eventTime = (e) => (e.allDay ? 'All day' : fmtClock(startMs(e)));
function eventRange(e) {
  if (e.allDay) {
    const days = eventDays(e);
    return days.length > 1 ? `All day, ${fmtShort(days[0])} – ${fmtShort(days[days.length - 1])}` : `All day, ${fmtDay(e.start)}`;
  }
  return `${fmtDay(toStr(new Date(e.start)))} · ${fmtClock(startMs(e))}${e.end ? ` – ${fmtClock(endMs(e))}` : ''}`;
}
const sourceLabel = (e) => (e.source === 'ical' ? `🔒 ${e.feedLabel} (read-only)` : 'Family calendar');

async function viewCalendar() {
  const seq = state.seq;
  const t = today();
  cal.day ||= t;
  cal.month ||= cal.day.slice(0, 8) + '01';
  const month = cal.month;
  const gridStart = addDays(month, -fromStr(month).getDay()); // calendar weeks start on Sunday
  const gridEnd = addDays(gridStart, 42);
  loading();
  const d = await loadEvents(gridStart, gridEnd);
  if (!isLive(seq)) return;
  const byDay = {};
  for (const e of d.events) for (const day of eventDays(e)) (byDay[day] ||= []).push(e);

  let notices = '';
  if (!d.google.connected) {
    notices += `<div class="card notice">${d.google.needsReconnect ? 'Google Calendar needs to be reconnected.' : 'Google Calendar isn’t connected yet.'}
      ${isAdult() ? '<a class="link-arrow" href="#/settings/calendar">Connect ›</a>' : 'Ask an adult to connect it in Settings.'}</div>`;
  }
  if (d.google.error) notices += `<div class="error-box" style="margin-bottom:14px">${esc(d.google.error)}</div>`;
  if (d.feedErrors.length) notices += `<div class="error-box" style="margin-bottom:14px">Couldn’t load: ${esc(d.feedErrors.join(', '))}. Showing everything else.</div>`;

  function draw() {
    const monthName = fromStr(month).toLocaleDateString('en-US', { month: 'long', year: 'numeric' });
    let cells = '';
    const m0 = fromStr(month);
    const daysInMonth = new Date(m0.getFullYear(), m0.getMonth() + 1, 0).getDate();
    const shown = Math.ceil((m0.getDay() + daysInMonth) / 7) * 7; // only the weeks this month needs
    for (let i = 0; i < shown; i++) {
      const day = addDays(gridStart, i);
      const evs = byDay[day] || [];
      const cls = ['cal-cell', day.slice(0, 7) !== month.slice(0, 7) && 'other', day === t && 'today', day === cal.day && 'selected'].filter(Boolean).join(' ');
      cells += `<button class="${cls}" data-day="${day}" aria-label="${esc(fmtDay(day))}${evs.length ? `, ${plural(evs.length, 'event', 'events')}` : ''}">
        <span class="num">${Number(day.slice(8))}</span>
        <span class="bars">${evs.slice(0, 3).map((e) => `<span class="bar ${e.source}"></span>`).join('')}</span>
        ${evs.length > 3 ? `<span class="more">+${evs.length - 3}</span>` : ''}</button>`;
    }
    const list = eventsOn(d.events, cal.day);
    paint(seq, `<h1>Calendar</h1>${notices}
      <div class="card cal">
        <div class="week-nav"><button data-month="-1" aria-label="Previous month">‹</button>
          <div class="label">${esc(monthName)}</div>
          <button data-month="1" aria-label="Next month">›</button></div>
        <div class="cal-wd">${['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'].map((w) => `<span>${w}</span>`).join('')}</div>
        <div class="cal-grid">${cells}</div>
        <div class="legend"><span><span class="bar google"></span> Family calendar</span><span><span class="bar ical"></span> Subscriptions (read-only)</span></div>
      </div>
      ${d.google.connected ? `<a class="btn" href="#/event-new?date=${cal.day}" style="margin:0 0 14px">+ Add event</a>` : ''}
      <div class="card"><h2>${esc(cal.day === t ? 'Today' : fmtDay(cal.day))}</h2>
        ${list.length ? list.map((e) => `<button class="ev-row" data-ev="${esc(e.id)}">
            <span class="ev-time">${esc(eventTime(e))}</span>
            <span class="grow"><span class="ev-title"><span class="ev-dot ${e.source}"></span>${esc(e.title)}</span>
              <span class="muted small" style="display:block">${esc(sourceLabel(e))}</span></span>
            <span class="chev">›</span></button>`).join('')
          : '<div class="empty">Nothing on the calendar this day.</div>'}
      </div>`);
  }
  draw();

  main.onclick = (e) => {
    if (state.page !== 'calendar') return;
    const cell = e.target.closest('[data-day]');
    const mon = e.target.closest('[data-month]');
    const ev = e.target.closest('[data-ev]');
    if (cell) {
      cal.day = cell.dataset.day;
      if (cal.day.slice(0, 7) !== month.slice(0, 7)) { cal.month = cal.day.slice(0, 8) + '01'; route(); } else draw();
    } else if (mon) {
      const m = fromStr(month);
      m.setMonth(m.getMonth() + Number(mon.dataset.month));
      cal.month = toStr(m);
      cal.day = cal.month.slice(0, 7) === t.slice(0, 7) ? t : cal.month;
      route();
    } else if (ev) {
      showEvent(events.get(ev.dataset.ev));
    }
  };
}

function showEvent(e) {
  if (!e) return;
  const google = e.source === 'google';
  const m = openModal(`<h2>${esc(e.title)}</h2>
    <p class="muted">${esc(eventRange(e))}</p>
    ${e.location ? `<p>📍 ${esc(e.location)}</p>` : ''}
    ${e.notes ? `<p style="white-space:pre-wrap">${esc(e.notes)}</p>` : ''}
    <p><span class="pill ${google ? '' : 'ical'}">${esc(sourceLabel(e))}</span></p>
    ${e.addedBy ? `<p class="muted small">Added by ${esc(nameOf(e.addedBy))} in the app</p>` : ''}
    ${google ? `${e.recurring ? '<p class="muted small">This is a repeating event — changes here affect just this date.</p>' : ''}
      <div class="btn-row"><button class="btn secondary" data-edit>Edit</button><button class="btn danger" data-del>Delete</button></div>`
    : '<p class="muted small">Subscription calendars can’t be changed from the app.</p>'}
    <button class="btn ghost" data-no>Close</button>`);
  m.onclick = async (ev) => {
    if (ev.target.closest('[data-no]') || ev.target === m) return closeModal();
    if (ev.target.closest('[data-edit]')) { closeModal(); location.hash = `#/event-edit/${encodeURIComponent(e.id)}`; return; }
    if (!ev.target.closest('[data-del]')) return;
    const ok = await confirmBox({
      title: 'Are you sure?',
      text: `This removes “${e.title}” from the family Google Calendar too.`,
      yes: 'Yes, delete it', danger: true,
    });
    if (!ok) return;
    try {
      await api('/calendar/delete', { id: e.id });
      events.delete(e.id);
      toast('Event deleted');
      route();
    } catch (err) { toast(err.message, true); }
  };
}

async function viewEventForm(id) {
  const seq = state.seq;
  const e = id ? events.get(id) : null;
  if (id && (!e || e.source !== 'google')) { location.replace('#/calendar'); return; }
  const date = e ? (e.allDay ? e.start : toStr(new Date(e.start))) : (state.query.get('date') || cal.day || today());
  const allDay = e ? e.allDay : false;
  const time = e && !e.allDay ? hhmm(startMs(e)) : '18:00';
  const endTime = e && !e.allDay && e.end ? hhmm(endMs(e)) : '';
  paint(seq, `${backLink('#/calendar', '‹ Cancel')}
    <h1>${e ? 'Edit event' : 'Add event'}</h1>
    <p class="muted">Saves to the family Google Calendar, so everyone sees it.</p>
    <form class="card" data-f novalidate>
      <label class="field">Title<input type="text" name="title" maxlength="120" value="${esc(e?.title || '')}" placeholder="e.g. Soccer practice" autocomplete="off"></label>
      <label class="field">Date<input type="date" name="date" value="${esc(date)}"></label>
      <label class="field check-field"><input type="checkbox" name="allDay" ${allDay ? 'checked' : ''}> All day</label>
      <div data-times ${allDay ? 'hidden' : ''}>
        <div class="btn-row">
          <label class="field" style="flex:1">Starts<input type="time" name="time" value="${esc(time)}"></label>
          <label class="field" style="flex:1">Ends <span class="hint">(optional)</span><input type="time" name="endTime" value="${esc(endTime)}"></label>
        </div>
      </div>
      <label class="field">Notes <span class="hint">(optional)</span><textarea name="notes" maxlength="1000">${esc(e?.notes || '')}</textarea></label>
      <button class="btn" type="submit">${e ? 'Save' : 'Add to calendar'}</button>
    </form>`);
  const f = $('[data-f]', main);
  if (!f) return;
  f.allDay.onchange = () => ($('[data-times]', f).hidden = f.allDay.checked);
  f.onsubmit = async (ev) => {
    ev.preventDefault();
    if (!f.title.value.trim()) { toast('Give the event a title.', true); f.title.focus(); return; }
    if (!f.date.value) { toast('Pick a date.', true); return; }
    if (!f.allDay.checked && !f.time.value) { toast('Pick a start time, or choose All day.', true); return; }
    const btn = $('button[type=submit]', f);
    btn.disabled = true;
    btn.textContent = 'Saving…';
    try {
      const body = { id, title: f.title.value, date: f.date.value, allDay: f.allDay.checked, time: f.time.value, endTime: f.endTime.value, notes: f.notes.value };
      await api(e ? '/calendar/update' : '/calendar/add', body);
      toast(e ? 'Saved' : 'Added to the family calendar');
      cal.day = f.date.value;
      cal.month = f.date.value.slice(0, 8) + '01';
      location.replace('#/calendar');
    } catch (err) {
      toast(err.message, true);
      btn.disabled = false;
      btn.textContent = e ? 'Save' : 'Add to calendar';
    }
  };
}

// ============================================================
// Screen 7 — Groceries
// ============================================================
async function viewGroceries({ focus = false } = {}) {
  const seq = state.seq;
  loading();
  const { open, bought } = await api('/groceries');
  let h = `<h1>Groceries</h1>
    <form class="card add-bar" data-add>
      <input type="text" name="item" maxlength="80" placeholder="Add an item (e.g. milk)" autocomplete="off" enterkeyhint="done" aria-label="New grocery item">
      <button class="btn" type="submit">Add</button>
    </form>
    <div class="card">
      <div class="card-head"><h2>On the list${open.length ? ` (${open.length})` : ''}</h2>
        ${open.length ? '<button class="btn small secondary" data-copy>Copy list</button>' : ''}</div>
      ${open.length
        ? open.map((i) => `<div class="g-row">
            <button class="g-check" data-check="${esc(i.id)}" data-name="${esc(i.name)}" aria-label="Check off ${esc(i.name)}"></button>
            <div class="g-name">${esc(i.name)}<div class="g-meta">Added by ${esc(nameOf(i.addedBy))}</div></div>
            <button class="x-btn" data-remove="${esc(i.id)}" data-name="${esc(i.name)}" aria-label="Remove ${esc(i.name)} from the list">✕</button>
          </div>`).join('')
        : '<div class="empty">List is empty — add the first item.</div>'}
    </div>
    <details class="card"${store.get('localStorage', 'fhq_bought_open') === '1' ? ' open' : ''}>
      <summary>Bought${bought.length ? ` (${bought.length === 40 ? 'latest 40' : bought.length})` : ''}</summary>
      ${bought.length
        ? '<p class="muted small">Tap one to put it back on the list.</p>' + bought.map((i) => `<button class="bought-row" data-readd="${esc(i.name)}">
            <span class="g-check done" aria-hidden="true">✓</span>
            <span class="g-name"><s>${esc(i.name)}</s><span class="g-meta" style="display:block">${esc(nameOf(i.boughtBy))} · ${esc(fmtTime(i.boughtAt))}</span></span>
            <span class="readd">+ Add again</span></button>`).join('')
        : '<p class="muted">Nothing bought yet.</p>'}
    </details>`;
  if (!paint(seq, h)) return;

  const addForm = $('[data-add]', main);
  if (focus) addForm.item.focus();
  addForm.onsubmit = async (e) => {
    e.preventDefault();
    const name = addForm.item.value.trim();
    if (!name) { addForm.item.focus(); return; }
    const btn = $('button', addForm);
    btn.disabled = true;
    try {
      const r = await api('/groceries/add', { name });
      toast(r.alreadyOnList ? `${r.item.name} is already on the list` : `Added ${name}`);
      state.seq += 1;
      await viewGroceries({ focus: true });
    } catch (err) {
      toast(err.message, true);
      btn.disabled = false;
    }
  };
  $('details', main).ontoggle = (e) => store.set('localStorage', 'fhq_bought_open', e.target.open ? '1' : '0');

  main.onclick = async (e) => {
    if (state.page !== 'groceries') return;
    const check = e.target.closest('[data-check]');
    const remove = e.target.closest('[data-remove]');
    const readd = e.target.closest('[data-readd]');
    const copy = e.target.closest('[data-copy]');
    try {
      if (check) {
        check.disabled = true;
        check.classList.add('done');
        check.textContent = '✓';
        await api('/groceries/check', { id: check.dataset.check });
        toast(`${check.dataset.name} checked off`);
      } else if (remove) {
        const ok = await confirmBox({ title: 'Are you sure?', text: `Take “${remove.dataset.name}” off the list without buying it?`, yes: 'Yes, remove it', danger: true });
        if (!ok) return;
        await api('/groceries/remove', { id: remove.dataset.remove });
        toast(`Removed ${remove.dataset.name}`);
      } else if (readd) {
        readd.disabled = true;
        const r = await api('/groceries/add', { name: readd.dataset.readd });
        toast(r.alreadyOnList ? `${r.item.name} is already on the list` : `${readd.dataset.readd} is back on the list`);
      } else if (copy) {
        return copyList(open.map((i) => i.name).join('\n'));
      } else return;
    } catch (err) {
      toast(err.message, true);
    }
    state.seq += 1;
    viewGroceries();
  };
}

async function copyList(text) {
  if (navigator.share && matchMedia('(pointer: coarse)').matches) {
    try { await navigator.share({ title: 'Grocery list', text }); return; } catch (e) { if (e.name === 'AbortError') return; }
  }
  try {
    await navigator.clipboard.writeText(text);
    toast('List copied — paste it anywhere');
  } catch {
    const m = openModal(`<h2>Grocery list</h2><p class="muted">Select all and copy:</p><textarea readonly>${esc(text)}</textarea><button class="btn" data-no>Done</button>`);
    $('textarea', m).select();
    m.onclick = (e) => { if (e.target.closest('[data-no]') || e.target === m) closeModal(); };
  }
}

// ============================================================
// Screen 8 — Settings
// ============================================================
async function viewSettings(sub) {
  const seq = state.seq;
  const adult = isAdult();
  if (!sub) {
    paint(seq, `<h1>Settings</h1>
      <div class="card settings-list">
        <a href="#/settings/code"><span>Change my code</span><span class="chev">›</span></a>
        ${adult ? `<a href="#/settings/reset"><span>Reset someone’s code</span><span class="chev">›</span></a>
        <a href="#/settings/names"><span>Family names</span><span class="chev">›</span></a>
        <a href="#/settings/chart"><span>Weekly chore chart</span><span class="chev">›</span></a>
        <a href="#/settings/jobs"><span>Jobs &amp; checklists</span><span class="chev">›</span></a>
        <a href="#/settings/household"><span>App name</span><span class="chev">›</span></a>
        <a href="#/settings/calendar"><span>Google Calendar connection</span><span class="chev">›</span></a>
        <a href="#/settings/feeds"><span>Calendar subscriptions (iCal)</span><span class="chev">›</span></a>` : ''}
      </div>
      <div class="card"><h3>Notifications</h3><p class="muted">Chore-time notifications are coming in a later step.</p></div>
      <div class="card"><h3>About</h3><p>Keep this app’s link private — don’t post it anywhere public. The link plus each person’s code is what keeps the app safe.</p>
        <p class="muted small" data-version>Version ${esc(state.config?.version || '')}</p></div>`);
    if (adult) api('/version').then((v) => {
      const el = $('[data-version]', main);
      if (!el || !isLive(seq)) return;
      el.innerHTML = v.updateAvailable
        ? `<b>Version ${esc(v.latest)} is out</b> (you have ${esc(v.version)}). ${esc(v.notes || '')}<br>
           To update: open your copy of the app on GitHub and tap <b>Sync fork → Update branch</b>. Netlify updates the app in about a minute. Your family’s data stays put.`
        : `Version ${esc(v.version)}${v.latest ? ' · up to date' : ''}`;
    }).catch(() => {});
    return;
  }
  if (sub !== 'code' && !adult) { location.hash = '#/settings'; return; }
  const views = { code: settingsCode, reset: settingsReset, names: settingsNames, chart: settingsChart, jobs: settingsJobs, household: settingsHousehold, feeds: settingsFeeds, calendar: settingsCalendar };
  return (views[sub] || (() => (location.hash = '#/settings')))(seq);
}

const pinInput = (name, label) => `<label class="field">${label}
  <input type="password" name="${name}" inputmode="numeric" pattern="[0-9]*" maxlength="4" autocomplete="off"></label>`;

function settingsCode(seq) {
  paint(seq, `${backLink('#/settings')}<h1>Change my code</h1>
    <form class="card" data-f>
      ${pinInput('old', 'Your current code')}
      ${pinInput('n1', 'New code (4 numbers)')}
      ${pinInput('n2', 'New code again')}
      <button class="btn" type="submit">Change my code</button>
    </form>`);
  const f = $('[data-f]', main);
  f.onsubmit = async (e) => {
    e.preventDefault();
    if (!/^\d{4}$/.test(f.n1.value)) return toast('Your new code needs to be 4 numbers.', true);
    if (f.n1.value !== f.n2.value) return toast("The new codes don't match.", true);
    try {
      await api('/change-code', { oldCode: f.old.value, newCode: f.n1.value });
      toast('Code changed');
      location.hash = '#/settings';
    } catch (err) { toast(err.message, true); }
  };
}

function settingsReset(seq) {
  const others = sortedPeople().filter((p) => p.id !== state.me.id);
  paint(seq, `${backLink('#/settings')}<h1>Reset a code</h1>
    <p class="muted">Use this if someone forgets their code. Their old code stops working, and they create a new one next time they sign in.</p>
    <form class="card" data-f>
      <label class="field">Whose code?
        <select name="who"><option value="">Pick a name…</option>${others.map((p) => `<option value="${esc(p.id)}">${esc(p.name)}</option>`).join('')}</select></label>
      ${pinInput('mine', `Your own code, ${esc(state.me.name)}, to confirm`)}
      <button class="btn pink" type="submit">Reset their code</button>
    </form>`);
  const f = $('[data-f]', main);
  f.onsubmit = async (e) => {
    e.preventDefault();
    if (!f.who.value) return toast('Pick a name first.', true);
    const who = nameOf(f.who.value);
    const ok = await confirmBox({ title: `Reset ${who}’s code?`, text: `${who}’s old code will stop working right away.`, yes: 'Yes, reset it', danger: true });
    if (!ok) return;
    try {
      await api('/reset-code', { personId: f.who.value, adultCode: f.mine.value });
      const p = state.people.find((x) => x.id === f.who.value);
      if (p) p.hasCode = false;
      toast(`Done — ${who} will create a new code next time`);
      location.hash = '#/settings';
    } catch (err) { toast(err.message, true); f.mine.value = ''; }
  };
}

async function settingsNames(seq) {
  state.people = await api('/people');
  if (!paint(seq, `${backLink('#/settings')}<h1>Family names</h1>
    <div class="card">${sortedPeople().map((p) => `<div class="list-row">
        <div class="grow"><b>${esc(p.name)}</b> <span class="tag-adult">${p.role === 'adult' ? 'Adult' : 'Kid'}</span></div>
        <button class="btn small secondary" data-rename="${esc(p.id)}">Rename</button></div>`).join('')}</div>
    <form class="card" data-f><h2>Add someone</h2>
      <label class="field">First name<input type="text" name="name" maxlength="30" autocomplete="off"></label>
      <div class="chips" data-role style="margin-bottom:4px"><button type="button" class="chip on" data-r="kid">Kid</button><button type="button" class="chip" data-r="adult">Adult (can review)</button></div>
      <button class="btn" type="submit">Add</button>
    </form>`)) return;
  let role = 'kid';
  $('[data-role]', main).onclick = (e) => {
    const b = e.target.closest('.chip');
    if (!b) return;
    role = b.dataset.r;
    $$('[data-role] .chip', main).forEach((x) => x.classList.toggle('on', x === b));
  };
  $$('[data-rename]', main).forEach((b) => (b.onclick = async () => {
    const p = state.people.find((x) => x.id === b.dataset.rename);
    const name = await promptBox({ title: `Rename ${p.name}`, label: 'New name', value: p.name });
    if (!name || name === p.name) return;
    try {
      await api('/people/rename', { personId: p.id, name });
      if (p.id === state.me.id) { state.me.name = name; $('#top small').textContent = name; }
      toast('Renamed');
      route();
    } catch (err) { toast(err.message, true); }
  }));
  const f = $('[data-f]', main);
  f.onsubmit = async (e) => {
    e.preventDefault();
    try {
      await api('/people/add', { name: f.name.value, role });
      toast(`Added ${f.name.value.trim()}`);
      route();
    } catch (err) { toast(err.message, true); }
  };
}

const CONNECT_RESULTS = (cal) => ({
  connected: ['ok', 'Connected! Family events now show on the Calendar.'],
  not_found: ['err', `Couldn’t find a calendar named “${cal}” in that Google account. Check the name below matches your Google calendar exactly, and that you picked the right account.`],
  read_only: ['err', `That Google account can only view “${cal}”, not add to it. Use the account that owns it.`],
  cancelled: ['err', 'Google sign-in was cancelled — nothing changed.'],
  expired: ['err', 'That took a little too long — tap Connect to try again.'],
  failed: ['err', 'Couldn’t finish connecting to Google — try again.'],
});

async function settingsCalendar(seq) {
  const [s, hh] = await Promise.all([api('/google/status'), api('/household')]);
  const result = CONNECT_RESULTS(hh.calendarName)[state.query.get('result')];
  let body;
  if (!s.configured) {
    body = '<p>Google sign-in isn’t set up on the server yet. This needs the one-time Google Cloud setup.</p>';
  } else if (s.connected) {
    body = `<p>Connected to <b>${esc(s.calendarName)}</b>.</p>
      <p class="muted">Events added in the app go only to this calendar — never to your other Google calendars.</p>
      <button class="btn danger" data-disconnect>Disconnect</button>`;
  } else {
    body = `${s.needsReconnect ? '<p><b>Google stopped accepting the old connection.</b> Connect again to fix it.</p>' : ''}
      <p>Sign in with the Google account that has the calendar named <b>${esc(hh.calendarName)}</b>. The app only uses that one calendar.</p>
      <p class="muted small">Different name? <a href="#/settings/household">Change it here</a> first.</p>
      <button class="btn" data-connect>Connect Google Calendar</button>`;
  }
  if (!paint(seq, `${backLink('#/settings')}<h1>Google Calendar</h1>
    ${result ? `<div class="${result[0] === 'ok' ? 'card notice ok' : 'error-box'}" style="margin-bottom:14px">${esc(result[1])}</div>` : ''}
    <div class="card">${body}</div>`)) return;
  const c = $('[data-connect]', main);
  if (c) c.onclick = async () => {
    c.disabled = true;
    try { location.href = (await api('/google/start', {})).url; } catch (err) { toast(err.message, true); c.disabled = false; }
  };
  const dc = $('[data-disconnect]', main);
  if (dc) dc.onclick = async () => {
    if (!(await confirmBox({ title: 'Disconnect Google Calendar?', text: 'Family events will stop showing in the app until an adult connects it again. Nothing is deleted from Google.', yes: 'Yes, disconnect', danger: true }))) return;
    try { await api('/google/disconnect', {}); toast('Disconnected'); if (location.hash === '#/settings/calendar') route(); else location.replace('#/settings/calendar'); } catch (err) { toast(err.message, true); }
  };
}

async function settingsFeeds(seq) {
  const { feeds } = await api('/feeds');
  if (!paint(seq, `${backLink('#/settings')}<h1>Calendar subscriptions</h1>
    <p class="muted">School calendars, sports schedules and other .ics / webcal links. They show on the Calendar for everyone, read-only.</p>
    <div class="card">${feeds.length ? feeds.map((f) => `<div class="list-row">
        <div class="grow"><b>${esc(f.label)}</b><div class="muted small" style="word-break:break-all">${esc(f.url)}</div></div>
        <button class="x-btn" data-del="${esc(f.id)}" data-label="${esc(f.label)}" aria-label="Remove ${esc(f.label)}">✕</button></div>`).join('')
      : '<div class="empty">No subscriptions yet.</div>'}</div>
    <form class="card" data-f><h2>Add a subscription</h2>
      <label class="field">Name<input type="text" name="label" maxlength="40" placeholder="e.g. School calendar" autocomplete="off"></label>
      <label class="field">Link<input type="url" name="url" placeholder="https://… or webcal://…" autocomplete="off"></label>
      <button class="btn" type="submit">Add</button></form>`)) return;
  $$('[data-del]', main).forEach((b) => (b.onclick = async () => {
    if (!(await confirmBox({ title: 'Are you sure?', text: `Remove “${b.dataset.label}” from the calendar?`, yes: 'Yes, remove it', danger: true }))) return;
    try { await api('/feeds/remove', { id: b.dataset.del }); toast('Removed'); route(); } catch (err) { toast(err.message, true); }
  }));
  const f = $('[data-f]', main);
  f.onsubmit = async (e) => {
    e.preventDefault();
    try { await api('/feeds/add', { label: f.label.value, url: f.url.value }); toast('Added'); route(); } catch (err) { toast(err.message, true); }
  };
}

async function settingsChart(seq) {
  const { chart, checklists } = await api('/chart');
  const days = structuredClone(chart.days);
  let dirty = false;
  const jobs = () => [...new Set([...Object.keys(checklists), ...days.flat().map((s) => s.job)])];
  const firstJob = () => jobs()[0] || 'Chore';

  function tally() {
    const n = new Map();
    days.forEach((slots) => new Set(slots.filter((s) => !s.quick).map((s) => s.personId)).forEach((id) => n.set(id, (n.get(id) || 0) + 1)));
    const ppl = sortedPeople().filter((p) => n.has(p.id) || p.role === 'kid');
    return ppl.map((p) => `<span>${esc(p.name)} · ${plural(n.get(p.id) || 0, 'night', 'nights')}</span>`).join('');
  }

  function draw() {
    const people = sortedPeople();
    const y = window.scrollY;
    paint(seq, `${backLink('#/settings')}<h1>Weekly chore chart</h1>
      <p class="muted">Change who does what on each night. Changes apply to nights that haven’t started yet. To change just one night, edit that chore instead.</p>
      <div class="card"><h3>Chore nights this week</h3><div class="tally">${tally()}</div>
        <div class="btn-row" style="margin-top:12px">
          <button class="btn small secondary" data-rotate>Build a fair rotation</button>
          <a class="btn small ghost" href="#/settings/jobs">Edit jobs</a></div></div>
      ${days.map((slots, d) => `<div class="card"><div class="card-head"><h3>${DAY_NAMES[d]}</h3>
          ${slots.length ? `<button class="btn small ghost" data-copy="${d}">Copy to…</button>` : ''}</div>
        ${slots.map((s, i) => `<div class="slot-wrap"><div class="slot">
          <select data-d="${d}" data-i="${i}" data-k="personId" aria-label="Who">${people.map((p) => `<option value="${esc(p.id)}"${p.id === s.personId ? ' selected' : ''}>${esc(p.name)}</option>`).join('')}</select>
          <select data-d="${d}" data-i="${i}" data-k="job" aria-label="Job">${jobs().map((j) => `<option${j === s.job ? ' selected' : ''}>${esc(j)}</option>`).join('')}<option value="__other">Other…</option></select>
          <button class="x-btn" data-more="${d}:${i}" aria-label="More options for this job">⋯</button>
        </div>
        ${s.extras?.length || s.quick ? `<div class="slot-meta">${s.quick ? '⚡ Quick task (not a chore night)' : ''}${s.quick && s.extras?.length ? ' · ' : ''}${s.extras?.length ? `Plus: ${esc(s.extras.join('; '))}` : ''}</div>` : ''}
        </div>`).join('') || '<p class="muted">No jobs this night — a night off for everyone.</p>'}
        <button class="btn small ghost" data-add="${d}">+ Add a job</button></div>`).join('')}
      <div class="save-bar">${dirty ? '<p class="dirty-note">You have unsaved changes</p>' : ''}<button class="btn" data-save>Save chart</button></div>`);
    window.scrollTo(0, y);
  }
  const changed = () => { dirty = true; draw(); };

  // The "⋯" sheet: move to another night, 2-minute add-ons, quick task, remove.
  function slotSheet(d, i) {
    const s = days[d][i];
    const m = openModal(`<h2>${esc(nameOf(s.personId))} · ${esc(s.job)}</h2>
      <p class="muted">${DAY_NAMES[d]}s</p>
      <label class="field">Move to
        <select name="day">${DAY_NAMES.map((n, x) => `<option value="${x}"${x === d ? ' selected' : ''}>${n}</option>`).join('')}</select></label>
      <label class="field">2-minute add-ons (one per line)
        <textarea name="extras" placeholder="e.g. Take the trash out to the curb">${esc((s.extras || []).join('\n'))}</textarea></label>
      <label class="check"><input type="checkbox" name="quick"${s.quick ? ' checked' : ''}> Quick task — doesn’t count as a chore night</label>
      <button class="btn" data-ok>Done</button>
      <button class="btn danger" data-rm>Remove from ${DAY_NAMES[d]}s</button>
      <button class="btn ghost" data-no>Cancel</button>`);
    m.onclick = async (e) => {
      if (e.target.closest('[data-ok]')) {
        s.extras = $('[name=extras]', m).value.split('\n').map((x) => x.trim()).filter(Boolean).slice(0, 5);
        s.quick = $('[name=quick]', m).checked;
        const to = Number($('[name=day]', m).value);
        if (to !== d) { days[d].splice(i, 1); days[to].push(s); toast(`Moved to ${DAY_NAMES[to]}`); }
        closeModal();
        changed();
      } else if (e.target.closest('[data-rm]')) {
        closeModal();
        if (!(await confirmBox({ title: 'Are you sure?', text: `Remove ${nameOf(s.personId)}’s ${s.job} from ${DAY_NAMES[d]}s?`, yes: 'Yes, remove it', danger: true }))) return;
        days[d].splice(i, 1);
        changed();
      } else if (e.target.closest('[data-no]') || e.target === m) closeModal();
    };
  }

  function copySheet(d) {
    const m = openModal(`<h2>Copy ${DAY_NAMES[d]}</h2>
      <p class="muted">Make other nights the same as ${DAY_NAMES[d]}. This replaces what’s on those nights.</p>
      <div class="chips">${DAY_NAMES.map((n, x) => (x === d ? '' : `<button type="button" class="chip" data-to="${x}">${n.slice(0, 3)}</button>`)).join('')}</div>
      <button class="btn" style="margin-top:16px" data-ok>Copy</button>
      <button class="btn ghost" data-no>Cancel</button>`);
    m.onclick = (e) => {
      const c = e.target.closest('[data-to]');
      if (c) return c.classList.toggle('on');
      if (e.target.closest('[data-ok]')) {
        const to = $$('[data-to].on', m).map((x) => Number(x.dataset.to));
        if (!to.length) return toast('Pick at least one night', true);
        to.forEach((x) => (days[x] = days[d].map((s) => ({ ...structuredClone(s), id: undefined }))));
        closeModal();
        changed();
      } else if (e.target.closest('[data-no]') || e.target === m) closeModal();
    };
  }

  function rotateSheet() {
    const kids = sortedPeople().filter((p) => p.role === 'kid');
    const pick = new Set((kids.length ? kids : sortedPeople()).map((p) => p.id));
    const nights = new Set(days.map((s, d) => (s.length ? d : -1)).filter((d) => d >= 0));
    if (!nights.size) DAY_NAMES.forEach((_, d) => nights.add(d));
    const jobPick = new Set(jobs().filter((j) => j in checklists));
    const chips = (items, set, key) => items.map(([v, label]) => `<button type="button" class="chip${set.has(v) ? ' on' : ''}" data-${key}="${esc(v)}">${esc(label)}</button>`).join('');
    const m = openModal(`<h2>Build a fair rotation</h2>
      <p class="muted">We’ll share the jobs out and shift them each night so everyone gets a turn. <b>This replaces the whole chart</b> — you can still fine-tune it after.</p>
      <h3>Who does chores?</h3><div class="chips">${chips(sortedPeople().map((p) => [p.id, p.name]), pick, 'p')}</div>
      <h3 style="margin-top:12px">Which jobs, every chore night?</h3><div class="chips">${chips(jobs().map((j) => [j, j]), jobPick, 'j')}</div>
      <h3 style="margin-top:12px">Chore nights</h3><div class="chips">${chips(DAY_NAMES.map((n, d) => [String(d), n.slice(0, 3)]), new Set([...nights].map(String)), 'n')}</div>
      <button class="btn" style="margin-top:16px" data-ok>Build it</button>
      <button class="btn ghost" data-no>Cancel</button>`);
    m.onclick = (e) => {
      const c = e.target.closest('[data-p],[data-j],[data-n]');
      if (c) return c.classList.toggle('on');
      if (e.target.closest('[data-ok]')) {
        const who = $$('[data-p].on', m).map((x) => x.dataset.p);
        const js = $$('[data-j].on', m).map((x) => x.dataset.j);
        const ns = $$('[data-n].on', m).map((x) => Number(x.dataset.n));
        if (!who.length || !js.length || !ns.length) return toast('Pick at least one person, job and night', true);
        buildRotation(who, js, ns).forEach((slots, d) => (days[d] = slots.map((s) => ({ personId: s.who, job: s.job, extras: [], quick: false }))));
        closeModal();
        changed();
        toast('Rotation built — check it, then Save');
      } else if (e.target.closest('[data-no]') || e.target === m) closeModal();
    };
  }

  draw();
  main.onchange = async (e) => {
    const sel = e.target.closest('select[data-k]');
    if (!sel || state.page !== 'settings') return;
    const s = days[sel.dataset.d][sel.dataset.i];
    if (sel.value === '__other') {
      const name = await promptBox({ title: 'Job name', label: 'What’s the job?' });
      if (name) s.job = name;
    } else s[sel.dataset.k] = sel.value;
    changed();
  };
  main.onclick = async (e) => {
    if (state.page !== 'settings') return;
    const add = e.target.closest('[data-add]');
    const more = e.target.closest('[data-more]');
    const copy = e.target.closest('[data-copy]');
    if (add) {
      const kid = sortedPeople().find((p) => p.role === 'kid') || sortedPeople()[0];
      days[add.dataset.add].push({ personId: kid.id, job: firstJob(), extras: [] });
      changed();
    } else if (more) {
      const [d, i] = more.dataset.more.split(':').map(Number);
      slotSheet(d, i);
    } else if (copy) copySheet(Number(copy.dataset.copy));
    else if (e.target.closest('[data-rotate]')) rotateSheet();
    else if (e.target.closest('[data-save]')) {
      try {
        await api('/chart', { days });
        dirty = false;
        toast('Chart saved');
        location.hash = '#/settings';
      } catch (err) { toast(err.message, true); }
    } else if (dirty && e.target.closest('[data-back], a[href]')) {
      const link = e.target.closest('[data-back], a[href]');
      e.preventDefault();
      e.stopPropagation();
      if (await confirmBox({ title: 'Leave without saving?', text: 'Your chart changes will be lost.', yes: 'Leave', no: 'Stay here', danger: true })) {
        dirty = false;
        location.hash = link.dataset.back || link.getAttribute('href');
      }
    }
  };
}

// Jobs & checklists: rename, edit the steps, add, delete.
async function settingsJobs(seq) {
  const { chart, checklists } = await api('/chart');
  const list = Object.entries(checklists).map(([name, steps]) => ({ name, orig: name, steps: [...steps] }));
  const uses = (job) => chart.days.flat().filter((s) => s.job === job).length;
  function draw() {
    paint(seq, `${backLink('#/settings')}<h1>Jobs &amp; checklists</h1>
      <p class="muted">The checklist is what people tick off when they do the job. Changes show up on nights that haven’t started yet.</p>
      ${list.map((j, i) => `<div class="card"><div class="card-head"><h3>${esc(j.name)}</h3>
          <span><button class="btn small ghost" data-ren="${i}">Rename</button> <button class="x-btn" data-del="${i}" aria-label="Delete ${esc(j.name)}">✕</button></span></div>
        <label class="field">Checklist (one step per line)<textarea data-steps="${i}">${esc(j.steps.join('\n'))}</textarea></label>
        <p class="muted small">On the chart ${plural(uses(j.orig), 'time', 'times')} a week</p></div>`).join('') || '<p class="muted">No jobs yet.</p>'}
      <button class="btn ghost" data-addjob>+ Add a job</button>
      <div class="save-bar" style="margin-top:12px"><button class="btn" data-save>Save jobs</button></div>`);
  }
  draw();
  main.oninput = (e) => { const i = e.target.dataset.steps; if (i !== undefined) list[i].steps = e.target.value.split('\n').map((s) => s.trim()).filter(Boolean); };
  main.onchange = null;
  main.onclick = async (e) => {
    if (state.page !== 'settings') return;
    const ren = e.target.closest('[data-ren]');
    const del = e.target.closest('[data-del]');
    if (ren) {
      const j = list[ren.dataset.ren];
      const name = await promptBox({ title: `Rename ${j.name}`, label: 'New name', value: j.name });
      if (name) { j.name = name; draw(); }
    } else if (del) {
      const j = list[del.dataset.del];
      const n = uses(j.orig);
      if (!(await confirmBox({ title: `Delete ${j.name}?`, text: n ? `It’s on the chart ${plural(n, 'time', 'times')} a week — those will come off the chart too.` : '', yes: 'Yes, delete it', danger: true }))) return;
      list.splice(Number(del.dataset.del), 1);
      draw();
    } else if (e.target.closest('[data-addjob]')) {
      const name = await promptBox({ title: 'Add a job', label: 'Job name (e.g. Bedrooms, Yard, Dishes)', yes: 'Add' });
      if (name) { list.push({ name, orig: null, steps: [] }); draw(); }
    } else if (e.target.closest('[data-save]')) {
      const out = {};
      const renames = {};
      for (const j of list) {
        out[j.name] = j.steps;
        if (j.orig && j.orig !== j.name) renames[j.orig] = j.name;
      }
      try {
        await api('/checklists', { checklists: out, renames });
        toast('Jobs saved');
        location.hash = '#/settings';
      } catch (err) { toast(err.message, true); }
    }
  };
}

async function settingsHousehold(seq) {
  const h = await api('/household');
  if (!paint(seq, `${backLink('#/settings')}<h1>App name</h1>
    <form class="card" data-f>
      <label class="field">App name (shows at the top)<input type="text" name="name" maxlength="40" value="${esc(h.name)}" autocomplete="off"></label>
      <label class="field">Google calendar name<input type="text" name="cal" maxlength="80" value="${esc(h.calendarName)}" autocomplete="off"></label>
      <p class="muted small">The app only adds events to the Google calendar with exactly this name. Change it before you connect Google Calendar.</p>
      <button class="btn" type="submit">Save</button>
    </form>`)) return;
  const f = $('[data-f]', main);
  f.onsubmit = async (e) => {
    e.preventDefault();
    try {
      const r = await api('/household', { name: f.name.value, calendarName: f.cal.value });
      state.config.name = r.name;
      document.title = r.name;
      $('#top .brand').firstChild.textContent = r.name;
      toast('Saved');
      location.hash = '#/settings';
    } catch (err) { toast(err.message, true); }
  };
}

boot();
