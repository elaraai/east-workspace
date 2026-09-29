/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 *
 * @vitest-environment jsdom
 *
 * `<Studio.Page>` and `<Studio.Site>` rendered (#993): a site's rail lists the
 * project's live pages alone, and choosing one opens it (F1); two placements
 * of one component on a page share its State (F3); a frameless component's
 * tile has no frame (F5).
 */

import { describe, test, expect, beforeEach, afterEach } from "vitest";
import { act, cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { ChakraProvider } from "@chakra-ui/react";
import { East, IntegerType, NullType, SortedMap, compareFor, none, some, variant, type ValueTypeOf } from "@elaraai/east";
import { Button, Reactive, Stack, State, Text, UIComponentType } from "@elaraai/east-ui/internal";
import {
    EastChakraComponent, StateRuntime, UIStore, getRegisteredPlatformImplementations, system,
} from "@elaraai/east-ui-components";
import { Studio, StudioKeyType, StudioPagesType } from "@elaraai/e3-ui/internal";

type Key = ValueTypeOf<typeof Studio.Types.Key>;
type Entry = ValueTypeOf<typeof Studio.Types.Entry>;

class ResizeObserverStub { observe() {} unobserve() {} disconnect() {} }
(globalThis as { ResizeObserver?: unknown }).ResizeObserver ??= ResizeObserverStub;
(globalThis as { matchMedia?: unknown }).matchMedia ??= (query: string) => ({
    matches: false, media: query, onchange: null,
    addListener() {}, removeListener() {}, addEventListener() {}, removeEventListener() {}, dispatchEvent() { return false; },
});

beforeEach(() => { StateRuntime.initializeStore(new UIStore()); });
afterEach(() => {
    cleanup();
    localStorage.clear();
});

/** Two live pages of ops, a draft-only page, a template, and another project's live page. */
const PAGES = new SortedMap<Key, Entry>([
    [{ project: "ops", page: "a-overview" }, variant("page", {
        draft: { title: "Overview", cells: [] },
        live: some({
            version: 1n,
            page: {
                title: "Overview",
                cells: [
                    { key: "o-kpi", row: "r1", span: 12n, height: none, align: variant("top", null), title: none, component: "kpi", fingerprint: "" },
                    { key: "o-count-1", row: "r2", span: 6n, height: none, align: variant("top", null), title: none, component: "counter", fingerprint: "" },
                    { key: "o-count-2", row: "r2", span: 6n, height: none, align: variant("top", null), title: none, component: "counter", fingerprint: "" },
                ],
            },
        }),
    })],
    [{ project: "ops", page: "b-weekly" }, variant("page", {
        draft: { title: "Weekly", cells: [] },
        live: some({
            version: 1n,
            page: {
                title: "Weekly",
                cells: [
                    { key: "w-note", row: "r1", span: 12n, height: none, align: variant("top", null), title: none, component: "note", fingerprint: "" },
                ],
            },
        }),
    })],
    [{ project: "ops", page: "c-detail" }, variant("page", {
        draft: {
            title: "Detail",
            cells: [
                { key: "d-note", row: "r1", span: 12n, height: none, align: variant("top", null), title: none, component: "note", fingerprint: "" },
            ],
        },
        live: none,
    })],
    [{ project: "ops", page: "d-template" }, variant("template", {
        title: "Starter",
        cells: [
            { key: "t-note", row: "t1", span: 12n, height: none, align: variant("top", null), title: none, component: "note", fingerprint: "" },
        ],
    })],
    [{ project: "retail", page: "home" }, variant("page", {
        draft: { title: "Home", cells: [] },
        live: some({ version: 1n, page: { title: "Home", cells: [] } }),
    })],
], compareFor(StudioKeyType));

/** The components the surfaces list: a frameless KPI line, a note, and a counter with its own State key. */
const components = [
    Studio.component("kpi", { name: "KPIs", category: "Display", icon: "gauge-high", frame: "none" },
        East.function([], UIComponentType, (_$) => Text.Root("Revenue 1.28M"))),
    Studio.component("note", { name: "Note", category: "Display", icon: "note-sticky" },
        East.function([], UIComponentType, (_$) => Text.Root("Weekly figures"))),
    Studio.component("counter", { name: "Counter", category: "Display", icon: "gauge" },
        East.function([], UIComponentType, (_$) => Reactive.Root(East.function([], UIComponentType, ($) => {
            const clicks = $.let(State.bind([IntegerType], "studio-surfaces.clicks", 0n));
            const add = $.const(East.function([], NullType, ($2) => { $2(clicks.write(clicks.read().add(1n))); }));
            return Stack.HStack([Text.Root(East.str`${East.print(clicks.read())} clicks`), Button.Root("Add", { onClick: add })]);
        })))),
];

describe("<Studio.Page> and <Studio.Site> (#993)", () => {
    test("F1: the site's rail lists the project's live pages alone, and choosing one opens it", async () => {
        const site = East.compile(East.function([], UIComponentType, ($) => {
            const listed = $.let(components);
            return Studio.Site({ pages: East.value(PAGES, StudioPagesType), components: listed, project: "ops", title: "Ops console", id: "dom" });
        }), getRegisteredPlatformImplementations()) as () => ValueTypeOf<typeof UIComponentType>;
        render(<ChakraProvider value={system}><EastChakraComponent value={site()} storageKey="studio-site" /></ChakraProvider>);

        // The rail: the navigation that lists the pages (the breadcrumb names only the open one).
        const rail = screen.getAllByRole("navigation").find((nav) => within(nav).queryByText("Weekly") !== null)!;
        expect(within(rail).getByText("Overview")).toBeTruthy();
        expect(within(rail).getByText("Weekly")).toBeTruthy();
        for (const hidden of ["Detail", "Starter", "Home"]) expect(within(rail).queryByText(hidden)).toBeNull();
        // The first live page in key order is open.
        expect(screen.getByText("Revenue 1.28M")).toBeTruthy();

        await act(async () => { fireEvent.click(within(rail).getByText("Weekly")); });
        expect(screen.getByText("Weekly figures")).toBeTruthy();
        expect(screen.queryByText("Revenue 1.28M")).toBeNull();
    });

    test("F3 and F5: two placements of one component share its State; a frameless component's tile has no frame", async () => {
        const page = East.compile(East.function([], UIComponentType, ($) => {
            const listed = $.let(components);
            return Studio.Page({ pages: East.value(PAGES, StudioPagesType), components: listed, page: { project: "ops", page: "a-overview" } });
        }), getRegisteredPlatformImplementations()) as () => ValueTypeOf<typeof UIComponentType>;
        const { container } = render(<ChakraProvider value={system}><EastChakraComponent value={page()} storageKey="studio-page" /></ChakraProvider>);

        expect(screen.getAllByText("0 clicks")).toHaveLength(2);
        await act(async () => { fireEvent.click(screen.getAllByRole("button", { name: "Add" })[0]!); });
        expect(screen.getAllByText("1 clicks")).toHaveLength(2);

        const tile = (key: string) => container.querySelector(`[data-snap-grid-cell="${key}"]`);
        expect(tile("o-kpi")?.hasAttribute("data-frame")).toBe(false);
        expect(tile("o-count-1")?.hasAttribute("data-frame")).toBe(true);
    });
});
