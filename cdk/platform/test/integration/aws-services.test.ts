/**
 * Integration tests for AWS services (S3, DynamoDB, Cognito, Step Functions).
 *
 * These tests validate that the AWS resources are created and accessible.
 */

import { describe, it, expect, beforeAll } from 'vitest';
import { S3Client, HeadBucketCommand } from '@aws-sdk/client-s3';
import { DynamoDBClient, DescribeTableCommand } from '@aws-sdk/client-dynamodb';
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

  describe('S3 Buckets', () => {
    const s3 = new S3Client({ region });

    it('should have data bucket', async () => {
      const command = new HeadBucketCommand({
        Bucket: outputs.dataBucketName,
      });

      // HeadBucket returns 200 if bucket exists and is accessible
      const response = await s3.send(command);
      expect(response.$metadata.httpStatusCode).toBe(200);
    });

    it('should have apps bucket', async () => {
      const command = new HeadBucketCommand({
        Bucket: outputs.appsBucketName,
      });

      const response = await s3.send(command);
      expect(response.$metadata.httpStatusCode).toBe(200);
    });
  });

  describe('DynamoDB Tables', () => {
    const dynamodb = new DynamoDBClient({ region });

    it('should have data table', async () => {
      const command = new DescribeTableCommand({
        TableName: outputs.dataTableName,
      });

      const response = await dynamodb.send(command);

      expect(response.Table).toBeDefined();
      expect(response.Table?.TableStatus).toBe('ACTIVE');
    });

    it('should have correct key schema', async () => {
      const command = new DescribeTableCommand({
        TableName: outputs.dataTableName,
      });

      const response = await dynamodb.send(command);

      // Single-table design: PK (partition key), SK (sort key)
      expect(response.Table?.KeySchema).toContainEqual({
        AttributeName: 'PK',
        KeyType: 'HASH',
      });
      expect(response.Table?.KeySchema).toContainEqual({
        AttributeName: 'SK',
        KeyType: 'RANGE',
      });
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
      expect(response.UserPool?.Id).toBe(outputs.userPoolId);
      expect(response.UserPool?.Name).toBeDefined();
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

  describe('Step Functions State Machines', () => {
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

    it('should have delete repo state machine', async () => {
      const command = new DescribeStateMachineCommand({
        stateMachineArn: outputs.deleteRepoStateMachineArn,
      });

      const response = await sfn.send(command);

      expect(response.status).toBe('ACTIVE');
      expect(response.name).toContain('delete-repo');
    });

    it('should have GC state machine', async () => {
      const command = new DescribeStateMachineCommand({
        stateMachineArn: outputs.gcStateMachineArn,
      });

      const response = await sfn.send(command);

      expect(response.status).toBe('ACTIVE');
      expect(response.name).toContain('gc');
    });
  });

  describe('Resource Naming', () => {
    it('should use consistent deployment prefix', () => {
      // All resources should include the deployment ID for isolation
      expect(outputs.dataBucketName).toContain(deploymentId);
      expect(outputs.dataTableName).toContain(deploymentId);
      expect(outputs.taskStateMachineArn).toContain(deploymentId);
      expect(outputs.dataflowStateMachineArn).toContain(deploymentId);
      expect(outputs.deleteRepoStateMachineArn).toContain(deploymentId);
      expect(outputs.gcStateMachineArn).toContain(deploymentId);
    });
  });
});
