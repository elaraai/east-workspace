# E3 Organization Management

CDK project for creating and managing AWS accounts for e3 cloud deployments.

## Overview

This project creates member accounts under the Elara AWS Organization (root account: `163997153162`) for hosting e3 cloud deployments. It integrates with the existing SSO infrastructure from `elara-infra`.

## Prerequisites

1. **AWS SSO configured** - You need access to the management account via SSO
2. **Existing SSO groups** - The `Elara-AWSAdministrators-*` groups must exist
3. **Existing permission sets** - The `InfraDeployInternal*` permission sets must exist
4. **M365 plus addressing** - Enable in Exchange Online for email aliases (see below)

## Quick Start

### 1. Add an Account

Edit `lib/accounts.ts`:

```typescript
export const accounts: AccountConfig[] = [
  {
    organization: 'elara',    // 'elara' for internal, or client name for client accounts
    environment: 'dev',       // 'dev', 'test', or 'prod'
    budgetLimitUsd: 200,
    description: 'e3 cloud development and testing',
  },
  // Add your new account here
];
```

The following are derived automatically:
- **name**: `${organization}-${environment}-e3` → `elara-dev-e3`
- **email**: `devops+${name}@elara.ai` → `devops+elara-dev-e3@elara.ai`
- **isClient**: `organization !== 'elara'` → `false`

### 2. Deploy from Management Account

```bash
# Login to management account via SSO
aws sso login --profile elaraai-prod-management-root

# Deploy (creates accounts in AWS Organizations)
cd organization
npm install
npm run build
AWS_PROFILE=elaraai-prod-management-root npm run deploy
```

### 3. Bootstrap the New Account

After the account is created, bootstrap it to configure security baseline and InfraDeployRole:

```bash
# Get the new account ID from the stack outputs
NEW_ACCOUNT_ID=$(aws cloudformation describe-stacks --stack-name E3Accounts \
  --query 'Stacks[0].Outputs[?contains(OutputKey, `elara-dev-e3-AccountId`)].OutputValue' \
  --output text --region ap-southeast-2)
echo "New account ID: $NEW_ACCOUNT_ID"

# Assume the OrganizationAccountAccessRole in the new account
eval $(aws sts assume-role \
  --role-arn arn:aws:iam::${NEW_ACCOUNT_ID}:role/OrganizationAccountAccessRole \
  --role-session-name bootstrap \
  --query 'Credentials.[AccessKeyId,SecretAccessKey,SessionToken]' \
  --output text | \
  awk '{print "export AWS_ACCESS_KEY_ID="$1" AWS_SECRET_ACCESS_KEY="$2" AWS_SESSION_TOKEN="$3}')

# Bootstrap CDK in the new account (must specify account explicitly)
npx cdk bootstrap aws://${NEW_ACCOUNT_ID}/ap-southeast-2

# Deploy the bootstrap stack (security baseline, InfraDeployRole, etc.)
npm run deploy -- --context bootstrapAccount=elara-dev-e3
```

The bootstrap stack configures:
- IAM password policy (security baseline)
- Account alias for easy identification
- Alternate contacts (operations, billing, security)
- InfraDeployRole for CDK deployments
- CloudTrail (audit logging)
- GuardDuty (threat detection)
- Security Hub (CIS + AWS Foundational Security standards)
- Budget alerts

### 4. Configure Domain (Optional but Recommended)

See [Domain Configuration](#domain-configuration) below for setting up custom domains like `dev.e3.elaraai.com`.

### 5. Deploy e3 Platform to the Account

```bash
# Clear the assumed role credentials
unset AWS_ACCESS_KEY_ID AWS_SECRET_ACCESS_KEY AWS_SESSION_TOKEN

# Add profile to ~/.aws/config (see AWS Profiles section), then:
aws sso login --profile elaraai-dev-elara-e3

# Deploy e3 platform
cd ../platform
AWS_PROFILE=elaraai-dev-elara-e3 npm run deploy -- --context deploymentId=dev
```

## Account Lifecycle

### Creating a New Account

1. Add to `lib/accounts.ts` (just `organization` + `environment`)
2. `npm run deploy` from management account
3. Bootstrap the account (see step 3 above)
4. Deploy e3 platform to the account

### Removing an Account

AWS Organizations accounts cannot be easily deleted. Instead:

1. Remove from `lib/accounts.ts`
2. `npm run deploy` (stack will no longer manage it)
3. Manually close the account via AWS Console if needed

## SSO Integration

This project integrates with the existing elara-infra SSO setup:

| Environment | SSO Group | Permission Set | InfraDeployRole |
|-------------|-----------|----------------|-----------------|
| dev | `Elara-AWSAdministrators-InternalDev` | `InfraDeployInternalDev` | `E3InternalDev-InfraDeployRole` |
| test | `Elara-AWSAdministrators-InternalTest` | `InfraDeployInternalTest` | `E3InternalTest-InfraDeployRole` |
| prod | `Elara-AWSAdministrators-InternalProd` | `InfraDeployInternalProd` | `E3InternalProd-InfraDeployRole` |
| client prod | `Elara-AWSAdministrators-ClientProd` | `InfraDeployClientProd` | `E3ClientProd-InfraDeployRole` |

**Note:** Client accounts currently only support `prod` environment. Adding `InfraDeployClientTest`/`InfraDeployClientDev` requires changes to `elara-infra`.

Developers in the appropriate SSO group can assume the InfraDeployRole after the account is bootstrapped.

## AWS Profiles

Your existing profile for management account: `elaraai-prod-management-root`

After creating a new e3 account, add a profile to `~/.aws/config`:

```ini
[profile elaraai-dev-elara-e3]
sso_start_url = https://elara.awsapps.com/start
sso_region = ap-southeast-2
sso_account_id = <NEW_ACCOUNT_ID>
sso_role_name = AdministratorAccess
region = ap-southeast-2
```

Then use:

```bash
aws sso login --profile elaraai-dev-elara-e3
AWS_PROFILE=elaraai-dev-elara-e3 npm run deploy
```

## Files

| File | Purpose |
|------|---------|
| `lib/accounts.ts` | Account definitions, SSO config, shared infra config |
| `lib/e3-accounts-stack.ts` | CDK stacks (E3AccountsStack, E3AccountBootstrapStack, E3SharedInfraStack) |
| `bin/e3-org.ts` | CDK app entry point |

## Stacks

| Stack | Target Account | Context Flag | Purpose |
|-------|----------------|--------------|---------|
| `E3AccountsStack` | Management | (default) | Creates member accounts in AWS Organizations |
| `E3AccountBootstrapStack` | Member account | `--context bootstrapAccount=NAME` | Security baseline, InfraDeployRole, CloudTrail, etc. |
| `E3SharedInfraStack` | Shared services | `--context shared=true` | Route53 hosted zone, cross-account access |

## Email Configuration

Account emails use plus addressing: `devops+elara-dev-e3@elara.ai`

For Microsoft 365/Exchange Online, plus addressing must be enabled:

```powershell
Connect-ExchangeOnline
Set-OrganizationConfig -AllowPlusAddressInRecipients $true
```

## Domain Configuration

Custom domains enable clean URLs like `e3 login https://dev.e3.elaraai.com` instead of CloudFront's generated domains.

### Architecture Overview

```
elaraai.com (parent zone - existing)
  └── NS e3.elaraai.com → [central hosted zone nameservers]

e3.elaraai.com (central hosted zone - shared services account)
  ├── A dev.e3.elaraai.com    → CloudFront (elara-dev-e3 account)
  ├── A test.e3.elaraai.com   → CloudFront (elara-test-e3 account)
  ├── A e3.elaraai.com        → CloudFront (elara-prod-e3 account) ← apex
  └── A acme.e3.elaraai.com   → CloudFront (acme-prod-e3 account) ← client
```

**Key points:**
- Single hosted zone (`e3.elaraai.com`) in a central account (shared services)
- Each deployment account creates its own ACM certificate (certs can't be shared cross-account)
- Each deployment creates an A record pointing to its CloudFront distribution
- The platform stack reads domain config from SSM parameters (zero-config per deployment)

### One-Time Setup (Shared Services Account)

These steps are performed once to set up the central DNS infrastructure in the shared services account.

#### 1. Configure Deployment Account IDs

After creating e3 accounts with `E3AccountsStack`, add their account IDs to `lib/accounts.ts`:

```typescript
export const sharedInfraConfig = {
  baseDomain: 'e3.elaraai.com',
  deploymentAccountIds: [
    'xxxxxxxxxxxx',  // elara-dev-e3
    'xxxxxxxxxxxx',  // elara-test-e3
    'xxxxxxxxxxxx',  // elara-prod-e3
  ],
};
```

Get account IDs from the E3Accounts stack outputs:

```bash
aws cloudformation describe-stacks --stack-name E3Accounts \
  --query 'Stacks[0].Outputs[?contains(OutputKey, `AccountId`)].OutputValue' \
  --output text --region ap-southeast-2
```

#### 2. Deploy Shared Infrastructure

```bash
# Login to shared services account
aws sso login --profile elaraai-prod-shared-services

# Deploy the shared infrastructure stack
cd cdk/accounts
npm run build
AWS_PROFILE=elaraai-prod-shared-services npm run deploy -- --context shared=true
```

This creates:
- Route53 hosted zone for `e3.elaraai.com`
- Cross-account IAM role (`E3-Route53-CrossAccount`) for deployment accounts
- SSM parameters for the hosted zone ID and base domain

Note the outputs:
- **HostedZoneId** - Use this in deployment account domain config
- **NameServers** - Add these to the parent zone

#### 3. Delegate from Parent Zone

Add NS records in the parent `elaraai.com` zone pointing to the nameservers from the stack output:

```
e3.elaraai.com.  NS  ns-xxx.awsdns-xx.org.
e3.elaraai.com.  NS  ns-xxx.awsdns-xx.co.uk.
e3.elaraai.com.  NS  ns-xxx.awsdns-xx.com.
e3.elaraai.com.  NS  ns-xxx.awsdns-xx.net.
```

#### 4. Create ACM Certificates (Per Deployment Account)

Each deployment account needs its own ACM certificate in us-east-1 (for CloudFront):

```bash
# In deployment account (e.g., elara-dev-e3)
aws sso login --profile elaraai-dev-elara-e3

aws acm request-certificate \
  --domain-name "*.e3.elaraai.com" \
  --subject-alternative-names "e3.elaraai.com" \
  --validation-method DNS \
  --region us-east-1
```

Add the DNS validation CNAME to the central hosted zone (in shared services account), then wait:

```bash
aws acm wait certificate-validated \
  --certificate-arn arn:aws:acm:us-east-1:ACCOUNT:certificate/CERT_ID \
  --region us-east-1
```

### Per-Account Setup

After the central infrastructure exists, configure each deployment account:

#### 1. Create ACM Certificate

Request a wildcard certificate in us-east-1:

```bash
# In deployment account
aws acm request-certificate \
  --domain-name "*.e3.elaraai.com" \
  --subject-alternative-names "e3.elaraai.com" \
  --validation-method DNS \
  --region us-east-1

# Note the certificate ARN
```

Add the DNS validation CNAME to the central hosted zone, then wait for validation:

```bash
aws acm wait certificate-validated \
  --certificate-arn arn:aws:acm:us-east-1:ACCOUNT:certificate/CERT_ID \
  --region us-east-1
```

#### 2. Configure Domain in accounts.ts

Update `lib/accounts.ts` with the domain configuration:

```typescript
{
  organization: 'elara',
  environment: 'dev',
  budgetLimitUsd: 200,
  description: 'e3 cloud development and testing',
  domain: {
    baseDomain: 'e3.elaraai.com',
    hostedZoneId: 'Z0XXXXXXXXXXXXXXXX',  // Central hosted zone ID
    certificateArn: 'arn:aws:acm:us-east-1:DEV_ACCOUNT:certificate/CERT_ID',
  },
},
```

#### 3. Redeploy Bootstrap Stack

```bash
npm run deploy -- --context bootstrapAccount=elara-dev-e3
```

This creates SSM parameters that the platform stack reads:
- `/e3/domain/base-domain` → `e3.elaraai.com`
- `/e3/domain/hosted-zone-id` → `Z0XXXXXXXXXXXXXXXX`
- `/e3/domain/certificate-arn` → `arn:aws:acm:...`

#### 4. Deploy Platform

The platform stack automatically picks up domain config from SSM:

```bash
cd ../platform
npm run deploy -- --context deploymentId=dev
```

This creates:
- CloudFront distribution with custom domain and certificate
- Route53 A record: `dev.e3.elaraai.com` → CloudFront
- Lambda environment variable: `BASE_URL=https://dev.e3.elaraai.com`

### Domain Naming Convention

| Account | DeploymentId | Domain |
|---------|--------------|--------|
| elara-dev-e3 | `dev` | `dev.e3.elaraai.com` |
| elara-test-e3 | `test` | `test.e3.elaraai.com` |
| elara-prod-e3 | `prod` or empty | `e3.elaraai.com` (apex) |
| acme-prod-e3 | `acme` | `acme.e3.elaraai.com` |

For production, use `deploymentId=prod` for `prod.e3.elaraai.com`, or configure the platform stack to use the apex domain directly.

### Client Deployments

Clients can either:

1. **Use a subdomain of `e3.elaraai.com`** (managed by Elara)
   - Domain: `clientname.e3.elaraai.com`
   - Same setup as above

2. **Use their own domain** (managed by client)
   - Client creates hosted zone for their domain
   - Client creates ACM certificate
   - Client provides zone ID and cert ARN as stack props (not SSM)

   ```typescript
   new E3PlatformStack(app, 'E3Platform', {
     deploymentId: 'prod',
     domain: {
       baseDomain: 'e3.clientdomain.com',
       hostedZoneId: 'ZXXXXXXXXXXXXX',
       certificateArn: 'arn:aws:acm:us-east-1:...',
     },
   });
   ```

### Without Custom Domain

If domain configuration is not set, the platform uses the CloudFront-generated domain (e.g., `d1234567890.cloudfront.net`). The OIDC discovery endpoint will return URLs based on request headers.

## Troubleshooting

### "Account email already exists"

Each AWS account needs a unique email. The naming convention `devops+{name}@elara.ai` ensures uniqueness.

### "Cannot assume OrganizationAccountAccessRole"

This role is only assumable from the management account. Make sure you're logged into the management account SSO profile.

### "Stack is in ROLLBACK_COMPLETE state"

Delete the failed stack and retry:
```bash
aws cloudformation delete-stack --stack-name E3Accounts
npm run deploy
```

### "Client accounts only support 'prod' environment"

The SSO permission sets for client test/dev don't exist in elara-infra yet. Either:
- Use `prod` for client accounts
- Add `InfraDeployClientTest`/`InfraDeployClientDev` to elara-infra first
