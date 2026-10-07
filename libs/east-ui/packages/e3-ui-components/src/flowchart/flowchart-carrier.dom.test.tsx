/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 *
 * @vitest-environment jsdom
 *
 * The Flowchart through its carrier (#1243). `<Flowchart>` returns the
 * flowchart as the `Flowchart` extension — its root's bytes beside its kind —
 * and the dispatcher hands it to the renderer registered against that kind,
 * decoding the root's functions against the registered platform: a hover
 * card's builder, which returns UI, and a select callback, which writes a
 * bound State. Every flowchart here is built by `<Flowchart>`, compiled, and
 * rendered through `EastChakraComponent`, as an app renders it.
 */

import { describe, test, expect, afterEach } from "vitest";
import { render, cleanup, waitFor, fireEvent, act } from "@testing-library/react";
import { ChakraProvider } from "@chakra-ui/react";
import { East, StringType, encodeBeast2For, variant, type ValueTypeOf } from "@elaraai/east";
import { Reactive, State, Text, UIComponentType } from "@elaraai/east-ui/internal";
import { EastChakraComponent, UIStore, getRegisteredPlatformImplementations, system } from "@elaraai/east-ui-components";
import { getStore, initializeStore } from "@elaraai/east-ui-components/internal";
import { Flowchart } from "@elaraai/e3-ui/internal";
// The flowchart is an extension: its renderer registers as it loads.
import "./index.js";

afterEach(() => {
    cleanup();
    localStorage.clear();
});

class ResizeObserverStub { observe() {} unobserve() {} disconnect() {} }
(globalThis as { ResizeObserver?: unknown }).ResizeObserver ??= ResizeObserverStub;

type UIValue = ValueTypeOf<typeof UIComponentType>;

const encodeString = encodeBeast2For(StringType);

/** Render a compiled UI value through the dispatcher. */
function mount(value: UIValue, storageKey: string) {
    return render(
        <ChakraProvider value={system}>
            <EastChakraComponent value={value} storageKey={storageKey} />
        </ChakraProvider>,
    );
}

/** Every state card drawn, by its key. */
const stateKeys = (container: HTMLElement): (string | null)[] =>
    [...container.querySelectorAll("[data-flowchart-node]")].map((el) => el.getAttribute("data-flowchart-node"));

/** Three states over two lanes and two links, one of them observed — module
 *  scope, so the East bodies call no host helper. */
const STATES = [
    { code: "ARV", name: "Arrived", phase: "intake" },
    { code: "SCN", name: "Scanned", phase: "intake" },
    { code: "SRT", name: "Sorting", phase: "sort" },
];
const LINKS = [
    { src: "ARV", dst: "SCN", kind: variant("planned", null) },
    { src: "SCN", dst: "SRT", kind: variant("observed", null) },
];
const LANES = [{ key: "intake", label: "Intake" }, { key: "sort", label: "Sort" }];

/** A flowchart of the three states. */
const VIEW = East.function([], UIComponentType, (_$) => Flowchart({
    states: STATES,
    state: (s) => ({ key: s.code, label: s.name, lane: s.phase }),
    links: LINKS,
    link: (l) => ({ from: l.src, to: l.dst, kind: l.kind }),
    lanes: LANES,
}));

describe("<Flowchart> through its carrier (#1243)", () => {
    test("the flowchart is the Flowchart extension — its root carried as bytes beside its kind — and the dispatcher draws it", async () => {
        initializeStore(new UIStore());
        const value = East.compile(VIEW, getRegisteredPlatformImplementations())();
        if (value.type !== "Extension") throw new Error(`expected the Flowchart extension, got the ${value.type} arm`);
        expect(value.value.kind).toBe("Flowchart");
        const { container } = mount(value, "flowchart-carrier-view");
        await waitFor(() => expect(stateKeys(container)).toEqual(["ARV", "SCN", "SRT"]));
        expect(container.querySelector('[data-flowchart-node="SCN"]')!.textContent).toContain("Scanned");
        expect(container.querySelector("[data-flowchart-footer]")!.textContent).toContain("1 planned · 1 observed");
    });
});

// ── Functions across the carrier ────────────────────────────────────────────

const LABEL_KEY = "flowchart.carrier.label";
const SELECTED_KEY = "flowchart.carrier.selected";

/** A Reactive flowchart: its state hover card builds UI from the label READ
 *  from State (a value, not the handle), and a state's click writes the
 *  selected key to State. A label write rebuilds a flowchart of the same data
 *  whose hover builder captured another label. */
const reactiveFlowchart = East.compile(East.function([], UIComponentType, (_$) =>
    Reactive.Root(East.function([], UIComponentType, ($) => {
        const labelBind = $.let(State.bind([StringType], LABEL_KEY, "ALPHA"));
        const label = $.const(labelBind.read());
        const selected = $.let(State.bind([StringType], SELECTED_KEY, ""));
        const stateHover = $.const(East.function([StringType], UIComponentType, (_$2, key) => Text.Root(East.str`${label} · ${key}`)));
        return Flowchart({
            states: STATES,
            state: (s) => ({ key: s.code, label: s.name, lane: s.phase }),
            links: LINKS,
            link: (l) => ({ from: l.src, to: l.dst, kind: l.kind }),
            lanes: LANES,
            stateHover,
            onSelectState: selected.write,
        });
    })),
), getRegisteredPlatformImplementations());

/** The selected key, as the State holds it. */
const readSelected = East.compile(East.function([], StringType, ($) => {
    const selected = $.const(State.bind([StringType], SELECTED_KEY, ""));
    return selected.read();
}), getRegisteredPlatformImplementations());

describe("functions across the carrier (#1243)", () => {
    test("a state's click calls the decoded onSelectState, which writes the bound State", async () => {
        initializeStore(new UIStore());
        const { container } = mount(reactiveFlowchart(), "flowchart-carrier-select");
        await waitFor(() => expect(stateKeys(container)).toEqual(["ARV", "SCN", "SRT"]));
        fireEvent.click(container.querySelector('[data-flowchart-node="SCN"]')!);
        await waitFor(() => expect(readSelected()).toBe("SCN"));
    });

    test("the decoded stateHover builds the card's UI, and a closure-only change re-renders the open card", async () => {
        initializeStore(new UIStore());
        const { container } = mount(reactiveFlowchart(), "flowchart-carrier-hover");
        await waitFor(() => expect(stateKeys(container)).toEqual(["ARV", "SCN", "SRT"]));
        fireEvent.pointerEnter(container.querySelector('[data-flowchart-node="ARV"]')!);
        await waitFor(() => expect(container.querySelector("[data-flowchart-hovercard]")?.textContent).toBe("ALPHA · ARV"));
        // Only the builder's capture moves: the data is the same, the
        // flowchart's memo (`equivalentFor`) lets it through, and the open card
        // builds again with the new label.
        act(() => { getStore().write(LABEL_KEY, encodeString("BETA")); });
        await waitFor(() => expect(container.querySelector("[data-flowchart-hovercard]")?.textContent).toBe("BETA · ARV"));
    });
});
