/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 *
 * @vitest-environment jsdom
 *
 * The lens and the views (Sheet Spec §5 rows 16–17 and 21): a bound slice's
 * narrowing drawn as hits with brand numbers and collapsed bands, the band
 * controls, the context switch, the view tabs (snapshot, dirty, update,
 * revert, close, rename), a Link column searched through its `text`
 * projection, and the paged arm's key search over `seek` — every value built
 * by the east-ui factory and COMPILED, the slice bound through the real
 * `Slice.bind`.
 */

import { describe, test, expect, afterEach, beforeEach } from "vitest";
import { render, cleanup, fireEvent, waitFor, act } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { ChakraProvider } from "@chakra-ui/react";
import {
    ArrayType, East, FloatType, IntegerType, OptionType, StringType, StructType,
    none, some, variant, type ValueTypeOf,
} from "@elaraai/east";
import { Paged } from "@elaraai/east-ui";
import { Sheet } from "@elaraai/e3-ui/internal";
import { Slice } from "@elaraai/east-ui/internal";
import { system, UIStore, getRegisteredPlatformImplementations } from "@elaraai/east-ui-components";
import { initializeStore } from "@elaraai/east-ui-components/internal";
import { EastChakraSheet } from "./index.js";
import { emulateWindowScroll, measureRowsAsDrawn } from "./frame.test-utils.js";
import type { SheetRootValue, SheetViewValue } from "./values.js";

afterEach(cleanup);
beforeEach(() => { initializeStore(new UIStore()); });

// jsdom lacks the browser APIs Chakra's Combobox positioner relies on.
class ResizeObserverStub { observe() {} unobserve() {} disconnect() {} }
(globalThis as unknown as { ResizeObserver?: unknown }).ResizeObserver ??= ResizeObserverStub;

const JobType = StructType({ id: StringType, activity: StringType, notes: StringType, stations: Sheet.Types.Link, qty: OptionType(FloatType) });
const MachineType = StructType({ code: StringType, family: StringType });

/** Fixtures at MODULE scope: East bodies never call host helpers. */
const ACTIVITIES = ["Routing", "Spraying", "Wrapping"];
const ROWS = Array.from({ length: 12 }, (_x, i) => ({
    id: `j${i}`,
    activity: ACTIVITIES[i % 3]!,
    notes: i === 4 ? "urgent — inspect before delivery" : `batch ${100 + i}`,
    stations: i === 1 ? { from: [], to: [variant("counted", { n: 2n, key: "CNC router" })] }
        : i === 5 ? { from: [], to: [variant("identified", { key: "R2141" })] }
            : i === 0 ? { from: [], to: [variant("identified", { key: "R2140" })] }
                : { from: [], to: [] },
    qty: some(100 + i * 10),
}));
const MACHINES = [{ code: "R2140", family: "CNC router" }, { code: "R2141", family: "CNC router" }];
const NARROWING = {
    range: none, compare: none, filters: [], cohorts: [], activeCohorts: new Set<string>(),
    breakdown: none, visible: none, selectedIndex: none, resolution: none,
};
const VIEWS = [
    { id: "spray", name: "SPRAY", narrowing: { ...NARROWING, search: some("spray") }, context: 0n, reveals: [], folds: new Map<string, boolean>() },
    { id: "router", name: "ROUTER", narrowing: { ...NARROWING, search: some("router") }, context: 0n, reveals: [], folds: new Map<string, boolean>() },
];

type SliceBindValue = ValueTypeOf<typeof Slice.Types.Bind>;

/** A sheet over a bound slice, a Link column searched through `Sheet.link.print`, two saved views, opening on `spray`. */
function buildLensSheet(): SheetRootValue {
    const program = East.function([], Sheet.Types.Root, ($) => {
        const rows = $.const(ROWS, ArrayType(JobType));
        const machines = $.const(MACHINES, ArrayType(MachineType));
        const views = $.const(VIEWS, ArrayType(Sheet.Types.View));
        const cfg = $.const(Slice.config(JobType, {
            fields: { activity: { label: "Activity" }, notes: { label: "Notes" }, stations: { label: "Work centres", text: (r) => Sheet.link.print(r.stations) } },
            searchFieldIds: ["activity", "notes", "stations"],
        }));
        const slice = $.let(Slice.bind([JobType], "sheet_lens_dom", cfg, Slice.state(), rows, none));
        return Sheet.Payload(rows, {
            activity: Sheet.column.text(JobType, { header: "Activity" }),
            notes: Sheet.column.text(JobType, { header: "Notes" }),
            stations: Sheet.column.set(JobType, "stations", { header: "Work centres", members: [{ kind: "machine", identified: true }, { kind: "family", countable: true }] }),
            qty: Sheet.column.quantity(JobType, { header: "Qty" }),
        }, {
            id: "id",
            registers: {
                stations: Sheet.register.concat([
                    Sheet.register.members(machines, { kind: "machine", key: (m) => m.code, label: (m) => m.code, meta: (m) => some(m.family) }),
                    Sheet.register.members(machines, { kind: "family", key: (m) => m.family, label: (m) => m.family }),
                ]),
            },
            slice, affordances: ["search"],
            views,
            activeView: some("spray"),
            blanks: 2,
        });
    });
    return East.compile(program, getRegisteredPlatformImplementations())();
}

// A keyed paged source, built by hand to the row-source contract — paged data
// is bound (`Data.bindPaged`), so no package produces one. 1,000 rows whose ids
// sort as they stream, `J10000` … `J10999`, so `seek` addresses real positions.
const Jobs = ArrayType(JobType);
const KEYED_ROWS: ValueTypeOf<typeof JobType>[] = Array.from({ length: 1_000 }, (_x, i) => ({
    id: `J${i + 10_000}`, activity: `Task ${i}`, notes: "", stations: { from: [], to: [] }, qty: none,
}));
const KEYED_IDS = KEYED_ROWS.map((r) => r.id);
const KEYED_PAGE = East.function([IntegerType, IntegerType], OptionType(Jobs), ($, offset, limit) => {
    const all = $.const(KEYED_ROWS, Jobs);
    const n = $.let(all.size());
    const start = $.let(offset.less(n).ifElse(() => offset, () => n));
    const end = $.let(start.add(limit).less(n).ifElse(() => start.add(limit), () => n));
    return some(all.slice(start, end));
});
const KEYED_TOTAL = East.function([], OptionType(IntegerType), ($) => {
    const all = $.const(KEYED_ROWS, Jobs);
    return some(all.size());
});
/**
 * Where a key query lands among the ids. Their order makes every query's
 * matches ONE contiguous run — `[lo, hi)` — so a hit is its first row and a
 * count, and a miss carries the row it would sit at. The ids are Strings:
 * leading struct fields name none of theirs, so `fields` matches only as its
 * prefix, and a range bounds on its first literal.
 */
const KEYED_SEEK = East.function([Paged.Types.SeekQuery], OptionType(Paged.Types.SeekRange), ($, query) => {
    const ids = $.const(KEYED_IDS, ArrayType(StringType));
    const lo = $.let(0n);
    const hi = $.let(0n);
    $.match(query, {
        key: ($2, literal) => {
            const k = $2.let(literal.parse(StringType));
            $2.assign(lo, ids.filter((_$, x) => x.less(k)).size());
            $2.assign(hi, ids.filter((_$, x) => x.lessEqual(k)).size());
        },
        prefix: ($2, p) => {
            $2.assign(lo, ids.filter((_$, x) => x.less(p)).size());
            $2.assign(hi, lo.add(ids.filter((_$, x) => x.startsWith(p)).size()));
        },
        fields: ($2, f) => {
            $2.if(f.values.size().equal(0n), ($3) => {
                const p = $3.let(f.prefix.unwrap("some", () => ""));
                $3.assign(lo, ids.filter((_$, x) => x.less(p)).size());
                $3.assign(hi, lo.add(ids.filter((_$, x) => x.startsWith(p)).size()));
            });
        },
        range: ($2, r) => {
            $2.if(r.from.size().greater(0n), ($3) => {
                const from = $3.let(r.from.get(0n).parse(StringType));
                $3.assign(lo, ids.filter((_$, x) => x.less(from)).size());
            });
            $2.assign(hi, ids.size());
            $2.if(r.to.size().greater(0n), ($3) => {
                const to = $3.let(r.to.get(0n).parse(StringType));
                $3.assign(hi, ids.filter((_$, x) => x.less(to)).size());
            });
            $2.if(hi.less(lo), ($3) => { $3.assign(hi, lo); });
        },
    });
    return some({ found: hi.greater(lo), row: lo, count: hi.subtract(lo) });
});
const KEYED_SOURCE = { id: "sheet_lens_keyed_1000", page: KEYED_PAGE, total: KEYED_TOTAL, seek: some(KEYED_SEEK) };

/** A paged sheet over the keyed source. */
function buildKeyed(): SheetRootValue {
    const program = East.function([], Sheet.Types.Root, ($) => {
        const source = $.const(KEYED_SOURCE, Paged.Types.Source(Jobs));
        return Sheet.Payload(source, {
            activity: Sheet.column.text(JobType, { header: "Activity" }),
        }, { id: "id", blanks: 2 });
    });
    return East.compile(program, getRegisteredPlatformImplementations())();
}

/** Swap the host callback for a spy after compilation — the renderer takes every function from the value. */
function withViewsSpy(root: SheetRootValue) {
    const changes: SheetViewValue[][] = [];
    const value: SheetRootValue = { ...root, onViewsChange: some((v: SheetViewValue[]) => { changes.push(v); return null; }) } as SheetRootValue;
    return { value, changes };
}

/** The compiled slice handle riding the value's chrome. */
function getSliceHandle(value: SheetRootValue): SliceBindValue {
    if (value.slice.type !== "some") throw new Error("the sheet binds no slice");
    return value.slice.value.slice;
}

function mount(value: SheetRootValue) {
    const utils = render(
        <ChakraProvider value={system}>
            <EastChakraSheet value={value} storageKey="sheet-lens-test" />
        </ChakraProvider>,
    );
    const root = () => utils.container.querySelector("[data-sheet]") as HTMLElement;
    const rows = () => [...utils.container.querySelectorAll('[data-slot="row"]:not([data-blank])')] as HTMLElement[];
    const numbers = () => rows().map((r) => r.querySelector('[data-slot="gutterNumber"]')!.textContent);
    const hits = () => [...utils.container.querySelectorAll('[data-slot="gutterNumber"][data-hit]')].map((n) => n.textContent);
    const gaps = () => [...utils.container.querySelectorAll('[data-slot="band"][data-band="lens"]')].map((b) => b.querySelector('[data-slot="bandCount"]')!.textContent);
    const count = () => utils.container.querySelector('[data-slot="toolbarCount"]')?.textContent ?? "";
    const tab = (id: string) => utils.container.querySelector(`[data-slot="tab"][data-tab="${id}"]`) as HTMLElement | null;
    const tabs = () => [...utils.container.querySelectorAll('[data-slot="tab"]')].map((t) => t.getAttribute("data-tab"));
    const searchInput = () => utils.container.querySelector('[data-slot="toolbarRail"] input') as HTMLInputElement;
    const slice = () => getSliceHandle(value);
    const flush = () => act(async () => { await new Promise<void>((r) => queueMicrotask(r)); });
    return { ...utils, root, rows, numbers, hits, gaps, count, tab, tabs, searchInput, slice, flush };
}

/** A row's cell by key — null while its row is not mounted. */
const cellOf = (container: HTMLElement, id: string, key: string) => container.querySelector<HTMLElement>(`[data-row-id="${id}"] [data-slot="cell"][data-key="${key}"]`);

describe("the lens (B§8)", () => {
    test("the active view's search draws hits with brand numbers, the rest collapse into bands; no blank tail; the count and the tabs", async () => {
        const { container, root, numbers, hits, gaps, count, tab, tabs } = mount(buildLensSheet());
        await waitFor(() => expect(root().hasAttribute("data-lens")).toBe(true));
        // Spraying rows are 2 · 5 · 8 · 11 (1-based) — the only rows shown under ±0.
        expect(numbers()).toEqual(["2", "5", "8", "11"]);
        expect(hits()).toEqual(["2", "5", "8", "11"]);
        expect(gaps()).toEqual(["1 hidden", "2 hidden", "2 hidden", "2 hidden", "1 hidden"]);
        expect(container.querySelectorAll('[data-slot="row"][data-blank]')).toHaveLength(0);
        expect(count()).toBe("4 matches");
        expect(tabs()).toEqual(["all", "spray", "router"]);
        expect(tab("spray")!.hasAttribute("data-active")).toBe(true);
        expect(tab("all")!.querySelector('[data-slot="tabCount"]')!.textContent).toBe("12");
        expect(tab("spray")!.querySelector('[data-slot="tabCount"]')!.textContent).toBe("4");
        expect(tab("router")!.querySelector('[data-slot="tabCount"]')!.textContent).toBe("1");
        expect(tab("spray")!.hasAttribute("data-dirty")).toBe(false);
        // The context switch widens the window; the count reads matches · context.
        fireEvent.mouseDown(container.querySelector('[data-slot="contextOption"][data-context="1"]')!, { button: 0 });
        expect(numbers()).toEqual(["1", "2", "3", "4", "5", "6", "7", "8", "9", "10", "11", "12"]);
        expect(hits()).toEqual(["2", "5", "8", "11"]);
        expect(count()).toBe("4 matches · 8 context");
        expect(gaps()).toEqual([]);
    });

    test("band controls open a run a little at a time — 1, then 3 — as a merged set; the whole run with `all`", async () => {
        const { container, root, numbers, gaps } = mount(buildLensSheet());
        await waitFor(() => expect(root().hasAttribute("data-lens")).toBe(true));
        const band = (i: number) => container.querySelectorAll('[data-slot="band"][data-band="lens"]')[i]!;
        // The second band hides rows 3 and 4: `+1` from its top reveals row 3.
        expect(band(1).querySelector('[data-slot="bandControl"][data-where="top"]')!.textContent).toBe("+1");
        fireEvent.mouseDown(band(1).querySelector('[data-slot="bandControl"][data-where="top"]')!, { button: 0 });
        expect(numbers()).toEqual(["2", "3", "5", "8", "11"]);
        expect(gaps()).toEqual(["1 hidden", "1 hidden", "2 hidden", "2 hidden", "1 hidden"]);
        // The band kept its identity: the next press would reach 3, capped to the run.
        expect(band(1).querySelector('[data-slot="bandControl"][data-where="top"]')!.textContent).toBe("+1");
        fireEvent.mouseDown(band(1).querySelector('[data-slot="bandControl"][data-where="top"]')!, { button: 0 });
        expect(numbers()).toEqual(["2", "3", "4", "5", "8", "11"]);
        // `all` on the last band.
        fireEvent.mouseDown(band(3).querySelector('[data-slot="bandControl"][data-where="all"]')!, { button: 0 });
        expect(numbers()).toEqual(["2", "3", "4", "5", "8", "11", "12"]);
        // A context change resets the reveals.
        fireEvent.mouseDown(container.querySelector('[data-slot="contextOption"][data-context="1"]')!, { button: 0 });
        fireEvent.mouseDown(container.querySelector('[data-slot="contextOption"][data-context="0"]')!, { button: 0 });
        expect(numbers()).toEqual(["2", "5", "8", "11"]);
    });

    test("a Link column is searched through its text projection; a narrowing change resets the reveals", async () => {
        const { root, numbers, hits, gaps, slice } = mount(buildLensSheet());
        await waitFor(() => expect(root().hasAttribute("data-lens")).toBe(true));
        act(() => { slice().setSearch(some("router")); });
        await waitFor(() => expect(hits()).toEqual(["2"]));   // `2 x CNC router`
        expect(numbers()).toEqual(["2"]);
        expect(gaps()).toEqual(["1 hidden", "10 hidden"]);
        act(() => { slice().setSearch(some("r2141")); });
        await waitFor(() => expect(hits()).toEqual(["6"]));
        act(() => { slice().setSearch(some("urgent")); });
        await waitFor(() => expect(hits()).toEqual(["5"]));
    });
});

describe("the view tabs (B§8)", () => {
    test("editing the query marks the tab dirty; + TAB snapshots it (named from the query) and the host hears onViewsChange; All clears the narrowing; × closes", async () => {
        const { value, changes } = withViewsSpy(buildLensSheet());
        const { container, root, tab, tabs, slice, flush } = mount(value);
        await waitFor(() => expect(root().hasAttribute("data-lens")).toBe(true));
        act(() => { slice().setSearch(some("router")); });
        await waitFor(() => expect(tab("spray")!.hasAttribute("data-dirty")).toBe(true));
        expect(container.querySelector('[data-slot="tabDot"]')).toBeTruthy();
        fireEvent.mouseDown(container.querySelector('[data-slot="tabAdd"]')!, { button: 0 });
        await flush();
        expect(tabs()).toEqual(["all", "spray", "router", "view-1"]);
        expect(tab("view-1")!.hasAttribute("data-active")).toBe(true);
        expect(tab("view-1")!.textContent).toMatch(/^router1/);
        expect(changes).toHaveLength(1);
        expect(changes[0]!.map((v) => v.id)).toEqual(["spray", "router", "view-1"]);
        expect(changes[0]![2]!.name).toBe("router");
        expect(changes[0]![2]!.narrowing.search).toEqual(some("router"));
        // The whole sheet: the narrowing clears, the lens goes, the blank tail returns.
        fireEvent.mouseDown(tab("all")!, { button: 0 });
        await waitFor(() => expect(root().hasAttribute("data-lens")).toBe(false));
        expect(slice().read().search).toEqual(none);
        expect(container.querySelectorAll('[data-slot="row"][data-blank]')).toHaveLength(2);
        expect(tab("all")!.hasAttribute("data-active")).toBe(true);
        // × closes a tab; a middle click too.
        fireEvent.mouseDown(tab("view-1")!.querySelector('[data-slot="tabClose"]')!, { button: 0 });
        await flush();
        expect(tabs()).toEqual(["all", "spray", "router"]);
        fireEvent(tab("router")!, new MouseEvent("auxclick", { button: 1, bubbles: true }));
        await flush();
        expect(tabs()).toEqual(["all", "spray"]);
        expect(changes.at(-1)!.map((v) => v.id)).toEqual(["spray"]);
    });

    test("⏎ in the search updates a dirty tab, esc reverts it, esc on a clean tab returns to the sheet; a double click renames", async () => {
        const { value, changes } = withViewsSpy(buildLensSheet());
        const { container, root, tab, searchInput, slice, flush } = mount(value);
        await waitFor(() => expect(root().hasAttribute("data-lens")).toBe(true));
        act(() => { slice().setSearch(some("router")); });
        await waitFor(() => expect(tab("spray")!.hasAttribute("data-dirty")).toBe(true));
        fireEvent.keyDown(searchInput(), { key: "Escape" });
        await waitFor(() => expect(tab("spray")!.hasAttribute("data-dirty")).toBe(false));
        expect(slice().read().search).toEqual(some("spray"));
        act(() => { slice().setSearch(some("wrapp")); });
        await waitFor(() => expect(tab("spray")!.hasAttribute("data-dirty")).toBe(true));
        fireEvent.keyDown(searchInput(), { key: "Enter" });
        await flush();
        await waitFor(() => expect(tab("spray")!.hasAttribute("data-dirty")).toBe(false));
        expect(changes.at(-1)![0]!.narrowing.search).toEqual(some("wrapp"));
        expect(container.querySelector('[data-slot="footerMessage"]')!.textContent).toBe('Tab "SPRAY" now saves this search');
        // esc on the clean tab: back to the whole sheet.
        fireEvent.keyDown(searchInput(), { key: "Escape" });
        await waitFor(() => expect(tab("all")!.hasAttribute("data-active")).toBe(true));
        expect(slice().read().search).toEqual(none);
        // Rename.
        fireEvent.doubleClick(tab("router")!);
        const input = container.querySelector('[data-slot="tabRename"]') as HTMLInputElement;
        expect(input.value).toBe("ROUTER");
        fireEvent.change(input, { target: { value: "Moulding" } });
        fireEvent.keyDown(input, { key: "Enter" });
        await flush();
        expect(tab("router")!.textContent).toMatch(/^Moulding/);
        expect(changes.at(-1)![1]!.name).toBe("Moulding");
    });
});

describe("the paged arm's key search (§3.13)", () => {
    test("a keyed source mounts the key search in the toolbar; a match jumps the source and lands the ring on the row; next steps to the following match", async () => {
        // 600 rows land, so the sheet mounts what the page shows (#856): the page scrolls to the ring.
        const restoreRows = measureRowsAsDrawn();
        const restore = emulateWindowScroll();
        try {
            const { container } = mount(buildKeyed());
            await waitFor(() => expect(container.querySelector('[data-slot="footerTransport"]')!.textContent).toBe("600 loaded of 1,000"), { timeout: 15_000 });
            const search = container.querySelector('[data-part="dataset-key-search"]')!;
            expect(search).toBeTruthy();
            const input = search.querySelector("input") as HTMLInputElement;
            // Typed a key at a time (the control debounces into one prefix query): J10230 … J10239.
            // Each keystroke is confirmed before the next: the combobox input is
            // controlled, so a re-render that lands late leaves userEvent appending
            // to a stale value, which swallows a character (a loaded CI runner typed
            // "J123", which matches nothing).
            for (const key of "J1023") {
                const typed = input.value + key;
                await userEvent.type(input, key);
                await waitFor(() => expect(input.value).toBe(typed));
            }
            await waitFor(() => expect(search.textContent).toMatch(/10 matches/), { timeout: 5_000 });
            fireEvent.keyDown(input, { key: "Enter" });
            await waitFor(() => expect(cellOf(container, "J10230", "activity")?.hasAttribute("data-selected")).toBe(true), { timeout: 5_000 });
            expect(search.textContent).toMatch(/1 of 10/);
            fireEvent.click(search.querySelector('[aria-label="Next match"]')!);
            await waitFor(() => expect(cellOf(container, "J10231", "activity")?.hasAttribute("data-selected")).toBe(true), { timeout: 5_000 });
            expect(search.textContent).toMatch(/2 of 10/);
        } finally {
            restore();
            restoreRows();
        }
    }, 30_000);
});
