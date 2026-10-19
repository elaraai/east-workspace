/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Licensed under BSL 1.1. See LICENSE for details.
 */

import { it } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm, stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { decodeBeast2For } from '@elaraai/east';
import { FileMachineIdentityStore } from './file-identity-store.js';
import { IdentityFileType } from './in-memory-identity-store.js';
import { generateEnrollmentToken } from './machine-identity.js';
import { readStateFile } from '../state-file.js';

it('consumes an enrollment once across racing callers and reload, with private atomic state', async (t) => {
  const home = await mkdtemp(join(tmpdir(), 'e3r-'));
  t.after(() => rm(home, { recursive: true, force: true }));
  const store = new FileMachineIdentityStore(home);
  const { tokenHash } = generateEnrollmentToken();
  await store.putEnrollmentToken(tokenHash, new Date(Date.now() + 60_000));
  const results = await Promise.all(Array.from({ length: 12 }, () => store.consumeEnrollmentToken(tokenHash, new Date())));
  assert.equal(results.filter(Boolean).length, 1);
  assert.equal(await new FileMachineIdentityStore(home).consumeEnrollmentToken(tokenHash, new Date()), false);
  const file = join(home, 'identity.beast2');
  await writeFile(`${file}.crash.partial`, 'incomplete');
  await store.putRackToken('one', 'rack', new Date(), 'current');
  assert.equal((await new FileMachineIdentityStore(home).getRackToken('one'))?.rackId, 'rack');
  if (process.platform !== 'win32') {
    assert.equal((await stat(home)).mode & 0o777, 0o700);
    assert.equal((await stat(file)).mode & 0o777, 0o600);
  }
});

it('rejects and prunes expired enrollment tokens and retains rotation grace across reload', async (t) => {
  const home = await mkdtemp(join(tmpdir(), 'e3r-'));
  t.after(() => rm(home, { recursive: true, force: true }));
  const store = new FileMachineIdentityStore(home);
  await store.putEnrollmentToken('expired', new Date(0));
  assert.equal(await store.consumeEnrollmentToken('expired', new Date()), false);
  const bytes = await readStateFile(join(home, 'identity.beast2'));
  assert.ok(bytes);
  assert.equal(decodeBeast2For(IdentityFileType)(bytes).enrollmentTokens.size, 0);
  await store.putRackToken('old', 'rack', new Date(), 'current');
  await store.putRackToken('next', 'rack', new Date(), 'pending');
  const cutoff = new Date(Date.now() + 60_000);
  await store.promoteRackToken('rack', 'next', cutoff);
  const reload = new FileMachineIdentityStore(home);
  assert.equal((await reload.getRackToken('next'))?.status, 'current');
  assert.deepEqual((await reload.getRackToken('old'))?.graceUntil, cutoff);
  await reload.putRackToken('third', 'rack', new Date(), 'pending');
  await reload.promoteRackToken('rack', 'third', new Date(cutoff.getTime() + 60_000));
  assert.deepEqual((await reload.getRackToken('old'))?.graceUntil, cutoff, 'existing grace is never extended');
});

it('fails closed on a corrupt identity file', async (t) => {
  const home = await mkdtemp(join(tmpdir(), 'e3r-'));
  t.after(() => rm(home, { recursive: true, force: true }));
  await writeFile(join(home, 'identity.beast2'), 'broken');
  await assert.rejects(new FileMachineIdentityStore(home).getRackToken('anything'));
});
