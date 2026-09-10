/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 *
 * @vitest-environment jsdom
 *
 * The sheet renderer, one test per §5 behaviour it owns in P2 (Sheet Spec
 * §9): the body and its blanks, the ring and the range, editing and the
 * commit directions, the typed parse through the editor, an insert from a
 * blank row, clearing and deleting, the controlled selection, the clipboard,
 * and the paged arm's bands, transport line and exhaustion — every value
 * built by the east-ui factory and COMPILED, so the closures the renderer
 * calls are the ones East emits.
 */

import { describe, test, expect, afterEach, beforeEach } from "vitest";
import { render, cleanup, fireEvent, waitFor } from "@testing-library/react";
import { ChakraProvider } from "@chakra-ui/react";
import {
    ArrayType, DateTimeType, East, FloatType, IntegerType, OptionType, StringType, StructType,
    none, some, variant, type ValueTypeOf,
} from "@elaraai/east";
import { Paged, StatusValueType } from "@elaraai/east-ui";
import { Sheet, UIComponentType } from "@elaraai/east-ui/internal";
import { system } from "../../theme/index.js";
import { initializeStore } from "../../platform/state-runtime.js";
import { UIStore } from "../../platform/state-store.js";
import { getRegisteredPlatformImplementations } from "../../platform/registry.js";
import { EastChakraSheet } from "./index.js";
import type { SheetEditValue, SheetRootValue, SheetSelectionValue } from "./values.js";
import { todayUtc, addDays } from "./parse/date.js";

afterEach(cleanup);
beforeEach(() => { initializeStore(new UIStore()); });

const JobType = StructType({
    id: StringType,
    start: OptionType(DateTimeType),
    task: StringType,
    qty: OptionType(FloatType),
    code: StringType,
    status: StringType,
});
const StatusType = StructType({ word: StringType, tone: StatusValueType });

/** Fixtures at MODULE scope: East bodies never call host helpers. */
const FEB16 = new Date("2026-02-16T00:00:00Z");
const ROWS = [
    { id: "j1", start: some(FEB16), task: "Machining", qty: some(1200), code: "WO-26001", status: "RELEASED" },
    { id: "j2", start: none, task: "Painting", qty: none, code: "", status: "" },
];
const STATUSES = [
    { word: "PLANNED", tone: variant("neutral", null) },
    { word: "RELEASED", tone: variant("info", null) },
    { word: "CANCELLED", tone: variant("danger", null) },
];

type Options = { selection?: boolean; readOnly?: boolean; blanks?: number };

/** Build the sheet the way an author does and unwrap the `Sheet` arm. */
function buildSheet(opts: Options = {}): SheetRootValue {
    const program = East.function([], UIComponentType, ($) => {
        const rows = $.const(ROWS, ArrayType(JobType));
        const statuses = $.const(STATUSES, ArrayType(StatusType));
        return Sheet.Root(rows, {
            start: Sheet.column.date(JobType, { header: "Start", sub: "d/m · fri · +3d" }),
            task: Sheet.column.text(JobType, { header: "Task" }),
            qty: Sheet.column.quantity(JobType, { header: "Qty" }),
            code: Sheet.column.stamped(JobType, { header: "Code", owner: "ERP" }),
            status: Sheet.column.enum(JobType, "statuses", { header: "Status" }),
        }, {
            id: "id",
            registers: { statuses: Sheet.register.members(statuses, { kind: "status", key: (s) => s.word, label: (s) => s.word, tone: (s) => some(s.tone) }) },
            blanks: opts.blanks ?? 3,
            ...(opts.readOnly ? { readOnly: true } : {}),
            ...(opts.selection ? { selection: some({ rowId: some("j2"), key: some("task") }) } : {}),
            footer: [{ text: "2 planned" }],
        });
    });
    const value = East.compile(program, getRegisteredPlatformImplementations())() as
        ValueTypeOf<typeof UIComponentType> & { value: SheetRootValue };
    return value.value;
}

/** A paged sheet over `n` generated rows keyed by id. */
function buildPaged(n: number): SheetRootValue {
    const program = East.function([], UIComponentType, ($) => {
        const rows = $.let(East.Array.range(0n, BigInt(n)).map(($2, i) => $2.const({
            id: East.str`p${i}`, start: none, task: East.str`Task ${i}`, qty: none, code: "", status: "",
        }, JobType)), ArrayType(JobType));
        const source = $.const(Paged.of(`sheet_dom_${n}`, rows, { key: (r) => r.id }));
        return Sheet.Root(source, {
            task: Sheet.column.text(JobType, { header: "Task" }),
            qty: Sheet.column.quantity(JobType, { header: "Qty" }),
        }, { id: "id", blanks: 2 });
    });
    const value = East.compile(program, getRegisteredPlatformImplementations())() as
        ValueTypeOf<typeof UIComponentType> & { value: SheetRootValue };
    return value.value;
}

/** Swap the host callbacks for spies after compilation — the renderer takes every function from the value. */
function withSpies(root: SheetRootValue) {
    const edits: SheetEditValue[] = [];
    const selects: SheetSelectionValue[] = [];
    const value: SheetRootValue = {
        ...root,
        onEdit: some((e: SheetEditValue) => { edits.push(e); return null; }),
        onSelect: some((s: SheetSelectionValue) => { selects.push(s); return null; }),
    } as SheetRootValue;
    return { value, edits, selects };
}

function mount(value: SheetRootValue) {
    const utils = render(
        <ChakraProvider value={system}>
            <EastChakraSheet value={value} storageKey="sheet-test" />
        </ChakraProvider>,
    );
    const card = utils.container.querySelector("[data-sheet-card]") as HTMLElement;
    const rows = () => [...utils.container.querySelectorAll('[data-slot="row"]')] as HTMLElement[];
    const cell = (r: number, key: string) => rows()[r]!.querySelector(`[data-slot="cell"][data-key="${key}"]`) as HTMLElement;
    const input = () => utils.container.querySelector('[data-slot="editorInput"]') as HTMLInputElement | null;
    const key = (k: string, init: Partial<KeyboardEventInit> = {}) => fireEvent.keyDown(card, { key: k, ...init });
    const editorKey = (k: string, init: Partial<KeyboardEventInit> = {}) => fireEvent.keyDown(input()!, { key: k, ...init });
    const type = (text: string) => fireEvent.change(input()!, { target: { value: text } });
    const flush = () => new Promise<void>((r) => queueMicrotask(r));
    return { ...utils, card, rows, cell, input, key, editorKey, type, flush };
}

describe("the body", () => {
    test("real rows, then the blank padding, numbered on; the header's two lines; the footer", () => {
        const { container, rows } = mount(buildSheet());
        expect(rows()).toHaveLength(5);
        expect(rows().filter((r) => !r.hasAttribute("data-blank"))).toHaveLength(2);
        expect(rows().map((r) => r.querySelector('[data-slot="gutter"]')!.textContent)).toEqual(["1", "2", "3", "4", "5"]);
        // The row under the header is marked, so its ring stays inside the cell instead of under the sticky header.
        expect(rows().map((r) => r.hasAttribute("data-first"))).toEqual([true, false, false, false, false]);
        const headers = [...container.querySelectorAll('[data-slot="headerCell"]')];
        expect(headers.map((h) => h.textContent)).toEqual(["Startd/m · fri · +3d", "Task", "Qty", "Code", "Status"]);
        // Cells by kind: a date prints `16 Feb 26`, a quantity groups, a stamped
        // code sits mono, an enum shows its dot and word, a blank row's stamped cell stays empty.
        expect(container.querySelector('[data-row-id="j1"] [data-key="start"]')!.textContent).toBe("16 Feb 26");
        expect(container.querySelector('[data-row-id="j1"] [data-key="qty"]')!.textContent).toBe("1,200");
        expect(container.querySelector('[data-row-id="j1"] [data-key="code"]')!.textContent).toBe("WO-26001");
        expect(container.querySelector('[data-row-id="j1"] [data-key="status"] [data-tone="info"]')).toBeTruthy();
        expect(container.querySelector('[data-row-id="j2"] [data-key="code"]')!.textContent).toBe("—");
        expect(rows()[3]!.querySelector('[data-key="code"]')!.textContent).toBe("");
        expect(container.querySelector('[data-slot="footerCounts"]')!.textContent).toBe("2 planned");
        expect(container.querySelector('[data-slot="toolbar"]')).toBeNull();
    });
});

describe("the ring and the range", () => {
    test("a click selects and reports; shift-click extends; arrows move; the gutter picks the whole row", async () => {
        const { value, selects } = withSpies(buildSheet());
        const { container, cell, key, rows, flush } = mount(value);
        fireEvent.mouseDown(cell(1, "task"), { button: 0 });
        expect(cell(1, "task").hasAttribute("data-selected")).toBe(true);
        await flush();
        expect(selects.at(-1)).toEqual({ rowId: some("j2"), key: some("task") });
        key("ArrowRight");
        expect(cell(1, "qty").hasAttribute("data-selected")).toBe(true);
        fireEvent.mouseDown(cell(2, "code"), { button: 0, shiftKey: true });
        expect(container.querySelectorAll('[data-slot="rangeWash"]')).toHaveLength(4);
        key("Escape");
        expect(container.querySelectorAll('[data-slot="rangeWash"]')).toHaveLength(0);
        fireEvent.mouseDown(rows()[0]!.querySelector('[data-slot="gutter"]')!, { button: 0 });
        expect(container.querySelectorAll('[data-slot="rangeWash"]')).toHaveLength(5);
        expect(container.querySelector('[data-slot="footerHint"]')!.textContent).toMatch(/1 row selected/);
    });

    test("a range drag needs pointer movement: a cell entered under a held but stationary button never extends the range", () => {
        const { container, cell } = mount(buildSheet());
        // Press on a cell, then the sheet moves under the pointer (a window
        // landing, a row growing): the next cell fires mouseenter with no
        // movement — one cell stays selected.
        fireEvent.mouseDown(cell(0, "task"), { button: 0 });
        fireEvent.mouseEnter(cell(1, "task"));
        expect(container.querySelectorAll('[data-slot="rangeWash"]')).toHaveLength(0);
        expect(cell(0, "task").hasAttribute("data-selected")).toBe(true);
        // The pointer actually moves with the button held: the range follows it.
        fireEvent.mouseMove(window, { buttons: 1 });
        fireEvent.mouseEnter(cell(1, "qty"));
        expect(container.querySelectorAll('[data-slot="rangeWash"]')).toHaveLength(4);
        fireEvent.mouseUp(window);
        // Released: a later mouseenter is a hover, not a drag.
        fireEvent.mouseEnter(cell(2, "qty"));
        expect(container.querySelectorAll('[data-slot="rangeWash"]')).toHaveLength(4);
    });
});

describe("editing", () => {
    test("a printable key seeds an edit, ⏎ commits down and the host hears a typed commit carrying the row after it", async () => {
        const { value, edits } = withSpies(buildSheet());
        const { cell, key, input, type, editorKey, flush } = mount(value);
        fireEvent.mouseDown(cell(1, "task"), { button: 0 });
        key("x");
        expect(input()!.value).toBe("x");
        type("xy");
        editorKey("Enter");
        expect(input()).toBeNull();
        expect(cell(1, "task").textContent).toBe("xy");
        expect(cell(2, "task").hasAttribute("data-selected")).toBe(true);
        await flush();
        expect(edits).toHaveLength(1);
        const e = edits[0]!;
        expect(e.type).toBe("commit");
        const c = e.value as { rowId: string; offset: bigint; key: string; row: { cells: Map<string, { type: string; value: unknown }> }; source: { type: string } };
        expect(c.rowId).toBe("j2");
        expect(c.offset).toBe(1n);
        expect(c.key).toBe("task");
        expect(c.row.cells.get("task")).toEqual({ type: "String", value: "xy" });
        expect(c.source.type).toBe("typed");
    });

    test("the date grammar runs through the editor; an unrecognised value keeps the editor open with the neg ring", async () => {
        const { value, edits } = withSpies(buildSheet());
        const { container, cell, key, type, editorKey, input, flush } = mount(value);
        fireEvent.mouseDown(cell(1, "start"), { button: 0 });
        key("+");
        type("+3");
        expect(container.querySelector('[data-slot="stripLabel"]')!.textContent).toBe("START");
        editorKey("Tab");
        await flush();
        const c = edits[0]!.value as { row: { cells: Map<string, { type: string; value: Date }> } };
        expect(c.row.cells.get("start")!.type).toBe("DateTime");
        expect(c.row.cells.get("start")!.value.getTime()).toBe(addDays(todayUtc(), 3).getTime());
        // Tab moved right, onto the task column.
        expect(cell(1, "task").hasAttribute("data-selected")).toBe(true);
        // An unparseable quantity never commits.
        fireEvent.mouseDown(cell(1, "qty"), { button: 0 });
        key("z");
        type("zz");
        editorKey("Enter");
        expect(input()).not.toBeNull();
        expect(container.querySelector('[data-slot="editorError"]')).toBeTruthy();
        expect(container.querySelector('[data-slot="stripChip"]')!.textContent).toBe("unrecognised");
        editorKey("Escape");
        expect(input()).toBeNull();
        await flush();
        expect(edits).toHaveLength(1);
    });

    test("an enum resolves to the register's word through the strip's armed candidate", async () => {
        const { value, edits } = withSpies(buildSheet());
        const { container, cell, key, type, editorKey, flush } = mount(value);
        fireEvent.mouseDown(cell(1, "status"), { button: 0 });
        key("c");
        type("can");
        expect(container.querySelector('[data-slot="stripChip"][data-armed]')!.textContent).toBe("CANCELLED");
        editorKey("Enter");
        await flush();
        const c = edits[0]!.value as { row: { cells: Map<string, { value: unknown }> } };
        expect(c.row.cells.get("status")!.value).toBe("CANCELLED");
        expect(container.querySelector('[data-row-id="j2"] [data-key="status"] [data-tone="danger"]')).toBeTruthy();
    });

    test("typing into a blank row inserts a real row after the last one, the ring follows it", async () => {
        const { value, edits } = withSpies(buildSheet());
        const { cell, key, type, editorKey, rows, flush } = mount(value);
        fireEvent.mouseDown(cell(3, "task"), { button: 0 });
        key("N");
        type("New job");
        editorKey("Enter");
        await flush();
        expect(rows().filter((r) => !r.hasAttribute("data-blank"))).toHaveLength(3);
        expect(rows()).toHaveLength(6);   // the padding is kept below the new last row
        expect(cell(2, "task").textContent).toBe("New job");
        expect(cell(3, "task").hasAttribute("data-selected")).toBe(true);
        expect(edits).toHaveLength(1);
        const e = edits[0]!.value as { afterRowId: { type: string; value: string }; row: { id: string; cells: Map<string, { type: string; value: unknown }> } };
        expect(edits[0]!.type).toBe("insert");
        expect(e.afterRowId).toEqual(some("j2"));
        expect(e.row.id).toMatch(/^sheet-/);
        expect(e.row.cells.get("task")).toEqual({ type: "String", value: "New job" });
        expect(e.row.cells.get("qty")).toEqual({ type: "Null", value: null });
    });

    test("⌫ clears the selected cells but never a stamped one; whole rows selected ⌫ removes them", async () => {
        const { value, edits } = withSpies(buildSheet());
        const { cell, key, rows, flush } = mount(value);
        fireEvent.mouseDown(cell(0, "qty"), { button: 0 });
        fireEvent.mouseDown(cell(0, "code"), { button: 0, shiftKey: true });
        key("Delete");
        await flush();
        expect(edits).toHaveLength(1);
        expect((edits[0]!.value as { key: string }).key).toBe("qty");
        expect(cell(0, "qty").textContent).toBe("");
        expect(cell(0, "code").textContent).toBe("WO-26001");
        fireEvent.mouseDown(rows()[1]!.querySelector('[data-slot="gutter"]')!, { button: 0 });
        key("Backspace");
        await flush();
        expect(edits[1]!.type).toBe("remove");
        expect((edits[1]!.value as { rowIds: string[] }).rowIds).toEqual(["j2"]);
        expect(rows().filter((r) => !r.hasAttribute("data-blank"))).toHaveLength(1);
    });

    test("a read-only sheet opens no editor", () => {
        const { cell, key, input } = mount(buildSheet({ readOnly: true }));
        fireEvent.mouseDown(cell(0, "task"), { button: 0 });
        key("x");
        expect(input()).toBeNull();
        key("Enter");
        expect(input()).toBeNull();
    });
});

describe("the controlled selection (§3.14)", () => {
    test("the ring follows the value, and every move still reports", async () => {
        const { value, selects } = withSpies(buildSheet({ selection: true }));
        const { cell, key, flush } = mount(value);
        expect(cell(1, "task").hasAttribute("data-selected")).toBe(true);
        key("ArrowUp");
        await flush();
        expect(selects.at(-1)).toEqual({ rowId: some("j1"), key: some("task") });
    });
});

describe("the clipboard", () => {
    test("copy is tab-separated with the kinds' clipboard forms; paste lands at the ring and parses by kind", async () => {
        const { value, edits } = withSpies(buildSheet());
        const { container, card, cell, flush } = mount(value);
        fireEvent.mouseDown(cell(0, "start"), { button: 0 });
        fireEvent.mouseDown(cell(0, "qty"), { button: 0, shiftKey: true });
        const set = new Map<string, string>();
        fireEvent.copy(card, { clipboardData: { setData: (k: string, v: string) => set.set(k, v), getData: () => "" } });
        expect(set.get("text/plain")).toBe("16/2/2026\tMachining\t1200");
        expect(container.querySelector('[data-slot="footerMessage"]')!.textContent).toBe("Copied 1×3 to clipboard");
        fireEvent.mouseDown(cell(1, "start"), { button: 0 });
        fireEvent.paste(card, { clipboardData: { getData: () => "17/11/2026\tPasted\t18k" } });
        await flush();
        expect(edits.map((e) => (e.value as { key: string }).key)).toEqual(["start", "task", "qty"]);
        expect(cell(1, "start").textContent).toBe("17 Nov 26");
        expect(cell(1, "qty").textContent).toBe("18,000");
        expect((edits[0]!.value as { source: { type: string } }).source.type).toBe("pasted");
        expect(container.querySelectorAll('[data-slot="rangeWash"]')).toHaveLength(3);
    });
});

describe("the paged arm (§3.13)", () => {
    test("a REAL Paged.of source: windows land, the tail band describes the rest, the transport line counts elements, no blanks until exhaustion", async () => {
        const { container } = mount(buildPaged(1_000));
        await waitFor(() => {
            expect(container.querySelectorAll('[data-slot="row"]:not([data-blank])').length).toBe(600);
        }, { timeout: 15_000 });
        const band = container.querySelector('[data-slot="band"][data-band="tail"]');
        expect(band).toBeTruthy();
        expect(band!.getAttribute("data-elements")).toBe("400");
        expect(container.querySelectorAll('[data-slot="row"][data-blank]')).toHaveLength(0);
        expect(container.querySelector('[data-slot="footerTransport"]')!.textContent).toBe("600 loaded of 1,000");
        expect(container.querySelector('[data-slot="toolbarBadge"]')!.textContent).toBe("loaded rows only");
        expect(container.querySelector('[data-row-id="p0"] [data-key="task"]')!.textContent).toBe("Task 0");
    }, 30_000);

    test("a source that fits the opening ring is exhausted: the blanks appear and edits go to onEdit as commits with the source offset", async () => {
        const { value, edits } = withSpies(buildPaged(450));
        const { container, cell, key, type, editorKey, flush } = mount(value);
        await waitFor(() => {
            expect(container.querySelectorAll('[data-slot="row"][data-blank]').length).toBe(2);
        }, { timeout: 15_000 });
        expect(container.querySelector('[data-slot="footerTransport"]')!.textContent).toBe("450 loaded of 450");
        expect(container.querySelector('[data-slot="toolbarBadge"]')).toBeNull();
        fireEvent.mouseDown(cell(449, "qty"), { button: 0 });
        key("4");
        type("42");
        editorKey("Enter");
        await flush();
        expect(edits).toHaveLength(1);
        const c = edits[0]!.value as { rowId: string; offset: bigint };
        expect(c.rowId).toBe("p449");
        expect(c.offset).toBe(449n);
        expect(cell(449, "qty").textContent).toBe("42");
    }, 30_000);
});

// ── The link cell and its editor (P3 — Sheet Spec §5 rows 4–9) ─────────────

const ActivityType = StructType({ name: StringType, uom: StringType, sides: Sheet.Types.Sides });
const MachineType = StructType({ code: StringType, family: StringType, line: StringType });
const LineType = StructType({ code: StringType, name: StringType, machines: IntegerType, aliases: ArrayType(StringType) });
const PlanRowType = StructType({ id: StringType, activity: StringType, qty: OptionType(FloatType), stations: Sheet.Types.Link, notes: StringType });
const ACTIVITIES = [
    { name: "Machining", uom: "pcs", sides: variant("both", null) },
    { name: "Inspection", uom: "lots", sides: variant("in", null) },
    { name: "Shipping", uom: "pallets", sides: variant("from", null) },
];
const MACHINES = [
    { code: "M2140", family: "CNC lathe", line: "Line 2" }, { code: "M2141", family: "CNC lathe", line: "Line 2" },
    { code: "M2145", family: "CNC lathe", line: "Line 2" }, { code: "M7301", family: "assembly bench", line: "Line 7" },
];
const LINES = [
    { code: "L2", name: "Line 2", machines: 96n, aliases: ["line 2", "the 2 line"] },
    { code: "L7", name: "Line 7", machines: 72n, aliases: ["l7"] },
];
const PLAN = [
    { id: "p1", activity: "Machining", qty: some(1200.0), notes: "", stations: { from: [variant("identified", { key: "M2140" })], to: [variant("counted", { n: 4n, key: "CNC lathe" })] } },
    { id: "p2", activity: "Inspection", qty: some(2.0), notes: "", stations: { from: [], to: [variant("placeholder", null)] } },
    { id: "p3", activity: "Shipping", qty: none, notes: "", stations: { from: [], to: [variant("text", "kept")] } },
    { id: "p4", activity: "Machining", qty: some(900.0), notes: "", stations: { from: [], to: [] } },
];

function buildLinkSheet(): SheetRootValue {
    const program = East.function([], UIComponentType, ($) => {
        const rows = $.const(PLAN, ArrayType(PlanRowType));
        const activities = $.const(ACTIVITIES, ArrayType(ActivityType));
        const machines = $.const(MACHINES, ArrayType(MachineType));
        const lines = $.const(LINES, ArrayType(LineType));
        const Ctx = Sheet.Types.Context(PlanRowType, ActivityType);
        const impliedStations = $.const(East.function([Ctx], OptionType(Sheet.Types.Counted), ($2, ctx) => {
            const noCount = $2.const(none, OptionType(Sheet.Types.Counted));
            return ctx.row.qty.match({
                none: (_$) => noCount,
                some: ($3, q) => {
                    // ⌈qty ÷ 300⌉ by hand — `toInteger` refuses a fraction.
                    const share = $3.let(q.divide(300.0));
                    const frac = $3.let(share.remainder(1.0));
                    const n = $3.let(frac.equal(0.0).ifElse((_$) => share, (_$) => share.subtract(frac).add(1.0)).toInteger());
                    return East.value(some({ n, key: "CNC lathe" }), OptionType(Sheet.Types.Counted));
                },
            });
        }));
        const CheckCtx = Sheet.Types.CheckContext(PlanRowType);
        const lathesOnly = $.const(East.function([CheckCtx], OptionType(StringType), ($2, c) => {
            const noFlag = $2.const(none, OptionType(StringType));
            return c.member.match({
                identified: (_$, m) => m.key.startsWith("M7").ifElse((_$2) => East.value(some(East.str`${m.key} is not a lathe`), OptionType(StringType)), (_$2) => noFlag),
            }, (_$) => noFlag);
        }));
        return Sheet.Root(rows, {
            activity: Sheet.column.lookup(PlanRowType, { header: "Activity" }),
            qty: Sheet.column.quantity(PlanRowType, ActivityType, { header: "Qty", uom: (d) => d.uom }),
            stations: Sheet.column.link(PlanRowType, ActivityType, "stations", {
                header: "Work centres",
                members: [
                    { kind: "machine", identified: true }, { kind: "range", identified: true },
                    { kind: "line", countable: true, resolvesTo: "machine" }, { kind: "family", countable: true, resolvesTo: "machine" },
                ],
                multiple: { forms: ["N x kind", "kind x N"], ops: ["x", "X", "*", "×"], appliesTo: "countable" },
                sides: { value: (d) => d.sides, locks: { from: { to: "external", in: "in place" }, to: { from: "external" } } },
                arity: Sheet.link.arity("to", impliedStations),
                check: [Sheet.link.check.exists(), lathesOnly],
            }),
            notes: Sheet.column.text(PlanRowType, { header: "Notes" }),
        }, {
            id: "id",
            driver: Sheet.driver("activity", activities, { key: (a) => a.name, label: (a) => a.name }),
            registers: {
                stations: Sheet.register.concat([
                    Sheet.register.members(machines, { kind: "machine", key: (m) => m.code, label: (m) => m.code, meta: (m) => some(m.family), parent: (m) => some(m.line) }),
                    Sheet.register.members(lines, { kind: "line", key: (l) => l.name, label: (l) => l.name, aliases: (l) => l.aliases, meta: (l) => some(East.str`line · ${l.machines}`) }),
                    Sheet.register.members(machines, { kind: "family", key: (m) => m.family, label: (m) => m.family, meta: (_m) => some("family") }),
                ]),
            },
            blanks: 2,
        });
    });
    const value = East.compile(program, getRegisteredPlatformImplementations())() as
        ValueTypeOf<typeof UIComponentType> & { value: SheetRootValue };
    return value.value;
}

describe("the link cell (B§4.3)", () => {
    test("halves, chips with meta, locks per the driver's sides, the minus for in place, flags from the checks", () => {
        const { container } = mount(buildLinkSheet());
        const cell = (id: string) => container.querySelector(`[data-row-id="${id}"] [data-key="stations"]`)!;
        // Both halves live: a single chip per half carries its register meta.
        const p1 = cell("p1");
        expect(p1.querySelector('[data-slot="linkCell"]')!.getAttribute("data-sides")).toBe("both");
        expect([...p1.querySelectorAll('[data-half="from"] [data-slot="chip"]')].map((c) => c.textContent)).toEqual(["M2140CNC lathe"]);
        expect([...p1.querySelectorAll('[data-half="to"] [data-slot="chip"]')].map((c) => c.textContent)).toEqual(["4 × CNC latheunassigned"]);
        // In place: From locked with its tag, the divider a minus, the placeholder dashed.
        const p2 = cell("p2");
        expect(p2.querySelector('[data-slot="linkCell"]')!.getAttribute("data-sides")).toBe("in");
        expect(p2.querySelector('[data-half="from"] [data-slot="lockTag"]')!.textContent).toBe("in place");
        expect(p2.querySelector('[data-half="to"] [data-slot="chip"][data-member="placeholder"]')).toBeTruthy();
        // From only: To locked AND holding content warns; a text member is dashed.
        const p3 = cell("p3");
        expect(p3.querySelector('[data-half="to"] [data-slot="lockWarn"]')!.textContent).toBe("external");
        expect(p3.querySelector('[data-half="to"] [data-slot="chip"][data-member="text"]')!.textContent).toBe("kept");
        // An empty live cell says what it wants.
        const p4 = cell("p4");
        expect([...p4.querySelectorAll('[data-slot="halfLabel"]')].map((h) => h.textContent)).toEqual(["from", "to"]);
        // A blank row draws nothing.
        expect(container.querySelector('[data-slot="row"][data-blank] [data-slot="linkCell"]')).toBeNull();
    });
});

describe("the link editor (B§4.4)", () => {
    test("typing resolves through the grammar — `,` chips, `>` hops, the armed candidate on ⇥ — and commits a typed Link", async () => {
        const { value, edits } = withSpies(buildLinkSheet());
        const { container, cell, key, type, editorKey, input, flush } = mount(value);
        fireEvent.mouseDown(cell(3, "stations"), { button: 0 });
        key("m");
        expect(container.querySelector('[data-slot="editor"][data-link]')).toBeTruthy();
        expect(input()!.getAttribute("data-side")).toBe("0");
        type("m2140, the 2 line > 4 x cnc lathe, m73");
        // From resolved to chips; the caret hopped to To; the buffer holds the tail.
        expect([...container.querySelectorAll('[data-slot="editor"] [data-half="from"] [data-slot="chip"]')].map((c) => c.textContent)).toEqual(["M2140", "Line 2"]);
        expect([...container.querySelectorAll('[data-slot="editor"] [data-half="to"] [data-slot="chip"]')].map((c) => c.textContent)).toEqual(["4 × CNC lathe"]);
        expect(input()!.getAttribute("data-side")).toBe("1");
        expect(input()!.value).toBe("m73");
        expect(container.querySelector('[data-slot="editorGhost"]')!.textContent).toBe("01");
        // The strip: the armed candidate with its meta, the To half named.
        expect(container.querySelector('[data-slot="stripLabel"]')!.textContent).toBe("WORK CENTRES · to");
        expect(container.querySelector('[data-slot="stripChip"][data-armed]')!.textContent).toBe("M7301");
        editorKey("Tab");
        expect(input()!.value).toBe("M7301");
        editorKey("Enter");   // resolves and stays
        expect(input()!.value).toBe("");
        expect([...container.querySelectorAll('[data-slot="editor"] [data-half="to"] [data-slot="chip"]')].map((c) => c.textContent)).toEqual(["4 × CNC lathe", "M7301"]);
        // The arity meta reads in the strip while To is edited: qty 900 ⇒ 3 × CNC lathe implied · 5 named.
        expect(container.querySelector('[data-slot="stripMeta"]')!.textContent).toBe("3 × CNC lathe implied · 5 named — more than the quantity needs");
        editorKey("Enter");   // empty: commits down
        await flush();
        expect(edits).toHaveLength(1);
        const link = (edits[0]!.value as { row: { cells: Map<string, { type: string; value: { from: unknown[]; to: unknown[] } }> } }).row.cells.get("stations")!;
        expect(link.type).toBe("Link");
        expect(link.value.from).toEqual([{ type: "identified", value: { key: "M2140" } }, { type: "identified", value: { key: "Line 2" } }]);
        expect(link.value.to).toEqual([{ type: "counted", value: { n: 4n, key: "CNC lathe" } }, { type: "identified", value: { key: "M7301" } }]);
        // The committed cell draws its chips; the custom check flags the bench.
        const committed = container.querySelector('[data-row-id="p4"] [data-key="stations"]')!;
        expect([...committed.querySelectorAll('[data-half="to"] [data-slot="chip"]')].map((c) => c.textContent)).toEqual(["4 × CNC lathe", "M7301"]);
        const flagged = committed.querySelector('[data-slot="chip"][data-flag]')!;
        expect(flagged.textContent).toBe("M7301");
        expect(flagged.getAttribute("title")).toBe("M7301 is not a lathe");
    });

    test("a locked half is skipped by ⇥ and flagged when typed into; a click in a half moves the caret; ⌫ pops a chip", () => {
        const { container, cell, key, type, editorKey, input } = mount(buildLinkSheet());
        // Shipping — from only: the editor opens in From, ⇥ commits right instead of hopping.
        fireEvent.mouseDown(cell(2, "stations"), { button: 0 });
        key("Enter");
        expect(input()!.getAttribute("data-side")).toBe("0");
        expect(container.querySelector('[data-slot="editor"] [data-half="to"] [data-slot="lockWarn"]')).toBeTruthy();   // holds `kept`
        editorKey("Tab");
        expect(input()).toBeNull();
        expect(cell(2, "notes").hasAttribute("data-selected")).toBe(true);
        // Machining — both halves: click the To half, pop its chip back into the buffer.
        fireEvent.mouseDown(cell(0, "stations"), { button: 0 });
        key("Enter");
        expect(input()!.getAttribute("data-side")).toBe("1");   // the first live EMPTY half is none ⇒ destination
        fireEvent.mouseDown(container.querySelector('[data-slot="editor"] [data-half="from"]')!, { button: 0 });
        expect(input()!.getAttribute("data-side")).toBe("0");
        editorKey("Backspace");
        expect(input()!.value).toBe("M2140");
        expect(container.querySelectorAll('[data-slot="editor"] [data-half="from"] [data-slot="chip"]')).toHaveLength(0);
        type("");
        editorKey("Escape");
        expect(input()).toBeNull();
        // Cancelled: the cell keeps its chips.
        expect(container.querySelectorAll('[data-row-id="p1"] [data-half="from"] [data-slot="chip"]')).toHaveLength(1);
    });

    test("paste lays two clipboard columns over a link column and parses them through the grammar", async () => {
        const { value, edits } = withSpies(buildLinkSheet());
        const { card, cell, flush } = mount(value);
        fireEvent.mouseDown(cell(3, "stations"), { button: 0 });
        fireEvent.paste(card, { clipboardData: { getData: () => "M2141\t2 x line 2, tbc" } });
        await flush();
        expect(edits).toHaveLength(1);
        const link = (edits[0]!.value as { row: { cells: Map<string, { value: { from: unknown[]; to: unknown[] } }> } }).row.cells.get("stations")!.value;
        expect(link.from).toEqual([{ type: "identified", value: { key: "M2141" } }]);
        expect(link.to).toEqual([{ type: "counted", value: { n: 2n, key: "Line 2" } }, { type: "placeholder", value: null }]);
        expect(cell(3, "stations").querySelectorAll('[data-slot="chip"]')).toHaveLength(3);
    });
});
