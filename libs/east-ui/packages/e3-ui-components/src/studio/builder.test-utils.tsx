/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

/**
 * What the `<Studio.Builder>` tests share (#1000): the studio examples' pages
 * record on e3 (#1376) — its patch door e3's own, its pages the tests', set
 * again before each test — the listed components, the builders a surface
 * mounts over it, and how a test reaches the palette, the canvas and the
 * inspector and does what an operator does to them.
 *
 * Importing it registers the builder's renderer, mounts the e3 harness and
 * resets the record before each test of the importing file.
 */

import { beforeEach } from "vitest";
import { fireEvent, screen, within } from "@testing-library/react";
import {
    East, NullType, SortedMap, compareFor, decodeBeast2For, encodeBeast2For, none, variant, type ValueTypeOf,
} from "@elaraai/east";
import { Reactive, Stack, State, Text, UIComponentType } from "@elaraai/east-ui/internal";
import { StateRuntime } from "@elaraai/east-ui-components";
import { Record, Studio, StudioKeyType, builderKeys } from "@elaraai/e3-ui/internal";
import * as ex from "@elaraai/e3-ui/examples/studio/studio";
import { act, e3Harness, settle } from "../e3-web-mount.test-utils.js";
// The builder is an extension: its renderer registers as it loads.
import "./builder.js";

export type Key = ValueTypeOf<typeof Studio.Types.Key>;
export type Entry = ValueTypeOf<typeof Studio.Types.Entry>;
export type Pages = ValueTypeOf<typeof Studio.Types.Pages>;
/** One placement of a page. */
export type Cell = ValueTypeOf<typeof Studio.Types.Cell>;
/** A layout: its title, its placements and its starting filters. */
export type Layout = ValueTypeOf<typeof Studio.Types.Page>;

/** The pages record the builder reads and saves, the studio examples': its name in the words a card, a tile and the inspector name what a component reads in. */
export const RECORD_NAMED = "Studio pages";
export const keys = compareFor(StudioKeyType);

/** The components' code. */
const kpiFn = East.function([], UIComponentType, (_$) => Text.Root("KPIs"));
const trendFn = East.function([], UIComponentType, (_$) => Reactive.Root(East.function([], UIComponentType, ($) => {
    const pages = $.let(Record.bind(ex.studioPages, ["patch"]));
    return Text.Root(East.str`${East.print(pages.read().size())} pages`);
})));
const ordersFn = East.function([], UIComponentType, (_$) => Text.Root("Orders"));
const barsFn = East.function([], UIComponentType, (_$) => Text.Root("Bars"));

/** The listed components: four offered — the trend's code reads the pages record — and a deprecated one that is not. */
export const components = [
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

export const OVERVIEW: Key = { project: "ops", page: "a-overview" };
export const REGIONAL: Key = { project: "ops", page: "f-regional" };

/**
 * In ops: the Overview (never published — the page the builder opens first),
 * the Weekly (live as v1, as it stands), the Monthly (live as v3, its draft
 * resized since), the Double (the trend placed twice), a template, and the
 * Regional (live as v3; its draft resizes the trend and adds the bars).
 * Another project's page.
 */
export const PAGES: Pages = Studio.value([
    {
        key: OVERVIEW,
        draft: {
            title: "Overview",
            cells: [
                { key: "c-kpi", row: "r1", span: 12n, height: none, align: variant("top", null), title: none, content: variant("component", "kpi_rail") },
                { key: "c-trend", row: "r2", span: 8n, height: none, align: variant("top", null), title: none, content: variant("component", "revenue_trend") },
            ],
            filters: [],
        },
    },
    {
        key: { project: "ops", page: "b-weekly" },
        draft: { title: "Weekly", cells: [{ key: "w-orders", row: "r1", span: 12n, height: none, align: variant("top", null), title: none, content: variant("component", "orders_by_week") }], filters: [] },
        live: { version: 1n, page: { title: "Weekly", cells: [{ key: "w-orders", row: "r1", span: 12n, height: none, align: variant("top", null), title: none, content: variant("component", "orders_by_week") }], filters: [] } },
    },
    {
        key: { project: "ops", page: "c-monthly" },
        draft: { title: "Monthly", cells: [{ key: "m-orders", row: "r1", span: 6n, height: none, align: variant("top", null), title: none, content: variant("component", "orders_by_week") }], filters: [] },
        live: { version: 3n, page: { title: "Monthly", cells: [{ key: "m-orders", row: "r1", span: 12n, height: none, align: variant("top", null), title: none, content: variant("component", "orders_by_week") }], filters: [] } },
    },
    {
        key: { project: "ops", page: "d-double" },
        draft: {
            title: "Double",
            cells: [
                { key: "d-trend-1", row: "r1", span: 6n, height: none, align: variant("top", null), title: none, content: variant("component", "revenue_trend") },
                { key: "d-trend-2", row: "r1", span: 6n, height: none, align: variant("top", null), title: none, content: variant("component", "revenue_trend") },
            ],
            filters: [],
        },
    },
    {
        key: { project: "ops", page: "e-starter" },
        template: {
            title: "Starter",
            cells: [{ key: "s-kpi", row: "r1", span: 12n, height: none, align: variant("top", null), title: none, content: variant("component", "kpi_rail") }],
            filters: [],
        },
    },
    {
        key: REGIONAL,
        draft: {
            title: "Regional",
            cells: [
                { key: "p-kpi", row: "r1", span: 12n, height: none, align: variant("top", null), title: none, content: variant("component", "kpi_rail") },
                { key: "p-trend", row: "r2", span: 8n, height: none, align: variant("top", null), title: none, content: variant("component", "revenue_trend") },
                { key: "p-bars", row: "r2", span: 4n, height: none, align: variant("top", null), title: none, content: variant("component", "breakdown_bars") },
            ],
            filters: [],
        },
        live: {
            version: 3n,
            page: {
                title: "Regional",
                cells: [
                    { key: "p-kpi", row: "r1", span: 12n, height: none, align: variant("top", null), title: none, content: variant("component", "kpi_rail") },
                    { key: "p-trend", row: "r2", span: 12n, height: none, align: variant("top", null), title: none, content: variant("component", "revenue_trend") },
                ],
                filters: [],
            },
        },
    },
    {
        key: { project: "retail", page: "home" },
        draft: { title: "Home", cells: [], filters: [] },
        live: { version: 1n, page: { title: "Home", cells: [], filters: [] } },
    },
]);

export const h = e3Harness({ "studio/studio": ex }, { measure: false });

/** The pages record's commits once the test's own pages were made: what a save adds to. */
export const before: string[] = [];

beforeEach(async () => {
    await h.patch(ex.studioPages, PAGES);
    before.splice(0, before.length, ...(await commits()));
});

/** Where the surface holds the page open in its builder, and where one that holds its page still says which page it was asked for. */
export const OPEN = "studio-test.open";
export const ASKED = "studio-test.asked";

/**
 * The builder over the record, as a surface mounts it: the record bound with
 * its patch door, the listed components, and the open page, which the surface
 * holds — the Overview to begin with — gives the builder, and writes when the
 * builder's palette asks for another.
 */
export const builder = {
    fn: East.function([], UIComponentType, (_$) => Reactive.Root(East.function([], UIComponentType, ($) => {
        const listed = $.let(components);
        const record = $.let(Record.bind(ex.studioPages, ["patch"]));
        const open = $.let(State.bind([StudioKeyType], OPEN, OVERVIEW));
        const go = $.const(East.function([StudioKeyType], NullType, ($2, key) => { $2(open.write(key)); }));
        return Studio.Builder({
            pages: record, components: listed, project: "ops", page: open.read(), onOpen: go,
            env: "Staging", audience: "Field ops · 24 users", rollout: "Immediate",
        });
    }))),
};

/** A builder whose surface holds its page still — the Regional — and only notes the page it was asked for. */
export const heldBuilder = {
    fn: East.function([], UIComponentType, (_$) => Reactive.Root(East.function([], UIComponentType, ($) => {
        const listed = $.let(components);
        const record = $.let(Record.bind(ex.studioPages, ["patch"]));
        const asked = $.let(State.bind([StudioKeyType], ASKED, { project: "", page: "" }));
        const note = $.const(East.function([StudioKeyType], NullType, ($2, key) => { $2(asked.write(key)); }));
        return Studio.Builder({ pages: record, components: listed, project: "ops", page: REGIONAL, onOpen: note });
    }))),
};

/** A builder given no page: it holds its own, and tells the surface the page it opened. */
export const ownBuilder = {
    fn: East.function([], UIComponentType, (_$) => Reactive.Root(East.function([], UIComponentType, ($) => {
        const listed = $.let(components);
        const record = $.let(Record.bind(ex.studioPages, ["patch"]));
        const asked = $.let(State.bind([StudioKeyType], ASKED, { project: "", page: "" }));
        const note = $.const(East.function([StudioKeyType], NullType, ($2, key) => { $2(asked.write(key)); }));
        return Studio.Builder({ pages: record, components: listed, project: "ops", onOpen: note });
    }))),
};

/** Two builders on one surface, each named and given no page: each holds its own. */
export const twoBuilders = {
    fn: East.function([], UIComponentType, (_$) => Reactive.Root(East.function([], UIComponentType, ($) => {
        const listed = $.let(components);
        const record = $.let(Record.bind(ex.studioPages, ["patch"]));
        return Stack.VStack([
            Studio.Builder({ pages: record, components: listed, project: "ops", id: "left" }),
            Studio.Builder({ pages: record, components: listed, project: "ops", id: "right" }),
        ]);
    }))),
};

/** Mount the builder over the record, under the page's drag layer, once what it reads has loaded. */
export const mountBuilder = () => h.mount(builder, { storageKey: "studio-builder" });

/** A page under a key, as the record holds one a solution ships (`Studio.value`): its draft, and its published version where it has one. */
export const pageAt = (key: Key, draft: Layout, live?: { version: bigint; page: Layout }): Entry =>
    Studio.value([live === undefined ? { key, draft } : { key, draft, live }]).get(key)!;

/** A template under a key, as the record holds one a solution ships. */
export const templateAt = (key: Key, template: Layout): Entry => Studio.value([{ key, template }]).get(key)!;

/** The pages as another session's write leaves them: one entry set, the others as they stand. */
export const withEntry = (key: Key, entry: Entry) => (now: Pages): Pages => new SortedMap([...now].filter(([k]) => keys(k, key) !== 0).concat([[key, entry]]), keys);

/** Open a page, as the builder's host does: it writes the open page it holds. */
export async function openPage(page: string) {
    await act(async () => {
        StateRuntime.getStore().write(OPEN, encodeBeast2For(StudioKeyType)({ project: "ops", page }));
    });
    await settle();
}

/** A page the surface holds in its state, if it has written one. */
export function held(key: string): Key | undefined {
    const bytes = StateRuntime.getStore().read(key);
    return bytes === undefined ? undefined : decodeBeast2For(StudioKeyType)(bytes);
}

/** The entry a page library and a builder once shared by id: nothing writes it (#1668). */
export const sharedEntry = () => StateRuntime.getStore().read("studio.builder.page");

/** The record as e3 holds it now. */
export const readRecord = (): Promise<Pages> => h.read(ex.studioPages);

/** The mutations the record committed, newest first. */
export async function commits(): Promise<string[]> {
    return (await h.history(ex.studioPages)).commits.map((c) => c.mutation);
}

/** Presses a button as a pointer does, with no wait: what a race sends. */
export function click(button: HTMLElement) {
    fireEvent.mouseDown(button, { button: 0 });
    fireEvent.click(button);
}

/** The toolbar's items, by key, in their order along the row. */
export const toolbarItems = (c: HTMLElement) =>
    [...c.querySelectorAll("[data-frame-slot=toolbar] [data-toolbar-item]")].map((el) => el.getAttribute("data-toolbar-item"));
/** A toolbar item, by its key. */
export const item = (c: HTMLElement, key: string) => c.querySelector<HTMLElement>(`[data-toolbar-item="${key}"]`)!;
/** A tile of the canvas. */
export const tile = (c: HTMLElement, key: string) => c.querySelector<HTMLElement>(`[data-snap-grid-tile="${key}"]`)!;
/** The palette — the canvas's start pane, in its builder frame. */
export const palette = (c: HTMLElement) => c.querySelector<HTMLElement>('[data-frame-slot="start"]')!;
/** A palette card, by the name on it. */
export const cardOf = (c: HTMLElement, name: string) => within(palette(c)).getByText(name).closest("[data-clickable]") as HTMLElement;
/** The inspector's pane — the canvas's end pane, in its builder frame. */
export const inspectorPane = (c: HTMLElement) => c.querySelector<HTMLElement>('[data-frame-slot="end"]')!;
/** The inspector's open tab's body, under its tab row — Configure's or Layout's; the other's is mounted, hidden. */
export const inspector = (c: HTMLElement) => inspectorPane(c).querySelector<HTMLElement>("[role=tabpanel]:not([hidden]) [data-studio-inspector]")!;
/** The inspector's open tab, by its name. */
export const openTabName = (c: HTMLElement) => within(inspectorPane(c)).getAllByRole("tab").find((tab) => tab.getAttribute("aria-selected") === "true")?.textContent;
/** Open a tab of the inspector — Configure or Layout. */
export async function openTab(c: HTMLElement, name: "Configure" | "Layout") {
    await act(async () => { fireEvent.click(within(inspectorPane(c)).getByRole("tab", { name })); });
    await settle();
}
/** The palette's components library's group heads of those names, each with its count, in order. */
export const groupHeads = (c: HTMLElement, names: readonly string[]) => [...palette(c).querySelectorAll(`[data-library='${builderKeys(undefined).components}'] span`)]
    .filter((span) => names.includes(span.textContent ?? ""))
    .map((span) => `${span.textContent} ${span.nextElementSibling?.textContent}`);
/** A tile's span, as the canvas draws it. */
export const spanOf = (c: HTMLElement, key: string) => tile(c, key).style.getPropertyValue("--snap-grid-span");
/** The rows as the canvas draws them: each row's tiles, by key. */
export const rowsDrawn = (c: HTMLElement) => [...c.querySelectorAll("[data-snap-grid-rows] [data-snap-grid-row]")]
    .map((row) => [...row.querySelectorAll("[data-snap-grid-tile]")].map((t) => t.getAttribute("data-snap-grid-tile")));
/** A text block's heading and paragraphs, as drawn in an element. */
export const textIn = (el: Element) => [
    el.querySelector("[data-studio-text-heading]")?.textContent,
    ...[...el.querySelectorAll("[data-studio-text-paragraph]")].map((p) => p.textContent),
];
/** A placement at the top of its row, under no title of its own. */
export const placed = (key: string, row: string, span: bigint, content: Cell["content"]): Cell =>
    ({ key, row, span, height: none, align: variant("top", null), title: none, content });

/** Select a placement on the canvas. */
export async function select(c: HTMLElement, key: string) {
    await act(async () => { fireEvent.click(tile(c, key)); });
    await settle();
}

/** Select a tile, and press a key on it. */
export async function keyOn(c: HTMLElement, key: string, init: { key: string }) {
    await act(async () => { fireEvent.click(tile(c, key)); });
    await act(async () => { fireEvent.keyDown(tile(c, key), init); });
    await settle();
}

/** Press a button by its name, as a pointer does. */
export async function press(name: string) {
    const button = screen.getByRole("button", { name });
    await act(async () => {
        fireEvent.mouseDown(button, { button: 0 });
        fireEvent.click(button);
    });
    await settle();
}

/** Opens a menu from the keyboard, then arrows down to an item and picks it — Zag's pointer handling needs a real pointer. */
export async function pickFromMenu(trigger: HTMLElement, name: string) {
    await act(async () => { trigger.focus(); fireEvent.keyDown(trigger, { key: "ArrowDown" }); });
    const menu = screen.getByRole("menu");
    for (let step = 0; step < 20 && menu.querySelector("[data-highlighted]")?.textContent !== name; step++) {
        await act(async () => { fireEvent.keyDown(menu, { key: "ArrowDown" }); });
    }
    await act(async () => { fireEvent.keyDown(menu, { key: "Enter" }); });
}

/** Drag an element onto another, as a pointer does: let go there, or held over it. */
export async function dragOnto(from: HTMLElement, onto: Element, drop = true) {
    await act(async () => {
        fireEvent.pointerDown(from, { clientX: 0, clientY: 0 });
        (document as unknown as { elementFromPoint: () => Element | null }).elementFromPoint = () => onto;
        fireEvent.pointerMove(document, { clientX: 10, clientY: 10 });
    });
    if (!drop) return;
    await act(async () => { fireEvent.pointerUp(document, { clientX: 10, clientY: 10 }); });
    await settle();
}

/** Drop a palette card on the canvas's end zone, as a pointer drags it there. */
export const dropCard = (c: HTMLElement, name: string) => dragOnto(cardOf(c, name), c.querySelector<HTMLElement>("[data-snap-grid-end]")!);
