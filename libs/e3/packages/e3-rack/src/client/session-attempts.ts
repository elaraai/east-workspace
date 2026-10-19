/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Licensed under BSL 1.1. See LICENSE for details.
 */

import { variant } from '@elaraai/east';
import { ExecutionAttempt, touchReachable, type StorageBackend } from '@elaraai/e3-core';
import type { ExecutionOwner } from '@elaraai/e3-types';
import type { RackLeaseRecord } from '../lease/lease-store.js';
import { closureHashes } from '../lease/closure.js';
import { isLeaseEventV2, leaseInputs, leaseRecordsUnit, type RackLeaseResult } from '../protocol/task-envelope.js';
import type { RackAttemptStore } from '../server/rack-routes.js';

/**
 * Writes rack attempt records with the session's own repository formats.
 * The hub serializes the calls and names itself as the process owner, so
 * another session can take over without an owner-death probe ending the work.
 * @param storage - Session storage backend
 * @param repo - Repository path known only to the session
 * @param owner - Resolves the hub's process identity
 * @returns The current repository's attempt adapter
 * @example
 * const attempts = sessionAttempts(storage, repo, () => hubOwner);
 */
export function sessionAttempts(storage: StorageBackend, repo: string, owner: () => ExecutionOwner): RackAttemptStore {
  const attemptFor = (lease: RackLeaseRecord) => {
    if (!isLeaseEventV2(lease.event) || lease.attempt === undefined) throw new Error('Rack lease has no current attempt');
    return new ExecutionAttempt(storage, repo, lease.taskHash, leaseInputs(lease.event), {
      inHash: lease.inputsHash, executionId: lease.attempt.executionId, startTime: lease.attempt.startedAtMs,
    }, leaseRecordsUnit(lease.event));
  };
  const statusOf = (lease: RackLeaseRecord) => storage.refs.executionGet(repo, lease.taskHash, lease.inputsHash, lease.attempt!.executionId);
  return {
    async closure(lease) {
      const hashes = await closureHashes(lease.event.closure, (hash) => storage.objects.read(repo, hash));
      if (!(await storage.objects.touch(repo, hashes)).every(Boolean)) throw new Error('Rack lease closure is missing objects');
      return hashes;
    },
    async running(lease) {
      const attempt = attemptFor(lease);
      const current = await statusOf(lease);
      if (current !== null && current.type !== 'running') return;
      const hub = owner();
      await attempt.recordOwner(hub, new Date(attempt.ids.startTime));
      if (current === null) await attempt.recordRunning(hub, new Date(attempt.ids.startTime));
    },
    async stopped(lease, how, cause) {
      const attempt = attemptFor(lease);
      const current = await statusOf(lease);
      if (current !== null && current.type !== 'running') return;
      if (how === 'cancelled') { await attempt.recordStopped('cancelled', cause); return; }
      await storage.logs.append(repo, lease.taskHash, lease.inputsHash, attempt.ids.executionId, 'stderr', `e3: ${cause}\n`);
      await storage.logs.flush(repo, lease.taskHash, lease.inputsHash, attempt.ids.executionId);
      await storage.refs.executionWrite(repo, lease.taskHash, lease.inputsHash, attempt.ids.executionId, variant('interrupted', {
        executionId: attempt.ids.executionId, inputHashes: attempt.inputHashes,
        startedAt: new Date(attempt.ids.startTime), completedAt: new Date(), pid: 0n, unit: attempt.unit,
        reason: { kind: variant('host', 'rack.lease_lost'), message: cause },
      }));
    },
    async outcome(lease, result: RackLeaseResult) {
      const attempt = attemptFor(lease);
      const current = await statusOf(lease);
      if (current !== null && current.type !== 'running') return;
      await storage.logs.flush(repo, lease.taskHash, lease.inputsHash, attempt.ids.executionId);
      if (result.cancelled) await attempt.recordStopped('cancelled', result.error ?? 'Rack work was cancelled');
      else if (result.state === 'error') await attempt.recordError(result.error ?? 'Rack execution failed', result.exitCode);
      else if (result.status === 'success') {
        if (result.outputHash === undefined || !await touchReachable(storage, repo, [result.outputHash])) throw new Error('Rack output is incomplete');
        await attempt.recordSuccess(result.outputHash, result.peakBytes);
      } else await attempt.recordFailed(result.exitCode ?? null, result.error ?? null, result.peakBytes);
    },
    verifyOutput: (_lease, hash) => touchReachable(storage, repo, [hash]),
    logs: {
      append: (_alias, task, inputs, id, stream, data) => storage.logs.append(repo, task, inputs, id, stream, data),
      flush: (_alias, task, inputs, id) => storage.logs.flush(repo, task, inputs, id),
    },
  };
}
