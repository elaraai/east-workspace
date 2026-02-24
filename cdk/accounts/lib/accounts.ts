/**
 * Copyright (c) 2025 Elara AI Pty Ltd. All rights reserved.
 * Proprietary and confidential.
 *
 * Account configuration for e3 cloud deployments.
 *
 * Add new accounts to this list and redeploy the organization stack
 * to create them in AWS Organizations.
 */

/**
 * Domain configuration for e3 platform deployments.
 *
 * The ACM certificate is created automatically by the platform stack.
 * Only the hosted zone information and cross-account role are needed here.
 */
export interface DomainConfig {
  /**
   * Base domain for e3 platform deployments.
   * Subdomains will be created as {deploymentId}.{baseDomain}.
   * Example: 'e3.elaraai.com' → 'dev.e3.elaraai.com'
   */
  baseDomain: string;

  /**
   * Route53 hosted zone ID for the base domain.
   * For Elara: This is the shared services hosted zone (e3.elaraai.com).
   */
  hostedZoneId: string;

  /**
   * Optional: IAM role ARN to assume for cross-account Route53 access.
   * Required when the hosted zone is in a different account than the deployment.
   * For Elara: This is the E3-Route53-CrossAccount role in shared services.
   */
  route53RoleArn?: string;
}

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

  /**
   * Optional: Domain configuration for e3 platform.
   * If provided, SSM parameters will be created for zero-config domain setup.
   * The platform stack will automatically use these for CloudFront custom domain.
   */
  domain?: DomainConfig;
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
    domain: {
      baseDomain: 'e3.elaraai.com',
      hostedZoneId: 'Z10452251PCGZVRQ2N81E',
      route53RoleArn: 'arn:aws:iam::064741130885:role/E3-Route53-CrossAccount',
    },
  },
  {
    organization: 'kpmg',
    environment: 'prod',
    budgetLimitUsd: 200,
    description: 'KPMG e3 production',
    domain: {
      baseDomain: 'e3.elaraai.com',
      hostedZoneId: 'Z10452251PCGZVRQ2N81E',
      route53RoleArn: 'arn:aws:iam::064741130885:role/E3-Route53-CrossAccount',
    },
  },
  {
    organization: 'twe',
    environment: 'prod',
    budgetLimitUsd: 200,
    description: 'TWE e3 production',
    domain: {
      baseDomain: 'e3.elaraai.com',
      hostedZoneId: 'Z10452251PCGZVRQ2N81E',
      route53RoleArn: 'arn:aws:iam::064741130885:role/E3-Route53-CrossAccount',
    },
  },
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

  /**
   * GitHub repository for CI/CD OIDC federation.
   * Used by E3AccountBootstrapStack to scope the OIDC trust policy.
   */
  github: {
    owner: 'elaraai',
    repo: 'e3-cloud',
  },

  /**
   * Organization root ID.
   * Find with: aws organizations list-roots --query 'Roots[0].Id'
   */
  rootId: 'r-7q9n',

  /**
   * Organizational Unit ID for e3 accounts.
   * If set, uses existing OU. If undefined, creates a new "e3" OU.
   * Find with: aws organizations list-organizational-units-for-parent --parent-id r-7q9n
   */
  e3OuId: 'ou-7q9n-vdll74n9',

  /**
   * Root domain hosted zone configuration.
   * The elaraai.com zone is in the management account.
   * Used for NS delegation to e3.elaraai.com.
   */
  rootDomain: {
    /**
     * The root domain name.
     */
    domain: 'elaraai.com',

    /**
     * Route53 hosted zone ID for elaraai.com in the management account.
     * Find with: aws route53 list-hosted-zones-by-name --dns-name elaraai.com --query 'HostedZones[0].Id'
     */
    hostedZoneId: 'Z03944413S71PZFFXXBES',
  },
};

/**
 * Shared infrastructure configuration.
 *
 * This configures the central Route53 hosted zone and cross-account access
 * for e3 platform deployments. Deployed to the shared services account.
 */
export const sharedInfraConfig = {
  /**
   * Base domain for all e3 platform deployments.
   * Subdomains will be: dev.e3.elaraai.com, test.e3.elaraai.com, etc.
   */
  baseDomain: 'e3.elaraai.com',

  /**
   * Account IDs that can create Route53 records in the shared hosted zone.
   * Add account IDs here after creating them with E3AccountsStack.
   *
   * To get account IDs after deployment:
   *   aws cloudformation describe-stacks --stack-name E3Accounts \
   *     --query 'Stacks[0].Outputs[?contains(OutputKey, `AccountId`)].OutputValue' \
   *     --output text
   */
  deploymentAccountIds: [
    '925445553972',  // elara-dev-e3
    '759210286954',  // kpmg-prod-e3
    '973168821520',  // twe-prod-e3
  ] as string[],
};
