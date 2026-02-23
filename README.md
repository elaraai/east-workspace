# e3-cloud

Multi-cloud implementation of [e3](../e3) (East Execution Engine) as a multi-tenant platform.
Currently we use AWS cloud infrastructure for hosting.
Relative to e3, e3-cloud provides enterprise-only features including authorization, task scheduling, scalable serverless compute/storage and access to high-capacity on-demand compute runners.

## What is e3?

e3 is a dataflow execution engine for the [East](../east) language. It provides:
- **Repositories** - Version-controlled storage for packages and workspaces
- **Workspaces** - Isolated execution environments with datasets and tasks
- **Dataflows** - Declarative data pipelines that execute incrementally

This project (`e3-cloud`) deploys e3 as a cloud service on AWS, with abstractions in place to make it easy to extend to Azure or GCP.

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
AWS_PROFILE=elaraai-dev-elara-e3 npx cdk deploy --context config=elara-dev --require-approval never
```

The `--context config=elara-dev` loads the full deployment configuration from `deployments/elara-dev.json`, including test users, OIDC, and domain settings.

### Deploy Runner

The task runner Lambda uses a Docker image. When the base image (`ghcr.io/elaraai/e3:beta`) is updated, rebuild and deploy the runner:

```bash
# Build+push runner image to ECR and update Lambda
make deploy-runner CONFIG=elara-dev PROFILE=elaraai-dev-elara-e3
# or directly: ./scripts/deploy-runner.sh elara-dev elaraai-dev-elara-e3
```

Or trigger the **Deploy Runner** workflow from GitHub Actions.

### Deploy Web Only (Fast)

For UI-only changes when infrastructure and config haven't changed:

```bash
# Build the web app then sync to S3
npm run build
make deploy-web CONFIG=elara-dev PROFILE=elaraai-dev-elara-e3
# or directly: ./scripts/deploy-web.sh elara-dev elaraai-dev-elara-e3
```

This preserves the existing `config.json` in S3. If OIDC, Cognito, or domain settings have changed, use a full deploy instead.

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
│   ├── e3-aws/             # AWS implementation (storage, services, handlers)
│   ├── e3-cloud-types/     # Shared authorization types
│   ├── e3-cloud-core/      # Cloud-agnostic interfaces and routes
│   ├── e3-cloud-client/    # Admin API client
│   ├── e3-cloud-tests/     # Portable integration tests
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
| `@elaraai/e3-aws` | AWS implementation — storage (S3+DynamoDB), services (Cognito, SFN, EventBridge), Lambda/Fargate handlers |
| `@elaraai/e3-cloud-types` | Shared East types for authorization |
| `@elaraai/e3-cloud-core` | Cloud-agnostic interfaces, routes and authorization |
| `@elaraai/e3-cloud-client` | HTTP client for admin API |
| `@elaraai/e3-cloud-tests` | Portable integration tests for cloud deployments |
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

All CDK commands require `AWS_PROFILE` and `--context config`:

```bash
# Set profile for all commands
export AWS_PROFILE=elaraai-dev-elara-e3

# Synthesize CloudFormation (no deploy)
npx cdk synth --context config=elara-dev

# Deploy platform
npx cdk deploy --context config=elara-dev --require-approval never

# Diff changes
npx cdk diff --context config=elara-dev

# Destroy (careful!)
npx cdk destroy --context config=elara-dev
```

### Wipe Dev Data

Reset the dev environment to a clean state by deleting all S3 objects and DynamoDB rows (infrastructure is preserved):

```bash
AWS_PROFILE=elaraai-dev-elara-e3 npm run wipe:dev
```

This is hardcoded to only work on the dev account (925445553972).

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
