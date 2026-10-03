/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Licensed under BSL 1.1. See LICENSE for details.
 */

/**
 * The local server's dataflow wiring: a LocalOrchestrator for each repository
 * it serves, over the repository's run state store — a local repository's
 * file per workspace. The dataflow routes run, poll and cancel a repository's
 * dataflows through them, as a cloud's routes do through its own.
 */

import {
  LocalOrchestrator,
  type DataflowOrchestrator,
  type ExecutionStateStore,
  type StorageBackend,
} from '@elaraai/e3-core';
import type { DataflowSeams } from './routes/executions.js';

/**
 * The orchestrator and state store of each repository a local server serves,
 * each made as its repository is first asked for and kept for the server's
 * life, so a poll or a cancel reaches the run its start began.
 *
 * @remarks
 * The state store is the backend's own (`StorageBackend.runStates`), so the
 * runs the orchestrator keeps are the ones a repository upgrade carries
 * forward.
 *
 * @param storage - The server's storage backend
 * @returns The seams' getters, for the dataflow routes
 */
export function localDataflow(storage: StorageBackend): Pick<DataflowSeams, 'getOrchestrator' | 'getStateStore'> {
  const stateStores = new Map<string, ExecutionStateStore>();
  const orchestrators = new Map<string, LocalOrchestrator>();

  const getStateStore = (repoPath: string): ExecutionStateStore => {
    let store = stateStores.get(repoPath);
    if (store === undefined) {
      store = storage.runStates(repoPath);
      stateStores.set(repoPath, store);
    }
    return store;
  };

  const getOrchestrator = (repoPath: string): DataflowOrchestrator => {
    let orchestrator = orchestrators.get(repoPath);
    if (orchestrator === undefined) {
      orchestrator = new LocalOrchestrator(getStateStore(repoPath));
      orchestrators.set(repoPath, orchestrator);
    }
    return orchestrator;
  };

  return { getOrchestrator, getStateStore };
}
