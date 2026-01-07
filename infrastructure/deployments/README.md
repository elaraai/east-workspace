# Deployment Configurations

Each JSON file in this directory represents a deployment configuration.

## Usage

```bash
# Deploy dev (default)
npm run deploy

# Deploy prod
npm run deploy:prod

# Deploy to a client account (create a new config file first)
npm run deploy -- --context deploymentId=acme \
  --context callbackUrls='["https://acme.elaraai.com/callback"]' \
  --context allowedOrigins='["https://acme.elaraai.com"]'
```

## Configuration Options

| Option | Description | Example |
|--------|-------------|---------|
| `deploymentId` | Unique identifier for this deployment. Used in resource names. | `"dev"`, `"prod"`, `"acme"` |
| `callbackUrls` | OAuth callback URLs for Cognito (in addition to localhost) | `["https://example.com/callback"]` |
| `allowedOrigins` | CORS allowed origins (in addition to localhost) | `["https://example.com"]` |

## Creating a New Deployment

1. Copy `dev.json` to `{client-name}.json`
2. Update the configuration values
3. Deploy: `npm run deploy -- --context @./deployments/{client-name}.json`

Or use context flags directly for one-off deployments.
