/**
 * Copyright (c) 2025 Elara AI Pty Ltd. All rights reserved.
 * Proprietary and confidential.
 */

import * as cdk from 'aws-cdk-lib';
import { StorageStack } from '../lib/storage-stack.js';
import { AuthStack } from '../lib/auth-stack.js';
import { ApiStack } from '../lib/api-stack.js';
import { ComputeStack } from '../lib/compute-stack.js';
import { FrontendStack } from '../lib/frontend-stack.js';

const app = new cdk.App();

const env = {
  account: process.env.CDK_DEFAULT_ACCOUNT,
  region: process.env.CDK_DEFAULT_REGION ?? 'ap-southeast-2',
};

// Storage: EFS + DynamoDB
const storageStack = new StorageStack(app, 'E3StorageStack', { env });

// Auth: Cognito
const authStack = new AuthStack(app, 'E3AuthStack', { env });

// API: API Gateway + Lambda
const apiStack = new ApiStack(app, 'E3ApiStack', {
  env,
  vpc: storageStack.vpc,
  fileSystem: storageStack.fileSystem,
  tenantsTable: storageStack.tenantsTable,
  permissionsTable: storageStack.permissionsTable,
  userPool: authStack.userPool,
});

// Compute: Step Functions + Lambda/Fargate runners
const computeStack = new ComputeStack(app, 'E3ComputeStack', {
  env,
  vpc: storageStack.vpc,
  fileSystem: storageStack.fileSystem,
});

// Frontend: CloudFront + S3
const frontendStack = new FrontendStack(app, 'E3FrontendStack', {
  env,
  apiGateway: apiStack.httpApi,
});

// Dependencies
apiStack.addDependency(storageStack);
apiStack.addDependency(authStack);
computeStack.addDependency(storageStack);
frontendStack.addDependency(apiStack);

app.synth();
