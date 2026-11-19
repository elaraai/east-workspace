/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

/**
 * The rule for what a fed source's load cannot run beside, which the SDK and
 * the dataflow's graph both refuse by: a task named as the load is, and a
 * cycle through it.
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { loadNodeName, loadStepProblem, type DataflowStep } from './dataflow-loads.js';

/** A task named `task` that reads `inputs` and writes its own output. */
const task = (name: string, ...inputs: string[]): DataflowStep => ({ task: name, inputs, output: `.tasks.${name}.output` });
/** The load of `record`'s source `source` from `feed`. */
const load = (record: string, source: string, feed: string): DataflowStep => ({ load: { record, source }, inputs: [feed], output: `.records.${record}` });

describe('a fed source\'s load as a step of a run', () => {
  it('is named <record>.<source>', () => {
    assert.equal(loadNodeName('orders', 'erp'), 'orders.erp');
  });

  it('finds nothing in a package whose loads read datasets their records do not make', () => {
    assert.equal(loadStepProblem([
      task('extract', '.inputs.rows'), load('orders', 'erp', '.tasks.extract.output'), task('report', '.records.orders'),
    ]), null);
  });

  it('names a task that has a load\'s name', () => {
    assert.equal(loadStepProblem([task('extract'), load('orders', 'erp', '.tasks.extract.output'), task('orders.erp', '.records.orders')]),
      'task \'orders.erp\' has the name of the load of source \'erp\' of record \'orders\', its step in a run — name the task otherwise');
  });

  it('names each step of a cycle through a load, through other datasets, tasks and loads', () => {
    assert.equal(loadStepProblem([task('extract', '.records.orders'), load('orders', 'erp', '.tasks.extract.output')]),
      'a cycle through the load orders.erp — record \'orders\' → task \'extract\' → load orders.erp → record \'orders\': ' +
      'what feeds a load cannot read the record it loads');
    assert.equal(loadStepProblem([
      load('first', 'erp', '.tasks.seed.output'), task('relay', '.records.first'), load('second', 'erp', '.tasks.relay.output'),
      task('seed', '.records.second'),
    ]),
    'a cycle through the load first.erp — record \'first\' → task \'relay\' → load second.erp → record \'second\' → task \'seed\' → ' +
      'load first.erp → record \'first\': what feeds a load cannot read the record it loads');
  });
});
