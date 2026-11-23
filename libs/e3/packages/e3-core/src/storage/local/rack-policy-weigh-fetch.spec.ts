/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Licensed under BSL 1.1. See LICENSE for details.
 */

/**
 * The upgrade that carries a local repository's rack policy into the form
 * that says whether work that would fetch for longer than it runs runs here:
 * it reads what `rack-policy-limits` writes, and writes this release's form.
 * The rack package, whose type the policy is, holds the form it writes to
 * that type (`routing.spec.ts`); this holds the step to what it leaves, from
 * the bytes a release before either step stored.
 */

import { afterEach, beforeEach, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { decodeBeast2For, encodeBeast2For, equalFor, none, printFor, some, variant } from '@elaraai/east';
import { E3_RELEASE, RepositoryRecordType } from '@elaraai/e3-types';
import { repositoryOpen } from '../../repository-record.js';
import { LocalStorage } from './LocalBackend.js';
import { REPOSITORY_RECORD_FILE, encodeRepositoryRecord } from './LocalRefStore.js';
import { repoInit } from './repository.js';
import { RACK_POLICY_LIMITS, RackPolicyWithLimitsType, rackPolicyFile } from './rack-policy-limits.js';
import { RACK_POLICY_KEEP, RackPolicyWithKeepType } from './rack-policy-keep.js';
import { RACK_POLICY_MERGES } from './rack-policy-merges.js';
import { RACK_POLICY_WEIGH_FETCH, RackPolicyWithWeighFetchType, rackPolicyWeighFetch } from './rack-policy-weigh-fetch.js';

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

const limited = { enabled: true, mode: variant('auto', null), defaultSize: variant('xlarge', null),
  defaultTimeoutMinutes: 720n, spill: false, claimTimeoutSeconds: 45n, retryTaskFailuresLocally: true, rules: [
    { tasks: 'train_*', target: variant('rack', null), size: some(variant('large', null)), timeoutMinutes: some(90n), allowHostCoupled: true, memoryLimit: some(8n * 1024n ** 3n), gpu: true },
    { tasks: 'ingest_*', target: variant('local', null), size: none, timeoutMinutes: none, allowHostCoupled: false, memoryLimit: none, gpu: false },
  ] };

describe('rack-policy-weigh-fetch', () => {
  let dir: string;
  let repo: string;
  const storage = new LocalStorage();
  const write = (bytes: Uint8Array) => {
    mkdirSync(dirname(rackPolicyFile(repo)), { recursive: true });
    writeFileSync(rackPolicyFile(repo), bytes);
  };
  const stored = () => decodeBeast2For(RackPolicyWithWeighFetchType)(readFileSync(rackPolicyFile(repo)));
  const apply = () => rackPolicyWeighFetch.apply(storage, repo, null, Date.now() + 60_000);

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'e3-rack-policy-'));
    repo = join(dir, 'repo');
    assert.ok(repoInit(repo).success);
  });
  afterEach(() => { rmSync(dir, { recursive: true, force: true }); });

  it('carries a policy in the form with limits into this form, everything as it was, weighing nothing of what work would fetch', async () => {
    write(encodeBeast2For(RackPolicyWithLimitsType)(limited));
    assert.throws(() => decodeBeast2For(RackPolicyWithWeighFetchType)(readFileSync(rackPolicyFile(repo))), 'this release\'s form does not read it');
    assert.equal(await apply(), null, 'the step is done in one part');
    assert.ok(equalFor(RackPolicyWithWeighFetchType)(stored(), { ...limited, weighFetch: false }), printFor(RackPolicyWithWeighFetchType)(stored()));
    // Applied again, as a crash before its record was written has it: nothing changes.
    const once = readFileSync(rackPolicyFile(repo));
    assert.equal(await apply(), null);
    assert.deepEqual(readFileSync(rackPolicyFile(repo)), once);
  });

  it('leaves a policy already in this form as it is, its weighing turned on among it', async () => {
    const on = { ...limited, weighFetch: true };
    write(encodeBeast2For(RackPolicyWithWeighFetchType)(on));
    assert.equal(await apply(), null);
    assert.ok(equalFor(RackPolicyWithWeighFetchType)(stored(), on));
  });

  it('leaves a repository with no policy without one, and a file in no form it knows as it is', async () => {
    assert.equal(await apply(), null);
    assert.throws(() => readFileSync(rackPolicyFile(repo)), /ENOENT/, 'the defaults need no file');
    const damaged = new Uint8Array([1, 2, 3]);
    write(damaged);
    assert.equal(await apply(), null);
    assert.deepEqual(new Uint8Array(readFileSync(rackPolicyFile(repo))), damaged, 'a read refuses it as it did before, naming its reset');
  });

  it('is applied between rack-policy-limits and rack-policy-merges, then rack-policy-keep, when a repository a release before every rack-policy step wrote is opened, once each, and recorded', async () => {
    write(POLICY_1_0_107);
    const record = decodeBeast2For(RepositoryRecordType)(readFileSync(join(repo, REPOSITORY_RECORD_FILE)));
    assert.ok(record.upgrades.some(({ name }) => name === RACK_POLICY_WEIGH_FETCH), 'a new repository is in the form the step writes');
    const steps = [RACK_POLICY_LIMITS, RACK_POLICY_WEIGH_FETCH, RACK_POLICY_MERGES, RACK_POLICY_KEEP];
    writeFileSync(join(repo, REPOSITORY_RECORD_FILE), encodeRepositoryRecord({ release: '1.0.107',
      upgrades: record.upgrades.filter(({ name }) => !steps.includes(name)) }));

    const opened = await repositoryOpen(storage, repo);
    const names = opened.upgrades.map(({ name }) => name);
    assert.ok(names.indexOf(RACK_POLICY_LIMITS) < names.indexOf(RACK_POLICY_WEIGH_FETCH), 'the limits first');
    assert.ok(names.indexOf(RACK_POLICY_WEIGH_FETCH) < names.indexOf(RACK_POLICY_MERGES), 'the merges after it');
    assert.ok(names.indexOf(RACK_POLICY_MERGES) < names.indexOf(RACK_POLICY_KEEP), 'and the keep last');
    assert.deepEqual(opened.upgrades.find(({ name }) => name === RACK_POLICY_WEIGH_FETCH), { name: RACK_POLICY_WEIGH_FETCH, release: E3_RELEASE });
    // What the step wrote, as the merges and keep steps after it carry it on
    const after = decodeBeast2For(RackPolicyWithKeepType)(readFileSync(rackPolicyFile(repo)));
    const expected = { ...limited, weighFetch: false, defaultMerges: variant('rack', null), keep: variant('split', null),
      rules: limited.rules.map((rule) => ({ ...rule, memoryLimit: none, gpu: false, merges: none })) };
    assert.ok(equalFor(RackPolicyWithKeepType)(after, expected), printFor(RackPolicyWithKeepType)(after));
    assert.deepEqual(await repositoryOpen(storage, repo), opened, 'a second open finds every step applied');
  });
});
