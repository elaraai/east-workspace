/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Licensed under AGPL-3.0. See LICENSE file for details.
 *
 * @vitest-environment jsdom
 *
 * `<App>` shell renderer (#367): the shell composes rail + breadcrumb + routed
 * body from one `Navigation.bind` handle. This guard mounts an `App`-in-`Reactive`
 * value via `EastChakraComponent`, asserts the rail / breadcrumb / title / body all
 * render, drives navigation (the rail's `navigateTo`) and asserts the body + active
 * row switch, and verifies `AppProvider` injects host React nodes into the app bar.
 */

import { describe, test, expect, afterEach } from "vitest";
import type { ReactNode } from "react";
import { render, cleanup, act } from "@testing-library/react";
import { ChakraProvider } from "@chakra-ui/react";
import { East, NullType, toEastTypeValue, type ValueTypeOf } from "@elaraai/east";
import { App, Navigation, Reactive, Text, UIComponentType, NavBindHandleType } from "@elaraai/east-ui/internal";
import { system } from "../../theme/index.js";
import { EastChakraComponent } from "../../component.js";
import { AppProvider } from "../app-provider.js";
import { initializeStore } from "../../platform/state-runtime.js";
import { getRegisteredPlatformImplementations } from "../../platform/registry.js";
import { UIStore } from "../../platform/state-store.js";
import { NavImpl } from "../../platform/nav/index.js";

afterEach(cleanup);

const routes = Navigation.config({
    overview: { value: NullType, label: "Overview", section: "Analyse", icon: { prefix: "fas", name: "gauge-high" } },
    audit: { value: NullType, label: "Audit", section: "Manage", icon: { prefix: "fas", name: "list-check" } },
});
const KEY = "app.test.route";
const initialPath = [routes.Page.overview()];

/** Build the live `App`-in-`Reactive` value — bound once, shared with the shell. */
function buildAppValue(): ValueTypeOf<typeof UIComponentType> {
    const program = East.function([], UIComponentType, (_$) =>
        Reactive.Root(East.function([], UIComponentType, ($2) => {
            const nav = $2.let(Navigation.bind(routes, KEY, initialPath));
            return App.Root({
                nav,
                config: routes,
                title: "Ops Console",
                pages: {
                    overview: () => Text.Root("BODY_OVERVIEW"),
                    audit: () => Text.Root("BODY_AUDIT"),
                },
            });
        })),
    );
    return East.compile(program, getRegisteredPlatformImplementations())() as ValueTypeOf<typeof UIComponentType>;
}

/** Drive a real nav handle on KEY (simulates the rail's onSelect → navigateTo). */
function navGoAudit(): void {
    const handle = NavImpl[0]!.fn!(
        toEastTypeValue(NavBindHandleType(routes.routes)),
        toEastTypeValue(routes.Route),
    )(KEY, initialPath) as { navigateTo: (p: unknown) => null };
    handle.navigateTo([routes.Page.audit()]);
}

function mount(value: ValueTypeOf<typeof UIComponentType>, provider?: { barEnd?: ReactNode }) {
    const tree = <EastChakraComponent value={value} storageKey="app.test" />;
    return render(
        <ChakraProvider value={system}>
            {provider ? <AppProvider barEnd={provider.barEnd}>{tree}</AppProvider> : tree}
        </ChakraProvider>,
    );
}

describe("<App> shell renderer (#367)", () => {
    test("renders rail + breadcrumb + title + routed body from one handle", () => {
        initializeStore(new UIStore());
        const { container } = mount(buildAppValue());
        // Rail rows (config labels) + section headings.
        expect(container.textContent).toContain("Overview");
        expect(container.textContent).toContain("Audit");
        expect(container.textContent).toContain("Analyse");
        expect(container.textContent).toContain("Manage");
        // Title + the active route's body.
        expect(container.textContent).toContain("Ops Console");
        expect(container.textContent).toContain("BODY_OVERVIEW");
        expect(container.textContent).not.toContain("BODY_AUDIT");
    });

    test("navigating switches the routed body", () => {
        initializeStore(new UIStore());
        const { container } = mount(buildAppValue());
        expect(container.textContent).toContain("BODY_OVERVIEW");
        act(() => { navGoAudit(); });
        expect(container.textContent).toContain("BODY_AUDIT");
        expect(container.textContent).not.toContain("BODY_OVERVIEW");
    });

    test("AppProvider injects host React nodes into the app bar", () => {
        initializeStore(new UIStore());
        const { container } = mount(buildAppValue(), { barEnd: <span>INJECTED_BAR_END</span> });
        expect(container.textContent).toContain("INJECTED_BAR_END");
        // The shell still renders alongside the injected chrome.
        expect(container.textContent).toContain("Ops Console");
    });
});
