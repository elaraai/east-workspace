/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Licensed under BSL 1.1. See LICENSE for details.
 */

import { afterEach, it } from 'node:test';
import assert from 'node:assert/strict';
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
