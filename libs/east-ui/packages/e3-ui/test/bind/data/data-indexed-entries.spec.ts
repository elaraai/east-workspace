/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

/**
 * `Data.bindPaged(record, { indexes })` beside a record's entries index
 * (#1522), reading no e3: the binding offers the rail the Dict field the index
 * files — its metadata the field, a Set marker of the Dict's key type, and its
 * kind `entries` — pages the record's lean rows, the field emptied, through its
 * other indexes, and reads a row's keys under the index as e3 files them; and
 * the rail over it lists the Dict's keys from its hints, takes several and
 * searches none. What each refuses, in its words.
 */

import { describe, test } from "node:test";
import assert from "node:assert/strict";
import {
    DictType, East, Expr, IntegerType, NullType, SetType, StringType, StructType, VariantType, equalFor, isTypeEqual, printFor, variant,
    type ArrayType, type EastType, type FunctionType, type ValueTypeOf,
} from "@elaraai/east";
import e3 from "@elaraai/e3";
import { bindRecord, type RecordSliceConfigType } from "@elaraai/east-ui/internal";
import { Data } from "@elaraai/e3-ui";
import { refusingPlatform } from "../../refusing-platform.js";

/** One service's share of what a station measured. */
const Share = StructType({ parcels: IntegerType, late: IntegerType });
/** A station's evidence, each service's share filed apart under the service's name. */
const Evidence = StructType({ station: StringType, parcels: IntegerType, byService: DictType(StringType, Share) });
const evidence = e3.record("data_entries_evidence", DictType(StringType, Evidence), {
    initial: new Map(),
    indexes: (index) => ({
        evidence_by_service: index.entries("byService"),
        evidence_by_station: index.on(["station"]),
        evidence_station_parcels: index.on(["station"], { value: East.function([StringType, Evidence], IntegerType, (_$, _key, row) => row.parcels) }),
    }),
});

/** A binding's handle type, as its expression holds it. */
const typeOf = (source: unknown) => Expr.type(source as Expr) as StructType;
/** The projection a binding's entries carry, and the row they join: the `some` of their `value` and their `row`. */
const entryOf = (source: unknown) => {
    const page = typeOf(source).fields.page as FunctionType;
    const entry = ((page.output as VariantType).cases.some as ArrayType<StructType>).value;
    return { projection: (entry.fields.value as VariantType).cases.some!, row: (entry.fields.row as VariantType).cases.some! };
};
/** A binding's handle, built on a platform that reads nothing. */
const handleOf = (source: unknown) => East.compile(East.function([], typeOf(source), ($) => $.return(source as Expr)), refusingPlatform)() as {
    readonly indexes: unknown; readonly joined: boolean; readonly defaultIndex: string;
    readonly entryKeys: (index: string, key: string, row: unknown) => readonly string[];
};

/** How the binding describes the entries index to the rail: the Dict field, a Set marker of its key type, and the kind. */
const EntriesMeta = StructType({ fields: StructType({ byService: SetType(StringType) }), kind: VariantType({ entries: NullType }) });
/** How it describes a plain index. */
const PlainMeta = StructType({ fields: StructType({ station: NullType }), kind: VariantType({ plain: NullType }) });

describe("Data.bindPaged beside an entries index", () => {
    test("offers the rail the Dict field the index files, a Set marker of its key type, its kind `entries`; pages the row, joined", () => {
        const source = Data.bindPaged(evidence, { indexes: ["evidence_by_service"] });
        const indexes = typeOf(source).fields.indexes!;
        assert.ok(isTypeEqual(indexes, StructType({ evidence_by_service: EntriesMeta })), "the field as a Set of the services' names, the kind entries");
        const handle = handleOf(source);
        assert.ok(equalFor(indexes)(handle.indexes, { evidence_by_service: { fields: { byService: new Set() }, kind: variant("entries", null) } }));
        const { projection, row } = entryOf(source);
        assert.ok(isTypeEqual(projection, Evidence) && isTypeEqual(row, Evidence), "an entry's value is the row's type: the lean row, its services emptied");
        assert.equal(handle.joined, true, "joined: the unfiltered view is the record's own rows");
        assert.equal(handle.defaultIndex, "primary");
        const keys = ((((typeOf(source).fields.page as FunctionType).output as VariantType).cases.some as ArrayType<StructType>).value.fields.ik as VariantType).cases;
        assert.deepEqual(Object.keys(keys).sort(), ["evidence_by_service", "primary"]);
        assert.ok(isTypeEqual(keys.evidence_by_service!, evidence.indexes.evidence_by_service.keyType), "searched by e3's own key: a service's name, then the row's");
    });

    test("beside it, an index carrying nothing pages the lean rows: the row its projection, each index described", () => {
        const source = Data.bindPaged(evidence, { indexes: ["evidence_by_station", "evidence_by_service"] });
        const indexes = typeOf(source).fields.indexes!;
        assert.ok(isTypeEqual(indexes, StructType({ evidence_by_station: PlainMeta, evidence_by_service: EntriesMeta })));
        assert.ok(isTypeEqual(entryOf(source).projection, Evidence), "the lean row, never a projection of the station alone");
        assert.equal(handleOf(source).defaultIndex, "primary");
    });

    test("reads a row's keys under the entries index as e3 files them: the services it holds, each printed at the Dict's key type", () => {
        const handle = handleOf(Data.bindPaged(evidence, { indexes: ["evidence_by_service"] }));
        const row = {
            station: "Sort", parcels: 465n,
            byService: new Map([["Standard", { parcels: 335n, late: 1n }], ["Priority", { parcels: 130n, late: 2n }]]),
        };
        const printKey = printFor(StringType);
        assert.deepEqual([...handle.entryKeys("evidence_by_service", "SRD", row)], ["Priority", "Standard"].map((service) => printKey(service)),
            "a key a service, in the Dict's order");
        assert.deepEqual([...handle.entryKeys("evidence_by_service", "IDL", { station: "Idle", parcels: 0n, byService: new Map() })], [], "no service: no entry");
    });

    test("binds an index carrying a value of its own apart, and the record's rows whole", () => {
        const apart = Data.bindPaged(evidence, { indexes: ["evidence_station_parcels"] });
        assert.ok(isTypeEqual(entryOf(apart).projection, IntegerType), "its own value");
        assert.doesNotThrow(() => Data.bindPaged(evidence));
    });

    test("the rail offers the Dict field: its hints its values, several taken, never searched — refused with no hints, and in search", () => {
        const rail = (options: object): ValueTypeOf<RecordSliceConfigType> => {
            const sliced = bindRecord("evidence", Data.bindPaged(evidence, { indexes: ["evidence_by_station", "evidence_by_service"] }), options as never);
            const type = Expr.type(sliced) as EastType;
            return (East.compile(East.function([], type, ($) => $.return(sliced)), refusingPlatform)() as { readonly config: ValueTypeOf<RecordSliceConfigType> }).config;
        };
        const config = rail({ fields: { station: { label: "Station", hints: ["Sort"] }, byService: { label: "Service", hints: ["Standard", "Priority"] } } });
        const service = config.fields.find((field) => field.fieldId === "byService");
        if (service === undefined) assert.fail("the Dict field offered");
        assert.equal(service.label, "Service");
        assert.equal(service.multiple, true, "several keys taken");
        assert.equal(service.set, false, "never one, as a Set field's element is");
        const printKey = printFor(StringType);
        assert.deepEqual(service.values.map((value) => [value.value, value.label]), [[printKey("Standard"), "Standard"], [printKey("Priority"), "Priority"]],
            "its hints, each a key as an `.east` literal");
        const index = config.indexes.find((candidate) => candidate.name === "evidence_by_service");
        if (index === undefined) assert.fail("the entries index described");
        assert.equal(index.entries, true);
        assert.deepEqual([...index.fields], ["byService"]);
        assert.equal(index.sets.size, 0, "no path fans out over it: it narrows nothing");
        assert.deepEqual([...config.search], ["station"], "a String field searched unless told; the Dict field never");
        assert.throws(() => rail({ fields: { byService: { label: "Service" } } }), {
            message: "Slice.bindRecord: 'Service' offers nothing to choose — give it hints, the keys of 'byService' it lists",
        });
        assert.throws(() => rail({ fields: { byService: { label: "Service", hints: ["Standard"] } }, search: "byService" }), {
            message: "Slice.bindRecord: 'byService' is a Dict field the rail lists by its hints, and is not searched — leave it out of search",
        });
    });

    test("refuses, in its words, an index carrying lean rows without the entries index, and a value of its own beside it", () => {
        assert.throws(() => Data.bindPaged(evidence, { indexes: ["evidence_by_station"] }), {
            message: "Data.bindPaged: record 'data_entries_evidence' files 'byService' entry by entry, and 'evidence_by_station' carries each row " +
                "with that field emptied — list 'evidence_by_service' beside it",
        });
        assert.throws(() => Data.bindPaged(evidence, { indexes: ["evidence_by_station", "evidence_station_parcels", "evidence_by_service"] }), {
            message: "Data.bindPaged: 'evidence_station_parcels' carries a value of its own beside 'evidence_by_service', whose record's other indexes " +
                "carry each row with its entries emptied — leave its value out, or bind it apart",
        });
    });
});
