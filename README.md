# Family HQ

A free, private family app for your phone: **chores with a checklist and grown-up review, a shared grocery list, and a family calendar** (Google Calendar plus school/sports calendar subscriptions).

Each person taps their name and uses their own 4-number code. Kids tick off their chore checklist, then send it for review, and an adult approves it or sends it back with a note.

It costs nothing to run. It lives on a free Netlify account, and your family's data stays in your own account. Nobody else can see it, including the person who made this.

---

## Set it up (about 15 minutes, no coding)

### Easiest: let Claude do it
If you use Claude, add the **Family HQ Setup** skill (in the [`skill/`](skill/) folder) and say *"set up Family HQ for my family"*. Claude will ask about your family and chores, build a fair chore chart with you, walk you through putting the app online, and give you a link that fills everything in.

### Or do it yourself
You need a free [GitHub](https://github.com) account and a free [Netlify](https://netlify.com) account. You can sign up for Netlify using GitHub.

1. **Make your own copy.** At the top of this page, click **Fork**, then **Create fork**. (A fork lets you get updates later with one click.)
2. **Put it online.** In Netlify, click **Add new site → Import an existing project → GitHub**, and pick your `family-hq` fork. Don't change any settings. Click **Deploy**.
3. **Open your app.** After about a minute, Netlify shows your link (something like `https://lively-otter-123.netlify.app`). You can rename it under **Site configuration → Change site name**.
4. **Set up your family.** Open the link on your phone and follow the setup screens: app name, who lives there, which chores, and which nights. It builds a fair rotation for you.
5. **Make your code.** Tap your name and pick 4 numbers. Then send the link to your family so each person can make their own code.
6. **Add it to your home screen.** iPhone: Share → **Add to Home Screen**. Android: ⋮ → **Add to Home screen**.

> **Keep the link private.** Don't post it publicly. The link plus each person's code is what keeps the app safe. Setup can only happen once, so finish it as soon as the app is online.

### Changing things later
Adults can change everything under **Settings**:
- **Weekly chore chart:** change who does what. Use ⋯ to move a job to another night, add 2-minute add-ons, or mark a quick task. You can also copy one night to others, or rebuild a fair rotation.
- **Jobs & checklists:** rename jobs, edit the steps people tick off, and add or delete jobs.
- **Family names:** add people or rename them.
- **App name:** the name at the top of the app, and the name of your Google calendar.

---

## Optional: connect Google Calendar

The Calendar tab can show your family's Google calendar and add events to it. It only ever touches **one** calendar, the one with the name you set in **Settings → App name** (default: "Family Calendar"). In Google Calendar, create a calendar with that exact name first.

Then do this one-time Google setup:
1. Go to [Google Cloud Console](https://console.cloud.google.com/), create a project, and turn on the **Google Calendar API**.
2. Under **APIs & Services → OAuth consent screen**, choose **External**. Add your Google account as a test user, then **Publish app** so the connection doesn't expire every 7 days.
3. Under **Credentials → Create credentials → OAuth client ID**, choose **Web application**. For **Authorized redirect URI**, enter `https://YOUR-SITE.netlify.app/api/google/callback`.
4. In Netlify, go to **Site configuration → Environment variables** and add `GOOGLE_CLIENT_ID` and `GOOGLE_CLIENT_SECRET` from step 3. Then **Deploys → Trigger deploy**.
5. In the app: **Settings → Google Calendar connection → Connect**.

School or sports calendars that give you an iCal / `.ics` link can be added under **Settings → Calendar subscriptions**. They don't need any Google setup.

---

## Getting updates

New features (for example, meal planning) come out from time to time. Adults see a note at the bottom of **Settings** when a new version is out.

**To update:** open your fork on GitHub and click **Sync fork → Update branch**. Netlify rebuilds your app in about a minute. **Your family's data is not touched.** Updates are built so existing families keep everything they've set up, and new features start out empty.

If your copy isn't a fork (for example, you used a "Deploy" button), you don't have the Sync button. Fork this repo, then in Netlify go to **Site configuration → Build & deploy → Link repository** and pick the fork. Your data stays with the Netlify site, not the repo, so nothing is lost.

The update check asks GitHub once a day for the newest version number. It sends nothing about your family. To turn it off, set the Netlify environment variable `UPDATE_CHECK_URL` to `off`.

---

## For tinkerers

- `public/`: the app people see (plain HTML/CSS/JS, no build step). `setup.js` holds the first-run setup screens and the rotation builder.
- `server/`: the backend. `app.mjs` has all the API routes, `migrations.mjs` handles safe upgrades, and `version.mjs` has the version and update check.
- `netlify/functions/api.mjs`: runs the backend on Netlify at `/api/*`.
- `skill/family-hq-setup/`: the Claude skill that sets the app up for a family.
- Data lives in **Netlify Blobs**, which is free and built into Netlify. Codes are hashed with scrypt and a salt, and are never stored in plain text.

Run it on your computer (Node 20+):

```
npm install
npm run dev
```

Then open http://localhost:8788. Test data is saved in `.data/`.

## License

MIT: free to use, change and share. See [LICENSE](LICENSE).
