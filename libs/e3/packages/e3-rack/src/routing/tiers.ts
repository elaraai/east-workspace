/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Licensed under BSL 1.1. See LICENSE for details.
 */

import { STOCK_PLATFORMS_BY_RUNNER } from '@elaraai/e3';
import type { RunnerValue } from '@elaraai/e3-types';

/** Stock runtime images available to rack agents. */
export type RackTier = 'node' | 'py' | 'py-datascience' | 'c';
/** A stable reason an execution stays on the local host. */
export type IneligibleReason = 'no-task-name' | 'not-selected' | 'environment' | 'custom-runner'
  | `non-stock-platform:${string}` | `host-coupled:${string}` | 'unscannable';

/**
 * Chooses a stock runtime image, refusing project-specific commands/packages.
 * @param runner - The task's wire runner
 * @returns Its tier, or the reason it cannot run on the rack
 * @example
 * const route = rackTierFor(task.runner);
 */
export function rackTierFor(runner: RunnerValue): { tier: RackTier } | { ineligible: IneligibleReason } {
  if (runner.type === 'custom') return { ineligible: 'custom-runner' };
  const stock: readonly string[] = STOCK_PLATFORMS_BY_RUNNER[runner.type];
  const unknown = runner.value.platforms.find((name) => !stock.includes(name));
  if (unknown !== undefined) return { ineligible: `non-stock-platform:${unknown}` };
  switch (runner.type) {
    case 'east_node': return { tier: 'node' };
    case 'east_c': return { tier: 'c' };
    case 'east_py': return { tier: runner.value.platforms.includes('east-py-datascience') ? 'py-datascience' : 'py' };
  }
}
