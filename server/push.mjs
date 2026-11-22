// Phone notifications (Web Push), with no outside libraries.
// - Each install makes its own VAPID keys the first time they're needed (stored in the
//   data store), so families never have to set anything up.
// - Messages are encrypted for each phone (RFC 8291, aes128gcm) and signed (RFC 8292).
// - Subscriptions: push/sub/<hash of endpoint> = { endpoint, keys, personId, createdAt }
// - Preferences:   push/prefs/<personId>     = { chores, nudge, results, reviews } (all on by default)
import { createECDH, createHmac, createCipheriv, generateKeyPairSync, createPrivateKey, sign, randomBytes } from 'node:crypto';
import * as store from './store.mjs';
import { sha256 } from './codes.mjs';

export const PREF_DEFAULTS = { chores: true, nudge: true, results: true, reviews: true };
const b64u = (buf) => Buffer.from(buf).toString('base64url');
const fromB64u = (s) => Buffer.from(String(s), 'base64url');

// ---------- keys ----------
let vapidCache;
export async function vapid() {
  if (vapidCache) return vapidCache;
  let v = await store.get('push/vapid');
  if (!v) {
    const { privateKey } = generateKeyPairSync('ec', { namedCurve: 'prime256v1' });
    const jwk = privateKey.export({ format: 'jwk' });
    v = { publicKey: b64u(Buffer.concat([Buffer.from([4]), fromB64u(jwk.x), fromB64u(jwk.y)])), privateJwk: jwk, createdAt: Date.now() };
    await store.set('push/vapid', v);
  }
  vapidCache = v;
  return v;
}

function vapidHeader(endpoint, v) {
  const aud = new URL(endpoint).origin;
  const header = b64u(JSON.stringify({ typ: 'JWT', alg: 'ES256' }));
  const claims = b64u(JSON.stringify({
    aud,
    exp: Math.floor(Date.now() / 1000) + 12 * 3600,
    sub: process.env.URL || 'https://github.com/taniachandler/family-hq',
  }));
  const key = createPrivateKey({ key: v.privateJwk, format: 'jwk' });
  const sig = sign('sha256', Buffer.from(`${header}.${claims}`), { key, dsaEncoding: 'ieee-p1363' });
  return `vapid t=${header}.${claims}.${b64u(sig)}, k=${v.publicKey}`;
}

// ---------- encryption (RFC 8291) ----------
const hmac = (key, data) => createHmac('sha256', key).update(data).digest();

export function encrypt(payload, keys) {
  const uaPublic = fromB64u(keys.p256dh);
  const authSecret = fromB64u(keys.auth);
  const salt = randomBytes(16);
  const ecdh = createECDH('prime256v1');
  const asPublic = ecdh.generateKeys();
  const shared = ecdh.computeSecret(uaPublic);
  const prkKey = hmac(authSecret, shared);
  const ikm = hmac(prkKey, Buffer.concat([Buffer.from('WebPush: info\0'), uaPublic, asPublic, Buffer.from([1])]));
  const prk = hmac(salt, ikm);
  const cek = hmac(prk, Buffer.from('Content-Encoding: aes128gcm\0\x01')).subarray(0, 16);
  const nonce = hmac(prk, Buffer.from('Content-Encoding: nonce\0\x01')).subarray(0, 12);
  const cipher = createCipheriv('aes-128-gcm', cek, nonce);
  const body = Buffer.concat([cipher.update(Buffer.concat([Buffer.from(payload), Buffer.from([2])])), cipher.final(), cipher.getAuthTag()]);
  const rs = Buffer.alloc(4);
  rs.writeUInt32BE(4096);
  return Buffer.concat([salt, rs, Buffer.from([asPublic.length]), asPublic, body]);
}

// ---------- sending ----------
async function sendOne(sub, message, v) {
  const res = await fetch(sub.endpoint, {
    method: 'POST',
    headers: {
      authorization: vapidHeader(sub.endpoint, v),
      'content-encoding': 'aes128gcm',
      'content-type': 'application/octet-stream',
      ttl: String(message.ttl ?? 6 * 3600),
      urgency: 'normal',
      ...(message.tag ? { topic: message.tag.replace(/[^A-Za-z0-9_-]/g, '').slice(0, 32) } : {}),
    },
    body: encrypt(JSON.stringify({ title: message.title, body: message.body, url: message.url || '/', tag: message.tag }), sub.keys),
    signal: AbortSignal.timeout(6000),
  });
  if (res.status === 404 || res.status === 410) return 'gone';
  if (!res.ok) throw new Error(`push ${res.status} ${(await res.text().catch(() => '')).slice(0, 200)}`);
  return 'ok';
}

export const subKey = (endpoint) => 'push/sub/' + sha256(endpoint).slice(0, 24);

export async function allSubs() {
  return store.getMany(await store.list('push/sub/'));
}

export async function prefsFor(personId) {
  return { ...PREF_DEFAULTS, ...((await store.get('push/prefs/' + personId)) || {}) };
}

// Send to everyone in personIds who has the given kind turned on. Never throws.
export async function notify(personIds, kind, message) {
  try {
    const ids = new Set(personIds);
    if (!ids.size) return 0;
    const subs = (await allSubs()).filter((s) => ids.has(s.personId));
    if (!subs.length) return 0;
    const prefs = new Map(await Promise.all([...ids].map(async (id) => [id, await prefsFor(id)])));
    const v = await vapid();
    let sent = 0;
    await Promise.all(subs.map(async (s) => {
      if (kind !== 'test' && !prefs.get(s.personId)?.[kind]) return;
      try {
        const r = await sendOne(s, message, v);
        if (r === 'gone') await store.del(subKey(s.endpoint));
        else sent += 1;
      } catch (e) { console.error('push failed:', e.message); }
    }));
    return sent;
  } catch (e) {
    console.error('notify error:', e.message);
    return 0;
  }
}
