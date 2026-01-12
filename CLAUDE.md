# e3-aws

AWS cloud infrastructure for hosting e3 solutions.

## Overview

This repository contains the AWS CDK infrastructure, Lambda handlers, and frontend application for deploying e3 as a multi-tenant cloud service.

**Architecture:** CloudFront + API Gateway + Lambda + EFS + Step Functions

See `design/cloud-options.md` for architecture decisions and `design/cloud-devplan.md` for the development roadmap.

## Structure

```
e3-aws/
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
│   ├── api/                  # Lambda handlers for API (@elaraai/e3-api)
│   │   └── src/handlers/     # Route handlers
│   │
│   ├── storage/              # EFS-backed StorageBackend (@elaraai/e3-storage)
│   │   └── src/
│   │       └── efs-backend.ts
│   │
│   └── runner/               # Task execution handlers (@elaraai/e3-runner)
│       └── src/handlers/     # Step Functions Lambda handlers
│
├── web/                      # Vite frontend app (@elaraai/e3-web)
│   └── src/
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

## Key Concepts

- **Tenant** - A hosted e3 repository with isolated storage (EFS directory)
- **StorageBackend** - Interface from e3-core for storage operations (this repo provides `EfsBackend`)
- **DataflowExecutor** - Interface from e3-core for orchestration (this repo provides Step Functions implementation)
- **UIComponentType** - East UI type that the frontend renders using `east-ui-components`

## Development

```bash
# Install dependencies
npm install

# Build all packages
npm run build

# Deploy e3 platform to AWS (requires credentials)
cd cdk/platform
npm run deploy

# Deploy account provisioning (management account only)
cd cdk/accounts
npm run deploy

# Run frontend locally
npm run dev
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
In particular deployment instructions and project structures must be kept up-to-date at all times.
