/**
 * Integration tests for AWS services (DynamoDB, EFS, Cognito, Step Functions).
 *
 * These tests validate that the AWS resources are created and accessible.
 */

import { describe, it, expect, beforeAll } from 'vitest';
import { DynamoDBClient, DescribeTableCommand } from '@aws-sdk/client-dynamodb';
import { EFSClient, DescribeFileSystemsCommand } from '@aws-sdk/client-efs';
import {
  CognitoIdentityProviderClient,
  DescribeUserPoolCommand,
} from '@aws-sdk/client-cognito-identity-provider';
import { SFNClient, DescribeStateMachineCommand } from '@aws-sdk/client-sfn';
import { getStackOutputs, getDeploymentId, type StackOutputs } from '../utils/stack-outputs.js';

describe('AWS Services Integration Tests', () => {
  let outputs: StackOutputs;
  const deploymentId = getDeploymentId();
  const region = process.env.AWS_REGION ?? 'ap-southeast-2';

  beforeAll(async () => {
    outputs = await getStackOutputs(deploymentId);
  }, 30000);

  describe('DynamoDB Tables', () => {
    const dynamodb = new DynamoDBClient({ region });

    it('should have tenants table', async () => {
      const command = new DescribeTableCommand({
        TableName: outputs.tenantsTableName,
      });

      const response = await dynamodb.send(command);

      expect(response.Table).toBeDefined();
      expect(response.Table?.TableStatus).toBe('ACTIVE');
      expect(response.Table?.KeySchema).toContainEqual({
        AttributeName: 'PK',
        KeyType: 'HASH',
      });
    });

    it('should have permissions table with GSI', async () => {
      const command = new DescribeTableCommand({
        TableName: outputs.permissionsTableName,
      });

      const response = await dynamodb.send(command);

      expect(response.Table).toBeDefined();
      expect(response.Table?.TableStatus).toBe('ACTIVE');

      // Check for TenantIndex GSI
      const gsi = response.Table?.GlobalSecondaryIndexes?.find(
        (idx) => idx.IndexName === 'TenantIndex'
      );
      expect(gsi).toBeDefined();
      expect(gsi?.IndexStatus).toBe('ACTIVE');
    });
  });

  describe('EFS FileSystem', () => {
    const efs = new EFSClient({ region });

    it('should have filesystem', async () => {
      const command = new DescribeFileSystemsCommand({
        FileSystemId: outputs.fileSystemId,
      });

      const response = await efs.send(command);

      expect(response.FileSystems).toHaveLength(1);
      expect(response.FileSystems?.[0].LifeCycleState).toBe('available');
      expect(response.FileSystems?.[0].Encrypted).toBe(true);
    });
  });

  describe('Cognito User Pool', () => {
    const cognito = new CognitoIdentityProviderClient({ region });

    it('should have user pool', async () => {
      const command = new DescribeUserPoolCommand({
        UserPoolId: outputs.userPoolId,
      });

      const response = await cognito.send(command);

      expect(response.UserPool).toBeDefined();
      expect(response.UserPool?.Status).toBe('Enabled');
    });

    it('should have correct password policy', async () => {
      const command = new DescribeUserPoolCommand({
        UserPoolId: outputs.userPoolId,
      });

      const response = await cognito.send(command);
      const policy = response.UserPool?.Policies?.PasswordPolicy;

      expect(policy?.MinimumLength).toBeGreaterThanOrEqual(12);
      expect(policy?.RequireLowercase).toBe(true);
      expect(policy?.RequireUppercase).toBe(true);
      expect(policy?.RequireNumbers).toBe(true);
      expect(policy?.RequireSymbols).toBe(true);
    });
  });

  describe('Step Functions', () => {
    const sfn = new SFNClient({ region });

    it('should have task execution state machine', async () => {
      const command = new DescribeStateMachineCommand({
        stateMachineArn: outputs.taskStateMachineArn,
      });

      const response = await sfn.send(command);

      expect(response.status).toBe('ACTIVE');
      expect(response.name).toContain('task-execution');
    });

    it('should have dataflow state machine', async () => {
      const command = new DescribeStateMachineCommand({
        stateMachineArn: outputs.dataflowStateMachineArn,
      });

      const response = await sfn.send(command);

      expect(response.status).toBe('ACTIVE');
      expect(response.name).toContain('dataflow');
    });
  });
});
