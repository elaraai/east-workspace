/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Licensed under BSL 1.1. See LICENSE for details.
 */

import { afterEach, it } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm, stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { setTimeout as delay } from 'node:timers/promises';
import { Hono } from 'hono';
import { BooleanType, StringType, decodeBeast2For, encodeBeast2For, some, variant } from '@elaraai/east';
import type { ExecutionOwner } from '@elaraai/e3-types';
import { processOwner } from '@elaraai/e3-core';
import { decodeBody, sendError, sendSuccess } from '../server/beast2.js';
import { acquireHubLock, HubLockType, readHubLock } from './lock.js';
import { defaultHubConfig, listenerProblem, loadHubConfig, saveHubConfig, validateHubConfig, wildcardHost } from './config.js';
import { FairLeaseStore } from './fair-lease-store.js';
import { SessionLeaseCoordinator, SessionProxyStorageBridge } from './session-bridge.js';
import { InMemoryRackLeaseStore } from '../lease/in-memory-lease-store.js';
import { makeLeaseId, type RackLeaseRecord } from '../lease/lease-store.js';
import { closeSocketServer, RackHubError, REQUEST_BODY_TIMEOUT_MS, serveOnSocket, socketRequest, socketStream } from '../client/local-http.js';
import { SessionLogsType } from '../protocol/session-data.js';
import { HUB_CONFIG_FILE, HUB_LOCK_FILE, sessionSocketPath } from '../paths.js';

const cleanup: Array<() => Promise<void>> = [];
afterEach(async () => { for (const close of cleanup.splice(0).reverse()) await close(); });
async function home() {
  const path = await mkdtemp(join(tmpdir(), 'e3r-'));
  cleanup.push(() => rm(path, { recursive: true, force: true }));
  return path;
}

it('persists hub configuration atomically and refuses invalid or corrupt state', async () => {
  const path = await home();
  assert.deepEqual(await loadHubConfig(path), defaultHubConfig());
  const config = { ...defaultHubConfig(), listen: some({ host: '127.0.0.1', port: 7331n }) };
  await saveHubConfig(config, path);
  assert.deepEqual(await loadHubConfig(path), config);
  await assert.rejects(saveHubConfig({ ...config, idleExitMinutes: -1n }, path), /timeout/);
  assert.deepEqual(await loadHubConfig(path), config);
  await writeFile(join(path, HUB_CONFIG_FILE), new Uint8Array([1, 2, 3]));
  await assert.rejects(loadHubConfig(path));
});

it('serves plain HTTP only on the loopback or a private address it names, and TLS on any address', () => {
  const listen = (host: string) => some({ host, port: 7331n });
  const plain = (host: string, allow = ['127.0.0.1']) => ({ ...defaultHubConfig(), listen: listen(host), allow, tls: false });
  assert.equal(defaultHubConfig().tls, true);
  assert.equal(listenerProblem(defaultHubConfig()), undefined);
  for (const host of ['127.0.0.1', '::1', 'localhost', '10.1.2.3', '172.16.0.9', '192.168.1.2', '100.64.0.10', '169.254.3.4', 'fd00::5', 'fe80::1']) {
    assert.equal(listenerProblem(plain(host)), undefined, host);
  }
  assert.match(listenerProblem(plain('127.0.0.1', []))!, /must name the addresses it admits/);
  for (const host of ['0.0.0.0', '::']) assert.match(listenerProblem(plain(host))!, /every address/);
  for (const host of ['8.8.8.8', '172.32.0.1', '2001:db8::1', 'hub.example.com']) assert.match(listenerProblem(plain(host))!, /loopback or a private address/, host);
  for (const host of ['0.0.0.0', '8.8.8.8', 'hub.example.com']) assert.equal(listenerProblem({ ...defaultHubConfig(), listen: listen(host) }), undefined, host);
  assert.match(listenerProblem({ ...defaultHubConfig(), listen: listen('127.0.0.1'), advertiseUrl: some('http://relay.example') })!, /https:\/\//);
  assert.equal(listenerProblem({ ...plain('127.0.0.1'), advertiseUrl: some('https://terminator.example') }), undefined);
  assert.throws(() => validateHubConfig(plain('127.0.0.1', [])), /must name the addresses/);
  assert.throws(() => validateHubConfig({ ...defaultHubConfig(), allow: ['not-an-ip'] }), /not an IP address/);
  assert.deepEqual(['0.0.0.0', '::', '0:0:0:0:0:0:0:0', '127.0.0.1', 'localhost'].map(wildcardHost), [true, true, true, false, false]);
});

it('publishes one whole hub lock and recovers a stale owner under simultaneous contenders', async () => {
  const path = await home();
  for (let round = 0; round < 3; round++) {
    const acquired = await Promise.all(Array.from({ length: 12 }, () => acquireHubLock(path)));
    const winners = acquired.filter((lock) => lock !== null);
    assert.equal(winners.length, 1);
    const winner = winners[0]!;
    cleanup.push(() => winner.release());
    assert.deepEqual(decodeBeast2For(HubLockType)(await readFile(join(path, HUB_LOCK_FILE))), winner.record);
    assert.equal(await acquireHubLock(path), null);
    await winner.release();
    assert.equal(await readHubLock(path), null);
    // A complete record left by a dead process: all contenders see the same stale owner.
    await writeFile(join(path, HUB_LOCK_FILE), encodeBeast2For(HubLockType)({ ...winner.record, pid: -1n }));
  }
});

it('asks after a contender\'s liveness once in a while during an election, never once per claim per poll', async () => {
  const path = await home();
  const self = await processOwner();
  // Twelve contenders of distinct identities, each liveness answer costing
  // about what a macOS answer does, which spawns sysctl and ps.
  const contenders: ExecutionOwner[] = Array.from({ length: 12 }, (_, n) => ({ ...self, pid: 100_000n + BigInt(n) }));
  let probes = 0;
  const alive = async () => { probes++; await delay(15); return true; };
  const started = Date.now();
  const acquired = await Promise.all(contenders.map((owner) => acquireHubLock(path, { owner, alive })));
  const elapsed = Date.now() - started;
  const winners = acquired.filter((lock) => lock !== null);
  assert.equal(winners.length, 1);
  cleanup.push(() => winners[0]!.release());
  assert(probes <= contenders.length * contenders.length, `${probes} liveness answers for ${contenders.length} contenders`);
  assert(elapsed < 3000, `the election took ${elapsed} ms`);
});

it('elects one hub across processes and recovers its lock after an ungraceful exit', async () => {
  const path = await home();
  const module = new URL('./lock.js', import.meta.url).href;
  const launch = async () => {
    const script = `import { acquireHubLock } from ${JSON.stringify(module)};
      const lock = await acquireHubLock(process.argv[1]);
      console.log(lock ? 'held' : 'busy');
      if (lock) setInterval(() => {}, 1000);`;
    const child = spawn(process.execPath, ['--input-type=module', '-e', script, path], { stdio: ['ignore', 'pipe', 'pipe'], windowsHide: true });
    cleanup.push(async () => {
      if (child.exitCode === null && child.signalCode === null) { const exit = once(child, 'exit'); child.kill('SIGKILL'); await exit; }
    });
    const [bytes] = await once(child.stdout, 'data', { signal: AbortSignal.timeout(10_000) });
    return { child, held: String(bytes).trim() === 'held' };
  };
  const contenders = await Promise.all([launch(), launch(), launch()]);
  const winners = contenders.filter((c) => c.held);
  assert.equal(winners.length, 1);
  const winner = winners[0]!.child;
  const exit = once(winner, 'exit');
  winner.kill('SIGKILL');
  await exit;
  const reclaimed = await Promise.all([launch(), launch(), launch()]);
  assert.equal(reclaimed.filter((c) => c.held).length, 1);
});

it('serves typed and raw data over a private socket with deadlines and cancellation', async () => {
  const path = sessionSocketPath(await home());
  const app = new Hono();
  app.post('/echo', async (c) => sendSuccess(StringType, await decodeBody(c, StringType)));
  app.get('/error', () => sendError(StringType, variant('internal', { message: 'test error' })));
  app.get('/slow', async () => { await delay(150); return sendSuccess(StringType, 'late'); });
  app.get('/bytes', () => new Response(new Uint8Array([1, 2, 3])));
  const server = await serveOnSocket(app, path);
  cleanup.push(() => closeSocketServer(server, path));
  assert.equal(server.requestTimeout, REQUEST_BODY_TIMEOUT_MS, "a request body may take a data URL's whole lifetime to arrive");
  if (process.platform !== 'win32') assert.equal((await stat(path)).mode & 0o777, 0o600);
  assert.equal(await socketRequest(path, 'POST', '/echo', { requestType: StringType, body: 'hello', responseType: StringType }), 'hello');
  await assert.rejects(socketRequest(path, 'GET', '/error', { responseType: StringType }), /test error/);
  await assert.rejects(socketRequest(path, 'GET', '/slow', { responseType: StringType, timeoutMs: 20 }), (err: unknown) => err instanceof RackHubError && err.code === 'timeout');
  const abort = new AbortController();
  const pending = socketRequest(path, 'GET', '/slow', { responseType: StringType, signal: abort.signal });
  abort.abort();
  await assert.rejects(pending, (err: unknown) => err instanceof RackHubError && err.code === 'aborted');
  const response = await socketStream(path, 'GET', '/bytes');
  const chunks: Buffer[] = [];
  for await (const chunk of response) chunks.push(Buffer.from(chunk as Uint8Array));
  assert.deepEqual(Buffer.concat(chunks), Buffer.from([1, 2, 3]));
});

it('drops a log batch whose flush the session refused, so the rack\'s re-post is written once', async () => {
  const path = sessionSocketPath(await home());
  const app = new Hono();
  const batches: string[][] = [];
  let refusals = 1;
  app.post('/v1/logs', async (c) => {
    const request = await decodeBody(c, SessionLogsType);
    if (refusals-- > 0) return c.text('session busy', 503);
    batches.push(request.chunks.map((chunk) => chunk.data));
    return sendSuccess(BooleanType, true);
  });
  const server = await serveOnSocket(app, path);
  cleanup.push(() => closeSocketServer(server, path));
  const leases = new InMemoryRackLeaseStore();
  const taskHash = 'a'.repeat(64); const inputsHash = 'b'.repeat(64);
  await leases.put({
    leaseId: makeLeaseId(taskHash, inputsHash), repo: 'repo', workspace: 'dev', taskHash, inputsHash, tier: 'node', status: 'claimed',
    claimedBy: 'rack', createdAtMs: 0, attempt: { executionId: 'run', startedAtMs: 0 },
    event: { version: 2, workspace: 'dev', taskName: 'task', closure: { hashes: [] }, runnerEvent: { mode: 'task', repo: 'repo', launchId: 'launch', taskHash, inputHashes: [], timeoutMs: 1000 } },
  });
  const coordinator = new SessionLeaseCoordinator();
  const bridge = new SessionProxyStorageBridge({ leases, coordinator, session: () => ({ dataSocket: path, dataToken: 'token' }), owner: await processOwner(), advertiseOrigin: () => undefined });
  const post = (line: string) => coordinator.run('repo', 'lease', async () => {
    await bridge.attempts.logs.append('repo', taskHash, inputsHash, 'run', 'stdout', line);
    await bridge.attempts.logs.flush!('repo', taskHash, inputsHash, 'run');
  });
  await assert.rejects(post('first\n'), /session busy/);
  await post('first\n'); // the rack, told its lines were not stored, posts them again
  await post('second\n');
  assert.deepEqual(batches, [['first\n'], ['second\n']]);
});

it('rotates claims across owners even when one session fills the oldest queue positions', async () => {
  const backend = new InMemoryRackLeaseStore();
  const store = new FairLeaseStore(backend, (lease) => lease.workspace);
  const taskHash = 'a'.repeat(64);
  const inputsHash = 'b'.repeat(64);
  for (const workspace of ['first', 'second']) for (let n = 0; n < 6; n++) {
    const lease: RackLeaseRecord = {
      leaseId: makeLeaseId(taskHash, inputsHash), repo: 'repo', workspace, taskHash, inputsHash,
      tier: 'node', status: 'pending', createdAtMs: workspace === 'first' ? n : n + 10,
      event: { version: 2, workspace, taskName: 'task', closure: { hashes: [] }, runnerEvent: {
        mode: 'task', repo: 'repo', launchId: 'launch', taskHash, inputHashes: [], timeoutMs: 1000,
      } },
    };
    await store.put(lease);
  }
  const owners: string[] = [];
  for (let n = 0; n < 12; n++) {
    const [lease] = await store.listClaimable(['node'], Date.now(), 1);
    assert(lease);
    assert(await store.claim('repo', lease.leaseId, 'rack', Date.now() + 60_000));
    owners.push(lease.workspace);
  }
  assert.deepEqual(owners, Array.from({ length: 12 }, (_, n) => n % 2 ? 'second' : 'first'));
});
