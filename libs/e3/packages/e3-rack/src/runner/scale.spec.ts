/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Licensed under BSL 1.1. See LICENSE for details.
 */

/**
 * A split task on a rack that admits work by its resources, as a dataflow
 * runs it: the acceptance test of a rack that scales as a local run does.
 */

import { afterEach, it } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { ArrayType, IntegerType, some, variant } from '@elaraai/east';
import e3 from '@elaraai/e3';
import { Budget, InMemoryStateStore, LocalOrchestrator, LocalStorage, LocalTaskRunner, datasetWrite, inputsHash,
  packageImport, packageRead, repoInit, unitCap, workspaceCreate, workspaceDeploy } from '@elaraai/e3-core';
import { RackHub } from '../hub/hub.js';
import { defaultHubConfig, saveHubConfig } from '../hub/config.js';
import { HubClient } from '../client/hub-client.js';
import { TestRackAgent } from '../testing/test-rack-agent.js';
import { DEFAULT_RACK_POLICY, setMode, setRule } from '../routing/policy.js';
import { openRackRunner } from './rack-runner.js';
import type { RackPlacementEvent } from './rack-body.js';
import { describeRackSummary } from './summary.js';

const MiB = 1024 ** 2;
const GiB = 1024 ** 3;
const cleanup: Array<() => Promise<void>> = [];
afterEach(async () => { for (const close of cleanup.splice(0).reverse()) await close(); });

it('runs a split of more than a hundred pieces wholly on a rack: its units queued together, eight held at a time, never more memory booked than the rack has', async () => {
  // Small pieces: a piece closes at a segment of its input, so enough rows to
  // fill well over a hundred segments are cut into more than a hundred pieces.
  const original = process.env.E3_TEST_PIECE_BYTES;
  process.env.E3_TEST_PIECE_BYTES = '64';
  cleanup.push(() => { if (original === undefined) delete process.env.E3_TEST_PIECE_BYTES; else process.env.E3_TEST_PIECE_BYTES = original; return Promise.resolve(); });

  const home = await mkdtemp(join(tmpdir(), 'e3x-'));
  cleanup.push(() => rm(home, { recursive: true, force: true }));
  await saveHubConfig({ ...defaultHubConfig(), listen: some({ host: '127.0.0.1', port: 0n }) }, home);
  const hub = new RackHub({ foreground: true, home }); assert(await hub.start()); cleanup.push(() => hub.stop());
  const client = new HubClient(home);
  const repo = join(home, 'repo'); assert(repoInit(repo).success);
  const storage = new LocalStorage();

  const type = ArrayType(IntegerType);
  const rows = Array.from({ length: 130_000 }, (_, i) => BigInt(i));
  const input = e3.input('rows', type, variant('value', rows));
  const task = e3.streamTask('score', { inputs: [e3.partition(input)], output: e3.output.array(IntegerType) },
    ($, rows, emit) => { $.for(rows, ($, row) => { $(emit(row.add(1n))); }); });
  const zip = join(home, 'scale.zip');
  await e3.export(e3.package('scale', '1.0.0', task), zip);
  await packageImport(storage, repo, zip);
  await workspaceCreate(storage, repo, 'dev');
  await workspaceDeploy(storage, repo, 'dev', 'scale', '1.0.0');
  const hash = (await packageRead(storage, repo, 'scale', '1.0.0')).tasks.get('score')!;
  const inputs = [await datasetWrite(storage, repo, rows, type)];

  // A rack of 8 cores and 16 GiB, whose every unit is taken to peak at 100 MiB.
  const placements: RackPlacementEvent[] = [];
  const claimed = () => placements.flatMap((event) => event.kind === 'placed' && event.where === 'rack' ? [event] : []);
  let ended = 0; let claimedAtFirstEnd = 0;
  const mint = await client.enroll();
  const agent = await TestRackAgent.enroll(mint.apiUrl, mint.enrollmentToken, {
    certificateSha256: mint.certificateSha256.type === 'some' ? mint.certificateSha256.value : undefined,
    resources: { cores: 8, memoryBytes: 16 * GiB, gpus: 0 },
    peak: () => { if (ended++ === 0) claimedAtFirstEnd = claimed().length; return 100 * MiB; },
  });
  cleanup.push(() => agent.close());

  // The run's own budget is guarded where a guard runs, as a run's is. Nothing
  // spills: the rack is to hold all of it. A piece nothing has measured books
  // its rule's limit, 1 GiB.
  const budget = new Budget({ cores: 2, memory: GiB });
  const rack = await openRackRunner({ repoPath: repo, workspace: 'dev', storage, label: 'scale test', home, budget, waitForRackMs: 0,
    policy: { ...setRule(setMode({ ...DEFAULT_RACK_POLICY, enabled: true }, 'auto'), 'score', 'rack', { memoryLimit: GiB }), spill: false },
    onPlacement: (event) => { placements.push(event); } });
  cleanup.push(() => rack.close());
  assert.equal(rack.rackSlots, 8);
  // The rack caps each unit, so a run whose own guard runs starts a stage's
  // units together; where no guard runs (Windows), it measures one first.
  const together = process.platform !== 'win32';
  assert.equal(rack.runner.firstWave, together ? 'estimate' : 'measure');
  agent.start();

  const orchestrator = new LocalOrchestrator(new InMemoryStateStore());
  const run = async (force: boolean) => {
    placements.length = 0; ended = 0; claimedAtFirstEnd = 0;
    const result = await orchestrator.wait(await orchestrator.start(storage, repo, 'dev', { runner: rack.runner, width: budget.cores + rack.rackSlots, force }));
    assert.equal(result.success, true);
    const record = await storage.refs.executionGetLatest(repo, hash, inputsHash(inputs));
    assert(record?.type === 'success');
    return record.value.outputHash;
  };

  // A first run: nothing has measured the task, so each unit books its rule's limit until one has.
  const first = await run(false);
  const firstCaps = claimed().map((event) => event.needs!.memoryBytes);
  assert(firstCaps.length > 100, `the split has more than a hundred units to place: ${firstCaps.length}`);
  assert(claimed().every((event) => event.role === 'unit' && event.rackLabel === 'test rack'));
  assert(firstCaps.every((cap) => cap === GiB || cap === unitCap(100 * MiB)), 'a unit books its limit, or once measured the cap of its peak');

  // A second run, the task's peak known: every unit of a stage asks the cap of that peak, and a stage's units are queued together.
  const second = await run(true);
  const caps = claimed().map((event) => event.needs!.memoryBytes);
  assert(caps.length > 100);
  if (together) {
    assert(caps.every((cap) => cap === unitCap(100 * MiB)), 'each unit asks half as much again as the task was measured to need');
    assert(claimedAtFirstEnd >= 8, `the rack held ${claimedAtFirstEnd} units before the first had ended: none waited for another to finish before it was leased`);
  }
  assert.equal(second, first, 'the same output');

  // The rack never held more than its eight cores, nor booked more than its memory; and nothing ran locally.
  assert.equal(agent.bookedMost.leases, 8, 'eight units at once, a core each');
  assert(agent.bookedMost.cores <= 8 && agent.bookedMost.memoryBytes <= 16 * GiB, `the rack booked ${agent.bookedMost.cores} cores and ${agent.bookedMost.memoryBytes} bytes at most`);
  assert.equal(budget.peak, 0, 'no unit ran on this machine');
  assert(placements.every((event) => event.where === 'rack'));
  assert.match(describeRackSummary(rack.takeSummary())!, /^Rack summary: \d+ units on test rack · \d+ waited for capacity( \(longest \d+ s\))? · 0 ran again \(cap\) · 0 transfers retried · 0 ran locally$/);
  await agent.stop();

  // A local run of the same task over the same rows writes the same output.
  const local = await new LocalTaskRunner(repo, new Budget({ cores: 8, memory: 4 * GiB }, { sampler: null })).execute(storage, hash, inputs, { force: true });
  assert.equal(local.state, 'success', local.error);
  assert.equal(local.outputHash, second);
});
