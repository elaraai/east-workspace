/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 *
 * @vitest-environment jsdom
 *
 * `<Studio.Builder>` rendered (#1000) over a pages record in memory, whose
 * patch door applies each patch with East's own checks — every part drawn by
 * the builder's renderer. The palette (#994): its tabs and rail (B1), the
 * search, the grouping and the Filter menu (B2), the cards by category (B3),
 * the placed component (B4), a card's click and the drag source (B5), the
 * Pages tab (B6), what is hidden and narrowed (B7). The canvas (#995): the one
 * toolbar and the page's status (B8), the selection bar (B9), the grid panel
 * (B10), a dropped card's cell (B11), Apply as one patch commit and a conflict
 * (B12), the panes (B13), Preview, Publish, Desktop and Tablet (B14). The
 * inspector (#996): its pane and rail (B15), the selected placement
 * (B16–B18), its layout edits (B20, B12), nothing selected (B21), and the
 * palette counting unsaved drafts. Save as template (D7, #997). The publish
 * preview (#998), in the canvas's place: its bar (E1), the page (E2), the
 * aside (E3–E5) and the footer (E6). The toolbar on a row short of room
 * (#1229): its ladder, the ⋯ chip's bundle and menu, and Save as template
 * hung from the chip.
 */

import { describe, test, expect, beforeEach, afterEach, beforeAll, afterAll, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { ChakraProvider } from "@chakra-ui/react";
import {
    East, PatchType, SortedMap, applyFor, compareFor, decodeBeast2For, diffFor, encodeBeast2For, none, some, variant,
    type ValueTypeOf,
} from "@elaraai/east";
import { Reactive, Text, UIComponentType } from "@elaraai/east-ui/internal";
import {
    DragLayerProvider, EastChakraComponent, StateRuntime, UIStore, getRegisteredPlatformImplementations, system,
} from "@elaraai/east-ui-components";
import {
    RecordBindHandleType, Studio, StudioKeyType, StudioPagesType, builderKeys, fingerprintOf, recordBindPlatformFn,
} from "@elaraai/e3-ui/internal";
import {
    ReactiveDatasetCache, createInMemoryRecordApi, datasetCacheKey, initializeReactiveDatasetCache, initializeRecordApi,
    type DatasetApi, type RecordApi,
} from "../platform/index.js";
import { studioMessages } from "./messages.js";
// The builder is an extension: its renderer registers as it loads.
import "./builder.js";

type Key = ValueTypeOf<typeof Studio.Types.Key>;
type Entry = ValueTypeOf<typeof Studio.Types.Entry>;
type Pages = ValueTypeOf<typeof Studio.Types.Pages>;

class ResizeObserverStub { observe() {} unobserve() {} disconnect() {} }
(globalThis as { ResizeObserver?: unknown }).ResizeObserver ??= ResizeObserverStub;
(globalThis as { matchMedia?: unknown }).matchMedia ??= (query: string) => ({
    matches: false, media: query, onchange: null,
    addListener() {}, removeListener() {}, addEventListener() {}, removeEventListener() {}, dispatchEvent() { return false; },
});
// The height select scrolls its open listbox to the chosen option; jsdom does not scroll.
Element.prototype.scrollTo ??= function scrollTo() { /* jsdom lays nothing out */ };
(globalThis as { CSS?: { escape?: (s: string) => string } }).CSS ??= {};
(globalThis as { CSS: { escape?: (s: string) => string } }).CSS.escape ??= (s: string) => s.replace(/[^\w-]/g, "\\$&");

const WORKSPACE = "builder-test";
const RECORD = "builder_pages";
const keys = compareFor(StudioKeyType);
const diffPages = diffFor(StudioPagesType);
const encodePatch = encodeBeast2For(PatchType(StudioPagesType));
const HandleType = RecordBindHandleType(StudioPagesType, { patch: [PatchType(StudioPagesType)] });

/** The components' code — the fingerprints a live version's cells store. */
const kpiFn = East.function([], UIComponentType, (_$) => Text.Root("KPIs"));
const trendFn = East.function([], UIComponentType, (_$) => Reactive.Root(East.function([], UIComponentType, ($) => {
    const pages = $.let(recordBindPlatformFn([HandleType], RECORD));
    return Text.Root(East.str`${East.print(pages.read().size())} pages`);
})));
const ordersFn = East.function([], UIComponentType, (_$) => Text.Root("Orders"));
const barsFn = East.function([], UIComponentType, (_$) => Text.Root("Bars"));
const kpiPrint = fingerprintOf(kpiFn);
const trendPrint = fingerprintOf(trendFn);
const ordersPrint = fingerprintOf(ordersFn);

/** The listed components: four offered — the trend's code reads the pages record — and a deprecated one that is not. */
const components = [
    Studio.component("kpi_rail", { name: "KPI rail", category: "Display", icon: "gauge-high", tags: ["kpi", "sales"] }, kpiFn),
    Studio.component("revenue_trend", {
        name: "Revenue trend", category: "Charts", icon: "chart-area", span: 8n, description: "Weekly revenue, as an area.",
        tags: ["sales"], collections: ["Finance"],
    }, trendFn),
    Studio.component("orders_by_week", { name: "Orders by week", category: "Charts", icon: "chart-column", span: 6n, tags: ["orders"] }, ordersFn),
    Studio.component("breakdown_bars", { name: "Breakdown bars", category: "Display", icon: "chart-bar", span: 4n }, barsFn),
    Studio.component("orders_table_v1", { name: "Legacy table", category: "Display", icon: "table", deprecated: true },
        East.function([], UIComponentType, (_$) => Text.Root("Rows"))),
];

const OVERVIEW: Key = { project: "ops", page: "a-overview" };
const REGIONAL: Key = { project: "ops", page: "f-regional" };

/**
 * In ops: the Overview (never published — the page the builder opens first),
 * the Weekly (live as v1, as it stands), the Monthly (live as v3, its draft
 * resized since and its component's code changed since), the Double (the trend
 * placed twice), a template, and the Regional (live as v3; its draft resizes
 * the trend and adds the bars). Another project's page.
 */
const PAGES: Pages = new SortedMap<Key, Entry>([
    [OVERVIEW, variant("page", {
        draft: {
            title: "Overview",
            cells: [
                { key: "c-kpi", row: "r1", span: 12n, height: none, align: variant("top", null), title: none, component: "kpi_rail", fingerprint: "" },
                { key: "c-trend", row: "r2", span: 8n, height: none, align: variant("top", null), title: none, component: "revenue_trend", fingerprint: "" },
            ],
        },
        live: none,
    })],
    [{ project: "ops", page: "b-weekly" }, variant("page", {
        draft: { title: "Weekly", cells: [{ key: "w-orders", row: "r1", span: 12n, height: none, align: variant("top", null), title: none, component: "orders_by_week", fingerprint: ordersPrint }] },
        live: some({ version: 1n, page: { title: "Weekly", cells: [{ key: "w-orders", row: "r1", span: 12n, height: none, align: variant("top", null), title: none, component: "orders_by_week", fingerprint: ordersPrint }] } }),
    })],
    [{ project: "ops", page: "c-monthly" }, variant("page", {
        draft: { title: "Monthly", cells: [{ key: "m-orders", row: "r1", span: 6n, height: none, align: variant("top", null), title: none, component: "orders_by_week", fingerprint: "" }] },
        live: some({ version: 3n, page: { title: "Monthly", cells: [{ key: "m-orders", row: "r1", span: 12n, height: none, align: variant("top", null), title: none, component: "orders_by_week", fingerprint: "" }] } }),
    })],
    [{ project: "ops", page: "d-double" }, variant("page", {
        draft: {
            title: "Double",
            cells: [
                { key: "d-trend-1", row: "r1", span: 6n, height: none, align: variant("top", null), title: none, component: "revenue_trend", fingerprint: "" },
                { key: "d-trend-2", row: "r1", span: 6n, height: none, align: variant("top", null), title: none, component: "revenue_trend", fingerprint: "" },
            ],
        },
        live: none,
    })],
    [{ project: "ops", page: "e-starter" }, variant("template", {
        title: "Starter",
        cells: [{ key: "s-kpi", row: "r1", span: 12n, height: none, align: variant("top", null), title: none, component: "kpi_rail", fingerprint: "" }],
    })],
    [REGIONAL, variant("page", {
        draft: {
            title: "Regional",
            cells: [
                { key: "p-kpi", row: "r1", span: 12n, height: none, align: variant("top", null), title: none, component: "kpi_rail", fingerprint: kpiPrint },
                { key: "p-trend", row: "r2", span: 8n, height: none, align: variant("top", null), title: none, component: "revenue_trend", fingerprint: trendPrint },
                { key: "p-bars", row: "r2", span: 4n, height: none, align: variant("top", null), title: none, component: "breakdown_bars", fingerprint: "" },
            ],
        },
        live: some({
            version: 3n,
            page: {
                title: "Regional",
                cells: [
                    { key: "p-kpi", row: "r1", span: 12n, height: none, align: variant("top", null), title: none, component: "kpi_rail", fingerprint: kpiPrint },
                    { key: "p-trend", row: "r2", span: 12n, height: none, align: variant("top", null), title: none, component: "revenue_trend", fingerprint: trendPrint },
                ],
            },
        }),
    })],
    [{ project: "retail", page: "home" }, variant("page", {
        draft: { title: "Home", cells: [] },
        live: some({ version: 1n, page: { title: "Home", cells: [] } }),
    })],
], keys);

let memory: RecordApi;
let cache: ReactiveDatasetCache;

beforeEach(() => {
    StateRuntime.initializeStore(new UIStore());
    const store = new Map<string, Uint8Array>();
    const api: DatasetApi = {
        async get(ws, path) {
            const bytes = store.get(datasetCacheKey(ws, path));
            if (!bytes) throw new Error(`no dataset ${datasetCacheKey(ws, path)}`);
            return { data: bytes, hash: null };
        },
        async set(ws, path, value) { store.set(datasetCacheKey(ws, path), value); },
        async launchDataflow() { /* in memory — nothing to launch */ },
        async listRoot() { return []; },
        async listAt() { return []; },
        async workspaceStatus() { return { datasets: [] }; },
    };
    cache = new ReactiveDatasetCache({ workspace: WORKSPACE }, api);
    cache.setScheduler((notify) => queueMicrotask(notify));
    initializeReactiveDatasetCache(cache);
    const applyPatch = applyFor(StudioPagesType);
    memory = createInMemoryRecordApi(cache, WORKSPACE, [{
        name: RECORD, stateType: StudioPagesType, initial: PAGES,
        mutations: [{ name: "patch", argTypes: [PatchType(StudioPagesType)], reduce: (state, patch) => applyPatch(state as never, patch as never) }],
    }]);
    initializeRecordApi(memory, cache, WORKSPACE);
});
afterEach(() => {
    cleanup();
    localStorage.clear();
});

/** Mount the builder over the record, as a surface mounts it, and let the record load. */
async function mountBuilder() {
    const program = East.compile(East.function([], UIComponentType, (_$) => Reactive.Root(East.function([], UIComponentType, ($) => {
        const listed = $.let(components);
        const record = $.let(recordBindPlatformFn([HandleType], RECORD));
        return Studio.Builder({
            pages: record as never, components: listed, project: "ops",
            env: "Staging", audience: "Field ops · 24 users", rollout: "Immediate",
        });
    }))), getRegisteredPlatformImplementations()) as () => ValueTypeOf<typeof UIComponentType>;
    const utils = render(
        <ChakraProvider value={system}>
            <DragLayerProvider>
                <EastChakraComponent value={program()} storageKey="studio-builder" />
            </DragLayerProvider>
        </ChakraProvider>,
    );
    await settle();
    return utils;
}

/** Let the record's reads, the session, the writes and the renders settle. */
async function settle() {
    await act(async () => {
        for (let i = 0; i < 8; i++) await new Promise<void>((resolve) => { setTimeout(resolve, 0); });
    });
}

/** Open a page, as the page library does. */
async function openPage(page: string) {
    await act(async () => {
        StateRuntime.getStore().write(builderKeys(undefined).page, encodeBeast2For(StudioKeyType)({ project: "ops", page }));
    });
    await settle();
}

/** The record as it stands — what its patch door last wrote. */
async function readRecord(): Promise<Pages> {
    const bytes = cache.read(WORKSPACE, [variant("field", "records"), variant("field", RECORD)]);
    if (bytes === undefined) throw new Error("the record has not loaded");
    return decodeBeast2For(StudioPagesType)(bytes);
}

/** The mutations the record committed, newest first. */
async function commits(): Promise<string[]> {
    return (await memory.history(WORKSPACE, RECORD, undefined)).commits.map((c) => c.mutation);
}

/** The toolbar's items, by key, in their order along the row. */
const toolbarItems = (c: HTMLElement) =>
    [...c.querySelectorAll("[data-frame-slot=toolbar] [data-toolbar-item]")].map((el) => el.getAttribute("data-toolbar-item"));
/** A toolbar item, by its key. */
const item = (c: HTMLElement, key: string) => c.querySelector<HTMLElement>(`[data-toolbar-item="${key}"]`)!;
/** A tile of the canvas. */
const tile = (c: HTMLElement, key: string) => c.querySelector<HTMLElement>(`[data-snap-grid-tile="${key}"]`)!;
/** The palette — the canvas's start pane, in its builder frame. */
const palette = (c: HTMLElement) => c.querySelector<HTMLElement>('[data-frame-slot="start"]')!;
/** A palette card, by the name on it. */
const cardOf = (c: HTMLElement, name: string) => within(palette(c)).getByText(name).closest("[data-clickable]") as HTMLElement;
/** The inspector's pane — the canvas's end pane, in its builder frame. */
const inspectorPane = (c: HTMLElement) => c.querySelector<HTMLElement>('[data-frame-slot="end"]')!;
/** The inspector's body, under its tab row. */
const inspector = (c: HTMLElement) => inspectorPane(c).querySelector<HTMLElement>("[data-studio-inspector]")!;
/** A tile's span, as the canvas draws it. */
const spanOf = (c: HTMLElement, key: string) => tile(c, key).style.getPropertyValue("--snap-grid-span");
/** The rows as the canvas draws them: each row's tiles, by key. */
const rowsDrawn = (c: HTMLElement) => [...c.querySelectorAll("[data-snap-grid-rows] [data-snap-grid-row]")]
    .map((row) => [...row.querySelectorAll("[data-snap-grid-tile]")].map((t) => t.getAttribute("data-snap-grid-tile")));

/** Select a placement on the canvas. */
async function select(c: HTMLElement, key: string) {
    await act(async () => { fireEvent.click(tile(c, key)); });
    await settle();
}

/** Select a tile, and press a key on it. */
async function keyOn(c: HTMLElement, key: string, init: { key: string }) {
    await act(async () => { fireEvent.click(tile(c, key)); });
    await act(async () => { fireEvent.keyDown(tile(c, key), init); });
    await settle();
}

/** Press a button by its name, as a pointer does. */
async function press(name: string) {
    const button = screen.getByRole("button", { name });
    await act(async () => {
        fireEvent.mouseDown(button, { button: 0 });
        fireEvent.click(button);
    });
    await settle();
}

/** Opens a menu from the keyboard, then arrows down to an item and picks it — Zag's pointer handling needs a real pointer. */
async function pickFromMenu(trigger: HTMLElement, name: string) {
    await act(async () => { trigger.focus(); fireEvent.keyDown(trigger, { key: "ArrowDown" }); });
    const menu = screen.getByRole("menu");
    for (let step = 0; step < 20 && menu.querySelector("[data-highlighted]")?.textContent !== name; step++) {
        await act(async () => { fireEvent.keyDown(menu, { key: "ArrowDown" }); });
    }
    await act(async () => { fireEvent.keyDown(menu, { key: "Enter" }); });
}

describe("<Studio.Builder> — the palette (#994)", () => {
    test("B1: the row holds the Components and Pages tabs and the collapse control; collapsed, the rail shows the icon, the count and the name", async () => {
        const { container } = await mountBuilder();
        const pane = within(palette(container));
        expect(pane.getAllByRole("tab").map((tab) => tab.textContent)).toEqual(["Components", "Pages"]);
        expect(pane.getAllByRole("tab")[0]!.getAttribute("aria-selected")).toBe("true");

        await act(async () => { fireEvent.click(screen.getByRole("button", { name: "Collapse Components" })); });
        expect(screen.getByRole("button", { name: "Expand Components" })).toBeTruthy();
        expect(pane.queryAllByRole("tab")).toHaveLength(0);
        expect(palette(container).querySelector("svg[data-icon=shapes]")).not.toBeNull();
        // Four components offered: the deprecated one is not counted.
        expect(pane.getByText("4")).toBeTruthy();
        expect(pane.getByText("Components")).toBeTruthy();
    }, 30_000);

    test("B2: the search counts the components, with its key; the grouping is by category; the Filter menu", async () => {
        const { container } = await mountBuilder();
        const pane = within(palette(container));
        expect(pane.getByPlaceholderText("Search 4 components…")).toBeTruthy();
        expect(within(pane.getByRole("tabpanel", { name: "Components" })).getByText("⌘ /")).toBeTruthy();
        expect(pane.getByRole("button", { name: "Group by" }).textContent).toBe("Group · Category");
        expect(pane.getByRole("button", { name: "Filter" })).toBeTruthy();
    }, 30_000);

    test("B3: cards by category, each group counted; a card holds its icon, its name, what it reads and a lock", async () => {
        const { container } = await mountBuilder();
        const heads = [...palette(container).querySelectorAll(`[data-library='${builderKeys(undefined).components}'] span`)]
            .filter((span) => span.textContent === "Display" || span.textContent === "Charts")
            .map((span) => `${span.textContent} ${span.nextElementSibling?.textContent}`);
        expect(heads).toEqual(["Display 2", "Charts 2"]);
        const trend = cardOf(container, "Revenue trend");
        expect(trend.querySelector("svg[data-icon=chart-area]")).not.toBeNull();
        expect(within(trend).getByText(RECORD)).toBeTruthy();
        expect(within(cardOf(container, "KPI rail")).getByText("no data")).toBeTruthy();
        expect(within(trend).getByRole("img", { name: "Logic fixed by the developer" })).toBeTruthy();
        expect(within(palette(container)).getAllByRole("img", { name: "Logic fixed by the developer" })).toHaveLength(4);
    }, 30_000);

    test("B4: the component the canvas has selected is placed, and counts its placements on the page", async () => {
        const { container } = await mountBuilder();
        await openPage("d-double");
        expect(cardOf(container, "Revenue trend").hasAttribute("data-placed")).toBe(false);
        await select(container, "d-trend-2");
        const trend = cardOf(container, "Revenue trend");
        expect(trend.hasAttribute("data-placed")).toBe(true);
        expect(within(trend).getByText("ON CANVAS · ×2")).toBeTruthy();
        expect(cardOf(container, "KPI rail").hasAttribute("data-placed")).toBe(false);
    }, 30_000);

    test("B5: a click selects the component's first placement; one the page does not place selects nothing new; the cards are drag sources", async () => {
        const { container } = await mountBuilder();
        expect(container.querySelector("[data-snap-grid-tile][data-selected]")).toBeNull();
        await act(async () => { fireEvent.click(cardOf(container, "Revenue trend")); });
        await settle();
        expect(tile(container, "c-trend").hasAttribute("data-selected")).toBe(true);
        await act(async () => { fireEvent.click(cardOf(container, "Orders by week")); });
        await settle();
        expect(tile(container, "c-trend").hasAttribute("data-selected")).toBe(true);
        expect(cardOf(container, "Orders by week").hasAttribute("data-draggable")).toBe(true);
    }, 30_000);

    test("B6: the Pages tab lists the project's pages with their status dots; the open page is placed; a click opens a page, with nothing selected", async () => {
        const { container } = await mountBuilder();
        await select(container, "c-trend");
        await act(async () => { fireEvent.click(within(palette(container)).getByRole("tab", { name: "Pages" })); });
        const pages = within(within(palette(container)).getByRole("tabpanel", { name: "Pages" }));
        expect(["Overview", "Weekly", "Monthly", "Double", "Regional"].every((title) => pages.queryByText(title) !== null)).toBe(true);
        expect(pages.queryByText("Starter")).toBeNull();
        expect(pages.queryByText("Home")).toBeNull();
        expect(pages.getByText("LIVE · V1")).toBeTruthy();
        expect(pages.getAllByText("DRAFT · V3 LIVE")).toHaveLength(2);
        expect(pages.getAllByRole("img", { name: "Live" })).toHaveLength(1);
        expect(pages.getAllByRole("img", { name: "Draft" })).toHaveLength(4);
        expect(cardOf(container, "Overview").hasAttribute("data-placed")).toBe(true);

        await act(async () => { fireEvent.click(pages.getByText("Weekly")); });
        await settle();
        expect([...container.querySelectorAll("[data-snap-grid-tile]")].map((t) => t.getAttribute("data-snap-grid-tile"))).toEqual(["w-orders"]);
        expect(cardOf(container, "Weekly").hasAttribute("data-placed")).toBe(true);
        expect(cardOf(container, "Overview").hasAttribute("data-placed")).toBe(false);
        expect(container.querySelector("[data-snap-grid-selection]")!.textContent).toBe("No selectionClick a component on the grid to arrange it");
        // The Weekly places no trend, so the trend's card has no placement to select.
        await act(async () => { fireEvent.click(within(palette(container)).getByRole("tab", { name: "Components" })); });
        await act(async () => { fireEvent.click(cardOf(container, "Revenue trend")); });
        await settle();
        expect(container.querySelector("[data-snap-grid-tile][data-selected]")).toBeNull();
    }, 30_000);

    test("B7: a deprecated component is hidden; the search and the Filter narrow the cards, and the counts follow", async () => {
        const { container } = await mountBuilder();
        const pane = within(palette(container));
        expect(pane.queryByText("Legacy table")).toBeNull();

        await act(async () => { fireEvent.change(pane.getByPlaceholderText("Search 4 components…"), { target: { value: "trend" } }); });
        expect(pane.getByText("Revenue trend")).toBeTruthy();
        expect(pane.queryByText("KPI rail")).toBeNull();
        expect(pane.queryByText("Orders by week")).toBeNull();
        const chartsHead = [...palette(container).querySelectorAll(`[data-library='${builderKeys(undefined).components}'] span`)]
            .find((span) => span.textContent === "Charts")!;
        expect(chartsHead.nextElementSibling?.textContent).toBe("1");
        await act(async () => { fireEvent.change(pane.getByPlaceholderText("Search 4 components…"), { target: { value: "" } }); });

        await pickFromMenu(pane.getByRole("button", { name: "Filter" }), "orders");
        expect(pane.getByText("Orders by week")).toBeTruthy();
        expect(pane.queryByText("Revenue trend")).toBeNull();
        expect(pane.queryByText("KPI rail")).toBeNull();
    }, 30_000);
});

describe("<Studio.Builder> — the canvas (#995)", () => {
    test("B8: one toolbar — the page's status and the grid chip; the width readout, the zoom, the history item, Desktop · Tablet, Save as template, Preview and Publish", async () => {
        const { container } = await mountBuilder();
        expect(toolbarItems(container)).toEqual(["status", "grid", "readout", "zoom", "rule", "history", "widths", "save-template", "preview", "publish"]);
        expect(item(container, "status").textContent).toBe("Draft");
        expect(item(container, "grid").textContent).toBe("12 col · snap on");
        expect(item(container, "readout").textContent).toBe("1440 px");
        expect(item(container, "zoom").textContent).toBe("100%");
        expect(within(item(container, "widths")).getAllByRole("button").map((b) => [b.textContent, b.getAttribute("aria-pressed")]))
            .toEqual([["Desktop", "true"], ["Tablet", "false"]]);
        expect(["save-template", "preview", "publish"].map((key) => item(container, key).textContent)).toEqual(["Save as template", "Preview", "Publish"]);
        // Headerless: nothing above the toolbar in the canvas's frame — the builder frame (#1125).
        const frame = container.querySelector("[data-snap-grid-editor]")!.firstElementChild!;
        expect(frame.hasAttribute("data-builder-frame")).toBe(true);
        expect(frame.firstElementChild!.getAttribute("data-frame-slot")).toBe("toolbar");
    }, 30_000);

    test("B8: the status is ○ Draft until a page is published, ● Live while its draft is its live layout, Live · edited once they differ, and Template for a template", async () => {
        const { container } = await mountBuilder();
        const status = () => item(container, "status").textContent;
        expect(status()).toBe("Draft");
        await openPage("b-weekly");
        expect(status()).toBe("Live");
        await openPage("c-monthly");
        expect(status()).toBe("Live · edited");
        await openPage("e-starter");
        expect(status()).toBe("Template");
    }, 30_000);

    test("B9: the selection bar names the selected placement — its component's icon and name, its key and what it reads; with none, what to do", async () => {
        const { container } = await mountBuilder();
        const bar = () => container.querySelector<HTMLElement>("[data-snap-grid-selection]")!;
        expect(bar().textContent).toBe("No selectionClick a component on the grid to arrange it");
        await select(container, "c-trend");
        expect(bar().querySelector("svg")!.getAttribute("data-icon")).toBe("chart-area");
        expect([...bar().children].slice(1).map((el) => el.textContent)).toEqual(["Revenue trend", `revenue_trend · ${RECORD}`]);
    }, 30_000);

    test("B10: the grid panel holds the page's cells on the editing canvas — each its component's own UI — with its guides and its end zone", async () => {
        const { container } = await mountBuilder();
        const main = container.querySelector("[data-snap-grid-main]")!;
        expect(main.querySelector("[data-snap-grid-canvas] [data-snap-grid-ruler]")).not.toBeNull();
        expect(main.querySelector("[data-snap-grid-end]")).not.toBeNull();
        expect([...main.querySelectorAll("[data-snap-grid-tile]")].map((t) => t.getAttribute("data-snap-grid-tile"))).toEqual(["c-kpi", "c-trend"]);
        expect(tile(container, "c-kpi").textContent).toBe("KPIs");
        await waitFor(() => expect(tile(container, "c-trend").textContent).toBe("7 pages"));
    }, 30_000);

    test("B11: a component dropped from the palette becomes a cell at its span, storing its fingerprint — Apply saves it", async () => {
        const { container } = await mountBuilder();
        const end = container.querySelector<HTMLElement>("[data-snap-grid-end]")!;
        await act(async () => {
            fireEvent.pointerDown(cardOf(container, "Orders by week"), { clientX: 0, clientY: 0 });
            (document as unknown as { elementFromPoint: () => Element | null }).elementFromPoint = () => end;
            fireEvent.pointerMove(document, { clientX: 10, clientY: 10 });
        });
        await act(async () => { fireEvent.pointerUp(document, { clientX: 10, clientY: 10 }); });
        await settle();
        const rows = rowsDrawn(container);
        expect(rows).toHaveLength(3);
        const dropped = rows[2]![0]!;
        expect(spanOf(container, dropped)).toBe("6");
        await press("Apply changes");
        const overview = (await readRecord()).get(OVERVIEW)!;
        if (overview.type !== "page") throw new Error("expected a page");
        const cell = overview.value.draft.cells.at(-1)!;
        expect([cell.key, cell.component, cell.span, cell.fingerprint]).toEqual([dropped, "orders_by_week", 6n, ordersPrint]);
    }, 30_000);

    test("B12: Apply is one patch commit on the page, and the toolbar says when it saved", async () => {
        const { container } = await mountBuilder();
        await keyOn(container, "c-trend", { key: "]" });
        expect(spanOf(container, "c-trend")).toBe("9");
        await press("Apply changes");
        expect(await commits()).toEqual(["patch", "$init"]);
        const overview = (await readRecord()).get(OVERVIEW)!;
        if (overview.type !== "page") throw new Error("expected a page");
        expect(overview.value.draft.cells.map((c) => [c.key, c.span])).toEqual([["c-kpi", 12n], ["c-trend", 9n]]);
        expect(container.querySelector("[data-snap-grid-saved]")!.textContent).toMatch(/^Saved · \d\d:\d\d$/);
        expect((screen.getByRole("button", { name: "Apply changes" }) as HTMLButtonElement).disabled).toBe(true);
    }, 30_000);

    test("B12: a save another landed first is a conflict, in the history item's words — and the other save stands", async () => {
        const { container } = await mountBuilder();
        await keyOn(container, "c-trend", { key: "[" });
        // Another operator's save lands between this Apply's read and its commit.
        const other = await readRecord();
        const before = other.get(OVERVIEW)!;
        if (before.type !== "page") throw new Error("expected a page");
        const after: Entry = variant("page", { draft: { title: before.value.draft.title, cells: before.value.draft.cells.slice(0, 1) }, live: before.value.live });
        const forward = memory.mutate.bind(memory);
        let raced = false;
        memory.mutate = async (ws, record, mutation, request) => {
            if (!raced) {
                raced = true;
                const patch = diffPages(new SortedMap([[OVERVIEW, before]], keys), new SortedMap([[OVERVIEW, after]], keys));
                await forward(ws, record, mutation, { args: [encodePatch(patch)] });
            }
            return forward(ws, record, mutation, request);
        };
        await press("Apply changes");
        // The commit is refused, and the canvas, reading the page back, finds its source moved under its drafts.
        expect(container.querySelector("[data-slot=history]")!.textContent).toContain("Source changed — review or discard these drafts");
        expect((screen.getByRole("button", { name: "Apply changes" }) as HTMLButtonElement).disabled).toBe(true);
        expect(await commits()).toEqual(["patch", "$init"]);
        const overview = (await readRecord()).get(OVERVIEW)!;
        if (overview.type !== "page") throw new Error("expected a page");
        expect(overview.value.draft.cells.map((c) => c.key)).toEqual(["c-kpi"]);
    }, 30_000);

    test("B13: the palette and the inspector sit either side of the canvas under the toolbar, and the palette collapses to its rail", async () => {
        const { container } = await mountBuilder();
        const body = container.querySelector("[data-frame-slot=toolbar]")!.nextElementSibling!;
        expect([...body.children].map((el) => el.getAttribute("data-frame-slot"))).toEqual(["start", "main", "end"]);
        expect(body.querySelector('[data-frame-slot="main"] > [data-snap-grid-main]')).not.toBeNull();
        await act(async () => { fireEvent.click(screen.getByRole("button", { name: "Collapse Components" })); });
        expect(body.querySelector('[data-frame-slot="start"] [data-collapsed]')).not.toBeNull();
        expect(screen.getByRole("button", { name: "Expand Components" })).toBeTruthy();
        expect(body.querySelector("[data-snap-grid-main] [data-snap-grid-tile]")).not.toBeNull();
    }, 30_000);

    test("B14: Preview and Publish open the publish preview in the canvas's place, the canvas kept as it was; Tablet draws the canvas at 1024px", async () => {
        const { container } = await mountBuilder();
        const canvas = () => container.querySelector<HTMLElement>("[data-studio-canvas]")!;
        expect(container.querySelector("[data-studio-publish]")).toBeNull();
        await press("Preview");
        expect(container.querySelector("[data-studio-publish]")).not.toBeNull();
        expect(canvas().hidden).toBe(true);
        expect(canvas().querySelector("[data-snap-grid-tile]")).not.toBeNull();
        await act(async () => { fireEvent.click(container.querySelector("[data-publish-exit]")!); });
        await settle();
        expect(container.querySelector("[data-studio-publish]")).toBeNull();
        expect(canvas().hidden).toBe(false);
        await press("Publish");
        expect(container.querySelector("[data-studio-publish]")).not.toBeNull();
        await act(async () => { fireEvent.click(container.querySelector("[data-publish-exit]")!); });
        await settle();

        const width = () => container.querySelector<HTMLElement>("[data-snap-grid-canvas]")!.style.maxWidth;
        expect(width()).toBe("1440px");
        await act(async () => { fireEvent.click(screen.getByRole("button", { name: "Tablet" })); });
        await settle();
        expect(width()).toBe("1024px");
        expect(item(container, "readout").textContent).toBe("1024 px");
    }, 30_000);
});

describe("<Studio.Builder> — the inspector (#996)", () => {
    test("B15, B21: a headerless pane — its one row the Inspector tab and its collapse control; with nothing selected it says what to do", async () => {
        const { container } = await mountBuilder();
        expect(within(inspectorPane(container)).getByText("Inspector").hasAttribute("data-selected")).toBe(true);
        expect(screen.getByRole("button", { name: "Collapse Inspector" }).getAttribute("aria-expanded")).toBe("true");
        expect(inspector(container).querySelector('[data-inspector="empty"]')!.textContent)
            .toBe("Nothing selectedClick a component on the grid to see what it reads and its layout.");
    }, 30_000);

    test("B15: collapsed, the rail — the sliders tile and the span badge in the brand while a placement is selected, and its name; else Nothing selected", async () => {
        const { container } = await mountBuilder();
        await press("Collapse Inspector");
        const detail = () => inspectorPane(container).querySelector<HTMLElement>("[data-dock-detail]")!;
        expect(detail().textContent).toBe("Nothing selected");
        expect(detail().parentElement!.hasAttribute("data-active")).toBe(false);
        await select(container, "c-trend");
        const rail = detail().parentElement!;
        expect(rail.hasAttribute("data-active")).toBe(true);
        expect([...rail.children].map((el) => el.textContent)).toEqual(["", "8/12", "Inspector", "Revenue trend"]);
        expect(rail.querySelector("svg[data-icon=sliders]")).not.toBeNull();
    }, 30_000);

    test("B16–B18, B21: the selected placement's name and its component's key, what its code reads, its description fixed by its developer, and the footer", async () => {
        const { container } = await mountBuilder();
        await select(container, "c-trend");
        const b = inspector(container);
        expect(b.querySelector("[data-inspector-name]")!.textContent).toBe("Revenue trend");
        expect(b.querySelector("[data-inspector-meta]")!.textContent).toBe("revenue_trend");
        expect(b.querySelector("[data-inspector-changed]")).toBeNull();
        // Each path its code reads, as e3 prints a keypath.
        expect([...b.querySelectorAll('[data-inspector="data"] li')].map((li) => li.textContent)).toEqual([`.records.${RECORD}`]);
        expect(b.querySelector('[data-inspector="config"]')!.textContent).toBe("Configurationfixed by developerWeekly revenue, as an area.");
        expect(b.querySelector('[data-inspector="footer"]')!.textContent).toBe("Published component · logic immutable");
        await select(container, "c-kpi");
        expect(inspector(container).querySelector('[data-inspector="data"]')!.textContent).toBe("Datareads no data");
        expect(inspector(container).querySelector('[data-inspector="config"] p')!.textContent).toBe("No description");
    }, 30_000);

    test("B16: a placement whose component's code changed since the page went live says so", async () => {
        const { container } = await mountBuilder();
        await openPage("c-monthly");
        await select(container, "m-orders");
        expect(inspector(container).querySelector("[data-inspector-changed]")!.textContent).toBe("logic changed since this page went live");
    }, 30_000);

    test("B20: the span stepper asks the canvas — each step a draft, held to the row's room — and Undo takes one back", async () => {
        const { container } = await mountBuilder();
        await select(container, "c-trend");
        const span = () => inspector(container).querySelector("[data-inspector-span]")!.textContent;
        expect(span()).toBe("8 / 12");
        await press("Increase span");
        expect(spanOf(container, "c-trend")).toBe("9");
        expect(span()).toBe("9 / 12");
        // A row of its own leaves it all 12, and no more.
        for (let i = 0; i < 3; i++) await press("Increase span");
        expect(spanOf(container, "c-trend")).toBe("12");
        expect((screen.getByRole("button", { name: "Increase span" }) as HTMLButtonElement).disabled).toBe(true);
        await press("Undo");
        expect(spanOf(container, "c-trend")).toBe("11");
        expect(span()).toBe("11 / 12");
    }, 30_000);

    test("B20: the row field moves the placement — into row 1, beside the KPI rail and fitted to it", async () => {
        const { container } = await mountBuilder();
        await select(container, "c-trend");
        const row = inspector(container).querySelector<HTMLInputElement>("[data-inspector-row]")!;
        expect(row.value).toBe("2");
        await act(async () => {
            fireEvent.change(row, { target: { value: "1" } });
            fireEvent.keyDown(row, { key: "Enter" });
        });
        await settle();
        expect(rowsDrawn(container)).toEqual([["c-kpi", "c-trend"]]);
        expect([spanOf(container, "c-kpi"), spanOf(container, "c-trend")]).toEqual(["6", "6"]);
        expect(inspector(container).querySelector<HTMLInputElement>("[data-inspector-row]")!.value).toBe("1");
    }, 30_000);

    test("B20: the height select sets the placement's height, and Auto returns it to its content's", async () => {
        const { container } = await mountBuilder();
        await select(container, "c-trend");
        const frame = () => tile(container, "c-trend").firstElementChild as HTMLElement;
        const pick = async (name: string) => {
            await act(async () => { fireEvent.click(inspector(container).querySelector("[data-inspector-height]")!); });
            await act(async () => { fireEvent.click(screen.getByRole("option", { name })); });
            await settle();
        };
        await pick("240 px");
        expect(frame().style.height).toBe("240px");
        await pick("Auto");
        expect(frame().style.height).toBe("");
    }, 30_000);

    test("B20: the alignment segments set where the placement sits in a taller row", async () => {
        const { container } = await mountBuilder();
        await select(container, "c-trend");
        expect(screen.getByRole("button", { name: "Top" }).getAttribute("aria-pressed")).toBe("true");
        await press("Center");
        expect(tile(container, "c-trend").getAttribute("data-align")).toBe("center");
        expect(screen.getByRole("button", { name: "Center" }).getAttribute("aria-pressed")).toBe("true");
    }, 30_000);

    test("B12: the inspector's edits are drafts of the page's session — Apply commits them in the page's one patch", async () => {
        const { container } = await mountBuilder();
        await select(container, "c-trend");
        await press("Increase span");
        await press("Stretch");
        await press("Apply changes");
        expect(await commits()).toEqual(["patch", "$init"]);
        const overview = (await readRecord()).get(OVERVIEW)!;
        if (overview.type !== "page") throw new Error("expected a page");
        const trend = overview.value.draft.cells.find((c) => c.key === "c-trend")!;
        expect([trend.span, trend.align.type]).toEqual([9n, "stretch"]);
    }, 30_000);

    test("the palette counts the canvas's unsaved drafts: a placement removed and not yet saved leaves ON CANVAS · ×1", async () => {
        const { container } = await mountBuilder();
        await openPage("d-double");
        await select(container, "d-trend-2");
        expect(within(palette(container)).getByText("ON CANVAS · ×2")).toBeTruthy();
        await keyOn(container, "d-trend-1", { key: "Delete" });
        await select(container, "d-trend-2");
        expect(within(palette(container)).getByText("ON CANVAS · ×1")).toBeTruthy();
        // Nothing saved yet: the record still places it twice.
        const double = (await readRecord()).get({ project: "ops", page: "d-double" })!;
        if (double.type !== "page") throw new Error("expected a page");
        expect(double.value.draft.cells).toHaveLength(2);
    }, 30_000);
});

describe("<Studio.Builder> — Save as template (#997)", () => {
    const TEMPLATE: Key = { project: "ops", page: "Overview template" };

    /** Open its popover from the toolbar. */
    async function openPopover() {
        await act(async () => { fireEvent.click(screen.getByRole("button", { name: "Save as template" })); });
        await settle();
        return within(screen.getByRole("dialog"));
    }

    test("D7: it names a template — offering the page's title — and saves the open page, as last saved, in one commit", async () => {
        const { container } = await mountBuilder();
        // A draft not yet applied is not what it saves.
        await keyOn(container, "c-trend", { key: "]" });
        const popover = await openPopover();
        // The design system's edit popover, hanging from the button: its head names the page it saves.
        expect(screen.getByRole("button", { name: "Save as template" }).closest("[data-part=trigger]")!.getAttribute("data-state")).toBe("open");
        expect(popover.getByText("Save as template ·").textContent).toBe("Save as template · Overview");
        expect((popover.getByRole("textbox", { name: "Template name" }) as HTMLInputElement).value).toBe("Overview template");
        await act(async () => { fireEvent.click(popover.getByRole("button", { name: "Save template" })); });
        await settle();
        await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
        expect(await commits()).toEqual(["patch", "$init"]);
        const template = (await readRecord()).get(TEMPLATE)!;
        if (template.type !== "template") throw new Error("expected a template");
        expect(template.value.title).toBe("Overview template");
        expect(template.value.cells.map((c) => [c.key, c.span])).toEqual([["c-kpi", 12n], ["c-trend", 8n]]);
        // The page's draft is still the canvas's to apply.
        expect(spanOf(container, "c-trend")).toBe("9");
    }, 30_000);

    test("D7: a name the project holds is the field's error, an empty one asks for a name, and nothing is written", async () => {
        await mountBuilder();
        const popover = await openPopover();
        const name = popover.getByRole("textbox", { name: "Template name" });
        await act(async () => { fireEvent.change(name, { target: { value: "b-weekly" } }); });
        expect(popover.getByText("b-weekly is already a page or a template here.")).toBeTruthy();
        expect(name.getAttribute("aria-invalid")).toBe("true");
        expect((popover.getByRole("button", { name: "Save template" }) as HTMLButtonElement).disabled).toBe(true);
        await act(async () => { fireEvent.change(name, { target: { value: " " } }); });
        expect(popover.getByText("Give the template a name to save it.")).toBeTruthy();
        expect((popover.getByRole("button", { name: "Save template" }) as HTMLButtonElement).disabled).toBe(true);
        await act(async () => { fireEvent.click(popover.getByRole("button", { name: "Cancel" })); });
        await settle();
        await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
        expect(await commits()).toEqual(["$init"]);
    }, 30_000);

    test("D7: a name another write took first is refused in the popover, in its words, and the other write stands", async () => {
        await mountBuilder();
        const popover = await openPopover();
        // Another operator saves a template under the same name between this popover's read and its commit.
        const forward = memory.mutate.bind(memory);
        let raced = false;
        memory.mutate = async (ws, record, mutation, request) => {
            if (!raced) {
                raced = true;
                const other = diffPages(new SortedMap([], keys), new SortedMap([[TEMPLATE, variant("template", { title: "Theirs", cells: [] })]], keys));
                await forward(ws, record, mutation, { args: [encodePatch(other)] });
            }
            return forward(ws, record, mutation, request);
        };
        await act(async () => { fireEvent.click(popover.getByRole("button", { name: "Save template" })); });
        await settle();
        expect(within(screen.getByRole("dialog")).getByRole("alert").textContent).toBe("Another write took the name Overview template first — choose another");
        const template = (await readRecord()).get(TEMPLATE)!;
        if (template.type !== "template") throw new Error("expected a template");
        expect(template.value.title).toBe("Theirs");
        expect(await commits()).toEqual(["patch", "$init"]);
    }, 30_000);

    test("D7: while a template is open it is disabled, and says why", async () => {
        await mountBuilder();
        expect((screen.getByRole("button", { name: "Save as template" }) as HTMLButtonElement).disabled).toBe(false);
        await openPage("e-starter");
        const button = screen.getByRole("button", { name: "Save as template" }) as HTMLButtonElement;
        expect(button.disabled).toBe(true);
        expect(button.title).toBe("A template is open — open a page to save it as a template");
    }, 30_000);
});

describe("<Studio.Builder> — the publish preview (#998)", () => {
    /** The preview. */
    const preview = (c: HTMLElement) => c.querySelector<HTMLElement>("[data-studio-publish]")!;
    /** An element of the preview, by its data attribute. */
    const part = (c: HTMLElement, name: string) => preview(c).querySelector<HTMLElement>(`[data-publish-${name}]`);
    /** The change list's rows: each one's sign, its words and its detail. */
    const rows = (c: HTMLElement) => [...preview(c).querySelectorAll("[data-publish-change]")]
        .map((row) => [...row.children].flatMap((el) => (el.children.length > 0 && el.tagName === "DIV" ? [...el.children] : [el])).map((el) => el.textContent));
    /** The footer's buttons. */
    const saveButton = (c: HTMLElement) => part(c, "save") as HTMLButtonElement;
    const publishButton = (c: HTMLElement) => part(c, "publish") as HTMLButtonElement;

    /** Open a page and its publish preview, from the toolbar's Preview. */
    async function previewPage(page: string) {
        await openPage(page);
        await press("Preview");
    }

    test("E1: headerless — its bar first: ● Preview, Desktop · Tablet · Mobile, the Env pill and Exit, which returns to the canvas", async () => {
        const { container } = await mountBuilder();
        await previewPage("f-regional");
        const bar = part(container, "bar")!;
        expect(preview(container).firstElementChild).toBe(bar);
        expect(bar.firstElementChild!.textContent).toBe("Preview");
        const devices = [...part(container, "devices")!.querySelectorAll("button")];
        expect(devices.map((b) => [b.textContent, b.getAttribute("aria-pressed")]))
            .toEqual([["Desktop", "true"], ["Tablet", "false"], ["Mobile", "false"]]);
        expect(part(container, "env")!.textContent).toBe("Env ·Staging");
        expect(part(container, "env")!.querySelector("svg[data-icon=chevron-down]")).not.toBeNull();
        await act(async () => { fireEvent.click(part(container, "exit")!); });
        await settle();
        expect(container.querySelector("[data-studio-publish]")).toBeNull();
        expect(container.querySelector<HTMLElement>("[data-studio-canvas]")!.hidden).toBe(false);
    }, 30_000);

    test("E2: the page as it will publish — its project, its title, and its layout at most the device's width", async () => {
        const { container } = await mountBuilder();
        await previewPage("f-regional");
        const frame = () => part(container, "frame")!;
        // The page's head sits in the frame with it.
        expect(frame().firstElementChild!.textContent).toBe("opsRegional");
        expect(frame().querySelector("h2")!.textContent).toBe("Regional");
        expect(frame().style.maxWidth).toBe("1440px");
        expect([...frame().querySelectorAll("[data-snap-grid-cell]")].map((cell) => cell.getAttribute("data-snap-grid-cell")))
            .toEqual(["p-kpi", "p-trend", "p-bars"]);
        await act(async () => { fireEvent.click(part(container, 'device="tablet"')!); });
        expect(frame().style.maxWidth).toBe("1024px");
        await act(async () => { fireEvent.click(part(container, 'device="mobile"')!); });
        expect(frame().style.maxWidth).toBe("390px");
        expect(frame().getAttribute("data-publish-frame")).toBe("mobile");
        expect(part(container, 'device="mobile"')!.getAttribute("aria-pressed")).toBe("true");
        // The builder's canvas keeps its own width.
        expect(container.querySelector<HTMLElement>("[data-snap-grid-canvas]")!.style.maxWidth).toBe("1440px");
    }, 30_000);

    test("E3, E5: ready to publish — the version it replaces and the next, the changes since, and who sees it when", async () => {
        const { container } = await mountBuilder();
        await previewPage("f-regional");
        expect(part(container, "head")!.textContent).toBe("Ready to publish");
        expect(part(container, "versions")!.textContent).toBe("Regional · v3 → v4");
        expect(part(container, "versions")!.lastElementChild!.textContent).toBe("v4");
        expect(part(container, "count")!.textContent).toBe("2 changes since v3");
        expect(rows(container)).toEqual([
            ["±", "Resized Revenue trend", "span 12 → 8"],
            ["+", "Added Breakdown bars", "row 2 · span 4"],
        ]);
        expect(part(container, "facts")!.textContent).toBe("AudienceField ops · 24 usersRolloutImmediate");
        expect(publishButton(container).textContent).toBe("Publish v4 to Staging");
        expect(publishButton(container).disabled).toBe(false);
        // Nothing unsaved: there is no draft to save.
        expect(saveButton(container).disabled).toBe(true);
    }, 30_000);

    test("E3: a page never published is its first version — every placement added — and no banner", async () => {
        const { container } = await mountBuilder();
        await previewPage("a-overview");
        expect(part(container, "head")!.textContent).toBe("Ready to publish");
        expect(part(container, "versions")!.textContent).toBe("Overview · v1");
        expect(part(container, "count")!.textContent).toBe("2 changes · first version");
        expect(rows(container)).toEqual([["+", "Added KPI rail", "row 1 · span 12"], ["+", "Added Revenue trend", "row 2 · span 8"]]);
        expect(part(container, "banner")).toBeNull();
        expect(publishButton(container).textContent).toBe("Publish v1 to Staging");
    }, 30_000);

    test("E3: a page live as it stands is up to date — nothing to publish, and no banner", async () => {
        const { container } = await mountBuilder();
        await previewPage("b-weekly");
        expect(part(container, "head")!.textContent).toBe("Up to date");
        expect(part(container, "versions")!.textContent).toBe("Weekly · v1 live");
        expect(part(container, "count")!.textContent).toBe("No changes since v1");
        expect(part(container, "changes")).toBeNull();
        expect(part(container, "banner")).toBeNull();
        expect(publishButton(container).disabled).toBe(true);
        expect(saveButton(container).disabled).toBe(true);
    }, 30_000);

    test("E3: a template is not published — no change list, and no banner", async () => {
        const { container } = await mountBuilder();
        await previewPage("e-starter");
        expect(part(container, "head")!.textContent).toBe("Templates are not published");
        expect(part(container, "versions")!.textContent).toBe("Starter · template");
        expect(part(container, "count")).toBeNull();
        expect(part(container, "banner")).toBeNull();
        expect(publishButton(container).textContent).toBe("Publish");
        expect(publishButton(container).disabled).toBe(true);
    }, 30_000);

    test("E4: the banner says the logic is unchanged — or names the components whose code changed since the live version", async () => {
        const { container } = await mountBuilder();
        await previewPage("f-regional");
        const banner = () => part(container, "banner")!;
        expect(banner().getAttribute("data-tone")).toBe("change");
        // The design system's banner: its glyph, then its words.
        expect([banner().firstElementChild!.textContent, banner().lastElementChild!.textContent])
            .toEqual(["△", "Component logic unchanged — only layout changed. Safe to publish."]);
        await act(async () => { fireEvent.click(part(container, "exit")!); });
        await previewPage("c-monthly");
        expect(part(container, "head")!.textContent).toBe("Ready to publish");
        expect(part(container, "count")!.textContent).toBe("1 change since v3");
        expect(banner().getAttribute("data-tone")).toBe("warning");
        expect(banner().getAttribute("role")).toBe("alert");
        expect([banner().firstElementChild!.textContent, banner().lastElementChild!.textContent])
            .toEqual(["!", "Logic changed since v3 in Orders by week — its placements publish with its new code"]);
    }, 30_000);

    test("E4: the banner's words — one component is its; several are theirs, named in the order they are placed", () => {
        expect(studioMessages.logicChangedIn({ version: "v2", components: ["Revenue trend"] }))
            .toBe("Logic changed since v2 in Revenue trend — its placements publish with its new code");
        expect(studioMessages.logicChangedIn({ version: "v2", components: ["KPI rail", "Revenue trend", "Breakdown bars"] }))
            .toBe("Logic changed since v2 in KPI rail, Revenue trend and Breakdown bars — their placements publish with their new code");
    });

    test("E6: Publish is one commit — the draft the next live version, each placement stamped with its code — and the page is up to date", async () => {
        const { container } = await mountBuilder();
        await previewPage("f-regional");
        await act(async () => { fireEvent.click(publishButton(container)); });
        await settle();
        await waitFor(() => expect(part(container, "head")!.textContent).toBe("Up to date"));
        expect(part(container, "refused")).toBeNull();
        expect(await commits()).toEqual(["patch", "$init"]);
        const regional = (await readRecord()).get(REGIONAL)!;
        if (regional.type !== "page" || regional.value.live.type !== "some") throw new Error("expected a published page");
        expect(regional.value.live.value.version).toBe(4n);
        expect(regional.value.live.value.page).toEqual(regional.value.draft);
        expect(regional.value.draft.cells.map((c) => c.fingerprint)).toEqual([kpiPrint, trendPrint, fingerprintOf(barsFn)]);
        expect(part(container, "versions")!.textContent).toBe("Regional · v4 live");
    }, 30_000);

    test("E6: with drafts on the canvas, the page shown is the drafted one; Publish applies them first — the canvas's own commit — then publishes them", async () => {
        const { container } = await mountBuilder();
        await openPage("f-regional");
        await keyOn(container, "p-trend", { key: "[" });
        await press("Preview");
        // The preview shows what will publish: the trend at 7, unsaved.
        expect(rows(container)[0]).toEqual(["±", "Resized Revenue trend", "span 12 → 7"]);
        expect(saveButton(container).disabled).toBe(false);
        await act(async () => { fireEvent.click(publishButton(container)); });
        await settle();
        await waitFor(() => expect(part(container, "head")!.textContent).toBe("Up to date"));
        expect(part(container, "refused")).toBeNull();
        expect(await commits()).toEqual(["patch", "patch", "$init"]);
        const regional = (await readRecord()).get(REGIONAL)!;
        if (regional.type !== "page" || regional.value.live.type !== "some") throw new Error("expected a published page");
        expect(regional.value.live.value.version).toBe(4n);
        expect(regional.value.live.value.page.cells.map((c) => [c.key, c.span])).toEqual([["p-kpi", 12n], ["p-trend", 7n], ["p-bars", 4n]]);
        expect(saveButton(container).disabled).toBe(true);
    }, 30_000);

    test("E6: Save as draft is the canvas's Apply alone — one commit to the draft, nothing published", async () => {
        const { container } = await mountBuilder();
        await openPage("f-regional");
        await keyOn(container, "p-trend", { key: "[" });
        await press("Preview");
        await act(async () => { fireEvent.click(saveButton(container)); });
        await settle();
        await waitFor(() => expect(saveButton(container).disabled).toBe(true));
        expect(await commits()).toEqual(["patch", "$init"]);
        const regional = (await readRecord()).get(REGIONAL)!;
        if (regional.type !== "page" || regional.value.live.type !== "some") throw new Error("expected a page");
        expect(regional.value.draft.cells.find((c) => c.key === "p-trend")!.span).toBe(7n);
        expect(regional.value.live.value.version).toBe(3n);
        expect(part(container, "head")!.textContent).toBe("Ready to publish");
    }, 30_000);

    test("E6: a publish another overtook is refused above the footer, in the preview's words — and the other stands", async () => {
        const { container } = await mountBuilder();
        await previewPage("f-regional");
        // Another operator publishes between this publish's read and its commit.
        const publish = East.compile(Studio.publish, []);
        const forward = memory.mutate.bind(memory);
        let raced = false;
        memory.mutate = async (ws, record, mutation, request) => {
            if (!raced) {
                raced = true;
                const other = publish(await readRecord(), REGIONAL, []);
                await forward(ws, record, mutation, { args: [encodePatch(other)] });
            }
            return forward(ws, record, mutation, request);
        };
        await act(async () => { fireEvent.click(publishButton(container)); });
        await settle();
        await waitFor(() => expect(part(container, "refused")).not.toBeNull());
        expect(part(container, "refused")!.getAttribute("role")).toBe("alert");
        expect(part(container, "refused")!.textContent).toBe("Another write changed this page first — review it and publish again");
        expect(await commits()).toEqual(["patch", "$init"]);
    }, 30_000);
});

describe("<Studio.Builder> — the toolbar on a row short of room (#1229)", () => {
    // jsdom lays nothing out: a toolbar row's box is `row.px`, an item's width is
    // its form's in FORM_PX (a hidden form has no box), and the gap is 10px. The
    // rows' ResizeObservers are captured, so a test moves the width as a browser does.
    const row = { px: 0 };
    /** Each item's width in each of its forms, widest first — none for a form that hides it. */
    const FORM_PX: Readonly<Record<string, ReadonlyArray<number | undefined>>> = {
        status: [57], grid: [110], readout: [62], zoom: [100, 45], rule: [1], history: [300, 136], widths: [150, 72],
        "save-template": [124], preview: [71], publish: [66], more: [undefined, 40],
    };
    const observers: { cb: ResizeObserverCallback; targets: Set<Element> }[] = [];
    class CapturingObserver {
        private readonly entry: { cb: ResizeObserverCallback; targets: Set<Element> };
        constructor(cb: ResizeObserverCallback) { this.entry = { cb, targets: new Set() }; observers.push(this.entry); }
        observe(el: Element) { this.entry.targets.add(el); }
        unobserve(el: Element) { this.entry.targets.delete(el); }
        disconnect() { this.entry.targets.clear(); }
    }
    const widthOf = (el: Element): number => {
        if (el.hasAttribute("data-toolbar")) return row.px;
        const key = el.getAttribute("data-toolbar-item");
        return key === null ? 0 : FORM_PX[key]?.[Number(el.getAttribute("data-toolbar-form"))] ?? 0;
    };
    const realRect = Element.prototype.getBoundingClientRect;
    const realObserver = (globalThis as { ResizeObserver?: unknown }).ResizeObserver;
    beforeAll(() => {
        (globalThis as { ResizeObserver?: unknown }).ResizeObserver = CapturingObserver;
        Element.prototype.getBoundingClientRect = function (this: Element) {
            const width = widthOf(this);
            return { x: 0, y: 0, left: 0, top: 0, width, height: 30, right: width, bottom: 30, toJSON() { return {}; } } as DOMRect;
        };
    });
    beforeEach(() => {
        const computed = window.getComputedStyle.bind(window);
        vi.spyOn(window, "getComputedStyle").mockImplementation((el: Element, pseudo?: string | null) => {
            const style = computed(el, pseudo);
            if (!el.hasAttribute("data-toolbar")) return style;
            return new Proxy(style, { get: (target, prop) => (prop === "columnGap" ? "10px" : Reflect.get(target, prop)) });
        });
    });
    afterEach(() => { vi.restoreAllMocks(); });
    afterAll(() => {
        Element.prototype.getBoundingClientRect = realRect;
        (globalThis as { ResizeObserver?: unknown }).ResizeObserver = realObserver;
    });

    /** Move the rows' width and deliver it as the browser does. */
    function resize(px: number) {
        row.px = px;
        act(() => {
            for (const o of observers) {
                const rowEl = [...o.targets].find((t) => t.hasAttribute("data-toolbar") && t.isConnected);
                if (rowEl !== undefined) o.cb([{ target: rowEl } as ResizeObserverEntry], {} as ResizeObserver);
            }
        });
    }
    /** The canvas's toolbar row. */
    const bar = (c: HTMLElement) => c.querySelector<HTMLElement>("[data-frame-slot=toolbar] [data-toolbar]")!;
    /** Each item's form of its forms, as the toolbar says it folded them. */
    const stateOf = (c: HTMLElement) => new Map(bar(c).getAttribute("data-toolbar-state")!.split(";").map((part) => {
        const [key, of] = part.split("=");
        return [key!, Number(of!.split("/")[0])] as const;
    }));
    /** The row a configuration needs: every drawn form's width, and a 10px gap between drawn items. */
    function needs(forms: ReadonlyMap<string, number>): number {
        const widths = [...forms].flatMap(([key, form]) => {
            const px = FORM_PX[key]![form];
            return px === undefined ? [] : [px];
        });
        return widths.reduce((a, b) => a + b, 0) + 10 * Math.max(0, widths.length - 1);
    }
    /** The ladder, move by move — the View chip's bundle one move of two steps, the ⋯ chip's one of four. */
    const MOVES: ReadonlyArray<ReadonlyArray<readonly [string, number]>> = [
        [["grid", 1]], [["readout", 1]], [["widths", 1]], [["zoom", 1], ["widths", 2]],
        [["save-template", 1], ["preview", 1], ["publish", 1], ["more", 1]], [["status", 1]], [["history", 1]],
    ];
    /** The ⋯ chip, while the row draws it. */
    const chipOf = (c: HTMLElement) => bar(c).querySelector<HTMLElement>("[data-studio-more]");
    /** The View chip, while the row draws it. */
    const viewChipOf = (c: HTMLElement) => bar(c).querySelector<HTMLElement>("[data-snap-grid-view]");
    /** The menu a chip opens. */
    const menuOf = (chip: HTMLElement) => document.getElementById(chip.getAttribute("aria-controls")!)!;
    /** A chip's menu's items. */
    const menuItems = (chip: HTMLElement) => [...menuOf(chip).querySelectorAll<HTMLElement>("[role=menuitem], [role=menuitemradio]")];
    /** Opens a chip's menu. */
    async function openMenu(chip: HTMLElement) {
        await act(async () => { fireEvent.click(chip); });
        await waitFor(() => expect(chip.getAttribute("aria-expanded")).toBe("true"));
    }
    /** Picks an item of a chip's menu as a pointer does: pressed on it, then its click. */
    async function pick(chip: HTMLElement, words: string) {
        const found = menuItems(chip).find((el) => el.textContent === words);
        if (found === undefined) throw new Error(`no item “${words}”`);
        await act(async () => { fireEvent.pointerDown(found); });
        await act(async () => { fireEvent.click(found); });
        await settle();
    }
    /** Waits the frames in which a popover opened starts to hear Esc and a click outside: Zag defers that a frame. */
    const frames = () => act(async () => { await new Promise<void>((resolve) => { requestAnimationFrame(() => requestAnimationFrame(() => resolve())); }); });

    test("one ladder: the canvas's own steps — the zoom into the View chip as the widths hide, one move — then Save as template, Preview and Publish into the ⋯ chip, one move; the status, and the history item last", async () => {
        row.px = 4000;
        const { container } = await mountBuilder();
        expect(bar(container).getAttribute("data-toolbar-ladder"))
            .toBe("grid>1 readout>1 widths>1 zoom>1 widths>2 save-template>1 preview>1 publish>1 more>1 status>1 history>1");
        let forms = new Map([
            ["status", 0], ["grid", 0], ["readout", 0], ["zoom", 0], ["rule", 0], ["history", 0], ["widths", 0],
            ["save-template", 0], ["preview", 0], ["publish", 0], ["more", 0],
        ]);
        expect(stateOf(container)).toEqual(forms);
        // Each configuration holds in exactly the row it needs, and a pixel less takes the next move — and only that.
        for (const move of MOVES) {
            const room = needs(forms);
            resize(room);
            expect(stateOf(container), `${room}px`).toEqual(forms);
            forms = new Map(forms);
            for (const [key, form] of move) forms.set(key, form);
            resize(room - 1);
            expect(stateOf(container), `${room - 1}px, ${move.map(([k, f]) => `${k}→${f}`).join(" + ")}`).toEqual(forms);
        }
        // Folded all the way: the View chip, the rule, the history item's buttons and the ⋯ chip — Save as template's anchor.
        expect(toolbarItems(container)).toEqual(["zoom", "rule", "history", "more"]);
        expect([viewChipOf(container)!.getAttribute("aria-label"), chipOf(container)!.getAttribute("aria-label")]).toEqual(["View", "More"]);
        expect(chipOf(container)!.parentElement!.getAttribute("data-part")).toBe("anchor");
    }, 30_000);

    test("the ⋯ chip's menu holds Save as template…, Preview and Publish: Preview and Publish open the publish preview in the canvas's place; the View chip's widths draw the canvas at theirs", async () => {
        row.px = 1;
        const { container } = await mountBuilder();
        const canvas = () => container.querySelector<HTMLElement>("[data-studio-canvas]")!;
        for (const words of ["Preview", "Publish"]) {
            await openMenu(chipOf(container)!);
            expect(menuItems(chipOf(container)!).map((el) => el.textContent)).toEqual(["Save as template…", "Preview", "Publish"]);
            await pick(chipOf(container)!, words);
            expect([container.querySelector("[data-studio-publish]") !== null, canvas().hidden], words).toEqual([true, true]);
            await act(async () => { fireEvent.click(container.querySelector("[data-publish-exit]")!); });
            await settle();
            expect([container.querySelector("[data-studio-publish]"), canvas().hidden]).toEqual([null, false]);
        }
        await openMenu(viewChipOf(container)!);
        expect(menuItems(viewChipOf(container)!).map((el) => `${el.textContent}${el.getAttribute("aria-checked") === "true" ? " (checked)" : ""}`))
            .toEqual(["Zoom out", "Zoom in", "Desktop (checked)", "Tablet"]);
        await pick(viewChipOf(container)!, "Tablet");
        expect(container.querySelector<HTMLElement>("[data-snap-grid-canvas]")!.style.maxWidth).toBe("1024px");
    }, 30_000);

    test("the ⋯ chip's Save as template… opens its popover hung from the chip: it saves the open page, as last saved, in one commit, and the focus is back on the chip", async () => {
        row.px = 1;
        const { container } = await mountBuilder();
        await openMenu(chipOf(container)!);
        await pick(chipOf(container)!, "Save as template…");
        await frames();
        const popover = within(screen.getByRole("dialog"));
        // The popover hangs from the chip, whose menu has closed.
        expect([chipOf(container)!.parentElement!.getAttribute("data-part"), chipOf(container)!.getAttribute("aria-expanded")]).toEqual(["anchor", "false"]);
        expect(popover.getByText("Save as template ·").textContent).toBe("Save as template · Overview");
        expect((popover.getByRole("textbox", { name: "Template name" }) as HTMLInputElement).value).toBe("Overview template");
        await act(async () => { fireEvent.click(popover.getByRole("button", { name: "Save template" })); });
        await settle();
        await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
        expect(await commits()).toEqual(["patch", "$init"]);
        const template = (await readRecord()).get({ project: "ops", page: "Overview template" })!;
        if (template.type !== "template") throw new Error("expected a template");
        expect(template.value.cells.map((c) => [c.key, c.span])).toEqual([["c-kpi", 12n], ["c-trend", 8n]]);
        await waitFor(() => expect(document.activeElement).toBe(chipOf(container)));
    }, 30_000);

    test("while a template is open, the ⋯ chip's Save as template… is disabled, and says why", async () => {
        row.px = 1;
        const { container } = await mountBuilder();
        await openPage("e-starter");
        await openMenu(chipOf(container)!);
        const saveAs = menuItems(chipOf(container)!)[0]!;
        expect([saveAs.textContent, saveAs.getAttribute("aria-disabled"), saveAs.title])
            .toEqual(["Save as template…", "true", "A template is open — open a page to save it as a template"]);
        await pick(chipOf(container)!, "Save as template…");
        expect(screen.queryByRole("dialog")).toBeNull();
    }, 30_000);

    test("while Save as template's popover hangs from the ⋯ chip, the chip and the three it holds keep their forms as the row widens — the canvas's own items and the status unfold around it; closed, the row unfolds", async () => {
        row.px = 1;
        const { container } = await mountBuilder();
        await openMenu(chipOf(container)!);
        await pick(chipOf(container)!, "Save as template…");
        await frames();
        resize(4000);
        expect(stateOf(container)).toEqual(new Map([
            ["status", 0], ["grid", 0], ["readout", 0], ["zoom", 0], ["rule", 0], ["history", 0], ["widths", 0],
            ["save-template", 1], ["preview", 1], ["publish", 1], ["more", 1],
        ]));
        await act(async () => { fireEvent.click(within(screen.getByRole("dialog")).getByRole("button", { name: "Cancel" })); });
        await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
        await waitFor(() => expect(stateOf(container).get("more")).toBe(0));
        expect(["save-template", "preview", "publish"].map((key) => stateOf(container).get(key))).toEqual([0, 0, 0]);
        expect(await commits()).toEqual(["$init"]);
    }, 30_000);
});
