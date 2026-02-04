# e3-aws

AWS cloud infrastructure for hosting [e3](../e3) (East Execution Engine) as a multi-tenant platform.

## What is e3?

e3 is a dataflow execution engine for the [East](../east) language. It provides:
- **Repositories** - Version-controlled storage for packages and workspaces
- **Workspaces** - Isolated execution environments with datasets and tasks
- **Dataflows** - Declarative data pipelines that execute incrementally

This repository (`e3-aws`) deploys e3 as a cloud service on AWS.

## Architecture

```
                                    ┌─────────────────────────────────┐
                                    │         CloudFront CDN          │
                                    │    (dev.e3.elaraai.com)         │
                                    └───────────────┬─────────────────┘
                                                    │
                        ┌───────────────────────────┼───────────────────────────┐
                        │                           │                           │
                        ▼                           ▼                           ▼
                 ┌─────────────┐            ┌─────────────┐            ┌─────────────┐
                 │   Web App   │            │ API Gateway │            │   Cognito   │
                 │    (S3)     │            │   (HTTP)    │            │ (Auth/SSO)  │
                 └─────────────┘            └──────┬──────┘            └─────────────┘
                                                   │
                                                   ▼
                                           ┌─────────────┐
                                           │   Lambda    │
                                           │ (API + Auth)│
                                           └──────┬──────┘
                                                  │
                    ┌─────────────────────────────┼─────────────────────────────┐
                    │                             │                             │
                    ▼                             ▼                             ▼
             ┌─────────────┐              ┌─────────────┐              ┌─────────────┐
             │     S3      │              │  DynamoDB   │              │    Step     │
             │  (Storage)  │              │   (Refs)    │              │  Functions  │
             │             │              │             │              │ (Dataflow)  │
             │  Packages   │              │  Metadata   │              │             │
             │  Artifacts  │              │  Workspaces │              │  Task       │
             │  Blobs      │              │  Device     │              │  Execution  │
             │             │              │  Codes      │              │             │
             └─────────────┘              └─────────────┘              └─────────────┘
```

## Quick Start

### Prerequisites

- Node.js 22+
- AWS CLI configured with SSO
- Access to an e3 deployment account

### Deploy

```bash
# Install dependencies
npm install

# Build all packages
npm run build

# Login to AWS SSO (opens browser)
aws sso login --profile elaraai-dev-elara-e3

# Deploy platform (from cdk/platform directory)
cd cdk/platform
AWS_PROFILE=elaraai-dev-elara-e3 npx cdk deploy --context deploymentId=dev --require-approval never
```

The `--context deploymentId=dev` specifies the target environment:
- `dev` → `dev.e3.elaraai.com` (development)
- `test` → `test.e3.elaraai.com` (staging)
- `prod` → `e3.elaraai.com` (production)

### Use with CLI

```bash
# Login to cloud platform
e3 login https://dev.e3.elaraai.com

# Create a repository
e3 repo create https://dev.e3.elaraai.com/api/repos/my-repo

# Import a package
e3 package import ./my-package.tar.gz https://dev.e3.elaraai.com/api/repos/my-repo
```

## Project Structure

```
e3-aws/
├── cdk/                    # AWS CDK Infrastructure
│   ├── accounts/           # AWS account provisioning & shared infra
│   │   ├── E3AccountsStack       # Creates member accounts
│   │   ├── E3AccountBootstrapStack # Security baseline per account
│   │   └── E3SharedInfraStack    # Shared DNS (Route53)
│   │
│   └── platform/           # e3 platform deployment
│       └── E3PlatformStack       # Complete platform stack
│
├── packages/               # TypeScript packages
│   ├── e3-aws-api/         # Lambda API handler (Hono)
│   ├── e3-aws-storage/     # S3 + DynamoDB storage backend
│   ├── e3-aws-runner/      # Task execution Lambda
│   ├── e3-admin-types/     # Shared authorization types
│   ├── e3-admin-core/      # Authorization logic
│   ├── e3-admin-client/    # Admin API client
│   └── e3-cloud-cli/       # Cloud management CLI
│
├── web/                    # React frontend (Vite)
│
└── design/                 # Architecture documentation
```

## Documentation

| Document | Description |
|----------|-------------|
| [CDK Overview](cdk/README.md) | Infrastructure architecture and deployment |
| [Accounts CDK](cdk/accounts/README.md) | Account provisioning and domain setup |
| [Platform CDK](cdk/platform/README.md) | Platform deployment and IdP configuration |
| [Architecture](design/cloud-options.md) | Design decisions |
| [Development Plan](design/cloud-devplan.md) | Implementation roadmap |

## AWS Account Structure

```
Elara AWS Organization
├── Management Account (163997153162)
│   └── E3AccountsStack (creates member accounts)
│
├── Shared Services Account (064741130885)
│   └── E3SharedInfraStack (Route53 zone: e3.elaraai.com)
│
└── Deployment Accounts (created by E3AccountsStack)
    ├── elara-dev-e3
    │   ├── E3AccountBootstrapStack (security, IAM)
    │   └── E3PlatformStack (the actual platform)
    │
    ├── elara-test-e3
    └── elara-prod-e3
```

## Packages

| Package | Description |
|---------|-------------|
| `@elaraai/e3-aws-api` | Lambda handler - routes, auth, OIDC discovery |
| `@elaraai/e3-aws-storage` | S3DynamoStorage backend implementation |
| `@elaraai/e3-aws-runner` | Task execution Lambda for Step Functions |
| `@elaraai/e3-admin-types` | Shared East types for authorization |
| `@elaraai/e3-admin-core` | Authorization logic and interfaces |
| `@elaraai/e3-admin-client` | HTTP client for admin API |
| `@elaraai/e3-cloud-cli` | CLI for cloud management |
| `@elaraai/e3-web` | React frontend application |
| `@elaraai/e3-accounts` | CDK for account provisioning |
| `@elaraai/e3-platform` | CDK for platform deployment |

## Development

```bash
# Install dependencies
npm install

# Build everything
npm run build

# Run tests
npm run test

# Lint
npm run lint

# Run frontend dev server
npm run dev
```

### CDK Commands

All CDK commands require `AWS_PROFILE` and `--context deploymentId`:

```bash
# Set profile for all commands
export AWS_PROFILE=elaraai-dev-elara-e3

# Synthesize CloudFormation (no deploy)
npx cdk synth --context deploymentId=dev

# Deploy platform
npx cdk deploy --context deploymentId=dev --require-approval never

# Diff changes
npx cdk diff --context deploymentId=dev

# Destroy (careful!)
npx cdk destroy --context deploymentId=dev
```

### Integration Tests

```bash
# Ensure you're logged into both AWS and e3
aws sso login --profile elaraai-dev-elara-e3
e3 login https://dev.e3.elaraai.com

# Run all integration tests
cd test/integration
AWS_PROFILE=elaraai-dev-elara-e3 npm test
```

## Related Projects

| Project | Description |
|---------|-------------|
| [e3](../e3) | Core engine, CLI, local API server |
| [east](../east) | East language compiler |
| [east-ui](../east-ui) | UI component library |
| [east-node](../east-node) | Node.js runtime |

## Authentication

The platform supports:
- **Device Flow** - For CLI authentication (`e3 login`)
- **Cognito Hosted UI** - For web app login
- **Azure AD / OIDC** - Enterprise SSO integration
- **SAML 2.0** - ADFS and other SAML providers

See [Platform README](cdk/platform/README.md#identity-provider-setup) for IdP configuration.

## Domain Structure

```
e3.elaraai.com (shared hosted zone)
├── dev.e3.elaraai.com    → elara-dev-e3 deployment
├── test.e3.elaraai.com   → elara-test-e3 deployment
├── e3.elaraai.com        → elara-prod-e3 deployment (apex)
└── {client}.e3.elaraai.com → client deployments
```

## License

Copyright (c) 2025 Elara AI Pty Ltd. All rights reserved.
Proprietary and confidential. See [LICENSE.md](LICENSE.md).
