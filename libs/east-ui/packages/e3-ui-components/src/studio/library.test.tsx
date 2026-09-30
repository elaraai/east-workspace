/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 *
 * @vitest-environment jsdom
 *
 * `<Studio.Library>` rendered over a pages record in memory, whose patch
 * door applies each patch with East's own checks (#997): headerless, with one
 * toolbar (D1); the pane of projects and pages with its legend (D2); the
 * Templates row, Blank grid first (D3); the Pages row, "Open in builder →"
 * and the dashed card (D4); a new page, one commit, in the popover under the
 * New page button, from the toolbar and from a template's card, and a name
 * taken refused in it (D5); the search, Sort and Grid · List (D6). The
 * surface tells the host which page it opened.
 */

import { describe, test, expect, beforeEach, afterEach } from "vitest";
import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { ChakraProvider } from "@chakra-ui/react";
import {
    East, NullType, PatchType, SortedMap, StringType, applyFor, compareFor, decodeBeast2For, none, some, variant, type ValueTypeOf,
} from "@elaraai/east";
import { Reactive, Stack, State, Text, UIComponentType } from "@elaraai/east-ui/internal";
import {
    DragLayerProvider, EastChakraComponent, StateRuntime, UIStore, getRegisteredPlatformImplementations, system,
} from "@elaraai/east-ui-components";
import {
    RecordBindHandleType, Studio, StudioKeyType, StudioPagesType, builderKeys, recordBindPlatformFn,
} from "@elaraai/e3-ui/internal";
import {
    ReactiveDatasetCache, createInMemoryRecordApi, datasetCacheKey, initializeReactiveDatasetCache, initializeRecordApi,
    type DatasetApi, type RecordApi,
} from "../platform/index.js";
// The page library's frame is an extension: its renderer registers as it loads.
import "./library.js";

type Key = ValueTypeOf<typeof Studio.Types.Key>;
type Entry = ValueTypeOf<typeof Studio.Types.Entry>;
type Pages = ValueTypeOf<typeof Studio.Types.Pages>;

class ResizeObserverStub { observe() {} unobserve() {} disconnect() {} }
(globalThis as { ResizeObserver?: unknown }).ResizeObserver ??= ResizeObserverStub;
(globalThis as { matchMedia?: unknown }).matchMedia ??= (query: string) => ({
    matches: false, media: query, onchange: null,
    addListener() {}, removeListener() {}, addEventListener() {}, removeEventListener() {}, dispatchEvent() { return false; },
});
// The template select scrolls its open listbox to the chosen option; jsdom does not scroll.
Element.prototype.scrollTo ??= function scrollTo() { /* jsdom lays nothing out */ };
(globalThis as { CSS?: { escape?: (s: string) => string } }).CSS ??= {};
(globalThis as { CSS: { escape?: (s: string) => string } }).CSS.escape ??= (s: string) => s.replace(/[^\w-]/g, "\\$&");

const WORKSPACE = "library-test";
const RECORD = "library_pages";
const HandleType = RecordBindHandleType(StudioPagesType, { patch: [PatchType(StudioPagesType)] });

/** The listed components. */
const components = [
    Studio.component("kpi_rail", { name: "KPI rail", category: "Display", icon: "gauge-high" },
        East.function([], UIComponentType, (_$) => Text.Root("KPIs"))),
    Studio.component("revenue_trend", { name: "Revenue trend", category: "Charts", icon: "chart-area", span: 8n },
        East.function([], UIComponentType, (_$) => Text.Root("Trend"))),
];

/** In ops, the Detail never published, the Overview live, the Weekly drafted past its live version, and two templates; a retail page. */
const PAGES: Pages = new SortedMap<Key, Entry>([
    [{ project: "ops", page: "a-detail" }, variant("page", {
        draft: {
            title: "Detail",
            cells: [
                { key: "c-trend", row: "r1", span: 8n, height: none, align: variant("top", null), title: none, component: "revenue_trend", fingerprint: "" },
            ],
        },
        live: none,
    })],
    [{ project: "ops", page: "b-overview" }, variant("page", {
        draft: {
            title: "Overview",
            cells: [
                { key: "c-kpi-1", row: "r1", span: 6n, height: some(96n), align: variant("top", null), title: none, component: "kpi_rail", fingerprint: "" },
                { key: "c-kpi-2", row: "r1", span: 6n, height: some(96n), align: variant("top", null), title: none, component: "kpi_rail", fingerprint: "" },
                { key: "c-trend", row: "r2", span: 8n, height: none, align: variant("top", null), title: none, component: "revenue_trend", fingerprint: "" },
            ],
        },
        live: some({
            version: 2n,
            page: {
                title: "Overview",
                cells: [
                    { key: "c-kpi-1", row: "r1", span: 6n, height: some(96n), align: variant("top", null), title: none, component: "kpi_rail", fingerprint: "" },
                    { key: "c-kpi-2", row: "r1", span: 6n, height: some(96n), align: variant("top", null), title: none, component: "kpi_rail", fingerprint: "" },
                    { key: "c-trend", row: "r2", span: 8n, height: none, align: variant("top", null), title: none, component: "revenue_trend", fingerprint: "" },
                ],
            },
        }),
    })],
    [{ project: "ops", page: "c-weekly" }, variant("page", {
        draft: { title: "Weekly", cells: [] },
        live: some({ version: 1n, page: { title: "Weekly (old)", cells: [] } }),
    })],
    [{ project: "ops", page: "t-empty" }, variant("template", { title: "Empty", cells: [] })],
    [{ project: "ops", page: "t-summary" }, variant("template", {
        title: "Summary",
        cells: [
            { key: "c-kpi-1", row: "r1", span: 6n, height: some(96n), align: variant("top", null), title: none, component: "kpi_rail", fingerprint: "" },
            { key: "c-kpi-2", row: "r1", span: 6n, height: some(96n), align: variant("top", null), title: none, component: "kpi_rail", fingerprint: "" },
            { key: "c-trend", row: "r2", span: 8n, height: none, align: variant("top", null), title: none, component: "revenue_trend", fingerprint: "" },
        ],
    })],
    [{ project: "retail", page: "home" }, variant("page", {
        draft: { title: "Home", cells: [] },
        live: some({ version: 1n, page: { title: "Home", cells: [] } }),
    })],
], compareFor(StudioKeyType));

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

/** Mount the page library over the record, with a line saying which page it told the host it opened, and let the record load. */
async function mountLibrary() {
    const program = East.compile(East.function([], UIComponentType, (_$) => Reactive.Root(East.function([], UIComponentType, ($) => {
        const listed = $.let(components);
        const record = $.let(recordBindPlatformFn([HandleType], RECORD));
        const told = $.let(State.bind([StringType], "library-test.told", "nothing"));
        const onOpen = $.const(East.function([StudioKeyType], NullType, ($2, key) => { $2(told.write(East.str`${key.project}/${key.page}`)); }));
        return Stack.VStack([
            Text.Root(East.str`told ${told.read()}`),
            Studio.Library({ pages: record as never, components: listed, project: "ops", onOpen }),
        ]);
    }))), getRegisteredPlatformImplementations()) as () => ValueTypeOf<typeof UIComponentType>;
    const utils = render(
        <ChakraProvider value={system}>
            <DragLayerProvider>
                <EastChakraComponent value={program()} storageKey="studio-library" />
            </DragLayerProvider>
        </ChakraProvider>,
    );
    await settle();
    return utils;
}

/** Let the record's reads, the writes and the renders settle. */
async function settle() {
    await act(async () => {
        for (let i = 0; i < 6; i++) await new Promise<void>((resolve) => { setTimeout(resolve, 0); });
    });
}

/** The page the builder has open, as its screens share it. */
function builderPage(): Key | undefined {
    const bytes = StateRuntime.getStore().read(builderKeys(undefined).page);
    return bytes === undefined ? undefined : decodeBeast2For(StudioKeyType)(bytes);
}

/** The record as it stands — what its patch door last wrote. */
async function readRecord(): Promise<Pages> {
    const bytes = cache.read(WORKSPACE, [variant("field", "records"), variant("field", RECORD)]);
    if (bytes === undefined) throw new Error("the record has not loaded");
    return decodeBeast2For(StudioPagesType)(bytes);
}

/** The pane beside the rows. */
const pane = (c: HTMLElement) => c.querySelector<HTMLElement>("[data-page-library-pane]")!;
/** A row's gallery: the templates' or the pages'. */
const gallery = (c: HTMLElement, row: "templates" | "pages") => c.querySelector<HTMLElement>(`[data-library="studio.library.${row}"]`)!;
/** A gallery's card titles, in their order. */
const titles = (g: HTMLElement) => [...g.querySelectorAll("[data-library-card]")].map((card) => card.getAttribute("data-library-card"));
/** The pane's pages, by name, in their order. */
const paneRows = (c: HTMLElement) => [...pane(c).querySelectorAll("[data-page-library-page]")].map((row) => row.getAttribute("data-page-library-page"));

/** Opens a menu from the keyboard, then arrows down to an item and picks it — Zag's pointer handling needs a real pointer. */
async function pickFromMenu(trigger: HTMLElement, name: string) {
    await act(async () => { trigger.focus(); fireEvent.keyDown(trigger, { key: "ArrowDown" }); });
    const menu = screen.getByRole("menu");
    for (let step = 0; step < 20 && menu.querySelector("[data-highlighted]")?.textContent !== name; step++) {
        await act(async () => { fireEvent.keyDown(menu, { key: "ArrowDown" }); });
    }
    await act(async () => { fireEvent.keyDown(menu, { key: "Enter" }); });
    await settle();
}

describe("<Studio.Library> (#997)", () => {
    test("D1: headerless, with one toolbar row — the search counting the pages and templates, Sort · Name, Grid · List, a rule and the primary action", async () => {
        const { container } = await mountLibrary();
        const root = container.querySelector<HTMLElement>("[data-studio-page-library]")!;
        expect(root.firstElementChild!.getAttribute("data-slot")).toBe("toolbar");
        expect(root.querySelectorAll("[data-toolbar]")).toHaveLength(1);
        const items = [...root.firstElementChild!.querySelectorAll("[data-toolbar-item]")].map((el) => el.getAttribute("data-toolbar-item"));
        expect(items).toEqual(["search", "sort", "layout", "rule", "new"]);
        // Three pages; two templates and Blank grid.
        expect(screen.getByRole("textbox", { name: "Search pages and templates" }).getAttribute("placeholder")).toBe("Search 3 pages and 3 templates…");
        expect(screen.getByRole("button", { name: "Sort · Name" })).toBeTruthy();
        expect(screen.getByRole("radiogroup", { name: "Layout" })).toBeTruthy();
        expect(screen.getByRole("button", { name: "New page in ops" }).textContent).toBe("New page in ops");
        // The galleries draw no toolbar of their own.
        expect(gallery(container, "templates").querySelector("[data-toolbar]")).toBeNull();
        expect(gallery(container, "pages").querySelector("[data-toolbar]")).toBeNull();
    }, 30_000);

    test("D2: the pane — the projects, the shown one in the brand; the project's pages with their status dots and count, the open one marked; the legend", async () => {
        const { container } = await mountLibrary();
        const projects = [...pane(container).querySelectorAll<HTMLElement>("[data-page-library-project]")];
        expect(projects.map((p) => p.textContent)).toEqual(["ops", "retail"]);
        expect(projects[0]!.hasAttribute("data-active")).toBe(true);
        expect(projects[0]!.querySelector("svg[data-icon=folder-open]")).not.toBeNull();
        expect(projects[1]!.querySelector("svg[data-icon=folder]")).not.toBeNull();
        expect(within(pane(container)).getByText("Pages").nextElementSibling!.textContent).toBe("3");
        expect(paneRows(container)).toEqual(["a-detail", "b-overview", "c-weekly"]);
        const row = (name: string) => pane(container).querySelector<HTMLElement>(`[data-page-library-page="${name}"]`)!;
        expect(within(row("b-overview")).getByRole("img", { name: "Live" })).toBeTruthy();
        expect(within(row("a-detail")).getByRole("img", { name: "Draft" })).toBeTruthy();
        expect(within(row("c-weekly")).getByRole("img", { name: "Draft" })).toBeTruthy();
        // The builder opens the project's first page to begin with.
        expect(row("a-detail").getAttribute("aria-current")).toBe("page");
        expect(container.querySelector("[data-page-library-legend]")!.textContent).toBe("LiveDraft");
    }, 30_000);

    test("D2: a project's click shows its pages; a page's click opens it in the builder, with nothing selected, and tells the host", async () => {
        const { container } = await mountLibrary();
        await act(async () => { fireEvent.click(pane(container).querySelector("[data-page-library-page=\"b-overview\"]")!); });
        await settle();
        expect(builderPage()).toEqual({ project: "ops", page: "b-overview" });
        expect(screen.getByText("told ops/b-overview")).toBeTruthy();
        expect(pane(container).querySelector("[data-page-library-page=\"b-overview\"]")!.getAttribute("aria-current")).toBe("page");

        await act(async () => { fireEvent.click(pane(container).querySelector("[data-page-library-project=\"retail\"]")!); });
        await settle();
        expect(paneRows(container)).toEqual(["home"]);
        expect(titles(gallery(container, "pages"))).toEqual(["home"]);
        expect(screen.getByRole("button", { name: "New page in retail" })).toBeTruthy();
        // The builder's page is another project's: none of these is marked.
        expect(pane(container).querySelector("[aria-current=page]")).toBeNull();
    }, 30_000);

    test("D3: Templates, clone to start a page — Blank grid first, then the project's templates; each with its wireframe, its title and what it places", async () => {
        const { container } = await mountLibrary();
        const templates = gallery(container, "templates");
        expect(titles(templates)).toEqual(["", "t-empty", "t-summary"]);
        const card = (name: string) => templates.querySelector<HTMLElement>(`[data-library-card="${name}"]`)!;
        expect(card("").textContent).toBe("Blank grid12-col · empty");
        expect(card("t-summary").textContent).toContain("KPI rail ×2 · Revenue trend");
        // Its media is the layout's wireframe: the snap grid, a tile per placement.
        expect(card("t-summary").querySelectorAll("[data-library-media] [data-snap-grid-variant=wireframe] [data-snap-grid-cell]")).toHaveLength(3);
        expect(templates.querySelector("[data-library-add]")).toBeNull();
        expect(container.querySelector('[data-section="templates"]')!.firstElementChild!.textContent).toBe("Templatesclone to start a page");
    }, 30_000);

    test("D4: Pages, N in the project — each with its wireframe, its title and status, how many components it places and Open in builder →; the dashed card last", async () => {
        const { container } = await mountLibrary();
        const pages = gallery(container, "pages");
        expect(titles(pages)).toEqual(["a-detail", "b-overview", "c-weekly"]);
        const card = (name: string) => pages.querySelector<HTMLElement>(`[data-library-card="${name}"]`)!;
        expect(within(card("b-overview")).getByText("Overview")).toBeTruthy();
        expect(card("b-overview").querySelector("[data-library-status]")!.textContent).toBe("Live");
        expect(card("a-detail").querySelector("[data-library-status]")!.textContent).toBe("Draft");
        expect(within(card("b-overview")).getByText("3 components")).toBeTruthy();
        expect(within(card("a-detail")).getByText("1 component")).toBeTruthy();
        expect(card("b-overview").querySelector("[data-library-action]")!.textContent).toBe("Open in builder →");
        expect(card("b-overview").querySelectorAll("[data-library-media] [data-snap-grid-variant=wireframe] [data-snap-grid-cell]")).toHaveLength(3);
        expect(pages.querySelector("[data-library-add]")!.textContent).toBe("New page from template");
        expect(container.querySelector("[data-page-library-shown]")!.textContent).toBe("3 in ops");

        await act(async () => { fireEvent.click(card("c-weekly")); });
        await settle();
        expect(builderPage()).toEqual({ project: "ops", page: "c-weekly" });
        expect(screen.getByText("told ops/c-weekly")).toBeTruthy();
    }, 30_000);

    test("D6: the search narrows both rows by title; Sort Z–A reverses them; Grid · List lays the pages out", async () => {
        const { container } = await mountLibrary();
        await act(async () => { fireEvent.change(screen.getByRole("textbox", { name: "Search pages and templates" }), { target: { value: "SUM" } }); });
        await settle();
        expect(titles(gallery(container, "templates"))).toEqual(["t-summary"]);
        expect(titles(gallery(container, "pages"))).toEqual([]);
        expect(container.querySelector("[data-page-library-shown]")!.textContent).toBe("0 of 3 in ops");
        await act(async () => { fireEvent.change(screen.getByRole("textbox", { name: "Search pages and templates" }), { target: { value: "" } }); });
        await settle();
        expect(titles(gallery(container, "pages"))).toEqual(["a-detail", "b-overview", "c-weekly"]);

        await pickFromMenu(screen.getByRole("button", { name: "Sort · Name" }), "Name Z–A");
        expect(titles(gallery(container, "templates"))).toEqual(["", "t-summary", "t-empty"]);
        expect(titles(gallery(container, "pages"))).toEqual(["c-weekly", "b-overview", "a-detail"]);
        expect(paneRows(container)).toEqual(["c-weekly", "b-overview", "a-detail"]);

        const grid = () => gallery(container, "pages").querySelector<HTMLElement>("[data-layout]")!;
        expect(grid().getAttribute("data-layout")).toBe("grid");
        await act(async () => { fireEvent.click(screen.getByRole("radio", { name: "List view" })); });
        await settle();
        expect(grid().getAttribute("data-layout")).toBe("list");
        expect(screen.getByRole("radio", { name: "List view" }).getAttribute("aria-checked")).toBe("true");
    }, 30_000);
});

describe("<Studio.Library> — a new page (#997)", () => {
    /** The New page popover. */
    const popover = () => within(screen.getByRole("dialog"));
    /** The New page button's popover trigger — what the popover hangs from. */
    const hangsFrom = () => screen.getByRole("button", { name: "New page in ops" }).closest("[data-part=trigger]")!;
    /** The template picker's trigger, showing the template the page starts from. */
    const picked = () => document.querySelector("[data-page-library-template]")!.textContent;

    test("D5: from the toolbar — a name and Blank grid — one commit inserting the page, empty and never published; the popover closes", async () => {
        const { container } = await mountLibrary();
        await act(async () => { fireEvent.click(screen.getByRole("button", { name: "New page in ops" })); });
        await settle();
        expect(hangsFrom().getAttribute("data-state")).toBe("open");
        expect(popover().getByText("New page ·").textContent).toBe("New page · ops");
        expect(picked()).toBe("Blank grid");
        // Help while the name is missing, and the commit waits for one.
        expect(popover().getByText("Give the page a name to create it.")).toBeTruthy();
        expect((popover().getByRole("button", { name: "Create page" }) as HTMLButtonElement).disabled).toBe(true);
        await act(async () => { fireEvent.change(popover().getByRole("textbox", { name: "Page name" }), { target: { value: "Q3 review" } }); });
        expect(popover().queryByText("Give the page a name to create it.")).toBeNull();
        await act(async () => { fireEvent.click(popover().getByRole("button", { name: "Create page" })); });
        await settle();
        await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
        expect((await memory.history(WORKSPACE, RECORD, undefined)).commits.map((c) => c.mutation)).toEqual(["patch", "$init"]);
        expect((await readRecord()).get({ project: "ops", page: "Q3 review" })).toEqual(
            variant("page", { draft: { title: "Q3 review", cells: [] }, live: none }),
        );
        expect(paneRows(container)).toContain("Q3 review");
    }, 30_000);

    test("D5: a template's card opens it under the New page button, starting from that template; the page's draft is the template's placements", async () => {
        const { container } = await mountLibrary();
        await act(async () => { fireEvent.click(gallery(container, "templates").querySelector("[data-library-card=\"t-summary\"]")!); });
        await settle();
        expect(hangsFrom().getAttribute("data-state")).toBe("open");
        expect(picked()).toBe("Summary");
        await act(async () => { fireEvent.change(popover().getByRole("textbox", { name: "Page name" }), { target: { value: "Board" } }); });
        await act(async () => { fireEvent.click(popover().getByRole("button", { name: "Create page" })); });
        await settle();
        const page = (await readRecord()).get({ project: "ops", page: "Board" })!;
        if (page.type !== "page") throw new Error("expected a page");
        expect(page.value.draft.cells.map((c) => c.key)).toEqual(["c-kpi-1", "c-kpi-2", "c-trend"]);
        expect(page.value.live).toEqual(none);
    }, 30_000);

    test("D5: the dashed card opens it from Blank grid; a name the project holds is the field's error, and nothing is written", async () => {
        const { container } = await mountLibrary();
        await act(async () => { fireEvent.click(gallery(container, "pages").querySelector("[data-library-add]")!); });
        await settle();
        expect(hangsFrom().getAttribute("data-state")).toBe("open");
        expect(picked()).toBe("Blank grid");
        const name = popover().getByRole("textbox", { name: "Page name" });
        await act(async () => { fireEvent.change(name, { target: { value: "t-summary" } }); });
        expect(popover().getByText("t-summary is already a page or a template here.")).toBeTruthy();
        expect(name.getAttribute("aria-invalid")).toBe("true");
        expect((popover().getByRole("button", { name: "Create page" }) as HTMLButtonElement).disabled).toBe(true);
        await act(async () => { fireEvent.click(popover().getByRole("button", { name: "Cancel" })); });
        await settle();
        await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
        expect((await memory.history(WORKSPACE, RECORD, undefined)).commits.map((c) => c.mutation)).toEqual(["$init"]);
    }, 30_000);

    test("D5: the template picker offers Blank grid and the project's templates", async () => {
        await mountLibrary();
        await act(async () => { fireEvent.click(screen.getByRole("button", { name: "New page in ops" })); });
        await settle();
        await act(async () => { fireEvent.click(document.querySelector("[data-page-library-template]")!); });
        expect(screen.getAllByRole("option").map((o) => o.textContent)).toEqual(["Blank grid", "Empty", "Summary"]);
    }, 30_000);
});
