/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Licensed under BSL 1.1. See LICENSE for details.
 */

/**
 * Orchestrator manager for e3-api-server.
 *
 * Manages LocalOrchestrator instances per repository, each with its own
 * FileStateStore for durable execution state persistence.
 */

import { join } from 'node:path';
import {
  LocalOrchestrator,
  FileStateStore,
  type ExecutionHandle,
  type ExecutionStateStore,
} from '@elaraai/e3-core';

/**
 * Map of state stores per repository path.
 */
const stateStores = new Map<string, FileStateStore>();

/**
 * Map of orchestrators per repository path.
 */
const orchestrators = new Map<string, LocalOrchestrator>();

/**
 * Get or create a FileStateStore for a repository.
 */
function getOrCreateStateStore(repoPath: string): FileStateStore {
  let store = stateStores.get(repoPath);
  if (!store) {
    const workspacesDir = join(repoPath, 'workspaces');
    store = new FileStateStore(workspacesDir);
    stateStores.set(repoPath, store);
  }
  return store;
}

/**
 * Get or create a LocalOrchestrator for a repository.
 */
function getOrCreateOrchestrator(repoPath: string): LocalOrchestrator {
  let orch = orchestrators.get(repoPath);
  if (!orch) {
    const stateStore = getOrCreateStateStore(repoPath);
    orch = new LocalOrchestrator(stateStore);
    orchestrators.set(repoPath, orch);
  }
  return orch;
}

/**
 * Map of active execution handles by workspace key.
 * Key format: `${repoPath}::${workspace}`
 */
const activeExecutions = new Map<string, ExecutionHandle>();

/**
 * Generate a key for workspace-level lookups.
 */
function makeWorkspaceKey(repoPath: string, workspace: string): string {
  return `${repoPath}::${workspace}`;
}

/**
 * Get the orchestrator for a repository.
 */
export function getOrchestrator(repoPath: string): LocalOrchestrator {
  return getOrCreateOrchestrator(repoPath);
}

/**
 * Get the state store for a repository.
 */
export function getStateStore(repoPath: string): ExecutionStateStore {
  return getOrCreateStateStore(repoPath);
}

/**
 * Set the active execution for a workspace.
 * Replaces any previous execution.
 */
export function setActiveExecution(repoPath: string, workspace: string, handle: ExecutionHandle): void {
  activeExecutions.set(makeWorkspaceKey(repoPath, workspace), handle);
}

/**
 * Get the active execution for a workspace.
 */
export function getActiveExecution(repoPath: string, workspace: string): ExecutionHandle | null {
  const key = makeWorkspaceKey(repoPath, workspace);
  return activeExecutions.get(key) ?? null;
}

/**
 * Clear a run's active execution for a workspace — once the run has let go of
 * the workspace (the orchestrator's `wait()` has settled). A run started after
 * it may be the workspace's active execution by then, and stays.
 *
 * @param repoPath - The repository
 * @param workspace - The workspace
 * @param executionId - The run that has let go
 */
export function clearActiveExecution(repoPath: string, workspace: string, executionId: string): void {
  const key = makeWorkspaceKey(repoPath, workspace);
  if (activeExecutions.get(key)?.id === executionId) activeExecutions.delete(key);
}

/**
 * Check if there's an active (running) execution for a workspace.
 */
export function hasActiveExecution(repoPath: string, workspace: string): boolean {
  return activeExecutions.has(makeWorkspaceKey(repoPath, workspace));
}

/**
 * Get the latest execution for a workspace (may not be active/running).
 * Useful for polling completed executions.
 */
export async function getLatestExecution(repoPath: string, workspace: string): Promise<ExecutionHandle | null> {
  // First check for active execution
  const active = getActiveExecution(repoPath, workspace);
  if (active) {
    return active;
  }

  // Otherwise check state store for latest
  const stateStore = getOrCreateStateStore(repoPath);
  const state = await stateStore.readLatest(repoPath, workspace);
  if (state) {
    return { id: state.id, repo: repoPath, workspace };
  }

  return null;
}

/**
 * Clear all in-memory state (for testing).
 * Note: This does not clear persisted file-based state.
 */
export function clearAll(): void {
  activeExecutions.clear();
  stateStores.clear();
  orchestrators.clear();
}
