/**
 * Copyright (c) 2025 Elara AI Pty Ltd. All rights reserved.
 * Proprietary and confidential.
 *
 * AWS Step Functions implementation of DataflowOrchestrator.
 */

import { SFNClient, StartExecutionCommand } from '@aws-sdk/client-sfn';
import { randomUUID } from 'node:crypto';
import type { DataflowOrchestrator } from '@elaraai/e3-cloud-core';

export class SfnDataflowOrchestrator implements DataflowOrchestrator {
  constructor(
    private readonly sfn: SFNClient,
    private readonly stateMachineArn: string,
  ) {}

  async startExecution(params: {
    repo: string;
    workspace: string;
    executionId: number;
    force: boolean;
    forceTasks: string[];
    filter?: string;
    runId: string;
  }): Promise<string> {
    const sfnExecutionId = randomUUID();
    const executionName = `dataflow-${params.repo}-${params.workspace}-${sfnExecutionId}`.slice(0, 80);

    await this.sfn.send(
      new StartExecutionCommand({
        stateMachineArn: this.stateMachineArn,
        name: executionName,
        input: JSON.stringify({
          repo: params.repo,
          workspace: params.workspace,
          executionId: params.executionId,
          force: params.force,
          forceTasks: params.forceTasks,
          filter: params.filter,
          runId: params.runId,
        }),
      })
    );

    return executionName;
  }
}
