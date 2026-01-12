/**
 * Copyright (c) 2025 Elara AI Pty Ltd. All rights reserved.
 * Proprietary and confidential.
 *
 * E3 AWS CDK Application
 *
 * Deploys the e3 cloud platform as a single stack.
 *
 * Usage:
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
import { E3PlatformStack, type DomainConfig } from '../lib/e3-platform-stack.js';

const app = new cdk.App();

// Configuration from context (can be overridden via --context or cdk.json)
const deploymentId = app.node.tryGetContext('deploymentId') ?? 'dev';

// Parse JSON arrays from context, or use defaults
const callbackUrlsRaw = app.node.tryGetContext('callbackUrls');
const callbackUrls = callbackUrlsRaw ? JSON.parse(callbackUrlsRaw) : [];

const allowedOriginsRaw = app.node.tryGetContext('allowedOrigins');
const allowedOrigins = allowedOriginsRaw ? JSON.parse(allowedOriginsRaw) : [];

// Domain configuration from context (optional - if not provided, reads from SSM or uses CloudFront domain)
// For distribution: pass these via --context to avoid SSM dependency
const domainBaseDomain = app.node.tryGetContext('domainBaseDomain');
const domainHostedZoneId = app.node.tryGetContext('domainHostedZoneId');
const domainRoute53RoleArn = app.node.tryGetContext('domainRoute53RoleArn');

let domain: DomainConfig | undefined;
if (domainBaseDomain && domainHostedZoneId) {
  domain = {
    baseDomain: domainBaseDomain,
    hostedZoneId: domainHostedZoneId,
    route53RoleArn: domainRoute53RoleArn, // Optional - only for cross-account
  };
}

// Environment - use CDK defaults or explicit values
const env = {
  account: process.env.CDK_DEFAULT_ACCOUNT,
  region: process.env.CDK_DEFAULT_REGION ?? 'ap-southeast-2',
};

// Create the platform stack
new E3PlatformStack(app, `E3Platform-${deploymentId}`, {
  env,
  deploymentId,
  domain, // If undefined, stack will try SSM, then fall back to CloudFront domain
  callbackUrls,
  allowedOrigins,

  // Stack-level tags
  tags: {
    Application: 'e3',
    DeploymentId: deploymentId,
    ManagedBy: 'CDK',
  },
});

app.synth();
