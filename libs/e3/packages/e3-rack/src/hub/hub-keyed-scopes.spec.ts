/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Licensed under BSL 1.1. See LICENSE for details.
 */

/**
 * The hub's own scope, through the hub: a rack whose report names
 * `hub-keyed-scopes`, over a TLS listener, is granted every task's and unit's
 * lease of every session with the one hub scope (a call's with none), and
 * every heartbeat's answer gives it the scope's key — its own, of the hub's
 * secret, never in a lease's event, a log line, or a file of the hub's home.
 * A hub that restarts has another scope and another key; nothing a session
 * does ends it. A rack that keeps split scopes alone is granted a unit's split
 * scope as before, one that keeps neither is granted none, and a plain-HTTP
 * listener gives no key and grants no hub scope. What a rack that keeps the
 * hub's scope wrote or was served whole is what a later lease of any session
 * waits for that rack for.
 */

import { afterEach, it } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { readdir, readFile } from 'node:fs/promises';
import { createServer } from 'node:net';
import { join } from 'node:path';
import { repoInit, uuidv7 } from '@elaraai/e3-core';
import { IntegerType, encodeBeast2For } from '@elaraai/east';
import { RACK_HUB_KEY_BYTES, RACK_HUB_KEYED_SCOPES, rackHubKeyHeader, readRackHubKey, type RackHubKey } from '../protocol/rack-json.js';
import { readRackLeaseScope, type RackLeaseEvent, type RackLeaseScope } from '../protocol/task-envelope.js';
import { splitUnitToWire } from '../runner-event.js';
import { RackHub, SCOPE_AFFINITY_MS } from './hub.js';
import { ApproveRackType } from '../protocol/control.js';
import { RackRegistrationType, RackSecurityPolicyType } from '../protocol/registration.js';
import { socketRequest } from '../client/local-http.js';
import { call, cleanup, closeAll, fixture, type HubFixture } from './hub.test-utils.js';
import type { TestRackAgent } from '../testing/test-rack-agent.js';

afterEach(closeAll);

const GiB = 1024 ** 3;
const resources = { cores: 4, memoryBytes: 8 * GiB, gpus: 0 };
const failed = { taskName: 'task', status: 'failed' as const };

/** A whole task's lease event, reading the inputs given, naming the scope given. */
function task(inputs: string[], scope?: RackLeaseScope): RackLeaseEvent {
  return { version: 2, taskName: 'task', workspace: 'dev', closure: { hashes: inputs },
    resources: { kind: 'task', cores: 1, memoryBytes: GiB, gpu: false }, ...(scope !== undefined && { scope }),
    runnerEvent: { mode: 'task', repo: 'replaced-by-hub', taskHash: 'a'.repeat(64), inputHashes: inputs, launchId: uuidv7(), timeoutMs: 30000 } };
}

/** A unit's lease event, named by its one input, in the split scope given. */
function unit(name: string, scope?: RackLeaseScope): RackLeaseEvent {
  return { version: 2, taskName: 'task', workspace: 'dev', closure: { hashes: [] },
    resources: { kind: 'unit', cores: 1, memoryBytes: GiB, gpu: false }, ...(scope !== undefined && { scope }),
    runnerEvent: { mode: 'unit', repo: 'replaced-by-hub', taskHash: 'a'.repeat(64), launchId: uuidv7(), timeoutMs: 30000,
      unit: splitUnitToWire({ inputs: [name.repeat(64)], merge: null, own: false }) } };
}

let written = 0n;
/** Claims the next lease the rack is granted, and completes it with an output
 *  of its own, written to the session's repository as the rack's upload would:
 *  the output's hash, and the scope the grant named. */
async function runs(f: HubFixture, agent: TestRackAgent): Promise<{ outputHash: string; scope: RackLeaseScope | undefined }> {
  const grant = await agent.claim(); assert(grant);
  const outputHash = await f.storage.objects.write(f.repo, encodeBeast2For(IntegerType)(++written));
  assert.equal((await agent.complete(grant, { taskName: 'task', status: 'success', outputHash })).disposition.type, 'recorded');
  return { outputHash, scope: readRackLeaseScope((JSON.parse(grant.eventJson) as RackLeaseEvent).scope) };
}

/** The scope a rack is granted the next lease with, failing it. */
async function grantedScope(agent: TestRackAgent): Promise<RackLeaseScope | undefined> {
  const grant = await agent.claim(); assert(grant);
  await agent.complete(grant, failed);
  return readRackLeaseScope((JSON.parse(grant.eventJson) as RackLeaseEvent).scope);
}

/** The key the rack's last heartbeat answer gave it. */
async function keyOf(agent: TestRackAgent): Promise<RackHubKey | undefined> {
  await agent.heartbeat();
  return agent.hubKeys.at(-1);
}

/** Every way a key's bytes may be written: base64, hex, and its raw bytes as text. */
function spellings(key: Uint8Array): string[] {
  const bytes = Buffer.from(key);
  return [bytes.toString('base64'), bytes.toString('base64url'), bytes.toString('hex'), bytes.toString('latin1')];
}

/** Every file under a directory, by path. */
async function filesUnder(dir: string): Promise<string[]> {
  const entries = await readdir(dir, { withFileTypes: true, recursive: true });
  return entries.filter((entry) => entry.isFile()).map((entry) => join(entry.parentPath, entry.name));
}

/** A port no listener holds now. */
async function freePort(): Promise<number> {
  const server = createServer();
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const address = server.address(); assert(address !== null && typeof address !== 'string');
  await new Promise<void>((resolve) => server.close(() => resolve()));
  return address.port;
}

it('reads and writes a hub key\'s header, and refuses one of any other form', () => {
  const key = { id: uuidv7(), key: new Uint8Array(RACK_HUB_KEY_BYTES).fill(7) };
  assert.deepEqual(readRackHubKey(rackHubKeyHeader(key)), key);
  assert.equal(readRackHubKey(null), undefined);
  assert.equal(readRackHubKey('not json'), undefined);
  assert.equal(readRackHubKey(JSON.stringify({ id: 'a/b', key: Buffer.alloc(32).toString('base64') })), undefined, 'no scope\'s id');
  assert.equal(readRackHubKey(JSON.stringify({ id: uuidv7(), key: Buffer.alloc(16).toString('base64') })), undefined, 'too short');
  assert.equal(readRackHubKey(JSON.stringify({ id: uuidv7(), key: Buffer.alloc(33).toString('base64') })), undefined, 'too long');
  assert.equal(readRackHubKey(JSON.stringify([uuidv7()])), undefined);
  assert.throws(() => rackHubKeyHeader({ id: uuidv7(), key: new Uint8Array(31) }), /32 bytes/);
  assert.deepEqual(readRackLeaseScope({ id: key.id, feeds: true, keyed: true }), { id: key.id, feeds: true, keyed: true });
  assert.deepEqual(readRackLeaseScope({ id: key.id, feeds: true, keyed: 'yes' }), { id: key.id, feeds: true }, 'keyed only when exactly true');
});

it('grants every task\'s and unit\'s lease of every session with the hub\'s scope to a rack that keeps it, a split scope to one that keeps those alone, and none to one that keeps neither', async () => {
  const f = await fixture({ leaseWindowMs: 40 });
  const keyed = await f.agent({ resources, splitScopes: true, hubKeyedScopes: true, label: 'keyed' });
  const split = await f.agent({ resources, splitScopes: true, label: 'split' });
  const neither = await f.agent({ resources, label: 'neither' });
  for (const agent of [keyed, split, neither]) await agent.heartbeat();
  assert.ok((await f.status()).capacity.racks.find((rack) => rack.label === 'keyed')?.features.includes(RACK_HUB_KEYED_SCOPES));
  const key = keyed.hubKeys.at(-1); assert(key !== undefined, 'a rack that keeps the hub\'s scope is given its key');
  assert.equal(key.key.byteLength, RACK_HUB_KEY_BYTES);
  assert.deepEqual([split.hubKeys.at(-1), neither.hubKeys.at(-1)], [undefined, undefined], 'and no other rack is');
  const hubScope = { id: key.id, feeds: true, keyed: true };

  const first = await f.session();
  const second = await f.session();
  const splitScope = { id: uuidv7(), feeds: true };
  // A whole task, and a unit of a split task, of each session
  await first.create(task(['b'.repeat(64)]));
  assert.deepEqual(await grantedScope(keyed), hubScope, 'a whole task of no scope is granted the hub\'s');
  await first.create(unit('1', splitScope));
  assert.deepEqual(await grantedScope(keyed), hubScope, 'a unit is granted the hub\'s in place of its split task\'s, feeding it');
  await second.create(task(['c'.repeat(64)]));
  assert.deepEqual(await grantedScope(keyed), hubScope, 'another session\'s, the same scope');
  const [program] = (await f.objects(1, 64)).keys();
  await second.create(call(program!, 2n));
  assert.equal(await grantedScope(keyed), undefined, 'a call writes nothing a later lease reads');

  // A rack that keeps split scopes alone: as before
  await first.create(unit('2', splitScope));
  assert.deepEqual(await grantedScope(split), splitScope);
  await first.create(task(['d'.repeat(64)]));
  assert.equal(await grantedScope(split), undefined);
  // One that keeps neither: none
  await first.create(unit('3', splitScope));
  assert.equal(await grantedScope(neither), undefined);

  // A split task's end ends its scope for the rack it was granted to, and not the hub's
  await first.close(); await second.close();
  for (const agent of [keyed, split]) await agent.heartbeat();
  assert.deepEqual(split.scopesEnded, [splitScope.id]);
  assert.deepEqual(keyed.scopesEnded, [], 'no session\'s close ends the hub\'s scope');
  assert.deepEqual(await keyOf(keyed), key, 'whose key every answer gives again');
});

it('gives each rack a key of its own, of one scope, and a new scope and key once the hub restarts', async () => {
  const port = await freePort();
  const f = await fixture({ leaseWindowMs: 40 }, port);
  const one = await f.agent({ resources, hubKeyedScopes: true });
  const two = await f.agent({ resources, hubKeyedScopes: true });
  const [a, b] = [await keyOf(one), await keyOf(two)]; assert(a !== undefined && b !== undefined);
  assert.equal(a.id, b.id, 'one scope of the hub');
  assert.notDeepEqual(a.key, b.key, 'a key of each rack\'s own');
  assert.deepEqual(await keyOf(one), a, 'and the same key with every answer');

  await f.hub.stop();
  const again = new RackHub({ foreground: true, home: f.home, leaseWindowMs: 40 });
  assert(await again.start());
  cleanup.push(() => again.stop());
  const after = await keyOf(one); assert(after !== undefined);
  assert.notEqual(after.id, a.id, 'a new scope');
  assert.notDeepEqual(after.key, a.key, 'under a new key');
});

it('gives no key and grants no hub scope over a plain-HTTP listener, where a rack that keeps split scopes too is granted those', async () => {
  const f = await fixture({ leaseWindowMs: 40 }, 0, { tls: false, allow: ['127.0.0.1'] });
  const keyed = await f.agent({ resources, splitScopes: true, hubKeyedScopes: true });
  assert.equal(await keyOf(keyed), undefined, 'the key travels only inside TLS');
  const session = await f.session();
  await session.create(task(['b'.repeat(64)]));
  assert.equal(await grantedScope(keyed), undefined);
  const splitScope = { id: uuidv7(), feeds: true };
  await session.create(unit('1', splitScope));
  assert.deepEqual(await grantedScope(keyed), splitScope);
});

it('never logs, stores or grants the key: no line of the hub\'s log, no file of its home and no lease\'s event holds it', async () => {
  const lines: string[] = [];
  const f = await fixture({ leaseWindowMs: 40, log: (line) => { lines.push(line); } });
  const keyed = await f.agent({ resources, hubKeyedScopes: true });
  const key = await keyOf(keyed); assert(key !== undefined);
  const session = await f.session();
  const events: string[] = [];
  for (const inputs of [['b'.repeat(64)], ['c'.repeat(64)]]) {
    await session.create(task(inputs));
    const grant = await keyed.claim(); assert(grant);
    events.push(grant.eventJson);
    await keyed.complete(grant, failed);
  }
  await keyed.heartbeat();
  await session.close();
  await f.hub.stop();
  assert.ok(lines.length > 0, 'the hub said something');
  const said = [...lines, ...events].join('\n');
  for (const spelling of spellings(key.key)) assert.equal(said.includes(spelling), false, 'no log line or lease event holds the key');
  for (const file of await filesUnder(f.home)) {
    const bytes = await readFile(file);
    assert.equal(bytes.includes(Buffer.from(key.key)), false, `${file} holds no key`);
    for (const spelling of spellings(key.key)) assert.equal(bytes.includes(Buffer.from(spelling)), false, `${file} holds no key`);
  }
});

it('sends a later session\'s lease first to the rack that keeps what it reads in the hub\'s scope, written or served there, and forgets it once that rack reboots', async () => {
  let time = Date.now();
  const f = await fixture({ now: () => time, leaseWindowMs: 40 });
  const keyed = await f.agent({ resources, hubKeyedScopes: true, label: 'keyed' });
  const other = await f.agent({ resources, hubKeyedScopes: true, label: 'other' });
  for (const agent of [keyed, other]) await agent.heartbeat();
  const [input] = (await f.objects(1, 64)).keys(); assert(input !== undefined);

  // A first session's task, on one rack: it is served its input, and writes its output there
  const first = await f.session();
  await first.create(task([input]));
  const grant = await keyed.claim(); assert(grant);
  await keyed.fetch(grant, [input]);
  const outputHash = await f.storage.objects.write(f.repo, encodeBeast2For(IntegerType)(++written));
  await keyed.complete(grant, { taskName: 'task', status: 'success', outputHash });
  await first.close();

  // A second session's tasks: each waits for that rack, which holds what it reads
  const second = await f.session();
  for (const reads of [[outputHash], [input]]) {
    const lease = await second.create(task(reads));
    assert.equal(await other.claim(), null, 'a rack that holds none of it waits');
    const there = await keyed.claim();
    assert.equal(there?.leaseId, lease.leaseId);
    await keyed.complete(there, failed);
  }
  // Once it has waited, another rack takes it
  const waited = await second.create(task([outputHash]));
  assert.equal(await other.claim(), null);
  time += SCOPE_AFFINITY_MS + 1;
  for (const agent of [keyed, other]) await agent.heartbeat();
  const taken = await other.claim();
  assert.equal(taken?.leaseId, waited.leaseId);
  await other.complete(taken, failed);

  // The rack reboots: it holds nothing, and no lease waits for it
  keyed.reboot();
  await keyed.heartbeat();
  const after = await second.create(task([outputHash]));
  assert.equal((await other.claim())?.leaseId, after.leaseId);
});

it('notes what a unit wrote on a rack that keeps the hub\'s scope as the hub\'s, whatever split scope its lease named, so a merge of it goes there', async () => {
  const f = await fixture({ leaseWindowMs: 40 });
  const keyed = await f.agent({ resources, hubKeyedScopes: true, label: 'keyed' });
  const other = await f.agent({ resources, hubKeyedScopes: true, label: 'other' });
  for (const agent of [keyed, other]) await agent.heartbeat();
  const session = await f.session();
  const splitScope = { id: uuidv7(), feeds: true };
  await session.create(unit('1', splitScope));
  const { outputHash, scope } = await runs(f, keyed);
  assert.equal(scope?.keyed, true);
  const merged = await session.create({ ...unit('1', splitScope), closure: { hashes: [outputHash] }, runnerEvent: { ...unit('1').runnerEvent,
    unit: splitUnitToWire({ inputs: ['merge', outputHash], merge: { parts: [outputHash], range: null }, own: false }) } } as RackLeaseEvent);
  assert.equal(await other.claim(), null, 'the merge waits for the rack that holds its part');
  assert.equal((await keyed.claim())?.leaseId, merged.leaseId);
});

/** Two racks that keep the hub's scope, on a hub whose clock the test sets, each having heard the hub once. */
async function twoKeyed(options: { idleMs?: number } = {}) {
  const clock = { time: Date.now() };
  const f = await fixture({ now: () => clock.time, leaseWindowMs: 40 });
  const keyed = await f.agent({ resources, hubKeyedScopes: true, label: 'keyed', ...(options.idleMs !== undefined && { hubScopeIdleMs: options.idleMs }) });
  const other = await f.agent({ resources, hubKeyedScopes: true, label: 'other' });
  for (const agent of [keyed, other]) await agent.heartbeat();
  return { f, keyed, other, clock };
}

/** Whether a lease reading the hashes given waits for a rack other than `other`: `other` is granted nothing at once. */
async function waitsOff(f: HubFixture, session: Awaited<ReturnType<HubFixture['session']>>, other: TestRackAgent, reads: string[]): Promise<boolean> {
  const lease = await session.create(task(reads));
  const grant = await other.claim();
  if (grant === null) return true;
  assert.equal(grant.leaseId, lease.leaseId);
  await other.complete(grant, failed);
  return false;
}

it('gives no key to a boot that awaits approval, and a boot it admits a key of its own, not the one its rack had before', async () => {
  const f = await fixture({ leaseWindowMs: 40 });
  const keyed = await f.agent({ resources, hubKeyedScopes: true });
  const first = await keyOf(keyed); assert(first !== undefined);
  await socketRequest(f.socket, 'POST', '/v1/security', { requestType: RackSecurityPolicyType, body: { requireStartApproval: true }, responseType: RackSecurityPolicyType });
  // The rack boots again, as a disk image of it restored would: no key until an operator admits that boot
  keyed.reboot();
  assert.equal(await keyOf(keyed), undefined, 'a boot that awaits approval is given no key');
  await socketRequest(f.socket, 'POST', `/v1/racks/${keyed.rackId}/approve`, { requestType: ApproveRackType, body: { bootId: keyed.bootId }, responseType: RackRegistrationType });
  const admitted = await keyOf(keyed); assert(admitted !== undefined);
  assert.equal(admitted.id, first.id, 'the hub\'s one scope');
  assert.notDeepEqual(admitted.key, first.key, 'under a key of the new boot\'s, which reads nothing the old boot kept');
});

it('grants a lease that feeds nothing the hub\'s scope feeding nothing, and notes nothing it wrote', async () => {
  const { f, keyed, other } = await twoKeyed();
  const session = await f.session();
  // A last merge, or an array's piece: its split scope feeds nothing
  await session.create(unit('1', { id: uuidv7(), feeds: false }));
  const { outputHash, scope } = await runs(f, keyed);
  assert.deepEqual(scope, { id: (keyed.hubKeys.at(-1))!.id, feeds: false, keyed: true }, 'the hub\'s scope, feeding nothing');
  assert.equal(await waitsOff(f, session, other, [outputHash]), false, 'no lease waits for what the rack did not keep');
});

it('keeps every rack that was served an object as holding it, so a later lease waits for the first fetcher too', async () => {
  const { f, keyed, other, clock } = await twoKeyed();
  const third = await f.agent({ resources, hubKeyedScopes: true, label: 'third' });
  await third.heartbeat();
  const [input] = (await f.objects(1, 64)).keys(); assert(input !== undefined);
  const session = await f.session();
  // The first rack is served the input, then the second is, once the first has had its wait
  for (const agent of [keyed, other]) {
    await session.create(task([input]));
    clock.time += SCOPE_AFFINITY_MS + 1;
    for (const one of [keyed, other, third]) await one.heartbeat();
    const grant = await agent.claim(); assert(grant);
    await agent.fetch(grant, [input]);
    await agent.complete(grant, failed);
  }
  // A lease that reads it: the first fetcher may take it at once, and a rack that holds none of it waits
  const lease = await session.create(task([input]));
  assert.equal(await third.claim(), null, 'a rack that holds none of it waits');
  assert.equal((await keyed.claim())?.leaseId, lease.leaseId, 'the first rack still holds it');
});

it('forgets what a rack held of the hub\'s scope once it reports another store, or has gone unused past its idle bound', async () => {
  const { f, keyed, other, clock } = await twoKeyed({ idleMs: 60_000 });
  const session = await f.session();
  const made = async () => { await session.create(task([randomUUID().replaceAll('-', '').padEnd(64, '0')])); return (await runs(f, keyed)).outputHash; };

  // Held: a lease that reads it waits for the rack
  const kept = await made();
  assert.equal(await waitsOff(f, session, other, [kept]), true);
  const there = await keyed.claim(); assert(there);
  await keyed.complete(there, failed);

  // Its agent restarted, and deleted what it kept: its next report names another store
  const restarted = await made();
  keyed.hubStore = randomUUID();
  await keyed.heartbeat();
  assert.equal(await waitsOff(f, session, other, [restarted]), false, 'a rack whose store changed holds none of it');

  // Unused past the bound it reports: it keeps nothing of the scope
  const idle = await made();
  clock.time += 60_001;
  for (const agent of [keyed, other]) await agent.heartbeat();
  assert.equal(await waitsOff(f, session, other, [idle]), false, 'a rack idle past its bound holds none of it');
});

it('keeps the hub\'s scope apart for each repository: a lease of one never waits for what a rack holds of another', async () => {
  const { f, keyed, other } = await twoKeyed();
  const first = await f.session();
  await first.create(task(['b'.repeat(64)]));
  const { outputHash } = await runs(f, keyed);
  assert.equal(await waitsOff(f, first, other, [outputHash]), true, 'its own repository\'s lease waits for it');
  const otherRepo = join(f.home, 'other'); assert(repoInit(otherRepo).success);
  const second = await f.session(otherRepo);
  assert.equal(await waitsOff(f, second, other, [outputHash]), false, 'another repository\'s waits for none');
});
