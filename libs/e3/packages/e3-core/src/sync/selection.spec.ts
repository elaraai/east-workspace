/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Licensed under BSL 1.1. See LICENSE for details.
 */

/**
 * A selection's cut, over packages and graphs built by hand: its package, its
 * tasks, its edge and its outputs, and what it refuses.
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { IntegerType, toEastTypeValue, variant } from '@elaraai/east';
import type { PackageObject, Structure, SyncSelection } from '@elaraai/e3-types';
import type { DataflowGraph } from '../dataflow.js';
import { SyncSelectionError } from '../errors.js';
import { selectionCut } from './selection.js';

const A = '.inputs.a';
const output = (task: string): string => `.tasks.${task}.output`;
const hashOf = (task: string): string => task.charCodeAt(0).toString(16).padStart(2, '0').repeat(32);

const leaf = (writable: boolean): Structure => variant('value', { type: toEastTypeValue(IntegerType), writable });

/** A package and its graph, of tasks given as `[name, inputs]`. */
function packageOf(tasks: ReadonlyArray<readonly [string, readonly string[]]>): { pkg: PackageObject; graph: DataflowGraph } {
  const producer = new Map(tasks.map(([name]) => [output(name), name] as const));
  const structure: Structure = variant('struct', new Map([
    ['inputs', variant('struct', new Map([['a', leaf(true)]]))],
    ['tasks', variant('struct', new Map(tasks.map(([name]) => [name, variant('struct', new Map([['output', leaf(false)]]))] as const)))],
  ]));
  const pkg: PackageObject = {
    tasks: new Map(tasks.map(([name]) => [name, hashOf(name)])),
    data: { structure, refs: new Map([['inputs/a', variant('value', { hash: 'f'.repeat(64), versions: new Map([[A, 'f'.repeat(64)]]) })]]) },
    functions: new Map([['score', 'e'.repeat(64)]]),
    records: new Map([['jobs', 'd'.repeat(64)]]),
    sources: new Map(),
  };
  const graph: DataflowGraph = {
    tasks: tasks.map(([name, inputs]) => ({
      name,
      hash: hashOf(name),
      inputs: [...inputs],
      output: output(name),
      dependsOn: inputs.flatMap((input) => producer.get(input) ?? []),
    })),
  };
  return { pkg, graph };
}

const noBinds = { paths: [], functions: [], records: [], pages: [] };
const tasks = (...names: string[]): SyncSelection => variant('partial', { tasks: names, binds: noBinds, records: [] });

/** `a -> first -> second` */
const chain = packageOf([['first', [A]], ['second', [output('first')]]]);

describe('selectionCut', () => {
  it('cuts the lower half of a chain: its edge is the upper half\'s output', () => {
    const cut = selectionCut(chain.pkg, chain.graph, tasks('second'));
    assert.deepEqual(cut.edge, [output('first')]);
    assert.deepEqual(cut.outputs, [output('second')]);
    assert.deepEqual(cut.tasks.map((task) => [task.name, task.dependsOn]), [['second', []]]);
  });

  it('cuts a whole chain: its edge is the root input, and the lower task still depends on the upper', () => {
    const cut = selectionCut(chain.pkg, chain.graph, tasks('second', 'first'));
    assert.deepEqual(cut.edge, [A]);
    assert.deepEqual(cut.outputs, [output('first'), output('second')]);
    assert.deepEqual(cut.tasks.map((task) => [task.name, task.dependsOn]), [['first', []], ['second', ['first']]]);
  });

  it('names an input two tasks of the cut read once on its edge', () => {
    const diamond = packageOf([['left', [A]], ['right', [A]], ['join', [output('left'), output('right')]]]);
    const cut = selectionCut(diamond.pkg, diamond.graph, tasks('left', 'right'));
    assert.deepEqual(cut.edge, [A]);
    assert.deepEqual(cut.tasks.map((task) => task.name), ['left', 'right']);
  });

  it('counts a task named twice once', () => {
    const cut = selectionCut(chain.pkg, chain.graph, tasks('first', 'first'));
    assert.deepEqual(cut.tasks.map((task) => task.name), ['first']);
    assert.deepEqual([...cut.package.tasks.keys()], ['first']);
  });

  it('gives the cut a package of only its tasks, by the origin\'s hashes, the whole structure, and nothing else', () => {
    const cut = selectionCut(chain.pkg, chain.graph, tasks('second'));
    assert.deepEqual([...cut.package.tasks], [['second', hashOf('second')]]);
    assert.equal(cut.package.data.structure, chain.pkg.data.structure);
    assert.equal(cut.package.data.refs.size, 0);
    assert.equal(cut.package.functions.size, 0);
    assert.equal(cut.package.records.size, 0);
    assert.equal(cut.package.sources.size, 0);
  });

  it('refuses a task the package does not have, naming every one', () => {
    assert.throws(() => selectionCut(chain.pkg, chain.graph, tasks('second', 'zeta', 'alpha')),
      (err: unknown) => err instanceof SyncSelectionError && /'alpha', 'zeta'/.test(err.message));
  });

  it('refuses bindings, and a record\'s use', () => {
    const withBinds: SyncSelection = variant('partial', { tasks: ['first'], binds: { ...noBinds, functions: ['score'] }, records: [] });
    assert.throws(() => selectionCut(chain.pkg, chain.graph, withBinds), SyncSelectionError);
    const withRecord: SyncSelection = variant('partial', { tasks: ['first'], binds: noBinds, records: [{ record: 'jobs', mutations: [], indexes: [] }] });
    assert.throws(() => selectionCut(chain.pkg, chain.graph, withRecord), SyncSelectionError);
  });

  it('refuses the whole workspace, which a bundle carries', () => {
    assert.throws(() => selectionCut(chain.pkg, chain.graph, variant('full', null)), /workspace bundle/);
  });
});
