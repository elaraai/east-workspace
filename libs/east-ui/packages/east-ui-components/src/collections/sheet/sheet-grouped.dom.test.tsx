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
 * source key search; the paged arm's geometry in a bounded frame, where an
 * unloaded band is as tall as its rows (#855). The group's noun is the host's
 * (`plan`). Every value built by the east-ui factory and COMPILED.
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
import { emulateWindowScroll, measureRowsAsDrawn } from "./frame.test-utils.js";
import type { SheetPagedSourceValue, SheetRootValue } from "./values.js";

// A sheet that mounts a screenful — bounded, or of 400 rows or more (#856) —
// measures its rows: they are as tall as they draw.
let restoreRows: () => void = () => {};
// Folds and a bounded frame's scroll persist under the sheet's `storageKey`
// (#857): every test starts from nothing persisted.
beforeEach(() => { localStorage.clear(); initializeStore(new UIStore()); restoreRows = measureRowsAsDrawn(); });
afterEach(() => { cleanup(); restoreRows(); });

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
const PLANS: ValueTypeOf<typeof PlanType>[] = [
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
const PAINT_NARROWING = {
    range: none, compare: none, filters: [], cohorts: [], activeCohorts: new Set<string>(),
    breakdown: none, search: some("paint"), visible: none, selectedIndex: none, resolution: none,
};
const LINES = PLANS.flatMap((p) => p.lines);
const VIEWS = [{ id: "paint", name: "PAINT", narrowing: PAINT_NARROWING, context: 0n, reveals: [], folds: new Map<string, boolean>() }];
/** PAINT and a view of every plan — for a host that moves `activeView` between them. */
const TWO_VIEWS = [...VIEWS, { id: "all", name: "ALL", narrowing: { ...PAINT_NARROWING, search: none }, context: 0n, reveals: [], folds: new Map<string, boolean>() }];

/** `activeView` — the sheet opens on this view, with {@link TWO_VIEWS} (else PAINT, alone). */
type Options = { lens?: boolean; readOnly?: boolean; activeView?: "paint" | "all" };

/** A grouped sheet the way an author builds one: plans over their lines, a band with a title, an eyebrow and two band cells, completed plans folded. */
function buildGrouped(opts: Options = {}): SheetRootValue {
    const viewList = opts.activeView !== undefined ? TWO_VIEWS : VIEWS;
    const opening = opts.activeView ?? "paint";
    const program = East.function([], UIComponentType, ($) => {
        const plans = $.const(PLANS, ArrayType(PlanType));
        const statuses = $.const(STATUSES, ArrayType(StatusType));
        const lines = $.const(LINES, ArrayType(LineType));
        const views = $.const(viewList, ArrayType(Sheet.Types.View));
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
            ...(opts.lens ? { slice, affordances: ["search" as const], views, activeView: some(opening) } : {}),
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

function mount(value: SheetRootValue, storageKey = "sheet-grouped-test") {
    const utils = render(
        <ChakraProvider value={system}>
            <EastChakraSheet value={value} storageKey={storageKey} />
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
    /** Hover the seam above a row: its chips show in the sheet's one insertion layer. */
    const chip = (row: HTMLElement, slot: "insertRow" | "insertGroup") => {
        fireEvent.mouseEnter(row.querySelector('[data-slot="insertPoint"]')!);
        return utils.container.querySelector(`[data-slot="insertLayer"] [data-slot="${slot}"]`) as HTMLElement | null;
    };
    return { ...utils, card, rows, band, lines, numbers, ghost, input, key, editorKey, type, flush, msg, chip };
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
        expect(writable.container.querySelectorAll("[data-slot=insertPoint]").length).toBeGreaterThan(0);
        // The chips draw only for the hovered seam, once, in the insertion layer.
        expect(writable.container.querySelector("[data-slot=insertLayer]")).toBeNull();
        expect(writable.chip(writable.band("p2")!, "insertGroup")).toBeTruthy();
        expect(writable.container.querySelectorAll("[data-slot=insertLayer]")).toHaveLength(1);
        fireEvent.mouseLeave(writable.band("p2")!.querySelector("[data-slot=insertPoint]")!);
        expect(writable.container.querySelector("[data-slot=insertLayer]")).toBeNull();
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
        const { container, band, ghost, input, type, editorKey, flush, chip } = mount(value);
        fireEvent.click(chip(band("p2")!, "insertGroup")!);
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
    const count = BigInt(n);
    const sourceId = `sheet_grouped_paged_${n}`;
    const program = East.function([], UIComponentType, ($) => {
        const total = $.const(count);
        const plans = $.let(East.Array.range(0n, total).map(($2, i) => $2.const({
            id: East.str`P${i.add(1000n)}`, name: East.str`Plan ${i}`, owner: "", status: "", total: 0.0,
            lines: [{ start: none, task: East.str`Task ${i}`, qty: none, status: "" }],
        }, PlanType)), ArrayType(PlanType));
        const source = $.const(Paged.of(sourceId, plans, { key: (p) => p.id }));
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
        const restore = emulateWindowScroll();
        try {
            const { container, band, lines, ghost, chip } = mount(withSpy(buildPagedPlans(250)).value);
            await waitFor(() => expect(container.querySelector('[data-slot="footerTransport"]')!.textContent).toBe("250 loaded of 250"), { timeout: 15_000 });
            expect(band("P1000")!.querySelector('[data-slot="groupTitle"]')!.textContent).toBe("Plan 0");
            expect(ghost()).toBeNull();
            expect(chip(band("P1000")!, "insertGroup")!.getAttribute("aria-label")).toBe("New group");
            // Every plan landed with its line and its blank line: 750 rows, of which the sheet mounts what
            // the page shows (#856). Down at the end, the last plan's line and blank line.
            const extent = Number(container.querySelector("[data-virtual-extent]")!.getAttribute("data-virtual-extent"));
            expect(extent).toBe(250 * (42 + 36 + 36));
            act(() => { window.scrollTo({ top: extent - window.innerHeight }); });
            expect(lines("P1249").map((r) => r.querySelector('[data-key="task"]')!.textContent)).toEqual(["Task 249", ""]);
        } finally {
            restore();
        }
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
    fireEvent.click(ui.chip(ui.lines("p1")[1]!, "insertRow")!); await ui.flush();
    expect(edits).toHaveLength(1);
    const p1 = draft("p1", Sheet.Types.DraftGroup(PlanType, "lines"));
    expect(p1.lines.map(row => row.task)).toEqual([variant("value", "Machining"), variant("missing", null), variant("value", "Painting")]);
    expect(p1.lines[0]!.status).toEqual(variant("value", "RELEASED"));
    expect(ui.lines("p1")[1]!.querySelector('[data-slot="editor"]')).toBeTruthy();
    // Commit/cancel the first editor before inserting into the folded group.
    fireEvent.click(ui.chip(ui.band("p2")!, "insertRow")!); await ui.flush();
    expect(ui.band("p2")!.hasAttribute("data-folded")).toBe(false);
    expect(ui.lines("p2")[0]!.querySelector('[data-slot="editor"]')).toBeTruthy();
    expect(draft("p2", Sheet.Types.DraftGroup(PlanType, "lines")).lines).toHaveLength(2);
});

const OpType = StructType({ code: StringType, name: StringType });
const CutLineType = StructType({ task: StringType, ops: ArrayType(OpType) });
const CutPlanType = StructType({ id: StringType, name: StringType, lines: ArrayType(CutLineType) });
const OPS = [{ code: "CUT", name: "Cut to length" }, { code: "DRL", name: "Drill" }];

/**
 * A read-only paged sheet of `n` plans in a 600 px frame (#855): every plan
 * two lines — `Cut i`, with two operations as its sub rows, and `Fit i` —
 * keyed by an id that sorts as it streams. Read-only, a group draws no blank
 * line: a plan is its band and its two lines, 42 + 2 × 36 = 114 px.
 */
function buildFramedPlans(n: number): SheetRootValue {
    const count = BigInt(n);
    const sourceId = `sheet_grouped_framed_${n}`;
    const program = East.function([], UIComponentType, ($) => {
        const ops = $.const(OPS, ArrayType(OpType));
        const noOps = $.const([], ArrayType(OpType));
        const total = $.const(count);
        const plans = $.let(East.Array.range(0n, total).map(($2, i) => $2.const({
            id: East.str`P${i.add(10000n)}`, name: East.str`Plan ${i}`,
            lines: [{ task: East.str`Cut ${i}`, ops }, { task: East.str`Fit ${i}`, ops: noOps }],
        }, CutPlanType)), ArrayType(CutPlanType));
        const source = $.const(Paged.of(sourceId, plans, { key: (p) => p.id }));
        return Sheet.Root(source, {
            task: Sheet.column.text(CutLineType, { header: "Task" }),
        }, {
            id: "id",
            group: Sheet.group(CutPlanType, "lines", { title: "name" }),
            subRows: Sheet.subRows(CutLineType, { ops: (op) => Sheet.subRow({ code: op.code, name: op.name }) }),
            readOnly: true,
            style: { height: "600px" },
        });
    });
    const value = East.compile(program, getRegisteredPlatformImplementations())() as
        ValueTypeOf<typeof UIComponentType> & { value: SheetRootValue };
    return value.value;
}

/**
 * {@link buildFramedPlans} with windows that draw otherwise than the first
 * (#878): plans 0–199 have one line (78 px), every later plan two (114 px), so
 * an unvisited window is described at 78 px a plan and lands 7,200 px taller.
 */
function buildVariedPlans(n: number): SheetRootValue {
    const count = BigInt(n);
    const sourceId = `sheet_grouped_varied_${n}`;
    const program = East.function([], UIComponentType, ($) => {
        const one = $.const([{ task: "Fit", ops: [] }], ArrayType(CutLineType));
        const two = $.const([{ task: "Cut", ops: [] }, { task: "Fit", ops: [] }], ArrayType(CutLineType));
        const total = $.const(count);
        const plans = $.let(East.Array.range(0n, total).map(($2, i) => $2.const({
            id: East.str`P${i.add(10000n)}`, name: East.str`Plan ${i}`,
            lines: i.less(200n).ifElse(($3) => one, ($3) => two),
        }, CutPlanType)), ArrayType(CutPlanType));
        const source = $.const(Paged.of(sourceId, plans, { key: (p) => p.id }));
        return Sheet.Root(source, {
            task: Sheet.column.text(CutLineType, { header: "Task" }),
        }, {
            id: "id",
            group: Sheet.group(CutPlanType, "lines", { title: "name" }),
            readOnly: true,
            style: { height: "600px" },
        });
    });
    const value = East.compile(program, getRegisteredPlatformImplementations())() as
        ValueTypeOf<typeof UIComponentType> & { value: SheetRootValue };
    return value.value;
}

/** Two inline plans whose first lines carry operations as sub rows (#856). */
const OPS_PLANS: ValueTypeOf<typeof CutPlanType>[] = [
    { id: "P1", name: "Plan 1", lines: [{ task: "Cut 1", ops: OPS }, { task: "Fit 1", ops: [] }] },
    { id: "P2", name: "Plan 2", lines: [{ task: "Cut 2", ops: OPS }] },
];
/** A read-only sheet of {@link OPS_PLANS} — unbounded, or in a frame `height` tall. */
function buildOpsPlans(height?: string): SheetRootValue {
    const bound = height !== undefined ? { style: { height } } : {};
    const program = East.function([], UIComponentType, ($) => {
        const plans = $.const(OPS_PLANS, ArrayType(CutPlanType));
        return Sheet.Root(plans, {
            task: Sheet.column.text(CutLineType, { header: "Task" }),
        }, {
            id: "id",
            group: Sheet.group(CutPlanType, "lines", { title: "name" }),
            subRows: Sheet.subRows(CutLineType, { ops: (op) => Sheet.subRow({ code: op.code, name: op.name }) }),
            readOnly: true,
            ...bound,
        });
    });
    const value = East.compile(program, getRegisteredPlatformImplementations())() as
        ValueTypeOf<typeof UIComponentType> & { value: SheetRootValue };
    return value.value;
}

describe("a sub row's well keeps to the view (#856)", () => {
    test("in an unbounded sheet, and after the sheet becomes bounded, the well's content is as wide as the view past the gutter", async () => {
        // The view's width, and a ResizeObserver the test fires: jsdom lays nothing out.
        const realOffsetHeight = Object.getOwnPropertyDescriptor(HTMLElement.prototype, "offsetHeight")!;
        let width = 900;
        const watchers: { el: Element; fire: () => void }[] = [];
        const realRO = (globalThis as { ResizeObserver?: unknown }).ResizeObserver;
        (globalThis as { ResizeObserver?: unknown }).ResizeObserver = class {
            private readonly cb: ResizeObserverCallback;
            constructor(cb: ResizeObserverCallback) { this.cb = cb; }
            observe(el: Element) { watchers.push({ el, fire: () => this.cb([], this as unknown as ResizeObserver) }); }
            unobserve() {}
            disconnect() {}
        };
        // The frame — the card's one child, bounded or not — is as wide as the view; bounded, it is 400 px tall.
        Object.defineProperty(HTMLElement.prototype, "clientWidth", {
            configurable: true,
            get(this: HTMLElement) { return this.parentElement?.hasAttribute("data-sheet-card") === true ? width : 0; },
        });
        Object.defineProperty(HTMLElement.prototype, "offsetHeight", {
            configurable: true,
            get(this: HTMLElement) { return this.getAttribute("data-virtual-rows") === "bounded" ? 400 : 0; },
        });
        try {
            const ui = mount(buildOpsPlans());
            const cut1 = ui.container.querySelector('[data-slot="row"][data-group-id="P1"][data-line="0"]')!;
            fireEvent.mouseDown(cut1.querySelector('[data-slot="subRowChevron"]')!, { button: 0 });
            await waitFor(() => expect(ui.container.querySelectorAll('[data-slot="subRow"]')).toHaveLength(2));
            const well = () => ui.container.querySelector<HTMLElement>('[data-slot="subRowContent"]')!;
            const gutter = parseFloat(well().style.left);
            expect(well().style.maxWidth).toBe(`${900 - gutter}px`);
            // Bounded, the frame scrolls its own rows; its scrollbar takes some of the view.
            ui.rerender(<ChakraProvider value={system}><EastChakraSheet value={buildOpsPlans("400px")} storageKey="sheet-grouped-test" /></ChakraProvider>);
            expect(ui.container.querySelector('[data-virtual-rows="bounded"]')).toBeTruthy();
            width = 880;
            act(() => { for (const w of watchers) if (w.el.parentElement?.hasAttribute("data-sheet-card") === true) w.fire(); });
            expect(well().style.maxWidth).toBe(`${880 - gutter}px`);
        } finally {
            (globalThis as { ResizeObserver?: unknown }).ResizeObserver = realRO;
            delete (HTMLElement.prototype as { clientWidth?: number }).clientWidth;
            Object.defineProperty(HTMLElement.prototype, "offsetHeight", realOffsetHeight);
        }
    });
});

/**
 * An inline sheet of `n` plans in a 600 px frame (#857): every plan two lines —
 * `Cut i`, with two operations as its sub rows, and `Fit i` — read-only, so a
 * plan draws its band and its two lines, 42 + 2 × 36 = 114 px.
 */
function buildFramedInline(n: number): SheetRootValue {
    const count = BigInt(n);
    const program = East.function([], UIComponentType, ($) => {
        const ops = $.const(OPS, ArrayType(OpType));
        const noOps = $.const([], ArrayType(OpType));
        const total = $.const(count);
        const plans = $.let(East.Array.range(0n, total).map(($2, i) => $2.const({
            id: East.str`P${i.add(10000n)}`, name: East.str`Plan ${i}`,
            lines: [{ task: East.str`Cut ${i}`, ops }, { task: East.str`Fit ${i}`, ops: noOps }],
        }, CutPlanType)), ArrayType(CutPlanType));
        return Sheet.Root(plans, {
            task: Sheet.column.text(CutLineType, { header: "Task" }),
        }, {
            id: "id",
            group: Sheet.group(CutPlanType, "lines", { title: "name" }),
            subRows: Sheet.subRows(CutLineType, { ops: (op) => Sheet.subRow({ code: op.code, name: op.name }) }),
            readOnly: true,
            style: { height: "600px" },
        });
    });
    const value = East.compile(program, getRegisteredPlatformImplementations())() as
        ValueTypeOf<typeof UIComponentType> & { value: SheetRootValue };
    return value.value;
}

describe("what the viewer arranged survives a remount (#857)", () => {
    /** A plan's drawn height: its band (42) and two lines (36 each). */
    const PLAN_PX = 42 + 2 * 36;
    // jsdom lays nothing out: the frame is 600 px tall and scrolls as far as it
    // is asked (its scroll height would clamp a restore to 0), and a scroll it
    // is asked for lands on scrollTop and sends its scroll event, as a
    // browser's does — a restore is a scroll the frame then reads.
    const realOffsetHeight = Object.getOwnPropertyDescriptor(HTMLElement.prototype, "offsetHeight")!;
    const proto = HTMLElement.prototype as unknown as { scrollTo?: (options: ScrollToOptions) => void };
    const realScrollTo = proto.scrollTo;
    beforeEach(() => {
        Object.defineProperty(HTMLElement.prototype, "offsetHeight", {
            configurable: true,
            get(this: HTMLElement) { return this.getAttribute("data-virtual-rows") === "bounded" ? 600 : 0; },
        });
        Object.defineProperty(HTMLElement.prototype, "scrollHeight", {
            configurable: true,
            get(this: HTMLElement) { return this.getAttribute("data-virtual-rows") === "bounded" ? 100_000_000 : 0; },
        });
        proto.scrollTo = function (this: HTMLElement, options: ScrollToOptions) {
            if (options.top === undefined || options.top === this.scrollTop) return;
            this.scrollTop = options.top;
            this.dispatchEvent(new Event("scroll"));
        };
    });
    afterEach(() => {
        Object.defineProperty(HTMLElement.prototype, "offsetHeight", realOffsetHeight);
        delete (HTMLElement.prototype as { scrollHeight?: number }).scrollHeight;
        if (realScrollTo === undefined) delete proto.scrollTo;
        else proto.scrollTo = realScrollTo;
    });

    /** The frame, its extent, where a plan's band starts, and a scroll the frame reads. */
    function framed(ui: ReturnType<typeof mount>) {
        const frame = () => ui.container.querySelector('[data-virtual-rows="bounded"]') as HTMLElement;
        const extent = () => Number(ui.container.querySelector("[data-virtual-extent]")!.getAttribute("data-virtual-extent"));
        const bandTop = (id: string) => {
            const wrapper = ui.band(id)!.closest<HTMLElement>('[data-slot="virtualRow"]')!;
            return Number(/translateY\((-?[\d.]+)px\)/.exec(wrapper.style.transform)![1]);
        };
        const scrollTo = (px: number) => act(() => { frame().scrollTop = px; fireEvent.scroll(frame()); });
        return { frame, extent, bandTop, scrollTo };
    }
    /** Let a scroll settle — the frame reports where it rests 150 ms after the last scroll event. */
    const settle = () => act(async () => { await new Promise((r) => setTimeout(r, 250)); });

    test("a folded plan, a line's open sub rows and the scroll come back with the same storageKey; another key starts fresh", async () => {
        const ui = mount(buildFramedInline(300));
        const f = framed(ui);
        // Plan 1 folds (its two lines go); plan 0's first line opens its two operations (2 × 30 px).
        fireEvent.mouseDown(ui.band("P10001")!.querySelector('[data-slot="fold"]')!, { button: 0 });
        const cut0 = ui.container.querySelector('[data-slot="row"][data-group-id="P10000"][data-line="0"]')!;
        fireEvent.mouseDown(cut0.querySelector('[data-slot="subRowChevron"]')!, { button: 0 });
        await waitFor(() => expect(ui.container.querySelectorAll('[data-slot="subRow"]')).toHaveLength(2));
        const arranged = 300 * PLAN_PX + 2 * 30 - 2 * 36;
        expect(f.extent()).toBe(arranged);
        // Down to plan 150's band, where the scroll comes to rest.
        const top = (PLAN_PX + 2 * 30) + 42 + 148 * PLAN_PX;
        f.scrollTo(top);
        expect(f.bandTop("P10150")).toBe(top);
        await settle();
        ui.unmount();
        // Back with the same key: the folds are as they were, and plan 150 is at the top of the view.
        const again = mount(buildFramedInline(300));
        const g = framed(again);
        expect(g.extent()).toBe(arranged);
        await waitFor(() => expect(g.frame().scrollTop).toBe(top));
        expect(g.bandTop("P10150")).toBe(top);
        g.scrollTo(0);
        expect(again.band("P10001")!.hasAttribute("data-folded")).toBe(true);
        expect(again.container.querySelectorAll('[data-slot="subRow"]')).toHaveLength(2);
        again.unmount();
        // Another key: nothing folded, nothing open, the top of the sheet.
        const fresh = mount(buildFramedInline(300), "sheet-grouped-other");
        const h = framed(fresh);
        expect(h.extent()).toBe(300 * PLAN_PX);
        expect(h.frame().scrollTop).toBe(0);
    }, 30_000);

    test("a persisted anchor whose item is gone lands at its index, clamped to the items", async () => {
        // Item 120 is plan 40's band: every plan is its band and two lines.
        localStorage.setItem("sheet-grouped-test", JSON.stringify({ view: null, folds: [], anchor: { key: "group:P19999", offset: 12, index: 120, element: null } }));
        const ui = mount(buildFramedInline(300));
        const f = framed(ui);
        await waitFor(() => expect(f.frame().scrollTop).toBe(40 * PLAN_PX));
        expect(f.bandTop("P10040")).toBe(40 * PLAN_PX);
        ui.unmount();
        // Past the last of the 900 items: the last — plan 299's second line.
        localStorage.setItem("sheet-grouped-end", JSON.stringify({ view: null, folds: [], anchor: { key: "group:P19999", offset: 12, index: 5_000, element: null } }));
        const end = mount(buildFramedInline(300), "sheet-grouped-end");
        await waitFor(() => expect(framed(end).frame().scrollTop).toBe(300 * PLAN_PX - 36));
    }, 30_000);

    test("paged: the anchor's window is fetched first, and the view lands on its item", async () => {
        localStorage.setItem("sheet-grouped-test", JSON.stringify({ view: null, folds: [], anchor: { key: "group:P11500", offset: 20, index: 3, element: 1500 } }));
        const ui = mount(buildFramedPlans(2_000));
        const f = framed(ui);
        // Window 7 (elements 1,400–1,599) is read, plan 1,500's band lands, and the view rests 20 px into it.
        await waitFor(() => expect(ui.band("P11500")).not.toBeNull(), { timeout: 10_000 });
        await waitFor(() => expect(f.frame().scrollTop).toBe(f.bandTop("P11500") + 20));
        expect(f.bandTop("P11500")).toBe(1_500 * PLAN_PX);
    }, 30_000);

    test("paged: an anchor past the end of a source that shrank lands on its last item, and hands the viewport back", async () => {
        // Plan 3,500 was in view; the source holds 2,000 plans now.
        localStorage.setItem("sheet-grouped-test", JSON.stringify({ view: null, folds: [], anchor: { key: "group:P13500", offset: 20, index: 3, element: 3_500 } }));
        const ui = mount(buildFramedPlans(2_000));
        const f = framed(ui);
        // The last plan's window is fetched, and the last plan is in view.
        await waitFor(() => {
            const top = f.bandTop("P11999") - f.frame().scrollTop;
            expect(top >= 0 && top < 600).toBe(true);
        }, { timeout: 10_000 });
        // The jump is over: where the viewer scrolls, the rows follow.
        f.scrollTo(0);
        await waitFor(() => expect(ui.band("P10000")).not.toBeNull(), { timeout: 10_000 });
    }, 30_000);

    test("paged: an anchor whose item is gone lands on the item now at its element — not at its index in another run", async () => {
        localStorage.setItem("sheet-grouped-test", JSON.stringify({ view: null, folds: [], anchor: { key: "group:P1GONE", offset: 20, index: 3, element: 1_500 } }));
        const ui = mount(buildFramedPlans(2_000));
        const f = framed(ui);
        await waitFor(() => expect(ui.band("P11500")).not.toBeNull(), { timeout: 10_000 });
        await waitFor(() => expect(f.frame().scrollTop).toBe(f.bandTop("P11500")));
        expect(f.bandTop("P11500")).toBe(1_500 * PLAN_PX);
    }, 30_000);

    test("paged: a view resting over an unloaded band persists the element the band draws there, and comes back to it", async () => {
        const ui = mount(buildFramedPlans(2_000));
        const f = framed(ui);
        const transport = () => ui.container.querySelector('[data-slot="footerTransport"]')!.textContent;
        await waitFor(() => expect(transport()).toBe("600 loaded of 2,000"));
        // Far down — windows 0–2 leave the run for the head band — then back up over it, to plan 250, 10 px in.
        f.scrollTo(1_500 * PLAN_PX);
        await waitFor(() => expect(transport()).toBe("800 loaded of 2,000"), { timeout: 10_000 });
        expect(ui.band("P10000")).toBeNull();
        f.scrollTo(250 * PLAN_PX + 10);
        // The scroll settles over the band, before any row lands under it.
        await waitFor(() => expect(localStorage.getItem("sheet-grouped-test")).toContain('"key":"band:head"'));
        ui.unmount();
        // The remount's run starts at the top — it draws no head band — and the element brings the view back.
        const again = mount(buildFramedPlans(2_000));
        const g = framed(again);
        await waitFor(() => expect(again.band("P10250")).not.toBeNull(), { timeout: 10_000 });
        await waitFor(() => expect(g.frame().scrollTop).toBe(g.bandTop("P10250")));
        expect(g.bandTop("P10250")).toBe(250 * PLAN_PX);
    }, 30_000);

    test("an unbounded sheet leaves a persisted anchor alone — its place is its page's: a paged one never fetches its window", async () => {
        // A bounded frame persisted plan 1,500; the sheet mounts unbounded now, its page at the top.
        localStorage.setItem("sheet-grouped-test", JSON.stringify({ view: null, folds: [], anchor: { key: "group:P2500", offset: 20, index: 3, element: 1_500 } }));
        const restore = emulateWindowScroll();
        try {
            // Every window the source is asked for, by its first element.
            const root = buildPagedPlans(2_000);
            if (root.rows.type !== "paged") throw new Error("a paged sheet");
            const source = root.rows.value;
            const asked = new Set<number>();
            const page: SheetPagedSourceValue["page"] = (offset, count) => { asked.add(Number(offset)); return source.page(offset, count); };
            const ui = mount({ ...root, rows: variant("paged", { ...source, page }) });
            await waitFor(() => expect(ui.container.querySelector('[data-slot="footerTransport"]')!.textContent).toBe("600 loaded of 2,000"), { timeout: 15_000 });
            // The page's top wants windows 0–2, and nothing else is read.
            expect([...asked].sort((a, b) => a - b)).toEqual([0, 200, 400]);
        } finally {
            restore();
        }
    }, 30_000);

    test("paged: a band is never an anchor's item — one persisted over the tail band lands on its element, not on the band a remount draws", async () => {
        localStorage.setItem("sheet-grouped-test", JSON.stringify({ view: null, folds: [], anchor: { key: "band:tail", offset: 20, index: 1, element: 1_500 } }));
        const ui = mount(buildFramedPlans(2_000));
        const f = framed(ui);
        await waitFor(() => expect(ui.band("P11500")).not.toBeNull(), { timeout: 10_000 });
        await waitFor(() => expect(f.frame().scrollTop).toBe(f.bandTop("P11500")));
    }, 30_000);

    test("folds left on a tab come back when the sheet opens on it again; a sheet no one folded records no tab", async () => {
        // The sheet opens on its PAINT view, as its host declares — and opening a view folds nothing.
        let ui = mount(buildGrouped({ lens: true }));
        const view = () => ui.container.querySelector("[data-sheet]")!.getAttribute("data-view");
        const stored = () => localStorage.getItem("sheet-grouped-test");
        await waitFor(() => expect(view()).toBe("paint"));
        // Storage holds what the persisted-state hook writes on its first read — nothing — and no tab.
        expect(stored()).toBe(JSON.stringify({ view: null, folds: [], anchor: null }));
        // p1 folds on PAINT, and the sheet goes before the tab is ever left — the view's own folds never hear of it.
        fireEvent.mouseDown(ui.band("p1")!.querySelector('[data-slot="fold"]')!, { button: 0 });
        expect(ui.band("p1")!.hasAttribute("data-folded")).toBe(true);
        expect(stored()).toBe(JSON.stringify({ view: "paint", folds: [["p1", true]], anchor: null }));
        ui.unmount();
        ui = mount(buildGrouped({ lens: true }));
        await waitFor(() => expect(view()).toBe("paint"));
        expect(ui.band("p1")!.hasAttribute("data-folded")).toBe(true);
    });

    test("a host that moves activeView later opens each view's own folds: the last session's are spent on the first open", async () => {
        localStorage.setItem("sheet-grouped-test", JSON.stringify({ view: "paint", folds: [["p1", true]], anchor: null }));
        const ui = mount(buildGrouped({ lens: true, activeView: "paint" }));
        const view = () => ui.container.querySelector("[data-sheet]")!.getAttribute("data-view");
        const open = (id: "paint" | "all") => ui.rerender(
            <ChakraProvider value={system}><EastChakraSheet value={buildGrouped({ lens: true, activeView: id })} storageKey="sheet-grouped-test" /></ChakraProvider>,
        );
        await waitFor(() => expect(view()).toBe("paint"));
        expect(ui.band("p1")!.hasAttribute("data-folded")).toBe(true);
        open("all");
        await waitFor(() => expect(view()).toBe("all"));
        expect(ui.band("p1")!.hasAttribute("data-folded")).toBe(false);
        open("paint");
        await waitFor(() => expect(view()).toBe("paint"));
        expect(ui.band("p1")!.hasAttribute("data-folded")).toBe(false);
    });
});

describe("the paged arm in a bounded frame: unloaded bands are as tall as their rows (#855)", () => {
    /** A plan's drawn height: its band (42) and two lines (36 each). */
    const PLAN_PX = 42 + 2 * 36;
    // jsdom lays nothing out: the frame is 600 px tall, and a row is its least
    // height — the height it declares inline — as if nothing wrapped (the
    // file's `measureRowsAsDrawn`).
    const realOffsetHeight = Object.getOwnPropertyDescriptor(HTMLElement.prototype, "offsetHeight")!;
    beforeEach(() => {
        Object.defineProperty(HTMLElement.prototype, "offsetHeight", {
            configurable: true,
            get(this: HTMLElement) { return this.getAttribute("data-virtual-rows") === "bounded" ? 600 : 0; },
        });
    });
    afterEach(() => {
        Object.defineProperty(HTMLElement.prototype, "offsetHeight", realOffsetHeight);
    });

    /** The frame's extent, where each plan's band starts, the frame's scroll, and the transport line. */
    function framed(ui: ReturnType<typeof mount>) {
        const frame = ui.container.querySelector('[data-virtual-rows="bounded"]') as HTMLElement;
        const extent = () => Number(ui.container.querySelector("[data-virtual-extent]")!.getAttribute("data-virtual-extent"));
        const bandTop = (id: string) => {
            const wrapper = ui.band(id)!.closest<HTMLElement>('[data-slot="virtualRow"]')!;
            return Number(/translateY\((-?[\d.]+)px\)/.exec(wrapper.style.transform)![1]);
        };
        const scrollTo = (px: number) => act(() => { frame.scrollTop = px; fireEvent.scroll(frame); });
        const transport = () => ui.container.querySelector('[data-slot="footerTransport"]')!.textContent;
        return { frame, extent, bandTop, scrollTo, transport };
    }

    test("the document is every plan's height from the first landing, and after a far scroll every plan sits where the geometry put it — windows landing above and leaving the run move nothing", async () => {
        const ui = mount(buildFramedPlans(2_000));
        const f = framed(ui);
        await waitFor(() => expect(f.transport()).toBe("600 loaded of 2,000"));
        // Three windows landed, seven described: the document is all 2,000 plans.
        expect(f.extent()).toBe(2_000 * PLAN_PX);
        // Far down, to plan 1,500: the run rebases to its window (7) and grows
        // back to window 6 above it — never visited — while windows 0–2 leave
        // it for the head band.
        f.scrollTo(1_500 * PLAN_PX);
        await waitFor(() => expect(f.transport()).toBe("800 loaded of 2,000"), { timeout: 10_000 });
        expect(ui.band("P10000")).toBeNull();
        expect(f.extent()).toBe(2_000 * PLAN_PX);
        // The plan the frame scrolled to is at the top of the view: nothing
        // above it — the head band, window 6's rows — took other than its height.
        expect(f.frame.scrollTop).toBe(1_500 * PLAN_PX);
        expect(f.bandTop("P11500")).toBe(1_500 * PLAN_PX);
    }, 30_000);

    test("a window landing above the rows in view leaves them where they are", async () => {
        const ui = mount(buildFramedPlans(2_000));
        const f = framed(ui);
        await waitFor(() => expect(f.transport()).toBe("600 loaded of 2,000"));
        f.scrollTo(1_500 * PLAN_PX);
        await waitFor(() => expect(f.transport()).toBe("800 loaded of 2,000"), { timeout: 10_000 });
        // Up to the top of window 6, the run's first: plan 1,210 at the top of
        // the view. Once the scroll settles, window 5 above it is asked for.
        f.scrollTo(1_210 * PLAN_PX);
        expect(f.bandTop("P11210") - f.frame.scrollTop).toBe(0);
        await waitFor(() => expect(f.transport()).toBe("1,000 loaded of 2,000"), { timeout: 10_000 });
        // It landed above the rows in view and took exactly its band's slot.
        expect(f.bandTop("P11210") - f.frame.scrollTop).toBe(0);
        expect(f.extent()).toBe(2_000 * PLAN_PX);
    }, 30_000);

    test("what a planner opens and folds counts: the window is re-measured, and leaving the run it leaves exactly what its rows drew", async () => {
        const ui = mount(buildFramedPlans(2_000));
        const f = framed(ui);
        await waitFor(() => expect(f.transport()).toBe("600 loaded of 2,000"));
        // Plan 0's first line opens its two operations (2 × 30 px), and plan 1
        // folds to its band (its two lines, 2 × 36 px, go).
        const cut0 = ui.container.querySelector('[data-slot="row"][data-group-id="P10000"][data-line="0"]')!;
        fireEvent.mouseDown(cut0.querySelector('[data-slot="subRowChevron"]')!, { button: 0 });
        await waitFor(() => expect(ui.container.querySelectorAll('[data-slot="subRow"]')).toHaveLength(2));
        fireEvent.mouseDown(ui.band("P10001")!.querySelector('[data-slot="fold"]')!, { button: 0 });
        await waitFor(() => expect(ui.band("P10001")!.hasAttribute("data-folded")).toBe(true));
        const change = 2 * 30 - 2 * 36;
        expect(f.extent()).toBe(2_000 * PLAN_PX + change);
        // Far down: their window leaves the run as the planner left it.
        f.scrollTo(1_500 * PLAN_PX + change);
        await waitFor(() => expect(f.transport()).toBe("800 loaded of 2,000"), { timeout: 10_000 });
        expect(ui.band("P10000")).toBeNull();
        expect(f.extent()).toBe(2_000 * PLAN_PX + change);
        expect(f.bandTop("P11500")).toBe(1_500 * PLAN_PX + change);
    }, 30_000);

    describe("a window drawing otherwise than its estimate (#878)", () => {
        // The frame anchors its scroll through `scrollTo`, which jsdom lacks:
        // its writes land on scrollTop, as a browser's do.
        const proto = HTMLElement.prototype as unknown as { scrollTo?: (options: ScrollToOptions) => void };
        const realScrollTo = proto.scrollTo;
        beforeEach(() => {
            proto.scrollTo = function (this: HTMLElement, options: ScrollToOptions) {
                if (options.top !== undefined) this.scrollTop = options.top;
            };
        });
        afterEach(() => {
            if (realScrollTo === undefined) delete proto.scrollTo;
            else proto.scrollTo = realScrollTo;
        });

        test("lands above the rows in view and leaves them where they are — the view follows its rows, not its estimate", async () => {
            const ui = mount(buildVariedPlans(2_000));
            const f = framed(ui);
            await waitFor(() => expect(f.transport()).toBe("600 loaded of 2,000"));
            // Unvisited windows are described at the first window's 78 px a plan.
            const rate = 42 + 36;
            const landed = 200 * rate + 2 * 200 * PLAN_PX;
            expect(f.extent()).toBe(landed + 7 * 200 * rate);
            // Where the estimate puts plan 1,500: the run rebases to window 7,
            // which lands there, and grows back to window 6 above it — 200 ×
            // (114 − 78) px taller than its estimate.
            const at = landed + 4 * 200 * rate + 100 * rate;
            f.scrollTo(at);
            await waitFor(() => expect(f.transport()).toBe("800 loaded of 2,000"), { timeout: 10_000 });
            // The rows window 7 put in view kept their places: the view moved
            // with them, by exactly what window 6 drew beyond its estimate.
            const grew = 200 * (PLAN_PX - rate);
            expect(f.frame.scrollTop).toBe(at + grew);
            const line = ui.container.querySelector('[data-slot="row"][data-group-id="P11468"][data-line="1"]')!;
            const wrapper = line.closest<HTMLElement>('[data-slot="virtualRow"]')!;
            const top = Number(/translateY\((-?[\d.]+)px\)/.exec(wrapper.style.transform)![1]);
            // P11468's second line started 30 px into the view when window 7 landed, and still does.
            expect(top - f.frame.scrollTop).toBe(30);
        }, 30_000);
    });
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
