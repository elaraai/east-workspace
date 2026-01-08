/**
 * Copyright (c) 2025 Elara AI Pty Ltd. All rights reserved.
 * Proprietary and confidential.
 *
 * Account configuration for e3 cloud deployments.
 *
 * Add new accounts to this list and redeploy the organization stack
 * to create them in AWS Organizations.
 */

export interface AccountConfig {
  /**
   * Organization this account belongs to.
   * Use 'elara' for internal accounts, or client name (e.g., 'acme') for client deployments.
   */
  organization: string;

  /**
   * Environment tier - determines SSO group and role naming.
   */
  environment: 'dev' | 'test' | 'prod';

  /**
   * Optional: Monthly budget alert threshold in USD.
   * @default 500
   */
  budgetLimitUsd?: number;

  /**
   * Optional: Description for the account.
   */
  description?: string;
}

/**
 * Derived account properties (computed from organization + environment).
 */
export interface DerivedAccountConfig extends AccountConfig {
  /** Account name: `${organization}-${environment}-e3` */
  name: string;
  /** Email: `devops+${name}@elara.ai` */
  email: string;
  /** True if organization !== 'elara' */
  isClient: boolean;
}

/**
 * Compute derived properties from base account config.
 */
export function deriveAccountConfig(config: AccountConfig): DerivedAccountConfig {
  const name = `${config.organization}-${config.environment}-e3`;
  return {
    ...config,
    name,
    email: `devops+${name}@elara.ai`,
    isClient: config.organization !== 'elara',
  };
}

/**
 * Accounts to create for e3 cloud deployments.
 *
 * To add a new account:
 * 1. Add an entry to this array
 * 2. Run: cd organization && npm run deploy
 * 3. Wait for account creation (can take a few minutes)
 * 4. Bootstrap the account (see README.md)
 * 5. Deploy e3 platform: cd ../infrastructure && npm run deploy -- --context deploymentId={name}
 */
export const accounts: AccountConfig[] = [
  {
    organization: 'elara',
    environment: 'dev',
    budgetLimitUsd: 200,
    description: 'e3 cloud development and testing',
  },
  // Uncomment to add more accounts:
  // {
  //   organization: 'elara',
  //   environment: 'test',
  //   budgetLimitUsd: 300,
  //   description: 'e3 cloud staging environment',
  // },
  // {
  //   organization: 'elara',
  //   environment: 'prod',
  //   budgetLimitUsd: 1000,
  //   description: 'e3 cloud production environment',
  // },
  // {
  //   organization: 'acme',  // Client account example
  //   environment: 'prod',   // Note: only 'prod' is supported for clients (no ClientTest/ClientDev in SSO)
  //   budgetLimitUsd: 500,
  //   description: 'ACME Corp e3 production',
  // },
];

/** Derived configs with computed name, email, isClient */
export const derivedAccounts = accounts.map(deriveAccountConfig);

/**
 * SSO configuration - matches existing elara-infra setup.
 *
 * Note: Currently only InfraDeployClientProd exists for clients.
 * InfraDeployClientTest/Dev would need to be added in elara-infra first.
 */
export const ssoConfig = {
  /**
   * SSO groups that map to environments.
   * These must already exist in AWS Identity Center.
   */
  groups: {
    internalDev: 'Elara-AWSAdministrators-InternalDev',
    internalTest: 'Elara-AWSAdministrators-InternalTest',
    internalProd: 'Elara-AWSAdministrators-InternalProd',
    clientProd: 'Elara-AWSAdministrators-ClientProd',
    // clientTest: 'Elara-AWSAdministrators-ClientTest',  // TODO: Add in elara-infra
    // clientDev: 'Elara-AWSAdministrators-ClientDev',    // TODO: Add in elara-infra
  },

  /**
   * Permission sets that map to environments.
   * These must already exist in AWS Identity Center.
   */
  permissionSets: {
    internalDev: 'InfraDeployInternalDev',
    internalTest: 'InfraDeployInternalTest',
    internalProd: 'InfraDeployInternalProd',
    clientProd: 'InfraDeployClientProd',
    // clientTest: 'InfraDeployClientTest',  // TODO: Add in elara-infra
    // clientDev: 'InfraDeployClientDev',    // TODO: Add in elara-infra
  },
};

/**
 * Get the SSO group name for an account.
 */
export function getSsoGroupName(config: DerivedAccountConfig): string {
  if (config.isClient) {
    if (config.environment !== 'prod') {
      throw new Error(
        `Client accounts only support 'prod' environment (got '${config.environment}'). ` +
          `Add InfraDeployClient${capitalize(config.environment)} to elara-infra first.`
      );
    }
    return ssoConfig.groups.clientProd;
  }
  const key = `internal${capitalize(config.environment)}` as keyof typeof ssoConfig.groups;
  return ssoConfig.groups[key];
}

/**
 * Get the permission set name for an account.
 */
export function getPermissionSetName(config: DerivedAccountConfig): string {
  if (config.isClient) {
    if (config.environment !== 'prod') {
      throw new Error(
        `Client accounts only support 'prod' environment (got '${config.environment}'). ` +
          `Add InfraDeployClient${capitalize(config.environment)} to elara-infra first.`
      );
    }
    return ssoConfig.permissionSets.clientProd;
  }
  const key = `internal${capitalize(config.environment)}` as keyof typeof ssoConfig.permissionSets;
  return ssoConfig.permissionSets[key];
}

/**
 * Get the InfraDeployRole name for an account.
 */
export function getInfraDeployRoleName(config: DerivedAccountConfig): string {
  const envSuffix = capitalize(config.environment);
  const audienceSuffix = config.isClient ? 'Client' : 'Internal';
  return `E3${audienceSuffix}${envSuffix}-InfraDeployRole`;
}

/** Capitalize first letter */
function capitalize(s: string): string {
  return s.charAt(0).toUpperCase() + s.slice(1);
}

/**
 * Organization configuration.
 */
export const orgConfig = {
  /**
   * Root/management account ID.
   */
  managementAccountId: '163997153162',

  /**
   * Region for organization operations.
   */
  region: 'ap-southeast-2',

  /**
   * Shared services account ID (for cross-account automation).
   */
  sharedServicesAccountId: '064741130885',
};
