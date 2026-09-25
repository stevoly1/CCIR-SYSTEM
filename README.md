# CCIR System

**Open-source, self-hostable backend for AI-assisted citizen complaint and infrastructure reporting.**

CCIR lets citizens report public infrastructure problems (potholes, broken streetlights, blocked drainage, water leakages, waste accumulation, etc.) with a description, an optional photo, and a location. The backend uses AI to classify and prioritize each report automatically, and gives government staff a set of APIs to review, assign, and track complaints through to resolution.

The core deliverable of this project is the **backend** — the API, database, authentication, and AI classification logic. It is designed to be deployed by any local or state government on its own servers and paired with whatever frontend that institution builds or adopts. A minimal reference frontend (in `client/`) is included to demonstrate and test the backend; it is not required for production use and is not the primary deliverable.

## Architecture

- **Backend**: Node.js, Express 5, MongoDB (Mongoose)
- **Auth**: email/password (bcrypt) + optional Google OAuth, JWT access/refresh tokens in signed HTTP-only cookies
- **AI classification**: Google Gemini (multimodal — text and photo), via `services/aiService.js`. Never blocks complaint submission; falls back to a default category/priority if the AI call fails or is unconfigured.
- **Location**: Photon (OpenStreetMap-based, keyless) for address autocomplete, forward geocoding, and reverse geocoding, via `services/locationService.js`
- **Photo storage**: Cloudinary
- **Email notifications**: Resend (optional — the app works without it)
- **Reference frontend**: React 19 + Redux Toolkit + React Router, in `client/`

If `client/dist` exists (i.e. the frontend has been built), the backend serves it as static files. Otherwise the backend runs as a pure JSON API — it does not require the reference frontend to function.

### A note on the AI component

The AI classification feature uses a pretrained, general-purpose multimodal model (Google Gemini) called via API with a prompt — it does not train or fine-tune a custom model. This was a deliberate choice: it avoids needing a large labelled dataset of civic complaints, and pretrained models already handle both text and images. One consequence is that AI classification and location autocomplete/geocoding depend on external third-party services and internet access. The backend itself can be fully self-hosted on your own servers, but these two specific features will keep relying on Google's and Photon's public APIs unless you swap in a different provider.

## Prerequisites

- Node.js 26 (26.9.0 or a later 26.x release) and npm 12.1.0 or later 12.x (`.nvmrc` records the verified version)
- MongoDB 4.4 or later, **running as a replica set** (the API uses transactions). Hosted clusters such as MongoDB Atlas already are. A self-managed server, even a single one, must be started with `--replSet rs0` and initiated once with `rs.initiate()` in `mongosh`
- A [Google AI Studio](https://aistudio.google.com/) API key (for AI classification — optional but recommended). A free-tier key allows only a few requests a minute per model (5 for `gemini-3.6-flash` in September 2026; see [rate limits](https://ai.google.dev/gemini-api/docs/rate-limits)). Each new report, and each edit that changes the description, is one request; beyond the limit reports fall back to `Other`/`MEDIUM` until the minute resets. Use a billing-enabled key for real use. Every fallback is logged (`AI classification failed; using the fallback`) with its code and, for a refusal, the provider's HTTP status (`providerStatus` 429 means the quota was reached)
- A [Cloudinary](https://cloudinary.com/) account (only required if citizens will attach photos to complaints — a text-only complaint never calls Cloudinary. Unlike the AI and email services, image upload has no fallback: a complaint submitted *with* a photo will fail without valid Cloudinary credentials)
- Optionally: a [Resend](https://resend.com/) API key (email notifications) and Google OAuth credentials (Google sign-in)

## Setup

```bash
# 1. Install backend dependencies
node --version  # must print v26.9.0 or a later v26 release
npm install

# 2. Copy the environment template and fill in your own values
cp .env.example .env

# 3. Start MongoDB (if running it locally, as a replica set), then start the API
npm run dev
```

The API will be running at `http://localhost:8080/api/v1`. `GET /api/v1/health/ready` reports whether it is ready to serve traffic, and the interactive API documentation is at `http://localhost:8080/api/v1/docs`.

In production (`NODE_ENV=production`) the API, the migrations and `set-role` never build database indexes themselves. Build them once on a new database, before the first start, with `npm run db:indexes -- --apply`, which also seeds the default categories (see [Operations](#operations)).

See [`.env.example`](./.env.example) for the full list of environment variables and what each one is for.

### Creating the first admin account

Every account created through `/api/v1/auth/signup` is a `citizen` by default — the API never lets a client set its own role. To create the first administrator, run this once while no active administrator exists:

```bash
npm run set-role -- you@example.com admin
```

After bootstrap, use the protected administrator API for role changes. The bootstrap command refuses to run once an active administrator exists.

### Running the reference frontend (optional)

```bash
cd client
npm install
npm run dev
```

By default the frontend expects the API at `http://localhost:8080/api/v1`. Override this with a `VITE_API_URL` environment variable if your backend runs elsewhere.

## API overview

All routes are prefixed with `/api/v1`.

| Area | Base path | Notes |
|---|---|---|
| Auth | `/auth` | signup, login, Google OAuth redirect/callback; forgot and reset password; email-change confirmation |
| Users | `/users` | profile management, password change, email change and account deletion; admin-only user listing/edit/email change/retirement; admin-only `/users/assignable` |
| Categories | `/categories` | admin-only create/edit/activate/deactivate; delete only inactive, unused categories; `Other` is protected |
| Complaints | `/complaints` | reports need an address (coordinates optional); reporters edit or withdraw pending reports; staff update status and priority (agency only when assigned); admins assign and may permanently delete with a reason |
| Location | `/location` | address autocomplete and geocoding with a bounded timeout (`LOCATION_TIMEOUT_MS`) |
| Health | `/health/live`, `/health/ready` | liveness and readiness probes (see [Operations](#operations)); `/health` is a legacy alias of `/health/live` |
| Contract | `/openapi.json`, `/docs` | the OpenAPI 3.1 contract as JSON, and interactive documentation |

The full contract, with every request and response schema, error code and example, is [`openapi/openapi.yaml`](./openapi/openapi.yaml). It is served at `GET /api/v1/openapi.json` and rendered at `GET /api/v1/docs` (turn the page off with `API_DOCS_UI=false`; the JSON stays available). The page's "Try it out" can read with your session; write operations from it are refused by the browser-origin rule unless the page is served from `BROWSER_ORIGIN`.

### Accounts

People manage their own accounts from the Profile page:
- **Forgot password:** a single-use link, valid for 30 minutes, emailed to the account. The answer is the same whether or not the address has an account.
- **Change password:** needs the current password and signs out the other devices.
- **Change email address:** needs the current password; the change applies only when the link sent to the new address is opened (valid 24 hours), and the old address is told.
- **Delete account:** needs the password (Google accounts type their email address). The name is removed from stored reports and their handling history; the reports stay. Administrators cannot delete their own account; another administrator retires it.

Administrators correct a user's email address from the Users page. It goes through the same confirmation: `POST /users/{id}/email`. Since contract 1.1.0, `PATCH /users/{id}` no longer accepts `email`.

Passwords set from now on need 8 to 128 characters and may not be the account's email address. Existing shorter passwords still work.

A Google sign-in started from a dashboard page (for example a report link opened while signed out) returns to that page (`GET /auth/google?returnTo=`); anything that is not a `/dashboard` path on this site is ignored.

These flows send email through Resend (`RESEND_API_KEY`, `EMAIL_FROM`). Without a key, reset requests are still answered, but no email goes out, and email changes answer 503 `EMAIL_NOT_SENT`. Resend's test sender delivers only to the Resend account owner's own address, so a real deployment needs a verified sending domain.

### Upgrading an existing database

Deployments with data from earlier versions run each migration they have not yet applied, in order (`migrate:phase1`, then `migrate:phase2`), after deploying the code. Each script supports `--dry-run`, `--apply --backup-reference=<label>` (take and label a backup first), and `--verify`:

```bash
npm run migrate:phase2 -- --dry-run
npm run migrate:phase2 -- --apply --backup-reference=<your-backup-label>
npm run migrate:phase2 -- --verify
```

Each script prints a single JSON report, and `--verify` exits with code 2 while any invariant fails. Case-duplicate category names and category names outside 2–60 characters are reported for manual correction, never changed automatically. Rolling back after `--apply` means restoring the backup together with the previous code; older code cannot read the migrated data.

## Operations

### Logging

Logs are JSON lines on standard output, one line per request plus one per notable event, each with a `requestId`. Every response carries an `X-Request-Id` header; a caller may send its own (8–64 characters of `A-Z a-z 0-9 . _ -`). An unexpected server error (500) returns `error.requestId` in its body, and the same ID is on the logged error with its stack. Passwords, tokens, cookies, API keys, connection-string credentials, request bodies, query strings and client IP addresses are never logged. `LOG_LEVEL` sets the detail (`info` by default; `debug` also logs health-probe requests).

### Health checks

| Endpoint | Answers | Status codes |
|---|---|---|
| `GET /api/v1/health/live` | the process is running (never checks the database) | 200 |
| `GET /api/v1/health/ready` | `ready`, `degraded` (an optional service — AI, uploads, email, Google sign-in — is not configured, or a TTL index is missing) or `unavailable` | 200 when ready or degraded; 503 when unavailable |

When unavailable, `checks.database.reason` is one of `DATABASE_DISCONNECTED`, `DATABASE_TIMEOUT`, `TRANSACTIONS_UNSUPPORTED` (not a replica set), `INDEXES_MISSING` (run `db:indexes -- --apply`) or `DATABASE_ERROR`. When degraded because `checks.database.reason` is `TTL_INDEXES_MISSING`, sessions and sign-in throttles would stop expiring: run `db:indexes -- --apply`. Readiness needs the database user to be allowed `listIndexes` (the `readWrite` role is). Neither endpoint is rate-limited, and neither reveals a setting value or connection detail; readiness does show which optional services are configured and the MongoDB server version. Because readiness is public, its database check is shared: concurrent probes wait for one check, and the result is reused for `READINESS_CACHE_MS` milliseconds (default `1000`; `0` checks on every call).

### Database indexes

```bash
npm run db:indexes                           # report only: what is missing or extra (changes nothing)
npm run db:indexes -- --apply                # create missing indexes; drops only an index being made unique
npm run db:indexes -- --apply --drop-extra   # also drop indexes the models do not declare
npm run db:indexes -- --check                # report, and exit 2 if any declared index is missing
```

Run `--apply` on a new database before the first start, and after every release that changes indexes. It also seeds the default categories once their unique indexes exist: in production the API seeds nothing while those indexes are missing, so several instances starting at once cannot create duplicates. `--check` suits a deploy step: it exits `2` while any declared index is missing (`1` means the script itself failed, including an unknown option).

When a release makes an existing index unique (this one does: `complaintdeletions.complaintId`), `--apply` first checks the values are unique, then replaces the old index with the unique one; if the values repeat it stops, names the collection and count, and leaves the old index in place. Until `--apply` has run, readiness reports `INDEXES_MISSING` (503) for that index, so run it before the new release takes traffic. A development database whose API builds indexes on start (`autoIndex`) cannot build the unique index over the old one either: run `--apply` there too. Upgrading from an earlier release: run the report first. It lists the unused coordinate index `location.latitude_1_location.longitude_1` as extra. Use `--apply --drop-extra` only if that is the only extra index listed, because it drops every index the models do not declare, including any made in a hosted console; otherwise drop that one index by name.

### Backup and restore

These commands need [MongoDB Database Tools](https://www.mongodb.com/try/download/database-tools) (`mongodump`, `mongorestore`); on macOS: `brew tap mongodb/brew && brew install mongodb-database-tools` (recent Homebrew asks you to `brew trust --formula mongodb/brew/mongodb-database-tools` first). They work the same for hosted and self-managed databases.

```bash
npm run db:backup -- --out backups     # the database in MONGO_URL → backups/ccir-<time>.archive.gz + a manifest
read -rs RESTORE_TARGET_URL && export RESTORE_TARGET_URL   # paste the target connection string; it is not echoed or kept in history
npm run db:restore -- --archive backups/ccir-<time>.archive.gz
npm run db:rehearse                    # proves backup and restore on a throwaway in-memory database (needs the dev dependencies)
```

A backup compares the database before and after the dump, so its manifest always matches its archive. If the application wrote in between, that attempt is discarded and retried; after three attempts it stops and keeps nothing. Collections that expire by themselves (refresh tokens, throttle counters, Google sign-in state) are backed up and restored but not compared, because MongoDB changes them even with the application stopped. The archive is created readable by its owner only.

Restore takes its target from `RESTORE_TARGET_URL`, never from `MONGO_URL`. `--uri` is accepted only for a target without a password, because the command line is visible to other users and kept in shell history. Secrets given as connection options (such as `tlsCertificateKeyFilePassword`) belong in `RESTORE_TARGET_URL` too. The target must name its database. A restore:
- refuses an archive that does not match its manifest checksum;
- refuses a non-empty target unless both `--drop` and `--confirm-drop` are given, and then makes the target an exact copy of the backup, dropping collections the backup does not have;
- afterwards checks every collection against the manifest.

Backups contain personal data and password hashes: `backups/` and `*.archive.gz` are git-ignored; keep them somewhere access-controlled. On a hosted cluster, the provider's own backups are the first line of defence; these commands are for moving data and for disaster recovery you control.

### Tests

```bash
npm run test:unit            # backend unit tests
npm run test:integration     # backend integration tests on an in-memory MongoDB replica set;
                             # every response is checked against the OpenAPI contract
npm run test:coverage        # both together, with coverage thresholds and the contract check
npm --prefix client run test:unit    # reference client component tests
npm --prefix client run test:e2e     # browser journeys on the production build, in Chrome, then WebKit;
                                     # extra arguments (a spec file, --grep) reach both browsers
```

Tests use in-memory databases and fake providers; they never contact a real database, AI, email, storage or geocoding service. The first run downloads the MongoDB server binary for the in-memory database. The journeys use your installed Google Chrome and Playwright's WebKit (Safari's engine), which is downloaded once with `npm --prefix client exec playwright install webkit` (about 85 MB).

Browser journeys read emails from a test-only outbox (`EMAIL_OUTBOX_DIR`); the API refuses to start with it unless `NODE_ENV=test`.

### Continuous integration

Every pull request to `main`, and every push to `main`, runs four jobs on GitHub Actions (`.github/workflows/ci.yml`). A repository ruleset (in the repository settings) lets a pull request into `main` only when all four pass. Each job runs commands you can run locally:

| Job | Checks | Locally |
|---|---|---|
| `backend` | Unit and integration tests, API contract validation and coverage, coverage floors; the backup rehearsal (MongoDB Database Tools installed) | `npm run test:coverage` |
| `client` | Client unit tests, lint, production build | `npm --prefix client run test:unit`, `lint`, `build` |
| `journeys` | The browser journeys in Chrome and WebKit on the production build | `npm --prefix client run test:e2e` |
| `safety` | No private or environment files tracked or in history; no credentials in history, merge commits included (gitleaks; findings listed by file, line and rule, values withheld; a self-test proves merge commits are read); no high or critical advisory in production dependencies | `npm run check:tracked-files`, `npm run check:secrets` and `npm run check:secrets-self-test` (need [gitleaks](https://github.com/gitleaks/gitleaks)), `npm run check:audit` |

A run passes only if every test ran: a skipped, todo, focused (`.only`) or flaky test fails it (`npm run check:test-results -- <results.json>` reads the Vitest or Playwright JSON results). Vitest's results do not record retries, so CI runs it with `--retry=0` and a unit test (`tests/unit/ci-no-retries.test.js`) refuses any retry setting in tests or their configuration. CI uses no secrets and no external service.

To catch a private file before it leaves your machine, install the same guard as a local pre-push hook: `cp scripts/ci/pre-push "$(git rev-parse --git-path hooks)/pre-push"` (this replaces any existing pre-push hook). It checks the commits a push would send, with the rules of `npm run check:tracked-files`, and refuses the push if it cannot run: on a branch older than the guard, or in a Git app whose `PATH` has no `node` (`git push --no-verify` skips it deliberately). It runs the guard from your working tree. CI remains the enforcement point.

## License

MIT — see [`LICENSE`](./LICENSE). You're free to deploy, modify, and reuse this backend for your own government or organization.
