# E3 Platform

CDK infrastructure for deploying e3 platform instances.

## Overview

The `E3PlatformStack` deploys a complete e3 platform with:

```
┌─────────────────────────────────────────────────────────────────────┐
│                        CloudFront Distribution                       │
│                    (dev.e3.elaraai.com or d123.cloudfront.net)      │
├─────────────────────────────────────────────────────────────────────┤
│  ┌─────────────┐    ┌─────────────────────────────────────────────┐ │
│  │ Static Apps │    │              API Gateway                     │ │
│  │  (S3)       │    │                                              │ │
│  │  /          │    │  /api/*  ──► Lambda (API Handler)            │ │
│  │  /index.html│    │  /.well-known/* ──► Lambda (OIDC Discovery)  │ │
│  │             │    │  /oauth2/* ──► Lambda (Device Flow)          │ │
│  └─────────────┘    │  /device ──► Lambda (Approval Page)          │ │
│                     └─────────────────────────────────────────────┘ │
└─────────────────────────────────────────────────────────────────────┘
                                        │
                    ┌───────────────────┼───────────────────┐
                    ▼                   ▼                   ▼
             ┌───────────┐       ┌─────────────┐     ┌─────────────┐
             │    S3     │       │  DynamoDB   │     │  Cognito    │
             │  (Data)   │       │  (Refs)     │     │ (User Pool) │
             │           │       │             │     │             │
             │ Packages  │       │ Repo meta   │     │ JWT tokens  │
             │ Artifacts │       │ Workspaces  │     │ Device flow │
             │ Blobs     │       │ Device codes│     │ OIDC        │
             └───────────┘       └─────────────┘     └─────────────┘
```

## Resources Created

| Resource | Name Pattern | Purpose |
|----------|--------------|---------|
| S3 Bucket | `e3-{id}-data-{account}` | Package storage, artifacts |
| DynamoDB Table | `e3-{id}-data` | Refs, metadata, executions, events |
| Cognito User Pool | `e3-{id}-users` | Authentication, JWT tokens |
| Lambda Function | `e3-{id}-api` | API request handler |
| Lambda Function | `e3-{id}-execute-task` | Task execution (Docker/ECR) |
| Lambda Functions | `e3-{id}-get-graph`, `-get-ready`, `-dispatch-task`, `-write-result`, `-mark-skipped`, `-finalize-execution` | Dataflow orchestration handlers |
| API Gateway | `e3-{id}-api` | HTTP API with JWT auth |
| Step Functions | `e3-{id}-dataflow` | Dataflow orchestration |
| Step Functions | `e3-{id}-gc` | Garbage collection |
| ECR Repository | `e3-{id}-runner` | Task execution container image |
| S3 Bucket | `e3-{id}-apps-{account}` | Static web apps |
| CloudFront | - | CDN, custom domain |
| Route53 A Record | `{id}.{baseDomain}` | DNS (if domain configured) |
| Secrets Manager | `e3-{id}-test-users` | Test user passwords (if enabled) |

## Deployment

### Prerequisites

1. **AWS Account** - Bootstrapped deployment account (via `cdk/accounts`)
2. **Build dependencies**:
   ```bash
   npm run build --workspace=@elaraai/e3-aws-api
   ```

### Deployment CLI

Deployments are managed via configuration files in `deployments/` and a CLI wrapper:

```bash
cd cdk/platform

# List available deployments
npm run deploy:list

# Show deployment details
npm run deploy:info elara-dev

# Preview changes
npm run deploy:diff elara-dev

# Deploy
aws sso login --profile elaraai-dev-elara-e3
npm run deploy:run elara-dev
```

### Creating New Deployments

Create a JSON file in `deployments/` (see `deployments/elara-dev.json` as a template):

```json
{
  "$schema": "../schemas/deployment.schema.json",
  "name": "my-deployment",
  "description": "Description of this deployment",
  "aws": {
    "accountId": "123456789012",
    "region": "ap-southeast-2",
    "profile": "my-aws-profile"
  },
  "deployment": {
    "id": "dev"
  },
  "domain": {
    "baseDomain": "e3.example.com",
    "hostedZoneId": "Z0XXXXXXXXXX"
  }
}
```

For client deployments with explicit domain config, see [accounts README](../accounts/README.md#client-deployments).

### Stack Outputs

After deployment, note these outputs:

| Output | Description |
|--------|-------------|
| `PlatformUrl` | Full URL to access the platform |
| `ApiEndpoint` | API Gateway URL |
| `CognitoLoginUrl` | Hosted UI login URL |
| `UserPoolId` | For IdP configuration |
| `UserPoolClientId` | For CLI/frontend configuration |
| `CognitoIssuer` | JWT issuer for token validation |
| `DataBucketName` | S3 bucket for data |
| `DataTableName` | DynamoDB table name |
| `TestUserSecretArn` | Secrets Manager ARN for test user passwords (if testUsers enabled) |

## Test Users (for Integration Testing)

Enable test users to automatically provision Cognito users for integration testing:

### Configuration

Add to your deployment config (`deployments/elara-dev.json`):

```json
{
  "testUsers": {
    "enabled": true,
    "emailDomain": "test.elaraai.com"  // Optional, defaults to test.elaraai.com
  }
}
```

Or via CDK context:

```bash
npx cdk deploy --context config=elara-dev --context testUsersEnabled=true
```

### What Gets Created

When `testUsers.enabled: true`:

1. **4 Cognito users** are created:
   - `owner@test.elaraai.com` - Regular user (repository owner)
   - `member@test.elaraai.com` - Regular user (repository member)
   - `outsider@test.elaraai.com` - Regular user (no repository access)
   - `admin@test.elaraai.com` - Platform admin (in `e3-admins` group)

2. **Passwords** are randomly generated (meeting Cognito policy) and stored in Secrets Manager

3. **USER_PASSWORD_AUTH** flow is enabled on the Cognito User Pool Client

### Integration Test Usage

Integration tests automatically detect test users and authenticate:

```bash
cd test/integration
AWS_PROFILE=elaraai-dev-elara-e3 npm test -- --test-name-pattern "Admin"
```

See [test/integration/README.md](../../test/integration/README.md) for details.

### Security Notes

- Test users are only created when explicitly enabled in config
- USER_PASSWORD_AUTH is only enabled when test users are enabled
- Passwords are stored in Secrets Manager (not in stack outputs)
- Test users use a distinct email domain (`test.elaraai.com`)
- Users are deleted when the stack is deleted

## SSM Parameters

These are automatically read if present:

| Parameter | Purpose |
|-----------|---------|
| `/e3/domain/base-domain` | Base domain (e.g., `e3.elaraai.com`) |
| `/e3/domain/hosted-zone-id` | Route53 hosted zone ID |
| `/e3/domain/certificate-arn` | ACM wildcard certificate ARN |
| `/e3/auth/oidc/*` | External OIDC provider config (see below)

## Identity Provider Setup

The platform uses Cognito for authentication. You can configure identity providers either:
1. **Automatically via SSM** - Account-wide config, applies to all deployments
2. **Manually via Console** - Per-deployment or per-client config

### Automatic Setup (SSM Parameters)

For development environments or accounts where you want consistent SSO across all e3 deployments, configure SSM parameters once and every deployment will use them.

#### Step 1: Create App Registration in Entra ID

Follow the manual steps below (Option A, Step 1) to create an Azure AD App Registration.

#### Step 2: Store Client Secret in AWS Secrets Manager

Store the client secret from Step 1.7 in AWS Secrets Manager. Include the Entra Secret ID
in the description for easier tracking when rotating secrets later.

```bash
aws secretsmanager create-secret \
  --name /e3/auth/oidc/client-secret \
  --description "Entra ID client secret for {account-name} (Secret ID: xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx)" \
  --secret-string "your-client-secret-value-here" \
  --region ap-southeast-2
```

Note the **ARN** from the output - you'll need it for the next step:
```json
{
    "ARN": "arn:aws:secretsmanager:ap-southeast-2:123456789:secret:/e3/auth/oidc/client-secret-AbCdEf",
    "Name": "/e3/auth/oidc/client-secret"
}
```

#### Step 3: Configure SSM Parameters

```bash
# Enable OIDC integration
aws ssm put-parameter \
  --name /e3/auth/oidc/enabled \
  --value "true" \
  --type String

# Provider name (shown on login button)
aws ssm put-parameter \
  --name /e3/auth/oidc/provider-name \
  --value "AzureAD" \
  --type String

# Azure AD App Registration client ID
aws ssm put-parameter \
  --name /e3/auth/oidc/client-id \
  --value "your-client-id-here" \
  --type String

# Azure AD issuer URL (include /v2.0)
aws ssm put-parameter \
  --name /e3/auth/oidc/issuer-url \
  --value "https://login.microsoftonline.com/your-tenant-id/v2.0" \
  --type String

# ARN to the Secrets Manager secret (from Step 2)
aws ssm put-parameter \
  --name /e3/auth/oidc/client-secret-arn \
  --value "arn:aws:secretsmanager:ap-southeast-2:123456789:secret:/e3/auth/oidc/client-secret-AbCdEf" \
  --type String
```

#### Step 4: Deploy

Now any `cdk deploy` in this account will automatically configure the OIDC provider:

```bash
npx cdk deploy --context deploymentId=elara-dev-e3
```

The stack output `OidcProviderName` confirms the provider was configured.

#### Disabling Automatic OIDC

To deploy without the SSM-configured provider:

```bash
npx cdk deploy --context deploymentId=test --context oidcEnabled=false
```

Or remove/update the SSM parameter:

```bash
aws ssm put-parameter --name /e3/auth/oidc/enabled --value "false" --type String --overwrite
```

---

### Manual Setup (AWS Console)

For client-specific IdPs or one-off configurations, add providers via the AWS Console after deployment.

### Option A: Azure AD / Entra ID (OIDC)

Use this for organizations using Microsoft 365 / Azure AD.

#### Step 1: Create App Registration in Entra ID

1. Sign in to [Entra ID Admin Center](https://entra.microsoft.com)

2. Navigate to **Applications → App registrations → New registration**

3. Configure the registration:
   - **Name**: `{account-name}` (e.g., `elara-dev-e3`)
   - **Supported account types**:
     - For single org: "Accounts in this organizational directory only"
     - For multi-tenant: "Accounts in any organizational directory" (or "Multiple organizations")
   - **Redirect URI**: Leave blank for now (we'll add it in step 6)

4. Click **Register**

5. Note these values from the **Overview** page:
   - **Application (client) ID** - e.g., `ecd3a920-ef9a-495c-b1ef-f5c8ce71304a`
   - **Directory (tenant) ID** - e.g., `f6e3d4a6-dd46-4950-ba59-d96255494980`

6. Configure **Authentication** settings:
   - Go to **Authentication → Add a platform → Web**
   - **Redirect URI**: `https://{cognito-domain}.auth.{region}.amazoncognito.com/oauth2/idpresponse`

     The Cognito domain follows the pattern `e3-{deploymentId}`, e.g.:
     ```
     https://e3-dev.auth.ap-southeast-2.amazoncognito.com/oauth2/idpresponse
     ```
   - **Front-channel logout URL** (optional but recommended):
     ```
     https://e3-dev.auth.ap-southeast-2.amazoncognito.com/logout
     ```
   - Under **Implicit grant and hybrid flows**, check: ☑️ **ID tokens**
   - Click **Configure**

7. Create a **client secret**:
   - Go to **Certificates & secrets → Client secrets → New client secret**
   - **Description**: `e3-cognito-integration`
   - **Expiry**: 24 months (or your preference)
   - Click **Add**
   - **Copy the Value immediately** (it won't be shown again)
   - Also note the **Secret ID** (useful for tracking when rotating secrets)

8. Configure **token claims**:
   - Go to **Token configuration → Add optional claim**
   - Token type: **ID**
   - Select claims: `email`, `given_name`, `family_name`
   - Click **Add**
   - When prompted "Turn on the Microsoft Graph email, profile permission?", click **Add**

9. Verify **API permissions**:
   - Go to **API permissions**
   - Ensure these delegated permissions are present: `email`, `profile`, `User.Read`
   - (The `openid` scope is implicit in OIDC flows)

#### Step 2: Configure Cognito Identity Provider

1. Open [AWS Cognito Console](https://console.aws.amazon.com/cognito)

2. Select your User Pool (e.g., `e3-elara-dev-e3-users`)

3. Go to **Sign-in experience → Federated identity provider sign-in → Add identity provider**

4. Select **OpenID Connect (OIDC)**

5. Configure the provider:
   - **Provider name**: `AzureAD` (or `AzureAD-{ClientName}` for clients)
   - **Client ID**: From Step 1.5 (Application client ID)
   - **Client secret**: From Step 1.6
   - **Authorized scopes**: `openid email profile`
   - **Issuer URL**: `https://login.microsoftonline.com/{tenant-id}/v2.0`

     Replace `{tenant-id}` with Directory (tenant) ID from Step 1.5

6. Under **Attribute mapping**, map these claims:
   | User pool attribute | OpenID Connect attribute |
   |---------------------|--------------------------|
   | `email` | `email` |
   | `name` | `name` |
   | `given_name` | `given_name` |
   | `family_name` | `family_name` |

7. Click **Add identity provider**

#### Step 3: Enable the Provider on App Client

1. In the User Pool, go to **App integration → App clients**

2. Select the app client (e.g., `e3-elara-dev-e3-web-client`)

3. Click **Edit hosted UI**

4. Under **Identity providers**, check `AzureAD` (in addition to any existing providers)

5. Click **Save changes**

#### Step 4: Test Sign-In

1. Open the Cognito Login URL from the stack outputs

2. You should see a "Continue with AzureAD" button (or similar)

3. Click it to sign in with your Microsoft account

4. After successful auth, you'll be redirected back with a Cognito JWT

### Option B: SAML 2.0 (ADFS, Okta, etc.)

Use this for organizations using ADFS or other SAML identity providers.

#### Step 1: Get IdP Metadata

Ask the client for their SAML IdP metadata. This is typically:
- A URL: `https://adfs.client.com/FederationMetadata/2007-06/FederationMetadata.xml`
- Or an XML file they provide

#### Step 2: Configure Cognito SAML Provider

1. Open [AWS Cognito Console](https://console.aws.amazon.com/cognito)

2. Select your User Pool

3. Go to **Sign-in experience → Federated identity provider sign-in → Add identity provider**

4. Select **SAML**

5. Configure the provider:
   - **Provider name**: `SAML-{ClientName}`
   - **Metadata document**: Upload file or enter URL from Step 1
   - **Provider attribute**: `email` (or as specified by client)
   - **User pool attribute**: `email`

6. Click **Add identity provider**

#### Step 3: Give Client the SP Metadata

The client needs to configure their IdP to trust Cognito. Provide them:

- **SP Entity ID / Audience URI**:
  ```
  urn:amazon:cognito:sp:{user-pool-id}
  ```

- **ACS (Assertion Consumer Service) URL**:
  ```
  https://{cognito-domain}.auth.{region}.amazoncognito.com/saml2/idpresponse
  ```

- **Sign-out URL** (optional):
  ```
  https://{cognito-domain}.auth.{region}.amazoncognito.com/saml2/logout
  ```

#### Step 4: Enable and Test

Same as OIDC Steps 3-4 above.

### Option C: Cognito Native Users (No SSO)

For testing or clients without SSO:

1. Open AWS Cognito Console → User Pool → Users

2. Click **Create user**

3. Enter email and temporary password

4. User receives email with temporary password, changes it on first login

## API Testing

### Health Check (No Auth)

```bash
curl https://{ApiEndpoint}/health
# {"status":"ok"}
```

### Whoami (Get Current User Identity)

```bash
# Get a token by signing in via hosted UI, then:
curl -H "Authorization: Bearer {id_token}" \
  https://{ApiEndpoint}/api/whoami
# Returns: {"sub":"...", "email":"...", "name":"...", "isAdmin":false}
```

### Authenticated Request

```bash
# Get a token by signing in via hosted UI, then:
curl -H "Authorization: Bearer {id_token}" \
  https://{ApiEndpoint}/repos/{tenant}/api/workspaces
```

## Troubleshooting

### "Invalid redirect_uri" from Azure AD

The redirect URI in the App Registration must exactly match:
```
https://{cognito-domain}.auth.{region}.amazoncognito.com/oauth2/idpresponse
```

### "Token validation failed"

Check that:
1. The issuer URL includes `/v2.0` for Azure AD v2 endpoints
2. The client ID in Cognito matches the App Registration
3. The `openid` scope is included

### Users can't see the SSO button

Ensure the identity provider is enabled on the App Client (Step 3 above).

## Files

| File | Purpose |
|------|---------|
| `lib/e3-platform-stack.ts` | Main stack definition |
| `bin/e3-platform.ts` | CDK app entry point |

## Related

- [CDK Overview](../README.md) - High-level infrastructure architecture
- [Accounts Setup](../accounts/README.md) - Account creation and domain configuration
- [API Package](../../packages/e3-aws-api/) - Lambda handler source code
