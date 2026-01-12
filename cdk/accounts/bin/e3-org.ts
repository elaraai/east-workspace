/**
 * Copyright (c) 2025 Elara AI Pty Ltd. All rights reserved.
 * Proprietary and confidential.
 *
 * E3 Organization CDK Application
 *
 * Creates and manages AWS accounts for e3 cloud deployments.
 *
 * Usage:
 *   # Deploy from management account (creates member accounts)
 *   aws sso login --profile management
 *   npm run deploy
 *
 *   # Bootstrap a new account (run after account creation)
 *   aws sso login --profile management
 *   # Assume OrganizationAccountAccessRole in new account, then:
 *   npm run deploy -- --context bootstrapAccount=elara-dev-e3
 *
 *   # Deploy shared infrastructure (Route53 hosted zone, cross-account access)
 *   aws sso login --profile shared-services
 *   npm run deploy -- --context shared=true
 */

import * as cdk from 'aws-cdk-lib';
import { E3AccountsStack, E3AccountBootstrapStack, E3SharedInfraStack } from '../lib/e3-accounts-stack.js';
import { derivedAccounts, orgConfig, sharedInfraConfig } from '../lib/accounts.js';

const app = new cdk.App();

// Check context flags
const bootstrapAccount = app.node.tryGetContext('bootstrapAccount');
const deployShared = app.node.tryGetContext('shared');

if (deployShared) {
  // Shared infrastructure mode: Deploy to shared services account
  new E3SharedInfraStack(app, 'E3SharedInfra', {
    env: {
      account: orgConfig.sharedServicesAccountId,
      region: orgConfig.region,
    },
    config: sharedInfraConfig,
    description: 'Shared infrastructure for e3 platform (Route53, cross-account access)',
    tags: {
      Application: 'e3',
      Component: 'shared-infrastructure',
      ManagedBy: 'CDK',
    },
  });
} else if (bootstrapAccount) {
  // Bootstrap mode: Deploy to a specific member account
  const accountConfig = derivedAccounts.find((a) => a.name === bootstrapAccount);

  if (!accountConfig) {
    throw new Error(
      `Account '${bootstrapAccount}' not found in accounts.ts. ` +
      `Available accounts: ${derivedAccounts.map((a) => a.name).join(', ')}`
    );
  }

  // This stack is deployed TO the member account
  // Requires assuming OrganizationAccountAccessRole first
  new E3AccountBootstrapStack(app, `E3Bootstrap-${bootstrapAccount}`, {
    env: {
      region: orgConfig.region,
      // Account is determined by current credentials (assumed role)
    },
    config: accountConfig,
    description: `Bootstrap stack for e3 account: ${bootstrapAccount}`,
    tags: {
      Application: 'e3',
      Environment: accountConfig.environment,
      Organization: accountConfig.organization,
      ManagedBy: 'CDK',
    },
  });
} else {
  // Normal mode: Deploy from management account to create member accounts
  new E3AccountsStack(app, 'E3Accounts', {
    env: {
      account: orgConfig.managementAccountId,
      region: orgConfig.region,
    },
    description: 'E3 cloud AWS accounts',
    tags: {
      Application: 'e3',
      Component: 'organization',
      ManagedBy: 'CDK',
    },
  });
}

app.synth();
