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
import * as apigatewayv2 from 'aws-cdk-lib/aws-apigatewayv2';
import * as apigatewayv2Integrations from 'aws-cdk-lib/aws-apigatewayv2-integrations';
import * as sfn from 'aws-cdk-lib/aws-stepfunctions';
import * as tasks from 'aws-cdk-lib/aws-stepfunctions-tasks';
import * as s3 from 'aws-cdk-lib/aws-s3';
import * as cloudfront from 'aws-cdk-lib/aws-cloudfront';
import * as origins from 'aws-cdk-lib/aws-cloudfront-origins';
import { Construct } from 'constructs';

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
  public readonly apiHandler: lambda.IFunction;

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
      throughputMode: efs.ThroughputMode.BURSTING,
      encrypted: true,
      removalPolicy: cdk.RemovalPolicy.RETAIN,
    });

    this.tenantsTable = new dynamodb.Table(this, 'TenantsTable', {
      tableName: `${prefix}-tenants`,
      partitionKey: { name: 'PK', type: dynamodb.AttributeType.STRING },
      billingMode: dynamodb.BillingMode.PAY_PER_REQUEST,
      pointInTimeRecovery: true,
      removalPolicy: cdk.RemovalPolicy.RETAIN,
    });

    this.permissionsTable = new dynamodb.Table(this, 'PermissionsTable', {
      tableName: `${prefix}-permissions`,
      partitionKey: { name: 'PK', type: dynamodb.AttributeType.STRING },
      sortKey: { name: 'SK', type: dynamodb.AttributeType.STRING },
      billingMode: dynamodb.BillingMode.PAY_PER_REQUEST,
      pointInTimeRecovery: true,
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

    this.userPoolClient = new cognito.UserPoolClient(this, 'UserPoolClient', {
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

    this.apiHandler = new lambda.Function(this, 'ApiHandler', {
      functionName: `${prefix}-api`,
      runtime: lambda.Runtime.NODEJS_22_X,
      handler: 'index.handler',
      code: lambda.Code.fromInline(`
        exports.handler = async (event) => {
          return {
            statusCode: 200,
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              message: 'e3-cloud-api placeholder',
              path: event.rawPath,
              tenant: event.pathParameters?.tenant,
            }),
          };
        };
      `),
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

    const apiIntegration = new apigatewayv2Integrations.HttpLambdaIntegration(
      'ApiIntegration',
      this.apiHandler
    );

    this.httpApi.addRoutes({
      path: '/repos/{tenant}/{proxy+}',
      methods: [apigatewayv2.HttpMethod.ANY],
      integration: apiIntegration,
    });

    // Health check route
    this.httpApi.addRoutes({
      path: '/health',
      methods: [apigatewayv2.HttpMethod.GET],
      integration: apiIntegration,
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

    new cdk.CfnOutput(this, 'CognitoDomain', {
      value: `https://cognito-idp.${this.region}.amazonaws.com/${this.userPool.userPoolId}`,
      description: 'Cognito domain for OAuth',
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
