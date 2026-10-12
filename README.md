# LockedIn

A daily, weekly and monthly planner you can install as an app (PWA). Anyone can create a free account, and administrators get a panel to manage users.

- **Landing page**: visitors see an interactive landing page before signing in. It has a hero phone you can tick tasks on, a live demo running the real Day, Week and Month screens on sample data, and features, how it works, reminders and FAQ sections. The installed app skips it and opens straight to sign-in.
- **Day**: a timeline where each task's block height matches how long it takes. Tick tasks off, and gaps of 30 minutes or more show as free time.
- **Week**: a 7-day grid of tasks, plus a list of weekly goals.
- **Month**: a calendar with a colored dot per task, plus a list of monthly goals.
- **Tasks**: name, icon, date, start and end time (any length, ending by midnight; longer things become a second task the next day), color, and repeat (once, daily, weekly or monthly).
- **Goals that track themselves**: weekly and monthly goals can repeat every period and be linked to daily tasks with a target ("Gym 4 times a week"). Each tick of a linked task counts, and the goal ticks itself at the target. Monthly goals can also count the weeks a weekly goal was met.
- **Streaks & progress**: repeating tasks build streaks ("🔥 6 days"). The Progress tab shows this week, the last 8 weeks, every habit's streak, best run and 30-day rate, and current goals.
- **Smarter reminders**: each task reminds at its start or 5–60 minutes before (or not at all). Reminders carry **Done** and **Remind me in 10 min** buttons (Android and desktop). There's also a morning briefing (30 minutes before the first task, or at a set time), one evening check-in if something is unticked, and a Sunday weekly review. Each can be switched on or off in Settings → What to send.
- **Admin panel**: usage stats, user search, switching people between user and admin, suspending accounts (which signs them out everywhere) and deleting users.
- **Install and reminders**: a card at the top of the planner walks people through installing the app (one tap on Android and desktop Chrome/Edge, Share → Add to Home Screen on iPhone), then asks them to turn on reminders. With reminders on, each device gets a push notification when a task starts, even when the app is closed, plus one evening check-in two hours after the day's last task if anything is still unticked (at most once a day). Reminders can be turned on, tested and turned off in Settings.
- **Responsive**: phones get a bottom nav bar and a bottom sheet. Screens 900px wide or more get a sidebar and a centered dialog.

The original Claude Design handoff (prototype, chat transcript and the original blue logo) is kept in [`design/`](design/).

## Stack

| Part | What |
| --- | --- |
| Frontend | React 19, Vite, TypeScript, `vite-plugin-pwa` (manifest and offline app shell) |
| Backend | Node and Express 5, serving the API at `/api` and the built app |
| Database | PostgreSQL (tables are created automatically on startup) |
| Auth | Email and password (bcrypt), with an httpOnly session cookie stored in Postgres |

Fonts are self-hosted: Manrope and JetBrains Mono come from npm, and the Material Symbols icons are a small subset in `src/fonts/`. If you use a new icon, add it to `scripts/fetch-icon-font.sh` and run the script.

## Deploying to Railway

1. Push this repository to GitHub.
2. In Railway, choose **New Project → Deploy from GitHub repo** and pick the repository. Railway reads `railway.json`, which builds with `npm run build`, starts with `npm start` and health-checks `/api/health`.
3. In the same project, click **+ New → Database → PostgreSQL**.
4. Open the LockedIn service → **Variables** and add:
   - `DATABASE_URL` = `${{Postgres.DATABASE_URL}}`
   - `ADMIN_EMAIL`: your email. This account is created as an administrator on startup (or promoted, if it already exists).
   - `ADMIN_PASSWORD`: a strong password for that account. It is only used the first time the account is created. Changing the variable later does not change the password.
   - `ADMIN_NAME` (optional): the display name for that account.
5. Open **Settings → Networking → Generate Domain** to get a public HTTPS address. Open it on your phone and use **Add to Home Screen** to install LockedIn.

Push notifications need no extra setup: the server generates its signing keys (VAPID) on first start and keeps them in the database. To manage the keys yourself instead, set `VAPID_PUBLIC_KEY` and `VAPID_PRIVATE_KEY` (generate them with `npx web-push generate-vapid-keys`). Changing the keys later turns reminders off on every device until people turn them back on.

Railway sets `PORT` automatically. Don't set `SEED_DEMO` in production: it creates demo accounts with public passwords.

## Running locally

Requires Node 20+ and a PostgreSQL database.

```bash
npm install
cp .env.example .env        # then edit DATABASE_URL and the admin settings
npm run dev                 # API on :3000, app on http://localhost:5173
```

Set `SEED_DEMO=true` in `.env` to start an empty database with the demo accounts from the design (`admin@lockedin.app` / `admin123`, `maya@example.com` / `maya123`) and a sample routine.

Other scripts:

```bash
npm run build     # typecheck, build the PWA into dist/client and bundle the server to dist/server.js
npm start         # run the production build
npm test          # API integration tests (drops and recreates the tables in TEST_DATABASE_URL)
```

`npm test` uses `TEST_DATABASE_URL`, which defaults to `postgres://postgres:postgres@localhost:5432/lockedin_test`. Point it at a throwaway database.

## Project layout

```
server/      Express API: auth.ts (sessions), app.ts (routes), db.ts (schema), push.ts (reminders), seed.ts
shared/      Types and date/repeat logic used by both server and client
src/         React app: App.tsx (layout and state), components/, styles.css
public/      Logo and app icons
design/      The original Claude Design handoff
```
