/**
 * Copyright (c) 2025 Elara AI Pty Ltd. All rights reserved.
 * Proprietary and confidential.
 *
 * Utilities for fetching CloudFormation stack outputs.
 */

import {
  CloudFormationClient,
  DescribeStacksCommand,
} from '@aws-sdk/client-cloudformation';

/**
 * Set default AWS profile if no credentials are configured.
 * Profile follows convention: elaraai-{deploymentId}-elara-e3
 */
function ensureAwsCredentials(deploymentId: string): void {
  if (!process.env.AWS_PROFILE && !process.env.AWS_ACCESS_KEY_ID) {
    process.env.AWS_PROFILE = `elaraai-${deploymentId}-elara-e3`;
  }
}

export interface StackOutputs {
  // Deployment
  deploymentId: string;

  // Storage
  dataBucketName: string;
  dataTableName: string;

  // Auth
  userPoolId: string;
  userPoolClientId: string;
  cognitoIssuer: string;
  cognitoDomain: string;

  // API
  apiEndpoint: string;

  // Compute
  taskStateMachineArn: string;
  dataflowStateMachineArn: string;
  gcStateMachineArn: string;

  // Frontend
  appsBucketName: string;
  distributionId: string;
  distributionDomainName: string;
  platformUrl: string;

  // Optional
  customDomainName?: string;
  oidcProviderName?: string;
}

export async function getStackOutputs(deploymentId: string): Promise<StackOutputs> {
  // Ensure AWS credentials are available (sets default profile if needed)
  ensureAwsCredentials(deploymentId);

  const client = new CloudFormationClient({
    region: process.env.AWS_REGION ?? 'ap-southeast-2',
  });

  const stackName = `E3Platform-${deploymentId}`;

  const command = new DescribeStacksCommand({ StackName: stackName });
  const response = await client.send(command);

  const stack = response.Stacks?.[0];
  if (!stack) {
    throw new Error(`Stack ${stackName} not found. Is it deployed?`);
  }

  if (stack.StackStatus !== 'CREATE_COMPLETE' && stack.StackStatus !== 'UPDATE_COMPLETE') {
    throw new Error(`Stack ${stackName} is in status ${stack.StackStatus}, expected CREATE_COMPLETE or UPDATE_COMPLETE`);
  }

  const outputs = stack.Outputs ?? [];

  const getOutput = (key: string): string => {
    const output = outputs.find((o) => o.OutputKey === key);
    if (!output?.OutputValue) {
      throw new Error(`Output ${key} not found in stack ${stackName}`);
    }
    return output.OutputValue;
  };

  const getOptionalOutput = (key: string): string | undefined => {
    const output = outputs.find((o) => o.OutputKey === key);
    return output?.OutputValue;
  };

  return {
    // Deployment
    deploymentId,

    // Storage
    dataBucketName: getOutput('DataBucketName'),
    dataTableName: getOutput('DataTableName'),

    // Auth
    userPoolId: getOutput('UserPoolId'),
    userPoolClientId: getOutput('UserPoolClientId'),
    cognitoIssuer: getOutput('CognitoIssuer'),
    cognitoDomain: getOutput('CognitoDomain'),

    // API
    apiEndpoint: getOutput('ApiEndpoint'),

    // Compute
    taskStateMachineArn: getOutput('TaskStateMachineArn'),
    dataflowStateMachineArn: getOutput('DataflowStateMachineArn'),
    gcStateMachineArn: getOutput('GcStateMachineArn'),

    // Frontend
    appsBucketName: getOutput('AppsBucketName'),
    distributionId: getOutput('DistributionId'),
    distributionDomainName: getOutput('DistributionDomainName'),
    platformUrl: getOutput('PlatformUrl'),

    // Optional
    customDomainName: getOptionalOutput('CustomDomainName'),
    oidcProviderName: getOptionalOutput('OidcProviderName'),
  };
}

/**
 * Parse deployment ID from command line args or environment.
 */
export function getDeploymentId(): string {
  // Check for --deploymentId=xxx argument
  const arg = process.argv.find((a) => a.startsWith('--deploymentId='));
  if (arg) {
    return arg.split('=')[1];
  }

  // Check environment variable
  if (process.env.E3_DEPLOYMENT_ID) {
    return process.env.E3_DEPLOYMENT_ID;
  }

  // Default
  return 'dev';
}
