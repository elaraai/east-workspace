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
import { fileURLToPath } from 'node:url';
import { East, IntegerType, StringType, encodeBeast2For, decodeBeast2For, toEastTypeValue, ArrayType, BlobType, DictType, StructType, openBeast2PagesFor, variant, type ValueTypeOf } from '@elaraai/east';
import e3 from '@elaraai/e3';
import type { Structure, TreePath } from '@elaraai/e3-types';
import { recordMutate, recordHistory, recordCompact, recordDescribe } from './records.js';
import { runDetached } from './execution/runDetached.js';
import { repoGc } from './storage/local/gc.js';
import { snapshotInputVersions } from './dataset-refs.js';
import { WorkspaceLockError } from './errors.js';
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

/** A runner whose detached run returns a fixed outcome (no subprocess). The
 *  impl may inspect the run spec and options (e.g. the abort signal) — existing
 *  zero-arg impls remain valid. */
function runnerReturning(
  impl: (spec: { args: Uint8Array[]; limits?: { timeoutMs: number } }, options?: { signal?: AbortSignal }) => Promise<DetachedResult>,
): TaskRunner {
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

  it('the version self-entry equals the commit hash and the commit is timestamped (§6.3)', async () => {
    const outcome = await recordMutate(storage, successRunner(encodeInt(5n)), repo, ws, 'counter', 'increment', [encodeInt(5n)], { actor: 'cli:test' });
    assert.strictEqual(outcome.kind, 'committed');
    const commitHash = (outcome as { commitHash: string }).commitHash;

    // §6.3: the record ref's version self-entry carries the COMMIT hash (not the
    // state hash), so change detection is commit-granular — asserted equal here,
    // where other tests only observe that it changes.
    const versions = await snapshotInputVersions(storage, repo, ws, counterStructure, new Set());
    assert.strictEqual(versions.get('.records.counter'), commitHash, 'self-entry == commit hash');

    // The head commit is timestamped — the audit trail's `at`.
    const head = (await recordHistory(storage, repo, ws, 'counter'))[0]!.commit;
    assert.ok(head.at instanceof Date && !Number.isNaN(head.at.getTime()), 'commit.at is a valid timestamp');
  });

  it('a failed reducer writes nothing and leaves history intact', async () => {
    const runner = runnerReturning(async () => ({
      kind: 'failed', exitCode: 1,
      stdout: '', stderr: 'reducer threw', stdoutTruncated: false, stderrTruncated: false,
    }));

    const objectsBefore = (await storage.objects.list(repo)).length;
    const outcome = await recordMutate(storage, runner, repo, ws, 'counter', 'increment', [encodeInt(5n)], { actor: 'cli:test' });
    assert.strictEqual(outcome.kind, 'failed');

    assert.strictEqual(await workspaceGetDataset(storage, repo, ws, counterPath), 0n);
    assert.strictEqual((await recordHistory(storage, repo, ws, 'counter')).length, 1);
    // §12.5: an aborted reducer writes NOTHING — recordMutate returns before any
    // objects.write — so not even an orphan state/args/commit object is left.
    assert.strictEqual((await storage.objects.list(repo)).length, objectsBefore, 'no object written on abort');
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
    // Assert on the outcome kinds (not just a boolean) so a future failure is
    // self-diagnosing: a residual `conflict` (CAS budget exhausted under
    // contention) reads differently from `failed`/`invalid`, and both read
    // differently from a converged-but-wrong value (a real lost update, caught by
    // the value assertion below). The in-process keyed mutex serializes these
    // same-process writers, so each should commit without a forced retry.
    const kinds = results.map((r) => r.kind);
    assert.ok(results.every((r) => r.kind === 'committed'), `every mutation committed; got ${JSON.stringify(kinds)}`);
    assert.strictEqual(await workspaceGetDataset(storage, repo, ws, counterPath), BigInt(K), 'converged to K with no lost updates');
    // genesis + K commits, a single linear chain (no forks / lost updates).
    assert.strictEqual((await recordHistory(storage, repo, ws, 'counter')).length, K + 1);
  });

  // ---- OPS-3: idempotency key (issue #69) ----

  it('idempotent retry: same key returns the prior commit and does NOT re-run the reducer', async () => {
    let calls = 0;
    const runner = runnerReturning(async () => {
      calls++;
      return { kind: 'success', value: encodeInt(5n), stdout: '', stderr: '', stdoutTruncated: false, stderrTruncated: false };
    });

    const first = await recordMutate(storage, runner, repo, ws, 'counter', 'increment', [encodeInt(5n)], { actor: 'cli:test', idempotencyKey: 'k1' });
    const second = await recordMutate(storage, runner, repo, ws, 'counter', 'increment', [encodeInt(5n)], { actor: 'cli:test', idempotencyKey: 'k1' });

    assert.strictEqual(first.kind, 'committed');
    assert.strictEqual(second.kind, 'committed');
    if (first.kind === 'committed' && second.kind === 'committed') {
      assert.strictEqual(second.commitHash, first.commitHash, 'the retry returns the original commit');
    }
    assert.strictEqual(calls, 1, 'the reducer ran exactly once');
    assert.strictEqual((await recordHistory(storage, repo, ws, 'counter')).length, 2, 'genesis + one commit, no duplicate');
    assert.strictEqual(await workspaceGetDataset(storage, repo, ws, counterPath), 5n);
  });

  it('distinct idempotency keys each commit', async () => {
    await recordMutate(storage, successRunner(encodeInt(5n)), repo, ws, 'counter', 'increment', [encodeInt(5n)], { actor: 'cli:test', idempotencyKey: 'k1' });
    await recordMutate(storage, successRunner(encodeInt(8n)), repo, ws, 'counter', 'increment', [encodeInt(3n)], { actor: 'cli:test', idempotencyKey: 'k2' });
    assert.strictEqual((await recordHistory(storage, repo, ws, 'counter')).length, 3, 'genesis + two distinct commits');
    assert.strictEqual(await workspaceGetDataset(storage, repo, ws, counterPath), 8n);
  });

  it('dedup is best-effort last-commit: a different mutation between two same-key calls is NOT deduped (at-least-once)', async () => {
    await recordMutate(storage, successRunner(encodeInt(5n)), repo, ws, 'counter', 'increment', [encodeInt(5n)], { actor: 'cli:test', idempotencyKey: 'k1' });
    // A different keyed mutation commits, overwriting the idempotency slot.
    await recordMutate(storage, successRunner(encodeInt(6n)), repo, ws, 'counter', 'increment', [encodeInt(1n)], { actor: 'cli:test', idempotencyKey: 'k2' });
    // k1 is no longer the last commit, so the retry re-applies — documented limit.
    let calls = 0;
    const runner = runnerReturning(async () => { calls++; return { kind: 'success', value: encodeInt(11n), stdout: '', stderr: '', stdoutTruncated: false, stderrTruncated: false }; });
    const retry = await recordMutate(storage, runner, repo, ws, 'counter', 'increment', [encodeInt(5n)], { actor: 'cli:test', idempotencyKey: 'k1' });
    assert.strictEqual(retry.kind, 'committed');
    assert.strictEqual(calls, 1, 'last-commit dedup cannot catch a superseded key, so the reducer re-runs');
  });

  // ---- OPS-1: wall-clock budget (issue #69) ----

  it('a spent budget returns conflict before running the reducer', async () => {
    let calls = 0;
    const runner = runnerReturning(async () => { calls++; return { kind: 'success', value: encodeInt(5n), stdout: '', stderr: '', stdoutTruncated: false, stderrTruncated: false }; });
    // budgetMs:0 -> the deadline is already past at the top of the first iteration.
    const outcome = await recordMutate(storage, runner, repo, ws, 'counter', 'increment', [encodeInt(5n)], { actor: 'cli:test', budgetMs: 0 });
    assert.strictEqual(outcome.kind, 'conflict');
    if (outcome.kind === 'conflict') assert.strictEqual(outcome.attempts, 0);
    assert.strictEqual(calls, 0, 'the reducer is not started past the deadline');
  });

  it('the budget bounds a contended retry loop to a typed conflict, not a hang', async () => {
    const genesis = await storage.datasets.read(repo, ws, 'records/counter');
    assert.ok(genesis && genesis.type === 'value');
    const stateHash = genesis.value.hash;

    let calls = 0;
    const runner = runnerReturning(async () => {
      calls++;
      // Always interfere so every writeIf conflicts (would retry to maxRetryMs=30s
      // without a budget); the budget must cut it far sooner.
      await storage.datasets.write(repo, ws, 'records/counter', variant('value', {
        hash: stateHash, versions: new Map([['.records.counter', calls.toString(16).padEnd(64, '0')]]),
      }));
      return { kind: 'success', value: encodeInt(7n), stdout: '', stderr: '', stdoutTruncated: false, stderrTruncated: false };
    });

    const start = Date.now();
    const outcome = await recordMutate(storage, runner, repo, ws, 'counter', 'increment', [encodeInt(7n)], { actor: 'cli:test', budgetMs: 200 });
    const elapsed = Date.now() - start;
    assert.strictEqual(outcome.kind, 'conflict', 'the budget bounded the retry loop');
    assert.ok(calls >= 1, 'at least one attempt ran');
    assert.ok(elapsed < 5000, `returned within the budget (~200ms), not the 30s default: ${elapsed}ms`);
  });

  it('clamps a single reducer run timeout to the remaining budget', async () => {
    let seenTimeout: number | undefined;
    const runner = runnerReturning(async (spec) => {
      seenTimeout = spec.limits?.timeoutMs;
      return { kind: 'success', value: encodeInt(5n), stdout: '', stderr: '', stdoutTruncated: false, stderrTruncated: false };
    });
    // The reducer's requested timeout (50s) far exceeds the budget, so the run
    // the runner sees must be clamped under the remaining budget — otherwise a
    // single run could overrun a caller's gateway.
    await recordMutate(storage, runner, repo, ws, 'counter', 'increment', [encodeInt(5n)], {
      actor: 'cli:test', budgetMs: 200,
      limits: { timeoutMs: 50_000, maxResultBytes: 64 * 1024 * 1024, maxLogBytes: 64 * 1024 },
    });
    assert.ok(seenTimeout !== undefined && seenTimeout <= 200, `run timeout clamped to the budget, got ${seenTimeout}ms`);
    assert.ok(seenTimeout! >= 1, 'the clamp floors at 1ms, never <= 0');
  });

  // ---- OPS-2: abort signal (issue #69) ----

  it('a pre-aborted signal returns failed/aborted without running the reducer', async () => {
    let calls = 0;
    const runner = runnerReturning(async () => { calls++; return { kind: 'success', value: encodeInt(5n), stdout: '', stderr: '', stdoutTruncated: false, stderrTruncated: false }; });
    const ac = new AbortController();
    ac.abort();
    const outcome = await recordMutate(storage, runner, repo, ws, 'counter', 'increment', [encodeInt(5n)], { actor: 'cli:test', signal: ac.signal });
    assert.strictEqual(outcome.kind, 'failed');
    if (outcome.kind === 'failed') assert.strictEqual(outcome.stderr, 'aborted');
    assert.strictEqual(calls, 0, 'the reducer is not started when already aborted');
  });

  it('forwards the abort signal to the runner', async () => {
    let received: AbortSignal | undefined;
    const runner = runnerReturning(async (_spec, options) => {
      received = options?.signal;
      return { kind: 'success', value: encodeInt(5n), stdout: '', stderr: '', stdoutTruncated: false, stderrTruncated: false };
    });
    const ac = new AbortController();
    await recordMutate(storage, runner, repo, ws, 'counter', 'increment', [encodeInt(5n)], { actor: 'cli:test', signal: ac.signal });
    assert.strictEqual(received, ac.signal, 'the runner received the mutation signal');
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

  it('a rejected type-change redeploy leaves the workspace fully intact', async () => {
    await recordMutate(storage, successRunner(encodeInt(3n)), repo, ws, 'counter', 'increment', [encodeInt(3n)], { actor: 'x' });
    const lenBefore = (await recordHistory(storage, repo, ws, 'counter')).length;

    // A new package version where `counter` is a String record instead of Integer.
    const counterStr = e3.record('counter', StringType, '');
    const pkg2 = e3.package('counters', '2.0.0', counterStr);
    const zip2 = join(tempDir, 'counters2.zip');
    await e3.export(pkg2, zip2);
    await packageImport(storage, repo, zip2);
    await assert.rejects(workspaceDeploy(storage, repo, ws, 'counters', '2.0.0'), /changed type/);

    // The rejection fires before any destructive write, so state + history + the
    // Integer typing are all untouched (no torn workspace, no data loss).
    assert.strictEqual(await workspaceGetDataset(storage, repo, ws, counterPath), 3n);
    assert.strictEqual((await recordHistory(storage, repo, ws, 'counter')).length, lenBefore);
  });

  it('redeploy without the record drops it (record removed)', async () => {
    await recordMutate(storage, successRunner(encodeInt(4n)), repo, ws, 'counter', 'increment', [encodeInt(4n)], { actor: 'x' });
    const noRecord = e3.package('counters', '3.0.0', e3.input('greeting', StringType, 'hi'));
    const zip3 = join(tempDir, 'counters-norecord.zip');
    await e3.export(noRecord, zip3);
    await packageImport(storage, repo, zip3);
    await workspaceDeploy(storage, repo, ws, 'counters', '3.0.0');
    await assert.rejects(workspaceGetDataset(storage, repo, ws, counterPath)); // path gone from the structure
  });

  it('a mutation and a compaction are fenced out by an exclusive deploy/remove lock', async () => {
    const held = await storage.locks.acquire(repo, ws, variant('deployment', null)); // default exclusive
    assert.ok(held);
    try {
      await assert.rejects(
        recordMutate(storage, successRunner(encodeInt(5n)), repo, ws, 'counter', 'increment', [encodeInt(5n)], { actor: 'x' }),
        WorkspaceLockError,
      );
      await assert.rejects(recordCompact(storage, repo, ws, 'counter', { actor: 'x' }), WorkspaceLockError);
      assert.strictEqual(await workspaceGetDataset(storage, repo, ws, counterPath), 0n); // untouched while fenced
    } finally {
      await held!.release();
    }
    // Once released, the mutation commits — proving it was the lock, not another failure.
    assert.strictEqual((await recordMutate(storage, successRunner(encodeInt(5n)), repo, ws, 'counter', 'increment', [encodeInt(5n)], { actor: 'x' })).kind, 'committed');
  });

  it('forwards reducer stderr on timed_out and too_large outcomes', async () => {
    const timedOut = await recordMutate(
      storage,
      runnerReturning(async () => ({ kind: 'timed_out', ms: 1234, stderr: 'slow reducer', stdout: '', stdoutTruncated: false, stderrTruncated: false })),
      repo, ws, 'counter', 'increment', [encodeInt(1n)], { actor: 'x' },
    );
    assert.strictEqual(timedOut.kind, 'timed_out');
    assert.strictEqual((timedOut as { stderr: string }).stderr, 'slow reducer');

    const tooLarge = await recordMutate(
      storage,
      runnerReturning(async () => ({ kind: 'too_large', bytes: 999, limit: 100, stderr: 'huge state', stdout: '', stdoutTruncated: false, stderrTruncated: false })),
      repo, ws, 'counter', 'increment', [encodeInt(1n)], { actor: 'x' },
    );
    assert.strictEqual(tooLarge.kind, 'too_large');
    assert.strictEqual((tooLarge as { stderr: string }).stderr, 'huge state');
  });

  it('history pages with a from cursor and ends gracefully on an unknown cursor', async () => {
    for (let i = 0; i < 3; i++) {
      await recordMutate(storage, successRunner(encodeInt(BigInt(i + 1))), repo, ws, 'counter', 'increment', [encodeInt(1n)], { actor: 'x' });
    }
    const all = await recordHistory(storage, repo, ws, 'counter');
    assert.strictEqual(all.length, 4); // $init + 3

    const page1 = await recordHistory(storage, repo, ws, 'counter', { limit: 2 });
    assert.deepStrictEqual(page1.map((e) => e.hash), all.slice(0, 2).map((e) => e.hash));

    const cursor = page1[1]!.commit.parent;
    assert.strictEqual(cursor.type, 'some');
    const page2 = await recordHistory(storage, repo, ws, 'counter', { from: cursor.type === 'some' ? cursor.value : undefined, limit: 10 });
    assert.deepStrictEqual(page2.map((e) => e.hash), all.slice(2).map((e) => e.hash)); // contiguous, no overlap

    // An unknown/garbage cursor terminates the walk rather than throwing.
    assert.deepStrictEqual(await recordHistory(storage, repo, ws, 'counter', { from: 'cafef00d'.padEnd(64, '0') }), []);
  });
});

// Reducer state is a task-input-like decode (issue #539): recordMutate hands
// it to the runner as input-0 of a detached run, and every runner decodes
// its inputs frozen — so a reducer cannot mutate its state in place (copy
// first) and the state can be served lazily for any nested element shape.
// These tests pin that composition end-to-end against the real east-node
// runner; the machinery itself (collapsed shape gate, per-segment frozen
// service, refuse-before-hydrate) is pinned by libs/east test/frozen.spec.ts
// and the east-node runner spec.
describe('frozen reducer state (#539)', () => {
  let repo: string;
  let tempDir: string;
  let storage: StorageBackend;
  const ws = 'main';

  const StateT = DictType(StringType, StructType({ n: IntegerType, xs: ArrayType(IntegerType) }));
  const kvPath: TreePath = [variant('field', 'records'), variant('field', 'kv')];
  const encodeStr = encodeBeast2For(StringType);
  const FROZEN = /cannot mutate a frozen value \(task inputs are immutable\) — copy first/;

  // The real runDetached, spawning the workspace's actual east-node CLI
  // (resolved by the node_modules/.bin walk up from this package).
  const realRunner = {
    runDetached: (spec: Parameters<typeof runDetached>[0], options: Parameters<typeof runDetached>[1]) =>
      runDetached(spec, { ...options, runnerSearchDir: dirname(fileURLToPath(import.meta.url)) }),
  } as unknown as TaskRunner;

  /** Runs `fn` with the given env vars set (undefined = unset), restoring after. */
  async function withEnv<T>(vars: Record<string, string | undefined>, fn: () => Promise<T>): Promise<T> {
    const prev = Object.keys(vars).map((k) => [k, process.env[k]] as const);
    for (const [k, v] of Object.entries(vars)) {
      if (v === undefined) delete process.env[k];
      else process.env[k] = v;
    }
    try {
      return await fn();
    } finally {
      for (const [k, v] of prev) {
        if (v === undefined) delete process.env[k];
        else process.env[k] = v;
      }
    }
  }

  beforeEach(async () => {
    repo = createTestRepo();
    tempDir = createTempDir();
    storage = new LocalStorage(dirname(repo));

    const kv = e3.record('kv', StateT, new Map());
    const seed = e3.mutation('seed', kv, East.function([StateT], StateT, ($, _state) => {
      const out = $.let(new Map(), StateT);
      $.for(East.Array.range(0n, 2500n), ($, i) => {
        $(out.insert(East.str`k-${i}`, { n: i, xs: [] }));
      });
      return out;
    }));
    const touch = e3.mutation('touch', kv, East.function([StateT, StringType], StateT, ($, state, k) => {
      const row = $.let(state.get(k));
      const out = $.let(new Map(), StateT);
      $(out.insert(k, row));
      return out;
    }));
    const bump = e3.mutation('bump', kv, East.function([StateT], StateT, ($, state) => {
      $(state.insert('zzz', { n: 0n, xs: [] }));
      return state;
    }));
    const bumpCopy = e3.mutation('bumpCopy', kv, East.function([StateT], StateT, ($, state) => {
      const next = $.let(state.copy());
      $(next.insert('zzz', { n: 0n, xs: [] }));
      return next;
    }));
    const pkg = e3.package('kvrecords', '1.0.0', kv, seed, touch, bump, bumpCopy);
    const zip = join(tempDir, 'kvrecords.zip');
    await e3.export(pkg, zip);
    await packageImport(storage, repo, zip);
    await workspaceCreate(storage, repo, ws);
    await workspaceDeploy(storage, repo, ws, 'kvrecords', '1.0.0');
  });

  afterEach(() => {
    removeTestRepo(repo);
    removeTempDir(tempDir);
  });

  it('reducer state is frozen: in-place mutation reports the uniform error, copy-first commits', async () => {
    const inPlace = await recordMutate(storage, realRunner, repo, ws, 'kv', 'bump', [], { actor: 'cli:test' });
    assert.strictEqual(inPlace.kind, 'failed');
    assert.match((inPlace as { stderr: string }).stderr, FROZEN);
    assert.strictEqual((await recordHistory(storage, repo, ws, 'kv')).length, 1, 'nothing committed');

    const copied = await recordMutate(storage, realRunner, repo, ws, 'kv', 'bumpCopy', [], { actor: 'cli:test' });
    assert.strictEqual(copied.kind, 'committed', `copy-first reducer commits: ${JSON.stringify(copied)}`);
    const after = await workspaceGetDataset(storage, repo, ws, kvPath) as ValueTypeOf<typeof StateT>;
    assert.strictEqual(after.size, 1);
    assert.ok(after.has('zzz'));
  });

  it('a keyed-touch reducer over lazily-served frozen state commits (addendum fixture)', async () => {
    // Seed a 2500-row state through the real runner: collection outputs are
    // written segmented + indexed, so the committed state object is pageable.
    const seeded = await recordMutate(storage, realRunner, repo, ws, 'kv', 'seed', [], { actor: 'cli:test' });
    assert.strictEqual(seeded.kind, 'committed', `seed committed: ${JSON.stringify(seeded)}`);
    const ref = await storage.datasets.read(repo, ws, 'records/kv');
    assert.ok(ref && ref.type === 'value');
    const pages = openBeast2PagesFor(StateT)(await storage.objects.read(repo, ref.value.hash));
    assert.ok(pages.segmentCount >= 2, `state is multi-segment (${pages.segmentCount})`);
    assert.strictEqual(pages.elementCount, 2500);

    // The nested-container element shape is exactly what the frozen gate
    // admits (unfrozen it would force a whole decode) — so with a 1-byte
    // threshold the reducer's state is pager-served, and its keyed touch
    // pays O(touched), not a whole decode.
    const outcome = await withEnv({ EAST_LAZY_INPUT_BYTES: '1' }, () =>
      recordMutate(storage, realRunner, repo, ws, 'kv', 'touch', [encodeStr('k-0')], { actor: 'cli:test' }));
    assert.strictEqual(outcome.kind, 'committed', `touch committed: ${JSON.stringify(outcome)}`);

    const after = await workspaceGetDataset(storage, repo, ws, kvPath) as ValueTypeOf<typeof StateT>;
    assert.strictEqual(after.size, 1, 'the touched row is the whole new state');
    assert.strictEqual(after.get('k-0')!.n, 0n);
  });
});
