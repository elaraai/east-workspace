# e3 Web App

Vite + React frontend for the e3 cloud platform.

## Architecture

The web app is a single-page application (SPA) served from S3 via CloudFront. It authenticates via Cognito OAuth and communicates with the e3 API through CloudFront's `/api/*` proxy to API Gateway.

```
Browser
  │
  ├── /login              → LoginPage (Cognito OAuth redirect)
  ├── /auth/callback      → AuthCallbackPage (token exchange)
  │
  └── (authenticated)
      ├── /repos                          → RepoListPage
      ├── /repos/:repo                    → RepoDashboardPage
      ├── /repos/:repo/workspaces/:ws     → WorkspaceViewPage
      └── /admin                          → AdminPage
```

### Auth Flow

1. User visits `/login` and clicks "Login with SSO"
2. Browser redirects to Cognito hosted UI (`/oauth2/authorize`)
3. User authenticates (Cognito native or federated via Entra ID/SAML)
4. Cognito redirects to `/auth/callback?code=...`
5. `AuthCallbackPage` exchanges the authorization code for an access token via Cognito's `/oauth2/token` endpoint
6. Token stored in `localStorage` as `e3_token`
7. `AuthGuard` layout route checks for token; redirects to `/login` if missing

### Runtime Configuration

The app loads Cognito settings from `/config.json` at runtime, **not** at build time. This makes the built assets deployment-agnostic -- the same `dist/` works for dev, test, and production.

**`/config.json` structure:**
```json
{
  "cognitoDomain": "e3-dev.auth.ap-southeast-2.amazoncognito.com",
  "cognitoClientId": "7d2r7hm4ivksi2a56e6s054mf9",
  "redirectUri": "https://dev.e3.elaraai.com/auth/callback"
}
```

**How it gets deployed:**
- `npm run build` produces `web/dist/` with the app bundle (no config.json)
- CDK deploys `web/dist/` to S3 via `BucketDeployment`
- CDK separately deploys a `config.json` via `Source.jsonData()` with values from the stack (Cognito domain, client ID, platform URL)
- The config deployment uses `prune: false` so it doesn't delete the web assets

## Local Development

### Setup

1. Create `web/public/config.json` (gitignored) with your dev Cognito settings:

```json
{
  "cognitoDomain": "e3-dev.auth.ap-southeast-2.amazoncognito.com",
  "cognitoClientId": "<your-client-id>",
  "redirectUri": "http://localhost:5173/auth/callback"
}
```

The client ID is available from the CDK stack output `UserPoolClientId`.

2. Run the dev server:

```bash
npm run dev
```

The Vite dev server proxies `/api/*` to `https://dev.e3.elaraai.com` (configured in `vite.config.ts`), and serves `public/config.json` at `/config.json`.

### Build

```bash
npm run build
```

Output goes to `web/dist/`. The build is deployment-agnostic since config is loaded at runtime.

## Project Structure

```
web/
├── public/
│   └── config.json          # Local dev config (gitignored)
├── src/
│   ├── main.tsx             # React entry + providers (Chakra, BrowserRouter)
│   ├── App.tsx              # Route tree
│   ├── api.ts               # Token helpers for e3-api-client
│   ├── config.ts            # Runtime config loader (fetches /config.json)
│   ├── components/
│   │   └── AuthGuard.tsx    # Auth layout route (checks localStorage token)
│   ├── layouts/
│   │   └── PlatformLayout.tsx  # Nav header + Outlet
│   └── pages/
│       ├── LoginPage.tsx           # SSO login button
│       ├── AuthCallbackPage.tsx    # OAuth code → token exchange
│       ├── RepoListPage.tsx        # List repositories
│       ├── RepoDashboardPage.tsx   # Repo detail (workspaces + packages)
│       ├── WorkspaceViewPage.tsx   # Workspace detail + dataflow trigger
│       └── AdminPage.tsx           # Admin stub
├── index.html               # SPA entry point
├── vite.config.ts           # Vite config (proxy, process.argv shim)
├── tsconfig.json
└── package.json
```

## Dependencies

| Package | Purpose |
|---------|---------|
| `@chakra-ui/react` | UI component library |
| `@elaraai/e3-api-client` | Typed HTTP client for e3 API |
| `@elaraai/east` | East type system (for BEAST2 decode) |
| `react-router-dom` | Client-side routing |

## Notes

- `vite.config.ts` defines `process.argv` as `[]` to work around a CLI entry point check in `@elaraai/east` that would otherwise throw `ReferenceError: process is not defined` in the browser
- CloudFront is configured with a custom error response to return `/index.html` for 403/404 on S3, enabling SPA client-side routing
