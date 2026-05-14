# Deployment Hosting Strategy Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use `superpowers:writing-plans` for any follow-up implementation plan. This document is a deployment and hosting strategy plan; do not implement deployment config directly from it until the `DISCUSS WITH USER` points are resolved.

**Goal:** Define a completely free production deployment path for Talented EasyOrder's Vite/React frontend that fits the recommended free backend architecture and the PC + iPad campus deployment model.

**Architecture:** Deploy the frontend as a Vite static asset bundle on Cloudflare Workers Static Assets by default, paired with the Cloudflare Worker + D1 API from the free backend plan. Keep the app local-first: hosting availability affects app load/update, but already-loaded POS service must continue from local state and PWA cache once that layer exists. Static assets should be served asset-first, while `/api/*` routes run the Worker script first and use D1 bindings.

**Tech Stack:** Vite 8, React 19, TypeScript 6, Zustand 5, Vitest 4, ESLint 10, Cloudflare Workers Static Assets, Cloudflare Workers + D1, Wrangler, Workers Builds GitHub integration, GitHub Actions, optional Cloudflare Pages / Firebase Hosting / Vercel / Netlify / GitHub Pages fallback paths.

---

## Required Reads Completed

- `docs/superpowers/plans/ROADMAP.md`
- `docs/superpowers/plans/2026-05-15-free-backend-architecture-exploration.md`
- `frontend/package.json`
- `frontend/vite.config.ts`
- `docs/iPad人臉辨識訂餐系統設計方案_V3.pdf`

## Official Provider Sources Checked On 2026-05-15

- Cloudflare Pages limits: https://developers.cloudflare.com/pages/platform/limits/
- Cloudflare Pages custom domains: https://developers.cloudflare.com/pages/configuration/custom-domains/
- Cloudflare Pages preview deployments: https://developers.cloudflare.com/pages/configuration/preview-deployments/
- Cloudflare Pages rollbacks: https://developers.cloudflare.com/pages/configuration/rollbacks/
- Cloudflare Pages build configuration: https://developers.cloudflare.com/pages/configuration/build-configuration/
- Cloudflare Pages build image: https://developers.cloudflare.com/pages/configuration/build-image/
- Cloudflare Workers Static Assets overview: https://developers.cloudflare.com/workers/static-assets/
- Cloudflare Workers Static Assets billing and limits: https://developers.cloudflare.com/workers/static-assets/billing-and-limitations/
- Cloudflare Workers platform limits: https://developers.cloudflare.com/workers/platform/limits/
- Cloudflare Workers React + Vite guide: https://developers.cloudflare.com/workers/framework-guides/web-apps/react/
- Cloudflare Workers best practices: https://developers.cloudflare.com/workers/best-practices/workers-best-practices/
- Cloudflare Workers Builds GitHub integration: https://developers.cloudflare.com/workers/ci-cd/builds/git-integration/github-integration/
- Cloudflare Workers Builds configuration: https://developers.cloudflare.com/workers/ci-cd/builds/configuration/
- Cloudflare Workers Builds build image: https://developers.cloudflare.com/workers/ci-cd/builds/build-image/
- Cloudflare Workers Preview URLs: https://developers.cloudflare.com/workers/configuration/previews/
- Cloudflare Workers rollbacks: https://developers.cloudflare.com/workers/configuration/versions-and-deployments/rollbacks/
- Cloudflare Workers Static Assets SPA routing: https://developers.cloudflare.com/workers/static-assets/routing/single-page-application/
- Cloudflare Workers Static Assets Worker routing: https://developers.cloudflare.com/workers/static-assets/routing/worker-script/
- GitHub `actions/setup-node`: https://github.com/actions/setup-node
- GitHub `actions/checkout`: https://github.com/actions/checkout
- Vercel pricing: https://vercel.com/pricing
- Vercel limits: https://vercel.com/docs/limits/overview
- Vercel domains and SSL: https://vercel.com/docs/domains/working-with-ssl
- Netlify pricing: https://www.netlify.com/pricing/
- Netlify HTTPS: https://docs.netlify.com/manage/domains/secure-domains-with-https/https-ssl/
- GitHub Pages limits: https://docs.github.com/en/pages/getting-started-with-github-pages/github-pages-limits
- GitHub Pages custom domain: https://docs.github.com/en/pages/configuring-a-custom-domain-for-your-github-pages-site
- Firebase pricing: https://firebase.google.com/pricing
- Firebase Hosting custom domain: https://firebase.google.com/docs/hosting/custom-domain

## Current Deployment Context

1. The repo currently has no production deployment configuration.
2. `frontend/package.json` exposes only:
   - `npm run dev` -> Vite dev server.
   - `npm run build` -> `vite build`.
   - `npm run lint` -> `eslint .`.
   - `npm run preview` -> local Vite static preview.
3. `frontend/vite.config.ts` uses `@vitejs/plugin-react` and Vitest jsdom setup. There is no custom base path, PWA plugin, service worker, or deployment-specific output configuration.
4. `.github/workflows/ci.yml` already exists. It runs from `frontend/` on `push` and `pull_request`, uses Node 22, runs `npm ci`, `npx tsc --noEmit`, `npm run lint`, and `npx vitest run`, but it does not run `npm run build`.
5. There is no `.nvmrc`, `.node-version`, or `.tool-versions` file in the repo today.
6. The app is a pure static SPA today. That makes static hosting enough for the frontend, as long as future backend API URLs are provided through build-time `VITE_*` environment variables.
7. The PDF's deployment reality is campus operation: a PC web POS is the accounting authority, future iPad is only an input sensor, and lunch service cannot stop during remote outage.
8. The previous free-backend plan recommends Cloudflare Workers + D1 as the primary zero-cost backend. Cloudflare's current Workers best-practices docs recommend Workers Static Assets, not Pages, for new static sites, SPAs, and full-stack apps.

## Deployment Goals

- Host the Vite app for free with custom domain and HTTPS.
- Support GitHub-based CI/CD from PR to preview to production.
- Keep staging and production separated by branch and environment variables.
- Keep rollback operator-friendly during lunch service incidents.
- Keep the hosting layer independent from POS accounting correctness: remote hosting outage should not corrupt local ledger state.
- Prepare for PWA/offline installability without implementing service worker details in this plan.
- Keep secrets out of the frontend. `VITE_*` values are public config only.

## Hosting Evaluation Criteria

| Criterion | What Good Looks Like For EasyOrder |
|---|---|
| Free allowance | Enough bandwidth/builds for one campus without surprise charges. |
| Custom domain | `easyorder.<domain>` or customer-owned domain can be attached without paid plan. |
| HTTPS | Automatic TLS for default and custom domains. |
| CI/CD | GitHub PRs build previews; `main` or `production` branch deploys production automatically. |
| Preview deployments | Reviewer and user can test each PR on a stable preview URL before merge. |
| Backend pairing | Frontend can call selected backend with environment-specific API URLs and compatible CORS. |
| Rollback | Non-technical operator can redeploy or promote a previous version quickly. |
| Campus network fit | Works through common school firewalls/proxies and does not require same-LAN hosting. |
| PWA readiness | Static assets can later be cached and versioned safely. |

## Candidate Evaluation

### 1. Cloudflare Workers Static Assets

| Dimension | Evaluation |
|---|---|
| Free allowance | Static asset requests are free and unlimited, and Cloudflare documents no additional storage cost for Assets. Dynamic requests that invoke the Worker script still count against the Workers plan. Static assets share the Workers Static Assets limits: 20,000 files per Worker version on Free, 100,000 on Paid, and 25 MiB max single asset. |
| Custom domain | Workers support routes and custom domains through Cloudflare. This keeps app and API under the same Cloudflare account and DNS surface. |
| HTTPS automation | Cloudflare manages HTTPS for proxied custom domains/routes. |
| CI/CD | Workers Builds can connect to GitHub, build on pushes, deploy production from the configured production branch, and upload preview versions for non-production branches. |
| Preview deployments | Workers Preview URLs support versioned preview URLs and aliased preview URLs. The GitHub integration posts PR comments with build status and preview URLs when preview uploads run. |
| Backend pairing | Best fit with the free backend plan. One Worker can serve static frontend assets and handle `/api/*` routes with D1 bindings. |
| Rollback | Workers can roll back through Wrangler or the Cloudflare dashboard. Cloudflare limits rollback targets to the 100 most recently published versions. |
| Campus network | Strong CDN/TLS story. If school firewall blocks `workers.dev`, use a custom domain and test from campus Wi-Fi before launch. |
| PWA readiness | Strong. SPA mode can serve `index.html` for navigation fallback while hashed Vite assets remain asset-first. Need careful cache/update policy once the PWA plan lands. |
| Verdict | **Recommended primary Cloudflare hosting for new project work.** This follows Cloudflare's current Workers best-practices guidance. |

### 2. Cloudflare Pages Free

| Dimension | Evaluation |
|---|---|
| Free allowance | Cloudflare Pages Free has 500 builds/month, 1 build at a time, 20-minute build timeout, 20,000 files/site, 25 MiB max single asset, unlimited active preview deployments, and a soft 100-project account limit. Cloudflare Pages docs do not meter normal static bandwidth in the same credit model as Netlify/Vercel; abuse controls still apply. |
| Custom domain | Up to 100 custom domains per Pages project on Free. Apex domains work best when the domain is on Cloudflare DNS; subdomains can be connected without making the whole site a Cloudflare zone. |
| HTTPS automation | Cloudflare automatically serves Pages over HTTPS and manages certificates for Cloudflare-routed custom domains. |
| CI/CD | Native Git integration builds on pushes/PRs. GitHub Actions can also use direct upload if the team wants full control over verification before deploy. |
| Preview deployments | Unlimited active preview deployments. Branch aliases and preview URLs fit reviewer/user validation. |
| Backend pairing | Works with Cloudflare Workers + D1, but it separates frontend hosting from the Worker deployment and requires CORS or same-zone routing between Pages and Worker API. |
| Rollback | Pages supports rolling back to a previous deployment. Worker rollback must still be handled separately. |
| Campus network | Strong CDN and TLS story. If school firewall blocks `pages.dev`, use a custom domain on Cloudflare DNS and verify from campus Wi-Fi before launch. |
| PWA readiness | Strong. Static assets and service worker can be served from the same origin later. Need careful cache busting for `index.html`. |
| Verdict | **Cloudflare fallback/override only.** Use Pages only if the user explicitly chooses the older Pages workflow or a future Pages-only feature that Workers cannot satisfy. |

### Cloudflare Choice: Workers Static Assets Vs Pages

Cloudflare has two relevant free static-hosting paths for this project, but the default must now be Workers Static Assets because Cloudflare's current best-practices docs say Workers Static Assets is the recommended way to deploy new static sites, SPAs, and full-stack apps on Cloudflare.

| Dimension | Workers Static Assets | Cloudflare Pages |
|---|---|---|
| Official direction | Current Cloudflare guidance for new projects. New features and optimizations are focused on Workers. | Continues to work, but is no longer the preferred new-project default per Cloudflare's Workers best-practices page. |
| Deployment shape | One Worker deployment can serve frontend static assets and `/api/*` routes with D1 bindings. | Frontend Pages project deploys separately from Worker API + D1. |
| Static asset handling | Static asset requests are free and unlimited with no additional storage cost. Dynamic `/api/*` Worker requests still count against Workers limits. | Pages has a separate Pages build/deployment model and 500 builds/month on Free. |
| Preview workflow | Workers Preview URLs support generated version URLs and aliased preview URLs. Workers GitHub integration can add PR comments and check runs. | Pages has mature preview deployments and branch aliases. |
| Rollback | Wrangler/dashboard rollback to the 100 most recently published Worker versions. Rollback does not revert D1/resource changes. | Pages deployment rollback for frontend only; Worker/API rollback remains separate. |
| API pairing | Strongest same-deployment story: static assets and API can share one Worker project and origin. | Requires CORS/same-zone routing between Pages frontend and Worker API. |
| Recommendation | **Primary choice** for this plan. | Fallback only if user deliberately overrides Cloudflare's current guidance. |

Use **Workers Static Assets** first. Recommending Pages would be an explicit override of Cloudflare's current guidance and this plan does not identify a Pages-only advantage that Workers cannot satisfy for EasyOrder.

### 3. Vercel Hobby

| Dimension | Evaluation |
|---|---|
| Free allowance | Hobby is free forever for personal projects. Current pricing lists 100 GB/month Fast Data Transfer, 1M/month Edge Requests, 1M/month function invocations, and 4 hours/month active CPU. Static Vite app should stay far below these limits, but Hobby cannot buy extra usage and is framed for personal projects. |
| Custom domain | Supported. Vercel has first-class domain UI and generated deployment URLs. |
| HTTPS automation | Vercel automatically attempts to generate certificates for domains added to a project. |
| CI/CD | Excellent GitHub integration and automatic deployments. |
| Preview deployments | Strong PR preview workflow. Good reviewer UX. |
| Backend pairing | Good for frontend-only hosting, but less cohesive with a Cloudflare Worker + D1 backend. Cross-origin API calls and CORS must be managed. Vercel Functions are not the chosen free backend. |
| Rollback | Good deployment history and redeploy flow. |
| Campus network | Generally good CDN reach. If school blocks `vercel.app`, use custom domain. |
| PWA readiness | Good for static app assets. Avoid Vercel-only dynamic features unless accepted as part of the hosting strategy. |
| Verdict | **Good developer experience, not primary** because the previous backend recommendation is Cloudflare and Hobby's production/commercial fit needs user/legal confirmation. |

### 4. Netlify Free

| Dimension | Evaluation |
|---|---|
| Free allowance | Netlify Free provides 300 credits/month. Current pricing says production deploys cost 15 credits each, bandwidth costs 20 credits/GB, web requests cost 2 credits/10k requests, and compute costs 10 credits/GB-hour. If a project reaches its credit limit, Netlify says the site enters a paused state until the next billing cycle and one project can pause all projects on the account. |
| Custom domain | Free plan includes custom domains with SSL. |
| HTTPS automation | Netlify provides free HTTPS, including automatic certificate creation and renewal for Netlify-managed certificates. |
| CI/CD | Strong Git integration. One concurrent build on Free. |
| Preview deployments | Unlimited deploy previews and branch deploys are included in the pricing page. |
| Backend pairing | Fine for static frontend calling Cloudflare Worker API, but no operational advantage over Workers Static Assets if backend is Cloudflare. Netlify Functions should not be introduced as a second backend. |
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
| CI/CD | GitHub Actions can build Vite and deploy Pages. This gives the most explicit CI control but less managed hosting UX. |
| Preview deployments | Weak. GitHub Pages has no first-class PR preview deployments. A team can script branch-specific previews, but that adds operational complexity and domain clutter. |
| Backend pairing | Works as a static frontend calling Cloudflare Worker API, but CORS and preview-origin policy are less convenient. |
| Rollback | Rollback is a git revert/redeploy or Actions artifact flow, not a simple hosting dashboard operation. |
| Campus network | Good if served on custom domain. GitHub Pages terms warn it is not intended as free web-hosting for online business/SaaS or sensitive transactions, so production POS use must be checked before choosing it. |
| PWA readiness | Adequate for static assets. Must configure Vite `base` carefully if deployed under a project path rather than a root custom domain. |
| Verdict | **Use for docs/demo only**, not recommended as production POS hosting unless the user explicitly accepts the terms and weak preview/rollback tradeoffs. |

### 6. Firebase Hosting Spark

| Dimension | Evaluation |
|---|---|
| Free allowance | Firebase Hosting Spark lists 10 GB storage and 360 MB/day data transfer. This is enough for a small static bundle but can be tight if many iPads/PCs reload assets often or if media assets grow. |
| Custom domain | Supported. Firebase Hosting provisions SSL certificates for custom domains and serves through Google's global CDN. |
| HTTPS automation | Automatic SSL provisioning and re-provisioning are documented for custom domains. Provisioning can take up to 24 hours. |
| CI/CD | Firebase CLI works well from GitHub Actions. Native preview channels exist, but the exact workflow must be configured. |
| Preview deployments | Good with Firebase Hosting preview channels, but less central to this repo than Workers Static Assets if backend is Cloudflare. |
| Backend pairing | Strong only if the backend choice changes to Firebase Spark/Firestore. Otherwise it adds a second cloud account while backend remains Cloudflare. |
| Rollback | Firebase Hosting supports version history/rollback through CLI/console. |
| Campus network | Generally good CDN. Google services are usually reachable, but campus Google restrictions should be tested. |
| PWA readiness | Strong; Firebase Hosting is common for PWAs. |
| Verdict | **Secondary only if Firebase backend is selected**. Not the best pair for Cloudflare Workers + D1. |

## Recommendation

### Primary: Workers Static Assets + Worker API + D1

Use Cloudflare Workers Static Assets as the default frontend hosting path when the user accepts the previous plan's Cloudflare Workers + D1 backend recommendation.

Recommended production shape:

```text
GitHub PR
  -> CI: npm ci, lint, typecheck, test, build in frontend/
  -> Workers Builds non-production build
  -> wrangler versions upload creates Worker preview version + preview URL
  -> reviewer/user verifies Workers preview URL
  -> merge to main or production branch
  -> Workers Builds production build
  -> wrangler deploy publishes Worker version with static assets
  -> static assets serve from the Worker asset binding
  -> /api/* routes run Worker API code and read/write D1
```

Why this is the best default:

- It follows Cloudflare's current new-project guidance for static sites, SPAs, and full-stack apps.
- One Worker deployment can include static frontend assets, `/api/*` routes, D1 bindings, DNS/TLS, preview versions, and rollback.
- Static asset requests are free/unlimited, while dynamic `/api/*` requests stay visible as Worker usage.
- Workers Preview URLs and GitHub integration cover the reviewer/user preview requirement.
- Workers dashboard/Wrangler rollback covers frontend and API code together, subject to Worker resource compatibility.
- No need to introduce Vercel/Netlify/Firebase just to host static assets.
- It makes the follow-up backend plan simpler because CORS, environment URLs, and deployment ownership can stay in one Worker project.

### Cloudflare Fallback: Pages + Worker API + D1

Use Cloudflare Pages only as an explicit override if the user wants the legacy Pages workflow or if a future Pages-specific feature proves materially better for EasyOrder.

This plan does **not** recommend Pages by default because Cloudflare's current best-practices guidance says new projects should use Workers Static Assets, and Workers now covers the previously cited Pages advantages: GitHub PR comments, preview URLs, and dashboard/Wrangler rollback.

### Secondary: Firebase Hosting Only If Firebase Spark Is Chosen As Backend

If the user rejects Cloudflare and chooses Firebase Spark for backend/realtime reasons, use Firebase Hosting for frontend. Keeping frontend and backend under Firebase simplifies account ownership, custom domain, preview channels, and Firebase SDK config.

Do not mix Firebase Hosting with Cloudflare D1 unless there is a strong domain/DNS reason; it adds another cloud surface without solving a real problem.

## Not Recommended As Primary

- Vercel Hobby: strong DX, but the plan is framed for personal projects and is not as cohesive with Cloudflare D1.
- Netlify Free: strong DX, but credit exhaustion can pause the site and account, which is a bad lunch-service failure mode.
- GitHub Pages: useful for docs/demo, but weak PR previews/rollback and terms/usage framing make it poor production POS hosting.

## Campus Network And Device Considerations

### School Firewall / Proxy

- Use a custom domain for production, not the provider default domain. Some campuses may block `*.pages.dev`, `*.vercel.app`, `*.netlify.app`, or `*.web.app` by category.
- Test from the actual school Wi-Fi and wired PC network before launch:
  - production frontend URL
  - staging frontend URL
  - Worker/API health URL
  - asset loading for JS/CSS/fonts/icons
  - iPad Safari camera permissions later in Phase 2
- Avoid multi-provider dependency for the critical path. If frontend is on Cloudflare and backend is on Cloudflare, fewer domains need allowlisting.
- Prepare an allowlist note for IT:
  - `https://app.easyorder.example`
  - `https://api.easyorder.example`
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
| Preview | Every PR branch | Workers Preview URL | Same Worker preview API, staging D1, or fake API depending on PR type | Reviewer/user validation before merge. |
| Staging | `develop` or `staging` branch | `staging.easyorder.example` | `https://api-staging.easyorder.example` | Operator rehearsal and migration dry runs. |
| Production | `main` or `production` branch | `easyorder.example` | `https://api.easyorder.example` | Real campus POS service. |

Recommended default: use `main` for production and Workers Preview URLs for review. Add a dedicated `staging` branch only if the user wants long-lived UAT separate from PR previews.

### GitHub Actions Verification Gate

Modify the existing `.github/workflows/ci.yml`; do **not** create a second frontend workflow. The repo already has one frontend CI gate using Node 22 from `frontend/`. The deployment implementation should extend that gate with `npm run build` and pin the exact Node version in source control.

Recommended Node source of truth:

```text
frontend/.node-version = 22.16.0
```

Reasoning:

- Existing CI already uses Node 22.
- Cloudflare Workers Builds' current build image default is Node 22.16.0.
- Pinning `frontend/.node-version` makes GitHub Actions and Workers Builds resolve the same runtime instead of relying on mutable provider defaults.
- Use `frontend/.node-version` because the frontend build runs from `frontend/`; if Workers Builds root is repo root, also set `NODE_VERSION=22.16.0` in build variables.

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
      - uses: actions/checkout@v5
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

Use `actions/setup-node@v6` rather than v4 because GitHub's Node 20 action-runtime deprecation starts on 2026-06-02. Pair it with `actions/checkout@v5` so the CI template does not immediately age into runtime warnings.

Keep the existing always-on `push` and `pull_request` triggers unless branch protection is explicitly designed for skipped checks. Path-filtered required checks can block merges when GitHub marks the workflow as skipped, so a simple always-on frontend gate is safer for this small repo.

Why GitHub Actions even if Workers Builds can build/deploy:

- The repo already defines a global gate in `ROADMAP.md`: `npx tsc --noEmit`, `npm run lint`, `npx vitest run`, `npm run build` from `frontend/`.
- Workers Builds deploy alone would catch deploy/build failures but should not replace the complete project gate.
- CI should be the merge gate. Hosting deployment should happen only from reviewed/merged code.

### Workers Static Assets Build And Deploy Settings

Use `wrangler.jsonc` at the repo root so Workers Builds and local deploys share the same source of truth:

```jsonc
{
  "$schema": "./node_modules/wrangler/config-schema.json",
  "name": "talented-easyorder",
  "main": "./workers/api/src/index.ts",
  "compatibility_date": "2026-05-15",
  "preview_urls": true,
  "assets": {
    "directory": "./frontend/dist",
    "binding": "ASSETS",
    "not_found_handling": "single-page-application",
    "run_worker_first": ["/api/*"]
  },
  "vars": {
    "EASYORDER_ENVIRONMENT": "production"
  },
  "d1_databases": [
    {
      "binding": "DB",
      "database_name": "talented-easyorder-prod",
      "database_id": "<set-after-d1-create>"
    }
  ]
}
```

Routing rule:

- `run_worker_first` must be limited to `/api/*`.
- Static files, Vite hashed assets, manifest, icons, and SPA navigation fallback should be asset-first.
- `/api/*` should invoke the Worker script, validate request method/body, and use D1 bindings.
- Do not put accounting mutation endpoints behind cached asset responses.

Recommended Workers Builds settings:

```text
Root directory: repo root
Build command: npm ci --prefix frontend && npm run build --prefix frontend
Deploy command: npx wrangler deploy
Non-production branch deploy command: npx wrangler versions upload
Node version: 22.16.0 from NODE_VERSION=22.16.0 and frontend/.node-version
Production branch: main
Non-production branch builds: enabled
```

Preview alias convention:

- Versioned preview URL: accept Cloudflare's generated URL for every uploaded preview version.
- Aliased preview URL: use `pr-<number>` when a build is associated with a pull request.
- Branch preview fallback: use `branch-<sanitized-branch-name>` when no PR number is available.
- The implementer must verify the exact Workers Builds environment variable names available for PR number and branch name. If Workers Builds does not expose the needed alias value directly, add `scripts/cloudflare/preview-alias.sh` and call `npx wrangler versions upload --preview-alias "$(scripts/cloudflare/preview-alias.sh)"`.

The implementer must verify the exact Workers Builds UI/CLI semantics during setup and document the final setting in `docs/deployment/workers-static-assets-runbook.md`.

### Branch Protection And Required Status Checks

Before enabling production auto-deploy from `main`, configure repository protection so deployment only happens from reviewed and verified code:

- Protect `main`.
- Require pull request review approval before merge.
- Require the GitHub Actions frontend gate as a status check. Expected check name after the workflow rename is `Frontend CI / build-and-test`, but the implementer must verify GitHub's displayed check name after the first run.
- Require branches to be up to date before merge, or use merge queue if available.
- Require conversation resolution.
- Restrict direct pushes to `main` for normal contributors.
- Configure Workers Builds production branch as protected `main`.
- Treat Workers Builds build/deploy status as deployment evidence, not as the merge gate. GitHub Actions remains the required merge gate.

### Environment Variables

Frontend variables are public at build time. Do not put secrets in `VITE_*` variables.

Recommended variables:

```text
VITE_EASYORDER_ENVIRONMENT=preview | staging | production
VITE_EASYORDER_API_BASE_URL=https://api-preview.example | https://api-staging.example | https://api.example
VITE_EASYORDER_SYNC_TRANSPORT=cloudflare_d1 | fake
```

Backend secrets belong in Cloudflare Worker secrets or D1 bindings, not in frontend `VITE_*` variables.

### Deployment Flow

1. Developer opens PR.
2. GitHub Actions runs frontend verification.
3. Workers Builds runs a non-production branch build and uploads a preview Worker version.
4. Cloudflare GitHub integration posts build status and the preview URL to the PR when available.
5. `general` or reviewer validates the Workers preview URL if the task involves UI/deployment behavior.
6. Branch protection allows merge to `main` only after review approval, green `Frontend CI / build-and-test`, and resolved conversations.
7. Workers Builds deploys production from `main` using `npx wrangler deploy`.
8. Post-deploy smoke check runs:
   - production URL returns 200.
   - app shell loads JS/CSS assets.
   - `VITE_EASYORDER_ENVIRONMENT` displays production in a non-sensitive diagnostics panel or build metadata endpoint.
   - `/api/health` endpoint succeeds from browser context.
   - a non-API asset URL is served asset-first and not by API routing.
9. If smoke fails, rollback the Worker deployment. D1 data/schema rollback is separate and must follow the backend rollback policy.

## Rollback Strategy

### Worker Static Assets Rollback

Use Workers rollback for frontend/API-code incidents:

1. Identify last known good Worker version in Cloudflare dashboard or with Wrangler.
2. Roll back with Cloudflare dashboard or `npx wrangler rollback <VERSION_ID>`.
3. Verify production app shell loads from the custom domain.
4. Verify `/api/health` and a read-only API route still match the expected D1 schema.
5. Confirm existing local queue/localStorage data is not migrated backwards destructively.
6. Open a fix PR for the bad commit rather than editing production manually.

### Backend Rollback

Worker + D1 rollback must be stricter than frontend rollback:

- Worker code can roll back to a prior deployment if API contract remains compatible.
- Worker rollback can target only the 100 most recently published versions.
- D1 schema migrations must be forward-compatible where possible.
- Destructive D1 migrations require a backup/export and explicit operator approval.
- Cloudflare resource changes are not automatically rolled back with Worker code.
- Static asset rollback must not assume D1/backend data rollback unless the backend version is part of the same release decision.

### Cache Rollback

When PWA is introduced later, rollback must also address service-worker cache:

- `index.html` should not be cached long-term by CDN or service worker.
- service worker should have a versioned app shell and explicit update flow.
- emergency rollback must include a way to force clients to fetch the previous compatible asset set.

## Files For Follow-Up Implementation Plan

This hosting strategy should become a provider-specific implementation plan after user decisions are resolved. Suggested file set for Workers Static Assets:

| File | Purpose |
|---|---|
| `.github/workflows/ci.yml` | Existing frontend CI gate; add build and use `frontend/.node-version`. |
| `frontend/.node-version` | Pin Node 22.16.0 for GitHub Actions and Workers Builds parity. |
| `package.json`, `package-lock.json` | Root Wrangler devDependency and scripts such as `deploy:worker` and `upload:worker-preview`; Workers Builds uses the Wrangler version from package metadata. |
| `wrangler.jsonc` | Worker name, static assets directory, SPA fallback, `/api/*` `run_worker_first`, preview URLs, D1 binding, and compatibility date. |
| `workers/api/src/index.ts` | Worker API entry point for `/api/*`, D1 access, health route, and asset binding type surface. |
| `workers/api/src/routes/health.ts` | Minimal health route for smoke tests and campus connectivity checks. |
| `scripts/cloudflare/preview-alias.sh` | Optional sanitized `pr-<number>` or `branch-<name>` alias helper if Workers Builds does not expose a usable alias directly. |
| `.github/workflows/deploy-preview-smoke.yml` | Optional smoke check against Workers preview URLs after preview version upload. |
| `docs/deployment/workers-static-assets-runbook.md` | Exact Workers Builds settings, domains/routes, environment variables, preview aliases, rollback, and smoke steps. |
| `docs/deployment/branch-protection.md` | Required checks, review requirement, direct-push restriction, and Workers production branch policy. |
| `docs/deployment/campus-network-checklist.md` | School IT allowlist, PC/iPad browser checks, custom domain/TLS checks. |
| `frontend/src/config/runtimeConfig.ts` | Typed public runtime/build config with environment label and API base URL. |
| `frontend/src/config/__tests__/runtimeConfig.test.ts` | Verify config validation rejects missing/invalid API base URL. |
| `frontend/public/manifest.webmanifest` | Future PWA metadata placeholder only if the PWA plan is approved. |

Do not add PWA service worker implementation in the first hosting PR unless the user explicitly expands scope.

## Suggested Follow-Up Task Breakdown

| Task ID | Title | Primary Files | Depends On |
|---|---|---|---|
| EO-DEPLOY-T01 | Workers Static Assets decision record and runbook | `docs/deployment/workers-static-assets-runbook.md` | User hosting decision |
| EO-DEPLOY-T02 | Existing CI gate and Node parity | `.github/workflows/ci.yml`, `frontend/.node-version` | EO-DEPLOY-T01 |
| EO-DEPLOY-T03 | Branch protection and required checks | `docs/deployment/branch-protection.md`, GitHub repository settings | EO-DEPLOY-T02 |
| EO-DEPLOY-T04 | Wrangler static assets and API routing config | `package.json`, `package-lock.json`, `wrangler.jsonc`, `workers/api/src/index.ts`, `workers/api/src/routes/health.ts` | EO-DEPLOY-T02 |
| EO-DEPLOY-T05 | Typed public runtime config | `frontend/src/config/runtimeConfig.ts`, `frontend/src/config/__tests__/runtimeConfig.test.ts` | EO-DEPLOY-T04 |
| EO-DEPLOY-T06 | Workers Builds environment setup | Cloudflare dashboard/CLI settings, build/deploy commands, preview aliases, no committed secrets | EO-DEPLOY-T03, EO-DEPLOY-T04 |
| EO-DEPLOY-T07 | Staging/production smoke checks | `.github/workflows/deploy-smoke.yml`, `docs/deployment/smoke-checks.md` | EO-DEPLOY-T06 |
| EO-DEPLOY-T08 | Campus network readiness checklist | `docs/deployment/campus-network-checklist.md` | EO-DEPLOY-T06 |
| EO-DEPLOY-T09 | Rollback drill | `docs/deployment/rollback-drill.md` | EO-DEPLOY-T07 |

## Testing And Verification Strategy

| Scope | Command / Check | Expected Result |
|---|---|---|
| Local frontend gate | `cd frontend && npm ci && npm run lint && npx tsc --noEmit && npx vitest run && npm run build` | All pass; `dist/` is produced. |
| Node parity | `cat frontend/.node-version` and inspect GitHub Actions + Workers Builds logs | All use Node 22.16.0. |
| Required check | Open PR branch protection status | Merge is blocked until `Frontend CI / build-and-test` passes. |
| Worker routing | Request `/api/health`, `/assets/<hashed-file>`, and an SPA route | `/api/*` runs Worker API; static assets are asset-first; SPA route falls back to `index.html`. |
| Preview deploy | Open Workers Preview URL from PR comment/build details | App shell loads; no console errors from missing env; `/api/health` uses preview/staging backend. |
| Production deploy | Open custom production URL | HTTPS valid; app loads from custom domain. |
| API CORS | Browser calls `GET /health` on selected backend | Success from production and staging origins only. |
| Campus Wi-Fi | PC and iPad open production URL on school network | App loads; API health succeeds. |
| Rollback | Roll back staging Worker to previous version | Staging returns previous app/API build; local data remains readable; D1 schema still compatible. |
| No secrets | Search committed files for backend tokens | No Worker secret, D1 token, Firebase token, or provider API token in repo. |

## DISCUSS WITH USER Decision Points

> ⚠️ DISCUSS WITH USER: Is Cloudflare acceptable as the single provider for frontend hosting, backend Worker, D1 database, DNS, TLS, and deployment ownership?

> ⚠️ DISCUSS WITH USER: Do we accept Cloudflare's current Workers Static Assets guidance for new projects, or is there a user/business reason to override it and use Pages anyway?

> ⚠️ DISCUSS WITH USER: Will the production app use a custom domain owned by the school/operator, and can that domain or subdomain be delegated to Cloudflare DNS?

> ⚠️ DISCUSS WITH USER: Can we enforce `main` branch protection before production auto-deploy, including required PR review and the `Frontend CI / build-and-test` status check?

> ⚠️ DISCUSS WITH USER: Should Workers Builds deploy production automatically from `main`, or should `main` only upload a version and require manual dashboard/Wrangler promotion?

> ⚠️ DISCUSS WITH USER: Do we need a long-lived staging URL, or are PR preview deployments enough before production?

> ⚠️ DISCUSS WITH USER: Who will own the Cloudflare/Firebase/Vercel/Netlify/GitHub account, recovery email, 2FA, billing-disabled/free-plan monitoring, and emergency rollback permission?

> ⚠️ DISCUSS WITH USER: Does the campus network block Cloudflare, Vercel, Netlify, GitHub Pages, Firebase, or provider default domains? We need a real PC + iPad test on campus Wi-Fi before launch.

> ⚠️ DISCUSS WITH USER: Is PWA offline cold-start required for launch, or is it acceptable that offline support initially requires the app to have been loaded before the network outage?

> ⚠️ DISCUSS WITH USER: Should Workers preview URLs point to a fake/staging D1/backend only, or can they ever point at production read-only data for user acceptance testing?

## Final Position

For the current architecture and the previous free-backend recommendation, use **Cloudflare Workers Static Assets** as the production frontend host. This follows Cloudflare's current new-project guidance and keeps static assets, `/api/*` Worker routes, D1 bindings, DNS, TLS, preview URLs, and rollback in one Workers deployment model.

Use **Cloudflare Pages** only as an explicit override/fallback if the user rejects Workers Static Assets despite Cloudflare's guidance. If the user chooses Firebase Spark as the backend, use **Firebase Hosting** instead. Otherwise, treat Vercel, Netlify, and GitHub Pages as fallback/demo options rather than the production POS hosting path.
