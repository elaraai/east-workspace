/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Licensed under AGPL-3.0. See LICENSE file for details.
 *
 * @vitest-environment jsdom
 *
 * Guard for issue #114 at the **east-ui-components layer**.
 *
 * #114 is "Pages.Root does not switch on navigation inside an e3 ui() task".
 * This test mounts a `Pages`-in-`Reactive` value via `EastChakraComponent` —
 * both LIVE and after a full beast2 encode → decode — drives `nav.go.b()`, and
 * asserts the page content switches. BOTH PASS: the east-ui-components reactive
 * + decode path is correct, so the #114 defect is NOT here — it lives downstream
 * in the e3-ui-components webview path (`UITaskPreview` mounts the decoded value
 * inside a `UIStoreProvider` with a per-task `createUIStore()` + a queueMicrotask
 * scheduler, while the State/Nav handles read the global `getStore()` singleton).
 * This guard pins the layer so a future regression here would be caught.
 */

import { describe, test, expect, afterEach } from "vitest";
import { render, cleanup, act } from "@testing-library/react";
import { ChakraProvider } from "@chakra-ui/react";
import {
    East, NullType, toEastTypeValue, encodeBeast2For, decodeBeast2For,
    type ValueTypeOf,
} from "@elaraai/east";
import { Navigation, Pages, Reactive, Text, UIComponentType, NavBindHandleType } from "@elaraai/east-ui/internal";
import { system } from "../theme/index.js";
import { EastChakraComponent } from "../component.js";
import { initializeStore } from "../platform/state-runtime.js";
import { getRegisteredPlatformImplementations } from "../platform/registry.js";
import { UIStore } from "../platform/state-store.js";
import { NavImpl } from "../platform/nav/index.js";

afterEach(cleanup);

const routes = Navigation.config({
    a: { value: NullType, label: "A" },
    b: { value: NullType, label: "B" },
});
const KEY = "issue114.route";
const initialPath = [routes.Page.a()];

/**
 * Build the live `Pages`-in-`Reactive` UI value. Post-#124 the nav handle is
 * bound once in the enclosing `Reactive` and passed to `<Pages>` as a prop, so
 * the switcher reads `nav.current()` on that shared handle (no internal
 * re-bind) — the construction that fixes #114 by sharing one subscription.
 */
function buildPagesValue(): ValueTypeOf<typeof UIComponentType> {
    const program = East.function([], UIComponentType, (_$) =>
        Reactive.Root(East.function([], UIComponentType, ($2) => {
            const nav = $2.let(Navigation.bind(routes, KEY, initialPath));
            return Pages.Root({
                nav,
                pages: {
                    a: () => Text.Root("PAGE_A"),
                    b: () => Text.Root("PAGE_B"),
                },
            });
        })),
    );
    return East.compile(program, getRegisteredPlatformImplementations())() as ValueTypeOf<typeof UIComponentType>;
}

/** Drive a real nav handle on KEY (simulates a callback calling nav.go.b()). */
function navGoB(): void {
    const handle = NavImpl[0]!.fn!(
        toEastTypeValue(NavBindHandleType(routes.routes)),
        toEastTypeValue(routes.Route),
    )(KEY, initialPath) as { go: { b: (p: unknown) => null } };
    handle.go.b(null);
}

function mount(value: ValueTypeOf<typeof UIComponentType>) {
    return render(
        <ChakraProvider value={system}>
            <EastChakraComponent value={value} storageKey="issue114" />
        </ChakraProvider>,
    );
}

describe("issue #114 — Pages switches on navigation", () => {
    test("LIVE value (showcase path) switches page on navigation", () => {
        initializeStore(new UIStore());
        const { container } = mount(buildPagesValue());
        expect(container.textContent).toContain("PAGE_A");
        act(() => { navGoB(); });
        expect(container.textContent).toContain("PAGE_B");
    });

    test("DECODED value (e3 ui() task path) switches page on navigation", () => {
        initializeStore(new UIStore());
        const bytes = encodeBeast2For(UIComponentType)(buildPagesValue());
        const decoded = decodeBeast2For(UIComponentType, { platform: getRegisteredPlatformImplementations() })(bytes) as ValueTypeOf<typeof UIComponentType>;
        const { container } = mount(decoded);
        expect(container.textContent).toContain("PAGE_A");
        act(() => { navGoB(); });
        expect(container.textContent).toContain("PAGE_B");
    });
});

// Issue #142 — the residual of #114. When BOTH page bodies are themselves
// `<Reactive>`, the bodies the switcher matches between are `ReactiveComponent`
// values differing ONLY by a render function. `equalFor` treats every function as
// equal (comparison.ts), so `EastChakraComponent`'s memo declares overview-body
// === detail-body and bails the swap — the page never changes. The plain-`Text`
// guard above can't catch this (its bodies differ structurally). `EastChakraPages`
// remounts the active page by the route's store version, fixing it.
const KEY142 = "issue142.route";

function buildReactivePagesValue(): ValueTypeOf<typeof UIComponentType> {
    const program = East.function([], UIComponentType, (_$) =>
        Reactive.Root(East.function([], UIComponentType, ($2) => {
            const nav = $2.let(Navigation.bind(routes, KEY142, initialPath));
            return Pages.Root({
                nav,
                pages: {
                    // Each page is its own <Reactive> — the case that defeats the memo.
                    a: () => Reactive.Root(East.function([], UIComponentType, (_$2) => Text.Root("PAGE_A"))),
                    b: () => Reactive.Root(East.function([], UIComponentType, (_$2) => Text.Root("PAGE_B"))),
                },
            });
        })),
    );
    return East.compile(program, getRegisteredPlatformImplementations())() as ValueTypeOf<typeof UIComponentType>;
}

function navGoB142(): void {
    const handle = NavImpl[0]!.fn!(
        toEastTypeValue(NavBindHandleType(routes.routes)),
        toEastTypeValue(routes.Route),
    )(KEY142, initialPath) as { go: { b: (p: unknown) => null } };
    handle.go.b(null);
}

describe("issue #142 — Pages switches when both page bodies are <Reactive>", () => {
    test("LIVE value switches reactive page on navigation (memo would bail on equalFor)", () => {
        initializeStore(new UIStore());
        const { container } = mount(buildReactivePagesValue());
        expect(container.textContent).toContain("PAGE_A");
        act(() => { navGoB142(); });
        expect(container.textContent).toContain("PAGE_B");
        expect(container.textContent).not.toContain("PAGE_A");
    });

    test("DECODED value switches reactive page on navigation", () => {
        initializeStore(new UIStore());
        const bytes = encodeBeast2For(UIComponentType)(buildReactivePagesValue());
        const decoded = decodeBeast2For(UIComponentType, { platform: getRegisteredPlatformImplementations() })(bytes) as ValueTypeOf<typeof UIComponentType>;
        const { container } = mount(decoded);
        expect(container.textContent).toContain("PAGE_A");
        act(() => { navGoB142(); });
        expect(container.textContent).toContain("PAGE_B");
        expect(container.textContent).not.toContain("PAGE_A");
    });
});
