/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Licensed under BSL 1.1. See LICENSE for details.
 */

/**
 * Shared formatting utilities for CLI commands.
 */

import type { RequeueReason, StageUnit } from '@elaraai/e3-types';

/**
 * Format a byte count as a human-readable string.
 *
 * @param bytes - Size in bytes
 * @returns Formatted string like "42 B", "1.5 KB", "1 MB"
 */
export function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  const units = ['KB', 'MB', 'GB', 'TB'];
  let value = bytes;
  for (const unit of units) {
    value /= 1024;
    if (value < 1024 || unit === 'TB') {
      const formatted = value % 1 === 0 ? value.toFixed(0) : value.toFixed(1);
      return `${formatted} ${unit}`;
    }
  }
  // unreachable, but TypeScript needs it
  return `${bytes} B`;
}

/**
 * A requeued unit as a run prints it: `piece 3/8: the guard stopped it at
 * 620 MB, past the budget; it runs again reserving 620 MB`.
 *
 * @param unit - The unit, by its place in its task
 * @param reason - Why its runner was stopped
 * @param peak - The most it was measured using, in bytes: for a cap, the cap
 * @param reserves - The memory it reserves when it runs again, in bytes
 * @returns The text
 */
export function formatRequeue(unit: StageUnit, reason: RequeueReason['type'], peak: number, reserves: number): string {
  const place = unit.merge.type === 'none'
    ? `piece ${unit.index + 1n}/${unit.units}`
    : `merge level ${unit.merge.value.level}/${unit.merge.value.levels} unit ${unit.index + 1n}/${unit.units}`;
  const cause = reason === 'cap'
    ? `it outgrew its cap of ${formatSize(peak)}`
    : `the guard stopped it at ${formatSize(peak)}, ${reason === 'budget' ? 'past the budget' : 'with the machine nearly out of memory'}`;
  return `${place}: ${cause}; it runs again reserving ${formatSize(reserves)}`;
}

