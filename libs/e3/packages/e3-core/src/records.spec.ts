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
import { execFileSync } from 'node:child_process';
import assert from 'node:assert';
import { join, dirname } from 'node:path';
import { East, IntegerType, NullType, PatchType, SortedMap, StringType, compareFor, encodeBeast2For, decodeBeast2For, toEastTypeValue, ArrayType, BlobType, DictType, StructType, variant, type PatchTypeOf, type ValueTypeOf } from '@elaraai/east';
import e3 from '@elaraai/e3';
import { RecordIndexObjectType } from '@elaraai/e3-types';
import type { Structure, TreePath } from '@elaraai/e3-types';
import { DatasetSegments, readDatasetWhole } from './dataset-open.js';
import { recordMutate, recordHistory, recordCompact, recordDescribe, recordIndexNames, recordReindex, readRecordState, resolveRecordIndex } from './records.js';
import { repoGc } from './storage/local/gc.js';
import { snapshotInputVersions } from './dataset-refs.js';
import { WorkspaceLockError } from './errors.js';
import { workspaceGetDataset, workspaceSetDataset } from './trees.js';
import { packageImport } from './packages.js';
import { workspaceCreate, workspaceDeploy, workspaceExport } from './workspaces.js';
import { createTestRepo, removeTestRepo, createTempDir, removeTempDir } from './test-helpers.js';
import { LocalStorage } from './storage/local/index.js';
import { LocalTaskRunner } from './execution/LocalTaskRunner.js';
import type { MutationOutcome, StorageBackend, TaskRunner, DetachedResult } from './index.js';

/** Whether a runtime's CLI answers on PATH — the multi-runtime suites skip
 *  rather than fail on a developer machine without it. */
function onPath(command: string, args: string[]): boolean {
  try {
    execFileSync(command, args, { stdio: 'ignore', shell: process.platform === 'win32' });
    return true;
  } catch {
    return false;
  }
}

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
    const noRecord = e3.package('counters', '3.0.0', e3.input('greeting', StringType, variant('value', 'hi')));
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

  it('carries a reserved $ slot through a mutation and a compaction', async () => {
    // A `$` slot is bookkeeping whose owner is whichever writer set it — the
    // applied-schema frontier, say. Every commit path builds its version vector
    // fresh, so a path that forgets to carry one erases it, and the writer that
    // set it reads the record afterwards as one that never had it.
    const ref = await storage.datasets.read(repo, ws, 'records/counter');
    assert.ok(ref && ref.type === 'value');
    const versions = new Map(ref.value.versions);
    versions.set('$schema', 'frontier-hash');
    await storage.datasets.write(repo, ws, 'records/counter',
      variant('value', { hash: ref.value.hash, versions }));

    const mutated = await recordMutate(storage, successRunner(encodeInt(3n)), repo, ws, 'counter', 'increment',
      [encodeInt(3n)], { actor: 'cli:test', idempotencyKey: 'k1' });
    assert.strictEqual(mutated.kind, 'committed');
    const afterMutate = await storage.datasets.read(repo, ws, 'records/counter');
    assert.ok(afterMutate && afterMutate.type === 'value');
    assert.strictEqual(afterMutate.value.versions.get('$schema'), 'frontier-hash');
    assert.strictEqual(afterMutate.value.versions.get('$idem'), 'k1', 'the writer that owns $idem still writes it');

    const compacted = await recordCompact(storage, repo, ws, 'counter', { actor: 'cli:test' });
    assert.strictEqual(compacted.kind, 'committed');
    const afterCompact = await storage.datasets.read(repo, ws, 'records/counter');
    assert.ok(afterCompact && afterCompact.type === 'value');
    assert.strictEqual(afterCompact.value.versions.get('$schema'), 'frontier-hash');
    assert.strictEqual(afterCompact.value.versions.get('$idem'), undefined,
      'a compaction is not an idempotency-keyed write, so it drops the key it does not own');
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

  // The real runner, spawning the workspace's actual east-node CLI (resolved
  // by the node_modules/.bin walk up from this package). A record operation's
  // units are ordinary task executions, so what runs them has to be a real
  // TaskRunner rather than a `runDetached` stub.
  let realRunner: TaskRunner;

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
    realRunner = new LocalTaskRunner(repo);

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
    assert.strictEqual(inPlace.kind, 'failed', JSON.stringify(inPlace));
    assert.match((inPlace as { stderr: string }).stderr, FROZEN,
      `frozen refusal reaches the caller's stderr: ${JSON.stringify(inPlace)}`);
    assert.strictEqual((await recordHistory(storage, repo, ws, 'kv')).length, 1, 'nothing committed');

    const copied = await recordMutate(storage, realRunner, repo, ws, 'kv', 'bumpCopy', [], { actor: 'cli:test' });
    assert.strictEqual(copied.kind, 'committed', `copy-first reducer commits: ${JSON.stringify(copied)}`);
    const after = await workspaceGetDataset(storage, repo, ws, kvPath) as ValueTypeOf<typeof StateT>;
    assert.strictEqual(after.size, 1);
    assert.ok(after.has('zzz'));
  });

  it('a keyed-touch reducer over lazily-served frozen state commits (addendum fixture)', async () => {
    // Seed a 2500-row state through the real runner: a collection state goes
    // into the store as segment objects under a manifest, so it is pageable
    // and a later one-row commit shares every segment it did not touch.
    const seeded = await recordMutate(storage, realRunner, repo, ws, 'kv', 'seed', [], { actor: 'cli:test' });
    assert.strictEqual(seeded.kind, 'committed', `seed committed: ${JSON.stringify(seeded)}`);
    const ref = await storage.datasets.read(repo, ws, 'records/kv');
    assert.ok(ref && ref.type === 'value');
    const segments = await DatasetSegments.open(storage, repo, ref.value.hash);
    assert.ok(segments.segmentCount >= 2, `state is multi-segment (${segments.segmentCount})`);
    assert.strictEqual(segments.elementCount, 2500);

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

const PlanRowType = StructType({ status: StringType, due: IntegerType, title: StringType });
/** What one touched key of a plans patch carries — derived from the patch type
 *  rather than hand-written, so it follows the row type. */
type PlanOp = Extract<ValueTypeOf<PatchTypeOf<typeof PlansType>>, { type: 'patch' }>['value'] extends Map<string, infer Op>
  ? Op : never;
const PlansType = DictType(StringType, PlanRowType);
const StatusKeyType = StructType({ status: StringType, due: IntegerType });

/**
 * Secondary indexes end to end, on the real runner.
 *
 * An index is a second canonical collection maintained inside the same commit
 * as the primary, so what is asserted here is that one commit moves both and
 * that the maintained index is the one a rebuild writes — which is what makes
 * a page through an index trustworthy at all.
 */
describe('record indexes', () => {
  let repo: string;
  let tempDir: string;
  let storage: StorageBackend;
  const ws = 'main';

  // A real TaskRunner: a record operation's units are ordinary task
  // executions, not `runDetached` calls.
  let realRunner: TaskRunner;

  beforeEach(async () => {
    repo = createTestRepo();
    tempDir = createTempDir();
    storage = new LocalStorage(dirname(repo));
    realRunner = new LocalTaskRunner(repo);

    const plans = e3.record('plans', PlansType, new Map());
    const seed = e3.mutation('seed', plans, East.function([PlansType], PlansType, ($, _state) => {
      const out = $.let(new Map(), PlansType);
      $.for(East.Array.range(0n, 600n), ($, i) => {
        const status = $.let('ok');
        $.if(East.equal(i.remainder(3n), 0n), ($) => {
          $.assign(status, 'late');
        });
        $(out.insert(East.str`p-${i}`, { status, due: i, title: East.str`Plan ${i}` }));
      });
      return out;
    }));
    const seedMany = e3.mutation('seed_many', plans, East.function([PlansType, IntegerType], PlansType, ($, _state, rows) => {
      const out = $.let(new Map(), PlansType);
      $.for(East.Array.range(0n, rows), ($, i) => {
        const status = $.let('ok');
        $.if(East.equal(i.remainder(3n), 0n), ($) => {
          $.assign(status, 'late');
        });
        $(out.insert(East.str`p-${i}`, { status, due: i, title: East.str`Plan ${i}` }));
      });
      return out;
    }));
    const retitle = e3.mutation('retitle', plans, East.function([PlansType, StringType], PlansType, ($, state, k) => {
      const next = $.let(state.copy());
      const row = $.let(state.get(k));
      $(next.insert(k, { status: row.status, due: row.due, title: 'RETITLED' }));
      return next;
    }));
    const byStatus = e3.recordIndex('by_status', plans, {
      key: East.function([StringType, PlanRowType], StatusKeyType, ($, _k, v) => ({ status: v.status, due: v.due })),
      value: East.function([StringType, PlanRowType], StringType, ($, _k, v) => v.title),
    });

    const pkg = e3.package('planrecords', '1.0.0', plans, seed, seedMany, retitle, byStatus);
    const zip = join(tempDir, 'planrecords.zip');
    await e3.export(pkg, zip);
    await packageImport(storage, repo, zip);
    await workspaceCreate(storage, repo, ws);
    await workspaceDeploy(storage, repo, ws, 'planrecords', '1.0.0', { runner: realRunner });
  });

  afterEach(() => {
    removeTestRepo(repo);
    removeTempDir(tempDir);
  });

  /** How many task executions the repository has recorded, over every task —
   *  the units of a record operation included. */
  async function countExecutions(): Promise<number> {
    let total = 0;
    for (const { taskHash, inputsHash } of await storage.refs.executionList(repo)) {
      total += (await storage.refs.executionListIds(repo, taskHash, inputsHash)).length;
    }
    return total;
  }

  /** The record's state refs. */
  async function state(): Promise<{ primary: string; indexes: Map<string, { manifest: string; index: string }> }> {
    const ref = await storage.datasets.read(repo, ws, 'records/plans');
    assert.ok(ref && ref.type === 'value');
    return readRecordState(storage, repo, ref.value.hash);
  }

  it('deploy builds a declared index, and the state names it beside the primary', async () => {
    const built = await state();
    assert.deepStrictEqual([...built.indexes.keys()], ['by_status']);
    // An empty record: the index is empty too, and both are real manifests.
    const index = await DatasetSegments.open(storage, repo, built.indexes.get('by_status')!.manifest);
    assert.strictEqual(index.elementCount, 0);

    const history = await recordHistory(storage, repo, ws, 'plans');
    assert.deepStrictEqual(history.map((e) => e.commit.mutation), ['$reindex', '$init']);
  });

  it('a commit moves the primary and the index together', async () => {
    const seeded = await recordMutate(storage, realRunner, repo, ws, 'plans', 'seed', [], { actor: 'cli:test' });
    assert.strictEqual(seeded.kind, 'committed', JSON.stringify(seeded));

    const after = await state();
    const index = await DatasetSegments.open(storage, repo, after.indexes.get('by_status')!.manifest);
    const primary = await DatasetSegments.open(storage, repo, after.primary);
    assert.strictEqual(primary.elementCount, 600, 'the primary holds every row');
    assert.strictEqual(index.elementCount, 600, 'the index holds one entry per row');

    // The index is sorted by the index key first: every `late` row precedes
    // every `ok` one, whatever their primary keys.
    // The index collection's key is `{ik, k}` — the index key first, so every
    // entry sharing one is a contiguous run ordered by primary key inside it.
    const collection = DictType(StructType({ ik: StatusKeyType, k: StringType }), StringType);
    const whole = decodeBeast2For(collection)(await readDatasetWhole(storage, repo, after.indexes.get('by_status')!.manifest)) as Map<{ ik: { status: string; due: bigint }; k: string }, string>;
    const statuses = [...whole.keys()].map((entry) => entry.ik.status);
    assert.strictEqual(statuses.indexOf('ok'), statuses.lastIndexOf('late') + 1, 'one contiguous run per status');
    assert.strictEqual(whole.size, 600);
  });

  it('a maintained index equals the one a reindex rebuilds, hash for hash', async () => {
    await recordMutate(storage, realRunner, repo, ws, 'plans', 'seed', [], { actor: 'cli:test' });
    await recordMutate(storage, realRunner, repo, ws, 'plans', 'retitle', [encodeBeast2For(StringType)('p-7')], { actor: 'cli:test' });
    const maintained = await state();

    const rebuilt = await recordReindex(storage, realRunner, repo, ws, 'plans', { actor: 'cli:test' });
    assert.strictEqual(rebuilt.kind, 'committed', JSON.stringify(rebuilt));
    const after = await state();

    assert.strictEqual(after.primary, maintained.primary, 'a reindex never touches the primary');
    assert.strictEqual(
      after.indexes.get('by_status')!.manifest,
      maintained.indexes.get('by_status')!.manifest,
      'maintained ≡ rebuilt — the same value gives the same segments',
    );
  });

  it('a fanned-out build writes what the one-unit build writes, hash for hash', async () => {
    // Big enough to span segments, which is what `plan` cuts into slices.
    assert.strictEqual((await recordMutate(storage, realRunner, repo, ws, 'plans', 'seed_many',
      [encodeBeast2For(IntegerType)(5_000n)], { actor: 'cli:test' })).kind, 'committed');
    const primary = await DatasetSegments.open(storage, repo, (await state()).primary);
    assert.ok(primary.segmentCount > 1, `a 5,000-row record should span segments, not ${primary.segmentCount}`);
    const built = (await state()).indexes.get('by_status')!.manifest;

    // A byte target small enough to cut the record into several slices: each
    // emits its own partial in INDEX order, and the merge tree sorts them
    // back together. The value is the same value, so its segments are the
    // same objects — segmentation is a function of the value, not of how many
    // processes produced it.
    const before = await countExecutions();
    const rebuilt = await recordReindex(storage, realRunner, repo, ws, 'plans',
      { actor: 'cli:test', sliceBytes: 32 * 1024 });
    assert.strictEqual(rebuilt.kind, 'committed', JSON.stringify(rebuilt));
    assert.ok(await countExecutions() >= before + 2, 'the build really did fan out');
    assert.strictEqual((await state()).indexes.get('by_status')!.manifest, built,
      'the fan-out and the single unit agree to the byte');
  });

  it('a rebuild over an unchanged record re-runs no unit', async () => {
    await recordMutate(storage, realRunner, repo, ws, 'plans', 'seed_many',
      [encodeBeast2For(IntegerType)(5_000n)], { actor: 'cli:test' });
    const first = await recordReindex(storage, realRunner, repo, ws, 'plans',
      { actor: 'cli:test', sliceBytes: 32 * 1024 });
    assert.strictEqual(first.kind, 'committed', JSON.stringify(first));
    const after = await countExecutions();
    assert.ok(after > 0, 'the build ran units');

    // Every unit is an ordinary content-addressed execution, so the second
    // build finds all of them in the cache and records no new one.
    const second = await recordReindex(storage, realRunner, repo, ws, 'plans',
      { actor: 'cli:test', sliceBytes: 32 * 1024 });
    assert.strictEqual(second.kind, 'committed', JSON.stringify(second));
    assert.strictEqual(await countExecutions(), after, 'the rebuild re-ran nothing');
  });

  it('a deploy says what it is about to do to each index — build, drop or keep', async () => {
    await recordMutate(storage, realRunner, repo, ws, 'plans', 'seed', [], { actor: 'cli:test' });

    // Redeploying the same package: the state already names the index built
    // under this declaration, so nothing runs.
    const kept: string[] = [];
    await workspaceDeploy(storage, repo, ws, 'planrecords', '1.0.0',
      { runner: realRunner, onRecordIndex: (plan) => kept.push(`${plan.index}:${plan.action}`) });
    assert.deepStrictEqual(kept, ['by_status:keep']);

    // A package that drops the index and declares another: one `drop`, one
    // `build`, and afterwards the state names only the new one.
    const plans = e3.record('plans', PlansType, new Map());
    const byDue = e3.recordIndex('by_due', plans, {
      key: East.function([StringType, PlanRowType], IntegerType, ($, _k, v) => v.due),
    });
    const zip = join(tempDir, 'planrecords-2.zip');
    await e3.export(e3.package('planrecords', '2.0.0', plans, byDue), zip);
    await packageImport(storage, repo, zip);

    const moved: string[] = [];
    await workspaceDeploy(storage, repo, ws, 'planrecords', '2.0.0',
      { runner: realRunner, onRecordIndex: (plan) => moved.push(`${plan.index}:${plan.action}`) });
    assert.deepStrictEqual(moved.sort(), ['by_due:build', 'by_status:drop']);
    assert.deepStrictEqual([...(await state()).indexes.keys()], ['by_due']);
  });

  it('resolves the index for reading, with the window and collection types', async () => {
    await recordMutate(storage, realRunner, repo, ws, 'plans', 'seed', [], { actor: 'cli:test' });
    const ref = await storage.datasets.read(repo, ws, 'records/plans');
    assert.ok(ref && ref.type === 'value');

    const resolved = await resolveRecordIndex(storage, repo, ws, 'records/plans', ref.value.hash, 'by_status');
    assert.ok(resolved !== null);
    assert.strictEqual(resolved.collectionType.type, 'Dict');
    assert.strictEqual(resolved.windowType.type, 'Array');
    assert.strictEqual(await resolveRecordIndex(storage, repo, ws, 'records/plans', ref.value.hash, 'nope'), null);
    assert.deepStrictEqual(await recordIndexNames(storage, repo, ref.value.hash), ['by_status']);
  });

  it('keeps every object an index names reachable through gc', async () => {
    await recordMutate(storage, realRunner, repo, ws, 'plans', 'seed', [], { actor: 'cli:test' });
    const after = await state();
    const entry = after.indexes.get('by_status')!;

    // The first sweep takes the operation's scratch — the synthesized unit
    // tasks and their command IRs, unrooted like an ad-hoc run's carved
    // slices. The SECOND must take nothing: what is left is the record's own
    // closure, and a sweep that keeps shrinking it is one eating the record.
    await repoGc(storage, repo, { minAge: 0 });
    const result = await repoGc(storage, repo, { minAge: 0 });
    assert.strictEqual(result.deletedObjects, 0, 'nothing the record names is collected');
    // The index's manifest, its segments, and the declaration it was built
    // under — a state read at an older commit names all three.
    await storage.objects.read(repo, entry.manifest);
    await storage.objects.read(repo, entry.index);
    const index = await DatasetSegments.open(storage, repo, entry.manifest);
    for (const segment of index.manifest!.entries) await storage.objects.read(repo, segment.hash);
    // ...and the IR bundles the declaration names, which nothing else in the
    // store reaches. A rebuild runs those programs, so an index whose bundles
    // are gone is one that can never be rebuilt again.
    const declared = decodeBeast2For(RecordIndexObjectType)(await storage.objects.read(repo, entry.index));
    for (const ir of [declared.keyIr, declared.buildIr, declared.mergeIr]) await storage.objects.read(repo, ir);
    if (declared.valueIr.type === 'some') await storage.objects.read(repo, declared.valueIr.value);
  });

  it('an export carries the primary, every index, and what each was built from', async () => {
    // A record's ref names a `$record` state, and the manifests hang off
    // that: an export that walked only the ref's own object would import a
    // record whose primary is a hash nothing in the bundle defines and whose
    // indexes are not there at all.
    await recordMutate(storage, realRunner, repo, ws, 'plans', 'seed', [], { actor: 'cli:test' });
    const exported = await state();
    const zip = join(tempDir, 'planrecords-export.zip');
    await workspaceExport(storage, repo, ws, zip);

    const freshRepo = createTestRepo();
    const freshStorage = new LocalStorage(dirname(freshRepo));
    try {
      await packageImport(freshStorage, freshRepo, zip);
      for (const manifest of [exported.primary, ...[...exported.indexes.values()].map((i) => i.manifest)]) {
        const opened = await DatasetSegments.open(freshStorage, freshRepo, manifest);
        await opened.head();
        for (let i = 0; i < opened.segmentCount; i++) await opened.segment(i);
      }
      // ...and the declaration each index was built under, with the programs
      // it names: a deploy of the imported package compares that declaration
      // against its own to decide whether the index needs rebuilding.
      for (const entry of exported.indexes.values()) {
        const declared = decodeBeast2For(RecordIndexObjectType)(await freshStorage.objects.read(freshRepo, entry.index));
        for (const ir of [declared.keyIr, declared.buildIr, declared.mergeIr]) await freshStorage.objects.read(freshRepo, ir);
      }
    } finally {
      removeTestRepo(freshRepo);
    }
  });

  it('an exported record redeploys, mutates and reads through its index', async () => {
    // The end of the same road: an imported bundle must carry enough to DEPLOY
    // — the record object, every mutation's program, every index declaration —
    // not just enough to read the bytes back.
    await recordMutate(storage, realRunner, repo, ws, 'plans', 'seed', [], { actor: 'cli:test' });
    const zip = join(tempDir, 'planrecords-roundtrip.zip');
    const { name, version } = await workspaceExport(storage, repo, ws, zip);

    const freshRepo = createTestRepo();
    const freshStorage = new LocalStorage(dirname(freshRepo));
    try {
      await packageImport(freshStorage, freshRepo, zip);
      await workspaceCreate(freshStorage, freshRepo, ws);
      await workspaceDeploy(freshStorage, freshRepo, ws, name, version, { runner: new LocalTaskRunner(freshRepo) });

      const ref = await freshStorage.datasets.read(freshRepo, ws, 'records/plans');
      assert.ok(ref && ref.type === 'value');
      const imported = await readRecordState(freshStorage, freshRepo, ref.value.hash);
      const index = await DatasetSegments.open(freshStorage, freshRepo, imported.indexes.get('by_status')!.manifest);
      assert.strictEqual(index.elementCount, 600, 'the imported record reads through its index');
      assert.ok(await resolveRecordIndex(freshStorage, freshRepo, ws, 'records/plans', ref.value.hash, 'by_status'));
    } finally {
      removeTestRepo(freshRepo);
    }
  });

  it('rebuilds an index after a sweep', async () => {
    // The sweep read from the other end: what survives it has to be enough to
    // run a rebuild, which is the one thing every index of every vintage must
    // stay able to do.
    await recordMutate(storage, realRunner, repo, ws, 'plans', 'seed', [], { actor: 'cli:test' });
    const built = (await state()).indexes.get('by_status')!.manifest;
    await repoGc(storage, repo, { minAge: 0 });

    const rebuilt = await recordReindex(storage, realRunner, repo, ws, 'plans', { actor: 'cli:test' });
    assert.strictEqual(rebuilt.kind, 'committed', JSON.stringify(rebuilt));
    assert.strictEqual((await state()).indexes.get('by_status')!.manifest, built,
      'the rebuild after a sweep writes the index the sweep kept');
  });
});

describe('the mutation delta', () => {
  let repo: string;
  let tempDir: string;
  let storage: StorageBackend;
  const ws = 'main';
  const plain = 'plain';
  const ROWS = 600;

  // A real TaskRunner: a record operation's units are ordinary task
  // executions, not `runDetached` calls.
  let realRunner: TaskRunner;
  /** A runner that must never be reached — the fast path runs no process. */
  const noRunner = {
    runDetached: () => { throw new Error('a process was started'); },
  } as unknown as TaskRunner;

  const encodePlansPatch = encodeBeast2For(PatchType(PlansType));
  const planKeys = compareFor(StringType);

  /** The seed mutation's rows, as this process sees them. */
  function seeded(): Map<string, { status: string; due: bigint; title: string }> {
    const rows = new Map<string, { status: string; due: bigint; title: string }>();
    for (let i = 0; i < ROWS; i++) {
      rows.set(`p-${i}`, { status: i % 3 === 0 ? 'late' : 'ok', due: BigInt(i), title: `Plan ${i}` });
    }
    return rows;
  }

  /** A record with `seed`, an `edit` retitle and a `patch` door, indexed when asked. */
  function planPackage(name: string, indexed: boolean): ReturnType<typeof e3.package> {
    const plans = e3.record('plans', PlansType, new Map());
    const seed = e3.mutation('seed', plans, East.function([PlansType], PlansType, ($, _state) => {
      const out = $.let(new Map(), PlansType);
      $.for(East.Array.range(0n, BigInt(ROWS)), ($, i) => {
        const status = $.let('ok');
        $.if(East.equal(i.remainder(3n), 0n), ($) => {
          $.assign(status, 'late');
        });
        $(out.insert(East.str`p-${i}`, { status, due: i, title: East.str`Plan ${i}` }));
      });
      return out;
    }));
    const retitle = e3.editMutation('retitle', plans,
      East.function([PlansType, StringType, e3.editTypeOf(PlansType) as never], NullType,
        (($: any, state: any, key: any, edit: any) => {
          const row = $.let(state.get(key));
          $(edit.set(key, { status: row.status, due: row.due, title: 'RETITLED' }));
        }) as never) as never);
    const items = [plans, seed, retitle, e3.patchMutation(plans)];
    if (indexed) {
      items.push(e3.recordIndex('by_status', plans, {
        key: East.function([StringType, PlanRowType], StatusKeyType, ($, _k, v) => ({ status: v.status, due: v.due })),
        value: East.function([StringType, PlanRowType], StringType, ($, _k, v) => v.title),
      }) as never);
    }
    return e3.package(name, '1.0.0', ...(items as never[]));
  }

  beforeEach(async () => {
    repo = createTestRepo();
    tempDir = createTempDir();
    storage = new LocalStorage(dirname(repo));
    realRunner = new LocalTaskRunner(repo);

    for (const [name, workspace, indexed] of [['planrecords', ws, true], ['plainrecords', plain, false]] as const) {
      const zip = join(tempDir, `${name}.zip`);
      await e3.export(planPackage(name, indexed), zip);
      await packageImport(storage, repo, zip);
      await workspaceCreate(storage, repo, workspace);
      await workspaceDeploy(storage, repo, workspace, name, '1.0.0', { runner: realRunner });
    }
  });

  afterEach(() => {
    removeTestRepo(repo);
    removeTempDir(tempDir);
  });

  async function state(workspace: string): Promise<{ primary: string; indexes: Map<string, { manifest: string; index: string }> }> {
    const ref = await storage.datasets.read(repo, workspace, 'records/plans');
    assert.ok(ref && ref.type === 'value');
    return readRecordState(storage, repo, ref.value.hash);
  }

  it('an edit mutation commits, and the commit names the delta it applied', async () => {
    assert.strictEqual((await recordMutate(storage, realRunner, repo, ws, 'plans', 'seed', [], { actor: 'cli:test' })).kind, 'committed');
    const before = await state(ws);

    const outcome = await recordMutate(storage, realRunner, repo, ws, 'plans', 'retitle',
      [encodeBeast2For(StringType)('p-7')], { actor: 'cli:test' });
    assert.strictEqual(outcome.kind, 'committed', JSON.stringify(outcome));

    const after = await state(ws);
    assert.notStrictEqual(after.primary, before.primary);
    const rows = decodeBeast2For(PlansType)(await readDatasetWhole(storage, repo, after.primary)) as Map<string, { title: string }>;
    assert.strictEqual(rows.get('p-7')!.title, 'RETITLED');
    assert.strictEqual(rows.size, ROWS);

    const [head] = await recordHistory(storage, repo, ws, 'plans', { limit: 1 });
    assert.strictEqual(head!.commit.delta.type, 'some', 'the commit records what changed');
  });

  it('an edit mutation maintains every index: maintained ≡ rebuilt, hash for hash', async () => {
    await recordMutate(storage, realRunner, repo, ws, 'plans', 'seed', [], { actor: 'cli:test' });
    for (const key of ['p-7', 'p-100', 'p-599']) {
      const outcome = await recordMutate(storage, realRunner, repo, ws, 'plans', 'retitle',
        [encodeBeast2For(StringType)(key)], { actor: 'cli:test' });
      assert.strictEqual(outcome.kind, 'committed', JSON.stringify(outcome));
    }
    const maintained = await state(ws);

    assert.strictEqual((await recordReindex(storage, realRunner, repo, ws, 'plans', { actor: 'cli:test' })).kind, 'committed');
    const rebuilt = await state(ws);
    assert.strictEqual(rebuilt.primary, maintained.primary, 'a reindex never touches the primary');
    assert.strictEqual(rebuilt.indexes.get('by_status')!.manifest, maintained.indexes.get('by_status')!.manifest);
  });

  it('a patch on a record with no index commits with no process at all', async () => {
    assert.strictEqual((await recordMutate(storage, realRunner, repo, plain, 'plans', 'seed', [], { actor: 'cli:test' })).kind, 'committed');
    const before = await state(plain);

    const ops = new SortedMap<string, PlanOp>([
      ['p-7', variant('update', variant('patch', {
        status: variant('unchanged', null),
        due: variant('unchanged', null),
        title: variant('replace', { before: 'Plan 7', after: 'PATCHED' }),
      }))],
      ['p-zzz', variant('insert', { status: 'ok', due: 9_999n, title: 'New' })],
    ], planKeys);
    const outcome = await recordMutate(storage, noRunner, repo, plain, 'plans', 'patch',
      [encodePlansPatch(variant('patch', ops))], { actor: 'cli:test' });
    assert.strictEqual(outcome.kind, 'committed', JSON.stringify(outcome));

    const after = await state(plain);
    const rows = decodeBeast2For(PlansType)(await readDatasetWhole(storage, repo, after.primary)) as Map<string, { title: string }>;
    assert.strictEqual(rows.get('p-7')!.title, 'PATCHED');
    assert.strictEqual(rows.size, ROWS + 1);

    // The whole point: the new state IS the old one bar the segments the two
    // touched keys fell in.
    const was = await DatasetSegments.open(storage, repo, before.primary);
    const now = await DatasetSegments.open(storage, repo, after.primary);
    const moved = now.manifest!.entries.filter((e) => !was.manifest!.entries.some((o) => o.hash === e.hash));
    assert.ok(moved.length <= 2, `a two-key patch rewrote ${moved.length} segments`);
  });

  it('a patch on an indexed record runs the program and moves the index with it', async () => {
    await recordMutate(storage, realRunner, repo, ws, 'plans', 'seed', [], { actor: 'cli:test' });
    const ops = new SortedMap<string, PlanOp>([
      ['p-7', variant('delete', seeded().get('p-7')!)],
    ], planKeys);
    const outcome = await recordMutate(storage, realRunner, repo, ws, 'plans', 'patch',
      [encodePlansPatch(variant('patch', ops))], { actor: 'cli:test' });
    assert.strictEqual(outcome.kind, 'committed', JSON.stringify(outcome));

    const after = await state(ws);
    const primary = await DatasetSegments.open(storage, repo, after.primary);
    const index = await DatasetSegments.open(storage, repo, after.indexes.get('by_status')!.manifest);
    assert.strictEqual(primary.elementCount, ROWS - 1);
    assert.strictEqual(index.elementCount, ROWS - 1, 'the index lost the entry with the row');
  });

  it('a stale patch is a conflict naming the key, and writes nothing', async () => {
    await recordMutate(storage, realRunner, repo, plain, 'plans', 'seed', [], { actor: 'cli:test' });
    const before = await storage.datasets.read(repo, plain, 'records/plans');

    const ops = new SortedMap<string, PlanOp>([
      ['p-7', variant('delete', { status: 'ok', due: 7n, title: 'SOMETHING ELSE' })],
    ], planKeys);
    const outcome = await recordMutate(storage, noRunner, repo, plain, 'plans', 'patch',
      [encodePlansPatch(variant('patch', ops))], { actor: 'cli:test' });
    assert.strictEqual(outcome.kind, 'conflict', JSON.stringify(outcome));
    assert.match((outcome as { detail?: string }).detail ?? '', /p-7/);
    assert.deepStrictEqual(await storage.datasets.read(repo, plain, 'records/plans'), before);
  });

  it('two patches on different keys both commit — the loser re-applies against fresher state', async () => {
    // The compare-and-swap loop is what makes a delta safe to retry: the
    // second writer's ops are re-applied to the state the first committed,
    // not to the one it read. Two keys, two commits, both changes present.
    assert.strictEqual((await recordMutate(storage, realRunner, repo, plain, 'plans', 'seed', [], { actor: 'cli:test' })).kind, 'committed');
    const rows = seeded();
    const retitle = (key: string, title: string): Promise<MutationOutcome> => recordMutate(
      storage, noRunner, repo, plain, 'plans', 'patch',
      [encodePlansPatch(variant('patch', new SortedMap<string, PlanOp>([
        [key, variant('update', variant('patch', {
          status: variant('unchanged', null),
          due: variant('unchanged', null),
          title: variant('replace', { before: rows.get(key)!.title, after: title }),
        }))],
      ], planKeys)))],
      { actor: 'cli:test' });

    const outcomes = await Promise.all([retitle('p-1', 'FIRST'), retitle('p-2', 'SECOND')]);
    assert.deepStrictEqual(outcomes.map((o) => o.kind), ['committed', 'committed'],
      JSON.stringify(outcomes));

    const after = await state(plain);
    const held = decodeBeast2For(PlansType)(await readDatasetWhole(storage, repo, after.primary)) as Map<string, { title: string }>;
    assert.strictEqual(held.get('p-1')!.title, 'FIRST');
    assert.strictEqual(held.get('p-2')!.title, 'SECOND', 'neither write was lost');
    assert.strictEqual((await recordHistory(storage, repo, plain, 'plans')).length, 4,
      'one unbroken chain: $init, seed, and a commit per patch — no fork');
  });

  it('an indexed record reads back through the ordinary dataset door', async () => {
    // A record that declares an index stores a `$record` state naming the
    // primary and every index. Every read door must still answer with the
    // ROWS — otherwise declaring an index silently changes what `e3 get`, a
    // page and a task input see.
    const plansPath: TreePath = [variant('field', 'records'), variant('field', 'plans')];
    for (const workspace of [ws, plain]) {
      assert.strictEqual((await recordMutate(storage, realRunner, repo, workspace, 'plans', 'seed', [], { actor: 'cli:test' })).kind, 'committed');
      const rows = await workspaceGetDataset(storage, repo, workspace, plansPath) as Map<string, { title: string }>;
      assert.strictEqual(rows.size, ROWS, `the ${workspace} record reads as its rows`);
      assert.strictEqual(rows.get('p-7')!.title, 'Plan 7');
    }
    const indexed = await state(ws);
    assert.ok(indexed.indexes.has('by_status'), 'the indexed workspace really does hold an index');
  });

  it('describes each mutation\'s write form, so a caller knows what its arguments mean', async () => {
    const signature = await recordDescribe(storage, repo, ws, 'plans');
    assert.deepStrictEqual(
      Object.fromEntries(signature!.mutations.map((m) => [m.name, m.form])),
      { seed: 'reduce', retitle: 'edit', patch: 'patch' });
  });

  it('keeps every object a commit names — the delta included — reachable through gc', async () => {
    await recordMutate(storage, realRunner, repo, ws, 'plans', 'seed', [], { actor: 'cli:test' });
    await recordMutate(storage, realRunner, repo, ws, 'plans', 'retitle',
      [encodeBeast2For(StringType)('p-7')], { actor: 'cli:test' });
    const [head] = await recordHistory(storage, repo, ws, 'plans', { limit: 1 });
    assert.strictEqual(head!.commit.delta.type, 'some');

    await repoGc(storage, repo, { minAge: 0 });
    assert.strictEqual((await repoGc(storage, repo, { minAge: 0 })).deletedObjects, 0,
      'a second sweep takes nothing: what is left is the record\'s own closure');
    const delta = await DatasetSegments.open(storage, repo, head!.commit.delta.value);
    for (const segment of delta.manifest!.entries) await storage.objects.read(repo, segment.hash);
  });
});

/**
 * Three runtimes, one delta.
 *
 * A mutation runs on the runner its author chose, and the engine applies what
 * it emits — so the three runtimes must agree, byte for byte, on what a write
 * changed. They cannot be checked by comparing programs: what has to match is
 * the RESULT, so this deploys the same record to a workspace per runtime,
 * applies the same writes, and compares the state hashes. Anything that
 * diverges — an emit sink that orders differently, a patch builtin that
 * produces a different op, a segment cut elsewhere — shows up as one hash.
 *
 * Skips where a runtime is not installed, the way every multi-runtime suite
 * here does; CI installs all three.
 */
describe('the mutation delta — cross-runtime parity', () => {
  let repo: string;
  let tempDir: string;
  let storage: StorageBackend;
  const ROWS = 400n;

  // A real TaskRunner: a record operation's units are ordinary task
  // executions, not `runDetached` calls.
  let realRunner: TaskRunner;

  /** The runtimes to compare, minus any that is not installed. */
  const runtimes: Array<{ ws: string; runner: Parameters<typeof e3.mutation>[3] }> = [
    { ws: 'node', runner: { runner: { runtime: 'east-node', platforms: ['@elaraai/east-node-std'] } } },
    ...(onPath('east-c', ['version']) ? [{ ws: 'c', runner: { runner: { runtime: 'east-c' as const, platforms: [] } } }] : []),
    ...(onPath('east-py', ['version']) ? [{ ws: 'py', runner: { runner: { runtime: 'east-py' as const, platforms: [] } } }] : []),
  ];
  const missing = runtimes.length < 3
    ? `needs east-c and east-py on PATH; have ${runtimes.map((r) => r.ws).join(', ')}`
    : false;

  beforeEach(async () => {
    repo = createTestRepo();
    tempDir = createTempDir();
    storage = new LocalStorage(dirname(repo));
    realRunner = new LocalTaskRunner(repo);
    if (missing) return;

    for (const { ws, runner } of runtimes) {
      const plans = e3.record('plans', PlansType, new Map());
      const seed = e3.mutation('seed', plans, East.function([PlansType], PlansType, ($, _state) => {
        const out = $.let(new Map(), PlansType);
        $.for(East.Array.range(0n, ROWS), ($, i) => {
          const status = $.let('ok');
          $.if(East.equal(i.remainder(3n), 0n), ($) => {
            $.assign(status, 'late');
          });
          $(out.insert(East.str`p-${i}`, { status, due: i, title: East.str`Plan ${i}` }));
        });
        return out;
      }), runner);
      const retitle = e3.editMutation('retitle', plans,
        East.function([PlansType, StringType, e3.editTypeOf(PlansType) as never], NullType,
          (($: any, state: any, key: any, edit: any) => {
            const row = $.let(state.get(key));
            $(edit.set(key, { status: 'late', due: row.due, title: 'RETITLED' }));
          }) as never) as never, runner);
      const byStatus = e3.recordIndex('by_status', plans, {
        key: East.function([StringType, PlanRowType], StatusKeyType, ($, _k, v) => ({ status: v.status, due: v.due })),
        value: East.function([StringType, PlanRowType], StringType, ($, _k, v) => v.title),
      }, runner);
      const pkg = e3.package(`parity-${ws}`, '1.0.0', plans, seed, retitle, e3.patchMutation(plans, 'patch', runner) as never, byStatus as never);
      const zip = join(tempDir, `parity-${ws}.zip`);
      await e3.export(pkg, zip);
      await packageImport(storage, repo, zip);
      await workspaceCreate(storage, repo, ws);
      await workspaceDeploy(storage, repo, ws, `parity-${ws}`, '1.0.0', { runner: realRunner });
    }
  });

  afterEach(() => {
    removeTestRepo(repo);
    removeTempDir(tempDir);
  });

  it('every runtime writes the same state, hash for hash', { skip: missing }, async () => {
    const hashes: Array<{ ws: string; primary: string; index: string }> = [];
    for (const { ws } of runtimes) {
      for (const [mutation, args] of [
        ['seed', []],
        ['retitle', [encodeBeast2For(StringType)('p-7')]],
        ['patch', [encodeBeast2For(PatchType(PlansType))(variant('patch', new SortedMap<string, PlanOp>([
          ['p-zzz', variant('insert', { status: 'late', due: 9_999n, title: 'New' })],
        ], compareFor(StringType))))]],
      ] as const) {
        const outcome = await recordMutate(storage, realRunner, repo, ws, 'plans', mutation, [...args], { actor: 'cli:test' });
        assert.strictEqual(outcome.kind, 'committed', `${ws}/${mutation}: ${JSON.stringify(outcome)}`);
      }
      const ref = await storage.datasets.read(repo, ws, 'records/plans');
      assert.ok(ref && ref.type === 'value');
      const state = await readRecordState(storage, repo, ref.value.hash);
      hashes.push({ ws, primary: state.primary, index: state.indexes.get('by_status')!.manifest });
    }
    for (const seen of hashes.slice(1)) {
      assert.strictEqual(seen.primary, hashes[0]!.primary, `${seen.ws} disagrees with ${hashes[0]!.ws} on the record`);
      assert.strictEqual(seen.index, hashes[0]!.index, `${seen.ws} disagrees with ${hashes[0]!.ws} on the index`);
    }
  });
});
