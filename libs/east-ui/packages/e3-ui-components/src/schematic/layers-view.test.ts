/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 *
 * @vitest-environment jsdom
 *
 * The viewer's layer choices (#1389, `layers-view.ts`, SC27): Show or Hide
 * flips a layer as it shows now and ends an isolation; Isolate shows one
 * layer alone, an entity on no layer still showing; Lock flips whether a
 * layer's entities select; Show all shows every layer, its author's hidden
 * ones among them, keeping the locks; and the choices are an East value under
 * the Schematic's layers key, which every Schematic of that key follows.
 * Fixtures are real East values.
 */

import { beforeEach, describe, expect, test } from "vitest";
import { act, renderHook } from "@testing-library/react";
import { decodeBeast2For, defaultValue, encodeBeast2For, equalFor, none, some, type ValueTypeOf } from "@elaraai/east";
import { Schematic } from "@elaraai/e3-ui/internal";
import { StateRuntime, UIStore } from "@elaraai/east-ui-components";
import { drawnItem, entityId } from "./canvas/drawn.js";
import { layerState } from "./canvas/layers.js";
import {
    NO_LAYER_VIEW, SchematicLayerViewType, anyHidden, layerLocked, layerShown, layersInForce, showAll, toggleIsolated, toggleLocked, toggleShown,
    useSchematicLayerView,
} from "./layers-view.js";

type Layer = ValueTypeOf<typeof Schematic.Types.Layer>;

const viewEqual = equalFor(SchematicLayerViewType);

/** A layer: shown and unlocked unless its author says otherwise. */
const layer = (key: string, over: Partial<Layer> = {}): Layer => ({
    key, label: key, visible: none, locked: none, opacity: none, tone: none, color: none, ...over,
});

/** Power and cooling shown; structure hidden and locked by its author. */
const LAYERS: readonly Layer[] = [layer("power"), layer("cooling"), layer("structure", { visible: some(false), locked: some(true) })];

/** Whether each layer shows, in order. */
const shown = (view: typeof NO_LAYER_VIEW) => LAYERS.map((l) => layerShown(l, view));

describe("the viewer's layer choices", () => {
    test("with no choice, every layer is as its author has it, and the layers are the drawing's as they are", () => {
        expect(shown(NO_LAYER_VIEW)).toEqual([true, true, false]);
        expect(LAYERS.map((l) => layerLocked(l, NO_LAYER_VIEW))).toEqual([false, false, true]);
        expect(layersInForce(LAYERS, NO_LAYER_VIEW)).toBe(LAYERS);
        expect(anyHidden(LAYERS, NO_LAYER_VIEW)).toBe(true);
    });

    test("Show or Hide flips a layer as it shows now: a shown one hides, one its author hides shows", () => {
        const hidden = toggleShown(LAYERS, NO_LAYER_VIEW, "power");
        expect(shown(hidden)).toEqual([false, true, false]);
        const back = toggleShown(LAYERS, toggleShown(LAYERS, hidden, "power"), "structure");
        expect(shown(back)).toEqual([true, true, true]);
        expect(anyHidden(LAYERS, back)).toBe(false);
    });

    test("Isolate shows one layer alone, and Isolate again ends it; Show or Hide on the isolated layer hides it and ends the isolation", () => {
        const isolated = toggleIsolated(NO_LAYER_VIEW, "cooling");
        expect(shown(isolated)).toEqual([false, true, false]);
        expect(shown(toggleIsolated(isolated, "cooling"))).toEqual([true, true, false]);
        // Hiding the isolated layer: the isolation ends, the others as their own choices have them.
        const after = toggleShown(LAYERS, isolated, "cooling");
        expect(after.isolated).toEqual(none);
        expect(shown(after)).toEqual([true, false, false]);
    });

    test("Lock flips whether a layer's entities select, over its author's default", () => {
        const locked = toggleLocked(LAYERS, NO_LAYER_VIEW, "power");
        expect(LAYERS.map((l) => layerLocked(l, locked))).toEqual([true, false, true]);
        expect(LAYERS.map((l) => layerLocked(l, toggleLocked(LAYERS, locked, "structure")))).toEqual([true, false, false]);
    });

    test("Show all shows every layer, its author's hidden ones among them, ends the isolation and keeps the locks", () => {
        const view = toggleLocked(LAYERS, toggleIsolated(toggleShown(LAYERS, NO_LAYER_VIEW, "power"), "cooling"), "power");
        const all = showAll(LAYERS, view);
        expect(shown(all)).toEqual([true, true, true]);
        expect(all.isolated).toEqual(none);
        expect(LAYERS.map((l) => layerLocked(l, all))).toEqual([true, false, true]);
        expect(anyHidden(LAYERS, all)).toBe(false);
    });

    test("the drawing obeys them: an isolated layer's neighbours hide, a locked one's entities never select, and an entity on no layer still shows", () => {
        const item = (key: string, on: string | undefined) => drawnItem({ kind: "racks", key }, {
            ...defaultValue<typeof Schematic.Types.Item>(Schematic.Types.Item), position: some({ x: 1, y: 1 }), label: key, layer: on === undefined ? none : some(on),
        }, undefined)!;
        const drawing = { items: [item("A01", "power"), item("CRAH-1", "cooling"), item("Loose", undefined)], zones: [], links: [], nets: [] };
        const view = toggleLocked(LAYERS, toggleIsolated(NO_LAYER_VIEW, "power"), "power");
        const state = layerState(layersInForce(LAYERS, view), drawing);
        const id = (key: string) => entityId({ kind: "racks", key });
        expect([...state.hidden]).toEqual([id("CRAH-1")]);
        expect([...state.locked]).toEqual([id("A01")]);
    });

    test("the choices cross the UI store as their East value, whole", () => {
        const view = toggleLocked(LAYERS, toggleIsolated(toggleShown(LAYERS, NO_LAYER_VIEW, "structure"), "power"), "cooling");
        const decoded = decodeBeast2For(SchematicLayerViewType)(encodeBeast2For(SchematicLayerViewType)(view));
        expect(viewEqual(decoded, view)).toBe(true);
        expect(viewEqual(decoded, NO_LAYER_VIEW)).toBe(false);
    });
});

describe("useSchematicLayerView", () => {
    const KEY = "schematic.floor.layers";
    beforeEach(() => { StateRuntime.initializeStore(new UIStore()); });

    test("holds no choice until the viewer makes one; a choice is an East value under the key, which another Schematic of the key follows", () => {
        const first = renderHook(() => useSchematicLayerView(KEY));
        const second = renderHook(() => useSchematicLayerView(KEY));
        expect(viewEqual(first.result.current[0], NO_LAYER_VIEW)).toBe(true);
        const isolated = toggleIsolated(NO_LAYER_VIEW, "power");
        act(() => { first.result.current[1](isolated); });
        expect(viewEqual(second.result.current[0], isolated)).toBe(true);
        expect(viewEqual(decodeBeast2For(SchematicLayerViewType)(StateRuntime.getStore().read(KEY)!), isolated)).toBe(true);
        // A Schematic of another id keeps its own.
        const hall = renderHook(() => useSchematicLayerView("schematic.hall.layers"));
        expect(viewEqual(hall.result.current[0], NO_LAYER_VIEW)).toBe(true);
    });
});
