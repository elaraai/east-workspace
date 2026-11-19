/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Licensed under BSL 1.1. See LICENSE for details.
 */

/**
 * What a deploy plans for an input the new package keeps as a dataset people
 * do not set. A package the SDK builds keeps its inputs, its records and its
 * tasks' outputs at paths of their own, so the packages here are built by
 * hand; the contract suite (`contract/workspace-deploy.ts`) deploys the rest
 * of the plan from packages the SDK exports.
 */

import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { dirname } from 'node:path';
import { IntegerType, SortedMap, StringType, encodeBeast2For, equalFor, toEastTypeValue, variant, type EastType } from '@elaraai/east';
import { DatasetRefType, type DatasetRef, type PackageObject } from '@elaraai/e3-types';
import { planInputDeployments } from './input-deploy.js';
import { LocalStorage } from './storage/local/index.js';
import type { StorageBackend } from './storage/interfaces.js';
import { createTestRepo, removeTestRepo } from './test-helpers.js';

/** A package declaring `inputs/x` as a dataset people set or not, of the
 *  type given (a String when omitted), its value `ref`; or declaring nothing,
 *  when `ref` is null. */
function pkg(writable: boolean, ref: DatasetRef | null, type: EastType = StringType): PackageObject {
  const x = variant('value', { type: toEastTypeValue(type), writable });
  return {
    tasks: new Map(),
    data: {
      structure: variant('struct', new SortedMap(ref === null ? [] : [['inputs', variant('struct', new SortedMap([['x', x]]))]])),
      refs: new Map(ref === null ? [] : [['inputs/x', ref]]),
    },
    functions: new Map(),
    records: new Map(),
    sources: new Map(),
  };
}

/** Whether two refs are one, as East compares them. */
const sameRef = equalFor(DatasetRefType);

describe('planInputDeployments', () => {
  let repo: string;
  let storage: StorageBackend;
  let given: DatasetRef;
  let other: DatasetRef;

  before(async () => {
    repo = createTestRepo();
    storage = new LocalStorage(dirname(repo));
    given = variant('value', { hash: await storage.objects.write(repo, encodeBeast2For(StringType)('given')), versions: new Map() });
    other = variant('value', { hash: await storage.objects.write(repo, encodeBeast2For(StringType)('set')), versions: new Map() });
  });

  after(() => {
    removeTestRepo(repo);
  });

  it('gives an input the new package no longer marks as one its value when nobody set it', async () => {
    await storage.datasets.write(repo, 'kept', 'inputs/x', given);
    const plans = await planInputDeployments(storage, repo, 'kept', pkg(false, given), pkg(true, given), 'keep-edited');
    assert.deepEqual(plans.map(({ plan }) => plan), [{ input: 'inputs/x', action: variant('package', null) }]);
  });

  it('resets one someone set, under either policy, and says why', async () => {
    await storage.datasets.write(repo, 'set', 'inputs/x', other);
    for (const policy of ['keep-edited', 'reset'] as const) {
      const [deployment] = await planInputDeployments(storage, repo, 'set', pkg(false, given), pkg(true, given), policy);
      assert.deepEqual(deployment?.plan.action,
        variant('reset', { reason: 'is no longer an input of the new package, which gives it its value', policy: false }));
      assert.equal(deployment?.kept, undefined, 'the package\'s value is written');
    }
  });

  it('R68 — keeps an input someone set that feeds a load, under the reset policy too, naming the load; a changed type resets it, saying the load waits', async () => {
    const feeds = new Map([['inputs/x', 'orders.erp']]);
    await storage.datasets.write(repo, 'fed', 'inputs/x', other);
    const [retained] = await planInputDeployments(storage, repo, 'fed', pkg(true, given), pkg(true, given), 'reset', true, feeds);
    assert.deepEqual(retained?.plan.action, variant('retained', { load: 'orders.erp' }));
    assert.ok(retained?.kept !== undefined && sameRef(retained.kept, other), 'the workspace keeps what was set');
    const [kept] = await planInputDeployments(storage, repo, 'fed', pkg(true, given), pkg(true, given), 'keep-edited', true, feeds);
    assert.deepEqual(kept?.plan.action, variant('keep', null), 'as any input under keep-edited');
    assert.ok(kept?.kept !== undefined && sameRef(kept.kept, other));

    const [changed] = await planInputDeployments(storage, repo, 'fed', pkg(true, given, IntegerType), pkg(true, given), 'reset', true, feeds);
    assert.equal(changed?.plan.action.type, 'reset');
    assert.match(changed?.plan.action.type === 'reset' ? changed.plan.action.value.reason : '', /^was set in the workspace, and changed type:\n[\s\S]*\norders\.erp waits until it is set again$/);
    assert.equal(changed?.kept, undefined, 'the package\'s value is written');

    // One that holds its package's value is the package's, as before: the load waits on it
    await storage.datasets.write(repo, 'given', 'inputs/x', given);
    const [packaged] = await planInputDeployments(storage, repo, 'given', pkg(true, given), pkg(true, given), 'reset', true, feeds);
    assert.deepEqual(packaged?.plan.action, variant('package', null));
  });

  it('drops one the new package does not declare at all', async () => {
    await storage.datasets.write(repo, 'gone', 'inputs/x', other);
    const plans = await planInputDeployments(storage, repo, 'gone', pkg(false, null), pkg(true, given), 'keep-edited');
    assert.deepEqual(plans.map(({ plan }) => plan), [{ input: 'inputs/x', action: variant('drop', null) }]);
  });
});
