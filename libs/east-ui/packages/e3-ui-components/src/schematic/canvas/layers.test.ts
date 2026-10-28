/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 *
 * What the layers do to the drawing (#1387, `layers.ts`, §8): each layer's
 * author defaults — `visible` false hides every entity on it, `locked` makes
 * them unselectable, an `opacity` under 1 dims them — over items, zones, links
 * and nets alike; an entity on no layer, or on a key no layer has, is always
 * shown. Fixtures are real East values, made what the canvas draws by
 * `drawn.ts`.
 */

import { describe, test, expect } from "vitest";
import { defaultValue, none, some, type ValueTypeOf } from "@elaraai/east";
import { Schematic } from "@elaraai/e3-ui/internal";
import { drawnItem, drawnLink, drawnNet, drawnZone, entityId } from "./drawn";
import { NO_LAYER_STATE, layerState } from "./layers";

type Layer = ValueTypeOf<typeof Schematic.Types.Layer>;

/** A layer: shown, unlocked and undimmed unless given. */
const layer = (key: string, over: Partial<Layer> = {}): Layer => ({
    key, label: key, visible: none, locked: none, opacity: none, tone: none, color: none, ...over,
});

const RACK = { kind: "racks", key: "A01" };
const FRAME = { kind: "network", key: "ODF-1" };

/** A drawing of one entity of each sort, each on the layer given. */
function drawing(on: { item?: string; zone?: string; link?: string; net?: string; other?: string }) {
    const at = (key: string | undefined) => (key === undefined ? none : some(key));
    const item = (ref: typeof RACK, key: string | undefined) => drawnItem(ref, {
        ...defaultValue<typeof Schematic.Types.Item>(Schematic.Types.Item), position: some({ x: 1, y: 1 }), label: ref.key, layer: at(key),
    }, undefined)!;
    return {
        items: [item(RACK, on.item), item(FRAME, on.other)],
        zones: [drawnZone({ kind: "areas", key: "cage-a" }, { ...defaultValue<typeof Schematic.Types.Zone>(Schematic.Types.Zone), layer: at(on.zone) })],
        links: [drawnLink({ kind: "fibre", key: "u1" }, { ...defaultValue<typeof Schematic.Types.Link>(Schematic.Types.Link), from: RACK, to: FRAME, layer: at(on.link) })],
        nets: [drawnNet({ kind: "feeds", key: "f1" }, { ...defaultValue<typeof Schematic.Types.Net>(Schematic.Types.Net), sources: [FRAME], destinations: [RACK], layer: at(on.net) })],
    };
}

const ids = {
    item: entityId(RACK), other: entityId(FRAME), zone: entityId({ kind: "areas", key: "cage-a" }),
    link: entityId({ kind: "fibre", key: "u1" }), net: entityId({ kind: "feeds", key: "f1" }),
};

describe("layerState", () => {
    test("with no layers, nothing is hidden, locked or dimmed", () => {
        expect(layerState([], drawing({ item: "power" }))).toBe(NO_LAYER_STATE);
    });

    test("a layer its author ships hidden hides every entity on it, of every sort — and a hidden one is not also locked", () => {
        const state = layerState([layer("power", { visible: some(false), locked: some(true) })], drawing({ item: "power", zone: "power", link: "power", net: "power" }));
        expect([...state.hidden].sort()).toEqual([ids.item, ids.zone, ids.link, ids.net].sort());
        expect([...state.locked]).toEqual([]);
        expect([...state.alpha]).toEqual([]);
    });

    test("a locked layer makes its entities unselectable; a dimmed one dims them; a full opacity dims nothing", () => {
        const state = layerState(
            [layer("structure", { locked: some(true), opacity: some(0.6) }), layer("network", { opacity: some(1) })],
            drawing({ item: "structure", zone: "structure", link: "network", other: "network" }),
        );
        expect([...state.locked].sort()).toEqual([ids.item, ids.zone].sort());
        expect([...state.alpha].sort()).toEqual([[ids.item, 0.6], [ids.zone, 0.6]].sort());
        expect([...state.hidden]).toEqual([]);
    });

    test("an entity on no layer, or on a key no layer has, is always shown", () => {
        // The rack is on a key no layer has, the frame on none.
        const state = layerState([layer("power", { visible: some(false) })], drawing({ item: "cooling", net: "power" }));
        expect([...state.hidden]).toEqual([ids.net]);
    });

    test("a layer its author shows is shown: only `visible` false hides", () => {
        const state = layerState([layer("power", { visible: some(true) })], drawing({ item: "power" }));
        expect([...state.hidden]).toEqual([]);
    });
});
