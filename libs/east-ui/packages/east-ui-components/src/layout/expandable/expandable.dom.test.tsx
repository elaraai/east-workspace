/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 *
 * @vitest-environment jsdom
 *
 * Behaviour guard for `<Expandable>` (issue #246):
 *   - the toggle expands/collapses via the floating control,
 *   - the takeover is a CSS swap on the SAME element — the content subtree
 *     keeps its DOM identity (no portal, no remount, no state loss),
 *   - Esc collapses, but NOT when an inner dismissable layer consumed the
 *     keypress (`event.defaultPrevented`),
 *   - a State-driven `expanded` + `onExpandedChange` round-trips through the
 *     store (the controlled path used by app-style ui() tasks).
 */

import { describe, test, expect, afterEach, vi } from "vitest";
import { render, cleanup, act, fireEvent } from "@testing-library/react";
import { ChakraProvider } from "@chakra-ui/react";
import { East, BooleanType, NullType, type ValueTypeOf } from "@elaraai/east";
import { Expandable, Text, State, Reactive, UIComponentType } from "@elaraai/east-ui/internal";
import { system } from "../../theme/index.js";
import { EastChakraComponent } from "../../component.js";
import { initializeStore } from "../../platform/state-runtime.js";
import { getRegisteredPlatformImplementations } from "../../platform/registry.js";
import { UIStore } from "../../platform/state-store.js";

afterEach(cleanup);

function buildUncontrolled(): ValueTypeOf<typeof UIComponentType> {
    // Content is a bare Text — the east-ui Box renderer reads
    // `window.matchMedia` (reduced-motion contract), which jsdom lacks.
    const program = East.function([], UIComponentType, (_$) =>
        Expandable.Root(Text.Root("CONTENT"), { label: "Chart" }),
    );
    return East.compile(program, getRegisteredPlatformImplementations())() as ValueTypeOf<typeof UIComponentType>;
}

const KEY = "expandable.test.expanded";

/** State-driven `expanded` + write-back `onExpandedChange` (controlled path). */
function buildControlled(): ValueTypeOf<typeof UIComponentType> {
    const program = East.function([], UIComponentType, (_$) =>
        Reactive.Root(East.function([], UIComponentType, ($2) => {
            const expandedBind = $2.let(State.bind([BooleanType], KEY, false));
            const expanded = $2.let(expandedBind.read(), BooleanType);
            const onExpandedChange = $2.const(East.function([BooleanType], NullType, ($3, next) => {
                $3(expandedBind.write(next));
            }));
            return Expandable.Root(Text.Root("CONTENT"), {
                expanded,
                onExpandedChange,
                label: "Chart",
            });
        })),
    );
    return East.compile(program, getRegisteredPlatformImplementations())() as ValueTypeOf<typeof UIComponentType>;
}

function mount(value: ValueTypeOf<typeof UIComponentType>) {
    return render(
        <ChakraProvider value={system}>
            <EastChakraComponent value={value} storageKey="expandable-test" />
        </ChakraProvider>,
    );
}

describe("Expandable — toggle, identity, Esc", () => {
    test("control toggles expanded state and content keeps its DOM identity", async () => {
        initializeStore(new UIStore());
        const { getByRole, getByText } = mount(buildUncontrolled());

        const control = getByRole("button", { name: "Expand Chart" });
        expect(control.getAttribute("aria-expanded")).toBe("false");
        const contentNode = getByText("CONTENT");

        await act(async () => { fireEvent.click(control); });
        expect(control.getAttribute("aria-expanded")).toBe("true");
        expect(control.getAttribute("aria-label")).toBe("Collapse Chart");
        // Same DOM node — the takeover did not remount the content subtree.
        expect(getByText("CONTENT")).toBe(contentNode);

        await act(async () => { fireEvent.click(control); });
        expect(control.getAttribute("aria-expanded")).toBe("false");
        expect(getByText("CONTENT")).toBe(contentNode);
    });

    test("Esc collapses the expanded region", async () => {
        initializeStore(new UIStore());
        const { getByRole } = mount(buildUncontrolled());
        const control = getByRole("button", { name: "Expand Chart" });

        await act(async () => { fireEvent.click(control); });
        expect(control.getAttribute("aria-expanded")).toBe("true");

        await act(async () => {
            fireEvent.keyDown(document, { key: "Escape" });
        });
        expect(control.getAttribute("aria-expanded")).toBe("false");
    });

    test("Esc consumed by an inner layer (defaultPrevented) does NOT collapse", async () => {
        initializeStore(new UIStore());
        const { getByRole } = mount(buildUncontrolled());
        const control = getByRole("button", { name: "Expand Chart" });

        await act(async () => { fireEvent.click(control); });
        expect(control.getAttribute("aria-expanded")).toBe("true");

        await act(async () => {
            const event = new KeyboardEvent("keydown", { key: "Escape", cancelable: true, bubbles: true });
            event.preventDefault();
            document.dispatchEvent(event);
        });
        expect(control.getAttribute("aria-expanded")).toBe("true");
    });

    test("expanding under a transformed ancestor warns about the containing-block trap", async () => {
        initializeStore(new UIStore());
        const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
        try {
            const { getByRole } = render(
                <ChakraProvider value={system}>
                    {/* Simulates a virtualizer row offset with transform (the
                      * showcase DocList bug) — fixed would fill this div. */}
                    <div style={{ transform: "translateY(120px)" }}>
                        <EastChakraComponent value={buildUncontrolled()} storageKey="expandable-trap" />
                    </div>
                </ChakraProvider>,
            );
            await act(async () => { fireEvent.click(getByRole("button", { name: "Expand Chart" })); });
            const trapWarnings = warn.mock.calls.filter(c => String(c[0]).includes("<Expandable>"));
            expect(trapWarnings.length).toBe(1);
            expect(String(trapWarnings[0]?.[0] ?? "")).toContain("transform");
        } finally {
            warn.mockRestore();
        }
    });

    test("expanding in a clean host does not warn", async () => {
        initializeStore(new UIStore());
        const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
        try {
            const { getByRole } = mount(buildUncontrolled());
            await act(async () => { fireEvent.click(getByRole("button", { name: "Expand Chart" })); });
            const trapWarnings = warn.mock.calls.filter(c => String(c[0]).includes("<Expandable>"));
            expect(trapWarnings.length).toBe(0);
        } finally {
            warn.mockRestore();
        }
    });

    test("controlled path: toggle writes State and the store drives expansion", async () => {
        initializeStore(new UIStore());
        const { getByRole } = mount(buildControlled());
        const control = getByRole("button", { name: "Expand Chart" });
        expect(control.getAttribute("aria-expanded")).toBe("false");

        await act(async () => { fireEvent.click(control); });
        expect(control.getAttribute("aria-expanded")).toBe("true");

        await act(async () => { fireEvent.click(control); });
        expect(control.getAttribute("aria-expanded")).toBe("false");
    });
});
