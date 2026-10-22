/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Licensed under AGPL-3.0. See LICENSE file for details.
 *
 * @vitest-environment jsdom
 *
 * Mount smoke test. The Schematic renderer is a single large component whose
 * hooks/memos all execute on first render — a declaration-order slip (a memo
 * reading state declared later, #179's TDZ) crashes EVERY mount yet is invisible
 * to the vite build (no typecheck) and to the pure module tests (nothing mounts).
 * jsdom has no layout and no 2D canvas, so the size-gated paint path stays off —
 * exactly enough to prove the hook graph itself is sound.
 */

import { describe, test, expect, afterEach, vi } from "vitest";
import { render, cleanup } from "@testing-library/react";
import { ChakraProvider } from "@chakra-ui/react";
import { defaultValue, variant, some, none } from "@elaraai/east";
import { Schematic } from "@elaraai/east-ui/internal";
import { system } from "../../theme/index.js";
import { EastChakraSchematic, type SchematicValue, type SchematicItemValue, type SchematicLinkValue, type SchematicNetValue, type SchematicZoneValue } from "./index.js";

afterEach(cleanup);

// jsdom lacks ResizeObserver (the canvas size probe); a no-op keeps `size` null,
// which is the untested-layout path the component already guards everywhere.
if (typeof globalThis.ResizeObserver === "undefined") {
    vi.stubGlobal("ResizeObserver", class {
        observe(): void { /* no layout in jsdom */ }
        unobserve(): void { /* no layout in jsdom */ }
        disconnect(): void { /* no layout in jsdom */ }
    });
}

/** An item at (x, y): the Item type's default value, keyed and placed. */
function item(key: string, x: number, y: number): SchematicItemValue {
    return { ...defaultValue<typeof Schematic.Types.Item>(Schematic.Types.Item), key, label: key, x, y };
}

/** Three items in a cage, an uplink between two of them and a bus from one to the other two. */
function mkValue(): SchematicValue {
    const link: SchematicLinkValue = {
        ...defaultValue<typeof Schematic.Types.Link>(Schematic.Types.Link),
        key: "l1", from: "A", to: "B", label: some("uplink"),
        style: variant("solid", { tone: none, weight: none }),
        route: variant("orthogonal", { corner: none }),
    };
    const net: SchematicNetValue = {
        ...defaultValue<typeof Schematic.Types.Net>(Schematic.Types.Net),
        key: "n1", sources: ["A"], destinations: ["B", "C"],
        style: variant("solid", { tone: none, weight: none }),
        route: variant("orthogonal", { corner: none }),
    };
    const zone: SchematicZoneValue = {
        ...defaultValue<typeof Schematic.Types.Zone>(Schematic.Types.Zone),
        key: "z1", label: "Cage A", x: 0, y: 0, width: 10, height: 6,
        pattern: variant("outline", { tone: none }),
    };
    return {
        ...defaultValue<typeof Schematic.Types.Schematic>(Schematic.Types.Schematic),
        extent: { width: 20, height: 10 },
        items: [item("A", 2, 2), item("B", 8, 2), item("C", 8, 6)],
        zones: [zone],
        links: [link],
        nets: [net],
        scaleUnit: some("m"),
        selectionMode: some(variant("multiple", null)),
    };
}

describe("EastChakraSchematic (jsdom mount)", () => {
    test("mounts with items + zones + links + nets and renders the canvas host", () => {
        const { container } = render(
            <ChakraProvider value={system}>
                <EastChakraSchematic value={mkValue()} storageKey="dom-smoke" />
            </ChakraProvider>,
        );
        expect(container.querySelector("[data-schematic-canvas]")).not.toBeNull();
    });

    test("remounts cleanly with a different value (prop-replace path)", () => {
        const first = render(
            <ChakraProvider value={system}>
                <EastChakraSchematic value={mkValue()} storageKey="dom-smoke-2" />
            </ChakraProvider>,
        );
        const next: SchematicValue = { ...mkValue(), items: [item("A", 1, 1)], links: [], nets: [] };
        first.rerender(
            <ChakraProvider value={system}>
                <EastChakraSchematic value={next} storageKey="dom-smoke-2" />
            </ChakraProvider>,
        );
        expect(first.container.querySelector("[data-schematic-canvas]")).not.toBeNull();
    });
});

/** Three items, B outside the slice, under a slice effect of the given emphasis: engaged from the first render. */
function emphasised(emphasis: "pulse" | "halo"): SchematicValue {
    const at = (key: string, x: number, y: number, excluded: boolean): SchematicItemValue =>
        ({ ...defaultValue<typeof Schematic.Types.Item>(Schematic.Types.Item), key, label: key, x, y, excluded: some(excluded) });
    return {
        ...defaultValue<typeof Schematic.Types.Schematic>(Schematic.Types.Schematic),
        extent: { width: 20, height: 10 },
        items: [at("A", 2, 2, false), at("B", 8, 2, true), at("C", 8, 6, false)],
        sliceEffect: some({ ...defaultValue<typeof Schematic.Types.SliceEffect>(Schematic.Types.SliceEffect), emphasis: some(variant(emphasis, null)) }),
    };
}

/** The card layer: the element the camera's variables are written on. */
const cardLayer = (container: HTMLElement) =>
    [...container.querySelectorAll<HTMLElement>("[data-schematic-canvas] *")].find(el => el.style.getPropertyValue("--cam-ppu") !== "");

describe("EastChakraSchematic — the pulse emphasis", () => {
    test("its frames breathe the card layer, though they start before the canvas is measured and the layer mounts; stopped, the layer they wrote rests at 0", async () => {
        const r = render(<ChakraProvider value={system}><EastChakraSchematic value={emphasised("pulse")} storageKey="dom-pulse" /></ChakraProvider>);
        const layer = await vi.waitFor(() => {
            const el = cardLayer(r.container);
            expect(["", "0"]).not.toContain(el?.style.getPropertyValue("--pulse") ?? "");
            return el!;
        });
        // The halo is still, so the pulse stops: no frame runs again, and the layer it breathed is at rest.
        r.rerender(<ChakraProvider value={system}><EastChakraSchematic value={emphasised("halo")} storageKey="dom-pulse" /></ChakraProvider>);
        expect(cardLayer(r.container)).toBe(layer);
        expect(layer.style.getPropertyValue("--pulse")).toBe("0");
        await new Promise<void>(resolve => { requestAnimationFrame(() => { requestAnimationFrame(() => { resolve(); }); }); });
        expect(layer.style.getPropertyValue("--pulse")).toBe("0");
    });
});
