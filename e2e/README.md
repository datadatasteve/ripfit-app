# RipFit end-to-end tests (Playwright)

A small browser suite that clicks through the main flows the way you would:
login, start → log a set (RPE 11) → finish, log a food, the Stats tabs, Start Set
sound timing, number keypads, and cardio segments / Avg Distance.

- **Chromium only.** Two sizes: `desktop` (1280×800) and `phone` (375×812, touch).
  The phone project is a narrow Chrome window, not a real phone: it does not
  prove anything about iPhone Safari sound or keyboards.
- **Local only.** The config refuses any base URL that is not localhost, and
  every test blocks requests to any other host. Nothing touches production,
  USDA, email or Northflank. The food search call is answered by the test itself.
- Takes a few minutes; tests run one at a time because they share one test user.

## What is downloaded

`@playwright/test` (published by Microsoft, github.com/microsoft/playwright,
Apache-2.0). By default the suite drives the **Google Chrome already installed**
on this Mac, so no browser download is needed. Install with the browser
download turned off:

```bash
cd e2e
PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD=1 npm install
```

Optional, only if you'd rather use Playwright's own Chromium (~150 MB from
Microsoft's CDN) instead of your Chrome:

```bash
npx playwright install chromium
E2E_BROWSER_CHANNEL=chromium npx playwright test
```

## One-time setup

1. A **local throwaway** PostgreSQL database with the RipFit schema. Never point
   this at the real database.
2. Load the test user and data (safe to run again before every run):

   ```bash
   psql -h localhost -p <port> -U <user> -d <local_test_db> -f e2e/seed/seed.sql
   ```

   Test user: `e2e@ripfit.test` / `E2e-Local-Pass1!` (local test value only).

## Each run

Terminal 1, backend against the local database (higher rate limit so the
suite's many logins aren't throttled):

```bash
cd backend
DB_HOST=localhost DB_PORT=<port> DB_USER=<user> DB_PASSWORD=<local_pw> DB_NAME=<local_test_db> PORT=3000 ALLOWED_ORIGINS=http://localhost:5173 RATE_LIMIT_MAX_REQUESTS=5000 node src/app.js
```

The backend also reads `backend/.env`. Variables set on the command line win,
so set every `DB_*` value above (use `DB_PASSWORD=` for none) to be sure it
connects to the local test database and not whatever `.env` names.

Terminal 2, frontend dev server pointed at that backend:

```bash
cd frontend
VITE_API_URL=http://localhost:3000/api/v1 npm run dev
```

Terminal 3, the tests:

```bash
cd e2e
npx playwright test
```

Other commands:

```bash
npx playwright test --project=desktop
```

```bash
npx playwright test --project=phone
```

```bash
npx playwright test tests/start-set.spec.js
```

```bash
npx playwright show-report
```

Different addresses: `E2E_BASE_URL` (default `http://localhost:5173/ripfit-app/`)
and `E2E_API_URL` (default `http://localhost:3000/api/v1`). Both must be localhost.

## Notes

- Failures keep a screenshot and trace in `e2e/test-results/`; open with
  `npx playwright show-report`. Both folders are git-ignored.
- **macOS:** the first run opens Chrome from the terminal app, and macOS may ask
  whether that app can access the Desktop folder (this repo lives there). Click
  Allow, or the run fails with "Operation not permitted".
- The Start Set test records the sounds the page schedules (which tones, when,
  how long). It proves the timing is right, not that a speaker made a noise.
