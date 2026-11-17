/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

/**
 * A composite record declared: `e3.recordComposite(name, row, { sources,
 * initial, indexes, mutations, migrations })` builds its sources through the
 * `source` builder, its type from them, and then its parts as `e3.record`
 * builds a record's, each handed the types the sources make. The first test
 * replays the declaration the design shows, as it is written; each refusal
 * names the record and the source or the part.
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  ArrayType, DictType, East, IntegerType, NullType, PatchType, SetType, SortedMap, StringType, StructType, VariantType,
  compareFor, equalFor, isTypeEqual, printFor, variant, type ValueTypeOf,
} from '@elaraai/east';
import { editTypeOf } from '@elaraai/e3-types';
import e3 from './index.js';
import type { SourceBuilder } from './record-builders.js';
import type { RecordTypes } from './record.js';
import { DEFAULT_RECORD_RUNNER } from './runner.js';

const Order = StructType({ customer: StringType, status: StringType, qty: IntegerType });

// What the ERP sends: its whole order book, keyed by its own order id.
const ErpOrder = StructType({ cust: StringType, state: StringType, qty: IntegerType });
const ErpDelivery = DictType(StringType, ErpOrder);

// The load: the delivery and the source's entries as they stand, to a patch of
// them. It sees the ERP's own ids; e3 puts the source's case on each key, and
// takes it off again.
const loadErp = East.function(
  [ErpDelivery, DictType(StringType, Order)], PatchType(DictType(StringType, Order)),
  ($, delivery, current) => East.diff(current, delivery.map(($, o) => ({ customer: o.cust, status: o.state, qty: o.qty }))),
);

/** The orders, as the design declares them. */
function declared() {
  return e3.recordComposite('orders', Order, {
    // Declared first: the parts after it are handed the types it makes.
    sources: (source) => ({
      erp: source.load(StringType, ErpDelivery, loadErp),  // the ERP's orders: written by this load alone
      own: source.mutations(StringType),                   // the solution's own: written by the mutations
    }),
    initial: { own: new Map() },                           // a solution source's entries, by its own key
    indexes: (index) => ({ by_customer: index.on(['customer']) }),
    mutations: (mutation, { state }) => ({
      plan_order: mutation.edit(East.function(
        [state, StringType, Order, e3.mutation.editType(state)], NullType,
        ($, _current, id, order, edit) => { $(edit.set(variant('own', id), order)); })),
      patch: mutation.patch(),
    }),
  });
}

/** The two sources of the orders: the ERP's, and the solution's own. */
const erpAndOwn = (source: SourceBuilder<typeof Order>) => ({
  erp: source.load(StringType, ErpDelivery, loadErp),
  own: source.mutations(StringType),
});

const OrdersKey = VariantType({ erp: StringType, own: StringType });
const Orders = DictType(OrdersKey, Order);
const Entries = DictType(StringType, Order);

describe('e3.recordComposite declares one record over its sources', () => {
  it('R1 — a composite is declared: its type is a Dict keyed by its sources\' cases, and it is a record whole', () => {
    const orders = declared();
    assert.ok(isTypeEqual(orders.type, Orders), 'orders.type: Dict<Variant{ erp: String, own: String }, Order>');
    assert.equal(orders.name, 'orders');
    assert.equal(orders.recordKind, 'record');

    // Its sources, by name: who writes each one's entries
    assert.deepEqual(Object.keys(orders.sources), ['erp', 'own']);
    const { erp, own } = orders.sources;
    assert.deepEqual([erp.kind, erp.name, erp.external], ['recordSource', 'erp', true]);
    assert.deepEqual([own.kind, own.name, own.external, own.load], ['recordSource', 'own', false, undefined]);
    assert.ok(isTypeEqual(erp.key, StringType) && isTypeEqual(own.key, StringType));
    assert.ok(erp.load !== undefined && isTypeEqual(erp.load.delivery, ErpDelivery), 'the load is delivered the ERP\'s order book');
    assert.equal(erp.load.keyed, true, 'a delivery keyed as its source is cut with the source\'s entries');
    assert.deepEqual(erp.load.runner, DEFAULT_RECORD_RUNNER);
    assert.equal(erp.load.fn, loadErp);

    // Its parts, built as a record's are, over the type the sources make
    assert.deepEqual(Object.keys(orders.indexes), ['by_customer']);
    assert.ok(isTypeEqual(orders.indexes.by_customer.keyType, StringType));
    assert.deepEqual(Object.values(orders.mutations).map((m) => [m.name, m.form, m.record === orders]), [['plan_order', 'edit', true], ['patch', 'patch', true]]);
    assert.ok(isTypeEqual(orders.mutations.plan_order.argTypes[0]!, StringType) && isTypeEqual(orders.mutations.plan_order.argTypes[1]!, Order));
    assert.ok(isTypeEqual(orders.mutations.patch.argTypes[0]!, PatchType(Orders)), 'a patch is of the whole record');
    assert.ok(Object.isFrozen(orders.sources) && Object.isFrozen(orders.indexes) && Object.isFrozen(orders.mutations));

    // TypeScript reads each source and part off the one call
    const erpName: 'erp' = erp.name;
    const external: true = erp.external;
    const solution: false = own.external;
    const planName: 'plan_order' = orders.mutations.plan_order.name;
    assert.deepEqual([erpName, external, solution, planName], ['erp', true, false, 'plan_order']);

    // And a package takes it as it takes any record
    assert.equal(e3.package('sales', '1.0.0', orders).records.orders, orders);
  });

  it('R1 — the parts after sources are handed its types: the built state, its key, and the capability over its own sources\' keys', () => {
    const handed: Array<[string, RecordTypes<typeof Orders, unknown>]> = [];
    const orders = e3.recordComposite('orders', Order, {
      sources: erpAndOwn,
      indexes: (index, types) => {
        handed.push(['indexes', types]);
        return { by_customer_of: index.key(East.function([types.key, Order], StringType, (_$, _key, row) => row.customer)) };
      },
      mutations: (mutation, types) => {
        handed.push(['mutations', types]);
        const { state, edit } = types;
        return {
          // `edit` writes the solution's own entries, each named by the record's key
          plan_order: mutation.edit(East.function([state, StringType, Order, edit], NullType, ($, _current, id, order, edit) => {
            $(edit.set(variant('own', id), order));
          })),
        };
      },
      migrations: (_migration, types) => {
        handed.push(['migrations', types]);
        return [];
      },
    });
    assert.deepEqual(handed.map(([part]) => part), ['indexes', 'mutations', 'migrations']);
    const ownEdit = editTypeOf(DictType(VariantType({ own: StringType }), Order));
    for (const [part, types] of handed) {
      assert.ok(isTypeEqual(types.state, Orders), `${part}: the state the sources make`);
      assert.ok(isTypeEqual(types.key, OrdersKey), `${part}: the record's key, a case a source`);
      assert.ok(isTypeEqual(types.edit as typeof ownEdit, ownEdit), `${part}: the capability over the solution's own keys`);
    }
    assert.ok(isTypeEqual(orders.mutations.plan_order.argTypes[0]!, StringType), 'the capability apart, as the state is');
    assert.equal(orders.mutations.plan_order.argTypes.length, 2);
  });

  it('R1 — an edit body handed the record\'s edit cannot name an external source\'s entry: it does not compile, nor build', () => {
    assert.throws(() => e3.recordComposite('orders', Order, {
      sources: erpAndOwn,
      mutations: (mutation, { state, edit }) => ({
        take: mutation.edit(East.function([state, StringType, Order, edit], NullType, ($, _current, id, order, edit) => {
          // @ts-expect-error the capability writes the record's own sources, and 'erp' is no case of their key
          $(edit.set(variant('erp', id), order));
        })),
      }),
    }), /Variant case erp not found in type/);
  });

  it('R1 — a record of external sources alone is handed no edit, and declares no mutation', () => {
    let handed: RecordTypes<EastTypeOf<'erp'>, unknown> | undefined;
    const orders = e3.recordComposite('erp_orders', Order, {
      sources: (source) => ({ erp: source.load(StringType, ErpDelivery, loadErp) }),
      indexes: (index, types) => {
        handed = types;
        return { by_customer: index.on(['customer']) };
      },
    });
    assert.ok(handed !== undefined && handed.edit === undefined);
    assert.ok(isTypeEqual(orders.type, DictType(VariantType({ erp: StringType }), Order)));
    assert.deepEqual(Object.keys(orders.mutations), []);
  });

  it('R1 — initial names each solution source\'s entries by its own key, and e3 puts the source\'s case on', () => {
    const planned = { customer: 'Acme', status: 'planned', qty: 4n };
    const held = { customer: 'Birch', status: 'held', qty: 1n };
    const first = { customer: 'Cole', status: 'planned', qty: 9n };
    const orders = e3.recordComposite('orders', Order, {
      sources: (source) => ({
        erp: source.load(StringType, ErpDelivery, loadErp),
        own: source.mutations(StringType),
        slots: source.mutations(IntegerType),
      }),
      initial: { slots: new Map([[2n, held], [1n, first]]), own: new Map([['P-1', planned]]) },
    });
    const state = orders.default;
    assert.ok(state !== undefined, 'a composite always holds a state');
    const expected = new SortedMap<ValueTypeOf<typeof orders.type.key>, ValueTypeOf<typeof Order>>([
      [variant('own', 'P-1'), planned], [variant('slots', 1n), first], [variant('slots', 2n), held],
    ], compareFor(orders.type.key));
    assert.ok(equalFor(orders.type)(state, expected), printFor(orders.type)(state));
    // Each source's entries are one run of the record, in the order of its key
    const print = printFor(orders.type.key);
    assert.deepEqual([...state.keys()].map((key) => print(key)), ['.own "P-1"', '.slots 1', '.slots 2']);
  });

  it('R1 — a composite declared with no initial holds no entries, and a source initial does not name starts with none', () => {
    const none = e3.recordComposite('orders', Order, { sources: erpAndOwn });
    assert.ok(none.default !== undefined && equalFor(Orders)(none.default, new SortedMap([], compareFor(OrdersKey))));
    const unnamed = e3.recordComposite('orders', Order, { sources: erpAndOwn, initial: {} });
    assert.ok(unnamed.default !== undefined && equalFor(Orders)(unnamed.default, new SortedMap([], compareFor(OrdersKey))));
  });

  it('R1 — a source\'s initial entries are made by the function given for them once, when first read, never as the record is declared', () => {
    let made = 0;
    const orders = e3.recordComposite('orders', Order, {
      sources: erpAndOwn,
      initial: { own: () => { made++; return new Map([['P-1', { customer: 'Acme', status: 'planned', qty: 4n }]]); } },
    });
    assert.equal(made, 0, 'declared, nothing made');
    const state = orders.default;
    assert.ok(state !== undefined && state.size === 1);
    assert.equal(orders.default, state, 'made once, then held');
    assert.equal(made, 1);
  });

  it('R1 — a load\'s delivery that is not keyed as its source runs as one piece, and a load names its runner', () => {
    const Lines = ArrayType(StructType({ id: StringType, cust: StringType }));
    const loadLines = East.function([Lines, Entries], PatchType(Entries), ($, _lines, current) => East.diff(current, current));
    const byOther = East.function([DictType(IntegerType, ErpOrder), Entries], PatchType(Entries), ($, _delivery, current) => East.diff(current, current));
    const ofIds = East.function([SetType(StringType), Entries], PatchType(Entries), ($, _ids, current) => East.diff(current, current));
    const orders = e3.recordComposite('orders', Order, {
      sources: (source) => ({
        lines: source.load(StringType, Lines, loadLines, { runner: { runtime: 'east-node', platforms: [] } }),
        other: source.load(StringType, DictType(IntegerType, ErpOrder), byOther),
        ids: source.load(StringType, SetType(StringType), ofIds),
      }),
    });
    assert.deepEqual(Object.values(orders.sources).map((source) => [source.name, source.load.keyed]), [['lines', false], ['other', false], ['ids', true]]);
    assert.deepEqual(orders.sources.lines.load.runner, { runtime: 'east-node', platforms: [] });
  });
});

/** A composite's state type over one source, for the test that hands it. */
type EastTypeOf<Name extends string> = DictType<VariantType<Record<Name, StringType>>, typeof Order>;

describe('e3.recordComposite refuses, naming the record and the source or the part', () => {
  const orderOf = (id: string): ValueTypeOf<typeof Order> => ({ customer: id, status: 'planned', qty: 1n });

  it('R2 — a source whose name is not an identifier, no source, and a source the builder did not make', () => {
    assert.throws(() => e3.recordComposite('orders', Order, { sources: (source) => ({ 'erp orders': source.mutations(StringType) }) }),
      /^Error: e3\.recordComposite 'orders': source 'erp orders' must be named by an identifier — it is a case of the record's key, and names its load's commits$/);
    assert.throws(() => e3.recordComposite('orders', Order, { sources: () => ({}) }),
      /^Error: e3\.recordComposite 'orders' declares no source — a composite record holds its sources' entries: declare each as source\.load\(key, delivery, fn\) or source\.mutations\(key\)$/);
    assert.throws(() => e3.recordComposite('orders', Order, {
      // @ts-expect-error a source is made by the source builder
      sources: () => ({ own: { key: StringType } }),
    }), /^Error: e3\.recordComposite 'orders': source 'own' is not one the source builder made — declare it as source\.mutations\(key\) and the like$/);
    assert.throws(() => e3.recordComposite('orders', Order, {
      // @ts-expect-error the sources come back by name
      sources: (source) => [source.mutations(StringType)],
    }), /^Error: e3\.recordComposite 'orders': sources returns its parts by name, as an object — \{ erp: source\.load\(key, delivery, fn\), own: source\.mutations\(key\) \}$/);
  });

  it('R2 — a load whose function is async, or calls a platform function', () => {
    const later = East.asyncFunction([ErpDelivery, Entries], PatchType(Entries), ($, _delivery, current) => East.diff(current, current));
    assert.throws(() => e3.recordComposite('orders', Order, {
      // @ts-expect-error a load's function is synchronous
      sources: (source) => ({ erp: source.load(StringType, ErpDelivery, later) }),
    }), /^Error: e3\.recordComposite 'orders': source\.load 'erp' function .*async.*a load runs again a piece at a time, from its cache and after a rollback, and must give the same entries each time\.$/s);
    const now = East.platform('test_now', [], StringType);
    const stamped = East.function([ErpDelivery, Entries], PatchType(Entries), ($, _delivery, current) => {
      const next = $.let(current.copy());
      $(next.insertOrUpdate('now', { customer: now(), status: 'planned', qty: 1n }));
      return East.diff(current, next);
    });
    assert.throws(() => e3.recordComposite('orders', Order, { sources: (source) => ({ erp: source.load(StringType, ErpDelivery, stamped) }) }),
      /^Error: e3\.recordComposite 'orders': source\.load 'erp' function .*test_now.*so a platform call makes the entries it commits depend on when it ran\.$/s);
  });

  it('R2 — a load whose function is not (delivery, Dict<key, Row>) -> Patch(Dict<key, Row>), naming the signature it takes and the one given', () => {
    const whole = East.function([ErpDelivery, Entries], Entries, ($, _delivery, current) => current);
    assert.throws(() => e3.recordComposite('orders', Order, {
      // @ts-expect-error a load returns a patch of the source's entries, not the entries
      sources: (source) => ({ erp: source.load(StringType, ErpDelivery, whole) }),
    }), /^Error: e3\.recordComposite 'orders': source\.load 'erp' function takes a delivery and the source's entries by its own key, and returns a patch of the entries — \(\.Dict .+\) -> \.Variant .+ — but is \(\.Dict .+\) -> \.Dict /s);
    assert.throws(() => e3.recordComposite('orders', Order, {
      // @ts-expect-error the function's delivery is the source's
      sources: (source) => ({ erp: source.load(StringType, SetType(StringType), loadErp) }),
    }), /^Error: e3\.recordComposite 'orders': source\.load 'erp' function takes a delivery and the source's entries by its own key/);
    assert.throws(() => e3.recordComposite('orders', Order, {
      // @ts-expect-error the function's entries are keyed by the source's key
      sources: (source) => ({ erp: source.load(IntegerType, ErpDelivery, loadErp) }),
    }), /^Error: e3\.recordComposite 'orders': source\.load 'erp' function takes a delivery and the source's entries by its own key/);
  });

  it('R2 — a source keyed by no type, or by a type no Dict is keyed by; a delivery that is no type; an option a source does not take', () => {
    assert.throws(() => e3.recordComposite('orders', Order, {
      // @ts-expect-error a source's key is an East type
      sources: (source) => ({ own: source.mutations('String') }),
    }), /^Error: e3\.recordComposite 'orders': source\.mutations 'own' takes an East type as its key — source\.mutations\(key\)$/);
    assert.throws(() => e3.recordComposite('orders', Order, { sources: (source) => ({ own: source.mutations(ArrayType(StringType)) }) }),
      /^Error: e3\.recordComposite 'orders': source\.mutations 'own' is keyed by \.Array \.String, which no Dict is keyed by: a source's key is an immutable type, as a Dict's is$/);
    assert.throws(() => e3.recordComposite('orders', Order, {
      // @ts-expect-error a load is delivered a type
      sources: (source) => ({ erp: source.load(StringType, { rows: ErpDelivery }, loadErp) }),
    }), /^Error: e3\.recordComposite 'orders': source\.load 'erp' takes an East type as what it is delivered — source\.load\(key, delivery, fn\)$/);
    assert.throws(() => e3.recordComposite('orders', Order, {
      // @ts-expect-error a source takes its runner alone
      sources: (source) => ({ erp: source.load(StringType, ErpDelivery, loadErp, { value: loadErp }) }),
    }), /^Error: e3\.recordComposite 'orders': source\.load 'erp' takes runner, not value$/);
  });

  it('R2 — mutations declared with no source of the solution\'s own to write', () => {
    assert.throws(() => e3.recordComposite('orders', Order, {
      sources: (source) => ({ erp: source.load(StringType, ErpDelivery, loadErp) }),
      mutations: (mutation) => ({ patch: mutation.patch() }),
    }), /^Error: e3\.recordComposite 'orders' declares mutations, and has no source of its own for them to write: every source is a load's — declare one as source\.mutations\(key\)$/);
  });

  it('R2 — an initial that names an external source, no source of the record, or entries that are not the source\'s', () => {
    assert.throws(() => e3.recordComposite('orders', Order, {
      sources: erpAndOwn,
      // @ts-expect-error an external source has no initial entries
      initial: { erp: new Map([['SO-1', orderOf('Acme')]]) },
    }), /^Error: e3\.recordComposite 'orders': initial names 'erp', an external source — its entries come from its load, and it holds none until its first delivery$/);
    assert.throws(() => e3.recordComposite('orders', Order, {
      sources: erpAndOwn,
      // @ts-expect-error initial names the record's own sources
      initial: { plans: new Map() },
    }), /^Error: e3\.recordComposite 'orders': initial names 'plans', which is no source of the record — its sources are 'erp', 'own'$/);
    assert.throws(() => e3.recordComposite('orders', Order, {
      sources: erpAndOwn,
      // @ts-expect-error a source's entries are keyed by its own key
      initial: { own: new Map([[1n, orderOf('Acme')]]) },
    }), /^Error: e3\.recordComposite 'orders': initial\.own holds the source's entries by its own key, a \.Dict \(key=\.String, value=\.Struct /);
    assert.throws(() => e3.recordComposite('orders', Order, {
      sources: erpAndOwn,
      // @ts-expect-error initial names each source's entries
      initial: new Map(),
    }), /^Error: e3\.recordComposite 'orders': initial names the entries of each source of its own, by the source's own key — initial: \{ own: new Map\(\) \}$/);
  });

  it('R2 — a declaration that is not one: no sources, a key it does not take, a part that is not a function', () => {
    // @ts-expect-error a composite declares its sources
    assert.throws(() => e3.recordComposite('orders', Order, { initial: {} }),
      /^Error: e3\.recordComposite 'orders' declares its sources first, as a function of its builder — sources: \(source\) => \(\{ own: source\.mutations\(key\) \}\)$/);
    // @ts-expect-error a composite's parts are its sources, indexes, mutations and migrations
    assert.throws(() => e3.recordComposite('orders', Order, { sources: erpAndOwn, views: () => ({}) }),
      /^Error: e3\.recordComposite 'orders' takes sources, initial, indexes, mutations and migrations, not 'views'$/);
    // @ts-expect-error a composite takes its declaration as an object
    assert.throws(() => e3.recordComposite('orders', Order, new Map()),
      /^Error: e3\.recordComposite 'orders' takes its declaration as \{ sources, initial\?, indexes\?, mutations\?, migrations\? \}$/);
    // @ts-expect-error each part is a function of its builder
    assert.throws(() => e3.recordComposite('orders', Order, { sources: erpAndOwn, mutations: { patch: e3.mutation.editType(Orders) } }),
      /^Error: e3\.recordComposite 'orders': mutations is a function of its builder — mutations: \(mutation\) => …$/);
  });

  it('R2 — what e3.record refuses of a part, naming the composite: an edit body whose last parameter is no capability of the record\'s', () => {
    assert.throws(() => e3.recordComposite('orders', Order, {
      sources: erpAndOwn,
      mutations: (mutation, { state }) => ({
        take: mutation.edit(East.function([state, StringType, editTypeOf(Entries)], NullType, ($, _current, id, edit) => {
          $(edit.delete(id));
        })),
      }),
    }), /^Error: e3\.recordComposite 'orders': mutation\.edit 'take' body's LAST parameter must be the edit capability \.Struct .+ — the `edit` its mutations are handed, \(mutation, \{ state, edit \}\) => …, which writes the entries of the record's own sources — but got \.Struct /s);
    assert.throws(() => e3.recordComposite('orders', Order, {
      sources: erpAndOwn,
      indexes: (index) => ({ primary: index.on(['customer']) }),
    }), /^Error: e3\.recordComposite 'orders': index\.on cannot be named 'primary'/);
  });
});
