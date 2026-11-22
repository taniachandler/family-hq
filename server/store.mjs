// Tiny key/value store.
// - On Netlify: Netlify Blobs (free, built into Netlify, no extra account).
// - On this computer (CHQ_LOCAL=1): JSON files in the .data folder.
import { promises as fs } from 'node:fs';
import path from 'node:path';

let impl;

async function load() {
  if (impl) return impl;
  if (process.env.CHQ_LOCAL === '1') {
    const dir = path.resolve(process.env.CHQ_DATA_DIR || '.data');
    await fs.mkdir(dir, { recursive: true });
    const file = (k) => path.join(dir, encodeURIComponent(k) + '.json');
    impl = {
      async get(k) {
        try { return JSON.parse(await fs.readFile(file(k), 'utf8')); }
        catch (e) { if (e.code === 'ENOENT') return null; throw e; }
      },
      async set(k, v) {
        // write to a temp file, then swap it in, so a reader never sees half a file
        const tmp = file(k) + '.' + process.pid + '.' + Math.random().toString(36).slice(2) + '.tmp';
        await fs.writeFile(tmp, JSON.stringify(v));
        await fs.rename(tmp, file(k));
      },
      async del(k) { await fs.rm(file(k), { force: true }); },
      async list(prefix) {
        const names = await fs.readdir(dir);
        return names
          .filter((n) => n.endsWith('.json'))
          .map((n) => decodeURIComponent(n.slice(0, -5)))
          .filter((k) => k.startsWith(prefix))
          .sort();
      },
    };
  } else {
    const { getStore } = await import('@netlify/blobs');
    const s = getStore({ name: process.env.STORE_NAME || 'family-hq', consistency: 'strong' });
    impl = {
      get: (k) => s.get(k, { type: 'json' }),
      set: (k, v) => s.setJSON(k, v),
      del: (k) => s.delete(k),
      async list(prefix) {
        const { blobs } = await s.list({ prefix });
        return blobs.map((b) => b.key).sort();
      },
    };
  }
  return impl;
}

// If storage hiccups, start fresh and try once more before showing an error.
async function withRetry(fn) {
  try {
    return await fn(await load());
  } catch (e) {
    console.error('store error, retrying once:', e?.name, e?.message);
    impl = undefined;
    await new Promise((r) => setTimeout(r, 300));
    return fn(await load());
  }
}

export const get = (k) => withRetry((s) => s.get(k));
export const set = (k, v) => withRetry((s) => s.set(k, v));
export const del = (k) => withRetry((s) => s.del(k));
export const list = (prefix) => withRetry((s) => s.list(prefix));
export const getMany = async (keys) => (await Promise.all(keys.map(get))).filter(Boolean);
