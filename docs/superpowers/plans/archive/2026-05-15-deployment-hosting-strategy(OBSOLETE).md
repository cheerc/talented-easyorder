# Deployment Hosting Strategy Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use `superpowers:writing-plans` for any follow-up implementation plan. This document is a deployment and hosting strategy plan; do not implement deployment config directly from it until the `DISCUSS WITH USER` points are resolved.

**Goal:** Define a completely free production deployment path for Talented EasyOrder's Vite/React frontend that fits the recommended free backend architecture and the PC + iPad campus deployment model.

**Architecture:** Deploy the Vite frontend as Cloudflare Workers Static Assets by default, paired with a Worker API and D1 when the Cloudflare backend recommendation is accepted. Keep static asset requests free/asset-first, invoke the Worker only for approved API routes such as `/api/*`, and keep GitHub Actions as the merge gate before Cloudflare deployment.

**Tech Stack:** Vite 8, React 19, TypeScript 6, Zustand 5, Vitest 4, ESLint 10, Cloudflare Workers Static Assets, Cloudflare Workers + D1, Wrangler 4, Workers Builds GitHub integration, GitHub Actions, optional Cloudflare Pages / Firebase Hosting / Vercel / Netlify / GitHub Pages fallback paths.

---

## Required Reads Completed

- `docs/superpowers/plans/ROADMAP.md`
- `docs/superpowers/plans/2026-05-15-free-backend-architecture-exploration.md`
- `frontend/package.json`
- `frontend/vite.config.ts`
- `.github/workflows/ci.yml`
- `docs/iPad人臉辨識訂餐系統設計方案_V3.pdf`

## Official Provider Sources Checked On 2026-05-15

- Cloudflare Workers best practices: https://developers.cloudflare.com/workers/best-practices/workers-best-practices/
- Cloudflare Workers Static Assets overview: https://developers.cloudflare.com/workers/static-assets/
- Cloudflare Workers Static Assets billing and limits: https://developers.cloudflare.com/workers/static-assets/billing-and-limitations/
- Cloudflare Workers Static Assets routing / worker script: https://developers.cloudflare.com/workers/static-assets/routing/worker-script/
- Cloudflare Workers Static Assets SPA routing: https://developers.cloudflare.com/workers/static-assets/routing/single-page-application/
- Cloudflare Workers GitHub integration: https://developers.cloudflare.com/workers/ci-cd/builds/git-integration/github-integration/
- Cloudflare Workers Builds configuration: https://developers.cloudflare.com/workers/ci-cd/builds/configuration/
- Cloudflare Workers Preview URLs: https://developers.cloudflare.com/workers/configuration/previews/
- Cloudflare Workers rollbacks: https://developers.cloudflare.com/workers/configuration/versions-and-deployments/rollbacks/
- Cloudflare Workers platform limits: https://developers.cloudflare.com/workers/platform/limits/
- Cloudflare D1 limits: https://developers.cloudflare.com/d1/platform/limits/
- Cloudflare R2 pricing: https://developers.cloudflare.com/r2/pricing/
- Cloudflare Pages limits: https://developers.cloudflare.com/pages/platform/limits/
- Cloudflare Pages build image: https://developers.cloudflare.com/pages/configuration/build-image/
- Vercel pricing: https://vercel.com/pricing
- Netlify pricing: https://www.netlify.com/pricing/
- GitHub Pages limits: https://docs.github.com/en/pages/getting-started-with-github-pages/github-pages-limits
- Firebase pricing: https://firebase.google.com/pricing
- GitHub `actions/setup-node`: https://github.com/actions/setup-node
- GitHub `actions/checkout`: https://github.com/actions/checkout
- GitHub Actions Node 20 runtime deprecation: https://github.blog/changelog/2025-09-19-deprecation-of-node-20-on-github-actions-runners/

## Current Deployment Context

1. The repo currently has no production deployment configuration.
2. `frontend/package.json` exposes only:
   - `npm run dev` -> Vite dev server.
   - `npm run build` -> `vite build`.
   - `npm run lint` -> `eslint .`.
   - `npm run preview` -> local Vite static preview.
3. `frontend/vite.config.ts` uses `@vitejs/plugin-react` and Vitest jsdom setup. There is no custom base path, PWA plugin, service worker, or deployment-specific output configuration.
4. `.github/workflows/ci.yml` already exists. It runs from `frontend/` on `push` and `pull_request`, uses Node 22, runs `npm ci`, `npx tsc --noEmit`, `npm run lint`, and `npx vitest run`, but it does not run `npm run build`.
5. There is no `.nvmrc`, `.node-version`, `.tool-versions`, `wrangler.jsonc`, or Cloudflare deployment config in the repo today.
6. The app is a pure static SPA today. That makes static hosting enough for the frontend, but the recommended Phase 1.3 backend path is Cloudflare Worker + D1.
7. The PDF's deployment reality is campus operation: a PC web POS is the accounting authority, future iPad is only an input sensor, and lunch service cannot stop during remote outage.
8. Cloudflare's current Workers best-practices documentation says Workers Static Assets is the recommended way to deploy new static sites, SPAs, and full-stack apps on Cloudflare; new projects should use Workers instead of Pages.

## Deployment Goals

- Host the Vite app for free with custom domain and HTTPS.
- Keep static asset requests on the free/unlimited static asset path where possible.
- Pair frontend assets, Worker API, D1, DNS, TLS, preview deployments, and rollback in one Cloudflare stack when the Cloudflare backend plan is accepted.
- Support GitHub-based CI/CD from PR to preview to production.
- Keep GitHub Actions as the merge gate, not Cloudflare build status alone.
- Keep staging and production separated by branch, environment, and public `VITE_*` config.
- Keep rollback operator-friendly during lunch service incidents.
- Keep the hosting layer independent from POS accounting correctness: remote hosting outage should not corrupt local ledger state.
- Prepare for PWA/offline installability without implementing service worker details in this plan.
- Keep secrets out of the frontend. `VITE_*` values are public config only.

## Hosting Evaluation Criteria

| Criterion | What Good Looks Like For EasyOrder |
|---|---|
| Free allowance | Enough asset traffic/builds for one campus without surprise charges. |
| Static/API routing | Static assets bypass Worker execution; API routes invoke Worker intentionally. |
| Custom domain | `easyorder.<domain>` or customer-owned domain can be attached without paid plan. |
| HTTPS | Automatic TLS for default and custom domains. |
| CI/CD | GitHub PRs build previews; protected production branch deploys production. |
| Preview deployments | Reviewer and user can test each PR on a stable preview URL before merge. |
| Backend pairing | Frontend can call selected backend with environment-specific API URLs and compatible CORS. |
| Rollback | Operator can promote a previous frontend/API version quickly, with D1 migration caveats documented. |
| Campus network fit | Works through common school firewalls/proxies and does not require same-LAN hosting. |
| PWA readiness | Static assets can later be cached and versioned safely. |

## Candidate Evaluation

### 1. Cloudflare Workers Static Assets + Worker API + D1

| Dimension | Evaluation |
|---|---|
| Free allowance | Static asset requests are free and unlimited, and storing Assets has no additional cost. Dynamic API traffic still counts against normal Workers plan limits. |
| Official direction | Cloudflare Workers best practices now recommend Workers Static Assets for new static sites, SPAs, and full-stack apps. Pages continues to work, but Cloudflare says new features and optimizations are focused on Workers. |
| Static/API routing | Strong. Asset-first routing serves matching static files without invoking the Worker. Use `assets.run_worker_first` only for `/api/*` so static lunch-time app loads do not spend Worker request quota. |
| File limits | Workers Static Assets supports 20,000 static asset files per Worker version on Free, 100,000 on Paid, and 25 MiB max single asset. |
| Custom domain | Supported through Workers routes/custom domains. Use a production custom domain so campus IT does not need to allowlist provider preview domains for daily operation. |
| HTTPS automation | Cloudflare manages TLS for Cloudflare-routed custom domains. |
| CI/CD | Workers Builds can connect to GitHub and deploy automatically on pushes. GitHub Actions should still run the repo verification gate before merge. |
| Preview deployments | Strong enough for this fleet. Workers GitHub integration posts PR comments, exposes check runs, and includes preview URLs for builds that upload Worker versions. Workers Preview URLs also support versioned URLs and aliased preview URLs. |
| Backend pairing | Best fit when the backend is Worker + D1. Static assets, API, D1 bindings, custom domains, preview, deploy, and rollback live in one Cloudflare Worker surface. |
| Rollback | Workers can roll back through Wrangler or the Cloudflare dashboard to the most recent 100 published versions. D1 schema rollback remains a separate policy decision. |
| Campus network | Strong CDN and TLS story. If `workers.dev` preview domains are blocked, use custom domains for production and Cloudflare Access or explicit preview allowlisting for test users. |
| PWA readiness | Strong. Hashed Vite assets can be served as static assets; `index.html` and service worker cache policy must be handled carefully in the later PWA plan. |
| Verdict | **Recommended primary hosting** when Cloudflare Workers + D1 is selected. |

Recommended initial `wrangler.jsonc` shape for the follow-up implementation plan:

```jsonc
{
  "$schema": "node_modules/wrangler/config-schema.json",
  "name": "talented-easyorder",
  "compatibility_date": "2026-05-15",
  "main": "src/worker/index.ts",
  "assets": {
    "directory": "./dist",
    "not_found_handling": "single-page-application",
    "run_worker_first": ["/api/*"]
  },
  "preview_urls": true,
  "observability": {
    "enabled": true
  },
  "vars": {
    "EASYORDER_ENVIRONMENT": "preview"
  },
  "env": {
    "staging": {
      "name": "talented-easyorder-staging",
      "vars": {
        "EASYORDER_ENVIRONMENT": "staging"
      }
    },
    "production": {
      "name": "talented-easyorder-production",
      "vars": {
        "EASYORDER_ENVIRONMENT": "production"
      }
    }
  }
}
```

Implementation notes:

- Put `wrangler.jsonc` under `frontend/` if the Worker project root is `frontend/`; otherwise use a repo-root file and make every command explicit about `frontend` build paths.
- Use `assets.run_worker_first: ["/api/*"]`; do not set `run_worker_first: true` for the static SPA because that would invoke Worker code for every app-shell asset request and can turn static traffic into Worker request quota usage.
- Use `assets.not_found_handling: "single-page-application"` so browser navigation routes fall back to the SPA shell without requiring the Worker for every non-API route.
- Keep `VITE_*` values public. Backend secrets, D1 bindings, and provider tokens belong in Worker bindings/secrets or GitHub/Cloudflare secret stores, never in committed frontend config.
- If a no-API first deployment is desired, the first PR may ship only static assets and `wrangler.jsonc`; add `src/worker/index.ts` with `/api/health` when the backend plan starts.

### Cloudflare Free-Tier Guardrails

These limits matter to deployment design, but they should not be mixed up:

| Product | Current free-limit fact | Deployment implication |
|---|---|---|
| Workers Static Assets | Static asset requests are free and unlimited; storing Assets has no additional cost. | Vite JS/CSS/icon/app-shell requests should remain asset-first and should not invoke the Worker. |
| Workers Free | 100,000 Worker requests/day, 10 ms CPU, 50 subrequests/invocation, 100 Workers/account, 20,000 static asset files per Worker version, 25 MiB max individual static asset. | `/api/*` and any `run_worker_first` route consumes Worker quota; do not route all SPA requests through Worker code unless the user accepts that quota risk. |
| D1 Free | 10 databases/account, 500 MB maximum database size, 5 GB maximum storage per account, 7-day Time Travel, 50 queries per Worker invocation. | Good enough for a single-campus pilot, but schema/import/migration plans must watch the 500 MB per-database cap, not just the 5 GB account cap. |
| R2 Free | Standard storage includes a monthly free allowance such as 10 GB storage plus operation allowances; R2 has no egress fees. | R2 is not required for the Vite static app because Workers Static Assets stores app assets. Revisit R2 only for future photos, exports, PDFs, backups, or model files. |

Backend-provider note:

- This hosting plan assumes Plan 1's accepted default remains Cloudflare Workers + D1.
- If the user later chooses Neon Postgres instead, Workers Static Assets can still host the frontend/API Worker, but the Worker needs Hyperdrive or external database connection design.
- If the user later chooses Turso, re-check the current Turso free tier and edge-database fit before implementation; do not treat old "Turso" product names or limits as stable.

### 2. Cloudflare Pages Free

| Dimension | Evaluation |
|---|---|
| Free allowance | Cloudflare Pages Free has 500 builds/month, 1 build at a time, 20-minute build timeout, 20,000 files/site, 25 MiB max single asset, unlimited active preview deployments, and a soft 100-project account limit. |
| Custom domain | Up to 100 custom domains per Pages project on Free. Apex domains work best when the domain is on Cloudflare DNS; subdomains can be connected without making the whole site a Cloudflare zone. |
| HTTPS automation | Cloudflare automatically serves Pages over HTTPS and manages certificates for Cloudflare-routed custom domains. |
| CI/CD | Native Git integration builds on pushes/PRs. GitHub Actions can also use direct upload if the team wants full control over verification before deploy. |
| Preview deployments | Excellent. Pages has first-class preview deployments, branch aliases, and UI rollback. |
| Backend pairing | Usable with Cloudflare Worker + D1, but frontend and API are separate deployment surfaces. CORS or same-zone routing must be designed carefully. |
| Rollback | Pages supports rolling back to a previous deployment. Worker rollback remains separate. |
| Campus network | Strong CDN and TLS story. If school firewall blocks `pages.dev`, use a custom domain on Cloudflare DNS and verify from campus Wi-Fi before launch. |
| PWA readiness | Strong for static app assets. Need careful cache busting for `index.html`. |
| Verdict | **Fallback / explicit override only.** Use Pages if the user values Pages' dedicated static-site dashboard more than Cloudflare's current new-project recommendation and accepts the separate Worker API deployment surface. |

Pages override policy:

- Do **not** pick Pages by habit. The default Cloudflare recommendation for this project is Workers Static Assets.
- If the user chooses Pages anyway, document the explicit reason in `docs/deployment/cloudflare-pages-runbook.md`, such as operator familiarity with Pages' static-site UI or an existing Pages account/process.
- When using Pages, keep Worker API deployment and D1 migration rollback as separate runbook sections, because Pages rollback does not roll back Worker code or D1 schema state.

### 3. Vercel Hobby

| Dimension | Evaluation |
|---|---|
| Free allowance | Hobby is free for personal projects. Static Vite app should stay below normal limits, but Hobby cannot buy extra usage and is framed for personal projects. |
| Custom domain | Supported. Vercel has first-class domain UI and generated deployment URLs. |
| HTTPS automation | Vercel automatically attempts to generate certificates for domains added to a project. |
| CI/CD | Excellent GitHub integration and automatic deployments. |
| Preview deployments | Strong PR preview workflow. |
| Backend pairing | Good for frontend-only hosting, but less cohesive with a Cloudflare Worker + D1 backend. Cross-origin API calls and CORS must be managed. |
| Rollback | Good deployment history and redeploy flow. |
| Campus network | Generally good CDN reach. If school blocks `vercel.app`, use custom domain. |
| PWA readiness | Good for static app assets. Avoid Vercel-only dynamic features unless accepted as part of the hosting strategy. |
| Verdict | **Good developer experience, not primary** because the previous backend recommendation is Cloudflare and Hobby's production/commercial fit needs user/legal confirmation. |

### 4. Netlify Free

| Dimension | Evaluation |
|---|---|
| Free allowance | Netlify Free provides a credit model. If a project reaches its credit limit, Netlify can pause the site until the next billing cycle. |
| Custom domain | Free plan includes custom domains with SSL. |
| HTTPS automation | Netlify provides free HTTPS, including automatic certificate creation and renewal for Netlify-managed certificates. |
| CI/CD | Strong Git integration. One concurrent build on Free. |
| Preview deployments | Deploy previews and branch deploys fit review workflows. |
| Backend pairing | Fine for static frontend calling Cloudflare Worker API, but no operational advantage over Cloudflare Workers Static Assets if backend is Cloudflare. |
| Rollback | Good deploy history and publish previous deploy capability. |
| Campus network | Generally good CDN. Credit-based bandwidth/request model is a risk for a strict free production app. |
| PWA readiness | Good static hosting behavior. |
| Verdict | **Usable fallback**, but the credit model and account-wide pause behavior are poor fit for lunch-service reliability. |

### 5. GitHub Pages

| Dimension | Evaluation |
|---|---|
| Free allowance | GitHub Pages published sites may be no larger than 1 GB, deployments time out after 10 minutes, sites have a soft 100 GB/month bandwidth limit, and a soft 10 builds/hour limit unless using a custom GitHub Actions workflow. |
| Custom domain | Supported. Custom domain setup requires DNS and repository/domain verification discipline. |
| HTTPS automation | GitHub Pages supports HTTPS for correctly configured Pages sites, including custom domains. |
| CI/CD | GitHub Actions can build Vite and deploy Pages. This gives explicit CI control but less managed hosting UX. |
| Preview deployments | Weak. GitHub Pages has no first-class PR preview deployments. A team can script branch-specific previews, but that adds operational complexity and domain clutter. |
| Backend pairing | Works as a static frontend calling Cloudflare Worker API, but CORS and preview-origin policy are less convenient. |
| Rollback | Rollback is a git revert/redeploy or Actions artifact flow, not a simple hosting dashboard operation. |
| Campus network | Good if served on custom domain. GitHub Pages terms/usage framing should be checked before production POS use. |
| PWA readiness | Adequate for static assets. Must configure Vite `base` carefully if deployed under a project path rather than a root custom domain. |
| Verdict | **Use for docs/demo only**, not recommended as production POS hosting unless the user explicitly accepts the terms and weak preview/rollback tradeoffs. |

### 6. Firebase Hosting Spark

| Dimension | Evaluation |
|---|---|
| Free allowance | Firebase Hosting Spark lists 10 GB storage and 360 MB/day data transfer. This is enough for a small static bundle but can be tight if many iPads/PCs reload assets often or if media assets grow. |
| Custom domain | Supported. Firebase Hosting provisions SSL certificates for custom domains and serves through Google's global CDN. |
| HTTPS automation | Automatic SSL provisioning and re-provisioning are documented for custom domains. Provisioning can take up to 24 hours. |
| CI/CD | Firebase CLI works well from GitHub Actions. Native preview channels exist, but the exact workflow must be configured. |
| Preview deployments | Good with Firebase Hosting preview channels, but less central to this repo than Cloudflare Workers if backend is Cloudflare. |
| Backend pairing | Strong only if the backend choice changes to Firebase Spark/Firestore. Otherwise it adds a second cloud account while backend remains Cloudflare. |
| Rollback | Firebase Hosting supports version history/rollback through CLI/console. |
| Campus network | Generally good CDN. Google services are usually reachable, but campus Google restrictions should be tested. |
| PWA readiness | Strong; Firebase Hosting is common for PWAs. |
| Verdict | **Secondary only if Firebase backend is selected**. Not the best pair for Cloudflare Workers + D1. |

## Recommendation

### Primary: Cloudflare Workers Static Assets + Worker API + D1

Use Cloudflare Workers Static Assets as the default Cloudflare frontend host when the user accepts the previous plan's Cloudflare Workers + D1 backend recommendation.

Recommended production shape:

```text
GitHub PR
  -> CI: npm ci, lint, typecheck, test, build in frontend/
  -> Workers Builds non-production upload
  -> PR comment/check run includes preview URL
  -> reviewer/user verifies preview
  -> merge to protected main or production branch
  -> Workers production deployment
  -> static assets served from Workers Static Assets
  -> /api/* invokes Worker API
  -> Worker API writes/reads D1
```

Why this is the best default:

- It follows Cloudflare's current new-project guidance for static sites, SPAs, and full-stack apps.
- Static assets can be free/unlimited and can avoid Worker invocation when `run_worker_first` is limited to `/api/*`.
- One provider surface owns frontend assets, API, D1 bindings, DNS, TLS, preview URLs, rollback, and observability.
- Workers GitHub integration now covers the review loop with PR comments, check runs, and preview URLs.
- Workers rollback supports dashboard/Wrangler rollback to recent versions; the D1 rollback caveat is visible in the same deployment model.
- It avoids a Pages frontend plus separate Worker API split unless the user explicitly wants that split.

### Fallback: Cloudflare Pages + separate Worker API + D1

Use Pages only as an explicit override if the user decides Pages' static-site dashboard, branch alias UX, or team familiarity outweigh Cloudflare's Workers new-project guidance.

### Secondary: Firebase Hosting Only If Firebase Spark Is Chosen As Backend

If the user rejects Cloudflare and chooses Firebase Spark for backend/realtime reasons, use Firebase Hosting for frontend. Keeping frontend and backend under Firebase simplifies account ownership, custom domain, preview channels, and Firebase SDK config.

Do not mix Firebase Hosting with Cloudflare D1 unless there is a strong domain/DNS reason; it adds another cloud surface without solving a real problem.

## Not Recommended As Primary

- Vercel Hobby: strong DX, but the plan is framed for personal projects and is not as cohesive with Cloudflare D1.
- Netlify Free: strong DX, but credit exhaustion can pause the site and account, which is a bad lunch-service failure mode.
- GitHub Pages: useful for docs/demo, but weak PR previews/rollback and terms/usage framing make it poor production POS hosting.

## Campus Network And Device Considerations

### School Firewall / Proxy

- Use a custom domain for production, not the provider default domain. Some campuses may block `*.workers.dev`, `*.pages.dev`, `*.vercel.app`, `*.netlify.app`, or `*.web.app` by category.
- Test from the actual school Wi-Fi and wired PC network before launch:
  - production frontend URL
  - staging frontend URL
  - Worker/API health URL
  - asset loading for JS/CSS/fonts/icons
  - iPad Safari camera permissions later in Phase 2
- Avoid multi-provider dependency for the critical path. If frontend assets, API, DNS, and D1 are on Cloudflare, fewer domains need allowlisting.
- Prepare an allowlist note for IT:
  - `https://app.easyorder.example`
  - `https://api.easyorder.example` or `/api/*` on the app domain if same-origin routing is selected
  - Cloudflare TLS/CDN endpoints behind those domains

### PC + iPad Same LAN

- The PC remains the accounting authority. iPad is only a handoff/input device in Phase 2.
- Hosting does not require PC and iPad to be on the same LAN. Both can reach the hosted frontend/API over HTTPS.
- Same-LAN direct discovery is out of scope for this hosting plan. It would add firewall, mDNS, TLS, and device-trust complexity.
- If future Phase 2 needs low-latency handoff, use backend-mediated handoff events first. Only consider LAN fallback after the hosted route is proven insufficient.

### Offline Availability / PWA Boundary

- This plan only selects hosting and deployment. It does not implement service workers, install prompts, or cache strategy.
- Hosting must be PWA-ready:
  - serve static assets with cache-friendly hashed filenames from Vite.
  - keep `index.html` short-cache or no-cache so deploy rollback reaches devices promptly.
  - later PWA work must cache the app shell and queue sync operations without hiding stale app versions.
- Offline service rule:
  - If the app is already loaded and network drops, POS local service should continue from local state.
  - If a device is cold-started with no cached app and network is unavailable, hosting cannot help; PWA app-shell caching must cover that in a separate plan.

## CI/CD Pipeline Design

### Branch And Environment Model

| Environment | Source | Frontend URL | Backend URL | Purpose |
|---|---|---|---|---|
| Preview | Every PR branch | Workers versioned or aliased preview URL | Worker preview/staging API or fake API depending on PR type | Reviewer/user validation before merge. |
| Staging | `develop` or `staging` branch | `staging.easyorder.example` or `staging-talented-easyorder.<subdomain>.workers.dev` | `https://api-staging.easyorder.example` or staging Worker env | Operator rehearsal and migration dry runs. |
| Production | `main` or `production` branch | `easyorder.example` | `/api/*` same-origin or `https://api.easyorder.example` | Real campus POS service. |

Recommended default: use `main` for production and PR previews for review. Add a dedicated `staging` branch only if the user wants long-lived UAT separate from PR previews.

Preview alias convention:

- Use versioned preview URLs for every PR build.
- Use aliased preview URLs only for stable human-facing channels:
  - `pr-<number>` for a live PR preview if the branch name is too long.
  - `staging` for long-lived staging.
  - `training` for operator rehearsal if the user wants a separate practice environment.
- Keep aliases lowercase letters, numbers, and dashes; ensure alias plus Worker name stays under the DNS label limit.
- Protect production data: preview aliases must use fake/staging API config unless the user explicitly approves read-only production data for UAT.

### GitHub Actions Verification Gate

Modify the existing `.github/workflows/ci.yml`; do **not** create a second frontend workflow. The repo already has one frontend CI gate using Node 22 from `frontend/`. The deployment implementation should extend that gate with `npm run build` and pin the exact Node version in source control.

Recommended Node source of truth:

```text
frontend/.node-version = 22.16.0
```

Reasoning:

- Existing CI already uses Node 22.
- Cloudflare Pages' v3 build image default is Node 22.16.0, and pinning the same version still helps if Pages is used as a fallback.
- Workers Builds should also read the same project Node version during frontend build setup.
- Pinning `frontend/.node-version` makes GitHub Actions and Cloudflare build logs comparable instead of relying on mutable provider defaults.
- Use `frontend/.node-version` rather than a root `.node-version` because CI and the recommended Workers project root should run from `frontend/`.

Recommended `.github/workflows/ci.yml` shape:

```yaml
name: Frontend CI

on:
  push:
  pull_request:

jobs:
  build-and-test:
    runs-on: ubuntu-latest
    defaults:
      run:
        working-directory: frontend
    steps:
      - uses: actions/checkout@v6
      - uses: actions/setup-node@v6
        with:
          node-version-file: frontend/.node-version
          cache: npm
          cache-dependency-path: frontend/package-lock.json
      - run: npm ci
      - run: npx tsc --noEmit
      - run: npm run lint
      - run: npx vitest run
      - run: npm run build
```

Action version note:

- `actions/setup-node@v6` is the current documented major and supports `node-version-file`.
- `actions/checkout@v6` is shown in the current setup-node examples; if the repo cannot move to v6 immediately, record the reason and upgrade separately.
- GitHub says runners begin using Node 24 by default on June 2, 2026 as part of Node 20 deprecation. Using current action majors avoids adding a known near-term runtime warning to new deployment docs.

Keep the existing always-on `push` and `pull_request` triggers unless branch protection is explicitly designed for skipped checks. Path-filtered required checks can block merges when GitHub marks the workflow as skipped, so a simple always-on frontend gate is safer for this small repo.

Why GitHub Actions even if Workers Builds has GitHub integration:

- The repo already defines a global gate in `ROADMAP.md`: `npx tsc --noEmit`, `npm run lint`, `npx vitest run`, `npm run build` from `frontend/`.
- Workers Builds proves deployability but should not replace the repo's code-quality merge gate.
- CI should be the merge gate. Cloudflare deployment should happen only from reviewed/merged code.

### Workers Builds Settings

Use these settings for the Vite frontend and Worker:

```text
Project root: frontend
Build command: npm ci && npm run build
Build output directory: dist
Deploy command for PR/non-production: npx wrangler versions upload --preview-alias pr-${PR_NUMBER}
Deploy command for production: npx wrangler deploy --env production
Node version: 22.16.0 from frontend/.node-version
Wrangler config: frontend/wrangler.jsonc
```

If the Worker API source lives outside `frontend/`, keep `frontend/` as the app build root but document the exact build/deploy command in `docs/deployment/cloudflare-workers-runbook.md`. Do not rely on implicit current directories.

The implementer must verify the exact Workers Builds UI/CLI semantics during setup and document the final settings in `docs/deployment/cloudflare-workers-runbook.md`.

### Branch Protection And Required Status Checks

Before enabling production auto-deploy from `main`, configure repository protection so deployment only happens from reviewed and verified code:

- Protect `main`.
- Require pull request review approval before merge.
- Require the GitHub Actions frontend gate as a status check. Expected check name after the workflow update is `Frontend CI / build-and-test`, but the implementer must verify GitHub's displayed check name after the first run.
- Require branches to be up to date before merge, or use merge queue if available.
- Require conversation resolution.
- Restrict direct pushes to `main` for normal contributors.
- Configure Workers production deployment branch as protected `main`.
- Treat Workers Builds/Cloudflare deploy status as deployment evidence, not as the merge gate. GitHub Actions remains the required merge gate.

### Environment Variables

Frontend variables are public at build time. Do not put secrets in `VITE_*` variables.

Recommended frontend variables:

```text
VITE_EASYORDER_ENVIRONMENT=preview | staging | production
VITE_EASYORDER_API_BASE_URL=/api | https://api-preview.example | https://api-staging.example | https://api.example
VITE_EASYORDER_SYNC_TRANSPORT=cloudflare_d1 | fake
```

Recommended Worker variables and bindings:

```text
EASYORDER_ENVIRONMENT=preview | staging | production
D1 binding: EASYORDER_DB
Worker secrets: provider tokens or admin-only credentials, if any
```

Backend secrets belong in Cloudflare Worker secrets or D1 bindings, not in frontend variables or committed files.

### Deployment Flow

1. Developer opens PR.
2. GitHub Actions runs frontend verification.
3. Workers Builds creates a non-production Worker version and preview URL.
4. Cloudflare GitHub integration posts PR comment/check run with build status and preview URL.
5. `general` or reviewer validates the preview URL if the task involves UI/deployment behavior.
6. Branch protection allows merge to `main` only after review approval, green `Frontend CI / build-and-test`, and resolved conversations.
7. Workers production deploy runs from `main`.
8. Post-deploy smoke check runs:
   - production URL returns 200.
   - app shell loads JS/CSS assets.
   - `/api/health` succeeds from browser context when API is in scope.
   - static asset requests do not invoke the Worker unless they match `/api/*`.
   - `VITE_EASYORDER_ENVIRONMENT` displays production in a non-sensitive diagnostics panel or build metadata endpoint.
9. If smoke fails, roll back the Worker deployment and keep D1 unchanged unless a backend release explicitly changed D1.

## Rollback Strategy

### Worker + Static Assets Rollback

Use Workers rollback for frontend/API incidents where the previous Worker version remains compatible with D1:

1. Identify last known good Worker version in Cloudflare dashboard or Wrangler.
2. Roll back to that version through dashboard or `wrangler rollback`.
3. Verify production app shell loads from the custom domain.
4. Verify `/api/health` and one read-only diagnostics request.
5. Confirm existing local queue/localStorage/IndexedDB data is not migrated backwards destructively.
6. Open a fix PR for the bad commit rather than editing production manually.

### D1 Rollback

D1 schema rollback must be stricter than code/static rollback:

- Worker code can roll back to a prior version if API contract remains compatible.
- D1 schema migrations must be forward-compatible where possible.
- Destructive D1 migrations require a backup/export and explicit operator approval.
- A Worker rollback does not change D1 resources or deleted/modified bindings.
- Frontend deployment must not assume D1 rollback unless the backend version is part of the same release decision.

### Cache Rollback

When PWA is introduced later, rollback must also address service-worker cache:

- `index.html` should not be cached long-term by CDN or service worker.
- service worker should have a versioned app shell and explicit update flow.
- emergency rollback must include a way to force clients to fetch the previous compatible asset set.

## Files For Follow-Up Implementation Plan

This hosting strategy should become a provider-specific implementation plan after user decisions are resolved. Suggested file set for Cloudflare Workers Static Assets:

| File | Purpose |
|---|---|
| `.github/workflows/ci.yml` | Existing frontend CI gate; add build, use `frontend/.node-version`, and update checkout/setup-node action majors. |
| `frontend/.node-version` | Pin Node 22.16.0 for GitHub Actions and Cloudflare build parity. |
| `frontend/wrangler.jsonc` | Workers Static Assets config, preview URLs, environment names, and `assets.run_worker_first: ["/api/*"]`. |
| `frontend/src/worker/index.ts` | Worker API entrypoint once `/api/health` or D1-backed endpoints are in scope. |
| `frontend/src/config/runtimeConfig.ts` | Typed public runtime/build config with environment label and API base URL. |
| `frontend/src/config/__tests__/runtimeConfig.test.ts` | Verify config validation rejects missing/invalid API base URL. |
| `docs/deployment/cloudflare-workers-runbook.md` | Workers Builds settings, domains, environment variables, preview alias convention, routing, rollback, and smoke steps. |
| `docs/deployment/branch-protection.md` | Required checks, review requirement, direct-push restriction, and Cloudflare production branch policy. |
| `docs/deployment/campus-network-checklist.md` | School IT allowlist, PC/iPad browser checks, custom domain/TLS checks. |
| `docs/deployment/smoke-checks.md` | Production and preview smoke checks, including static-vs-Worker route checks. |
| `.github/workflows/deploy-preview-smoke.yml` | Optional smoke check against preview URLs after Workers Build. |

Do not add PWA service worker implementation in the first hosting PR unless the user explicitly expands scope.

## Suggested Follow-Up Task Breakdown

| Task ID | Title | Primary Files | Depends On |
|---|---|---|---|
| EO-DEPLOY-T01 | Cloudflare Workers decision record and runbook | `docs/deployment/cloudflare-workers-runbook.md` | User hosting decision |
| EO-DEPLOY-T02 | Existing CI gate and Node/action parity | `.github/workflows/ci.yml`, `frontend/.node-version` | EO-DEPLOY-T01 |
| EO-DEPLOY-T03 | Workers Static Assets config | `frontend/wrangler.jsonc`, optional `frontend/src/worker/index.ts` | EO-DEPLOY-T02 |
| EO-DEPLOY-T04 | Branch protection and required checks | `docs/deployment/branch-protection.md`, GitHub repository settings | EO-DEPLOY-T02 |
| EO-DEPLOY-T05 | Typed public runtime config | `frontend/src/config/runtimeConfig.ts`, `frontend/src/config/__tests__/runtimeConfig.test.ts` | EO-DEPLOY-T02 |
| EO-DEPLOY-T06 | Workers Builds environment setup | Cloudflare dashboard/CLI settings, no committed secrets | EO-DEPLOY-T03, EO-DEPLOY-T04 |
| EO-DEPLOY-T07 | Staging/production smoke checks | `.github/workflows/deploy-preview-smoke.yml`, `docs/deployment/smoke-checks.md` | EO-DEPLOY-T06 |
| EO-DEPLOY-T08 | Campus network readiness checklist | `docs/deployment/campus-network-checklist.md` | EO-DEPLOY-T06 |
| EO-DEPLOY-T09 | Rollback drill | `docs/deployment/rollback-drill.md` | EO-DEPLOY-T07 |

## Testing And Verification Strategy

| Scope | Command / Check | Expected Result |
|---|---|---|
| Local frontend gate | `cd frontend && npm ci && npm run lint && npx tsc --noEmit && npx vitest run && npm run build` | All pass; `dist/` is produced. |
| Node parity | `cat frontend/.node-version` and inspect GitHub Actions + Workers Builds logs | All use Node 22.16.0. |
| Required check | Open PR branch protection status | Merge is blocked until `Frontend CI / build-and-test` passes. |
| Workers config | `cd frontend && npx wrangler deploy --dry-run --env staging` or equivalent validation command | Wrangler reads `wrangler.jsonc`, asset directory, preview setting, and env without schema errors. |
| Static/API routing | Request hashed asset and `/api/health` in preview | Asset request is served as static asset; `/api/health` invokes Worker. |
| Preview deploy | Open Workers preview URL from PR comment/check run | App shell loads; no console errors from missing env. |
| Production deploy | Open custom production URL | HTTPS valid; app loads from custom domain. |
| API CORS/same-origin | Browser calls `GET /api/health` or configured API origin | Success from production and staging origins only. |
| Campus Wi-Fi | PC and iPad open production URL on school network | App loads; API health succeeds. |
| Rollback | Roll back staging Worker to previous version | Staging returns previous build/API; local data remains readable. |
| No secrets | Search committed files for backend tokens | No Worker secret, D1 token, Firebase token, or provider API token in repo. |

## DISCUSS WITH USER Decision Points

> ⚠️ DISCUSS WITH USER: Is Cloudflare acceptable as the single provider for frontend static assets, backend Worker, D1 database, DNS, TLS, and deployment ownership?

> ⚠️ DISCUSS WITH USER: Within Cloudflare, do we accept Workers Static Assets as the default because Cloudflare recommends Workers for new static/SPAs/full-stack apps, or is there an explicit reason to override to Pages?

> ⚠️ DISCUSS WITH USER: If Workers Static Assets is selected, should production use same-origin `/api/*` routing or a separate `api.easyorder.example` domain?

> ⚠️ DISCUSS WITH USER: Will the production app use a custom domain owned by the school/operator, and can that domain or subdomain be delegated to Cloudflare DNS?

> ⚠️ DISCUSS WITH USER: Can we enforce `main` branch protection before production auto-deploy, including required PR review and the `Frontend CI / build-and-test` status check?

> ⚠️ DISCUSS WITH USER: Should production deploy automatically on every `main` merge, or require a manual approval step after merge?

> ⚠️ DISCUSS WITH USER: Do we need a long-lived staging URL, or are PR preview deployments enough before production?

> ⚠️ DISCUSS WITH USER: Who will own the Cloudflare/Firebase/Vercel/Netlify/GitHub account, recovery email, 2FA, billing-disabled/free-plan monitoring, and emergency rollback permission?

> ⚠️ DISCUSS WITH USER: Does the campus network block Cloudflare, Vercel, Netlify, GitHub Pages, Firebase, or provider default domains? We need a real PC + iPad test on campus Wi-Fi before launch.

> ⚠️ DISCUSS WITH USER: Is PWA offline cold-start required for launch, or is it acceptable that offline support initially requires the app to have been loaded before the network outage?

> ⚠️ DISCUSS WITH USER: Should preview deployments point to a fake/staging backend only, or can they ever point at production read-only data for user acceptance testing?

## Final Position

For the current architecture and the previous free-backend recommendation, use **Cloudflare Workers Static Assets** as the production frontend host with Worker API + D1. This follows Cloudflare's current new-project guidance and keeps frontend assets, API, D1 bindings, DNS/TLS, preview URLs, deployment, rollback, and observability in one Cloudflare Worker model.

Use **Cloudflare Pages** only as an explicit override if the user prioritizes Pages' dedicated static-site dashboard or has an existing Pages process. If the user chooses Firebase Spark as the backend, use **Firebase Hosting** instead. Otherwise, treat Vercel, Netlify, and GitHub Pages as fallback/demo options rather than the production POS hosting path.
