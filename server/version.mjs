// The app's version, and a once-a-day check for a newer one.
// Keep VERSION in step with version.json at the top of the repo.
import * as store from './store.mjs';

export const VERSION = '1.0.0';

// Where the newest version number is published. A family can turn the check off
// by setting the Netlify environment variable UPDATE_CHECK_URL to "off".
const DEFAULT_URL = 'https://raw.githubusercontent.com/taniachandler/family-hq/main/version.json';
const CHECK_HOURS = 24;

const newer = (a, b) => {
  const pa = String(a).split('.').map(Number);
  const pb = String(b).split('.').map(Number);
  for (let i = 0; i < 3; i++) if ((pa[i] || 0) !== (pb[i] || 0)) return (pa[i] || 0) > (pb[i] || 0);
  return false;
};

export async function updateInfo() {
  const url = process.env.UPDATE_CHECK_URL || DEFAULT_URL;
  const out = { version: VERSION, latest: null, notes: null, updateAvailable: false };
  if (url === 'off') return out;
  let cached = await store.get('updatecheck');
  if (!cached || Date.now() - cached.at > CHECK_HOURS * 3600e3) {
    try {
      const res = await fetch(url, { signal: AbortSignal.timeout(5000), headers: { accept: 'application/json' } });
      if (res.ok) {
        const j = await res.json();
        cached = { at: Date.now(), latest: String(j.version || ''), notes: String(j.notes || '').slice(0, 500) };
        await store.set('updatecheck', cached);
      }
    } catch { /* offline or GitHub down: try again next time */ }
  }
  if (cached?.latest) {
    out.latest = cached.latest;
    out.notes = cached.notes;
    out.updateAvailable = newer(cached.latest, VERSION);
  }
  return out;
}
