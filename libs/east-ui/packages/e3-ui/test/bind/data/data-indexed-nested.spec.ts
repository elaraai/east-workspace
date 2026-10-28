/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

/**
 * `Data.bindPaged(record, { indexes })` beside a record's nested series index
 * (#1435), reading no e3: the binding pages the record's lean rows through its
 * other indexes, never joining one, and carries how each collection the nested
 * index files is declared — its part's type the structure, its value the
 * index's name, tile and summary beside it. What it refuses, in its words, and
 * what a UI binding it declares it reads.
 */

import { describe, test } from "node:test";
import assert from "node:assert/strict";
import {
    ArrayType, DateTimeType, DictType, East, Expr, IRType, NullType, SortedMap, StringType, StructType, compareFor, decodeBeast2For,
    encodeBeast2For, equalFor, isTypeEqual, isValueOf, none, some, variant,
    type FunctionType, type IR, type ValueTypeOf, type VariantType,
} from "@elaraai/east";
import { Reactive, Text, UIComponentType, bindRecord, resolveRowSource, type ResolvedRowSource } from "@elaraai/east-ui/internal";
import { Data, NestedPartType, Sheet, deriveUiAccess, orderedRowSource } from "@elaraai/e3-ui/internal";
import { refusingPlatform } from "../../refusing-platform.js";
import * as ex from "./data-nested.examples.js";

/** A binding's handle type, as its expression holds it. */
const typeOf = (source: unknown) => Expr.type(source as Expr) as StructType;
/** The projection a binding's entries carry, and the row they join: the `some` of their `value` and their `row`. */
const entryOf = (source: unknown) => {
    const page = typeOf(source).fields.page as FunctionType;
    const entry = ((page.output as VariantType).cases.some as ArrayType<StructType>).value;
    return { projection: (entry.fields.value as VariantType).cases.some!, row: (entry.fields.row as VariantType).cases.some! };
};
/** A binding's handle, built on a platform that reads nothing. */
const handleOf = (source: unknown) => East.compile(East.function([], typeOf(source), $ => $.return(source as Expr)), refusingPlatform)() as {
    readonly indexes: Readonly<Record<string, unknown>>; readonly nested: unknown; readonly joined: boolean; readonly defaultIndex: string;
};

/** Each collection's leaf: a role's field, or a kind holding nothing more. */
const LEAF = NullType;
/** An item's times from `start` to `end`, as a binding carries them. */
const Span = { from: StructType({ start: LEAF }), to: StructType({ end: LEAF }) };
/** How the machines' binding carries each collection the nested index files. */
const MachineCollections = StructType({
    alarms: StructType({ items: StructType({ at: StructType({ at: LEAF }) }) }),
    jobs: StructType({ items: StructType(Span) }),
    load: StructType({ values: LEAF }),
    output: StructType({ values: LEAF }),
    stops: StructType({ items: StructType(Span) }),
});

const machines = () => Data.bindPaged(ex.nestedMachines, { indexes: [ex.machinesBySiteStatus, ex.machinesInTime] });

describe("Data.bindPaged beside a nested series index", () => {
    test("pages the lean rows through the other indexes: its projection the row, never joined, the nested index no index of the rail", () => {
        const source = machines();
        const { projection, row } = entryOf(source);
        assert.ok(isTypeEqual(projection, ex.NestedMachine) && isTypeEqual(row, ex.NestedMachine), "an entry's value is the machine's own row");
        const handle = handleOf(source);
        assert.equal(handle.joined, false, "never joined");
        assert.deepEqual(Object.keys(handle.indexes), ["machines_by_site_status"], "the rail's indexes: the one paging the machines");
        assert.equal(handle.defaultIndex, "machines_by_site_status", "the unfiltered view pages the machines through it");
        const keys = ((((typeOf(source).fields.page as FunctionType).output as VariantType).cases.some as ArrayType<StructType>).value.fields.ik as VariantType).cases;
        assert.deepEqual(Object.keys(keys).sort(), ["machines_by_site_status", "machines_in_time", "primary"]);
        assert.ok(isTypeEqual(keys.machines_in_time!, ex.machinesInTime.keyType), "a cell of the nested index searched by e3's own key");
    });

    test("carries each collection's declaration as structure, and the index's name, tile and summary as its value", () => {
        const source = machines();
        const nestedType = typeOf(source).fields.nested!;
        assert.ok(isTypeEqual(nestedType, NestedPartType(MachineCollections, StructType({ machines_in_time: LEAF }))),
            "the index's name, and each collection by its field: what it holds, and its times by role");
        const expected = some({
            index: { machines_in_time: null }, tile: variant("week", null), summary: some(variant("month", null)),
            collections: {
                alarms: { items: { at: { at: null } } }, jobs: { items: { from: { start: null }, to: { end: null } } },
                load: { values: null }, output: { values: null }, stops: { items: { from: { start: null }, to: { end: null } } },
            },
        });
        assert.ok(equalFor(nestedType)(handleOf(source).nested, expected), "the nested part, as the definition declares it");
    });

    test("carries child rows' collections and their rollups, each fold a struct of its aggregates, and a recursive field and a rollup of items", () => {
        const ledgers = Data.bindPaged(ex.nestedLedgers, { indexes: [ex.ledgersByName, ex.ledgersInTime] });
        const Readings = StructType({ values: StructType({ rollup: StructType({ sum: StructType({ sum: LEAF }) }) }) });
        assert.ok(isTypeEqual(typeOf(ledgers).fields.nested!,
            NestedPartType(StructType({ measures: StructType({ rows: StructType({ readings: Readings }) }) }), StructType({ ledgers_in_time: LEAF }))));
        const assemblies = Data.bindPaged(ex.nestedAssemblies, { indexes: [ex.assembliesByName, ex.assembliesInTime] });
        const Jobs = StructType({ items: StructType({ ...Span, rollup: LEAF }) });
        assert.ok(isTypeEqual(typeOf(assemblies).fields.nested!,
            NestedPartType(StructType({ parts: StructType({ rows: StructType({ jobs: Jobs, parts: StructType({ recursive: LEAF }) }) }) }), StructType({ assemblies_in_time: LEAF }))));
    });

    test("binds an index carrying a value of its own apart, joined as any other, and the record's rows whole", () => {
        const apart = Data.bindPaged(ex.nestedMachines, { indexes: [ex.machinesByName] });
        assert.ok(isTypeEqual(entryOf(apart).projection, StringType), "its own value");
        assert.equal(handleOf(apart).joined, true);
        assert.ok(isTypeEqual(typeOf(apart).fields.nested!, NestedPartType(StructType({}), StructType({}))), "no nested part");
        assert.ok(equalFor(typeOf(apart).fields.nested!)(handleOf(apart).nested, none), "none");
        assert.doesNotThrow(() => Data.bindPaged(ex.nestedMachines, { index: ex.machinesByName }));
        assert.doesNotThrow(() => Data.bindPaged(ex.nestedMachines));
    });

    test("refuses, in its words, an index carrying lean rows without the nested index, join, a value of its own beside it, and no index paging the rows", () => {
        assert.throws(() => Data.bindPaged(ex.nestedMachines, { indexes: [ex.machinesBySiteStatus] }), {
            message: "Data.bindPaged: record 'nested_machines' has a nested series index, 'machines_in_time', and 'machines_by_site_status' carries " +
                "each row without the collections it declares — list 'machines_in_time' beside it",
        });
        assert.throws(() => Data.bindPaged(ex.nestedMachines, { indexes: [ex.machinesBySiteStatus, ex.machinesInTime], join: true }), {
            message: "Data.bindPaged: 'machines_in_time' is listed, so the other indexes carry each row without its collections and a page joins " +
                "none — leave join out: a join would read each row whole",
        });
        assert.throws(() => Data.bindPaged(ex.nestedMachines, { indexes: [ex.machinesBySiteStatus, ex.machinesByName, ex.machinesInTime] }), {
            message: "Data.bindPaged: 'machines_by_name' carries a value of its own beside 'machines_in_time', whose record's other indexes carry " +
                "each row without its collections — leave its value out, or bind it apart",
        });
        assert.throws(() => Data.bindPaged(ex.nestedMachines, { indexes: [ex.machinesBySiteStatus, ex.machinesInTime, ex.machinesInTime] }),
            { message: "Data.bindPaged: repeated index 'machines_in_time'" });
        assert.throws(() => Data.bindPaged(ex.nestedMachines, { indexes: [ex.machinesInTime] }), {
            message: "Data.bindPaged: 'machines_in_time' is listed, and no index listed beside it pages the rows of 'nested_machines' — a page reads " +
                "each row through an index carrying it without its collections: list one, e3.recordIndex(name, nested_machines, { on: [field, …] })",
        });
    });

    test("refuses one index read alone where it carries lean rows, or is the nested index", () => {
        assert.throws(() => Data.bindPaged(ex.nestedMachines, { index: ex.machinesBySiteStatus }), {
            message: "Data.bindPaged: record 'nested_machines' has a nested series index, 'machines_in_time', and 'machines_by_site_status' carries " +
                "each row without the collections it declares — bind them together: " +
                "Data.bindPaged(nested_machines, { indexes: [machines_by_site_status, machines_in_time] })",
        });
        assert.throws(() => Data.bindPaged(ex.nestedMachines, { index: ex.machinesInTime }), {
            message: "Data.bindPaged: 'machines_in_time' is a nested series index, whose entries are items, totals and subtotals: a reader reads its " +
                "cells — list it in Data.bindPaged(nested_machines, { indexes })",
        });
    });

    test("a UI binding it declares the nested index among what it reads, before and after decoding", () => {
        const ui = East.function([], UIComponentType, (_$) => Reactive.Root(East.function([], UIComponentType, ($) => {
            $(Data.bindPaged(ex.nestedMachines, { indexes: [ex.machinesBySiteStatus, ex.machinesInTime] }));
            return Text.Root("Machines");
        })));
        const ir = ui.toIR().ir;
        for (const read of [ir, decodeBeast2For(IRType)(encodeBeast2For(IRType)(ir)) as IR]) {
            assert.deepEqual(deriveUiAccess(read).records.map(record => [record.name, [...record.indexes].sort()]),
                [["nested_machines", ["machines_by_site_status", "machines_in_time"]]]);
        }
    });

    test("an ordered source over a narrowed window of lean rows takes each row from its entry's value, keyed and in the index's order, and a Sheet reads it", () => {
        const sliced = bindRecord("machines", machines(), { fields: { site: { hints: [...ex.SITES] } } });
        const resolved = resolveRowSource(sliced.data, "Rows");
        assert.equal(resolved.kind, "ordered");
        const { rows, keys } = orderedRowSource(resolved as Extract<ResolvedRowSource, { kind: "ordered" }>, "Rows");
        type Machine = ValueTypeOf<typeof ex.NestedMachine>;
        const keyOrder = compareFor(StringType);
        const instantOrder = compareFor(DateTimeType);
        const lean = (i: number): Machine => ({
            ...ex.nestedMachine(i), jobs: new SortedMap(undefined, keyOrder), stops: new SortedMap(undefined, keyOrder),
            alarms: new SortedMap(undefined, keyOrder), load: new SortedMap(undefined, instantOrder), output: new SortedMap(undefined, instantOrder),
        });
        // Two entries in the index's order, north's before south's, each carrying its lean row as its value alone, as a runtime may.
        const window = [4, 1].map(i => {
            const machine = lean(i);
            return { ik: variant("machines_by_site_status", { site: machine.site, status: machine.status }), key: `M-00${i}`, value: some(machine), row: none };
        });
        assert.ok(isValueOf(window, resolved.collectionType), "a window as the narrowed source serves it");
        const Keyed = DictType(StringType, ex.NestedMachine);
        const keyedEqual = equalFor(Keyed);
        const keyed = East.compile(rows, [])(window);
        assert.ok(isValueOf(keyed, Keyed) && keyedEqual(keyed as Parameters<typeof keyedEqual>[0], new SortedMap([["M-001", lean(1)], ["M-004", lean(4)]], keyOrder)),
            "each row its entry's value, by its key");
        assert.deepEqual(East.compile(keys, [])(window), ["M-004", "M-001"], "in the index's order");
        assert.doesNotThrow(() => Sheet.Root(sliced.data, { name: Sheet.column.text(ex.NestedMachine, { header: "Name" }) }, {}),
            "a Sheet pages the lean rows, its columns the machine's own fields");
    });
});

