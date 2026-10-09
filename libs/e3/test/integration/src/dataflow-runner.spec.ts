/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Licensed under BSL 1.1. See LICENSE for details.
 */

import { afterEach, it } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { East, IntegerType, StringType, some, variant } from '@elaraai/east';
import e3 from '@elaraai/e3';
import { Budget, LocalStorage, MockTaskRunner, datasetWrite, packageImport, packageRead, repoInit, workspaceCreate, workspaceDeploy } from '@elaraai/e3-core';
import { createServer, type DataflowRunnerFactory } from '@elaraai/e3-api-server';
import { dataflowCancel, dataflowExecute, dataflowExecuteLaunch, dataflowExecutePoll } from '@elaraai/e3-api-client';
import { waitFor } from './helpers.js';
import { RackHub, HubClient, createDataflowRunnerFactory, defaultHubConfig, saveHubConfig, DEFAULT_RACK_POLICY, savePolicy, setMode } from '@elaraai/e3-rack';
import { TestRackAgent } from '@elaraai/e3-rack/testing';

const cleanup: Array<() => Promise<void>> = [];
afterEach(async () => { for (const close of cleanup.splice(0).reverse()) await close(); });
async function fixture() {
  const repo = await mkdtemp(join(tmpdir(), 'e3-injected-')); cleanup.push(() => rm(repo, { recursive: true, force: true }));
  assert(repoInit(repo).success);
  const input = e3.input('injected_text', StringType, variant('value', 'four'));
  const task = e3.task('injected_length', [input], East.function([StringType], IntegerType, (_$, text) => text.length()));
  const zip = join(repo, 'package.zip'); await e3.export(e3.package('injected', '1.0.0', task), zip);
  const storage = new LocalStorage(); await packageImport(storage, repo, zip);
  await workspaceCreate(storage, repo, 'dev'); await workspaceDeploy(storage, repo, 'dev', 'injected', '1.0.0');
  const hash = (await packageRead(storage, repo, 'injected', '1.0.0')).tasks.get('injected_length')!;
  const outputHash = await datasetWrite(storage, repo, 4n, IntegerType);
  const budget = new Budget({ cores: 1, memory: 512 * 1024 ** 2 }, { sampler: null });
  const start = async (dataflowRunner: DataflowRunnerFactory) => {
    const server = await createServer({ singleRepoPath: repo, host: '127.0.0.1', port: 0, budget, dataflowRunner });
    await server.start(); cleanup.push(() => server.stop()); return `http://127.0.0.1:${server.port}`;
  };
  return { repo, hash, outputHash, budget, start };
}

for (const state of ['success', 'failed'] as const) it(`closes an injected API runner exactly once after ${state}`, async () => {
  const f = await fixture(); const runner = new MockTaskRunner(); let closed = 0;
  runner.setDefaultResult({ state, cached: false, outputHash: state === 'success' ? f.outputHash : undefined, exitCode: 7 });
  const url = await f.start(async (repo, ws, context) => {
    assert.equal(repo, f.repo); assert.equal(ws, 'dev'); assert.equal(context.budget, f.budget);
    return { runner, extraConcurrency: 3, close: async () => { closed++; } };
  });
  const result = await dataflowExecute(url, 'default', 'dev', {}, { token: null }, { pollInterval: 10 });
  assert.equal(result.success, state === 'success'); assert.equal(runner.getCalls().length, 1);
  await waitFor(() => closed === 1); assert.equal(f.budget.peak, 0);
});

it('closes an injected API runner after cancellation and after a refused start', async () => {
  const f = await fixture(); const runner = new MockTaskRunner(); let closed = 0;
  let release!: () => void;
  const blocked = new Promise<void>((resolve) => { release = resolve; });
  runner.setResult(f.hash, async () => { await blocked; return { state: 'success', cached: false, outputHash: f.outputHash }; });
  const url = await f.start(async () => ({ runner, extraConcurrency: 3, close: async () => { closed++; } }));
  await dataflowExecuteLaunch(url, 'default', 'dev', {}, { token: null });
  await waitFor(() => runner.getCalls().length === 1);
  const cancelling = dataflowCancel(url, 'default', 'dev', { token: null }); release(); await cancelling;
  await waitFor(() => closed === 1);
  assert.equal((await dataflowExecutePoll(url, 'default', 'dev', {}, { token: null })).status.type, 'aborted');
  await assert.rejects(dataflowExecuteLaunch(url, 'default', 'dev', { filter: 'missing' }, { token: null }));
  await waitFor(() => closed === 2);
});

it('runs locally on the server shared budget when its runner factory throws', async () => {
  const f = await fixture();
  const url = await f.start(async () => { throw new Error('attachment unavailable'); });
  assert.equal((await dataflowExecute(url, 'default', 'dev', {}, { token: null }, { pollInterval: 10 })).success, true);
  assert.equal(f.budget.peak, 1);
});

it('delegates an API run under explicit server opt-in and closes its hub session', async () => {
  const f = await fixture();
  const home = await mkdtemp(join(tmpdir(), 'e3r-')); cleanup.push(() => rm(home, { recursive: true, force: true }));
  await saveHubConfig({ ...defaultHubConfig(), listen: some({ host: '127.0.0.1', port: 0n }) }, home);
  const hub = new RackHub({ home, foreground: true }); assert(await hub.start()); cleanup.push(() => hub.stop());
  const client = new HubClient(home); const mint = await client.enroll();
  const agent = await TestRackAgent.enroll(mint.apiUrl, mint.enrollmentToken); cleanup.push(() => agent.close());
  // enabled remains false: the server operator explicitly opted in.
  await savePolicy(f.repo, setMode(DEFAULT_RACK_POLICY, 'auto'));
  const url = await f.start(createDataflowRunnerFactory({ home, waitForRackMs: 0 }));
  await dataflowExecuteLaunch(url, 'default', 'dev', {}, { token: null });
  assert.equal((await client.status()).sessions.length, 1);
  assert.equal((await agent.runOne())?.status, 'success');
  await waitFor(async () => (await dataflowExecutePoll(url, 'default', 'dev', {}, { token: null })).status.type === 'completed');
  await waitFor(async () => (await client.status()).sessions.length === 0);
  assert.equal(f.budget.peak, 0);
});
