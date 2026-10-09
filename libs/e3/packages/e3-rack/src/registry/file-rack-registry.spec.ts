/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Licensed under BSL 1.1. See LICENSE for details.
 */

import { it } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { equalFor, none, some } from '@elaraai/east';
import { RackRegistrationType, type RackRegistration } from '../protocol/registration.js';
import { FileRackRegistry } from './file-rack-registry.js';

it('persists enrollment and revocation immediately and coalesces only heartbeat fields', async (t) => {
  const home = await mkdtemp(join(tmpdir(), 'e3r-'));
  let now = Date.now();
  const registry = new FileRackRegistry(home, () => now);
  t.after(async () => { await registry.flush(); await rm(home, { recursive: true, force: true }); });
  const rack: RackRegistration = {
    rackId: 'rack', label: 'local', enrolledAt: new Date(now), tiers: ['node'], capacity: 2n,
    lastSeenAt: new Date(now), agentVersion: '0.5.0', healthy: true, lastBootId: none, approvedBootId: none,
  };
  await registry.putRack(rack);
  assert.ok(equalFor(RackRegistrationType)((await new FileRackRegistry(home).getRack('rack'))!, rack));
  const file = join(home, 'racks.beast2');
  const before = await readFile(file);
  for (let i = 0; i < 8; i++) {
    now += 1000;
    await registry.putRack({ ...rack, lastSeenAt: new Date(now), agentVersion: '0.5.1', healthy: false });
  }
  assert.deepEqual(await readFile(file), before);
  assert.equal((await registry.getRack('rack'))?.healthy, false);
  now += 30_000;
  await registry.putRack({ ...rack, lastSeenAt: new Date(now) });
  assert.notDeepEqual(await readFile(file), before);
  await registry.putRack({ ...rack, approvedBootId: some('boot'), lastBootId: some('boot') });
  assert.deepEqual((await new FileRackRegistry(home).getRack('rack'))?.approvedBootId, some('boot'));
  await registry.putRackSecurityPolicy({ requireStartApproval: true });
  assert.deepEqual(await new FileRackRegistry(home).getRackSecurityPolicy(), { requireStartApproval: true });
  assert.equal(await registry.deleteRack('rack'), true);
  assert.equal(await new FileRackRegistry(home).getRack('rack'), null);
});
