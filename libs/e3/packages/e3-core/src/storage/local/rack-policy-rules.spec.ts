/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Licensed under BSL 1.1. See LICENSE for details.
 */

/**
 * The upgrade that carries a local repository's rack policy into the form of
 * rules and defaults alone: it reads what `rack-policy-keep` writes, and
 * writes this release's form. The rack package, whose type the policy is,
 * holds the form it writes to that type (`routing.spec.ts`); this holds the
 * step to what it leaves, from the bytes release 1.0.107 stored (before every
 * rack-policy step) and from the form release 1.0.117 stored (after all four
 * before it).
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
import { RACK_POLICY_KEEP, RackPolicyWithKeepType } from './rack-policy-keep.js';
import { RACK_POLICY_LIMITS, rackPolicyFile } from './rack-policy-limits.js';
import { RACK_POLICY_MERGES } from './rack-policy-merges.js';
import { RACK_POLICY_RULES, RackPolicyRulesType, rackPolicyRules, takeRackPolicyNotice } from './rack-policy-rules.js';
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

/** A policy in the form `rack-policy-keep` writes, as release 1.0.117 stored it. */
type PolicyWithKeep = ValueTypeOf<typeof RackPolicyWithKeepType>;
/** A policy in the form this step writes. */
type PolicyOfRules = ValueTypeOf<typeof RackPolicyRulesType>;

/** A policy release 1.0.117 stored: a limit, a GPU, its weighing turned on,
 *  its merges here, a rule's merges on a rack, and kept for the session. */
const kept: PolicyWithKeep = { enabled: true, mode: variant('auto', null), defaultSize: variant('xlarge', null),
  defaultTimeoutMinutes: 720n, spill: false, claimTimeoutSeconds: 45n, retryTaskFailuresLocally: true, weighFetch: true,
  defaultMerges: variant('local', null), keep: variant('session', null), rules: [
    { tasks: 'train_*', target: variant('rack', null), size: some(variant('large', null)), timeoutMinutes: some(90n), allowHostCoupled: true,
      memoryLimit: some(8n * 1024n ** 3n), gpu: true, merges: some(variant('rack', null)) },
    { tasks: 'ingest_*', target: variant('local', null), size: none, timeoutMinutes: none, allowHostCoupled: false, memoryLimit: none, gpu: false, merges: none },
  ] };

/** What the step makes of it: its rules and defaults as they were, and nothing of what the form no longer holds. */
function carried(policy: PolicyWithKeep): PolicyOfRules {
  const { weighFetch: _weighFetch, defaultMerges: _defaultMerges, keep: _keep, rules, ...defaults } = policy;
  return { ...defaults, rules: rules.map(({ merges: _merges, ...rule }) => rule) };
}

describe('rack-policy-rules', () => {
  let dir: string;
  let repo: string;
  const storage = new LocalStorage();
  const write = (bytes: Uint8Array) => {
    mkdirSync(dirname(rackPolicyFile(repo)), { recursive: true });
    writeFileSync(rackPolicyFile(repo), bytes);
  };
  const stored = () => decodeBeast2For(RackPolicyRulesType)(readFileSync(rackPolicyFile(repo)));
  const apply = () => rackPolicyRules.apply(storage, repo, null, Date.now() + 60_000);
  const steps = [RACK_POLICY_LIMITS, RACK_POLICY_WEIGH_FETCH, RACK_POLICY_MERGES, RACK_POLICY_KEEP, RACK_POLICY_RULES];
  /** The repository's record as a release that had applied none of `pending` left it. */
  const recordWithout = (release: string, pending: readonly string[]) => {
    const record = decodeBeast2For(RepositoryRecordType)(readFileSync(join(repo, REPOSITORY_RECORD_FILE)));
    writeFileSync(join(repo, REPOSITORY_RECORD_FILE), encodeRepositoryRecord({ release, upgrades: record.upgrades.filter(({ name }) => !pending.includes(name)) }));
  };

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'e3-rack-policy-'));
    repo = join(dir, 'repo');
    assert.ok(repoInit(repo).success);
  });
  afterEach(() => { rmSync(dir, { recursive: true, force: true }); });

  it('is the local backend\'s fifth step, after the keep', () => {
    assert.deepEqual(LOCAL_REPOSITORY_UPGRADES.map(({ name }) => name), steps);
  });

  it('carries a policy in the form that says how long a rack keeps work into this form, its rules and defaults as they were', async () => {
    write(encodeBeast2For(RackPolicyWithKeepType)(kept));
    assert.throws(() => stored(), 'this release\'s form does not read it');
    assert.equal(await apply(), null, 'the step is done in one part');
    assert.ok(equalFor(RackPolicyRulesType)(stored(), carried(kept)), printFor(RackPolicyRulesType)(stored()));
    // Applied again, as a crash before its record was written has it: nothing changes.
    const once = readFileSync(rackPolicyFile(repo));
    assert.equal(await apply(), null);
    assert.deepEqual(readFileSync(rackPolicyFile(repo)), once);
  });

  it('says each setting it let go that asked for more than the defaults, and why, once, for the first command that reads the policy', async () => {
    write(encodeBeast2For(RackPolicyWithKeepType)(kept));
    assert.equal(await apply(), null);
    const said = await takeRackPolicyNotice(repo);
    assert.equal(said.length, 3, said.join('\n'));
    assert.match(said[0]!, /^weighFetch \(--weigh-fetch\) was on: work is no longer weighed/);
    assert.match(said[1]!, /^defaultMerges was local \(--merges local\): a split task's merges run where its pieces run$/);
    assert.match(said[2]!, /^keep was session \(--keep session\): a rack keeps what your hub's tasks read and write/);
    assert.deepEqual(await takeRackPolicyNotice(repo), [], 'said once');
    // A rule that kept its own merges local is named too; one that named them on a rack asked for nothing more
    const rules = { ...kept, weighFetch: false, defaultMerges: variant('rack', null), keep: variant('split', null),
      rules: [{ ...kept.rules[0]!, merges: some(variant('local', null)) }, { ...kept.rules[1]!, merges: some(variant('rack', null)) }] };
    write(encodeBeast2For(RackPolicyWithKeepType)(rules));
    assert.equal(await apply(), null);
    assert.deepEqual(await takeRackPolicyNotice(repo), ['the rule \'train_*\' kept its merges local (--merges local): a split task\'s merges run where its pieces run']);
  });

  it('says nothing of a policy that asked for nothing more than the defaults', async () => {
    write(encodeBeast2For(RackPolicyWithKeepType)({ ...kept, weighFetch: false, defaultMerges: variant('rack', null), keep: variant('split', null),
      rules: kept.rules.map((rule) => ({ ...rule, merges: none })) }));
    assert.equal(await apply(), null);
    assert.deepEqual(await takeRackPolicyNotice(repo), []);
  });

  it('leaves a policy already in this form as it is', async () => {
    const rules = carried(kept);
    write(encodeBeast2For(RackPolicyRulesType)(rules));
    assert.equal(await apply(), null);
    assert.ok(equalFor(RackPolicyRulesType)(stored(), rules));
  });

  it('leaves a repository with no policy without one, and a file in no form it knows as it is', async () => {
    assert.equal(await apply(), null);
    assert.throws(() => readFileSync(rackPolicyFile(repo)), /ENOENT/, 'the defaults need no file');
    const damaged = new Uint8Array([1, 2, 3]);
    write(damaged);
    assert.equal(await apply(), null);
    assert.deepEqual(new Uint8Array(readFileSync(rackPolicyFile(repo))), damaged, 'a read refuses it as it did before, naming its reset');
  });

  it('carries a policy release 1.0.117 stored through itself alone as the repository is opened, and records it', async () => {
    write(encodeBeast2For(RackPolicyWithKeepType)(kept));
    recordWithout('1.0.117', [RACK_POLICY_RULES]);
    const opened = await repositoryOpen(storage, repo);
    assert.deepEqual(opened.upgrades.find(({ name }) => name === RACK_POLICY_RULES), { name: RACK_POLICY_RULES, release: E3_RELEASE });
    assert.ok(equalFor(RackPolicyRulesType)(stored(), carried(kept)), printFor(RackPolicyRulesType)(stored()));
    assert.deepEqual(await repositoryOpen(storage, repo), opened, 'a second open finds it applied');
  });

  it('carries a policy release 1.0.107 stored through every rack-policy step in order as the repository is opened, once each, and records them', async () => {
    write(POLICY_1_0_107);
    recordWithout('1.0.107', steps);
    const opened = await repositoryOpen(storage, repo);
    const names = opened.upgrades.map(({ name }) => name);
    assert.deepEqual(names.filter((name) => steps.includes(name)), steps, 'the limits, the weighing, the merges, the keep, then the rules');
    for (const step of steps) assert.deepEqual(opened.upgrades.find(({ name }) => name === step), { name: step, release: E3_RELEASE });
    // Its rules and defaults, as 1.0.107 stored them, with what the steps between added let go
    const expected: PolicyOfRules = { enabled: true, mode: variant('auto', null), defaultSize: variant('xlarge', null),
      defaultTimeoutMinutes: 720n, spill: false, claimTimeoutSeconds: 45n, retryTaskFailuresLocally: true, rules: [
        { tasks: 'train_*', target: variant('rack', null), size: some(variant('large', null)), timeoutMinutes: some(90n), allowHostCoupled: true, memoryLimit: none, gpu: false },
        { tasks: 'ingest_*', target: variant('local', null), size: none, timeoutMinutes: none, allowHostCoupled: false, memoryLimit: none, gpu: false },
      ] };
    assert.ok(equalFor(RackPolicyRulesType)(stored(), expected), printFor(RackPolicyRulesType)(stored()));
    assert.deepEqual(await repositoryOpen(storage, repo), opened, 'a second open finds every step applied');
  });
});
