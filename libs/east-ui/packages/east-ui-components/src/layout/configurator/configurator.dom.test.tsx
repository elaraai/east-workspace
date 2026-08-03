/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 *
 * @vitest-environment jsdom
 *
 * Behaviour guard for the Configurator's collapsible control column:
 *   - the toggle collapses the controls to the rail and back (aria round-trip),
 *   - the control rows are kept mounted (in the DOM) while collapsed, so a
 *     control's state survives the collapse,
 *   - collapsed state defaults to expanded and persists per instance under the
 *     structural storage key (a fresh mount rehydrates it),
 *   - the derived spec readout stays visible while the controls are collapsed
 *     (it lives in the sidebar, not the control column).
 */

import { describe, test, expect, afterEach } from "vitest";
import { render, cleanup, act, fireEvent } from "@testing-library/react";
import { ChakraProvider } from "@chakra-ui/react";
import { East, type ValueTypeOf } from "@elaraai/east";
import { Configurator, Text, UIComponentType } from "@elaraai/east-ui/internal";
import { system } from "../../theme/index.js";
import { EastChakraComponent } from "../../component.js";
import { initializeStore } from "../../platform/state-runtime.js";
import { getRegisteredPlatformImplementations } from "../../platform/registry.js";
import { UIStore } from "../../platform/state-store.js";

afterEach(() => {
    cleanup();
    window.localStorage.clear();
});

function compileUI(program: ReturnType<typeof East.function>): ValueTypeOf<typeof UIComponentType> {
    return East.compile(program, getRegisteredPlatformImplementations())() as ValueTypeOf<typeof UIComponentType>;
}

function buildConfigurator(): ValueTypeOf<typeof UIComponentType> {
    return compileUI(East.function([], UIComponentType, (_$) =>
        Configurator.Root({
            controls: [Configurator.Control("Density", "compact", Text.Root("ROWCTL"))],
            preview: Text.Root("PREVIEW"),
        }),
    ));
}

function mount(value: ValueTypeOf<typeof UIComponentType>, storageKey = "cfg-test") {
    return render(
        <ChakraProvider value={system}>
            <EastChakraComponent value={value} storageKey={storageKey} />
        </ChakraProvider>,
    );
}

describe("Configurator — collapsible control column", () => {
    test("toggle collapses the controls to the rail and back (aria round-trip)", async () => {
        initializeStore(new UIStore());
        const { getByRole } = mount(buildConfigurator());

        const control = getByRole("button", { name: "Collapse controls" });
        expect(control.getAttribute("aria-expanded")).toBe("true");

        await act(async () => { fireEvent.click(control); });
        expect(getByRole("button", { name: "Expand controls" }).getAttribute("aria-expanded")).toBe("false");

        await act(async () => { fireEvent.click(getByRole("button", { name: "Expand controls" })); });
        expect(getByRole("button", { name: "Collapse controls" }).getAttribute("aria-expanded")).toBe("true");
    });

    test("control rows are kept mounted (in the DOM) while collapsed", async () => {
        initializeStore(new UIStore());
        const { getByRole, getByText } = mount(buildConfigurator());
        // Same node survives the collapse (kept mounted, just hidden).
        const rowNode = getByText("ROWCTL");
        await act(async () => { fireEvent.click(getByRole("button", { name: "Collapse controls" })); });
        expect(getByText("ROWCTL")).toBe(rowNode);
    });

    test("the derived spec readout stays visible while collapsed", async () => {
        initializeStore(new UIStore());
        const { getByRole, getByText } = mount(buildConfigurator());
        await act(async () => { fireEvent.click(getByRole("button", { name: "Collapse controls" })); });
        // The spec row derives from the control row's value and lives in the
        // sidebar — collapsing the controls must not take the readout with it.
        expect(getByText("compact")).toBeTruthy();
        expect(getByText("PREVIEW")).toBeTruthy();
    });

    test("collapsed state persists per instance under the derived storage key", async () => {
        initializeStore(new UIStore());
        const first = mount(buildConfigurator());
        await act(async () => {
            fireEvent.click(first.getByRole("button", { name: "Collapse controls" }));
        });
        // The dispatcher derives the key (root key + component segment), so
        // assert the suffix contract rather than a hard-coded literal.
        expect(window.localStorage.length).toBe(1);
        const key = window.localStorage.key(0)!;
        expect(key.startsWith("cfg-test")).toBe(true);
        expect(key.endsWith(".controlsCollapsed")).toBe(true);
        expect(window.localStorage.getItem(key)).toBe("true");
        first.unmount();

        // A fresh mount under the same key rehydrates collapsed.
        initializeStore(new UIStore());
        const second = mount(buildConfigurator());
        expect(second.getByRole("button", { name: "Expand controls" }).getAttribute("aria-expanded")).toBe("false");
    });
});
