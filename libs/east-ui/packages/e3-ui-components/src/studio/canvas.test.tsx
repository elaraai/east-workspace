/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 *
 * @vitest-environment jsdom
 *
 * The builder rendered over a pages record in memory, whose patch door
 * applies each patch with East's own checks. `<Studio.Canvas>` (#995): the one
 * toolbar and the page's status (B8); the selection bar (B9); the grid panel
 * (B10); a dropped component's cell (B11); Apply as one patch commit on the
 * page, and a conflict in the history item's words (B12); the panes (B13);
 * Preview, Publish, Desktop and Tablet (B14). `<Studio.Inspector>` (#996): its
 * pane and its rail (B15); the selected placement, its code's change since
 * the page went live, what it reads and its description (B16–B18); its
 * layout edits, each a draft of the page's session (B20, B12); what it says
 * with nothing selected (B21); and the palette counting unsaved drafts. Save as
 * template (D7, #997): the open page, as last saved, under a name the project
 * does not hold, one commit; a name taken, or taken first by another write,
 * refused in its popover; disabled while a template is open.
 */

import { describe, test, expect, beforeEach, afterEach } from "vitest";
import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { ChakraProvider } from "@chakra-ui/react";
import {
    East, NullType, PatchType, SortedMap, StringType, applyFor, compareFor, decodeBeast2For,
    diffFor, encodeBeast2For, none, some, variant, type ValueTypeOf,
} from "@elaraai/east";
import { Reactive, SnapGrid, Stack, State, Text, UIComponentType } from "@elaraai/east-ui/internal";
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
// The inspector's body and Save as template are extensions: their renderers register as they load.
import "./inspector.js";
import "./save-template.js";

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

const WORKSPACE = "canvas-test";
const RECORD = "canvas_pages";
const keys = compareFor(StudioKeyType);
const diffPages = diffFor(StudioPagesType);
const encodePatch = encodeBeast2For(PatchType(StudioPagesType));
const decodeCell = decodeBeast2For(Studio.Types.Cell);
const HandleType = RecordBindHandleType(StudioPagesType, { patch: [PatchType(StudioPagesType)] });

/** The component the palette offers but no page places — what a drop makes a cell of. */
const ordersFn = East.function([], UIComponentType, (_$) => Text.Root("Orders"));

/** The listed components — the trend's code reads the pages record, so it has a read to show. */
const components = [
    Studio.component("kpi_rail", { name: "KPI rail", category: "Display", icon: "gauge-high" },
        East.function([], UIComponentType, (_$) => Text.Root("KPIs"))),
    Studio.component("revenue_trend", {
        name: "Revenue trend", category: "Charts", icon: "chart-area", span: 8n, description: "Weekly revenue, as an area.",
    }, East.function([], UIComponentType, (_$) => Reactive.Root(East.function([], UIComponentType, ($) => {
        const pages = $.let(recordBindPlatformFn([HandleType], RECORD));
        return Text.Root(East.str`${East.print(pages.read().size())} pages`);
    })))),
    Studio.component("orders_by_week", { name: "Orders by week", category: "Charts", icon: "chart-column", span: 6n }, ordersFn),
];

const OVERVIEW: Key = { project: "ops", page: "a-overview" };

/** The Overview (never published), the Weekly (live, its draft its live layout), the Monthly (live, its draft since changed), the Double (two trends) and a template. */
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
        draft: { title: "Weekly", cells: [{ key: "w-orders", row: "r1", span: 12n, height: none, align: variant("top", null), title: none, component: "orders_by_week", fingerprint: "" }] },
        live: some({ version: 1n, page: { title: "Weekly", cells: [{ key: "w-orders", row: "r1", span: 12n, height: none, align: variant("top", null), title: none, component: "orders_by_week", fingerprint: "" }] } }),
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

/** The builder: the canvas over the record with the palette before it and the inspector after it, and a line saying which of Preview and Publish was pressed. */
function surfaceProgram() {
    return East.compile(East.function([], UIComponentType, (_$) => Reactive.Root(East.function([], UIComponentType, ($) => {
        const listed = $.let(components);
        const record = $.let(recordBindPlatformFn([HandleType], RECORD));
        const said = $.let(State.bind([StringType], "canvas-test.said", "nothing"));
        const onPreview = $.const(East.function([], NullType, ($2) => { $2(said.write("preview")); }));
        const onPublish = $.const(East.function([], NullType, ($2) => { $2(said.write("publish")); }));
        return Stack.VStack([
            Text.Root(East.str`pressed ${said.read()}`),
            Studio.Canvas({
                pages: record as never, components: listed, project: "ops", onPreview, onPublish,
                panes: {
                    start: Studio.Palette({ pages: record.read() as never, components: listed, project: "ops" }),
                    end: Studio.Inspector({ pages: record.read() as never, components: listed, project: "ops" }),
                },
            }),
        ]);
    }))), getRegisteredPlatformImplementations()) as () => ValueTypeOf<typeof UIComponentType>;
}

/** Mount the builder and let the record load. */
async function mountCanvas() {
    const program = surfaceProgram();
    const utils = render(
        <ChakraProvider value={system}>
            <DragLayerProvider>
                <EastChakraComponent value={program()} storageKey="studio-canvas" />
            </DragLayerProvider>
        </ChakraProvider>,
    );
    await settle();
    return utils;
}

/** Let the record's reads, the session and the renders settle. */
async function settle() {
    await act(async () => {
        for (let i = 0; i < 6; i++) await new Promise<void>((resolve) => { setTimeout(resolve, 0); });
    });
}

/** Open a page, as the palette's Pages tab does. */
async function openPage(page: string) {
    await act(async () => {
        StateRuntime.getStore().write(builderKeys(undefined).page, encodeBeast2For(StudioKeyType)({ project: "ops", page }));
    });
    await settle();
}

/** The toolbar's items, by key, in their order along the row. */
const toolbarItems = (c: HTMLElement) =>
    [...c.querySelectorAll("[data-snap-grid-toolbar-row] [data-toolbar-item]")].map((el) => el.getAttribute("data-toolbar-item"));

/** A tile of the canvas. */
const tile = (c: HTMLElement, key: string) => c.querySelector<HTMLElement>(`[data-snap-grid-tile="${key}"]`)!;

/** Press a history item button, as a pointer does. */
async function press(name: string) {
    const button = screen.getByRole("button", { name });
    await act(async () => {
        fireEvent.mouseDown(button, { button: 0 });
        fireEvent.click(button);
    });
    await settle();
}

/** Select a tile, and press a key on it. */
async function keyOn(c: HTMLElement, key: string, init: { key: string }) {
    await act(async () => { fireEvent.click(tile(c, key)); });
    await act(async () => { fireEvent.keyDown(tile(c, key), init); });
    await settle();
}

describe("<Studio.Canvas> (#995)", () => {
    test("B8: one toolbar — the page's status and the grid chip; the width readout, the zoom, the history item, Desktop · Tablet, Save as template, Preview and Publish", async () => {
        const { container } = await mountCanvas();
        expect(toolbarItems(container)).toEqual(["start-0", "grid", "readout", "zoom", "rule", "history", "widths", "end-0", "end-1", "end-2"]);
        const item = (key: string) => container.querySelector(`[data-toolbar-item="${key}"]`)!;
        expect(item("start-0").textContent).toBe("Draft");
        expect(item("grid").textContent).toBe("12 col · snap on");
        expect(item("readout").textContent).toBe("1440 px");
        expect(item("zoom").textContent).toBe("100%");
        expect(within(item("widths") as HTMLElement).getAllByRole("button").map((b) => [b.textContent, b.getAttribute("aria-pressed")]))
            .toEqual([["Desktop", "true"], ["Tablet", "false"]]);
        expect([item("end-0").textContent, item("end-1").textContent, item("end-2").textContent]).toEqual(["Save as template", "Preview", "Publish"]);
        // Headerless: nothing above the toolbar in the canvas's frame.
        const editor = container.querySelector("[data-snap-grid-editor]")!;
        expect(editor.firstElementChild!.hasAttribute("data-snap-grid-toolbar-row")).toBe(true);
    }, 30_000);

    test("B8: the status is ○ Draft until a page is published, ● Live while its draft is its live layout, Live · edited once they differ", async () => {
        const { container } = await mountCanvas();
        const status = () => container.querySelector('[data-toolbar-item="start-0"]')!.textContent;
        expect(status()).toBe("Draft");
        await openPage("b-weekly");
        expect(status()).toBe("Live");
        await openPage("c-monthly");
        expect(status()).toBe("Live · edited");
    }, 30_000);

    test("B9: the selection bar names the selected placement — its component's icon and name, its key and what it reads; with none, what to do", async () => {
        const { container } = await mountCanvas();
        const bar = () => container.querySelector<HTMLElement>("[data-snap-grid-selection]")!;
        expect(bar().textContent).toBe("No selectionClick a component on the grid to arrange it");
        await act(async () => { fireEvent.click(tile(container, "c-trend")); });
        expect(bar().querySelector("svg")!.getAttribute("data-icon")).toBe("chart-area");
        expect([...bar().children].slice(1).map((el) => el.textContent)).toEqual(["Revenue trend", "revenue_trend · canvas_pages"]);
    }, 30_000);

    test("B10: the grid panel holds the page's cells on the editing canvas, with its guides and its end zone", async () => {
        const { container } = await mountCanvas();
        const main = container.querySelector("[data-snap-grid-main]")!;
        expect(main.querySelector("[data-snap-grid-canvas] [data-snap-grid-ruler]")).not.toBeNull();
        expect(main.querySelector("[data-snap-grid-end]")).not.toBeNull();
        expect([...main.querySelectorAll("[data-snap-grid-tile]")].map((t) => t.getAttribute("data-snap-grid-tile"))).toEqual(["c-kpi", "c-trend"]);
    }, 30_000);

    test("B11: a component dropped from the palette becomes a cell at its span, storing its fingerprint", async () => {
        const program = surfaceProgram();
        const root = program();
        if (root.type !== "ReactiveComponent") throw new Error(`expected a Reactive, got ${root.type}`);
        const stack = root.value.render();
        if (stack.type !== "Stack") throw new Error(`expected a Stack, got ${stack.type}`);
        const canvas = stack.value.children[1]!;
        if (canvas.type !== "ReactiveComponent") throw new Error(`expected the canvas's Reactive, got ${canvas.type}`);
        const grid = canvas.value.render();
        if (grid.type !== "SnapGrid" || grid.value.editing.type !== "some" || grid.value.editing.value.create.type !== "some") {
            throw new Error("expected the editing canvas, taking a card");
        }
        // The palette's components library is where its cards come from.
        expect(grid.value.sources).toEqual([builderKeys(undefined).components]);
        const bytes = grid.value.editing.value.create.value({ library: builderKeys(undefined).components, key: "orders_by_week" }, { key: "orders_by_week-1", row: "r3" });
        expect(decodeCell(bytes)).toEqual({
            key: "orders_by_week-1", row: "r3", span: 6n, height: none, align: variant("top", null), title: none,
            component: "orders_by_week", fingerprint: fingerprintOf(ordersFn),
        });
    }, 30_000);

    test("B12: Apply is one patch commit on the page, and the toolbar says when it saved", async () => {
        const { container } = await mountCanvas();
        await keyOn(container, "c-trend", { key: "]" });
        expect(tile(container, "c-trend").style.getPropertyValue("--snap-grid-span")).toBe("9");
        await press("Apply changes");
        const { commits } = await memory.history(WORKSPACE, RECORD, undefined);
        expect(commits.map((c) => c.mutation)).toEqual(["patch", "$init"]);
        const state = await readRecord();
        const overview = state.get(OVERVIEW)!;
        if (overview.type !== "page") throw new Error("expected a page");
        expect(overview.value.draft.cells.map((c) => [c.key, c.span])).toEqual([["c-kpi", 12n], ["c-trend", 9n]]);
        expect(container.querySelector("[data-snap-grid-saved]")!.textContent).toMatch(/^Saved · \d\d:\d\d$/);
        expect((screen.getByRole("button", { name: "Apply changes" }) as HTMLButtonElement).disabled).toBe(true);
    }, 30_000);

    test("B12: a save another landed first is a conflict, in the history item's words — and the other save stands", async () => {
        const { container } = await mountCanvas();
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
        expect(await memory.history(WORKSPACE, RECORD, undefined).then((h) => h.commits.map((c) => c.mutation))).toEqual(["patch", "$init"]);
        const state = await readRecord();
        const overview = state.get(OVERVIEW)!;
        if (overview.type !== "page") throw new Error("expected a page");
        expect(overview.value.draft.cells.map((c) => c.key)).toEqual(["c-kpi"]);
    }, 30_000);

    test("B13: the palette and the inspector sit either side of the canvas under the toolbar, and the palette collapses to its rail", async () => {
        const { container } = await mountCanvas();
        const body = container.querySelector("[data-snap-grid-toolbar-row]")!.nextElementSibling!;
        expect([...body.children].map((el) => el.getAttribute("data-snap-grid-pane") ?? (el.hasAttribute("data-snap-grid-main") ? "main" : "?")))
            .toEqual(["start", "main", "end"]);
        await act(async () => { fireEvent.click(screen.getByRole("button", { name: "Collapse Components" })); });
        expect(body.querySelector('[data-snap-grid-pane="start"] [data-collapsed]')).not.toBeNull();
        expect(screen.getByRole("button", { name: "Expand Components" })).toBeTruthy();
        expect(body.querySelector("[data-snap-grid-main] [data-snap-grid-tile]")).not.toBeNull();
    }, 30_000);

    test("B14: Preview and Publish call the host; Tablet draws the canvas at 1024px, and the builder's view holds it", async () => {
        const { container } = await mountCanvas();
        expect(screen.getByText("pressed nothing")).toBeTruthy();
        await act(async () => { fireEvent.click(screen.getByRole("button", { name: "Preview" })); });
        expect(screen.getByText("pressed preview")).toBeTruthy();
        await act(async () => { fireEvent.click(screen.getByRole("button", { name: "Publish" })); });
        expect(screen.getByText("pressed publish")).toBeTruthy();

        const canvas = () => container.querySelector<HTMLElement>("[data-snap-grid-canvas]")!.style.maxWidth;
        expect(canvas()).toBe("1440px");
        await act(async () => { fireEvent.click(screen.getByRole("button", { name: "Tablet" })); });
        await settle();
        expect(canvas()).toBe("1024px");
        expect(container.querySelector('[data-toolbar-item="readout"]')!.textContent).toBe("1024 px");
        const view = decodeBeast2For(SnapGrid.Types.ViewState)(StateRuntime.getStore().read(builderKeys(undefined).view)!);
        expect(view.width).toEqual(some("1024px"));
    }, 30_000);
});

describe("<Studio.Inspector> (#996)", () => {
    /** The inspector's pane — the canvas's end pane. */
    const pane = (c: HTMLElement) => c.querySelector<HTMLElement>('[data-snap-grid-pane="end"]')!;
    /** The inspector's body, under its tab row. */
    const body = (c: HTMLElement) => pane(c).querySelector<HTMLElement>("[data-studio-inspector]")!;
    /** A tile's span, as the canvas draws it. */
    const spanOf = (c: HTMLElement, key: string) => tile(c, key).style.getPropertyValue("--snap-grid-span");
    /** The rows as the canvas draws them: each row's tiles, by key. */
    const rowsDrawn = (c: HTMLElement) => [...c.querySelectorAll("[data-snap-grid-row]")]
        .map((row) => [...row.querySelectorAll("[data-snap-grid-tile]")].map((t) => t.getAttribute("data-snap-grid-tile")));

    /** Select a placement on the canvas. */
    async function select(c: HTMLElement, key: string) {
        await act(async () => { fireEvent.click(tile(c, key)); });
        await settle();
    }

    /** Press a button by its name, and let the canvas take what it asks. */
    async function click(name: string) {
        await act(async () => { fireEvent.click(screen.getByRole("button", { name })); });
        await settle();
    }

    test("B15, B21: a headerless pane — its one row the Inspector tab and its collapse control; with nothing selected it says what to do", async () => {
        const { container } = await mountCanvas();
        expect(within(pane(container)).getByText("Inspector").hasAttribute("data-selected")).toBe(true);
        expect(screen.getByRole("button", { name: "Collapse Inspector" }).getAttribute("aria-expanded")).toBe("true");
        expect(body(container).querySelector('[data-inspector="empty"]')!.textContent)
            .toBe("Nothing selectedClick a component on the grid to see what it reads and its layout.");
    }, 30_000);

    test("B15: collapsed, the rail — the sliders tile and the span badge in the brand while a placement is selected, and its name; else Nothing selected", async () => {
        const { container } = await mountCanvas();
        await click("Collapse Inspector");
        const detail = () => pane(container).querySelector<HTMLElement>("[data-dock-detail]")!;
        expect(detail().textContent).toBe("Nothing selected");
        expect(detail().parentElement!.hasAttribute("data-active")).toBe(false);
        await select(container, "c-trend");
        const rail = detail().parentElement!;
        expect(rail.hasAttribute("data-active")).toBe(true);
        expect([...rail.children].map((el) => el.textContent)).toEqual(["", "8/12", "Inspector", "Revenue trend"]);
        expect(rail.querySelector("svg[data-icon=sliders]")).not.toBeNull();
    }, 30_000);

    test("B16–B18, B21: the selected placement's name and its component's key, what its code reads, its description fixed by its developer, and the footer", async () => {
        const { container } = await mountCanvas();
        await select(container, "c-trend");
        const b = body(container);
        expect(b.querySelector("[data-inspector-name]")!.textContent).toBe("Revenue trend");
        expect(b.querySelector("[data-inspector-meta]")!.textContent).toBe("revenue_trend");
        expect(b.querySelector("[data-inspector-changed]")).toBeNull();
        // Each path its code reads, as e3 prints a keypath.
        expect([...b.querySelectorAll('[data-inspector="data"] li')].map((li) => li.textContent)).toEqual([".records.canvas_pages"]);
        expect(b.querySelector('[data-inspector="config"]')!.textContent).toBe("Configurationfixed by developerWeekly revenue, as an area.");
        expect(b.querySelector('[data-inspector="footer"]')!.textContent).toBe("Published component · logic immutable");
        await select(container, "c-kpi");
        expect(body(container).querySelector('[data-inspector="data"]')!.textContent).toBe("Datareads no data");
        expect(body(container).querySelector('[data-inspector="config"] p')!.textContent).toBe("No description");
    }, 30_000);

    test("B16: a placement whose component's code changed since the page went live says so", async () => {
        const { container } = await mountCanvas();
        await openPage("c-monthly");
        await select(container, "m-orders");
        expect(body(container).querySelector("[data-inspector-changed]")!.textContent).toBe("logic changed since this page went live");
    }, 30_000);

    test("B20: the span stepper asks the canvas — each step a draft, held to the row's room — and Undo takes one back", async () => {
        const { container } = await mountCanvas();
        await select(container, "c-trend");
        const span = () => body(container).querySelector("[data-inspector-span]")!.textContent;
        expect(span()).toBe("8 / 12");
        await click("Increase span");
        expect(spanOf(container, "c-trend")).toBe("9");
        expect(span()).toBe("9 / 12");
        // A row of its own leaves it all 12, and no more.
        for (let i = 0; i < 3; i++) await click("Increase span");
        expect(spanOf(container, "c-trend")).toBe("12");
        expect((screen.getByRole("button", { name: "Increase span" }) as HTMLButtonElement).disabled).toBe(true);
        await press("Undo");
        expect(spanOf(container, "c-trend")).toBe("11");
        expect(span()).toBe("11 / 12");
    }, 30_000);

    test("B20: the row field moves the placement — into row 1, beside the KPI rail and fitted to it", async () => {
        const { container } = await mountCanvas();
        await select(container, "c-trend");
        const row = body(container).querySelector<HTMLInputElement>("[data-inspector-row]")!;
        expect(row.value).toBe("2");
        await act(async () => {
            fireEvent.change(row, { target: { value: "1" } });
            fireEvent.keyDown(row, { key: "Enter" });
        });
        await settle();
        expect(rowsDrawn(container)).toEqual([["c-kpi", "c-trend"]]);
        expect([spanOf(container, "c-kpi"), spanOf(container, "c-trend")]).toEqual(["6", "6"]);
        expect(body(container).querySelector<HTMLInputElement>("[data-inspector-row]")!.value).toBe("1");
    }, 30_000);

    test("B20: the height select sets the placement's height, and Auto returns it to its content's", async () => {
        const { container } = await mountCanvas();
        await select(container, "c-trend");
        const frame = () => tile(container, "c-trend").firstElementChild as HTMLElement;
        const pick = async (name: string) => {
            await act(async () => { fireEvent.click(body(container).querySelector("[data-inspector-height]")!); });
            await act(async () => { fireEvent.click(screen.getByRole("option", { name })); });
            await settle();
        };
        await pick("240 px");
        expect(frame().style.height).toBe("240px");
        await pick("Auto");
        expect(frame().style.height).toBe("");
    }, 30_000);

    test("B20: the alignment segments set where the placement sits in a taller row", async () => {
        const { container } = await mountCanvas();
        await select(container, "c-trend");
        expect(screen.getByRole("button", { name: "Top" }).getAttribute("aria-pressed")).toBe("true");
        await click("Center");
        expect(tile(container, "c-trend").getAttribute("data-align")).toBe("center");
        expect(screen.getByRole("button", { name: "Center" }).getAttribute("aria-pressed")).toBe("true");
    }, 30_000);

    test("B12: the inspector's edits are drafts of the page's session — Apply commits them in the page's one patch", async () => {
        const { container } = await mountCanvas();
        await select(container, "c-trend");
        await click("Increase span");
        await click("Stretch");
        await press("Apply changes");
        const { commits } = await memory.history(WORKSPACE, RECORD, undefined);
        expect(commits.map((c) => c.mutation)).toEqual(["patch", "$init"]);
        const overview = (await readRecord()).get(OVERVIEW)!;
        if (overview.type !== "page") throw new Error("expected a page");
        const trend = overview.value.draft.cells.find((c) => c.key === "c-trend")!;
        expect([trend.span, trend.align.type]).toEqual([9n, "stretch"]);
    }, 30_000);

    test("the palette counts the canvas's unsaved drafts: a placement removed and not yet saved leaves ON CANVAS · ×1", async () => {
        const { container } = await mountCanvas();
        await openPage("d-double");
        const palette = () => container.querySelector<HTMLElement>('[data-snap-grid-pane="start"]')!;
        await select(container, "d-trend-2");
        expect(within(palette()).getByText("ON CANVAS · ×2")).toBeTruthy();
        await keyOn(container, "d-trend-1", { key: "Delete" });
        await select(container, "d-trend-2");
        expect(within(palette()).getByText("ON CANVAS · ×1")).toBeTruthy();
        // Nothing saved yet: the record still places it twice.
        const double = (await readRecord()).get({ project: "ops", page: "d-double" })!;
        if (double.type !== "page") throw new Error("expected a page");
        expect(double.value.draft.cells).toHaveLength(2);
    }, 30_000);
});

describe("Save as template (#997)", () => {
    const TEMPLATE: Key = { project: "ops", page: "Overview template" };

    /** Open its popover from the toolbar. */
    async function openPopover() {
        await act(async () => { fireEvent.click(screen.getByRole("button", { name: "Save as template" })); });
        await settle();
        return within(screen.getByRole("dialog"));
    }

    test("D7: it names a template — offering the page's title — and saves the open page, as last saved, in one commit", async () => {
        const { container } = await mountCanvas();
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
        expect((await memory.history(WORKSPACE, RECORD, undefined)).commits.map((c) => c.mutation)).toEqual(["patch", "$init"]);
        const state = await readRecord();
        const template = state.get(TEMPLATE)!;
        if (template.type !== "template") throw new Error("expected a template");
        expect(template.value.title).toBe("Overview template");
        expect(template.value.cells.map((c) => [c.key, c.span])).toEqual([["c-kpi", 12n], ["c-trend", 8n]]);
        // The page's draft is still the canvas's to apply.
        expect(tile(container, "c-trend").style.getPropertyValue("--snap-grid-span")).toBe("9");
    }, 30_000);

    test("D7: a name the project holds is the field's error, an empty one asks for a name, and nothing is written", async () => {
        await mountCanvas();
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
        expect((await memory.history(WORKSPACE, RECORD, undefined)).commits.map((c) => c.mutation)).toEqual(["$init"]);
    }, 30_000);

    test("D7: a name another write took first is refused in the popover, in its words, and the other write stands", async () => {
        await mountCanvas();
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
        expect((await memory.history(WORKSPACE, RECORD, undefined)).commits.map((c) => c.mutation)).toEqual(["patch", "$init"]);
    }, 30_000);

    test("D7: while a template is open it is disabled, and says why", async () => {
        await mountCanvas();
        expect((screen.getByRole("button", { name: "Save as template" }) as HTMLButtonElement).disabled).toBe(false);
        await openPage("e-starter");
        const button = screen.getByRole("button", { name: "Save as template" }) as HTMLButtonElement;
        expect(button.disabled).toBe(true);
        expect(button.title).toBe("A template is open — open a page to save it as a template");
    }, 30_000);
});

/** The record as it stands — what its patch door last wrote. */
async function readRecord(): Promise<Pages> {
    const bytes = cache.read(WORKSPACE, [variant("field", "records"), variant("field", RECORD)]);
    if (bytes === undefined) throw new Error("the record has not loaded");
    return decodeBeast2For(StudioPagesType)(bytes);
}
