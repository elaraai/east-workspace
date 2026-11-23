/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 *
 * @vitest-environment jsdom
 *
 * A click on a Record's row (east-workspace#1727), in a browser, on e3: the
 * app's `onRowClick` hears each click on a row with the row's key at the
 * record's own type — an Integer-keyed bench's as an Integer, a row Add made
 * under the key Add gave it, a row an edit moved under the key it stands under
 * now, the press that commits the edit too, its row drawn again in another
 * place — and the column clicked. A press on a title opens its Details and
 * clicks; a tick of the row's box and a press that steps a boolean do not, nor
 * does a key. `onSelect` hears the ring move, by a press or a key, as the
 * Sheet's does. Each app keeps what it hears in the page's state, which the
 * test reads back as East values.
 */

import { describe, expect, test } from "vitest";
import { fireEvent } from "@testing-library/react";
import { ArrayType, BooleanType, DictType, East, IntegerType, NullType, StringType, StructType, equalFor, none, printFor, some } from "@elaraai/east";
import { Reactive, State, UIComponentType } from "@elaraai/east-ui/internal";
import { StateImpl } from "@elaraai/east-ui-components";
import { Record, Sheet } from "@elaraai/e3-ui/internal";
import e3 from "@elaraai/e3";
import { act, settle, sheetHarness, slot } from "../sheet/frame/harness.test-utils.js";
import { placeAt } from "../sheet/frame.test-utils.js";
// The Record is an extension: its renderer registers as it loads.
import "./index.js";

/** A press: its name, its hall and whether it runs. */
const Press = StructType({ name: StringType, hall: StringType, running: BooleanType });
const presses = e3.record("row_click_presses", DictType(StringType, Press), {
    initial: new Map([
        ["P-01", { name: "Offset press 1", hall: "Hall A", running: true }],
        ["P-02", { name: "Offset press 2", hall: "Hall A", running: false }],
        ["P-03", { name: "Digital press", hall: "Hall B", running: true }],
    ]),
    mutations: (mutation) => ({ patch: mutation.patch() }),
});

/** A bench, keyed by its number. */
const Bench = StructType({ name: StringType });
const benches = e3.record("row_click_benches", DictType(IntegerType, Bench), {
    initial: new Map([[1n, { name: "Assembly 1" }], [7n, { name: "Finishing" }]]),
    mutations: (mutation) => ({ patch: mutation.patch() }),
});

/** A rack, keyed by the code a person types: its key built from its row. */
const Rack = StructType({ code: StringType, bay: StringType });
const racks = e3.record("row_click_racks", DictType(StringType, Rack), {
    initial: new Map([["R-1", { code: "R-1", bay: "North" }], ["R-2", { code: "R-2", bay: "South" }]]),
    mutations: (mutation) => ({ patch: mutation.patch() }),
});

const h = sheetHarness({ modules: { "record/row-click": { presses, benches, racks } }, frame: 2000 });

/** Where each app keeps the clicks it hears — over rows keyed by text, and by Integer — and the ring's moves. */
const CLICKS = "record-row-click-clicks";
const NUMBER_CLICKS = "record-row-click-number-clicks";
const SELECTED = "record-row-click-selected";

/** A click on a row keyed by text, and by Integer, as the app hears it. */
const TextClick = Record.Types.RowClick(StringType);
const NumberClick = Record.Types.RowClick(IntegerType);
const TextClicks = ArrayType(TextClick);
const NumberClicks = ArrayType(NumberClick);
const Selections = ArrayType(Sheet.Types.Selection);

/** The presses: each click and each move of the ring kept, the title opening Details. */
const pressesHeard = East.function([], UIComponentType, (_$) => Reactive.Root(East.function([], UIComponentType, ($) => {
    const held = $.let(Record.bind(presses));
    const clicks = $.let(State.bind([TextClicks], CLICKS, []));
    const selected = $.let(State.bind([Selections], SELECTED, []));
    const onRowClick = $.const(East.function([TextClick], NullType, ($2, click) => { $2(clicks.write(clicks.read().concat([click]))); }));
    const onSelect = $.const(East.function([Sheet.Types.Selection], NullType, ($2, at) => { $2(selected.write(selected.read().concat([at]))); }));
    return Record({
        record: held,
        title: "Presses",
        noun: { singular: "press", plural: "presses" },
        columns: {
            name: Record.column.title(Press, { header: "Press" }),
            hall: Record.column.text(Press, { header: "Hall" }),
            running: Record.column.boolean(Press, { header: "Running" }),
        },
        inspector: true,
        onRowClick,
        onSelect,
        name: "rowClickPresses",
    });
})));

/** The benches: each click kept, its key an Integer. */
const benchesHeard = East.function([], UIComponentType, (_$) => Reactive.Root(East.function([], UIComponentType, ($) => {
    const held = $.let(Record.bind(benches));
    const clicks = $.let(State.bind([NumberClicks], NUMBER_CLICKS, []));
    const onRowClick = $.const(East.function([NumberClick], NullType, ($2, click) => { $2(clicks.write(clicks.read().concat([click]))); }));
    return Record({
        record: held,
        title: "Benches",
        noun: { singular: "bench", plural: "benches" },
        columns: { name: Record.column.title(Bench, { header: "Bench" }) },
        onRowClick,
        name: "rowClickBenches",
    });
})));

/** The racks, each keyed by its code: each click kept. */
const racksHeard = East.function([], UIComponentType, (_$) => Reactive.Root(East.function([], UIComponentType, ($) => {
    const held = $.let(Record.bind(racks));
    const clicks = $.let(State.bind([TextClicks], CLICKS, []));
    const onRowClick = $.const(East.function([TextClick], NullType, ($2, click) => { $2(clicks.write(clicks.read().concat([click]))); }));
    return Record({
        record: held,
        rowKey: (rack) => rack.code,
        title: "Racks",
        noun: { singular: "rack", plural: "racks" },
        columns: {
            code: Record.column.text(Rack, { header: "Code" }),
            bay: Record.column.text(Rack, { header: "Bay" }),
        },
        onRowClick,
        name: "rowClickRacks",
    });
})));

/** What the apps have kept: the clicks on rows keyed by text and by Integer, and the ring's moves. */
const textClicks = East.function([], TextClicks, ($) => $.const(State.bind([TextClicks], CLICKS, [])).read()).toIR().compile(StateImpl);
const numberClicks = East.function([], NumberClicks, ($) => $.const(State.bind([NumberClicks], NUMBER_CLICKS, [])).read()).toIR().compile(StateImpl);
const selections = East.function([], Selections, ($) => $.const(State.bind([Selections], SELECTED, [])).read()).toIR().compile(StateImpl);

const textClicksEqual = equalFor(TextClicks);
const printTextClicks = printFor(TextClicks);

/** A click as the app over rows keyed by text hears it: the key, and the column — none for none. */
const heard = (key: string, column: string | undefined) => ({ key, index: none, column: column === undefined ? none : some(column) });

/** The Record's rows, in order. */
const rows = (c: HTMLElement) => [...c.querySelectorAll<HTMLElement>('[data-record] [data-slot="row"]')];
/** The grid's rows, by their keys, in order. */
const ids = (c: HTMLElement) => rows(c).map((row) => row.getAttribute("data-row-id"));
/** A row, by its key. */
const rowOf = (c: HTMLElement, id: string) => rows(c).find((row) => row.getAttribute("data-row-id") === id)!;
/** A row's cell under a column. */
const cellOf = (c: HTMLElement, id: string, key: string) => rowOf(c, id).querySelector<HTMLElement>(`[data-slot="cell"][data-key="${key}"]`)!;
/** The grid: what takes the keys and the pastes. */
const grid = (c: HTMLElement) => c.querySelector<HTMLElement>('[data-record] [role="grid"]')!;
/** The row Details shows, by its key. */
const inspected = (c: HTMLElement) => slot(c, "end")?.querySelector('[role="tabpanel"]:not([hidden]) [data-record-details="row"]')?.getAttribute("data-record-entry");

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

/** A key on the grid, and what it leads to settled. */
async function press(c: HTMLElement, key: string) {
    fireEvent.keyDown(grid(c), { key });
    await settle();
}

/** The app's clicks so far, against what they should be: the test names every click heard. */
function expectClicks(expected: ReturnType<typeof heard>[]) {
    const got = textClicks();
    expect(textClicksEqual(got, expected), printTextClicks(got)).toBe(true);
}

describe("a click on a Record's row (east-workspace#1727)", () => {
    test("a press on a cell clicks its row with the column; on a title it opens its Details and clicks; a tick of the row's box, a press stepping a boolean and the keys never do (RC1, RC7, RC8, RC11, RC13)", async () => {
        const { container: c } = await h.mount({ fn: pressesHeard }, { storageKey: "record-row-click-presses" });
        expect(ids(c)).toEqual(["P-01", "P-02", "P-03"]);
        await click(cellOf(c, "P-02", "hall"));
        expectClicks([heard("P-02", "hall")]);
        // The row's box ticks the row, and clicks nothing.
        await click(rowOf(c, "P-03").querySelector('[role="checkbox"]')!);
        expect(rowOf(c, "P-03").hasAttribute("data-ticked")).toBe(true);
        // A press on a boolean steps it, and clicks nothing.
        await click(cellOf(c, "P-02", "running"));
        expect(cellOf(c, "P-02", "running").querySelector('[data-slot="box"]')?.getAttribute("aria-checked")).toBe("true");
        expectClicks([heard("P-02", "hall")]);
        // A press on a title opens its Details, and clicks its row.
        await click(cellOf(c, "P-01", "name"));
        expect(inspected(c)).toBe("P-01");
        expectClicks([heard("P-02", "hall"), heard("P-01", "name")]);
        // Keys move the ring, and click nothing.
        for (const key of ["ArrowDown", "ArrowRight", "Enter", "Escape"]) await press(c, key);
        expectClicks([heard("P-02", "hall"), heard("P-01", "name")]);
    });

    test("`onSelect` hears the ring move, by a press or a key, as the Sheet's does", async () => {
        const { container: c } = await h.mount({ fn: pressesHeard }, { storageKey: "record-row-click-select" });
        await click(cellOf(c, "P-02", "hall"));
        await press(c, "ArrowDown");
        const moves = selections();
        expect(equalFor(Selections)(moves, [
            { rowId: some("P-02"), line: none, key: some("hall") },
            { rowId: some("P-03"), line: none, key: some("hall") },
        ]), printFor(Selections)(moves)).toBe(true);
    });

    test("over a record keyed by Integer, the key arrives as an Integer — a row Add made too, under the key Add gave it", async () => {
        const { container: c } = await h.mount({ fn: benchesHeard }, { storageKey: "record-row-click-benches" });
        await click(cellOf(c, "7", "name"));
        const add = slot(c, "toolbar")!.querySelector<HTMLButtonElement>('[data-record-action="add"]')!;
        fireEvent.mouseDown(add, { button: 0 });
        fireEvent.click(add);
        await settle();
        // One past the largest key the record holds.
        expect(ids(c)).toContain("8");
        await click(cellOf(c, "8", "name"));
        const got = numberClicks();
        expect(equalFor(NumberClicks)(got, [
            { key: 7n, index: none, column: some("name") },
            { key: 8n, index: none, column: some("name") },
        ]), printFor(NumberClicks)(got)).toBe(true);
    });

    test("a row an edit moved under another key clicks with the key it stands under now (`rowKey`, east-workspace#1709)", async () => {
        const { container: c } = await h.mount({ fn: racksHeard }, { storageKey: "record-row-click-racks" });
        // R-1's code typed over, as a paste types it: the rack moves under its new code.
        fireEvent.mouseDown(cellOf(c, "R-1", "code"), { button: 0, detail: 1 });
        fireEvent.mouseUp(cellOf(c, "R-1", "code"), { button: 0, detail: 1 });
        await act(async () => { fireEvent.paste(grid(c), { clipboardData: { getData: () => "R-9" } }); });
        await settle();
        expect(ids(c)).toContain("R-9");
        await click(cellOf(c, "R-9", "bay"));
        expectClicks([heard("R-1", "code"), heard("R-9", "bay")]);
    });

    test("a press that commits an edit moving its row under another key clicks the row there — drawn again in another place, another row's cell under the pointer as the button lifts (`rowKey`, east-workspace#1709)", async () => {
        const { container: c } = await h.mount({ fn: racksHeard }, { storageKey: "record-row-click-rekeyed" });
        // R-1's code typed over and left open: the next press commits it.
        await click(cellOf(c, "R-1", "code"));
        await press(c, "R");
        fireEvent.input(c.querySelector('[data-slot="editorInput"]')!, { target: { value: "R-9" } });
        await settle();
        // A press on R-1's bay, the button held: the code is committed, and the rack moves under R-9, after R-2.
        placeAt(cellOf(c, "R-1", "bay"), { left: 200, top: 40, width: 120, height: 32 });
        fireEvent.mouseDown(cellOf(c, "R-1", "bay"), { button: 0, detail: 1, clientX: 260, clientY: 56 });
        await settle();
        expect(ids(c)).toEqual(["R-2", "R-9"]);
        // The button lifts where it was pressed — over R-2's bay now.
        fireEvent.mouseUp(cellOf(c, "R-2", "bay"), { button: 0, detail: 1, clientX: 260, clientY: 56 });
        await settle();
        expectClicks([heard("R-1", "code"), heard("R-9", "bay")]);
    });
});
