/**
 * Copyright (c) 2025 Elara AI Pty Ltd. All rights reserved.
 * Proprietary and confidential.
 *
 * AWS Step Functions implementation of DataflowOrchestrator.
 */

import { SFNClient, StartExecutionCommand } from '@aws-sdk/client-sfn';
import { uuidv7 } from '@elaraai/e3-core';
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
    triggeredBy?: { type: string; value: unknown };
  }): Promise<string> {
    const executionName = `dataflow-${uuidv7()}-${params.repo}-${params.workspace}`.slice(0, 80);

    const input: Record<string, unknown> = {
      repo: params.repo,
      workspace: params.workspace,
      executionId: params.executionId,
      force: params.force,
      forceTasks: params.forceTasks,
      filter: params.filter,
      runId: params.runId,
    };
    if (params.triggeredBy) {
      input.triggeredBy = params.triggeredBy;
    }

    await this.sfn.send(
      new StartExecutionCommand({
        stateMachineArn: this.stateMachineArn,
        name: executionName,
        input: JSON.stringify(input),
      })
    );

    return executionName;
  }
}
