/**
 * Copyright (c) 2025 Elara AI Pty Ltd. All rights reserved.
 * Proprietary and confidential.
 *
 * E3 AWS CDK Application
 *
 * Deploys the e3 cloud platform as a single stack.
 *
 * Usage:
 *   # Deploy using a deployment config file
 *   npm run deploy -- --context config=elara-dev
 *
 *   # Deploy to current account (reads domain config from SSM if available)
 *   npm run deploy -- --context deploymentId=dev
 *
 *   # Deploy with explicit domain configuration (for distribution/client deployments)
 *   npm run deploy -- --context deploymentId=acme \
 *     --context domainBaseDomain=e3.clientdomain.com \
 *     --context domainHostedZoneId=Z0XXXXXXXXXX
 *
 *   # Deploy with cross-account Route53 access (Elara setup)
 *   npm run deploy -- --context deploymentId=dev \
 *     --context domainBaseDomain=e3.elaraai.com \
 *     --context domainHostedZoneId=Z10452251PCGZVRQ2N81E \
 *     --context domainRoute53RoleArn=arn:aws:iam::064741130885:role/E3-Route53-CrossAccount
 *
 *   # Deploy without custom domain (uses CloudFront domain)
 *   npm run deploy -- --context deploymentId=dev
 */

import * as cdk from 'aws-cdk-lib';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';
import { E3PlatformStack, type DomainConfig } from '../lib/e3-platform-stack.js';

/**
 * Deployment configuration file structure.
 * See schemas/deployment.schema.json for full schema.
 */
interface DeploymentConfig {
  name: string;
  description?: string;
  aws: {
    accountId: string;
    region: string;
    profile: string;
  };
  deployment: {
    id: string;
    callbackUrls?: string[];
    allowedOrigins?: string[];
  };
  domain?: {
    baseDomain: string;
    hostedZoneId: string;
    route53RoleArn?: string;
  };
  oidc?: {
    enabled?: boolean;
    providerName: string;
    clientId: string;
    issuerUrl: string;
    clientSecretArn: string;
    adminGroup?: string;
  };
  scheduling?: {
    defaultTimezone?: string;
  };
  testUsers?: {
    enabled?: boolean;
    emailDomain?: string;
  };
  externalBuckets?: string[];
}

/**
 * Load deployment configuration from JSON file.
 * @param configName - Name of the config file (without .json extension)
 * @returns Parsed deployment configuration, or undefined if not found
 */
function loadDeploymentConfig(configName: string): DeploymentConfig | undefined {
  const __filename = fileURLToPath(import.meta.url);
  const __dirname = path.dirname(__filename);
  // At runtime, __dirname is dist/bin/, so go up 2 levels to reach cdk/platform/
  const configPath = path.join(__dirname, '..', '..', 'deployments', `${configName}.json`);

  if (!fs.existsSync(configPath)) {
    return undefined;
  }

  const content = fs.readFileSync(configPath, 'utf-8');
  return JSON.parse(content) as DeploymentConfig;
}

const app = new cdk.App();

// Try to load deployment config from file
const configName = app.node.tryGetContext('config');
const deploymentConfig = configName ? loadDeploymentConfig(configName) : undefined;

// Configuration from config file, context, or defaults
// Priority: context > config file > defaults
const deploymentId = app.node.tryGetContext('deploymentId')
  ?? deploymentConfig?.deployment.id
  ?? 'dev';

const adminGroup = app.node.tryGetContext('adminGroup')
  ?? deploymentConfig?.oidc?.adminGroup
  ?? 'e3-admins';

// Parse JSON arrays from context, or use config file, or defaults
const callbackUrlsRaw = app.node.tryGetContext('callbackUrls');
const callbackUrls = callbackUrlsRaw
  ? JSON.parse(callbackUrlsRaw)
  : deploymentConfig?.deployment.callbackUrls ?? [];

const allowedOriginsRaw = app.node.tryGetContext('allowedOrigins');
const allowedOrigins = allowedOriginsRaw
  ? JSON.parse(allowedOriginsRaw)
  : deploymentConfig?.deployment.allowedOrigins ?? [];

// Domain configuration from context or config file
// For distribution: pass these via --context to avoid SSM dependency
const domainBaseDomain = app.node.tryGetContext('domainBaseDomain')
  ?? deploymentConfig?.domain?.baseDomain;
const domainHostedZoneId = app.node.tryGetContext('domainHostedZoneId')
  ?? deploymentConfig?.domain?.hostedZoneId;
const domainRoute53RoleArn = app.node.tryGetContext('domainRoute53RoleArn')
  ?? deploymentConfig?.domain?.route53RoleArn;

let domain: DomainConfig | undefined;
if (domainBaseDomain && domainHostedZoneId) {
  domain = {
    baseDomain: domainBaseDomain,
    hostedZoneId: domainHostedZoneId,
    route53RoleArn: domainRoute53RoleArn, // Optional - only for cross-account
  };
}

// Environment - use config file, CDK defaults, or explicit values
const env = {
  account: deploymentConfig?.aws.accountId ?? process.env.CDK_DEFAULT_ACCOUNT,
  region: deploymentConfig?.aws.region ?? process.env.CDK_DEFAULT_REGION ?? 'ap-southeast-2',
};

// Test users configuration
const testUsersEnabled = app.node.tryGetContext('testUsersEnabled') === 'true'
  || deploymentConfig?.testUsers?.enabled;
const testUsersEmailDomain = app.node.tryGetContext('testUsersEmailDomain')
  ?? deploymentConfig?.testUsers?.emailDomain;

const testUsers = testUsersEnabled
  ? {
      enabled: true,
      emailDomain: testUsersEmailDomain,
    }
  : undefined;

// Forward OIDC config as context (so the stack doesn't fall back to SSM tokens)
if (deploymentConfig?.oidc && deploymentConfig.oidc.enabled !== false) {
  if (!app.node.tryGetContext('oidcEnabled')) {
    app.node.setContext('oidcEnabled', 'true');
    app.node.setContext('oidcProviderName', deploymentConfig.oidc.providerName);
    app.node.setContext('oidcClientId', deploymentConfig.oidc.clientId);
    app.node.setContext('oidcIssuerUrl', deploymentConfig.oidc.issuerUrl);
    app.node.setContext('oidcSecretArn', deploymentConfig.oidc.clientSecretArn);
  }
}

// Create the platform stack
new E3PlatformStack(app, `E3Platform-${deploymentId}`, {
  env,
  deploymentId,
  adminGroup,
  domain, // If undefined, stack will try SSM, then fall back to CloudFront domain
  callbackUrls,
  allowedOrigins,
  defaultTimezone: deploymentConfig?.scheduling?.defaultTimezone,
  testUsers,
  externalBuckets: deploymentConfig?.externalBuckets,

  // Stack-level tags
  tags: {
    Application: 'e3',
    DeploymentId: deploymentId,
    ManagedBy: 'CDK',
  },
});

app.synth();
