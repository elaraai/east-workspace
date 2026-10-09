/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Licensed under BSL 1.1. See LICENSE for details.
 */

import { afterEach, it } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID, createHash } from 'node:crypto';
import { mkdtemp, realpath, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createServer } from 'node:http';
import { once } from 'node:events';
import { setTimeout as delay } from 'node:timers/promises';
import { East, IntegerType, StringType, decodeBeast2For, encodeBeast2For, none, some, variant } from '@elaraai/east';
import e3 from '@elaraai/e3';
import { decodeTaskObject } from '@elaraai/e3-types';
import { LocalStorage, inputsHash, packageImport, packageRead, processOwner, repoInit, uuidv7 } from '@elaraai/e3-core';
import { RackHub, type RackHubOptions } from './hub.js';
import { defaultHubConfig, saveHubConfig } from './config.js';
import { readHubLock } from './lock.js';
import { socketRequest } from '../client/local-http.js';
import { startSessionDataServer } from '../client/session-data-server.js';
import { hubSocketPath } from '../paths.js';
import { E3_RACK_VERSION, HUB_PROTOCOL } from '../version.js';
import { CancelLeaseResultType, CreateLeaseType, CreateLeaseResultType, EmptyType, HubConfigType,
  HubEnrollResultType, HubEnrollType, HubStatusType, OpenSessionType, OpenSessionResultType, SessionPollType, SessionPollResultType } from '../protocol/control.js';
import { TestRackAgent } from '../testing/test-rack-agent.js';
import { taskClosure } from '../lease/closure.js';
import type { RackLeaseEvent } from '../protocol/task-envelope.js';

const cleanup: Array<() => Promise<void>> = [];
afterEach(async () => { for (const close of cleanup.splice(0).reverse()) await close(); });
async function fixture(options: RackHubOptions = {}, port = 0) {
  const home = await mkdtemp(join(tmpdir(), 'e3h-'));
  cleanup.push(() => rm(home, { recursive: true, force: true }));
  const config = { ...defaultHubConfig(), listen: some({ host: '127.0.0.1', port: BigInt(port) }) };
  await saveHubConfig(config, home);
  const hub = new RackHub({ foreground: true, ...options, home });
  assert(await hub.start());
  cleanup.push(() => hub.stop());
  const socket = hubSocketPath(home);
  const status = () => socketRequest(socket, 'GET', '/v1/status', { responseType: HubStatusType });
  const storage = new LocalStorage();
  const repo = join(home, 'repo'); assert(repoInit(repo).success);
  const session = async (repoPath = repo, version = E3_RACK_VERSION) => {
    const dataToken = randomUUID();
    const logs: string[] = [];
    const data = await startSessionDataServer({ storage, repoPath, home, dataToken, onLog: (_id, _stream, text) => { logs.push(text); } });
    const opened = await socketRequest(socket, 'POST', '/v1/sessions', { requestType: OpenSessionType, responseType: OpenSessionResultType, body: {
      protocol: BigInt(HUB_PROTOCOL), e3Version: version, owner: await processOwner(), repoPath: await realpath(repoPath),
      workspace: 'dev', label: 'test session', dataSocket: data.socketPath, dataToken,
    } });
    const path = `/v1/sessions/${opened.sessionId}`;
    const close = async () => { await socketRequest(socket, 'DELETE', path, { responseType: EmptyType }).catch(() => {}); await data.close(); };
    cleanup.push(close);
    const create = (event: RackLeaseEvent) => socketRequest(socket, 'POST', `${path}/leases`, {
      requestType: CreateLeaseType, body: { eventJson: JSON.stringify(event), tier: 'node', computeSize: 'large' }, responseType: CreateLeaseResultType,
    });
    let after = 0n;
    const events = async () => {
      const response = await socketRequest(socket, 'POST', `${path}/events`, {
        requestType: SessionPollType, body: { after, waitMs: 0n }, responseType: SessionPollResultType,
      });
      after = response.events.at(-1)?.seq ?? after;
      return response;
    };
    const cancel = (id: string) => socketRequest(socket, 'POST', `${path}/leases/${encodeURIComponent(id)}/cancel`, { responseType: CancelLeaseResultType });
    return { ...opened, close, create, events, cancel, logs };
  };
  const agent = async () => {
    const mint = await socketRequest(socket, 'POST', '/v1/enroll', { requestType: HubEnrollType,
      body: { label: none, ttlMinutes: none }, responseType: HubEnrollResultType });
    const agent = await TestRackAgent.enroll(mint.apiUrl, mint.enrollmentToken);
    cleanup.push(() => agent.close());
    return agent;
  };
  return { home, hub, socket, repo, storage, status, session, agent, config };
}
function event(input: string[] = []): RackLeaseEvent {
  return { version: 2, taskName: 'task', workspace: 'dev', closure: { hashes: input },
    runnerEvent: { mode: 'task', repo: 'replaced-by-hub', taskHash: 'a'.repeat(64), inputHashes: input, launchId: uuidv7(), timeoutMs: 30000 } };
}

it('owns one hub, shares a task across sessions and commits a real runner output before publishing completion', async () => {
  const f = await fixture();
  assert.equal(await new RackHub({ home: f.home }).start(), false);
  const first = await f.session();
  const second = await f.session();
  const text = 'large input '.repeat(1000);
  const input = e3.input('text', StringType);
  const task = e3.task('length', [input], East.function([StringType], IntegerType, (_$, value) => value.length()));
  const zip = join(f.home, 'task.zip');
  await e3.export(e3.package('hub', '1.0.0', task), zip);
  await packageImport(f.storage, f.repo, zip);
  const pkg = await packageRead(f.storage, f.repo, 'hub', '1.0.0');
  const hash = pkg.tasks.get('length')!;
  const inputHash = await f.storage.objects.write(f.repo, encodeBeast2For(StringType)(text));
  const taskObject = decodeTaskObject(await f.storage.objects.read(f.repo, hash));
  const work: RackLeaseEvent = { version: 2, workspace: 'dev', taskName: 'length',
    closure: { hashes: await taskClosure(f.storage, f.repo, hash, taskObject, [inputHash]) },
    runnerEvent: { mode: 'task', repo: 'replaced', taskHash: hash, inputHashes: [inputHash], launchId: uuidv7(), timeoutMs: 30000 } };
  const created = await first.create(work);
  const agent = await f.agent();
  const grant = await agent.claim(); assert(grant);
  const attached = await second.create(work);
  assert.equal(attached.attached, true); assert.equal(attached.leaseId, created.leaseId);
  assert.equal(attached.attempt.type, 'some');
  const before = await first.events();
  assert.equal(before.events[0]?.event.type, 'claimed');
  await agent.logs(grant, [{ stream: variant('stdout', null), data: 'rack executing\n' }]);
  const result = await agent.execute(grant);
  assert.equal(result.status, 'success', result.error);
  assert(result.outputHash);
  assert.equal(decodeBeast2For(IntegerType)(await f.storage.objects.read(f.repo, result.outputHash)), BigInt(text.length));
  const events = await first.events();
  assert.deepEqual(events.events.map((e) => e.event.type), ['completed']);
  const secondEvents = await second.events();
  assert.deepEqual(secondEvents.events.map((e) => e.event.type), ['claimed', 'completed']);
  const claimed = before.events[0]!.event; assert(claimed.type === 'claimed');
  assert.equal((await f.storage.refs.executionGet(f.repo, hash, inputsHash([inputHash]), claimed.value.attempt.executionId))?.type, 'success');
  const persisted = (await f.storage.logs.read(f.repo, hash, inputsHash([inputHash]), claimed.value.attempt.executionId, 'stdout')).data;
  assert.match(persisted, /^e3: running on rack test rack \(lease .+\)\nrack executing\n$/);
  assert.equal(first.logs.join(''), persisted);
  assert.deepEqual(second.logs, ['rack executing\n']);
});

it('takes over acknowledged uploads and cancels a shared lease only after its last subscriber leaves', async () => {
  const f = await fixture();
  const first = await f.session(); const second = await f.session();
  const created = await first.create(event());
  assert.equal((await second.create(event())).leaseId, created.leaseId);
  const agent = await f.agent();
  const grant = await agent.claim(); assert(grant);
  const bytes = encodeBeast2For(IntegerType)(42n);
  const hash = createHash('sha256').update(bytes).digest('hex');
  const size = BigInt(bytes.length);
  const response = await agent.storageRequest(grant, { outputs: [{ hash, size }] });
  const target = response.targets[0]!.target; assert(target.type === 'put');
  const bad = await fetch(target.value.url, { method: 'PUT', body: new Uint8Array(bytes.length) });
  assert.equal(bad.status, 400); await bad.arrayBuffer();
  const put = await fetch(target.value.url, { method: 'PUT', body: bytes });
  assert.equal(put.status, 200); await put.arrayBuffer();
  const version = put.headers.get('x-amz-version-id')!;
  await first.close();
  assert.equal((await agent.heartbeat([grant])).stop.length, 0);
  assert.equal((await agent.storageRequest(grant, { commits: [{ hash, size, version }] })).committed[0]!.committed, true);
  assert.equal((await second.cancel(created.leaseId)).status, 'cancelled');
  assert.deepEqual((await agent.heartbeat([grant])).stop, [{ repo: grant.repo, leaseId: grant.leaseId }]);
  assert.equal((await fetch(target.value.url, { method: 'PUT', body: bytes })).status, 404);
  assert.equal((await agent.complete(grant, { taskName: 'task', status: 'success', outputHash: hash })).disposition.type, 'discarded');
  assert.equal(await f.storage.objects.exists(f.repo, hash), true);
});

it('does not deduplicate across repositories or e3 releases and expires abandoned sessions', async () => {
  let time = Date.now();
  const f = await fixture({ now: () => time });
  const otherRepo = join(f.home, 'other'); assert(repoInit(otherRepo).success);
  const first = await f.session(); const other = await f.session(otherRepo); const version = await f.session(f.repo, '1.0.84');
  const ids = await Promise.all([first.create(event()), other.create(event()), version.create(event())]);
  assert.equal(new Set(ids.map((lease) => lease.leaseId)).size, 3);
  time += 45001;
  await f.hub.sweep();
  const status = await f.status();
  assert.equal(status.sessions.length, 0); assert.equal(status.capacity.queued, 0n);
});

it('reports lost rack work after its reclaim window and replays a fresh attempt when another rack takes over', async () => {
  let time = Date.now();
  const f = await fixture({ now: () => time, visibilityMs: 100 });
  const session = await f.session(); await session.create(event());
  const first = await f.agent(); const grant = await first.claim(); assert(grant);
  const before = (await session.events()).events[0]!.event; assert(before.type === 'claimed');
  time += 101;
  const second = await f.agent(); assert(await second.claim());
  const next = (await session.events()).events[0]!.event; assert(next.type === 'claimed');
  assert.notEqual(before.value.attempt.executionId, next.value.attempt.executionId);
  assert.equal((await first.complete(grant, { taskName: 'task', status: 'failed' })).disposition.type, 'discarded');
  time += 201;
  await f.hub.sweep();
  assert.equal((await session.events()).events[0]?.event.type, 'lost');
  assert.equal((await second.heartbeat([grant])).stop.length, 1);
});

it('enforces the rack allowlist, retries an occupied listener and exits only once idle', async () => {
  const occupied = createServer(); occupied.listen(0, '127.0.0.1'); await once(occupied, 'listening');
  cleanup.push(async () => { if (occupied.listening) { const closed = once(occupied, 'close'); occupied.close(); await closed; } });
  const address = occupied.address(); assert(address && typeof address !== 'string');
  let time = Date.now();
  const f = await fixture({ now: () => time, listenerRetryMs: 20, idleExitMinutes: 1 }, address.port);
  assert.equal((await f.status()).rackListener.type, 'down');
  const closed = once(occupied, 'close'); occupied.close(); await closed;
  for (let n = 0; n < 100 && (await f.status()).rackListener.type !== 'up'; n++) await delay(20);
  const status = await f.status(); assert(status.rackListener.type === 'up');
  const config = { ...f.config, allow: ['192.0.2.1'] };
  await socketRequest(f.socket, 'POST', '/v1/config', { requestType: HubConfigType, body: config, responseType: HubConfigType });
  assert.equal((await fetch(`${status.rackListener.value.origin}/api/rack/enroll`, { method: 'POST' })).status, 403);
  await socketRequest(f.socket, 'POST', '/v1/config', { requestType: HubConfigType, body: { ...config, allow: ['::ffff:127.0.0.1'] }, responseType: HubConfigType });
  await f.agent();
  const session = await f.session();
  time += 60001; await session.events(); await f.hub.sweep();
  assert.equal((await f.status()).sessions.length, 1);
  await session.close(); time += 60001; await f.hub.sweep(); await f.hub.closed;
  assert.equal(await readHubLock(f.home), null);
});
