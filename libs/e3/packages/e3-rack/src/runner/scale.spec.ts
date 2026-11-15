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
import { setTimeout as delay } from 'node:timers/promises';
import { ArrayType, IntegerType, some, variant } from '@elaraai/east';
import e3 from '@elaraai/e3';
import { Budget, InMemoryStateStore, LocalOrchestrator, LocalStorage, LocalTaskRunner, datasetWrite, inputsHash,
  packageImport, packageRead, repoInit, unitCap, workspaceCreate, workspaceDeploy } from '@elaraai/e3-core';
import { RackHub } from '../hub/hub.js';
import { defaultHubConfig, saveHubConfig } from '../hub/config.js';
import { HubClient } from '../client/hub-client.js';
import { TestRackAgent } from '../testing/test-rack-agent.js';
import { pinnedFetch } from '../tls/tls.js';
import { DEFAULT_RACK_POLICY, setMode, setRule } from '../routing/policy.js';
import { openRackRunner, type OpenRackRunnerOptions } from './rack-runner.js';
import type { RackPlacementEvent } from './rack-body.js';
import { describeRackSummary } from './summary.js';

const MiB = 1024 ** 2;
const GiB = 1024 ** 3;
const cleanup: Array<() => Promise<void>> = [];
afterEach(async () => { for (const close of cleanup.splice(0).reverse()) await close(); });

/**
 * Whether a run's own guard runs: everywhere but Windows. A run whose units
 * each run under its guard, or on a rack that caps them, starts a stage's
 * units together; where no guard runs, e3-core measures one first.
 */
const together = process.platform !== 'win32';

/**
 * A hub, and a repository whose workspace `dev` runs `score`: a task split
 * over its input's rows, cut small, so that a piece closes at each segment of
 * the input.
 *
 * @param count - The rows
 * @returns The hub's home and client, and the repository, the task and its inputs
 */
async function splitFixture(count: number) {
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
  const rows = Array.from({ length: count }, (_, i) => BigInt(i));
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
  return { home, hub, client, repo, storage, hash, inputs };
}

it('runs a split of more than a hundred pieces wholly on a rack: its units queued together, eight held at a time, never more memory booked than the rack has', async () => {
  // Enough rows to fill well over a hundred segments are cut into more than a
  // hundred pieces.
  const { home, client, repo, storage, hash, inputs } = await splitFixture(130_000);

  // A rack of 8 cores and 16 GiB, whose every unit is taken to peak at 100 MiB.
  // Where a stage's units are leased together, the first of a run's units to
  // end is held until the rack is known to hold eight: units leased one after
  // another's end would never be eight while the first is held, so how fast
  // either side is decides nothing.
  const placements: RackPlacementEvent[] = [];
  const claimed = () => placements.flatMap((event) => event.kind === 'placed' && event.where === 'rack' ? [event] : []);
  let ended = 0; let claimedAtFirstEnd = 0;
  const mint = await client.enroll();
  const agent = await TestRackAgent.enroll(mint.apiUrl, mint.enrollmentToken, {
    certificateSha256: mint.certificateSha256.type === 'some' ? mint.certificateSha256.value : undefined,
    resources: { cores: 8, memoryBytes: 16 * GiB, gpus: 0 },
    peak: async () => {
      if (ended++ === 0) {
        for (let waited = 0; together && claimed().length < 8 && waited < 60_000; waited += 10) await delay(10);
        claimedAtFirstEnd = claimed().length;
      }
      return 100 * MiB;
    },
  });
  cleanup.push(() => agent.close());

  // The run's own budget is guarded where a guard runs, as a run's is. Nothing
  // spills: the rack is to hold all of it. No rule sets a memory limit: a first
  // run's pieces are booked at e3's estimate, which is far less than the
  // size's 16 GiB.
  const budget = new Budget({ cores: 2, memory: GiB });
  const rack = await openRackRunner({ repoPath: repo, workspace: 'dev', storage, label: 'scale test', home, budget, waitForRackMs: 0,
    policy: { ...setRule(setMode({ ...DEFAULT_RACK_POLICY, enabled: true }, 'auto'), 'score', 'rack'), spill: false },
    onPlacement: (event) => { placements.push(event); } });
  cleanup.push(() => rack.close());
  assert.equal(rack.rackSlots, 8);
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

  // A first run: nothing has measured the task, so each unit books the cap of e3's estimate, until one has measured;
  // its pieces are queued together, as wide as a later run's, and none runs first to measure the rest.
  const first = await run(false);
  const firstCaps = claimed().map((event) => event.needs!.memoryBytes);
  assert(firstCaps.length > 100, `the split has more than a hundred units to place: ${firstCaps.length}`);
  assert(claimed().every((event) => event.role === 'unit' && event.rackLabel === 'test rack'));
  const estimated = firstCaps[0]!;
  // Where the run's budget has no guard, e3-core runs one unit first to measure, and it, expecting nothing, books its size's memory.
  if (together) assert(estimated >= unitCap(64 * MiB) && estimated < GiB, `the first unit books the cap of the estimate, the runner's own memory and what it holds: ${estimated}`);
  else assert.equal(estimated, 16 * GiB, 'a unit run first to measure, expecting nothing, books its size\'s memory');
  assert(firstCaps.every((cap) => cap === estimated || cap === unitCap(100 * MiB)), 'a unit books the estimate\'s cap, or once measured the cap of its peak');
  if (together) assert(claimedAtFirstEnd >= 8, `the first run held ${claimedAtFirstEnd} units before its first had ended: it measured none first`);

  // A second run, the task's peak known: every unit of a stage asks the cap of that peak, and a stage's units are queued together.
  const second = await run(true);
  const caps = claimed().map((event) => event.needs!.memoryBytes);
  assert(caps.length > 100);
  if (together) {
    assert(caps.every((cap) => cap === unitCap(100 * MiB)), 'each unit asks half as much again as the task was measured to need');
    // Eight or more: a unit that ends while the first is held makes room for the next.
    assert(claimedAtFirstEnd >= 8, `the rack held ${claimedAtFirstEnd} units before the first had ended: none waited for another to finish before it was leased`);
  }
  assert.equal(second, first, 'the same output');

  // The rack never held more than its eight cores, nor booked more than its memory; and nothing ran locally.
  assert.equal(agent.bookedMost.leases, 8, 'eight units at once, a core each');
  assert(agent.bookedMost.cores <= 8 && agent.bookedMost.memoryBytes <= 16 * GiB, `the rack booked ${agent.bookedMost.cores} cores and ${agent.bookedMost.memoryBytes} bytes at most`);
  assert.equal(budget.peak, 0, 'no unit ran on this machine');
  assert(placements.every((event) => event.where === 'rack'));
  assert.match(describeRackSummary(rack.takeSummary())!, /^Rack summary: \d+ units on test rack · \d+ waited for capacity( \(longest \d+ s\))? · 0 ran again · 0 transfers retried · 0 ran locally$/);
  await agent.stop();

  // A local run of the same task over the same rows writes the same output.
  const local = await new LocalTaskRunner(repo, new Budget({ cores: 8, memory: 4 * GiB }, { sampler: null })).execute(storage, hash, inputs, { force: true });
  assert.equal(local.state, 'success', local.error);
  assert.equal(local.outputHash, second);
});

/**
 * A run of `score` whose policy sends it to a rack and spills nothing, under
 * the run's own budget, guarded where a guard runs, as a run's is.
 *
 * @param f - The fixture
 * @param placements - Collects where each task and unit runs
 * @param options - What the run sets beside
 * @returns The runner's handle
 */
async function rackRun(f: Awaited<ReturnType<typeof splitFixture>>, placements: RackPlacementEvent[], options: Partial<OpenRackRunnerOptions> = {}) {
  const rack = await openRackRunner({ repoPath: f.repo, workspace: 'dev', storage: f.storage, label: 'no rack test', home: f.home,
    budget: new Budget({ cores: 2, memory: GiB }), waitForRackMs: 0,
    policy: { ...setRule(setMode({ ...DEFAULT_RACK_POLICY, enabled: true }, 'auto'), 'score', 'rack'), spill: false },
    onPlacement: (event) => { placements.push(event); }, ...options });
  cleanup.push(() => rack.close());
  return rack;
}

/** The units a run placed. */
const unitsOf = (placements: RackPlacementEvent[]) => placements.flatMap((event) => event.kind === 'placed' && event.role === 'unit' ? [event] : []);

it('starts a stage\'s units together with no rack enrolled', async () => {
  const f = await splitFixture(8_000);
  const placements: RackPlacementEvent[] = [];
  const rack = await rackRun(f, placements);
  assert.equal(rack.rackSlots, 0);
  assert.match(rack.describe(), /No connected rack/);

  // Every unit runs here, where the guard stops one that outgrows its share:
  // a stage starts them all, each expecting e3's estimate, as it does with no
  // rack policy at all, and none runs first to measure the rest.
  assert.equal(rack.runner.firstWave, together ? 'estimate' : 'measure');
  const result = await rack.runner.execute(f.storage, f.hash, f.inputs, { taskName: 'score' });
  assert.equal(result.state, 'success', result.error);
  const units = unitsOf(placements);
  assert(units.length > 1, `the split has more than one unit: ${units.length}`);
  assert(units.every((event) => event.where === 'local' && event.reason === 'no-rack-for-tier:node'), 'no rack took a unit');
  const log = (await f.storage.logs.read(f.repo, f.hash, inputsHash(f.inputs), result.executionId, 'stdout')).data;
  if (together) assert.match(log, /^wave pieces units=\d+ estimate=\d+ from=rows$/m, `its pieces started together, each expecting e3's estimate:\n${log}`);
  else assert.doesNotMatch(log, /^wave /m, 'where no guard runs, one unit ran first to measure');
});

it('leases no unit to a rack that caps nothing', async () => {
  const f = await splitFixture(8_000);
  // A rack that admits work by its slots: it caps nothing. It claims whatever
  // is queued for it, so a unit leased to it would run on it.
  const mint = await f.client.enroll();
  const agent = await TestRackAgent.enroll(mint.apiUrl, mint.enrollmentToken, { certificateSha256: mint.certificateSha256.type === 'some' ? mint.certificateSha256.value : undefined });
  cleanup.push(() => agent.close());
  agent.start();
  const placements: RackPlacementEvent[] = [];
  const rack = await rackRun(f, placements);
  assert.equal(await rack.refreshSlots(), 1);
  assert.match(rack.describe(), /^test rack \(1 slots, whole tasks only, e3 \S+/, 'a run is told before it starts that the rack takes no unit');

  // Whatever racks there are, a unit runs where something stops it when it
  // outgrows its share: a stage's units still start together, and with only
  // such a rack each runs here, by that name.
  assert.equal(rack.runner.firstWave, together ? 'estimate' : 'measure');
  const result = await rack.runner.execute(f.storage, f.hash, f.inputs, { taskName: 'score' });
  assert.equal(result.state, 'success', result.error);
  const units = unitsOf(placements);
  assert(units.length > 1, `the split has more than one unit: ${units.length}`);
  assert(units.every((event) => event.where === 'local' && event.reason === 'no-rack-caps-units:node'), `every unit ran here, since no rack caps one: ${JSON.stringify(units.slice(0, 3))}`);
  await agent.stop();
});

it('leases a stage\'s units to the rack that caps them alone, beside one that caps nothing', async () => {
  const f = await splitFixture(8_000);
  const enrol = async (label: string, resources?: { cores: number; memoryBytes: number; gpus: number }) => {
    const mint = await f.client.enroll();
    const agent = await TestRackAgent.enroll(mint.apiUrl, mint.enrollmentToken, { label, ...(resources !== undefined && { resources }),
      certificateSha256: mint.certificateSha256.type === 'some' ? mint.certificateSha256.value : undefined });
    cleanup.push(() => agent.close());
    agent.start();
    return agent;
  };
  // Both poll for whatever is queued: the one that admits by its slots offers no bound, and would run any unit it were granted.
  const slots = await enrol('slots');
  const capping = await enrol('capping', { cores: 8, memoryBytes: 16 * GiB, gpus: 0 });
  const placements: RackPlacementEvent[] = [];
  const rack = await rackRun(f, placements);
  assert.equal(await rack.refreshSlots(), 9);

  assert.equal(rack.runner.firstWave, together ? 'estimate' : 'measure');
  const result = await rack.runner.execute(f.storage, f.hash, f.inputs, { taskName: 'score' });
  assert.equal(result.state, 'success', result.error);
  const units = unitsOf(placements);
  assert(units.length > 1, `the split has more than one unit: ${units.length}`);
  assert(units.every((event) => event.where === 'rack' && event.rackLabel === 'capping'), `every unit ran on the rack that caps it: ${JSON.stringify(units.slice(0, 3))}`);
  await slots.stop(); await capping.stop();
});

it('waits, under rack-only, for a rack its hub has not yet heard say what it has, and leases it the units once it has', async () => {
  const f = await splitFixture(8_000);
  // The hub starts again on another port, below: its rack follows it there
  let origin = '';
  const listening = async () => { const listener = (await f.client.status()).rackListener; assert(listener.type === 'up'); origin = listener.value.origin; };
  await listening();
  const mint = await f.client.enroll();
  const reach = mint.certificateSha256.type === 'some' ? pinnedFetch(mint.certificateSha256.value) : fetch;
  const agent = await TestRackAgent.enroll(mint.apiUrl, mint.enrollmentToken, { resources: { cores: 8, memoryBytes: 16 * GiB, gpus: 0 },
    fetch: (input, init) => { const url = new URL(String(input)); return reach(`${origin}${url.pathname}${url.search}`, init); } });
  cleanup.push(() => agent.close());

  // A hub that starts again knows the rack, and that it was healthy, from its
  // registry, and has not heard what it has: a rack says that with each
  // heartbeat. Nothing says yet whether it caps a unit.
  await f.hub.stop();
  const again = new RackHub({ foreground: true, home: f.home }); assert(await again.start()); cleanup.push(() => again.stop());
  await listening();
  const placements: RackPlacementEvent[] = [];
  const rack = await rackRun(f, placements, { rackOnly: true, unreachableWaitMs: 300 });
  assert.equal(rack.rackSlots, 8);
  assert.match(rack.describe(), /^test rack \(8 slots, e3 \S+/, 'said by its slots alone until it has said what it has');

  // A run that keeps its work for a rack waits for it to, as for a rack that
  // is not healthy; it does not take it for a rack that caps nothing. Past the
  // wait the units run here, by that name.
  const waited = await rack.runner.execute(f.storage, f.hash, f.inputs, { taskName: 'score' });
  assert.equal(waited.state, 'success', waited.error);
  const local = unitsOf(placements);
  assert(local.length > 1, `the split has more than one unit: ${local.length}`);
  assert(local.every((event) => event.where === 'local' && event.reason === 'source-unreachable'), `every unit waited for the rack, then ran here: ${JSON.stringify(local.slice(0, 3))}`);

  // Once the rack has said what it has, its units are its.
  await agent.heartbeat();
  agent.start();
  assert.equal(await rack.refreshSlots(), 8);
  assert.match(rack.describe(), /^test rack \(8 cores, /);
  placements.length = 0;
  const leased = await rack.runner.execute(f.storage, f.hash, f.inputs, { taskName: 'score', force: true });
  assert.equal(leased.state, 'success', leased.error);
  const units = unitsOf(placements);
  assert(units.length > 1 && units.every((event) => event.where === 'rack'), `every unit ran on the rack: ${JSON.stringify(units.slice(0, 3))}`);
  await agent.stop();
});
