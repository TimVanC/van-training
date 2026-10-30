# Van Training

## Changing the app icon

Every home-screen / PWA icon is generated from one source image, so swapping the icon is a single command:

```sh
npm run icons -- path/to/your-icon.png
```

That rewrites `public/icons/icon-180.png` (iPhone home screen), `icon-192.png` and `icon-512.png` (Android, favicon) and `icon-512-maskable.png` (Android adaptive icon with extra safe-zone padding). Nothing else needs to change: `index.html`, `public/manifest.webmanifest` and `public/sw.js` all point at those fixed file names.

- Use a square-ish PNG (or SVG) at least 512px wide. Transparent backgrounds are best; any empty margin is trimmed automatically.
- The artwork is placed on the app's dark theme colour by default. Pick another background with `--bg "#ffffff"` (or `--bg transparent`), and tweak breathing room with `--padding 0.1` (fraction of each edge, default `0.03`).
- Full-bleed artwork that already has its own background (like the current van) should skip the auto-crop: `npm run icons -- van.png --no-trim --padding 0 --bg "#fefefb"`.
- Running `npm run icons` with no path rebuilds from the current source at `src/assets/app-icon.png` (pass the same flags as above).
- iOS copies the icon at "Add to Home Screen" time, so remove and re-add the app on your phone to see a new icon there. Android and desktop pick it up on the next manifest update.

## Garmin backfill

`scripts/garmin_backfill.py` pulls Tim's Garmin data through the official
[Garmin Connect Personal API](https://github.com/garmin/connect-personal-api-python)
into the raw tables `garmin_daily_raw`, `garmin_activities` and
`garmin_sync_runs`, which the views `garmin_daily` and `training_recovery`
read (`supabase/migrate_add_garmin_tables.sql`, `supabase/migrate_add_garmin_views.sql`).
Field names are documented in `supabase/garmin_field_reference.md`.

```bash
python3 -m pip install -r scripts/requirements-garmin.txt      # Python 3.12+
# .env (gitignored): GARMIN_PERSONAL_API_KEY, SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY
python3 scripts/garmin_backfill.py --inspect                   # samples to ./samples, field check, window probe
python3 scripts/garmin_backfill.py                             # backfill 2026-02-23 .. today
python3 scripts/garmin_backfill.py --start 2026-10-01 --datasets sleep,hrv,activities
```

Runs are idempotent and resumable: stored dates are skipped unless `--force`,
apart from the last `--refresh-days` (default 3) which Garmin may still be
updating. Range endpoints use 28-day windows and shrink on HTTP 400; 429/5xx
back off exponentially; a 401 triggers one token refresh. The bearer token is
cached in `.garmin-bearer-token.json` (gitignored). The three tables have RLS
enabled with no policies, so only the service role can read or write them.

---

# React + TypeScript + Vite

This template provides a minimal setup to get React working in Vite with HMR and some ESLint rules.

Currently, two official plugins are available:

- [@vitejs/plugin-react](https://github.com/vitejs/vite-plugin-react/blob/main/packages/plugin-react) uses [Babel](https://babeljs.io/) (or [oxc](https://oxc.rs) when used in [rolldown-vite](https://vite.dev/guide/rolldown)) for Fast Refresh
- [@vitejs/plugin-react-swc](https://github.com/vitejs/vite-plugin-react/blob/main/packages/plugin-react-swc) uses [SWC](https://swc.rs/) for Fast Refresh

## React Compiler

The React Compiler is not enabled on this template because of its impact on dev & build performances. To add it, see [this documentation](https://react.dev/learn/react-compiler/installation).

## Expanding the ESLint configuration

If you are developing a production application, we recommend updating the configuration to enable type-aware lint rules:

```js
export default defineConfig([
  globalIgnores(['dist']),
  {
    files: ['**/*.{ts,tsx}'],
    extends: [
      // Other configs...

      // Remove tseslint.configs.recommended and replace with this
      tseslint.configs.recommendedTypeChecked,
      // Alternatively, use this for stricter rules
      tseslint.configs.strictTypeChecked,
      // Optionally, add this for stylistic rules
      tseslint.configs.stylisticTypeChecked,

      // Other configs...
    ],
    languageOptions: {
      parserOptions: {
        project: ['./tsconfig.node.json', './tsconfig.app.json'],
        tsconfigRootDir: import.meta.dirname,
      },
      // other options...
    },
  },
])
```

You can also install [eslint-plugin-react-x](https://github.com/Rel1cx/eslint-react/tree/main/packages/plugins/eslint-plugin-react-x) and [eslint-plugin-react-dom](https://github.com/Rel1cx/eslint-react/tree/main/packages/plugins/eslint-plugin-react-dom) for React-specific lint rules:

```js
// eslint.config.js
import reactX from 'eslint-plugin-react-x'
import reactDom from 'eslint-plugin-react-dom'

export default defineConfig([
  globalIgnores(['dist']),
  {
    files: ['**/*.{ts,tsx}'],
    extends: [
      // Other configs...
      // Enable lint rules for React
      reactX.configs['recommended-typescript'],
      // Enable lint rules for React DOM
      reactDom.configs.recommended,
    ],
    languageOptions: {
      parserOptions: {
        project: ['./tsconfig.node.json', './tsconfig.app.json'],
        tsconfigRootDir: import.meta.dirname,
      },
      // other options...
    },
  },
])
```

## Coach Van (AI)

The onboarding chat (`/onboarding`) and the in-app coach (`/coach`) call the Claude API from the serverless functions in `api/`.

- Set `ANTHROPIC_API_KEY` in the Vercel project (all environments). A key that is not scoped to one workspace also needs `ANTHROPIC_WORKSPACE_ID`.
- Until the key is set, `/api/coachStatus` reports `enabled: false` and the app hides the Coach tab and the "Add a split with Coach Van" button.
- Per-user limits live in `api/_handlers/onboardingChat.ts` and `api/_handlers/coachChat.ts` and are counted in the `ai_usage` table.
- Vercel's Hobby plan allows 12 serverless functions per deployment, so the coach and account endpoints share one function (`api/app.ts`, routed by `vercel.json`). Add new endpoints under `api/_handlers/`.

## Tests

```bash
npm test
```

runs the unit tests for the pure logic in `src/lib`. Two end-to-end scripts run against a local `vercel dev` server and the real database:

```bash
npx tsx --env-file=.env.local scripts/coachIntegrationTest.mts
npx tsx --env-file=.env.local scripts/accountDeletionTest.mts
```

The first needs `TEST_COACH_EMAIL` and `TEST_COACH_PASSWORD` in `.env.local` (an account with a split named "Coach Test UL" whose first day is "Upper A"); the second creates and deletes its own throwaway account.
