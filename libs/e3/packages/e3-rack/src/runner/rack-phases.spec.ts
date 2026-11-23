/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Licensed under BSL 1.1. See LICENSE for details.
 *
 * Where a rack lease's time went (#1723): the phases its rack completes it
 * with reach the line a run prints of the work — a task's, and each unit's of
 * a split task — and the work's log, through a real hub and session; and a
 * rack that says none changes neither.
 */

import { afterEach, it } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { setTimeout as delay } from 'node:timers/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { ArrayType, East, IntegerType, StringType, some, variant } from '@elaraai/east';
import type { PartitionProgress } from '@elaraai/e3-types';
import e3 from '@elaraai/e3';
import { Budget, InMemoryStateStore, LocalOrchestrator, LocalStorage, datasetWrite, inputsHash, packageImport, packageRead, repoInit, workspaceCreate,
  workspaceDeploy, type TaskCompletedCallback } from '@elaraai/e3-core';
import { RackHub } from '../hub/hub.js';
import { defaultHubConfig, saveHubConfig } from '../hub/config.js';
import { HubClient } from '../client/hub-client.js';
import { TestRackAgent } from '../testing/test-rack-agent.js';
import { DEFAULT_RACK_POLICY, setMode } from '../routing/policy.js';
import { openRackRunner } from './rack-runner.js';
import type { RackLeasePhases } from '../protocol/task-envelope.js';

const cleanup: Array<() => Promise<void>> = [];
afterEach(async () => { for (const close of cleanup.splice(0).reverse()) await close(); });

const MB = 1024 ** 2;

/** What a rack of this release says of a lease it ran. */
const PHASES: RackLeasePhases = {
  marks: { 'admitted': 0, 'booted': 3_000, 'runner-started': 3_200, 'runner-ended': 22_200, 'outputs-sent': 23_200 },
  fetchedBytes: 903 * MB, fetchMs: 260_000, cachedBytes: 0, sentBytes: 4 * MB,
};

/** What a run prints of them: how long the lease waited for its grant is this machine's measure, and so varies. */
const SAID = /^granted \+[0-9.]+ s · fetched 903 MB \(0 B cached\) 260 s · booted 3 s · ran 19 s · sent 4 MB 1 s$/;

/** A hub, a repository whose one task a rack runs, and a rack that does not complete its next lease itself. */
async function fixture() {
  const home = await mkdtemp(join(tmpdir(), 'e3r-phases-'));
  cleanup.push(() => rm(home, { recursive: true, force: true }));
  await saveHubConfig({ ...defaultHubConfig(), listen: some({ host: '127.0.0.1', port: 0n }) }, home);
  const hub = new RackHub({ foreground: true, home });
  assert(await hub.start()); cleanup.push(() => hub.stop());
  const repo = join(home, 'repo'); assert(repoInit(repo).success);
  const storage = new LocalStorage();
  const input = e3.input('text', StringType, variant('value', 'four'));
  const task = e3.task('length', [input], East.function([StringType], IntegerType, (_$, text) => text.length()));
  const zip = join(home, 'package.zip');
  await e3.export(e3.package('rack', '1.0.0', task), zip);
  await packageImport(storage, repo, zip);
  await workspaceCreate(storage, repo, 'dev');
  await workspaceDeploy(storage, repo, 'dev', 'rack', '1.0.0');
  const hash = (await packageRead(storage, repo, 'rack', '1.0.0')).tasks.get('length')!;
  const inputs = [await datasetWrite(storage, repo, 'four', StringType)];
  const budget = new Budget({ cores: 1, memory: 512 * 1024 ** 2 }, { sampler: null });
  const mint = await new HubClient(home).enroll();
  // The agent runs the lease and leaves its completion to the test, which
  // completes it as a rack of this release, or of an older one, would
  const agent = await TestRackAgent.enroll(mint.apiUrl, mint.enrollmentToken, {
    certificateSha256: mint.certificateSha256.type === 'some' ? mint.certificateSha256.value : undefined, faults: { dropCompletionNext: 1 },
  });
  cleanup.push(() => agent.close());
  const rack = await openRackRunner({ repoPath: repo, workspace: 'dev', storage, label: 'phases test', budget,
    policy: setMode({ ...DEFAULT_RACK_POLICY, enabled: true }, 'auto'), home, waitForRackMs: 0 });
  cleanup.push(() => rack.close());
  return { repo, storage, hash, inputs, budget, agent, rack };
}

/** Runs the dataflow, its one task on the rack, completed with what `phases` gives; answers its completion, and its log. */
async function runCompleted(phases: RackLeasePhases | undefined) {
  const f = await fixture();
  const completed: TaskCompletedCallback[] = [];
  const orchestrator = new LocalOrchestrator(new InMemoryStateStore());
  const run = await orchestrator.start(f.storage, f.repo, 'dev', { runner: f.rack.runner, width: f.budget.cores + f.rack.rackSlots,
    onTaskComplete: (result) => { completed.push(result); } });
  const grant = await f.agent.claim(); assert(grant);
  const result = await f.agent.execute(grant);
  assert.equal(result.status, 'success', result.error);
  assert.equal(await f.agent.complete(grant, phases === undefined ? result : { ...result, phases }).then((answer) => answer.disposition.type), 'recorded');
  await orchestrator.wait(run);
  const record = await f.storage.refs.executionGetLatest(f.repo, f.hash, inputsHash(f.inputs));
  assert(record?.type === 'success');
  const stderr = (await f.storage.logs.read(f.repo, f.hash, inputsHash(f.inputs), record.value.executionId, 'stderr')).data;
  return { completed, stderr };
}

it('prints a rack task\'s phases on its completion line and in its log, its grant measured by this machine', async () => {
  const { completed, stderr } = await runCompleted(PHASES);
  const done = completed.find((result) => result.name === 'length');
  assert.equal(done?.state, 'success');
  assert.match(done?.timing ?? '', SAID);
  const line = stderr.split('\n').find((text) => text.startsWith('e3: on its rack: '));
  assert.match(line?.slice('e3: on its rack: '.length) ?? '', SAID, stderr);
});

it('prints each rack unit\'s phases on its line, and in its split task\'s log beside its execution', async () => {
  const original = process.env.E3_TEST_PIECE_BYTES;
  process.env.E3_TEST_PIECE_BYTES = '64';
  cleanup.push(() => { if (original === undefined) delete process.env.E3_TEST_PIECE_BYTES; else process.env.E3_TEST_PIECE_BYTES = original; return Promise.resolve(); });
  const home = await mkdtemp(join(tmpdir(), 'e3r-phases-split-'));
  cleanup.push(() => rm(home, { recursive: true, force: true }));
  await saveHubConfig({ ...defaultHubConfig(), listen: some({ host: '127.0.0.1', port: 0n }) }, home);
  const hub = new RackHub({ foreground: true, home }); assert(await hub.start()); cleanup.push(() => hub.stop());
  const client = new HubClient(home);
  const mint = await client.enroll();
  // A rack that caps a unit, as the rack a unit is leased to must; each completion is the test's
  const faults = { dropCompletionNext: 0 };
  const agent = await TestRackAgent.enroll(mint.apiUrl, mint.enrollmentToken, { resources: { cores: 8, memoryBytes: 16 * 1024 ** 3, gpus: 0 }, faults,
    certificateSha256: mint.certificateSha256.type === 'some' ? mint.certificateSha256.value : undefined });
  cleanup.push(() => agent.close());
  const repo = join(home, 'repo'); assert(repoInit(repo).success);
  const storage = new LocalStorage();
  const budget = new Budget({ cores: 2, memory: 1024 ** 3 }, { sampler: null });
  const rack = await openRackRunner({ repoPath: repo, workspace: 'dev', storage, label: 'phases split test', home, budget,
    policy: setMode(DEFAULT_RACK_POLICY, 'auto'), rackOnly: true, waitForRackMs: 0 });
  cleanup.push(() => rack.close());
  const type = ArrayType(IntegerType);
  const input = e3.input('rows', type);
  const task = e3.streamTask('split', { inputs: [e3.partition(input)], output: e3.output.array(IntegerType) }, ($, rows, emit) => { $.for(rows, ($, row) => { $(emit(row)); }); });
  const zip = join(home, 'split.zip');
  await e3.export(e3.package('split', '1.0.0', task), zip);
  await packageImport(storage, repo, zip);
  const hash = (await packageRead(storage, repo, 'split', '1.0.0')).tasks.get('split')!;
  const inputs = [await datasetWrite(storage, repo, Array.from({ length: 8000 }, (_, i) => BigInt(i)), type)];
  let ended = false;
  let units = 0;
  const pump = async () => {
    while (!ended) {
      if (Number((await client.status()).capacity.queued) === 0) { await delay(10); continue; }
      const grant = await agent.claim(); assert(grant);
      faults.dropCompletionNext = 1;
      const result = await agent.execute(grant); assert.equal(result.status, 'success', result.error);
      await agent.complete(grant, { ...result, phases: PHASES });
      units++;
    }
  };
  const progress: PartitionProgress[] = [];
  const [remote] = await Promise.all([
    rack.runner.execute(storage, hash, inputs, { taskName: 'split', onPartitionProgress: (unit) => { progress.push(unit); } }).finally(() => { ended = true; }),
    pump(),
  ]);
  assert.equal(remote.state, 'success', remote.error);
  assert(units > 1, `${units} units`);
  const done = progress.filter((unit) => unit.state === 'completed');
  assert.equal(done.length, units);
  for (const unit of done) assert.match(unit.timing ?? '', SAID);
  // The split task's log names each unit's execution, and says where its time went after it
  const log = (await storage.logs.read(repo, hash, inputsHash(inputs), remote.executionId, 'stdout')).data;
  const lines = log.split('\n').filter((line) => / completed task=/.test(line));
  assert.equal(lines.length, units, log);
  for (const line of lines) assert.match(line.split(' — ')[1] ?? '', SAID, line);
});

it('prints nothing more of a task whose rack says no phases, as one of an older release does', async () => {
  const { completed, stderr } = await runCompleted(undefined);
  const done = completed.find((result) => result.name === 'length');
  assert.equal(done?.state, 'success');
  assert.equal(done?.timing, undefined);
  assert.doesNotMatch(stderr, /on its rack/);
});
