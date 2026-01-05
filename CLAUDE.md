# e3-aws

AWS cloud infrastructure for hosting e3 solutions.

## Overview

This repository contains the AWS CDK infrastructure, Lambda handlers, and frontend application for deploying e3 as a multi-tenant cloud service.

**Architecture:** CloudFront + API Gateway + Lambda + EFS + Step Functions

See `design/cloud-options.md` for architecture decisions and `design/cloud-devplan.md` for the development roadmap.

## Structure

```
e3-aws/
├── infrastructure/           # AWS CDK stacks (TypeScript)
│   ├── lib/
│   │   ├── api-stack.ts      # API Gateway + Lambda
│   │   ├── storage-stack.ts  # EFS + DynamoDB
│   │   ├── compute-stack.ts  # Step Functions + runners
│   │   ├── auth-stack.ts     # Cognito
│   │   └── frontend-stack.ts # CloudFront + S3
│   └── bin/
│       └── e3-aws.ts         # CDK app entry
│
├── packages/
│   ├── e3-cloud-api/         # Lambda handlers for API
│   │   └── src/handlers/     # Route handlers
│   │
│   ├── e3-cloud-storage/     # EFS-backed StorageBackend
│   │   └── src/
│   │       └── efs-backend.ts
│   │
│   └── e3-cloud-runner/      # Task execution handlers
│       └── src/handlers/     # Step Functions Lambda handlers
│
├── apps/
│   └── main/                 # Default Vite frontend app
│       └── src/
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

# Deploy to AWS (requires credentials)
npm run cdk deploy

# Run frontend locally
npm run dev -w @elaraai/e3-cloud-main
```

## CDK Stacks

| Stack | Purpose |
|-------|---------|
| `StorageStack` | EFS filesystem, DynamoDB tables (tenants, permissions) |
| `AuthStack` | Cognito User Pool, JWT configuration |
| `ApiStack` | API Gateway, Lambda functions, EFS mount |
| `ComputeStack` | Step Functions state machines, task runners |
| `FrontendStack` | CloudFront distribution, S3 bucket for apps |

## References

- Design docs: `./design/cloud-options.md`, `./design/cloud-devplan.md`
- e3 design: `../e3/design/e3-mvp.md`
- e3-core interfaces: `../e3/packages/e3-core/src/` (StorageBackend, DataflowExecutor)
- east-ui components: `../east-ui/packages/east-ui-components/src/`
