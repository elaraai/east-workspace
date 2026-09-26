/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Licensed under BSL 1.1. See LICENSE for details.
 */

/**
 * The budget of a command that runs units: the cores and the memory its
 * runner processes take from — a dataflow's tasks and the units of its
 * partitioned tasks, a function call, a mutation, an index build.
 */

import { configureFramePool } from '@elaraai/east';
import { DOOR_FRAME_WORKERS, resolveBudget, type Budget } from '@elaraai/e3-core';
import { exitError } from '../utils.js';

/** The flags that name a budget. */
export interface BudgetFlags {
  /** `--jobs <n>` / `-j <n>`: the cores. */
  jobs?: string;
  /** `--memory <size>`: the memory. */
  memory?: string;
}

/**
 * Resolves a command's budget — each of `--jobs` and `--memory`, else
 * `E3_JOBS` and `E3_MEMORY`, else what this process may use — and caps e3's
 * own frame pool, the one the store door frames on, from it.
 *
 * A value that is not a positive integer of cores or a memory size is an
 * argument error: NaN would launch nothing and die later as "Dataflow stuck".
 *
 * @param flags - The parsed flags, when the command takes them
 * @returns The budget
 */
export function commandBudget(flags: BudgetFlags = {}): Budget {
  let budget: Budget;
  try {
    budget = resolveBudget(flags);
  } catch (err) {
    exitError(err instanceof Error ? err.message : String(err));
  }
  configureFramePool({ workers: Math.min(DOOR_FRAME_WORKERS, budget.cores) });
  return budget;
}

/**
 * Refuses `-j` and `--memory` against a server, whose own budget runs the
 * work.
 *
 * @param flags - The parsed flags
 */
export function refuseRemoteBudget(flags: BudgetFlags): void {
  if (flags.jobs !== undefined || flags.memory !== undefined) {
    exitError("-j and --memory budget a local repository's runners: a server runs the work under its own budget");
  }
}
