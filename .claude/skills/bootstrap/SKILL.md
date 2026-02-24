---
name: bootstrap
description: "Bootstrap a new e3-cloud environment. Use when: (1) Creating a new AWS account for e3, (2) Bootstrapping a new client deployment, (3) Setting up Entra ID SSO for a new environment, (4) Deploying the e3 platform to a new account, (5) Troubleshooting account or deployment setup."
user_invocable: true
---

# e3-cloud Environment Bootstrap

> **Work in progress.** This skill is being developed alongside our multi-environment rollout. The authoritative instructions are in the READMEs and design docs linked below. This skill will be expanded with interactive validation and automation as the process matures.

## Key Documentation

Read these before starting a new environment setup:

### Design & Planning
- **`design/multi-environment-rollout.md`** — Full rollout plan, versioning strategy, and deployment sequence for bringing up new client environments.

### CDK Accounts (AWS account provisioning)
- **`cdk/accounts/README.md`** — Complete guide for creating AWS accounts, bootstrapping security baseline, configuring OIDC, domain setup, and SSO integration.
- **`cdk/accounts/lib/accounts.ts`** — Account definitions. Add new accounts here.

### CDK Platform (e3 application infrastructure)
- **`cdk/platform/README.md`** — Platform stack deployment, deployment config schema, and resource overview.
- **`cdk/platform/deployments/elara-dev.json`** — Reference deployment config (use as template for new environments).
- **`cdk/platform/schemas/deployment.schema.json`** — JSON schema for deployment configs.

### Deployment Scripts
- **`scripts/deploy-runner.sh`** — Build and push runner Docker image to ECR + update Lambda.
- **`scripts/deploy-web.sh`** — Fast UI-only deploy (S3 sync + CloudFront invalidation).
- **`scripts/build-runner.sh`** — Build runner Docker image locally or push to ECR.

### GitHub Actions
- **`.github/workflows/deploy-platform.yml`** — Full CDK platform deploy (manual trigger).
- **`.github/workflows/build-runner.yml`** — Runner image build + push + Lambda update (manual trigger).

## Azure CLI Setup

The Azure CLI (`az`) is required for creating Entra ID enterprise apps for SSO.

### Install

```bash
# Ubuntu/Debian (including WSL)
curl -sL https://aka.ms/InstallAzureCLIDeb | sudo bash

# Verify
az --version
```

### Login

Elara's Entra ID tenant: `f6e3d4a6-dd46-4950-ba59-d96255494980`

The tenant has no Azure subscriptions (Entra ID-only), so `--allow-no-subscriptions` is required:

```bash
az login --tenant f6e3d4a6-dd46-4950-ba59-d96255494980 --allow-no-subscriptions
```

This opens a browser for authentication.

## Create an Entra ID Enterprise App

For each new e3-cloud environment, create an app registration in Elara's Entra ID tenant.

**Naming conventions:**
- App registration: `e3-{deploymentId}` (e.g., `e3-kpmg`) — matches Cognito domain prefix
- Security groups: `{org}-{env}-e3-{role}` (e.g., `kpmg-prod-e3-admins`) — matches AWS account name
- Replace `{deploymentId}` with the deployment ID (e.g., `kpmg`, `twe`, `dev`)
- Replace `{account}` with the AWS account name (e.g., `kpmg-prod-e3`, `elara-dev-e3`)

These settings are verified against the working `elara-dev-e3` and `e3-kpmg` app registrations.

### Step 1: Create the app registration

```bash
az ad app create \
  --display-name "e3-{deploymentId}" \
  --sign-in-audience AzureADMultipleOrgs \
  --web-redirect-uris "https://e3-{deploymentId}.auth.ap-southeast-2.amazoncognito.com/oauth2/idpresponse" \
  --enable-id-token-issuance true
```

- `AzureADMultipleOrgs` enables future federation with client Entra ID tenants.
- `--enable-id-token-issuance true` is required for the OIDC implicit flow with Cognito.

Note the `appId` (client ID) and `id` (object ID) from the output.

### Step 2: Create a client secret

```bash
az ad app credential reset --id <appId> --display-name "e3-cloud" --years 2
```

**Save the `password` value immediately** — you cannot retrieve it later. It will be stored in AWS Secrets Manager when provisioning the AWS account.

### Step 3: Enable group membership claims

```bash
az ad app update --id <appId> --set groupMembershipClaims=ApplicationGroup
```

> **Note:** `--group-membership-claims` is not a valid flag. You must use `--set groupMembershipClaims=...`.

This makes the app emit group IDs in tokens, which Cognito maps to the admin group.

### Step 4: Configure optional token claims

```bash
az ad app update --id <appId> --optional-claims '{
  "idToken": [
    {"name": "email", "source": null, "essential": false},
    {"name": "given_name", "source": null, "essential": false},
    {"name": "family_name", "source": null, "essential": false},
    {"name": "groups", "source": null, "essential": false}
  ],
  "accessToken": [
    {"name": "groups", "source": null, "essential": false}
  ]
}'
```

### Step 5: Add and grant API permissions (Microsoft Graph delegated)

```bash
# Microsoft Graph resource ID: 00000003-0000-0000-c000-000000000000
# Permission GUIDs (delegated scopes):
#   email:              64a6cdd6-aab1-4aaf-94b8-3cc8405e90d0
#   profile:            14dad69e-099b-42c9-810b-d002981feec1
#   User.Read:          e1fe6dd8-ba31-4d61-89e7-88639da4683d
#   Group.Read.All:     5f8c59db-677d-491f-a6b8-5f174b11ec1d
#   GroupMember.Read.All: bc024368-1153-4739-b217-4326f2e966d0

az ad app permission add --id <appId> \
  --api 00000003-0000-0000-c000-000000000000 \
  --api-permissions \
    64a6cdd6-aab1-4aaf-94b8-3cc8405e90d0=Scope \
    14dad69e-099b-42c9-810b-d002981feec1=Scope \
    e1fe6dd8-ba31-4d61-89e7-88639da4683d=Scope \
    5f8c59db-677d-491f-a6b8-5f174b11ec1d=Scope \
    bc024368-1153-4739-b217-4326f2e966d0=Scope
```

### Step 6: Create service principal and grant permissions

A service principal (the "Enterprise application" in the Azure portal) must exist before granting permissions:

```bash
# Create the service principal
az ad sp create --id <appId>
```

Note the service principal `id` (object ID) from the output — this is different from the app's `id`.

```bash
# Grant the API permissions (admin consent)
az ad app permission grant --id <appId> \
  --api 00000003-0000-0000-c000-000000000000 \
  --scope "email profile User.Read Group.Read.All GroupMember.Read.All"
```

### Step 7: Set the logout URL

The `az ad app update --set web.logoutUrl=` flag does not work. Use the Graph API directly (requires the app **object ID**, not the appId):

```bash
az rest --method PATCH \
  --uri "https://graph.microsoft.com/v1.0/applications/<objectId>" \
  --headers "Content-Type=application/json" \
  --body '{"web":{"logoutUrl":"https://e3-{deploymentId}.auth.ap-southeast-2.amazoncognito.com/logout"}}'
```

### Step 8: Configure the enterprise application (service principal)

Add tags so the app appears in the "Enterprise applications" panel, and require group assignment for sign-in:

```bash
# Add enterprise app tags (use the service principal object ID)
az ad sp update --id <spObjectId> \
  --set tags='["HideApp","WindowsAzureActiveDirectoryIntegratedApp"]'

# Require group assignment (only assigned users/groups can sign in)
az ad sp update --id <spObjectId> \
  --set appRoleAssignmentRequired=true
```

### Step 9: Create security groups and assign to app

Create an admin group (for platform admin access) and a users group (for sign-in access):

```bash
# Admin group — the ID goes in oidc.adminGroup in the deployment config
az ad group create \
  --display-name "{account}-admins" \
  --mail-nickname "{account}-admins"

# Users group — controls who can sign in (when appRoleAssignmentRequired=true)
az ad group create \
  --display-name "{account}-users" \
  --mail-nickname "{account}-users"
```

Assign both groups to the enterprise application (use the Graph API with the **service principal object ID**):

```bash
# Assign admins group
az rest --method POST \
  --uri "https://graph.microsoft.com/v1.0/servicePrincipals/<spObjectId>/appRoleAssignedTo" \
  --headers "Content-Type=application/json" \
  --body '{
    "principalId": "<admins-group-id>",
    "principalType": "Group",
    "resourceId": "<spObjectId>",
    "appRoleId": "00000000-0000-0000-0000-000000000000"
  }'

# Assign users group
az rest --method POST \
  --uri "https://graph.microsoft.com/v1.0/servicePrincipals/<spObjectId>/appRoleAssignedTo" \
  --headers "Content-Type=application/json" \
  --body '{
    "principalId": "<users-group-id>",
    "principalType": "Group",
    "resourceId": "<spObjectId>",
    "appRoleId": "00000000-0000-0000-0000-000000000000"
  }'
```

Add users to the groups:

```bash
az ad group member add --group "{account}-admins" --member-id <user-object-id>
az ad group member add --group "{account}-users" --member-id <user-object-id>
```

### Summary of values to record

| Entra ID Value | Deployment Config Field |
|----------------|------------------------|
| Application (client) ID | `oidc.clientId` |
| Client secret value | Store in AWS Secrets Manager → ARN goes in `oidc.clientSecretArn` |
| Admin group ID (UUID) | `oidc.adminGroup` |
| Issuer URL | `oidc.issuerUrl` (always `https://login.microsoftonline.com/f6e3d4a6-dd46-4950-ba59-d96255494980/v2.0` for Elara tenant) |
| Provider name | `oidc.providerName` (use `EntraID`) |

### Existing deployments

| Deployment | App Name | Client ID | Admin Group | Users Group |
|------------|----------|-----------|-------------|-------------|
| `dev` | `elara-dev-e3` | `ecd3a920-ef9a-495c-b1ef-f5c8ce71304a` | `elara-dev-e3-admins` (`b1de3e14-4420-4920-a673-c9da23562da4`) | `elara-dev-e3-users` (`679ca78f-2ed5-4ee6-a9e6-d69f115b9c51`) |
| `kpmg` | `e3-kpmg` | `7356c61e-9d9e-4af8-b9e3-eea677f9491d` | `kpmg-prod-e3-admins` (`8fa20a64-8126-48c5-aefb-eaee8374228a`) | `kpmg-prod-e3-users` (`3fd33d89-a5ab-41b6-b5b5-e9e281ff6bd4`) |

## Create AWS Account

### Step 1: Add account to `cdk/accounts/lib/accounts.ts`

```typescript
{
  organization: '{org}',    // 'elara' for internal, client name for clients
  environment: '{env}',     // 'dev' | 'test' | 'prod'
  budgetLimitUsd: 200,
  description: '{Org} e3 {environment}',
  domain: {
    baseDomain: 'e3.elaraai.com',
    hostedZoneId: 'Z10452251PCGZVRQ2N81E',
    route53RoleArn: 'arn:aws:iam::064741130885:role/E3-Route53-CrossAccount',
  },
}
```

Derived values: name=`{org}-{env}-e3`, email=`devops+{name}@elara.ai`, isClient=`org !== 'elara'`.

Client accounts use `clientProd` SSO group/permission set. Only `prod` is supported for clients (no `ClientTest`/`ClientDev` in SSO yet).

### Step 2: Deploy E3AccountsStack (management account)

```bash
aws sso login --profile elaraai-prod-management-root
cd cdk/accounts && npm run build
AWS_PROFILE=elaraai-prod-management-root npm run deploy
```

This creates the AWS Organizations member account, SSO assignments, and SSM parameters. Note the account ID from the stack outputs.

### Step 3: Bootstrap the new account

> **Important:** The assumed-role credentials only exist in the shell where `eval` runs. Chain all commands with `&&` in a single invocation, or run in one interactive terminal session.

```bash
# Get the new account ID
NEW_ACCOUNT_ID=$(AWS_PROFILE=elaraai-prod-management-root aws cloudformation describe-stacks \
  --stack-name E3Accounts \
  --query 'Stacks[0].Outputs[?contains(OutputKey, `{account}-AccountId`)].OutputValue' \
  --output text --region ap-southeast-2)

# Assume OrganizationAccountAccessRole into the new account
eval $(AWS_PROFILE=elaraai-prod-management-root aws sts assume-role \
  --role-arn arn:aws:iam::${NEW_ACCOUNT_ID}:role/OrganizationAccountAccessRole \
  --role-session-name bootstrap \
  --query 'Credentials.[AccessKeyId,SecretAccessKey,SessionToken]' \
  --output text | \
  awk '{print "export AWS_ACCESS_KEY_ID="$1" AWS_SECRET_ACCESS_KEY="$2" AWS_SESSION_TOKEN="$3}')

# CDK bootstrap + deploy account stack
# --require-approval never is needed (stack creates IAM roles)
npx cdk bootstrap aws://${NEW_ACCOUNT_ID}/ap-southeast-2
npx cdk deploy --context account={account} --require-approval never
```

This creates: IAM password policy, account alias, alternate contacts, InfraDeployRole, GitHub OIDC provider + role, CloudTrail, GuardDuty, Security Hub, budget alerts, and domain SSM parameters.

### Step 4: Add to shared infrastructure

Add the new account ID to `sharedInfraConfig.deploymentAccountIds` in `accounts.ts`, then redeploy shared infra to grant cross-account Route53 access:

```bash
unset AWS_ACCESS_KEY_ID AWS_SECRET_ACCESS_KEY AWS_SESSION_TOKEN
AWS_PROFILE=elaraai-prod-shared-services-core npm run deploy -- --context shared=true
```

### Step 5: Store OIDC client secret in Secrets Manager

SSO propagation for new accounts can take time. Use the assumed-role approach:

```bash
# Re-assume role (or reuse existing session if still valid)
eval $(AWS_PROFILE=elaraai-prod-management-root aws sts assume-role \
  --role-arn arn:aws:iam::${NEW_ACCOUNT_ID}:role/OrganizationAccountAccessRole \
  --role-session-name secrets \
  --query 'Credentials.[AccessKeyId,SecretAccessKey,SessionToken]' \
  --output text | \
  awk '{print "export AWS_ACCESS_KEY_ID="$1" AWS_SECRET_ACCESS_KEY="$2" AWS_SESSION_TOKEN="$3}')

aws secretsmanager create-secret \
  --name /e3/auth/oidc/client-secret \
  --secret-string '<client-secret-from-entra-id>' \
  --region ap-southeast-2
```

Note the secret ARN — it goes in `oidc.clientSecretArn` in the deployment config.

### Step 6: Add AWS SSO profile

Add to `~/.aws/config`:

```ini
[profile {profile}]
sso_start_url = https://elara-portal.awsapps.com/start
sso_region = ap-southeast-2
sso_account_id = <account-id>
sso_role_name = AdministratorAccess
region = ap-southeast-2
```

Profile naming convention: `elaraai-{env}-{org}-e3` (e.g., `elaraai-prod-kpmg-e3`).

Then login: `aws sso login --profile {profile}`

### Step 7: Create deployment config

Create `cdk/platform/deployments/{deploymentId}.json` using `elara-dev.json` as template:

```json
{
  "$schema": "../schemas/deployment.schema.json",
  "name": "{org}-{env}",
  "description": "{Org} {env} environment",
  "aws": {
    "accountId": "<from step 2>",
    "region": "ap-southeast-2",
    "profile": "{profile}"
  },
  "deployment": { "id": "{deploymentId}" },
  "domain": {
    "baseDomain": "e3.elaraai.com",
    "hostedZoneId": "Z10452251PCGZVRQ2N81E",
    "route53RoleArn": "arn:aws:iam::064741130885:role/E3-Route53-CrossAccount"
  },
  "oidc": {
    "providerName": "EntraID",
    "clientId": "<from entra id>",
    "issuerUrl": "https://login.microsoftonline.com/f6e3d4a6-dd46-4950-ba59-d96255494980/v2.0",
    "clientSecretArn": "<from step 5>",
    "adminGroup": "<admins group UUID from entra id>"
  },
  "github": { "deployRoleArn": "arn:aws:iam::<accountId>:role/E3-GitHubActions-{EnvSuffix}" },
  "scheduling": { "defaultTimezone": "Australia/Sydney" }
}
```

### Step 8: Create ECR repo and push runner image

The platform stack references an ECR repository that must exist with a `:latest` image **before** deploying. The CDK uses `fromRepositoryName` (lookup, not create).

```bash
# Create the ECR repository
AWS_PROFILE={profile} aws ecr create-repository \
  --repository-name e3-{deploymentId}-runner --region ap-southeast-2

# Build and push the runner image (from repo root, requires Docker)
npm install && npm run build
AWS_PROFILE={profile} AWS_REGION=ap-southeast-2 E3_DEPLOYMENT_ID={deploymentId} \
  ./scripts/build-runner.sh --push
```

### Step 9: Deploy e3 platform

```bash
cd cdk/platform
AWS_PROFILE={profile} npx cdk deploy --context config={deploymentId} --require-approval never
```

> **Gotcha:** Ensure `cdk/platform/cdk.json` does NOT contain a `"deploymentId"` key in the `context` section. If present, it overrides the deployment config file and all stacks will use that ID instead. The fallback default is in `bin/e3-aws.ts`.

Verify the stack name before deploying: `npx cdk list --context config={deploymentId}` should show `E3Platform-{deploymentId}`.

This creates: Cognito user pool + OIDC integration, API Gateway + Lambda, S3 + DynamoDB storage, CloudFront + custom domain + ACM certificate, Step Functions (dataflow + GC), and uploads the web app to S3.

The deploy takes ~15 minutes on first run (ACM certificate validation is the bottleneck).

> **If the deploy fails and rolls back:** CDK retains S3 buckets, DynamoDB tables, and Cognito user pools (RETAIN policy). Before retrying, manually delete orphaned resources:
> ```bash
> aws s3 rb s3://e3-{deploymentId}-frontend-<accountId> s3://e3-{deploymentId}-data-<accountId>
> aws dynamodb delete-table --table-name e3-{deploymentId}-data
> aws cognito-idp list-user-pools --max-results 10  # then delete-user-pool for each orphan
> ```

### Step 10: Update runner Lambda (after future image rebuilds)

```bash
# From repo root
make deploy-runner CONFIG={deploymentId} PROFILE={profile}
```

This rebuilds the Docker image, pushes to ECR, and calls `update-function-code` on the Lambda. Required after east/e3 package updates.

### Step 11: Add to GitHub Actions

Add the new deployment config name to the `options` list in:
- `.github/workflows/deploy-platform.yml` — under `inputs.deployment.options`
- `.github/workflows/build-runner.yml` — under `inputs.deployment.options`

### Step 12: Add users to Entra ID groups

Add yourself and other operators to the security groups so they can log in.

**Always add Campbell Morrison** (CEO, `cmorrison@elara.ai`, object ID `b4d5949b-6d3a-4ec2-a16a-05191b81d321`) to both admin and user groups for every new environment.

```bash
# Get your own user object ID
az ad signed-in-user show --query id -o tsv

# Add to both groups (repeat for each user)
az ad group member add --group "{account}-admins" --member-id <user-object-id>
az ad group member add --group "{account}-users" --member-id <user-object-id>

# Campbell Morrison — always add to every environment
az ad group member add --group "{account}-admins" --member-id b4d5949b-6d3a-4ec2-a16a-05191b81d321
az ad group member add --group "{account}-users" --member-id b4d5949b-6d3a-4ec2-a16a-05191b81d321
```

Verify login at `https://{deploymentId}.e3.elaraai.com`.

### Existing AWS accounts

| Account | Account ID | Profile | Deployment ID |
|---------|-----------|---------|---------------|
| `elara-dev-e3` | `925445553972` | `elaraai-dev-elara-e3` | `dev` |
| `kpmg-prod-e3` | `759210286954` | `elaraai-prod-kpmg-e3` | `kpmg` |
