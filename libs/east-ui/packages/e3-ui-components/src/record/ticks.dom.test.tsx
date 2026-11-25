/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 *
 * @vitest-environment jsdom
 *
 * The rows a Record's select column ticks (east-workspace#1737), in a browser,
 * on e3: the app's `onTick` hears every ticked row's key after each change of
 * the ticks — a tick, another, an untick, the header's box ticking every row
 * shown and unticking them, and the ticks the Record lets go itself: Delete's,
 * the row Details deletes, Discard's and a new search's — with Add and Delete
 * on or off, an Integer-keyed record's as Integers, and a ticked row an edit
 * moves under another key under the key it stands under now; it says nothing
 * as the Record shows, which starts with none ticked. The tick boxes show where
 * something acts on them — Delete, or `onTick`, read only too — and nowhere
 * else, never on a phone. `edits` takes Add and Duplicate away
 * (`insertRows: false`), and Delete from the toolbar and from Details
 * (`removeRows: false`). Each app keeps every call it hears in the page's
 * state, which the test reads back as East values.
 */

import { describe, expect, test, vi } from "vitest";
import { fireEvent, waitFor, within } from "@testing-library/react";
import { ArrayType, East, IntegerType, NullType, SetType, SortedSet, StringType, compareFor, equalFor, printFor, type ValueTypeOf } from "@elaraai/east";
import { Reactive, RecordSlicesChromeType, Slice, State, UIComponentType, recordSlicesChrome } from "@elaraai/east-ui/internal";
import { StateImpl, editingMessages, getRegisteredPlatformImplementations } from "@elaraai/east-ui-components";
import { Data, Record } from "@elaraai/e3-ui/internal";
import * as ex from "@elaraai/e3-ui/examples/record/record-ticks";
import { width } from "../e3-web-mount.test-utils.js";
import { act, settle, sheetHarness, slot } from "../sheet/frame/harness.test-utils.js";
import { touchFrame } from "../sheet/frame.test-utils.js";
// The Record is an extension: its renderer registers as it loads.
import "./index.js";

/** The presses, keyed by text and searched by name; the benches, keyed by Integer; the racks, keyed by a code typed. */
const { TicksPress: Press, ticksPresses: presses, TicksBench: Bench, ticksBenches: benches, TicksRack: Rack, ticksRacks: racks } = ex;

const h = sheetHarness({ modules: { "record/record-ticks": ex }, frame: 2000 });

/** Where each app keeps every call of its `onTick`: over rows keyed by text, and by Integer. */
const HEARD = "record-ticks-heard";
const HEARD_BENCHES = "record-ticks-heard-benches";

/** What `onTick` hears over rows keyed by text, and by Integer; and every call of it. */
const Keys = SetType(StringType);
const BenchKeys = SetType(IntegerType);
const Heard = ArrayType(Keys);
const HeardBenches = ArrayType(BenchKeys);

/** What a test gives the presses' Record: whether it hears its ticks, its `edits`, and whether it is read only. */
interface PressesProps {
    hears: boolean;
    edits?: { insertRows?: boolean; removeRows?: boolean };
    readOnly?: boolean;
}

/** The presses' Record, as a test gives it, with Details: its `onTick`, where it hears, keeping every call in the page's state. */
const pressesOf = (props: PressesProps) => East.function([], UIComponentType, (_$) => Reactive.Root(East.function([], UIComponentType, ($) => {
    const held = $.let(Record.bind(presses));
    const heard = $.let(State.bind([Heard], HEARD, []));
    const onTick = $.const(East.function([Keys], NullType, ($2, keys) => { $2(heard.write(heard.read().concat([keys]))); }));
    return Record({
        record: held,
        title: "Presses",
        noun: { singular: "press", plural: "presses" },
        columns: {
            name: Record.column.title(Press, { header: "Press" }),
            hall: Record.column.text(Press, { header: "Hall" }),
        },
        inspector: true,
        ...(props.hears ? { onTick } : {}),
        ...(props.edits !== undefined ? { edits: props.edits } : {}),
        ...(props.readOnly === true ? { readOnly: true } : {}),
        name: "ticksPresses",
    });
})));

const hearsNoEdits = pressesOf({ hears: true, edits: { insertRows: false, removeRows: false } });
const hearsWithDelete = pressesOf({ hears: true });
const deleteOnly = pressesOf({ hears: false });
const noDelete = pressesOf({ hears: false, edits: { removeRows: false } });
const noAdd = pressesOf({ hears: false, edits: { insertRows: false } });
const readOnlyHears = pressesOf({ hears: true, readOnly: true });
const readOnlyQuiet = pressesOf({ hears: false, readOnly: true });

/** The benches: every call of `onTick` kept, its keys Integers. */
const benchesHeard = East.function([], UIComponentType, (_$) => Reactive.Root(East.function([], UIComponentType, ($) => {
    const held = $.let(Record.bind(benches));
    const heard = $.let(State.bind([HeardBenches], HEARD_BENCHES, []));
    const onTick = $.const(East.function([BenchKeys], NullType, ($2, keys) => { $2(heard.write(heard.read().concat([keys]))); }));
    return Record({
        record: held,
        title: "Benches",
        noun: { singular: "bench", plural: "benches" },
        columns: { name: Record.column.title(Bench, { header: "Bench" }) },
        onTick,
        name: "ticksBenches",
    });
})));

/** The racks, each keyed by its code: every call of `onTick` kept. */
const racksHeard = East.function([], UIComponentType, (_$) => Reactive.Root(East.function([], UIComponentType, ($) => {
    const held = $.let(Record.bind(racks));
    const heard = $.let(State.bind([Heard], HEARD, []));
    const onTick = $.const(East.function([Keys], NullType, ($2, keys) => { $2(heard.write(heard.read().concat([keys]))); }));
    return Record({
        record: held,
        rowKey: (rack) => rack.code,
        title: "Racks",
        noun: { singular: "rack", plural: "racks" },
        columns: {
            code: Record.column.text(Rack, { header: "Code" }),
            bay: Record.column.text(Rack, { header: "Bay" }),
        },
        onTick,
        name: "ticksRacks",
    });
})));

/** The key the rail over the presses this file searches is kept under: the Record's and the test's. */
const RAIL = "record.ticks.presses";

/** The presses, narrowed by the rail: every call of `onTick` kept. */
const pressesSearched = East.function([], UIComponentType, (_$) => Reactive.Root(East.function([], UIComponentType, ($) => {
    const held = $.let(Record.bind(presses));
    const slice = $.let(Slice.bindRecords(RAIL, {
        rows: { source: Data.bindPaged(presses, { indexes: ["ticks_presses_by_name"] }), label: "Presses", fields: { name: { label: "Name" } }, search: ["name"] },
    }));
    const heard = $.let(State.bind([Heard], HEARD, []));
    const onTick = $.const(East.function([Keys], NullType, ($2, keys) => { $2(heard.write(heard.read().concat([keys]))); }));
    return Record({
        slice: { slice },
        record: held,
        title: "Presses",
        noun: { singular: "press", plural: "presses" },
        columns: {
            name: Record.column.title(Press, { header: "Press" }),
            hall: Record.column.text(Press, { header: "Hall" }),
        },
        onTick,
        name: "ticksSearched",
    });
})));

const stringEqual = equalFor(StringType);
/** The rail, as the test writes it: the same source under the same key. */
const pressesRail = East.compile(East.function([], RecordSlicesChromeType, ($) => $.return(recordSlicesChrome({ slice: Slice.bindRecords(RAIL, {
    rows: { source: Data.bindPaged(presses, { indexes: ["ticks_presses_by_name"] }), label: "Presses", fields: { name: { label: "Name" } }, search: ["name"] },
}) }))), getRegisteredPlatformImplementations());
/** The rail's rows source, bound. */
const pressesRows = () => pressesRail().slice.parts.find((part) => stringEqual(part.source, "rows"))!.slice;

/** Every call each app has heard. */
const heardOf = East.function([], Heard, ($) => {
    const heard = $.const(State.bind([Heard], HEARD, []));
    return heard.read();
}).toIR().compile(StateImpl);
const heardBenchesOf = East.function([], HeardBenches, ($) => {
    const heard = $.const(State.bind([HeardBenches], HEARD_BENCHES, []));
    return heard.read();
}).toIR().compile(StateImpl);

const heardEqual = equalFor(Heard);
const printHeard = printFor(Heard);

/** The rows ticked, as `onTick` hears them over rows keyed by text, and by Integer. */
const keysOf = (...ids: string[]) => new SortedSet(ids, compareFor(StringType));
const benchKeysOf = (...ids: bigint[]) => new SortedSet(ids, compareFor(IntegerType));

/** The app's calls so far, against what they should be: the test names every call heard. */
function expectHeard(expected: ValueTypeOf<typeof Heard>) {
    const got = heardOf();
    expect(heardEqual(got, expected), printHeard(got)).toBe(true);
}

/** The Record's rows, in order. */
const rows = (c: HTMLElement) => [...c.querySelectorAll<HTMLElement>('[data-record] [data-slot="row"]')];
/** A row, by its key. */
const rowOf = (c: HTMLElement, id: string) => rows(c).find((row) => row.getAttribute("data-row-id") === id)!;
/** A row's cell under a column. */
const cellOf = (c: HTMLElement, id: string, key: string) => rowOf(c, id).querySelector<HTMLElement>(`[data-slot="cell"][data-key="${key}"]`)!;
/** A row's tick box, where it has one. */
const boxOf = (c: HTMLElement, id: string) => rowOf(c, id).querySelector<HTMLElement>('[role="checkbox"]');
/** The header's tick cell, which ticks every row shown, or unticks them. */
const tickAll = (c: HTMLElement) => c.querySelector<HTMLElement>('[data-record] [data-slot="headerRow"] [data-tick]');
/** A toolbar action, by its name. */
const action = (c: HTMLElement, name: string) => slot(c, "toolbar")?.querySelector<HTMLButtonElement>(`[data-record-action="${name}"]`) ?? null;
/** A Details action, by its name. */
const detailsAction = (c: HTMLElement, name: string) => slot(c, "end")?.querySelector<HTMLButtonElement>(`[data-inspector-action="${name}"]`) ?? null;
/** The grid: what takes the keys and the pastes. */
const grid = (c: HTMLElement) => c.querySelector<HTMLElement>('[data-record] [role="grid"]')!;
/** The history bar's Discard. */
const discard = (c: HTMLElement) => within(slot(c, "toolbar")!).getByRole<HTMLButtonElement>("button", { name: editingMessages.discard() });

/**
 * A press of the primary button on an element and its release there, as a browser sends them — each event its own, as
 * each is the browser's — and what it leads to settled.
 */
async function click(el: Element) {
    fireEvent.mouseDown(el, { button: 0, detail: 1 });
    fireEvent.mouseUp(el, { button: 0, detail: 1 });
    fireEvent.click(el, { button: 0, detail: 1 });
    await settle();
}

/** A button pressed, and what it leads to settled. */
async function press(el: Element) {
    fireEvent.mouseDown(el, { button: 0 });
    fireEvent.click(el);
    await settle();
}

describe("the rows a Record ticks (east-workspace#1737)", () => {
    test("onTick hears every ticked row's key after each change — a tick, another, an untick, the header ticking every row shown and unticking them — with Add and Delete off; nothing as the Record shows", async () => {
        const { container: c } = await h.mount({ fn: hearsNoEdits }, { storageKey: "record-ticks-hears" });
        expectHeard([]);
        expect([action(c, "add"), action(c, "delete")]).toEqual([null, null]);
        await click(boxOf(c, "P-01")!);
        await click(boxOf(c, "P-03")!);
        await click(boxOf(c, "P-01")!);
        await click(tickAll(c)!);
        await click(tickAll(c)!);
        expectHeard([keysOf("P-01"), keysOf("P-01", "P-03"), keysOf("P-03"), keysOf("P-01", "P-02", "P-03"), keysOf()]);
    });

    test("onTick hears the ticks the Record lets go itself: Delete's, the row Details deletes, and Discard's", async () => {
        const { container: c } = await h.mount({ fn: hearsWithDelete }, { storageKey: "record-ticks-let-go" });
        // Delete takes the ticked rows out as one draft, and the ticks with them.
        await click(boxOf(c, "P-01")!);
        await click(boxOf(c, "P-02")!);
        await press(action(c, "delete")!);
        expect(rows(c).map((row) => row.getAttribute("data-row-id"))).toEqual(["P-03"]);
        // Discard drops the drafts, and the ticks with them.
        await click(boxOf(c, "P-03")!);
        await press(discard(c));
        expect(rows(c).map((row) => row.getAttribute("data-row-id"))).toEqual(["P-01", "P-02", "P-03"]);
        // Details deletes its row, a ticked one too, and lets its tick go.
        await click(boxOf(c, "P-01")!);
        await click(boxOf(c, "P-02")!);
        await click(cellOf(c, "P-02", "name"));
        await press(detailsAction(c, "delete")!);
        expectHeard([
            keysOf("P-01"), keysOf("P-01", "P-02"), keysOf(),
            keysOf("P-03"), keysOf(),
            keysOf("P-01"), keysOf("P-01", "P-02"), keysOf("P-01"),
        ]);
    });

    test("onTick hears a new search let the ticks go", async () => {
        const { container: c } = await h.mount({ fn: pressesSearched }, { storageKey: "record-ticks-search" });
        await waitFor(() => expect(rows(c)).toHaveLength(3), { timeout: 10_000 });
        await click(boxOf(c, "P-03")!);
        await act(async () => { pressesRows().prefix("name", "Offset"); });
        await waitFor(() => expect(rows(c)).toHaveLength(2), { timeout: 10_000 });
        await settle();
        expectHeard([keysOf("P-03"), keysOf()]);
    });

    test("over a record keyed by Integer, onTick hears the ticked rows' keys as Integers", async () => {
        const { container: c } = await h.mount({ fn: benchesHeard }, { storageKey: "record-ticks-benches" });
        await click(boxOf(c, "7")!);
        await click(boxOf(c, "1")!);
        const got = heardBenchesOf();
        expect(equalFor(HeardBenches)(got, [benchKeysOf(7n), benchKeysOf(1n, 7n)]), printFor(HeardBenches)(got)).toBe(true);
    });

    test("a ticked row an edit moves under another key keeps its tick there, and onTick hears the key it stands under now; an Undo puts both back (`rowKey`)", async () => {
        const { container: c } = await h.mount({ fn: racksHeard }, { storageKey: "record-ticks-rekeyed" });
        await click(boxOf(c, "R-1")!);
        // R-1's code typed over, as a paste types it: the rack moves under its new code, after R-2.
        fireEvent.mouseDown(cellOf(c, "R-1", "code"), { button: 0, detail: 1 });
        fireEvent.mouseUp(cellOf(c, "R-1", "code"), { button: 0, detail: 1 });
        await act(async () => { fireEvent.paste(grid(c), { clipboardData: { getData: () => "R-9" } }); });
        await settle();
        expect(rows(c).map((row) => `${row.getAttribute("data-row-id")}${row.hasAttribute("data-ticked") ? " ticked" : ""}`)).toEqual(["R-2", "R-9 ticked"]);
        fireEvent.keyDown(grid(c), { key: "z", metaKey: true });
        await settle();
        expect(rows(c).map((row) => `${row.getAttribute("data-row-id")}${row.hasAttribute("data-ticked") ? " ticked" : ""}`)).toEqual(["R-1 ticked", "R-2"]);
        expectHeard([keysOf("R-1"), keysOf("R-9"), keysOf("R-1")]);
    });

    test("an Undo that takes a ticked new row back unticks it, and a Redo of a Delete the rows it takes again: onTick hears each", async () => {
        const { container: c } = await h.mount({ fn: hearsWithDelete }, { storageKey: "record-ticks-undo" });
        const keysNow = () => rows(c).map((row) => row.getAttribute("data-row-id")!);
        const historyButton = (name: string) => within(slot(c, "toolbar")!).getByRole<HTMLButtonElement>("button", { name });
        // A new press, ticked; the Add taken back, and its tick with it.
        await press(action(c, "add")!);
        const added = keysNow().find((id) => !["P-01", "P-02", "P-03"].includes(id))!;
        await click(boxOf(c, added)!);
        await press(historyButton(editingMessages.undo()));
        expect(keysNow()).toEqual(["P-01", "P-02", "P-03"]);
        // P-02 ticked and deleted, the Delete taken back, P-02 ticked again — and the Delete redone, its tick with it.
        await click(boxOf(c, "P-02")!);
        await press(action(c, "delete")!);
        await press(historyButton(editingMessages.undo()));
        await click(boxOf(c, "P-02")!);
        await press(historyButton(editingMessages.redo()));
        expect(keysNow()).toEqual(["P-01", "P-03"]);
        expect(rows(c).filter((row) => row.hasAttribute("data-ticked"))).toEqual([]);
        expectHeard([keysOf(added), keysOf(), keysOf("P-02"), keysOf(), keysOf("P-02"), keysOf()]);
    });

    test("narrowed to a phone's frame, which draws no tick boxes, the Record lets its ticks go, and onTick hears that none stand", async () => {
        // The Record's frame laid out at a desktop's width, then at a phone's: what it reads its phone's rule from.
        let frame = 900;
        const real = Element.prototype.getBoundingClientRect;
        const measured = vi.spyOn(Element.prototype, "getBoundingClientRect").mockImplementation(function (this: Element) {
            return this.hasAttribute("data-builder-frame")
                ? { x: 0, y: 0, top: 0, left: 0, right: frame, bottom: 700, width: frame, height: 700, toJSON() {} } as DOMRect
                : real.call(this);
        });
        let touch: (() => void) | undefined;
        try {
            const { container: c } = await h.mount({ fn: hearsWithDelete }, { storageKey: "record-ticks-narrowed" });
            await click(boxOf(c, "P-02")!);
            // The frame, and the rows' frame in it, narrowed to a phone's 390 — as a resize lays them out.
            touch = touchFrame(390);
            frame = 390;
            await width(390);
            expect([boxOf(c, "P-01"), rows(c).filter((row) => row.hasAttribute("data-ticked"))]).toEqual([null, []]);
            expectHeard([keysOf("P-02"), keysOf()]);
        } finally {
            touch?.();
            measured.mockRestore();
        }
    });

    test("let go, the Record's ticks go with it, and onTick hears that none stand", async () => {
        const { container: c, unmount } = await h.mount({ fn: hearsWithDelete }, { storageKey: "record-ticks-let-go-whole" });
        await click(boxOf(c, "P-02")!);
        unmount();
        await settle();
        expectHeard([keysOf("P-02"), keysOf()]);
    });

    test.each([
        { what: "Delete on, as by default", fn: deleteOnly, shows: true },
        { what: "Delete off, nothing hearing the ticks", fn: noDelete, shows: false },
        { what: "Add and Delete off, onTick given", fn: hearsNoEdits, shows: true },
        { what: "read only, onTick given", fn: readOnlyHears, shows: true },
        { what: "read only, nothing hearing the ticks", fn: readOnlyQuiet, shows: false },
    ])("the tick boxes show where something acts on them — $what: $shows", async ({ fn, shows }) => {
        const { container: c } = await h.mount({ fn }, { storageKey: "record-ticks-boxes" });
        expect([boxOf(c, "P-01") !== null, tickAll(c) !== null]).toEqual([shows, shows]);
    });

    test("on a phone there are no tick boxes, onTick given or not", async () => {
        const restore = touchFrame(390);
        try {
            const { container: c } = await h.mount({ fn: hearsNoEdits }, { storageKey: "record-ticks-phone" });
            expect(c.querySelector("[data-record] [data-tick]")).toBeNull();
            expect(boxOf(c, "P-01")).toBeNull();
        } finally {
            restore();
        }
    });

    test("insertRows: false takes Add from the toolbar and Duplicate from Details, and leaves Delete in both", async () => {
        const { container: added } = await h.mount({ fn: noAdd }, { storageKey: "record-ticks-no-add" });
        await click(cellOf(added, "P-01", "name"));
        expect([action(added, "add"), detailsAction(added, "duplicate")]).toEqual([null, null]);
        expect([action(added, "delete") !== null, detailsAction(added, "delete") !== null]).toEqual([true, true]);
    });

    test("removeRows: false takes Delete from the toolbar and from Details, and leaves Add and Duplicate", async () => {
        const { container: c } = await h.mount({ fn: noDelete }, { storageKey: "record-ticks-no-delete" });
        await click(cellOf(c, "P-01", "name"));
        expect([action(c, "delete"), detailsAction(c, "delete")]).toEqual([null, null]);
        expect([action(c, "add") !== null, detailsAction(c, "duplicate") !== null]).toEqual([true, true]);
    });
});
