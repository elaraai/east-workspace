/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 *
 * @vitest-environment jsdom
 *
 * `<Library>`'s card additions and its Filter menu: a trailing glyph that
 * names itself and takes its tone; a placed card; a click that reports the
 * card, from the keyboard too when the card cannot be dragged; facets that
 * narrow the cards (AND across facets, OR within one) with the counts
 * following; and the noun the search box counts the items by.
 */

import { describe, test, expect, afterEach } from "vitest";
import { render, cleanup, act, fireEvent, screen, within } from "@testing-library/react";
import { ChakraProvider } from "@chakra-ui/react";
import { East, NullType, StringType, some, type ValueTypeOf } from "@elaraai/east";
import { Library, Reactive, State, Stack, Text, UIComponentType } from "@elaraai/east-ui/internal";
import { system } from "../../theme/index.js";
import { EastChakraComponent } from "../../component.js";
import { initializeStore } from "../../platform/state-runtime.js";
import { getRegisteredPlatformImplementations } from "../../platform/registry.js";
import { UIStore } from "../../platform/state-store.js";

// jsdom lacks the ResizeObserver the menu's positioner reaches for, and the
// CSS.escape the menu finds its items with.
class ResizeObserverStub { observe() {} unobserve() {} disconnect() {} }
(globalThis as { ResizeObserver?: unknown }).ResizeObserver ??= ResizeObserverStub;
(globalThis as { CSS?: { escape?: (s: string) => string } }).CSS ??= {};
(globalThis as { CSS: { escape?: (s: string) => string } }).CSS.escape ??= (s: string) => s.replace(/[^\w-]/g, "\\$&");

afterEach(cleanup);

function mount(value: ValueTypeOf<typeof UIComponentType>) {
    return render(
        <ChakraProvider value={system}>
            <EastChakraComponent value={value} storageKey="library-test" />
        </ChakraProvider>,
    );
}

/** Opens a menu from the keyboard, as its trigger's arrow key does. */
async function open(trigger: HTMLElement) {
    await act(async () => { trigger.focus(); fireEvent.keyDown(trigger, { key: "ArrowDown" }); });
}

/** Picks a menu item from the keyboard: arrows down to it, a step at a time, then Enter. */
async function pick(name: string) {
    const menu = screen.getByRole("menu");
    for (let step = 0; step < 20 && menu.querySelector("[data-highlighted]")?.textContent !== name; step++) {
        await act(async () => { fireEvent.keyDown(menu, { key: "ArrowDown" }); });
    }
    await act(async () => { fireEvent.keyDown(menu, { key: "Enter" }); });
}

describe("Library — card additions", () => {
    test("a trailing glyph names itself, and a toned glyph carries its tone", () => {
        initializeStore(new UIStore());
        mount(East.compile(East.function([], UIComponentType, (_$) => Library.Root([
            { id: "kpi", name: "KPI rail", live: false },
            { id: "home", name: "Home", live: true },
        ], {
            id: "things",
            item: r => ({
                key: r.id,
                label: r.name,
                trailing: r.live.ifElse(
                    () => some(Library.glyph("circle", "Live", "success")),
                    () => some(Library.glyph("lock", "Logic fixed by the developer")),
                ),
            }),
        })), getRegisteredPlatformImplementations())() as ValueTypeOf<typeof UIComponentType>);

        const lock = screen.getByRole("img", { name: "Logic fixed by the developer" });
        expect(lock.hasAttribute("data-tone")).toBe(false);
        expect(lock.querySelector("svg[data-icon=lock]")).not.toBeNull();
        const dot = screen.getByRole("img", { name: "Live" });
        expect(dot.getAttribute("data-tone")).toBe("success");
    });

    test("a placed card carries the placed state, and the others do not", () => {
        initializeStore(new UIStore());
        const { container } = mount(East.compile(East.function([], UIComponentType, (_$) => Library.Root([
            { id: "kpi", name: "KPI rail" },
            { id: "trend", name: "Revenue trend" },
        ], {
            id: "things",
            item: r => ({ key: r.id, label: r.name, placed: r.id.equal("trend") }),
        })), getRegisteredPlatformImplementations())() as ValueTypeOf<typeof UIComponentType>);

        const placed = container.querySelectorAll("[data-placed]");
        expect(placed).toHaveLength(1);
        expect(within(placed[0] as HTMLElement).getByText("Revenue trend")).toBeTruthy();
    });

    test("a click reports the card's key; a card that cannot be dragged is a button the keyboard clicks", async () => {
        initializeStore(new UIStore());
        mount(East.compile(East.function([], UIComponentType, (_$) => Reactive.Root(East.function([], UIComponentType, ($) => {
            const picked = $.let(State.bind([StringType], "library.test.picked", ""));
            const onCardClick = $.const(East.function([StringType], NullType, ($2, key) => { $2(picked.write(key)); }));
            return Stack.VStack([
                Text.Root(East.str`picked ${picked.read()}`),
                Library.Root([
                    { id: "kpi", name: "KPI rail", pinned: false },
                    { id: "home", name: "Home", pinned: true },
                ], {
                    id: "things",
                    item: r => ({ key: r.id, label: r.name, draggable: r.pinned.not() }),
                    onCardClick,
                }),
            ]);
        }))), getRegisteredPlatformImplementations())() as ValueTypeOf<typeof UIComponentType>);

        await act(async () => { fireEvent.click(screen.getByText("KPI rail")); });
        expect(screen.getByText("picked kpi")).toBeTruthy();

        const home = screen.getByRole("button", { name: /Home/ });
        await act(async () => { fireEvent.keyDown(home, { key: "Enter" }); });
        expect(screen.getByText("picked home")).toBeTruthy();
    });
});

describe("Library — the Filter menu and the noun", () => {
    test("checked values keep the cards that hold one — OR within a facet, AND across facets — and the counts follow", async () => {
        initializeStore(new UIStore());
        mount(East.compile(East.function([], UIComponentType, (_$) => Library.Root([
            { id: "kpi", name: "KPI rail", category: "Display", tags: ["kpi", "sales"] },
            { id: "trend", name: "Revenue trend", category: "Charts", tags: ["sales"] },
            { id: "orders", name: "Orders by week", category: "Charts", tags: ["orders"] },
        ], {
            id: "things",
            item: r => ({ key: r.id, label: r.name }),
            groupBy: [{ key: "category", label: "Category", value: r => r.category }],
            filters: [
                { key: "category", label: "Category", values: r => [r.category] },
                { key: "tags", label: "Tags", values: r => r.tags },
            ],
            search: r => r.name,
            noun: { singular: "component", plural: "components" },
        })), getRegisteredPlatformImplementations())() as ValueTypeOf<typeof UIComponentType>);

        expect(screen.getByPlaceholderText("Search 3 components…")).toBeTruthy();
        await open(screen.getByRole("button", { name: "Filter" }));
        await pick("Charts");
        // One category checked: the Charts pair stays, the Display card hides.
        expect(screen.queryByText("KPI rail")).toBeNull();
        expect(screen.getByText("Revenue trend")).toBeTruthy();
        expect(screen.getByText("Orders by week")).toBeTruthy();
        expect(screen.getByText("1 hidden by filter ·")).toBeTruthy();

        // AND across facets: Charts and the sales tag keep the trend alone.
        await pick("sales");
        expect(screen.queryByText("Orders by week")).toBeNull();
        expect(screen.getByText("Revenue trend")).toBeTruthy();
        // OR within a facet: the orders tag as well brings the orders back.
        await pick("orders");
        expect(screen.getByText("Orders by week")).toBeTruthy();
        expect(screen.getByRole("button", { name: "Filter · 3" })).toBeTruthy();

        await act(async () => { fireEvent.click(screen.getByText("Show all")); });
        expect(screen.getByText("KPI rail")).toBeTruthy();
        expect(screen.getByRole("button", { name: "Filter" })).toBeTruthy();
    });

    test("without a noun the search box counts items", () => {
        initializeStore(new UIStore());
        mount(East.compile(East.function([], UIComponentType, (_$) => Library.Root([
            { id: "kpi", name: "KPI rail" },
        ], {
            id: "things",
            item: r => ({ key: r.id, label: r.name }),
            search: r => r.name,
        })), getRegisteredPlatformImplementations())() as ValueTypeOf<typeof UIComponentType>);
        expect(screen.getByPlaceholderText("Search 1 item…")).toBeTruthy();
    });
});
