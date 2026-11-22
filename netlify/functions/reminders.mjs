// Runs every 15 minutes on Netlify (free) to send chore-time reminders.
// The times live in the app: Settings > Notifications (adults).
import { runReminders } from '../../server/app.mjs';

export default async () => {
  const r = await runReminders();
  console.log('reminders sent:', r.sent);
};

export const config = { schedule: '*/15 * * * *' };
