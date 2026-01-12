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
import { Construct } from 'constructs';
import { CrossRegionCertificate } from './cross-region-certificate.js';
import { CrossAccountRoute53Record } from './cross-account-route53-record.js';

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

    const defaultCallbacks = ['http://localhost:5173/callback', 'http://localhost:3000/oauth2/callback'];
    const callbackUrls = [...defaultCallbacks, ...(props.callbackUrls ?? [])];

    // Add custom domain callback URL if configured
    if (customDomainName) {
      callbackUrls.push(`https://${customDomainName}/oauth2/callback`);
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
    this.dataBucket = new s3.Bucket(this, 'DataBucket', {
      bucketName: `${prefix}-data-${this.account}`,
      blockPublicAccess: s3.BlockPublicAccess.BLOCK_ALL,
      encryption: s3.BucketEncryption.S3_MANAGED,
      removalPolicy: cdk.RemovalPolicy.RETAIN,
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
      authFlows: { userSrp: true },
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
    // API
    // ============================================================

    // Path to API package source (relative to this CDK project)
    // Use import.meta.url for ES module compatibility
    // At runtime, __dirname is dist/lib/, so we go up 4 levels to reach repo root
    const __filename = fileURLToPath(import.meta.url);
    const __dirname = path.dirname(__filename);
    const repoRoot = path.join(__dirname, '..', '..', '..', '..');
    const apiPackagePath = path.join(repoRoot, 'packages', 'api');

    // Cognito domain URL (e.g., e3-dev.auth.ap-southeast-2.amazoncognito.com)
    const cognitoDomainUrl = `${prefix}.auth.${this.region}.amazoncognito.com`;
    const cognitoIssuer = `https://cognito-idp.${this.region}.amazonaws.com/${userPool.userPoolId}`;

    this.apiHandler = new nodejs.NodejsFunction(this, 'ApiHandler', {
      functionName: `${prefix}-api`,
      runtime: lambda.Runtime.NODEJS_22_X,
      entry: path.join(apiPackagePath, 'src', 'index.ts'),
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
        // Cognito configuration for device flow proxy
        COGNITO_DOMAIN: cognitoDomainUrl,
        COGNITO_ISSUER: cognitoIssuer,
        COGNITO_CLIENT_ID: userPoolClient.userPoolClientId,
        // OIDC provider name (if configured) - used to skip Cognito login page
        ...(isOidcEnabled && oidcProviderName ? { OIDC_PROVIDER_NAME: oidcProviderName } : {}),
        // Base URL for the platform (used for device flow callbacks)
        // If custom domain is configured, use it; otherwise Lambda determines from request headers
        ...(customDomainName ? { BASE_URL: `https://${customDomainName}` } : {}),
      },
    });

    this.dataTable.grantReadWriteData(this.apiHandler);
    this.dataBucket.grantReadWrite(this.apiHandler);

    this.httpApi = new apigatewayv2.HttpApi(this, 'HttpApi', {
      apiName: `${prefix}-api`,
      corsPreflight: {
        allowOrigins: allowedOrigins,
        allowMethods: [apigatewayv2.CorsHttpMethod.ANY],
        allowHeaders: ['Authorization', 'Content-Type'],
        allowCredentials: true,
      },
    });

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

    // Dataflow orchestration state machine (placeholder)
    const startState = new sfn.Pass(this, 'DataflowStart', {
      result: sfn.Result.fromObject({ status: 'started' }),
    });

    const endState = new sfn.Pass(this, 'DataflowEnd', {
      result: sfn.Result.fromObject({ status: 'completed' }),
    });

    this.dataflowStateMachine = new sfn.StateMachine(this, 'DataflowStateMachine', {
      stateMachineName: `${prefix}-dataflow`,
      definitionBody: sfn.DefinitionBody.fromChainable(startState.next(endState)),
      timeout: cdk.Duration.hours(24),
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

    this.distribution = new cloudfront.Distribution(this, 'Distribution', {
      comment: `e3 Platform - ${deploymentId}`,

      // Custom domain configuration (if available)
      domainNames: customDomainName ? [customDomainName] : undefined,
      certificate,

      defaultBehavior: {
        origin: s3Origin,
        viewerProtocolPolicy: cloudfront.ViewerProtocolPolicy.REDIRECT_TO_HTTPS,
        cachePolicy: cloudfront.CachePolicy.CACHING_OPTIMIZED,
      },

      additionalBehaviors: {
        // OIDC discovery endpoint
        '/.well-known/openid-configuration': {
          origin: apiOrigin,
          viewerProtocolPolicy: cloudfront.ViewerProtocolPolicy.HTTPS_ONLY,
          cachePolicy: cloudfront.CachePolicy.CACHING_DISABLED,
          originRequestPolicy: cloudfront.OriginRequestPolicy.ALL_VIEWER_EXCEPT_HOST_HEADER,
          allowedMethods: cloudfront.AllowedMethods.ALLOW_GET_HEAD,
        },

        // OAuth2/device flow endpoints
        '/oauth2/*': {
          origin: apiOrigin,
          viewerProtocolPolicy: cloudfront.ViewerProtocolPolicy.HTTPS_ONLY,
          cachePolicy: cloudfront.CachePolicy.CACHING_DISABLED,
          originRequestPolicy: cloudfront.OriginRequestPolicy.ALL_VIEWER_EXCEPT_HOST_HEADER,
          allowedMethods: cloudfront.AllowedMethods.ALLOW_ALL,
        },

        // Device approval page
        '/device': {
          origin: apiOrigin,
          viewerProtocolPolicy: cloudfront.ViewerProtocolPolicy.HTTPS_ONLY,
          cachePolicy: cloudfront.CachePolicy.CACHING_DISABLED,
          originRequestPolicy: cloudfront.OriginRequestPolicy.ALL_VIEWER_EXCEPT_HOST_HEADER,
          allowedMethods: cloudfront.AllowedMethods.ALLOW_GET_HEAD,
        },

        // Health check
        '/health': {
          origin: apiOrigin,
          viewerProtocolPolicy: cloudfront.ViewerProtocolPolicy.HTTPS_ONLY,
          cachePolicy: cloudfront.CachePolicy.CACHING_DISABLED,
          originRequestPolicy: cloudfront.OriginRequestPolicy.ALL_VIEWER_EXCEPT_HOST_HEADER,
          allowedMethods: cloudfront.AllowedMethods.ALLOW_GET_HEAD,
        },

        // API routes (repos endpoints)
        '/api/*': {
          origin: apiOrigin,
          viewerProtocolPolicy: cloudfront.ViewerProtocolPolicy.HTTPS_ONLY,
          cachePolicy: cloudfront.CachePolicy.CACHING_DISABLED,
          originRequestPolicy: cloudfront.OriginRequestPolicy.ALL_VIEWER_EXCEPT_HOST_HEADER,
          allowedMethods: cloudfront.AllowedMethods.ALLOW_ALL,
        },

        // Per-repo frontend apps
        '/repos/*': {
          origin: s3Origin,
          viewerProtocolPolicy: cloudfront.ViewerProtocolPolicy.REDIRECT_TO_HTTPS,
          cachePolicy: cloudfront.CachePolicy.CACHING_OPTIMIZED,
        },
      },

      errorResponses: [
        {
          httpStatus: 404,
          responseHttpStatus: 200,
          responsePagePath: '/index.html',
          ttl: cdk.Duration.minutes(5),
        },
        {
          httpStatus: 403,
          responseHttpStatus: 200,
          responsePagePath: '/index.html',
          ttl: cdk.Duration.minutes(5),
        },
      ],
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
