// Safe updates for families who are already using the app.
//
// When a new version changes how data is stored, add a step to MIGRATIONS below.
// Each step runs exactly once per install, in order, the first time the new code
// starts. The step number reached is saved under the "meta" key.
//
// Rules for future features (meal planning, etc.):
//   1. Never delete or rename an existing key without a migration step that moves the data.
//   2. New features store their data under NEW keys (e.g. "meals/2026-12-01") and treat
//      a missing key as "nothing yet", so old installs just start empty.
//   3. Steps must be safe to run on an install that already has the data (check first).
//   4. Never edit an old step after it's released. Add a new one.
import * as store from './store.mjs';
import { DEFAULT_HOUSEHOLD } from './seed.mjs';

const MIGRATIONS = [
  // 1 — household settings (name, Google calendar name, setup done?).
  //     Installs that already have people (e.g. the original Chandler HQ) count as set up.
  async () => {
    if (await store.get('household')) return;
    const people = await store.get('people');
    const g = await store.get('google');
    const { notify, ...base } = DEFAULT_HOUSEHOLD; // notify belongs to step 2 (same result as v1.0.0)
    await store.set('household', {
      ...base,
      calendarName: g?.calendarName || DEFAULT_HOUSEHOLD.calendarName,
      setupDone: Array.isArray(people) && people.length > 0,
    });
  },

  // 2 (v1.1) — phone notification settings. Uses the Google Calendar's time zone if connected.
  async () => {
    const h = await store.get('household');
    if (!h || h.notify) return;
    const g = await store.get('google');
    await store.set('household', { ...h, notify: { ...DEFAULT_HOUSEHOLD.notify, timeZone: g?.timeZone || DEFAULT_HOUSEHOLD.notify.timeZone } });
  },
];

export const SCHEMA_VERSION = MIGRATIONS.length;

let ready;
export function migrate() {
  if (!ready) ready = run().catch((e) => { ready = undefined; throw e; });
  return ready;
}

async function run() {
  const meta = (await store.get('meta')) || { schema: 0 };
  for (let v = meta.schema; v < MIGRATIONS.length; v++) {
    await MIGRATIONS[v]();
    meta.schema = v + 1;
    meta.updatedAt = Date.now();
    await store.set('meta', meta);
  }
}
