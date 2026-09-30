/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 *
 * @vitest-environment jsdom
 *
 * `<Studio.Page>` rendered (#993): a page's live layout, or its draft when
 * asked, on the snap grid; two placements of one component share its State
 * (F3, K3); a frameless component's tile has no frame (F5); a placement whose
 * component the surface does not list is a placeholder naming it (K5), and
 * one whose key two listed components share an error naming it (K7); and what
 * a page says with nothing to draw.
 */

import { describe, test, expect, beforeEach, afterEach } from "vitest";
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { ChakraProvider } from "@chakra-ui/react";
import { East, IntegerType, NullType, SortedMap, compareFor, none, some, variant, type ValueTypeOf } from "@elaraai/east";
import { Button, Reactive, Stack, State, Text, UIComponentType } from "@elaraai/east-ui/internal";
import {
    EastChakraComponent, StateRuntime, UIStore, getRegisteredPlatformImplementations, system,
} from "@elaraai/east-ui-components";
import { Studio, StudioKeyType, StudioPagesType } from "@elaraai/e3-ui/internal";
// The page is an extension: its renderer registers as it loads.
import "./page.js";

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

/** The Overview live (a KPI line, the counter twice, a retired component) and drafted since; the Detail never published; a template. */
const PAGES = new SortedMap<Key, Entry>([
    [{ project: "ops", page: "a-overview" }, variant("page", {
        draft: {
            title: "Overview",
            cells: [
                { key: "o-note", row: "r1", span: 12n, height: none, align: variant("top", null), title: none, component: "note", fingerprint: "" },
            ],
        },
        live: some({
            version: 1n,
            page: {
                title: "Overview",
                cells: [
                    { key: "o-kpi", row: "r1", span: 12n, height: none, align: variant("top", null), title: none, component: "kpi", fingerprint: "" },
                    { key: "o-count-1", row: "r2", span: 6n, height: none, align: variant("top", null), title: none, component: "counter", fingerprint: "" },
                    { key: "o-count-2", row: "r2", span: 6n, height: none, align: variant("top", null), title: none, component: "counter", fingerprint: "" },
                    { key: "o-gone", row: "r3", span: 12n, height: none, align: variant("top", null), title: none, component: "retired", fingerprint: "" },
                ],
            },
        }),
    })],
    [{ project: "ops", page: "b-detail" }, variant("page", {
        draft: {
            title: "Detail",
            cells: [
                { key: "d-note", row: "r1", span: 12n, height: none, align: variant("top", null), title: none, component: "note", fingerprint: "" },
            ],
        },
        live: none,
    })],
    [{ project: "ops", page: "c-template" }, variant("template", {
        title: "Starter",
        cells: [
            { key: "t-kpi", row: "t1", span: 12n, height: none, align: variant("top", null), title: none, component: "kpi", fingerprint: "" },
        ],
    })],
], compareFor(StudioKeyType));

/** A note. */
const note = Studio.component("note", { name: "Note", category: "Display", icon: "note-sticky" },
    East.function([], UIComponentType, (_$) => Text.Root("Weekly figures")));

/** The components the page lists: a frameless KPI line, the note, and a counter with its own State key. */
const components = [
    Studio.component("kpi", { name: "KPIs", category: "Display", icon: "gauge-high", frame: "none" },
        East.function([], UIComponentType, (_$) => Text.Root("Revenue 1.28M"))),
    note,
    Studio.component("counter", { name: "Counter", category: "Display", icon: "gauge" },
        East.function([], UIComponentType, (_$) => Reactive.Root(East.function([], UIComponentType, ($) => {
            const clicks = $.let(State.bind([IntegerType], "studio-page.clicks", 0n));
            const add = $.const(East.function([], NullType, ($2) => { $2(clicks.write(clicks.read().add(1n))); }));
            return Stack.HStack([Text.Root(East.str`${East.print(clicks.read())} clicks`), Button.Root("Add", { onClick: add })]);
        })))),
];

/** Render a compiled page. */
function mount(page: ValueTypeOf<typeof UIComponentType>) {
    return render(<ChakraProvider value={system}><EastChakraComponent value={page} storageKey="studio-page" /></ChakraProvider>);
}

/** A tile of the page. */
const tile = (c: HTMLElement, key: string) => c.querySelector<HTMLElement>(`[data-snap-grid-cell="${key}"]`);

describe("<Studio.Page> (#993)", () => {
    test("the live layout on the snap grid; F3, K3: two placements of one component share its State — a click in one shows in both", async () => {
        const page = East.compile(East.function([], UIComponentType, ($) => {
            const listed = $.let(components);
            return Studio.Page({ pages: East.value(PAGES, StudioPagesType), components: listed, page: { project: "ops", page: "a-overview" } });
        }), getRegisteredPlatformImplementations()) as () => ValueTypeOf<typeof UIComponentType>;
        const { container } = mount(page());
        expect([...container.querySelectorAll("[data-snap-grid-cell]")].map((cell) => cell.getAttribute("data-snap-grid-cell")))
            .toEqual(["o-kpi", "o-count-1", "o-count-2", "o-gone"]);
        expect(screen.getByText("Revenue 1.28M")).toBeTruthy();
        expect(screen.getAllByText("0 clicks")).toHaveLength(2);
        await act(async () => { fireEvent.click(screen.getAllByRole("button", { name: "Add" })[0]!); });
        expect(screen.getAllByText("1 clicks")).toHaveLength(2);
    });

    test("F5: a frameless component's tile has no frame, any other's has one", () => {
        const page = East.compile(East.function([], UIComponentType, ($) => {
            const listed = $.let(components);
            return Studio.Page({ pages: East.value(PAGES, StudioPagesType), components: listed, page: { project: "ops", page: "a-overview" } });
        }), getRegisteredPlatformImplementations()) as () => ValueTypeOf<typeof UIComponentType>;
        const { container } = mount(page());
        expect(tile(container, "o-kpi")!.hasAttribute("data-frame")).toBe(false);
        expect(tile(container, "o-count-1")!.hasAttribute("data-frame")).toBe(true);
    });

    test("K5: a placement whose component the surface does not list is a placeholder naming it, in a tile", () => {
        const page = East.compile(East.function([], UIComponentType, ($) => {
            const listed = $.let(components);
            return Studio.Page({ pages: East.value(PAGES, StudioPagesType), components: listed, page: { project: "ops", page: "a-overview" } });
        }), getRegisteredPlatformImplementations()) as () => ValueTypeOf<typeof UIComponentType>;
        const { container } = mount(page());
        expect(tile(container, "o-gone")!.textContent).toContain('No component "retired"');
        expect(tile(container, "o-gone")!.hasAttribute("data-frame")).toBe(true);
    });

    test("K7: a placement whose key two listed components share is an error naming it", () => {
        const page = East.compile(East.function([], UIComponentType, ($) => {
            const listed = $.let(note);
            const shared = $.let([listed, listed]);
            return Studio.Page({ pages: East.value(PAGES, StudioPagesType), components: shared, page: { project: "ops", page: "b-detail" }, version: "draft" });
        }), getRegisteredPlatformImplementations()) as () => ValueTypeOf<typeof UIComponentType>;
        mount(page());
        expect(screen.getByText('Two components share the key "note"')).toBeTruthy();
        expect(screen.queryByText("Weekly figures")).toBeNull();
    });

    test("the draft when asked for, and a template's layout either way", () => {
        const draft = East.compile(East.function([], UIComponentType, ($) => {
            const listed = $.let(components);
            return Studio.Page({ pages: East.value(PAGES, StudioPagesType), components: listed, page: { project: "ops", page: "a-overview" }, version: "draft" });
        }), getRegisteredPlatformImplementations()) as () => ValueTypeOf<typeof UIComponentType>;
        const { container, unmount } = mount(draft());
        expect([...container.querySelectorAll("[data-snap-grid-cell]")].map((cell) => cell.getAttribute("data-snap-grid-cell"))).toEqual(["o-note"]);
        unmount();
        const template = East.compile(East.function([], UIComponentType, ($) => {
            const listed = $.let(components);
            return Studio.Page({ pages: East.value(PAGES, StudioPagesType), components: listed, page: { project: "ops", page: "c-template" } });
        }), getRegisteredPlatformImplementations()) as () => ValueTypeOf<typeof UIComponentType>;
        mount(template());
        expect(screen.getByText("Revenue 1.28M")).toBeTruthy();
    });

    test("a page not yet published says so; a page the record does not hold is named", () => {
        const unpublished = East.compile(East.function([], UIComponentType, ($) => {
            const listed = $.let(components);
            return Studio.Page({ pages: East.value(PAGES, StudioPagesType), components: listed, page: { project: "ops", page: "b-detail" } });
        }), getRegisteredPlatformImplementations()) as () => ValueTypeOf<typeof UIComponentType>;
        const { unmount } = mount(unpublished());
        expect(screen.getByText("b-detail is not published yet")).toBeTruthy();
        expect(screen.queryByText("Weekly figures")).toBeNull();
        unmount();
        const missing = East.compile(East.function([], UIComponentType, ($) => {
            const listed = $.let(components);
            return Studio.Page({ pages: East.value(PAGES, StudioPagesType), components: listed, page: { project: "ops", page: "gone" } });
        }), getRegisteredPlatformImplementations()) as () => ValueTypeOf<typeof UIComponentType>;
        mount(missing());
        expect(screen.getByText("No page gone")).toBeTruthy();
    });
});
