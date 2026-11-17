/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

import { describe, it } from 'node:test';
import * as assert from 'node:assert';
import { DictType, East, IntegerType, PatchType, StringType, StructType, VariantType } from '@elaraai/east';
import e3 from './index.js';
import { package_ } from './package.js';
import type { DatasetDef, TaskDef } from './types.js';

describe('package', () => {
  it('refuses a name or a version no path can hold, since a repository keeps a package under both', () => {
    assert.throws(() => package_('../escape', '1.0.0'), /^Error: e3\.package: the package name "\.\.\/escape" holds "\/", which a file name cannot$/);
    assert.throws(() => package_('pkg', '..'), /^Error: e3\.package: the package version name "\.\." is a path of its own$/);
    assert.throws(() => package_('pkg', ''), /^Error: e3\.package: the package version name "" is empty$/);
    assert.strictEqual(package_('pkg', '1.0.0-rc.1').version, '1.0.0-rc.1');
  });
});

describe('a package of a record the dataflow loads', () => {
  const Order = StructType({ customer: StringType, qty: IntegerType });
  const Orders = DictType(StringType, Order);
  const loadOrders = East.function([Orders, Orders], PatchType(Orders), (_$, delivery, current) => East.diff(current, delivery));
  /** A composite record of one source, `erp`, as its state holds it. */
  const Fed = DictType(VariantType({ erp: StringType }), Order);
  const rows = e3.input('rows', Orders);
  /** A task named `name` whose output is an order book, made from the rows. */
  const book = (name: string): TaskDef<typeof Orders> => e3.task(name, [rows], East.function([Orders], Orders, (_$, held) => held));
  /** A task named `name` whose output is an order book, made from a fed record. */
  const relay = (name: string, from: DatasetDef<typeof Fed>): TaskDef<typeof Orders> =>
    e3.task(name, [from], East.function([Fed], Orders, (_$, _held) => East.value(new Map(), Orders)));
  /** A composite record named `name` whose one source, `erp`, the dataflow loads from `feed`. */
  const fedBy = (name: string, feed: TaskDef<typeof Orders>) =>
    e3.recordComposite(name, Order, { sources: (source) => ({ erp: source.load(StringType, feed, loadOrders) }) });

  it('R3 — refuses a task named as a fed source\'s step in a run, <record>.<source>, a name a source e3 load delivers leaves free', () => {
    const orders = fedBy('orders', book('extract'));
    const clash = relay('orders.erp', orders);
    assert.throws(() => package_('sales', '1.0.0', orders, clash),
      /^Error: e3\.package 'sales': task 'orders\.erp' has the name of the load of source 'erp' of record 'orders', its step in a run — name the task otherwise$/);

    const delivered = e3.recordComposite('orders', Order, { sources: (source) => ({ erp: source.load(StringType, Orders, loadOrders) }) });
    assert.doesNotThrow(() => package_('sales', '1.0.0', delivered, relay('orders.erp', delivered)), 'a load e3 load delivers is no step of a run');
  });

  it('R3 — refuses a cycle through a fed load, naming its steps: what feeds the load reads the record it loads', () => {
    // A second task named as the feed's writes the dataset the load reads, and reads the record it loads
    const orders = fedBy('orders', book('extract'));
    assert.throws(() => package_('sales', '1.0.0', orders, relay('extract', orders)),
      /^Error: e3\.package 'sales': a cycle through the load orders\.erp — record 'orders' → task 'extract' → load orders\.erp → record 'orders': what feeds a load cannot read the record it loads$/);
  });

  it('R3 — refuses a cycle through other datasets and another load, naming each step', () => {
    const first = fedBy('first', book('seed'));
    const second = fedBy('second', relay('relay', first));
    // Named as first's feed: it writes what first's load reads, from second, which is loaded from first
    assert.throws(() => package_('sales', '1.0.0', first, second, relay('seed', second)),
      /^Error: e3\.package 'sales': a cycle through the load first\.erp — record 'first' → task 'relay' → load second\.erp → record 'second' → task 'seed' → load first\.erp → record 'first': what feeds a load cannot read the record it loads$/);
  });

  it('R3 — takes a record a task reads beside the feed of its load, and a feed made from another record', () => {
    const first = fedBy('first', book('seed'));
    const second = fedBy('second', relay('relay', first));
    const report = relay('report', second);
    const pkg = package_('sales', '1.0.0', report);
    assert.deepStrictEqual(Object.keys(pkg.records).sort(), ['first', 'second'], 'each record, with its feed, through the task that reads the last');
  });
});
