'use strict';
/* Phone notifications: the service worker, turning them on/off for this phone,
   each person's choices, and (adults) the reminder times.
   Uses helpers from app.js — only inside functions. */

const push = {
  supported: () => 'serviceWorker' in navigator && 'PushManager' in window && 'Notification' in window,
  isIOS: () => /iphone|ipad|ipod/i.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1),
  installed: () => window.matchMedia?.('(display-mode: standalone)').matches || navigator.standalone === true,
  reg: null,
};

async function registerWorker() {
  if (!('serviceWorker' in navigator)) return null;
  try {
    push.reg = await navigator.serviceWorker.register('/sw.js');
    navigator.serviceWorker.addEventListener('message', (e) => { if (e.data?.go) location.href = e.data.go; });
  } catch { push.reg = null; }
  return push.reg;
}

async function currentSub() {
  if (!push.supported()) return null;
  const reg = push.reg || (await navigator.serviceWorker.ready);
  return reg.pushManager.getSubscription();
}

const b64ToBytes = (s) => {
  const b = atob(s.replace(/-/g, '+').replace(/_/g, '/') + '='.repeat((4 - (s.length % 4)) % 4));
  return Uint8Array.from(b, (c) => c.charCodeAt(0));
};

async function turnOnPush() {
  const perm = await Notification.requestPermission();
  if (perm !== 'granted') throw new Error(perm === 'denied' ? 'Notifications are blocked for this app. See the steps below to allow them.' : 'No problem — you can turn them on any time.');
  const reg = push.reg || (await registerWorker()) || (await navigator.serviceWorker.ready);
  const { publicKey } = await api('/push/key');
  let sub = await reg.pushManager.getSubscription();
  // keys change only if the app was reset; start fresh if this phone has an old one
  if (sub && b64u(sub.options?.applicationServerKey) !== publicKey) { await sub.unsubscribe(); sub = null; }
  if (!sub) sub = await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: b64ToBytes(publicKey) });
  await api('/push/subscribe', { subscription: sub.toJSON() });
  store.del('localStorage', 'fhq_push_hide');
}
const b64u = (buf) => (buf ? btoa(String.fromCharCode(...new Uint8Array(buf))).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '') : '');

async function turnOffPush() {
  const sub = await currentSub();
  if (!sub) return;
  await api('/push/unsubscribe', { endpoint: sub.endpoint }).catch(() => {});
  await sub.unsubscribe().catch(() => {});
}

// A small card on Home inviting people to turn notifications on (until they do, or hide it).
async function homePushCard() {
  const el = $('#home-push');
  if (!el || store.get('localStorage', 'fhq_push_hide') === '1') return;
  if (push.supported() && Notification.permission === 'granted' && (await currentSub())) return;
  if (!push.supported() && !push.isIOS()) return; // this browser can't, and it's not an iPhone
  el.innerHTML = `<div class="card notice"><div><b>🔔 Get a buzz at chore time</b>
      <div class="muted small">${isAdult() ? 'And when a chore is ready to review.' : 'And when your chore gets approved.'}</div></div>
    <span><a class="btn small" href="#/settings/notify">Turn on</a> <button class="x-btn" data-hide aria-label="Hide">✕</button></span></div>`;
  $('[data-hide]', el).onclick = (e) => { e.preventDefault(); store.set('localStorage', 'fhq_push_hide', '1'); el.innerHTML = ''; };
}

const IOS_STEPS = `<ol class="steps">
  <li>Tap the <b>Share</b> button <span aria-hidden="true">(the square with an arrow ↑)</span> at the bottom of Safari.</li>
  <li>Scroll down and tap <b>Add to Home Screen</b>, then <b>Add</b>.</li>
  <li>Close Safari and open the app <b>from the new icon</b> on your home screen.</li>
  <li>Sign in, then come back to <b>Settings → Notifications</b> and tap <b>Turn on</b>.</li></ol>
  <p class="muted small">iPhones only allow notifications from apps on the home screen (iOS 16.4 or newer).</p>`;

async function settingsNotify(seq) {
  const sub = push.supported() ? await currentSub().catch(() => null) : null;
  const st = await api('/push/status' + (sub ? `?endpoint=${encodeURIComponent(sub.endpoint)}` : ''));
  const onHere = !!sub && st.thisPhone === state.me.id && Notification.permission === 'granted';
  const otherPerson = sub && st.thisPhone && st.thisPhone !== state.me.id ? nameOf(st.thisPhone) : '';
  const adult = isAdult();
  const n = st.notify;
  const fmt12 = (t) => (t ? new Date(`2000-01-01T${t}`).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' }) : '');

  let phone;
  if (!push.supported()) {
    phone = push.isIOS() && !push.installed()
      ? `<h3>First, add this app to your home screen</h3>${IOS_STEPS}`
      : '<p>This browser can’t show notifications. Try Chrome on Android, or Safari on iPhone (from the home screen).</p>';
  } else if (Notification.permission === 'denied') {
    phone = `<p><b>Notifications are blocked for this app.</b></p>
      <p class="muted">${push.isIOS() ? 'Open your iPhone’s <b>Settings → Notifications</b>, find this app, and turn on <b>Allow Notifications</b>.'
        : 'Tap the icon next to the web address (or ⋮ → <b>Site settings</b>), set <b>Notifications</b> to <b>Allow</b>, then reload.'}</p>`;
  } else if (onHere) {
    phone = `<p class="notice ok card" style="margin:0 0 12px">✓ On for ${esc(state.me.name)} on this phone</p>
      <div class="btn-row"><button class="btn secondary" data-test>Send a test</button><button class="btn ghost" data-off>Turn off</button></div>`;
  } else {
    phone = `${otherPerson ? `<p class="muted">This phone is getting notifications for <b>${esc(otherPerson)}</b>. Turning on switches them to you.</p>` : ''}
      <p>Get a notification on this phone at chore time${adult ? ' and when a chore is ready to review' : ''}.</p>
      <button class="btn" data-on>Turn on notifications</button>`;
  }

  const P = st.prefs;
  const prefRow = (k, label) => `<label class="check"><input type="checkbox" data-pref="${k}"${P[k] ? ' checked' : ''}> ${label}</label>`;
  if (!paint(seq, `${backLink('#/settings')}<h1>Notifications</h1>
    <div class="card">${phone}</div>
    <div class="card"><h3>Tell me when…</h3>
      ${prefRow('chores', `It’s chore time${n.on ? ` (${esc(fmt12(n.choreTime))})` : ''}`)}
      ${prefRow('nudge', `My chore still isn’t done${n.on && n.nudgeTime ? ` (${esc(fmt12(n.nudgeTime))})` : ''}`)}
      ${prefRow('results', 'My chore is approved or sent back')}
      ${adult ? prefRow('reviews', 'A chore is ready for me to review') : ''}
      <p class="muted small">These apply to all of ${esc(state.me.name)}’s phones.</p></div>
    ${adult ? `<form class="card" data-times><h3>Reminder times (everyone)</h3>
      <label class="check"><input type="checkbox" name="on"${n.on ? ' checked' : ''}> Send chore reminders</label>
      <label class="field">Chore time<input type="time" name="choreTime" value="${esc(n.choreTime)}"></label>
      <label class="field">“Still not done” nudge <span class="muted small">(leave empty for none)</span><input type="time" name="nudgeTime" value="${esc(n.nudgeTime)}"></label>
      <label class="field">Time zone<input type="text" name="timeZone" value="${esc(n.timeZone)}" autocomplete="off"></label>
      <button type="button" class="btn small ghost" data-tz>Use this phone’s time zone</button>
      <button class="btn" type="submit" style="margin-top:12px">Save times</button></form>` : ''}`)) return;

  const again = () => route();
  const on = $('[data-on]', main);
  if (on) on.onclick = async () => {
    on.disabled = true;
    try { await turnOnPush(); toast('Notifications on'); again(); } catch (e) { toast(e.message, true); on.disabled = false; if (Notification.permission === 'denied') again(); }
  };
  const off = $('[data-off]', main);
  if (off) off.onclick = async () => { await turnOffPush(); toast('Notifications off on this phone'); again(); };
  const test = $('[data-test]', main);
  if (test) test.onclick = async () => {
    test.disabled = true;
    try { await api('/push/test', {}); toast('Sent — it should pop up in a few seconds'); } catch (e) { toast(e.message, true); }
    test.disabled = false;
  };
  main.onchange = async (e) => {
    const k = e.target.dataset?.pref;
    if (!k || state.page !== 'settings') return;
    try { await api('/push/prefs', { [k]: e.target.checked }); toast('Saved'); } catch (err) { toast(err.message, true); e.target.checked = !e.target.checked; }
  };
  const f = $('[data-times]', main);
  if (f) {
    $('[data-tz]', f).onclick = () => { f.timeZone.value = Intl.DateTimeFormat().resolvedOptions().timeZone; };
    f.onsubmit = async (e) => {
      e.preventDefault();
      try {
        await api('/notify-settings', { on: f.on.checked, choreTime: f.choreTime.value, nudgeTime: f.nudgeTime.value, timeZone: f.timeZone.value.trim() });
        toast('Saved');
        again();
      } catch (err) { toast(err.message, true); }
    };
  }
}
