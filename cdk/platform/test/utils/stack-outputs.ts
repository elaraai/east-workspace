/**
 * Utilities for fetching CloudFormation stack outputs.
 */

import {
  CloudFormationClient,
  DescribeStacksCommand,
} from '@aws-sdk/client-cloudformation';

export interface StackOutputs {
  deploymentId: string;
  apiEndpoint: string;
  platformUrl: string;
  userPoolId: string;
  userPoolClientId: string;
  cognitoDomain: string;
  fileSystemId: string;
  tenantsTableName: string;
  permissionsTableName: string;
  appsBucketName: string;
  distributionId: string;
  taskStateMachineArn: string;
  dataflowStateMachineArn: string;
}

export async function getStackOutputs(deploymentId: string): Promise<StackOutputs> {
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

  return {
    deploymentId,
    apiEndpoint: getOutput('ApiEndpoint'),
    platformUrl: getOutput('PlatformUrl'),
    userPoolId: getOutput('UserPoolId'),
    userPoolClientId: getOutput('UserPoolClientId'),
    cognitoDomain: getOutput('CognitoDomain'),
    fileSystemId: getOutput('FileSystemId'),
    tenantsTableName: getOutput('TenantsTableName'),
    permissionsTableName: getOutput('PermissionsTableName'),
    appsBucketName: getOutput('AppsBucketName'),
    distributionId: getOutput('DistributionId'),
    taskStateMachineArn: getOutput('TaskStateMachineArn'),
    dataflowStateMachineArn: getOutput('DataflowStateMachineArn'),
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
