/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 *
 * @vitest-environment jsdom
 *
 * `<Studio.Publish>` (#998) rendered beside the builder's canvas, over a pages
 * record in memory whose patch door applies each patch with East's own checks
 * — as `<Studio>` keeps the builder mounted under the preview. The bar (E1);
 * the page at the device's width (E2); the aside's head, versions and change
 * list — ready, a first version, up to date, a template (E3); the banner
 * (E4); the Audience and Rollout rows (E5); and the footer (E6): a publish is
 * one commit making the draft the next live version, the canvas's drafts are
 * applied first — one commit of their own — Save as draft is that Apply
 * alone, and a publish another overtook is refused in the preview's words.
 */

import { describe, test, expect, beforeEach, afterEach } from "vitest";
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { ChakraProvider } from "@chakra-ui/react";
import {
    East, NullType, PatchType, SortedMap, StringType, applyFor, compareFor, decodeBeast2For, encodeBeast2For, none, some, variant,
    type ValueTypeOf,
} from "@elaraai/east";
import { Reactive, Stack, State, Text, UIComponentType } from "@elaraai/east-ui/internal";
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
// The publish preview is an extension: its renderer registers as it loads.
import "./publish.js";

type Key = ValueTypeOf<typeof Studio.Types.Key>;
type Entry = ValueTypeOf<typeof Studio.Types.Entry>;
type Pages = ValueTypeOf<typeof Studio.Types.Pages>;

class ResizeObserverStub { observe() {} unobserve() {} disconnect() {} }
(globalThis as { ResizeObserver?: unknown }).ResizeObserver ??= ResizeObserverStub;
(globalThis as { matchMedia?: unknown }).matchMedia ??= (query: string) => ({
    matches: false, media: query, onchange: null,
    addListener() {}, removeListener() {}, addEventListener() {}, removeEventListener() {}, dispatchEvent() { return false; },
});
Element.prototype.scrollTo ??= function scrollTo() { /* jsdom lays nothing out */ };
(globalThis as { CSS?: { escape?: (s: string) => string } }).CSS ??= {};
(globalThis as { CSS: { escape?: (s: string) => string } }).CSS.escape ??= (s: string) => s.replace(/[^\w-]/g, "\\$&");

const WORKSPACE = "publish-test";
const RECORD = "publish_pages";
const keys = compareFor(StudioKeyType);
const HandleType = RecordBindHandleType(StudioPagesType, { patch: [PatchType(StudioPagesType)] });

/** The components' code — the fingerprints a live version's cells store. */
const kpiFn = East.function([], UIComponentType, (_$) => Text.Root("KPIs"));
const trendFn = East.function([], UIComponentType, (_$) => Text.Root("Trend"));
const barsFn = East.function([], UIComponentType, (_$) => Text.Root("Bars"));
const kpiPrint = fingerprintOf(kpiFn);
const trendPrint = fingerprintOf(trendFn);

/** The listed components. */
const components = [
    Studio.component("kpi_rail", { name: "KPI rail", category: "Display", icon: "gauge-high" }, kpiFn),
    Studio.component("revenue_trend", { name: "Revenue trend", category: "Charts", icon: "chart-area", span: 8n }, trendFn),
    Studio.component("breakdown_bars", { name: "Breakdown bars", category: "Display", icon: "chart-bar", span: 4n }, barsFn),
];

const OVERVIEW: Key = { project: "ops", page: "a-overview" };

/**
 * The Overview (live as v3; its draft resizes the trend and adds the bars), the
 * Detail (never published), the Weekly (live as v1, as it stands), the Monthly
 * (live as v2, both components' code changed since) and a template.
 */
const PAGES: Pages = new SortedMap<Key, Entry>([
    [OVERVIEW, variant("page", {
        draft: {
            title: "Overview",
            cells: [
                { key: "c-kpi", row: "r1", span: 12n, height: none, align: variant("top", null), title: none, component: "kpi_rail", fingerprint: kpiPrint },
                { key: "c-trend", row: "r2", span: 8n, height: none, align: variant("top", null), title: none, component: "revenue_trend", fingerprint: trendPrint },
                { key: "c-bars", row: "r2", span: 4n, height: none, align: variant("top", null), title: none, component: "breakdown_bars", fingerprint: "" },
            ],
        },
        live: some({
            version: 3n,
            page: {
                title: "Overview",
                cells: [
                    { key: "c-kpi", row: "r1", span: 12n, height: none, align: variant("top", null), title: none, component: "kpi_rail", fingerprint: kpiPrint },
                    { key: "c-trend", row: "r2", span: 12n, height: none, align: variant("top", null), title: none, component: "revenue_trend", fingerprint: trendPrint },
                ],
            },
        }),
    })],
    [{ project: "ops", page: "b-detail" }, variant("page", {
        draft: { title: "Detail", cells: [{ key: "d-kpi", row: "r1", span: 12n, height: none, align: variant("top", null), title: none, component: "kpi_rail", fingerprint: "" }] },
        live: none,
    })],
    [{ project: "ops", page: "c-weekly" }, variant("page", {
        draft: { title: "Weekly", cells: [{ key: "w-kpi", row: "r1", span: 12n, height: none, align: variant("top", null), title: none, component: "kpi_rail", fingerprint: kpiPrint }] },
        live: some({ version: 1n, page: { title: "Weekly", cells: [{ key: "w-kpi", row: "r1", span: 12n, height: none, align: variant("top", null), title: none, component: "kpi_rail", fingerprint: kpiPrint }] } }),
    })],
    [{ project: "ops", page: "d-monthly" }, variant("page", {
        draft: {
            title: "Monthly",
            cells: [
                { key: "m-kpi", row: "r1", span: 12n, height: none, align: variant("top", null), title: none, component: "kpi_rail", fingerprint: "an older fingerprint" },
                { key: "m-trend", row: "r2", span: 12n, height: none, align: variant("top", null), title: none, component: "revenue_trend", fingerprint: "an older fingerprint" },
            ],
        },
        live: some({
            version: 2n,
            page: {
                title: "Monthly",
                cells: [
                    { key: "m-kpi", row: "r1", span: 12n, height: none, align: variant("top", null), title: none, component: "kpi_rail", fingerprint: "an older fingerprint" },
                    { key: "m-trend", row: "r2", span: 12n, height: none, align: variant("top", null), title: none, component: "revenue_trend", fingerprint: "an older fingerprint" },
                ],
            },
        }),
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

/** The builder's canvas and the preview beside it, over the record, and a line saying whether Exit was pressed. */
async function mountPreview() {
    const program = East.compile(East.function([], UIComponentType, (_$) => Reactive.Root(East.function([], UIComponentType, ($) => {
        const listed = $.let(components);
        const record = $.let(recordBindPlatformFn([HandleType], RECORD));
        const said = $.let(State.bind([StringType], "publish-test.said", "nothing"));
        const onExit = $.const(East.function([], NullType, ($2) => { $2(said.write("exit")); }));
        return Stack.VStack([
            Text.Root(East.str`pressed ${said.read()}`),
            Studio.Canvas({ pages: record as never, components: listed, project: "ops" }),
            Studio.Publish({
                pages: record as never, components: listed, project: "ops",
                env: "Staging", audience: "Field ops · 24 users", rollout: "Immediate", onExit,
            }),
        ]);
    }))), getRegisteredPlatformImplementations()) as () => ValueTypeOf<typeof UIComponentType>;
    const utils = render(
        <ChakraProvider value={system}>
            <DragLayerProvider>
                <EastChakraComponent value={program()} storageKey="studio-publish" />
            </DragLayerProvider>
        </ChakraProvider>,
    );
    await settle();
    return utils;
}

/** Let the record's reads, the writes and the renders settle. */
async function settle() {
    await act(async () => {
        for (let i = 0; i < 8; i++) await new Promise<void>((resolve) => { setTimeout(resolve, 0); });
    });
}

/** Open a page, as the palette's Pages tab does. */
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
/** A tile of the canvas. */
const tile = (c: HTMLElement, key: string) => c.querySelector<HTMLElement>(`[data-snap-grid-tile="${key}"]`)!;

describe("<Studio.Publish> — the bar and the page (#998)", () => {
    test("E1: headerless — its bar first: ● Preview, Desktop · Tablet · Mobile, the Env pill and Exit, which returns to the builder", async () => {
        const { container } = await mountPreview();
        const bar = part(container, "bar")!;
        expect(preview(container).firstElementChild).toBe(bar);
        expect(bar.firstElementChild!.textContent).toBe("Preview");
        const devices = [...part(container, "devices")!.querySelectorAll("button")];
        expect(devices.map((b) => [b.textContent, b.getAttribute("aria-pressed")]))
            .toEqual([["Desktop", "true"], ["Tablet", "false"], ["Mobile", "false"]]);
        expect(part(container, "env")!.textContent).toBe("Env ·Staging");
        expect(part(container, "env")!.querySelector("svg[data-icon=chevron-down]")).not.toBeNull();
        expect(screen.getByText("pressed nothing")).toBeTruthy();
        await act(async () => { fireEvent.click(part(container, "exit")!); });
        await settle();
        expect(screen.getByText("pressed exit")).toBeTruthy();
    }, 30_000);

    test("E2: the page as it will publish — its project, its title, and its layout at most the device's width", async () => {
        const { container } = await mountPreview();
        const frame = () => part(container, "frame")!;
        // The page's head sits in the frame with it.
        expect(frame().firstElementChild!.textContent).toBe("opsOverview");
        expect(frame().querySelector("h2")!.textContent).toBe("Overview");
        expect(frame().style.maxWidth).toBe("1440px");
        expect([...frame().querySelectorAll("[data-snap-grid-cell]")].map((cell) => cell.getAttribute("data-snap-grid-cell")))
            .toEqual(["c-kpi", "c-trend", "c-bars"]);
        await act(async () => { fireEvent.click(part(container, 'device="tablet"')!); });
        expect(frame().style.maxWidth).toBe("1024px");
        await act(async () => { fireEvent.click(part(container, 'device="mobile"')!); });
        expect(frame().style.maxWidth).toBe("390px");
        expect(frame().getAttribute("data-publish-frame")).toBe("mobile");
        expect(part(container, 'device="mobile"')!.getAttribute("aria-pressed")).toBe("true");
        // The builder's canvas keeps its own width.
        expect(container.querySelector<HTMLElement>("[data-snap-grid-canvas]")!.style.maxWidth).toBe("1440px");
    }, 30_000);
});

describe("<Studio.Publish> — the aside (#998)", () => {
    test("E3, E5: ready to publish — the version it replaces and the next, the changes since, and who sees it when", async () => {
        const { container } = await mountPreview();
        expect(part(container, "head")!.textContent).toBe("Ready to publish");
        expect(part(container, "versions")!.textContent).toBe("Overview · v3 → v4");
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
        const { container } = await mountPreview();
        await openPage("b-detail");
        expect(part(container, "head")!.textContent).toBe("Ready to publish");
        expect(part(container, "versions")!.textContent).toBe("Detail · v1");
        expect(part(container, "count")!.textContent).toBe("1 change · first version");
        expect(rows(container)).toEqual([["+", "Added KPI rail", "row 1 · span 12"]]);
        expect(part(container, "banner")).toBeNull();
        expect(publishButton(container).textContent).toBe("Publish v1 to Staging");
    }, 30_000);

    test("E3: a page live as it stands is up to date — nothing to publish, and no banner", async () => {
        const { container } = await mountPreview();
        await openPage("c-weekly");
        expect(part(container, "head")!.textContent).toBe("Up to date");
        expect(part(container, "versions")!.textContent).toBe("Weekly · v1 live");
        expect(part(container, "count")!.textContent).toBe("No changes since v1");
        expect(part(container, "changes")).toBeNull();
        expect(part(container, "banner")).toBeNull();
        expect(publishButton(container).disabled).toBe(true);
        expect(saveButton(container).disabled).toBe(true);
    }, 30_000);

    test("E3: a template is not published — no change list, and no banner", async () => {
        const { container } = await mountPreview();
        await openPage("e-starter");
        expect(part(container, "head")!.textContent).toBe("Templates are not published");
        expect(part(container, "versions")!.textContent).toBe("Starter · template");
        expect(part(container, "count")).toBeNull();
        expect(part(container, "banner")).toBeNull();
        expect(publishButton(container).textContent).toBe("Publish");
        expect(publishButton(container).disabled).toBe(true);
    }, 30_000);

    test("E4: the banner says the logic is unchanged — or names the components whose code changed since the live version", async () => {
        const { container } = await mountPreview();
        const banner = () => part(container, "banner")!;
        expect(banner().getAttribute("data-tone")).toBe("change");
        // The design system's banner: its glyph, then its words.
        expect([banner().firstElementChild!.textContent, banner().lastElementChild!.textContent])
            .toEqual(["△", "Component logic unchanged — only layout changed. Safe to publish."]);
        await openPage("d-monthly");
        // Its layout is as it went live; the trend's code is not.
        expect(part(container, "head")!.textContent).toBe("Ready to publish");
        expect(part(container, "count")!.textContent).toBe("No changes since v2");
        expect(banner().getAttribute("data-tone")).toBe("warning");
        expect(banner().getAttribute("role")).toBe("alert");
        expect([banner().firstElementChild!.textContent, banner().lastElementChild!.textContent])
            .toEqual(["!", "Logic changed since v2 in KPI rail and Revenue trend — their placements publish with their new code"]);
    }, 30_000);
});

describe("<Studio.Publish> — the banner's words (#998)", () => {
    test("E4: one component is its; several are theirs, named in the order they are placed", () => {
        expect(studioMessages.logicChangedIn({ version: "v2", components: ["Revenue trend"] }))
            .toBe("Logic changed since v2 in Revenue trend — its placements publish with its new code");
        expect(studioMessages.logicChangedIn({ version: "v2", components: ["KPI rail", "Revenue trend", "Breakdown bars"] }))
            .toBe("Logic changed since v2 in KPI rail, Revenue trend and Breakdown bars — their placements publish with their new code");
    });
});

describe("<Studio.Publish> — the footer (#998)", () => {
    test("E6: Publish is one commit — the draft the next live version, each placement stamped with its code — and the page is up to date", async () => {
        const { container } = await mountPreview();
        await act(async () => { fireEvent.click(publishButton(container)); });
        await settle();
        await waitFor(() => expect(part(container, "head")!.textContent).toBe("Up to date"));
        expect(part(container, "refused")).toBeNull();
        expect(await commits()).toEqual(["patch", "$init"]);
        const overview = (await readRecord()).get(OVERVIEW)!;
        if (overview.type !== "page" || overview.value.live.type !== "some") throw new Error("expected a published page");
        expect(overview.value.live.value.version).toBe(4n);
        expect(overview.value.live.value.page).toEqual(overview.value.draft);
        expect(overview.value.draft.cells.map((c) => c.fingerprint)).toEqual([kpiPrint, trendPrint, fingerprintOf(barsFn)]);
        expect(part(container, "versions")!.textContent).toBe("Overview · v4 live");
    }, 30_000);

    test("E6: with drafts on the canvas, the page shown is the drafted one; Publish applies them first — the canvas's own commit — then publishes them", async () => {
        const { container } = await mountPreview();
        await act(async () => { fireEvent.click(tile(container, "c-trend")); });
        await act(async () => { fireEvent.keyDown(tile(container, "c-trend"), { key: "[" }); });
        await settle();
        // The preview shows what will publish: the trend at 7, unsaved.
        expect(rows(container)[0]).toEqual(["±", "Resized Revenue trend", "span 12 → 7"]);
        expect(saveButton(container).disabled).toBe(false);
        await act(async () => { fireEvent.click(publishButton(container)); });
        await settle();
        await waitFor(() => expect(part(container, "head")!.textContent).toBe("Up to date"));
        expect(part(container, "refused")).toBeNull();
        expect(await commits()).toEqual(["patch", "patch", "$init"]);
        const overview = (await readRecord()).get(OVERVIEW)!;
        if (overview.type !== "page" || overview.value.live.type !== "some") throw new Error("expected a published page");
        expect(overview.value.live.value.version).toBe(4n);
        expect(overview.value.live.value.page.cells.map((c) => [c.key, c.span])).toEqual([["c-kpi", 12n], ["c-trend", 7n], ["c-bars", 4n]]);
        expect(saveButton(container).disabled).toBe(true);
    }, 30_000);

    test("E6: Save as draft is the canvas's Apply alone — one commit to the draft, nothing published", async () => {
        const { container } = await mountPreview();
        await act(async () => { fireEvent.click(tile(container, "c-trend")); });
        await act(async () => { fireEvent.keyDown(tile(container, "c-trend"), { key: "[" }); });
        await settle();
        await act(async () => { fireEvent.click(saveButton(container)); });
        await settle();
        await waitFor(() => expect(saveButton(container).disabled).toBe(true));
        expect(await commits()).toEqual(["patch", "$init"]);
        const overview = (await readRecord()).get(OVERVIEW)!;
        if (overview.type !== "page" || overview.value.live.type !== "some") throw new Error("expected a page");
        expect(overview.value.draft.cells.find((c) => c.key === "c-trend")!.span).toBe(7n);
        expect(overview.value.live.value.version).toBe(3n);
        expect(part(container, "head")!.textContent).toBe("Ready to publish");
    }, 30_000);

    test("E6: a publish another overtook is refused above the footer, in the preview's words — and the other stands", async () => {
        const { container } = await mountPreview();
        // Another operator publishes between this publish's read and its commit.
        const publish = East.compile(Studio.publish, []);
        const forward = memory.mutate.bind(memory);
        let raced = false;
        memory.mutate = async (ws, record, mutation, request) => {
            if (!raced) {
                raced = true;
                const other = publish(await readRecord(), OVERVIEW, []);
                await forward(ws, record, mutation, { args: [encodeBeast2For(PatchType(StudioPagesType))(other)] });
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
