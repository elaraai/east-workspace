/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Licensed under BSL 1.1. See LICENSE for details.
 */

/**
 * A rack attempt's records as the session writes them: the line its log is
 * given of where its time went on its rack (#1723) follows its outcome, and
 * is best effort, so a log store that fails to take it loses no outcome, and
 * a completion retried after its record appends nothing twice.
 */

import { it } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { IntegerType, encodeBeast2For } from '@elaraai/east';
import { LocalStorage, processOwner, repoInit, uuidv7 } from '@elaraai/e3-core';
import type { RackLeaseRecord } from '../lease/lease-store.js';
import type { RackLeasePhases } from '../protocol/task-envelope.js';
import { sessionAttempts } from './session-attempts.js';

const PHASES: RackLeasePhases = { marks: { 'admitted': 0, 'booted': 3_000, 'runner-started': 3_200, 'runner-ended': 22_200 } };

it('records an attempt\'s outcome before the line of where its time went, which is best effort and written once', async (t) => {
  const home = await mkdtemp(join(tmpdir(), 'e3sa-'));
  t.after(() => rm(home, { recursive: true, force: true }));
  const repo = join(home, 'repo'); assert(repoInit(repo).success);
  const storage = new LocalStorage();
  const owner = await processOwner();
  const attempts = sessionAttempts(storage, repo, () => owner);
  const outputHash = await storage.objects.write(repo, encodeBeast2For(IntegerType)(4n));
  const lease = (input: string): RackLeaseRecord => ({ leaseId: uuidv7(), repo: 'r-repo', workspace: 'dev', taskHash: 'a'.repeat(64), inputsHash: input.repeat(64),
    tier: 'node', status: 'claimed', claimedBy: 'rack-a', createdAtMs: 1_000, claimedAtMs: 13_000, attempt: { executionId: uuidv7(), startedAtMs: 13_000 },
    event: { version: 2, taskName: 'length', workspace: 'dev', closure: { hashes: [] },
      runnerEvent: { mode: 'task', repo: 'r-repo', taskHash: 'a'.repeat(64), inputHashes: [], launchId: uuidv7(), timeoutMs: 30_000 } } });
  const success = { taskName: 'length', status: 'success' as const, outputHash, phases: PHASES };
  const lines = async (record: RackLeaseRecord) =>
    (await storage.logs.read(repo, record.taskHash, record.inputsHash, record.attempt!.executionId, 'stderr')).data.split('\n').filter((line) => line.startsWith('e3: on its rack: '));

  // A log store that takes no line of the rack's: the outcome is recorded all the same
  const append = storage.logs.append.bind(storage.logs);
  let refuse = true;
  storage.logs.append = (repoPath, task, inputs, id, stream, data) =>
    refuse && data.startsWith('e3: on its rack: ') ? Promise.reject(new Error('the log store is full')) : append(repoPath, task, inputs, id, stream, data);
  const lost = lease('b');
  await attempts.running(lost, 'boot');
  await attempts.outcome(lost, success);
  assert.equal((await storage.refs.executionGet(repo, lost.taskHash, lost.inputsHash, lost.attempt!.executionId))?.type, 'success', 'the outcome stands');
  assert.deepEqual(await lines(lost), []);

  // A store that takes it: once, after the outcome, and not again for a completion retried
  refuse = false;
  const kept = lease('c');
  await attempts.running(kept, 'boot');
  await attempts.outcome(kept, success);
  await attempts.outcome(kept, success);
  assert.equal((await storage.refs.executionGet(repo, kept.taskHash, kept.inputsHash, kept.attempt!.executionId))?.type, 'success');
  assert.deepEqual(await lines(kept), ['e3: on its rack: granted +12 s · booted 3 s · ran 19 s'], 'its grant by the hub\'s clock, from the lease\'s creation to its claim');
});
