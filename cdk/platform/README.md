# E3 Platform

CDK infrastructure for the e3 cloud application.

## Overview

This stack deploys the complete e3 cloud platform:
- **Networking**: VPC with NAT gateway
- **Storage**: EFS (elastic throughput), DynamoDB tables
- **Auth**: Cognito User Pool with OAuth/OIDC support
- **API**: API Gateway + Lambda with JWT authorization
- **Compute**: Step Functions for dataflow orchestration
- **Frontend**: CloudFront + S3

## Deployment

```bash
# From repo root
cd cdk/platform
npm run build

# Deploy (requires AWS credentials for target account)
npx cdk deploy --context deploymentId=elara-dev-e3
```

### Stack Outputs

After deployment, note these outputs:
- `ApiEndpoint` - API Gateway URL
- `CognitoLoginUrl` - Hosted UI login URL
- `UserPoolId` - For IdP configuration
- `UserPoolClientId` - For frontend configuration

## Identity Provider Setup

The platform uses Cognito for authentication. You can configure identity providers either:
1. **Automatically via SSM** - Account-wide config, applies to all deployments
2. **Manually via Console** - Per-deployment or per-client config

### Automatic Setup (SSM Parameters)

For development environments or accounts where you want consistent SSO across all e3 deployments, configure SSM parameters once and every deployment will use them.

#### Step 1: Create App Registration in Entra ID

Follow the manual steps below (Option A, Step 1) to create an Azure AD App Registration.

#### Step 2: Store Client Secret in Secrets Manager

```bash
# Store the client secret (from App Registration)
aws secretsmanager create-secret \
  --name /e3/auth/oidc/client-secret \
  --secret-string "your-client-secret-here" \
  --region ap-southeast-2
```

Note the ARN from the output (e.g., `arn:aws:secretsmanager:ap-southeast-2:123456789:secret:/e3/auth/oidc/client-secret-AbCdEf`).

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
   - **Name**: `e3 Platform` (or `e3 Platform - {client name}` for clients)
   - **Supported account types**:
     - For single org: "Accounts in this organizational directory only"
     - For multi-tenant: "Accounts in any organizational directory"
   - **Redirect URI**:
     - Platform: `Web`
     - URI: `https://{cognito-domain}.auth.{region}.amazoncognito.com/oauth2/idpresponse`

     The Cognito domain is output as `CognitoDomain` from the CDK stack, e.g.:
     ```
     https://e3-elara-dev-e3.auth.ap-southeast-2.amazoncognito.com/oauth2/idpresponse
     ```

4. Click **Register**

5. Note the **Application (client) ID** and **Directory (tenant) ID** from the Overview page

6. Create a client secret:
   - Go to **Certificates & secrets → Client secrets → New client secret**
   - Description: `e3 Platform Cognito`
   - Expiry: Choose appropriate (e.g., 24 months)
   - Click **Add**
   - **Copy the Value immediately** (you won't see it again)

7. Configure token claims (optional but recommended):
   - Go to **Token configuration → Add optional claim**
   - Token type: `ID`
   - Claims: `email`, `given_name`, `family_name`

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
