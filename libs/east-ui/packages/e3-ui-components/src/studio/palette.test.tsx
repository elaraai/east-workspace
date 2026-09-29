/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 *
 * @vitest-environment jsdom
 *
 * `<Studio.Palette>` rendered (#994): the pane's tab row and its rail (B1);
 * the search, the grouping and the Filter menu (B2); the cards by category
 * (B3); the component the canvas has selected, placed (B4); a click that
 * selects a component's first placement, and the drag source (B5); the Pages
 * tab (B6); and what is hidden and narrowed (B7). The surface shows the
 * builder's shared open page and selection beside the palette, and a button
 * selects a placement as the canvas would.
 */

import { describe, test, expect, beforeEach, afterEach } from "vitest";
import { act, cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { ChakraProvider } from "@chakra-ui/react";
import { East, NullType, SortedMap, compareFor, none, some, variant, type ValueTypeOf } from "@elaraai/east";
import { Button, Reactive, SnapGrid, Stack, State, Text, UIComponentType } from "@elaraai/east-ui/internal";
import {
    DragLayerProvider, EastChakraComponent, StateRuntime, UIStore, getRegisteredPlatformImplementations, system,
} from "@elaraai/east-ui-components";
import { Studio, StudioKeyType, StudioPagesType, builderKeys } from "@elaraai/e3-ui/internal";

type Key = ValueTypeOf<typeof Studio.Types.Key>;
type Entry = ValueTypeOf<typeof Studio.Types.Entry>;

class ResizeObserverStub { observe() {} unobserve() {} disconnect() {} }
(globalThis as { ResizeObserver?: unknown }).ResizeObserver ??= ResizeObserverStub;
(globalThis as { matchMedia?: unknown }).matchMedia ??= (query: string) => ({
    matches: false, media: query, onchange: null,
    addListener() {}, removeListener() {}, addEventListener() {}, removeEventListener() {}, dispatchEvent() { return false; },
});
(globalThis as { CSS?: { escape?: (s: string) => string } }).CSS ??= {};
(globalThis as { CSS: { escape?: (s: string) => string } }).CSS.escape ??= (s: string) => s.replace(/[^\w-]/g, "\\$&");

beforeEach(() => { StateRuntime.initializeStore(new UIStore()); });
afterEach(() => {
    cleanup();
    localStorage.clear();
});

/** The Overview (live, placing the trend twice), the Weekly (drafted past its live version), the Detail (never published), a template, and another project's page. */
const PAGES = new SortedMap<Key, Entry>([
    [{ project: "ops", page: "a-overview" }, variant("page", {
        draft: {
            title: "Overview",
            cells: [
                { key: "c-kpi", row: "r1", span: 12n, height: none, align: variant("top", null), title: none, component: "kpi_rail", fingerprint: "" },
                { key: "c-trend-1", row: "r2", span: 6n, height: none, align: variant("top", null), title: none, component: "revenue_trend", fingerprint: "" },
                { key: "c-trend-2", row: "r2", span: 6n, height: none, align: variant("top", null), title: none, component: "revenue_trend", fingerprint: "" },
            ],
        },
        live: some({
            version: 2n,
            page: {
                title: "Overview",
                cells: [
                    { key: "c-kpi", row: "r1", span: 12n, height: none, align: variant("top", null), title: none, component: "kpi_rail", fingerprint: "" },
                    { key: "c-trend-1", row: "r2", span: 6n, height: none, align: variant("top", null), title: none, component: "revenue_trend", fingerprint: "" },
                    { key: "c-trend-2", row: "r2", span: 6n, height: none, align: variant("top", null), title: none, component: "revenue_trend", fingerprint: "" },
                ],
            },
        }),
    })],
    [{ project: "ops", page: "b-weekly" }, variant("page", {
        draft: { title: "Weekly", cells: [] },
        live: some({ version: 1n, page: { title: "Weekly (old)", cells: [] } }),
    })],
    [{ project: "ops", page: "c-detail" }, variant("page", {
        draft: { title: "Detail", cells: [] },
        live: none,
    })],
    [{ project: "ops", page: "d-starter" }, variant("template", { title: "Starter", cells: [] })],
    [{ project: "retail", page: "home" }, variant("page", {
        draft: { title: "Home", cells: [] },
        live: some({ version: 1n, page: { title: "Home", cells: [] } }),
    })],
], compareFor(StudioKeyType));

/** The listed components: three offered, and a deprecated one that is not. */
const components = [
    Studio.component("kpi_rail", { name: "KPI rail", category: "Display", icon: "gauge-high", tags: ["kpi", "sales"] },
        East.function([], UIComponentType, (_$) => Text.Root("KPIs"))),
    Studio.component("revenue_trend", { name: "Revenue trend", category: "Charts", icon: "chart-area", tags: ["sales"], collections: ["Finance"] },
        East.function([], UIComponentType, (_$) => Text.Root("Trend"))),
    Studio.component("orders_by_week", { name: "Orders by week", category: "Charts", icon: "chart-column", tags: ["orders"] },
        East.function([], UIComponentType, (_$) => Text.Root("Orders"))),
    Studio.component("orders_table_v1", { name: "Legacy table", category: "Display", icon: "table", deprecated: true },
        East.function([], UIComponentType, (_$) => Text.Root("Rows"))),
];

/** The palette beside the builder's shared open page and selection, and a button that selects a placement as the canvas would. */
function mountPalette() {
    const keys = builderKeys(undefined);
    const surface = East.compile(East.function([], UIComponentType, (_$) => Reactive.Root(East.function([], UIComponentType, ($) => {
        const listed = $.let(components);
        const open = $.let(State.bind([StudioKeyType], keys.page, { project: "ops", page: "a-overview" }));
        const selection = $.let(State.bind([SnapGrid.Types.UiState], keys.ui, SnapGrid.uiState()));
        const selectSecond = $.const(East.function([], NullType, ($2) => {
            $2(selection.write(SnapGrid.uiState({ selected: "c-trend-2" })));
        }));
        return Stack.VStack([
            Text.Root(East.str`open ${open.read().page}`),
            Text.Root(selection.read().selected.match({
                some: (_$2, key) => East.str`picked ${key}`,
                none: (_$2) => East.value("picked nothing"),
            })),
            Button.Root("Select the second trend", { onClick: selectSecond }),
            Studio.Palette({ pages: East.value(PAGES, StudioPagesType), components: listed, project: "ops" }),
        ]);
    }))), getRegisteredPlatformImplementations()) as () => ValueTypeOf<typeof UIComponentType>;
    return render(
        <ChakraProvider value={system}>
            <DragLayerProvider>
                <EastChakraComponent value={surface()} storageKey="studio-palette" />
            </DragLayerProvider>
        </ChakraProvider>,
    );
}

/** The card a name sits on. */
const cardOf = (name: string) => screen.getByText(name).closest("[data-clickable]") as HTMLElement;

/** Opens a menu from the keyboard, then arrows down to an item and picks it — Zag's pointer handling needs a real pointer. */
async function pickFromMenu(trigger: HTMLElement, name: string) {
    await act(async () => { trigger.focus(); fireEvent.keyDown(trigger, { key: "ArrowDown" }); });
    const menu = screen.getByRole("menu");
    for (let step = 0; step < 20 && menu.querySelector("[data-highlighted]")?.textContent !== name; step++) {
        await act(async () => { fireEvent.keyDown(menu, { key: "ArrowDown" }); });
    }
    await act(async () => { fireEvent.keyDown(menu, { key: "Enter" }); });
}

describe("<Studio.Palette> (#994)", () => {
    test("B1: the row holds the Components and Pages tabs and the collapse control; collapsed, the rail shows the icon, the count and the name", async () => {
        const { container } = mountPalette();
        expect(screen.getAllByRole("tab").map(tab => tab.textContent)).toEqual(["Components", "Pages"]);
        expect(screen.getAllByRole("tab")[0]!.getAttribute("aria-selected")).toBe("true");

        await act(async () => { fireEvent.click(screen.getByRole("button", { name: "Collapse Components" })); });
        expect(screen.getByRole("button", { name: "Expand Components" })).toBeTruthy();
        expect(screen.queryAllByRole("tab")).toHaveLength(0);
        expect(container.querySelector("svg[data-icon=shapes]")).not.toBeNull();
        // Three components offered: the deprecated one is not counted.
        expect(screen.getByText("3")).toBeTruthy();
        expect(screen.getByText("Components")).toBeTruthy();
    });

    test("B2: the search counts the components, with its key; the grouping is by category; the Filter menu", () => {
        mountPalette();
        expect(screen.getByPlaceholderText("Search 3 components…")).toBeTruthy();
        expect(within(screen.getByRole("tabpanel", { name: "Components" })).getByText("⌘ /")).toBeTruthy();
        expect(screen.getByRole("button", { name: "Group by" }).textContent).toBe("Group · Category");
        expect(screen.getByRole("button", { name: "Filter" })).toBeTruthy();
    });

    test("B3: cards by category, each group counted; a card holds its icon, its name, what it reads and a lock", () => {
        const { container } = mountPalette();
        const heads = [...container.querySelectorAll("[data-library='studio.components'] span")]
            .filter(span => span.textContent === "Display" || span.textContent === "Charts")
            .map(span => `${span.textContent} ${span.nextElementSibling?.textContent}`);
        expect(heads).toEqual(["Display 1", "Charts 2"]);
        const trend = cardOf("Revenue trend");
        expect(trend.querySelector("svg[data-icon=chart-area]")).not.toBeNull();
        expect(within(trend).getByText("no data")).toBeTruthy();
        expect(within(trend).getByRole("img", { name: "Logic fixed by the developer" })).toBeTruthy();
        expect(screen.getAllByRole("img", { name: "Logic fixed by the developer" })).toHaveLength(3);
    });

    test("B4: the component the canvas has selected is placed, and counts its placements on the page", async () => {
        mountPalette();
        expect(cardOf("Revenue trend").hasAttribute("data-placed")).toBe(false);
        await act(async () => { fireEvent.click(screen.getByRole("button", { name: "Select the second trend" })); });
        const trend = cardOf("Revenue trend");
        expect(trend.hasAttribute("data-placed")).toBe(true);
        expect(within(trend).getByText("ON CANVAS · ×2")).toBeTruthy();
        expect(cardOf("KPI rail").hasAttribute("data-placed")).toBe(false);
    });

    test("B5: a click selects the component's first placement; one the page does not place selects nothing; the cards are drag sources", async () => {
        mountPalette();
        expect(screen.getByText("picked nothing")).toBeTruthy();
        await act(async () => { fireEvent.click(screen.getByText("Revenue trend")); });
        expect(screen.getByText("picked c-trend-1")).toBeTruthy();
        await act(async () => { fireEvent.click(screen.getByText("Orders by week")); });
        expect(screen.getByText("picked c-trend-1")).toBeTruthy();
        expect(cardOf("Orders by week").hasAttribute("data-draggable")).toBe(true);
    });

    test("B6: the Pages tab lists the project's pages with their status dots; the open page is placed; a click opens a page", async () => {
        mountPalette();
        await act(async () => { fireEvent.click(screen.getByRole("tab", { name: "Pages" })); });
        const pages = within(screen.getByRole("tabpanel", { name: "Pages" }));
        expect(pages.getByText("Overview")).toBeTruthy();
        expect(pages.getByText("Weekly")).toBeTruthy();
        expect(pages.getByText("Detail")).toBeTruthy();
        expect(pages.queryByText("Starter")).toBeNull();
        expect(pages.queryByText("Home")).toBeNull();
        expect(pages.getByText("LIVE · V2")).toBeTruthy();
        expect(pages.getByText("DRAFT · V1 LIVE")).toBeTruthy();
        expect(pages.getAllByRole("img", { name: "Live" })).toHaveLength(1);
        expect(pages.getAllByRole("img", { name: "Draft" })).toHaveLength(2);
        expect(cardOf("Overview").hasAttribute("data-placed")).toBe(true);

        await act(async () => { fireEvent.click(pages.getByText("Weekly")); });
        expect(screen.getByText("open b-weekly")).toBeTruthy();
        expect(cardOf("Weekly").hasAttribute("data-placed")).toBe(true);
        expect(cardOf("Overview").hasAttribute("data-placed")).toBe(false);
        // The Weekly places nothing, so the trend card has no placements to select.
        await act(async () => { fireEvent.click(screen.getByRole("tab", { name: "Components" })); });
        await act(async () => { fireEvent.click(screen.getByText("Revenue trend")); });
        expect(screen.getByText("picked nothing")).toBeTruthy();
    });

    test("B7: a deprecated component is hidden; the search and the Filter narrow the cards, and the counts follow", async () => {
        const { container } = mountPalette();
        expect(screen.queryByText("Legacy table")).toBeNull();

        await act(async () => { fireEvent.change(screen.getByPlaceholderText("Search 3 components…"), { target: { value: "trend" } }); });
        expect(screen.getByText("Revenue trend")).toBeTruthy();
        expect(screen.queryByText("KPI rail")).toBeNull();
        expect(screen.queryByText("Orders by week")).toBeNull();
        const chartsHead = [...container.querySelectorAll("[data-library='studio.components'] span")].find(span => span.textContent === "Charts")!;
        expect(chartsHead.nextElementSibling?.textContent).toBe("1");
        await act(async () => { fireEvent.change(screen.getByPlaceholderText("Search 3 components…"), { target: { value: "" } }); });

        await pickFromMenu(screen.getByRole("button", { name: "Filter" }), "orders");
        expect(screen.getByText("Orders by week")).toBeTruthy();
        expect(screen.queryByText("Revenue trend")).toBeNull();
        expect(screen.queryByText("KPI rail")).toBeNull();
    });
});
