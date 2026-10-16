# Project notes

## Git

- Always push commits to GitHub (`git push origin main`) as part of finishing work — do not wait for the user to ask.

## Infrastructure (Railway)

- Project `lyco`, environment `production`. Three services: **lyco app** (the Next.js app, public URL `https://lyco.up.railway.app`), **Lyco Database** (Postgres), and **run remind** (cron `*/5 * * * *`, start command `npm run remind`).
- Postgres private domain inside Railway: `postgres.railway.internal:5432`. Local `.env.local` must use the public proxy host instead (`.railway.internal` is unreachable off-platform).
- Email sender is `EMAIL_FROM=hello@pixelous.io` (Resend; domain verified). Nothing reads `RESEND_FROM_EMAIL` — the correct name is `EMAIL_FROM`.
- Local dev uses `DEV_USER_ID` bypass + `NEXT_PUBLIC_BASE_URL=http://localhost:3001`. Production uses `NEXT_PUBLIC_APP_URL` and must never have `DEV_USER_ID`.
- Google Calendar OAuth needs each environment's callback registered in Google Cloud Console: `<base>/api/calendar/callback` (localhost:3001 locally, the Railway URL in production).
- `railway` CLI is installed and logged in; `railway variables -s "<service>" --json` lists that service's env vars.
