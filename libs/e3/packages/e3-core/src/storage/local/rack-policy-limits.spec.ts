/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Licensed under BSL 1.1. See LICENSE for details.
 */

/**
 * The upgrade that carries a local repository's rack policy into the form in
 * which a rule may hold a memory limit and ask for a GPU: it reads what the
 * releases before it stored, and writes this release's form. The rack package,
 * whose type the policy is, holds the form it writes to that type
 * (`routing.spec.ts`); this holds the earlier form to the bytes a release
 * stored, and the step to what it leaves.
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
import { RACK_POLICY_LIMITS, RackPolicyBeforeLimitsType, RackPolicyWithLimitsType, rackPolicyFile, rackPolicyLimits } from './rack-policy-limits.js';

/** The policy release 1.0.107 stored: enabled, automatic, two rules — `train_*`
 *  on a rack at `large` for 90 minutes with host access, `ingest_*` local —
 *  and defaults of `xlarge`, 720 minutes, no spill, 45 s, failures retried. */
const POLICY_1_0_107 = Buffer.from(
  'iUVhc3QNCgUAmQILDAQACAIEYXV0bwEFb3B0SW4BAQgCBWxvY2FsAQRyYWNrAQgFBWxhcmdlAQZtZWRpdW0BCnNlcnZlcmxl' +
  'c3MBBXNtYWxsAQZ4bGFyZ2UBCAIEbm9uZQEEc29tZQUCCAIEbm9uZQEEc29tZQcJBQV0YXNrcwMGdGFyZ2V0BARzaXplBg50' +
  'aW1lb3V0TWludXRlcwgQYWxsb3dIb3N0Q291cGxlZAAKCQkIB2VuYWJsZWQABG1vZGUCBXJ1bGVzCgtkZWZhdWx0U2l6ZQUV' +
  'ZGVmYXVsdFRpbWVvdXRNaW51dGVzBwVzcGlsbAATY2xhaW1UaW1lb3V0U2Vjb25kcwcYcmV0cnlUYXNrRmFpbHVyZXNMb2Nh' +
  'bGx5AAEAACcnAQAAAgd0cmFpbl8qAQEAAbQBAQhpbmdlc3RfKgAAAAAABKALAFoB',
  'base64',
);

const earlierRules = [
  { tasks: 'train_*', target: variant('rack', null), size: some(variant('large', null)), timeoutMinutes: some(90n), allowHostCoupled: true },
  { tasks: 'ingest_*', target: variant('local', null), size: none, timeoutMinutes: none, allowHostCoupled: false },
];
const earlier = { enabled: true, mode: variant('auto', null), rules: earlierRules, defaultSize: variant('xlarge', null),
  defaultTimeoutMinutes: 720n, spill: false, claimTimeoutSeconds: 45n, retryTaskFailuresLocally: true };
const carried = { ...earlier, rules: earlierRules.map((rule) => ({ ...rule, memoryLimit: none, gpu: false })) };

describe('rack-policy-limits', () => {
  let dir: string;
  let repo: string;
  const storage = new LocalStorage();
  const write = (bytes: Uint8Array) => {
    mkdirSync(dirname(rackPolicyFile(repo)), { recursive: true });
    writeFileSync(rackPolicyFile(repo), bytes);
  };
  const stored = () => decodeBeast2For(RackPolicyWithLimitsType)(readFileSync(rackPolicyFile(repo)));
  const apply = () => rackPolicyLimits.apply(storage, repo, null, Date.now() + 60_000);

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'e3-rack-policy-'));
    repo = join(dir, 'repo');
    assert.ok(repoInit(repo).success);
  });
  afterEach(() => { rmSync(dir, { recursive: true, force: true }); });

  it('reads a policy an earlier release stored, as that release stored it', () => {
    const policy = decodeBeast2For(RackPolicyBeforeLimitsType)(POLICY_1_0_107);
    assert.ok(equalFor(RackPolicyBeforeLimitsType)(policy, earlier), printFor(RackPolicyBeforeLimitsType)(policy));
    assert.throws(() => decodeBeast2For(RackPolicyWithLimitsType)(POLICY_1_0_107), 'this release\'s form does not read it');
  });

  it('carries a policy an earlier release stored into the form with limits, each rule as it was with no limit and no GPU', async () => {
    write(POLICY_1_0_107);
    assert.equal(await apply(), null, 'the step is done in one part');
    assert.ok(equalFor(RackPolicyWithLimitsType)(stored(), carried), printFor(RackPolicyWithLimitsType)(stored()));
    // Applied again, as a crash before its record was written has it: nothing changes.
    const once = readFileSync(rackPolicyFile(repo));
    assert.equal(await apply(), null);
    assert.deepEqual(readFileSync(rackPolicyFile(repo)), once);
  });

  it('leaves a policy already in the form with limits as it is, a limit and a GPU it holds among it', async () => {
    const limited = { ...carried, rules: [{ ...carried.rules[0]!, memoryLimit: some(8n * 1024n ** 3n), gpu: true }] };
    write(encodeBeast2For(RackPolicyWithLimitsType)(limited));
    assert.equal(await apply(), null);
    assert.ok(equalFor(RackPolicyWithLimitsType)(stored(), limited));
  });

  it('leaves a repository with no policy without one, and a file in neither form as it is', async () => {
    assert.equal(await apply(), null);
    assert.throws(() => readFileSync(rackPolicyFile(repo)), /ENOENT/, 'the defaults need no file');
    const damaged = new Uint8Array([1, 2, 3]);
    write(damaged);
    assert.equal(await apply(), null);
    assert.deepEqual(new Uint8Array(readFileSync(rackPolicyFile(repo))), damaged, 'a read refuses it as it did before, naming its reset');
  });

  it('is applied when a repository an earlier release wrote is opened, once, and recorded', async () => {
    write(POLICY_1_0_107);
    // What the release before the step left: a record without it.
    const record = decodeBeast2For(RepositoryRecordType)(readFileSync(join(repo, REPOSITORY_RECORD_FILE)));
    assert.ok(record.upgrades.some(({ name }) => name === RACK_POLICY_LIMITS), 'a new repository is in the form the step writes');
    writeFileSync(join(repo, REPOSITORY_RECORD_FILE), encodeRepositoryRecord({ release: '1.0.107', upgrades: record.upgrades.filter(({ name }) => name !== RACK_POLICY_LIMITS) }));

    const opened = await repositoryOpen(storage, repo);
    assert.deepEqual(opened.upgrades.find(({ name }) => name === RACK_POLICY_LIMITS), { name: RACK_POLICY_LIMITS, release: E3_RELEASE });
    assert.ok(equalFor(RackPolicyWithLimitsType)(stored(), carried));
    assert.deepEqual(await repositoryOpen(storage, repo), opened, 'a second open finds it applied');
  });
});
