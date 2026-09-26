# Lockedin

A daily, weekly and monthly planner you can install as an app (PWA). Anyone can create a free account, and administrators get a panel to manage users.

- **Day**: a timeline where each task's block height matches how long it takes. Tick tasks off, and gaps of 30 minutes or more show as free time.
- **Week**: a 7-day grid of tasks, plus a list of weekly goals.
- **Month**: a calendar with a colored dot per task, plus a list of monthly goals.
- **Tasks**: name, icon, date, start time, duration, color, and repeat (once, daily, weekly or monthly).
- **Admin panel**: usage stats, user search, switching people between user and admin, suspending accounts (which signs them out everywhere) and deleting users.
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
4. Open the Lockedin service → **Variables** and add:
   - `DATABASE_URL` = `${{Postgres.DATABASE_URL}}`
   - `ADMIN_EMAIL`: your email. This account is created as an administrator on startup (or promoted, if it already exists).
   - `ADMIN_PASSWORD`: a strong password for that account. It is only used the first time the account is created. Changing the variable later does not change the password.
   - `ADMIN_NAME` (optional): the display name for that account.
5. Open **Settings → Networking → Generate Domain** to get a public HTTPS address. Open it on your phone and use **Add to Home Screen** to install Lockedin.

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
server/      Express API: auth.ts (sessions), app.ts (routes), db.ts (schema), seed.ts
shared/      Types and date/repeat logic used by both server and client
src/         React app: App.tsx (layout and state), components/, styles.css
public/      Logo and app icons
design/      The original Claude Design handoff
```
