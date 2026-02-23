/**
 * Copyright (c) 2025 Elara AI Pty Ltd. All rights reserved.
 * Proprietary and confidential.
 */

import type { ComputeSize } from '@elaraai/e3-cloud-types';

/**
 * Cloud-agnostic interface for dispatching compute tasks.
 *
 * Implementations handle the specifics of launching tasks on
 * different compute backends (e.g., ECS Fargate, Azure Container Instances).
 */
export interface ComputeDispatcher {
  dispatch(params: {
    repo: string;
    workspace: string;
    executionId: number;
    taskName: string;
    taskHash: string;
    computeSize: ComputeSize;
    timeout: number;
  }): Promise<{ ref: string }>;
}
