// End-to-end test for phone notifications. Run with: npm test
// Plays the part of the phones: intercepts the push requests, checks the VAPID
// signature, and decrypts each message (RFC 8291) with the "phone's" private key.
import assert from 'node:assert/strict';
import { createECDH, createHmac, createDecipheriv, createPublicKey, verify, randomBytes } from 'node:crypto';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

const dir = mkdtempSync(path.join(tmpdir(), 'fhq-test-'));
process.env.CHQ_LOCAL = '1';
process.env.CHQ_DATA_DIR = dir;
process.env.UPDATE_CHECK_URL = 'off';
const { handle, runReminders } = await import('../server/app.mjs');

// ---------- fake phones ----------
const inbox = [];
let gone = new Set();
const phones = {};
function makePhone(name) {
  const ecdh = createECDH('prime256v1');
  const pub = ecdh.generateKeys();
  const auth = randomBytes(16);
  phones[name] = { ecdh, auth, endpoint: `https://push.test/${name}` };
  return { endpoint: phones[name].endpoint, keys: { p256dh: pub.toString('base64url'), auth: auth.toString('base64url') } };
}
const hmac = (k, d) => createHmac('sha256', k).update(d).digest();
function decrypt(phone, body) {
  const salt = body.subarray(0, 16);
  const idlen = body[20];
  const asPublic = body.subarray(21, 21 + idlen);
  const data = body.subarray(21 + idlen);
  const uaPublic = phone.ecdh.getPublicKey();
  const shared = phone.ecdh.computeSecret(asPublic);
  const ikm = hmac(hmac(phone.auth, shared), Buffer.concat([Buffer.from('WebPush: info\0'), uaPublic, asPublic, Buffer.from([1])]));
  const prk = hmac(salt, ikm);
  const cek = hmac(prk, Buffer.from('Content-Encoding: aes128gcm\0\x01')).subarray(0, 16);
  const nonce = hmac(prk, Buffer.from('Content-Encoding: nonce\0\x01')).subarray(0, 12);
  const d = createDecipheriv('aes-128-gcm', cek, nonce);
  d.setAuthTag(data.subarray(data.length - 16));
  const plain = Buffer.concat([d.update(data.subarray(0, data.length - 16)), d.final()]);
  assert.equal(plain[plain.length - 1], 2, 'last-record delimiter');
  return JSON.parse(plain.subarray(0, -1).toString());
}
function checkVapid(authz, endpoint) {
  const m = /^vapid t=([^.]+)\.([^.]+)\.([^,]+), k=(.+)$/.exec(authz);
  assert.ok(m, 'vapid header shape');
  const [, h, c, s, k] = m;
  const raw = Buffer.from(k, 'base64url');
  const key = createPublicKey({ key: { kty: 'EC', crv: 'P-256', x: raw.subarray(1, 33).toString('base64url'), y: raw.subarray(33).toString('base64url') }, format: 'jwk' });
  assert.ok(verify('sha256', Buffer.from(`${h}.${c}`), { key, dsaEncoding: 'ieee-p1363' }, Buffer.from(s, 'base64url')), 'vapid signature');
  const claims = JSON.parse(Buffer.from(c, 'base64url'));
  assert.equal(claims.aud, new URL(endpoint).origin);
  assert.ok(claims.exp > Date.now() / 1000);
}
const realFetch = globalThis.fetch;
globalThis.fetch = async (url, opts) => {
  if (!String(url).startsWith('https://push.test/')) return realFetch(url, opts);
  const name = String(url).split('/').pop();
  if (gone.has(name)) return new Response('', { status: 410 });
  assert.equal(opts.headers['content-encoding'], 'aes128gcm');
  checkVapid(opts.headers.authorization, url);
  inbox.push({ to: name, ...decrypt(phones[name], Buffer.from(opts.body)) });
  return new Response('', { status: 201 });
};

// ---------- helpers ----------
async function call(route, body, token) {
  const r = await handle(new Request('http://localhost/api' + route, {
    method: body ? 'POST' : 'GET',
    headers: { 'content-type': 'application/json', ...(token ? { authorization: 'Bearer ' + token } : {}) },
    body: body ? JSON.stringify(body) : undefined,
  }));
  const j = await r.json();
  if (!r.ok) throw new Error(`${route}: ${j.message}`);
  return j;
}
const take = () => inbox.splice(0);
const now = new Date();
const today = now.toISOString().slice(0, 10);
const dayIdx = (now.getUTCDay() + 6) % 7;
const hhmm = (d) => d.toISOString().slice(11, 16);
let failures = 0;
async function step(name, fn) {
  try { await fn(); console.log('  ✓', name); } catch (e) { failures++; console.log('  ✗', name, '\n   ', e.message); }
}

// ---------- the test ----------
const days = [[], [], [], [], [], [], []];
days[dayIdx] = [{ who: 'Leo', job: 'Kitchen' }];
await call('/setup', { household: 'Test HQ', people: [{ name: 'Ana', role: 'adult' }, { name: 'Leo', role: 'kid' }], jobs: { Kitchen: ['Wipe'] }, days, startDate: today, timeZone: 'UTC' });
const ana = (await call('/setup-code', { personId: 'ana', code: '1111' })).token;
const leo = (await call('/setup-code', { personId: 'leo', code: '2222' })).token;
await call('/push/subscribe', { subscription: makePhone('anaPhone') }, ana);
await call('/push/subscribe', { subscription: makePhone('leoPhone') }, leo);
const chore = (await call('/home?date=' + today, null, leo)).myChores[0];

console.log('Notifications');
await step('test button reaches the phone', async () => {
  await call('/push/test', {}, leo);
  const got = take();
  assert.equal(got.length, 1);
  assert.equal(got[0].to, 'leoPhone');
  assert.match(got[0].title, /It works/);
});
await step('adult hears when a chore is sent for review', async () => {
  await call('/chore/submit', { date: today, id: chore.id }, leo);
  const got = take();
  assert.deepEqual(got.map((m) => m.to), ['anaPhone']);
  assert.equal(got[0].title, 'Leo finished Kitchen');
  assert.equal(got[0].url, '/#/review');
});
await step('kid hears when it’s sent back, with the note', async () => {
  await call('/chore/review', { date: today, id: chore.id, decision: 'redo', note: 'Counters too' }, ana);
  const got = take();
  assert.equal(got[0].to, 'leoPhone');
  assert.equal(got[0].title, 'Kitchen needs another go');
  assert.equal(got[0].body, 'Counters too');
});
await step('chore-time reminder sends once per day', async () => {
  await call('/notify-settings', { choreTime: hhmm(new Date(Date.now() - 5 * 60000)), nudgeTime: '', timeZone: 'UTC' }, ana);
  await runReminders();
  await runReminders();
  const got = take();
  assert.equal(got.length, 1);
  assert.equal(got[0].title, 'Chore time, Leo!');
  assert.equal(got[0].body, 'Tonight: Kitchen');
});
await step('nudge goes out while the chore still needs doing', async () => {
  await call('/notify-settings', { nudgeTime: hhmm(new Date(Date.now() - 60000)) }, ana);
  await runReminders();
  const got = take();
  assert.equal(got.length, 1);
  assert.equal(got[0].title, 'Still to do: Kitchen');
});
await step('reminders more than 2 hours late are skipped', async () => {
  await call('/notify-settings', { choreTime: hhmm(new Date(Date.now() - 3 * 3600e3)), nudgeTime: '' }, ana);
  rmSync(path.join(dir, encodeURIComponent('push/sent/' + today + '/chores/leo') + '.json'), { force: true });
  await runReminders();
  assert.equal(take().length, 0);
});
await step('turning a choice off stops that kind', async () => {
  await call('/push/prefs', { results: false }, leo);
  await call('/chore/submit', { date: today, id: chore.id }, leo);
  take();
  await call('/chore/review', { date: today, id: chore.id, decision: 'approve' }, ana);
  assert.equal(take().length, 0);
});
await step('a shared phone moves to whoever turns it on', async () => {
  await call('/push/subscribe', { subscription: { endpoint: phones.leoPhone.endpoint, keys: { p256dh: phones.leoPhone.ecdh.getPublicKey().toString('base64url'), auth: phones.leoPhone.auth.toString('base64url') } } }, ana);
  const st = await call('/push/status?endpoint=' + encodeURIComponent(phones.leoPhone.endpoint), null, ana);
  assert.equal(st.thisPhone, 'ana');
});
await step('a phone that uninstalled the app is cleaned up', async () => {
  gone = new Set(['anaPhone', 'leoPhone']);
  await call('/push/test', {}, ana).catch(() => {});
  const st = await call('/push/status', null, ana);
  assert.equal(st.phones, 0);
});

rmSync(dir, { recursive: true, force: true });
console.log(failures ? `\n${failures} failed` : '\nAll passed');
process.exit(failures ? 1 : 0);
