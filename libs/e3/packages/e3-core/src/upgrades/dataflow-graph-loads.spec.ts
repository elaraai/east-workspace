/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Licensed under BSL 1.1. See LICENSE for details.
 */

/**
 * The upgrade that carries stored dataflow runs into the form in which each
 * node of a run's graph says what it loads (R60): it reads the form the step
 * before it writes, and writes this release's. The contract suite
 * (`contract/repository-record.ts`) runs it over every backend, in parts; this
 * holds its form to the type this release reads.
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { encodeBeast2For, equalFor, isTypeValueEqual, none, printFor, some, toEastTypeValue } from '@elaraai/east';
import { DataflowExecutionStateType, E3_RELEASE, dataflowForce, type DataflowExecutionState } from '@elaraai/e3-types';
import { InMemoryStorage } from '../storage/in-memory/InMemoryStorage.js';
import { DataflowStateWithForceTasksType } from './dataflow-force-tasks.js';
import { DataflowStateWithGraphLoadsType, dataflowGraphLoads } from './dataflow-graph-loads.js';

/** A completed run in `workspace`, its graph's nodes those given, as this release reads it. */
function run(workspace: string, graph: DataflowExecutionState['graph']): DataflowExecutionState {
  return {
    release: E3_RELEASE, id: `run-${workspace}`, repo: 'repo', workspace, startedAt: new Date(1_000), force: dataflowForce(false), filter: none,
    graph, graphHash: none, tasks: new Map(), executed: 2n, cached: 0n, failed: 0n, skipped: 0n, status: 'completed',
    completedAt: some(new Date(2_000)), error: none, versionVectors: new Map(), inputSnapshot: new Map(), taskOutputPaths: [],
    reexecuted: 0n, events: [], eventSeq: 0n,
  };
}

/** A node of a run's graph that loads nothing: a task. */
const task = (name: string, dependsOn: string[]) =>
  ({ name, hash: name.padEnd(64, '0'), inputs: [`.inputs.${name}`], output: `.tasks.${name}.output`, dependsOn, load: none });

describe('dataflow-graph-loads', () => {
  it('writes this release\'s form', () => {
    assert.ok(isTypeValueEqual(toEastTypeValue(DataflowStateWithGraphLoadsType), toEastTypeValue(DataflowExecutionStateType)),
      'the execution state\'s type changed: its form is the next upgrade\'s to carry, from this one\'s frozen form');
  });

  it('R60 — writes that no node loads anything on every node of every run an earlier release stored, and leaves a run already in this form, or in neither, as it is', async () => {
    const storage = new InMemoryStorage();
    const store = storage.runStates('repo');
    const graphed = run('graphed', some({ tasks: [task('extract', []), task('model', ['extract'])] }));
    const bare = run('bare', none);
    // A run of this form, one of whose nodes is a load
    const current = run('current', some({ tasks: [
      task('combine', []),
      { ...task('orders.erp', ['combine']), load: some({ record: 'orders', source: 'erp' }) },
    ] }));
    const crashed = run('crashed', none);
    for (const each of [graphed, bare, current, crashed]) await store.create(each);
    const stored = async (workspace: string) => (await store.readStored('repo')).find((each) => each.workspace === workspace)!;
    // The earlier form names no node's load: a struct encodes the fields its type names
    const encodeEarlier = encodeBeast2For(DataflowStateWithForceTasksType);
    for (const each of [graphed, bare]) await (await stored(each.workspace)).replace(encodeEarlier(each));
    await (await stored('crashed')).replace(new TextEncoder().encode('not a run'));
    const currentBytes = new Uint8Array((await stored('current')).bytes);
    await assert.rejects(store.read('repo', 'graphed', graphed.id), 'before the upgrade, a run of the earlier form does not read');

    assert.equal(await dataflowGraphLoads.apply(storage, 'repo', null, Date.now() + 60_000), null, 'a part with time to spare does the step whole');
    const equal = equalFor(DataflowExecutionStateType);
    const print = printFor(DataflowExecutionStateType);
    for (const each of [graphed, bare]) {
      const read = await store.read('repo', each.workspace, each.id);
      assert.ok(read !== null && equal(read, each), `the ${each.workspace} run reads as it was, no node loading anything: ${read === null ? 'none' : print(read)}`);
    }
    assert.deepEqual(new Uint8Array((await stored('current')).bytes), currentBytes, 'a run of this form is left as it is');
    assert.deepEqual(new Uint8Array((await stored('crashed')).bytes), new TextEncoder().encode('not a run'), 'a run in neither form is left as it is');
  });
});
