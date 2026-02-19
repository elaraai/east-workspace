/**
 * Copyright (c) 2025 Elara AI Pty Ltd. All rights reserved.
 * Proprietary and confidential.
 */

/**
 * Storage interface for Fargate compute task results.
 *
 * When a task runs on Fargate (non-serverless compute), the container writes
 * its result to this store before exiting. A separate Lambda handler then reads
 * and deletes the result to pass it back through the Step Functions state machine.
 *
 * Implementations:
 * - DynamoComputeResultStore (e3-aws-storage) - DynamoDB-backed
 * - InMemoryComputeResultStore (e3-cloud-core/testing) - In-memory for testing
 */
export interface ComputeResultStore {
  /** Write a task execution result. */
  write(repo: string, workspace: string, taskExecutionId: string, result: string): Promise<void>;

  /** Read a task execution result (returns null if not found). */
  read(repo: string, workspace: string, taskExecutionId: string): Promise<string | null>;

  /** Delete a task execution result. */
  delete(repo: string, workspace: string, taskExecutionId: string): Promise<void>;
}
