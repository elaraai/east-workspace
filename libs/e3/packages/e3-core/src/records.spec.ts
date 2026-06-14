/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Licensed under BSL 1.1. See LICENSE for details.
 */

/**
 * Tests for record mutation execution: deploy genesis, the compare-and-swap
 * commit loop, history, and failure outcomes. The reducer process is faked so
 * the loop is exercised deterministically without spawning a runtime.
 */

import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert';
import { join, dirname } from 'node:path';
import { East, IntegerType, StringType, encodeBeast2For, decodeBeast2For, toEastTypeValue, ArrayType, BlobType, variant } from '@elaraai/east';
import e3 from '@elaraai/e3';
import type { Structure, TreePath } from '@elaraai/e3-types';
import { recordMutate, recordHistory, recordCompact, recordDescribe } from './records.js';
import { repoGc } from './storage/local/gc.js';
import { snapshotInputVersions } from './dataset-refs.js';
import { workspaceGetDataset, workspaceSetDataset } from './trees.js';
import { packageImport } from './packages.js';
import { workspaceCreate, workspaceDeploy } from './workspaces.js';
import { createTestRepo, removeTestRepo, createTempDir, removeTempDir } from './test-helpers.js';
import { LocalStorage } from './storage/local/index.js';
import type { StorageBackend, TaskRunner, DetachedResult } from './index.js';

const encodeInt = encodeBeast2For(IntegerType);
const decodeInt = decodeBeast2For(IntegerType);
const counterPath: TreePath = [variant('field', 'records'), variant('field', 'counter')];
// The deployed workspace structure for the `.records.counter` leaf, used to
// drive snapshotInputVersions directly.
const counterStructure: Structure = variant('struct', new Map([
  ['records', variant('struct', new Map([
    ['counter', variant('value', { type: toEastTypeValue(IntegerType), writable: false })],
  ]))],
]));

/** Constant success outcome carrying the given new-state bytes. */
function successRunner(value: Uint8Array): TaskRunner {
  return runnerReturning(async () => ({ kind: 'success', value, stdout: '', stderr: '', stdoutTruncated: false, stderrTruncated: false }));
}

/** A runner whose detached run returns a fixed outcome (no subprocess). */
function runnerReturning(impl: () => Promise<DetachedResult>): TaskRunner {
  return { runDetached: impl } as unknown as TaskRunner;
}

describe('records', () => {
  let repo: string;
  let tempDir: string;
  let storage: StorageBackend;
  const ws = 'main';

  beforeEach(async () => {
    repo = createTestRepo();
    tempDir = createTempDir();
    // reposDir = parent of the repo, so repoGc's RepoStore scans resolve.
    storage = new LocalStorage(dirname(repo));

    // counter record + increment(state, by) => state + by
    const counter = e3.record('counter', IntegerType, 0n);
    const increment = e3.mutation(
      'increment',
      counter,
      East.function([IntegerType, IntegerType], IntegerType, ($, state, by) => state.add(by))
    );
    const pkg = e3.package('counters', '1.0.0', counter, increment);
    const zip = join(tempDir, 'counters.zip');
    await e3.export(pkg, zip);
    await packageImport(storage, repo, zip);
    await workspaceCreate(storage, repo, ws);
    await workspaceDeploy(storage, repo, ws, 'counters', '1.0.0');
  });

  afterEach(() => {
    removeTestRepo(repo);
    removeTempDir(tempDir);
  });

  it('deploy mints a $init genesis commit and the initial state', async () => {
    const history = await recordHistory(storage, repo, ws, 'counter');
    assert.strictEqual(history.length, 1);
    assert.strictEqual(history[0]!.commit.mutation, '$init');
    assert.strictEqual(history[0]!.commit.parent.type, 'none');
    assert.strictEqual(await workspaceGetDataset(storage, repo, ws, counterPath), 0n);
  });

  it('commits a mutation: new state, commit chain, readable result', async () => {
    const runner = runnerReturning(async () => ({
      kind: 'success', value: encodeInt(5n),
      stdout: '', stderr: '', stdoutTruncated: false, stderrTruncated: false,
    }));

    const outcome = await recordMutate(storage, runner, repo, ws, 'counter', 'increment', [encodeInt(5n)], { actor: 'cli:test' });
    assert.strictEqual(outcome.kind, 'committed');

    assert.strictEqual(await workspaceGetDataset(storage, repo, ws, counterPath), 5n);
    const history = await recordHistory(storage, repo, ws, 'counter');
    assert.strictEqual(history.length, 2);
    assert.strictEqual(history[0]!.commit.mutation, 'increment');
    assert.strictEqual(history[0]!.commit.actor, 'cli:test');
    assert.strictEqual(history[0]!.commit.parent.type, 'some'); // chained onto $init
  });

  it('a failed reducer writes nothing and leaves history intact', async () => {
    const runner = runnerReturning(async () => ({
      kind: 'failed', exitCode: 1,
      stdout: '', stderr: 'reducer threw', stdoutTruncated: false, stderrTruncated: false,
    }));

    const outcome = await recordMutate(storage, runner, repo, ws, 'counter', 'increment', [encodeInt(5n)], { actor: 'cli:test' });
    assert.strictEqual(outcome.kind, 'failed');

    assert.strictEqual(await workspaceGetDataset(storage, repo, ws, counterPath), 0n);
    assert.strictEqual((await recordHistory(storage, repo, ws, 'counter')).length, 1);
  });

  it('rejects unknown records, unknown mutations, and wrong arity', async () => {
    const runner = runnerReturning(async () => ({
      kind: 'success', value: encodeInt(1n),
      stdout: '', stderr: '', stdoutTruncated: false, stderrTruncated: false,
    }));

    const unknownRecord = await recordMutate(storage, runner, repo, ws, 'nope', 'increment', [encodeInt(1n)], { actor: 'x' });
    assert.strictEqual(unknownRecord.kind, 'invalid');

    const unknownMutation = await recordMutate(storage, runner, repo, ws, 'counter', 'nope', [encodeInt(1n)], { actor: 'x' });
    assert.strictEqual(unknownMutation.kind, 'invalid');

    const wrongArity = await recordMutate(storage, runner, repo, ws, 'counter', 'increment', [], { actor: 'x' });
    assert.strictEqual(wrongArity.kind, 'invalid');

    // None of the rejects touched state or history.
    assert.strictEqual(await workspaceGetDataset(storage, repo, ws, counterPath), 0n);
    assert.strictEqual((await recordHistory(storage, repo, ws, 'counter')).length, 1);
  });

  it('keeps the whole commit chain reachable through gc', async () => {
    const runner = runnerReturning(async () => ({
      kind: 'success', value: encodeInt(5n),
      stdout: '', stderr: '', stdoutTruncated: false, stderrTruncated: false,
    }));
    await recordMutate(storage, runner, repo, ws, 'counter', 'increment', [encodeInt(5n)], { actor: 'cli:test' });

    // gc would collect every commit if the head-commit hash in the ref's
    // version vector and the chain it roots were not walked.
    const result = await repoGc(storage, repo, { minAge: 0 });
    assert.strictEqual(result.deletedObjects, 0, 'no reachable object collected');

    const history = await recordHistory(storage, repo, ws, 'counter');
    assert.strictEqual(history.length, 2, 'increment + $init survive');
    assert.strictEqual(await workspaceGetDataset(storage, repo, ws, counterPath), 5n);
  });

  it('retries when a concurrent writer wins the compare-and-swap', async () => {
    const genesis = await storage.datasets.read(repo, ws, 'records/counter');
    assert.ok(genesis && genesis.type === 'value');
    const stateHash = genesis.value.hash;

    let calls = 0;
    const runner = runnerReturning(async () => {
      calls++;
      if (calls === 1) {
        // Interfere mid-flight: same valid state, different version entry — the
        // changed bytes bump the ref revision so the first writeIf conflicts.
        await storage.datasets.write(repo, ws, 'records/counter', variant('value', {
          hash: stateHash,
          versions: new Map([['.records.counter', 'deadbeef'.padEnd(64, '0')]]),
        }));
      }
      return { kind: 'success', value: encodeInt(7n), stdout: '', stderr: '', stdoutTruncated: false, stderrTruncated: false };
    });

    const outcome = await recordMutate(storage, runner, repo, ws, 'counter', 'increment', [encodeInt(7n)], { actor: 'cli:test' });
    assert.strictEqual(outcome.kind, 'committed');
    assert.strictEqual(calls, 2, 'reducer re-ran against fresher state after the conflict');
    assert.strictEqual(await workspaceGetDataset(storage, repo, ws, counterPath), 7n);
  });

  it('change detection is commit-granular: an identical-state mutation still changes the version', async () => {
    const before = (await snapshotInputVersions(storage, repo, ws, counterStructure, new Set())).get('.records.counter');
    // A mutation that reproduces the identical state (state hash unchanged).
    const outcome = await recordMutate(storage, successRunner(encodeInt(0n)), repo, ws, 'counter', 'increment', [encodeInt(0n)], { actor: 'cli:test' });
    assert.strictEqual(outcome.kind, 'committed');
    const after = (await snapshotInputVersions(storage, repo, ws, counterStructure, new Set())).get('.records.counter');
    // The snapshot keys on the commit hash, so it changes even though the state did not — no ABA.
    assert.notStrictEqual(after, before);
    assert.strictEqual(await workspaceGetDataset(storage, repo, ws, counterPath), 0n);
  });

  it('N concurrent increments all commit and converge with no lost updates', async () => {
    // The reducer reads the current state (arg 0) and adds `by` (arg 1).
    const adder = { runDetached: async (spec: { args: Uint8Array[] }) => ({
      kind: 'success' as const, value: encodeInt(decodeInt(spec.args[0]!) + decodeInt(spec.args[1]!)),
      stdout: '', stderr: '', stdoutTruncated: false, stderrTruncated: false,
    }) } as unknown as TaskRunner;

    const K = 8;
    const results = await Promise.all(
      Array.from({ length: K }, () => recordMutate(storage, adder, repo, ws, 'counter', 'increment', [encodeInt(1n)], { actor: 'cli:test' })),
    );
    assert.ok(results.every((r) => r.kind === 'committed'), 'every mutation committed');
    assert.strictEqual(await workspaceGetDataset(storage, repo, ws, counterPath), BigInt(K));
    // genesis + K commits, a single linear chain (no forks / lost updates).
    assert.strictEqual((await recordHistory(storage, repo, ws, 'counter')).length, K + 1);
  });

  it('recordCompact resets history to a $compact root and gc reclaims the prior chain', async () => {
    await recordMutate(storage, successRunner(encodeInt(5n)), repo, ws, 'counter', 'increment', [encodeInt(5n)], { actor: 'cli:test' });
    assert.strictEqual((await recordHistory(storage, repo, ws, 'counter')).length, 2);

    const outcome = await recordCompact(storage, repo, ws, 'counter', { actor: 'cli:test' });
    assert.strictEqual(outcome.kind, 'committed');
    const hist = await recordHistory(storage, repo, ws, 'counter');
    assert.strictEqual(hist.length, 1);
    assert.strictEqual(hist[0]!.commit.mutation, '$compact');
    assert.strictEqual(hist[0]!.commit.parent.type, 'none');
    assert.strictEqual(await workspaceGetDataset(storage, repo, ws, counterPath), 5n); // state preserved

    const gc = await repoGc(storage, repo, { minAge: 0 });
    assert.ok(gc.deletedObjects > 0, 'the pre-compact commit chain is collected');
    assert.strictEqual((await recordHistory(storage, repo, ws, 'counter')).length, 1); // head survives
    assert.strictEqual(await workspaceGetDataset(storage, repo, ws, counterPath), 5n);
  });

  it('recordCompact on an unknown record is invalid', async () => {
    assert.strictEqual((await recordCompact(storage, repo, ws, 'nope', { actor: 'x' })).kind, 'invalid');
  });

  it('records the args tuple on a commit and none on $init', async () => {
    const decodeArgs = decodeBeast2For(ArrayType(BlobType));
    await recordMutate(storage, successRunner(encodeInt(5n)), repo, ws, 'counter', 'increment', [encodeInt(5n)], { actor: 'cli:test' });
    const hist = await recordHistory(storage, repo, ws, 'counter');

    const incArgs = hist[0]!.commit.args;
    if (incArgs.type !== 'some') throw new Error('expected the increment commit to record its args');
    const storedArgs = decodeArgs(await storage.objects.read(repo, incArgs.value));
    assert.strictEqual(storedArgs.length, 1);
    assert.ok(Buffer.from(storedArgs[0]!).equals(Buffer.from(encodeInt(5n))), 'stored args round-trip to the input bytes');

    assert.strictEqual(hist[1]!.commit.args.type, 'none'); // $init has no args
  });

  it('recordDescribe returns mutation signatures and null for an unknown record', async () => {
    const sig = await recordDescribe(storage, repo, ws, 'counter');
    assert.ok(sig);
    assert.strictEqual(sig.name, 'counter');
    assert.deepStrictEqual(sig.mutations.map((m) => m.name), ['increment']);
    assert.strictEqual(sig.mutations[0]!.argTypes.length, 1);
    assert.strictEqual(await recordDescribe(storage, repo, ws, 'nope'), null);
  });

  it('rejects a raw set on a record path (mutations are the only door)', async () => {
    await assert.rejects(
      workspaceSetDataset(storage, repo, ws, counterPath, 42n, IntegerType),
      /not writable/,
    );
    assert.strictEqual(await workspaceGetDataset(storage, repo, ws, counterPath), 0n);
  });

  it('redeploy preserves committed record state and history when the type is unchanged', async () => {
    await recordMutate(storage, successRunner(encodeInt(9n)), repo, ws, 'counter', 'increment', [encodeInt(9n)], { actor: 'cli:test' });
    const lenBefore = (await recordHistory(storage, repo, ws, 'counter')).length;

    await workspaceDeploy(storage, repo, ws, 'counters', '1.0.0'); // redeploy onto the live workspace

    assert.strictEqual(await workspaceGetDataset(storage, repo, ws, counterPath), 9n); // not reset to 0n
    assert.strictEqual((await recordHistory(storage, repo, ws, 'counter')).length, lenBefore); // chain intact
  });

  it('redeploy errors when a record changed type', async () => {
    await recordMutate(storage, successRunner(encodeInt(3n)), repo, ws, 'counter', 'increment', [encodeInt(3n)], { actor: 'x' });
    // A new package version where `counter` is a String record instead of Integer.
    const counterStr = e3.record('counter', StringType, '');
    const pkg2 = e3.package('counters', '2.0.0', counterStr);
    const zip2 = join(tempDir, 'counters2.zip');
    await e3.export(pkg2, zip2);
    await packageImport(storage, repo, zip2);
    await assert.rejects(workspaceDeploy(storage, repo, ws, 'counters', '2.0.0'), /changed type/);
  });
});
