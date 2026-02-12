# e3 CDK Infrastructure

AWS CDK projects for e3 cloud platform infrastructure.

## Overview

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                         AWS Organization                                    │
│                                                                             │
│  ┌──────────────────┐  ┌──────────────────┐  ┌──────────────────────────┐   │
│  │   Management     │  │ Shared Services  │  │   Deployment Accounts    │   │
│  │   Account        │  │    Account       │  │                          │   │
│  │  163997153162    │  │  064741130885    │  │  ┌──────────────────┐    │   │
│  │                  │  │                  │  │  │  elara-dev-e3    │    │   │
│  │  E3AccountsStack │  │ E3SharedInfra    │  │  │                  │    │   │
│  │  (creates accts) │  │ Stack            │  │  │  E3Bootstrap     │    │   │
│  │                  │  │                  │  │  │  E3Platform      │    │   │
│  │                  │  │  • Route53 zone  │  │  └──────────────────┘    │   │
│  │                  │  │    e3.elaraai.com│  │                          │   │
│  │                  │  │  • Cross-account │  │  ┌──────────────────┐    │   │
│  │                  │  │    IAM role      │  │  │  elara-prod-e3   │    │   │
│  │                  │  │                  │  │  │                  │    │   │
│  │                  │  │                  │  │  │  E3Bootstrap     │    │   │
│  │                  │  │                  │  │  │  E3Platform      │    │   │
│  │                  │  │                  │  │  └──────────────────┘    │   │
│  └──────────────────┘  └──────────────────┘  └──────────────────────────┘   │
│                                                                             │
│  cdk/accounts ─────────────────────────────► cdk/platform                   │
│  (organization-level)                        (per-deployment)               │
└─────────────────────────────────────────────────────────────────────────────┘
```

## Projects

| Project | Path | Purpose |
|---------|------|---------|
| **accounts** | `cdk/accounts` | Organization management: creates AWS accounts, bootstraps security, shared DNS |
| **platform** | `cdk/platform` | e3 platform deployment: API, storage, auth, frontend per account |

## Account Types

| Account | Purpose | Stacks Deployed |
|---------|---------|-----------------|
| **Management** (163997153162) | AWS Organizations root, SSO | `E3AccountsStack` |
| **Shared Services** (064741130885) | Cross-account resources | `E3SharedInfraStack` |
| **Deployment** (created by E3AccountsStack) | Runs e3 platform | `E3AccountBootstrapStack`, `E3PlatformStack` |

## Domain Architecture

```
elaraai.com (parent zone)
  └── NS e3.elaraai.com → Shared Services hosted zone

e3.elaraai.com (shared services account)
  ├── dev.e3.elaraai.com    → elara-dev-e3 CloudFront
  ├── test.e3.elaraai.com   → elara-test-e3 CloudFront
  └── e3.elaraai.com        → elara-prod-e3 CloudFront (apex)
```

## Deployment Workflow

### Initial Setup (new accounts, infrastructure changes)

1. **Create member accounts** → Deploy `E3AccountsStack` from management account
2. **Deploy shared infrastructure** → Deploy `E3SharedInfraStack` from shared services account
3. **Bootstrap each deployment account** → Deploy `E3AccountBootstrapStack` to member account

See [accounts/README.md](accounts/README.md) for detailed step-by-step instructions.

### Deploy e3 Platform

```bash
cd cdk/platform
aws sso login --profile elaraai-dev-elara-e3
AWS_PROFILE=elaraai-dev-elara-e3 npm run deploy -- --context config=elara-dev
```

See [platform/README.md](platform/README.md) for detailed instructions.

## Project Details

### cdk/accounts

Organization-level infrastructure:

- **E3AccountsStack** - Creates AWS accounts in Organizations, sets up SSO assignments
- **E3AccountBootstrapStack** - Security baseline (CloudTrail, GuardDuty, Security Hub), IAM roles, domain SSM parameters
- **E3SharedInfraStack** - Centralized Route53 hosted zone, cross-account DNS access

See [accounts/README.md](accounts/README.md) for detailed documentation.

### cdk/platform

Per-deployment e3 platform:

- **E3PlatformStack** - Complete e3 deployment:
  - S3 bucket for package/artifact storage
  - DynamoDB table for refs and metadata
  - Cognito User Pool for authentication
  - Lambda function (API handler)
  - API Gateway (HTTP API with JWT auth)
  - CloudFront distribution (CDN + custom domain)
  - Route53 record (if domain configured)

See [platform/README.md](platform/README.md) for detailed documentation.

## Cross-Project Dependencies

```
cdk/accounts                          cdk/platform
─────────────                         ────────────
E3AccountsStack
    │ creates account
    ▼
E3AccountBootstrapStack
    │ writes SSM params:
    │   /e3/domain/base-domain
    │   /e3/domain/hosted-zone-id
    │   /e3/domain/certificate-arn
    ▼
                    ──────────────►   E3PlatformStack
                                          │ reads SSM params
                                          │ creates CloudFront
                                          │ creates Route53 record
                                          ▼
E3SharedInfraStack                    (subdomain in shared zone)
    │ hosts Route53 zone
    │ grants cross-account access
    ▼
(deployment accounts create records)
```

## Environment Variables & Context

### cdk/accounts

| Context | Purpose |
|---------|---------|
| (none) | Deploy E3AccountsStack to management account |
| `--context account=NAME` | Deploy E3AccountBootstrapStack to member account (idempotent) |
| `--context shared=true` | Deploy E3SharedInfraStack to shared services |

### cdk/platform

| Context | Purpose |
|---------|---------|
| `--context config=NAME` | Deployment config file name (e.g., `elara-dev`) — loads `deployments/{NAME}.json` |

## Related Documentation

- [Cloud Architecture](../design/cloud-options.md) - Architecture decisions
- [Development Plan](../design/cloud-devplan.md) - Implementation roadmap
- [Accounts README](accounts/README.md) - Account management details
- [Platform README](platform/README.md) - Platform deployment details
