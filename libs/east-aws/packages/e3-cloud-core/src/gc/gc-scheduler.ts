/**
 * Copyright (c) 2025 Elara AI Pty Ltd. All rights reserved.
 * Proprietary and confidential.
 *
 * GC Scheduler — Cloud-agnostic logic.
 *
 * Lists all active repos and starts GC for each with random jitter.
 * Triggered by a scheduled event (e.g., EventBridge on AWS).
 */

import { uuidv7 } from '@elaraai/e3-core';
import type { RepoManager } from '../repo-manager.js';
import type { GcOrchestrator } from '../gc-orchestrator.js';

export interface GcSchedulerDeps {
  repoManager: RepoManager;
  gcOrchestrator: GcOrchestrator;
}

export interface GcSchedulerInput {
  /** Optional: force GC even if repo was recently GC'd */
  force?: boolean;
  /** Optional: only GC specific repos */
  repos?: string[];
  /** Maximum jitter in milliseconds (default: 3600000 = 1 hour) */
  maxJitterMs?: number;
}

export interface GcSchedulerOutput {
  /** Number of GC executions started */
  started: number;
  /** Number of repos skipped (not active) */
  skipped: number;
  /** Repos that were scheduled */
  scheduledRepos: string[];
}

// Jitter configuration
const JITTER_MIN_FACTOR = 0.5;
const JITTER_MAX_FACTOR = 1.5;
const DEFAULT_MAX_JITTER_MS = 3600000; // 1 hour

/**
 * Calculate jitter delay for a repo.
 *
 * Uses repo name to generate consistent jitter, so the same repo
 * gets the same relative delay across scheduler runs.
 *
 * Returns delay in milliseconds (0 to maxJitterMs * JITTER_MAX_FACTOR).
 */
export function calculateJitter(repo: string, maxJitterMs: number = DEFAULT_MAX_JITTER_MS): number {
  // Simple hash of repo name to get a number between 0 and 1
  let hash = 0;
  for (let i = 0; i < repo.length; i++) {
    const char = repo.charCodeAt(i);
    hash = ((hash << 5) - hash) + char;
    hash = hash & hash; // Convert to 32bit integer
  }
  const normalized = Math.abs(hash) / 2147483647; // 0 to 1

  // Apply jitter factor (50% to 150%)
  const jitterFactor = JITTER_MIN_FACTOR + (normalized * (JITTER_MAX_FACTOR - JITTER_MIN_FACTOR));

  // Scale to max jitter
  return Math.floor(jitterFactor * maxJitterMs);
}

/**
 * GC Scheduler handler.
 *
 * Lists all active repos and starts GC state machine for each.
 */
export async function handleGcScheduler(deps: GcSchedulerDeps, input: GcSchedulerInput = {}): Promise<GcSchedulerOutput> {
  const _maxJitterMs = input.maxJitterMs ?? DEFAULT_MAX_JITTER_MS;

  // Get list of repos to GC
  let repos: string[];
  if (input.repos && input.repos.length > 0) {
    repos = input.repos;
  } else {
    // listRepos() returns only active repos by default
    repos = await deps.repoManager.listRepos();
  }

  let started = 0;
  let skipped = 0;
  const scheduledRepos: string[] = [];

  for (const repo of repos) {
    try {
      // Check if repo is active (can run GC)
      if (!input.force) {
        const metadata = await deps.repoManager.getRepoMetadata(repo);
        if (!metadata || metadata.status !== 'active') {
          skipped++;
          continue;
        }
      }

      // Generate unique GC ID
      const gcId = uuidv7();
      const startTime = Date.now();

      // Start GC via orchestrator
      await deps.gcOrchestrator.startGc({ repo, gcId, startTime });

      started++;
      scheduledRepos.push(repo);
    } catch (err) {
      console.error(`Failed to start GC for repo ${repo}:`, err);
    }
  }

  return {
    started,
    skipped,
    scheduledRepos,
  };
}
