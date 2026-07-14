/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Licensed under AGPL-3.0. See LICENSE file for details.
 *
 * @vitest-environment jsdom
 *
 * Guard for issue #333 at the east-ui-components layer.
 *
 * `<Match>` exists because swapping component A → B at one slot via a plain
 * `variant.match` reconciles the same-shape nodes and keeps A mounted — when
 * both bodies are `<Reactive>`, they differ only by a render function, and
 * `equalFor` treats every function as equal, so the generic memo'd swap bails
 * (the #142 failure Pages solved for the nav case). These tests mount a
 * `Match`-in-`Reactive` value with **both cases `<Reactive>`** — LIVE and
 * after a full beast2 encode → decode — flip the `on` variant through the
 * State store, and assert the case swaps; plus the tag-keying contract:
 * same-tag payload churn re-renders in place (the DOM node is reused, no
 * remount), while a tag change swaps the subtree.
 */

import { describe, test, expect, afterEach } from "vitest";
import { render, cleanup, act } from "@testing-library/react";
import { ChakraProvider } from "@chakra-ui/react";
import {
    East, NullType, StringType, VariantType, variant, encodeBeast2For, decodeBeast2For,
    type ValueTypeOf,
} from "@elaraai/east";
import { Match, Reactive, State, Text, UIComponentType } from "@elaraai/east-ui/internal";
import { system } from "../theme/index.js";
import { EastChakraComponent } from "../component.js";
import { initializeStore, getStore } from "../platform/state-runtime.js";
import { getRegisteredPlatformImplementations } from "../platform/registry.js";
import { UIStore } from "../platform/state-store.js";

afterEach(cleanup);

const ModeType = VariantType({ a: NullType, b: StringType });
const encodeMode = encodeBeast2For(ModeType);

/**
 * Build the live `Match`-in-`Reactive` UI value. The mode is `State`-bound in
 * the enclosing `Reactive`; `on` is the *reading expression* (`bind.read()`),
 * so the Match closures re-read the store at call time. Both case bodies are
 * their own `<Reactive>` (static text — a Reactive body must not capture the
 * arm payload) — the construction a plain `variant.match` swap cannot switch
 * (function-blind memo).
 */
function buildMatchValue(key: string): ValueTypeOf<typeof UIComponentType> {
    const program = East.function([], UIComponentType, (_$) =>
        Reactive.Root(East.function([], UIComponentType, ($2) => {
            const modeBind = $2.let(State.bind([ModeType], key, variant("a", null)));
            return Match.Root({
                on: modeBind.read(),
                cases: {
                    a: () => Reactive.Root(East.function([], UIComponentType, (_$2) => Text.Root("CASE_A"))),
                    b: () => Reactive.Root(East.function([], UIComponentType, (_$2) => Text.Root("CASE_B"))),
                },
            });
        })),
    );
    return East.compile(program, getRegisteredPlatformImplementations())() as ValueTypeOf<typeof UIComponentType>;
}

/**
 * Payload-flow fixture: the `b` body renders the arm payload directly (no
 * nested Reactive), so same-tag writes change only the payload text.
 */
function buildMatchPayloadValue(key: string): ValueTypeOf<typeof UIComponentType> {
    const program = East.function([], UIComponentType, (_$) =>
        Reactive.Root(East.function([], UIComponentType, ($2) => {
            const modeBind = $2.let(State.bind([ModeType], key, variant("a", null)));
            return Match.Root({
                on: modeBind.read(),
                cases: {
                    a: () => Text.Root("CASE_A"),
                    b: (_$3, payload) => Text.Root(East.str`CASE_B_${payload}`),
                },
            });
        })),
    );
    return East.compile(program, getRegisteredPlatformImplementations())() as ValueTypeOf<typeof UIComponentType>;
}

/** Flip the bound mode by writing the store key directly (as a callback would). */
function writeMode(key: string, value: ValueTypeOf<typeof ModeType>): void {
    getStore().write(key, encodeMode(value));
}

function mount(value: ValueTypeOf<typeof UIComponentType>) {
    return render(
        <ChakraProvider value={system}>
            <EastChakraComponent value={value} storageKey="issue333" />
        </ChakraProvider>,
    );
}

describe("issue #333 — Match swaps stateful cases on tag change", () => {
    test("LIVE value swaps the active case when both bodies are <Reactive>", () => {
        initializeStore(new UIStore());
        const KEY = "issue333.mode.live";
        const { container } = mount(buildMatchValue(KEY));
        expect(container.textContent).toContain("CASE_A");
        act(() => { writeMode(KEY, variant("b", "x")); });
        expect(container.textContent).toContain("CASE_B");
        expect(container.textContent).not.toContain("CASE_A");
        act(() => { writeMode(KEY, variant("a", null)); });
        expect(container.textContent).toContain("CASE_A");
        expect(container.textContent).not.toContain("CASE_B");
    });

    test("DECODED value (e3 ui() task path) swaps the active case", () => {
        initializeStore(new UIStore());
        const KEY = "issue333.mode.decoded";
        const bytes = encodeBeast2For(UIComponentType)(buildMatchValue(KEY));
        const decoded = decodeBeast2For(UIComponentType, { platform: getRegisteredPlatformImplementations() })(bytes) as ValueTypeOf<typeof UIComponentType>;
        const { container } = mount(decoded);
        expect(container.textContent).toContain("CASE_A");
        act(() => { writeMode(KEY, variant("b", "x")); });
        expect(container.textContent).toContain("CASE_B");
        expect(container.textContent).not.toContain("CASE_A");
    });

    test("same-tag payload churn re-renders in place — no remount", () => {
        initializeStore(new UIStore());
        const KEY = "issue333.mode.payload";
        const { container, getByText } = mount(buildMatchPayloadValue(KEY));
        act(() => { writeMode(KEY, variant("b", "x")); });
        const before = getByText("CASE_B_x");
        act(() => { writeMode(KEY, variant("b", "y")); });
        const after = getByText("CASE_B_y");
        // Same tag ⇒ the mounted case updates in place: React reuses the DOM
        // node, so nested mounted state would survive the payload change.
        expect(after.isSameNode(before)).toBe(true);
        expect(container.textContent).not.toContain("CASE_B_x");
    });

    test("tag change swaps the subtree — a fresh mount, not an in-place update", () => {
        initializeStore(new UIStore());
        const KEY = "issue333.mode.remount";
        const { getByText } = mount(buildMatchValue(KEY));
        const before = getByText("CASE_A");
        act(() => { writeMode(KEY, variant("b", "x")); });
        const afterB = getByText("CASE_B");
        expect(afterB.isSameNode(before)).toBe(false);
        // Return to the first case: a fresh mount again (keyed remount), not
        // the original node resurfacing.
        act(() => { writeMode(KEY, variant("a", null)); });
        const afterA = getByText("CASE_A");
        expect(afterA.isSameNode(before)).toBe(false);
    });
});
