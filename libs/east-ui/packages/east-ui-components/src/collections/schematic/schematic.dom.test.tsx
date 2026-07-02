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
import { variant, some, none } from "@elaraai/east";
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

function item(key: string, x: number, y: number): SchematicItemValue {
    return {
        key, x, y, label: key,
        sublabel: none, icon: none, status: none, meter: none, metric: none,
        width: none, footprint: none, tone: none, color: none, layer: none,
    } as unknown as SchematicItemValue;
}

function mkValue(): SchematicValue {
    const link: SchematicLinkValue = {
        key: "l1", from: "A", to: "B",
        label: some("feed"), metric: none,
        style: variant("solid", { tone: none, weight: none }),
        route: variant("orthogonal", { corner: none }),
        via: [], layer: none,
    } as unknown as SchematicLinkValue;
    const net: SchematicNetValue = {
        key: "n1", sources: ["A"], destinations: ["B", "C"],
        label: none, metric: none,
        style: variant("solid", { tone: none, weight: none }),
        route: variant("orthogonal", { corner: none }),
        via: [], layer: none,
    } as unknown as SchematicNetValue;
    const zone: SchematicZoneValue = {
        key: "z1", label: "Hall", x: 0, y: 0, width: 10, height: 6,
        pattern: variant("outline", null), geometry: none, tone: none, color: none, layer: none,
    } as unknown as SchematicZoneValue;
    return {
        extent: { width: 20, height: 10 },
        items: [item("A", 2, 2), item("B", 8, 2), item("C", 8, 6)],
        zones: [zone],
        links: [link],
        nets: [net],
        scaleUnit: some("m"),
        grid: none, navigator: none, minimap: none, slice: none,
        sliceEffect: none, layers: none, height: none,
        onSelect: none, selectionMode: some(variant("multiple", null)),
        onSelectionChange: none, sliceSelectField: none, selectZoomFocus: none,
        onViewportChange: none, onItemOpen: none,
        onSelectZone: none, onZoneSelectionChange: none,
        linkMode: none, onCreateLink: none, onSelectLink: none,
        onEditLink: none, onDeleteLink: none,
        readOnly: none, readOnlyLinks: none, readOnlyItems: none,
        onMoveItem: none,
        itemHover: none, zoneHover: none, linkHover: none,
    } as unknown as SchematicValue;
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
        const next = { ...mkValue(), items: [item("A", 1, 1)], links: [], nets: [] } as SchematicValue;
        first.rerender(
            <ChakraProvider value={system}>
                <EastChakraSchematic value={next} storageKey="dom-smoke-2" />
            </ChakraProvider>,
        );
        expect(first.container.querySelector("[data-schematic-canvas]")).not.toBeNull();
    });
});
