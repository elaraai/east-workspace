/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Licensed under BSL 1.1. See LICENSE for details.
 */

import { East, DictType, IntegerType, NullType, StringType, StructType } from '@elaraai/east';
import e3 from '@elaraai/e3';
import { example } from './example.js';

// ---
// e3.record
// ---

export const recordMutations = example({
  keywords: ['e3', 'record', 'mutation', 'reduce', 'edit', 'patch', 'index', 'audited state'],
  description: 'Declare a record whole: an index, and mutations of each form — reduce the whole state, edit a few entries, patch with a change',
  fn: () => {
    const PlanType = StructType({ title: StringType, owner: StringType });
    const PlansType = DictType(StringType, PlanType);
    const plans = e3.record('plans', PlansType, {
      initial: new Map(),
      // An index: a second collection in another order, maintained in the same commit.
      indexes: (index) => ({
        by_owner: index.key(East.function([StringType, PlanType], StringType, ($, _id, plan) => plan.owner)),
      }),
      mutations: (mutation) => ({
        // reduce: the reducer returns the whole new state — any record.
        add_plan: mutation.reduce(East.function([PlansType, StringType, PlanType], PlansType, ($, state, id, plan) => {
          const next = $.let(state.copy());   // the state is a frozen input
          $(next.insert(id, plan));
          return next;
        })),
        // edit: reads the state lazily and writes through `edit`, so a write costs the segments it touches.
        reassign: mutation.edit(East.function([PlansType, StringType, StringType, e3.mutation.editType(PlansType)], NullType,
          ($, state, id, owner, edit) => { $(edit.set(id, { title: state.get(id).title, owner })); })),
        // patch: no body — the argument is the change, a PatchType of the state.
        patch: mutation.patch(),
      }),
    });
    return e3.package('planning', '1.0.0', plans);
  },
});

export const recordEditUpsert = example({
  keywords: ['e3', 'record', 'edit', 'mutation', 'upsert', 'add', 'quantity', 'stock', 'e3 mutate'],
  description: 'An edit mutation that adds to an entry or creates it, touching only that entry (`e3 mutate <repo> stock.receive \'"pear"\' 3 -w <ws>`), and a task reading the record',
  fn: () => {
    const StockType = DictType(StringType, IntegerType);
    const stock = e3.record('stock', StockType, {
      initial: new Map([['apple', 5n]]),
      mutations: (mutation) => ({
        receive: mutation.edit(East.function([StockType, StringType, IntegerType, e3.mutation.editType(StockType)], NullType,
          ($, state, sku, qty, edit) => {
            const now = $.let(qty);
            $.if(state.has(sku), ($) => { $.assign(now, state.get(sku).add(qty)); });
            $(edit.set(sku, now));
          })),
      }),
    });
    const total = e3.task('total', [stock], East.function([StockType], IntegerType, ($, s) => s.sum()));
    return e3.package('inventory', '1.0.0', total);
  },
});

export const recordMigration = example({
  keywords: ['e3', 'record', 'migration', 'rows', 'schema change', 'version', 'deploy'],
  description: "Change a record's type between package versions with a migration step: a deploy runs the steps a workspace has not applied, in order",
  fn: () => {
    const RowV1Type = StructType({ title: StringType });
    const RowV2Type = StructType({ title: StringType, owner: StringType });
    const plans = e3.record('plans', DictType(StringType, RowV2Type), {
      initial: new Map(),
      migrations: (migration) => [
        migration.rows('add_owner', East.function([StringType, RowV1Type], RowV2Type,
          ($, _id, row) => ({ title: row.title, owner: 'unassigned' }))),
      ],
    });
    return e3.package('planning', '2.0.0', plans);
  },
});
