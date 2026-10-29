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
 *   whose tooltip names the resolution they take one at.
 * - Below 480px of main, a tap on a cell opens the input in a popover anchored
 *   to it, its Enter writing as above.
 */

import { describe, test, expect, beforeEach, afterEach } from "vitest";
import { fireEvent, waitFor, within } from "@testing-library/react";
import { DictType, East, PatchType, StringType, decodeBeast2For, equalFor, DateTimeType, some, type ValueTypeOf } from "@elaraai/east";
import { editingMessages } from "@elaraai/east-ui-components";
import { Reactive, UIComponentType } from "@elaraai/east-ui/internal";
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

/** The twenty ledgers paged lean beside their nested series index, each leaf measure's readings taking a typed number. */
const ledgersTyped = (resolution: keyof typeof WINDOWS) => ({ fn: East.function([], UIComponentType, (_$) => Reactive.Root(East.function([], UIComponentType, ($) => {
    const record = $.const(Record.bind(ex.ledgers, ["patch"]));
    const ledgers = $.const(Data.bindPaged(ex.ledgers, { indexes: ["ledgers_by_site", "ledgers_in_time"] }));
    return Plan({
        axis: Plan.axis({ window: WINDOWS[resolution], resolution }), data: ledgers,
        series: [Plan.series.group(ex.Ledger, {
            key: "ledgers", title: "Ledgers", label: (l) => l.name,
            children: Plan.children("measures", [Plan.series.table(ex.Measure, {
                key: "readings", title: "Readings", label: (m) => m.label, children: "children", aggregate: "sum",
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

const JAN_12 = new Date("2026-01-12T00:00:00Z");
const JAN_19 = new Date("2026-01-19T00:00:00Z");
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

    test("a parent's cell takes no typing; at the month, a leaf's cell folding its weeks takes none either, its tooltip saying where they take one", async () => {
        const { container: c } = await h.mount(ledgersTyped("week"));
        await settle();
        expect([MIDDLE, TOP].map((row) => cellAt(c, row, JAN_12)!.hasAttribute("data-typed"))).toEqual([false, false]);
        await openOn(c, MIDDLE, JAN_12);
        expect(inputOf(c)).toBeNull();
        const { container: m } = await h.mount(ledgersTyped("month"), { storageKey: "month" });
        await settle();
        const january = cellAt(m, LEAF, new Date("2026-01-01T00:00:00Z"))!;
        expect(january.hasAttribute("data-typed")).toBe(false);
        expect(january.getAttribute("data-plan-note")).toBe(planMessages.typedFolded({ resolution: "week" }));
        await openOn(m, LEAF, new Date("2026-01-01T00:00:00Z"));
        expect(inputOf(m)).toBeNull();
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

    test("a tap on a leaf's cell opens the input in a popover anchored to it; its Enter writes the value, every subtotal above it moving", async () => {
        const { container: c } = await h.mount(ledgersTyped("week"));
        await settle();
        await narrowTo(390);
        expect(c.querySelector("[data-plan-narrow]")).toBeTruthy();
        // Ledger 101's rows, as cards.
        const group = [...c.querySelectorAll<HTMLElement>("[data-plan-groupcard]")]
            .find((card) => card.getAttribute("data-plan-groupcard") === rowKeyOf(entry("ledgers", "L-101")))!;
        await act(async () => { fireEvent.click(group); });
        await settle();
        const card = (id: ReturnType<typeof entry>) => `[data-plan-card=${JSON.stringify(rowKeyOf(id))}]`;
        const leaf = card(entry("readings", "L-101", "101.1", "101.1.1", "101.1.1.1"));
        const middle = card(entry("readings", "L-101", "101.1", "101.1.1"));
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
});

/** A row selector's key, as `data-plan-row` holds it. */
function cellRowKey(selector: string): string {
    return JSON.parse(selector.slice("[data-plan-row=".length, -1)) as string;
}
