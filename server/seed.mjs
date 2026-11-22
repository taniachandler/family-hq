// Starting data for a brand-new install. Everything is empty on purpose:
// the first-run setup screen (or a setup code from the Claude skill) fills it in.
// After setup, adults change names, jobs and the chart from Settings.

export const SEED_PEOPLE = [];

export const SEED_CHECKLISTS = {};

// days[0] = Monday ... days[6] = Sunday. Each slot:
// { id, personId, job, extras: [2-minute add-ons], quick: true if it doesn't count as a chore night }
export const SEED_CHART = {
  startDate: '2000-01-01',
  days: [[], [], [], [], [], [], []],
};

export const DEFAULT_HOUSEHOLD = {
  name: 'Family HQ',
  calendarName: 'Family Calendar',
  setupDone: false,
};
