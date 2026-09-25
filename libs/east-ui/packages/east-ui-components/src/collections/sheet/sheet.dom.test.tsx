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
 * and the paged arm's bands, transport line and exhaustion, a failure kept
 * to where it happened (#853), and the grid as assistive tech reads it and
 * the keyboard walks it (#860) — every value built by the east-ui
 * factory and COMPILED, so the closures the renderer calls are the ones East
 * emits.
 */

import { describe, test, expect, afterEach, beforeEach, vi } from "vitest";
import { render, cleanup, fireEvent, waitFor, act, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { ChakraProvider } from "@chakra-ui/react";
import { I18nProvider } from "@react-aria/i18n";
import {
    ArrayType, DateTimeType, East, FloatType, IntegerType, OptionType, StringType, StructType,
    decodeBeast2For, encodeBeast2For, none, some, variant, type ValueTypeOf,
} from "@elaraai/east";
import { Paged, StatusValueType } from "@elaraai/east-ui";
import { Sheet, UIComponentType } from "@elaraai/east-ui/internal";
import { system } from "../../theme/index.js";
import { getStore, initializeStore, trackKey } from "../../platform/state-runtime.js";
import { UIStore } from "../../platform/state-store.js";
import { getRegisteredPlatformImplementations } from "../../platform/registry.js";
import { EastChakraSheet } from "./index.js";
import { SHEET_PAGE_SIZE } from "./paging.js";
import { sheetJournal } from "./journal.test-utils.js";
import { emulateWindowScroll, holdFrames, measureRowsAsDrawn, offsetOf } from "./frame.test-utils.js";
import type { SheetRootValue, SheetRowValue, SheetSelectionValue } from "./values.js";

// A sheet of 400 rows or more mounts a screenful and measures it (#856):
// its rows are as tall as they draw.
let restoreRows: () => void = () => {};
beforeEach(() => { initializeStore(new UIStore()); restoreRows = measureRowsAsDrawn(); });
afterEach(() => { cleanup(); restoreRows(); });

// jsdom lacks ResizeObserver — the key search's combobox positioner needs one.
class ResizeObserverStub { observe() {} unobserve() {} disconnect() {} }
(globalThis as unknown as { ResizeObserver?: unknown }).ResizeObserver ??= ResizeObserverStub;

// jsdom has no `CSS.escape`; the enum editor's combobox selects its items with it.
(globalThis as unknown as { CSS?: { escape?: (s: string) => string } }).CSS ??= {};
(globalThis as unknown as { CSS: { escape?: (s: string) => string } }).CSS.escape ??= (s: string) => s.replace(/[^a-zA-Z0-9_-]/g, (c) => `\\${c}`);

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
/** j1 holds a fraction, so a whole-number re-read would show (#852). */
const ROWS_FRACTION = [{ ...ROWS[0]!, qty: some(1234.5) }, ROWS[1]!];
/** j1 holds more digits than the number field shows (`0.3`). */
const ROWS_NOISE = [{ ...ROWS[0]!, qty: some(0.30000000000000004) }, ROWS[1]!];
/** Five thousand jobs: an inline sheet past the threshold at which an unbounded sheet mounts a screenful (#856). */
const MANY = Array.from({ length: 5_000 }, (_x, i) => ({ id: `m${i}`, start: none, task: `Job ${i}`, qty: none, code: "", status: "" }));

type Options = { selection?: boolean; readOnly?: boolean; blanks?: number; rows?: ValueTypeOf<typeof JobType>[] };

/** Build the sheet the way an author does and unwrap the `Sheet` arm. */
function buildSheet(opts: Options = {}): SheetRootValue {
    const data = opts.rows ?? ROWS;
    const program = East.function([], UIComponentType, ($) => {
        const rows = $.const(data, ArrayType(JobType));
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
            ...(opts.selection ? { selection: some({ rowId: some("j2"), line: none, key: some("task") }) } : {}),
            footer: [{ text: "2 planned" }],
        });
    });
    const value = East.compile(program, getRegisteredPlatformImplementations())() as
        ValueTypeOf<typeof UIComponentType> & { value: SheetRootValue };
    return value.value;
}

/** A paged sheet over `n` generated rows keyed by id. */
function buildPaged(n: number): SheetRootValue {
    const count = BigInt(n);
    const sourceId = `sheet_dom_${n}`;
    const program = East.function([], UIComponentType, ($) => {
        const total = $.const(count);
        const rows = $.let(East.Array.range(0n, total).map(($2, i) => $2.const({
            id: East.str`p${i}`, start: none, task: East.str`Task ${i}`, qty: none, code: "", status: "",
        }, JobType)), ArrayType(JobType));
        const source = $.const(Paged.of(sourceId, rows, { key: (r) => r.id }));
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
    const journal = sheetJournal(root);
    const edits = journal.events;
    const selects: SheetSelectionValue[] = [];
    const value: SheetRootValue = {
        ...journal.value,
        onSelect: some((s: SheetSelectionValue) => { selects.push(s); return null; }),
    } as SheetRootValue;
    return { value, edits, selects, draft: journal.draft };
}

/** Mount the sheet; with `locale`, under an `I18nProvider` in that language (#852). */
function mount(value: SheetRootValue, locale?: string) {
    const sheet = <EastChakraSheet value={value} storageKey="sheet-test" />;
    const utils = render(
        <ChakraProvider value={system}>
            {locale !== undefined ? <I18nProvider locale={locale}>{sheet}</I18nProvider> : sheet}
        </ChakraProvider>,
    );
    const card = utils.container.querySelector("[data-sheet-card]") as HTMLElement;
    const rows = () => [...utils.container.querySelectorAll('[data-slot="row"]')] as HTMLElement[];
    const cell = (r: number, key: string) => rows()[r]!.querySelector(`[data-slot="cell"][data-key="${key}"]`) as HTMLElement;
    const input = () => utils.container.querySelector('[data-slot="editorInput"]') as HTMLInputElement | null;
    const key = (k: string, init: Partial<KeyboardEventInit> = {}) => fireEvent.keyDown(card, { key: k, ...init });
    const editorKey = (k: string, init: Partial<KeyboardEventInit> = {}) => fireEvent.keyDown(input()!, { key: k, ...init });
    // A native `input` event — the common number field listens to it, the text inputs too.
    const type = (text: string) => fireEvent.input(input()!, { target: { value: text } });
    // Two microtask turns and a frame, inside `act`: the common fields'
    // machines start and take their events on microtasks, the number field
    // writes its input on the next frame, and the renders they cause are
    // React work `act` flushes on the way out.
    const tick = () => new Promise<void>((r) => queueMicrotask(r));
    const frame = () => new Promise<void>((r) => (typeof requestAnimationFrame === "function" ? requestAnimationFrame(() => r()) : setTimeout(r, 20)));
    const flush = () => act(async () => { await tick(); await tick(); await frame(); });
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
        expect(selects.at(-1)).toEqual({ rowId: some("j2"), line: none, key: some("task") });
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
        const { value, edits, draft } = withSpies(buildSheet());
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
        expect(edits[0]!.origin.type).toBe("typed");
        expect(edits[0]!.draftChanges.map(change => change.id)).toEqual(["j2"]);
        expect(draft("j2", Sheet.Types.Draft(JobType)).task).toEqual(variant("value", "xy"));
    });

    test("the date field: a seed lands in the day segment, digits fill the rest, ⇥ on the last segment commits right; an unrecognised number becomes an undoable invalid draft", async () => {
        const { value, edits, draft } = withSpies(buildSheet());
        const { container, cell, key, type, editorKey, input, flush } = mount(value);
        fireEvent.mouseDown(cell(1, "start"), { button: 0 });
        key("1");   // the printable key that opened the editor is typed into the day segment
        const field = () => container.querySelector('[data-slot="editorDate"]') as HTMLElement;
        const segments = () => [...field().querySelectorAll<HTMLElement>('[role="spinbutton"]')];
        const typeInto = (seg: HTMLElement, digits: string) => act(() => {
            for (const ch of digits) seg.dispatchEvent(new InputEvent("beforeinput", { data: ch, inputType: "insertText", bubbles: true, cancelable: true }));
        });
        expect(field()).toBeTruthy();
        expect(input()).toBeNull();   // no typed buffer: the segments are the field
        expect(container.querySelector('[data-slot="stripLabel"]')!.textContent).toBe("START");
        expect(container.querySelector('[data-slot="stripChip"]')!.textContent).toBe("incomplete");
        typeInto(segments()[0]!, "7");
        typeInto(segments()[1]!, "11");
        typeInto(segments()[2]!, "2026");
        expect(container.querySelector('[data-slot="stripChip"]')!.textContent).toBe("Tue 17 Nov 26");
        fireEvent.keyDown(segments()[2]!, { key: "Tab" });
        await flush();
        expect(draft("j2", Sheet.Types.Draft(JobType)).start).toEqual(variant("value", some(new Date("2026-11-17T00:00:00Z"))));
        expect(cell(1, "start").textContent).toBe("17 Nov 26");
        // Tab on the last segment moved right, onto the task column.
        expect(cell(1, "task").hasAttribute("data-selected")).toBe(true);
        // An unparseable quantity stays local as raw draft text.
        fireEvent.mouseDown(cell(1, "qty"), { button: 0 });
        key("z");
        await flush();
        type("zz");
        await flush();
        editorKey("Enter");
        expect(input()).toBeNull();
        await flush();
        expect(edits).toHaveLength(2);
        expect(draft("j2", Sheet.Types.Draft(JobType)).qty).toEqual(variant("invalid", "zz"));
        expect(edits[1]!.domainChanges.type).toBe("none");
        expect(cell(1, "qty").getAttribute("aria-invalid")).toBe("true");
        const description = document.getElementById(cell(1, "qty").getAttribute("aria-describedby")!);
        expect(description?.textContent).toBe("Invalid input: zz");
        key("z", { ctrlKey: true });
        await flush();
        expect(draft("j2", Sheet.Types.Draft(JobType)).qty).toEqual(variant("value", none));
        expect(cell(1, "qty").hasAttribute("aria-invalid")).toBe(false);
        expect(edits[2]!.origin.type).toBe("undo");
    });

    test("the number field opens on the value, ↑ steps it through the field's own handler, ⏎ commits", async () => {
        const { value, edits } = withSpies(buildSheet());
        const { container, cell, key, editorKey, input, flush } = mount(value);
        fireEvent.mouseDown(cell(0, "qty"), { button: 0 });
        key("Enter");
        await flush();
        expect(container.querySelector('[data-slot="editorNumber"]')).toBeTruthy();
        expect(container.querySelector('[data-slot="editorStepper"]')).toBeTruthy();
        expect(input()!.value).toBe("1200");
        fireEvent.keyDown(input()!, { key: "ArrowUp" });
        await flush();
        // The field's own step reached the buffer (the strip previews it); the
        // input's text follows on Zag's next frame, which jsdom never paints.
        expect(container.querySelector('[data-slot="stripChip"]')!.textContent).toBe("1,201");
        editorKey("Enter");
        await flush();
        expect(edits).toHaveLength(1);
        expect(cell(0, "qty").textContent).toBe("1,201");
        expect(cell(1, "qty").hasAttribute("data-selected")).toBe(true);
    });

    test("an enum resolves to the register's word through the strip's armed candidate", async () => {
        const { value, edits, draft } = withSpies(buildSheet());
        const { container, cell, key, type, editorKey, flush } = mount(value);
        fireEvent.mouseDown(cell(1, "status"), { button: 0 });
        key("c");
        type("can");
        expect(container.querySelector('[data-slot="stripChip"][data-armed]')!.textContent).toBe("CANCELLED");
        editorKey("Enter");
        await flush();
        expect(draft("j2", Sheet.Types.Draft(JobType)).status).toEqual(variant("value", "CANCELLED"));
        expect(container.querySelector('[data-row-id="j2"] [data-key="status"] [data-tone="danger"]')).toBeTruthy();
    });

    test("typing into a blank row inserts a real row after the last one, the ring follows it", async () => {
        const { value, edits, draft } = withSpies(buildSheet());
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
        const change = edits[0]!.draftChanges[0]!;
        expect(change.id).toMatch(/^sheet-/);
        expect(change.place).toEqual(some(variant("ordered", variant("after", "j2"))));
        const inserted = draft(change.id, Sheet.Types.Draft(JobType));
        expect(inserted.task).toEqual(variant("value", "New job"));
        expect(inserted.qty.type).toBe("missing");
        expect(inserted.code.type).toBe("missing");
        expect(edits[0]!.domainChanges.type).toBe("none");
    });

    test("⌫ clears the selected cells but never a stamped one; whole rows selected ⌫ removes them", async () => {
        const { value, edits, draft } = withSpies(buildSheet());
        const { cell, key, rows, flush } = mount(value);
        fireEvent.mouseDown(cell(0, "qty"), { button: 0 });
        fireEvent.mouseDown(cell(0, "code"), { button: 0, shiftKey: true });
        key("Delete");
        await flush();
        expect(edits).toHaveLength(1);
        expect(draft("j1", Sheet.Types.Draft(JobType)).qty.type).toBe("missing");
        expect(cell(0, "qty").textContent).toBe("");
        expect(cell(0, "code").textContent).toBe("WO-26001");
        fireEvent.mouseDown(rows()[1]!.querySelector('[data-slot="gutter"]')!, { button: 0 });
        key("Backspace");
        await flush();
        expect(edits[1]!.origin.type).toBe("remove");
        expect(edits[1]!.draftChanges.map(change => change.id)).toEqual(["j2"]);
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
        expect(selects.at(-1)).toEqual({ rowId: some("j1"), line: none, key: some("task") });
    });
});

describe("the clipboard", () => {
    test("copy is tab-separated with the kinds' clipboard forms; paste lands at the ring and parses by kind", async () => {
        const { value, edits, draft } = withSpies(buildSheet());
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
        expect(edits).toHaveLength(1);
        expect(edits[0]!.draftChanges).toHaveLength(1);
        const pasted = draft("j2", Sheet.Types.Draft(JobType));
        expect(pasted.task).toEqual(variant("value", "Pasted"));
        expect(pasted.qty).toEqual(variant("value", some(18000)));
        expect(cell(1, "start").textContent).toBe("17 Nov 26");
        expect(cell(1, "qty").textContent).toBe("18,000");
        expect(edits[0]!.origin.type).toBe("pasted");
        expect(container.querySelectorAll('[data-slot="rangeWash"]')).toHaveLength(3);
    });
});

describe("numbers in the viewer's language (#852)", () => {
    test("German: a quantity shows 1.234,5, the edit box opens on 1234,5, ⏎ leaves it as it was, and copy writes 1234,5", async () => {
        const { value, edits } = withSpies(buildSheet({ rows: ROWS_FRACTION }));
        const { container, card, cell, key, editorKey, input, flush } = mount(value, "de-DE");
        expect(cell(0, "qty").textContent).toBe("1.234,5");
        fireEvent.mouseDown(cell(0, "qty"), { button: 0 });
        key("Enter");
        await flush();
        expect(input()!.value).toBe("1234,5");
        editorKey("Enter");
        await flush();
        expect(input()).toBeNull();
        expect(cell(1, "qty").hasAttribute("data-selected")).toBe(true);
        expect(edits).toHaveLength(0);
        expect(cell(0, "qty").textContent).toBe("1.234,5");
        // Copy: the bare form a German spreadsheet reads as 1234.5.
        fireEvent.mouseDown(cell(0, "qty"), { button: 0 });
        const set = new Map<string, string>();
        fireEvent.copy(card, { clipboardData: { setData: (k: string, v: string) => set.set(k, v), getData: () => "" } });
        expect(set.get("text/plain")).toBe("1234,5");
        expect(container.querySelector('[data-slot="footerMessage"]')!.textContent).toBe("Copied 1×1 to clipboard");
    });

    test("German: typing 1.234 saves 1234, 1.234,5 saves 1235 (the whole-number rule), 1,5k saves 1500; a paste reads the same", async () => {
        const { value, draft } = withSpies(buildSheet({ rows: ROWS_FRACTION }));
        const { card, cell, key, type, editorKey, flush } = mount(value, "de-DE");
        for (const [text, n] of [["1.234", 1234], ["1.234,5", 1235], ["1,5k", 1500]] as const) {
            fireEvent.mouseDown(cell(1, "qty"), { button: 0 });
            key("1");
            await flush();
            type(text);
            await flush();
            editorKey("Enter");
            await flush();
            expect(draft("j2", Sheet.Types.Draft(JobType)).qty).toEqual(variant("value", some(n)));
        }
        expect(cell(1, "qty").textContent).toBe("1.500");
        fireEvent.mouseDown(cell(1, "qty"), { button: 0 });
        fireEvent.paste(card, { clipboardData: { getData: () => "2.345,5" } });
        await flush();
        expect(draft("j2", Sheet.Types.Draft(JobType)).qty).toEqual(variant("value", some(2346)));
        expect(cell(1, "qty").textContent).toBe("2.346");
    });

    test("English: the cell and the edit box are as they always were, and ⏎ on the unchanged box leaves 1234.5 as it was", async () => {
        const { value, edits } = withSpies(buildSheet({ rows: ROWS_FRACTION }));
        const { cell, key, editorKey, input, flush } = mount(value, "en-US");
        expect(cell(0, "qty").textContent).toBe("1,234.5");
        fireEvent.mouseDown(cell(0, "qty"), { button: 0 });
        key("Enter");
        await flush();
        expect(input()!.value).toBe("1234.5");
        editorKey("Enter");
        await flush();
        expect(input()).toBeNull();
        expect(edits).toHaveLength(0);
        expect(cell(0, "qty").textContent).toBe("1,234.5");
    });

    test("a value with more digits than the number field shows opens rounded in the box, and ⏎ or a blur leaves it as it was", async () => {
        const { value, edits } = withSpies(buildSheet({ rows: ROWS_NOISE }));
        const { cell, key, editorKey, input, flush } = mount(value, "de-DE");
        fireEvent.mouseDown(cell(0, "qty"), { button: 0 });
        key("Enter");
        await flush();
        expect(input()!.value).toBe("0,3");
        editorKey("Enter");
        await flush();
        expect(input()).toBeNull();
        expect(edits).toHaveLength(0);
        // A blur (past the grace after opening) commits the same way.
        fireEvent.mouseDown(cell(0, "qty"), { button: 0 });
        key("Enter");
        await flush();
        const later = Date.now() + 1_000;
        const clock = vi.spyOn(Date, "now").mockReturnValue(later);
        try {
            fireEvent.blur(input()!);
        } finally {
            clock.mockRestore();
        }
        await flush();
        expect(input()).toBeNull();
        expect(edits).toHaveLength(0);
    });
});

describe("the paged arm (§3.13)", () => {
    test("a REAL Paged.of source: windows land, the tail band describes the rest, the transport line counts elements, no blanks until exhaustion", async () => {
        const restore = emulateWindowScroll();
        try {
            const { container, rows } = mount(buildPaged(1_000));
            const transport = () => container.querySelector('[data-slot="footerTransport"]')!.textContent;
            await waitFor(() => expect(transport()).toBe("600 loaded of 1,000"), { timeout: 15_000 });
            expect(container.querySelector('[data-slot="toolbarBadge"]')!.textContent).toBe("loaded rows only");
            expect(container.querySelector('[data-row-id="p0"] [data-key="task"]')!.textContent).toBe("Task 0");
            // With no height, the sheet mounts a screenful of its 600 rows (#856)…
            expect(container.querySelector('[data-virtual-rows="ancestor"]')).toBeTruthy();
            expect(rows().length).toBeLessThan(40);
            // …and down at the last of them, the tail band follows it: no blank rows before exhaustion.
            const rowPx = parseFloat(container.querySelector<HTMLElement>('[data-row-id="p0"]')!.style.minHeight);
            act(() => { window.scrollTo({ top: 600 * rowPx - window.innerHeight / 2 }); });
            expect(container.querySelector('[data-row-id="p599"]')).toBeTruthy();
            const band = container.querySelector('[data-slot="band"][data-band="tail"]');
            expect(band).toBeTruthy();
            expect(band!.getAttribute("data-elements")).toBe("400");
            expect(container.querySelectorAll('[data-slot="row"][data-blank]')).toHaveLength(0);
        } finally {
            restore();
        }
    }, 30_000);

    test("an exhausted immutable source shows its rows but has no editing capability", async () => {
        const restore = emulateWindowScroll();
        try {
            const { container, key, input } = mount(buildPaged(450));
            await waitFor(() => expect(container.querySelector('[data-slot="footerTransport"]')!.textContent).toBe("450 loaded of 450"), { timeout: 15_000 });
            // Down at the end of the sheet: the blank padding follows the last row.
            const rowPx = parseFloat(container.querySelector<HTMLElement>('[data-row-id="p0"]')!.style.minHeight);
            act(() => { window.scrollTo({ top: 452 * rowPx - window.innerHeight / 2 }); });
            expect(container.querySelectorAll('[data-slot="row"][data-blank]')).toHaveLength(2);
            fireEvent.mouseDown(container.querySelector('[data-row-id="p449"] [data-key="qty"]')!, { button: 0 });
            key("4");
            expect(input()).toBeNull();
            expect(container.querySelector('[data-slot="history"]')).toBeNull();
        } finally {
            restore();
        }
    }, 30_000);
});

describe("an unbounded sheet mounts a screenful (#856)", () => {
    // Compiled once each: their rows are a constant of the program. The ring's and the seams' tests
    // take 600 rows, past the threshold, since every row's draft checks run on an editable sheet.
    let many: SheetRootValue | undefined;
    const manySheet = (): SheetRootValue => (many ??= buildSheet({ rows: MANY }));
    let past: SheetRootValue | undefined;
    const pastSheet = (): SheetRootValue => (past ??= buildSheet({ rows: MANY.slice(0, 600) }));

    test("5,000 rows with no height: a screenful is mounted, and the page's scroll mounts the rows coming into view; below the threshold every row renders in flow, as before", () => {
        const restore = emulateWindowScroll();
        try {
            const { container, rows, unmount } = mount(manySheet());
            expect(container.querySelector('[data-virtual-rows="ancestor"]')).toBeTruthy();
            const rowPx = parseFloat(rows()[0]!.style.minHeight);
            // jsdom's page is 768 px tall: a screenful, and four rows of overscan below it.
            expect(rows().length).toBeGreaterThan(10);
            expect(rows().length).toBeLessThanOrEqual(Math.ceil(window.innerHeight / rowPx) + 4 + 1);
            // The rows' extent is every row, the three blank rows with them.
            expect(Number(container.querySelector("[data-virtual-extent]")!.getAttribute("data-virtual-extent"))).toBe(5_003 * rowPx);
            act(() => { window.scrollTo({ top: 2_500 * rowPx }); });
            expect(container.querySelector('[data-row-id="m2500"]')).toBeTruthy();
            expect(container.querySelector('[data-row-id="m0"]')).toBeNull();
            expect(rows().length).toBeLessThanOrEqual(Math.ceil(window.innerHeight / rowPx) + 2 * 4 + 1);
            unmount();
            const small = mount(buildSheet({ rows: MANY.slice(0, 390) }));
            expect(small.container.querySelector("[data-virtual-rows]")).toBeNull();
            expect(small.container.querySelector('[data-slot="virtualRow"]')).toBeNull();
            expect(small.rows()).toHaveLength(393);
        } finally {
            restore();
        }
    }, 30_000);

    test("the ring walked past the page's edge scrolls the page to it, and an edit there commits as anywhere", async () => {
        const restore = emulateWindowScroll();
        try {
            const { value, draft } = withSpies(pastSheet());
            const { container, cell, key, type, editorKey, flush } = mount(value);
            const rowPx = parseFloat(container.querySelector<HTMLElement>('[data-row-id="m0"]')!.style.minHeight);
            fireEvent.mouseDown(cell(0, "task"), { button: 0 });
            for (let i = 0; i < 30; i++) key("ArrowDown");
            await flush();
            const row = container.querySelector('[data-row-id="m30"]')!;
            expect(row.querySelector('[data-key="task"]')!.hasAttribute("data-selected")).toBe(true);
            // Row 31 is in view: the page scrolled down to it.
            const top = offsetOf(row);
            expect(window.scrollY).toBeGreaterThan(0);
            expect(top).toBeGreaterThanOrEqual(window.scrollY);
            expect(top + rowPx).toBeLessThanOrEqual(window.scrollY + window.innerHeight);
            key("x");
            type("Moved");
            editorKey("Enter");
            await flush();
            expect(draft("m30", Sheet.Types.Draft(JobType)).task).toEqual(variant("value", "Moved"));
        } finally {
            restore();
        }
    }, 30_000);

    test("an insertion seam's chips go when the page scrolls the rows from under them", () => {
        const restore = emulateWindowScroll();
        try {
            const { container, rows } = mount(withSpies(pastSheet()).value);
            fireEvent.mouseEnter(rows()[3]!.querySelector('[data-slot="insertPoint"]')!);
            expect(container.querySelector('[data-slot="insertLayer"]')).toBeTruthy();
            act(() => { window.scrollTo({ top: 100 }); });
            expect(container.querySelector('[data-slot="insertLayer"]')).toBeNull();
        } finally {
            restore();
        }
    }, 30_000);
});

// ── Failure is local (#853) ─────────────────────────────────────────────────

/** The held source's jobs: `r000`, `r001`, … `r7999`; `code` has no column. */
const HELD_JOBS: ValueTypeOf<typeof JobType>[] = Array.from({ length: 8_000 }, (_, i) => ({
    id: `r${String(i).padStart(3, "0")}`, start: none, task: `Task ${i}`, qty: none, code: `C${i}`, status: "",
}));
/** The State key a held source's reads track: a write to it is the source's channel saying something moved. */
const HELD_KEY = "sheet-held-source";
const encodeMove = encodeBeast2For(IntegerType);
const HeldSource = Paged.Types.Source(ArrayType(JobType));
/**
 * The held Sheet, built by its own factory over the source it is called
 * with. Two author callbacks read the `code` of the row above, which has no
 * column, so it reaches them only through that row's own source entry: the
 * `status` column's fill proposes it, and the row's readiness check wants it.
 */
const heldProgram = East.function([HeldSource], UIComponentType, ($, held) => {
    const Context = Sheet.Types.Context(JobType);
    const StringFill = OptionType(Sheet.Types.Fill(StringType));
    const Ready = Sheet.Types.Readiness;
    const codeAbove = $.const(East.function([Context], StringFill, ($2, ctx) => {
        const noFill = $2.const(none, StringFill);
        return ctx.rowIndex.greater(0n).ifElse(
            (_$3) => ctx.rows.get(ctx.rowIndex.subtract(1n)).code.match({
                value: ($4, code) => $4.const(some({ value: code, meta: "the code above" }), StringFill),
            }, (_$4) => noFill),
            (_$3) => noFill,
        );
    }));
    const codeAboveKept = $.const(East.function([Sheet.Types.Draft(JobType), Sheet.Types.DraftContext(JobType)], Ready, ($2, _row, ctx) => {
        const ready = $2.const(variant("ready", null), Ready);
        const lost = $2.const(variant("incomplete", [{ field: "code", message: "The row above has no code" }]), Ready);
        return ctx.rowIndex.greater(0n).ifElse(
            (_$3) => ctx.rows.get(ctx.rowIndex.subtract(1n)).code.hasTag("value").ifElse((_$4) => ready, (_$4) => lost),
            (_$3) => ready,
        );
    }));
    return Sheet.Root(held, {
        task: Sheet.column.text(JobType, { header: "Task" }),
        qty: Sheet.column.quantity(JobType, { header: "Qty" }),
        status: Sheet.column.text(JobType, { header: "Status", fill: [codeAbove] }),
    }, {
        id: "id", blanks: 2, ready: { row: codeAboveKept },
        onApply: East.function([Sheet.Types.ChangeSet(JobType)], Sheet.Types.ApplyResult, () => variant("conflict", [])),
    });
});

/** A wire row that throws as it is drawn — its `owned`, which only the row's own render reads, throws. */
function brokenRow(row: SheetRowValue): SheetRowValue {
    return Object.defineProperty({ ...row }, "owned", { enumerable: true, get: () => { throw new Error("bad row"); } });
}

/**
 * A held paged source (#853): `n` jobs served a window at a time, while the
 * test decides what the source does — which windows are in flight or throw,
 * whether it is down, whether its count or a single entry's read (the
 * read-back after an Apply) throws, which row the renderer is handed broken.
 * The Sheet is built by its own factory over it, so the projection, the base
 * reads and every author context read through it. Every read tracks
 * {@link HELD_KEY}, so `touch` reaches the reads that saw the source, as a
 * real source's channel does; an Apply writes the jobs and moves the
 * revision, as a real write does.
 */
function heldSheet(n: number) {
    const state = {
        revision: 1,
        down: undefined as string | undefined,
        /** The source has not counted itself yet: `total()` answers none (#860). */
        uncounted: false,
        totalError: undefined as string | undefined,
        entryError: undefined as string | undefined,
        failing: new Map<number, string>(),
        inFlight: new Set<number>(),
        broken: undefined as string | undefined,
        /** What happens to the source once an Apply's batch is written. */
        afterApply: undefined as (() => void) | undefined,
        refreshes: 0,
        /** The window of every page read. */
        asked: [] as number[],
    };
    let jobs = HELD_JOBS.slice(0, n);
    let moves = 0n;
    const move = (): void => { getStore().write(HELD_KEY, encodeMove(++moves)); };
    const read = (): void => {
        trackKey(HELD_KEY);
        if (state.down !== undefined) throw new Error(state.down);
    };
    const source: ValueTypeOf<typeof HeldSource> = {
        id: "sheet_held",
        page: (offset, limit) => {
            read();
            const w = Math.floor(Number(offset) / SHEET_PAGE_SIZE);
            state.asked.push(w);
            if (limit === 1n && state.entryError !== undefined) throw new Error(state.entryError);
            const failure = state.failing.get(w);
            if (failure !== undefined) throw new Error(failure);
            if (state.inFlight.has(w)) return none;
            return some(jobs.slice(Number(offset), Number(offset + limit)));
        },
        total: () => {
            read();
            if (state.totalError !== undefined) throw new Error(state.totalError);
            return state.uncounted ? none : some(BigInt(jobs.length));
        },
        // A key search over the ids (#854): the first match of a whole key or a prefix, and how many there are.
        seek: some((query: ValueTypeOf<typeof Paged.Types.SeekQuery>) => {
            read();
            const exact = query.type === "key";
            const text = query.type === "prefix" ? query.value : query.type === "key" ? JSON.parse(query.value) as string : "";
            let row = -1;
            let count = 0;
            jobs.forEach((job, i) => {
                if (exact ? job.id !== text : !job.id.startsWith(text)) return;
                if (row < 0) row = i;
                count += 1;
            });
            return some({ found: count > 0, row: BigInt(Math.max(0, row)), count: BigInt(count) });
        }),
        revision: () => { read(); return some(`rev-${state.revision}`); },
        refresh: () => { state.refreshes += 1; move(); return null; },
    };
    const applyBatch = East.compile(Sheet.apply(JobType, "id"), []);
    const decodeBatch = decodeBeast2For(Sheet.Types.ChangeSet(JobType));
    const apply = (payload: Uint8Array) => {
        const applied = applyBatch(jobs, decodeBatch(payload), some(`rev-${state.revision}`));
        if (applied.type === "conflict") return variant("conflict", applied.value);
        jobs = applied.value;
        state.revision += 1;
        state.afterApply?.();
        move();
        return variant("applied", { revision: some(`rev-${state.revision}`) });
    };
    const built = East.compile(heldProgram, getRegisteredPlatformImplementations())(source) as ValueTypeOf<typeof UIComponentType>;
    if (built.type !== "Sheet" || built.value.rows.type !== "paged") throw new Error("Expected a paged Sheet");
    const root = built.value;
    const served = built.value.rows.value;
    const value = {
        ...root,
        // The renderer is handed the broken row as it draws it; the factory's own reads see it whole.
        rows: variant("paged", { ...served, page: (offset: bigint, limit: bigint) => {
            const window = served.page(offset, limit);
            return window.type === "some" ? some(window.value.map((row) => (row.id === state.broken ? brokenRow(row) : row))) : window;
        } }),
        editing: { ...root.editing, onApply: some(variant("sync", apply)) },
    } as SheetRootValue;
    /** Another planner changes the jobs: the source serves them at a new revision (#877). */
    const rewrite = (next: (rows: ValueTypeOf<typeof JobType>[]) => ValueTypeOf<typeof JobType>[]) => act(() => {
        jobs = next(jobs);
        state.revision += 1;
        move();
    });
    return { value, state, touch: () => act(() => { move(); }), rewrite };
}

/**
 * The hang guard of a test over the held sheet. Such a test once drew every
 * resident row — about 800 once a jump had landed — on every gesture, and took
 * up to 31 s on the CI runners, most for the first such test in the file,
 * which warms up what the rest reuse. The sheet now mounts a screenful of
 * them (#856), and a gesture will re-render only the rows it touches (#858).
 * The guard stays at twice the old worst case, so only a hang trips it.
 */
const HELD_TEST_MS = 60_000;

/** Type a key into the toolbar's key search, a keystroke at a time, and jump to its match with ⏎. */
async function seekKey(container: HTMLElement, key: string): Promise<void> {
    const search = container.querySelector('[data-part="dataset-key-search"]')!;
    const input = search.querySelector("input") as HTMLInputElement;
    for (const ch of key) {
        const typed = input.value + ch;
        await userEvent.type(input, ch);
        await waitFor(() => expect(input.value).toBe(typed));
    }
    await waitFor(() => expect(search.textContent).toMatch(/1 match/), { timeout: 5_000 });
    fireEvent.keyDown(input, { key: "Enter" });
}

describe("a key-search jump owns the viewport (#854)", () => {
    test("a report from the old place before the target lands does not undo the jump; once it lands the ring is on the sought row and the view shows it", async () => {
        const restore = emulateWindowScroll();
        try {
            const held = heldSheet(8_000);
            // Element 6,000's window stays on the wire until the test releases it.
            held.state.inFlight.add(30);
            const { container, flush } = mount(held.value);
            await waitFor(() => expect(container.querySelector('[data-row-id="r000"]')).toBeTruthy(), { timeout: 15_000 });
            await seekKey(container, "r6000");
            // The run moved to the target: a head band covers where the sheet was.
            await waitFor(() => expect(container.querySelector('[data-row-id="r000"]')).toBeNull(), { timeout: 10_000 });
            // A report from where the sheet still is — the top, over the head band.
            act(() => { window.dispatchEvent(new Event("scroll")); });
            await flush();
            // The window lands: the ring is on the sought row, and the page scrolled to it.
            held.state.inFlight.delete(30);
            held.touch();
            const cell = () => container.querySelector('[data-row-id="r6000"] [data-key="task"]');
            await waitFor(() => expect(cell()?.hasAttribute("data-selected")).toBe(true), { timeout: 10_000 });
            const row = container.querySelector('[data-row-id="r6000"]') as HTMLElement;
            await waitFor(() => expect(window.scrollY).toBeGreaterThan(0));
            const top = offsetOf(row);
            expect(window.scrollY).toBeLessThanOrEqual(top);
            expect(top + parseFloat(row.style.minHeight)).toBeLessThanOrEqual(window.scrollY + window.innerHeight);
            // The jump handed the viewport back: the reports from there keep the run where the ring is. Back at
            // the top of the page, before the sheet pages there, the head band still stands for the rows it left.
            await flush();
            expect(cell()?.hasAttribute("data-selected")).toBe(true);
            act(() => { window.scrollTo({ top: 0 }); });
            expect(container.querySelector('[data-slot="band"][data-band="head"]')).toBeTruthy();
            expect(container.querySelector('[data-row-id="r000"]')).toBeNull();
        } finally {
            restore();
        }
    }, HELD_TEST_MS);

    test("clearing the search before the target lands drops the jump: the sheet pages where it is scrolled again", async () => {
        const restore = emulateWindowScroll();
        try {
            const held = heldSheet(8_000);
            held.state.inFlight.add(30);
            const { container } = mount(held.value);
            await waitFor(() => expect(container.querySelector('[data-row-id="r000"]')).toBeTruthy(), { timeout: 15_000 });
            const rowPx = parseFloat((container.querySelector('[data-row-id="r000"]') as HTMLElement).style.minHeight);
            await seekKey(container, "r6000");
            await waitFor(() => expect(container.querySelector('[data-row-id="r000"]')).toBeNull(), { timeout: 10_000 });
            // Element 6,000's window is still on the wire when the search is cleared.
            fireEvent.click(within(container).getByRole("button", { name: "Clear search" }));
            act(() => { window.scrollTo({ top: 2_000 }); });
            // The rows the page shows there land (the sheet mounts only those, #856).
            const shown = `r${String(Math.floor(2_000 / rowPx)).padStart(3, "0")}`;
            await waitFor(() => expect(container.querySelector(`[data-row-id="${shown}"]`)).toBeTruthy(), { timeout: 10_000 });
        } finally {
            restore();
        }
    }, HELD_TEST_MS);
});

describe("a window loading above the rows never hides them (#876)", () => {
    test("scrolling up into a window still loading keeps the rows on screen; landing, its rows join above in its place, and an open editor stays on its row", async () => {
        const restore = emulateWindowScroll();
        try {
            const held = heldSheet(8_000);
            const { container, key, input, flush } = mount(held.value);
            await waitFor(() => expect(container.querySelector('[data-row-id="r000"]')).toBeTruthy(), { timeout: 15_000 });
            const read = held.state.asked.length;
            await seekKey(container, "r6000");
            await waitFor(() => expect(container.querySelector('[data-row-id="r6000"] [data-key="task"]')?.hasAttribute("data-selected")).toBe(true), { timeout: 10_000 });
            await flush();
            // The run around the sought row starts at the first window the jump read. The window above the
            // run stays on the wire; the one above THAT lands at once.
            const first = Math.min(...held.state.asked.slice(read)) * SHEET_PAGE_SIZE;
            const above = first / SHEET_PAGE_SIZE - 1;
            held.state.inFlight.add(above);
            const rowOf = (n: number) => container.querySelector(`[data-row-id="r${n}"]`) as HTMLElement | null;
            const loaded = () => Number(container.querySelector('[data-slot="footerTransport"]')!.textContent!.split(" ")[0]!.replace(/,/g, ""));
            const run = loaded();
            // Scroll up: the view is centred five rows above the run, in the held window's slot. The sheet
            // mounts what the page shows (#856), so where the run starts is laid out from the sought row.
            const sought = rowOf(6000)!;
            const rowPx = parseFloat(sought.style.minHeight);
            const firstTop = offsetOf(sought) - (6000 - first) * rowPx;
            act(() => { window.scrollTo({ top: firstTop - 5 * rowPx - window.innerHeight / 2 }); });
            await waitFor(() => expect(held.state.asked).toContain(above - 1), { timeout: 10_000 });
            await flush();
            // The run's first rows stay on screen, where they were; the held window's slot stays a band, and
            // the window above it waits until it lands.
            expect(offsetOf(rowOf(first)!)).toBe(firstTop);
            expect(rowOf(first - 1)).toBeNull();
            expect(loaded()).toBe(run);
            // An editor opens on a row near the run's top.
            const row = () => rowOf(first + 2)!;
            const cell = () => row().querySelector('[data-key="task"]') as HTMLElement;
            fireEvent.mouseDown(cell(), { button: 0 });
            key("Enter");
            await flush();
            expect(input()!.value).toBe(`Task ${first + 2}`);
            const top = offsetOf(row());
            // The held window lands: its rows and the ones above it join above, in the band's place, and the
            // row and its editor stay where they were.
            held.state.inFlight.delete(above);
            held.touch();
            await waitFor(() => expect(rowOf(first - 1)).toBeTruthy(), { timeout: 10_000 });
            expect(rowOf(first - 5)).toBeTruthy();
            expect(loaded()).toBe(run + 2 * SHEET_PAGE_SIZE);
            expect(offsetOf(row())).toBe(top);
            expect(cell().querySelector('[data-slot="editorInput"]')).toBe(input());
            expect(input()!.value).toBe(`Task ${first + 2}`);
        } finally {
            restore();
        }
    }, HELD_TEST_MS);

    test("a jump whose target lands before the window above it shows the target at once; landing, that window's rows join above and the row stays where it was shown, through the frames after (#885)", async () => {
        const restore = emulateWindowScroll();
        // From the jump on the frames are the test's: window 29 lands before the frame in which TanStack
        // reconciles the jump's scroll, whatever the machine's load (#885).
        let frames: ReturnType<typeof holdFrames> | undefined;
        try {
            const held = heldSheet(8_000);
            // Window 29, above element 6,000's, stays on the wire.
            held.state.inFlight.add(29);
            const { container } = mount(held.value);
            await waitFor(() => expect(container.querySelector('[data-row-id="r000"]')).toBeTruthy(), { timeout: 15_000 });
            frames = holdFrames();
            await seekKey(container, "r6000");
            const cell = () => container.querySelector('[data-row-id="r6000"] [data-key="task"]');
            await waitFor(() => expect(cell()?.hasAttribute("data-selected")).toBe(true), { timeout: 10_000 });
            // Window 29's last row, right above the target, is not there yet.
            expect(container.querySelector('[data-row-id="r5999"]')).toBeNull();
            const row = container.querySelector('[data-row-id="r6000"]') as HTMLElement;
            await waitFor(() => expect(window.scrollY).toBeGreaterThan(0));
            const top = offsetOf(row);
            const y = window.scrollY;
            expect(y).toBeLessThanOrEqual(top);
            expect(top + parseFloat(row.style.minHeight)).toBeLessThanOrEqual(y + window.innerHeight);
            held.state.inFlight.delete(29);
            held.touch();
            await waitFor(() => expect(container.querySelector('[data-row-id="r5999"]')).toBeTruthy(), { timeout: 10_000 });
            const shown = () => container.querySelector('[data-row-id="r6000"]');
            expect(shown()).not.toBeNull();
            expect(offsetOf(shown()!)).toBe(top);
            // The frames come: the page stays where the jump put it, and the row where it was shown.
            act(() => { frames!.run(); });
            expect(window.scrollY).toBe(y);
            expect(shown()).not.toBeNull();
            expect(offsetOf(shown()!)).toBe(top);
            expect(cell()?.hasAttribute("data-selected")).toBe(true);
        } finally {
            frames?.restore();
            restore();
        }
    }, HELD_TEST_MS);
});

describe("an editor whose row leaves the sheet (#877)", () => {
    const LEFT = "The edited row left the sheet — its edit was not kept";

    test("a new revision without the edited row closes its editor: nothing is written to the row that took its place, and the footer says why", async () => {
        const held = heldSheet(20);
        const { value, edits } = withSpies(held.value);
        const { container, cell, key, type, input, flush } = mount(value);
        await waitFor(() => expect(container.querySelectorAll('[data-slot="row"][data-blank]')).toHaveLength(2));
        fireEvent.mouseDown(cell(5, "task"), { button: 0 });
        key("x");
        type("Typed");
        await flush();
        expect(input()!.value).toBe("Typed");
        // Another planner deletes r005: the rows below move up into its place.
        held.rewrite((rows) => rows.filter((row) => row.id !== "r005"));
        await waitFor(() => expect(container.querySelector('[data-row-id="r005"]')).toBeNull());
        await flush();
        expect(input()).toBeNull();
        expect(container.querySelector('[data-slot="footerMessage"]')!.textContent).toBe(LEFT);
        expect(cell(5, "task").textContent).toBe("Task 6");
        expect(edits).toHaveLength(0);
    });

    test("an editor typing a new row into the padding stays in the padding when another planner's row joins above it", async () => {
        const held = heldSheet(20);
        const { value } = withSpies(held.value);
        const { container, rows, cell, key, type, input, flush } = mount(value);
        await waitFor(() => expect(container.querySelectorAll('[data-slot="row"][data-blank]')).toHaveLength(2));
        fireEvent.mouseDown(cell(20, "task"), { button: 0 });
        key("N");
        type("New job");
        await flush();
        // Another planner's row joins at the end: the padding moves down one.
        held.rewrite((jobs) => [...jobs, HELD_JOBS[20]!]);
        await waitFor(() => expect(container.querySelector('[data-row-id="r020"]')).toBeTruthy());
        await flush();
        expect(rows()[21]!.hasAttribute("data-blank")).toBe(true);
        expect(cell(21, "task").querySelector('[data-slot="editorInput"]')).toBe(input());
        expect(input()!.value).toBe("New job");
        expect(cell(20, "task").textContent).toBe("Task 20");
    });

    test("on the inline arm, a host write-back without the edited row closes its editor", async () => {
        const { value, edits } = withSpies(buildSheet());
        const { container, cell, key, type, input, flush, rerender } = mount(value);
        fireEvent.mouseDown(cell(1, "task"), { button: 0 });
        key("x");
        type("Typed");
        await flush();
        expect(input()!.value).toBe("Typed");
        // The host drops j2 — another control, a sync — and writes the rows back.
        const next = withSpies(buildSheet({ rows: [ROWS[0]!] })).value;
        rerender(<ChakraProvider value={system}><EastChakraSheet value={next} storageKey="sheet-test" /></ChakraProvider>);
        await flush();
        expect(container.querySelector('[data-row-id="j2"]')).toBeNull();
        expect(input()).toBeNull();
        expect(container.querySelector('[data-slot="footerMessage"]')!.textContent).toBe(LEFT);
        expect(edits).toHaveLength(0);
    });
});

describe("failure is local (#853)", () => {
    test("a window that cannot be read is its own band with the reason and a Retry; the rows around it, the ring, the open editor and the drafts stay; Retry lands it once the source is back", async () => {
        const restore = emulateWindowScroll();
        const logged = vi.spyOn(console, "error").mockImplementation(() => {});
        try {
            const held = heldSheet(410);
            held.state.inFlight.add(1);
            const { value, draft } = withSpies(held.value);
            const { container, cell, key, type, editorKey, input, flush } = mount(value);
            await waitFor(() => expect(container.querySelector('[data-row-id="r199"]')).toBeTruthy(), { timeout: 15_000 });
            // Window 1 is on the wire: the run stops there, window 2 waits behind it.
            expect(container.querySelector('[data-row-id="r400"]')).toBeNull();
            // The planner works: a draft on the first row, an editor open on the sixth.
            fireEvent.mouseDown(cell(0, "task"), { button: 0 });
            key("x");
            type("Edited");
            editorKey("Enter");
            await flush();
            fireEvent.mouseDown(cell(5, "task"), { button: 0 });
            key("Enter");
            await flush();
            expect(input()!.value).toBe("Task 5");
            // Window 1's read throws.
            held.state.inFlight.delete(1);
            held.state.failing.set(1, "gateway timeout");
            held.touch();
            await waitFor(() => expect(container.querySelector('[data-band="failed"]')).toBeTruthy());
            const band = container.querySelector('[data-band="failed"]')!;
            expect(band.getAttribute("data-elements")).toBe("200");
            expect(band.querySelector('[role="alert"]')!.textContent).toBe("Elements 201–400 could not be read — gateway timeout");
            expect(band.querySelector('[data-slot="retry"]')!.textContent).toBe("Retry");
            // Windows 0 and 2 draw around it; a row after it keeps its number.
            expect(container.querySelector('[data-row-id="r000"]')).toBeTruthy();
            expect(container.querySelector('[data-row-id="r200"]')).toBeNull();
            expect(container.querySelector('[data-row-id="r400"] [data-slot="gutterNumber"]')!.textContent).toBe("401");
            expect(container.querySelector("[data-sheet-error]")).toBeNull();
            // The open editor, where the ring is, and the draft are as they were.
            expect(cell(5, "task").querySelector('[data-slot="editorInput"]')).toBe(input());
            expect(input()!.value).toBe("Task 5");
            expect(cell(0, "task").textContent).toBe("Edited");
            expect(draft("r000", Sheet.Types.Draft(JobType)).task).toEqual(variant("value", "Edited"));
            // The source recovers and says so: the reader does not ask the failed window again by itself.
            const asks = held.state.asked.filter((w) => w === 1).length;
            held.state.failing.delete(1);
            held.touch();
            expect(held.state.asked.filter((w) => w === 1)).toHaveLength(asks);
            expect(container.querySelector('[data-band="failed"]')).toBeTruthy();
            // Retry does, and the rows land in place. The sheet holds 412 rows then, so it mounts what the
            // page shows (#856): at the top, the open editor and the draft are as they were…
            fireEvent.click(band.querySelector('[data-slot="retry"]')!);
            await waitFor(() => expect(container.querySelector('[data-slot="footerTransport"]')!.textContent).toBe("410 loaded of 410"));
            expect(input()!.value).toBe("Task 5");
            expect(draft("r000", Sheet.Types.Draft(JobType)).task).toEqual(variant("value", "Edited"));
            // …and down where the band was, its rows, numbered on.
            const rowPx = parseFloat((container.querySelector('[data-row-id="r000"]') as HTMLElement).style.minHeight);
            act(() => { window.scrollTo({ top: 200 * rowPx - window.innerHeight / 2 }); });
            expect(container.querySelector('[data-band="failed"]')).toBeNull();
            expect(container.querySelector('[data-row-id="r200"] [data-slot="gutterNumber"]')!.textContent).toBe("201");
        } finally {
            logged.mockRestore();
            restore();
        }
    }, HELD_TEST_MS);

    test("a source that fails before anything lands is the whole sheet's message, with a Retry that brings it back", async () => {
        const logged = vi.spyOn(console, "error").mockImplementation(() => {});
        try {
            const held = heldSheet(20);
            held.state.down = "no route to the dataset";
            const { container } = mount(held.value);
            await waitFor(() => expect(container.querySelector("[data-sheet-error]")).toBeTruthy());
            const message = container.querySelector("[data-sheet-error]")!;
            expect(message.getAttribute("role")).toBe("alert");
            expect(message.textContent).toBe("NO ROWS — the paged source could not be read. no route to the dataset Retry");
            held.state.down = undefined;
            fireEvent.click(message.querySelector('[data-slot="retry"]')!);
            await waitFor(() => expect(container.querySelectorAll('[data-slot="row"]:not([data-blank])')).toHaveLength(20));
            expect(container.querySelector("[data-sheet-error]")).toBeNull();
            expect(container.querySelector('[data-slot="footerTransport"]')!.textContent).toBe("20 loaded of 20");
        } finally {
            logged.mockRestore();
        }
    });

    test("a count the source cannot give is said on the transport line with a Retry; the rows, the blank tail and the count stay", async () => {
        const logged = vi.spyOn(console, "error").mockImplementation(() => {});
        try {
            const held = heldSheet(20);
            const { container } = mount(held.value);
            await waitFor(() => expect(container.querySelectorAll('[data-slot="row"][data-blank]')).toHaveLength(2));
            held.state.totalError = "count unavailable";
            held.touch();
            await waitFor(() => expect(container.querySelector('[data-slot="transportError"]')).toBeTruthy());
            const transport = container.querySelector('[data-slot="footerTransport"]')!;
            expect(transport.textContent).toBe("20 loaded of 20 · could not be read — count unavailable Retry");
            expect(transport.querySelector('[data-slot="transportError"]')!.getAttribute("role")).toBe("alert");
            expect(container.querySelectorAll('[data-slot="row"]:not([data-blank])')).toHaveLength(20);
            expect(container.querySelectorAll('[data-slot="row"][data-blank]')).toHaveLength(2);
            held.state.totalError = undefined;
            fireEvent.click(transport.querySelector('[data-slot="retry"]')!);
            await waitFor(() => expect(container.querySelector('[data-slot="transportError"]')).toBeNull());
            expect(container.querySelector('[data-slot="footerTransport"]')!.textContent).toBe("20 loaded of 20");
        } finally {
            logged.mockRestore();
        }
    });

    test("a confirmation read that throws keeps the Apply waiting, with its reason and Retry on the history bar; a Retry that fails again says so again; one that gets through confirms it", async () => {
        const logged = vi.spyOn(console, "error").mockImplementation(() => {});
        try {
            // The edited row sits after a failed window: it is read back at its own position.
            const held = heldSheet(410);
            held.state.failing.set(1, "gateway timeout");
            const { container, key, type, editorKey, flush } = mount(held.value);
            await waitFor(() => expect(container.querySelector('[data-row-id="r401"]')).toBeTruthy(), { timeout: 15_000 });
            const task = () => container.querySelector('[data-row-id="r401"] [data-key="task"]')!;
            fireEvent.mouseDown(task(), { button: 0 });
            key("x");
            type("Applied");
            editorKey("Enter");
            await flush();
            // The source takes the write, but from then on reading an entry back fails — the
            // readiness check's reads too, which it reports as an issue: the sheet stays up.
            held.state.afterApply = () => { held.state.entryError = "read-back refused"; };
            const bar = container.querySelector('[data-slot="history"]') as HTMLElement;
            fireEvent.click(within(bar).getByRole("button", { name: "Apply changes" }));
            await waitFor(() => expect(within(bar).getByRole("alert").textContent).toBe("read-back refused"));
            expect(within(bar).getByRole("status").textContent).toBe("Applied — loading the confirmed revision…");
            expect(within(bar).getByRole("button", { name: "1 issue" })).toBeTruthy();
            expect(held.state.refreshes).toBe(1);
            // Retry asks the source again; the read fails again, and the bar says so again.
            fireEvent.click(within(bar).getByRole("button", { name: "Retry refresh" }));
            await flush();
            expect(held.state.refreshes).toBe(2);
            expect(within(bar).getByRole("alert").textContent).toBe("read-back refused");
            // The read gets through: the Apply is confirmed, and the bar is clear.
            held.state.entryError = undefined;
            held.touch();
            await waitFor(() => expect(within(bar).queryByRole("alert")).toBeNull());
            expect(within(bar).queryByRole("status")).toBeNull();
            expect(within(bar).queryByRole("button", { name: "Retry refresh" })).toBeNull();
            expect(within(bar).getByRole("button", { name: "0 issues" })).toBeTruthy();
            expect(task().textContent).toBe("Applied");
        } finally {
            logged.mockRestore();
        }
    }, HELD_TEST_MS);

    test("a row that throws while it draws is a one-row diagnostic, and the rows around it draw", async () => {
        const logged = vi.spyOn(console, "error").mockImplementation(() => {});
        try {
            const held = heldSheet(20);
            held.state.broken = "r003";
            const { container } = mount(held.value);
            await waitFor(() => expect(container.querySelector("[data-row-error]")).toBeTruthy());
            const diagnostic = container.querySelector("[data-row-error]")!;
            expect(diagnostic.getAttribute("data-row-error")).toBe("4");
            expect(diagnostic.getAttribute("role")).toBe("row");
            expect(diagnostic.textContent).toBe("Row 4 could not be drawn — bad row");
            expect(container.querySelector('[data-row-id="r002"] [data-slot="gutterNumber"]')!.textContent).toBe("3");
            expect(container.querySelector('[data-row-id="r004"] [data-slot="gutterNumber"]')!.textContent).toBe("5");
            expect(container.querySelectorAll('[data-slot="row"]:not([data-blank])')).toHaveLength(19);
            expect(container.querySelector("[data-sheet-error]")).toBeNull();
        } finally {
            logged.mockRestore();
        }
    });

    test("a jump whose window cannot be read shows its band at the target and hands the viewport back (#854)", async () => {
        const restore = emulateWindowScroll();
        const logged = vi.spyOn(console, "error").mockImplementation(() => {});
        try {
            const held = heldSheet(8_000);
            held.state.failing.set(30, "gateway timeout");
            const { container } = mount(held.value);
            await waitFor(() => expect(container.querySelector('[data-row-id="r000"]')).toBeTruthy(), { timeout: 15_000 });
            await seekKey(container, "r6000");
            // Element 6,000's window fails: its band shows where its rows would be, and the view goes to it.
            await waitFor(() => expect(container.querySelector('[data-band="failed"][data-failed="30"]')).toBeTruthy(), { timeout: 10_000 });
            const band = container.querySelector('[data-band="failed"][data-failed="30"]') as HTMLElement;
            await waitFor(() => expect(window.scrollY).toBeGreaterThan(0));
            const top = offsetOf(band);
            expect(window.scrollY).toBeLessThan(top + parseFloat(band.style.height));
            expect(window.scrollY + window.innerHeight).toBeGreaterThan(top);
            // The jump handed the viewport back: at the top again, the sheet pages there.
            act(() => { window.scrollTo({ top: 0 }); });
            await waitFor(() => expect(container.querySelector('[data-row-id="r000"]')).toBeTruthy(), { timeout: 10_000 });
        } finally {
            logged.mockRestore();
            restore();
        }
    }, HELD_TEST_MS);

    test("an author's callbacks on a row after a failed window see the rows around it, each over its own source entry", async () => {
        const logged = vi.spyOn(console, "error").mockImplementation(() => {});
        try {
            const held = heldSheet(410);
            held.state.failing.set(1, "gateway timeout");
            const { container, key, editorKey, flush } = mount(held.value);
            await waitFor(() => expect(container.querySelector('[data-row-id="r401"]')).toBeTruthy(), { timeout: 15_000 });
            // A quantity typed on r401 reads its own entry, then runs the copilot and the
            // readiness check for it. Both read the code of the row above, r400 — a field with
            // no column, which reaches them only through r400's own entry in the source.
            const status = () => container.querySelector('[data-row-id="r401"] [data-key="status"]')!;
            fireEvent.mouseDown(container.querySelector('[data-row-id="r401"] [data-key="qty"]')!, { button: 0 });
            key("5");
            await flush();
            editorKey("Enter");
            await flush();
            await waitFor(() => expect(status().hasAttribute("data-proposed")).toBe(true));
            expect(status().textContent).toBe("C400");
            const bar = container.querySelector('[data-slot="history"]') as HTMLElement;
            expect(within(bar).getByRole("button", { name: "0 issues" })).toBeTruthy();
            expect(within(bar).getByRole("button", { name: "Apply changes" }).hasAttribute("disabled")).toBe(false);
        } finally {
            logged.mockRestore();
        }
    }, HELD_TEST_MS);
});

// ── The accessible grid (#860) ──────────────────────────────────────────────

describe("the accessible grid (#860)", () => {
    /** The element the grid names as its active cell. */
    const active = (card: HTMLElement) => document.getElementById(card.getAttribute("aria-activedescendant") ?? "");

    test("a paged sheet is described whole — the source's count, each row's place and name, the columns — and the ring is the active cell, following the keys", async () => {
        const restore = emulateWindowScroll();
        try {
            const held = heldSheet(410);
            // Window 1 stays on the wire: the run is window 0, and the rest one band.
            held.state.inFlight.add(1);
            const { container, card, cell, key } = mount(held.value);
            await waitFor(() => expect(container.querySelector('[data-row-id="r199"]')).toBeTruthy(), { timeout: 15_000 });
            expect(card.getAttribute("role")).toBe("grid");
            // The source's 410 rows and the header; the gutter and three columns.
            expect(card.getAttribute("aria-rowcount")).toBe("411");
            expect(card.getAttribute("aria-colcount")).toBe("4");
            expect(card.getAttribute("aria-multiselectable")).toBe("true");
            const header = container.querySelector('[data-slot="header"]')!;
            expect(header.getAttribute("aria-rowindex")).toBe("1");
            expect([...header.querySelectorAll('[role="columnheader"]')].map((h) => h.getAttribute("aria-colindex"))).toEqual(["1", "2", "3", "4"]);
            // A row is its place in the source, the header first: its rowheader names it, its cells sit under their columns.
            const r5 = container.querySelector('[data-row-id="r005"]')!;
            expect(r5.getAttribute("aria-rowindex")).toBe("7");
            expect(r5.querySelector('[role="rowheader"]')!.getAttribute("aria-label")).toBe("Row 6");
            expect([...r5.querySelectorAll('[role="gridcell"]')].map((c) => c.getAttribute("aria-colindex"))).toEqual(["2", "3", "4"]);
            // The rows not loaded are one row, where the first of them would be, its one cell across the grid.
            const tail = container.querySelector('[data-band="tail"]')!;
            expect(tail.getAttribute("role")).toBe("row");
            expect(tail.getAttribute("aria-rowindex")).toBe("202");
            expect(tail.querySelector('[role="gridcell"]')!.getAttribute("aria-colspan")).toBe("4");
            // The ring is the active cell and a selected one; the keys move it.
            fireEvent.mouseDown(cell(5, "task"), { button: 0 });
            expect(active(card)).toBe(cell(5, "task"));
            expect(cell(5, "task").getAttribute("aria-selected")).toBe("true");
            key("ArrowRight");
            expect(active(card)).toBe(cell(5, "qty"));
            expect(cell(5, "task").getAttribute("aria-selected")).toBe("false");
            // A range: every cell in it is selected, and the ring stays the active one.
            key("ArrowDown", { shiftKey: true });
            expect(cell(6, "qty").getAttribute("aria-selected")).toBe("true");
            expect(active(card)).toBe(cell(5, "qty"));
        } finally {
            restore();
        }
    }, HELD_TEST_MS);

    test("↓ past the resident rows asks for the next window, and the ring lands on its first row once it arrives", async () => {
        const restore = emulateWindowScroll();
        try {
            const held = heldSheet(410);
            held.state.inFlight.add(1);
            const { container, card, key, flush } = mount(held.value);
            await waitFor(() => expect(container.querySelector('[data-row-id="r199"]')).toBeTruthy(), { timeout: 15_000 });
            const task = (id: string) => container.querySelector(`[data-row-id="${id}"] [data-key="task"]`) as HTMLElement | null;
            fireEvent.mouseDown(task("r199")!, { button: 0 });
            key("ArrowDown");
            await flush();
            // The window is on the wire: the ring waits on the last resident row.
            expect(task("r199")!.hasAttribute("data-selected")).toBe(true);
            expect(container.querySelector('[data-row-id="r200"]')).toBeNull();
            held.state.inFlight.delete(1);
            held.touch();
            await waitFor(() => expect(task("r200")?.hasAttribute("data-selected")).toBe(true), { timeout: 10_000 });
            expect(active(card)).toBe(task("r200"));
            // Every row is in now: the count takes the blank padding too.
            expect(card.getAttribute("aria-rowcount")).toBe("413");
        } finally {
            restore();
        }
    }, HELD_TEST_MS);

    test("a press elsewhere while that window is on its way keeps the ring where the viewer put it", async () => {
        const restore = emulateWindowScroll();
        try {
            const held = heldSheet(410);
            held.state.inFlight.add(1);
            const { container, card, key, flush } = mount(held.value);
            await waitFor(() => expect(container.querySelector('[data-row-id="r199"]')).toBeTruthy(), { timeout: 15_000 });
            const task = (id: string) => container.querySelector(`[data-row-id="${id}"] [data-key="task"]`) as HTMLElement | null;
            fireEvent.mouseDown(task("r199")!, { button: 0 });
            key("ArrowDown");
            await flush();
            fireEvent.mouseDown(task("r010")!, { button: 0 });
            held.state.inFlight.delete(1);
            held.touch();
            await waitFor(() => expect(container.querySelector('[data-slot="footerTransport"]')!.textContent).toBe("410 loaded of 410"), { timeout: 10_000 });
            await flush();
            expect(task("r010")!.hasAttribute("data-selected")).toBe(true);
            expect(active(card)).toBe(task("r010"));
        } finally {
            restore();
        }
    }, HELD_TEST_MS);

    test("another planner's edit while ↓'s window is on its way keeps the move: the ring lands once the window arrives", async () => {
        const restore = emulateWindowScroll();
        try {
            const held = heldSheet(410);
            held.state.inFlight.add(1);
            const { container, card, key, flush } = mount(held.value);
            await waitFor(() => expect(container.querySelector('[data-row-id="r199"]')).toBeTruthy(), { timeout: 15_000 });
            const task = (id: string) => container.querySelector(`[data-row-id="${id}"] [data-key="task"]`) as HTMLElement | null;
            fireEvent.mouseDown(task("r199")!, { button: 0 });
            key("ArrowDown");
            await flush();
            // The source moves to a new revision — the key search starts over on it — while the window is on the wire.
            held.rewrite((jobs) => jobs.map((job, i) => (i === 5 ? { ...job, task: "Changed" } : job)));
            await waitFor(() => expect(task("r005")?.textContent).toBe("Changed"));
            expect(task("r199")!.hasAttribute("data-selected")).toBe(true);
            held.state.inFlight.delete(1);
            held.touch();
            await waitFor(() => expect(task("r200")?.hasAttribute("data-selected")).toBe(true), { timeout: 10_000 });
            expect(active(card)).toBe(task("r200"));
        } finally {
            restore();
        }
    }, HELD_TEST_MS);

    test("a key search into the window ↓ is waiting on takes the ring to the row it found, not the one ↓ was headed for", async () => {
        const restore = emulateWindowScroll();
        try {
            const held = heldSheet(410);
            held.state.inFlight.add(1);
            const { container, card, key, flush } = mount(held.value);
            await waitFor(() => expect(container.querySelector('[data-row-id="r199"]')).toBeTruthy(), { timeout: 15_000 });
            const task = (id: string) => container.querySelector(`[data-row-id="${id}"] [data-key="task"]`) as HTMLElement | null;
            fireEvent.mouseDown(task("r199")!, { button: 0 });
            key("ArrowDown");
            await flush();
            // The same window, sought by key while ↓ still waits on it.
            await seekKey(container, "r250");
            held.state.inFlight.delete(1);
            held.touch();
            await waitFor(() => expect(task("r250")?.hasAttribute("data-selected")).toBe(true), { timeout: 10_000 });
            await flush();
            expect(active(card)).toBe(task("r250"));
            expect(task("r200")?.hasAttribute("data-selected") ?? false).toBe(false);
        } finally {
            restore();
        }
    }, HELD_TEST_MS);

    test("↓ into a window that cannot be read shows its band, and the ring stays on the last row it could reach", async () => {
        const restore = emulateWindowScroll();
        const logged = vi.spyOn(console, "error").mockImplementation(() => {});
        try {
            // Two windows; the second stays on the wire until ↓ asks for it, and then its read throws.
            const held = heldSheet(400);
            held.state.inFlight.add(1);
            const { container, card, key, flush } = mount(held.value);
            await waitFor(() => expect(container.querySelector('[data-row-id="r199"]')).toBeTruthy(), { timeout: 15_000 });
            const task = (id: string) => container.querySelector(`[data-row-id="${id}"] [data-key="task"]`) as HTMLElement | null;
            fireEvent.mouseDown(task("r199")!, { button: 0 });
            expect(window.scrollY).toBe(0);
            held.state.inFlight.delete(1);
            held.state.failing.set(1, "gateway timeout");
            key("ArrowDown");
            await waitFor(() => expect(container.querySelector('[data-band="failed"][data-failed="1"]')).toBeTruthy(), { timeout: 10_000 });
            // The view went to the band, and the ring stayed on the last row there is.
            await waitFor(() => expect(window.scrollY).toBeGreaterThan(0));
            await flush();
            expect(task("r199")!.hasAttribute("data-selected")).toBe(true);
            expect(active(card)).toBe(task("r199"));
        } finally {
            logged.mockRestore();
            restore();
        }
    }, HELD_TEST_MS);

    test("⌘End jumps to the source's last cell and ⌘Home back to its first, the ring landing once each window arrives", async () => {
        const restore = emulateWindowScroll();
        try {
            const held = heldSheet(8_000);
            const { container, card, key } = mount(held.value);
            await waitFor(() => expect(container.querySelector('[data-row-id="r000"]')).toBeTruthy(), { timeout: 15_000 });
            const at = (id: string, k: string) => container.querySelector(`[data-row-id="${id}"] [data-key="${k}"]`) as HTMLElement | null;
            fireEvent.mouseDown(at("r000", "qty")!, { button: 0 });
            key("End", { ctrlKey: true });
            await waitFor(() => expect(at("r7999", "status")?.hasAttribute("data-selected")).toBe(true), { timeout: 10_000 });
            expect(active(card)).toBe(at("r7999", "status"));
            // The source's last row is the grid's last.
            expect(container.querySelector('[data-row-id="r7999"]')!.getAttribute("aria-rowindex")).toBe("8001");
            expect(card.getAttribute("aria-rowcount")).toBe("8001");
            key("Home", { ctrlKey: true });
            await waitFor(() => expect(at("r000", "task")?.hasAttribute("data-selected")).toBe(true), { timeout: 10_000 });
            expect(active(card)).toBe(at("r000", "task"));
        } finally {
            restore();
        }
    }, HELD_TEST_MS);

    test("a source that has not counted itself leaves the grid's row count unknown, and its rows still say where they are", async () => {
        const held = heldSheet(20);
        held.state.uncounted = true;
        const { container, card } = mount(held.value);
        await waitFor(() => expect(container.querySelector('[data-row-id="r019"]')).toBeTruthy());
        expect(card.getAttribute("aria-rowcount")).toBe("-1");
        expect(container.querySelector('[data-row-id="r019"]')!.getAttribute("aria-rowindex")).toBe("21");
        // Counted, the count is the source's.
        held.state.uncounted = false;
        held.touch();
        await waitFor(() => expect(card.getAttribute("aria-rowcount")).toBe("23"));
    });

    test("the grid is one tab stop — no control in it is in the tab order — and a Tab it has no use for leaves it", async () => {
        const { value } = withSpies(buildSheet());
        const { container, card, cell, key, type, editorKey, flush } = mount(value);
        // A new row in the first padding row: a draft the gutter can discard, so its button is drawn.
        fireEvent.mouseDown(cell(2, "task"), { button: 0 });
        key("N");
        type("New job");
        editorKey("Enter");
        await flush();
        expect(container.querySelector('[data-slot="discardDraft"]')).toBeTruthy();
        const tabbable = [...card.querySelectorAll<HTMLElement>("button, input, select, textarea, a[href], [tabindex]")].filter((el) => el.tabIndex >= 0);
        expect(tabbable).toEqual([]);
        // ⇥ walks the columns (a handled key is prevented)…
        fireEvent.mouseDown(cell(0, "qty"), { button: 0 });
        expect(fireEvent.keyDown(card, { key: "Tab" })).toBe(false);
        expect(cell(0, "code").hasAttribute("data-selected")).toBe(true);
        // …and on the row's last column, nothing pending, it is the browser's: the focus leaves the grid. ⇧⇥ on the first too.
        fireEvent.mouseDown(cell(0, "status"), { button: 0 });
        expect(fireEvent.keyDown(card, { key: "Tab" })).toBe(true);
        expect(cell(0, "status").hasAttribute("data-selected")).toBe(true);
        fireEvent.mouseDown(cell(0, "start"), { button: 0 });
        expect(fireEvent.keyDown(card, { key: "Tab", shiftKey: true })).toBe(true);
    });

    test("a keyboard move brings the ring's column into view sideways, right of the sticky gutter; a column already in view scrolls nothing", () => {
        const { container, card, cell, key } = mount(buildSheet());
        // jsdom lays nothing out: the columns scroll sideways inside a frame 600 px wide, each 150 px wide
        // after the 128 px gutter — where its header cell is, less the frame's scroll.
        const frame = card.firstElementChild as HTMLElement;
        Object.defineProperty(frame, "clientWidth", { configurable: true, value: 600 });
        const headers = [...container.querySelectorAll<HTMLElement>('[data-slot="headerCell"]')];
        const realRect = Element.prototype.getBoundingClientRect;
        Element.prototype.getBoundingClientRect = function (this: Element) {
            const box = (left: number, width: number) => ({ x: left, y: 0, top: 0, left, right: left + width, bottom: 36, width, height: 36, toJSON: () => ({}) }) as DOMRect;
            const i = headers.indexOf(this as HTMLElement);
            if (i >= 0) return box(128 + i * 150 - frame.scrollLeft, 150);
            if (this === frame) return box(0, 600);
            return realRect.call(this);
        };
        try {
            fireEvent.mouseDown(cell(0, "start"), { button: 0 });
            expect(frame.scrollLeft).toBe(0);
            // The last column, the fifth, ends at 878 px: the frame scrolls 278 px and it shows whole.
            key("End");
            expect(frame.scrollLeft).toBe(278);
            key("ArrowLeft");
            expect(frame.scrollLeft).toBe(278);
            // The first, back right of the gutter.
            key("Home");
            expect(frame.scrollLeft).toBe(0);
            // A frame narrower than a column — a phone's, beside its wide gutter: a column shows from its start.
            Object.defineProperty(frame, "clientWidth", { configurable: true, value: 200 });
            key("End");
            expect(frame.scrollLeft).toBe(600);
        } finally {
            Element.prototype.getBoundingClientRect = realRect;
        }
    });

    test("on a sheet whose rows render in flow, a keyboard move brings the ring's cell into view; a frame that virtualizes brings the row in itself", async () => {
        const proto = Element.prototype as unknown as { scrollIntoView?: (options?: ScrollIntoViewOptions) => void };
        const real = proto.scrollIntoView;
        const into = vi.fn();
        proto.scrollIntoView = into;
        try {
            const inFlow = mount(buildSheet());
            fireEvent.mouseDown(inFlow.cell(0, "task"), { button: 0 });
            // A press never scrolls: the cell is under the pointer.
            expect(into).not.toHaveBeenCalled();
            inFlow.key("ArrowDown");
            expect(into).toHaveBeenCalledTimes(1);
            expect(into.mock.contexts[0]).toBe(inFlow.cell(1, "task"));
            expect(into.mock.calls[0]![0]).toEqual({ block: "nearest", inline: "nearest" });
            inFlow.unmount();
            // A paged sheet's frame watches the page, and scrolls it to the row itself.
            into.mockClear();
            const restore = emulateWindowScroll();
            try {
                const paged = mount(heldSheet(20).value);
                await waitFor(() => expect(paged.container.querySelector('[data-row-id="r001"]')).toBeTruthy());
                fireEvent.mouseDown(paged.cell(0, "task"), { button: 0 });
                paged.key("ArrowDown");
                expect(paged.cell(1, "task").hasAttribute("data-selected")).toBe(true);
                expect(into).not.toHaveBeenCalled();
            } finally {
                restore();
            }
        } finally {
            if (real === undefined) delete proto.scrollIntoView;
            else proto.scrollIntoView = real;
        }
    });
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
        const Ctx = Sheet.Types.DraftContext(PlanRowType, ActivityType);
        const impliedStations = $.const(East.function([Ctx], OptionType(Sheet.Types.Counted), ($2, ctx) => {
            const noCount = $2.const(none, OptionType(Sheet.Types.Counted));
            return ctx.row.qty.match({
                missing: () => noCount,
                invalid: () => noCount,
                value: (_$, value) => value.match({
                    none: () => noCount,
                    some: ($3, q) => {
                        const share = $3.let(q.divide(300.0));
                        const frac = $3.let(share.remainder(1.0));
                        const n = $3.let(frac.equal(0.0).ifElse(() => share, () => share.subtract(frac).add(1.0)).toInteger());
                        return East.value(some({ n, key: "CNC lathe" }), OptionType(Sheet.Types.Counted));
                    },
                }),
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
        // A counted member prints its kind; its count, worded in the kind it resolves to, is the chip's meta.
        expect([...p1.querySelectorAll('[data-half="to"] [data-slot="chip"]')].map((c) => c.textContent)).toEqual(["CNC lathe4 machines"]);
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
        const { value, edits, draft } = withSpies(buildLinkSheet());
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
        const link = draft("p4", Sheet.Types.Draft(PlanRowType)).stations;
        expect(link.type).toBe("value");
        if (link.type !== "value") throw new Error("Expected a complete link draft");
        expect(link.value.from).toEqual([variant("identified", { key: "M2140" }), variant("identified", { key: "Line 2" })]);
        expect(link.value.to).toEqual([variant("counted", { n: 4n, key: "CNC lathe" }), variant("identified", { key: "M7301" })]);
        // The committed cell draws its chips; the custom check flags the bench.
        const committed = container.querySelector('[data-row-id="p4"] [data-key="stations"]')!;
        expect([...committed.querySelectorAll('[data-half="to"] [data-slot="chip"]')].map((c) => c.textContent)).toEqual(["CNC lathe4 machines", "M7301"]);
        const flagged = committed.querySelector('[data-slot="chip"][data-flag]')!;
        expect(flagged.textContent).toBe("M7301");
        expect(flagged.getAttribute("title")).toBe("M7301 is not a lathe");
    });

    test("a locked half is skipped by ⇥ and flagged when typed into; a click in a half moves the caret; ⌫ pops a chip", () => {
        const { container, cell, key, type, editorKey, input } = mount(sheetJournal(buildLinkSheet()).value);
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
        const { value, edits, draft } = withSpies(buildLinkSheet());
        const { card, cell, flush } = mount(value);
        fireEvent.mouseDown(cell(3, "stations"), { button: 0 });
        fireEvent.paste(card, { clipboardData: { getData: () => "M2141\t2 x line 2, tbc" } });
        await flush();
        expect(edits).toHaveLength(1);
        const link = draft("p4", Sheet.Types.Draft(PlanRowType)).stations;
        if (link.type !== "value") throw new Error("Expected a complete link draft");
        expect(link.value.from).toEqual([variant("identified", { key: "M2141" })]);
        expect(link.value.to).toEqual([variant("counted", { n: 2n, key: "Line 2" }), variant("placeholder", null)]);
        expect(cell(3, "stations").querySelectorAll('[data-slot="chip"]')).toHaveLength(3);
    });
});
