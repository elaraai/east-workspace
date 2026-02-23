/**
 * Copyright (c) 2025 Elara AI Pty Ltd. All rights reserved.
 * Proprietary and confidential.
 *
 * AWS Step Functions implementation of GcOrchestrator.
 */

import { SFNClient, StartExecutionCommand, DescribeExecutionCommand } from '@aws-sdk/client-sfn';
import type { GcOrchestrator, GcStatus } from '@elaraai/e3-cloud-core';

export class SfnGcOrchestrator implements GcOrchestrator {
  constructor(
    private readonly sfn: SFNClient,
    private readonly gcStateMachineArn: string,
  ) {}

  async startGc(params: { repo: string; gcId: string; startTime: number }): Promise<string> {
    const executionName = `gc-${params.repo}-${params.gcId}`;
    await this.sfn.send(
      new StartExecutionCommand({
        stateMachineArn: this.gcStateMachineArn,
        name: executionName,
        input: JSON.stringify({ repo: params.repo, gcId: params.gcId, startTime: params.startTime, jitterSeconds: 0 }),
      })
    );
    return executionName;
  }

  async getGcStatus(executionId: string): Promise<GcStatus> {
    // Construct execution ARN from state machine ARN and execution name
    const arnParts = this.gcStateMachineArn.split(':');
    const region = arnParts[3];
    const account = arnParts[4];
    const stateMachineName = arnParts[6];
    const executionArn = `arn:aws:states:${region}:${account}:execution:${stateMachineName}:${executionId}`;

    let execution;
    try {
      execution = await this.sfn.send(
        new DescribeExecutionCommand({ executionArn })
      );
    } catch (err: any) {
      if (err.name === 'ExecutionDoesNotExist') {
        return { status: 'not_found' };
      }
      throw err;
    }

    switch (execution.status) {
      case 'RUNNING':
        return { status: 'running' };

      case 'SUCCEEDED': {
        if (execution.output) {
          const output = JSON.parse(execution.output);

          if (output.success === false) {
            const errorMsg = output.error ?? (output.status
              ? `GC skipped - repo is in '${output.status}' state`
              : 'GC skipped - repo not in valid state');
            return { status: 'failed', error: errorMsg };
          }

          if (output.stats) {
            return {
              status: 'succeeded',
              stats: {
                deletedObjects: output.stats.deletedObjects ?? 0,
                retainedObjects: output.stats.retainedObjects ?? 0,
                skippedYoung: output.stats.skippedYoung ?? 0,
                bytesFreed: output.stats.bytesFreed ?? 0,
              },
            };
          }
        }
        return { status: 'succeeded' };
      }

      case 'FAILED':
      case 'TIMED_OUT':
      case 'ABORTED': {
        const errorMessage = execution.error
          ? `${execution.error}: ${execution.cause ?? ''}`
          : `GC ${execution.status.toLowerCase()}`;
        return { status: 'failed', error: errorMessage };
      }

      default:
        return { status: 'running' };
    }
  }
}
