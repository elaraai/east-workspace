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
import { envManifestKey, envManifestName } from '../server/env-publication.js';
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
 * A bridge to one session that keeps the manifests the test gives it, and
 * answers a read of the one it is told to fail with a failure: what the
 * session was asked, by the manifest's name.
 */
async function fixture(leases: RackLeaseRecord[]) {
  const home = await mkdtemp(join(tmpdir(), 'e3sb-'));
  cleanup.push(() => rm(home, { recursive: true, force: true }));
  const kept = new Map<string, string>();
  const asked: string[] = [];
  const failing = new Set<string>();
  const app = new Hono();
  app.get('/v1/env/manifests/:name', (c) => {
    const name = c.req.param('name');
    asked.push(name);
    if (failing.has(name)) return c.text('the disk is away', 500);
    const text = kept.get(name);
    return text === undefined ? c.body(null, 404) : c.text(text);
  });
  const socket = hubSocketPath(home);
  const server = await serveOnSocket(app, socket);
  cleanup.push(() => closeSocketServer(server, socket));
  const byId = new Map(leases.map((lease) => [lease.leaseId, lease]));
  const store = { get: (_repo: string, leaseId: string) => Promise.resolve(byId.get(leaseId) ?? null) } as unknown as RackLeaseStore;
  /** A rack that names an image of the `py` tier: its keys, the layers built over that image first, then the whole environment's. */
  const image = `sha256:${'c'.repeat(64)}`;
  const keysOf = (lease: RackLeaseRecord): string[] => [
    envManifestKey(lease.event.environment!, E3_RACK_VERSION, platform, { tier: 'py', manifest: image }),
    envManifestKey(lease.event.environment!, E3_RACK_VERSION, platform),
  ];
  const bridge = new SessionProxyStorageBridge({ leases: store, coordinator: new SessionLeaseCoordinator(),
    session: () => ({ dataSocket: socket, dataToken: 'a session credential' }), owner: await processOwner(),
    advertiseOrigin: () => undefined, envManifestKeys: (_rack, lease) => keysOf(lease) });
  cleanup.push(() => { bridge.close(); return Promise.resolve(); });
  /** What a rack's keys for a lease are named in its session. */
  const names = (lease: RackLeaseRecord): [over: string, whole: string] => keysOf(lease).map((key) => envManifestName(key)!) as [string, string];
  return { bridge, kept, asked, failing, keysOf, names };
}

it('asks a session once for the layers built over a rack\'s image of a pending lease built whole, until another session joins the lease', async () => {
  const lease = leaseOf('L1', 'e'.repeat(64));
  const f = await fixture([lease]);
  const [overKey, wholeKey] = f.keysOf(lease);
  const [over, whole] = f.names(lease);
  f.kept.set(whole, '{"kept":"whole"}');

  // Each claim poll of each rack asks which manifest it would be served
  for (let poll = 0; poll < 3; poll++) assert.equal(await f.bridge.envManifestKeyOf('r-repo', 'L1', 'rack-a'), wholeKey);
  assert.deepEqual(f.asked, [over, whole], 'its miss is asked once, and the whole manifest, once read, is answered from memory');

  // A session that joins the lease has built the layers for the racks it saw, over this image among them
  f.kept.set(over, '{"kept":"over"}');
  assert.equal(await f.bridge.envManifestKeyOf('r-repo', 'L1', 'rack-a'), wholeKey, 'until then, its miss stands');
  f.bridge.forgetEnvMisses('r-repo', 'L1');
  assert.equal(await f.bridge.envManifestKeyOf('r-repo', 'L1', 'rack-a'), overKey);
});

it('asks the next key when a read of one fails, and says the failure only when no key answers', async () => {
  const both = leaseOf('L2', 'd'.repeat(64));
  const none = leaseOf('L3', 'f'.repeat(64));
  const f = await fixture([both, none]);
  const [, wholeKey] = f.keysOf(both);
  f.failing.add(f.names(both)[0]);
  f.kept.set(f.names(both)[1], '{"kept":"whole"}');
  assert.equal(await f.bridge.envManifestKeyOf('r-repo', 'L2', 'rack-a'), wholeKey, 'the whole environment\'s, though the read of the other failed');
  // A failed read is no miss: the key is asked again
  f.asked.length = 0;
  assert.equal(await f.bridge.envManifestKeyOf('r-repo', 'L2', 'rack-a'), wholeKey);
  assert.deepEqual(f.asked, [f.names(both)[0]]);

  f.failing.add(f.names(none)[0]);
  await assert.rejects(f.bridge.envManifestKeyOf('r-repo', 'L3', 'rack-a'), /Environment manifest read failed: HTTP 500/);
});
