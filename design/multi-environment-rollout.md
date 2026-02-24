# Multi-Environment Production Rollout

Plan for bootstrapping two new client production accounts and hardening e3-cloud for managing multiple deployments with different upgrade cadences.

## Current State

- Single deployment: **elara-dev** (`dev.e3.elaraai.com`, account `925445553972`)
- CDK accounts project handles AWS Organizations provisioning + account bootstrap (OIDC, security baseline, domain)
- CDK platform project deploys the full e3 stack (API, storage, compute, auth, frontend)
- GitHub Actions workflows for platform deploy and runner deploy (manual trigger, OIDC auth)
- Runner image based on floating `ghcr.io/elaraai/e3:beta` tag, pushed to ECR as `:latest` only
- All `@elaraai/*` dependencies pinned to `"beta"` npm tag (resolved versions locked in `package-lock.json`)

## Versioning Strategy

### Design Principles

1. **Locked versioning per repository** — all packages in a git repo share one version number. A version bump means "the platform changed," even if only one package's code changed.
2. **The e3 npm version is the platform version** — it's the version devkit users install, the version the Docker base image is tagged with, and the version e3-cloud pins to.
3. **The Docker image is the cross-language metapackage** — it's the only artifact that can guarantee TypeScript types match Python runtime code.
4. **npm peer dependencies enforce compile-time compatibility** — each package declares which versions of its ecosystem it's compatible with.
5. **Git tags bridge npm and Python** — the npm version of `@elaraai/east-py-datascience` corresponds to a git tag in the east-py repo, which the Docker build uses to install the matching Python code.

### Repository Boundaries & Locked Version Groups

Each git repository has locked versioning — all packages within share the same version:

| Repository | Packages | Current Version |
|------------|----------|-----------------|
| **east** | `@elaraai/east` | `0.0.1-beta.35` |
| **east-node** | `east-node-std`, `east-node-io`, `east-node-cli` | `0.0.1-beta.29` |
| **east-py** | `east-py`, `east-py-std`, `east-py-io`, `east-py-datascience`, `east-py-cli` (PyPI + npm) | `0.0.2-beta.69` (npm) / `0.1.0` (PyPI) |
| **east-ui** | `east-ui`, `east-ui-components`, `e3-ui-components` | `0.0.1-beta.33` |
| **e3** | `e3`, `e3-types`, `e3-core`, `e3-cli`, `e3-api-client`, `e3-api-server`, `e3-api-tests` | `0.0.2-beta.33` |
| **e3-cloud** | `e3-cloud-core`, `e3-cloud-types`, `e3-cloud-cli`, `e3-aws` | `0.0.1-alpha.0` |
| **east-plugin** | Docker images (no npm packages) | N/A |

### Peer Dependencies

Each tier declares peer dependencies on the packages it requires from upstream tiers:

**`@elaraai/e3`** (the devkit-facing package):
```json
{
  "peerDependencies": {
    "@elaraai/east": "0.0.1-beta.35",
    "@elaraai/east-node-std": "0.0.1-beta.29",
    "@elaraai/east-node-io": "0.0.1-beta.28",
    "@elaraai/east-py-datascience": "0.0.2-beta.69"
  },
  "peerDependenciesMeta": {
    "@elaraai/east-ui": { "optional": true },
    "@elaraai/east-ui-components": { "optional": true }
  }
}
```

**`@elaraai/e3-cloud-core`** (cloud-agnostic abstractions):
```json
{
  "peerDependencies": {
    "@elaraai/east": "0.0.1-beta.35",
    "@elaraai/e3-types": "0.0.2-beta.33",
    "@elaraai/e3-core": "0.0.2-beta.33"
  }
}
```

**`@elaraai/e3-cloud-cli`** (cloud management tool):
```json
{
  "peerDependencies": {
    "@elaraai/east": "0.0.1-beta.35",
    "@elaraai/e3": "0.0.2-beta.33"
  }
}
```

Peer dep versions are updated automatically by the cascade (see below). At publish time, workspace `"*"` references and `"beta"` tags are rewritten to exact versions.

### Publish Cascade

The cascade is serial — each tier publishes after its upstream dependencies, so it always knows the exact compatible versions:

```
east publishes (0.0.1-beta.36)
  → triggers update-deps in east-node
    → east-node publishes (0.0.1-beta.30)
      → triggers update-deps in east-py
        → east-py publishes npm + bumps Python version (0.0.2-beta.70)
          → triggers update-deps in e3 (updates deps AND peer deps)
            → e3 publishes (0.0.2-beta.35)
              → triggers update-deps in east-ui
              → triggers Docker image build in east-plugin
              → triggers update-deps in e3-cloud
```

Key change from current state: east-node currently triggers east-py and e3 in parallel. This must become serial (east-py before e3) so that e3 can declare the correct east-py-datascience peer dep version.

### Docker Image Tagging

**Base image** (`ghcr.io/elaraai/e3`): Tagged with the **e3 npm version**.

The east-plugin Docker workflow:
1. Receives the e3 version (from cascade trigger or manual input)
2. Queries npm for e3's peer dependency versions
3. Installs npm packages at those exact versions (already works)
4. Installs Python packages from git tags derived from npm versions:
   ```bash
   # The npm version maps to a git tag in the east-py repo
   EAST_PY_DS_VERSION="0.0.2-beta.69"  # from e3's peerDependencies
   GIT_TAG="east-py-datascience-${EAST_PY_DS_VERSION}"

   uv pip install \
     "east-py @ git+https://github.com/elaraai/east-py@${GIT_TAG}#subdirectory=packages/east-py" \
     "east-py-std @ git+https://github.com/elaraai/east-py@${GIT_TAG}#subdirectory=packages/east-py-std" \
     "east-py-io @ git+https://github.com/elaraai/east-py@${GIT_TAG}#subdirectory=packages/east-py-io" \
     "east-py-datascience[all] @ git+https://github.com/elaraai/east-py@${GIT_TAG}#subdirectory=packages/east-py-datascience" \
     "east-py-cli @ git+https://github.com/elaraai/east-py@${GIT_TAG}#subdirectory=packages/east-py-cli"
   ```
5. Tags the image with the e3 version: `ghcr.io/elaraai/e3:0.0.2-beta.35`
6. Also tags with `:beta` (floating alias)

**Runner image** (`e3-{id}-runner` in ECR): Tagged with **e3-cloud git SHA**.

The `Dockerfile.runner` pins to the e3 version:
```dockerfile
FROM ghcr.io/elaraai/e3:0.0.2-beta.34
```
Where the version comes from e3-cloud's `@elaraai/e3` dependency. The runner ECR image is tagged with both `:<git-sha-short>` and `:latest`.

### Version Traceability

From any running environment, the full version chain is traceable:

```
Deployment config: "runner.imageTag": "a1b2c3d"
  → e3-cloud git commit a1b2c3d
    → Dockerfile.runner: FROM ghcr.io/elaraai/e3:0.0.2-beta.34
      → e3@0.0.2-beta.34 peer deps:
        → east@0.0.1-beta.35
        → east-node-std@0.0.1-beta.29
        → east-py-datascience@0.0.2-beta.69 (npm types + Python code from same git tag)
```

### Python Version Bumps Without TypeScript Changes

If a Python-only fix is made in east-py (no TypeScript type changes), the npm version is still bumped (e.g., `0.0.2-beta.69` → `0.0.2-beta.70`). This creates a new git tag pointing to the commit with the fix. The cost is a "wasteful" npm publish of identical TypeScript code, but it keeps the model simple:

- One version number per east-py release
- Git tag always points to the right code (both TypeScript and Python)
- No special cases or out-of-band fixes

This is analogous to apt's build numbers (`1.2.3-1` → `1.2.3-2`) where the upstream source didn't change but the package was rebuilt.

### Locked Versioning in e3 Publish Workflow

The e3 publish workflow currently allows selective package publishing (individual toggles per package). This must be removed — all 7 packages are always bumped and published together. This guarantees that `e3@0.0.2-beta.34` and `e3-types@0.0.2-beta.34` always refer to the same release.

## Critical Issues (Fix Before Bootstrapping)

### 1. GitHub Repo Name Mismatch in OIDC Trust Policy

**Status: FIXED** — CDK source updated (`e3-aws` → `e3-cloud` in `accounts.ts`), dev account patched via AWS CLI.

### 2. Runner Image Has No Version Pinning

The entire runner pipeline uses floating tags with no version tracking:

| Layer | Current | Target |
|-------|---------|--------|
| Base image | `ghcr.io/elaraai/e3:beta` (floating) | `ghcr.io/elaraai/e3:0.0.2-beta.34` (e3 version) |
| ECR tag | `:latest` only | `:<git-sha>` + `:latest` |
| CDK reference | `fromEcr(repo, { tagOrDigest: 'latest' })` | Same (`:latest` for CDK, deploy script pins) |
| Lambda update | `--image-uri ...:latest` | `--image-uri ...:<git-sha>` |
| Deployment config | No runner config | `"runner": { "imageTag": "<git-sha>" }` |

### 3. No GitHub Environment Protection Rules

Production deploy workflows have `environment:` commented out. Anyone with repo access can deploy to prod from the GitHub UI without approval.

## Phase 1: Versioning & Pre-Bootstrap Fixes

### 1.1 Fix OIDC repo name — DONE

- Updated `orgConfig.github.repo` from `'e3-aws'` to `'e3-cloud'` in `cdk/accounts/lib/accounts.ts`
- Patched dev account OIDC role via `aws iam update-assume-role-policy`

### 1.2 Locked versioning in e3

- Remove selective package publish toggles from `e3/.github/workflows/publish.yml`
- Always bump and publish all 7 packages together
- Update e3 README.md and CLAUDE.md with versioning strategy

### 1.3 Add peer dependencies to e3

- `@elaraai/e3` declares peer deps on east, east-node-std, east-node-io, east-py-datascience
- Optional peers for east-ui, east-ui-components
- Update e3's `update-deps` workflow to also update peer dep versions
- Rewrite peer dep versions to exact values at publish time (not `"beta"`)

### 1.4 Make cascade serial (east-py before e3)

- Change east-node's publish workflow to trigger east-py (not e3)
- Add cascade trigger from east-py to e3
- e3's update-deps picks up both east-node and east-py-datascience versions

### 1.5 Tag base Docker image with e3 version

- Update east-plugin Docker workflow to accept e3 version as input
- Derive Python package git tags from e3's peer dep versions
- Pin Python installs to git tags (not `@main`)
- Tag image as `ghcr.io/elaraai/e3:<e3-version>` + `:beta`
- Add cascade trigger from e3 publish → east-plugin Docker build

### 1.6 Pin runner Dockerfile and add version tagging

- Change `Dockerfile.runner` FROM to `ghcr.io/elaraai/e3:<e3-version>` (not `:beta`)
- Update `build-runner.sh` and GitHub Actions to tag with git SHA
- Add `runner.imageTag` to deployment config schema
- Update `deploy-runner.sh` to use config image tag

### 1.7 Add e3-cloud to cascade

- Add `update-deps` workflow to e3-cloud (triggered by e3 publish)
- Updates `@elaraai/e3` dependency version + Dockerfile FROM tag
- Creates PR for review before merge

### 1.8 Enable GitHub Environment protection

- Uncomment `environment:` in both workflow files
- Create GitHub Environments for each deployment config
- Add required reviewers for production environments

## Phase 2: Account Provisioning

### 2.1 Prerequisites (Azure / Entra ID)

For each client, create an enterprise application in Entra ID:
1. Register app in Azure AD → Enterprise Applications
2. Configure SAML/OIDC SSO with Cognito as the relying party
3. Create a client secret and store in AWS Secrets Manager in the target account
4. Configure group claims to include the admin group

### 2.2 Add accounts

Add two new entries to `cdk/accounts/lib/accounts.ts`:

```typescript
export const accounts: AccountConfig[] = [
  { organization: 'elara', environment: 'dev', ... },
  { organization: 'client-a', environment: 'prod', budgetLimitUsd: 500, description: '...' },
  { organization: 'client-b', environment: 'prod', budgetLimitUsd: 500, description: '...' },
];
```

### 2.3 Deploy sequence

1. **Deploy org stack** (management account) — creates member accounts
   ```bash
   cd cdk/accounts
   AWS_PROFILE=elaraai-prod-management-root npm run deploy
   ```

2. **Wait for account creation** (several minutes)

3. **Bootstrap CDK in each new account**
   ```bash
   # Assume OrganizationAccountAccessRole into new account
   npx cdk bootstrap aws://<ACCOUNT_ID>/ap-southeast-2
   ```

4. **Deploy bootstrap stack** to each account
   ```bash
   npm run deploy -- --context account=client-a-prod-e3
   npm run deploy -- --context account=client-b-prod-e3
   ```

5. **Update shared infra** — add new account IDs to `sharedInfraConfig.deploymentAccountIds`
   ```bash
   cd cdk/accounts
   AWS_PROFILE=elaraai-prod-management-root npm run deploy -- --context shared=true
   ```

6. **Create OIDC client secret** in each account's Secrets Manager
   ```bash
   aws secretsmanager create-secret \
     --name /e3/auth/oidc/client-secret \
     --secret-string "<client-secret-from-entra>" \
     --region ap-southeast-2
   ```

7. **Create ECR repository** in each account
   ```bash
   aws ecr create-repository --repository-name e3-<id>-runner --region ap-southeast-2
   ```

8. **Create deployment config** JSON in `cdk/platform/deployments/`

9. **Deploy platform stack**
   ```bash
   cd cdk/platform
   AWS_PROFILE=<profile> npx cdk deploy --context config=<config-name> --require-approval never
   ```

10. **Build + push runner image**
    ```bash
    make deploy-runner CONFIG=<config-name> PROFILE=<profile>
    ```

11. **Add config to GitHub Actions** workflow dropdown options

## Phase 3: Operational Hardening

### 3.1 Release & promotion workflow

Rather than deploying independently to each environment from arbitrary commits:

1. Merge to `main` → auto-deploy to dev (optional)
2. Tag a release (`v0.1.0`) → manually promote to staging/test
3. Approve → promote same artifacts to prod

This ensures prod runs the exact same code that passed testing.

### 3.2 Deploy-web GitHub Action

Add a third workflow for web-only deploys (S3 sync + CloudFront invalidation). Most production updates will be frontend-only and shouldn't require full CDK deploy.

### 3.3 Upgrade runbook

Document the process for upgrading an environment:
1. Update `@elaraai/*` dependencies (`make update`)
2. Run unit tests (`make test`)
3. Deploy to dev, run integration tests
4. Tag release
5. Deploy platform to target environment
6. Deploy runner to target environment (with pinned image tag)
7. Run smoke tests against target environment

### 3.4 Claude Code skill

Create a skill definition that guides team members through the bootstrap process interactively, validating prerequisites at each step.

## Appendix: Deployment Config Schema

Full schema for `cdk/platform/deployments/<name>.json`:

```json
{
  "$schema": "../schemas/deployment.schema.json",
  "name": "client-a-prod",
  "description": "Client A production environment",
  "aws": {
    "accountId": "123456789012",
    "region": "ap-southeast-2",
    "profile": "client-a-prod-e3"
  },
  "deployment": {
    "id": "client-a",
    "callbackUrls": [],
    "allowedOrigins": []
  },
  "domain": {
    "baseDomain": "e3.elaraai.com",
    "hostedZoneId": "Z10452251PCGZVRQ2N81E",
    "route53RoleArn": "arn:aws:iam::064741130885:role/E3-Route53-CrossAccount"
  },
  "oidc": {
    "providerName": "EntraID",
    "clientId": "<from-entra>",
    "issuerUrl": "https://login.microsoftonline.com/<tenant-id>/v2.0",
    "clientSecretArn": "arn:aws:secretsmanager:ap-southeast-2:123456789012:secret:/e3/auth/oidc/client-secret-XXXXXX",
    "adminGroup": "<entra-group-id>"
  },
  "github": {
    "deployRoleArn": "arn:aws:iam::123456789012:role/E3-GitHubActions-Prod"
  },
  "scheduling": {
    "defaultTimezone": "Australia/Sydney"
  },
  "runner": {
    "imageTag": "a1b2c3d"
  },
  "testUsers": {
    "enabled": false
  }
}
```

## Appendix: Known Limitations

- **Client accounts only support `prod` environment** — `InfraDeployClientTest`/`ClientDev` SSO permission sets don't exist in elara-infra yet
- **Alternate contacts hardcoded** to Campbell Morrison in bootstrap stack — should be parameterized per account
- **DynamoDB throttling on cold starts** — first burst of requests after idle can hit `TableReadKeyRangeThroughputExceeded`
- **Fargate VPC has no private subnets** — tasks pull from ECR via internet, not suitable for strict network isolation
- **ECR repository must be created manually** before CDK deploy (not auto-created by the stack)
- **GC schedule hardcoded** to daily at 2 AM UTC — not configurable per environment
