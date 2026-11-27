/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Licensed under BSL 1.1. See LICENSE for details.
 */

/**
 * A replica of a selection, made in a second repository and run there with
 * e3's own dataflow, against the origin it was described from: the results
 * are the origin's, its structure is all it fetches before it runs, and
 * nothing a task of the selection does not read is fetched at all.
 */

import { describe, it, type TestContext } from 'node:test';
import assert from 'node:assert/strict';
import { join } from 'node:path';
import { DictType, East, IntegerType, SortedMap, compareFor, encodeBeast2For, variant } from '@elaraai/east';
import e3 from '@elaraai/e3';
import { decodeCollectionManifest, type SyncDescription, type SyncSelection } from '@elaraai/e3-types';
import { dataflowGetGraph, dataflowResolveInputHashes } from '../dataflow.js';
import { SyncObjectError, SyncReleaseError, WorkspaceExistsError } from '../errors.js';
import { dataflowExecute } from '../execution/local-orchestrator.js';
import { LocalTaskRunner } from '../execution/LocalTaskRunner.js';
import { inputsHash } from '../executions.js';
import { gcObjectReaders, markReachable } from '../gc-graph.js';
import { packageImport } from '../package-files.js';
import { recordMutate } from '../records.js';
import type { StorageBackend } from '../storage/interfaces.js';
import { LocalStorage } from '../storage/local/LocalBackend.js';
import { createTempDir, createTestRepo, removeTempDir, removeTestRepo } from '../test-helpers.js';
import { workspaceCreate, workspaceDeploy } from '../workspaces.js';
import { syncDescribe } from './describe.js';
import { originObjects, replicaCreate, withReadThrough, type OriginObjects } from './replica.js';

const add = East.function([IntegerType], IntegerType, ($, x) => x.add(1n));
const RowsType = DictType(IntegerType, IntegerType);

/** 8,000 rows, stored as a collection of several segments. */
const rowsOf = (offset: bigint): SortedMap<bigint, bigint> =>
  new SortedMap(Array.from({ length: 8000 }, (_, i) => [BigInt(i), BigInt(i) + offset] as [bigint, bigint]), compareFor(IntegerType));

const tasks = (...names: string[]): SyncSelection => variant('partial', {
  tasks: names, binds: { paths: [], functions: [], records: [], pages: [] }, records: [],
});

/** An origin and a replica repository, in one local backend. */
function repositories(t: TestContext): { storage: StorageBackend; origin: string; replica: string; dir: string } {
  const origin = createTestRepo();
  const replica = createTestRepo();
  const dir = createTempDir();
  t.after(() => {
    removeTestRepo(origin);
    removeTestRepo(replica);
    removeTempDir(dir);
  });
  return { storage: new LocalStorage(), origin, replica, dir };
}

/** Deploys a package to workspace `ws` of a repository. */
async function deploy(storage: StorageBackend, repo: string, dir: string, name: string, pkg: Parameters<typeof e3.export>[0]): Promise<void> {
  const zip = join(dir, `${name}-${Math.random().toString(16).slice(2)}.zip`);
  await e3.export(pkg, zip);
  await packageImport(storage, repo, zip);
  await workspaceCreate(storage, repo, 'ws');
  await workspaceDeploy(storage, repo, 'ws', name, '1.0.0');
}

/** An origin's objects, every request to it recorded. */
function recording(origin: OriginObjects): OriginObjects & { readonly asked: string[]; readonly requests: number[] } {
  const asked: string[] = [];
  const requests: number[] = [];
  return {
    asked,
    requests,
    async read(hashes) {
      requests.push(hashes.length);
      asked.push(...hashes);
      return origin.read(hashes);
    },
  };
}

/** A task's latest execution over its current inputs, which must be a success. */
async function latest(storage: StorageBackend, repo: string, name: string): Promise<{ taskHash: string; inputsHash: string; outputHash: string; plan: boolean }> {
  const task = (await dataflowGetGraph(storage, repo, 'ws')).tasks.find((each) => each.name === name);
  assert.ok(task, `${name} is a task of ${repo}`);
  const inputs = await dataflowResolveInputHashes(storage, repo, 'ws', task);
  assert.ok(inputs.every((hash) => hash !== null), `${name}'s inputs are all assigned`);
  const inHash = inputsHash(inputs as string[]);
  const status = await storage.refs.executionGetLatest(repo, task.hash, inHash);
  assert.ok(status?.type === 'success', `${name} succeeded in ${repo}: ${status?.type}`);
  return { taskHash: task.hash, inputsHash: inHash, outputHash: status.value.outputHash, plan: status.value.plan.type === 'some' };
}

/** Holds each task's result at the replica to the origin's. */
async function sameResults(t: TestContext, storage: StorageBackend, origin: string, replica: string, names: readonly string[]): Promise<void> {
  for (const name of names) {
    const there = await latest(storage, origin, name);
    const here = await latest(storage, replica, name);
    t.diagnostic(`${name}: inputs ${here.inputsHash} output ${here.outputHash} at the replica; inputs ${there.inputsHash} output ${there.outputHash} at the origin`);
    assert.equal(here.taskHash, there.taskHash, `${name}'s task hash`);
    assert.equal(here.inputsHash, there.inputsHash, `${name}'s inputs hash`);
    assert.equal(here.outputHash, there.outputHash, `${name}'s output hash`);
  }
}

/** Everything a root reaches at the origin, as gc's mark finds it. */
async function closureOf(storage: StorageBackend, repo: string, root: string): Promise<Set<string>> {
  const { readObject, readHead } = gcObjectReaders(storage, repo);
  const reached = await markReachable(readObject, new Set([root]), { readHead });
  reached.add(root);
  return reached;
}

/** A dataset's value's hash at the origin. */
async function valueOf(storage: StorageBackend, repo: string, refPath: string): Promise<{ hash: string; self: string | undefined }> {
  const ref = await storage.datasets.read(repo, 'ws', refPath);
  assert.ok(ref?.type === 'value', `${refPath} has a value`);
  return { hash: ref.value.hash, self: [...ref.value.versions.values()][0] };
}

/** `a -> first -> second`, and beside it `other`, a large input only `use_other` reads. */
function chainWithOther(): Parameters<typeof e3.export>[0] {
  const a = e3.input('a', IntegerType, variant('value', 1n));
  const first = e3.task('first', [a], add);
  const second = e3.task('second', [first.output], add);
  const other = e3.input('other', RowsType, variant('value', rowsOf(7n)));
  const useOther = e3.task('use_other', [other], East.function([RowsType], IntegerType, ($, rows) => rows.size()));
  return e3.package('chain', '1.0.0', a, first, second, other, useOther);
}

describe('a replica of a selection', { concurrency: false }, () => {
  it('runs a whole chain to the origin\'s results, and fetches nothing of a dataset no task of it reads', async (t) => {
    const { storage, origin, replica, dir } = repositories(t);
    await deploy(storage, origin, dir, 'chain', chainWithOther());

    const description = await syncDescribe(storage, origin, 'ws', tasks('first', 'second'));
    const asked = recording(originObjects(storage, origin, description));
    await replicaCreate(storage, replica, 'ws', description, asked);
    const ran = await dataflowExecute(withReadThrough(storage, replica, asked), replica, 'ws');
    assert.equal(ran.success, true);
    assert.equal(ran.executed, 2);

    const there = await dataflowExecute(storage, origin, 'ws');
    assert.equal(there.success, true);
    await sameResults(t, storage, origin, replica, ['first', 'second']);

    // Nothing of `other` was asked for, and none of it may be read
    const other = await closureOf(storage, origin, (await valueOf(storage, origin, 'inputs/other')).hash);
    assert.deepEqual(asked.asked.filter((hash) => other.has(hash)), []);
    const segment = [...other][0]!;
    assert.equal((await originObjects(storage, origin, description).read([segment])).size, 0);
    t.diagnostic(`the origin was asked for ${new Set(asked.asked).size} objects of the ${await storage.objects.count(origin)} it holds, in ${asked.requests.length} requests`);
  });

  it('runs the lower half of a chain from the upper half\'s output, which the origin made', async (t) => {
    const { storage, origin, replica, dir } = repositories(t);
    await deploy(storage, origin, dir, 'chain', chainWithOther());
    const firstOnly = await dataflowExecute(storage, origin, 'ws', { filter: 'first' });
    assert.equal(firstOnly.success, true);

    const description = await syncDescribe(storage, origin, 'ws', tasks('second'));
    const asked = recording(originObjects(storage, origin, description));
    await replicaCreate(storage, replica, 'ws', description, asked);
    assert.deepEqual((await dataflowGetGraph(storage, replica, 'ws')).tasks.map((task) => [task.name, task.dependsOn]), [['second', []]]);
    const ran = await dataflowExecute(withReadThrough(storage, replica, asked), replica, 'ws');
    assert.equal(ran.success, true);
    assert.equal(ran.executed, 1);

    assert.equal((await dataflowExecute(storage, origin, 'ws')).success, true);
    await sameResults(t, storage, origin, replica, ['second']);
  });

  it('runs a split task, and the task after it, to the origin\'s results', async (t) => {
    const pieceBytes = process.env.E3_TEST_PIECE_BYTES;
    // Pieces of 16 to 256 stored bytes: a piece a segment
    process.env.E3_TEST_PIECE_BYTES = '64';
    t.after(() => {
      if (pieceBytes === undefined) delete process.env.E3_TEST_PIECE_BYTES;
      else process.env.E3_TEST_PIECE_BYTES = pieceBytes;
    });
    const { storage, origin, replica, dir } = repositories(t);
    const rows = e3.input('rows', RowsType, variant('value', rowsOf(0n)));
    const total = e3.streamTask('total', {
      inputs: [e3.partition(rows)],
      output: e3.output.fold(IntegerType, { zero: 0n, combine: (_$, a, b) => a.add(b) }),
    }, ($, rows, emit) => {
      $.for(rows, ($, value) => {
        $(emit(value));
      });
    });
    const report = e3.task('report', [total.output], East.function([IntegerType], IntegerType, ($, sum) => sum.multiply(2n)));
    await deploy(storage, origin, dir, 'split', e3.package('split', '1.0.0', rows, total, report));

    const description = await syncDescribe(storage, origin, 'ws', tasks('total', 'report'));
    const asked = recording(originObjects(storage, origin, description));
    await replicaCreate(storage, replica, 'ws', description, asked);
    const ran = await dataflowExecute(withReadThrough(storage, replica, asked), replica, 'ws');
    assert.equal(ran.success, true);

    assert.equal((await dataflowExecute(storage, origin, 'ws')).success, true);
    await sameResults(t, storage, origin, replica, ['total', 'report']);
    assert.equal((await latest(storage, replica, 'total')).plan, true, 'the replica split the task');
    assert.equal((await latest(storage, origin, 'total')).plan, true, 'and so did the origin');
  });

  it('fetches only its structure as it is made: no segment of an input, in fewer requests than objects', async (t) => {
    const { storage, origin, replica, dir } = repositories(t);
    const rows = e3.input('rows', RowsType, variant('value', rowsOf(0n)));
    const counts = Array.from({ length: 6 }, (_, i) =>
      e3.task(`count_${i}`, [rows], East.function([RowsType], IntegerType, ($, rows) => rows.size().add(BigInt(i)))));
    await deploy(storage, origin, dir, 'counts', e3.package('counts', '1.0.0', rows, ...counts));

    const description = await syncDescribe(storage, origin, 'ws', tasks(...counts.map((_, i) => `count_${i}`)));
    const asked = recording(originObjects(storage, origin, description));
    await replicaCreate(storage, replica, 'ws', description, asked);

    const manifest = decodeCollectionManifest(await storage.objects.read(origin, (await valueOf(storage, origin, 'inputs/rows')).hash));
    assert.equal(manifest.level, 0n, 'the rows are one level of segments');
    assert.ok(manifest.entries.length > 1, `the rows are in several segments: ${manifest.entries.length}`);
    const segments = new Set(manifest.entries.map((entry) => entry.hash));
    assert.deepEqual(asked.asked.filter((hash) => segments.has(hash)), [], 'no segment was asked for');
    const fetched = new Set(asked.asked).size;
    t.diagnostic(`made with ${fetched} objects in ${asked.requests.length} requests (${asked.requests.join(', ')})`);
    assert.ok(asked.requests.length < fetched, `${asked.requests.length} requests for ${fetched} objects`);

    const ran = await dataflowExecute(withReadThrough(storage, replica, asked), replica, 'ws');
    assert.equal(ran.success, true);
    assert.equal(ran.executed, counts.length);
    assert.ok(asked.asked.some((hash) => segments.has(hash)), 'its run fetched the segments it read');
  });

  it('runs a task that reads a record from its state, fetching none of its commits', async (t) => {
    const { storage, origin, replica, dir } = repositories(t);
    const counter = e3.record('counter', IntegerType, {
      initial: 0n,
      mutations: (mutation) => ({
        increment: mutation.reduce(East.function([IntegerType, IntegerType], IntegerType, ($, state, by) => state.add(by))),
      }),
    });
    const reader = e3.task('reader', [counter], East.function([IntegerType], IntegerType, ($, c) => c.multiply(2n)));
    await deploy(storage, origin, dir, 'recflow', e3.package('recflow', '1.0.0', counter, reader));
    const outcome = await recordMutate(storage, new LocalTaskRunner(origin), origin, 'ws', 'counter', 'increment', [encodeBeast2For(IntegerType)(5n)], { actor: 'cli:test' });
    assert.equal(outcome.kind, 'committed');

    const held = await valueOf(storage, origin, 'records/counter');
    assert.ok(held.self !== undefined && held.self !== held.hash, 'the record names its head commit beside its state');
    const description = await syncDescribe(storage, origin, 'ws', tasks('reader'));
    const asked = recording(originObjects(storage, origin, description));
    await replicaCreate(storage, replica, 'ws', description, asked);
    const ran = await dataflowExecute(withReadThrough(storage, replica, asked), replica, 'ws');
    assert.equal(ran.success, true);

    assert.equal((await dataflowExecute(storage, origin, 'ws')).success, true);
    await sameResults(t, storage, origin, replica, ['reader']);
    assert.ok(asked.asked.includes(held.hash), 'the state was fetched');
    assert.ok(!asked.asked.includes(held.self), 'its head commit was not');
  });

  describe('refuses', () => {
    async function described(t: TestContext): Promise<{ storage: StorageBackend; origin: string; replica: string; description: SyncDescription }> {
      const { storage, origin, replica, dir } = repositories(t);
      await deploy(storage, origin, dir, 'chain', chainWithOther());
      return { storage, origin, replica, description: await syncDescribe(storage, origin, 'ws', tasks('first', 'second')) };
    }

    it('a description a newer release wrote, and takes one an older release wrote', async (t) => {
      const { storage, origin, replica, description } = await described(t);
      const objects = originObjects(storage, origin, description);
      await assert.rejects(replicaCreate(storage, replica, 'ws', { ...description, release: '99.0.0' }, objects), SyncReleaseError);
      await replicaCreate(storage, replica, 'older', { ...description, release: '1.0.0' }, objects);
      assert.ok(await storage.refs.workspaceRead(replica, 'older') !== null);
    });

    it('a workspace that exists', async (t) => {
      const { storage, origin, replica, description } = await described(t);
      await workspaceCreate(storage, replica, 'ws');
      await assert.rejects(replicaCreate(storage, replica, 'ws', description, originObjects(storage, origin, description)), WorkspaceExistsError);
    });

    it('an origin that answers other bytes for an object, keeping nothing under its name', async (t) => {
      const { storage, replica, description } = await described(t);
      const lying: OriginObjects = {
        read: (hashes) => Promise.resolve(new Map(hashes.map((hash) => [hash, new TextEncoder().encode(`not ${hash}`)]))),
      };
      await assert.rejects(replicaCreate(storage, replica, 'ws', description, lying), SyncObjectError);
      const task = description.package.tasks.get('first')!;
      assert.equal(await storage.objects.exists(replica, task), false);
      assert.equal(await storage.refs.workspaceRead(replica, 'ws'), null, 'and makes no workspace');
    });

    it('an origin that leaves a root out, naming it', async (t) => {
      const { storage, origin, replica, description } = await described(t);
      const objects = originObjects(storage, origin, description);
      const left = description.package.tasks.get('second')!;
      const leaving: OriginObjects = { read: async (hashes) => new Map([...await objects.read(hashes)].filter(([hash]) => hash !== left)) };
      await assert.rejects(replicaCreate(storage, replica, 'ws', description, leaving), (err: unknown) => err instanceof SyncObjectError && err.message.includes(left));
      assert.equal(await storage.refs.workspaceRead(replica, 'ws'), null, 'and makes no workspace');
    });
  });
});
