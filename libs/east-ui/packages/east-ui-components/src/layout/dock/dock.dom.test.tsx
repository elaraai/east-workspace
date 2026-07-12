/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 *
 * @vitest-environment jsdom
 *
 * Behaviour guard for `<Dock>` (issue #325):
 *   - the toggle collapses/expands via the chevron control (aria round-trip),
 *   - `defaultCollapsed` starts on the rail,
 *   - the body is kept mounted (in the DOM) while collapsed by default, so a
 *     child's state survives the collapse,
 *   - Esc does NOT collapse (inline content, not a modal — unlike Expandable),
 *   - a State-driven `collapsed` + `onCollapsedChange` round-trips through the
 *     store (the controlled path used by app-style ui() tasks).
 */

import { describe, test, expect, afterEach } from "vitest";
import { render, cleanup, act, fireEvent } from "@testing-library/react";
import { ChakraProvider } from "@chakra-ui/react";
import { East, BooleanType, NullType, type ValueTypeOf } from "@elaraai/east";
import { Dock, Text, State, Reactive, UIComponentType } from "@elaraai/east-ui/internal";
import { system } from "../../theme/index.js";
import { EastChakraComponent } from "../../component.js";
import { initializeStore } from "../../platform/state-runtime.js";
import { getRegisteredPlatformImplementations } from "../../platform/registry.js";
import { UIStore } from "../../platform/state-store.js";

afterEach(cleanup);

function compileUI(program: ReturnType<typeof East.function>): ValueTypeOf<typeof UIComponentType> {
    return East.compile(program, getRegisteredPlatformImplementations())() as ValueTypeOf<typeof UIComponentType>;
}

function buildUncontrolled(defaultCollapsed = false): ValueTypeOf<typeof UIComponentType> {
    return compileUI(East.function([], UIComponentType, (_$) =>
        Dock.Root([Text.Root("BODY")], { label: "Library", icon: "book", defaultCollapsed }),
    ));
}

const KEY = "dock.test.collapsed";

/** State-driven `collapsed` + write-back `onCollapsedChange` (controlled path). */
function buildControlled(): ValueTypeOf<typeof UIComponentType> {
    return compileUI(East.function([], UIComponentType, (_$) =>
        Reactive.Root(East.function([], UIComponentType, ($2) => {
            const collapsedBind = $2.let(State.bind([BooleanType], KEY, false));
            const collapsed = $2.let(collapsedBind.read(), BooleanType);
            const onCollapsedChange = $2.const(East.function([BooleanType], NullType, ($3, next) => {
                $3(collapsedBind.write(next));
            }));
            return Dock.Root([Text.Root("BODY")], { collapsed, onCollapsedChange, label: "Library" });
        })),
    ));
}

function mount(value: ValueTypeOf<typeof UIComponentType>) {
    return render(
        <ChakraProvider value={system}>
            <EastChakraComponent value={value} storageKey="dock-test" />
        </ChakraProvider>,
    );
}

describe("Dock — toggle, rail, keep-mounted, Esc", () => {
    test("chevron toggles collapsed state (aria round-trip)", async () => {
        initializeStore(new UIStore());
        const { getByRole } = mount(buildUncontrolled());

        const control = getByRole("button", { name: "Collapse Library" });
        expect(control.getAttribute("aria-expanded")).toBe("true");

        await act(async () => { fireEvent.click(control); });
        expect(getByRole("button", { name: "Expand Library" }).getAttribute("aria-expanded")).toBe("false");

        await act(async () => { fireEvent.click(getByRole("button", { name: "Expand Library" })); });
        expect(getByRole("button", { name: "Collapse Library" }).getAttribute("aria-expanded")).toBe("true");
    });

    test("defaultCollapsed starts on the rail", async () => {
        initializeStore(new UIStore());
        const { getByRole } = mount(buildUncontrolled(true));
        expect(getByRole("button", { name: "Expand Library" }).getAttribute("aria-expanded")).toBe("false");
    });

    test("body is kept mounted (in the DOM) while collapsed", async () => {
        initializeStore(new UIStore());
        const { getByRole, getByText } = mount(buildUncontrolled());
        // Same text node survives the collapse (kept mounted, just hidden).
        const bodyNode = getByText("BODY");
        await act(async () => { fireEvent.click(getByRole("button", { name: "Collapse Library" })); });
        expect(getByText("BODY")).toBe(bodyNode);
    });

    test("Esc does NOT collapse (inline content, not a modal)", async () => {
        initializeStore(new UIStore());
        const { getByRole } = mount(buildUncontrolled());
        expect(getByRole("button", { name: "Collapse Library" }).getAttribute("aria-expanded")).toBe("true");
        await act(async () => { fireEvent.keyDown(document, { key: "Escape" }); });
        expect(getByRole("button", { name: "Collapse Library" }).getAttribute("aria-expanded")).toBe("true");
    });

    test("controlled path: toggle writes State and the store drives collapse", async () => {
        initializeStore(new UIStore());
        const { getByRole } = mount(buildControlled());
        expect(getByRole("button", { name: "Collapse Library" }).getAttribute("aria-expanded")).toBe("true");

        await act(async () => { fireEvent.click(getByRole("button", { name: "Collapse Library" })); });
        expect(getByRole("button", { name: "Expand Library" }).getAttribute("aria-expanded")).toBe("false");
    });
});
