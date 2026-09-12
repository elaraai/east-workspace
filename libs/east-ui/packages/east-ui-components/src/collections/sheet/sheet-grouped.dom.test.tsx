/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 *
 * @vitest-environment jsdom
 *
 * Grouped rows (#740 — G1–G12): a band per plan over its lines, numbered
 * from 1 per plan, one blank line per open plan, the `+ plan` ghost band;
 * folds; a line's commit, a blank line's insert, a band cell's commit and
 * the title rename; the ghost band creating a plan; the two-step delete;
 * paste into a plan and a copy that skips bands; the lens over lines. Every
 * value built by the east-ui factory and COMPILED.
 */

import { describe, test, expect, afterEach, beforeEach } from "vitest";
import { render, cleanup, fireEvent, waitFor, act } from "@testing-library/react";
import { ChakraProvider } from "@chakra-ui/react";
import {
    ArrayType, DateTimeType, East, FloatType, OptionType, StringType, StructType,
    none, some, variant, type ValueTypeOf,
} from "@elaraai/east";
import { Paged, StatusValueType } from "@elaraai/east-ui";
import { Sheet, Slice, UIComponentType } from "@elaraai/east-ui/internal";
import { system } from "../../theme/index.js";
import { initializeStore } from "../../platform/state-runtime.js";
import { UIStore } from "../../platform/state-store.js";
import { getRegisteredPlatformImplementations } from "../../platform/registry.js";
import "../../platform/slice/index.js";
import { EastChakraSheet } from "./index.js";
import type { SheetEditValue, SheetRootValue, SheetRowValue } from "./values.js";

afterEach(cleanup);
beforeEach(() => { initializeStore(new UIStore()); });

// jsdom lacks the browser APIs Chakra's Combobox positioner relies on.
class ResizeObserverStub { observe() {} unobserve() {} disconnect() {} }
(globalThis as unknown as { ResizeObserver?: unknown }).ResizeObserver ??= ResizeObserverStub;

const LineType = StructType({ start: OptionType(DateTimeType), task: StringType, qty: OptionType(FloatType), status: StringType });
const PlanType = StructType({ id: StringType, name: StringType, owner: StringType, status: StringType, total: FloatType, lines: ArrayType(LineType) });
const StatusType = StructType({ word: StringType, tone: StatusValueType });

/** Fixtures at MODULE scope: East bodies never call host helpers. */
const FEB16 = new Date("2026-02-16T00:00:00Z");
const PLANS = [
    { id: "p1", name: "Line 2 week 8", owner: "planner", status: "PLANNED", total: 300.0, lines: [
        { start: some(FEB16), task: "Machining", qty: some(120.0), status: "RELEASED" },
        { start: none, task: "Painting", qty: none, status: "" },
    ] },
    { id: "p2", name: "Line 3 week 8", owner: "erp", status: "COMPLETE", total: 90.0, lines: [
        { start: none, task: "Inspection", qty: some(90.0), status: "" },
    ] },
];
const STATUSES = [
    { word: "PLANNED", tone: variant("neutral", null) },
    { word: "RELEASED", tone: variant("info", null) },
    { word: "COMPLETE", tone: variant("success", null) },
];
const NARROW = (search: string) => ({
    range: none, compare: none, filters: [], cohorts: [], activeCohorts: new Set<string>(),
    breakdown: none, search: some(search), visible: none, selectedIndex: none, resolution: none,
});
const LINES = PLANS.flatMap((p) => p.lines);
const VIEWS = [{ id: "paint", name: "PAINT", narrowing: NARROW("paint"), context: 0n, reveals: [], folds: new Map<string, boolean>() }];

type Options = { lens?: boolean; readOnly?: boolean };

/** A grouped sheet the way an author builds one: plans over their lines, a band with a title, an eyebrow and two band cells, completed plans folded. */
function buildGrouped(opts: Options = {}): SheetRootValue {
    const program = East.function([], UIComponentType, ($) => {
        const plans = $.const(PLANS, ArrayType(PlanType));
        const statuses = $.const(STATUSES, ArrayType(StatusType));
        const lines = $.const(LINES, ArrayType(LineType));
        const views = $.const(VIEWS, ArrayType(Sheet.Types.View));
        const cfg = $.const(Slice.config(LineType, { fields: { task: { label: "Task" } }, searchFieldIds: ["task"] }));
        const slice = $.let(Slice.bind([LineType], "sheet_grouped_dom", cfg, Slice.state(), lines, none));
        return Sheet.Root(plans, {
            start:  Sheet.column.date(LineType, { header: "Start" }),
            task:   Sheet.column.text(LineType, { header: "Task" }),
            qty:    Sheet.column.quantity(LineType, { header: "Qty" }),
            status: Sheet.column.enum(LineType, "statuses", { header: "Status" }),
        }, {
            id: "id",
            group: Sheet.group(PlanType, "lines", {
                title: "name",
                sub: (p) => East.str`${p.owner} · ${p.status}`,
                cells: {
                    qty:    Sheet.group.cell.quantity(PlanType, "total", { editable: false }),
                    status: Sheet.group.cell.enum(PlanType, "statuses", "status"),
                },
                folded: (p) => p.status.equal("COMPLETE"),
            }),
            registers: { statuses: Sheet.register.members(statuses, { kind: "status", key: (s) => s.word, label: (s) => s.word, tone: (s) => some(s.tone) }) },
            ...(opts.lens ? { slice, affordances: ["search" as const], views, activeView: some("paint") } : {}),
            ...(opts.readOnly ? { readOnly: true } : {}),
        });
    });
    const value = East.compile(program, getRegisteredPlatformImplementations())() as
        ValueTypeOf<typeof UIComponentType> & { value: SheetRootValue };
    return value.value;
}

/** Swap the host's edit channel for a spy after compilation — the renderer takes every function from the value. */
function withSpy(root: SheetRootValue) {
    const edits: SheetEditValue[] = [];
    const value: SheetRootValue = { ...root, onEdit: some((e: SheetEditValue) => { edits.push(e); return null; }) } as SheetRootValue;
    return { value, edits };
}

function mount(value: SheetRootValue) {
    const utils = render(
        <ChakraProvider value={system}>
            <EastChakraSheet value={value} storageKey="sheet-grouped-test" />
        </ChakraProvider>,
    );
    const card = utils.container.querySelector("[data-sheet-card]") as HTMLElement;
    const rows = () => [...utils.container.querySelectorAll('[data-slot="row"]')] as HTMLElement[];
    const band = (id: string) => utils.container.querySelector(`[data-slot="row"][data-band-row][data-row-id="${id}"]`) as HTMLElement | null;
    const lines = (id: string) => [...utils.container.querySelectorAll(`[data-slot="row"][data-group-id="${id}"]`)] as HTMLElement[];
    const numbers = (id: string) => lines(id).map((r) => r.querySelector('[data-slot="gutterNumber"]')!.textContent);
    const ghost = () => utils.container.querySelector('[data-slot="row"][data-ghost-band]') as HTMLElement | null;
    const input = () => utils.container.querySelector('[data-slot="editorInput"]') as HTMLInputElement | null;
    const key = (k: string, init: Partial<KeyboardEventInit> = {}) => fireEvent.keyDown(card, { key: k, ...init });
    const editorKey = (k: string) => fireEvent.keyDown(input()!, { key: k });
    const type = (text: string) => fireEvent.input(input()!, { target: { value: text } });
    const tick = () => new Promise<void>((r) => queueMicrotask(r));
    const flush = () => act(async () => { await tick(); await tick(); });
    const msg = () => utils.container.querySelector('[data-slot="footerMessage"]')!.textContent;
    return { ...utils, card, rows, band, lines, numbers, ghost, input, key, editorKey, type, flush, msg };
}

/** The decoded group row an edit event carries. */
const rowOf = (e: SheetEditValue) => (e.value as { row: SheetRowValue }).row;

describe("the body (G1–G3, G6, G12)", () => {
    test("a band per plan over its lines, numbered from 1 per plan, one blank line per open plan; a folded plan is its band; the extent rule; the footer counts plans and lines", () => {
        const { container, rows, band, lines, numbers, ghost } = mount(buildGrouped());
        // p1 band · 2 lines · its blank line · p2 band (folded). No edit channel ⇒ no ghost band.
        expect(rows()).toHaveLength(5);
        expect(ghost()).toBeNull();
        expect(numbers("p1")).toEqual(["1", "2", "3"]);
        expect(lines("p1").map((r) => r.getAttribute("data-line"))).toEqual(["0", "1", ""]);
        expect(band("p1")!.querySelector('[data-slot="groupTitle"]')!.textContent).toBe("Line 2 week 8");
        expect(band("p1")!.querySelector('[data-slot="groupSub"]')!.textContent).toBe("planner · PLANNED");
        expect(band("p1")!.querySelector('[data-slot="groupCount"]')!.textContent).toBe("2");
        expect(band("p1")!.getAttribute("aria-expanded")).toBe("true");
        // Band cells sit under their line columns; a column with none is empty.
        expect(band("p1")!.querySelector('[data-key="qty"]')!.textContent).toBe("300");
        expect(band("p1")!.querySelector('[data-key="status"] [data-tone="neutral"]')).toBeTruthy();
        expect(band("p1")!.querySelector('[data-key="status"]')!.textContent).toBe("PLANNED");
        // The title spans the columns before the first band cell: start · task.
        expect(band("p1")!.querySelector('[data-key="$title"]')!.getAttribute("style")).toMatch(/span 2/);
        // Folded: the band keeps its cells and count; its lines hide.
        expect(band("p2")!.hasAttribute("data-folded")).toBe(true);
        expect(band("p2")!.querySelector('[data-slot="groupCount"]')!.textContent).toBe("1");
        expect(lines("p2")).toHaveLength(0);
        // Lines are not nested: every line keeps the full grid; the extent rule runs down the band and its lines.
        expect(lines("p1")[0]!.querySelectorAll('[data-slot="cell"]')).toHaveLength(4);
        expect(container.querySelectorAll('[data-slot="edge"]')).toHaveLength(5);
        expect(container.querySelector('[data-slot="footerSummary"]')!.textContent).toBe("2 plans · 3 lines");
    });

    test("with an edit channel the ghost band closes the sheet; a read-only sheet has no blank lines and no ghost band", () => {
        const writable = mount(withSpy(buildGrouped()).value);
        expect(writable.ghost()!.textContent).toBe("+ plan");
        writable.unmount();
        const readOnly = mount(withSpy(buildGrouped({ readOnly: true })).value);
        expect(readOnly.ghost()).toBeNull();
        expect(readOnly.numbers("p1")).toEqual(["1", "2"]);
    });
});

describe("folds (G4)", () => {
    test("the chevron folds and opens a plan; Space with the ring on its band too", () => {
        const { container, band, lines } = mount(buildGrouped());
        fireEvent.mouseDown(band("p1")!.querySelector('[data-slot="fold"]')!, { button: 0 });
        expect(band("p1")!.hasAttribute("data-folded")).toBe(true);
        expect(lines("p1")).toHaveLength(0);
        fireEvent.mouseDown(band("p2")!.querySelector('[data-key="$title"]')!, { button: 0 });
        fireEvent.keyDown(container.querySelector("[data-sheet-card]")!, { key: " " });
        expect(band("p2")!.hasAttribute("data-folded")).toBe(false);
        expect(lines("p2").map((r) => r.querySelector('[data-key="task"]')!.textContent)).toEqual(["Inspection", ""]);
    });
});

describe("edits (G5, G8)", () => {
    test("typing on a line commits its plan — the line's address and the whole plan after the edit", async () => {
        const { value, edits } = withSpy(buildGrouped());
        const { lines, key, type, editorKey, flush } = mount(value);
        fireEvent.mouseDown(lines("p1")[1]!.querySelector('[data-key="task"]')!, { button: 0 });
        key("P");
        type("Packaging");
        editorKey("Enter");
        await flush();
        expect(edits).toHaveLength(1);
        expect(edits[0]!.type).toBe("lineCommit");
        const c = edits[0]!.value as { rowId: string; line: string; key: string; offset: bigint };
        expect([c.rowId, c.line, c.key, c.offset]).toEqual(["p1", "1", "task", 0n]);
        expect(rowOf(edits[0]!).lines.map((l) => l.cells.get("task"))).toEqual([variant("String", "Machining"), variant("String", "Packaging")]);
        expect(lines("p1")[1]!.querySelector('[data-key="task"]')!.textContent).toBe("Packaging");
        // ⏎ moved the ring down onto the plan's blank line.
        expect(lines("p1")[2]!.querySelector('[data-key="task"]')!.hasAttribute("data-selected")).toBe(true);
    });

    test("the blank line inserts a line at the end of its plan; a new blank line follows and the ring lands on it", async () => {
        const { value, edits } = withSpy(buildGrouped());
        const { lines, numbers, key, type, editorKey, flush } = mount(value);
        fireEvent.mouseDown(lines("p1")[2]!.querySelector('[data-key="task"]')!, { button: 0 });
        key("D");
        type("Deburring");
        editorKey("Enter");
        await flush();
        expect(edits.map((e) => e.type)).toEqual(["lineInsert"]);
        const i = edits[0]!.value as { rowId: string; after: unknown; line: string };
        expect([i.rowId, i.after, i.line]).toEqual(["p1", some("1"), "2"]);
        expect(rowOf(edits[0]!).lines).toHaveLength(3);
        // The new line's wire key is minted — never a source index.
        expect(rowOf(edits[0]!).lines[2]!.key).toMatch(/^\+/);
        expect(numbers("p1")).toEqual(["1", "2", "3", "4"]);
        expect(lines("p1")[2]!.querySelector('[data-key="task"]')!.textContent).toBe("Deburring");
        expect(lines("p1")[3]!.querySelector('[data-key="task"]')!.hasAttribute("data-selected")).toBe(true);
        expect(lines("p1")[3]!.getAttribute("data-line")).toBe("");
    });

    test("a band cell commits the plan's field; ⏎ on the title renames the plan; a read-only band cell never opens", async () => {
        const { value, edits } = withSpy(buildGrouped());
        const { band, input, key, type, editorKey, flush } = mount(value);
        fireEvent.mouseDown(band("p1")!.querySelector('[data-key="status"]')!, { button: 0 });
        key("c");
        type("comp");
        editorKey("Enter");
        await flush();
        expect(edits.map((e) => e.type)).toEqual(["commit"]);
        expect((edits[0]!.value as { rowId: string; key: string }).key).toBe("status");
        expect(rowOf(edits[0]!).cells.get("status")).toEqual(variant("String", "COMPLETE"));
        expect(band("p1")!.querySelector('[data-key="status"] [data-tone="success"]')).toBeTruthy();
        // The title.
        fireEvent.mouseDown(band("p1")!.querySelector('[data-key="$title"]')!, { button: 0 });
        key("Enter");
        expect(input()!.value).toBe("Line 2 week 8");
        type("Line 2 week 8b");
        editorKey("Enter");
        await flush();
        expect((edits[1]!.value as { key: string }).key).toBe("$title");
        expect(band("p1")!.querySelector('[data-slot="groupTitle"]')!.textContent).toBe("Line 2 week 8b");
        // The derived quantity cell is read-only.
        fireEvent.mouseDown(band("p1")!.querySelector('[data-key="qty"]')!, { button: 0 });
        key("5");
        expect(input()).toBeNull();
    });

    test("the ghost band: a click opens its title, ⏎ creates the plan after the last one, the ring lands on its blank line", async () => {
        const { value, edits } = withSpy(buildGrouped());
        const { container, ghost, input, type, editorKey, flush, rows } = mount(value);
        fireEvent.mouseDown(ghost()!.querySelector('[data-slot="cell"]')!, { button: 0 });
        expect(input()).not.toBeNull();
        type("Line 4 week 9");
        editorKey("Enter");
        await flush();
        expect(edits.map((e) => e.type)).toEqual(["insert"]);
        expect((edits[0]!.value as { afterRowId: unknown }).afterRowId).toEqual(some("p2"));
        const created = rowOf(edits[0]!);
        expect(created.cells.get("$title")).toEqual(variant("String", "Line 4 week 9"));
        expect(created.lines).toEqual([]);
        const bands = [...container.querySelectorAll('[data-slot="row"][data-band-row]')].map((b) => b.querySelector('[data-slot="groupTitle"]')!.textContent);
        expect(bands).toEqual(["Line 2 week 8", "Line 3 week 8", "Line 4 week 9"]);
        // The new plan's blank line holds the ring; the ghost band still closes the sheet.
        const blank = rows().find((r) => r.getAttribute("data-group-id") === created.id)!;
        expect(blank.querySelector('[data-slot="cell"][data-selected]')).toBeTruthy();
        expect(rows().at(-1)!.hasAttribute("data-ghost-band")).toBe(true);
    });
});

describe("selection and delete (G7)", () => {
    test("the band's gutter selects the plan's lines; ⌫ removes them; ⌫ again removes the empty plan", async () => {
        const { value, edits } = withSpy(buildGrouped());
        const { container, band, lines, key, flush, msg } = mount(value);
        fireEvent.mouseDown(band("p1")!.querySelector('[data-slot="gutter"]')!, { button: 0 });
        expect(container.querySelectorAll('[data-slot="rangeWash"]')).toHaveLength(8);
        key("Backspace");
        await flush();
        expect(edits.map((e) => e.type)).toEqual(["lineRemove"]);
        expect((edits[0]!.value as { lines: string[] }).lines).toEqual(["0", "1"]);
        expect(rowOf(edits[0]!).lines).toEqual([]);
        expect(band("p1")!.querySelector('[data-slot="groupCount"]')!.textContent).toBe("0");
        expect(lines("p1").map((r) => r.getAttribute("data-line"))).toEqual([""]);
        expect(msg()).toBe("Deleted 2 lines — ⌫ again removes the plan");
        // The ring now holds the empty plan's band.
        expect(band("p1")!.querySelector('[data-slot="gutter"] > div')).toBeTruthy();
        key("Backspace");
        await flush();
        expect(edits.map((e) => e.type)).toEqual(["lineRemove", "remove"]);
        expect((edits[1]!.value as { rowIds: string[] }).rowIds).toEqual(["p1"]);
        expect(band("p1")).toBeNull();
    });
});

describe("the clipboard (G9)", () => {
    test("paste lands on the plan's lines from the ring and inserts past its blank line, never across a band; copy skips bands", async () => {
        const { value, edits } = withSpy(buildGrouped());
        const { card, band, lines, numbers, flush, msg } = mount(value);
        fireEvent.mouseDown(lines("p1")[1]!.querySelector('[data-key="task"]')!, { button: 0 });
        fireEvent.paste(card, { clipboardData: { getData: () => "Grinding\nPolishing\nPacking" } });
        await flush();
        expect(edits.map((e) => e.type)).toEqual(["lineCommit", "lineInsert", "lineInsert"]);
        expect(lines("p1").map((r) => r.querySelector('[data-key="task"]')!.textContent)).toEqual(["Machining", "Grinding", "Polishing", "Packing", ""]);
        expect(numbers("p1")).toEqual(["1", "2", "3", "4", "5"]);
        // p2 is untouched.
        expect(edits.every((e) => (e.value as { rowId: string }).rowId === "p1")).toBe(true);
        // Copy from the band through the first line: the band is left out.
        fireEvent.mouseDown(band("p1")!.querySelector('[data-key="$title"]')!, { button: 0 });
        fireEvent.mouseDown(lines("p1")[0]!.querySelector('[data-key="qty"]')!, { button: 0, shiftKey: true });
        const set = new Map<string, string>();
        fireEvent.copy(card, { clipboardData: { setData: (k: string, v: string) => set.set(k, v), getData: () => "" } });
        expect(set.get("text/plain")).toBe("16/2/2026\tMachining\t120");
        expect(msg()).toBe("Copied 1×3 to clipboard");
    });
});

describe("the lens (G10)", () => {
    test("hits are lines: a plan with hits counts `n of m` and keeps its context inside it; a plan with none folds to its band", async () => {
        const { container, band, lines } = mount(buildGrouped({ lens: true }));
        await waitFor(() => expect(container.querySelector("[data-sheet]")!.hasAttribute("data-lens")).toBe(true));
        expect(band("p1")!.querySelector('[data-slot="groupCount"]')!.textContent).toBe("1 of 2");
        expect(lines("p1").map((r) => r.querySelector('[data-key="task"]')!.textContent)).toEqual(["Painting"]);
        expect(lines("p1")[0]!.querySelector('[data-slot="gutterNumber"]')!.textContent).toBe("2");
        expect(lines("p1")[0]!.querySelector('[data-slot="gutterNumber"]')!.hasAttribute("data-hit")).toBe(true);
        expect(container.querySelectorAll('[data-slot="band"][data-band="lens"]')).toHaveLength(1);
        expect(band("p2")!.hasAttribute("data-folded")).toBe(true);
        expect(band("p2")!.querySelector('[data-slot="groupCount"]')!.textContent).toBe("0 of 1");
        expect(container.querySelector('[data-slot="toolbarCount"]')!.textContent).toBe("1 match");
        // No blank lines and no ghost band under a lens.
        expect(container.querySelector('[data-slot="row"][data-blank]')).toBeNull();
    });
});

/** A paged source of `n` plans, one line each, keyed by an id that sorts as it streams. */
function buildPagedPlans(n: number): SheetRootValue {
    const program = East.function([], UIComponentType, ($) => {
        const plans = $.let(East.Array.range(0n, BigInt(n)).map(($2, i) => $2.const({
            id: East.str`P${i.add(1000n)}`, name: East.str`Plan ${i}`, owner: "", status: "", total: 0.0,
            lines: [{ start: none, task: East.str`Task ${i}`, qty: none, status: "" }],
        }, PlanType)), ArrayType(PlanType));
        const source = $.const(Paged.of(`sheet_grouped_paged_${n}`, plans, { key: (p) => p.id }));
        return Sheet.Root(source, {
            task: Sheet.column.text(LineType, { header: "Task" }),
        }, { id: "id", group: Sheet.group(PlanType, "lines", { title: "name" }) });
    });
    const value = East.compile(program, getRegisteredPlatformImplementations())() as
        ValueTypeOf<typeof UIComponentType> & { value: SheetRootValue };
    return value.value;
}

describe("the paged arm (G13)", () => {
    test("windows of plans land with their lines; the transport counts plans; the ghost band waits for exhaustion", async () => {
        const { container, band, lines, ghost } = mount(withSpy(buildPagedPlans(250)).value);
        await waitFor(() => expect(container.querySelectorAll('[data-slot="row"][data-band-row]').length).toBe(250), { timeout: 15_000 });
        expect(band("P1000")!.querySelector('[data-slot="groupTitle"]')!.textContent).toBe("Plan 0");
        expect(lines("P1249").map((r) => r.querySelector('[data-key="task"]')!.textContent)).toEqual(["Task 249", ""]);
        expect(container.querySelector('[data-slot="footerTransport"]')!.textContent).toBe("250 loaded of 250");
        expect(ghost()).not.toBeNull();
    }, 30_000);
});
