/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Licensed under BSL 1.1. See LICENSE for details.
 */

import { it } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { East, IntegerType, StringType, encodeBeast2For, encodeEastIR, equalFor, none, some, variant } from '@elaraai/east';
import { InMemoryStorage, uuidv7, type TaskBodyRequest } from '@elaraai/e3-core';
import { TASK_OBJECT_KIND, TaskObjectType, type TaskObject } from '@elaraai/e3-types';
import { DEFAULT_RACK_POLICY, RackPolicyError, RackPolicyType, loadPolicy, policyPath, removeRule, savePolicy, selectTask, setEnabled, setMode, setRule } from './policy.js';
import { rackTierFor } from './tiers.js';
import { collectPlatformNames, hostCoupledPlatforms } from './host-coupling.js';
import { EligibilityEvaluator } from './eligibility.js';

it('matches whole names, literal punctuation, wildcards, and first-rule precedence', () => {
  let policy = setRule(DEFAULT_RACK_POLICY, 'train', 'rack');
  assert.equal(selectTask(policy, 'train').target, 'rack');
  assert.equal(selectTask(policy, 'train_xgb').target, 'local');
  policy = setRule(policy, 'train_*', 'local');
  policy = setRule(policy, '*', 'rack', { size: 'small', timeoutMinutes: 12 });
  assert.equal(selectTask(policy, 'train_xgb').target, 'local');
  assert.equal(selectTask(policy, 'other').size, 'small');
  assert.equal(selectTask(policy, 'other').timeoutMinutes, 12);
  assert.equal(selectTask(policy, 'train').size, 'large');
  assert.equal(selectTask(policy, 'train').timeoutMinutes, 1440);
  const literal = setRule(DEFAULT_RACK_POLICY, 'task[?].*', 'rack');
  assert.equal(selectTask(literal, 'task[x].anything').target, 'rack');
  assert.equal(selectTask(literal, 'taskxx.anything').target, 'local');
  assert.equal(selectTask(literal, 'task[xx].anything').target, 'local');
  assert.equal(selectTask(setMode(DEFAULT_RACK_POLICY, 'auto'), 'anything').target, 'rack');
  assert.equal(removeRule(policy, 'train').rules.length, 2);
  assert.equal(setRule(policy, 'train', 'local').rules.length, 3);
  assert.equal(DEFAULT_RACK_POLICY.rules.length, 0);
});

it('round-trips policy and refuses corrupt or invalid values with a remedy', async (t) => {
  const repo = await mkdtemp(join(tmpdir(), 'e3r-'));
  t.after(() => rm(repo, { recursive: true, force: true }));
  assert.ok(equalFor(RackPolicyType)(await loadPolicy(repo), DEFAULT_RACK_POLICY));
  const policy = setEnabled(setRule(DEFAULT_RACK_POLICY, 'train_*', 'rack'), true);
  await savePolicy(repo, policy);
  assert.ok(equalFor(RackPolicyType)(await loadPolicy(repo), policy));
  await assert.rejects(savePolicy(repo, { ...policy, claimTimeoutSeconds: -1n }), RackPolicyError);
  await writeFile(policyPath(repo), 'corrupt');
  await assert.rejects(loadPolicy(repo), (err: unknown) => err instanceof RackPolicyError && err.message.includes(policyPath(repo)) && err.message.includes('reset'));
});

it('maps only each runtime’s own stock platforms to a rack tier', () => {
  const decode = variant('lazy', null);
  assert.deepEqual(rackTierFor(variant('east_node', { platforms: [], decode })), { tier: 'node' });
  assert.deepEqual(rackTierFor(variant('east_node', { platforms: ['@elaraai/east-node-std', '@elaraai/east-node-io'], decode })), { tier: 'node' });
  assert.deepEqual(rackTierFor(variant('east_py', { platforms: ['east-py-std', 'east-py-io'], decode })), { tier: 'py' });
  assert.deepEqual(rackTierFor(variant('east_py', { platforms: ['east-py-datascience'], decode })), { tier: 'py-datascience' });
  assert.deepEqual(rackTierFor(variant('east_c', { platforms: ['east-c-std'], decode })), { tier: 'c' });
  assert.deepEqual(rackTierFor(variant('east_node', { platforms: ['east-py-std'], decode })), { ineligible: 'non-stock-platform:east-py-std' });
  assert.deepEqual(rackTierFor(variant('east_py', { platforms: ['mine'], decode })), { ineligible: 'non-stock-platform:mine' });
  assert.deepEqual(rackTierFor(variant('custom', { command: ['mine'] })), { ineligible: 'custom-runner' });
});

const fetchGet = East.asyncPlatform('fetch_get', [StringType], StringType);
const envGet = East.platform('env_get', [StringType], StringType);
const sync = East.function([StringType], StringType, ($, value) => envGet(value));
const asyncNested = East.asyncFunction([StringType], StringType, ($, value) => {
  const helper = $.const(East.asyncFunction([StringType], StringType, ($, url) => fetchGet(url)));
  return helper(value);
});

it('scans sync and nested async programs and distinguishes JSON text from host files', () => {
  assert.deepEqual(collectPlatformNames(encodeEastIR(sync.toIR())), ['env_get']);
  assert.deepEqual(collectPlatformNames(encodeEastIR(asyncNested.toIR())), ['fetch_get']);
  assert.deepEqual(hostCoupledPlatforms(['fs_read_file', 'json_open', 'json_value', 'json_open_text', 'path_resolve', 'console_log', 'crypto_uuid', 'random_normal', 'time_now']),
    ['fs_read_file', 'json_open', 'json_value', 'path_resolve']);
  assert.throws(() => collectPlatformNames(new Uint8Array([1])));
});

it('checks reducers even when the first request is a merge with cached maps', async () => {
  const storage = new InMemoryStorage();
  await storage.repos.create('repo');
  const pure = East.function([IntegerType], IntegerType, ($, value) => value.add(1n));
  const program = await storage.objects.write('repo', encodeEastIR(pure.toIR()));
  const reducer = await storage.objects.write('repo', encodeEastIR(sync.toIR()));
  const task: TaskObject = {
    kind: TASK_OBJECT_KIND, body: variant('east', { program }),
    runner: variant('east_node', { platforms: ['@elaraai/east-node-std'], decode: variant('lazy', null) }),
    inputs: [], output: { path: [], kind: variant('dict', { merge: some(reducer) }) }, role: variant('data', null), environment: none,
  };
  const hash = await storage.objects.write('repo', encodeBeast2For(TaskObjectType)(task));
  const request: TaskBodyRequest = { storage, repo: 'repo', taskHash: hash, task, inputHashes: ['merge'],
    ids: { inHash: 'a'.repeat(64), executionId: uuidv7(), startTime: Date.now() }, options: { taskName: 'train' },
    role: 'unit', logicalTaskHash: hash, unit: { inputs: ['merge'], merge: { parts: [], range: null }, own: false } };
  const policy = setRule(DEFAULT_RACK_POLICY, 'train', 'rack');
  const evaluator = new EligibilityEvaluator(policy);
  assert.deepEqual(await evaluator.evaluate(request), { eligible: false, reason: 'host-coupled:env_get' });
  assert.deepEqual(await evaluator.evaluate({ ...request, role: 'task' }), { eligible: false, reason: 'host-coupled:env_get' });
  assert.deepEqual(await evaluator.evaluate({ ...request, options: {} }), { eligible: false, reason: 'no-task-name' });
  assert.deepEqual(await evaluator.evaluate({ ...request, options: { taskName: 'other' } }), { eligible: false, reason: 'not-selected' });
  const override = new EligibilityEvaluator(setRule(policy, 'train', 'rack', { allowHostCoupled: true }));
  assert.deepEqual(await override.evaluate(request), { eligible: true, tier: 'node', size: 'large', timeoutMinutes: 1440 });
  const envTask = { ...task, environment: some('b'.repeat(64)) };
  assert.deepEqual(await new EligibilityEvaluator(policy).evaluate({ ...request, task: envTask }), { eligible: false, reason: 'environment' });
  const badTask = { ...task, body: variant('east', { program: 'c'.repeat(64) }) };
  assert.deepEqual(await new EligibilityEvaluator(policy).evaluate({ ...request, task: badTask }), { eligible: false, reason: 'unscannable' });
});
