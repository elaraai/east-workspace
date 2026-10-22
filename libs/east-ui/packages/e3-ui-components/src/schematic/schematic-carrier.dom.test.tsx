/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 *
 * @vitest-environment jsdom
 *
 * The Schematic through its carrier (#1384). `<Schematic>` returns the
 * schematic as the `Schematic` extension — its root's bytes beside its kind —
 * and the dispatcher hands it to the renderer registered against that kind,
 * decoding the root's functions against the registered platform: a hover
 * card's builder, which returns UI, and a select callback, which writes a
 * bound State. Every schematic here is built by `<Schematic>`, compiled, and
 * rendered through `EastChakraComponent`, as an app renders it.
 */

import { describe, test, expect, afterEach, beforeEach } from "vitest";
import { render, cleanup, waitFor, fireEvent, act } from "@testing-library/react";
import { ChakraProvider } from "@chakra-ui/react";
import { East, StringType, encodeBeast2For, type ValueTypeOf } from "@elaraai/east";
import { Reactive, State, Text, UIComponentType } from "@elaraai/east-ui/internal";
import { EastChakraComponent, UIStore, getRegisteredPlatformImplementations, system } from "@elaraai/east-ui-components";
import { getStore, initializeStore } from "@elaraai/east-ui-components/internal";
import { Schematic } from "@elaraai/e3-ui/internal";
// The schematic is an extension: its renderer registers as it loads.
import "./index.js";

class ResizeObserverStub { observe() {} unobserve() {} disconnect() {} }
(globalThis as { ResizeObserver?: unknown }).ResizeObserver ??= ResizeObserverStub;
// jsdom has neither `CSS.escape` nor `scrollIntoView`: the navigator scrolls
// the selected item into view through both.
(globalThis as unknown as { CSS?: { escape?: (s: string) => string } }).CSS ??= {};
(globalThis as unknown as { CSS: { escape?: (s: string) => string } }).CSS.escape ??= (s) => s.replace(/[^a-zA-Z0-9_-]/g, (c) => `\\${c}`);
Element.prototype.scrollIntoView ??= function scrollIntoView() {};

// jsdom lays nothing out: the canvas is given the box a page would give it,
// 560 × 240 — the extent's 28 × 12 world units at 20 px each, the camera at
// rest — so a pointer's place on it is a place in the world.
beforeEach(() => {
    for (const [name, px] of [["clientWidth", 560], ["clientHeight", 240]] as const) {
        Object.defineProperty(HTMLElement.prototype, name, {
            configurable: true,
            get(this: HTMLElement) { return this.hasAttribute("data-schematic-canvas") ? px : 0; },
        });
    }
});

afterEach(() => {
    cleanup();
    localStorage.clear();
    delete (HTMLElement.prototype as { clientWidth?: number }).clientWidth;
    delete (HTMLElement.prototype as { clientHeight?: number }).clientHeight;
});

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

/** Every item the navigator lists, by its key. */
const navKeys = (container: HTMLElement): (string | null)[] =>
    [...container.querySelectorAll("[data-nav-key]")].map((el) => el.getAttribute("data-nav-key"));

/** Three racks in a cage and a switch on the floor beside it — module scope,
 *  so the East bodies call no host helper. */
const RACKS = [
    { id: "A01", x: 2.4, y: 2.9 },
    { id: "A02", x: 6.0, y: 2.9 },
    { id: "A03", x: 9.6, y: 2.9 },
    { id: "SW-1", x: 24.2, y: 2.9 },
];
const CAGES = [{ id: "cage-a", name: "Cage A", x: 0.6, y: 0.6, w: 19.6, h: 4.6 }];

/** A schematic of the four. */
const VIEW = East.function([], UIComponentType, (_$) => Schematic({
    extent: { width: 28, height: 12 },
    items: RACKS,
    item: (r) => ({ key: r.id, x: r.x, y: r.y, label: r.id }),
    zones: CAGES,
    zone: (z) => ({ key: z.id, label: z.name, x: z.x, y: z.y, width: z.w, height: z.h }),
}));

describe("<Schematic> through its carrier (#1384)", () => {
    test("the schematic is the Schematic extension — its root carried as bytes beside its kind — and the dispatcher draws it", async () => {
        initializeStore(new UIStore());
        const value = East.compile(VIEW, getRegisteredPlatformImplementations())();
        if (value.type !== "Extension") throw new Error(`expected the Schematic extension, got the ${value.type} arm`);
        expect(value.value.kind).toBe("Schematic");
        const { container, getByText } = mount(value, "schematic-carrier-view");
        await waitFor(() => expect(container.querySelector("[data-schematic-canvas]")).not.toBeNull());
        // The navigator lists the cage and, on the floor, the switch outside it;
        // the cage opened, its racks.
        expect(navKeys(container)).toEqual(["SW-1"]);
        fireEvent.click(getByText("Cage A"));
        await waitFor(() => expect(navKeys(container)).toEqual(["A01", "A02", "A03", "SW-1"]));
    });
});

// ── Functions across the carrier ────────────────────────────────────────────

const LABEL_KEY = "schematic.carrier.label";
const SELECTED_KEY = "schematic.carrier.selected";

/** A Reactive schematic: its zone hover card builds UI from the label READ
 *  from State (a value, not the handle), and an item's selection writes its
 *  key to State. A label write rebuilds a schematic of the same data whose
 *  hover builder captured another label. */
const reactiveSchematic = East.compile(East.function([], UIComponentType, (_$) =>
    Reactive.Root(East.function([], UIComponentType, ($) => {
        const labelBind = $.let(State.bind([StringType], LABEL_KEY, "ALPHA"));
        const label = $.const(labelBind.read());
        const selected = $.let(State.bind([StringType], SELECTED_KEY, ""));
        const zoneHover = $.const(East.function([StringType], UIComponentType, (_$2, key) => Text.Root(East.str`${label} · ${key}`)));
        return Schematic({
            extent: { width: 28, height: 12 },
            items: RACKS,
            item: (r) => ({ key: r.id, x: r.x, y: r.y, label: r.id }),
            zones: CAGES,
            zone: (z) => ({ key: z.id, label: z.name, x: z.x, y: z.y, width: z.w, height: z.h }),
            zoneHover,
            onSelect: selected.write,
        });
    })),
), getRegisteredPlatformImplementations());

/** The selected key, as the State holds it. */
const readSelected = East.compile(East.function([], StringType, ($) => {
    const selected = $.const(State.bind([StringType], SELECTED_KEY, ""));
    return selected.read();
}), getRegisteredPlatformImplementations());

describe("functions across the carrier (#1384)", () => {
    test("an item's selection from the navigator calls the decoded onSelect, which writes the bound State", async () => {
        initializeStore(new UIStore());
        const { container } = mount(reactiveSchematic(), "schematic-carrier-select");
        await waitFor(() => expect(navKeys(container)).toEqual(["SW-1"]));
        fireEvent.click(container.querySelector('[data-nav-key="SW-1"]')!);
        await waitFor(() => expect(readSelected()).toBe("SW-1"));
        // The schematic draws the selection — the navigator marks the item, and
        // scrolls to it — and stands.
        await waitFor(() => expect(container.querySelector('[data-nav-key="SW-1"]')?.hasAttribute("data-selected")).toBe(true));
        expect(container.querySelector("[data-schematic-canvas]")).not.toBeNull();
    });

    test("the decoded zoneHover builds the card's UI, and a closure-only change re-renders the open card", async () => {
        initializeStore(new UIStore());
        const { container, findByText } = mount(reactiveSchematic(), "schematic-carrier-hover");
        const canvas = await waitFor(() => {
            const el = container.querySelector<HTMLElement>("[data-schematic-canvas]");
            expect(el).not.toBeNull();
            return el!;
        });
        // (100, 60) on the canvas is (5, 3) in the world: inside Cage A.
        fireEvent.pointerMove(canvas, { clientX: 100, clientY: 60 });
        expect(await findByText("ALPHA · cage-a")).toBeDefined();
        // Only the builder's capture moves: the data is the same, the
        // schematic's memo (`equivalentFor`) lets it through, and the open card
        // builds again with the new label.
        act(() => { getStore().write(LABEL_KEY, encodeString("BETA")); });
        expect(await findByText("BETA · cage-a")).toBeDefined();
    });
});
