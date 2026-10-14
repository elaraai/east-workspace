/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Licensed under BSL 1.1. See LICENSE for details.
 */

import { afterEach, it } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, readdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawn } from 'node:child_process';
import { setTimeout as delay } from 'node:timers/promises';
import { Hono } from 'hono';
import { some, variant } from '@elaraai/east';
import { LocalStorage, repoInit, uuidv7 } from '@elaraai/e3-core';
import { sendSuccess } from '@elaraai/e3-api-server/beast2';
import { connectHub, RackHubOutdatedError, RackHubUnavailableError } from './connect.js';
import { HubClient } from './hub-client.js';
import { RackSession } from './session.js';
import { closeSocketServer, serveOnSocket } from './local-http.js';
import { EmptyType, HubHelloType } from '../protocol/control.js';
import { hubSocketPath } from '../paths.js';
import { readHubLock } from '../hub/lock.js';
import { TestRackAgent } from '../testing/test-rack-agent.js';

const cleanup: Array<() => Promise<void>> = [];
afterEach(async () => { for (const close of cleanup.splice(0).reverse()) await close(); });
async function home() {
  const path = await mkdtemp(join(tmpdir(), 'e3c-'));
  cleanup.push(() => rm(path, { recursive: true, force: true }));
  cleanup.push(async () => {
    await new HubClient(path).stop().catch(() => {});
    for (let i = 0; i < 100 && await readHubLock(path) !== null; i++) await delay(20);
    const lock = await readHubLock(path);
    if (lock !== null) try { process.kill(Number(lock.pid), 'SIGKILL'); } catch { /* already gone */ }
  });
  return path;
}
async function fixture() {
  const path = await home();
  const client = await connectHub({ home: path });
  await client.setConfig({ ...await client.getConfig(), listen: some({ host: '127.0.0.1', port: 0n }) });
  const mint = await client.enroll();
  const agent = await TestRackAgent.enroll(mint.apiUrl, mint.enrollmentToken);
  cleanup.push(() => agent.close());
  const repo = join(path, 'repo'); assert(repoInit(repo).success);
  const storage = new LocalStorage();
  const session = await RackSession.open(client, { storage, repoPath: repo, workspace: 'dev', label: 'client test' });
  cleanup.push(() => session.close());
  const request = { tier: 'node', computeSize: 'large', eventJson: JSON.stringify({ version: 2, workspace: 'dev', taskName: 'task', closure: { hashes: [] },
    runnerEvent: { mode: 'task', taskHash: 'a'.repeat(64), repo: 'replaced', inputHashes: [], launchId: uuidv7(), timeoutMs: 30000 } }) };
  return { path, client, agent, repo, storage, session, request };
}

it('cold-starts the published hub entry, logs startup and shares it across three processes', async () => {
  const path = await home();
  const module = new URL('./connect.js', import.meta.url).href;
  const script = `import { connectHub } from ${JSON.stringify(module)};
    const hub = await connectHub({ home: process.argv[1] });
    console.log(Number((await hub.hello()).pid));`;
  const run = () => new Promise<number>((resolve, reject) => {
    const child = spawn(process.execPath, ['--input-type=module', '-e', script, path], { stdio: ['ignore', 'pipe', 'pipe'], windowsHide: true });
    let out = ''; let error = '';
    child.stdout.on('data', (data: Buffer) => { out += data.toString(); });
    child.stderr.on('data', (data: Buffer) => { error += data.toString(); });
    child.once('error', reject);
    child.once('exit', (code) => { if (code !== 0) reject(new Error(error)); else resolve(Number(out.trim())); });
  });
  const pids = await Promise.all([run(), run(), run()]);
  assert.equal(new Set(pids).size, 1);
  const client = await connectHub({ home: path, spawn: false });
  assert.equal(Number((await client.status()).hello.pid), pids[0]);
  assert.match(await readFile(join(path, 'hub.log'), 'utf8'), /rack hub started/);
  assert.equal(Number((await readHubLock(path))!.pid), pids[0]);
});

it('drains an older protocol, refuses a newer one and leaves its sessions alone', async () => {
  const path = await home();
  let protocol = 0n; let drains = 0;
  const app = new Hono();
  app.post('/v1/hello', () => sendSuccess(HubHelloType, { version: '1.0.0', protocol, pid: BigInt(process.pid), draining: false }));
  app.post('/v1/drain', () => { drains++; return sendSuccess(EmptyType, {}); });
  const server = await serveOnSocket(app, hubSocketPath(path));
  cleanup.push(() => closeSocketServer(server, hubSocketPath(path)));
  await assert.rejects(connectHub({ home: path }), (err: unknown) => err instanceof RackHubOutdatedError && /older.*exit once idle/.test(err.message));
  assert.equal(drains, 1);
  protocol = 2n;
  await assert.rejects(connectHub({ home: path }), (err: unknown) => err instanceof RackHubOutdatedError && /newer/.test(err.message));
  assert.equal(drains, 1);
});

it('delivers claim, log tee and terminal outcome in order, then removes its session data socket', async () => {
  const f = await fixture();
  const handle = await f.session.createLease(f.request);
  const grant = await f.agent.claim(); assert(grant);
  const claimed = await handle.next(); assert.equal(claimed.kind, 'claimed');
  assert(handle.attempt);
  const logs: string[] = [];
  f.session.onLog(handle.attempt.executionId, (_stream, data) => { logs.push(data); });
  await f.agent.logs(grant, [{ stream: variant('stdout', null), data: 'first\n' }, { stream: variant('stdout', null), data: 'second\n' }]);
  assert.deepEqual(logs, ['first\n', 'second\n']);
  await f.agent.complete(grant, { taskName: 'task', status: 'failed', exitCode: 7, error: 'expected failure' });
  const completed = await handle.next(); assert.equal(completed.kind, 'completed');
  if (completed.kind === 'completed') assert.equal(completed.result.exitCode, 7);
  await f.session.close(); await f.session.close();
  assert.equal((await f.client.status()).sessions.length, 0);
  assert.equal((await readdir(f.path)).filter((name) => name.startsWith('s-') && name.endsWith('.sock')).length, 0);
});

it('unblocks every lease promptly after the real hub is killed and refuses reconnecting the old session', async () => {
  const f = await fixture();
  const handle = await f.session.createLease(f.request);
  const hello = await f.client.hello();
  const waiting = handle.next();
  const started = Date.now();
  process.kill(Number(hello.pid), 'SIGKILL');
  const update = await waiting;
  assert.equal(update.kind, 'lost'); assert(Date.now() - started < 3000);
  assert.equal(f.session.hubLost, true);
  await assert.rejects(f.session.createLease(f.request), RackHubUnavailableError);
  const replacement = await connectHub({ home: f.path });
  assert.notEqual(Number((await replacement.hello()).pid), Number(hello.pid));
  assert.equal((await replacement.status()).sessions.length, 0);
});

it('keeps another handle subscribed when identical work is requested twice in one session', async () => {
  const f = await fixture();
  const [first, second] = await Promise.all([f.session.createLease(f.request), f.session.createLease(f.request)]);
  assert.equal(first.leaseId, second.leaseId);
  await first.cancel(); assert.equal((await first.next()).kind, 'cancelled');
  const grant = await f.agent.claim(); assert(grant);
  assert.equal((await second.next()).kind, 'claimed');
  await f.agent.complete(grant, { taskName: 'task', status: 'failed' });
  assert.equal((await second.next()).kind, 'completed');
});
