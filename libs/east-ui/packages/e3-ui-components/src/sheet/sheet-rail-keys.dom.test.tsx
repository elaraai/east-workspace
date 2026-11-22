/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 *
 * @vitest-environment jsdom
 *
 * A Sheet's rail over records keyed by any type (east-workspace#1696), on e3
 * itself: a port's five docks, keyed once by a variant, as a composite record
 * keys its rows by the source each came from, and once by a struct, each
 * dock's yard and its number there. Through the rail's `rows` source each dock
 * stands under its record's own key, never a String spelled out of it:
 *
 * - **the key's order**: the rows come in the key's own order — a variant's
 *   cases each one run, a number in a key by its value — never in their
 *   texts', whose first is the tenth dock;
 * - **the narrowing**: a field, the rail's search and a preset each narrow the
 *   rows, and the rail's summary counts them out of the record's;
 * - **a scope** (#1621): a page scoped to one yard holds its docks alone, in
 *   their keys' order, whatever the viewer searches or clears;
 * - **Search Records**: a dock sought by its key, typed as its key's type
 *   reads, is found, and the ring goes to its row.
 */

import { describe, expect, test } from "vitest";
import { waitFor } from "@testing-library/react";
import { DictType, East, IntegerType, SortedMap, StringType, StructType, VariantType, compareFor, printFor, variant, type ValueTypeOf } from "@elaraai/east";
import { RecordSlicesChromeType, Slice, recordSlicesChrome } from "@elaraai/east-ui/internal";
import { getRegisteredPlatformImplementations } from "@elaraai/east-ui-components";
import { Data, Record, Sheet, SheetPayloadType } from "@elaraai/e3-ui/internal";
import e3 from "@elaraai/e3";
import { act, searchRecords, settle, sheetHarness, slot, type PayloadFunction } from "./frame/harness.test-utils.js";

/** A dock: its name, and the yard it stands in. */
const Dock = StructType({ name: StringType, yard: StringType });
/** A dock's key as a composite record keys its rows: the ERP's numbered, the port's own named. */
const Sourced = VariantType({ erp: IntegerType, own: StringType });
/** A dock's key as a struct: its yard, and its number there. */
const Placed = StructType({ yard: StringType, no: IntegerType });

/**
 * The docks keyed by a variant — the North yard's numbered 2, 9 and 10 by the ERP, the South's named by the port —
 * filed by their yard, by their yard and name, and by their name: what the rail narrows them through.
 */
const sourcedDocks = e3.record("rail_sourced_docks", DictType(Sourced, Dock), {
    initial: new SortedMap<ValueTypeOf<typeof Sourced>, ValueTypeOf<typeof Dock>>([
        [variant("erp", 2n), { name: "North A", yard: "North" }],
        [variant("erp", 9n), { name: "North B", yard: "North" }],
        [variant("erp", 10n), { name: "North C", yard: "North" }],
        [variant("own", "Annex"), { name: "South A", yard: "South" }],
        [variant("own", "Berth"), { name: "South B", yard: "South" }],
    ], compareFor(Sourced)),
    indexes: (index) => ({ by_yard: index.on(["yard"]), by_yard_name: index.on(["yard", "name"]), by_name: index.on(["name"]) }),
    mutations: (mutation) => ({ patch: mutation.patch() }),
});

/** The same docks keyed by a struct — the North yard's 2, 9 and 10, the South's 1 and 3 — filed the same way. */
const placedDocks = e3.record("rail_placed_docks", DictType(Placed, Dock), {
    initial: new SortedMap<ValueTypeOf<typeof Placed>, ValueTypeOf<typeof Dock>>([
        [{ yard: "North", no: 2n }, { name: "North A", yard: "North" }],
        [{ yard: "North", no: 9n }, { name: "North B", yard: "North" }],
        [{ yard: "North", no: 10n }, { name: "North C", yard: "North" }],
        [{ yard: "South", no: 1n }, { name: "South A", yard: "South" }],
        [{ yard: "South", no: 3n }, { name: "South B", yard: "South" }],
    ], compareFor(Placed)),
    indexes: (index) => ({ by_yard: index.on(["yard"]), by_yard_name: index.on(["yard", "name"]), by_name: index.on(["name"]) }),
    mutations: (mutation) => ({ patch: mutation.patch() }),
});

const h = sheetHarness({ modules: { "sheet/rail-keys": { sourcedDocks, placedDocks } }, frame: 2000 });
const printString = printFor(StringType);
const printSourced = printFor(Sourced);
const printPlaced = printFor(Placed);

/** The sheet over the docks keyed by a variant, through its rail: a field over their yard, a search over their name, and a preset of the North yard. */
const sourcedSheet = East.function([], SheetPayloadType, ($) => {
    const held = $.let(Record.bind(sourcedDocks));
    const slice = $.const(Slice.bindRecords("test.sheet.rail.sourced", {
        rows: { source: Data.bindPaged(sourcedDocks, { indexes: ["by_yard", "by_yard_name", "by_name"] }), fields: { yard: { label: "Yard", hints: ["North", "South"] }, name: { label: "Name" } }, search: ["name"] },
    }, { presets: [{ id: "north", name: "North yard", where: { rows: { yard: ["North"] } } }] }));
    return Sheet.Payload({
        record: held, name: "docks", slice: { slice }, edits: { insertRows: false },
        columns: { name: Sheet.column.text(Dock, { header: "Name" }), yard: Sheet.column.text(Dock, { header: "Yard" }) },
    });
});
/** That sheet's rail, bound under its key as the sheet binds it: what a test narrows the docks through, as its controls do. */
const sourcedRail = East.compile(East.function([], RecordSlicesChromeType, ($) => $.return(recordSlicesChrome({
    slice: Slice.bindRecords("test.sheet.rail.sourced", {
        rows: { source: Data.bindPaged(sourcedDocks, { indexes: ["by_yard", "by_yard_name", "by_name"] }), fields: { yard: { label: "Yard", hints: ["North", "South"] }, name: { label: "Name" } }, search: ["name"] },
    }, { presets: [{ id: "north", name: "North yard", where: { rows: { yard: ["North"] } } }] }),
}))), getRegisteredPlatformImplementations());

/** The sheet over the docks keyed by a variant on a page scoped to the North yard: the search over their name alone. */
const sourcedScopedSheet = East.function([], SheetPayloadType, ($) => {
    const held = $.let(Record.bind(sourcedDocks));
    const slice = $.const(Slice.bindRecords("test.sheet.rail.sourced.scoped", {
        rows: { source: Data.bindPaged(sourcedDocks, { indexes: ["by_yard", "by_yard_name", "by_name"] }), scope: { yard: ["North"] }, fields: { name: { label: "Name" } }, search: ["name"] },
    }));
    return Sheet.Payload({
        record: held, name: "docks", slice: { slice }, edits: { insertRows: false },
        columns: { name: Sheet.column.text(Dock, { header: "Name" }), yard: Sheet.column.text(Dock, { header: "Yard" }) },
    });
});
/** That sheet's rail, bound under its key as the sheet binds it. */
const sourcedScopedRail = East.compile(East.function([], RecordSlicesChromeType, ($) => $.return(recordSlicesChrome({
    slice: Slice.bindRecords("test.sheet.rail.sourced.scoped", {
        rows: { source: Data.bindPaged(sourcedDocks, { indexes: ["by_yard", "by_yard_name", "by_name"] }), scope: { yard: ["North"] }, fields: { name: { label: "Name" } }, search: ["name"] },
    }),
}))), getRegisteredPlatformImplementations());

/** The sheet over the docks keyed by a struct, through its rail: a field over their yard, a search over their name, and a preset of the North yard. */
const placedSheet = East.function([], SheetPayloadType, ($) => {
    const held = $.let(Record.bind(placedDocks));
    const slice = $.const(Slice.bindRecords("test.sheet.rail.placed", {
        rows: { source: Data.bindPaged(placedDocks, { indexes: ["by_yard", "by_yard_name", "by_name"] }), fields: { yard: { label: "Yard", hints: ["North", "South"] }, name: { label: "Name" } }, search: ["name"] },
    }, { presets: [{ id: "north", name: "North yard", where: { rows: { yard: ["North"] } } }] }));
    return Sheet.Payload({
        record: held, name: "docks", slice: { slice }, edits: { insertRows: false },
        columns: { name: Sheet.column.text(Dock, { header: "Name" }), yard: Sheet.column.text(Dock, { header: "Yard" }) },
    });
});
/** That sheet's rail, bound under its key as the sheet binds it. */
const placedRail = East.compile(East.function([], RecordSlicesChromeType, ($) => $.return(recordSlicesChrome({
    slice: Slice.bindRecords("test.sheet.rail.placed", {
        rows: { source: Data.bindPaged(placedDocks, { indexes: ["by_yard", "by_yard_name", "by_name"] }), fields: { yard: { label: "Yard", hints: ["North", "South"] }, name: { label: "Name" } }, search: ["name"] },
    }, { presets: [{ id: "north", name: "North yard", where: { rows: { yard: ["North"] } } }] }),
}))), getRegisteredPlatformImplementations());

/** The sheet over the docks keyed by a struct on a page scoped to the North yard: the search over their name alone. */
const placedScopedSheet = East.function([], SheetPayloadType, ($) => {
    const held = $.let(Record.bind(placedDocks));
    const slice = $.const(Slice.bindRecords("test.sheet.rail.placed.scoped", {
        rows: { source: Data.bindPaged(placedDocks, { indexes: ["by_yard", "by_yard_name", "by_name"] }), scope: { yard: ["North"] }, fields: { name: { label: "Name" } }, search: ["name"] },
    }));
    return Sheet.Payload({
        record: held, name: "docks", slice: { slice }, edits: { insertRows: false },
        columns: { name: Sheet.column.text(Dock, { header: "Name" }), yard: Sheet.column.text(Dock, { header: "Yard" }) },
    });
});
/** That sheet's rail, bound under its key as the sheet binds it. */
const placedScopedRail = East.compile(East.function([], RecordSlicesChromeType, ($) => $.return(recordSlicesChrome({
    slice: Slice.bindRecords("test.sheet.rail.placed.scoped", {
        rows: { source: Data.bindPaged(placedDocks, { indexes: ["by_yard", "by_yard_name", "by_name"] }), scope: { yard: ["North"] }, fields: { name: { label: "Name" } }, search: ["name"] },
    }),
}))), getRegisteredPlatformImplementations());

/** One of the two records' pages, and what the cases ask of them. */
interface Keyed {
    /** How the docks are keyed, as the cases' titles say it. */
    readonly what: string;
    /** The sheet through its rail, and that rail as a test writes it. */
    readonly sheet: PayloadFunction;
    readonly rail: () => ValueTypeOf<typeof RecordSlicesChromeType>;
    /** The sheet on a page scoped to the North yard, and its rail. */
    readonly scopedSheet: PayloadFunction;
    readonly scopedRail: () => ValueTypeOf<typeof RecordSlicesChromeType>;
    /** Each dock's key as the sheet holds it — its text — in the key's own order: North's three, then South's two. */
    readonly ids: readonly string[];
    /** The tenth North dock's key as Search Records is typed it, as its key's type reads. */
    readonly typed: string;
}
const KEYED: readonly Keyed[] = [{
    what: "a variant", sheet: sourcedSheet, rail: sourcedRail, scopedSheet: sourcedScopedSheet, scopedRail: sourcedScopedRail,
    ids: [variant("erp", 2n), variant("erp", 9n), variant("erp", 10n), variant("own", "Annex"), variant("own", "Berth")].map((key) => printSourced(key)),
    typed: ".erp 10",
}, {
    what: "a struct", sheet: placedSheet, rail: placedRail, scopedSheet: placedScopedSheet, scopedRail: placedScopedRail,
    ids: [{ yard: "North", no: 2n }, { yard: "North", no: 9n }, { yard: "North", no: 10n }, { yard: "South", no: 1n }, { yard: "South", no: 3n }]
        .map((key) => printPlaced(key)),
    typed: "North, 10",
}];

/** The sheet's rows, by their keys' texts, in order. */
const ids = (c: HTMLElement) => [...c.querySelectorAll<HTMLElement>('[data-frame-slot="main"] [data-slot="row"][data-row-id]')].map((row) => row.getAttribute("data-row-id"));
/** The rail's summary: how many docks the narrowing holds, out of the record's. */
const summary = (c: HTMLElement) => slot(c, "toolbar")?.querySelector("[data-record-slices-summary]")?.textContent ?? null;
/** The ring's cell on a row, by its key's text, if the ring is on it. */
const ring = (c: HTMLElement, id: string) => c.querySelector(`[data-slot="row"][data-row-id=${JSON.stringify(id)}] [data-slot="cell"][data-selected]`);
/** A write to a rail, as its controls make it, and what it starts settled. */
async function write(does: () => void): Promise<void> {
    await act(async () => { does(); });
    await settle();
}

describe.each(KEYED)("the Sheet's rail over docks keyed by $what (east-workspace#1696)", (keyed) => {
    const rows = () => keyed.rail().slice.parts[0]!.slice;

    test("#1696 — the rows come in the key's own order: a variant's cases each one run, a number in a key by its value — never in their texts', whose first is the tenth dock", async () => {
        const { container: c } = await h.mountPayload(keyed.sheet, { storageKey: "sheet-rail-keys" });
        await waitFor(() => expect(ids(c)).toEqual(keyed.ids));
        expect([...keyed.ids].sort()[0]).toBe(keyed.ids[2]);
    });

    test("#1696 — a field, the rail's search and a preset each narrow the rows, in their keys' order, and the rail's summary counts them out of the record's", async () => {
        const { container: c } = await h.mountPayload(keyed.sheet, { storageKey: "sheet-rail-keys" });
        await waitFor(() => expect(ids(c)).toEqual(keyed.ids));
        // The South yard chosen: its two docks.
        await write(() => rows().choose("yard", [printString("South")]));
        await waitFor(() => expect(ids(c)).toEqual(keyed.ids.slice(3)));
        expect(summary(c)).toBe("2 of 5 rows");
        // Cleared, and searched: the North dock whose name begins so.
        await write(() => keyed.rail().slice.clearAll());
        await write(() => rows().prefix("name", "North C"));
        await waitFor(() => expect(ids(c)).toEqual([keyed.ids[2]]));
        expect(summary(c)).toBe("1 of 5 rows");
        // Cleared, and the North yard's preset chosen: its three.
        await write(() => keyed.rail().slice.clearAll());
        await write(() => keyed.rail().slice.togglePreset("north"));
        await waitFor(() => expect(ids(c)).toEqual(keyed.ids.slice(0, 3)));
        expect(summary(c)).toBe("3 of 5 rows");
    });

    test("#1696 — a page scoped to the North yard holds its docks alone, in their keys' order, whatever the viewer searches or clears (#1621)", async () => {
        const { container: c } = await h.mountPayload(keyed.scopedSheet, { storageKey: "sheet-rail-keys-scoped" });
        await waitFor(() => expect(ids(c)).toEqual(keyed.ids.slice(0, 3)));
        // A search for the South yard's docks finds none of them on the page.
        await write(() => keyed.scopedRail().slice.parts[0]!.slice.prefix("name", "South"));
        await waitFor(() => expect(ids(c)).toEqual([]));
        // The viewer's choices cleared: the scope stays.
        await write(() => keyed.scopedRail().slice.clearAll());
        await waitFor(() => expect(ids(c)).toEqual(keyed.ids.slice(0, 3)));
    });

    test("#1696 — Search Records finds a dock by its key, typed as its key's type reads, and the ring goes to its row", async () => {
        const { container: c } = await h.mountPayload(keyed.sheet, { storageKey: "sheet-rail-keys" });
        await waitFor(() => expect(ids(c)).toEqual(keyed.ids));
        const search = searchRecords(c);
        await search.ask(keyed.typed);
        await waitFor(() => expect(search.box().textContent).toMatch(/1 match/), { timeout: 5_000 });
        await search.enter();
        await waitFor(() => expect(ring(c, keyed.ids[2]!)).not.toBeNull(), { timeout: 10_000 });
    });
});
