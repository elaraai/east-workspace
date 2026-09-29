/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 *
 * @vitest-environment jsdom
 *
 * `<Studio.Canvas>` rendered (#995) over a pages record in memory, whose patch
 * door applies each patch with East's own checks: the one toolbar and the
 * page's status (B8); the selection bar (B9); the grid panel (B10); a dropped
 * component's cell (B11); Apply as one patch commit on the page, and a
 * conflict in the history item's words (B12); the panes (B13); Preview,
 * Publish, Desktop and Tablet (B14).
 */

import { describe, test, expect, beforeEach, afterEach } from "vitest";
import { act, cleanup, fireEvent, render, screen, within } from "@testing-library/react";
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

type Key = ValueTypeOf<typeof Studio.Types.Key>;
type Entry = ValueTypeOf<typeof Studio.Types.Entry>;
type Pages = ValueTypeOf<typeof Studio.Types.Pages>;

class ResizeObserverStub { observe() {} unobserve() {} disconnect() {} }
(globalThis as { ResizeObserver?: unknown }).ResizeObserver ??= ResizeObserverStub;
(globalThis as { matchMedia?: unknown }).matchMedia ??= (query: string) => ({
    matches: false, media: query, onchange: null,
    addListener() {}, removeListener() {}, addEventListener() {}, removeEventListener() {}, dispatchEvent() { return false; },
});
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

/** The listed components. */
const components = [
    Studio.component("kpi_rail", { name: "KPI rail", category: "Display", icon: "gauge-high" },
        East.function([], UIComponentType, (_$) => Text.Root("KPIs"))),
    Studio.component("revenue_trend", { name: "Revenue trend", category: "Charts", icon: "chart-area", span: 8n },
        East.function([], UIComponentType, (_$) => Text.Root("Trend"))),
    Studio.component("orders_by_week", { name: "Orders by week", category: "Charts", icon: "chart-column", span: 6n }, ordersFn),
];

const OVERVIEW: Key = { project: "ops", page: "a-overview" };

/** The Overview (never published), the Weekly (live, its draft its live layout) and the Monthly (live, its draft since changed). */
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

/** The builder: the canvas over the record with the palette beside it, and a line saying which of Preview and Publish was pressed. */
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
                panes: { start: Studio.Palette({ pages: record.read() as never, components: listed, project: "ops" }) },
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
    test("B8: one toolbar — the page's status and the grid chip; the width readout, the zoom, the history item, Desktop · Tablet, Preview and Publish", async () => {
        const { container } = await mountCanvas();
        expect(toolbarItems(container)).toEqual(["start-0", "grid", "readout", "zoom", "rule", "history", "widths", "end-0", "end-1"]);
        const item = (key: string) => container.querySelector(`[data-toolbar-item="${key}"]`)!;
        expect(item("start-0").textContent).toBe("Draft");
        expect(item("grid").textContent).toBe("12 col · snap on");
        expect(item("readout").textContent).toBe("1440 px");
        expect(item("zoom").textContent).toBe("100%");
        expect(within(item("widths") as HTMLElement).getAllByRole("button").map((b) => [b.textContent, b.getAttribute("aria-pressed")]))
            .toEqual([["Desktop", "true"], ["Tablet", "false"]]);
        expect([item("end-0").textContent, item("end-1").textContent]).toEqual(["Preview", "Publish"]);
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
        expect([...bar().children].slice(1).map((el) => el.textContent)).toEqual(["Revenue trend", "revenue_trend"]);
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

    test("B13: the palette sits beside the canvas under the toolbar, and collapses to its rail", async () => {
        const { container } = await mountCanvas();
        const body = container.querySelector("[data-snap-grid-toolbar-row]")!.nextElementSibling!;
        expect([...body.children].map((el) => el.getAttribute("data-snap-grid-pane") ?? (el.hasAttribute("data-snap-grid-main") ? "main" : "?")))
            .toEqual(["start", "main"]);
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

/** The record as it stands — what its patch door last wrote. */
async function readRecord(): Promise<Pages> {
    const bytes = cache.read(WORKSPACE, [variant("field", "records"), variant("field", RECORD)]);
    if (bytes === undefined) throw new Error("the record has not loaded");
    return decodeBeast2For(StudioPagesType)(bytes);
}
