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

### 4. Deploy e3 Platform to the Account

```bash
# Clear the assumed role credentials
unset AWS_ACCESS_KEY_ID AWS_SECRET_ACCESS_KEY AWS_SESSION_TOKEN

# Add profile to ~/.aws/config (see AWS Profiles section), then:
aws sso login --profile elaraai-dev-elara-e3

# Deploy e3 platform
cd ../infrastructure
AWS_PROFILE=elaraai-dev-elara-e3 npm run deploy -- --context deploymentId=elara-dev-e3
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
| `lib/accounts.ts` | Account definitions, SSO config, helper functions |
| `lib/e3-accounts-stack.ts` | CDK stacks for account creation and bootstrap |
| `bin/e3-org.ts` | CDK app entry point |

## Email Configuration

Account emails use plus addressing: `devops+elara-dev-e3@elara.ai`

For Microsoft 365/Exchange Online, plus addressing must be enabled:

```powershell
Connect-ExchangeOnline
Set-OrganizationConfig -AllowPlusAddressInRecipients $true
```

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
