/**
 * Copyright (c) 2025 Elara AI Pty Ltd. All rights reserved.
 * Proprietary and confidential.
 *
 * E3 Platform Stack - Single deployable stack for e3 cloud infrastructure.
 *
 * This consolidated stack contains all infrastructure components:
 * - Storage (S3, DynamoDB)
 * - Auth (Cognito)
 * - API (API Gateway, Lambda)
 * - Compute (Step Functions, Lambda runners)
 * - Frontend (CloudFront, S3)
 */

import * as cdk from 'aws-cdk-lib';
import * as dynamodb from 'aws-cdk-lib/aws-dynamodb';
import * as cognito from 'aws-cdk-lib/aws-cognito';
import * as iam from 'aws-cdk-lib/aws-iam';
import * as lambda from 'aws-cdk-lib/aws-lambda';
import * as nodejs from 'aws-cdk-lib/aws-lambda-nodejs';
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';
import * as apigatewayv2 from 'aws-cdk-lib/aws-apigatewayv2';
import * as apigatewayv2Authorizers from 'aws-cdk-lib/aws-apigatewayv2-authorizers';
import * as apigatewayv2Integrations from 'aws-cdk-lib/aws-apigatewayv2-integrations';
import * as sfn from 'aws-cdk-lib/aws-stepfunctions';
import * as tasks from 'aws-cdk-lib/aws-stepfunctions-tasks';
import * as s3 from 'aws-cdk-lib/aws-s3';
import * as cloudfront from 'aws-cdk-lib/aws-cloudfront';
import * as origins from 'aws-cdk-lib/aws-cloudfront-origins';
import * as acm from 'aws-cdk-lib/aws-certificatemanager';
import * as route53 from 'aws-cdk-lib/aws-route53';
import * as route53Targets from 'aws-cdk-lib/aws-route53-targets';
import * as ssm from 'aws-cdk-lib/aws-ssm';
import * as secretsmanager from 'aws-cdk-lib/aws-secretsmanager';
import * as events from 'aws-cdk-lib/aws-events';
import * as targets from 'aws-cdk-lib/aws-events-targets';
import * as ec2 from 'aws-cdk-lib/aws-ec2';
import * as ecr from 'aws-cdk-lib/aws-ecr';
import * as ecs from 'aws-cdk-lib/aws-ecs';
import * as logs from 'aws-cdk-lib/aws-logs';
import * as scheduler from 'aws-cdk-lib/aws-scheduler';
import * as sqs from 'aws-cdk-lib/aws-sqs';
import * as cloudwatch from 'aws-cdk-lib/aws-cloudwatch';
import * as s3deploy from 'aws-cdk-lib/aws-s3-deployment';
import * as cr from 'aws-cdk-lib/custom-resources';
import { Construct } from 'constructs';
import { CrossRegionCertificate } from './cross-region-certificate.js';
import { CrossAccountRoute53Record } from './cross-account-route53-record.js';
import { CognitoTestUsers } from './cognito-test-users.js';

/**
 * SSM parameter paths for optional OIDC identity provider configuration.
 * If these parameters exist in the account, the stack will automatically
 * configure an OIDC identity provider (e.g., Azure AD) for Cognito.
 */
const SSM_OIDC_PREFIX = '/e3/auth/oidc';
const SSM_OIDC_ENABLED = `${SSM_OIDC_PREFIX}/enabled`;  // 'true' to enable
const SSM_OIDC_PROVIDER_NAME = `${SSM_OIDC_PREFIX}/provider-name`;  // e.g., 'AzureAD'
const SSM_OIDC_CLIENT_ID = `${SSM_OIDC_PREFIX}/client-id`;
const SSM_OIDC_ISSUER_URL = `${SSM_OIDC_PREFIX}/issuer-url`;
const SSM_OIDC_SECRET_ARN = `${SSM_OIDC_PREFIX}/client-secret-arn`;  // ARN to Secrets Manager secret

/**
 * SSM parameter paths for domain configuration.
 * If these parameters exist, the stack will automatically configure
 * a custom domain: {deploymentId}.{baseDomain}
 *
 * For Elara accounts, these are pre-configured by E3AccountBootstrapStack.
 * For client deployments, pass domain config via props instead.
 */
const SSM_DOMAIN_PREFIX = '/e3/domain';
const SSM_DOMAIN_BASE = `${SSM_DOMAIN_PREFIX}/base-domain`;        // e.g., 'e3.elaraai.com'
const SSM_DOMAIN_HOSTED_ZONE_ID = `${SSM_DOMAIN_PREFIX}/hosted-zone-id`;
const SSM_DOMAIN_ROUTE53_ROLE_ARN = `${SSM_DOMAIN_PREFIX}/route53-role-arn`; // Optional cross-account role

/**
 * Domain configuration for custom domain setup.
 *
 * The ACM certificate is created automatically during deployment.
 * For cross-account hosted zones (e.g., Elara's shared services setup),
 * provide the route53RoleArn to allow DNS validation record creation.
 */
export interface DomainConfig {
  /**
   * Base domain for this deployment (e.g., "e3.elaraai.com").
   * The deployment will be accessible at {deploymentId}.{baseDomain}
   * (e.g., dev.e3.elaraai.com, prod.e3.elaraai.com)
   */
  baseDomain: string;

  /**
   * Route53 Hosted Zone ID for the base domain.
   * Used to create the subdomain DNS record and certificate validation.
   */
  hostedZoneId: string;

  /**
   * Optional: IAM role ARN to assume for cross-account Route53 access.
   * Required when the hosted zone is in a different AWS account.
   *
   * For Elara deployments: This is the E3-Route53-CrossAccount role in shared services.
   * For client self-hosted: Leave undefined if hosted zone is in the same account.
   */
  route53RoleArn?: string;
}

export interface E3PlatformStackProps extends cdk.StackProps {
  /**
   * Deployment identifier for resource naming (e.g., 'dev', 'prod', 'acme').
   * Used to isolate multiple deployments in the same account.
   */
  deploymentId: string;

  /**
   * Group name that grants admin access.
   * Must match the IdP group name exactly (e.g., EntraID group).
   * @default 'e3-admins'
   */
  adminGroup?: string;

  /**
   * Custom domain configuration.
   * If not provided, reads from SSM parameters (/e3/domain/*).
   * If SSM parameters not found, uses CloudFront's default domain.
   */
  domain?: DomainConfig;

  /**
   * Additional callback URLs for Cognito OAuth (beyond localhost).
   * @default []
   */
  callbackUrls?: string[];

  /**
   * Additional allowed origins for CORS.
   * @default []
   */
  allowedOrigins?: string[];

  /**
   * Default timezone for scheduled executions (IANA format).
   * Used when a schedule doesn't specify an explicit timezone.
   * @default 'UTC'
   */
  defaultTimezone?: string;

  /**
   * Test user configuration for integration testing.
   * When enabled, creates test users in Cognito with passwords stored in Secrets Manager.
   */
  testUsers?: {
    /**
     * Enable test user creation.
     * @default false
     */
    enabled: boolean;

    /**
     * Email domain for test user addresses.
     * @default 'test.elaraai.com'
     */
    emailDomain?: string;
  };

  /**
   * External S3 bucket ARNs that Lambda functions need access to.
   * Grants read/write access to the API handler and task execution roles.
   * Used for cross-account S3 access (e.g., upload buckets in workload accounts).
   * @default []
   */
  externalBuckets?: string[];
}

export class E3PlatformStack extends cdk.Stack {
  // Storage
  public readonly dataBucket: s3.Bucket;
  public readonly dataTable: dynamodb.Table;

  // Auth
  public readonly userPool: cognito.IUserPool;
  public readonly userPoolClient: cognito.IUserPoolClient;

  // API
  public readonly httpApi: apigatewayv2.HttpApi;
  public readonly apiHandler: nodejs.NodejsFunction;

  // Compute
  public readonly taskRunner: lambda.IFunction;
  public readonly taskStateMachine: sfn.IStateMachine;
  public readonly dataflowStateMachine: sfn.IStateMachine;
  public readonly gcStateMachine: sfn.IStateMachine;

  // Frontend
  public readonly appsBucket: s3.Bucket;
  public readonly distribution: cloudfront.Distribution;

  // Domain (if configured)
  public readonly platformUrl: string;
  public readonly domainName?: string;

  constructor(scope: Construct, id: string, props: E3PlatformStackProps) {
    super(scope, id, props);

    const { deploymentId } = props;
    const prefix = `e3-${deploymentId}`;

    // Compute repo root path (relative to compiled CDK code location)
    // At runtime, __dirname is dist/lib/, so we go up 4 levels to reach repo root
    const __filename = fileURLToPath(import.meta.url);
    const __dirname = path.dirname(__filename);
    const repoRoot = path.join(__dirname, '..', '..', '..', '..');

    // ============================================================
    // DOMAIN CONFIGURATION
    // ============================================================
    // Try props first, then SSM parameters, then fall back to CloudFront domain
    const hasEnvironment = this.account !== cdk.Aws.ACCOUNT_ID;

    let domainConfig: DomainConfig | undefined = props.domain;

    // If not provided via props and we have an environment, try SSM
    if (!domainConfig && hasEnvironment) {
      const ssmBaseDomain = ssm.StringParameter.valueFromLookup(this, SSM_DOMAIN_BASE);

      // SSM lookup returns 'dummy-value-for-...' during synthesis if not found
      if (ssmBaseDomain && !ssmBaseDomain.startsWith('dummy-value-for-')) {
        const ssmHostedZoneId = ssm.StringParameter.valueFromLookup(this, SSM_DOMAIN_HOSTED_ZONE_ID);
        // Route53 role is optional - only needed for cross-account setups
        let ssmRoute53RoleArn: string | undefined;
        try {
          const roleArn = ssm.StringParameter.valueFromLookup(this, SSM_DOMAIN_ROUTE53_ROLE_ARN);
          if (roleArn && !roleArn.startsWith('dummy-value-for-')) {
            ssmRoute53RoleArn = roleArn;
          }
        } catch {
          // Parameter doesn't exist - that's fine for same-account setups
        }

        domainConfig = {
          baseDomain: ssmBaseDomain,
          hostedZoneId: ssmHostedZoneId,
          route53RoleArn: ssmRoute53RoleArn,
        };
      }
    }

    // Compute the full domain name if configured
    // Format: {deploymentId}.{baseDomain} (e.g., dev.e3.elaraai.com)
    const customDomainName = domainConfig ? `${deploymentId}.${domainConfig.baseDomain}` : undefined;

    // Create ACM certificate if domain is configured
    // Certificate is created in us-east-1 (required for CloudFront)
    let certificate: acm.ICertificate | undefined;
    if (domainConfig && customDomainName) {
      const cert = new CrossRegionCertificate(this, 'DomainCertificate', {
        domainName: customDomainName,
        hostedZoneId: domainConfig.hostedZoneId,
        hostedZoneName: domainConfig.baseDomain,
        route53RoleArn: domainConfig.route53RoleArn,
        removalPolicy: cdk.RemovalPolicy.DESTROY,
      });

      certificate = acm.Certificate.fromCertificateArn(this, 'Certificate', cert.certificateArn);
    }

    // Merge default origins with custom ones
    const defaultOrigins = ['http://localhost:5173'];
    const allowedOrigins = [...defaultOrigins, ...(props.allowedOrigins ?? [])];

    // Add custom domain to allowed origins if configured
    if (customDomainName) {
      allowedOrigins.push(`https://${customDomainName}`);
    }

    const defaultCallbacks = [
      'http://localhost:5173/callback',
      'http://localhost:5173/auth/callback',
      'http://localhost:3000/oauth2/callback',
    ];
    const callbackUrls = [...defaultCallbacks, ...(props.callbackUrls ?? [])];

    // Add custom domain callback URL if configured
    if (customDomainName) {
      callbackUrls.push(`https://${customDomainName}/oauth2/callback`);
      callbackUrls.push(`https://${customDomainName}/auth/callback`);
    }

    const defaultLogouts = ['http://localhost:5173/', 'http://localhost:3000/'];
    const logoutUrls = [...defaultLogouts, ...(props.allowedOrigins?.map(o => `${o}/`) ?? [])];

    // Add custom domain logout URL if configured
    if (customDomainName) {
      logoutUrls.push(`https://${customDomainName}/`);
    }

    // ============================================================
    // STORAGE
    // ============================================================

    // S3 bucket for content-addressed objects
    // Versioning is enabled to support concurrent-safe GC via version pinning.
    // GC cleanup handles version deletion - do NOT add lifecycle rules for noncurrent versions.
    this.dataBucket = new s3.Bucket(this, 'DataBucket', {
      bucketName: `${prefix}-data-${this.account}`,
      blockPublicAccess: s3.BlockPublicAccess.BLOCK_ALL,
      encryption: s3.BucketEncryption.S3_MANAGED,
      removalPolicy: cdk.RemovalPolicy.RETAIN,
      versioned: true,
      cors: [{
        allowedOrigins: customDomainName ? [`https://${customDomainName}`] : ['*'],
        allowedMethods: [s3.HttpMethods.GET, s3.HttpMethods.PUT],
        allowedHeaders: ['Content-Type', 'Content-Length', 'x-amz-checksum-sha256'],
        maxAge: 3600,
      }],
    });

    // Single DynamoDB table for all data (packages, workspaces, executions, locks, logs)
    this.dataTable = new dynamodb.Table(this, 'DataTable', {
      tableName: `${prefix}-data`,
      partitionKey: { name: 'PK', type: dynamodb.AttributeType.STRING },
      sortKey: { name: 'SK', type: dynamodb.AttributeType.STRING },
      billingMode: dynamodb.BillingMode.PAY_PER_REQUEST,
      pointInTimeRecoverySpecification: { pointInTimeRecoveryEnabled: true },
      timeToLiveAttribute: 'ttl',
      removalPolicy: cdk.RemovalPolicy.RETAIN,
    });

    // GSI for user->repos lookup (permissions)
    this.dataTable.addGlobalSecondaryIndex({
      indexName: 'GSI1',
      partitionKey: { name: 'GSI1PK', type: dynamodb.AttributeType.STRING },
      sortKey: { name: 'GSI1SK', type: dynamodb.AttributeType.STRING },
      projectionType: dynamodb.ProjectionType.ALL,
    });

    // ============================================================
    // AUTH
    // ============================================================

    const userPool = new cognito.UserPool(this, 'UserPool', {
      userPoolName: `${prefix}-users`,
      selfSignUpEnabled: false,
      signInAliases: { email: true },
      standardAttributes: {
        email: { required: true, mutable: true },
        fullname: { required: false, mutable: true },
      },
      customAttributes: {
        // Custom attribute for IdP groups (mapped from OIDC federation)
        'groups': new cognito.StringAttribute({ mutable: true }),
      },
      passwordPolicy: {
        minLength: 12,
        requireLowercase: true,
        requireUppercase: true,
        requireDigits: true,
        requireSymbols: true,
      },
      accountRecovery: cognito.AccountRecovery.EMAIL_ONLY,
      removalPolicy: cdk.RemovalPolicy.RETAIN,
    });
    this.userPool = userPool;

    // ============================================================
    // ADMIN GROUP CONFIGURATION
    // ============================================================
    // Admin group name must match the IdP group name exactly.
    // This is passed from the deployment config or CDK context.
    const adminGroup = props.adminGroup ?? 'e3-admins';

    // ============================================================
    // ============================================================
    // COGNITO ADMIN GROUP
    // ============================================================
    // Create the admin group that the Pre-Token Generation Lambda will
    // assign users to based on their IdP group membership.
    const cognitoAdminGroup = new cognito.CfnUserPoolGroup(this, 'CognitoAdminGroup', {
      userPoolId: userPool.userPoolId,
      groupName: 'e3-admins',
      description: 'E3 platform administrators (assigned dynamically from IdP groups)',
    });

    // ============================================================
    // PRE-TOKEN GENERATION LAMBDA
    // ============================================================
    // This Lambda is triggered before Cognito generates tokens. It reads
    // IdP groups from user attributes (mapped during OIDC federation) and
    // assigns users to Cognito groups for authorization.
    const preTokenGenerationFn = new nodejs.NodejsFunction(this, 'PreTokenGenerationHandler', {
      functionName: `${prefix}-pre-token-generation`,
      runtime: lambda.Runtime.NODEJS_22_X,
      entry: path.join(repoRoot, 'packages', 'e3-aws', 'src', 'handlers', 'pre-token-generation.ts'),
      handler: 'handler',
      bundling: {
        minify: true,
        sourceMap: true,
        format: nodejs.OutputFormat.ESM,
        banner: "import { createRequire } from 'module'; const require = createRequire(import.meta.url);",
      },
      environment: {
        // IdP admin group identifier (GUID or name) - used to check IdP group membership
        ADMIN_GROUP: props.adminGroup ?? 'e3-admins',
      },
      timeout: cdk.Duration.seconds(5),
      memorySize: 128,
    });

    // Add pre-token generation V2 trigger to user pool
    // V2_0 is required for access token customization (V1_0 only supports ID token)
    // CDK's addTrigger defaults to V1_0, so we use escape hatch to set V2_0
    const cfnUserPool = userPool.node.defaultChild as cognito.CfnUserPool;
    cfnUserPool.addPropertyOverride('LambdaConfig.PreTokenGenerationConfig', {
      LambdaArn: preTokenGenerationFn.functionArn,
      LambdaVersion: 'V2_0',
    });

    // Grant Cognito permission to invoke the Lambda
    preTokenGenerationFn.addPermission('CognitoInvoke', {
      principal: new iam.ServicePrincipal('cognito-idp.amazonaws.com'),
      sourceArn: userPool.userPoolArn,
    });

    // ============================================================
    // OPTIONAL: OIDC IDENTITY PROVIDER (from SSM parameters)
    // ============================================================
    // Check if OIDC configuration exists in SSM Parameter Store.
    // If the /e3/auth/oidc/enabled parameter is 'true', configure the provider.
    // This allows account-wide SSO configuration without hardcoding in CDK.
    //
    // SSM lookups require stack environment to be configured. If not configured,
    // OIDC can still be enabled via context: --context oidcEnabled=true
    // along with other oidc* context variables.
    // Note: hasEnvironment is defined earlier in the domain configuration section.

    // Check for context-based config first (works without environment)
    const oidcEnabledContext = this.node.tryGetContext('oidcEnabled');
    const oidcProviderNameContext = this.node.tryGetContext('oidcProviderName');
    const oidcClientIdContext = this.node.tryGetContext('oidcClientId');
    const oidcIssuerUrlContext = this.node.tryGetContext('oidcIssuerUrl');
    const oidcSecretArnContext = this.node.tryGetContext('oidcSecretArn');

    let isOidcEnabled = oidcEnabledContext === 'true';
    let oidcProviderName = oidcProviderNameContext;
    let oidcClientId = oidcClientIdContext;
    let oidcIssuerUrl = oidcIssuerUrlContext;
    let oidcSecretArn = oidcSecretArnContext;

    // If not configured via context and we have an environment, try SSM
    if (!isOidcEnabled && hasEnvironment) {
      const ssmEnabled = ssm.StringParameter.valueFromLookup(this, SSM_OIDC_ENABLED);
      isOidcEnabled = ssmEnabled === 'true';

      if (isOidcEnabled) {
        oidcProviderName = ssm.StringParameter.valueFromLookup(this, SSM_OIDC_PROVIDER_NAME);
        oidcClientId = ssm.StringParameter.valueFromLookup(this, SSM_OIDC_CLIENT_ID);
        oidcIssuerUrl = ssm.StringParameter.valueFromLookup(this, SSM_OIDC_ISSUER_URL);
        oidcSecretArn = ssm.StringParameter.valueFromLookup(this, SSM_OIDC_SECRET_ARN);
      }
    }

    // Create OIDC provider if enabled (must be created before the User Pool Client)
    let oidcProvider: cognito.UserPoolIdentityProviderOidc | undefined;
    if (isOidcEnabled && oidcClientId && !oidcClientId.startsWith('dummy-value-for-')) {
      const clientSecret = secretsmanager.Secret.fromSecretCompleteArn(
        this,
        'OidcClientSecret',
        oidcSecretArn
      );

      oidcProvider = new cognito.UserPoolIdentityProviderOidc(this, 'OidcProvider', {
        userPool,
        name: oidcProviderName,
        clientId: oidcClientId,
        clientSecret: clientSecret.secretValue.unsafeUnwrap(),
        issuerUrl: oidcIssuerUrl,
        scopes: ['openid', 'email', 'profile'],
        attributeMapping: {
          email: cognito.ProviderAttribute.other('email'),
          fullname: cognito.ProviderAttribute.other('name'),
          givenName: cognito.ProviderAttribute.other('given_name'),
          familyName: cognito.ProviderAttribute.other('family_name'),
          // Map IdP groups claim to custom:groups attribute
          // EntraID sends groups in the 'groups' claim (requires token config in Azure)
          custom: {
            'custom:groups': cognito.ProviderAttribute.other('groups'),
          },
        },
      });

      new cdk.CfnOutput(this, 'OidcProviderName', {
        value: oidcProviderName,
        description: 'Configured OIDC identity provider name',
      });
    }

    // Build list of supported identity providers for the User Pool Client
    const supportedIdentityProviders: cognito.UserPoolClientIdentityProvider[] = [
      cognito.UserPoolClientIdentityProvider.COGNITO,
    ];
    if (oidcProvider) {
      supportedIdentityProviders.push(
        cognito.UserPoolClientIdentityProvider.custom(oidcProviderName)
      );
    }

    const userPoolClient = new cognito.UserPoolClient(this, 'UserPoolClient', {
      userPool,
      userPoolClientName: `${prefix}-web-client`,
      // Enable USER_PASSWORD_AUTH only when test users are enabled (for programmatic login)
      authFlows: {
        userSrp: true,
        userPassword: props.testUsers?.enabled ?? false,
      },
      oAuth: {
        flows: { authorizationCodeGrant: true },
        scopes: [
          cognito.OAuthScope.OPENID,
          cognito.OAuthScope.EMAIL,
          cognito.OAuthScope.PROFILE,
        ],
        callbackUrls,
        logoutUrls,
      },
      supportedIdentityProviders,
      generateSecret: false,
      preventUserExistenceErrors: true,
      // Token lifetime configuration
      // - Short access tokens limit exposure if compromised
      // - Long refresh tokens for CLI convenience (industry standard: 90 days)
      // - Token revocation enables rotation (old refresh tokens invalidated on use)
      accessTokenValidity: cdk.Duration.minutes(15),
      idTokenValidity: cdk.Duration.minutes(15),
      refreshTokenValidity: cdk.Duration.days(90),
      // Enable token revocation for refresh token rotation
      // When a refresh token is used, a new one is issued and the old one is invalidated
      enableTokenRevocation: true,
    });
    this.userPoolClient = userPoolClient;

    // Ensure the provider is created before the client references it
    if (oidcProvider) {
      userPoolClient.node.addDependency(oidcProvider);
    }

    // Cognito hosted UI domain (required for OAuth flows)
    // Uses Cognito-provided domain: {prefix}.auth.{region}.amazoncognito.com
    const cognitoDomain = userPool.addDomain('CognitoDomain', {
      cognitoDomain: {
        domainPrefix: prefix, // e.g., e3-elara-dev-e3
      },
    });

    // ============================================================
    // TEST USERS (Optional - for integration testing)
    // ============================================================
    // Create test users in Cognito when testUsers.enabled is true.
    // Passwords are stored in Secrets Manager for programmatic authentication.
    if (props.testUsers?.enabled) {
      const testUsers = new CognitoTestUsers(this, 'TestUsers', {
        userPool,
        emailDomain: props.testUsers.emailDomain ?? 'test.elaraai.com',
        prefix,
        adminGroup: cognitoAdminGroup,
      });

      new cdk.CfnOutput(this, 'TestUserSecretArn', {
        value: testUsers.secretArn,
        description: 'Secrets Manager ARN containing test user passwords',
      });
    }

    // ============================================================
    // API
    // ============================================================

    const awsPackagePath = path.join(repoRoot, 'packages', 'e3-aws');

    // Cognito domain URL (e.g., e3-dev.auth.ap-southeast-2.amazoncognito.com)
    const cognitoDomainUrl = `${prefix}.auth.${this.region}.amazoncognito.com`;
    const cognitoIssuer = `https://cognito-idp.${this.region}.amazonaws.com/${userPool.userPoolId}`;

    // Package import processing Lambda (invoked async by API Lambda)
    const processImportFn = new nodejs.NodejsFunction(this, 'ProcessImportFn', {
      functionName: `${prefix}-process-import`,
      runtime: lambda.Runtime.NODEJS_22_X,
      entry: path.join(awsPackagePath, 'src', 'handlers', 'transfer', 'process-import.ts'),
      handler: 'handler',
      bundling: {
        minify: true,
        sourceMap: true,
        format: nodejs.OutputFormat.ESM,
        banner: "import { createRequire } from 'module'; const require = createRequire(import.meta.url);",
      },
      timeout: cdk.Duration.minutes(15),
      memorySize: 8192,
      ephemeralStorageSize: cdk.Size.gibibytes(10),
      environment: {
        TABLE_NAME: this.dataTable.tableName,
        BUCKET_NAME: this.dataBucket.bucketName,
      },
    });
    this.dataTable.grantReadWriteData(processImportFn);
    this.dataBucket.grantReadWrite(processImportFn);

    // Mark-import-failed Lambda (Step Function error path)
    const markImportFailedFn = new nodejs.NodejsFunction(this, 'MarkImportFailedFn', {
      functionName: `${prefix}-mark-import-failed`,
      runtime: lambda.Runtime.NODEJS_22_X,
      entry: path.join(awsPackagePath, 'src', 'handlers', 'transfer', 'mark-import-failed.ts'),
      handler: 'handler',
      bundling: {
        minify: true,
        sourceMap: true,
        format: nodejs.OutputFormat.ESM,
        banner: "import { createRequire } from 'module'; const require = createRequire(import.meta.url);",
      },
      timeout: cdk.Duration.seconds(30),
      memorySize: 256,
      environment: {
        TABLE_NAME: this.dataTable.tableName,
        BUCKET_NAME: this.dataBucket.bucketName,
      },
    });
    this.dataTable.grantReadWriteData(markImportFailedFn);
    this.dataBucket.grantDelete(markImportFailedFn);

    // Import State Machine
    const processImportTask = new tasks.LambdaInvoke(this, 'ProcessImportTask', {
      lambdaFunction: processImportFn,
      outputPath: '$.Payload',
    });

    const markFailedTask = new tasks.LambdaInvoke(this, 'MarkImportFailedTask', {
      lambdaFunction: markImportFailedFn,
      outputPath: '$.Payload',
    });

    processImportTask.addCatch(
      new sfn.Pass(this, 'PrepareImportError', {
        parameters: {
          'id.$': '$$.Execution.Input.id',
          'repo.$': '$$.Execution.Input.repo',
          'error.$': '$.error',
        },
      }).next(markFailedTask).next(new sfn.Fail(this, 'ImportFailed')),
      { resultPath: '$.error' },
    );
    processImportTask.next(new sfn.Succeed(this, 'ImportComplete'));

    const importStateMachine = new sfn.StateMachine(this, 'ImportStateMachine', {
      stateMachineName: `${prefix}-import`,
      definitionBody: sfn.DefinitionBody.fromChainable(processImportTask),
      timeout: cdk.Duration.minutes(20),
    });

    this.apiHandler = new nodejs.NodejsFunction(this, 'ApiHandler', {
      functionName: `${prefix}-api`,
      runtime: lambda.Runtime.NODEJS_22_X,
      entry: path.join(awsPackagePath, 'src', 'handlers', 'api.ts'),
      handler: 'handler',
      bundling: {
        minify: true,
        sourceMap: true,
        format: nodejs.OutputFormat.ESM,
        // Shim require() for CJS dependencies using Node.js builtins
        banner: "import { createRequire } from 'module'; const require = createRequire(import.meta.url);",
      },
      timeout: cdk.Duration.seconds(30),
      memorySize: 1024,
      environment: {
        DEPLOYMENT_ID: deploymentId,
        TABLE_NAME: this.dataTable.tableName,
        BUCKET_NAME: this.dataBucket.bucketName,
        USER_POOL_ID: this.userPool.userPoolId,
        // Admin group name for authorization (must match IdP group name)
        ADMIN_GROUP: adminGroup,
        // Cognito configuration for device flow proxy
        COGNITO_DOMAIN: cognitoDomainUrl,
        COGNITO_ISSUER: cognitoIssuer,
        COGNITO_CLIENT_ID: userPoolClient.userPoolClientId,
        IMPORT_STATE_MACHINE_ARN: importStateMachine.stateMachineArn,
        // OIDC provider name (if configured) - used to skip Cognito login page
        ...(isOidcEnabled && oidcProviderName ? { OIDC_PROVIDER_NAME: oidcProviderName } : {}),
        // Base URL for the platform (used for device flow callbacks)
        // If custom domain is configured, use it; otherwise Lambda determines from request headers
        ...(customDomainName ? { BASE_URL: `https://${customDomainName}` } : {}),
        // Note: DELETE_REPO_STATE_MACHINE_ARN is added after state machine creation
      },
    });

    // Grant API Lambda permission to start the import state machine
    importStateMachine.grantStartExecution(this.apiHandler);

    this.dataTable.grantReadWriteData(this.apiHandler);
    this.dataBucket.grantReadWrite(this.apiHandler);

    // Grant permission to list users in Cognito (for lookupUserByEmail)
    this.apiHandler.addToRolePolicy(new iam.PolicyStatement({
      actions: ['cognito-idp:ListUsers'],
      resources: [userPool.userPoolArn],
    }));

    this.httpApi = new apigatewayv2.HttpApi(this, 'HttpApi', {
      apiName: `${prefix}-api`,
      corsPreflight: {
        allowOrigins: allowedOrigins,
        allowMethods: [apigatewayv2.CorsHttpMethod.ANY],
        allowHeaders: ['Authorization', 'Content-Type'],
        allowCredentials: true,
      },
    });

    // Configure stage-level throttling
    // These are account-wide limits; individual users share this capacity
    // Generous limits to accommodate dashboard batch loading (50+ datasets in parallel)
    const defaultStage = this.httpApi.defaultStage?.node.defaultChild as apigatewayv2.CfnStage;
    if (defaultStage) {
      defaultStage.addPropertyOverride('DefaultRouteSettings', {
        // Sustained request rate (requests/second)
        ThrottlingRateLimit: 500,
        // Burst capacity for sudden spikes (e.g., dashboard loading 50 datasets)
        ThrottlingBurstLimit: 1000,
        // Enable detailed CloudWatch metrics for monitoring
        DetailedMetricsEnabled: true,
      });
    }

    // JWT authorizer using Cognito User Pool
    const jwtAuthorizer = new apigatewayv2Authorizers.HttpJwtAuthorizer(
      'CognitoAuthorizer',
      `https://cognito-idp.${this.region}.amazonaws.com/${userPool.userPoolId}`,
      {
        jwtAudience: [this.userPoolClient.userPoolClientId],
        identitySource: ['$request.header.Authorization'],
      }
    );

    const apiIntegration = new apigatewayv2Integrations.HttpLambdaIntegration(
      'ApiIntegration',
      this.apiHandler
    );

    // Health check route (public, no auth required)
    this.httpApi.addRoutes({
      path: '/health',
      methods: [apigatewayv2.HttpMethod.GET],
      integration: apiIntegration,
    });

    // OIDC discovery endpoint (public, required for e3 login)
    this.httpApi.addRoutes({
      path: '/.well-known/openid-configuration',
      methods: [apigatewayv2.HttpMethod.GET],
      integration: apiIntegration,
    });

    // Device flow auth endpoints (public, no auth required)
    this.httpApi.addRoutes({
      path: '/oauth2/device_authorization',
      methods: [apigatewayv2.HttpMethod.POST],
      integration: apiIntegration,
    });

    this.httpApi.addRoutes({
      path: '/oauth2/token',
      methods: [apigatewayv2.HttpMethod.POST],
      integration: apiIntegration,
    });

    this.httpApi.addRoutes({
      path: '/oauth2/callback',
      methods: [apigatewayv2.HttpMethod.GET],
      integration: apiIntegration,
    });

    this.httpApi.addRoutes({
      path: '/device',
      methods: [apigatewayv2.HttpMethod.GET],
      integration: apiIntegration,
    });

    // Whoami endpoint (requires JWT auth)
    this.httpApi.addRoutes({
      path: '/api/whoami',
      methods: [apigatewayv2.HttpMethod.GET],
      integration: apiIntegration,
      authorizer: jwtAuthorizer,
    });

    // Repository list endpoint (public, returns empty if not authenticated)
    this.httpApi.addRoutes({
      path: '/api/repos',
      methods: [apigatewayv2.HttpMethod.GET, apigatewayv2.HttpMethod.PUT],
      integration: apiIntegration,
      authorizer: jwtAuthorizer,
    });

    // Tenant API routes (requires JWT auth)
    this.httpApi.addRoutes({
      path: '/api/repos/{repo}',
      methods: [apigatewayv2.HttpMethod.ANY],
      integration: apiIntegration,
      authorizer: jwtAuthorizer,
    });

    this.httpApi.addRoutes({
      path: '/api/repos/{repo}/{proxy+}',
      methods: [apigatewayv2.HttpMethod.ANY],
      integration: apiIntegration,
      authorizer: jwtAuthorizer,
    });

    // Admin API routes (requires JWT auth, additional admin group check in Lambda)
    this.httpApi.addRoutes({
      path: '/api/admin/{proxy+}',
      methods: [apigatewayv2.HttpMethod.ANY],
      integration: apiIntegration,
      authorizer: jwtAuthorizer,
    });

    // ============================================================
    // COMPUTE
    // ============================================================

    this.taskRunner = new lambda.Function(this, 'TaskRunner', {
      functionName: `${prefix}-task-runner`,
      runtime: lambda.Runtime.NODEJS_22_X,
      handler: 'index.handler',
      code: lambda.Code.fromInline(`
        exports.handler = async (event) => {
          console.log('Task execution:', JSON.stringify(event));
          return {
            status: 'success',
            taskHash: event.taskHash,
            outputHash: 'placeholder-hash',
          };
        };
      `),
      timeout: cdk.Duration.minutes(15),
      memorySize: 3008,
      environment: {
        DEPLOYMENT_ID: deploymentId,
        TABLE_NAME: this.dataTable.tableName,
        BUCKET_NAME: this.dataBucket.bucketName,
      },
    });

    this.dataTable.grantReadWriteData(this.taskRunner);
    this.dataBucket.grantReadWrite(this.taskRunner);

    // Task execution state machine
    const runTaskState = new tasks.LambdaInvoke(this, 'RunTask', {
      lambdaFunction: this.taskRunner,
      outputPath: '$.Payload',
    });

    this.taskStateMachine = new sfn.StateMachine(this, 'TaskStateMachine', {
      stateMachineName: `${prefix}-task-execution`,
      definitionBody: sfn.DefinitionBody.fromChainable(runTaskState),
      timeout: cdk.Duration.hours(1),
    });

    // ============================================================
    // DATAFLOW STATE MACHINE
    // ============================================================
    // Orchestrates task execution for dataflows with external state tracking
    // in DynamoDB. Supports large DAGs and handles failures gracefully.
    //
    // Flow: GetGraph -> GetReady -> [AllComplete?]
    //                   │ yes       │ no
    //                   ▼           ▼
    //               Success    DispatchTasks (Map)
    //                               │
    //                               ▼
    //                         Poll Loop (Wait -> CheckCompletion -> [AnyDone?])
    //                               │ yes
    //                               ▼
    //                         WriteResults -> [HasFailures?]
    //                                           │ yes         │ no
    //                                           ▼             ▼
    //                                      MarkSkipped    GetReady

    // All handler paths now come from the unified e3-aws package

    // Lambda: Get dependency graph from workspace
    const getGraphFn = new nodejs.NodejsFunction(this, 'GetGraphHandler', {
      functionName: `${prefix}-get-graph`,
      runtime: lambda.Runtime.NODEJS_22_X,
      entry: path.join(awsPackagePath, 'src', 'handlers', 'sfn', 'get-graph.ts'),
      handler: 'handler',
      bundling: {
        minify: true,
        sourceMap: true,
        format: nodejs.OutputFormat.ESM,
        banner: "import { createRequire } from 'module'; const require = createRequire(import.meta.url);",
      },
      timeout: cdk.Duration.seconds(60),
      memorySize: 1024,
      environment: {
        TABLE_NAME: this.dataTable.tableName,
        BUCKET_NAME: this.dataBucket.bucketName,
      },
    });
    this.dataTable.grantReadWriteData(getGraphFn);
    this.dataBucket.grantRead(getGraphFn);

    // Lambda: Get tasks ready to execute
    const getReadyFn = new nodejs.NodejsFunction(this, 'GetReadyHandler', {
      functionName: `${prefix}-get-ready`,
      runtime: lambda.Runtime.NODEJS_22_X,
      entry: path.join(awsPackagePath, 'src', 'handlers', 'sfn', 'get-ready.ts'),
      handler: 'handler',
      bundling: {
        minify: true,
        sourceMap: true,
        format: nodejs.OutputFormat.ESM,
        banner: "import { createRequire } from 'module'; const require = createRequire(import.meta.url);",
      },
      timeout: cdk.Duration.seconds(30),
      memorySize: 512,
      environment: {
        TABLE_NAME: this.dataTable.tableName,
      },
    });
    // GetReady needs write access to record events and mark tasks as event-recorded
    this.dataTable.grantReadWriteData(getReadyFn);

    // Lambda: Dispatch task (checks cache, returns task execution params if not cached)
    const dispatchTaskFn = new nodejs.NodejsFunction(this, 'DispatchTaskHandler', {
      functionName: `${prefix}-dispatch-task`,
      runtime: lambda.Runtime.NODEJS_22_X,
      entry: path.join(awsPackagePath, 'src', 'handlers', 'sfn', 'dispatch-task.ts'),
      handler: 'handler',
      bundling: {
        minify: true,
        sourceMap: true,
        format: nodejs.OutputFormat.ESM,
        banner: "import { createRequire } from 'module'; const require = createRequire(import.meta.url);",
      },
      timeout: cdk.Duration.seconds(30),
      memorySize: 512,
      environment: {
        TABLE_NAME: this.dataTable.tableName,
        BUCKET_NAME: this.dataBucket.bucketName,
      },
    });
    this.dataTable.grantReadWriteData(dispatchTaskFn);
    this.dataBucket.grantRead(dispatchTaskFn);

    // Lambda: Apply task results serially after parallel Map execution
    // This serializes execution state writes to avoid lost update race conditions
    const applyResultsFn = new nodejs.NodejsFunction(this, 'ApplyResultsHandler', {
      functionName: `${prefix}-apply-results`,
      runtime: lambda.Runtime.NODEJS_22_X,
      entry: path.join(awsPackagePath, 'src', 'handlers', 'sfn', 'apply-results.ts'),
      handler: 'handler',
      bundling: {
        minify: true,
        sourceMap: true,
        format: nodejs.OutputFormat.ESM,
        banner: "import { createRequire } from 'module'; const require = createRequire(import.meta.url);",
      },
      timeout: cdk.Duration.seconds(120),
      memorySize: 1024,
      environment: {
        TABLE_NAME: this.dataTable.tableName,
        BUCKET_NAME: this.dataBucket.bucketName,
      },
    });
    this.dataTable.grantReadWriteData(applyResultsFn);
    this.dataBucket.grantReadWrite(applyResultsFn);

    // Note: Tree updates are now applied inline by apply-results.ts using
    // stepApplyTreeUpdate with per-dataset refs (reactive dataflow).

    // Note: Mark-skipped functionality is handled by apply-results.ts
    // using stepTaskFailed + stepTasksSkipped from e3-core

    // Lambda: Finalize execution state (update status to completed/failed)
    const finalizeExecutionFn = new nodejs.NodejsFunction(this, 'FinalizeExecutionHandler', {
      functionName: `${prefix}-finalize-execution`,
      runtime: lambda.Runtime.NODEJS_22_X,
      entry: path.join(awsPackagePath, 'src', 'handlers', 'sfn', 'finalize-execution.ts'),
      handler: 'handler',
      bundling: {
        minify: true,
        sourceMap: true,
        format: nodejs.OutputFormat.ESM,
        banner: "import { createRequire } from 'module'; const require = createRequire(import.meta.url);",
      },
      timeout: cdk.Duration.seconds(30),
      memorySize: 256,
      environment: {
        TABLE_NAME: this.dataTable.tableName,
      },
    });
    this.dataTable.grantReadWriteData(finalizeExecutionFn);

    // Step Function states for dataflow
    // Note: We need to define executeTaskFn first before using it in the state machine.
    // The executeTaskFn is created after this section, so we use a forward reference pattern.

    // ECR Repository for runner container image (needed early for executeTaskFn)
    // Note: Repository must be created manually before deployment:
    //   aws ecr create-repository --repository-name e3-${deploymentId}-runner --region <region>
    // Then push the image with: ./scripts/build-runner.sh --push
    const runnerRepo = ecr.Repository.fromRepositoryName(
      this,
      'RunnerRepo',
      `${prefix}-runner`
    );

    // ECR lifecycle policy — expire untagged images after 1 day to prevent storage bloat.
    // Applied via AwsCustomResource because the repo is created manually (chicken-and-egg:
    // image must exist before Lambda, so repo is created during bootstrap before first CDK deploy).
    new cr.AwsCustomResource(this, 'RunnerRepoLifecyclePolicy', {
      onCreate: {
        service: 'ECR',
        action: 'putLifecyclePolicy',
        parameters: {
          repositoryName: `${prefix}-runner`,
          lifecyclePolicyText: JSON.stringify({
            rules: [{
              rulePriority: 1,
              description: 'Expire untagged images after 1 day',
              selection: {
                tagStatus: 'untagged',
                countType: 'sinceImagePushed',
                countUnit: 'days',
                countNumber: 1,
              },
              action: { type: 'expire' },
            }],
          }),
        },
        physicalResourceId: cr.PhysicalResourceId.of(`${prefix}-runner-lifecycle-policy`),
      },
      onUpdate: {
        service: 'ECR',
        action: 'putLifecyclePolicy',
        parameters: {
          repositoryName: `${prefix}-runner`,
          lifecyclePolicyText: JSON.stringify({
            rules: [{
              rulePriority: 1,
              description: 'Expire untagged images after 1 day',
              selection: {
                tagStatus: 'untagged',
                countType: 'sinceImagePushed',
                countUnit: 'days',
                countNumber: 1,
              },
              action: { type: 'expire' },
            }],
          }),
        },
        physicalResourceId: cr.PhysicalResourceId.of(`${prefix}-runner-lifecycle-policy`),
      },
      installLatestAwsSdk: false,
      policy: cr.AwsCustomResourcePolicy.fromSdkCalls({
        resources: cr.AwsCustomResourcePolicy.ANY_RESOURCE,
      }),
    });

    // Lambda function with container image for task execution
    // Note: Image must be pushed to ECR before deployment
    // Use scripts/build-runner.sh to build and push the image
    const executeTaskFn = new lambda.DockerImageFunction(this, 'ExecuteTaskFn', {
      functionName: `${prefix}-execute-task`,
      code: lambda.DockerImageCode.fromEcr(runnerRepo, { tagOrDigest: 'latest' }),
      memorySize: 10240, // 10GB max for Lambda
      timeout: cdk.Duration.minutes(15), // 15 min max for Lambda
      environment: {
        BUCKET_NAME: this.dataBucket.bucketName,
        TABLE_NAME: this.dataTable.tableName,
      },
    });
    this.dataBucket.grantReadWrite(executeTaskFn);
    this.dataTable.grantReadWriteData(executeTaskFn);

    // Grant task execution access to external S3 buckets (cross-account)
    if (props.externalBuckets && props.externalBuckets.length > 0) {
      const externalS3Policy = new iam.PolicyStatement({
        actions: ['s3:GetObject', 's3:PutObject', 's3:ListBucket', 's3:DeleteObject'],
        resources: props.externalBuckets.flatMap(arn => [arn, `${arn}/*`]),
      });
      executeTaskFn.addToRolePolicy(externalS3Policy);
    }

    // Outputs for execute-task Lambda
    new cdk.CfnOutput(this, 'RunnerRepoUri', {
      value: runnerRepo.repositoryUri,
      description: 'ECR repository URI for runner image',
    });

    new cdk.CfnOutput(this, 'ExecuteTaskFnArn', {
      value: executeTaskFn.functionArn,
      description: 'Execute task Lambda function ARN',
    });

    // SOCI Index Builder — auto-generates Seekable OCI indexes on ECR push
    // for lazy container loading, reducing Fargate cold starts by ~50-60%
    new cdk.CfnStack(this, 'SociIndexBuilder', {
      templateUrl: `https://aws-ia-${this.region}.s3.${this.region}.amazonaws.com/cfn-ecr-aws-soci-index-builder/templates/SociIndexBuilder.yml`,
      parameters: {
        SociRepositoryImageTagFilters: `${prefix}-runner:*`,
      },
    });

    // ============================================================
    // FARGATE COMPUTE INFRASTRUCTURE
    // ============================================================
    // Sized compute execution for tasks configured as small/medium/large/xlarge.
    // Uses ECS Fargate with per-size task definitions.

    // VPC — public subnets only, no NAT (tasks pull from ECR/S3 via internet)
    const computeVpc = new ec2.Vpc(this, 'ComputeVpc', {
      vpcName: `${prefix}-compute`,
      maxAzs: 2,
      natGateways: 0,
      subnetConfiguration: [{
        name: 'Public',
        subnetType: ec2.SubnetType.PUBLIC,
        cidrMask: 24,
      }],
    });

    // Security group — no inbound, all outbound
    const computeTaskSg = new ec2.SecurityGroup(this, 'ComputeTaskSg', {
      vpc: computeVpc,
      description: 'e3 compute tasks - no inbound, all outbound',
      allowAllOutbound: true,
    });

    // ECS Cluster
    const computeCluster = new ecs.Cluster(this, 'ComputeCluster', {
      clusterName: `${prefix}-compute`,
      vpc: computeVpc,
    });

    // Shared log group for all compute task sizes
    const computeLogGroup = new logs.LogGroup(this, 'ComputeTaskLogs', {
      logGroupName: `/e3/${prefix}/compute-tasks`,
      retention: logs.RetentionDays.TWO_WEEKS,
      removalPolicy: cdk.RemovalPolicy.DESTROY,
    });

    // Helper to create a Fargate task definition for a given size
    const createComputeTaskDef = (id: string, cpu: number, memoryMiB: number, storageGiB: number) => {
      const taskDef = new ecs.FargateTaskDefinition(this, `ComputeTaskDef${id}`, {
        family: `${prefix}-compute-${id.toLowerCase()}`,
        cpu,
        memoryLimitMiB: memoryMiB,
        ephemeralStorageGiB: storageGiB,
        runtimePlatform: {
          cpuArchitecture: ecs.CpuArchitecture.X86_64,
          operatingSystemFamily: ecs.OperatingSystemFamily.LINUX,
        },
      });
      this.dataBucket.grantReadWrite(taskDef.taskRole);
      this.dataTable.grantReadWriteData(taskDef.taskRole);
      // Grant Fargate tasks access to external S3 buckets (cross-account)
      if (props.externalBuckets && props.externalBuckets.length > 0) {
        taskDef.taskRole.addToPrincipalPolicy(new iam.PolicyStatement({
          actions: ['s3:GetObject', 's3:PutObject', 's3:ListBucket', 's3:DeleteObject'],
          resources: props.externalBuckets.flatMap(arn => [arn, `${arn}/*`]),
        }));
      }
      taskDef.taskRole.addToPrincipalPolicy(new iam.PolicyStatement({
        actions: ['states:SendTaskSuccess', 'states:SendTaskFailure'],
        resources: ['*'],  // Task tokens are self-scoping
      }));
      const container = taskDef.addContainer('runner', {
        image: ecs.ContainerImage.fromEcrRepository(runnerRepo, 'latest'),
        logging: ecs.LogDrivers.awsLogs({ logGroup: computeLogGroup, streamPrefix: `task-${id.toLowerCase()}` }),
        environment: { BUCKET_NAME: this.dataBucket.bucketName, TABLE_NAME: this.dataTable.tableName },
        entryPoint: ['node'],
        command: ['dist/src/handlers/fargate/main.js'],
      });
      return { taskDef, container };
    };

    const computeSmall = createComputeTaskDef('Small', 2048, 8192, 30);
    const computeMedium = createComputeTaskDef('Medium', 4096, 16384, 30);
    const computeLarge = createComputeTaskDef('Large', 8192, 32768, 50);
    const computeXLarge = createComputeTaskDef('XLarge', 16384, 65536, 100);

    // EventBridge rule: detect Fargate container crashes and notify Step Functions
    const onTaskStoppedFn = new nodejs.NodejsFunction(this, 'OnTaskStoppedHandler', {
      functionName: `${prefix}-on-task-stopped`,
      runtime: lambda.Runtime.NODEJS_22_X,
      entry: path.join(awsPackagePath, 'src', 'handlers', 'fargate', 'on-task-stopped.ts'),
      handler: 'handler',
      bundling: {
        minify: true,
        sourceMap: true,
        format: nodejs.OutputFormat.ESM,
        banner: "import { createRequire } from 'module'; const require = createRequire(import.meta.url);",
      },
      timeout: cdk.Duration.seconds(10),
      memorySize: 128,
      environment: {},
    });

    onTaskStoppedFn.addToRolePolicy(new iam.PolicyStatement({
      actions: ['states:SendTaskSuccess', 'states:SendTaskFailure'],
      resources: ['*'],
    }));

    new events.Rule(this, 'ComputeTaskStoppedRule', {
      ruleName: `${prefix}-compute-task-stopped`,
      eventPattern: {
        source: ['aws.ecs'],
        detailType: ['ECS Task State Change'],
        detail: {
          clusterArn: [computeCluster.clusterArn],
          lastStatus: ['STOPPED'],
        },
      },
      targets: [new targets.LambdaFunction(onTaskStoppedFn)],
    });

    // Collect-compute-result Lambda — reads result from DynamoDB after Fargate completes
    const collectComputeResultFn = new nodejs.NodejsFunction(this, 'CollectComputeResultHandler', {
      functionName: `${prefix}-collect-compute-result`,
      runtime: lambda.Runtime.NODEJS_22_X,
      entry: path.join(awsPackagePath, 'src', 'handlers', 'sfn', 'collect-compute-result.ts'),
      handler: 'handler',
      bundling: {
        minify: true,
        sourceMap: true,
        format: nodejs.OutputFormat.ESM,
        banner: "import { createRequire } from 'module'; const require = createRequire(import.meta.url);",
      },
      timeout: cdk.Duration.seconds(30),
      memorySize: 256,
      environment: {
        TABLE_NAME: this.dataTable.tableName,
      },
    });
    this.dataTable.grantReadWriteData(collectComputeResultFn);

    // Now define the dataflow state machine states
    const getGraphState = new tasks.LambdaInvoke(this, 'GetGraphState', {
      lambdaFunction: getGraphFn,
      outputPath: '$.Payload',
      retryOnServiceExceptions: true,
    });

    const getReadyState = new tasks.LambdaInvoke(this, 'GetReadyState', {
      lambdaFunction: getReadyFn,
      // Merge GetReady result with existing state (preserves graph from GetGraph)
      resultPath: '$.readyResult',
      retryOnServiceExceptions: true,
    });

    // Terminal states
    const dataflowSuccess = new sfn.Succeed(this, 'DataflowSuccess', {
      comment: 'Dataflow completed successfully',
    });

    const dataflowFailed = new sfn.Fail(this, 'DataflowFailed', {
      error: 'DataflowFailed',
      cause: 'One or more tasks failed during execution',
    });

    // Finalize states - update execution state in DynamoDB before terminal states
    // Finalize only sets status and completedAt - counts are already set by apply-results
    const prepareFinalizeSuccess = new sfn.Pass(this, 'PrepareFinalizeSuccess', {
      parameters: {
        'repo.$': '$.repo',
        'workspace.$': '$.workspace',
        'executionId.$': '$.executionId',
        'runId.$': '$.runId',
        'status': 'completed',
      },
    });

    const prepareFinalizeFailure = new sfn.Pass(this, 'PrepareFinalizeFailure', {
      parameters: {
        'repo.$': '$.repo',
        'workspace.$': '$.workspace',
        'executionId.$': '$.executionId',
        'runId.$': '$.runId',
        'status': 'failed',
      },
    });

    // Safety net: if any handler throws after retries, ensure lock is released
    // by routing to the failure finalization path
    getGraphState.addCatch(prepareFinalizeFailure, { resultPath: '$.error' });
    getReadyState.addCatch(prepareFinalizeFailure, { resultPath: '$.error' });

    const _finalizeExecutionState = new tasks.LambdaInvoke(this, 'FinalizeExecutionState', {
      lambdaFunction: finalizeExecutionFn,
      outputPath: '$.Payload',
      retryOnServiceExceptions: true,
    });

    // Wire finalize -> terminal states
    // For success path
    const finalizeSuccessState = new tasks.LambdaInvoke(this, 'FinalizeSuccessState', {
      lambdaFunction: finalizeExecutionFn,
      outputPath: '$.Payload',
      retryOnServiceExceptions: true,
    });
    prepareFinalizeSuccess.next(finalizeSuccessState);
    finalizeSuccessState.next(dataflowSuccess);

    // For failure path
    const finalizeFailureState = new tasks.LambdaInvoke(this, 'FinalizeFailureState', {
      lambdaFunction: finalizeExecutionFn,
      outputPath: '$.Payload',
      retryOnServiceExceptions: true,
    });
    prepareFinalizeFailure.next(finalizeFailureState);
    finalizeFailureState.next(dataflowFailed);

    // States for task execution within the Map iterator
    // Each state needs to preserve the context (repo, workspace, executionId) through the chain

    // DispatchTask: checks cache, resolves input hashes, returns task params or cached result
    // Merge result into $.dispatch to preserve context
    const dispatchTaskState = new tasks.LambdaInvoke(this, 'DispatchTaskState', {
      lambdaFunction: dispatchTaskFn,
      resultPath: '$.dispatch',
      retryOnServiceExceptions: true,
    });

    // Skip state for tasks that aren't ready yet (race condition between task completion and workspace update)
    const skipNotReadyState = new sfn.Pass(this, 'SkipNotReady', {
      parameters: {
        'skipped': true,
        'taskName.$': '$.dispatch.Payload.taskName',
        'status': 'not_ready',
      },
    });

    // Flatten dispatch result while preserving context
    // Note: outputHash only exists for cached results, not for ready tasks
    const prepareExecutionState = new sfn.Pass(this, 'PrepareExecution', {
      parameters: {
        'repo.$': '$.repo',
        'workspace.$': '$.workspace',
        'executionId.$': '$.executionId',
        'runId.$': '$.runId',
        'taskName.$': '$.dispatch.Payload.taskName',
        'status.$': '$.dispatch.Payload.status',
        'taskHash.$': '$.dispatch.Payload.taskHash',
        'inputHashes.$': '$.dispatch.Payload.inputHashes',
        'outputPath.$': '$.dispatch.Payload.outputPath',
        'taskExecutionId.$': '$.dispatch.Payload.taskExecutionId',
        'cached.$': '$.dispatch.Payload.cached',
        'computeSize.$': '$.dispatch.Payload.computeSize',
        'timeoutMinutes.$': '$.dispatch.Payload.timeoutMinutes',
        'timeoutSeconds.$': '$.dispatch.Payload.timeoutSeconds',
        // Pass through the entire dispatch payload so we can access outputHash if it exists
        'dispatchResult.$': '$.dispatch.Payload',
      },
    });

    // Skip state for tasks that were cancelled mid-dispatch
    const skipCancelledState = new sfn.Pass(this, 'SkipCancelled', {
      parameters: {
        'skipped': true,
        'taskName.$': '$.dispatch.Payload.taskName',
        'status': 'cancelled',
      },
    });

    // Choice: Is task not ready or cancelled? Route away from PrepareExecution
    // which requires fields (taskHash, inputHashes, etc.) that only exist for ready/cached tasks.
    const isNotReadyChoice = new sfn.Choice(this, 'IsNotReady')
      .when(
        sfn.Condition.stringEquals('$.dispatch.Payload.status', 'not_ready'),
        skipNotReadyState  // Skip - will be retried in next get-ready iteration
      )
      .when(
        sfn.Condition.stringEquals('$.dispatch.Payload.status', 'cancelled'),
        skipCancelledState  // Skip - execution was cancelled
      )
      .otherwise(prepareExecutionState);

    // ExecuteTask: runs the actual task computation
    // Merge result into $.execution to preserve context
    const executeTaskState = new tasks.LambdaInvoke(this, 'ExecuteTaskState', {
      lambdaFunction: executeTaskFn,
      resultPath: '$.execution',
      retryOnServiceExceptions: true,
    }).addRetry({
      errors: ['States.TaskFailed', 'States.Timeout'],
      maxAttempts: 2,
      backoffRate: 2,
    }).addCatch(new sfn.Pass(this, 'TaskExecutionFailed', {
      parameters: {
        'status': 'failed',
        'error': 'Task execution failed',
        'exitCode': -1,
        'duration': 0,
      },
      resultPath: '$.execution.Payload',
    }), {
      resultPath: '$.execution.error',
    });

    // Prepare write for successful execution
    const prepareSuccessWriteState = new sfn.Pass(this, 'PrepareSuccessWrite', {
      parameters: {
        'repo.$': '$.repo',
        'workspace.$': '$.workspace',
        'executionId.$': '$.executionId',
        'runId.$': '$.runId',
        'taskName.$': '$.taskName',
        'outputPath.$': '$.outputPath',
        'taskHash.$': '$.taskHash',
        'inputHashes.$': '$.inputHashes',
        'taskExecutionId.$': '$.taskExecutionId',
        'status': 'completed',
        'outputHash.$': '$.execution.Payload.outputHash',
        'duration.$': '$.execution.Payload.duration',
      },
    });

    // Prepare write for failed execution
    const prepareFailureWriteState = new sfn.Pass(this, 'PrepareFailureWrite', {
      parameters: {
        'repo.$': '$.repo',
        'workspace.$': '$.workspace',
        'executionId.$': '$.executionId',
        'runId.$': '$.runId',
        'taskName.$': '$.taskName',
        'outputPath.$': '$.outputPath',
        'taskHash.$': '$.taskHash',
        'inputHashes.$': '$.inputHashes',
        'taskExecutionId.$': '$.taskExecutionId',
        'status': 'failed',
        'error.$': '$.execution.Payload.error',
        'exitCode.$': '$.execution.Payload.exitCode',
        'duration.$': '$.execution.Payload.duration',
      },
    });

    // Choice: Did execution succeed?
    const didExecutionSucceedChoice = new sfn.Choice(this, 'DidExecutionSucceed')
      .when(
        sfn.Condition.stringEquals('$.execution.Payload.status', 'success'),
        prepareSuccessWriteState
      )
      .otherwise(prepareFailureWriteState);

    // PrepareSuccessWrite and PrepareFailureWrite are terminal states in the Map iterator.
    // Their outputs are collected by the Map and processed by ApplyResults after the Map completes.

    // Prepare write for cached results (outputHash comes from dispatch)
    const prepareCachedWriteState = new sfn.Pass(this, 'PrepareCachedWrite', {
      parameters: {
        'repo.$': '$.repo',
        'workspace.$': '$.workspace',
        'executionId.$': '$.executionId',
        'runId.$': '$.runId',
        'taskName.$': '$.taskName',
        'outputPath.$': '$.outputPath',
        'taskHash.$': '$.taskHash',
        'inputHashes.$': '$.inputHashes',
        'taskExecutionId.$': '$.taskExecutionId',
        'status': 'cached',  // Preserve cached status for proper counting
        'outputHash.$': '$.dispatchResult.outputHash',
      },
    });
    // PrepareCachedWrite is a terminal state in the Map iterator (collected by ApplyResults)

    // ============================================================
    // FARGATE COMPUTE STATES
    // ============================================================
    // EcsRunTask states for each Fargate size + routing Choice

    // Helper to create an EcsRunTask state for a given size
    const createComputeExecuteState = (
      id: string,
      taskDef: ecs.FargateTaskDefinition,
      container: ecs.ContainerDefinition,
    ) => {
      return new tasks.EcsRunTask(this, `ExecuteTask${id}`, {
        integrationPattern: sfn.IntegrationPattern.WAIT_FOR_TASK_TOKEN,
        cluster: computeCluster,
        taskDefinition: taskDef,
        launchTarget: new tasks.EcsFargateLaunchTarget({
          platformVersion: ecs.FargatePlatformVersion.LATEST,
        }),
        assignPublicIp: true,
        subnets: { subnetType: ec2.SubnetType.PUBLIC },
        securityGroups: [computeTaskSg],
        containerOverrides: [{
          containerDefinition: container,
          environment: [
            { name: 'TASK_EVENT', value: sfn.JsonPath.jsonToString(sfn.JsonPath.objectAt('$')) },
            { name: 'TASK_TOKEN', value: sfn.JsonPath.taskToken },
          ],
        }],
        heartbeatTimeout: sfn.Timeout.duration(cdk.Duration.minutes(30)),
        resultPath: '$.computeCallback',
      });
    }

    const executeTaskSmallState = createComputeExecuteState('Small', computeSmall.taskDef, computeSmall.container);
    const executeTaskMediumState = createComputeExecuteState('Medium', computeMedium.taskDef, computeMedium.container);
    const executeTaskLargeState = createComputeExecuteState('Large', computeLarge.taskDef, computeLarge.container);
    const executeTaskXLargeState = createComputeExecuteState('XLarge', computeXLarge.taskDef, computeXLarge.container);

    // CollectComputeResult: reads result from DynamoDB after Fargate completes
    const collectComputeResultState = new tasks.LambdaInvoke(this, 'CollectComputeResult', {
      lambdaFunction: collectComputeResultFn,
      resultPath: '$.execution',
      retryOnServiceExceptions: true,
    });

    // DidComputeSucceed: routes to success or failure write states
    const didComputeSucceedChoice = new sfn.Choice(this, 'DidComputeSucceed')
      .when(
        sfn.Condition.stringEquals('$.execution.Payload.status', 'success'),
        prepareSuccessWriteState
      )
      .otherwise(prepareFailureWriteState);

    // Wire Fargate states: EcsRunTask -> CollectComputeResult -> DidComputeSucceed
    collectComputeResultState.next(didComputeSucceedChoice);
    executeTaskSmallState.next(collectComputeResultState);
    executeTaskMediumState.next(collectComputeResultState);
    executeTaskLargeState.next(collectComputeResultState);
    executeTaskXLargeState.next(collectComputeResultState);

    // Error handling for Fargate states
    const computeTaskFailed = new sfn.Pass(this, 'ComputeTaskFailed', {
      parameters: {
        'status': 'failed',
        'error': 'Compute task execution failed',
        'exitCode': -1,
        'duration': 0,
      },
      resultPath: '$.execution.Payload',
    });
    computeTaskFailed.next(prepareFailureWriteState);

    executeTaskSmallState.addCatch(computeTaskFailed, { resultPath: '$.execution.error' });
    executeTaskMediumState.addCatch(computeTaskFailed, { resultPath: '$.execution.error' });
    executeTaskLargeState.addCatch(computeTaskFailed, { resultPath: '$.execution.error' });
    executeTaskXLargeState.addCatch(computeTaskFailed, { resultPath: '$.execution.error' });
    collectComputeResultState.addCatch(computeTaskFailed, { resultPath: '$.execution.error' });

    // ChooseExecutor: routes to Lambda or appropriate Fargate size
    const chooseExecutorChoice = new sfn.Choice(this, 'ChooseExecutor')
      .when(sfn.Condition.stringEquals('$.computeSize.type', 'serverless'), executeTaskState)
      .when(sfn.Condition.stringEquals('$.computeSize.type', 'small'), executeTaskSmallState)
      .when(sfn.Condition.stringEquals('$.computeSize.type', 'medium'), executeTaskMediumState)
      .when(sfn.Condition.stringEquals('$.computeSize.type', 'large'), executeTaskLargeState)
      .when(sfn.Condition.stringEquals('$.computeSize.type', 'xlarge'), executeTaskXLargeState)
      .otherwise(executeTaskState); // Fallback to serverless

    // Choice: Is task result cached?
    const isCachedChoice = new sfn.Choice(this, 'IsCached')
      .when(
        sfn.Condition.stringEquals('$.status', 'cached'),
        prepareCachedWriteState  // Cached results - prepare and write
      )
      .otherwise(chooseExecutorChoice);  // Route to appropriate executor

    // Wire up the task execution chain
    dispatchTaskState.next(isNotReadyChoice);
    prepareExecutionState.next(isCachedChoice);
    executeTaskState.next(didExecutionSucceedChoice);

    // Map iterator definition: dispatch -> prepare -> (cached? -> write) or (execute -> prepare -> write)
    // The chain is already wired above, dispatchTaskState is the entry point
    const taskIterator = dispatchTaskState;

    // Map state for parallel task execution
    // Use high concurrency - each task runs in its own Lambda, limited only by Lambda service limits
    // Note: Handlers now load execution state (including graph) from DynamoDB
    const dispatchTasksMap = new sfn.Map(this, 'DispatchTasksMap', {
      maxConcurrency: 100,
      itemsPath: '$.readyTasks',
      itemSelector: {
        'taskName.$': '$$.Map.Item.Value',
        'repo.$': '$.repo',
        'workspace.$': '$.workspace',
        'executionId.$': '$.executionId',
        'runId.$': '$.runId',
        'force.$': '$.force',
        'forceTasks.$': '$.forceTasks',
      },
      resultPath: '$.taskResults',
    }).itemProcessor(taskIterator);

    // After map completes, pass collected task results to ApplyResults
    const afterMapLoop = new sfn.Pass(this, 'AfterMapLoop', {
      parameters: {
        'repo.$': '$.repo',
        'workspace.$': '$.workspace',
        'executionId.$': '$.executionId',
        'runId.$': '$.runId',
        'force.$': '$.force',
        'forceTasks.$': '$.forceTasks',
        'taskResults.$': '$.taskResults',
      },
    });

    // Apply task results serially to execution state (avoids race conditions)
    // Returns { repo, workspace, executionId, runId, force }
    const applyResultsState = new tasks.LambdaInvoke(this, 'ApplyResultsState', {
      lambdaFunction: applyResultsFn,
      outputPath: '$.Payload',
      retryOnServiceExceptions: true,
    });

    dispatchTasksMap.next(afterMapLoop);
    afterMapLoop.next(applyResultsState);
    applyResultsState.next(getReadyState);

    // Catch coverage for remaining dataflow states
    applyResultsState.addCatch(prepareFinalizeFailure, { resultPath: '$.error' });
    dispatchTasksMap.addCatch(prepareFinalizeFailure, { resultPath: '$.error' });

    // Pass state to flatten GetReady result and add readyCount
    // Note: graph is now stored in DynamoDB and loaded by handlers as needed
    const checkReadyTasks = new sfn.Pass(this, 'CheckReadyTasks', {
      parameters: {
        'repo.$': '$.repo',
        'workspace.$': '$.workspace',
        'executionId.$': '$.executionId',
        'runId.$': '$.runId',
        'force.$': '$.force',
        'forceTasks.$': '$.forceTasks',
        'readyTasks.$': '$.readyResult.Payload.readyTasks',
        'allCompleted.$': '$.readyResult.Payload.allCompleted',
        'cancelled.$': '$.readyResult.Payload.cancelled',
        'completedCount.$': '$.readyResult.Payload.completedCount',
        'failedCount.$': '$.readyResult.Payload.failedCount',
        'skippedCount.$': '$.readyResult.Payload.skippedCount',
        'inProgressCount.$': '$.readyResult.Payload.inProgressCount',
        'deferredCount.$': '$.readyResult.Payload.deferredCount',
        'readyCount.$': 'States.ArrayLength($.readyResult.Payload.readyTasks)',
      },
    });

    // Prepare state for cancelled execution finalization
    const prepareFinalizeCancel = new sfn.Pass(this, 'PrepareFinalizeCancel', {
      parameters: {
        'repo.$': '$.repo',
        'workspace.$': '$.workspace',
        'executionId.$': '$.executionId',
        'runId.$': '$.runId',
        'status': 'failed',
      },
    });

    // Finalize for cancelled execution (reuse failure finalization)
    const finalizeCancelState = new tasks.LambdaInvoke(this, 'FinalizeCancelState', {
      lambdaFunction: finalizeExecutionFn,
      outputPath: '$.Payload',
      retryOnServiceExceptions: true,
    });
    prepareFinalizeCancel.next(finalizeCancelState);
    finalizeCancelState.next(dataflowFailed);

    // Last-resort catches on finalize states — lock release is guaranteed by try/finally in handler
    finalizeSuccessState.addCatch(dataflowFailed, { resultPath: '$.error' });
    finalizeFailureState.addCatch(dataflowFailed, { resultPath: '$.error' });
    finalizeCancelState.addCatch(dataflowFailed, { resultPath: '$.error' });

    // Choice: All tasks complete?
    // Check completion status and handle success/failure appropriately
    // Also checks for cancellation
    const isAllCompleteChoice = new sfn.Choice(this, 'IsAllComplete')
      .when(
        // Cancelled -> finalize as failed
        sfn.Condition.booleanEquals('$.cancelled', true),
        prepareFinalizeCancel
      )
      .when(
        // All complete with failures -> finalize as failed
        sfn.Condition.and(
          sfn.Condition.booleanEquals('$.allCompleted', true),
          sfn.Condition.numberGreaterThan('$.failedCount', 0)
        ),
        prepareFinalizeFailure
      )
      .when(
        // All complete with no failures -> finalize as success
        sfn.Condition.booleanEquals('$.allCompleted', true),
        prepareFinalizeSuccess
      )
      .when(
        sfn.Condition.numberEquals('$.readyCount', 0),
        // No ready tasks but not complete - deadlock or waiting for in-progress
        new sfn.Wait(this, 'WaitForProgress', {
          time: sfn.WaitTime.duration(cdk.Duration.seconds(5)),
        }).next(getReadyState)
      )
      .otherwise(dispatchTasksMap);

    getReadyState.next(checkReadyTasks);
    checkReadyTasks.next(isAllCompleteChoice);

    this.dataflowStateMachine = new sfn.StateMachine(this, 'DataflowStateMachine', {
      stateMachineName: `${prefix}-dataflow`,
      definitionBody: sfn.DefinitionBody.fromChainable(
        getGraphState.next(getReadyState)
      ),
      timeout: cdk.Duration.hours(24),
    });

    // Grant API handler permission to start dataflow state machine
    this.dataflowStateMachine.grantStartExecution(this.apiHandler);
    this.dataflowStateMachine.grantRead(this.apiHandler);
    this.apiHandler.addEnvironment('DATAFLOW_STATE_MACHINE_ARN', this.dataflowStateMachine.stateMachineArn);

    // ============================================================
    // GC STATE MACHINE
    // ============================================================

    // Lambda: Set repo status to 'gc'
    const setGcFn = new nodejs.NodejsFunction(this, 'SetGcHandler', {
      functionName: `${prefix}-set-gc`,
      runtime: lambda.Runtime.NODEJS_22_X,
      entry: path.join(awsPackagePath, 'src', 'handlers', 'gc', 'set-status.ts'),
      handler: 'setGCHandler',
      bundling: {
        minify: true,
        sourceMap: true,
        format: nodejs.OutputFormat.ESM,
        banner: "import { createRequire } from 'module'; const require = createRequire(import.meta.url);",
      },
      timeout: cdk.Duration.seconds(30),
      memorySize: 256,
      environment: {
        TABLE_NAME: this.dataTable.tableName,
      },
    });
    this.dataTable.grantReadWriteData(setGcFn);

    // Lambda: GC Mark phase (collect roots, trace object graph, write reachable set)
    const gcMarkFn = new nodejs.NodejsFunction(this, 'GcMarkHandler', {
      functionName: `${prefix}-gc-mark`,
      runtime: lambda.Runtime.NODEJS_22_X,
      entry: path.join(awsPackagePath, 'src', 'handlers', 'gc', 'gc-mark.ts'),
      handler: 'handler',
      bundling: {
        minify: true,
        sourceMap: true,
        format: nodejs.OutputFormat.ESM,
        banner: "import { createRequire } from 'module'; const require = createRequire(import.meta.url);",
      },
      timeout: cdk.Duration.minutes(15),
      memorySize: 3008, // Higher memory for object graph traversal
      environment: {
        TABLE_NAME: this.dataTable.tableName,
        BUCKET_NAME: this.dataBucket.bucketName,
      },
    });
    this.dataTable.grantReadData(gcMarkFn);
    this.dataBucket.grantReadWrite(gcMarkFn);

    // Lambda: GC Sweep phase (delete unreachable catalogue entries)
    const gcSweepFn = new nodejs.NodejsFunction(this, 'GcSweepHandler', {
      functionName: `${prefix}-gc-sweep`,
      runtime: lambda.Runtime.NODEJS_22_X,
      entry: path.join(awsPackagePath, 'src', 'handlers', 'gc', 'gc-sweep.ts'),
      handler: 'handler',
      bundling: {
        minify: true,
        sourceMap: true,
        format: nodejs.OutputFormat.ESM,
        banner: "import { createRequire } from 'module'; const require = createRequire(import.meta.url);",
      },
      timeout: cdk.Duration.minutes(15),
      memorySize: 3008, // Higher memory for reachable set
      environment: {
        BUCKET_NAME: this.dataBucket.bucketName,
        TABLE_NAME: this.dataTable.tableName,
      },
    });
    this.dataBucket.grantRead(gcSweepFn); // Only needs read for reachable set
    this.dataTable.grantReadWriteData(gcSweepFn); // For catalogue deletion

    // Lambda: GC Cleanup (delete orphaned S3 versions and temp files)
    const gcCleanupFn = new nodejs.NodejsFunction(this, 'GcCleanupHandler', {
      functionName: `${prefix}-gc-cleanup`,
      runtime: lambda.Runtime.NODEJS_22_X,
      entry: path.join(awsPackagePath, 'src', 'handlers', 'gc', 'gc-cleanup.ts'),
      handler: 'handler',
      bundling: {
        minify: true,
        sourceMap: true,
        format: nodejs.OutputFormat.ESM,
        banner: "import { createRequire } from 'module'; const require = createRequire(import.meta.url);",
      },
      timeout: cdk.Duration.minutes(15),
      memorySize: 1024,
      environment: {
        BUCKET_NAME: this.dataBucket.bucketName,
        TABLE_NAME: this.dataTable.tableName,
      },
    });
    this.dataBucket.grantReadWrite(gcCleanupFn);
    this.dataTable.grantReadData(gcCleanupFn);

    // Lambda: Set repo status back to 'active'
    const setActiveFn = new nodejs.NodejsFunction(this, 'SetActiveHandler', {
      functionName: `${prefix}-set-active`,
      runtime: lambda.Runtime.NODEJS_22_X,
      entry: path.join(awsPackagePath, 'src', 'handlers', 'gc', 'set-status.ts'),
      handler: 'setActiveHandler',
      bundling: {
        minify: true,
        sourceMap: true,
        format: nodejs.OutputFormat.ESM,
        banner: "import { createRequire } from 'module'; const require = createRequire(import.meta.url);",
      },
      timeout: cdk.Duration.seconds(30),
      memorySize: 256,
      environment: {
        TABLE_NAME: this.dataTable.tableName,
      },
    });
    this.dataTable.grantReadWriteData(setActiveFn);

    // Step Function: GC
    // Flow: CheckJitter -> (GenerateJitter?) -> ApplyJitter -> SetGC -> MarkPhase -> SweepPhase (loop) -> Cleanup -> SetActive

    // Wait state for jitter (spreads GC runs to avoid thundering herd)
    const applyJitterState = new sfn.Wait(this, 'ApplyJitter', {
      time: sfn.WaitTime.secondsPath('$.jitterSeconds'),
    });

    // Pass state to generate random jitter (only used if jitterSeconds not provided)
    const generateJitterState = new sfn.Pass(this, 'GenerateJitter', {
      parameters: {
        'repo.$': '$.repo',
        'gcId.$': '$.gcId',
        'startTime.$': '$.startTime',
        'jitterSeconds.$': "States.MathAdd(0, States.MathRandom(0, 3600))",
      },
    });

    // Choice state to check if jitterSeconds was provided
    const checkJitterProvided = new sfn.Choice(this, 'CheckJitterProvided')
      .when(sfn.Condition.isPresent('$.jitterSeconds'), applyJitterState)
      .otherwise(generateJitterState);

    const setGcState = new tasks.LambdaInvoke(this, 'SetGcState', {
      lambdaFunction: setGcFn,
      outputPath: '$.Payload',
      retryOnServiceExceptions: true,
    });

    const gcMarkState = new tasks.LambdaInvoke(this, 'GcMarkState', {
      lambdaFunction: gcMarkFn,
      outputPath: '$.Payload',
      retryOnServiceExceptions: true,
    });

    const gcSweepState = new tasks.LambdaInvoke(this, 'GcSweepState', {
      lambdaFunction: gcSweepFn,
      outputPath: '$.Payload',
      retryOnServiceExceptions: true,
    });

    const gcCleanupState = new tasks.LambdaInvoke(this, 'GcCleanupState', {
      lambdaFunction: gcCleanupFn,
      outputPath: '$.Payload',
      retryOnServiceExceptions: true,
    });

    const setActiveState = new tasks.LambdaInvoke(this, 'SetActiveState', {
      lambdaFunction: setActiveFn,
      outputPath: '$.Payload',
      retryOnServiceExceptions: true,
    });

    const gcComplete = new sfn.Succeed(this, 'GcComplete', {
      comment: 'Garbage collection completed successfully',
    });

    // GcSkipped: When repo isn't in valid state for GC (e.g., already running GC, being deleted)
    // This is a graceful "nothing to do" rather than an error
    const gcSkipped = new sfn.Succeed(this, 'GcSkipped', {
      comment: 'GC skipped - repo not in valid state',
    });

    // Error recovery: revert repo status from 'gc' back to 'active' on failure
    const prepareGcRevert = new sfn.Pass(this, 'PrepareGcRevert', {
      parameters: {
        'repo.$': '$.repo',
      },
    });

    const revertToActive = new tasks.LambdaInvoke(this, 'RevertToActive', {
      lambdaFunction: setActiveFn,
      outputPath: '$.Payload',
      retryOnServiceExceptions: true,
    });

    const gcFailed = new sfn.Fail(this, 'GcFailed', {
      error: 'GcFailed',
      cause: 'GC phase failed after retries, repo reverted to active',
    });

    prepareGcRevert.next(revertToActive);
    revertToActive.next(gcFailed);

    // Catch failures in GC phases and revert repo to active status
    gcMarkState.addCatch(prepareGcRevert, { resultPath: '$.error' });
    gcSweepState.addCatch(prepareGcRevert, { resultPath: '$.error' });
    gcCleanupState.addCatch(prepareGcRevert, { resultPath: '$.error' });

    // Check if SetGC succeeded
    const checkSetGcResult = new sfn.Choice(this, 'CheckSetGcResult')
      .when(sfn.Condition.booleanEquals('$.success', false), gcSkipped)
      .otherwise(gcMarkState);

    // Check if we need to continue sweeping
    const checkGcSweepResult = new sfn.Choice(this, 'CheckGcSweepResult')
      .when(sfn.Condition.stringEquals('$.status', 'continue'), gcSweepState)
      .otherwise(gcCleanupState);

    // Check if we need to continue cleanup (version scanning is paginated)
    const checkGcCleanupResult = new sfn.Choice(this, 'CheckGcCleanupResult')
      .when(sfn.Condition.stringEquals('$.status', 'continue'), gcCleanupState)
      .otherwise(setActiveState);

    // Wire up the state machine
    // GenerateJitter flows into ApplyJitter
    generateJitterState.next(applyJitterState);
    // ApplyJitter flows into SetGC
    applyJitterState.next(setGcState);
    // SetGC flows into CheckSetGcResult
    setGcState.next(checkSetGcResult);

    const gcDefinition = checkJitterProvided;

    gcMarkState.next(gcSweepState);
    gcSweepState.next(checkGcSweepResult);
    gcCleanupState.next(checkGcCleanupResult);
    setActiveState.next(gcComplete);

    this.gcStateMachine = new sfn.StateMachine(this, 'GcStateMachine', {
      stateMachineName: `${prefix}-gc`,
      definitionBody: sfn.DefinitionBody.fromChainable(gcDefinition),
      timeout: cdk.Duration.hours(24),
    });

    // Grant API handler permission to start and query GC state machine
    this.gcStateMachine.grantStartExecution(this.apiHandler);
    this.gcStateMachine.grantRead(this.apiHandler); // For DescribeExecution
    this.apiHandler.addEnvironment('GC_STATE_MACHINE_ARN', this.gcStateMachine.stateMachineArn);

    // Lambda: GC Scheduler (triggered by EventBridge)
    const gcSchedulerFn = new nodejs.NodejsFunction(this, 'GcSchedulerHandler', {
      functionName: `${prefix}-gc-scheduler`,
      runtime: lambda.Runtime.NODEJS_22_X,
      entry: path.join(awsPackagePath, 'src', 'handlers', 'gc', 'gc-scheduler.ts'),
      handler: 'handler',
      bundling: {
        minify: true,
        sourceMap: true,
        format: nodejs.OutputFormat.ESM,
        banner: "import { createRequire } from 'module'; const require = createRequire(import.meta.url);",
      },
      timeout: cdk.Duration.minutes(5),
      memorySize: 256,
      environment: {
        TABLE_NAME: this.dataTable.tableName,
        GC_STATE_MACHINE_ARN: this.gcStateMachine.stateMachineArn,
        MAX_JITTER_MS: '3600000', // 1 hour max jitter
      },
    });
    this.dataTable.grantReadData(gcSchedulerFn);
    this.gcStateMachine.grantStartExecution(gcSchedulerFn);

    // EventBridge rule to run GC scheduler daily at 2 AM UTC
    new events.Rule(this, 'GcScheduleRule', {
      ruleName: `${prefix}-gc-schedule`,
      description: 'Triggers garbage collection for all repos daily',
      schedule: events.Schedule.cron({ hour: '2', minute: '0' }),
      targets: [new targets.LambdaFunction(gcSchedulerFn)],
    });

    // ============================================================
    // SCHEDULED EXECUTION
    // ============================================================
    // EventBridge Scheduler for per-workspace recurring dataflow execution.
    // Each schedule is an independent resource with its own cron expression,
    // target, and retry policy.

    // EventBridge Scheduler Group — organises all e3 schedules
    const schedulerGroup = new scheduler.CfnScheduleGroup(this, 'ScheduleGroup', {
      name: `${prefix}-schedules`,
    });

    // Dead-letter queue for failed schedule invocations
    const scheduleDlq = new sqs.Queue(this, 'ScheduleDlq', {
      queueName: `${prefix}-schedule-dlq`,
      retentionPeriod: cdk.Duration.days(14),
      encryption: sqs.QueueEncryption.SQS_MANAGED,
    });

    // Schedule Trigger Lambda — invoked by EventBridge Scheduler
    const scheduleTriggerFn = new nodejs.NodejsFunction(this, 'ScheduleTriggerHandler', {
      functionName: `${prefix}-schedule-trigger`,
      runtime: lambda.Runtime.NODEJS_22_X,
      entry: path.join(awsPackagePath, 'src', 'handlers', 'sfn', 'schedule-trigger.ts'),
      handler: 'handler',
      bundling: {
        minify: true,
        sourceMap: true,
        format: nodejs.OutputFormat.ESM,
        banner: "import { createRequire } from 'module'; const require = createRequire(import.meta.url);",
      },
      timeout: cdk.Duration.minutes(2),
      memorySize: 512,
      environment: {
        TABLE_NAME: this.dataTable.tableName,
        BUCKET_NAME: this.dataBucket.bucketName,
        DATAFLOW_STATE_MACHINE_ARN: this.dataflowStateMachine.stateMachineArn,
      },
    });
    this.dataTable.grantReadWriteData(scheduleTriggerFn);
    this.dataBucket.grantRead(scheduleTriggerFn);
    this.dataflowStateMachine.grantStartExecution(scheduleTriggerFn);

    // IAM Role for EventBridge Scheduler → Lambda invocation
    const schedulerRole = new iam.Role(this, 'SchedulerExecutionRole', {
      roleName: `${prefix}-scheduler-role`,
      assumedBy: new iam.ServicePrincipal('scheduler.amazonaws.com'),
    });
    scheduleTriggerFn.grantInvoke(schedulerRole);
    scheduleDlq.grantSendMessages(schedulerRole);

    // CloudWatch log group for EventBridge Scheduler delivery logging
    const schedulerLogGroup = new logs.LogGroup(this, 'SchedulerLogGroup', {
      logGroupName: `/aws/scheduler/${prefix}-schedules`,
      retention: logs.RetentionDays.ONE_MONTH,
      removalPolicy: cdk.RemovalPolicy.DESTROY,
    });
    schedulerLogGroup.grantWrite(schedulerRole);

    // API handler permissions for Scheduler management
    this.apiHandler.addToRolePolicy(new iam.PolicyStatement({
      actions: [
        'scheduler:CreateSchedule',
        'scheduler:UpdateSchedule',
        'scheduler:DeleteSchedule',
        'scheduler:GetSchedule',
      ],
      resources: [
        `arn:aws:scheduler:${this.region}:${this.account}:schedule/${prefix}-schedules/*`,
      ],
    }));
    this.apiHandler.addToRolePolicy(new iam.PolicyStatement({
      actions: ['iam:PassRole'],
      resources: [schedulerRole.roleArn],
      conditions: {
        StringEquals: {
          'iam:PassedToService': 'scheduler.amazonaws.com',
        },
      },
    }));

    // Environment variables for API handler
    this.apiHandler.addEnvironment('SCHEDULER_GROUP_NAME', `${prefix}-schedules`);
    this.apiHandler.addEnvironment('SCHEDULER_ROLE_ARN', schedulerRole.roleArn);
    this.apiHandler.addEnvironment('SCHEDULE_TRIGGER_FN_ARN', scheduleTriggerFn.functionArn);
    this.apiHandler.addEnvironment('SCHEDULE_DLQ_ARN', scheduleDlq.queueArn);
    this.apiHandler.addEnvironment('DEFAULT_TIMEZONE', props.defaultTimezone ?? 'UTC');

    // Stack outputs
    new cdk.CfnOutput(this, 'SchedulerGroupName', {
      value: schedulerGroup.name!,
      exportName: `${prefix}-scheduler-group-name`,
    });
    new cdk.CfnOutput(this, 'ScheduleTriggerFnArn', {
      value: scheduleTriggerFn.functionArn,
      exportName: `${prefix}-schedule-trigger-fn-arn`,
    });
    new cdk.CfnOutput(this, 'ScheduleDlqUrl', {
      value: scheduleDlq.queueUrl,
      description: 'Dead-letter queue URL for failed schedule invocations',
    });

    // ============================================================
    // FRONTEND
    // ============================================================

    this.appsBucket = new s3.Bucket(this, 'AppsBucket', {
      bucketName: `${prefix}-frontend-${this.account}`,
      blockPublicAccess: s3.BlockPublicAccess.BLOCK_ALL,
      encryption: s3.BucketEncryption.S3_MANAGED,
      removalPolicy: cdk.RemovalPolicy.RETAIN,
    });

    const s3Origin = origins.S3BucketOrigin.withOriginAccessControl(this.appsBucket);

    const apiEndpoint = this.httpApi.apiEndpoint;
    const apiDomain = cdk.Fn.select(2, cdk.Fn.split('/', apiEndpoint));

    const apiOrigin = new origins.HttpOrigin(apiDomain, {
      protocolPolicy: cloudfront.OriginProtocolPolicy.HTTPS_ONLY,
    });

    // CloudFront Function for SPA routing
    // Rewrites paths without file extensions to /index.html
    // This handles client-side routing without using error responses
    // (which would interfere with API 404 responses)
    const spaRewriteFunction = new cloudfront.Function(this, 'SpaRewriteFunction', {
      functionName: `${prefix}-spa-rewrite`,
      code: cloudfront.FunctionCode.fromInline(`
function handler(event) {
  var request = event.request;
  var uri = request.uri;

  // If URI has a file extension, pass through
  if (uri.includes('.')) {
    return request;
  }

  // If URI is exactly '/', serve index.html
  if (uri === '/') {
    request.uri = '/index.html';
    return request;
  }

  // For SPA routes (no extension), serve index.html
  request.uri = '/index.html';
  return request;
}
      `),
    });

    // Security headers policy for all CloudFront responses
    const securityHeadersPolicy = new cloudfront.ResponseHeadersPolicy(this, 'SecurityHeadersPolicy', {
      responseHeadersPolicyName: `${prefix}-security-headers`,
      comment: 'Security headers for e3 platform',
      securityHeadersBehavior: {
        strictTransportSecurity: {
          accessControlMaxAge: cdk.Duration.seconds(63072000), // 2 years
          includeSubdomains: true,
          override: true,
          preload: true,
        },
        contentTypeOptions: {
          override: true,
        },
        frameOptions: {
          frameOption: cloudfront.HeadersFrameOption.DENY,
          override: true,
        },
        xssProtection: {
          protection: true,
          modeBlock: true,
          override: true,
        },
        referrerPolicy: {
          referrerPolicy: cloudfront.HeadersReferrerPolicy.STRICT_ORIGIN_WHEN_CROSS_ORIGIN,
          override: true,
        },
      },
    });

    this.distribution = new cloudfront.Distribution(this, 'Distribution', {
      comment: `e3 Platform - ${deploymentId}`,

      // Custom domain configuration (if available)
      domainNames: customDomainName ? [customDomainName] : undefined,
      certificate,

      defaultBehavior: {
        origin: s3Origin,
        viewerProtocolPolicy: cloudfront.ViewerProtocolPolicy.REDIRECT_TO_HTTPS,
        cachePolicy: cloudfront.CachePolicy.CACHING_OPTIMIZED,
        responseHeadersPolicy: securityHeadersPolicy,
        functionAssociations: [{
          function: spaRewriteFunction,
          eventType: cloudfront.FunctionEventType.VIEWER_REQUEST,
        }],
      },

      additionalBehaviors: {
        // OIDC discovery endpoint
        '/.well-known/openid-configuration': {
          origin: apiOrigin,
          viewerProtocolPolicy: cloudfront.ViewerProtocolPolicy.HTTPS_ONLY,
          cachePolicy: cloudfront.CachePolicy.CACHING_DISABLED,
          originRequestPolicy: cloudfront.OriginRequestPolicy.ALL_VIEWER_EXCEPT_HOST_HEADER,
          responseHeadersPolicy: securityHeadersPolicy,
          allowedMethods: cloudfront.AllowedMethods.ALLOW_GET_HEAD,
        },

        // OAuth2/device flow endpoints
        '/oauth2/*': {
          origin: apiOrigin,
          viewerProtocolPolicy: cloudfront.ViewerProtocolPolicy.HTTPS_ONLY,
          cachePolicy: cloudfront.CachePolicy.CACHING_DISABLED,
          originRequestPolicy: cloudfront.OriginRequestPolicy.ALL_VIEWER_EXCEPT_HOST_HEADER,
          responseHeadersPolicy: securityHeadersPolicy,
          allowedMethods: cloudfront.AllowedMethods.ALLOW_ALL,
        },

        // Device approval page
        '/device': {
          origin: apiOrigin,
          viewerProtocolPolicy: cloudfront.ViewerProtocolPolicy.HTTPS_ONLY,
          cachePolicy: cloudfront.CachePolicy.CACHING_DISABLED,
          originRequestPolicy: cloudfront.OriginRequestPolicy.ALL_VIEWER_EXCEPT_HOST_HEADER,
          responseHeadersPolicy: securityHeadersPolicy,
          allowedMethods: cloudfront.AllowedMethods.ALLOW_GET_HEAD,
        },

        // Health check
        '/health': {
          origin: apiOrigin,
          viewerProtocolPolicy: cloudfront.ViewerProtocolPolicy.HTTPS_ONLY,
          cachePolicy: cloudfront.CachePolicy.CACHING_DISABLED,
          originRequestPolicy: cloudfront.OriginRequestPolicy.ALL_VIEWER_EXCEPT_HOST_HEADER,
          responseHeadersPolicy: securityHeadersPolicy,
          allowedMethods: cloudfront.AllowedMethods.ALLOW_GET_HEAD,
        },

        // API routes (repos endpoints)
        '/api/*': {
          origin: apiOrigin,
          viewerProtocolPolicy: cloudfront.ViewerProtocolPolicy.HTTPS_ONLY,
          cachePolicy: cloudfront.CachePolicy.CACHING_DISABLED,
          originRequestPolicy: cloudfront.OriginRequestPolicy.ALL_VIEWER_EXCEPT_HOST_HEADER,
          responseHeadersPolicy: securityHeadersPolicy,
          allowedMethods: cloudfront.AllowedMethods.ALLOW_ALL,
        },

        // Per-repo frontend apps
        '/repos/*': {
          origin: s3Origin,
          viewerProtocolPolicy: cloudfront.ViewerProtocolPolicy.REDIRECT_TO_HTTPS,
          cachePolicy: cloudfront.CachePolicy.CACHING_OPTIMIZED,
          responseHeadersPolicy: securityHeadersPolicy,
          functionAssociations: [{
            function: spaRewriteFunction,
            eventType: cloudfront.FunctionEventType.VIEWER_REQUEST,
          }],
        },
      },
      // Note: No errorResponses - SPA routing is handled by the CloudFront Function
      // to avoid interfering with API 404 responses (e.g., user_not_found)
    });

    // Create Route53 record if domain is configured
    if (domainConfig && customDomainName) {
      // CloudFront's hosted zone ID (constant for all CloudFront distributions)
      const cloudfrontHostedZoneId = 'Z2FDTNDATAQYW2';

      if (domainConfig.route53RoleArn) {
        // Cross-account: use custom resource with role assumption
        new CrossAccountRoute53Record(this, 'DomainRecord', {
          recordName: customDomainName,
          hostedZoneId: domainConfig.hostedZoneId,
          aliasTarget: this.distribution.distributionDomainName,
          aliasHostedZoneId: cloudfrontHostedZoneId,
          route53RoleArn: domainConfig.route53RoleArn,
        });
      } else {
        // Same account: use standard CDK construct
        const hostedZone = route53.HostedZone.fromHostedZoneAttributes(this, 'HostedZone', {
          hostedZoneId: domainConfig.hostedZoneId,
          zoneName: domainConfig.baseDomain,
        });

        new route53.ARecord(this, 'DomainARecord', {
          zone: hostedZone,
          recordName: deploymentId, // Creates {deploymentId}.{baseDomain}
          target: route53.RecordTarget.fromAlias(
            new route53Targets.CloudFrontTarget(this.distribution)
          ),
        });
      }

      this.domainName = customDomainName;
      this.platformUrl = `https://${customDomainName}`;
    } else {
      this.platformUrl = `https://${this.distribution.distributionDomainName}`;
    }

    // Deploy web app + runtime config to S3 and invalidate CloudFront.
    // Both sources are in a single BucketDeployment so pruning correctly
    // removes only stale assets while preserving config.json.
    new s3deploy.BucketDeployment(this, 'WebAppDeployment', {
      sources: [
        s3deploy.Source.asset(path.join(repoRoot, 'web', 'dist')),
        s3deploy.Source.jsonData('config.json', {
          cognitoDomain: cognitoDomainUrl,
          cognitoClientId: userPoolClient.userPoolClientId,
          redirectUri: `${this.platformUrl}/auth/callback`,
          oidcProviderName: oidcProviderName ?? '',
        }),
      ],
      destinationBucket: this.appsBucket,
      distribution: this.distribution,
      distributionPaths: ['/*'],
    });

    // ============================================================
    // CLOUDWATCH ALARMS
    // ============================================================
    // Basic operational alarms. No SNS topic — visible in CloudWatch console,
    // can connect to SNS/PagerDuty later.

    new cloudwatch.Alarm(this, 'DataflowFailuresAlarm', {
      alarmName: `${prefix}-dataflow-failures`,
      metric: this.dataflowStateMachine.metricFailed({
        period: cdk.Duration.minutes(5),
      }),
      threshold: 1,
      evaluationPeriods: 1,
      comparisonOperator: cloudwatch.ComparisonOperator.GREATER_THAN_OR_EQUAL_TO_THRESHOLD,
      treatMissingData: cloudwatch.TreatMissingData.NOT_BREACHING,
      alarmDescription: 'Dataflow state machine execution failures',
    });

    new cloudwatch.Alarm(this, 'GcFailuresAlarm', {
      alarmName: `${prefix}-gc-failures`,
      metric: this.gcStateMachine.metricFailed({
        period: cdk.Duration.minutes(5),
      }),
      threshold: 1,
      evaluationPeriods: 1,
      comparisonOperator: cloudwatch.ComparisonOperator.GREATER_THAN_OR_EQUAL_TO_THRESHOLD,
      treatMissingData: cloudwatch.TreatMissingData.NOT_BREACHING,
      alarmDescription: 'GC state machine execution failures',
    });

    new cloudwatch.Alarm(this, 'ScheduleDlqDepthAlarm', {
      alarmName: `${prefix}-schedule-dlq-depth`,
      metric: scheduleDlq.metricApproximateNumberOfMessagesVisible({
        period: cdk.Duration.minutes(5),
      }),
      threshold: 1,
      evaluationPeriods: 1,
      comparisonOperator: cloudwatch.ComparisonOperator.GREATER_THAN_OR_EQUAL_TO_THRESHOLD,
      treatMissingData: cloudwatch.TreatMissingData.NOT_BREACHING,
      alarmDescription: 'Failed schedule invocations in dead-letter queue',
    });

    new cloudwatch.Alarm(this, 'ApiErrorsAlarm', {
      alarmName: `${prefix}-api-errors`,
      metric: this.apiHandler.metricErrors({
        period: cdk.Duration.minutes(5),
      }),
      threshold: 5,
      evaluationPeriods: 2,
      comparisonOperator: cloudwatch.ComparisonOperator.GREATER_THAN_OR_EQUAL_TO_THRESHOLD,
      treatMissingData: cloudwatch.TreatMissingData.NOT_BREACHING,
      alarmDescription: 'API Lambda function errors',
    });

    // ============================================================
    // OUTPUTS
    // ============================================================

    // Deployment info
    new cdk.CfnOutput(this, 'DeploymentId', {
      value: deploymentId,
      description: 'Deployment identifier',
    });

    // Storage
    new cdk.CfnOutput(this, 'DataBucketName', {
      value: this.dataBucket.bucketName,
      description: 'Data S3 bucket name',
    });

    new cdk.CfnOutput(this, 'DataTableName', {
      value: this.dataTable.tableName,
      description: 'Data DynamoDB table name',
    });

    // Auth
    new cdk.CfnOutput(this, 'UserPoolId', {
      value: this.userPool.userPoolId,
      description: 'Cognito User Pool ID',
    });

    new cdk.CfnOutput(this, 'UserPoolClientId', {
      value: this.userPoolClient.userPoolClientId,
      description: 'Cognito User Pool Client ID',
    });

    new cdk.CfnOutput(this, 'CognitoIssuer', {
      value: `https://cognito-idp.${this.region}.amazonaws.com/${this.userPool.userPoolId}`,
      description: 'Cognito JWT issuer URL',
    });

    new cdk.CfnOutput(this, 'CognitoDomain', {
      value: cognitoDomainUrl,
      description: 'Cognito hosted UI domain (for device flow)',
    });

    new cdk.CfnOutput(this, 'CognitoLoginUrl', {
      value: cognitoDomain.signInUrl(userPoolClient, {
        redirectUri: callbackUrls[0],
      }),
      description: 'Cognito hosted UI login URL',
    });

    new cdk.CfnOutput(this, 'AdminGroup', {
      value: adminGroup,
      description: 'Group name that grants admin access (must match IdP group)',
    });

    // API
    new cdk.CfnOutput(this, 'ApiEndpoint', {
      value: this.httpApi.apiEndpoint,
      description: 'API Gateway endpoint URL',
    });

    // Compute
    new cdk.CfnOutput(this, 'TaskStateMachineArn', {
      value: this.taskStateMachine.stateMachineArn,
      description: 'Task execution state machine ARN',
    });

    new cdk.CfnOutput(this, 'DataflowStateMachineArn', {
      value: this.dataflowStateMachine.stateMachineArn,
      description: 'Dataflow orchestration state machine ARN',
    });

    new cdk.CfnOutput(this, 'GcStateMachineArn', {
      value: this.gcStateMachine.stateMachineArn,
      description: 'GC state machine ARN',
    });

    // Frontend
    new cdk.CfnOutput(this, 'AppsBucketName', {
      value: this.appsBucket.bucketName,
      description: 'Frontend apps S3 bucket name',
    });

    new cdk.CfnOutput(this, 'DistributionId', {
      value: this.distribution.distributionId,
      description: 'CloudFront distribution ID',
    });

    new cdk.CfnOutput(this, 'DistributionDomainName', {
      value: this.distribution.distributionDomainName,
      description: 'CloudFront distribution domain name',
    });

    new cdk.CfnOutput(this, 'PlatformUrl', {
      value: this.platformUrl,
      description: 'Platform URL (custom domain or CloudFront)',
    });

    if (this.domainName) {
      new cdk.CfnOutput(this, 'CustomDomainName', {
        value: this.domainName,
        description: 'Custom domain name for the platform',
      });
    }
  }
}
