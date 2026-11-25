/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Licensed under BSL 1.1. See LICENSE for details.
 */

import { afterEach, it } from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { EventEmitter } from 'node:events';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Hono } from 'hono';
import { processOwner, uuidv7 } from '@elaraai/e3-core';
import { closeSocketServer, serveOnSocket } from '../client/local-http.js';
import type { RackLeaseRecord, RackLeaseStore } from '../lease/lease-store.js';
import { hubSocketPath } from '../paths.js';
import { envManifestKey } from '../server/env-publication.js';
import { E3_RACK_VERSION } from '../version.js';
import { RACK_INLINE_OBJECT_MAX } from '../protocol/rack-json.js';
import { SessionLeaseCoordinator, SessionProxyStorageBridge } from './session-bridge.js';

const cleanup: Array<() => Promise<void>> = [];
afterEach(async () => { for (const close of cleanup.splice(0).reverse()) await close(); });

const platform = 'x86_64-manylinux_2_28';

/** A pending lease of the `py` tier whose work declares an environment. */
function leaseOf(leaseId: string, environment: string): RackLeaseRecord {
  return { leaseId, repo: 'r-repo', workspace: 'dev', taskHash: 'a'.repeat(64), inputsHash: 'b'.repeat(64), tier: 'py', status: 'pending', createdAtMs: 0,
    event: { version: 2, taskName: 'task', workspace: 'dev', closure: { hashes: [] }, environment,
      runnerEvent: { mode: 'task', repo: 'r-repo', taskHash: 'a'.repeat(64), inputHashes: [], launchId: uuidv7(), timeoutMs: 30000 } } };
}

/**
 * A bridge to one session, which records each thing it is asked, and whose
 * racks may be served the keys the test gives each: as the hub gives them, of
 * the builds the lease's sessions keep.
 */
async function fixture(leases: RackLeaseRecord[]) {
  const home = await mkdtemp(join(tmpdir(), 'e3sb-'));
  cleanup.push(() => rm(home, { recursive: true, force: true }));
  const asked: string[] = [];
  const app = new Hono();
  app.all('*', (c) => { asked.push(c.req.path); return c.body(null, 404); });
  const socket = hubSocketPath(home);
  const server = await serveOnSocket(app, socket);
  cleanup.push(() => closeSocketServer(server, socket));
  const byId = new Map(leases.map((lease) => [lease.leaseId, lease]));
  const store = { get: (_repo: string, leaseId: string) => Promise.resolve(byId.get(leaseId) ?? null) } as unknown as RackLeaseStore;
  /** What each rack may be served, by rack. */
  const served = new Map<string, string[]>();
  const bridge = new SessionProxyStorageBridge({ leases: store, coordinator: new SessionLeaseCoordinator(),
    session: () => ({ dataSocket: socket, dataToken: 'a session credential' }), owner: await processOwner(),
    advertiseOrigin: () => undefined, envManifestKeys: (rackId) => served.get(rackId) ?? [] });
  cleanup.push(() => { bridge.close(); return Promise.resolve(); });
  return { bridge, asked, served };
}

it('serves a rack the first build of a lease\'s environment its sessions keep, asking no session anything to choose it, and keeps serving the one it holds the lease by', async () => {
  const lease = leaseOf('L1', 'e'.repeat(64));
  const f = await fixture([lease]);
  const environment = lease.event.environment!;
  const over = envManifestKey(environment, E3_RACK_VERSION, platform, { tier: 'py', manifest: `sha256:${'c'.repeat(64)}` });
  const whole = envManifestKey(environment, E3_RACK_VERSION, platform);

  // Its sessions keep none the rack may be served: it is served none
  assert.equal(await f.bridge.envManifestKeyOf('r-repo', 'L1', 'rack-a'), null);
  // They keep the whole environment's: each claim poll is answered it, and no session is asked
  f.served.set('rack-a', [whole]);
  for (let poll = 0; poll < 3; poll++) assert.equal(await f.bridge.envManifestKeyOf('r-repo', 'L1', 'rack-a'), whole);
  assert.deepEqual(f.asked, []);

  // The rack claims the lease; a session that joins it then keeps the layers built over the rack's image too
  Object.assign(lease, { status: 'claimed', claimedBy: 'rack-a' });
  assert.equal(await f.bridge.envManifestKeyOf('r-repo', 'L1', 'rack-a'), whole);
  f.served.set('rack-a', [over, whole]);
  assert.equal(await f.bridge.envManifestKeyOf('r-repo', 'L1', 'rack-a'), whole, 'the rack that holds the lease is served the build it was');
  f.served.set('rack-b', [over, whole]);
  assert.equal(await f.bridge.envManifestKeyOf('r-repo', 'L1', 'rack-b'), over, 'another is served the first');

  // The lease ends its claim: its next is served anew
  assert.equal(await f.bridge.discardWrites('r-repo', 'L1', []), 0);
  assert.equal(await f.bridge.envManifestKeyOf('r-repo', 'L1', 'rack-a'), over);
  assert.deepEqual(f.asked, [], 'no session was asked anything');
});

it('serves an object inline when it fits the reply\'s room, taking its bytes from it, and by a data URL otherwise; a read given no room is served as before', async () => {
  const home = await mkdtemp(join(tmpdir(), 'e3sb-'));
  cleanup.push(() => rm(home, { recursive: true, force: true }));
  // A session that keeps three objects: 3 KiB, 10 KiB and 100 KiB
  const objects = new Map([3, 10, 100].map((kib) => {
    const bytes = new Uint8Array(kib * 1024).fill(kib);
    return [createHash('sha256').update(bytes).digest('hex'), bytes] as const;
  }));
  const [small, segment, large] = [...objects.keys()] as [string, string, string];
  const reads: string[] = [];
  const app = new Hono();
  app.on(['HEAD', 'GET'], '/v1/objects/:hash', (c) => {
    const bytes = objects.get(c.req.param('hash'));
    if (bytes === undefined) return c.body(null, 404);
    reads.push(`${c.req.method} ${c.req.param('hash')}`);
    return new Response(c.req.method === 'HEAD' ? null : bytes, { headers: { 'content-length': String(bytes.length) } });
  });
  const socket = hubSocketPath(home);
  const server = await serveOnSocket(app, socket);
  cleanup.push(() => closeSocketServer(server, socket));
  const lease: RackLeaseRecord = { ...leaseOf('L1', 'e'.repeat(64)), status: 'claimed', claimedBy: 'rack-a', attempt: { executionId: uuidv7(), startedAtMs: 0 } };
  const coordinator = new SessionLeaseCoordinator();
  const bridge = new SessionProxyStorageBridge({ leases: { get: () => Promise.resolve(lease) } as unknown as RackLeaseStore, coordinator,
    session: () => ({ dataSocket: socket, dataToken: 'a session credential' }), owner: await processOwner(), advertiseOrigin: () => 'https://hub.invalid' });
  cleanup.push(() => { bridge.close(); return Promise.resolve(); });
  const read = (hash: string, room?: { objectBytes: number; left: number }) => coordinator.run('r-repo', 'L1', () => bridge.readDescriptor('r-repo', hash, room));
  const inline = (descriptor: Awaited<ReturnType<typeof read>>): Uint8Array | undefined => descriptor.kind === 'inline' ? new Uint8Array(descriptor.data) : undefined;

  // Given no room, as every read was before a request could name one: at most 4 KiB inline
  assert.deepEqual(inline(await read(small)), objects.get(small));
  assert.equal((await read(segment)).kind, 'url');

  // Given room for objects of 64 KiB, and 12 KiB of the reply's left
  const room = { objectBytes: RACK_INLINE_OBJECT_MAX, left: 12 * 1024 };
  reads.length = 0;
  assert.deepEqual(inline(await read(segment, room)), objects.get(segment), 'a segment of 10 KiB rides the reply');
  assert.equal(room.left, 2 * 1024, 'its bytes taken from the reply\'s room');
  assert.deepEqual(reads, [`HEAD ${segment}`, `GET ${segment}`]);
  const past = await read(small, room);
  assert(past.kind === 'url' && past.url.startsWith('https://hub.invalid/api/rack/data/'), 'one the reply has no room left for is a data URL');
  assert.equal(room.left, 2 * 1024);
  assert.equal((await read(large, { objectBytes: RACK_INLINE_OBJECT_MAX, left: Number.MAX_SAFE_INTEGER })).kind, 'url', 'one past the largest the request takes is a data URL');
  assert.deepEqual(reads.filter((line) => line.startsWith('GET')), [`GET ${segment}`], 'and the session is asked for no bytes of those');
});

it('tells of an object a rack was served through its data URL only once the answer to the rack has finished', async () => {
  const home = await mkdtemp(join(tmpdir(), 'e3sb-'));
  cleanup.push(() => rm(home, { recursive: true, force: true }));
  // A session that keeps two objects of 2 MiB, whose stream ends as soon as it is read
  const objects = new Map([1, 2].map((fill) => {
    const bytes = new Uint8Array(2 * 1024 * 1024).fill(fill);
    return [createHash('sha256').update(bytes).digest('hex'), bytes] as const;
  }));
  const [sent, cut] = [...objects.keys()] as [string, string];
  const app = new Hono();
  app.on(['HEAD', 'GET'], '/v1/objects/:hash', (c) => {
    const bytes = objects.get(c.req.param('hash'));
    if (bytes === undefined) return c.body(null, 404);
    return new Response(c.req.method === 'HEAD' ? null : bytes, { headers: { 'content-length': String(bytes.length) } });
  });
  const socket = hubSocketPath(home);
  const server = await serveOnSocket(app, socket);
  cleanup.push(() => closeSocketServer(server, socket));
  const lease: RackLeaseRecord = { ...leaseOf('L1', 'e'.repeat(64)), status: 'claimed', claimedBy: 'rack-a', attempt: { executionId: uuidv7(), startedAtMs: 0 } };
  const coordinator = new SessionLeaseCoordinator();
  const served: string[] = [];
  const bridge = new SessionProxyStorageBridge({ leases: { get: () => Promise.resolve(lease) } as unknown as RackLeaseStore, coordinator,
    session: () => ({ dataSocket: socket, dataToken: 'a session credential' }), owner: await processOwner(), advertiseOrigin: () => 'https://hub.invalid',
    served: (whole) => { served.push(`${whole.rackId} ${whole.repo} ${whole.leaseId} ${whole.hash}`); } });
  cleanup.push(() => { bridge.close(); return Promise.resolve(); });
  const routes = bridge.dataRoutes();
  /** The object's data URL, read whole by the rack's side of a connection
   *  whose end the test says: the connection's answer, which the route watches. */
  const fetchWhole = async (hash: string) => {
    const descriptor = await coordinator.run('r-repo', 'L1', () => bridge.readDescriptor('r-repo', hash, { objectBytes: 0, left: 0 }));
    assert(descriptor.kind === 'url');
    const outgoing = Object.assign(new EventEmitter(), { writableFinished: false });
    const response = await routes.fetch(new Request(descriptor.url), { outgoing });
    assert.equal(response.status, 200);
    assert.equal((await response.arrayBuffer()).byteLength, 2 * 1024 * 1024, 'the session\'s stream has ended');
    return outgoing;
  };

  // Read whole at once, as a small object is into the buffers between hub and rack: held only once its answer finishes
  const finished = await fetchWhole(sent);
  assert.deepEqual(served, [], 'not held while its answer has not finished');
  finished.writableFinished = true;
  finished.emit('finish'); finished.emit('close');
  assert.deepEqual(served, [`rack-a r-repo L1 ${sent}`], 'told once');

  // One whose connection closed before its answer finished is a transfer cut short: the rack does not hold it
  const dropped = await fetchWhole(cut);
  dropped.emit('close');
  assert.deepEqual(served, [`rack-a r-repo L1 ${sent}`]);
});
