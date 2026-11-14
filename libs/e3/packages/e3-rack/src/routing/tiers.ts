/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Licensed under BSL 1.1. See LICENSE for details.
 */

import { STOCK_PLATFORMS_BY_RUNNER } from '@elaraai/e3';
import type { RunnerValue } from '@elaraai/e3-types';

/** Stock runtime images available to rack agents. */
export type RackTier = 'node' | 'py' | 'py-datascience' | 'c';
/**
 * A stable reason an execution stays on the local host. An `environment:`
 * reason says why the environment the task declares cannot go to a rack:
 * its kind (`tools`, `image`), the launching machine (`windows-host`), or
 * what its build for the rack's platform was refused or failed of
 * (`no-wheel:<package>`, `native-package:<package>`, `pnpm`, `build-failed`).
 */
export type IneligibleReason = 'no-task-name' | 'not-selected' | 'custom-runner' | 'gpu-not-east-py'
  | `environment:${string}` | `non-stock-platform:${string}` | `host-coupled:${string}` | 'unscannable';

/** What a task asks of a rack beyond its runner. */
export interface RackTierAsks {
  /** Whether the task declares an environment, which carries the platform
   *  packages its runner names */
  environment?: boolean;
  /** Whether its rule asks for a rack's GPU */
  gpu?: boolean;
}

/**
 * Chooses the runtime image a task's work runs over, refusing a
 * project-specific command, and a platform package a rack has nowhere to
 * find: one named by a task that declares no environment.
 *
 * A task's tier is its runner's. An `east-py` task runs on `py-datascience`
 * when its platforms name `east-py-datascience`, or its rule asks for a GPU:
 * the tier a rack gives its GPU to. Only an `east-py` task may ask for one.
 *
 * @param runner - The task's wire runner
 * @param asks - Whether the task declares an environment, and asks for a GPU
 * @returns Its tier, or the reason it cannot run on the rack
 * @example
 * const route = rackTierFor(task.runner, { environment: task.environment.type === 'some' });
 */
export function rackTierFor(runner: RunnerValue, asks: RackTierAsks = {}): { tier: RackTier } | { ineligible: IneligibleReason } {
  if (runner.type === 'custom') return { ineligible: 'custom-runner' };
  if (asks.gpu === true && runner.type !== 'east_py') return { ineligible: 'gpu-not-east-py' };
  if (asks.environment !== true) {
    const stock: readonly string[] = STOCK_PLATFORMS_BY_RUNNER[runner.type];
    const unknown = runner.value.platforms.find((name) => !stock.includes(name));
    if (unknown !== undefined) return { ineligible: `non-stock-platform:${unknown}` };
  }
  switch (runner.type) {
    case 'east_node': return { tier: 'node' };
    case 'east_c': return { tier: 'c' };
    case 'east_py': return { tier: asks.gpu === true || runner.value.platforms.includes('east-py-datascience') ? 'py-datascience' : 'py' };
  }
}
