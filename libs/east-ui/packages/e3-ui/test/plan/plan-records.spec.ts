/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */
import { describe, test } from "node:test";
import assert from "node:assert/strict";
import { DictType, East, IntegerType, OptionType, StringType, StructType, decodeBeast2For, encodeBeast2For, none, some, type EastIR } from "@elaraai/east";
import { Paged, UIComponentType } from "@elaraai/east-ui";
import { Plan, PlanPayloadType, deriveManifest } from "@elaraai/e3-ui/internal";
import { indexedWorkOrders } from "../sheet/sheet-records.examples.js";
import * as ex from "./plan-records.examples.js";

for (const example of [ex.planRecordIndexes, ex.planRecordIndexesMobile]) {
    test(example.description, () => {
        const manifest = deriveManifest(example.fn);
        // The work orders and their operations are each read a page, a search or a cell at a time, never whole.
        assert.deepEqual(manifest.pages, [ex.planOperations.path, indexedWorkOrders.path]);
        assert.equal(manifest.paths.length, 0, "the Plan never reads either record whole");
        // The operations are the record the Plan writes, through their patch door; the work orders it only reads.
        assert.deepEqual(manifest.records, [ex.planOperations.name]);
        const component = (example.fn.toIR() as EastIR<[], typeof UIComponentType>).compile([])();
        assert.equal(decodeBeast2For(UIComponentType)(encodeBeast2For(UIComponentType)(component)).type, component.type);
    });
}

/** A row of the canvases below. */
const Row = StructType({ name: StringType });
const Rows = DictType(StringType, Row);
/** Six rows, `r00` to `r05`. */
const SIX = new Map(Array.from({ length: 6 }, (_, i) => [`r0${i}`, { name: `Row ${i}` }] as const));
/** The six rows, paged: a window of two entries is served, and a window of any other size is none. */
const PAIRS = {
    id: "pairs",
    page: East.function([IntegerType, IntegerType], OptionType(Rows), ($, offset, limit) => {
        const all = $.const(SIX, Rows);
        const keys = $.let(all.toArray((_$2, _row, key) => key));
        const served = $.let(none, OptionType(Rows));
        $.if(limit.equal(2n), ($2) => { $2.assign(served, some(all.getKeys(keys.slice(offset, offset.add(limit)).toSet()))); });
        return served;
    }),
    total: East.function([], OptionType(IntegerType), () => some(6n)),
    seek: none,
};

describe("a grouped Plan read a hall at a time (#1714)", () => {
    test("forty halls of 75 presses each, keyed in their order, each press's two jobs a week apart", () => {
        const halls = ex.planHalls.default!;
        assert.equal(halls.size, 40);
        assert.deepEqual([...halls.keys()].slice(0, 3), ["H-101", "H-102", "H-103"]);
        assert.deepEqual([...halls.values()].map((hall) => hall.presses.size), Array.from({ length: 40 }, () => 75));
        const first = halls.get("H-101")!;
        assert.equal(first.name, "Hall 1");
        assert.deepEqual([...first.presses.keys()].slice(0, 2), ["P-101", "P-102"]);
        for (const press of first.presses.values()) {
            const [one, two] = [...press.jobs.values()];
            assert.equal(two!.start.getTime() - one!.start.getTime(), 7 * 86_400_000, `${press.label}: its jobs a week apart`);
        }
    });

    test(ex.planGroupWindows.description, () => {
        const manifest = deriveManifest(ex.planGroupWindows.fn);
        // The halls are read a window at a time, never whole.
        assert.deepEqual(manifest.pages, [ex.planHalls.path]);
        assert.equal(manifest.paths.length, 0, "the Plan never reads the halls whole");
        const component = (ex.planGroupWindows.fn.toIR() as EastIR<[], typeof UIComponentType>).compile([])();
        assert.equal(decodeBeast2For(UIComponentType)(encodeBeast2For(UIComponentType)(component)).type, component.type);
    });

    test("the root carries its windows' size, 200 without `paging`: an entry is read back from a window of that size", () => {
        const plain = decodeBeast2For(Plan.Types.Root)(encodeBeast2For(Plan.Types.Root)(East.compile(East.function([], Plan.Types.Root, ($) => {
            const source = $.const(PAIRS, Paged.Types.Source(Rows));
            return Plan.Root({
                data: source,
                series: [Plan.series.span(Row, { key: "rows", title: "Rows", label: (row) => row.name, runs: () => [] })],
                axis: Plan.axis({ window: { min: new Date("2026-10-05T00:00:00Z"), max: new Date("2026-10-26T00:00:00Z") }, resolution: "week" }),
                editing: {},
            });
        }), [])()));
        assert.equal(plain.windowEntries, 200n);
        assert.equal(plain.editing.type, "some");
        if (plain.editing.type !== "some") return;
        // Its windows are 200 entries long, and the source serves none of that size.
        assert.equal(plain.editing.value.readEntry("r02", 2n).type, "none");

        const paired = decodeBeast2For(Plan.Types.Root)(encodeBeast2For(Plan.Types.Root)(East.compile(East.function([], Plan.Types.Root, ($) => {
            const source = $.const(PAIRS, Paged.Types.Source(Rows));
            return Plan.Root({
                data: source,
                series: [Plan.series.span(Row, { key: "rows", title: "Rows", label: (row) => row.name, runs: () => [] })],
                axis: Plan.axis({ window: { min: new Date("2026-10-05T00:00:00Z"), max: new Date("2026-10-26T00:00:00Z") }, resolution: "week" }),
                editing: {},
                paging: { entries: 2 },
            });
        }), [])()));
        assert.equal(paired.windowEntries, 2n);
        assert.equal(paired.editing.type, "some");
        if (paired.editing.type !== "some") return;
        // The third row is read back from the window it came in, rows two and three.
        const read = paired.editing.value.readEntry("r02", 2n);
        assert.ok(read.type === "some" && decodeBeast2For(Row)(read.value).name === "Row 2");
    });

    test("<Plan>'s payload carries `paging.entries` on its root", () => {
        const payload = East.compile(East.function([], PlanPayloadType, ($) => {
            const source = $.const(PAIRS, Paged.Types.Source(Rows));
            return Plan.Payload({
                data: source,
                series: [Plan.series.span(Row, { key: "rows", title: "Rows", label: (row) => row.name, runs: () => [] })],
                axis: Plan.axis({ window: { min: new Date("2026-10-05T00:00:00Z"), max: new Date("2026-10-26T00:00:00Z") }, resolution: "week" }),
                paging: { entries: 1 },
            });
        }), [])();
        assert.equal(payload.plan.windowEntries, 1n);
    });

    test("`paging.entries` other than a whole number of 1 or more is refused, naming the option", () => {
        for (const [entries, said] of [[0, "0"], [1.5, "1\\.5"], [-1, "-1"]] as const) {
            assert.throws(() => Plan.Payload({
                data: East.value(PAIRS, Paged.Types.Source(Rows)),
                series: [Plan.series.span(Row, { key: "rows", title: "Rows", label: (row) => row.name, runs: () => [] })],
                axis: Plan.axis({ window: { min: new Date("2026-10-05T00:00:00Z"), max: new Date("2026-10-26T00:00:00Z") }, resolution: "week" }),
                paging: { entries },
            }), new RegExp(`^Error: Plan: \`paging\\.entries\` is how many of the rows' entries .* a whole number of 1 or more, and this one is ${said}$`));
        }
    });
});
