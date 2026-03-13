# e3-cloud

Multi-cloud implementation for SaaS hosting of e3 business optimization and analytics solutions.

## e3

The "East Execution Engine" or e3 is Elara's solution to hosting and executing business solutions.
Typically, consultants will set up solutions using East programming language and ecosystem, and e3 will host the datasets, dataflow-based compute and UI, organized into persistent workspaces.
In short, e3 is a complete platform for near-real-time advanced anlytics.

## Overview

Our local-first implementation of e3 can be found at ../e3, and this package builds directly on that to provide enterprise cloud-only features, multi-cloud abstractions and a concrete AWS cloud implementation.

The base e3 packages provide abstract interfaces for storage, compute and so-on and is designed to be extended into different concrete implementations.
Generic algorithms are provided using a dependency injection approach.

This repository contains the abstractions and generic algorithms for enterprise cloud features, concrete AWS implementations (e.g. S3 and DynamaDB for the storage backend), AWS CDK infrastructure, Lambda handlers, and frontend application for deploying e3 as a multi-tenant cloud service.
Elara services various industries including banking, governemnt, health and defence, and in future we will create Azure and/or GCP implementations to serve our clients' infrastructure requirements.

**AWS Architecture:** CloudFront + API Gateway + Lambda + ECS Fargate + S3 + DynamoDB + Step Functions

## Structure

```
e3-cloud/
├── .github/
│   └── workflows/
│       ├── deploy-platform.yml  # GitHub Actions CI/CD with optional runner step (manual trigger, OIDC auth)
│       ├── build-runner.yml     # Runner image build+push to ECR (manual trigger, OIDC auth)
│       └── promote-runner.yml   # Cross-account runner image transfer (manual trigger, OIDC auth)
├── scripts/
│   ├── deploy-web.sh            # Fast UI-only deploy (S3 sync + CloudFront invalidation)
│   ├── deploy-runner.sh         # Build or transfer runner image to ECR + update Lambda
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
│   ├── e3-aws/              # Unified AWS implementation (@elaraai/e3-aws)
│   │   └── src/
│   │       ├── storage/      # S3+DynamoDB StorageBackend
│   │       │   ├── s3-dynamo-storage.ts         # Main storage backend
│   │       │   ├── s3-object-store.ts           # S3 object storage
│   │       │   ├── dynamo-ref-store.ts          # DynamoDB ref store
│   │       │   ├── dynamo-dataset-ref-store.ts   # DynamoDB per-dataset refs (reactive dataflow)
│   │       │   ├── dynamo-lock-service.ts       # DynamoDB distributed locks (shared + exclusive)
│   │       │   ├── dynamo-user-settings-store.ts # DynamoDB per-user workspace settings
│   │       │   ├── s3-gc-temp-store.ts          # S3 GcTempStore implementation
│   │       │   ├── init.ts                      # Singleton initialization
│   │       │   └── ...                          # Other DynamoDB stores
│   │       ├── services/     # AWS service implementations
│   │       │   ├── sfn-dataflow-orchestrator.ts # Step Functions dataflow orchestrator
│   │       │   ├── sfn-gc-orchestrator.ts       # Step Functions GC orchestrator
│   │       │   ├── eventbridge-scheduler.ts     # EventBridge scheduler service
│   │       │   ├── cognito-identity.ts          # Cognito identity backend
│   │       │   ├── cognito-device-flow.ts       # OAuth device flow proxy
│   │       │   └── cognito-discovery.ts         # OIDC discovery endpoint
│   │       └── handlers/     # Lambda + Fargate entry points
│   │           ├── api.ts                       # API Lambda composition root
│   │           ├── pre-token-generation.ts      # Cognito pre-token Lambda
│   │           ├── sfn/                         # Step Functions Lambda handlers (thin wrappers)
│   │           │   ├── execute-task.ts           # Lambda task execution wrapper
│   │           │   ├── dispatch-task.ts          # Task dispatch wrapper
│   │           │   ├── get-graph.ts              # Dependency graph wrapper
│   │           │   ├── get-ready.ts              # Ready task discovery wrapper
│   │           │   ├── apply-results.ts          # Result application wrapper
│   │           │   ├── check-completion.ts       # Completion polling wrapper
│   │           │   └── ...                       # Other SFN handler wrappers
│   │           ├── gc/                          # GC state machine handlers
│   │           │   ├── gc-mark.ts               # Mark phase
│   │           │   ├── gc-sweep.ts              # Sweep phase
│   │           │   ├── gc-cleanup.ts            # Cleanup phase
│   │           │   └── ...                      # Other GC handlers
│   │           └── fargate/                     # Fargate entry points
│   │               └── main.ts                  # Fargate task execution
│   │
│   ├── e3-cloud-types/       # Shared East types for authorization (@elaraai/e3-cloud-types)
│   │
│   ├── e3-cloud-core/        # Cloud-agnostic interfaces, routes and authorization (@elaraai/e3-cloud-core)
│   │   └── src/
│   │       ├── user-settings-store.ts  # UserSettingsStore interface (per-user workspace settings)
│   │       ├── routes/       # Cloud-agnostic Hono route handlers (admin, repo, dataflow, schedule, user-settings, etc.)
│   │       ├── steps/        # Cloud-agnostic dataflow step logic (get-graph, dispatch-task, execute-task, etc.)
│   │       ├── gc/           # Cloud-agnostic GC step logic (gc-mark, gc-sweep, gc-cleanup, gc-scheduler, set-status)
│   │       └── testing/      # In-memory implementations for unit tests
│   │
│   ├── e3-cloud-client/      # HTTP client for admin API (@elaraai/e3-cloud-client)
│   │
│   ├── e3-cloud-tests/       # Portable integration tests for cloud deployments (@elaraai/e3-cloud-tests)
│   │   └── src/suites/       # Test suites (admin auth, compute execution)
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
│           ├── AdminRepoDetailPage.tsx    # Admin per-repo detail (users + task configs)
│           ├── InputViewPage.tsx          # Dataset input detail view
│           └── TaskViewPage.tsx           # Task detail view
│
└── design/                   # Architecture documentation
```

## Related Projects

| Project | Path | Description |
|---------|------|-------------|
| **e3** | `../e3` | East Execution Engine - core library, CLI, API server |
| **east** | `../east` | East language compiler and type system |
| **east-ui** | `../east-ui` | East UI component library (Chakra-based) |
| **east-node** | `../east-node` | East runtime for Node.js |
| **east-python** | `../east-python` | Python-based East runtime (with datascience integrations) |
| **east-plugin** | `../east-plugin` | e3 ecosystem-wide artifacts |

**Important:** Changes to related projects (`../e3`, `../east`, etc.) are consumed via npm packages. After editing a related project, you must publish the updated packages to npm before e3-cloud will pick up the changes. A local build alone is not sufficient — `npm install` / `npm update` in e3-cloud pulls from the registry.

## Key Concepts

- **Tenant** - A hosted e3 repository with isolated storage (S3 prefix + DynamoDB partition)
- **StorageBackend** - Interface from e3-core for storage operations (this repo provides `S3DynamoStorage`)
- **DataflowExecutor** - Interface from e3-core for orchestration (this repo provides Step Functions implementation)
- **DatasetRefStore** - Per-dataset ref storage for reactive dataflow (this repo provides `DynamoDatasetRefStore`)
- **Reactive Dataflow** - Concurrent input writes during execution with automatic re-execution of affected tasks via version vectors
- **UIComponentType** - East UI type that the frontend renders using `east-ui-components`
- **ComputeSize** - Per-task compute tier (serverless/small/medium/large/xlarge). Serverless = Lambda, others = Fargate
- **TaskConfig** - Per-task configuration for compute size and timeout, stored in DynamoDB

## Development

```bash
# Install dependencies
npm install

# Update @elaraai dependencies to latest
make update

# Build all packages
npm run build

# Run frontend locally (requires web/public/config.json — see web/README.md)
npm run dev
```

**Important:** The runner container image (`ghcr.io/elaraai/e3:beta`) bundles specific versions of `@elaraai/east` and other packages. After updating dependencies with `make update`, you must also rebuild and deploy the runner (`make deploy-runner`) so that the task IR compiled by the updated packages is compatible with the runner's East runtime. Version mismatches between the compiler (e3-cloud) and the evaluator (runner) can cause silent failures (e.g., commandIr producing truncated commands).

## Deployment

### AWS Profiles

Available AWS SSO profiles for e3 deployments:
- `elaraai-dev-elara-e3` - Development environment (dev.e3.elaraai.com)
- `elaraai-prod-kpmg-e3` - KPMG production environment (kpmg.e3.elaraai.com)
- `elaraai-prod-twe-e3` - TWE production environment (twe.e3.elaraai.com)

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
3. Add the environment name to the `options` list in `.github/workflows/deploy-platform.yml`, `.github/workflows/build-runner.yml`, and `.github/workflows/promote-runner.yml`
4. Optionally configure a GitHub Environment with protection rules for approval gates

### Deploy Runner (Lambda Container Image)

The task runner Lambda (`e3-{id}-execute-task`) uses a Docker image based on `ghcr.io/elaraai/e3:beta`. When east/e3 packages are updated and the base image is rebuilt, the runner container must be rebuilt and pushed to ECR, then the Lambda function must be updated to pull the new image.

**Build from source** (via GitHub Actions):

1. Go to **Actions** > **Deploy Runner** > **Run workflow**
2. Select the deployment config (e.g., `elara-dev`)
3. Click **Run workflow**

**Transfer between environments** (via GitHub Actions):

1. Go to **Actions** > **Promote Runner** > **Run workflow**
2. Select source and target environments
3. Click **Run workflow**

This copies the runner image from one account's ECR to another without rebuilding.

**As part of a platform deploy** (via GitHub Actions):

The **Deploy Platform** workflow has a `runner` input with options: `none` (default), `build`, `transfer from elara-dev`, `transfer from kpmg`. When set, the runner job runs before CDK deploy.

**Locally:**

```bash
# Build from source
make deploy-runner CONFIG=elara-dev PROFILE=elaraai-dev-elara-e3

# Transfer from another environment (no rebuild)
make deploy-runner CONFIG=kpmg PROFILE=elaraai-prod-kpmg-e3 FROM=elara-dev
```

Building from source creates the Docker image from `docker/Dockerfile.runner`, pushes it to ECR, and calls `aws lambda update-function-code`. Transferring pulls the image from the source account's ECR and pushes to the target. The Lambda update is required because CDK references the `:latest` tag — pushing a new `:latest` to ECR does not automatically update the Lambda function.

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

Integration tests run against the deployed cloud environment. **These tests take ~10-20 minutes.** Capturing the full output is critical — a rerun with no code changes wastes the entire cycle time.

### Running tests

```bash
# 1. Ensure you're logged in to both AWS and e3
aws sso login --profile elaraai-dev-elara-e3
e3 login https://dev.e3.elaraai.com

# 2. Run integration tests — ALWAYS capture full output
cd test/integration
AWS_PROFILE=elaraai-dev-elara-e3 npm run test:integration 2>&1 | tee /tmp/integration-test-output.log

# Or run specific test file:
AWS_PROFILE=elaraai-dev-elara-e3 npm run test:integration -- --test-name-pattern "diamond" 2>&1 | tee /tmp/integration-test-output.log
```

### IMPORTANT: Never discard test output

**NEVER pipe test or build output through `| tail`, `| head`, or `| grep`** on the first run. This discards failure details (stack traces, error messages, assertion diffs) that are essential for debugging. Integration tests are slow and expensive — losing output means waiting another 10-20 minutes for the same information.

Instead:
- **Use `| tee /tmp/<name>.log`** to save full output to a file while still displaying it
- **Read the log file** (`/tmp/integration-test-output.log`) to inspect failures after the run
- The Claude harness automatically saves large outputs — rely on that plus the filesystem for durable records
- Only use `grep` on the **saved log file** after the run completes, never on the live output stream

### Known issue — DynamoDB throttling on first run

Integration tests run concurrently and can trigger `ThrottlingException` (`TableReadKeyRangeThroughputExceeded`) on the `e3-dev-data` DynamoDB table when the table has been idle. DynamoDB auto-scales partitions after the burst, so a second run typically passes. Check CloudWatch logs (`/aws/lambda/e3-dev-api`) to confirm throttling vs a real bug. If this starts happening persistently (not just the first cold run), we need a permanent fix — either increase base capacity, add retry/backoff in the storage layer, or cap test concurrency.

## CDK Deployments

| Directory | Stack | Purpose |
|-----------|-------|---------|
| `cdk/accounts` | `E3Accounts` | Creates member accounts in AWS Organizations |
| `cdk/accounts` | `E3AccountBootstrap-*` | Security baseline for new accounts |
| `cdk/platform` | `E3Platform` | Full e3 cloud app (API, storage, auth, frontend) |

## References

- Design docs: `./design/cloud-options.md`, `./design/cloud-devplan.md`, `./design/fargate-compute.md`, etc
- e3 design: `../e3/design/e3-mvp.md`
- e3-core interfaces: `../e3/packages/e3-core/src/` (StorageBackend, DataflowExecutor)
- east-ui components: `../east-ui/packages/east-ui-components/src/`

## Making changes

Ensure all changes are reflected in the project README.md files.
In particular deployment instructions, schemas and project structures must be kept up-to-date at all times.
The integration tests must have a 100% pass rate - use the dev environment to test all changes.

All features are to be designed as cloud-agnostic abstractions and generic algorithms, using dependency injection for AWS functionality.
Generally, logic that could live in ../e3 should be added there.
Logic that could be shared across different cloud implementations should be made generic using dependency injection.
We should minimize the amount of concrete code throughout (e.g. AWS lambda definitions should be short stubs).
Abstract interfaces should have in-memory implementations (functioning mocks) for rapid unit and integration testing, while the tests themselves should be abstracted over implementations so they can be shared and reused.
This ensures our different implementations (local, AWS, Azure, GCP) behave identically and robustly.
