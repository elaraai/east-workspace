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
 */

import * as cdk from 'aws-cdk-lib';
import { E3AccountsStack, E3AccountBootstrapStack } from '../lib/e3-accounts-stack.js';
import { derivedAccounts, orgConfig } from '../lib/accounts.js';

const app = new cdk.App();

// Check if we're bootstrapping a specific account
const bootstrapAccount = app.node.tryGetContext('bootstrapAccount');

if (bootstrapAccount) {
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
