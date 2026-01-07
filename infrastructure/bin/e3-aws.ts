/**
 * Copyright (c) 2025 Elara AI Pty Ltd. All rights reserved.
 * Proprietary and confidential.
 *
 * E3 AWS CDK Application
 *
 * Deploys the e3 cloud platform as a single stack.
 *
 * Usage:
 *   # Deploy to current account (dev)
 *   npm run deploy
 *
 *   # Deploy with custom deployment ID
 *   npm run deploy -- --context deploymentId=acme
 *
 *   # Deploy with production settings
 *   npm run deploy -- --context deploymentId=prod \
 *     --context callbackUrls='["https://platform.elaraai.com/callback"]' \
 *     --context allowedOrigins='["https://platform.elaraai.com"]'
 */

import * as cdk from 'aws-cdk-lib';
import { E3PlatformStack } from '../lib/e3-platform-stack.js';

const app = new cdk.App();

// Configuration from context (can be overridden via --context or cdk.json)
const deploymentId = app.node.tryGetContext('deploymentId') ?? 'dev';

// Parse JSON arrays from context, or use defaults
const callbackUrlsRaw = app.node.tryGetContext('callbackUrls');
const callbackUrls = callbackUrlsRaw ? JSON.parse(callbackUrlsRaw) : [];

const allowedOriginsRaw = app.node.tryGetContext('allowedOrigins');
const allowedOrigins = allowedOriginsRaw ? JSON.parse(allowedOriginsRaw) : [];

// Environment - use CDK defaults or explicit values
const env = {
  account: process.env.CDK_DEFAULT_ACCOUNT,
  region: process.env.CDK_DEFAULT_REGION ?? 'ap-southeast-2',
};

// Create the platform stack
new E3PlatformStack(app, `E3Platform-${deploymentId}`, {
  env,
  deploymentId,
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
