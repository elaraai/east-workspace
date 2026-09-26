/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 *
 * @vitest-environment jsdom
 *
 * The localizable Sheet (#861): every word the Sheet says itself comes from
 * ONE message table — the toolbar and the view tabs, the header, the rows,
 * bands and gap pills, the strip, the footer and the history bar, the
 * insertion chips, and the message each gesture leaves — its numbers in the
 * locale react-aria's `I18nProvider` sets, and `SheetMessagesProvider`
 * overrides the words for a subtree. The Plan's #820 test, for the Sheet.
 * Every sheet is built by the east-ui factory and COMPILED.
 */

import { describe, test, expect, afterEach, beforeEach, vi } from "vitest";
import { render, cleanup, fireEvent, waitFor, act } from "@testing-library/react";
import type { ReactNode } from "react";
import { ChakraProvider } from "@chakra-ui/react";
import { I18nProvider } from "@react-aria/i18n";
import { ArrayType, DateTimeType, East, IntegerType, OptionType, StringType, StructType, none, some, type ValueTypeOf } from "@elaraai/east";
import { Paged } from "@elaraai/east-ui";
import { Sheet, Slice, State, UIComponentType } from "@elaraai/east-ui/internal";
import { system } from "../../theme/index.js";
import { initializeStore } from "../../platform/state-runtime.js";
import { UIStore } from "../../platform/state-store.js";
import { getRegisteredPlatformImplementations } from "../../platform/registry.js";
import "../../platform/slice/index.js";
import { EastChakraSheet } from "./index.js";
import { SheetBandRow, SheetFailedBandRow, SheetRowBoundary } from "./Rows.js";
import { SheetMessagesProvider, sheetMessages, type SheetMessages } from "./messages.js";
import type { SheetRootValue } from "./values.js";

class ResizeObserverStub { observe() {} unobserve() {} disconnect() {} }
(globalThis as { ResizeObserver?: unknown }).ResizeObserver ??= ResizeObserverStub;

beforeEach(() => { initializeStore(new UIStore()); });
afterEach(() => {
    cleanup();
    localStorage.clear();
});

// ── Fixtures, at module scope: East bodies never call host helpers ─────────
const RowType = StructType({ id: StringType, task: StringType, start: OptionType(DateTimeType), qty: IntegerType });
const ROWS = [
    { id: "a", task: "First", start: none, qty: 1n },
    { id: "b", task: "Second", start: none, qty: 2n },
];
const JobType = StructType({ id: StringType, activity: StringType });
const JOBS = ["Machining", "Painting", "Packaging", "Painting", "Machining", "Packaging"].map((activity, i) => ({ id: `j${i}`, activity }));
const NARROWING = {
    range: none, compare: none, filters: [], cohorts: [], activeCohorts: new Set<string>(),
    breakdown: none, visible: none, selectedIndex: none, resolution: none,
};
const VIEWS = [{ id: "paint", name: "PAINT", narrowing: { ...NARROWING, search: some("paint") }, context: 0n, reveals: [], folds: new Map<string, boolean>() }];
const LineType = StructType({ task: StringType, qty: IntegerType });
const PlanType = StructType({ id: StringType, name: StringType, lines: ArrayType(LineType) });
const PLANS = [
    { id: "p1", name: "Line 2 week 8", lines: [{ task: "Cut", qty: 1n }, { task: "Weld", qty: 2n }] },
    { id: "p2", name: "Line 3 week 8", lines: [{ task: "Paint", qty: 3n }] },
];
const PAGED_TOTAL = 1_000n;

/** An editable flat sheet: a text, a date and an integer column over a bound State, insertion and removal on. */
const EDITABLE = East.function([], UIComponentType, ($) => {
    const data = $.const(State.bind([ArrayType(RowType)], "sheet-i18n-rows", ROWS));
    return Sheet.Root(data, {
        task: Sheet.column.text(RowType, { header: "Task" }),
        start: Sheet.column.date(RowType, { header: "Start" }),
        qty: Sheet.column.integer(RowType, { header: "Qty" }),
    }, { id: "id", onUpdate: data.write, blanks: 1n, edits: { insertRows: true, removeRows: true } });
}).toIR().compile(getRegisteredPlatformImplementations());

/** A sheet over a bound slice, opening on a saved view that searches `paint`. */
const LENS = East.function([], UIComponentType, ($) => {
    const rows = $.const(JOBS, ArrayType(JobType));
    const views = $.const(VIEWS, ArrayType(Sheet.Types.View));
    const cfg = $.const(Slice.config(JobType, { fields: { activity: { label: "Activity" } }, searchFieldIds: ["activity"] }));
    const slice = $.let(Slice.bind([JobType], "sheet_i18n_dom", cfg, Slice.state(), rows, none));
    return Sheet.Root(rows, { activity: Sheet.column.text(JobType, { header: "Activity" }) }, {
        id: "id", slice, affordances: ["search"], views, activeView: some("paint"),
    });
}).toIR().compile(getRegisteredPlatformImplementations());

/** A grouped sheet whose declaration names no noun: the Sheet's own word says what a group is. */
const GROUPED = East.function([], UIComponentType, ($) => {
    const plans = $.const(PLANS, ArrayType(PlanType));
    return Sheet.Root(plans, {
        task: Sheet.column.text(LineType, { header: "Task" }),
        qty: Sheet.column.integer(LineType, { header: "Qty" }),
    }, { id: "id", group: Sheet.group(PlanType, "lines", { title: "name" }) });
}).toIR().compile(getRegisteredPlatformImplementations());

/** A keyed paged source of a thousand rows, in a bounded frame: its first windows land, the rest wait. */
const PAGED = East.function([], UIComponentType, ($) => {
    const total = $.const(PAGED_TOTAL);
    const rows = $.let(East.Array.range(0n, total).map(($2, i) => $2.const({ id: East.str`J${i.add(10000n)}`, activity: East.str`Task ${i}` }, JobType)), ArrayType(JobType));
    const source = $.const(Paged.of("sheet_i18n_paged", rows, { key: (r) => r.id }));
    return Sheet.Root(source, { activity: Sheet.column.text(JobType, { header: "Activity" }) }, { id: "id", style: { height: "400px" } });
}).toIR().compile(getRegisteredPlatformImplementations());

/** A compiled program's Sheet. */
function view(program: () => ValueTypeOf<typeof UIComponentType>): SheetRootValue {
    const value = program();
    if (value.type !== "Sheet") throw new Error("Expected a Sheet");
    return value.value;
}

function mount(value: SheetRootValue, key: string, wrap: (sheet: ReactNode) => ReactNode = (s) => s) {
    const tree = (w: (sheet: ReactNode) => ReactNode) => (
        <ChakraProvider value={system}>{w(<EastChakraSheet value={value} storageKey={key} />)}</ChakraProvider>
    );
    const utils = render(tree(wrap));
    const q = (selector: string) => utils.container.querySelector<HTMLElement>(selector);
    const card = () => q("[data-sheet-card]")!;
    const flush = () => act(async () => { await Promise.resolve(); await new Promise<void>((r) => requestAnimationFrame(() => r())); });
    const message = () => q('[data-slot="footerMessage"]')!.textContent;
    return { ...utils, q, card, flush, message, rewrap: (next: (sheet: ReactNode) => ReactNode) => utils.rerender(tree(next)) };
}

/** Every text node under `root` that says something — a separator or the whitespace between words is structure. */
function words(root: Element): string[] {
    const out: string[] = [];
    const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
    for (let n = walker.nextNode(); n !== null; n = walker.nextNode()) {
        const s = n.textContent ?? "";
        if (/[\p{L}\p{N}]/u.test(s)) out.push(s.trim());
    }
    return out;
}

/** The English table with every message marked `⟦` — a word the Sheet says without the mark did not come from the table. */
const MARKED = Object.fromEntries(Object.entries(sheetMessages).map(([k, f]) =>
    [k, (p: never) => `⟦${(f as (p: never) => string)(p)}`])) as unknown as SheetMessages;
const marked = (sheet: ReactNode) => <SheetMessagesProvider messages={MARKED}>{sheet}</SheetMessagesProvider>;

const allMarked = (texts: readonly (string | null | undefined)[]) => {
    expect(texts.length).toBeGreaterThan(0);
    for (const s of texts) expect(s?.startsWith("⟦"), `"${s}" is not the table's`).toBe(true);
};
const attrs = (el: Element | null, ...names: string[]) => names.map((n) => el?.getAttribute(n));

/** A row that throws as it draws. */
function Thrower(): never {
    throw new Error("boom");
}

// ── Every word the Sheet says is the table's ───────────────────────────────
describe("one message table (#861)", () => {
    test("the toolbar and the view tabs, the gap pills, and a tab's message", async () => {
        const { q, container, flush, message } = mount(view(LENS), "sheet-861-lens", marked);
        await waitFor(() => expect(q("[data-sheet]")!.hasAttribute("data-lens")).toBe(true));
        // The tabs: the list's name, the whole-sheet tab, a view's title, the close control, + TAB.
        expect(q('[role="tablist"]')!.getAttribute("aria-label")).toBe("⟦Views");
        const all = q('[data-slot="tab"][data-tab="all"]')!;
        expect(words(all)).toEqual(["⟦All", "6"]);
        expect(all.getAttribute("title")).toBe("⟦Every row — the whole sheet");
        const paint = q('[data-slot="tab"][data-tab="paint"]')!;
        expect(paint.getAttribute("title")).toBe('⟦"paint" · live · double-click renames · middle-click closes');
        expect(paint.querySelector('[data-slot="tabClose"]')!.getAttribute("title")).toBe("⟦Close tab");
        const add = q('[data-slot="tabAdd"]')!;
        allMarked(attrs(add, "aria-label", "title"));
        expect(words(add)).toEqual(["⟦tab"]);
        // The lens's count line and its context switch.
        expect(q('[data-slot="toolbarCount"]')!.textContent).toBe("⟦2 matches");
        const context = q('[data-slot="contextSwitch"]')!;
        expect(context.getAttribute("aria-label")).toBe("⟦Context rows either side of a hit");
        expect(words(context)).toEqual(["⟦context", "⟦none", "⟦±1", "⟦±3"]);
        // A gap pill: its count and every control's words, names and titles.
        const gap = [...container.querySelectorAll('[data-slot="band"][data-band="lens"]')].find((g) => g.querySelector('[data-where="top"]') !== null)!;
        allMarked(words(gap));
        allMarked(attrs(gap.querySelector('[data-where="top"]'), "aria-label", "title"));
        allMarked(attrs(gap.querySelector('[data-where="all"]'), "aria-label", "title"));
        expect(gap.querySelector('[data-slot="bandCount"]')!.getAttribute("title")).toBe("⟦Expand — each click reaches further");
        // A rename box's name.
        fireEvent.doubleClick(paint);
        expect(q('[data-slot="tabRename"]')!.getAttribute("aria-label")).toBe("⟦Rename tab");
        fireEvent.keyDown(q('[data-slot="tabRename"]')!, { key: "Escape" });
        // + TAB: the message it leaves.
        fireEvent.mouseDown(add, { button: 0 });
        await flush();
        expect(message()).toBe('⟦Saved tab "paint" — a live view: rows that match join it as the sheet changes');
    });

    test("the header, a group's band, a line's name, the count line, and what folding leaves — a group named in the Sheet's own word", () => {
        const { q, message } = mount(view(GROUPED), "sheet-861-grouped", marked);
        expect(q('[data-slot="headerNumber"]')!.textContent).toBe("⟦#");
        const foldAll = q('[data-slot="foldAll"]')!;
        // The declaration named no noun: the table's word, not an English default on the wire.
        expect(foldAll.getAttribute("aria-label")).toBe("⟦Fold ⟦2 ⟦groups");
        expect(foldAll.getAttribute("title")).toBe("⟦Fold ⟦2 ⟦groups — ⌥ on a chevron, ⇧Space on a ⟦group");
        const band = q('[data-band-row][data-row-id="p1"]')!;
        const gutter = band.querySelector('[data-slot="gutter"]')!;
        expect(gutter.getAttribute("aria-label")).toBe("⟦⟦group 1, 2 lines");
        expect(gutter.getAttribute("title")).toBe("⟦Select the ⟦group's lines — delete removes them");
        expect(gutter.querySelector('[data-slot="checkbox"]')!.getAttribute("aria-label")).toBe("⟦Select ⟦group Line 2 week 8");
        const fold = band.querySelector('[data-slot="fold"]')!;
        expect(attrs(fold, "aria-label", "title")).toEqual(["⟦Fold the ⟦group", "⟦Fold — Space · ⌥ folds all"]);
        expect(q('[data-slot="row"][data-group-id="p1"][data-line="0"] [data-slot="gutter"]')!.getAttribute("aria-label")).toBe("⟦Line 1 of Line 2 week 8");
        expect(q('[data-slot="footerSummary"]')!.textContent).toBe("⟦⟦2 ⟦groups · 3 lines");
        // What folding leaves.
        fireEvent.mouseDown(fold, { button: 0 });
        expect(message()).toBe("⟦Folded the ⟦group — Space or the chevron opens it");
        fireEvent.click(foldAll);
        expect(message()).toBe("⟦Folded ⟦2 ⟦groups — the corner, ⌥ on a chevron or ⇧Space opens them");
        expect(q('[data-slot="foldAll"]')!.getAttribute("aria-label")).toBe("⟦Open ⟦2 ⟦groups");
    });

    test("a row's names and titles, the strip, the footer's hint and the history bar", async () => {
        const { q, getByRole, flush } = mount(view(EDITABLE), "sheet-861-rows", marked);
        const gutter = q('[data-row-id="a"] [data-slot="gutter"]')!;
        expect(attrs(gutter, "aria-label", "title")).toEqual(["⟦Row 1", "⟦Select whole row — delete removes it"]);
        expect(gutter.querySelector('[data-slot="checkbox"]')!.getAttribute("aria-label")).toBe("⟦Select row 1");
        expect(q('[data-slot="footerHint"]')!.textContent).toBe("⟦⏎ edit · esc cancel · click a row number to select it · ⌘C / ⌘V round-trips with Excel");
        for (const name of ["⟦Undo", "⟦Redo", "⟦Discard", "⟦Apply changes"]) expect(getByRole("button", { name })).toBeTruthy();
        expect(q('[data-slot="historyIssues"] button')!.getAttribute("aria-label")).toBe("⟦0 issues");
        // An empty date field: what it accepts, in the strip.
        fireEvent.doubleClick(q('[data-row-id="a"] [data-slot="cell"][data-key="start"]')!);
        await flush();
        allMarked(words(q('[data-slot="strip"]')!));
        expect(q('[data-slot="stripLabel"]')!.textContent).toBe("⟦START · accepts");
        expect(q('[data-slot="stripMeta"]')!.textContent).toBe("⟦dd / mm / yyyy");
        fireEvent.keyDown(q('[data-slot="editorDate"]')!, { key: "Escape" });
        await flush();
        // A draft's own issue — a required value left out — in the table's words.
        const qty = () => q('[data-row-id="a"] [data-slot="cell"][data-key="qty"]')!;
        fireEvent.doubleClick(qty());
        await flush();
        // The number field reports its change a microtask later: let it land before ⏎.
        fireEvent.input(q('[data-slot="editorInput"]')!, { target: { value: "" } });
        await flush();
        fireEvent.keyDown(q('[data-slot="editorInput"]')!, { key: "Enter" });
        await flush();
        expect(document.getElementById(qty().getAttribute("aria-describedby")!)!.textContent).toBe("⟦A value is required");
    });

    test("the bands: an unloaded run, a window that could not be read and its Retry, a row that could not be drawn", () => {
        const err = vi.spyOn(console, "error").mockImplementation(() => {});
        try {
            const { container } = render(
                <ChakraProvider value={system}>
                    <SheetMessagesProvider messages={MARKED}>
                        <SheetBandRow styles={{}} band={{ at: "tail", from: 600, to: 999, px: 400 }} loading={false} colCount={1} />
                        <SheetFailedBandRow styles={{}} failure={{ w: 1, from: 200, to: 399, px: 400, error: "fetch failed: 503" }} onRetry={() => {}} colCount={1} />
                        <SheetRowBoundary styles={{}} rowPx={30} number={3} resetKey={0}><Thrower /></SheetRowBoundary>
                    </SheetMessagesProvider>
                </ChakraProvider>,
            );
            expect(words(container.querySelector('[data-band="tail"]')!)).toEqual(["⟦400 not loaded"]);
            expect(words(container.querySelector('[data-band="failed"]')!)).toEqual(["⟦Elements 201–400 could not be read — fetch failed: 503", "⟦Retry"]);
            expect(words(container.querySelector('[data-slot="rowError"]')!)).toEqual(["⟦Row 3 could not be drawn — boom"]);
        } finally {
            err.mockRestore();
        }
    });

    test("the insertion chips, the insertion strip, and what a copy and a delete leave", async () => {
        const { q, card, flush, message } = mount(view(EDITABLE), "sheet-861-insert", marked);
        fireEvent.mouseEnter(q('[data-row-id="b"] [data-slot="insertPoint"]')!);
        expect(q('[data-slot="insertChips"]')!.getAttribute("aria-label")).toBe("⟦Insert here");
        expect(attrs(q('[data-slot="insertLayer"] [data-slot="insertRow"]'), "aria-label", "title")).toEqual(["⟦Insert row before", "⟦Insert a row here"]);
        // Whole rows selected: the strip's choices, and the hint that says so.
        fireEvent.click(q('[data-row-id="a"] [data-slot="checkbox"]')!);
        await flush();
        expect(words(q('[role="group"][aria-label="⟦Row insertion"]')!)).toEqual(["⟦Insert above", "⟦Insert below"]);
        expect(q('[data-slot="footerHint"]')!.textContent).toBe("⟦1 row selected · ⌫ deletes them · ⌘C copies");
        fireEvent.copy(card(), { clipboardData: { setData: () => undefined } });
        expect(message()).toBe("⟦Copied 1×3 to clipboard");
        fireEvent.keyDown(card(), { key: "Backspace" });
        await flush();
        expect(message()).toBe("⟦Deleted 1 row");
    });

    test("paged, in German: the transport line in the locale's numbers, and the scope badge", async () => {
        const { q } = mount(view(PAGED), "sheet-861-paged", (sheet) => <I18nProvider locale="de-DE">{marked(sheet)}</I18nProvider>);
        await waitFor(() => expect(q('[data-slot="footerTransport"]')!.textContent).toMatch(/^⟦[\d.]+ loaded of 1\.000$/), { timeout: 15_000 });
        expect(q('[data-slot="toolbarBadge"]')!.textContent).toBe("⟦loaded rows only");
    }, 30_000);
});

// ── Overrides ─────────────────────────────────────────────────────────────
describe("SheetMessagesProvider (#861)", () => {
    const OUTER: Partial<SheetMessages> = {
        hintDefault: () => "⏎ bearbeiten · esc abbrechen",
        undo: () => "Rückgängig",
    };
    const INNER: Partial<SheetMessages> = {
        redo: () => "Wiederholen",
    };

    test("overrides take effect, nested providers compose, and the rest stays English", () => {
        const { q, getByRole } = mount(view(EDITABLE), "sheet-861-override", (sheet) => (
            <SheetMessagesProvider messages={OUTER}>
                <SheetMessagesProvider messages={INNER}>{sheet}</SheetMessagesProvider>
            </SheetMessagesProvider>
        ));
        expect(q('[data-slot="footerHint"]')!.textContent).toBe("⏎ bearbeiten · esc abbrechen");
        expect(getByRole("button", { name: "Rückgängig" })).toBeTruthy();
        expect(getByRole("button", { name: "Wiederholen" })).toBeTruthy();
        // Whatever neither overrides is the default table's.
        expect(getByRole("button", { name: "Apply changes" })).toBeTruthy();
        expect(q('[data-row-id="a"] [data-slot="gutter"]')!.getAttribute("aria-label")).toBe("Row 1");
    });

    test("a new table takes effect without a remount — the message a gesture left included", async () => {
        const english: Partial<SheetMessages> = {};
        const { q, card, flush, message, rewrap, getByRole } = mount(view(EDITABLE), "sheet-861-swap",
            (sheet) => <SheetMessagesProvider messages={english}>{sheet}</SheetMessagesProvider>);
        fireEvent.click(q('[data-row-id="a"] [data-slot="checkbox"]')!);
        await flush();
        fireEvent.copy(card(), { clipboardData: { setData: () => undefined } });
        expect(message()).toBe("Copied 1×3 to clipboard");
        const sheetEl = q("[data-sheet]");
        const german: Partial<SheetMessages> = {
            noticeCopied: ({ rows, cols }) => `${rows}×${cols} kopiert`,
            undo: () => "Rückgängig",
        };
        rewrap((sheet) => <SheetMessagesProvider messages={german}>{sheet}</SheetMessagesProvider>);
        // The same sheet, re-worded: the message is data, worded as it shows.
        expect(q("[data-sheet]")).toBe(sheetEl);
        expect(message()).toBe("1×3 kopiert");
        expect(getByRole("button", { name: "Rückgängig" })).toBeTruthy();
    });
});
