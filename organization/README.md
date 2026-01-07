# E3 Organization Management

CDK project for creating and managing AWS accounts for e3 cloud deployments.

## Overview

This project creates member accounts under the Elara AWS Organization (root account: `163997153162`) for hosting e3 cloud deployments. It integrates with the existing SSO infrastructure from `elara-infra`.

## Prerequisites

1. **AWS SSO configured** - You need access to the management account via SSO
2. **Existing SSO groups** - The `Elara-AWSAdministrators-*` groups must exist
3. **Existing permission sets** - The `InfraDeployInternal*` permission sets must exist

## Quick Start

### 1. Add an Account

Edit `lib/accounts.ts`:

```typescript
export const accounts: AccountConfig[] = [
  {
    name: 'elara-dev-e3',
    email: 'devops+elara-dev-e3@elara.ai',
    environment: 'dev',
    isClient: false,
    budgetLimitUsd: 200,
    description: 'e3 cloud development and testing',
  },
  // Add your new account here
];
```

### 2. Deploy from Management Account

```bash
# Login to management account via SSO
aws sso login --profile elara-management

# Deploy (creates accounts in AWS Organizations)
cd organization
npm install
npm run build
npm run deploy
```

### 3. Bootstrap the New Account

After the account is created, bootstrap it to configure the InfraDeployRole:

```bash
# Get the new account ID from the stack outputs
aws cloudformation describe-stacks --stack-name E3Accounts \
  --query 'Stacks[0].Outputs[?contains(OutputKey, `AccountId`)].OutputValue'

# Assume the OrganizationAccountAccessRole in the new account
eval $(aws sts assume-role \
  --role-arn arn:aws:iam::NEW_ACCOUNT_ID:role/OrganizationAccountAccessRole \
  --role-session-name bootstrap \
  --query 'Credentials.[AccessKeyId,SecretAccessKey,SessionToken]' \
  --output text | \
  awk '{print "export AWS_ACCESS_KEY_ID="$1" AWS_SECRET_ACCESS_KEY="$2" AWS_SESSION_TOKEN="$3}')

# Bootstrap CDK in the new account
npx cdk bootstrap

# Deploy the bootstrap stack
npm run deploy -- --context bootstrapAccount=dev-e3
```

### 4. Deploy e3 Platform to the Account

```bash
# Clear the assumed role credentials
unset AWS_ACCESS_KEY_ID AWS_SECRET_ACCESS_KEY AWS_SESSION_TOKEN

# Login via SSO (now you can use the InfraDeployRole)
aws sso login --profile elara-dev

# Deploy e3 platform
cd ../infrastructure
npm run deploy -- --context deploymentId=dev-e3
```

## Account Lifecycle

### Creating a New Account

1. Add to `lib/accounts.ts`
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

Developers in the appropriate SSO group can assume the InfraDeployRole after the account is bootstrapped.

## AWS Profiles

Add to your `~/.aws/config`:

```ini
[profile elara-management]
sso_start_url = https://elara.awsapps.com/start
sso_region = ap-southeast-2
sso_account_id = 163997153162
sso_role_name = InfraDeployInternalProd
region = ap-southeast-2

[profile elara-dev-e3]
sso_start_url = https://elara.awsapps.com/start
sso_region = ap-southeast-2
sso_account_id = <NEW_ACCOUNT_ID>
sso_role_name = E3InternalDev-InfraDeployRole
region = ap-southeast-2
```

Then use:

```bash
aws sso login --profile elara-dev-e3
AWS_PROFILE=elara-dev-e3 npm run deploy
```

## Files

| File | Purpose |
|------|---------|
| `lib/accounts.ts` | Account definitions and SSO config |
| `lib/e3-accounts-stack.ts` | CDK stacks for account creation and bootstrap |
| `bin/e3-org.ts` | CDK app entry point |

## Troubleshooting

### "Account email already exists"

Each AWS account needs a unique email. Use the `+` alias pattern: `aws+name@elara.ai`

### "Cannot assume OrganizationAccountAccessRole"

This role is only assumable from the management account. Make sure you're logged into the management account SSO profile.

### "Stack is in ROLLBACK_COMPLETE state"

Delete the failed stack and retry:
```bash
aws cloudformation delete-stack --stack-name E3Accounts
npm run deploy
```
