/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Licensed under BSL 1.1. See LICENSE for details.
 */

import { afterEach, it } from 'node:test';
import assert from 'node:assert/strict';
import { randomBytes, createHash } from 'node:crypto';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createServer } from 'node:http';
import { once } from 'node:events';
import { setTimeout as delay } from 'node:timers/promises';
import { East, IntegerType, OptionType, StringType, decodeBeast2For, encodeBeast2For, equalFor, none, some, variant } from '@elaraai/east';
import e3 from '@elaraai/e3';
import { decodeTaskObject } from '@elaraai/e3-types';
import { hostEnvironmentPlatform, inputsHash, packageImport, packageRead, repoInit, uuidv7 } from '@elaraai/e3-core';
import { RackHub } from './hub.js';
import { defaultHubConfig } from './config.js';
import { readHubLock } from './lock.js';
import { socketRequest } from '../client/local-http.js';
import { HUB_CONFIG_FILE, hubSocketPath } from '../paths.js';
import { E3_RACK_VERSION } from '../version.js';
import { ApproveRackType, HubAttemptType, HubConfigType, HubEnrollResultType, HubEnrollType, HubStatusType, RemoveRackResultType } from '../protocol/control.js';
import { RackRegistrationType, RackSecurityPolicyType } from '../protocol/registration.js';
import { RackHeartbeatRequestType, RackHeartbeatResponseType } from '../protocol/rack-wire.js';
import { sameLeaseRefs } from '../testing/lease-refs.js';
import { RACK_CALL_VALUE_OBJECTS, RACK_LISTENER_IDLE_MS, RACK_PROTOCOL, RACK_TIER_MANIFESTS, RACK_TRANSFERS_AT_ONCE, readRackHello, readRackRefusal } from '../protocol/rack-json.js';
import { TestRackAgent, type TestRackAgentOptions } from '../testing/test-rack-agent.js';
import { certificateSha256, createHubCertificate } from '../tls/tls.js';
import { writeStateFile } from '../state-file.js';
import { taskClosure } from '../lease/closure.js';
import { type RackLeaseEvent } from '../protocol/task-envelope.js';
import { splitUnitToWire } from '../runner-event.js';
import { closeAll, cleanup, fixture, event, call } from './hub.test-utils.js';

afterEach(closeAll);

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
  const claimed = before.events[0]!.event; assert(claimed.type === 'claimed' && claimed.value.attempt.type === 'some');
  const executionId = claimed.value.attempt.value.executionId;
  assert.equal((await f.storage.refs.executionGet(f.repo, hash, inputsHash([inputHash]), executionId))?.type, 'success');
  const persisted = (await f.storage.logs.read(f.repo, hash, inputsHash([inputHash]), executionId, 'stdout')).data;
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
  const bad = await f.fetch(target.value.url, { method: 'PUT', body: new Uint8Array(bytes.length) });
  assert.equal(bad.status, 400); await bad.arrayBuffer();
  const put = await f.fetch(target.value.url, { method: 'PUT', body: bytes });
  assert.equal(put.status, 200); await put.arrayBuffer();
  const version = put.headers.get('x-amz-version-id')!;
  await first.close();
  assert.equal((await agent.heartbeat([grant])).stop.length, 0);
  assert.equal((await agent.storageRequest(grant, { commits: [{ hash, size, version }] })).committed[0]!.committed, true);
  assert.equal((await second.cancel(created.leaseId)).status, 'cancelled');
  assert.ok(sameLeaseRefs((await agent.heartbeat([grant])).stop, [{ repo: grant.repo, leaseId: grant.leaseId }]));
  assert.equal((await f.fetch(target.value.url, { method: 'PUT', body: bytes })).status, 404);
  assert.equal((await agent.complete(grant, { taskName: 'task', status: 'success', outputHash: hash })).disposition.type, 'discarded');
  assert.equal(await f.storage.objects.exists(f.repo, hash), true);
});

it('attaches to identical work already queued without queuing, and queues nothing for work no session holds', async () => {
  const f = await fixture();
  const first = await f.session(); const second = await f.session();
  assert.equal((await second.attach(event())).type, 'none');
  assert.equal((await f.status()).capacity.queued, 0n, 'an attach-only request queues nothing');
  const created = await first.create(event());
  const attached = await second.attach(event());
  assert(attached.type === 'some');
  assert.equal(attached.value.leaseId, created.leaseId); assert.equal(attached.value.attached, true);
  const status = await f.status();
  assert.equal(status.capacity.queued, 1n);
  assert.equal(status.sessions.find((session) => session.sessionId === second.sessionId)?.pending, 1n, 'the attached session subscribes to the lease');
});

it('leases each call as its own lease, attaches none to another, and publishes a claim of one that names no attempt and writes no log line', async () => {
  const f = await fixture();
  const first = await f.session(); const second = await f.session();
  const program = 'b'.repeat(64);
  // Two calls of one program, made at once, are two leases: they differ by their arguments alone
  const [a, b] = await Promise.all([first.create(call(program, 2n)), first.create(call(program, 3n))]);
  assert.notEqual(a.leaseId, b.leaseId);
  assert.deepEqual([a.attached, b.attached], [false, false]);
  // The same call again, from another session, is its own lease too
  const again = await second.create(call(program, 2n));
  assert.equal(again.attached, false);
  assert.equal(new Set([a.leaseId, b.leaseId, again.leaseId]).size, 3);
  assert.equal((await second.attach(call(program, 2n))).type, 'none', 'a call joins no other, and an attach-only request of one queues nothing');
  assert.equal((await f.status()).capacity.queued, 3n);

  // One of them left in the queue, a rack claims it
  for (const [session, id] of [[first, b.leaseId], [second, again.leaseId]] as const) assert.equal((await session.cancel(id)).status, 'cancelled');
  const agent = await f.agent();
  const grant = await agent.claim(); assert.equal(grant?.leaseId, a.leaseId);
  const claims = (await first.events()).events.map((e) => e.event).filter((e) => e.type === 'claimed');
  assert.equal(claims.length, 1); assert(claims[0]!.type === 'claimed');
  assert.ok(equalFor(OptionType(HubAttemptType))(claims[0]!.value.attempt, none), 'a call\'s lease runs no attempt');
  assert.deepEqual(first.logs, [], 'and keeps no log');
  await assert.rejects(first.create({ ...call(program, 4n), program: 'not a hash' }), /A call's lease names its program/);
});

it('quarantines a rebooted rack until its boot is approved, only while the policy requires it', async () => {
  const f = await fixture();
  const agent = await f.agent();
  const policy = () => socketRequest(f.socket, 'GET', '/v1/security', { responseType: RackSecurityPolicyType });
  assert.deepEqual(await policy(), { requireStartApproval: false });
  const reboot = async (bootId: string) => {
    const response = await agent.raw('heartbeat', RackHeartbeatRequestType, { healthy: true, freeCapacity: 1n, runningLeases: [], agentVersion: `0.5.0+e3.${E3_RACK_VERSION}`, bootId, cacheBytes: 0n,
      report: JSON.stringify({ features: [] }) });
    assert.equal(response.status, 200);
    return decodeBeast2For(RackHeartbeatResponseType)(new Uint8Array(await response.arrayBuffer()));
  };
  const pending = async () => (await f.status()).capacity.racks[0]!.pendingApproval;
  // Without the policy a reboot is admitted as the first boot was.
  assert.equal((await reboot('second-boot')).pendingApproval, false); assert.equal(await pending(), false);
  await socketRequest(f.socket, 'POST', '/v1/security', { requestType: RackSecurityPolicyType, body: { requireStartApproval: true }, responseType: RackSecurityPolicyType });
  assert.deepEqual(await policy(), { requireStartApproval: true });
  assert.equal(await pending(), true, 'the reboot since the approved boot is quarantined');
  const rack = (await f.status()).racks[0]!;
  const approve = (bootId: string) => socketRequest(f.socket, 'POST', `/v1/racks/${rack.rackId}/approve`, { requestType: ApproveRackType, body: { bootId }, responseType: RackRegistrationType });
  await assert.rejects(approve('stale-boot'), /rebooted; refresh before approving/);
  assert.deepEqual((await approve('second-boot')).approvedBootId, some('second-boot'));
  assert.equal(await pending(), false);
  // The rack boots again, as itself: quarantined until that boot is approved; then it is leased work.
  assert.equal((await reboot(agent.bootId)).pendingApproval, true); assert.equal(await pending(), true);
  await approve(agent.bootId); assert.equal(await pending(), false);
  const session = await f.session(); await session.create(event());
  assert(await agent.claim());
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
  const before = (await session.events()).events[0]!.event; assert(before.type === 'claimed' && before.value.attempt.type === 'some');
  time += 101;
  const second = await f.agent(); assert(await second.claim());
  const next = (await session.events()).events[0]!.event; assert(next.type === 'claimed' && next.value.attempt.type === 'some');
  assert.notEqual(before.value.attempt.value.executionId, next.value.attempt.value.executionId);
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
  assert.equal((await f.fetch(`${status.rackListener.value.origin}/api/rack/enroll`, { method: 'POST' })).status, 403);
  await socketRequest(f.socket, 'POST', '/v1/config', { requestType: HubConfigType, body: { ...config, allow: ['::ffff:127.0.0.1'] }, responseType: HubConfigType });
  await f.agent();
  const session = await f.session();
  time += 60001; await session.events(); await f.hub.sweep();
  assert.equal((await f.status()).sessions.length, 1);
  await session.close(); time += 60001; await f.hub.sweep(); await f.hub.closed;
  assert.equal(await readHubLock(f.home), null);
});

it('serves its rack listener over TLS with a certificate it keeps across restarts, and a rack pinning another is refused', async () => {
  const f = await fixture();
  const status = await f.status();
  assert(status.rackListener.type === 'up');
  assert.match(status.rackListener.value.origin, /^https:\/\/127\.0\.0\.1:\d+$/);
  assert.deepEqual(status.rackListener.value.certificateSha256, some(f.pin));
  const mint = await socketRequest(f.socket, 'POST', '/v1/enroll', { requestType: HubEnrollType, body: { label: none, ttlMinutes: none }, responseType: HubEnrollResultType });
  assert.deepEqual(mint.certificateSha256, some(f.pin));
  const other = certificateSha256(createHubCertificate().certificatePem);
  await assert.rejects(TestRackAgent.enroll(mint.apiUrl, mint.enrollmentToken, { certificateSha256: other }), /not the pinned/);
  await assert.rejects(TestRackAgent.enroll(mint.apiUrl, mint.enrollmentToken), 'an unpinned rack refuses the self-signed certificate');
  await TestRackAgent.enroll(mint.apiUrl, mint.enrollmentToken, { certificateSha256: f.pin }).then((agent) => agent.close());
  await f.hub.stop();
  const again = new RackHub({ foreground: true, home: f.home });
  assert(await again.start());
  cleanup.push(() => again.stop());
  const restarted = await f.status();
  assert(restarted.rackListener.type === 'up');
  assert.deepEqual(restarted.rackListener.value.certificateSha256, some(f.pin), 'the certificate every rack pinned is kept');
});

it('builds every data URL on the advertised origin, not the origin the rack request named', async () => {
  const f = await fixture();
  // Enrolled at the listener itself; the relay's name resolves nowhere here.
  const agent = await f.agent();
  const advertised = 'https://rack-relay.example.invalid:7401';
  await socketRequest(f.socket, 'POST', '/v1/config', { requestType: HubConfigType, body: { ...f.config, advertiseUrl: some(advertised) }, responseType: HubConfigType });
  const session = await f.session(); await session.create(event());
  const grant = await agent.claim(); assert(grant);
  const bytes = encodeBeast2For(IntegerType)(7n);
  const response = await agent.storageRequest(grant, { outputs: [{ hash: createHash('sha256').update(bytes).digest('hex'), size: BigInt(bytes.length) }] });
  const target = response.targets[0]!.target; assert(target.type === 'put');
  assert(target.value.url.startsWith(`${advertised}/api/rack/data/`), target.value.url);
  const mint = await socketRequest(f.socket, 'POST', '/v1/enroll', { requestType: HubEnrollType, body: { label: none, ttlMinutes: none }, responseType: HubEnrollResultType });
  assert.equal(mint.apiUrl, advertised);
});

it('keeps a saved listener it must not serve down, with the reason, until its configuration changes', async () => {
  const home = await mkdtemp(join(tmpdir(), 'e3h-'));
  cleanup.push(() => rm(home, { recursive: true, force: true }));
  // A configuration a newer rule refuses, written as an older release would have.
  const unsafe = { ...defaultHubConfig(), listen: some({ host: '127.0.0.1', port: 0n }), tls: false };
  await writeStateFile(join(home, HUB_CONFIG_FILE), encodeBeast2For(HubConfigType)(unsafe));
  const hub = new RackHub({ foreground: true, home });
  assert(await hub.start());
  cleanup.push(() => hub.stop());
  const socket = hubSocketPath(home);
  const down = await socketRequest(socket, 'GET', '/v1/status', { responseType: HubStatusType });
  assert(down.rackListener.type === 'down');
  assert.match(down.rackListener.value.reason, /must name the addresses it admits/);
  await assert.rejects(socketRequest(socket, 'POST', '/v1/config', { requestType: HubConfigType, body: unsafe, responseType: HubConfigType }), /must name the addresses/);
  await socketRequest(socket, 'POST', '/v1/config', { requestType: HubConfigType, body: { ...unsafe, allow: ['127.0.0.1'] }, responseType: HubConfigType });
  const up = await socketRequest(socket, 'GET', '/v1/status', { responseType: HubStatusType });
  assert(up.rackListener.type === 'up');
  assert.match(up.rackListener.value.origin, /^http:\/\//);
  assert.deepEqual(up.rackListener.value.certificateSha256, none);
  const mint = await socketRequest(socket, 'POST', '/v1/enroll', { requestType: HubEnrollType, body: { label: none, ttlMinutes: none }, responseType: HubEnrollResultType });
  assert.deepEqual(mint.certificateSha256, none);
  const agent = await TestRackAgent.enroll(mint.apiUrl, mint.enrollmentToken);
  await agent.close();
});

it('enrolls through a listener on every address only once an origin is advertised', async () => {
  const f = await fixture({}, 0, { listen: some({ host: '0.0.0.0', port: 0n }) });
  const enroll = () => socketRequest(f.socket, 'POST', '/v1/enroll', { requestType: HubEnrollType, body: { label: none, ttlMinutes: none }, responseType: HubEnrollResultType });
  await assert.rejects(enroll(), /binds every address; set --advertise-url/);
  await socketRequest(f.socket, 'POST', '/v1/config', { requestType: HubConfigType,
    body: { ...f.config, advertiseUrl: some('https://rack-source.example.invalid') }, responseType: HubConfigType });
  assert.equal((await enroll()).apiUrl, 'https://rack-source.example.invalid');
});

it('says what it speaks to anyone who reaches its listener, what each rack reports of itself, and why a rack that asks in another protocol cannot be used', async () => {
  const lines: string[] = [];
  const f = await fixture({ log: (line) => { lines.push(line); } });
  const status = await f.status(); assert(status.rackListener.type === 'up');
  const hello = await f.fetch(`${status.rackListener.value.origin}/api/rack/hello`);
  assert.deepEqual(readRackHello(await hello.text()), { protocol: RACK_PROTOCOL, e3: E3_RACK_VERSION, limits: { transfersAtOnce: RACK_TRANSFERS_AT_ONCE },
    features: [RACK_CALL_VALUE_OBJECTS, RACK_TIER_MANIFESTS] },
  'a session reads a call\'s value from the object its completion commits, and builds an environment over the tier image a rack reports');

  const agent = await f.agent({ report: { features: ['resources', 'environments'], target: 'x86_64-manylinux_2_28' } });
  const rack = async () => (await f.status()).capacity.racks[0]!;
  const reported = await rack();
  assert.deepEqual(reported.features, ['resources', 'environments']);
  assert.deepEqual(reported.target, some('x86_64-manylinux_2_28'));
  assert.deepEqual(reported.problem, none);

  // The same rack, its agent now one of another release: refused by name each
  // time it asks, said once in the log, and in the status for as long as it holds.
  const heartbeat = { healthy: true, freeCapacity: 1n, runningLeases: [], agentVersion: `0.5.0+e3.${E3_RACK_VERSION}`, bootId: agent.bootId, cacheBytes: 0n,
    report: JSON.stringify({ features: [] }) };
  for (let asked = 0; asked < 2; asked++) {
    const refused = await agent.raw('heartbeat', RackHeartbeatRequestType, heartbeat, 2);
    assert.equal(refused.status, 426); await refused.arrayBuffer();
  }
  assert.deepEqual((await rack()).problem, some(`speaks rack protocol 2, not ${RACK_PROTOCOL}; update the rack`));
  assert.deepEqual((await rack()).features, ['resources', 'environments'], 'a refused heartbeat is not read');
  assert.equal(lines.filter((line) => line.includes(`rack ${agent.rackId} refused: it speaks rack protocol 2`)).length, 1);
  const unnamed = await agent.raw('heartbeat', RackHeartbeatRequestType, heartbeat, null);
  assert.equal(unnamed.status, 426); await unnamed.arrayBuffer();
  assert.deepEqual((await rack()).problem, some(`speaks a rack protocol from before it was named, not ${RACK_PROTOCOL}; update the rack`));

  // Its agent updated, its next heartbeat is read and the problem is gone.
  await agent.heartbeat();
  assert.deepEqual((await rack()).problem, none);
  // A rack that is removed takes what was known of it along.
  await socketRequest(f.socket, 'DELETE', `/v1/racks/${agent.rackId}`, { responseType: RemoveRackResultType });
  assert.equal((await f.status()).capacity.racks.length, 0);
});

it('never enrols an agent of another rack protocol, and keeps its token for the agent that replaces it', async () => {
  const f = await fixture();
  const mint = await socketRequest(f.socket, 'POST', '/v1/enroll', { requestType: HubEnrollType, body: { label: none, ttlMinutes: none }, responseType: HubEnrollResultType });
  await assert.rejects(TestRackAgent.enroll(mint.apiUrl, mint.enrollmentToken, { certificateSha256: f.pin, protocol: 2 }),
    /HTTP 426 upgrade-required: this source speaks rack protocol 3, and the request names 2: update the rack's agent/);
  assert.equal((await f.status()).racks.length, 0);
  const agent = await TestRackAgent.enroll(mint.apiUrl, mint.enrollmentToken, { certificateSha256: f.pin });
  cleanup.push(() => agent.close());
  assert.equal((await f.status()).racks.length, 1);
});

it('serves one rack eight transfers at once, tells it to ask again for a ninth, and serves another rack meanwhile', async () => {
  const f = await fixture();
  const session = await f.session();
  const inputs = await f.objects(1, 8192); const [input] = [...inputs.keys()];
  await session.create(event([input!]));
  const first = await f.agent(); const grant = await first.claim(); assert(grant);
  const others = await f.objects(1, 8192); const [other] = [...others.keys()];
  await session.create(event([other!]));
  const second = await f.agent(); const otherGrant = await second.claim(); assert(otherGrant);
  const read = async (agent: TestRackAgent, lease: typeof grant, hash: string) => {
    const descriptor = (await agent.storageRequest(lease, { need: [hash] })).objects[0]; assert(descriptor?.type === 'url');
    return f.fetch(descriptor.value.url);
  };

  // Eight uploads whose bodies have not ended are in flight for as long as the test holds them.
  // Each sends half its body at once: a request's head goes out with its first bytes.
  const stop = new AbortController();
  const held = await Promise.all(Array.from({ length: RACK_TRANSFERS_AT_ONCE }, async () => {
    const bytes = randomBytes(64);
    const hash = createHash('sha256').update(bytes).digest('hex');
    const target = (await first.storageRequest(grant, { outputs: [{ hash, size: BigInt(bytes.length) }] })).targets[0]!.target; assert(target.type === 'put');
    let body!: ReadableStreamDefaultController<Uint8Array>;
    const response = f.fetch(target.value.url, { method: 'PUT', signal: stop.signal, duplex: 'half',
      body: new ReadableStream<Uint8Array>({ start(controller) { body = controller; controller.enqueue(bytes.subarray(0, 32)); } }) } as RequestInit);
    response.catch(() => {}); // those still held when the test ends are aborted
    return { bytes, body, response };
  }));
  // Each is counted once its request reaches the hub: until then a read is served.
  let refused: Response | undefined;
  for (let asked = 0; asked < 200 && refused === undefined; asked++) {
    const response = await read(first, grant, input!);
    if (response.status === 429) refused = response;
    else { assert.equal(response.status, 200); await response.arrayBuffer(); await delay(10); }
  }
  assert(refused, 'a ninth transfer is refused while eight are in flight');
  assert.equal(refused.headers.get('retry-after'), '1');
  assert.deepEqual(readRackRefusal(await refused.text()), { code: 'busy', message: '8 transfers are in flight for this rack', retryAfterMs: 500 });

  // The bound is each rack's own.
  const elsewhere = await read(second, otherGrant, other!);
  assert.equal(elsewhere.status, 200); assert.deepEqual(Buffer.from(await elsewhere.arrayBuffer()), others.get(other!));

  // One of the eight ends, and the rack has a transfer free again.
  held[0]!.body.enqueue(held[0]!.bytes.subarray(32)); held[0]!.body.close();
  const put = await held[0]!.response; assert.equal(put.status, 200); await put.arrayBuffer();
  let served: Response | undefined;
  for (let asked = 0; asked < 200 && served === undefined; asked++) {
    const response = await read(first, grant, input!);
    if (response.status === 200) served = response; else { assert.equal(response.status, 429); await response.arrayBuffer(); await delay(10); }
  }
  assert(served, 'a transfer is served once one of the eight has ended');
  assert.deepEqual(Buffer.from(await served.arrayBuffer()), inputs.get(input!));
  stop.abort();
});

it('reads an object from a byte on, so a transfer a link cut short goes on from where it stopped', async () => {
  const f = await fixture();
  const session = await f.session();
  const size = 1024 * 1024;
  const inputs = await f.objects(1, size); const [hash] = [...inputs.keys()]; const bytes = inputs.get(hash!)!;
  await session.create(event([hash!]));
  const { link, origin } = await f.link({});
  const agent = await f.agent({ timings: { retryMs: 1 } }, origin); const grant = await agent.claim(); assert(grant);

  const descriptor = (await agent.storageRequest(grant, { need: [hash!] })).objects[0]; assert(descriptor?.type === 'url');
  assert(descriptor.value.url.startsWith(`${origin}/api/rack/data/`), 'a data URL is on the origin the rack asked at');
  const whole = await f.fetch(descriptor.value.url);
  assert.equal(whole.status, 200); assert.equal(whole.headers.get('accept-ranges'), 'bytes'); await whole.arrayBuffer();
  const rest = await f.fetch(descriptor.value.url, { headers: { range: 'bytes=1000000-' } });
  assert.equal(rest.status, 206);
  assert.equal(rest.headers.get('content-range'), `bytes 1000000-${size - 1}/${size}`);
  assert.equal(rest.headers.get('content-length'), String(size - 1000000));
  assert.deepEqual(Buffer.from(await rest.arrayBuffer()), bytes.subarray(1000000));
  const past = await f.fetch(descriptor.value.url, { headers: { range: `bytes=${size}-` } });
  assert.equal(past.status, 416); assert.equal(past.headers.get('content-range'), `bytes */${size}`); await past.arrayBuffer();
  // A range it does not serve is answered with the whole object, as a server may.
  const other = await f.fetch(descriptor.value.url, { headers: { range: 'bytes=0-99' } });
  assert.equal(other.status, 200); assert.equal((await other.arrayBuffer()).byteLength, size);

  // The link drops the connection a third of the way through the body.
  link.cutAfter(350_000);
  const before = link.carried.towardsAgent;
  await agent.fetch(grant, [hash!]);
  assert.equal(link.cuts, 1);
  assert.equal(agent.transfers.resumed, 1, 'the second try was answered from the byte the first reached');
  const carried = link.carried.towardsAgent - before;
  assert(carried >= size && carried < size + 64 * 1024, `the bytes the first try carried were not sent again: the link carried ${carried} for an object of ${size}`);
  assert.equal(agent.transfers.retried, 1);
  assert(await agent.holds(hash!), 'the object arrived whole: the agent\'s store took it under its own hash');
});

it('gives a transfer five tries, and fails its lease\'s fetch only when the fifth has failed', async () => {
  const f = await fixture();
  const session = await f.session();
  const inputs = await f.objects(2, 8192); const [recovers, fails] = [...inputs.keys()];
  await session.create(event([recovers!, fails!]));
  const agent = await f.agent({ timings: { retryMs: 1 }, faults: {} }); const grant = await agent.claim(); assert(grant);
  agent.faults.failTransferNext = 4;
  await agent.fetch(grant, [recovers!]);
  assert.equal(agent.transfers.retried, 4); assert(await agent.holds(recovers!));
  agent.faults.failTransferNext = 5;
  await assert.rejects(agent.fetch(grant, [fails!]), new RegExp(`Rack input ${fails} failed after 5 tries: injected transfer failure`));
  assert.equal(await agent.holds(fails!), false);
  // A request its source refuses is not sent again: a URL that is not this rack's to read.
  const before = agent.transfers.retried;
  const ended = (await agent.storageRequest(grant, { need: [fails!] })).objects[0]; assert(ended?.type === 'url');
  const wrong = await f.fetch(ended.value.url, { method: 'PUT', body: new Uint8Array(1) });
  assert.equal(wrong.status, 404); await wrong.arrayBuffer();
  assert.equal(agent.transfers.retried, before);
});

it('keeps an idle connection of a rack for seventy-five seconds, and says so in every reply', async () => {
  const f = await fixture();
  const status = await f.status(); assert(status.rackListener.type === 'up');
  const hello = await f.fetch(`${status.rackListener.value.origin}/api/rack/hello`);
  assert.equal(hello.headers.get('keep-alive'), `timeout=${RACK_LISTENER_IDLE_MS / 1000}`); await hello.arrayBuffer();
  assert.equal(RACK_LISTENER_IDLE_MS, 75_000);
});

it('carries a burst of input transfers over a slow link with no failed transfer, never more than eight of a rack\'s in flight', async () => {
  const f = await fixture();
  const session = await f.session();
  // A link of 8 MiB/s that every connection shares, and three leases of eight inputs each, fetched at once.
  const { origin } = await f.link({ delayMs: 5, bytesPerSecond: 8 * 1024 * 1024 });
  const agent = await f.agent({ capacity: 3 }, origin);
  const leases = [];
  for (let n = 0; n < 3; n++) {
    const inputs = await f.objects(8, 192 * 1024);
    await session.create(event([...inputs.keys()]));
    const grant = await agent.claim(); assert(grant);
    leases.push({ grant, inputs });
  }
  await Promise.all(leases.map(({ grant, inputs }) => agent.fetch(grant, [...inputs.keys()])));
  for (const { inputs } of leases) for (const hash of inputs.keys()) assert(await agent.holds(hash));
  assert.equal(agent.transfers.peak, RACK_TRANSFERS_AT_ONCE, 'the agent has as many in flight as its source\'s hello allows, and no more');
  assert.equal(agent.transfers.busy, 0, 'the hub never had a ninth to refuse');
  assert.equal(agent.transfers.retried, 0);

  // An agent that does not hold itself to the limit is held to it by the hub, and loses nothing by it.
  const greedy = await f.agent({ transfersAtOnce: 24 }, origin);
  const inputs = await f.objects(24, 64 * 1024);
  await session.create(event([...inputs.keys()]));
  const grant = await greedy.claim(); assert(grant);
  await greedy.fetch(grant, [...inputs.keys()]);
  for (const hash of inputs.keys()) assert(await greedy.holds(hash));
  assert(greedy.transfers.peak > RACK_TRANSFERS_AT_ONCE, `the agent asked for ${greedy.transfers.peak} at once`);
  assert(greedy.transfers.busy > 0, 'the hub told it to ask again');
  assert.equal(greedy.transfers.retried, 0, 'being told to wait is no failed try');
});

it('grants a lease to a rack whose offer holds it, lets smaller work pass a larger lease for ten seconds, then holds the line for it', async () => {
  let time = Date.now();
  const GiB = 1024 ** 3;
  const f = await fixture({ now: () => time, leaseWindowMs: 40 });
  const session = await f.session();
  const agent = await f.agent({ resources: { cores: 4, memoryBytes: 8 * GiB, gpus: 0 } });
  const rack = async () => (await f.status()).capacity.racks[0]!;
  assert.deepEqual((await rack()).features, hostEnvironmentPlatform() === null ? ['resources'] : ['resources', 'environments']);
  // Each lease is its own work: its inputs name it.
  const piece = (name: string, memoryBytes: number) => session.create(event([name.repeat(64)], { kind: 'unit', cores: 1, memoryBytes, gpu: false }));
  const failed = { taskName: 'task', status: 'failed' as const };

  const first = await piece('1', 3 * GiB);
  const held = await agent.claim(); assert.equal(held?.leaseId, first.leaseId);
  assert.deepEqual(agent.bookedFor(first.leaseId), { kind: 'unit', cores: 1, memoryBytes: 3 * GiB, gpu: false }, 'the rack books the lease at its cap');
  // The status says all the rack has, and what this hub's leases leave of it before the rack next reports.
  assert.deepEqual((await rack()).resources, some({ cores: 4n, memoryBytes: BigInt(8 * GiB), gpus: 0n }));
  assert.deepEqual((await rack()).free, some({ cores: 3n, memoryBytes: BigInt(5 * GiB), gpus: 0n }));

  // A lease of 6 GiB, and two of 3 GiB behind it: the rack has 5 GiB free.
  const large = await piece('2', 6 * GiB); const second = await piece('3', 3 * GiB); const third = await piece('4', 3 * GiB);
  const passed = await agent.claim(); assert.equal(passed?.leaseId, second.leaseId, 'smaller work passes a lease the offer does not hold');
  assert.equal(agent.waitingFor, undefined);
  // 2 GiB free: nothing queued fits, and the idle poll says what the oldest waits for.
  assert.equal(await agent.claim(), null);
  assert.deepEqual(agent.waitingFor, { cores: 1, memoryBytes: 6 * GiB, gpus: 0, ms: 0 });

  // Ten seconds on, the large lease holds the line: 5 GiB free again, and the 3 GiB lease behind it is not granted.
  time += 10_001; await agent.heartbeat([held, passed]);
  await agent.complete(held, failed);
  assert.equal(await agent.claim(), null, 'nothing behind a lease that holds the line is granted to this rack');
  assert.deepEqual(agent.waitingFor, { cores: 1, memoryBytes: 6 * GiB, gpus: 0, ms: 10_001 });
  // The rack has room for it: it is granted, and then the work behind it.
  await agent.complete(passed, failed);
  const granted = await agent.claim(); assert.equal(granted?.leaseId, large.leaseId);
  await agent.complete(granted, failed);
  const last = await agent.claim(); assert.equal(last?.leaseId, third.leaseId);
  await agent.complete(last, failed);

  // A lease this rack could never hold, however long it waits, holds no line at it.
  await piece('5', 16 * GiB);
  time += 10_001; await agent.heartbeat();
  const small = await piece('6', GiB);
  const after = await agent.claim(); assert.equal(after?.leaseId, small.leaseId);
  assert.equal(agent.waitingFor, undefined);

  // Nor does one this rack may not take, which its offer does not hold:
  // work whose environment's layers its session keeps for no platform.
  await session.create({ ...event(['8'.repeat(64)], { kind: 'unit', cores: 1, memoryBytes: 8 * GiB, gpu: false }), environment: 'e'.repeat(64) });
  time += 10_001; await agent.heartbeat([after]);
  const behind = await piece('9', GiB);
  assert.equal((await agent.claim())?.leaseId, behind.leaseId, 'a lease its rack may not take holds no line there');
  assert.equal(agent.waitingFor, undefined, 'and is not what the rack is told to keep room for');
  await assert.rejects(session.create({ ...event(['7'.repeat(64)]), resources: { kind: 'unit', cores: 0, memoryBytes: GiB, gpu: false } }), /a lease's cores is a whole number of one or more/);
});

it('grants leases by what they reserve, not their caps, says what reservations leave free, and holds back a lease whose cap no rack\'s memory holds', async () => {
  const GiB = 1024 ** 3;
  const time = Date.now();
  const f = await fixture({ now: () => time, leaseWindowMs: 40 });
  const session = await f.session();
  const agent = await f.agent({ resources: { cores: 4, memoryBytes: 5 * GiB, gpus: 0 } });
  const rack = async () => (await f.status()).capacity.racks[0]!;
  // Pieces capped at 3 GiB that reserve 2 GiB: two fit 5 GiB by what they reserve, where their caps would fit one.
  const piece = (name: string, memoryBytes = 3 * GiB) => session.create(event([name.repeat(64)], { kind: 'unit', cores: 1, memoryBytes, reserveBytes: 2 * GiB, gpu: false }));
  const first = await piece('1'); const second = await piece('2');
  const a = await agent.claim(); const b = await agent.claim(); assert(a && b, 'both are granted');
  assert.deepEqual([a.leaseId, b.leaseId], [first.leaseId, second.leaseId]);
  assert.deepEqual(agent.bookedFor(first.leaseId), { kind: 'unit', cores: 1, memoryBytes: 3 * GiB, reserveBytes: 2 * GiB, gpu: false });
  assert.deepEqual((await rack()).free, some({ cores: 2n, memoryBytes: BigInt(GiB), gpus: 0n }), 'what this hub\'s leases reserve is taken from all the rack has');
  // 1 GiB free: the next is not granted, and the idle poll says it waits for what it reserves.
  await piece('3');
  assert.equal(await agent.claim(), null);
  assert.deepEqual(agent.waitingFor, { cores: 1, memoryBytes: 2 * GiB, gpus: 0, ms: 0 });
  await agent.complete(a, { taskName: 'task', status: 'failed' }); await agent.complete(b, { taskName: 'task', status: 'failed' });
  assert.notEqual(await agent.claim(), null);
  // A lease that reserves what the rack has, but could grow past all of it, holds no line there.
  await piece('4', 6 * GiB);
  assert.equal(await agent.claim(), null);
  assert.equal(agent.waitingFor, undefined, 'no rack it could ever be granted to waits for it');
});

it('grants a unit only to a rack that caps it: never to one that admits by its slots, nor to one it has not yet heard say what it has', async () => {
  const GiB = 1024 ** 3;
  const f = await fixture({ leaseWindowMs: 40 });
  // The hub starts again on another port, below: its racks follow it there
  let origin = '';
  const listening = async () => { const listener = (await f.status()).rackListener; assert(listener.type === 'up'); origin = listener.value.origin; };
  await listening();
  const follow: typeof fetch = (input, init) => { const url = new URL(String(input)); return f.fetch(`${origin}${url.pathname}${url.search}`, init); };
  const enrol = async (as: Pick<TestRackAgentOptions, 'resources' | 'label'>) => {
    const mint = await socketRequest(f.socket, 'POST', '/v1/enroll', { requestType: HubEnrollType, body: { label: none, ttlMinutes: none }, responseType: HubEnrollResultType });
    const agent = await TestRackAgent.enroll(mint.apiUrl, mint.enrollmentToken, { ...as, fetch: follow });
    cleanup.push(() => agent.close());
    return agent;
  };
  /** What the fleet's snapshot says of each rack, by label. */
  const racks = async () => new Map((await f.status()).capacity.racks.map((rack) => [rack.label, { healthy: rack.healthy, reported: rack.reported, admits: rack.resources.type === 'some' ? 'resources' : 'slots' }]));
  const failed = { taskName: 'task', status: 'failed' as const };
  const lease = (session: Awaited<ReturnType<typeof f.session>>, name: string, kind: 'unit' | 'task') =>
    session.create(event([name.repeat(64)], { kind, cores: 1, memoryBytes: GiB, gpu: false }));

  // A rack that admits by its slots caps nothing. It has said so, and its poll offers no bound: a unit is still not its.
  const session = await f.session();
  const slots = await enrol({ label: 'slots' });
  assert.deepEqual(await racks(), new Map([['slots', { healthy: true, reported: true, admits: 'slots' }]]));
  const unit = await lease(session, '1', 'unit');
  const whole = await lease(session, '2', 'task');
  const taken = await slots.claim();
  assert.equal(taken?.leaseId, whole.leaseId, 'a whole task behind the unit is its: the unit holds no line at it');
  await slots.complete(taken, failed);
  assert.equal(await slots.claim(), null, 'the unit is never granted to it');
  assert.equal(slots.waitingFor, undefined, 'nor is it told to keep room for it');

  // A rack that admits by its resources stops a unit at its cap: the unit is its.
  const capping = await enrol({ label: 'capping', resources: { cores: 4, memoryBytes: 8 * GiB, gpus: 0 } });
  const granted = await capping.claim();
  assert.equal(granted?.leaseId, unit.leaseId);
  await capping.complete(granted, failed);

  // A hub that starts again knows its racks, and that each was healthy, from its registry. It has heard neither say
  // what it has, which a rack says with each heartbeat: so it grants no unit yet, to the rack that caps them either.
  await f.hub.stop();
  const again = new RackHub({ foreground: true, home: f.home, leaseWindowMs: 40 });
  assert(await again.start()); cleanup.push(() => again.stop());
  await listening();
  assert.deepEqual(await racks(), new Map([['slots', { healthy: true, reported: false, admits: 'slots' }], ['capping', { healthy: true, reported: false, admits: 'slots' }]]));
  const after = await f.session();
  const next = await lease(after, '3', 'unit');
  const task = await lease(after, '4', 'task');
  assert.equal((await capping.claim())?.leaseId, task.leaseId, 'a whole task is granted as before');
  assert.equal(await capping.claim(), null, 'and no unit, until the rack has said what it has');
  await capping.heartbeat(); await slots.heartbeat();
  assert.deepEqual(await racks(), new Map([['slots', { healthy: true, reported: true, admits: 'slots' }], ['capping', { healthy: true, reported: true, admits: 'resources' }]]));
  assert.equal(await slots.claim(), null);
  assert.equal((await capping.claim())?.leaseId, next.leaseId);

  // A unit's lease says what it asks, so that a rack can cap it there
  const unsized: RackLeaseEvent = { version: 2, taskName: 'task', workspace: 'dev', closure: { hashes: [] },
    runnerEvent: { mode: 'unit', repo: 'replaced-by-hub', taskHash: 'a'.repeat(64), launchId: uuidv7(), timeoutMs: 30000,
      unit: splitUnitToWire({ inputs: ['5'.repeat(64)], merge: null, own: false }) } };
  await assert.rejects(after.create(unsized), /names what it asks of a rack/);
});
