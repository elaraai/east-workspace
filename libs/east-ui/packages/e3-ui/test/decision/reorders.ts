/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */
/**
 * The decision queue's paged example (#1455, #1458, `Decision Queue Spec.md`
 * §3.5, §15): a replenishment model's reorders across a chain of forty stores
 * — 20,000 of them, an item at a store each, each its own one proposal (D15),
 * each carrying the verdict the queue writes — and the chain's stock levels
 * they change, a row an item at a store. The rail narrows the reorders through
 * the app's own indexes on their judgement, their store and their range (D18),
 * the queue reading the narrowing a page at a time as the list scrolls, in the
 * index's order (D4, D5). The same pure generators give both records' keys and
 * rows, so each reorder's patch is of its own stock row. Every name and figure
 * is generated.
 */
import {
    ArrayType, DateTimeType, DictType, East, FloatType, IntegerType, NullType, OptionType, PatchType, StringType, StructType, VariantType, none, some, variant,
} from "@elaraai/east";
import e3 from "@elaraai/e3";
import { StockLevel } from "./ops.js";

/** The chain's stock levels, by an item at a store. */
const ChainStock = DictType(StringType, StockLevel);

/** What a reorder changes: its tag is the kind of decision, its value a patch of the record that kind changes. */
export const ReorderChange = VariantType({
    stock: PatchType(ChainStock),  // the chain's stock levels, which no builder draws
});

/** A person's verdict on a reorder: waiting, as the model writes every reorder, until a person decides it. */
export const ReorderVerdict = VariantType({ waiting: NullType, applied: NullType, overridden: NullType, deferred: NullType, handedOff: NullType });

/** A reorder the replenishment model proposes, in the app's own words: one item at one store, its own one proposal — and the verdict on it. */
export const Reorder = StructType({
    store: StringType, range: StringType, due: OptionType(DateTimeType), run: StringType, why: StringType,
    title: StringType, summary: StringType, detail: StringType, uplift: FloatType, confidence: FloatType, change: ReorderChange,
    verdict: ReorderVerdict, note: OptionType(StringType),
});

/** The reorders, by an item at a store. */
const Reorders = DictType(StringType, Reorder);

/** The `i`-th reorder's store: one of forty, `Store 101` to `Store 140`. */
export const reorderStore = East.function([IntegerType], StringType, (_$, i) => East.str`Store ${i.remainder(40n).add(101n)}`);

/** The `i`-th reorder's range: each store's items run through the five in turn. */
export const reorderRange = East.function([IntegerType], StringType, ($, i) => {
    const ranges = $.const(["Envelopes", "Labels", "Folders", "Notebooks", "Cards"], ArrayType(StringType));
    return ranges.get(i.divide(40n).remainder(5n));
});

/** The `i`-th reorder's item: its range's code and its number, `EN-1001` to `CD-1100`. */
export const reorderItem = East.function([IntegerType], StringType, ($, i) => {
    const codes = $.const(["EN", "LB", "FD", "NB", "CD"], ArrayType(StringType));
    return East.str`${codes.get(i.divide(40n).remainder(5n))}-${i.divide(200n).add(1001n)}`;
});

/** The `i`-th reorder's key, and its stock row's: its store's number and its item, `101/EN-1001`. */
export const reorderKey = East.function([IntegerType], StringType, ($, i) => {
    const itemOf = $.const(reorderItem);
    return East.str`${i.remainder(40n).add(101n)}/${itemOf(i)}`;
});

/** The `i`-th item's stock-out risk in the fortnight ahead with nothing on order, in percent: 12 to 51. */
const reorderRisk = East.function([IntegerType], IntegerType, (_$, i) => i.multiply(7n).remainder(40n).add(12n));

/** The `i`-th item's stock row as the chain holds it: nothing on order, and its risk. */
const reorderStock = East.function([IntegerType], StockLevel, ($, i) => {
    const storeOf = $.const(reorderStore);
    const itemOf = $.const(reorderItem);
    const riskOf = $.const(reorderRisk);
    const nothing = $.const(0.0);
    return { item: East.str`${itemOf(i)} · ${storeOf(i)}`, onOrder: nothing, risk: riskOf(i).toFloat() };
});

/** The chain's stock levels, `count` of them: an item at a store a row. */
const generateChainStock = East.function([IntegerType], ChainStock, ($, count) => {
    const rows = $.let(new Map(), ChainStock);
    const keyOf = $.const(reorderKey);
    const stockOf = $.const(reorderStock);
    const i = $.let(0n);
    $.while(i.less(count), ($2) => {
        $2(rows.insert(keyOf(i), stockOf(i)));
        $2.assign(i, i.add(1n));
    });
    return rows;
});

/**
 * The reorders, `count` of them: an item at a store each, between 200 and 900 units, its change the patch of that
 * item's stock row alone — East's own diff of the row before and after — and due from 09:00 on Tuesday 10 March 2026
 * every twelve hours to Saturday's, so at the examples' `now` some are overdue, some due today and the rest this week.
 * Each waits, as the model writes it, with no note.
 */
const generateReorders = East.function([IntegerType], Reorders, ($, count) => {
    const rows = $.let(new Map(), Reorders);
    const keyOf = $.const(reorderKey);
    const storeOf = $.const(reorderStore);
    const rangeOf = $.const(reorderRange);
    const itemOf = $.const(reorderItem);
    const riskOf = $.const(reorderRisk);
    const stockOf = $.const(reorderStock);
    const from = $.const(new Date("2026-03-10T09:00:00Z"));
    const run = $.const("replen-v1.4 · run #31");
    const waiting = $.const(variant("waiting", null), ReorderVerdict);
    const noNote = $.const(none, OptionType(StringType));
    const i = $.let(0n);
    $.while(i.less(count), ($2) => {
        const key = $2.const(keyOf(i));
        const store = $2.const(storeOf(i));
        const item = $2.const(itemOf(i));
        const units = $2.const(i.remainder(8n).add(2n).multiply(100n));
        const risk = $2.const(riskOf(i));
        const after = $2.const(risk.divide(6n));
        const held = $2.const(stockOf(i));
        // The item's stock row as the model read it, and as the reorder leaves it.
        const before = $2.let(new Map(), ChainStock);
        $2(before.insert(key, held));
        const ordered = $2.let(new Map(), ChainStock);
        $2(ordered.insert(key, { item: held.item, onOrder: units.toFloat(), risk: after.toFloat() }));
        $2(rows.insert(key, {
            store, range: rangeOf(i), due: some(from.addMilliseconds(i.remainder(9n).multiply(43_200_000n))), run,
            why: East.str`${item} falls under its safety level at ${store} within the fortnight; the supplier needs 6 days.`,
            title: East.str`Reorder ${units} units of ${item} at ${store}`,
            summary: East.str`on order 0 → ${units}`,
            detail: East.str`Stock-out risk ${risk}% → ${after}%.`,
            uplift: units.multiply(i.remainder(5n).add(3n)).toFloat(),
            confidence: i.remainder(35n).toFloat().divide(100.0).add(0.6),
            change: variant("stock", East.diff(before, ordered)),
            verdict: waiting, note: noNote,
        }));
        $2.assign(i, i.add(1n));
    });
    return rows;
});

/** The chain's stock levels, which no builder draws: 20,000 rows, made by their generator, written through their patch door. */
export const chainStock = e3.record("chain_stock", ChainStock, {
    initial: () => East.compile(generateChainStock, [])(20000n),
    mutations: (mutation) => ({
        patch: mutation.patch(),
    }),
});

/** The reorders: 20,000, made by their generator, with the patch door the queue writes each verdict through. */
export const reorders = e3.record("reorders", Reorders, {
    initial: () => East.compile(generateReorders, [])(20000n),
    indexes: (index) => ({
        // The app's own: whether anyone has judged a reorder — its verdict's tag — then its store and its range, or its range.
        reorders_by_judgement: index.key(East.function([StringType, Reorder], StructType({ judgement: StringType, store: StringType, range: StringType }),
            (_$, _key, r) => ({ judgement: r.verdict.getTag(), store: r.store, range: r.range }))),
        reorders_by_judgement_range: index.key(East.function([StringType, Reorder], StructType({ judgement: StringType, range: StringType }),
            (_$, _key, r) => ({ judgement: r.verdict.getTag(), range: r.range }))),
    }),
    mutations: (mutation) => ({
        patch: mutation.patch(),
    }),
});
