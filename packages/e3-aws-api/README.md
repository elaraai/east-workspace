# @elaraai/e3-aws-api

Lambda API handler for the e3 cloud platform. Serves all API routes via [Hono](https://hono.dev/).

## Routes

| Path | Description |
|------|-------------|
| `/.well-known/openid-configuration` | OIDC discovery document |
| `/oauth2/*` | Device flow proxy (for `e3 login`) |
| `/device` | Device authorization approval page |
| `/api/whoami` | Current user identity |
| `/api/repos` | Repository list/create |
| `/api/repos/:repo` | Repository detail/delete |
| `/api/repos/:repo/users` | User ACL management |
| `/api/repos/:repo/workspaces/:ws/task-configs/*` | Per-task compute and timeout config |
| `/api/repos/:repo/workspaces/:ws/schedules` | Workspace schedule management |
| `/api/repos/:repo/api/*` | Proxied e3-api-server routes (packages, workspaces, datasets, tasks, dataflow) |

## Structure

```
src/
├── index.ts                    # Hono app, Lambda handler entry point
├── admin-routes.ts             # User ACL routes
├── authz-middleware.ts         # Authorization middleware (JWT → identity)
├── task-config-routes.ts       # Compute/timeout config routes
├── schedule-routes.ts          # Schedule CRUD routes
├── auth/
│   ├── cognito-identity.ts     # Cognito user lookup
│   ├── device-flow.ts          # Device authorization flow
│   ├── discovery.ts            # OIDC discovery endpoint
│   └── pre-token-generation.ts # Cognito pre-token trigger
└── repo-lifecycle/
    ├── set-status.ts           # Repository status management
    └── gc-*.ts                 # Garbage collection handlers
```

## License

BSL-1.1 - See LICENSE.md
