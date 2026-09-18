/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Licensed under BSL 1.1. See LICENSE for details.
 */

/**
 * The `--jobs` flag: the runner processes a local run keeps in flight at
 * once, across the dataflow's tasks and the units of its partitioned tasks.
 */

import { defaultJobs } from '@elaraai/e3-core';
import { exitError } from '../utils.js';

/** The flags that name a jobs budget. */
export interface JobsFlags {
  /** `--jobs <n>` / `-j <n>`. */
  jobs?: string;
  /** Deprecated `--concurrency <n>`: the same budget. */
  concurrency?: string;
  /** Deprecated `--partition-concurrency <n>`: the same budget. */
  partitionConcurrency?: string;
}

/**
 * Resolves the jobs budget of a run: `--jobs`, else a deprecated alias (with
 * a warning), else `E3_JOBS`, else the CPUs available to e3.
 *
 * A value that is not a positive integer is an argument error: NaN would
 * launch nothing and die later as "Dataflow stuck".
 *
 * @param flags - The parsed flags
 * @returns The budget, a positive integer
 */
export function resolveJobs(flags: JobsFlags): number {
  const given: [name: string, raw: string] | null =
    flags.jobs !== undefined ? ['--jobs', flags.jobs]
      : flags.concurrency !== undefined ? ['--concurrency', flags.concurrency]
        : flags.partitionConcurrency !== undefined ? ['--partition-concurrency', flags.partitionConcurrency]
          : process.env.E3_JOBS !== undefined && process.env.E3_JOBS !== '' ? ['E3_JOBS', process.env.E3_JOBS]
            : null;
  if (given === null) return defaultJobs();
  const [name, raw] = given;
  const jobs = Number(raw.trim());
  if (!Number.isInteger(jobs) || jobs < 1) {
    exitError(`${name} must be a positive integer, got '${raw}'`);
  }
  if (name === '--concurrency' || name === '--partition-concurrency') {
    console.error(`Warning: ${name} is deprecated — use --jobs (-j), one budget for tasks and partition units alike`);
  }
  return jobs;
}
