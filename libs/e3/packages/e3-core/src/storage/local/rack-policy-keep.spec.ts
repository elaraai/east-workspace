/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Licensed under BSL 1.1. See LICENSE for details.
 */

/**
 * The upgrade that carries a local repository's rack policy into the form
 * that says how long a rack keeps what work wrote there for later work: it
 * reads what `rack-policy-merges` writes, and writes this release's form. The
 * rack package, whose type the policy is, holds the form it writes to that
 * type (`routing.spec.ts`); this holds the step to what it leaves, from the
 * bytes a release before every rack-policy step stored.
 */

import { afterEach, beforeEach, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { decodeBeast2For, encodeBeast2For, equalFor, none, printFor, some, variant, type ValueTypeOf } from '@elaraai/east';
import { E3_RELEASE, RepositoryRecordType } from '@elaraai/e3-types';
import { repositoryOpen } from '../../repository-record.js';
import { LocalStorage } from './LocalBackend.js';
import { REPOSITORY_RECORD_FILE, encodeRepositoryRecord } from './LocalRefStore.js';
import { repoInit } from './repository.js';
import { RACK_POLICY_KEEP, RackPolicyWithKeepType, rackPolicyKeep } from './rack-policy-keep.js';
import { RACK_POLICY_LIMITS, rackPolicyFile } from './rack-policy-limits.js';
import { RACK_POLICY_MERGES, RackPolicyWithMergesType } from './rack-policy-merges.js';
import { RACK_POLICY_WEIGH_FETCH } from './rack-policy-weigh-fetch.js';
import { LOCAL_REPOSITORY_UPGRADES } from './upgrades.js';

/** The policy release 1.0.107 stored, as `rack-policy-limits.spec.ts` holds
 *  it: enabled, automatic, two rules, and defaults of `xlarge`, 720 minutes,
 *  no spill, 45 s, failures retried. */
const POLICY_1_0_107 = Buffer.from(
  'iUVhc3QNCgUAmQILDAQACAIEYXV0bwEFb3B0SW4BAQgCBWxvY2FsAQRyYWNrAQgFBWxhcmdlAQZtZWRpdW0BCnNlcnZlcmxl' +
  'c3MBBXNtYWxsAQZ4bGFyZ2UBCAIEbm9uZQEEc29tZQUCCAIEbm9uZQEEc29tZQcJBQV0YXNrcwMGdGFyZ2V0BARzaXplBg50' +
  'aW1lb3V0TWludXRlcwgQYWxsb3dIb3N0Q291cGxlZAAKCQkIB2VuYWJsZWQABG1vZGUCBXJ1bGVzCgtkZWZhdWx0U2l6ZQUV' +
  'ZGVmYXVsdFRpbWVvdXRNaW51dGVzBwVzcGlsbAATY2xhaW1UaW1lb3V0U2Vjb25kcwcYcmV0cnlUYXNrRmFpbHVyZXNMb2Nh' +
  'bGx5AAEAACcnAQAAAgd0cmFpbl8qAQEAAbQBAQhpbmdlc3RfKgAAAAAABKALAFoB',
  'base64',
);

/** A policy in the form `rack-policy-merges` writes. */
type PolicyWithMerges = ValueTypeOf<typeof RackPolicyWithMergesType>;

/** A policy in the form `rack-policy-merges` writes: a limit, a GPU, its
 *  weighing turned off and its merges here among it. */
const merged: PolicyWithMerges = { enabled: true, mode: variant('auto', null), defaultSize: variant('xlarge', null),
  defaultTimeoutMinutes: 720n, spill: false, claimTimeoutSeconds: 45n, retryTaskFailuresLocally: true, weighFetch: false,
  defaultMerges: variant('local', null), rules: [
    { tasks: 'train_*', target: variant('rack', null), size: some(variant('large', null)), timeoutMinutes: some(90n), allowHostCoupled: true,
      memoryLimit: some(8n * 1024n ** 3n), gpu: true, merges: some(variant('rack', null)) },
    { tasks: 'ingest_*', target: variant('local', null), size: none, timeoutMinutes: none, allowHostCoupled: false, memoryLimit: none, gpu: false, merges: none },
  ] };

/** What the step makes of it: everything as it was, a rack keeping what work wrote for a split task's later units alone. */
function carried(policy: PolicyWithMerges): ValueTypeOf<typeof RackPolicyWithKeepType> {
  return { ...policy, keep: variant('split', null) };
}

describe('rack-policy-keep', () => {
  let dir: string;
  let repo: string;
  const storage = new LocalStorage();
  const write = (bytes: Uint8Array) => {
    mkdirSync(dirname(rackPolicyFile(repo)), { recursive: true });
    writeFileSync(rackPolicyFile(repo), bytes);
  };
  const stored = () => decodeBeast2For(RackPolicyWithKeepType)(readFileSync(rackPolicyFile(repo)));
  const apply = () => rackPolicyKeep.apply(storage, repo, null, Date.now() + 60_000);

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'e3-rack-policy-'));
    repo = join(dir, 'repo');
    assert.ok(repoInit(repo).success);
  });
  afterEach(() => { rmSync(dir, { recursive: true, force: true }); });

  it('is the local backend\'s fourth step, after the merges', () => {
    assert.deepEqual(LOCAL_REPOSITORY_UPGRADES.map(({ name }) => name), [RACK_POLICY_LIMITS, RACK_POLICY_WEIGH_FETCH, RACK_POLICY_MERGES, RACK_POLICY_KEEP]);
  });

  it('carries a policy in the form that says where merges run into this form, everything as it was, kept for a split task alone', async () => {
    write(encodeBeast2For(RackPolicyWithMergesType)(merged));
    assert.throws(() => decodeBeast2For(RackPolicyWithKeepType)(readFileSync(rackPolicyFile(repo))), 'this release\'s form does not read it');
    assert.equal(await apply(), null, 'the step is done in one part');
    assert.ok(equalFor(RackPolicyWithKeepType)(stored(), carried(merged)), printFor(RackPolicyWithKeepType)(stored()));
    // Applied again, as a crash before its record was written has it: nothing changes.
    const once = readFileSync(rackPolicyFile(repo));
    assert.equal(await apply(), null);
    assert.deepEqual(readFileSync(rackPolicyFile(repo)), once);
  });

  it('leaves a policy already in this form as it is, kept for the session among it', async () => {
    const session = { ...carried(merged), keep: variant('session', null) };
    write(encodeBeast2For(RackPolicyWithKeepType)(session));
    assert.equal(await apply(), null);
    assert.ok(equalFor(RackPolicyWithKeepType)(stored(), session));
  });

  it('leaves a repository with no policy without one, and a file in no form it knows as it is', async () => {
    assert.equal(await apply(), null);
    assert.throws(() => readFileSync(rackPolicyFile(repo)), /ENOENT/, 'the defaults need no file');
    const damaged = new Uint8Array([1, 2, 3]);
    write(damaged);
    assert.equal(await apply(), null);
    assert.deepEqual(new Uint8Array(readFileSync(rackPolicyFile(repo))), damaged, 'a read refuses it as it did before, naming its reset');
  });

  it('is applied after every earlier rack-policy step when a repository a release before all four wrote is opened, once each, and recorded', async () => {
    write(POLICY_1_0_107);
    const record = decodeBeast2For(RepositoryRecordType)(readFileSync(join(repo, REPOSITORY_RECORD_FILE)));
    assert.ok(record.upgrades.some(({ name }) => name === RACK_POLICY_KEEP), 'a new repository is in the form the step writes');
    const steps = [RACK_POLICY_LIMITS, RACK_POLICY_WEIGH_FETCH, RACK_POLICY_MERGES, RACK_POLICY_KEEP];
    writeFileSync(join(repo, REPOSITORY_RECORD_FILE), encodeRepositoryRecord({ release: '1.0.107',
      upgrades: record.upgrades.filter(({ name }) => !steps.includes(name)) }));

    const opened = await repositoryOpen(storage, repo);
    const names = opened.upgrades.map(({ name }) => name);
    assert.deepEqual(names.filter((name) => steps.includes(name)), steps, 'the limits, the weighing, the merges, then the keep');
    assert.deepEqual(opened.upgrades.find(({ name }) => name === RACK_POLICY_KEEP), { name: RACK_POLICY_KEEP, release: E3_RELEASE });
    const expected = carried({ ...merged, weighFetch: true, defaultMerges: variant('rack', null),
      rules: merged.rules.map((rule) => ({ ...rule, memoryLimit: none, gpu: false, merges: none })) });
    assert.ok(equalFor(RackPolicyWithKeepType)(stored(), expected), printFor(RackPolicyWithKeepType)(stored()));
    assert.deepEqual(await repositoryOpen(storage, repo), opened, 'a second open finds all four applied');
  });
});
