/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Licensed under BSL 1.1. See LICENSE for details.
 */

/**
 * A split task's execution as its units are run in it (`SplitScope`): one
 * random id for every unit of an execution, whether a later unit reads what
 * each writes, and its end, however the execution ends — for a task run on its
 * own and for one the dataflow runs.
 */

import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { join } from 'node:path';
import { ArrayType, DictType, IntegerType, SortedMap, compareFor, variant } from '@elaraai/east';
import e3, { type TaskDef } from '@elaraai/e3';
import type { SplitScope } from './interfaces.js';
import { LocalTaskRunner, type TaskBodyRequest } from './LocalTaskRunner.js';
import { readTestPieceBytesFrom } from './pieces.js';
import { LocalOrchestrator } from '../dataflow/orchestrator/LocalOrchestrator.js';
import { InMemoryStateStore } from '../dataflow/state-store/InMemoryStateStore.js';
import { packageImport } from '../package-files.js';
import { packageRead } from '../packages.js';
import { LocalStorage } from '../storage/local/index.js';
import { createTestRepo, removeTestRepo } from '../test-helpers.js';
import { datasetWrite, workspaceSetDataset } from '../trees.js';
import { workspaceCreate, workspaceDeploy } from '../workspaces.js';

const RowsType = DictType(IntegerType, IntegerType);
const rowsInput = e3.input('rows', RowsType);

/** `n` rows keyed `0 … n-1`, each valued its key. */
function rowsOf(n: number): SortedMap<bigint, bigint> {
  return new SortedMap(Array.from({ length: n }, (_, i) => [BigInt(i), BigInt(i)] as [bigint, bigint]), compareFor(IntegerType));
}

/** Counts rows by their key's remainder of 7: every piece holds every
 *  remainder, so its pieces are merged, in one level. */
const counts = e3.streamTask('counts', {
  inputs: [e3.partition(rowsInput)],
  output: e3.output.dict(IntegerType, IntegerType, { merge: (_$, _key, a, b) => a.add(b) }),
}, ($, rows, emit) => { $.for(rows, ($, _value, key) => { $(emit(key.remainder(7n), 1n)); }); });

/** What one unit was run in, as its body saw it as it started. */
interface Seen {
  readonly merge: boolean;
  readonly scope: SplitScope | undefined;
  readonly endedAtStart: boolean;
}

describe('a split task\'s scope', () => {
  let repo: string;
  let storage: LocalStorage;

  beforeEach(() => {
    repo = createTestRepo();
    storage = new LocalStorage();
    readTestPieceBytesFrom(() => '64');
  });
  afterEach(() => removeTestRepo(repo));

  async function deploy(task: TaskDef): Promise<string> {
    const zip = join(repo, 'test.zip');
    await e3.export(e3.package('scoped', '1.0.0', task), zip);
    await packageImport(storage, repo, zip);
    return (await packageRead(storage, repo, 'scoped', '1.0.0')).tasks.get(task.name)!;
  }

  /** A runner whose body notes what each unit runs in, and runs it here. */
  function noting(seen: Seen[], also: (request: TaskBodyRequest) => void = () => {}): LocalTaskRunner {
    return new LocalTaskRunner(repo, undefined, { body: (request, local) => {
      const scope = request.options.splitScope;
      seen.push({ merge: request.unit?.merge !== null && request.unit?.merge !== undefined, scope, endedAtStart: scope?.ended.aborted ?? false });
      also(request);
      return local();
    } });
  }

  it('runs every unit of an execution in one scope, its pieces feeding its merges and its last merges none, ended as the execution ends', async () => {
    const hash = await deploy(counts);
    const inputs = [await datasetWrite(storage, repo, rowsOf(8000), RowsType)];
    const seen: Seen[] = [];
    const runner = noting(seen);
    const result = await runner.execute(storage, hash, inputs, { taskName: 'counts' });
    assert.equal(result.state, 'success', result.error);

    const pieces = seen.filter((unit) => !unit.merge);
    const merges = seen.filter((unit) => unit.merge);
    assert.ok(pieces.length > 1 && merges.length >= 1, 'the task ran as pieces and merges');
    const ids = new Set(seen.map((unit) => unit.scope?.id));
    assert.equal(ids.size, 1, 'one scope for every unit');
    assert.match([...ids][0] ?? '', /^[0-9a-f-]{36}$/);
    assert.ok(pieces.every((unit) => unit.scope?.feeds === true), 'a piece feeds the merges');
    assert.ok(merges.every((unit) => unit.scope?.feeds === false), 'the one level of merges feeds nothing');
    assert.ok(seen.every((unit) => !unit.endedAtStart), 'no unit runs in an ended scope');
    assert.ok(seen.every((unit) => unit.scope?.ended.aborted === true), 'the scope ended with the execution');

    // Another execution of the same task is another scope
    const again: Seen[] = [];
    const second = await noting(again).execute(storage, hash, inputs, { force: true });
    assert.equal(second.state, 'success', second.error);
    assert.notEqual(again[0]!.scope?.id, seen[0]!.scope?.id);
  });

  it('feeds nothing from the pieces of an array, whose outputs are concatenated here', async () => {
    const EventsType = ArrayType(IntegerType);
    const events = e3.input('events', EventsType);
    const hash = await deploy(e3.streamTask('shifted', {
      inputs: [e3.partition(events)],
      output: e3.output.array(IntegerType),
    }, ($, events, emit) => { $.for(events, ($, value) => { $(emit(value.add(1n))); }); }));
    const seen: Seen[] = [];
    const result = await noting(seen).execute(storage, hash, [await datasetWrite(storage, repo, Array.from({ length: 9000 }, (_, i) => BigInt(i)), EventsType)]);
    assert.equal(result.state, 'success', result.error);
    assert.ok(seen.length > 1 && seen.every((unit) => !unit.merge && unit.scope?.feeds === false), 'every piece, and none feeds');
  });

  it('feeds the next level from every merge below the last', async () => {
    // A fold whose pieces are more than a merge's fan-in: two levels of merges
    const hash = await deploy(e3.streamTask('total', {
      inputs: [e3.partition(rowsInput)],
      output: e3.output.fold(IntegerType, { zero: 0n, combine: (_$, a, b) => a.add(b) }),
    }, ($, rows, emit) => { $.for(rows, ($, value) => { $(emit(value)); }); }));
    readTestPieceBytesFrom(() => '16');
    const seen: Seen[] = [];
    const result = await noting(seen).execute(storage, hash, [await datasetWrite(storage, repo, rowsOf(40000), RowsType)]);
    assert.equal(result.state, 'success', result.error);
    const pieces = seen.filter((unit) => !unit.merge);
    const merges = seen.filter((unit) => unit.merge);
    assert.ok(pieces.length > 32, `more pieces than a merge's fan-in: ${pieces.length}`);
    assert.equal(merges.filter((unit) => unit.scope?.feeds === false).length, 1, 'the last level is one merge, feeding nothing');
    assert.ok(merges.filter((unit) => unit.scope?.feeds === true).length >= 2, 'the level below feeds it');
    assert.equal(new Set(seen.map((unit) => unit.scope?.id)).size, 1);
  });

  it('runs a task that is one piece in no scope', async () => {
    const hash = await deploy(counts);
    const seen: Seen[] = [];
    const result = await noting(seen).execute(storage, hash, [await datasetWrite(storage, repo, rowsOf(1), RowsType)]);
    assert.equal(result.state, 'success', result.error);
    assert.deepEqual(seen.map((unit) => unit.scope), [undefined]);
  });

  it('ends the scope of an execution that is cancelled or fails', async () => {
    const hash = await deploy(counts);
    const inputs = [await datasetWrite(storage, repo, rowsOf(8000), RowsType)];
    const abort = new AbortController();
    const seen: Seen[] = [];
    const cancelled = await noting(seen, () => abort.abort()).execute(storage, hash, inputs, { signal: abort.signal });
    assert.equal(cancelled.cancelled, true);
    assert.ok(seen.length >= 1 && seen.every((unit) => unit.scope?.ended.aborted === true), 'cancelled, its scope ended');

    const failing: Seen[] = [];
    const runner = new LocalTaskRunner(repo, undefined, { body: (request, local) => {
      failing.push({ merge: request.unit?.merge !== null, scope: request.options.splitScope, endedAtStart: false });
      if (request.unit?.merge !== null) return Promise.reject(new Error('the merge could not run'));
      return local();
    } });
    await assert.rejects(runner.execute(storage, hash, inputs, { force: true }), /the merge could not run/);
    assert.ok(failing.some((unit) => unit.merge) && failing.every((unit) => unit.scope?.ended.aborted === true), 'failed, its scope ended');
  });

  it('runs each unit the dataflow runs in its execution\'s scope, ended as the task completes', async () => {
    await deploy(counts);
    await workspaceCreate(storage, repo, 'dev');
    await workspaceDeploy(storage, repo, 'dev', 'scoped', '1.0.0');
    await workspaceSetDataset(storage, repo, 'dev', [variant('field', 'inputs'), variant('field', 'rows')], rowsOf(8000), RowsType);
    const seen: Seen[] = [];
    const orchestrator = new LocalOrchestrator(new InMemoryStateStore());
    const run = await orchestrator.wait(await orchestrator.start(storage, repo, 'dev', { runner: noting(seen) }));
    assert.equal(run.success, true);
    assert.ok(seen.some((unit) => unit.merge) && seen.some((unit) => !unit.merge));
    assert.equal(new Set(seen.map((unit) => unit.scope?.id)).size, 1);
    assert.ok(seen.every((unit) => unit.scope !== undefined && !unit.endedAtStart && unit.scope.ended.aborted));
    assert.ok(seen.every((unit) => unit.scope?.feeds === !unit.merge));
  });
});
