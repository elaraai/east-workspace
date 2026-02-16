# e3-aws

AWS cloud infrastructure for hosting e3 solutions.

## Overview

This repository contains the AWS CDK infrastructure, Lambda handlers, and frontend application for deploying e3 as a multi-tenant cloud service.

**Architecture:** CloudFront + API Gateway + Lambda + S3 + DynamoDB + Step Functions

See `design/cloud-options.md` for architecture decisions and `design/cloud-devplan.md` for the development roadmap.

## Structure

```
e3-aws/
├── .github/
│   └── workflows/
│       ├── deploy-platform.yml  # GitHub Actions CI/CD (manual trigger, OIDC auth)
│       └── build-runner.yml     # Runner image build+push to ECR (manual trigger, OIDC auth)
├── scripts/
│   ├── deploy-web.sh            # Fast UI-only deploy (S3 sync + CloudFront invalidation)
│   ├── deploy-runner.sh         # Build+push runner image to ECR + update Lambda
│   └── build-runner.sh          # Build runner Docker image (used by deploy-runner.sh)
├── cdk/
│   ├── accounts/             # AWS Organization & account provisioning
│   │   ├── lib/
│   │   │   ├── accounts.ts           # Account definitions
│   │   │   └── e3-accounts-stack.ts  # Account creation + bootstrap stacks
│   │   └── bin/
│   │       └── e3-org.ts             # CDK app entry
│   │
│   └── platform/             # e3 cloud application infrastructure
│       ├── lib/
│       │   └── e3-platform-stack.ts  # Single consolidated stack
│       └── bin/
│           └── e3-aws.ts             # CDK app entry
│
├── packages/
│   ├── e3-aws-api/           # Lambda handlers for API (@elaraai/e3-aws-api)
│   │   └── src/handlers/     # Route handlers
│   │
│   ├── e3-aws-storage/       # S3+DynamoDB StorageBackend (@elaraai/e3-aws-storage)
│   │   └── src/
│   │       └── s3-dynamo-storage.ts
│   │
│   ├── e3-aws-runner/        # Task execution handlers (@elaraai/e3-aws-runner)
│   │   └── src/handlers/     # Step Functions Lambda handlers
│   │
│   ├── e3-admin-types/       # Shared East types for authorization (@elaraai/e3-admin-types)
│   │
│   ├── e3-admin-core/        # Authorization logic and interfaces (@elaraai/e3-admin-core)
│   │
│   ├── e3-admin-client/      # HTTP client for admin API (@elaraai/e3-admin-client)
│   │
│   └── e3-cloud-cli/         # CLI for cloud management (@elaraai/e3-cloud-cli)
│
├── web/                      # Vite frontend app (@elaraai/e3-web)
│   ├── public/
│   │   └── config.json       # Local dev config (gitignored; CDK generates for deployments)
│   └── src/
│       ├── main.tsx           # React entry point
│       ├── App.tsx            # Route tree
│       ├── api.ts             # Auth helpers for e3-api-client
│       ├── config.ts          # Runtime config loader (fetches /config.json)
│       ├── components/
│       │   ├── AuthGuard.tsx  # Token-based auth layout route
│       │   ├── Sidebar.tsx    # Nav sidebar with expandable admin sub-menu
│       │   ├── Breadcrumbs.tsx # Route-aware breadcrumb trail
│       │   ├── StatCard.tsx   # Reusable stat card (big number + label + icon)
│       │   └── ...
│       ├── hooks/
│       │   ├── useApi.ts      # TanStack Query hooks for e3-api-client
│       │   ├── useAdminApi.ts # TanStack Query hooks for admin endpoints
│       │   └── ...
│       ├── layouts/
│       │   └── PlatformLayout.tsx  # Nav header + content outlet
│       └── pages/
│           ├── LoginPage.tsx              # Cognito SSO login
│           ├── AuthCallbackPage.tsx       # OAuth callback handler
│           ├── RepoListPage.tsx           # Repository listing
│           ├── RepoDashboardPage.tsx      # Repo workspaces + packages
│           ├── WorkspaceViewPage.tsx      # Workspace detail + dataflow
│           ├── AdminPage.tsx              # Admin overview dashboard
│           ├── AdminReposPage.tsx         # Admin repository management table
│           ├── AdminRepoDetailPage.tsx    # Admin per-repo detail (users + infrastructure)
│           └── AdminSchedulesPage.tsx     # Admin cross-repo schedule listing
│
└── design/                   # Architecture documentation
    ├── cloud-options.md      # Architecture decisions
    └── cloud-devplan.md      # Development roadmap
```

## Related Projects

| Project | Path | Description |
|---------|------|-------------|
| **e3** | `../e3` | East Execution Engine - core library, CLI, API server |
| **east** | `../east` | East language compiler and type system |
| **east-ui** | `../east-ui` | East UI component library (Chakra-based) |
| **east-node** | `../east-node` | East runtime for Node.js |

**Important:** Changes to related projects (`../e3`, `../east`, etc.) are consumed via npm packages. After editing a related project, you must publish the updated packages to npm before e3-aws will pick up the changes. A local build alone is not sufficient — `npm install` / `npm update` in e3-aws pulls from the registry.

## Key Concepts

- **Tenant** - A hosted e3 repository with isolated storage (S3 prefix + DynamoDB partition)
- **StorageBackend** - Interface from e3-core for storage operations (this repo provides `S3DynamoStorage`)
- **DataflowExecutor** - Interface from e3-core for orchestration (this repo provides Step Functions implementation)
- **UIComponentType** - East UI type that the frontend renders using `east-ui-components`

## Development

```bash
# Install dependencies
npm install

# Build all packages
npm run build

# Run frontend locally (requires web/public/config.json — see web/README.md)
npm run dev
```

## Deployment

### AWS Profiles

Available AWS SSO profiles for e3 deployments:
- `elaraai-dev-elara-e3` - Development environment (dev.e3.elaraai.com)
- Future: `elaraai-test-elara-e3`, `elaraai-prod-elara-e3`

### Deploy to Dev

```bash
# 1. Login to AWS SSO (opens browser)
aws sso login --profile elaraai-dev-elara-e3

# 2. Build all packages
npm run build

# 3. Deploy platform (from cdk/platform directory)
cd cdk/platform
AWS_PROFILE=elaraai-dev-elara-e3 npx cdk deploy --context config=elara-dev --require-approval never
```

The `--context config=elara-dev` loads the deployment configuration from `deployments/elara-dev.json`. This controls:
- Stack name: `E3Platform-dev`
- Resource naming: `e3-dev-*`
- Domain: `dev.e3.elaraai.com`
- Test users, OIDC, and other environment-specific settings

The deploy also uploads `web/dist/` to S3 and generates a deployment-specific `config.json` with Cognito settings (domain, client ID, redirect URI). The web app is deployment-agnostic — the same build works for any environment.

**Important:** Do not use `--context deploymentId=dev` alone — this skips the config file and will omit test users, OIDC, and domain configuration.

### Deploy via GitHub Actions (CI/CD)

Platform deployments can be triggered from the GitHub Actions UI using the **Deploy Platform** workflow:

1. Go to **Actions** > **Deploy Platform** > **Run workflow**
2. Select the deployment config (e.g., `elara-dev`)
3. Click **Run workflow**

The workflow uses OIDC federation — no long-lived AWS credentials are stored in GitHub. The IAM OIDC provider and deploy role (`E3-GitHubActions-{Environment}`) are provisioned by the `E3AccountBootstrapStack` in each account.

To add a new environment to CI/CD:
1. Deploy the bootstrap stack to the target account (creates the OIDC provider + role)
2. Add `github.deployRoleArn` to the deployment config in `cdk/platform/deployments/`
3. Add the environment name to the `options` list in `.github/workflows/deploy-platform.yml`
4. Optionally configure a GitHub Environment with protection rules for approval gates

### Deploy Runner (Lambda Container Image)

The task runner Lambda (`e3-{id}-execute-task`) uses a Docker image based on `ghcr.io/elaraai/e3:beta`. When east/e3 packages are updated and the base image is rebuilt, the runner container must be rebuilt and pushed to ECR, then the Lambda function must be updated to pull the new image.

**Via GitHub Actions:**

1. Go to **Actions** > **Deploy Runner** > **Run workflow**
2. Select the deployment config (e.g., `elara-dev`)
3. Click **Run workflow**

**Locally:**

```bash
# 1. Login to AWS SSO
aws sso login --profile elaraai-dev-elara-e3

# 2. Build all packages
npm run build

# 3. Build+push runner image and update Lambda
make deploy-runner CONFIG=elara-dev PROFILE=elaraai-dev-elara-e3
# or directly: ./scripts/deploy-runner.sh elara-dev elaraai-dev-elara-e3
```

This builds the Docker image from `docker/Dockerfile.runner`, pushes it to ECR, and calls `aws lambda update-function-code` to point the Lambda at the new image. The Lambda update is required because CDK references the `:latest` tag — pushing a new `:latest` to ECR does not automatically update the Lambda function.

### Deploy Web Only (Fast)

For UI-only changes when infrastructure and config haven't changed:

```bash
# 1. Build the web app
npm run build

# 2. Sync assets to S3 + invalidate CloudFront
make deploy-web CONFIG=elara-dev PROFILE=elaraai-dev-elara-e3
# or directly: ./scripts/deploy-web.sh elara-dev elaraai-dev-elara-e3
```

**Note:** This preserves the existing `config.json` in S3. If OIDC, Cognito, or domain settings have changed, use a full `make deploy` instead.

### Deploy Account Infrastructure (Management Account Only)

```bash
cd cdk/accounts
AWS_PROFILE=elaraai-prod-management-root npm run deploy
```

## Integration Tests

Integration tests run against the deployed cloud environment.

```bash
# 1. Ensure you're logged in to both AWS and e3
aws sso login --profile elaraai-dev-elara-e3
e3 login https://dev.e3.elaraai.com

# 2. Run integration tests
cd test/integration
AWS_PROFILE=elaraai-dev-elara-e3 npm test

# Or run specific test file:
AWS_PROFILE=elaraai-dev-elara-e3 npm test -- --test-name-pattern "diamond"
```

## CDK Deployments

| Directory | Stack | Purpose |
|-----------|-------|---------|
| `cdk/accounts` | `E3Accounts` | Creates member accounts in AWS Organizations |
| `cdk/accounts` | `E3AccountBootstrap-*` | Security baseline for new accounts |
| `cdk/platform` | `E3Platform` | Full e3 cloud app (API, storage, auth, frontend) |

## References

- Design docs: `./design/cloud-options.md`, `./design/cloud-devplan.md`
- e3 design: `../e3/design/e3-mvp.md`
- e3-core interfaces: `../e3/packages/e3-core/src/` (StorageBackend, DataflowExecutor)
- east-ui components: `../east-ui/packages/east-ui-components/src/`

## Making changes

Ensure all changes are reflected in the project REAMDE.md files.
In particular deployment instructions, schemas and project structures must be kept up-to-date at all times.
The integration tests must have a 100% pass rate - use the dev environment to test all changes.
