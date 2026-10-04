/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Licensed under BSL 1.1. See LICENSE for details.
 */

/**
 * The repository upgrade that indexes each task's runs: every store keeps an
 * index of each task's runs — its own attempts, never a split task's units —
 * which its `executionWrite` keeps (`RefStore.executionListRuns`), so a task's
 * history and its logs read a page of what it ran, not every attempt it made.
 *
 * A record an earlier release wrote is in no index, so the step writes each
 * run's record again, through the store, which indexes it as it writes it. A
 * unit's record is left as it is. An e3 from before the index would record a
 * run without indexing it, so it refuses a repository that has had the step,
 * as it refuses any step it does not know.
 *
 * @packageDocumentation
 */

import { OBJECT_CONCURRENCY } from '../concurrency.js';
import type { RepositoryUpgrade } from '../storage/interfaces.js';
import { workInParts } from './parts.js';

/** The name a repository's record keeps once the upgrade is applied. */
export const TASK_RUNS_INDEXED = 'task-runs-indexed';

/**
 * Writes every run's record of a repository again, through the store, which
 * indexes it.
 *
 * @remarks
 * Each task's inputs' attempts are read in one call
 * (`RefStore.executionListAttempts`), so the upgrade goes through every
 * backend's stores alike. A record that does not decode, which a crash or a
 * failing disk left, is left as it is, as is a unit's. A run indexed already
 * is written again as it is, which leaves it so: a step a crash cut short runs
 * its part again.
 *
 * A unit of the step is a task's inputs: every attempt recorded under them.
 * The units go in the order of their keys, `<taskHash>/<inputsHash>`,
 * {@link OBJECT_CONCURRENCY} at once, and a part stops between batches once
 * its time is up, with the key of the last unit it indexed as its cursor.
 */
export const taskRunsIndexed: RepositoryUpgrade = {
  name: TASK_RUNS_INDEXED,
  async apply(storage, repo, at, until) {
    const { refs } = storage;
    const units = (await refs.executionList(repo)).map((execution) => ({
      key: `${execution.taskHash}/${execution.inputsHash}`,
      unit: execution,
    }));
    return workInParts(units, at, until, OBJECT_CONCURRENCY, async ({ taskHash, inputsHash }) => {
      for (const { executionId, status } of await refs.executionListAttempts(repo, taskHash, inputsHash)) {
        if (status !== null && !status.value.unit) await refs.executionWrite(repo, taskHash, inputsHash, executionId, status);
      }
    });
  },
};
