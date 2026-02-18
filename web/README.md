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
      ├── /admin                          → AdminPage (overview dashboard)
      ├── /admin/repos                    → AdminReposPage (repository management)
      ├── /admin/repos/:repo              → AdminRepoDetailPage (users + infrastructure)
      └── /admin/schedules                → AdminSchedulesPage (cross-repo schedules)
```

### Auth Flow

1. User visits `/login` and clicks "Login with SSO"
2. Browser redirects to Cognito hosted UI (`/oauth2/authorize`)
3. User authenticates (Cognito native or federated via Entra ID/SAML)
4. Cognito redirects to `/auth/callback?code=...`
5. `AuthCallbackPage` exchanges the authorization code for tokens via Cognito's `/oauth2/token` endpoint
6. Access token stored in `localStorage` as `e3_token`, refresh token as `e3_refresh_token`
7. `AuthGuard` layout route checks for token; redirects to `/login` if missing
8. On 401 (`AuthError`), the global query cache error handler attempts a silent token refresh using the stored refresh token. If refresh succeeds, all failed queries are refetched. If refresh fails, the user is redirected to `/login`.

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

### Design System

The UI follows the ELARA design system (Mixpanel-aesthetic):

- **Color scale**: `brand` (teal: brand.500 = `#488e97`), cyan-tinted `gray` scale
- **Font**: Sailec with system font fallback
- **Semantic tokens**: ~50 light/dark tokens for backgrounds, text, borders, cards, inputs, nav, status
- **Dark mode**: Toggle via ThemeProvider, persisted in localStorage
- **Layout**: Absolute-positioned sidebar (72/20px collapsed), 72px NavHeader, `bg.secondary` content area

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
│   └── config.json              # Local dev config (gitignored)
├── src/
│   ├── main.tsx                 # React entry + providers (Chakra, ThemeProvider, BrowserRouter)
│   ├── App.tsx                  # Route tree
│   ├── api.ts                   # Token helpers, refresh logic for e3-api-client
│   ├── config.ts                # Runtime config loader (fetches /config.json)
│   ├── theme.ts                 # Chakra UI theme (brand colors, semantic tokens, dark mode)
│   ├── contexts/
│   │   ├── ThemeContext.ts      # Theme mode context + useTheme hook
│   │   └── ThemeProvider.tsx    # Dark/light mode with localStorage persistence
│   ├── hooks/
│   │   ├── useApi.ts            # TanStack Query hooks for e3-api-client
│   │   ├── useAdminApi.ts       # TanStack Query hooks for admin endpoints
│   │   ├── useAuth.ts           # Auth helper (token, logout)
│   │   ├── useCardStyles.ts     # Shared card style object with semantic tokens
│   │   └── useScrollbarStyles.ts # Custom scrollbar styles
│   ├── components/
│   │   ├── AuthGuard.tsx        # Auth layout route (checks localStorage token)
│   │   ├── Sidebar.tsx          # Collapsible sidebar with expandable admin sub-menu
│   │   ├── NavHeader.tsx        # Page header with title, theme toggle, user menu
│   │   ├── Breadcrumbs.tsx      # Route-aware breadcrumb trail
│   │   ├── DisplayStates.tsx    # LoadingState, EmptyState, ErrorState components
│   │   ├── StatusBadge.tsx      # Color-coded status badges
│   │   ├── LoadingIcon.tsx      # Animated Elara logo spinner
│   │   ├── Logo.tsx             # Logo variants (full, collapsed, mark)
│   │   ├── StatCard.tsx         # Reusable stat card (big number + label + icon)
│   │   └── Toaster.tsx          # Chakra toast provider
│   ├── layouts/
│   │   └── PlatformLayout.tsx   # Sidebar + NavHeader + content Outlet
│   ├── pages/
│   │   ├── LoginPage.tsx        # Centered card with SSO login button
│   │   ├── AuthCallbackPage.tsx # OAuth code → token exchange
│   │   ├── RepoListPage.tsx     # Repository grid with search
│   │   ├── RepoDashboardPage.tsx # Workspaces + packages dashboard
│   │   ├── WorkspaceViewPage.tsx     # Workspace status + dataflow controls
│   │   ├── AdminPage.tsx            # Admin overview dashboard (stats + repo grid)
│   │   ├── AdminReposPage.tsx       # Admin repository management table
│   │   ├── AdminRepoDetailPage.tsx  # Admin per-repo detail (users + infrastructure tabs)
│   │   └── AdminSchedulesPage.tsx   # Admin cross-repo schedule listing
│   └── assets/
│       ├── Elara_AI_Lockup.svg
│       ├── Elara_AI_Lockup_Collapsed.svg
│       └── Elara_AI_Mark.svg
├── index.html                   # SPA entry point
├── vite.config.ts               # Vite config (proxy, process.argv shim)
├── tsconfig.json
└── package.json
```

## Dependencies

| Package | Purpose |
|---------|---------|
| `@chakra-ui/react` | UI component library (v3) |
| `@elaraai/e3-cloud-client` | Typed HTTP client for admin API (users, schedules) |
| `@elaraai/e3-cloud-types` | East type definitions for admin entities |
| `@elaraai/e3-api-client` | Typed HTTP client for e3 API |
| `@elaraai/east` | East type system (for BEAST2 decode) |
| `@tanstack/react-query` | Data fetching and caching |
| `react-router-dom` | Client-side routing |
| `react-icons` | Icon library (Feather Icons) |
| `framer-motion` | Animation (LoadingIcon) |

## Notes

- `vite.config.ts` defines `process.argv` as `[]` to work around a CLI entry point check in `@elaraai/east` that would otherwise throw `ReferenceError: process is not defined` in the browser
- CloudFront is configured with a custom error response to return `/index.html` for 403/404 on S3, enabling SPA client-side routing
- All colors use semantic tokens for dark mode compatibility — never use hardcoded hex or `elara.*`/`blueGray.*` color references
