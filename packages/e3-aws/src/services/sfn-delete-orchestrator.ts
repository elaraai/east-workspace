/**
 * Copyright (c) 2025 Elara AI Pty Ltd. All rights reserved.
 * Proprietary and confidential.
 *
 * AWS Step Functions implementation of DeleteOrchestrator.
 */

import { SFNClient, StartExecutionCommand, DescribeExecutionCommand } from '@aws-sdk/client-sfn';
import { uuidv7 } from '@elaraai/e3-core';
import type { DeleteOrchestrator, DeletionStatus } from '@elaraai/e3-cloud-core';

export class SfnDeleteOrchestrator implements DeleteOrchestrator {
  constructor(
    private readonly sfn: SFNClient,
    private readonly deleteStateMachineArn: string,
  ) {}

  async startDeletion(params: { repo: string }): Promise<string> {
    const executionName = `delete-${uuidv7()}-${params.repo}`.slice(0, 80);
    await this.sfn.send(
      new StartExecutionCommand({
        stateMachineArn: this.deleteStateMachineArn,
        name: executionName,
        input: JSON.stringify({ repo: params.repo }),
      })
    );
    return executionName;
  }

  async getDeletionStatus(executionId: string): Promise<DeletionStatus> {
    const arnParts = this.deleteStateMachineArn.split(':');
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
      case 'SUCCEEDED':
        return { status: 'succeeded' };
      case 'FAILED':
      case 'TIMED_OUT':
      case 'ABORTED': {
        const errorMessage = execution.error
          ? `${execution.error}: ${execution.cause ?? ''}`
          : `Deletion ${execution.status.toLowerCase()}`;
        return { status: 'failed', error: errorMessage };
      }
      default:
        return { status: 'running' };
    }
  }
}
