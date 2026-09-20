# CCIR System

**Open-source, self-hostable backend for AI-assisted citizen complaint and infrastructure reporting.**

CCIR lets citizens report public infrastructure problems (potholes, broken streetlights, blocked drainage, water leakages, waste accumulation, etc.) with a description, an optional photo, and a location. The backend uses AI to classify and prioritize each report automatically, and gives government staff a set of APIs to review, assign, and track complaints through to resolution.

The core deliverable of this project is the **backend** — the API, database, authentication, and AI classification logic. It is designed to be deployed by any local or state government on its own servers and paired with whatever frontend that institution builds or adopts. A minimal reference frontend (in `client/`) is included to demonstrate and test the backend; it is not required for production use and is not the primary deliverable.

## Project remediation program

The audited path from the current prototype to the evaluated final-year-project release is maintained in the [CCIR Master Remediation Program](./docs/remediation/MASTER_REMEDIATION_PROGRAM.md). It orders security and integrity work before feature completion, deployment, formal evaluation, and the evidence-dependent dissertation chapters.

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

- Node.js 24.19.0 (`.nvmrc` pins the reproducible version)
- A MongoDB instance (local, self-hosted, or a managed service)
- A [Google AI Studio](https://aistudio.google.com/) API key (for AI classification — optional but recommended)
- A [Cloudinary](https://cloudinary.com/) account (only required if citizens will attach photos to complaints — a text-only complaint never calls Cloudinary. Unlike the AI and email services, image upload has no fallback: a complaint submitted *with* a photo will fail without valid Cloudinary credentials)
- Optionally: a [Resend](https://resend.com/) API key (email notifications) and Google OAuth credentials (Google sign-in)

## Setup

```bash
# 1. Install backend dependencies
node --version  # must print v24.19.0
npm install

# 2. Copy the environment template and fill in your own values
cp .env.example .env

# 3. Start MongoDB (if running it locally), then start the API
npm run dev
```

The API will be running at `http://localhost:8080/api/v1`, with a health check at `GET /api/v1/health`.

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
| Auth | `/auth` | signup, login, Google OAuth redirect/callback |
| Users | `/users` | profile management; admin-only user listing/edit/delete |
| Categories | `/categories` | complaint categories and their default priority |
| Complaints | `/complaints` | create/list/view/update reports; status updates and assignment are restricted to `admin`/`agency` |
| Location | `/location` | address autocomplete, forward/reverse geocoding |

## License

MIT — see [`LICENSE`](./LICENSE). You're free to deploy, modify, and reuse this backend for your own government or organization.
