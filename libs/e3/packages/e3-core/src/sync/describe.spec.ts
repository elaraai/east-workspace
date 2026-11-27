/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Licensed under BSL 1.1. See LICENSE for details.
 */

/**
 * A selection of a deployed workspace, described: the refs on its edge, the
 * values given in their place, its roots, and the lock it reads under.
 */

import { describe, it, type TestContext } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { East, IntegerType, variant } from '@elaraai/east';
import e3 from '@elaraai/e3';
import { E3_RELEASE, type SyncSelection } from '@elaraai/e3-types';
import { dataflowGetGraph } from '../dataflow.js';
import { keypathToRefPath } from '../dataset-refs.js';
import { SyncSelectionError, WorkspaceLockError } from '../errors.js';
import { packageImport } from '../package-files.js';
import { InMemoryStorage } from '../storage/in-memory/InMemoryStorage.js';
import { workspaceCreate, workspaceDeploy } from '../workspaces.js';
import { descriptionRoots, syncDescribe } from './describe.js';

const add = East.function([IntegerType], IntegerType, ($, x) => x.add(1n));

/** Deploys `a -> first -> second` to workspace `ws` of a repository in memory. */
async function deployChain(t: TestContext): Promise<{ storage: InMemoryStorage; keypath: (task: string) => string; input: string; hashOf: (task: string) => string }> {
  const dir = mkdtempSync(join(tmpdir(), 'e3-sync-describe-'));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const storage = new InMemoryStorage();
  await storage.repos.create('repo');
  const a = e3.input('a', IntegerType, variant('value', 1n));
  const first = e3.task('first', [a], add);
  const zip = join(dir, 'chain.zip');
  await e3.export(e3.package('chain', '1.0.0', a, first, e3.task('second', [first.output], add)), zip);
  await packageImport(storage, 'repo', zip);
  await workspaceCreate(storage, 'repo', 'ws');
  await workspaceDeploy(storage, 'repo', 'ws', 'chain', '1.0.0');
  const graph = await dataflowGetGraph(storage, 'repo', 'ws');
  const task = (name: string) => graph.tasks.find((each) => each.name === name)!;
  return { storage, keypath: (name) => task(name).output, input: task('first').inputs[0]!, hashOf: (name) => task(name).hash };
}

const tasks = (...names: string[]): SyncSelection => variant('partial', {
  tasks: names, binds: { paths: [], functions: [], records: [], pages: [] }, records: [],
});

describe('syncDescribe', () => {
  it('describes a whole chain by its root input, as a value whose version vector is its self-entry', async (t) => {
    const { storage, input, hashOf } = await deployChain(t);
    const held = await storage.datasets.read('repo', 'ws', keypathToRefPath(input));
    assert.ok(held?.type === 'value');

    const description = await syncDescribe(storage, 'repo', 'ws', tasks('first', 'second'));
    assert.equal(description.release, E3_RELEASE);
    assert.deepEqual([...description.package.tasks.keys()], ['first', 'second']);
    assert.deepEqual([...description.datasets.keys()], [keypathToRefPath(input)]);
    const ref = description.datasets.get(keypathToRefPath(input))!;
    assert.ok(ref.type === 'value');
    assert.equal(ref.value.hash, held.value.hash);
    assert.deepEqual([...ref.value.versions], [[input, held.value.hash]]);
    assert.deepEqual(descriptionRoots(description), [hashOf('first'), hashOf('second'), held.value.hash].sort());
  });

  it('describes the lower half as its upper half\'s output, unassigned until it is made', async (t) => {
    const { storage, keypath } = await deployChain(t);
    const description = await syncDescribe(storage, 'repo', 'ws', tasks('second'));
    assert.deepEqual([...description.package.tasks.keys()], ['second']);
    assert.deepEqual([...description.datasets], [[keypathToRefPath(keypath('first')), variant('unassigned', null)]]);
  });

  it('describes an edge by the origin\'s ref, with the version vector its value was made with', async (t) => {
    const { storage, keypath, input } = await deployChain(t);
    const held = await storage.datasets.read('repo', 'ws', keypathToRefPath(input));
    assert.ok(held?.type === 'value');
    const made = '7'.repeat(64);
    await storage.datasets.write('repo', 'ws', keypathToRefPath(keypath('first')), variant('value', { hash: made, versions: new Map([[input, held.value.hash]]) }));
    const description = await syncDescribe(storage, 'repo', 'ws', tasks('second'));
    const ref = description.datasets.get(keypathToRefPath(keypath('first')))!;
    assert.ok(ref.type === 'value');
    assert.equal(ref.value.hash, made);
    assert.deepEqual([...ref.value.versions], [[input, held.value.hash]], 'the root input it was made from, not itself');
  });

  it('describes an edge by the value it is given in place of its ref, with the version vector the origin\'s loop gives it', async (t) => {
    const { storage, keypath, hashOf, input } = await deployChain(t);
    const held = await storage.datasets.read('repo', 'ws', keypathToRefPath(input));
    assert.ok(held?.type === 'value');
    const given = '9'.repeat(64);
    const description = await syncDescribe(storage, 'repo', 'ws', tasks('second'), { values: new Map([[keypath('first'), given], ['.inputs.nothing', '8'.repeat(64)]]) });
    const ref = description.datasets.get(keypathToRefPath(keypath('first')))!;
    assert.ok(ref.type === 'value');
    assert.equal(ref.value.hash, given);
    assert.deepEqual([...ref.value.versions], [[input, held.value.hash]], 'its task\'s input\'s');
    assert.equal(description.datasets.size, 1, 'a value given off the edge is not consulted');
    assert.deepEqual(descriptionRoots(description), [hashOf('second'), given].sort());
  });

  it('refuses a value given, or a task, made from two values of one input', async (t) => {
    const dir = mkdtempSync(join(tmpdir(), 'e3-sync-describe-'));
    t.after(() => rmSync(dir, { recursive: true, force: true }));
    const storage = new InMemoryStorage();
    await storage.repos.create('repo');
    const a = e3.input('a', IntegerType, variant('value', 1n));
    const left = e3.task('left', [a], add);
    const right = e3.task('right', [a], add);
    const joined = e3.task('join', [left.output, right.output], East.function([IntegerType, IntegerType], IntegerType, ($, l, r) => l.add(r)));
    const zip = join(dir, 'diamond.zip');
    await e3.export(e3.package('diamond', '1.0.0', a, left, right, joined, e3.task('after', [joined.output], add)), zip);
    await packageImport(storage, 'repo', zip);
    await workspaceCreate(storage, 'repo', 'ws');
    await workspaceDeploy(storage, 'repo', 'ws', 'diamond', '1.0.0');
    // `left` made from one value of `a`, `right` from another
    for (const [task, from] of [['left', '1'], ['right', '2']] as const) {
      await storage.datasets.write('repo', 'ws', `tasks/${task}/output`, variant('value', { hash: from.repeat(64), versions: new Map([['.inputs.a', from.repeat(64)]]) }));
    }
    await assert.rejects(syncDescribe(storage, 'repo', 'ws', tasks('after'), { values: new Map([['.tasks.join.output', '9'.repeat(64)]]) }),
      (err: unknown) => err instanceof SyncSelectionError && /two values of '\.inputs\.a'/.test(err.message));
    // Nor is a task of the cut that would read them described
    await assert.rejects(syncDescribe(storage, 'repo', 'ws', tasks('join')),
      (err: unknown) => err instanceof SyncSelectionError && /'join' would read values made from two values of '\.inputs\.a'/.test(err.message));
  });

  it('refuses a value that is no object hash', async (t) => {
    const { storage, keypath } = await deployChain(t);
    await assert.rejects(syncDescribe(storage, 'repo', 'ws', tasks('second'), { values: new Map([[keypath('first'), 'not-a-hash']]) }), /SHA-256/);
  });

  it('refuses a workspace something holds exclusively', async (t) => {
    const { storage } = await deployChain(t);
    const lock = await storage.locks.acquire('repo', 'ws', variant('deployment', null));
    assert.ok(lock);
    t.after(() => lock.release());
    await assert.rejects(syncDescribe(storage, 'repo', 'ws', tasks('second')), WorkspaceLockError);
  });
});
