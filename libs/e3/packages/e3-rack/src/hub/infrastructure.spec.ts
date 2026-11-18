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
import { BooleanType, StringType, decodeBeast2For, encodeBeast2For, some } from '@elaraai/east';
import type { ExecutionOwner } from '@elaraai/e3-types';
import { processOwner } from '@elaraai/e3-core';
import { answer, decodeBody } from '../server/beast2.js';
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

/** A read's refusal as Windows makes it, of a file another handle is replacing or removing. */
const refusal = (file: string) => Object.assign(new Error(`EPERM: operation not permitted, open '${file}'`), { code: 'EPERM' });

it('elects one hub while reads of the claims are refused now and then, as Windows refuses a file being replaced or removed', async () => {
  const path = await home();
  // The second and the fifth read of each claim are refused, as a moment of its
  // replacement or its removal is
  const reads = new Map<string, number>();
  let refused = 0;
  const read = async (file: string): Promise<Uint8Array> => {
    const n = (reads.get(file) ?? 0) + 1;
    reads.set(file, n);
    if (n === 2 || n === 5) { refused++; throw refusal(file); }
    return readFile(file);
  };
  for (let round = 0; round < 3; round++) {
    const acquired = await Promise.all(Array.from({ length: 12 }, () => acquireHubLock(path, { read })));
    const winners = acquired.filter((lock) => lock !== null);
    assert.equal(winners.length, 1);
    await winners[0]!.release();
  }
  assert.ok(refused > 0, 'reads were refused');
});

it('waits for a live claim whose read is refused, and never chooses its ticket past it', async () => {
  const path = await home();
  const self = await processOwner();
  const alive = async () => true;
  const holder = await acquireHubLock(path, { owner: { ...self, pid: 200_000n }, alive });
  assert.ok(holder !== null);
  cleanup.push(() => holder.release());
  // As though each contender below had read hub.lock before the holder wrote it
  await rm(join(path, HUB_LOCK_FILE));
  const held = join(path, `.hub-claim-${holder.record.ownerId}.beast2`);
  // A contender that went on without the holder's claim would take its ticket and
  // be elected beside it whenever its id came first: none is, however the ids fall
  for (let contender = 1n; contender <= 6n; contender++) {
    let refused = 0;
    const read = async (file: string): Promise<Uint8Array> => {
      if (file === held && refused < 2) { refused++; throw refusal(file); }
      return readFile(file);
    };
    assert.equal(await acquireHubLock(path, { owner: { ...self, pid: 200_000n + contender }, alive, read }), null);
    assert.equal(refused, 2, 'the holder\'s claim was refused, and read again');
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
    // A contender's line, within a minute. It is a process started cold, loading the lock and what the lock loads: on a
    // loaded Windows runner one took 6.8 s to say its line (6,000 contenders measured, none failing or stalling), and
    // ten seconds was once too few.
    const [bytes] = await once(child.stdout, 'data', { signal: AbortSignal.timeout(60_000) });
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
  app.post('/echo', async (c) => answer(StringType, await decodeBody(c, StringType)));
  app.get('/error', (c) => c.text('test error', 409));
  app.get('/slow', async () => { await delay(150); return answer(StringType, 'late'); });
  app.get('/bytes', () => new Response(new Uint8Array([1, 2, 3])));
  const server = await serveOnSocket(app, path);
  cleanup.push(() => closeSocketServer(server, path));
  assert.equal(server.requestTimeout, REQUEST_BODY_TIMEOUT_MS, "a request body may take a data URL's whole lifetime to arrive");
  if (process.platform !== 'win32') assert.equal((await stat(path)).mode & 0o777, 0o600);
  assert.equal(await socketRequest(path, 'POST', '/echo', { requestType: StringType, body: 'hello', responseType: StringType }), 'hello');
  // A refusal is a status with its reason as text; a reply of another type is a peer of another protocol.
  await assert.rejects(socketRequest(path, 'GET', '/error', { responseType: StringType }), (err: unknown) => err instanceof RackHubError && err.code === 'http_409' && err.message === 'test error');
  await assert.rejects(socketRequest(path, 'POST', '/echo', { requestType: StringType, body: 'hello', responseType: BooleanType }),
    (err: unknown) => err instanceof RackHubError && err.code === 'undecodable' && /does not read as this e3's/.test(err.message));
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
    return answer(BooleanType, true);
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
