/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 *
 * @vitest-environment jsdom
 *
 * Typing a number into a table cell (#1436, #1438), on e3 itself: the twenty
 * ledgers paged lean beside their nested series index, each leaf measure's
 * readings `edit: true`, every Save one commit through the record's patch
 * door, by key.
 *
 * - A leaf's week value typed: the ledger read whole once, the value drawn at
 *   once, every subtotal above it moved by the difference from e3's preview;
 *   its Save commits that value alone. A second value typed reads nothing.
 * - While the ledger is read whole, the leaf and every row above it draw in
 *   flight.
 * - Cleared, the value goes; typed into the empty bucket, it comes back.
 * - Enter, F2, a double click or a digit opens the input; Tab and Shift+Tab
 *   move along the row, ↑ and ↓ to the rows above and below that take typing,
 *   and Esc writes nothing.
 * - A parent's cell takes none, and nor does a bucket folding several values,
 *   whose tooltip names the resolution they are at and the Plan's zoom showing
 *   them apart, where it has one.
 * - At a zoom coarser than the Plan's finest, each cell is a summary of the
 *   values beneath it and takes none: its tooltip says to zoom to the finest,
 *   and a double click, Enter or a tap below 480px of main zooms there about
 *   its period, on the row's cell at its middle, where a number typed into a
 *   week holding one value replaces it at its date. The resolution is the
 *   slice's: a Plan without one has no zoom but the one it shows.
 * - Below 480px of main, a tap on a cell opens the input in a popover anchored
 *   to it, its Enter writing as above. A card reads its row's nested series
 *   whatever the desktop folds, washed while they are read.
 */

import { describe, test, expect, beforeEach, afterEach } from "vitest";
import { fireEvent, waitFor, within } from "@testing-library/react";
import { DictType, East, PatchType, SortedMap, StringType, compareFor, decodeBeast2For, equalFor, DateTimeType, some, type ValueTypeOf } from "@elaraai/east";
import { editingMessages } from "@elaraai/east-ui-components";
import { Reactive, Slice, UIComponentType } from "@elaraai/east-ui/internal";
import { Data, Plan, Record } from "@elaraai/e3-ui/internal";
import * as ex from "@elaraai/e3-ui/fixtures/plan/plan-nested";
import { MutationCallRequestType, type TreePath } from "@elaraai/e3-types";
import { instantKey, timeInstant } from "../instant.js";
import { rowKeyOf } from "../model.js";
import { planMessages } from "../messages.js";
import { act, entry, planHarness, rowAt, settle, slot } from "./harness.test-utils.js";

const h = planHarness({ "plan/plan-nested.fixtures": ex });

/** The ledgers' record, as e3's requests name it. */
const LEDGERS = (ex.ledgers.path as TreePath).map((step) => step.value).join(".");

/** The weeks the canvas shows, Monday to Monday, at each resolution it is typed at. */
const WINDOWS = {
    week: { min: new Date("2026-01-05T00:00:00Z"), max: new Date("2026-03-02T00:00:00Z") },
    month: { min: new Date("2026-01-01T00:00:00Z"), max: new Date("2026-07-01T00:00:00Z") },
} as const;

/** How the ledgers' Plan is mounted: the resolutions its axis names beside the one it opens at, and whether a slice holds them. */
interface LedgersTyped {
    readonly resolutions?: readonly (keyof typeof WINDOWS)[];
    /** Its rows paged through a slice, which holds the resolution, so the Plan zooms: without one it shows the one it opens at. */
    readonly sliced?: boolean;
    /** Its measures folded on the desktop, so it lays out none of their children. */
    readonly collapsed?: boolean;
}

/**
 * The twenty ledgers paged lean beside their nested series index, each leaf measure's readings taking a typed number: at
 * a resolution, its axis naming `resolutions` beside it, where given, and zooming to them through a slice, where `sliced`.
 */
const ledgersTyped = (resolution: keyof typeof WINDOWS, { resolutions, sliced = false, collapsed = false }: LedgersTyped = {}) => ({ fn: East.function([], UIComponentType, (_$) => Reactive.Root(East.function([], UIComponentType, ($) => {
    const record = $.const(Record.bind(ex.ledgers, ["patch"]));
    const ledgers = Data.bindPaged(ex.ledgers, { indexes: ["ledgers_by_site", "ledgers_in_time"] });
    return Plan({
        axis: Plan.axis({ window: WINDOWS[resolution], resolution, ...(resolutions === undefined ? {} : { resolutions: [...resolutions] }) }),
        ...(sliced
            ? { slice: { slice: $.const(Slice.bindRecords("ledgers", { rows: { source: ledgers, fields: { site: { label: "Site" } } } })) } }
            : { data: $.const(ledgers) }),
        series: [Plan.series.group(ex.Ledger, {
            key: "ledgers", title: "Ledgers", label: (l) => l.name,
            children: Plan.children("measures", [Plan.series.table(ex.Measure, {
                key: "readings", title: "Readings", label: (m) => m.label, children: "children", aggregate: "sum", collapsed,
                cells: Plan.tableCells(Plan.values("readings", (v) => ({ value: some(v) }))), edit: true,
            })]),
        })],
        editing: { onApply: Record.onApply(record, { keyed: true }) },
    });
}))) });

/** Ledger 101's measures by their path: its first top measure, that one's first middle one, and its three leaves. */
const TOP = rowAt(entry("readings", "L-101", "101.1"));
const MIDDLE = rowAt(entry("readings", "L-101", "101.1", "101.1.1"));
const LEAF = rowAt(entry("readings", "L-101", "101.1", "101.1.1", "101.1.1.1"));
const LEAF_2 = rowAt(entry("readings", "L-101", "101.1", "101.1.1", "101.1.1.2"));

const JAN_1 = new Date("2026-01-01T00:00:00Z");
const JAN_5 = new Date("2026-01-05T00:00:00Z");
const JAN_7 = new Date("2026-01-07T00:00:00Z");
const JAN_12 = new Date("2026-01-12T00:00:00Z");
const JAN_19 = new Date("2026-01-19T00:00:00Z");
const FEB_1 = new Date("2026-02-01T00:00:00Z");
const FEB_9 = new Date("2026-02-09T00:00:00Z");
/** A cell, by its row and its bucket's start. */
const cellAt = (c: HTMLElement, row: string, at: Date) =>
    [...c.querySelectorAll<HTMLElement>(`${row} [data-cell]`)].find((cell) => cell.getAttribute("data-cell") === instantKey(timeInstant(at)));
/** What a cell prints. */
const printed = (c: HTMLElement, row: string, at: Date) => cellAt(c, row, at)?.textContent ?? "no cell";
/** The open input, if any: its field, and the row and bucket it is open on. */
const inputOf = (c: HTMLElement) => c.querySelector<HTMLInputElement>("[data-plan-typing] input");
/** The row holding the open input. */
const inputRow = (c: HTMLElement) => inputOf(c)?.closest("[data-plan-row]")?.getAttribute("data-plan-row");

/** Type text into the open input, as the Sheet's tests type into the same field. */
async function typeIn(c: HTMLElement, text: string) {
    await act(async () => { fireEvent.input(inputOf(c)!, { target: { value: text } }); });
}
/** Press a key in the open input. */
async function press(c: HTMLElement, key: string, shiftKey = false) {
    await act(async () => { fireEvent.keyDown(inputOf(c)!, { key, shiftKey }); });
}
/** Open the input on a cell with a double click. */
async function openOn(c: HTMLElement, row: string, at: Date) {
    await act(async () => { fireEvent.doubleClick(cellAt(c, row, at)!); });
}

type LedgerValue = ValueTypeOf<typeof ex.Ledger>;
type MeasureValue = ValueTypeOf<typeof ex.Measure>;
const sameDay = equalFor(DateTimeType);
/** A measure of a ledger, by its path. */
const measureOf = (ledger: LedgerValue, ...path: string[]): MeasureValue => {
    let at = ledger.measures.get(path[0]!)!;
    for (const key of path.slice(1)) at = at.children.get(key)!;
    return at;
};
const readLedgers = async () => (await h.read(ex.ledgers)) as ReadonlyMap<string, LedgerValue>;
/** The ledgers' Plan opened at the month, zooming to the week through its slice. */
const ZOOMING = ledgersTyped("month", { resolutions: ["week", "month"], sliced: true });

/** Ledger 101's first leaf: January holding one reading, the one of its week of the 5th moved to Wednesday the 7th. */
async function januaryOnTheSeventh(): Promise<{ path: readonly string[]; reading: number }> {
    const before = await readLedgers();
    const path = ["101.1", "101.1.1", "101.1.1.1"] as const;
    const reading = measureOf(before.get("L-101")!, ...path).readings.get(JAN_5)!;
    const order = compareFor(DateTimeType);
    const withLeaf = (measures: ReadonlyMap<string, MeasureValue>, [key, ...rest]: readonly string[]): Map<string, MeasureValue> =>
        new Map([...measures].map(([k, m]) => [k, k !== key ? m : rest.length === 0
            ? { ...m, readings: new SortedMap([...[...m.readings].filter(([at]) => order(at, JAN_1) < 0 || order(at, FEB_1) >= 0), [JAN_7, reading]], order) }
            : { ...m, children: withLeaf(m.children, rest) }]));
    await h.commit(ex.ledgers, new Map([...before].map(([k, l]) => [k, k === "L-101" ? { ...l, measures: withLeaf(l.measures, path) } : l])));
    return { path, reading };
}

describe("a number typed into a table cell (#1438)", () => {
    test("a leaf's week value typed reads its ledger whole once, draws at once with every subtotal above it moved by the difference, and its Save commits that value alone", async () => {
        const before = await readLedgers();
        const { container: c } = await h.mount(ledgersTyped("week"));
        await settle();
        expect([printed(c, LEAF, JAN_12), printed(c, MIDDLE, JAN_12), printed(c, TOP, JAN_12)]).toEqual(["2", "9", "54"]);
        const rowsAsked = h.requests("rows", LEDGERS).length;
        await openOn(c, LEAF, JAN_12);
        expect(inputOf(c)!.value).toBe("2");
        await typeIn(c, "15");
        await press(c, "Enter");
        await settle();
        expect(inputOf(c)).toBeNull();
        expect(h.requests("rows", LEDGERS).length - rowsAsked).toBe(1);
        await waitFor(() => expect([printed(c, LEAF, JAN_12), printed(c, MIDDLE, JAN_12), printed(c, TOP, JAN_12)]).toEqual(["15", "22", "67"]));
        // A second value typed, in a row held whole now, reads nothing.
        await openOn(c, LEAF_2, JAN_19);
        await typeIn(c, "10");
        await press(c, "Enter");
        await settle();
        expect(h.requests("rows", LEDGERS).length - rowsAsked).toBe(1);
        await waitFor(() => expect(printed(c, MIDDLE, JAN_19)).toBe(String(3 + 10 + 5)));
        await act(async () => { fireEvent.click(within(slot(c, "toolbar") ?? c).getByRole("button", { name: editingMessages.apply() })); });
        await settle();
        // e3 holds the two values typed, and every other value of the ledger, and every other ledger, as it was.
        const after = await readLedgers();
        const was = before.get("L-101")!;
        const now = after.get("L-101")!;
        expect(measureOf(now, "101.1", "101.1.1", "101.1.1.1").readings.get(JAN_12)).toBe(15);
        expect(measureOf(now, "101.1", "101.1.1", "101.1.1.2").readings.get(JAN_19)).toBe(10);
        for (const [leaf, typed] of [["101.1.1.1", JAN_12], ["101.1.1.2", JAN_19]] as const) {
            for (const [at, value] of measureOf(was, "101.1", "101.1.1", leaf).readings) {
                if (!sameDay(at, typed)) expect(measureOf(now, "101.1", "101.1.1", leaf).readings.get(at)).toBe(value);
            }
        }
        expect(measureOf(now, "101.1", "101.1.1", "101.1.1.3")).toEqual(measureOf(was, "101.1", "101.1.1", "101.1.1.3"));
        expect(after.get("L-102")).toEqual(before.get("L-102"));
    });

    test("while its ledger is read whole, the leaf typed into and every row above it draw in flight, then land with the value drafted", async () => {
        const { container: c } = await h.mount(ledgersTyped("week"));
        await settle();
        const read = h.e3.hold((request) => request.dataset === LEDGERS && request.kind === "rows");
        await openOn(c, LEAF, JAN_12);
        await typeIn(c, "15");
        await press(c, "Enter");
        await read.holding;
        // The leaf, its middle measure and its top measure wash as in flight; its sibling does not.
        const inFlight = () => [LEAF, MIDDLE, TOP, LEAF_2].map((row) => c.querySelector(`${row} [data-plan-unread]`) !== null);
        await waitFor(() => expect(inFlight()).toEqual([true, true, true, false]));
        read.release();
        await settle();
        expect(inFlight()).toEqual([false, false, false, false]);
        await waitFor(() => expect([printed(c, LEAF, JAN_12), printed(c, MIDDLE, JAN_12)]).toEqual(["15", "22"]));
    });

    test("Undo, Redo and Discard leave every subtotal as the session then stands", async () => {
        const { container: c } = await h.mount(ledgersTyped("week"));
        await settle();
        const weekOf = () => [LEAF, MIDDLE, TOP].map((row) => printed(c, row, JAN_12));
        await openOn(c, LEAF, JAN_12);
        await typeIn(c, "15");
        await press(c, "Enter");
        await settle();
        await waitFor(() => expect(weekOf()).toEqual(["15", "22", "67"]));
        const historyButton = async (name: string) => {
            const button = within(slot(c, "toolbar") ?? c).getByRole("button", { name });
            await act(async () => { fireEvent.mouseDown(button, { button: 0 }); fireEvent.click(button); });
            await settle();
        };
        await historyButton(editingMessages.undo());
        await waitFor(() => expect(weekOf()).toEqual(["2", "9", "54"]));
        await historyButton(editingMessages.redo());
        await waitFor(() => expect(weekOf()).toEqual(["15", "22", "67"]));
        await historyButton(editingMessages.discard());
        await waitFor(() => expect(weekOf()).toEqual(["2", "9", "54"]));
    });

    test("Save is one commit naming the one ledger and the one measure under it, and a remount draws the value saved", async () => {
        const { container: c } = await h.mount(ledgersTyped("week"));
        await settle();
        await openOn(c, LEAF, JAN_12);
        await typeIn(c, "15");
        await press(c, "Enter");
        await settle();
        await act(async () => { fireEvent.click(within(slot(c, "toolbar") ?? c).getByRole("button", { name: editingMessages.apply() })); });
        await settle();
        const commits = h.requests("mutate", ex.ledgers.name);
        expect(commits).toHaveLength(1);
        // The patch names ledger 101 alone, and in it the top measure the leaf is under: a node of a recursive tree is a
        // whole value to East's patches.
        const patch = decodeBeast2For(PatchType(DictType(StringType, ex.Ledger)))(decodeBeast2For(MutationCallRequestType)(commits[0]!.body!).args[0]!);
        expect(patch.type).toBe("patch");
        if (patch.type !== "patch") return;
        expect([...patch.value.keys()]).toEqual(["L-101"]);
        const ledger = patch.value.get("L-101")!;
        expect(ledger.type === "update" && ledger.value.type === "patch" ? ledger.value.value.measures.type : ledger.type).toBe("patch");
        if (ledger.type !== "update" || ledger.value.type !== "patch" || ledger.value.value.measures.type !== "patch") return;
        expect([...ledger.value.value.measures.value.keys()]).toEqual(["101.1"]);
        const { container: again } = await h.mount(ledgersTyped("week"), { storageKey: "again" });
        await settle();
        expect([LEAF, MIDDLE, TOP].map((row) => printed(again, row, JAN_12))).toEqual(["15", "22", "67"]);
    });

    test("cleared, a value goes and its subtotals with it; typed into the empty bucket, it comes back", async () => {
        const { container: c } = await h.mount(ledgersTyped("week"));
        await settle();
        await openOn(c, LEAF, JAN_12);
        await typeIn(c, "");
        await press(c, "Enter");
        await settle();
        await waitFor(() => expect([printed(c, LEAF, JAN_12), printed(c, MIDDLE, JAN_12)]).toEqual(["", "7"]));
        expect(cellAt(c, LEAF, JAN_12)!.getAttribute("data-typed")).toBe("0");
        await openOn(c, LEAF, JAN_12);
        expect(inputOf(c)!.value).toBe("");
        await typeIn(c, "4");
        await press(c, "Enter");
        await settle();
        await waitFor(() => expect([printed(c, LEAF, JAN_12), printed(c, MIDDLE, JAN_12)]).toEqual(["4", "11"]));
    });

    test("Enter, F2 and a digit open the input; Tab and Shift+Tab move along the row, ↑ and ↓ across the rows that take typing, and Esc writes nothing", async () => {
        const { container: c } = await h.mount(ledgersTyped("week"));
        await settle();
        const cell = cellAt(c, LEAF, JAN_12)!;
        await act(async () => { cell.focus(); fireEvent.keyDown(cell, { key: "Enter" }); });
        expect(inputOf(c)!.value).toBe("2");
        await press(c, "Tab");
        expect([inputRow(c), inputOf(c)!.value]).toEqual([cellRowKey(LEAF), "3"]);
        await press(c, "Tab", true);
        expect(inputOf(c)!.value).toBe("2");
        await press(c, "ArrowDown");
        expect([inputRow(c), inputOf(c)!.value]).toEqual([cellRowKey(LEAF_2), "3"]);
        await press(c, "ArrowUp");
        expect([inputRow(c), inputOf(c)!.value]).toEqual([cellRowKey(LEAF), "2"]);
        // Above the first leaf, its parents take none, and nor does any row above them.
        await press(c, "ArrowUp");
        expect(inputOf(c)).toBeNull();
        await act(async () => { fireEvent.keyDown(cell, { key: "F2" }); });
        await typeIn(c, "99");
        await press(c, "Escape");
        expect(inputOf(c)).toBeNull();
        await act(async () => { fireEvent.keyDown(cell, { key: "7" }); });
        expect(inputOf(c)!.value).toBe("7");
        await press(c, "Escape");
        await settle();
        // Nothing was written: every cell as it was, and nothing read whole.
        expect([printed(c, LEAF, JAN_12), printed(c, MIDDLE, JAN_12)]).toEqual(["2", "9"]);
        expect(h.requests("rows", LEDGERS)).toEqual([]);
    });

    test("a parent's cell takes no typing; at the month of a Plan with no slice, its one zoom however its axis names the week, a leaf's cell folding its weeks takes none either, its tooltip saying no zoom of this Plan's shows them apart", async () => {
        const { container: c } = await h.mount(ledgersTyped("week"));
        await settle();
        expect([MIDDLE, TOP].map((row) => cellAt(c, row, JAN_12)!.hasAttribute("data-typed"))).toEqual([false, false]);
        await openOn(c, MIDDLE, JAN_12);
        expect(inputOf(c)).toBeNull();
        const { container: m } = await h.mount(ledgersTyped("month", { resolutions: ["week", "month"] }), { storageKey: "month" });
        await settle();
        const january = cellAt(m, LEAF, new Date("2026-01-01T00:00:00Z"))!;
        expect(january.hasAttribute("data-typed")).toBe(false);
        expect(january.getAttribute("data-plan-note")).toBe(planMessages.typedFolded({ resolution: "week", zoom: undefined }));
        await openOn(m, LEAF, new Date("2026-01-01T00:00:00Z"));
        expect(inputOf(m)).toBeNull();
    });

    test("at the month of a Plan zooming to the week, a leaf's cell is a summary: it takes no number, saying to zoom to the week, and a double click zooms there about its month, on that row's cell at its middle, where a number typed into the week holding one value replaces it at its date", async () => {
        const { path, reading } = await januaryOnTheSeventh();
        const { container: c } = await h.mount(ZOOMING);
        await settle();
        const january = cellAt(c, LEAF, JAN_1)!;
        expect(printed(c, LEAF, JAN_1)).toBe(String(reading));
        expect([january.hasAttribute("data-typed"), january.getAttribute("data-plan-note")]).toEqual([false, planMessages.typedZoomTo({ zoom: "week" })]);
        // A parent's says nothing: it takes no typing at any zoom.
        expect(cellAt(c, MIDDLE, JAN_1)!.hasAttribute("data-plan-note")).toBe(false);
        await openOn(c, LEAF, JAN_1);
        await settle();
        expect(inputOf(c)).toBeNull();
        // At the week, about January's middle: the leaf's cell holding it focused, the week of the 5th holding the reading.
        await waitFor(() => expect(document.activeElement).toBe(cellAt(c, LEAF, JAN_12)));
        expect([cellAt(c, LEAF, JAN_5)!.getAttribute("data-typed"), printed(c, LEAF, JAN_5)]).toEqual(["0", String(reading)]);
        await openOn(c, LEAF, JAN_5);
        expect(inputOf(c)!.value).toBe(String(reading));
        await typeIn(c, "100");
        await press(c, "Enter");
        await settle();
        await waitFor(() => expect(printed(c, LEAF, JAN_5)).toBe("100"));
        // Saved, the number is the reading of the 7th, and none is kept at the 5th.
        await act(async () => { fireEvent.click(within(slot(c, "toolbar") ?? c).getByRole("button", { name: editingMessages.apply() })); });
        await settle();
        const saved = measureOf((await readLedgers()).get("L-101")!, ...path);
        expect([saved.readings.get(JAN_7), saved.readings.has(JAN_5)]).toEqual([100, false]);
    });

    test("at the month, a digit or F2 on a leaf's summary opens nothing, and Enter zooms to the week about it as a double click does", async () => {
        const { container: c } = await h.mount(ZOOMING);
        await settle();
        const february = cellAt(c, LEAF, FEB_1)!;
        await act(async () => { february.focus(); fireEvent.keyDown(february, { key: "7" }); fireEvent.keyDown(february, { key: "F2" }); });
        expect(inputOf(c)).toBeNull();
        expect(cellAt(c, LEAF, FEB_1)).toBe(february);
        await act(async () => { fireEvent.keyDown(february, { key: "Enter" }); });
        await settle();
        // February's middle is the 15th, in the week of the 9th.
        await waitFor(() => expect(document.activeElement).toBe(cellAt(c, LEAF, FEB_9)));
        expect(inputOf(c)).toBeNull();
    });
});

describe("below 480px of main (#1438)", () => {
    const realRect = Element.prototype.getBoundingClientRect;
    const realObserver = globalThis.ResizeObserver;
    /** Every ResizeObserver the frame and the canvas made — fired as a browser fires them when their container resizes. */
    const observers = new Set<ResizeObserverProbe>();
    class ResizeObserverProbe {
        constructor(readonly callback: ResizeObserverCallback) {}
        observe(): void { observers.add(this); }
        unobserve(): void {}
        disconnect(): void { observers.delete(this); }
    }
    beforeEach(() => { (globalThis as { ResizeObserver?: unknown }).ResizeObserver = ResizeObserverProbe; });
    afterEach(() => {
        Element.prototype.getBoundingClientRect = realRect;
        (globalThis as { ResizeObserver?: unknown }).ResizeObserver = realObserver;
        observers.clear();
    });

    /** The container narrows to `px`: every element measures it, every observer fires, and the canvas measures again on the next frame. */
    async function narrowTo(px: number): Promise<void> {
        Element.prototype.getBoundingClientRect = function () {
            return { left: 0, top: 0, right: px, bottom: 600, width: px, height: 600, x: 0, y: 0, toJSON: () => ({}) } as DOMRect;
        };
        await act(async () => {
            for (const ro of [...observers]) ro.callback([], ro as unknown as ResizeObserver);
            await new Promise<void>((resolve) => { requestAnimationFrame(() => resolve()); });
        });
        await settle();
    }

    /** A row's card, by its id. */
    const card = (id: ReturnType<typeof entry>) => `[data-plan-card=${JSON.stringify(rowKeyOf(id))}]`;
    const leaf = card(entry("readings", "L-101", "101.1", "101.1.1", "101.1.1.1"));
    const middle = card(entry("readings", "L-101", "101.1", "101.1.1"));

    /** Narrows the container to a phone's width, and opens ledger 101's rows as cards. */
    async function ledger101AsCards(c: HTMLElement): Promise<void> {
        await narrowTo(390);
        expect(c.querySelector("[data-plan-narrow]")).toBeTruthy();
        const group = [...c.querySelectorAll<HTMLElement>("[data-plan-groupcard]")]
            .find((el) => el.getAttribute("data-plan-groupcard") === rowKeyOf(entry("ledgers", "L-101")))!;
        await act(async () => { fireEvent.click(group); });
        await settle();
    }

    test("a tap on a leaf's cell opens the input in a popover anchored to it; its Enter writes the value, every subtotal above it moving", async () => {
        const { container: c } = await h.mount(ledgersTyped("week"));
        await settle();
        await ledger101AsCards(c);
        const tapped = cellAt(c, leaf, JAN_12)!;
        expect(tapped.getAttribute("data-typed")).toBe("0");
        await act(async () => { fireEvent.click(tapped); });
        await waitFor(() => expect(document.querySelector("[data-plan-typing-popover]")).not.toBeNull());
        const popover = document.querySelector<HTMLElement>("[data-plan-typing-popover]");
        const input = popover!.querySelector<HTMLInputElement>("input")!;
        expect(input.value).toBe("2");
        await act(async () => { fireEvent.input(input, { target: { value: "15" } }); });
        await act(async () => { fireEvent.keyDown(input, { key: "Enter" }); });
        await settle();
        expect(document.querySelector("[data-plan-typing-popover]")).toBeNull();
        await waitFor(() => expect([printed(c, leaf, JAN_12), printed(c, middle, JAN_12)]).toEqual(["15", "22"]));
    });

    test("with its measures folded on the desktop, a leaf's card reads its readings, washed while they are read, and a tap on one takes a typed number, the subtotals above it moving", async () => {
        const { container: c } = await h.mount(ledgersTyped("week", { collapsed: true }));
        await settle();
        // Folded, the desktop lays out none of ledger 101's leaves.
        expect(c.querySelector(LEAF)).toBeNull();
        await narrowTo(390);
        // Ledger 101's rows as cards, their readings' reads held: its leaf's card washes until they land.
        const reads = h.e3.hold((request) => request.kind === "find");
        const group = [...c.querySelectorAll<HTMLElement>("[data-plan-groupcard]")]
            .find((el) => el.getAttribute("data-plan-groupcard") === rowKeyOf(entry("ledgers", "L-101")))!;
        await act(async () => { fireEvent.click(group); });
        await waitFor(() => expect(c.querySelector(`${leaf} [data-plan-unread]`)).not.toBeNull());
        reads.release();
        await settle();
        await waitFor(() => expect([printed(c, leaf, JAN_12), printed(c, middle, JAN_12)]).toEqual(["2", "9"]));
        expect(c.querySelector(`${leaf} [data-plan-unread]`)).toBeNull();
        const tapped = cellAt(c, leaf, JAN_12)!;
        await act(async () => { fireEvent.click(tapped); });
        await waitFor(() => expect(document.querySelector("[data-plan-typing-popover]")).not.toBeNull());
        const input = document.querySelector<HTMLInputElement>("[data-plan-typing-popover] input")!;
        await act(async () => { fireEvent.input(input, { target: { value: "500" } }); });
        await act(async () => { fireEvent.keyDown(input, { key: "Enter" }); });
        await settle();
        await waitFor(() => expect([printed(c, leaf, JAN_12), printed(c, middle, JAN_12)]).toEqual(["500", "507"]));
    });

    test("at the month of a Plan zooming to the week, a tap on a leaf's summary opens nothing and zooms to the week about it", async () => {
        const { container: c } = await h.mount(ZOOMING);
        await settle();
        await ledger101AsCards(c);
        const january = cellAt(c, leaf, JAN_1)!;
        expect(january.getAttribute("data-plan-note")).toBe(planMessages.typedZoomTo({ zoom: "week" }));
        await act(async () => { fireEvent.click(january); });
        await settle();
        expect(document.querySelector("[data-plan-typing-popover]")).toBeNull();
        // At the week, about January's middle: the card's cell holding it.
        await waitFor(() => expect(cellAt(c, leaf, JAN_12)?.getAttribute("data-typed")).toBe("0"));
    });
});

/** A row selector's key, as `data-plan-row` holds it. */
function cellRowKey(selector: string): string {
    return JSON.parse(selector.slice("[data-plan-row=".length, -1)) as string;
}
