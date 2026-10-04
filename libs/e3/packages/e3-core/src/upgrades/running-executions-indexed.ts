/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Licensed under BSL 1.1. See LICENSE for details.
 */

/**
 * The repository upgrade that indexes the executions recorded running: every
 * store keeps an index of the attempts recorded running, which its
 * `executionWrite` keeps (`RefStore.executionListRunning`), so a workspace's
 * status reads what runs, not every attempt its tasks ever made.
 *
 * A record an earlier release wrote running is in no index, so the step
 * writes it again, through the store, which indexes it as it writes it. Every
 * other record is left as it is. An e3 from before the index would record an
 * attempt running without indexing it, so it refuses a repository that has
 * had the step, as it refuses any step it does not know.
 *
 * @packageDocumentation
 */

import type { ExecutionStatus } from '@elaraai/e3-types';
import { OBJECT_CONCURRENCY } from '../concurrency.js';
import { ExecutionCorruptError } from '../errors.js';
import type { RepositoryUpgrade } from '../storage/interfaces.js';
import { workInParts } from './parts.js';

/** The name a repository's record keeps once the upgrade is applied. */
export const RUNNING_EXECUTIONS_INDEXED = 'running-executions-indexed';

/**
 * Writes every execution record of a repository that is recorded running
 * again, through the store, which indexes it.
 *
 * @remarks
 * Every attempt's record is read (`RefStore.executionGet`), so the upgrade
 * goes through every backend's stores alike. A record that does not decode,
 * which a crash or a failing disk left, is left as it is, as is every record
 * of an attempt that ended. A record indexed already is written again as it
 * is, which leaves it so: a step a crash cut short runs its part again.
 *
 * A unit of the step is a task's inputs: every attempt recorded under them.
 * The units go in the order of their keys, `<taskHash>/<inputsHash>`,
 * {@link OBJECT_CONCURRENCY} at once, and a part stops between batches once
 * its time is up, with the key of the last unit it indexed as its cursor.
 */
export const runningExecutionsIndexed: RepositoryUpgrade = {
  name: RUNNING_EXECUTIONS_INDEXED,
  async apply(storage, repo, at, until) {
    const { refs } = storage;
    const units = (await refs.executionList(repo)).map((execution) => ({
      key: `${execution.taskHash}/${execution.inputsHash}`,
      unit: execution,
    }));
    return workInParts(units, at, until, OBJECT_CONCURRENCY, async ({ taskHash, inputsHash }) => {
      for (const executionId of await refs.executionListIds(repo, taskHash, inputsHash)) {
        let status: ExecutionStatus | null;
        try {
          status = await refs.executionGet(repo, taskHash, inputsHash, executionId);
        } catch (err) {
          if (err instanceof ExecutionCorruptError) continue;
          throw err;
        }
        if (status?.type === 'running') await refs.executionWrite(repo, taskHash, inputsHash, executionId, status);
      }
    });
  },
};
