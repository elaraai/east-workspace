/**
 * Copyright (c) 2025 Elara AI Pty Ltd. All rights reserved.
 * Proprietary and confidential.
 *
 * E3 Accounts Stack - Creates and configures AWS accounts for e3 cloud deployments.
 *
 * This stack must be deployed from the management/root account (163997153162).
 *
 * What it creates for each account in the configuration:
 * 1. AWS Organizations member account
 * 2. SSO account assignments (AdministratorAccess, ReadOnlyAccess) for the SSO group
 * 3. SSM parameters for account ID and role name
 */

import * as cdk from 'aws-cdk-lib';
import * as cloudtrail from 'aws-cdk-lib/aws-cloudtrail';
import * as guardduty from 'aws-cdk-lib/aws-guardduty';
import * as iam from 'aws-cdk-lib/aws-iam';
import * as lambda from 'aws-cdk-lib/aws-lambda';
import * as logs from 'aws-cdk-lib/aws-logs';
import * as organizations from 'aws-cdk-lib/aws-organizations';
import * as s3 from 'aws-cdk-lib/aws-s3';
import * as securityhub from 'aws-cdk-lib/aws-securityhub';
import * as sso from 'aws-cdk-lib/aws-sso';
import * as ssm from 'aws-cdk-lib/aws-ssm';
import * as cr from 'aws-cdk-lib/custom-resources';
import { Construct } from 'constructs';
import {
  derivedAccounts,
  orgConfig,
  getSsoGroupName,
  getPermissionSetName,
  getInfraDeployRoleName,
  type DerivedAccountConfig,
} from './accounts.js';

export class E3AccountsStack extends cdk.Stack {
  /**
   * Map of account name to account ID (populated after account creation).
   */
  public readonly accountIds: Map<string, string> = new Map();

  constructor(scope: Construct, id: string, props?: cdk.StackProps) {
    super(scope, id, props);

    // Validate we're deploying to the management account
    const currentAccount = cdk.Stack.of(this).account;
    if (currentAccount !== orgConfig.managementAccountId) {
      throw new Error(
        `This stack must be deployed from the management account (${orgConfig.managementAccountId}), ` +
          `but is being deployed to ${currentAccount}. ` +
          `Use: aws sso login --profile <management-account-profile>`
      );
    }

    // Look up SSO instance ARN using a custom resource
    // (CDK doesn't have a native data source for this)
    const ssoInstanceLookup = new cr.AwsCustomResource(this, 'SsoInstanceLookup', {
      onCreate: {
        service: 'SSOAdmin',
        action: 'listInstances',
        physicalResourceId: cr.PhysicalResourceId.of('sso-instance'),
      },
      policy: cr.AwsCustomResourcePolicy.fromSdkCalls({
        resources: cr.AwsCustomResourcePolicy.ANY_RESOURCE,
      }),
    });

    const ssoInstanceArn = ssoInstanceLookup.getResponseField('Instances.0.InstanceArn');
    const identityStoreId = ssoInstanceLookup.getResponseField('Instances.0.IdentityStoreId');

    // Create Lambda for looking up permission sets by name
    // (AWS SSO doesn't have a direct lookup-by-name API)
    const permissionSetLookupFn = new lambda.Function(this, 'PermissionSetLookup', {
      runtime: lambda.Runtime.NODEJS_20_X,
      handler: 'index.handler',
      timeout: cdk.Duration.seconds(30),
      code: lambda.Code.fromInline(`
const { SSOAdminClient, ListPermissionSetsCommand, DescribePermissionSetCommand } = require('@aws-sdk/client-sso-admin');

exports.handler = async (event) => {
  console.log('Event:', JSON.stringify(event, null, 2));

  const { InstanceArn, PermissionSetName } = event.ResourceProperties;
  const client = new SSOAdminClient({});

  // List all permission sets
  let nextToken;
  let allPermissionSets = [];
  do {
    const listCmd = new ListPermissionSetsCommand({ InstanceArn, NextToken: nextToken });
    const result = await client.send(listCmd);
    allPermissionSets = allPermissionSets.concat(result.PermissionSets || []);
    nextToken = result.NextToken;
  } while (nextToken);

  // Find the one with matching name
  for (const psArn of allPermissionSets) {
    const descCmd = new DescribePermissionSetCommand({ InstanceArn, PermissionSetArn: psArn });
    const psDetails = await client.send(descCmd);
    if (psDetails.PermissionSet.Name === PermissionSetName) {
      return {
        PhysicalResourceId: psArn,
        Data: { PermissionSetArn: psArn }
      };
    }
  }

  throw new Error('Permission set not found: ' + PermissionSetName);
};
      `),
    });

    permissionSetLookupFn.addToRolePolicy(
      new iam.PolicyStatement({
        actions: ['sso:ListPermissionSets', 'sso:DescribePermissionSet'],
        resources: ['*'],
      })
    );

    const permissionSetLookupProvider = new cr.Provider(this, 'PermissionSetLookupProvider', {
      onEventHandler: permissionSetLookupFn,
    });

    // Look up the AdministratorAccess and ReadOnlyAccess permission sets
    const permissionSetArns: Record<string, string> = {};
    for (const psName of ['AdministratorAccess', 'ReadOnlyAccess']) {
      const lookup = new cdk.CustomResource(this, `PermissionSet-${psName}`, {
        serviceToken: permissionSetLookupProvider.serviceToken,
        properties: {
          InstanceArn: ssoInstanceArn,
          PermissionSetName: psName,
        },
      });
      lookup.node.addDependency(ssoInstanceLookup);
      permissionSetArns[psName] = lookup.getAttString('PermissionSetArn');
    }

    // Create each account
    for (const accountConfig of derivedAccounts) {
      this.createAccount(accountConfig, ssoInstanceArn, identityStoreId, permissionSetArns);
    }

    // Output summary
    new cdk.CfnOutput(this, 'AccountCount', {
      value: derivedAccounts.length.toString(),
      description: 'Number of e3 accounts managed by this stack',
    });

    new cdk.CfnOutput(this, 'SsoInstanceArn', {
      value: ssoInstanceArn,
      description: 'SSO Instance ARN',
    });
  }

  private createAccount(
    config: DerivedAccountConfig,
    ssoInstanceArn: string,
    identityStoreId: string,
    permissionSetArns: Record<string, string>
  ): void {
    const accountName = `e3-${config.name}`;
    const roleName = getInfraDeployRoleName(config);
    const ssoGroupName = getSsoGroupName(config);

    // Create the member account
    const account = new organizations.CfnAccount(this, `Account-${config.name}`, {
      accountName,
      email: config.email,
      roleName: 'OrganizationAccountAccessRole', // Default AWS Organizations role
      tags: [
        { key: 'Application', value: 'e3' },
        { key: 'Environment', value: config.environment },
        { key: 'ManagedBy', value: 'CDK' },
        { key: 'Purpose', value: config.description ?? 'e3 cloud deployment' },
      ],
    });

    // Look up the SSO group ID
    const groupLookup = new cr.AwsCustomResource(this, `GroupLookup-${config.name}`, {
      onCreate: {
        service: 'IdentityStore',
        action: 'listGroups',
        parameters: {
          IdentityStoreId: identityStoreId,
          Filters: [
            {
              AttributePath: 'DisplayName',
              AttributeValue: ssoGroupName,
            },
          ],
        },
        physicalResourceId: cr.PhysicalResourceId.of(`group-${config.name}`),
      },
      policy: cr.AwsCustomResourcePolicy.fromSdkCalls({
        resources: cr.AwsCustomResourcePolicy.ANY_RESOURCE,
      }),
    });

    const groupId = groupLookup.getResponseField('Groups.0.GroupId');

    // Create SSO account assignments for AdministratorAccess and ReadOnlyAccess
    // This makes the account appear in the SSO portal with these roles
    for (const permissionSetName of ['AdministratorAccess', 'ReadOnlyAccess']) {
      new sso.CfnAssignment(this, `SsoAssignment-${config.name}-${permissionSetName}`, {
        instanceArn: ssoInstanceArn,
        permissionSetArn: permissionSetArns[permissionSetName],
        principalId: groupId,
        principalType: 'GROUP',
        targetId: account.attrAccountId,
        targetType: 'AWS_ACCOUNT',
      });
    }

    // Store account ID in SSM for cross-stack reference
    new ssm.StringParameter(this, `AccountId-${config.name}`, {
      parameterName: `/e3/accounts/${config.name}/account-id`,
      stringValue: account.attrAccountId,
      description: `AWS Account ID for ${accountName}`,
    });

    // Store the role name for the infrastructure deployment
    new ssm.StringParameter(this, `RoleName-${config.name}`, {
      parameterName: `/e3/accounts/${config.name}/infra-deploy-role`,
      stringValue: roleName,
      description: `Infrastructure deployment role name for ${accountName}`,
    });

    // Output account details
    new cdk.CfnOutput(this, `${config.name}-AccountId`, {
      value: account.attrAccountId,
      description: `Account ID for ${accountName}`,
    });

    new cdk.CfnOutput(this, `${config.name}-AssumeRoleArn`, {
      value: `arn:aws:iam::${account.attrAccountId}:role/${roleName}`,
      description: `Role ARN to assume for deploying to ${accountName}`,
    });

    // Track for reference
    this.accountIds.set(config.name, account.attrAccountId);
  }
}

/**
 * Stack for bootstrapping a single member account.
 *
 * This stack is deployed TO the member account (not from management account).
 * It sets up:
 * - IAM password policy (security baseline)
 * - Account alias for easy identification
 * - Alternate contacts (operations, billing, security)
 * - InfraDeployRole that trusts SSO roles from management account
 * - CloudTrail (audit logging to S3 + CloudWatch)
 * - GuardDuty (threat detection)
 * - Security Hub (security posture with CIS + AWS Foundational standards)
 * - Budget alerts
 *
 * Usage:
 *   1. Deploy E3AccountsStack from management account (creates the account)
 *   2. Assume OrganizationAccountAccessRole in the new account
 *   3. Deploy E3AccountBootstrapStack to configure the account
 *   4. Future deploys can use the InfraDeployRole via SSO
 */
export class E3AccountBootstrapStack extends cdk.Stack {
  constructor(scope: Construct, id: string, props: cdk.StackProps & { config: DerivedAccountConfig }) {
    super(scope, id, props);

    const { config } = props;
    const roleName = getInfraDeployRoleName(config);
    const permissionSetName = getPermissionSetName(config);
    const accountAlias = config.name; // e.g., "elara-dev-e3"

    // ========================================
    // IAM Password Policy (Security Baseline)
    // ========================================
    // Matches elara-infra settings for consistency
    new cr.AwsCustomResource(this, 'PasswordPolicy', {
      onCreate: {
        service: 'IAM',
        action: 'updateAccountPasswordPolicy',
        parameters: {
          AllowUsersToChangePassword: true,
          MaxPasswordAge: 90,
          MinimumPasswordLength: 8,
          PasswordReusePrevention: 24,
          RequireLowercaseCharacters: true,
          RequireNumbers: true,
          RequireSymbols: true,
          RequireUppercaseCharacters: true,
        },
        physicalResourceId: cr.PhysicalResourceId.of('password-policy'),
      },
      onUpdate: {
        service: 'IAM',
        action: 'updateAccountPasswordPolicy',
        parameters: {
          AllowUsersToChangePassword: true,
          MaxPasswordAge: 90,
          MinimumPasswordLength: 8,
          PasswordReusePrevention: 24,
          RequireLowercaseCharacters: true,
          RequireNumbers: true,
          RequireSymbols: true,
          RequireUppercaseCharacters: true,
        },
        physicalResourceId: cr.PhysicalResourceId.of('password-policy'),
      },
      policy: cr.AwsCustomResourcePolicy.fromStatements([
        new iam.PolicyStatement({
          actions: ['iam:UpdateAccountPasswordPolicy'],
          resources: ['*'],
        }),
      ]),
    });

    // ========================================
    // Account Alias
    // ========================================
    new cr.AwsCustomResource(this, 'AccountAlias', {
      onCreate: {
        service: 'IAM',
        action: 'createAccountAlias',
        parameters: {
          AccountAlias: accountAlias,
        },
        physicalResourceId: cr.PhysicalResourceId.of(accountAlias),
      },
      onDelete: {
        service: 'IAM',
        action: 'deleteAccountAlias',
        parameters: {
          AccountAlias: accountAlias,
        },
      },
      policy: cr.AwsCustomResourcePolicy.fromStatements([
        new iam.PolicyStatement({
          actions: ['iam:CreateAccountAlias', 'iam:DeleteAccountAlias'],
          resources: ['*'],
        }),
      ]),
    });

    // ========================================
    // Alternate Contacts (Operations, Billing, Security)
    // ========================================
    const alternateContactTypes = ['OPERATIONS', 'BILLING', 'SECURITY'] as const;
    for (const contactType of alternateContactTypes) {
      new cr.AwsCustomResource(this, `AlternateContact-${contactType}`, {
        onCreate: {
          service: 'Account',
          action: 'putAlternateContact',
          parameters: {
            AlternateContactType: contactType,
            Name: 'Campbell Morrison',
            Title: 'Technical Lead',
            EmailAddress: 'cmorrison@elara.ai',
            PhoneNumber: '+61458211584',
          },
          physicalResourceId: cr.PhysicalResourceId.of(`alternate-contact-${contactType}`),
        },
        onUpdate: {
          service: 'Account',
          action: 'putAlternateContact',
          parameters: {
            AlternateContactType: contactType,
            Name: 'Campbell Morrison',
            Title: 'Technical Lead',
            EmailAddress: 'cmorrison@elara.ai',
            PhoneNumber: '+61458211584',
          },
          physicalResourceId: cr.PhysicalResourceId.of(`alternate-contact-${contactType}`),
        },
        onDelete: {
          service: 'Account',
          action: 'deleteAlternateContact',
          parameters: {
            AlternateContactType: contactType,
          },
        },
        policy: cr.AwsCustomResourcePolicy.fromStatements([
          new iam.PolicyStatement({
            actions: ['account:PutAlternateContact', 'account:DeleteAlternateContact'],
            resources: ['*'],
          }),
        ]),
      });
    }

    // ========================================
    // InfraDeployRole (for CDK/infrastructure deployments)
    // ========================================
    // Create the InfraDeployRole that trusts SSO roles from management account
    const infraDeployRole = new cdk.aws_iam.Role(this, 'InfraDeployRole', {
      roleName,
      description: 'IAM Role for infrastructure deployment via SSO',
      assumedBy: new cdk.aws_iam.CompositePrincipal(
        new cdk.aws_iam.AccountPrincipal(orgConfig.managementAccountId)
      ),
    });

    // Override the trust policy to be more specific - only SSO roles can assume
    const cfnRole = infraDeployRole.node.defaultChild as cdk.aws_iam.CfnRole;
    cfnRole.assumeRolePolicyDocument = {
      Version: '2012-10-17',
      Statement: [
        {
          Effect: 'Allow',
          Principal: {
            AWS: `arn:aws:iam::${orgConfig.managementAccountId}:root`,
          },
          Action: ['sts:AssumeRole', 'sts:TagSession'],
          Condition: {
            ArnLike: {
              'aws:PrincipalArn': [
                // Trust SSO roles with the matching permission set
                `arn:aws:iam::${orgConfig.managementAccountId}:role/aws-reserved/sso.amazonaws.com/*/AWSReservedSSO_${permissionSetName}*`,
                // Trust the shared services automation role
                `arn:aws:iam::${orgConfig.sharedServicesAccountId}:user/system/GithubMachineUser`,
              ],
            },
          },
        },
      ],
    };

    // Attach AdministratorAccess for full deployment capabilities
    infraDeployRole.addManagedPolicy(
      cdk.aws_iam.ManagedPolicy.fromAwsManagedPolicyName('AdministratorAccess')
    );

    // ========================================
    // CloudTrail (Audit Logging)
    // ========================================
    // S3 bucket for CloudTrail logs with security best practices
    const cloudTrailBucket = new s3.Bucket(this, 'CloudTrailBucket', {
      bucketName: `e3-cloudtrail-${config.name}-${cdk.Stack.of(this).account}`,
      encryption: s3.BucketEncryption.S3_MANAGED,
      blockPublicAccess: s3.BlockPublicAccess.BLOCK_ALL,
      enforceSSL: true,
      versioned: true,
      lifecycleRules: [
        {
          id: 'ExpireOldLogs',
          expiration: cdk.Duration.days(365), // Keep logs for 1 year
          noncurrentVersionExpiration: cdk.Duration.days(30),
        },
      ],
      removalPolicy: cdk.RemovalPolicy.RETAIN, // Don't delete audit logs on stack deletion
    });

    // CloudWatch Log Group for CloudTrail (for real-time monitoring/alerting)
    const cloudTrailLogGroup = new logs.LogGroup(this, 'CloudTrailLogGroup', {
      logGroupName: `/e3/${config.name}/cloudtrail`,
      retention: logs.RetentionDays.ONE_YEAR,
      removalPolicy: cdk.RemovalPolicy.RETAIN,
    });

    // CloudTrail trail for all management events
    const _trail = new cloudtrail.Trail(this, 'CloudTrail', {
      trailName: `e3-${config.name}-trail`,
      bucket: cloudTrailBucket,
      sendToCloudWatchLogs: true,
      cloudWatchLogGroup: cloudTrailLogGroup,
      includeGlobalServiceEvents: true,
      isMultiRegionTrail: true,
      enableFileValidation: true, // Log file integrity validation
    });

    // ========================================
    // GuardDuty (Threat Detection)
    // ========================================
    const _guardDutyDetector = new guardduty.CfnDetector(this, 'GuardDutyDetector', {
      enable: true,
      findingPublishingFrequency: 'FIFTEEN_MINUTES',
      dataSources: {
        s3Logs: { enable: true },
        kubernetes: {
          auditLogs: { enable: true },
        },
        malwareProtection: {
          scanEc2InstanceWithFindings: {
            ebsVolumes: true,
          },
        },
      },
      tags: [
        { key: 'Application', value: 'e3' },
        { key: 'Environment', value: config.environment },
      ],
    });

    // ========================================
    // Security Hub CSPM (Security Posture Management)
    // ========================================
    // TODO: As of Jan 2026, the new unified Security Hub (with risk prioritization,
    // threat correlation, OCSF schema) is GA but has no CloudFormation resource yet.
    // Currently only CfnHub exists which enables Security Hub CSPM.
    // Monitor for AWS::SecurityHub::SecurityHub or similar resource in future CDK releases.
    // For now, enable the new Security Hub manually via console.
    // See: https://aws.amazon.com/blogs/aws/aws-security-hub-now-generally-available-with-near-real-time-analytics-and-risk-prioritization/
    const securityHubHub = new securityhub.CfnHub(this, 'SecurityHub', {
      enableDefaultStandards: false, // We'll enable specific standards
      tags: {
        Application: 'e3',
        Environment: config.environment,
      },
    });

    // Enable AWS Foundational Security Best Practices standard
    const awsFoundationalStandard = new securityhub.CfnStandard(this, 'SecurityHubAWSFoundational', {
      standardsArn: `arn:aws:securityhub:${cdk.Stack.of(this).region}::standards/aws-foundational-security-best-practices/v/1.0.0`,
    });
    awsFoundationalStandard.addDependency(securityHubHub);

    // Enable CIS AWS Foundations Benchmark (sequential to avoid rate limits)
    const cisStandard = new securityhub.CfnStandard(this, 'SecurityHubCIS', {
      standardsArn: `arn:aws:securityhub:${cdk.Stack.of(this).region}::standards/cis-aws-foundations-benchmark/v/1.4.0`,
    });
    cisStandard.addDependency(awsFoundationalStandard);

    // ========================================
    // Budget Alerts
    // ========================================
    new cdk.aws_budgets.CfnBudget(this, 'MonthlyBudget', {
      budget: {
        budgetName: 'e3-monthly-budget',
        budgetType: 'COST',
        timeUnit: 'MONTHLY',
        budgetLimit: {
          amount: config.budgetLimitUsd ?? 500,
          unit: 'USD',
        },
      },
      notificationsWithSubscribers: [
        {
          notification: {
            comparisonOperator: 'GREATER_THAN',
            threshold: 80,
            thresholdType: 'PERCENTAGE',
            notificationType: 'FORECASTED',
          },
          subscribers: [
            {
              subscriptionType: 'EMAIL',
              address: config.email,
            },
          ],
        },
      ],
    });

    // ========================================
    // Domain Configuration SSM Parameters
    // ========================================
    // These parameters enable zero-config domain setup in the e3 platform stack.
    // The platform stack will automatically look up these values.
    if (config.domain) {
      new ssm.StringParameter(this, 'DomainBaseDomain', {
        parameterName: '/e3/domain/base-domain',
        stringValue: config.domain.baseDomain,
        description: 'Base domain for e3 platform (e.g., platform.elaraai.com)',
      });

      new ssm.StringParameter(this, 'DomainHostedZoneId', {
        parameterName: '/e3/domain/hosted-zone-id',
        stringValue: config.domain.hostedZoneId,
        description: 'Route53 hosted zone ID for the base domain',
      });

      new ssm.StringParameter(this, 'DomainCertificateArn', {
        parameterName: '/e3/domain/certificate-arn',
        stringValue: config.domain.certificateArn,
        description: 'ACM wildcard certificate ARN for CloudFront',
      });
    }

    // Outputs
    new cdk.CfnOutput(this, 'InfraDeployRoleArn', {
      value: infraDeployRole.roleArn,
      description: 'Role ARN for infrastructure deployment',
    });

    if (config.domain) {
      new cdk.CfnOutput(this, 'DomainBaseDomain', {
        value: config.domain.baseDomain,
        description: 'Base domain for e3 platform',
      });
    }
  }
}
