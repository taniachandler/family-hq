'use strict';
/* First-run setup (shown once, on a brand-new install) + the chore-rotation builder
   that the setup screen and Settings > Weekly chore chart both use.
   Uses the helpers defined in app.js ($, esc, api, toast...) — only inside functions. */

const DAY_NAMES = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'];

// Suggested jobs. Families tick the ones they want and edit the checklists.
const STARTER_JOBS = {
  'Kitchen': ['Wipe the table', 'Wipe the countertops', 'Put food away', 'Load or empty the dishwasher'],
  'Living room': ['Straighten pillows and blankets', 'No trash left out', 'Put away anything that doesn’t belong there'],
  'Halls & stairs': ['Shoes put away', 'Clear anything left on the floor or steps'],
  'Bathroom': ['Toilet', 'Sink', 'Floor', 'Take out the trash', 'Check there’s toilet paper'],
  'Trash & recycling': ['Empty the kitchen trash', 'Take the bins out on pickup day'],
  'Pets': ['Food and fresh water', 'Clean up after them'],
  'Laundry': ['Bring dirty clothes down', 'Fold and put away clean clothes'],
  'Pantry': ['Straighten the shelves', 'Throw out empty boxes'],
};

/* ---------- fair rotation ----------
   workers: names (or ids), jobs: job names, nights: day indexes (0 = Monday).
   Every chore night each job goes to someone; who gets what shifts by one each night,
   so jobs and nights off rotate fairly. */
function buildRotation(workers, jobs, nights, shift = 0) {
  const days = [[], [], [], [], [], [], []];
  if (!workers.length || !jobs.length) return days;
  nights.forEach((d, k) => {
    jobs.forEach((job, i) => {
      days[d].push({ who: workers[(i + k + shift) % workers.length], job, extras: [], quick: false });
    });
  });
  return days;
}

/* ---------- setup code (from the Claude skill) ----------
   Accepts the JSON itself, or the base64url text after #/setup/ in a link. */
function readSetupCode(raw) {
  let s = String(raw || '').trim();
  if (!s) return null;
  if (!s.startsWith('{')) {
    s = s.replace(/^.*#\/setup\//, '').replace(/-/g, '+').replace(/_/g, '/');
    try { s = new TextDecoder().decode(Uint8Array.from(atob(s), (c) => c.charCodeAt(0))); } catch { throw new Error('That setup code doesn’t look right. Ask Claude to make it again.'); }
  }
  let j;
  try { j = JSON.parse(s); } catch { throw new Error('That setup code doesn’t look right. Ask Claude to make it again.'); }
  const people = (Array.isArray(j.people) ? j.people : []).map((p) => ({ name: String(p.name || '').trim(), role: p.role === 'adult' ? 'adult' : 'kid' })).filter((p) => p.name);
  const jobs = {};
  for (const [k, v] of Object.entries(j.jobs || {})) jobs[String(k).trim()] = (Array.isArray(v) ? v : []).map(String);
  // chart: { "Monday": [ {who, job, addons|extras, quick} ] } or days: [ [..], ..7 ]
  let days = [[], [], [], [], [], [], []];
  if (Array.isArray(j.days) && j.days.length === 7) days = j.days;
  else if (j.chart && typeof j.chart === 'object') {
    days = DAY_NAMES.map((n) => j.chart[n] || j.chart[n.toLowerCase()] || j.chart[n.slice(0, 3)] || []);
  }
  days = days.map((day) => (Array.isArray(day) ? day : []).map((x) => ({
    who: String(x.who || '').trim(),
    job: String(x.job || '').trim(),
    extras: (x.extras || x.addons || []).map(String),
    quick: !!x.quick,
  })).filter((x) => x.who && x.job));
  for (const day of days) for (const x of day) if (!(x.job in jobs)) jobs[x.job] = [];
  return { household: String(j.household || j.name || '').trim(), people, jobs, days };
}

/* ---------- the setup screens ---------- */
function showSetup() {
  signinMode(true);
  const w = { step: 0, household: '', people: [{ name: '', role: 'adult' }], jobs: {}, nights: [0, 1, 2, 3, 4, 5, 6], workers: null, days: null, shift: 0, fromCode: false };
  const fromHash = location.hash.startsWith('#/setup/') ? location.hash : '';

  const names = () => w.people.map((p) => p.name.trim()).filter(Boolean);
  const kidsByDefault = () => {
    const kids = w.people.filter((p) => p.role === 'kid' && p.name.trim()).map((p) => p.name.trim());
    return kids.length ? kids : names();
  };
  const STEPS = 5;
  const progress = () => `<p class="muted small">Step ${w.step} of ${STEPS}</p>`;
  const shell = (inner) => { main.innerHTML = `<div class="setup">${inner}</div>`; };

  function useCode(raw) {
    const c = readSetupCode(raw);
    if (!c) return;
    w.household = c.household;
    w.people = c.people.length ? c.people : w.people;
    w.jobs = c.jobs;
    w.days = c.days;
    w.workers = null;
    w.fromCode = true;
    w.step = 5;
    draw();
  }

  let shownStep = -1;
  function draw() {
    // jump to the top only when moving to a new step, not when ticking things on the same one
    if (w.step !== shownStep) window.scrollTo(0, 0);
    shownStep = w.step;
    if (w.step === 0) {
      shell(`<div class="logo">Family HQ</div>
        <h1>Let’s set up your family’s app</h1>
        <p class="muted">It takes about 5 minutes. You’ll add your family, pick the chores, and we’ll build a fair chore chart. You can change all of it later in Settings.</p>
        <button class="btn" data-next>Start setup</button>
        <details class="card" style="margin-top:18px;text-align:left"><summary><b>Got a setup code from Claude?</b></summary>
          <label class="field">Paste it here<textarea data-code placeholder="{ &quot;household&quot;: ... }"></textarea></label>
          <button class="btn secondary" data-usecode>Use this code</button>
        </details>`);
      $('[data-usecode]', main).onclick = () => { try { useCode($('[data-code]', main).value); } catch (e) { toast(e.message, true); } };
    } else if (w.step === 1) {
      shell(`${progress()}<h1>What should we call it?</h1>
        <p class="muted">This shows at the top of the app. Most families use their last name.</p>
        <label class="field">App name<input type="text" data-hh maxlength="40" value="${esc(w.household)}" placeholder="e.g. Rivera HQ" autocomplete="off"></label>
        ${nav()}`);
      $('[data-hh]', main).oninput = (e) => (w.household = e.target.value);
    } else if (w.step === 2) {
      shell(`${progress()}<h1>Who lives here?</h1>
        <p class="muted">First names are fine. <b>Adults</b> review chores and change settings. Everyone makes their own 4-number code later.</p>
        <div class="card">${w.people.map((p, i) => `<div class="setup-person">
            <input type="text" data-pn="${i}" maxlength="30" value="${esc(p.name)}" placeholder="Name" aria-label="Name" autocomplete="off">
            <div class="chips"><button type="button" class="chip${p.role === 'kid' ? ' on' : ''}" data-role="${i}:kid">Kid</button><button type="button" class="chip${p.role === 'adult' ? ' on' : ''}" data-role="${i}:adult">Adult</button></div>
            ${w.people.length > 1 ? `<button class="x-btn" data-rmp="${i}" aria-label="Remove">✕</button>` : '<span></span>'}
          </div>`).join('')}
          <button class="btn small ghost" data-addp>+ Add someone</button></div>
        ${nav()}`);
      main.oninput = (e) => { const i = e.target.dataset.pn; if (i !== undefined) w.people[i].name = e.target.value; };
      main.onclick = (e) => {
        const r = e.target.closest('[data-role]');
        if (r) { const [i, role] = r.dataset.role.split(':'); w.people[i].role = role; draw(); return; }
        const rm = e.target.closest('[data-rmp]');
        if (rm) { w.people.splice(Number(rm.dataset.rmp), 1); draw(); return; }
        if (e.target.closest('[data-addp]')) { w.people.push({ name: '', role: 'kid' }); draw(); $$('[data-pn]', main).at(-1).focus(); return; }
        handleNav(e);
      };
      return;
    } else if (w.step === 3) {
      const all = { ...STARTER_JOBS, ...w.jobs };
      shell(`${progress()}<h1>Which chores?</h1>
        <p class="muted">Tick the jobs your family does. Tap a job to change its checklist — that’s what the kids tick off.</p>
        <div class="card">${Object.keys(all).map((j) => `<div class="setup-job">
            <label class="check"><input type="checkbox" data-job="${esc(j)}"${j in w.jobs ? ' checked' : ''}> <b>${esc(j)}</b></label>
            ${j in w.jobs ? `<details><summary class="muted small">Checklist (${w.jobs[j].length})</summary>
              <textarea data-list="${esc(j)}" placeholder="One step per line">${esc(w.jobs[j].join('\n'))}</textarea></details>` : ''}
          </div>`).join('')}
          <button class="btn small ghost" data-addjob>+ Add your own job</button></div>
        ${nav()}`);
      main.onchange = (e) => {
        const j = e.target.dataset.job;
        if (j === undefined) return;
        if (e.target.checked) w.jobs[j] = [...(w.jobs[j] || STARTER_JOBS[j] || [])];
        else delete w.jobs[j];
        w.days = null;
        draw();
      };
      main.oninput = (e) => { const j = e.target.dataset.list; if (j !== undefined) w.jobs[j] = e.target.value.split('\n').map((s) => s.trim()).filter(Boolean); };
      main.onclick = async (e) => {
        if (e.target.closest('[data-addjob]')) {
          const name = await promptBox({ title: 'Add a job', label: 'Job name (e.g. Bedrooms, Yard, Dishes)', yes: 'Add' });
          if (name && !(name in w.jobs)) { w.jobs[name] = []; w.days = null; draw(); }
          return;
        }
        handleNav(e);
      };
      return;
    } else if (w.step === 4) {
      if (!w.workers) w.workers = kidsByDefault();
      if (!w.days) w.days = buildRotation(w.workers, Object.keys(w.jobs), w.nights, w.shift);
      shell(`${progress()}<h1>Your chore chart</h1>
        <p class="muted">We rotate the jobs so everyone gets a turn. You can move things around after setup in <b>Settings → Weekly chore chart</b>.</p>
        <div class="card"><h3>Chore nights</h3>
          <div class="chips">${DAY_NAMES.map((n, d) => `<button type="button" class="chip${w.nights.includes(d) ? ' on' : ''}" data-night="${d}">${n.slice(0, 3)}</button>`).join('')}</div>
          <h3 style="margin-top:14px">Who does chores?</h3>
          <div class="chips">${names().map((n) => `<button type="button" class="chip${w.workers.includes(n) ? ' on' : ''}" data-worker="${esc(n)}">${esc(n)}</button>`).join('')}</div>
          <button class="btn small ghost" style="margin-top:12px" data-shuffle>↻ Shuffle who starts</button>
        </div>
        ${chartPreview(w.days)}
        ${nav()}`);
      main.onclick = (e) => {
        const n = e.target.closest('[data-night]');
        const wk = e.target.closest('[data-worker]');
        if (n) { const d = Number(n.dataset.night); w.nights = w.nights.includes(d) ? w.nights.filter((x) => x !== d) : [...w.nights, d].sort(); }
        else if (wk) { const v = wk.dataset.worker; w.workers = w.workers.includes(v) ? w.workers.filter((x) => x !== v) : names().filter((x) => x === v || w.workers.includes(x)); }
        else if (e.target.closest('[data-shuffle]')) w.shift += 1;
        else return handleNav(e);
        w.days = buildRotation(w.workers, Object.keys(w.jobs), w.nights, w.shift);
        draw();
      };
      return;
    } else if (w.step === 5) {
      const ppl = w.people.filter((p) => p.name.trim());
      shell(`${progress()}<h1>Look right?</h1>
        <div class="card"><h3>${esc(w.household || 'Family HQ')}</h3>
          <p>${ppl.map((p) => `${esc(p.name)}${p.role === 'adult' ? ' <span class="tag-adult">Adult</span>' : ''}`).join(', ')}</p>
          <p class="muted small">Jobs: ${esc(Object.keys(w.jobs).join(', ') || 'none yet')}</p></div>
        ${chartPreview(w.days || [[], [], [], [], [], [], []])}
        ${w.fromCode ? '<p class="muted small">Loaded from your setup code. Tap Back to change anything.</p>' : ''}
        <button class="btn" data-finish>Finish setup</button>
        <button class="btn ghost" data-prev>Back</button>`);
      $('[data-finish]', main).onclick = finish;
    }
    main.onclick = handleNav;
    main.oninput = null;
    main.onchange = null;
  }

  function nav() {
    return `<div class="btn-row" style="margin-top:16px"><button class="btn ghost" data-prev>Back</button><button class="btn" data-next>Next</button></div>`;
  }
  function check() {
    if (w.step === 1 && !w.household.trim()) return 'Give your app a name.';
    if (w.step === 2) {
      const n = names();
      if (!n.length) return 'Add at least one person.';
      if (new Set(n.map((x) => x.toLowerCase())).size !== n.length) return 'Two people have the same name — add a last initial to one.';
      if (!w.people.some((p) => p.role === 'adult' && p.name.trim())) return 'At least one person needs to be an adult.';
    }
    if (w.step === 3 && !Object.keys(w.jobs).length) return 'Pick at least one job.';
    return '';
  }
  function handleNav(e) {
    if (e.target.closest('[data-next]')) {
      const msg = check();
      if (msg) return toast(msg, true);
      if (w.step === 2) { w.people = w.people.filter((p) => p.name.trim()); w.workers = null; w.days = null; }
      w.step += 1;
      draw();
    } else if (e.target.closest('[data-prev]')) {
      w.step = w.fromCode && w.step === 5 ? 1 : w.step - 1;
      w.fromCode = false;
      draw();
    }
  }

  async function finish() {
    const b = $('[data-finish]', main);
    b.disabled = true;
    try {
      await api('/setup', {
        household: w.household || 'Family HQ',
        people: w.people.filter((p) => p.name.trim()),
        jobs: w.jobs,
        days: w.days || [[], [], [], [], [], [], []],
        startDate: today(),
        timeZone: Intl.DateTimeFormat().resolvedOptions().timeZone,
      });
      history.replaceState(null, '', location.pathname);
      window.scrollTo(0, 0);
      await boot();
      toast('All set! Tap your name and make your code.');
    } catch (e) {
      b.disabled = false;
      toast(e.message, true);
    }
  }

  if (fromHash) { try { useCode(fromHash); return; } catch (e) { toast(e.message, true); } }
  draw();
}

function chartPreview(days) {
  return `<div class="card"><h3>Week at a glance</h3>${days.map((slots, d) => `<div class="list-row">
      <div class="grow"><b>${DAY_NAMES[d]}</b><div class="muted small">${slots.length ? slots.map((s) => `${esc(s.who || nameOf(s.personId))}: ${esc(s.job)}`).join(' · ') : 'No chores'}</div></div>
    </div>`).join('')}</div>`;
}
