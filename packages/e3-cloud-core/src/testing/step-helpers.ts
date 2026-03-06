/**
 * Copyright (c) 2025 Elara AI Pty Ltd. All rights reserved.
 * Proprietary and confidential.
 *
 * Shared test helpers for dataflow step unit tests.
 */

import { none, some } from '@elaraai/east';
import {
  InMemoryStorage,
  InMemoryStateStore,
  type DataflowExecutionState,
} from '@elaraai/e3-core';
import {
  InMemoryRepoManager,
  InMemoryDataflowRunStore,
  InMemoryExecutionTracker,
  InMemoryComputeResultStore,
  InMemoryTaskConfigStore,
  InMemoryScheduleStore,
  InMemoryDataflowOrchestrator,
} from './in-memory.js';
import type { DataflowStorage } from '../dataflow-storage.js';

type TaskState = DataflowExecutionState['tasks'] extends Map<string, infer V> ? V : never;
type GraphTask = DataflowExecutionState['graph'] extends { type: 'some'; value: { tasks: (infer T)[] } } | { type: 'none' } ? T : never;

/**
 * Create a task state entry with default values.
 */
export function taskState(name: string, overrides: {
  status?: string;
  cached?: boolean;
  outputHash?: string;
  error?: string;
  exitCode?: bigint;
  duration?: bigint;
} = {}): [string, TaskState] {
  return [name, {
    name,
    status: overrides.status ?? 'pending',
    cached: overrides.cached !== undefined ? some(overrides.cached) : none,
    outputHash: overrides.outputHash ? some(overrides.outputHash) : none,
    error: overrides.error ? some(overrides.error) : none,
    exitCode: overrides.exitCode !== undefined ? some(overrides.exitCode) : none,
    startedAt: none,
    completedAt: none,
    duration: overrides.duration !== undefined ? some(overrides.duration) : none,
  } as TaskState];
}

/**
 * Create a graph task entry.
 */
export function graphTask(name: string, opts: {
  hash?: string;
  inputs?: string[];
  output?: string;
  dependsOn?: string[];
} = {}): GraphTask {
  return {
    name,
    hash: opts.hash ?? `hash-${name}`,
    inputs: opts.inputs ?? [],
    output: opts.output ?? `/out/${name}`,
    dependsOn: opts.dependsOn ?? [],
  } as GraphTask;
}

/**
 * Build a mock DataflowStorage by combining InMemoryStorage with InMemoryStateStore.
 */
export function createMockStorage() {
  const base = new InMemoryStorage();
  const stateStore = new InMemoryStateStore();
  const originalLocks = base.locks;

  const locks = {
    acquire: originalLocks.acquire.bind(originalLocks),
    getState: originalLocks.getState.bind(originalLocks),
    isHolderAlive: originalLocks.isHolderAlive.bind(originalLocks),
    renewLock(_repo: string, _resource: string) { return Promise.resolve(true); },
    async forceRelease(_repo: string, _resource: string) {},
  };

  const repoManager = new InMemoryRepoManager();
  const dataflowRuns = new InMemoryDataflowRunStore();
  const executionTracker = new InMemoryExecutionTracker();

  const storage = {
    objects: base.objects,
    refs: base.refs,
    locks,
    logs: base.logs,
    repos: base.repos,
    datasets: base.datasets,
    executions: stateStore,
    repoManager,
    dataflowRuns,
    executionTracker,
    validateRepository: base.validateRepository.bind(base),
  } as DataflowStorage;

  return {
    storage,
    base,
    stateStore,
    repoManager,
    dataflowRuns,
    executionTracker,
  };
}

export {
  InMemoryComputeResultStore,
  InMemoryTaskConfigStore,
  InMemoryScheduleStore,
  InMemoryDataflowOrchestrator,
  InMemoryExecutionTracker,
  InMemoryDataflowRunStore,
  InMemoryRepoManager,
  InMemoryStateStore,
};
