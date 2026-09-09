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
    ArrayType, East, FloatType, OptionType, StringType, StructType,
    none, some, variant, type ValueTypeOf,
} from "@elaraai/east";
import { Paged } from "@elaraai/east-ui";
import { Sheet, Slice, UIComponentType } from "@elaraai/east-ui/internal";
import { system } from "../../theme/index.js";
import { initializeStore } from "../../platform/state-runtime.js";
import { UIStore } from "../../platform/state-store.js";
import { getRegisteredPlatformImplementations } from "../../platform/registry.js";
import "../../platform/slice/index.js";
import { EastChakraSheet } from "./index.js";
import type { SheetRootValue, SheetViewValue } from "./values.js";

afterEach(cleanup);
beforeEach(() => { initializeStore(new UIStore()); });

// jsdom lacks the browser APIs Chakra's Combobox positioner relies on.
class ResizeObserverStub { observe() {} unobserve() {} disconnect() {} }
(globalThis as unknown as { ResizeObserver?: unknown }).ResizeObserver ??= ResizeObserverStub;

const JobType = StructType({ id: StringType, activity: StringType, notes: StringType, stations: Sheet.Types.Link, qty: OptionType(FloatType) });
const MachineType = StructType({ code: StringType, family: StringType });

/** Fixtures at MODULE scope: East bodies never call host helpers. */
const ACTIVITIES = ["Machining", "Painting", "Packaging"];
const ROWS = Array.from({ length: 12 }, (_x, i) => ({
    id: `j${i}`,
    activity: ACTIVITIES[i % 3]!,
    notes: i === 4 ? "urgent — inspect before shipping" : `lot ${100 + i}`,
    stations: i === 1 ? { from: [], to: [variant("counted", { n: 2n, key: "CNC lathe" })] }
        : i === 5 ? { from: [], to: [variant("identified", { key: "M2141" })] }
            : i === 0 ? { from: [], to: [variant("identified", { key: "M2140" })] }
                : { from: [], to: [] },
    qty: some(100 + i * 10),
}));
const MACHINES = [{ code: "M2140", family: "CNC lathe" }, { code: "M2141", family: "CNC lathe" }];
const NARROW = (search: string) => ({
    range: none, compare: none, filters: [], cohorts: [], activeCohorts: new Set<string>(),
    breakdown: none, search: some(search), visible: none, selectedIndex: none, resolution: none,
});
const VIEWS = [
    { id: "paint", name: "PAINT", narrowing: NARROW("paint"), context: 0n, reveals: [] },
    { id: "lathe", name: "LATHE", narrowing: NARROW("lathe"), context: 0n, reveals: [] },
];

type SliceBindValue = ValueTypeOf<typeof Slice.Types.Bind>;

/** A sheet over a bound slice, a Link column searched through `Sheet.link.print`, two saved views, opening on `paint`. */
function buildLensSheet(): SheetRootValue {
    const program = East.function([], UIComponentType, ($) => {
        const rows = $.const(ROWS, ArrayType(JobType));
        const machines = $.const(MACHINES, ArrayType(MachineType));
        const views = $.const(VIEWS, ArrayType(Sheet.Types.View));
        const cfg = $.const(Slice.config(JobType, {
            fields: { activity: { label: "Activity" }, notes: { label: "Notes" }, stations: { label: "Work centres", text: (r) => Sheet.link.print(r.stations) } },
            searchFieldIds: ["activity", "notes", "stations"],
        }));
        const slice = $.let(Slice.bind([JobType], "sheet_lens_dom", cfg, Slice.state(), rows, none));
        return Sheet.Root(rows, {
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
            activeView: some("paint"),
            blanks: 2,
        });
    });
    const value = East.compile(program, getRegisteredPlatformImplementations())() as
        ValueTypeOf<typeof UIComponentType> & { value: SheetRootValue };
    return value.value;
}

/** A keyed paged source of `n` rows whose ids sort as they stream, so `seek` addresses real positions. */
function buildKeyed(n: number): SheetRootValue {
    const program = East.function([], UIComponentType, ($) => {
        const rows = $.let(East.Array.range(0n, BigInt(n)).map(($2, i) => $2.const({
            id: East.str`J${i.add(10000n)}`, activity: East.str`Task ${i}`, notes: "", stations: { from: [], to: [] }, qty: none,
        }, JobType)), ArrayType(JobType));
        const source = $.const(Paged.of(`sheet_lens_keyed_${n}`, rows, { key: (r) => r.id }));
        return Sheet.Root(source, {
            activity: Sheet.column.text(JobType, { header: "Activity" }),
        }, { id: "id", blanks: 2 });
    });
    const value = East.compile(program, getRegisteredPlatformImplementations())() as
        ValueTypeOf<typeof UIComponentType> & { value: SheetRootValue };
    return value.value;
}

/** Swap the host callback for a spy after compilation — the renderer takes every function from the value. */
function withViewsSpy(root: SheetRootValue) {
    const changes: SheetViewValue[][] = [];
    const value: SheetRootValue = { ...root, onViewsChange: some((v: SheetViewValue[]) => { changes.push(v); return null; }) } as SheetRootValue;
    return { value, changes };
}

/** The compiled slice handle riding the value's chrome. */
function getSliceHandle(value: SheetRootValue): SliceBindValue {
    const chrome = value.slice as { type: string; value: { slice: SliceBindValue } };
    return chrome.value.slice;
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

/** A row's cell by key. */
const cellOf = (container: HTMLElement, id: string, key: string) => container.querySelector(`[data-row-id="${id}"] [data-slot="cell"][data-key="${key}"]`) as HTMLElement;

describe("the lens (B§8)", () => {
    test("the active view's search draws hits with brand numbers, the rest collapse into bands; no blank tail; the count and the tabs", async () => {
        const { container, root, numbers, hits, gaps, count, tab, tabs } = mount(buildLensSheet());
        await waitFor(() => expect(root().hasAttribute("data-lens")).toBe(true));
        // Painting rows are 2 · 5 · 8 · 11 (1-based) — the only rows shown under ±0.
        expect(numbers()).toEqual(["2", "5", "8", "11"]);
        expect(hits()).toEqual(["2", "5", "8", "11"]);
        expect(gaps()).toEqual(["1 hidden", "2 hidden", "2 hidden", "2 hidden", "1 hidden"]);
        expect(container.querySelectorAll('[data-slot="row"][data-blank]')).toHaveLength(0);
        expect(count()).toBe("4 matches");
        expect(tabs()).toEqual(["all", "paint", "lathe"]);
        expect(tab("paint")!.hasAttribute("data-active")).toBe(true);
        expect(tab("all")!.querySelector('[data-slot="tabCount"]')!.textContent).toBe("12");
        expect(tab("paint")!.querySelector('[data-slot="tabCount"]')!.textContent).toBe("4");
        expect(tab("lathe")!.querySelector('[data-slot="tabCount"]')!.textContent).toBe("1");
        expect(tab("paint")!.hasAttribute("data-dirty")).toBe(false);
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
        act(() => { slice().setSearch(some("lathe")); });
        await waitFor(() => expect(hits()).toEqual(["2"]));   // `2 x CNC lathe`
        expect(numbers()).toEqual(["2"]);
        expect(gaps()).toEqual(["1 hidden", "10 hidden"]);
        act(() => { slice().setSearch(some("m2141")); });
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
        act(() => { slice().setSearch(some("lathe")); });
        await waitFor(() => expect(tab("paint")!.hasAttribute("data-dirty")).toBe(true));
        expect(container.querySelector('[data-slot="tabDot"]')).toBeTruthy();
        fireEvent.mouseDown(container.querySelector('[data-slot="tabAdd"]')!, { button: 0 });
        await flush();
        expect(tabs()).toEqual(["all", "paint", "lathe", "view-1"]);
        expect(tab("view-1")!.hasAttribute("data-active")).toBe(true);
        expect(tab("view-1")!.textContent).toMatch(/^lathe1/);
        expect(changes).toHaveLength(1);
        expect(changes[0]!.map((v) => v.id)).toEqual(["paint", "lathe", "view-1"]);
        expect(changes[0]![2]!.name).toBe("lathe");
        expect(changes[0]![2]!.narrowing.search).toEqual(some("lathe"));
        // The whole sheet: the narrowing clears, the lens goes, the blank tail returns.
        fireEvent.mouseDown(tab("all")!, { button: 0 });
        await waitFor(() => expect(root().hasAttribute("data-lens")).toBe(false));
        expect(slice().read().search).toEqual(none);
        expect(container.querySelectorAll('[data-slot="row"][data-blank]')).toHaveLength(2);
        expect(tab("all")!.hasAttribute("data-active")).toBe(true);
        // × closes a tab; a middle click too.
        fireEvent.mouseDown(tab("view-1")!.querySelector('[data-slot="tabClose"]')!, { button: 0 });
        await flush();
        expect(tabs()).toEqual(["all", "paint", "lathe"]);
        fireEvent(tab("lathe")!, new MouseEvent("auxclick", { button: 1, bubbles: true }));
        await flush();
        expect(tabs()).toEqual(["all", "paint"]);
        expect(changes.at(-1)!.map((v) => v.id)).toEqual(["paint"]);
    });

    test("⏎ in the search updates a dirty tab, esc reverts it, esc on a clean tab returns to the sheet; a double click renames", async () => {
        const { value, changes } = withViewsSpy(buildLensSheet());
        const { container, root, tab, searchInput, slice, flush } = mount(value);
        await waitFor(() => expect(root().hasAttribute("data-lens")).toBe(true));
        act(() => { slice().setSearch(some("lathe")); });
        await waitFor(() => expect(tab("paint")!.hasAttribute("data-dirty")).toBe(true));
        fireEvent.keyDown(searchInput(), { key: "Escape" });
        await waitFor(() => expect(tab("paint")!.hasAttribute("data-dirty")).toBe(false));
        expect(slice().read().search).toEqual(some("paint"));
        act(() => { slice().setSearch(some("packag")); });
        await waitFor(() => expect(tab("paint")!.hasAttribute("data-dirty")).toBe(true));
        fireEvent.keyDown(searchInput(), { key: "Enter" });
        await flush();
        await waitFor(() => expect(tab("paint")!.hasAttribute("data-dirty")).toBe(false));
        expect(changes.at(-1)![0]!.narrowing.search).toEqual(some("packag"));
        expect(container.querySelector('[data-slot="footerMessage"]')!.textContent).toBe('Tab "PAINT" now saves this search');
        // esc on the clean tab: back to the whole sheet.
        fireEvent.keyDown(searchInput(), { key: "Escape" });
        await waitFor(() => expect(tab("all")!.hasAttribute("data-active")).toBe(true));
        expect(slice().read().search).toEqual(none);
        // Rename.
        fireEvent.doubleClick(tab("lathe")!);
        const input = container.querySelector('[data-slot="tabRename"]') as HTMLInputElement;
        expect(input.value).toBe("LATHE");
        fireEvent.change(input, { target: { value: "Turning" } });
        fireEvent.keyDown(input, { key: "Enter" });
        await flush();
        expect(tab("lathe")!.textContent).toMatch(/^Turning/);
        expect(changes.at(-1)![1]!.name).toBe("Turning");
    });
});

describe("the paged arm's key search (§3.13)", () => {
    test("a keyed source mounts the key search in the toolbar; a match jumps the source and lands the ring on the row; next steps to the following match", async () => {
        const { container } = mount(buildKeyed(1_000));
        await waitFor(() => {
            expect(container.querySelectorAll('[data-slot="row"]:not([data-blank])').length).toBe(600);
        }, { timeout: 15_000 });
        const search = container.querySelector('[data-part="dataset-key-search"]')!;
        expect(search).toBeTruthy();
        const input = search.querySelector("input") as HTMLInputElement;
        // Typed a key at a time (the control debounces into one prefix query): J10230 … J10239.
        await userEvent.type(input, "J1023", { delay: 10 });
        await waitFor(() => expect(search.textContent).toMatch(/10 matches/), { timeout: 5_000 });
        fireEvent.keyDown(input, { key: "Enter" });
        await waitFor(() => expect(cellOf(container, "J10230", "activity").hasAttribute("data-selected")).toBe(true), { timeout: 5_000 });
        expect(search.textContent).toMatch(/1 of 10/);
        fireEvent.click(search.querySelector('[aria-label="Next match"]')!);
        await waitFor(() => expect(cellOf(container, "J10231", "activity").hasAttribute("data-selected")).toBe(true), { timeout: 5_000 });
        expect(search.textContent).toMatch(/2 of 10/);
    }, 30_000);
});
