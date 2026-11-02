/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Licensed under BSL 1.1. See LICENSE for details.
 */

import { East, ArrayType, DictType, FloatType, IntegerType, StringType, StructType, variant } from '@elaraai/east';
import e3 from '@elaraai/e3';
import { example } from './example.js';

// ---
// e3.streamTask and e3.partition
// ---

export const partitionMerge = example({
  keywords: ['e3', 'partition', 'streamTask', 'split', 'pieces', 'merge', 'dict', 'large input', 'parallel'],
  description: "Split a stream task's work over a large input with e3.partition: the body runs once per piece; a key emitted in several pieces folds with merge; an unwrapped input reaches every piece whole",
  fn: () => {
    const SaleKeyType = StructType({ sku: StringType, id: IntegerType });
    const SaleType = StructType({ amount: FloatType, currency: StringType });
    const sales = e3.input('sales', DictType(SaleKeyType, SaleType));
    const rates = e3.input('rates', DictType(StringType, FloatType));
    const bySku = e3.streamTask('by_sku', {
      inputs: [e3.partition(sales), rates],
      output: e3.output.dict(StringType, FloatType, { merge: ($, _sku, a, b) => a.add(b) }),
    }, ($, sales, rates, emit) => {
      $.for(sales, ($, sale, key) => {
        $(emit(key.sku, sale.amount.multiply(rates.get(sale.currency))));
      });
    });
    return e3.package('sales', '1.0.0', bySku);
  },
});

export const partitionBy = example({
  keywords: ['e3', 'partition', 'by', 'group', 'whole groups', 'running total'],
  description: "e3.partition(dataset, { by }) never splits rows whose leading key fields are equal across pieces, so each piece holds whole groups, in key order",
  fn: () => {
    const SaleKeyType = StructType({ sku: StringType, id: IntegerType });
    const SaleType = StructType({ amount: FloatType, currency: StringType });
    const sales = e3.input('sales', DictType(SaleKeyType, SaleType));
    const perSku = e3.streamTask('per_sku', {
      inputs: [e3.partition(sales, { by: ['sku'] })],
      output: e3.output.array(FloatType),
    }, ($, sales, emit) => {
      const sku = $.let('');
      const total = $.let(0.0);
      $.for(sales, ($, sale, key) => {
        $.if(East.notEqual(key.sku, sku), ($) => { $.assign(sku, key.sku); $.assign(total, 0.0); });
        $.assign(total, total.add(sale.amount));
        $(emit(total));
      });
    });
    return e3.package('sales', '1.0.0', perSku);
  },
});

export const partitionByRegion = example({
  keywords: ['e3', 'partition', 'array', 'group', 'region', 'sum', 'dict output'],
  description: "Each region's total over an array input, split in pieces: emit into a Dict output whose merge adds a key's values across pieces",
  fn: () => {
    const Sale = StructType({ region: StringType, amount: FloatType });
    const sales = e3.input('sales', ArrayType(Sale), variant('value', [
      { region: 'north', amount: 1 }, { region: 'south', amount: 2 }, { region: 'north', amount: 3 }, { region: 'east', amount: 4 },
    ]));
    const byRegion = e3.streamTask('by_region', {
      inputs: [e3.partition(sales)],
      output: e3.output.dict(StringType, FloatType, { merge: ($, _k, a, b) => a.add(b) }),
    }, ($, sales, emit) => { $.for(sales, ($, s) => { $(emit(s.region, s.amount)); }); });
    return e3.package('regions', '1.0.0', byRegion);
  },
});

export const streamOutputKinds = example({
  keywords: ['e3', 'streamTask', 'output', 'array', 'set', 'fold', 'emit', 'balance'],
  description: "A stream task emits into an output kind — array, set or fold — which fixes emit's signature and how the parts combine",
  fn: () => {
    const EventType = StructType({ account: StringType, amount: FloatType });
    const events = e3.input('events', ArrayType(EventType));
    // With no partitioned input the task is one unit, exact left to right.
    const balances = e3.streamTask('balances', { inputs: [events], output: e3.output.array(FloatType) }, ($, events, emit) => {
      const balance = $.let(0.0);
      $.for(events, ($, event) => { $.assign(balance, balance.add(event.amount)); $(emit(balance)); });
    });
    // A Set holds an element emitted twice once.
    const accounts = e3.streamTask('accounts', { inputs: [e3.partition(events)], output: e3.output.set(StringType) },
      ($, events, emit) => { $.for(events, ($, event) => { $(emit(event.account)); }); });
    // A fold folds every emitted value with `combine`, from `zero`.
    const total = e3.streamTask('total', {
      inputs: [e3.partition(events)],
      output: e3.output.fold(FloatType, { zero: 0.0, combine: ($, a, b) => a.add(b) }),
    }, ($, events, emit) => { $.for(events, ($, event) => { $(emit(event.amount)); }); });
    return e3.package('ledger', '1.0.0', balances, accounts, total);
  },
});
