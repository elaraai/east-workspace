/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 *
 * @vitest-environment jsdom
 *
 * How placements of Studio components render (#991): two placements of one
 * component share its own state (K3) — the component binds a State key of its
 * own, so a click in one shows in the other; a key the surface does not list
 * is a placeholder naming it (K5); a key two listed components share is an
 * error naming it (K7).
 */

import { describe, test, expect, beforeEach, afterEach } from "vitest";
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { ChakraProvider } from "@chakra-ui/react";
import { East, IntegerType, NullType, type ValueTypeOf } from "@elaraai/east";
import { Button, Reactive, Stack, State, Text, UIComponentType } from "@elaraai/east-ui/internal";
import {
    EastChakraComponent, StateRuntime, UIStore, getRegisteredPlatformImplementations, system,
} from "@elaraai/east-ui-components";
import { Studio } from "@elaraai/e3-ui/internal";

class ResizeObserverStub { observe() {} unobserve() {} disconnect() {} }
(globalThis as { ResizeObserver?: unknown }).ResizeObserver ??= ResizeObserverStub;

beforeEach(() => { StateRuntime.initializeStore(new UIStore()); });
afterEach(() => {
    cleanup();
    localStorage.clear();
});

/** A counter: its clicks are its own State key. */
const counter = Studio.component("counter", { name: "Counter", category: "Display", icon: "gauge-high" },
    East.function([], UIComponentType, (_$) => Reactive.Root(East.function([], UIComponentType, ($) => {
        const clicks = $.let(State.bind([IntegerType], "studio-dom.clicks", 0n));
        const add = $.const(East.function([], NullType, ($2) => { $2(clicks.write(clicks.read().add(1n))); }));
        return Stack.HStack([
            Text.Root(East.str`${East.print(clicks.read())} clicks`),
            Button.Root("Add", { onClick: add }),
        ]);
    }))));

/** A page placing the counter twice. */
const page = East.compile(East.function([], UIComponentType, ($) => {
    const components = $.let([counter]);
    return Stack.VStack([Studio.dispatch(components, "counter"), Studio.dispatch(components, "counter")]);
}), getRegisteredPlatformImplementations()) as () => ValueTypeOf<typeof UIComponentType>;

describe("Studio placements (#991)", () => {
    test("K3: two placements of one component share its State keys — a click in one shows in both", async () => {
        render(<ChakraProvider value={system}><EastChakraComponent value={page()} storageKey="studio-dom" /></ChakraProvider>);
        expect(screen.getAllByText("0 clicks")).toHaveLength(2);
        await act(async () => { fireEvent.click(screen.getAllByRole("button", { name: "Add" })[0]!); });
        expect(screen.getAllByText("1 clicks")).toHaveLength(2);
    });

    test("K5: a key the surface does not list renders a placeholder naming it", () => {
        const retired = East.compile(East.function([], UIComponentType, ($) => {
            const components = $.let([counter]);
            return Studio.dispatch(components, "retired");
        }), getRegisteredPlatformImplementations()) as () => ValueTypeOf<typeof UIComponentType>;
        render(<ChakraProvider value={system}><EastChakraComponent value={retired()} storageKey="studio-dom" /></ChakraProvider>);
        expect(screen.getByText('No component "retired"')).toBeTruthy();
        expect(screen.queryByText("0 clicks")).toBeNull();
    });

    test("K7: a key two listed components share renders an error naming it", () => {
        const shared = East.compile(East.function([], UIComponentType, ($) => {
            const listed = $.let(counter);
            const components = $.let([listed, listed]);
            return Studio.dispatch(components, "counter");
        }), getRegisteredPlatformImplementations()) as () => ValueTypeOf<typeof UIComponentType>;
        render(<ChakraProvider value={system}><EastChakraComponent value={shared()} storageKey="studio-dom" /></ChakraProvider>);
        expect(screen.getByText('Two components share the key "counter"')).toBeTruthy();
        expect(screen.queryByText("0 clicks")).toBeNull();
    });
});
