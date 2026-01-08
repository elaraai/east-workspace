/**
 * Copyright (c) 2025 Elara AI Pty Ltd. All rights reserved.
 * Proprietary and confidential.
 */

import * as cdk from 'aws-cdk-lib';
import * as ec2 from 'aws-cdk-lib/aws-ec2';
import * as efs from 'aws-cdk-lib/aws-efs';
import * as dynamodb from 'aws-cdk-lib/aws-dynamodb';
import * as cognito from 'aws-cdk-lib/aws-cognito';
import * as lambda from 'aws-cdk-lib/aws-lambda';
import * as apigatewayv2 from 'aws-cdk-lib/aws-apigatewayv2';
import * as apigatewayv2Integrations from 'aws-cdk-lib/aws-apigatewayv2-integrations';
import { Construct } from 'constructs';

export interface ApiStackProps extends cdk.StackProps {
  vpc: ec2.IVpc;
  fileSystem: efs.IFileSystem;
  tenantsTable: dynamodb.ITable;
  permissionsTable: dynamodb.ITable;
  userPool: cognito.IUserPool;
}

export class ApiStack extends cdk.Stack {
  public readonly httpApi: apigatewayv2.IHttpApi;

  constructor(scope: Construct, id: string, props: ApiStackProps) {
    super(scope, id, props);

    // EFS Access Point for Lambda
    const accessPoint = new efs.AccessPoint(this, 'LambdaAccessPoint', {
      fileSystem: props.fileSystem as efs.FileSystem,
      path: '/lambda',
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

    // Security group for Lambda
    const lambdaSg = new ec2.SecurityGroup(this, 'LambdaSg', {
      vpc: props.vpc,
      description: 'Security group for e3 API Lambda functions',
    });

    // API Lambda function
    const apiHandler = new lambda.Function(this, 'ApiHandler', {
      runtime: lambda.Runtime.NODEJS_22_X,
      handler: 'index.handler',
      code: lambda.Code.fromInline(`
        exports.handler = async (event) => {
          return {
            statusCode: 200,
            body: JSON.stringify({ message: 'e3-cloud-api placeholder' }),
          };
        };
      `),
      vpc: props.vpc,
      vpcSubnets: { subnetType: ec2.SubnetType.PRIVATE_WITH_EGRESS },
      securityGroups: [lambdaSg],
      filesystem: lambda.FileSystem.fromEfsAccessPoint(accessPoint, '/mnt/efs'),
      timeout: cdk.Duration.seconds(30),
      memorySize: 1024,
      environment: {
        TENANTS_TABLE: props.tenantsTable.tableName,
        PERMISSIONS_TABLE: props.permissionsTable.tableName,
        USER_POOL_ID: props.userPool.userPoolId,
        EFS_MOUNT_PATH: '/mnt/efs',
      },
    });

    // Grant permissions
    props.tenantsTable.grantReadWriteData(apiHandler);
    props.permissionsTable.grantReadWriteData(apiHandler);

    // HTTP API Gateway
    this.httpApi = new apigatewayv2.HttpApi(this, 'E3HttpApi', {
      apiName: 'e3-api',
      corsPreflight: {
        allowOrigins: ['http://localhost:5173', 'https://platform.elaraai.com'],
        allowMethods: [apigatewayv2.CorsHttpMethod.ANY],
        allowHeaders: ['Authorization', 'Content-Type'],
        allowCredentials: true,
      },
    });

    // Routes
    const lambdaIntegration = new apigatewayv2Integrations.HttpLambdaIntegration(
      'ApiIntegration',
      apiHandler
    );

    this.httpApi.addRoutes({
      path: '/repos/{tenant}/{proxy+}',
      methods: [apigatewayv2.HttpMethod.ANY],
      integration: lambdaIntegration,
    });

    // Outputs
    new cdk.CfnOutput(this, 'ApiEndpoint', {
      value: this.httpApi.apiEndpoint,
    });
  }
}
