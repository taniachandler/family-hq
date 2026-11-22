---
name: family-hq-setup
description: Sets up Family HQ, a free private family web app (chore chart with checklists and parent review, grocery list, family calendar), for the user's household, from a short conversation to a working app on their phone. Use when someone says "set up Family HQ", "make me a family chore app", "build a chore chart app for my kids", "family command center app", or asks to change, update or fix their existing Family HQ.
---

# Family HQ Setup

You're helping a parent get **Family HQ** running for their household. **The job is done only when they have a working web app open on their phone, signed in, showing their own family and chore chart.** A chart in the chat or a file on its own is not the finish line.

Family HQ is free and open source: https://github.com/taniachandler/family-hq
Each family runs their own copy on a free Netlify account. Their data stays in their account.

Talk like a friendly, practical helper. Most users aren't technical. Use short steps, one thing at a time, and name exact buttons. Don't use jargon (no "repo", "deploy", "env var" unless they use those words first; say "your copy", "put it online", "a setting in Netlify").

## First: new or existing?

Ask whether they already have Family HQ running.
- **New**: follow the 4 parts below in order.
- **Already running, wants changes** (move chores, new kid, rename a job): don't redo setup. It only works once. Tell them where it lives in the app: **Settings → Weekly chore chart** (⋯ on a job moves it to another night, adds 2-minute add-ons, or marks a quick task; **Copy to…** copies a night; **Build a fair rotation** rebuilds it), **Settings → Jobs & checklists**, **Settings → Family names**. Then walk them through it.
- **Wants the latest version**: see "Updates" at the end.

## Part 1: Get to know the family (keep it quick)

Ask in small groups, not one long form:
1. **App name**: usually "[Last name] HQ". Max 40 characters.
2. **People**: first names, and who is an **adult** (adults review chores and change settings) or a **kid**. At least one adult. Ages help you plan fair chores; you don't need to save them.
3. **Jobs**: offer starter jobs to pick from: Kitchen, Living room, Halls & stairs, Bathroom, Trash & recycling, Pets, Laundry, Pantry, Bedrooms, Yard. For each job they pick, agree on a short checklist of 2–6 steps the kid ticks off ("Wipe the table", "Put food away"). Suggest sensible steps so they mostly just confirm.
4. **Schedule**: which nights chores happen; who does chores (often just the kids); nights someone is always off (practice, other parent's house); fixed things ("trash to the curb Monday night"); anything that should happen only once a week (e.g. bathroom on Friday).

## Part 2: Build the chart together

Make a weekly chart (Monday → Sunday) that:
- respects every fixed rule and night off they gave you;
- gives each kid a fair number of chore nights (count and show them);
- rotates the harder jobs so no one gets stuck with the bathroom every time;
- gives younger kids lighter jobs if ages were mentioned;
- puts tiny, fixed tasks as **2-minute add-ons** on a job ("Plus: take recycling to the curb"), or as a **quick task** (`"quick": true`) if it's on its own and shouldn't count as a chore night.

Show it as a simple table by night, plus "chore nights per kid". Change it until they're happy. Remind them it can be changed any time in the app.

## Part 3: Get the app online (once, about 10 minutes)

They need free **GitHub** and **Netlify** accounts. Netlify can be signed up for with GitHub. Guide them step by step and wait for each step to be done:

1. While signed in to GitHub, open https://github.com/taniachandler/family-hq → click **Fork** → **Create fork**. (Forking is what lets them get updates later with one click.)
2. Go to https://app.netlify.com → **Add new site** (or **Add new project**) → **Import an existing project** → **GitHub** → allow access if asked → pick **family-hq**. Leave every setting as it is → **Deploy**.
3. Wait about a minute until it says **Published**. Ask them to copy their site link (like `https://something-random-123.netlify.app`). Optional: **Site configuration → Change site name** for a nicer link.

If you have tools that can do this for them (for example the GitHub CLI `gh` is installed and signed in to *their* account), you may offer to fork for them (`gh repo fork taniachandler/family-hq --clone=false`) **after they say yes**. Never sign in, create accounts, or type passwords for them. Account sign-ups and logins are theirs to do.

## Part 4: Fill it in and sign in

Turn everything from Parts 1–2 into a **setup code**. This JSON shape is exactly what the app reads:

```json
{
  "household": "Rivera HQ",
  "people": [
    { "name": "Ana", "role": "adult" },
    { "name": "Leo", "role": "kid" }
  ],
  "jobs": {
    "Kitchen": ["Wipe the table", "Wipe the countertops", "Put food away"],
    "Bathroom": ["Toilet", "Sink", "Floor", "Take out the trash"]
  },
  "chart": {
    "Monday":   [ { "who": "Leo", "job": "Kitchen", "addons": ["Take the trash to the curb"] } ],
    "Tuesday":  [ { "who": "Leo", "job": "Bathroom" } ],
    "Saturday": [ { "who": "Leo", "job": "Bring the bins back", "quick": true } ]
  }
}
```

Limits (the app rejects the code otherwise): every `who` must match a name in `people` exactly. At least one adult. Up to 20 people (names ≤ 30 characters). Up to 40 jobs (job names ≤ 60 characters). Up to 20 checklist steps per job. Up to 5 add-ons per chart entry. Leave out nights with no chores. A chart job that isn't in `jobs` is fine; it just has no checklist.

Then give it to them **one** of these ways:
- **A setup link (best).** Save the JSON as `setup.json` and run whichever of these works (nothing to install). The script also checks the names match:
  `python3 scripts/make_setup_link.py https://their-site.netlify.app setup.json`
  `node scripts/make_setup_link.mjs https://their-site.netlify.app setup.json`
  It prints a link like `https://their-site.netlify.app/#/setup/eyJ…`. The family details travel in the part after `#`, which browsers never send in web requests, so they stay on the phone until setup saves them to the family's own app.
- **Paste it.** If you can't run code, give them the JSON in one code block. On the app's first screen they tap **Got a setup code from Claude?**, paste it, and tap **Use this code**.

Then have them:
1. Open the link on their phone, check the summary, and tap **Finish setup**.
2. Tap their name and **create their 4-number code**. Never ask them to tell you a code.
3. Confirm they can see the Home screen with their app name at the top. **Don't call it done until they confirm this.**
4. Send the link to the family. Each person taps their name and makes their own code.
5. Add it to the home screen: iPhone **Share → Add to Home Screen**; Android **⋮ → Add to Home screen**.
6. Turn on notifications: each person goes to **Settings → Notifications → Turn on notifications**. On iPhone, open the app **from the home-screen icon** first (Apple rule). Ask what time chores start and set it under **Reminder times** (default 6:30pm, with an 8pm nudge if it isn't done).
7. Keep the link private. The link plus each person's code is the security.

### If something goes wrong
| What they see | What to do |
|---|---|
| "This app is already set up" | Setup already happened. Use Settings to change things, or have them sign in. |
| "The chart mentions X, who isn't on the list" | Fix the name in the chart so it matches `people` exactly, and make the code again. |
| "That setup code doesn't look right" | The code got cut off when copied. Use the paste method with the full JSON. |
| Netlify page says "Page not found" | The deploy hasn't finished or failed. In Netlify → **Deploys**, wait for **Published** or click **Retry deploy**. |
| No notifications | Check **Settings → Notifications** says "On for [name] on this phone" and tap **Send a test**. iPhone: must be opened from the home-screen icon. If it says blocked, follow the steps shown there. Reminders only come on nights that person has chores. |
| "Something went wrong on our end" | Wait a minute and try again. If it keeps happening, check Netlify → **Logs → Functions**. |

## Optional extras (offer, don't push)

- **Google Calendar**: needs a one-time Google Cloud setup. The steps are under "Optional: connect Google Calendar" in the repo README. First, they make a Google calendar named exactly what's in **Settings → App name → Google calendar name** (default "Family Calendar").
- **School or sports calendars**: any iCal / `.ics` link goes in **Settings → Calendar subscriptions**. No setup needed.

## Updates

When a new version is out (for example, meal planning), adults see a note at the bottom of **Settings**. To update: open their fork on GitHub → **Sync fork** → **Update branch**. Netlify rebuilds in about a minute. **Their family's data is kept.** If their copy isn't a fork, they won't see **Sync fork**. Have them fork the original, then in Netlify **Site configuration → Build & deploy → Link repository** and pick the fork. The data stays with the Netlify site.
