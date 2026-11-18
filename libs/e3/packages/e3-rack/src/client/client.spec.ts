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
import { createServer } from 'node:http';
import { setTimeout as delay } from 'node:timers/promises';
import { Hono } from 'hono';
import { BooleanType, IntegerType, StringType, StructType, encodeBeast2For, some, variant } from '@elaraai/east';
import { BEAST2_CONTENT_TYPE, ResponseType } from '@elaraai/e3-types';
import { LocalStorage, repoInit, uuidv7 } from '@elaraai/e3-core';
import { answer } from '../server/beast2.js';
import { connectHub, RackHubOutdatedError, RackHubUnavailableError } from './connect.js';
import { HUB_ASK_MS, negotiateHub, type HubAsks } from './hub-negotiation.js';
import { HubClient } from './hub-client.js';
import { RackSession } from './session.js';
import { RackHubError, closeSocketServer, serveOnSocket } from './local-http.js';
import { EmptyType, HubHelloType } from '../protocol/control.js';
import { HUB_PROTOCOL } from '../version.js';
import { HUB_LOG_FILE, hubSocketPath } from '../paths.js';
import { readHubLock } from '../hub/lock.js';
import { TestRackAgent } from '../testing/test-rack-agent.js';

const cleanup: Array<() => Promise<void>> = [];
afterEach(async () => { for (const close of cleanup.splice(0).reverse()) await close(); });
/** Whether a process has exited, waiting up to `ms` for it to. */
async function exited(pid: number, ms: number): Promise<boolean> {
  for (const end = Date.now() + ms; ; await delay(20)) {
    try { process.kill(pid, 0); } catch (err) {
      if ((err as NodeJS.ErrnoException).code === 'ESRCH') return true;
      throw err;
    }
    if (Date.now() >= end) return false;
  }
}
/** The hubs spawned for a home, by pid, as their spawner logged each one: every process holding the home's log as its output. */
async function spawnedHubs(home: string): Promise<number[]> {
  const log = await readFile(join(home, HUB_LOG_FILE), 'utf8').catch((err: NodeJS.ErrnoException) => {
    if (err.code === 'ENOENT') return '';
    throw err;
  });
  return [...log.matchAll(/rack hub spawned \(pid (\d+)\)/g)].map((match) => Number(match[1]));
}
async function home() {
  const path = await mkdtemp(join(tmpdir(), 'e3c-'));
  cleanup.push(() => rm(path, { recursive: true, force: true }));
  cleanup.push(async () => {
    // Every hub spawned for the home holds the home's files — its log among them, its output — until its process
    // exits: on Windows a file held open is not removed, and nor is the directory holding it. Those that lost the
    // election exit on their own, and are waited for while the hub holding the lock still holds it, so none of them
    // wins it once it is gone; then that hub is stopped.
    const lock = await readHubLock(path);
    const holder = lock === null ? undefined : Number(lock.pid);
    for (const pid of await spawnedHubs(path)) {
      if (pid !== holder) assert(await exited(pid, 10_000), `the hub ${pid}, which lost the election for its home, did not exit`);
    }
    await new HubClient(path).stop().catch(() => {});
    if (holder === undefined) return;
    if (await exited(holder, 2000)) return;
    try { process.kill(holder, 'SIGKILL'); } catch { /* already gone */ }
    assert(await exited(holder, 10_000), `the hub ${holder} did not exit once killed`);
  });
  return path;
}
async function fixture() {
  const path = await home();
  const client = await connectHub({ home: path });
  await client.setConfig({ ...await client.getConfig(), listen: some({ host: '127.0.0.1', port: 0n }) });
  const mint = await client.enroll();
  const agent = await TestRackAgent.enroll(mint.apiUrl, mint.enrollmentToken, { certificateSha256: mint.certificateSha256.type === 'some' ? mint.certificateSha256.value : undefined });
  cleanup.push(() => agent.close());
  const repo = join(path, 'repo'); assert(repoInit(repo).success);
  const storage = new LocalStorage();
  const session = await RackSession.open(client, { storage, repoPath: repo, workspace: 'dev', label: 'client test' });
  cleanup.push(() => session.close());
  const request = { tier: 'node', computeSize: 'large', envManifests: [], eventJson: JSON.stringify({ version: 2, workspace: 'dev', taskName: 'task', closure: { hashes: [] },
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
  // Its spawner names each hub it spawned — the one serving among them — before the process that spawned it goes on.
  const spawned = await spawnedHubs(path);
  assert.ok(spawned.length >= 1 && spawned.length <= 3 && spawned.includes(pids[0]), `the log names the hubs spawned (${spawned.join(", ")}), the one serving among them`);
});

it('drains an older protocol, refuses a newer one and leaves its sessions alone', async () => {
  const path = await home();
  let protocol = BigInt(HUB_PROTOCOL) - 1n; let drains = 0;
  const app = new Hono();
  app.post('/v1/hello', () => answer(HubHelloType, { version: '1.0.0', protocol, pid: BigInt(process.pid), draining: false }));
  app.post('/v1/drain', () => { drains++; return answer(EmptyType, {}); });
  const server = await serveOnSocket(app, hubSocketPath(path));
  cleanup.push(() => closeSocketServer(server, hubSocketPath(path)));
  await assert.rejects(connectHub({ home: path }), (err: unknown) => err instanceof RackHubOutdatedError && /older.*exit once idle/.test(err.message));
  assert.equal(drains, 1);
  protocol = BigInt(HUB_PROTOCOL) + 1n;
  await assert.rejects(connectHub({ home: path }), (err: unknown) => err instanceof RackHubOutdatedError && /newer/.test(err.message));
  assert.equal(drains, 1);
});

it('drains a hub from before replies lost their envelope, whose hello it cannot read, and says how to replace it', async () => {
  const path = await home();
  let drains = 0;
  // Such a hub answers every route inside e3's HTTP response type.
  const enveloped = (bytes: Uint8Array) => new Response(bytes, { headers: { 'Content-Type': BEAST2_CONTENT_TYPE } });
  const app = new Hono();
  app.post('/v1/hello', () => enveloped(encodeBeast2For(ResponseType(HubHelloType))(variant('success',
    { version: '1.0.107', protocol: BigInt(HUB_PROTOCOL) - 1n, pid: BigInt(process.pid), draining: false }))));
  app.post('/v1/drain', () => { drains++; return enveloped(encodeBeast2For(ResponseType(EmptyType))(variant('success', {}))); });
  const server = await serveOnSocket(app, hubSocketPath(path));
  cleanup.push(() => closeSocketServer(server, hubSocketPath(path)));
  await assert.rejects(connectHub({ home: path }), (err: unknown) => err instanceof RackHubOutdatedError
    && /cannot read its replies/.test(err.message) && /exit once idle — run `e3 rack stop` with that e3/.test(err.message));
  assert.equal(drains, 1, 'the older hub is asked to drain, though its answer is not read');
  assert.deepEqual(await spawnedHubs(path), [], 'no hub is spawned beside one that is running');
});

it('reads no hello of a later release, nor one cut short, and takes neither for a hub from before replies lost their envelope', async () => {
  const path = await home();
  let drains = 0;
  const beast2 = (bytes: Uint8Array) => new Response(bytes, { headers: { 'Content-Type': BEAST2_CONTENT_TYPE } });
  // A later hello, grown by a field; then the current one, cut short.
  const later = encodeBeast2For(StructType({ version: StringType, protocol: IntegerType, pid: IntegerType, draining: BooleanType, region: StringType }))(
    { version: '9.0.0', protocol: BigInt(HUB_PROTOCOL), pid: BigInt(process.pid), draining: false, region: 'x' });
  const current = encodeBeast2For(HubHelloType)({ version: '1.0.0', protocol: BigInt(HUB_PROTOCOL), pid: BigInt(process.pid), draining: false });
  let hello = later;
  const app = new Hono();
  app.post('/v1/hello', () => beast2(hello));
  app.post('/v1/drain', () => { drains++; return answer(EmptyType, {}); });
  const server = await serveOnSocket(app, hubSocketPath(path));
  cleanup.push(() => closeSocketServer(server, hubSocketPath(path)));
  // What a connection does with such a hub is the negotiation's, below: asked of the hub itself, with no deadline to meet
  const client = new HubClient(path);
  for (const reply of [later, current.subarray(0, current.length - 3)]) {
    hello = reply;
    await assert.rejects(client.hello(), (err: unknown) => err instanceof RackHubError && err.code === 'undecodable' && /does not read as this e3's/.test(err.message));
    assert.equal(await client.answersInEnvelope(), false, 'it is no hub from before replies lost their envelope');
  }
  assert.equal(drains, 0, 'neither hub is asked to drain');
});

it('says a reply that begins and does not end timed out, as one that never begins does', async () => {
  const path = await home();
  // A hub that sends a reply's head and part of its body, and no more
  const server = createServer((_request, response) => {
    response.writeHead(200, { 'content-type': BEAST2_CONTENT_TYPE });
    response.write(Buffer.from([0x89]));
  });
  await new Promise<void>((resolve, reject) => { server.once('error', reject); server.listen(hubSocketPath(path), resolve); });
  cleanup.push(() => { server.closeAllConnections(); return closeSocketServer(server, hubSocketPath(path)); });
  const client = new HubClient(path);
  const timedOut = (err: unknown) => err instanceof RackHubError && err.code === 'timeout' && /^Rack request POST \/v1\/hello timed out$/.test(err.message);
  await assert.rejects(client.hello(50), timedOut);
  await assert.rejects(client.answersInEnvelope(50), timedOut);
});

type Step = 'draining' | 'ready' | 'unreadable' | 'unanswered' | 'absent';

/**
 * A hub that answers each hello as a script says, at once: no answer of it
 * waits on this machine's speed. `asked` holds the time each hello was given,
 * and `drained` how often it was asked to drain.
 */
function scriptedHub(script: Step[]): HubAsks & { asked: number[]; drained: number } {
  const asked: number[] = [];
  const hello = (draining: boolean) => ({ version: '1.0.0', protocol: BigInt(HUB_PROTOCOL), pid: BigInt(process.pid), draining });
  const hub = {
    asked,
    drained: 0,
    hello: (ms = 0) => {
      asked.push(ms);
      // The script's last step answers every hello after it
      const step = script[Math.min(asked.length, script.length) - 1]!;
      if (step === 'unanswered') return Promise.reject(new RackHubError('timeout', 'Rack request POST /v1/hello timed out'));
      if (step === 'unreadable') return Promise.reject(new RackHubError('undecodable', 'a field this e3 does not know'));
      if (step === 'absent') return Promise.reject(new RackHubError('ENOENT', 'connect ENOENT hub.sock'));
      return Promise.resolve(hello(step === 'draining'));
    },
    answersInEnvelope: () => Promise.resolve(false),
    drain: () => { hub.drained++; return Promise.resolve(); },
    drainUnread: () => { hub.drained++; return Promise.resolve(); },
  };
  return hub;
}
/** Negotiates with a scripted hub for `ms`, starting none unless `spawn` is given. */
const negotiate = (hub: HubAsks, ms: number, spawn?: () => Promise<void>) =>
  negotiateHub(hub, { deadline: Date.now() + ms, logFile: 'hub.log', ...(spawn !== undefined && { spawn }) });

it('asks a slow hub again until it answers', async () => {
  const hub = scriptedHub(['unanswered', 'unanswered', 'ready']);
  await negotiate(hub, 10_000);
  assert.equal(hub.asked.length, 3, 'two asks went unanswered, and the third was answered');
});

it('starts a hub where none answers, once, and asks until it does', async () => {
  const hub = scriptedHub(['absent', 'absent', 'absent', 'ready']);
  let spawned = 0;
  await negotiate(hub, 10_000, () => { spawned++; return Promise.resolve(); });
  assert.equal(spawned, 1, 'one hub was started for the asks that found none');
  assert.equal(hub.asked.length, 4);
  // With no way to start one, the first ask that finds none ends it
  const none = scriptedHub(['absent', 'ready']);
  await assert.rejects(negotiate(none, 10_000), (err: unknown) => err instanceof RackHubUnavailableError && /^Rack hub unavailable: connect ENOENT hub\.sock\. See hub\.log$/.test(err.message));
  assert.equal(none.asked.length, 1);
});

for (const [what, first, said] of [
  ['is draining', 'draining', /^Rack hub unavailable: the running rack hub is draining/],
  ['answers a hello that does not read', 'unreadable', /^Rack hub unavailable: the running rack hub's hello does not read as this e3's \(a field this e3 does not know\); it was not asked to drain/],
] as const) {
  // A hub that is draining is waited for only by a caller that could start its successor
  const spawn = () => Promise.resolve();

  it(`keeps that a hub ${what} when only asks cut short go unanswered`, async () => {
    // A deadline under an ask's whole time: every ask is cut short by it
    const hub = scriptedHub([first, 'unanswered']);
    await assert.rejects(negotiate(hub, HUB_ASK_MS / 2, spawn), (err: unknown) => err instanceof RackHubUnavailableError
      && said.test(err.message) && !/timed out|not answered since/.test(err.message));
    assert(hub.asked.every((ms) => ms < HUB_ASK_MS), `every ask was cut short: ${hub.asked.join(', ')}`);
    assert.equal(hub.drained, 0, 'it is not asked to drain');
  });

  it(`says a hub that ${what} stopped answering once a whole ask goes unanswered`, async () => {
    const hub = scriptedHub([first, 'unanswered']);
    let message = '';
    await assert.rejects(negotiate(hub, 2.5 * HUB_ASK_MS, spawn), (err: unknown) => {
      message = err instanceof RackHubUnavailableError ? err.message : '';
      return err instanceof RackHubUnavailableError;
    });
    assert.match(message, said);
    assert.doesNotMatch(message, /timed out/);
    // Judged by the time each unanswered ask was given, whatever this machine's speed made of it
    const whole = hub.asked.slice(1).some((ms) => ms >= HUB_ASK_MS);
    assert.equal(/; it has not answered since\. See /.test(message), whole, `asks were given ${hub.asked.join(', ')} ms: ${message}`);
    assert.equal(hub.drained, 0, 'it is not asked to drain');
  });
}

it('says an ask timed out of a hub that never answered one', async () => {
  const hub = scriptedHub(['unanswered']);
  await assert.rejects(negotiate(hub, HUB_ASK_MS / 2), (err: unknown) => err instanceof RackHubUnavailableError
    && /^Rack hub unavailable: Rack request POST \/v1\/hello timed out\. See /.test(err.message));
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

it('shares one capacity refresh among callers that ask together', async () => {
  const f = await fixture();
  const status = f.client.status.bind(f.client);
  let asked = 0;
  f.client.status = () => { asked++; return status(); };
  // A stage's units that wait for a rack look again together
  const together = await Promise.all([f.session.refreshCapacity(), f.session.refreshCapacity(), f.session.refreshCapacity()]);
  assert.equal(asked, 1, 'the callers shared one ask');
  assert(together.every((snapshot) => Object.is(snapshot, together[0])), 'and its answer, the one object');
  // One that accepts an answer of some age does not ask again, and one that does not, does
  await f.session.refreshCapacity(60 * 60_000);
  assert.equal(asked, 1);
  await f.session.refreshCapacity();
  assert.equal(asked, 2);
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
