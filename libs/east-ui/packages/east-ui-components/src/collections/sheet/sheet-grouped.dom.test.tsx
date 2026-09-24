/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 *
 * @vitest-environment jsdom
 *
 * Grouped rows (#740 — G1–G12): a band per plan over its lines, numbered
 * from 1 per plan, legacy blank children during the insertion migration;
 * folds; a line's commit, a blank line's insert, a band cell's commit and
 * the title rename; explicit group insertion; the two-step delete;
 * paste into a plan and a copy that skips summaries; the lens on lines and
 * source key search. The group's noun is the host's (`plan`). Every value
 * built by the east-ui factory and COMPILED.
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
import { sheetJournal } from "./journal.test-utils.js";
import type { SheetRootValue } from "./values.js";

afterEach(cleanup);
beforeEach(() => { initializeStore(new UIStore()); });

// jsdom lacks the browser APIs Chakra's Combobox positioner relies on.
class ResizeObserverStub { observe() {} unobserve() {} disconnect() {} }
(globalThis as unknown as { ResizeObserver?: unknown }).ResizeObserver ??= ResizeObserverStub;
// jsdom has no `CSS.escape`; the enum editor's combobox selects its items with it.
(globalThis as unknown as { CSS?: { escape?: (s: string) => string } }).CSS ??= {};
(globalThis as unknown as { CSS: { escape?: (s: string) => string } }).CSS.escape ??= (s: string) => s.replace(/[^a-zA-Z0-9_-]/g, (c) => `\\${c}`);

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
                noun: { singular: "plan", plural: "plans" },
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
    const journal = sheetJournal(root);
    return { value: journal.value, edits: journal.events, draft: journal.draft, drafts: journal.drafts };
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

describe("the body (G1–G3, G6, G12)", () => {
    test("a band per plan over its lines, numbered from 1 per plan, one blank line per open plan; a folded plan is its band; gutter membership; the footer counts plans and lines", () => {
        const { container, rows, band, lines, numbers, ghost } = mount(buildGrouped());
        // p1 band · 2 lines · its blank line · p2 band (folded). No edit channel ⇒ no ghost band.
        expect(rows()).toHaveLength(4);
        expect(ghost()).toBeNull();
        expect(numbers("p1")).toEqual(["1", "2"]);
        expect(lines("p1").map((r) => r.getAttribute("data-line"))).toEqual(["0", "1"]);
        expect(band("p1")!.querySelector('[data-slot="groupTitle"]')!.textContent).toBe("Line 2 week 8");
        expect(band("p1")!.querySelector('[data-slot="groupSub"]')!.textContent).toBe("planner · PLANNED");
        expect(band("p1")!.querySelector('[data-slot="groupCount"]')!.textContent).toBe("2");
        expect(band("p1")!.getAttribute("aria-expanded")).toBe("true");
        // Summary fields share one spanning cell, independently of the line grid.
        expect(band("p1")!.querySelector('[data-key="qty"]')!.textContent).toBe("300");
        expect(band("p1")!.querySelector('[data-key="status"] [data-tone="neutral"]')).toBeTruthy();
        expect(band("p1")!.querySelector('[data-key="status"]')!.textContent).toBe("PLANNED");
        expect(band("p1")!.querySelector('[data-slot="groupSummary"]')!.getAttribute("style")).toMatch(/span 4/);
        expect(band("p1")!.querySelectorAll('[role="gridcell"]')).toHaveLength(1);
        expect(band("p1")!.querySelector('[data-slot="groupSummary"] [data-slot="fold"]')).toBeTruthy();
        expect(band("p1")!.querySelector('[data-slot="gutter"] [data-slot="fold"]')).toBeNull();
        expect(band("p1")!.querySelector('[data-slot="gutterNumber"]')!.textContent).toBe("1");
        expect(band("p2")!.querySelector('[data-slot="gutterNumber"]')!.textContent).toBe("2");
        // Folded: the band keeps its cells and count; its lines hide.
        expect(band("p2")!.hasAttribute("data-folded")).toBe(true);
        expect(band("p2")!.querySelector('[data-slot="groupCount"]')!.textContent).toBe("1");
        expect(lines("p2")).toHaveLength(0);
        // Lines keep the full grid; only the gutter's connector joins adjacent members.
        expect(lines("p1")[0]!.querySelectorAll('[data-slot="cell"]')).toHaveLength(4);
        expect(container.querySelectorAll('[data-slot="edge"]')).toHaveLength(0);
        const connectors = [...container.querySelectorAll('[data-slot="connector"]')];
        expect(connectors.map(c => [c.hasAttribute("data-above"), c.hasAttribute("data-below")])).toEqual([
            [false, true], [true, true], [true, false], [false, false],
        ]);
        // The host's noun names the groups.
        expect(container.querySelector('[data-slot="footerSummary"]')!.textContent).toBe("2 plans · 3 lines");
        expect(container.querySelector('[data-slot="foldAll"]')!.getAttribute("aria-label")).toBe("Fold 2 plans");
    });

    test("writable gutters expose group insertion without a ghost band; read-only sheets hide insertion", () => {
        const writable = mount(withSpy(buildGrouped()).value);
        expect(writable.ghost()).toBeNull();
        expect(writable.container.querySelectorAll("[data-slot=insertGroup]").length).toBeGreaterThan(0);
        writable.unmount();
        const readOnly = mount(withSpy(buildGrouped({ readOnly: true })).value);
        expect(readOnly.ghost()).toBeNull();
        expect(readOnly.container.querySelector("[data-slot=insertPoint]")).toBeNull();
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
        expect(lines("p2").map((r) => r.querySelector('[data-key="task"]')!.textContent)).toEqual(["Inspection"]);
    });
});

describe("edits (G5, G8)", () => {
    test("typing on a line commits its plan — the line's address and the whole plan after the edit", async () => {
        const { value, edits, draft } = withSpy(buildGrouped());
        const { lines, key, type, editorKey, flush } = mount(value);
        fireEvent.mouseDown(lines("p1")[1]!.querySelector('[data-key="task"]')!, { button: 0 });
        key("P");
        type("Packaging");
        editorKey("Enter");
        await flush();
        expect(edits).toHaveLength(1);
        expect(edits[0]!.draftChanges.map(change => change.id)).toEqual(["p1"]);
        expect(draft("p1", Sheet.Types.DraftGroup(PlanType, "lines")).lines.map(line => line.task)).toEqual([variant("value", "Machining"), variant("value", "Packaging")]);
        expect(lines("p1")[1]!.querySelector('[data-key="task"]')!.textContent).toBe("Packaging");
        // ⏎ moved the ring down onto the plan's blank line.
        expect(lines("p1")[2]!.querySelector('[data-key="task"]')!.hasAttribute("data-selected")).toBe(true);
    });

    test("the blank line inserts a line at the end of its plan; a new blank line follows and the ring lands on it", async () => {
        const { value, edits, draft } = withSpy(buildGrouped());
        const { lines, numbers, key, type, editorKey, flush } = mount(value);
        fireEvent.mouseDown(lines("p1")[2]!.querySelector('[data-key="task"]')!, { button: 0 });
        key("D");
        type("Deburring");
        editorKey("Enter");
        await flush();
        expect(edits).toHaveLength(1);
        expect(edits[0]!.draftChanges.map(change => change.id)).toEqual(["p1"]);
        const created = draft("p1", Sheet.Types.DraftGroup(PlanType, "lines"));
        expect(created.lines).toHaveLength(3);
        expect(created.lines[2]!.task).toEqual(variant("value", "Deburring"));
        expect(lines("p1")[2]!.getAttribute("data-line")).toMatch(/^\+/);
        expect(numbers("p1")).toEqual(["1", "2", "3", "4"]);
        expect(lines("p1")[2]!.querySelector('[data-key="task"]')!.textContent).toBe("Deburring");
        expect(lines("p1")[3]!.querySelector('[data-key="task"]')!.hasAttribute("data-selected")).toBe(true);
        expect(lines("p1")[3]!.getAttribute("data-line")).toBe("");
    });

    test("a band cell commits the plan's field; ⏎ on the title renames the plan; a read-only band cell never opens", async () => {
        const { value, edits, draft } = withSpy(buildGrouped());
        const { band, input, key, type, editorKey, flush } = mount(value);
        fireEvent.mouseDown(band("p1")!.querySelector('[data-key="status"]')!, { button: 0 });
        key("c");
        type("comp");
        editorKey("Enter");
        await flush();
        expect(edits).toHaveLength(1);
        expect(draft("p1", Sheet.Types.DraftGroup(PlanType, "lines")).status).toEqual(variant("value", "COMPLETE"));
        expect(band("p1")!.querySelector('[data-key="status"] [data-tone="success"]')).toBeTruthy();
        // The title.
        fireEvent.mouseDown(band("p1")!.querySelector('[data-key="$title"]')!, { button: 0 });
        key("Enter");
        expect(input()!.value).toBe("Line 2 week 8");
        type("Line 2 week 8b");
        editorKey("Enter");
        await flush();
        expect(draft("p1", Sheet.Types.DraftGroup(PlanType, "lines")).name).toEqual(variant("value", "Line 2 week 8b"));
        expect(band("p1")!.querySelector('[data-slot="groupTitle"]')!.textContent).toBe("Line 2 week 8b");
        // The derived quantity cell is read-only.
        fireEvent.mouseDown(band("p1")!.querySelector('[data-key="qty"]')!, { button: 0 });
        key("5");
        expect(input()).toBeNull();
    });

    test("New group creates a draft before its anchor and opens the name editor; naming is a separate undoable gesture", async () => {
        const { value, edits, draft } = withSpy(buildGrouped());
        const { container, band, ghost, input, type, editorKey, flush } = mount(value);
        fireEvent.click(band("p2")!.querySelector('[data-slot="insertGroup"]')!);
        await flush();
        expect(input()).not.toBeNull();
        expect(edits).toHaveLength(1);
        const change = edits[0]!.draftChanges[0]!;
        expect(change.place).toEqual(some(variant("ordered", variant("before", "p2"))));
        expect(edits[0]!.origin.type).toBe("insert");
        expect(draft(change.id, Sheet.Types.DraftGroup(PlanType, "lines")).name.type).toBe("missing");
        type("Line 4 week 9");
        editorKey("Enter");
        await flush();
        expect(edits).toHaveLength(2);
        const created = draft(change.id, Sheet.Types.DraftGroup(PlanType, "lines"));
        expect(created.name).toEqual(variant("value", "Line 4 week 9"));
        expect(created.lines).toEqual([]);
        expect(created.owner.type).toBe("missing");
        expect(edits[1]!.domainChanges.type).toBe("none");
        const bands = [...container.querySelectorAll('[data-slot="row"][data-band-row]')].map(b => b.querySelector('[data-slot="groupTitle"]')!.textContent);
        expect(bands).toEqual(["Line 2 week 8", "Line 4 week 9", "Line 3 week 8"]);
        expect(ghost()).toBeNull();
    });
});

describe("selection and delete (G7)", () => {
    test("the band's gutter selects the plan's lines; ⌫ removes them; ⌫ again removes the empty plan", async () => {
        const { value, edits, draft } = withSpy(buildGrouped());
        const { container, band, lines, key, flush, msg } = mount(value);
        fireEvent.mouseDown(band("p1")!.querySelector('[data-slot="gutter"]')!, { button: 0 });
        expect(container.querySelectorAll('[data-slot="rangeWash"]')).toHaveLength(8);
        key("Backspace");
        await flush();
        expect(edits).toHaveLength(1);
        expect(edits[0]!.origin.type).toBe("remove");
        expect(draft("p1", Sheet.Types.DraftGroup(PlanType, "lines")).lines).toEqual([]);
        expect(band("p1")!.querySelector('[data-slot="groupCount"]')!.textContent).toBe("0");
        expect(lines("p1").map((r) => r.getAttribute("data-line"))).toEqual([""]);
        expect(msg()).toBe("Deleted 2 lines — ⌫ again removes the plan");
        // The ring now holds the empty plan's band.
        expect(band("p1")!.querySelector('[data-slot="gutter"] > div')).toBeTruthy();
        key("Backspace");
        await flush();
        expect(edits.map(e => e.origin.type)).toEqual(["remove", "remove"]);
        expect(edits[1]!.draftChanges.map(change => change.id)).toEqual(["p1"]);
        expect(band("p1")).toBeNull();
    });
});

describe("the clipboard (G9)", () => {
    test("paste lands on the plan's lines from the ring and inserts past its blank line, never across a band; copy skips bands", async () => {
        const { value, edits, draft } = withSpy(buildGrouped());
        const { card, band, lines, numbers, flush, msg } = mount(value);
        fireEvent.mouseDown(lines("p1")[1]!.querySelector('[data-key="task"]')!, { button: 0 });
        fireEvent.paste(card, { clipboardData: { getData: () => "Grinding\nPolishing\nPacking" } });
        await flush();
        expect(edits).toHaveLength(1);
        expect(edits[0]!.origin.type).toBe("pasted");
        expect(draft("p1", Sheet.Types.DraftGroup(PlanType, "lines")).lines).toHaveLength(4);
        expect(lines("p1").map((r) => r.querySelector('[data-key="task"]')!.textContent)).toEqual(["Machining", "Grinding", "Polishing", "Packing", ""]);
        expect(numbers("p1")).toEqual(["1", "2", "3", "4", "5"]);
        // p2 is untouched.
        expect(edits[0]!.draftChanges.map(change => change.id)).toEqual(["p1"]);
        // Copy from the band through the first line: the band is left out.
        fireEvent.mouseDown(band("p1")!.querySelector('[data-key="$title"]')!, { button: 0 });
        fireEvent.mouseDown(lines("p1")[0]!.querySelector('[data-key="qty"]')!, { button: 0, shiftKey: true });
        const set = new Map<string, string>();
        fireEvent.copy(card, { clipboardData: { setData: (k: string, v: string) => set.set(k, v), getData: () => "" } });
        expect(set.get("text/plain")).toBe("16/2/2026\tMachining\t120");
        expect(msg()).toBe("Copied 1×3 to clipboard");
    });
});

describe("the lens on a grouped sheet", () => {
    test("a view's search narrows the groups, then the lines inside a shown group — a hit keeps its number, the rest collapse into bands; folds are untouched", async () => {
        const value = buildGrouped({ lens: true });
        const { container, band, lines, flush } = mount(value);
        await flush();
        await waitFor(() => expect(container.querySelector("[data-sheet]")!.hasAttribute("data-lens")).toBe(true));
        expect(container.querySelector("[data-sheet]")!.getAttribute("data-view")).toBe("paint");
        expect(container.querySelector('[data-slot="tabs"]')).toBeTruthy();
        // p1 shows through its `Painting` line — line 2, a hit — and its Machining line collapses into a band.
        expect(lines("p1").map(row => row.querySelector('[data-key="task"]')!.textContent)).toEqual(["Painting"]);
        expect(lines("p1")[0]!.querySelector('[data-slot="gutterNumber"]')!.textContent).toBe("2");
        expect(lines("p1")[0]!.querySelector('[data-slot="gutterNumber"]')!.hasAttribute("data-hit")).toBe(true);
        // p2 matches nothing: it is hidden in a band of its own, and it stays folded.
        expect(band("p2")).toBeNull();
        expect(container.querySelectorAll('[data-band="lens"]')).toHaveLength(2);
        expect(container.querySelector('[data-slot="toolbarCount"]')!.textContent).toBe("1 match");
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
    test("windows land with children and insertion controls without a ghost band", async () => {
        const { container, band, lines, ghost } = mount(withSpy(buildPagedPlans(250)).value);
        await waitFor(() => expect(container.querySelectorAll('[data-slot="row"][data-band-row]').length).toBe(250), { timeout: 15_000 });
        expect(band("P1000")!.querySelector('[data-slot="groupTitle"]')!.textContent).toBe("Plan 0");
        expect(lines("P1249").map((r) => r.querySelector('[data-key="task"]')!.textContent)).toEqual(["Task 249", ""]);
        expect(container.querySelector('[data-slot="footerTransport"]')!.textContent).toBe("250 loaded of 250");
        expect(ghost()).toBeNull();
        expect(band("P1000")!.querySelector("[data-slot=insertGroup]")!.getAttribute("aria-label")).toBe("New group");
    }, 30_000);
});


test("clicking a selected row marker deselects it without editing the data", async () => {
    const { value, edits } = withSpy(buildGrouped());
    const { lines, flush } = mount(value);
    const row = () => lines("p1")[0]!;
    const marker = () => row().querySelector('[data-slot="checkbox"]')!;
    expect(marker().getAttribute("aria-pressed")).toBe("false");
    fireEvent.click(marker(), { button: 0 });
    expect(marker().getAttribute("aria-pressed")).toBe("true");
    expect(row().querySelectorAll('[data-slot="rangeWash"]')).toHaveLength(4);
    fireEvent.click(marker(), { button: 0 });
    expect(marker().getAttribute("aria-pressed")).toBe("false");
    expect(row().querySelectorAll('[data-slot="rangeWash"]')).toHaveLength(0);
    await flush();
    expect(edits).toHaveLength(0);
});


test("child insertion uses the current local slot, preserves siblings and unfolds a selected folded group", async () => {
    const { value, edits, draft } = withSpy(buildGrouped());
    const ui = mount(value);
    fireEvent.click(ui.lines("p1")[1]!.querySelector('[data-slot="insertRow"]')!); await ui.flush();
    expect(edits).toHaveLength(1);
    const p1 = draft("p1", Sheet.Types.DraftGroup(PlanType, "lines"));
    expect(p1.lines.map(row => row.task)).toEqual([variant("value", "Machining"), variant("missing", null), variant("value", "Painting")]);
    expect(p1.lines[0]!.status).toEqual(variant("value", "RELEASED"));
    expect(ui.lines("p1")[1]!.querySelector('[data-slot="editor"]')).toBeTruthy();
    // Commit/cancel the first editor before inserting into the folded group.
    fireEvent.click(ui.band("p2")!.querySelector('[data-slot="insertRow"]')!); await ui.flush();
    expect(ui.band("p2")!.hasAttribute("data-folded")).toBe(false);
    expect(ui.lines("p2")[0]!.querySelector('[data-slot="editor"]')).toBeTruthy();
    expect(draft("p2", Sheet.Types.DraftGroup(PlanType, "lines")).lines).toHaveLength(2);
});

test("grouped key search jumps and steps between summaries without filtering children or changing folds", async () => {
    const ui = mount(buildPagedPlans(10));
    await waitFor(() => expect(ui.band("P1002")).not.toBeNull());
    fireEvent.mouseDown(ui.band("P1002")!.querySelector('[data-slot="fold"]')!, { button: 0 });
    expect(ui.lines("P1002")).toHaveLength(0);
    const count = ui.rows().length;
    const search = ui.getByPlaceholderText("Search keys");
    ui.key("f", { ctrlKey: true });
    expect(document.activeElement).toBe(search);
    fireEvent.change(search, { target: { value: "P100" } });
    await waitFor(() => expect(ui.getByText("10 matches")).toBeTruthy());
    fireEvent.keyDown(search, { key: "Enter" });
    await waitFor(() => expect(ui.band("P1000")!.querySelector('[data-key="$title"][data-selected]')).not.toBeNull());
    fireEvent.click(ui.getByRole("button", { name: "Next match" }));
    await waitFor(() => expect(ui.band("P1001")!.querySelector('[data-key="$title"][data-selected]')).not.toBeNull());
    fireEvent.click(ui.getByRole("button", { name: "Next match" }));
    await waitFor(() => expect(ui.band("P1002")!.querySelector('[data-key="$title"][data-selected]')).not.toBeNull());
    expect(ui.band("P1002")!.hasAttribute("data-folded")).toBe(true);
    expect(ui.rows()).toHaveLength(count);
    expect(ui.lines("P1000")).toHaveLength(1);
    expect(ui.container.querySelector('[data-slot="tabs"]')).toBeNull();
    expect(ui.container.querySelector('[data-band="lens"]')).toBeNull();
    fireEvent.click(ui.getByRole("button", { name: "Previous match" }));
    await waitFor(() => expect(ui.band("P1001")!.querySelector('[data-key="$title"][data-selected]')).not.toBeNull());
    fireEvent.click(ui.getByRole("button", { name: "Clear search" }));
    expect((ui.getByPlaceholderText("Search keys") as HTMLInputElement).value).toBe("");
    expect(ui.band("P1002")!.hasAttribute("data-folded")).toBe(true);
    expect(ui.rows()).toHaveLength(count);
});
