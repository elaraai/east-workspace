/**
 * Copyright (c) 2025 Elara AI Pty Ltd. All rights reserved.
 * Proprietary and confidential.
 *
 * E3 Platform Stack - Single deployable stack for e3 cloud infrastructure.
 *
 * This consolidated stack contains all infrastructure components:
 * - Networking (VPC)
 * - Storage (EFS, DynamoDB)
 * - Auth (Cognito)
 * - API (API Gateway, Lambda)
 * - Compute (Step Functions, Lambda runners)
 * - Frontend (CloudFront, S3)
 */

import * as cdk from 'aws-cdk-lib';
import * as ec2 from 'aws-cdk-lib/aws-ec2';
import * as efs from 'aws-cdk-lib/aws-efs';
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
import * as ssm from 'aws-cdk-lib/aws-ssm';
import * as secretsmanager from 'aws-cdk-lib/aws-secretsmanager';
import { Construct } from 'constructs';

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

export interface E3PlatformStackProps extends cdk.StackProps {
  /**
   * Deployment identifier for resource naming (e.g., 'dev', 'prod', 'acme').
   * Used to isolate multiple deployments in the same account.
   */
  deploymentId: string;

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
  // Networking
  public readonly vpc: ec2.IVpc;

  // Storage
  public readonly fileSystem: efs.FileSystem;
  public readonly tenantsTable: dynamodb.Table;
  public readonly permissionsTable: dynamodb.Table;

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

  constructor(scope: Construct, id: string, props: E3PlatformStackProps) {
    super(scope, id, props);

    const { deploymentId } = props;
    const prefix = `e3-${deploymentId}`;

    // Merge default origins with custom ones
    const defaultOrigins = ['http://localhost:5173'];
    const allowedOrigins = [...defaultOrigins, ...(props.allowedOrigins ?? [])];

    const defaultCallbacks = ['http://localhost:5173/callback'];
    const callbackUrls = [...defaultCallbacks, ...(props.callbackUrls ?? [])];

    const defaultLogouts = ['http://localhost:5173/'];
    const logoutUrls = [...defaultLogouts, ...(props.allowedOrigins?.map(o => `${o}/`) ?? [])];

    // ============================================================
    // NETWORKING
    // ============================================================

    this.vpc = new ec2.Vpc(this, 'Vpc', {
      vpcName: `${prefix}-vpc`,
      maxAzs: 2,
      natGateways: 1,
    });

    // ============================================================
    // STORAGE
    // ============================================================

    this.fileSystem = new efs.FileSystem(this, 'FileSystem', {
      fileSystemName: `${prefix}-efs`,
      vpc: this.vpc,
      lifecyclePolicy: efs.LifecyclePolicy.AFTER_30_DAYS,
      performanceMode: efs.PerformanceMode.GENERAL_PURPOSE,
      // ELASTIC throughput scales automatically with workload (up to 10 GiB/s read, 3 GiB/s write)
      // Cost: $0.04/GB transferred vs BURSTING's burst credit model
      throughputMode: efs.ThroughputMode.ELASTIC,
      encrypted: true,
      removalPolicy: cdk.RemovalPolicy.RETAIN,
    });

    this.tenantsTable = new dynamodb.Table(this, 'TenantsTable', {
      tableName: `${prefix}-tenants`,
      partitionKey: { name: 'PK', type: dynamodb.AttributeType.STRING },
      billingMode: dynamodb.BillingMode.PAY_PER_REQUEST,
      pointInTimeRecoverySpecification: { pointInTimeRecoveryEnabled: true },
      removalPolicy: cdk.RemovalPolicy.RETAIN,
    });

    this.permissionsTable = new dynamodb.Table(this, 'PermissionsTable', {
      tableName: `${prefix}-permissions`,
      partitionKey: { name: 'PK', type: dynamodb.AttributeType.STRING },
      sortKey: { name: 'SK', type: dynamodb.AttributeType.STRING },
      billingMode: dynamodb.BillingMode.PAY_PER_REQUEST,
      pointInTimeRecoverySpecification: { pointInTimeRecoveryEnabled: true },
      removalPolicy: cdk.RemovalPolicy.RETAIN,
    });

    this.permissionsTable.addGlobalSecondaryIndex({
      indexName: 'TenantIndex',
      partitionKey: { name: 'SK', type: dynamodb.AttributeType.STRING },
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
      generateSecret: false,
      preventUserExistenceErrors: true,
    });
    this.userPoolClient = userPoolClient;

    // Cognito hosted UI domain (required for OAuth flows)
    // Uses Cognito-provided domain: {prefix}.auth.{region}.amazoncognito.com
    const cognitoDomain = userPool.addDomain('CognitoDomain', {
      cognitoDomain: {
        domainPrefix: prefix, // e.g., e3-elara-dev-e3
      },
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

    const hasEnvironment = this.account !== cdk.Aws.ACCOUNT_ID;

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

    // Configure OIDC provider if enabled and we have real values
    if (isOidcEnabled && oidcClientId && !oidcClientId.startsWith('dummy-value-for-')) {
      const clientSecret = secretsmanager.Secret.fromSecretCompleteArn(
        this,
        'OidcClientSecret',
        oidcSecretArn
      );

      const oidcProvider = new cognito.UserPoolIdentityProviderOidc(this, 'OidcProvider', {
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

      // Ensure the provider is created before the client references it
      userPoolClient.node.addDependency(oidcProvider);

      new cdk.CfnOutput(this, 'OidcProviderName', {
        value: oidcProviderName,
        description: 'Configured OIDC identity provider name',
      });
    }

    // ============================================================
    // API
    // ============================================================

    const apiAccessPoint = new efs.AccessPoint(this, 'ApiAccessPoint', {
      fileSystem: this.fileSystem,
      path: '/tenants',
      createAcl: {
        ownerGid: '1001',
        ownerUid: '1001',
        permissions: '755',
      },
      posixUser: {
        gid: '1001',
        uid: '1001',
      },
    });

    const apiSecurityGroup = new ec2.SecurityGroup(this, 'ApiSecurityGroup', {
      vpc: this.vpc,
      description: 'Security group for e3 API Lambda',
      securityGroupName: `${prefix}-api-sg`,
    });

    // Path to API package source (relative to this CDK project)
    // Use import.meta.url for ES module compatibility
    // At runtime, __dirname is dist/lib/, so we go up 4 levels to reach repo root
    const __filename = fileURLToPath(import.meta.url);
    const __dirname = path.dirname(__filename);
    const repoRoot = path.join(__dirname, '..', '..', '..', '..');
    const apiPackagePath = path.join(repoRoot, 'packages', 'api');

    this.apiHandler = new nodejs.NodejsFunction(this, 'ApiHandler', {
      functionName: `${prefix}-api`,
      runtime: lambda.Runtime.NODEJS_22_X,
      entry: path.join(apiPackagePath, 'src', 'index.ts'),
      handler: 'handler',
      bundling: {
        minify: true,
        sourceMap: true,
        externalModules: [],
        format: nodejs.OutputFormat.ESM,
      },
      vpc: this.vpc,
      vpcSubnets: { subnetType: ec2.SubnetType.PRIVATE_WITH_EGRESS },
      securityGroups: [apiSecurityGroup],
      filesystem: lambda.FileSystem.fromEfsAccessPoint(apiAccessPoint, '/mnt/efs'),
      timeout: cdk.Duration.seconds(30),
      memorySize: 1024,
      environment: {
        DEPLOYMENT_ID: deploymentId,
        TENANTS_TABLE: this.tenantsTable.tableName,
        PERMISSIONS_TABLE: this.permissionsTable.tableName,
        USER_POOL_ID: this.userPool.userPoolId,
        EFS_MOUNT_PATH: '/mnt/efs',
      },
    });

    this.tenantsTable.grantReadWriteData(this.apiHandler);
    this.permissionsTable.grantReadWriteData(this.apiHandler);

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

    // Tenant API routes (requires JWT auth)
    this.httpApi.addRoutes({
      path: '/repos/{tenant}/{proxy+}',
      methods: [apigatewayv2.HttpMethod.ANY],
      integration: apiIntegration,
      authorizer: jwtAuthorizer,
    });

    // ============================================================
    // COMPUTE
    // ============================================================

    const runnerAccessPoint = new efs.AccessPoint(this, 'RunnerAccessPoint', {
      fileSystem: this.fileSystem,
      path: '/runners',
      createAcl: {
        ownerGid: '1001',
        ownerUid: '1001',
        permissions: '755',
      },
      posixUser: {
        gid: '1001',
        uid: '1001',
      },
    });

    const runnerSecurityGroup = new ec2.SecurityGroup(this, 'RunnerSecurityGroup', {
      vpc: this.vpc,
      description: 'Security group for e3 task runners',
      securityGroupName: `${prefix}-runner-sg`,
    });

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
      vpc: this.vpc,
      vpcSubnets: { subnetType: ec2.SubnetType.PRIVATE_WITH_EGRESS },
      securityGroups: [runnerSecurityGroup],
      filesystem: lambda.FileSystem.fromEfsAccessPoint(runnerAccessPoint, '/mnt/efs'),
      timeout: cdk.Duration.minutes(15),
      memorySize: 3008,
      environment: {
        DEPLOYMENT_ID: deploymentId,
        EFS_MOUNT_PATH: '/mnt/efs',
      },
    });

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

      defaultBehavior: {
        origin: s3Origin,
        viewerProtocolPolicy: cloudfront.ViewerProtocolPolicy.REDIRECT_TO_HTTPS,
        cachePolicy: cloudfront.CachePolicy.CACHING_OPTIMIZED,
      },

      additionalBehaviors: {
        '/repos/*/api/*': {
          origin: apiOrigin,
          viewerProtocolPolicy: cloudfront.ViewerProtocolPolicy.HTTPS_ONLY,
          cachePolicy: cloudfront.CachePolicy.CACHING_DISABLED,
          originRequestPolicy: cloudfront.OriginRequestPolicy.ALL_VIEWER_EXCEPT_HOST_HEADER,
          allowedMethods: cloudfront.AllowedMethods.ALLOW_ALL,
        },

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

    // ============================================================
    // OUTPUTS
    // ============================================================

    // Deployment info
    new cdk.CfnOutput(this, 'DeploymentId', {
      value: deploymentId,
      description: 'Deployment identifier',
    });

    // Networking
    new cdk.CfnOutput(this, 'VpcId', {
      value: this.vpc.vpcId,
      description: 'VPC ID',
    });

    // Storage
    new cdk.CfnOutput(this, 'FileSystemId', {
      value: this.fileSystem.fileSystemId,
      description: 'EFS filesystem ID',
    });

    new cdk.CfnOutput(this, 'TenantsTableName', {
      value: this.tenantsTable.tableName,
      description: 'Tenants DynamoDB table name',
    });

    new cdk.CfnOutput(this, 'PermissionsTableName', {
      value: this.permissionsTable.tableName,
      description: 'Permissions DynamoDB table name',
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
      value: `https://${this.distribution.distributionDomainName}`,
      description: 'Platform URL (CloudFront)',
    });
  }
}
