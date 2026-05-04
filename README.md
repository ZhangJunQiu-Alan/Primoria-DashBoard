# Primoria Dashboard

Primoria Dashboard is now a pure React/Vite web app. It can run locally without an account, and can sync personal dashboard data through Supabase Auth + Postgres when configured.

## Local Development

```bash
pnpm install
pnpm dev
```

Production build:

```bash
pnpm build
pnpm preview
```

## Supabase Free Cloud Sync

Create a Supabase project on the Free plan, then run the SQL migration in:

```text
supabase/migrations/20260504120000_dashboard_web_sync.sql
```

The migration creates:

- `public.dashboard_snapshots` for per-user dashboard state.
- Row Level Security policies so users can only read/write their own snapshot.
- A private `dashboard-assets` Storage bucket for wallpaper images.
- Storage policies that isolate files under each user's `auth.uid()` folder.

Create a personal user first, then disable public signups in Supabase Auth settings if this dashboard is only for you.

Set these environment variables locally and in Cloudflare Pages:

```bash
VITE_SUPABASE_URL=your-project-url
VITE_SUPABASE_ANON_KEY=your-anon-key
```

You can copy `.env.example` to `.env` for local development. Never commit `.env`.

If these variables are missing, the app still works in local-only mode.

## Cloudflare Pages Deployment

Use Cloudflare Pages for the free public URL.

Build settings:

- Framework preset: `Vite`
- Build command: `pnpm build`
- Build output directory: `dist`
- Environment variables: `VITE_SUPABASE_URL`, `VITE_SUPABASE_ANON_KEY`

The deployed app will be available at a free `*.pages.dev` URL unless you later attach a custom domain.

Current manual deployment target:

```bash
pnpm build
npx wrangler pages deploy dist --project-name primoria-dashboard --branch main
```

Production URL:

```text
https://primoria-dashboard.pages.dev
```

## Free-Tier Notes

- Cloudflare Pages is used only for static assets. The app build output is small and fits the Pages Free plan asset limits.
- Supabase Free is expected to be enough for personal dashboard sync, but it is not unlimited. Keep wallpapers under 5 MB and clean unused data if you approach free limits.
- The old Tauri desktop shell and local NetEase backend were removed. The NetEase widget is intentionally degraded in the web version and links out to NetEase Music instead of storing third-party cookies or proxying playback.
