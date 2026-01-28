/**
 * Copyright (c) 2025 Elara AI Pty Ltd. All rights reserved.
 * Proprietary and confidential.
 *
 * Integration tests for AWS services (S3, DynamoDB, Cognito, Step Functions).
 *
 * These tests validate that the AWS resources are created and accessible.
 */

import { describe, it, before } from 'node:test';
import assert from 'node:assert/strict';
import { S3Client, HeadBucketCommand } from '@aws-sdk/client-s3';
import { DynamoDBClient, DescribeTableCommand } from '@aws-sdk/client-dynamodb';
import {
  CognitoIdentityProviderClient,
  DescribeUserPoolCommand,
} from '@aws-sdk/client-cognito-identity-provider';
import { SFNClient, DescribeStateMachineCommand } from '@aws-sdk/client-sfn';
import { getStackOutputs, getDeploymentId, type StackOutputs } from './helpers/stack-outputs.js';

describe('AWS Services Integration Tests', { timeout: 60000 }, () => {
  let outputs: StackOutputs;
  const deploymentId = getDeploymentId();
  const region = process.env.AWS_REGION ?? 'ap-southeast-2';

  before(async () => {
    outputs = await getStackOutputs(deploymentId);
  });

  describe('S3 Buckets', () => {
    const s3 = new S3Client({ region });

    it('should have data bucket', async () => {
      const command = new HeadBucketCommand({
        Bucket: outputs.dataBucketName,
      });

      // HeadBucket returns 200 if bucket exists and is accessible
      const response = await s3.send(command);
      assert.strictEqual(response.$metadata.httpStatusCode, 200);
    });

    it('should have apps bucket', async () => {
      const command = new HeadBucketCommand({
        Bucket: outputs.appsBucketName,
      });

      const response = await s3.send(command);
      assert.strictEqual(response.$metadata.httpStatusCode, 200);
    });
  });

  describe('DynamoDB Tables', () => {
    const dynamodb = new DynamoDBClient({ region });

    it('should have data table', async () => {
      const command = new DescribeTableCommand({
        TableName: outputs.dataTableName,
      });

      const response = await dynamodb.send(command);

      assert.ok(response.Table !== undefined, 'Table should be defined');
      assert.strictEqual(response.Table?.TableStatus, 'ACTIVE');
    });

    it('should have correct key schema', async () => {
      const command = new DescribeTableCommand({
        TableName: outputs.dataTableName,
      });

      const response = await dynamodb.send(command);
      const keySchema = response.Table?.KeySchema ?? [];

      // Single-table design: PK (partition key), SK (sort key)
      const hasPK = keySchema.some(
        (k) => k.AttributeName === 'PK' && k.KeyType === 'HASH'
      );
      const hasSK = keySchema.some(
        (k) => k.AttributeName === 'SK' && k.KeyType === 'RANGE'
      );

      assert.ok(hasPK, 'KeySchema should have PK as HASH key');
      assert.ok(hasSK, 'KeySchema should have SK as RANGE key');
    });
  });

  describe('Cognito User Pool', () => {
    const cognito = new CognitoIdentityProviderClient({ region });

    it('should have user pool', async () => {
      const command = new DescribeUserPoolCommand({
        UserPoolId: outputs.userPoolId,
      });

      const response = await cognito.send(command);

      assert.ok(response.UserPool !== undefined, 'UserPool should be defined');
      assert.strictEqual(response.UserPool?.Id, outputs.userPoolId);
      assert.ok(response.UserPool?.Name !== undefined, 'UserPool Name should be defined');
    });

    it('should have correct password policy', async () => {
      const command = new DescribeUserPoolCommand({
        UserPoolId: outputs.userPoolId,
      });

      const response = await cognito.send(command);
      const policy = response.UserPool?.Policies?.PasswordPolicy;

      assert.ok(
        (policy?.MinimumLength ?? 0) >= 12,
        `MinimumLength should be >= 12, got ${policy?.MinimumLength}`
      );
      assert.strictEqual(policy?.RequireLowercase, true);
      assert.strictEqual(policy?.RequireUppercase, true);
      assert.strictEqual(policy?.RequireNumbers, true);
      assert.strictEqual(policy?.RequireSymbols, true);
    });
  });

  describe('Step Functions State Machines', () => {
    const sfn = new SFNClient({ region });

    it('should have task execution state machine', async () => {
      const command = new DescribeStateMachineCommand({
        stateMachineArn: outputs.taskStateMachineArn,
      });

      const response = await sfn.send(command);

      assert.strictEqual(response.status, 'ACTIVE');
      assert.ok(
        response.name?.includes('task-execution'),
        `State machine name should contain 'task-execution', got ${response.name}`
      );
    });

    it('should have dataflow state machine', async () => {
      const command = new DescribeStateMachineCommand({
        stateMachineArn: outputs.dataflowStateMachineArn,
      });

      const response = await sfn.send(command);

      assert.strictEqual(response.status, 'ACTIVE');
      assert.ok(
        response.name?.includes('dataflow'),
        `State machine name should contain 'dataflow', got ${response.name}`
      );
    });

    it('should have GC state machine', async () => {
      const command = new DescribeStateMachineCommand({
        stateMachineArn: outputs.gcStateMachineArn,
      });

      const response = await sfn.send(command);

      assert.strictEqual(response.status, 'ACTIVE');
      assert.ok(
        response.name?.includes('gc'),
        `State machine name should contain 'gc', got ${response.name}`
      );
    });
  });

  describe('Resource Naming', () => {
    it('should use consistent deployment prefix', () => {
      // All resources should include the deployment ID for isolation
      assert.ok(
        outputs.dataBucketName.includes(deploymentId),
        `dataBucketName should contain ${deploymentId}`
      );
      assert.ok(
        outputs.dataTableName.includes(deploymentId),
        `dataTableName should contain ${deploymentId}`
      );
      assert.ok(
        outputs.taskStateMachineArn.includes(deploymentId),
        `taskStateMachineArn should contain ${deploymentId}`
      );
      assert.ok(
        outputs.dataflowStateMachineArn.includes(deploymentId),
        `dataflowStateMachineArn should contain ${deploymentId}`
      );
      assert.ok(
        outputs.gcStateMachineArn.includes(deploymentId),
        `gcStateMachineArn should contain ${deploymentId}`
      );
    });
  });
});
