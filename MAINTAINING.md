# Releasing updates (for the maintainer)

Families run their own copy (a fork) with their own data in their own Netlify account.
You never touch their data. They pull your code changes with **Sync fork**.
So every release has to work on installs that already have months of data.

## Checklist for every release

1. **Data rules** (see the top of `server/migrations.mjs`):
   - New features store data under **new keys** (e.g. `meals/2026-12-01`, `mealplan`) and treat "nothing there yet" as empty.
   - Never rename or delete an existing key, or change the shape of `people`, `chart`, `checklists`, `household`, `chore/...`, `grocery/...`, without adding a **migration step** that converts old data.
   - Never edit a migration step that has already been released. Add a new one.
2. **Test the upgrade:** copy a `.data` folder from an older version, run `npm run dev` with the new code, and check everything still loads.
3. **Bump the version** in BOTH `server/version.mjs` (`VERSION`) and `version.json`. Put a one-line, family-friendly summary in `version.json` → `notes`. That text shows in families' Settings.
4. Push to `main`. Families see "Version X is out" in Settings within a day.

Use `1.1.0` for new features and `1.0.1` for fixes. Only use `2.0.0` if families must do something by hand (avoid this).

## Adding a feature like meal planning

- Add a tab in `startApp()` (`public/app.js`), a `viewMeals()` screen, and routes like `GET /meals` / `POST /meals/save` in `server/app.mjs`.
- Store data under `meals/...` keys. On an older install those keys don't exist yet, so the screen starts empty.
- If the feature needs a setting (e.g. "which night is takeout"), store it in its own key or as a new optional field on `household` with a default. Don't make it required.
- If families should be able to turn it off, add `features: { meals: true }` to `household` with a migration step that sets the default.

## The skill

`skill/family-hq-setup/` is the Claude skill. It points at this repo on GitHub, so code updates don't need a new skill version. Only re-share the skill if the setup steps or the setup-code format change. The format is read by `readSetupCode()` in `public/setup.js`, so keep it backwards compatible.

## Running the original Chandler HQ on this code (optional, later)

The original Chandler HQ is a separate private repo. To build features once and have both sites get them:
in the Chandler HQ Netlify site, set the environment variable `STORE_NAME` = `chandler-hq` (so it keeps reading the same data), then
link the site to a fork of this repo. Migration step 1 marks it as already set up and keeps its Google calendar name.
Set the app name to "Chandler HQ" in Settings → App name. Test on a Netlify deploy preview first.
