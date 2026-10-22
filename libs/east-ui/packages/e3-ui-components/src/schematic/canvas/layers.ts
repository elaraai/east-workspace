/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

/**
 * What the layers do to the drawing (#1387, §8): each entity's layer — its
 * `layer`, naming a layer by its key (`Schematic.layers`, D36) — hides it,
 * locks it or dims it as the layer's author defaults say: `visible` false
 * hides every entity on it, `locked` makes them unselectable, and `opacity`
 * under 1 dims them. An entity on no layer, or on a key no layer has, is
 * always shown. The viewer's own choices are the Layers tab's (#1389), kept
 * under the Schematic's `id`. Pure: data in, data out, unit-tested in
 * `layers.test.ts`.
 *
 * @packageDocumentation
 */

import { match, type ValueTypeOf, type option } from "@elaraai/east";
import type { Schematic } from "@elaraai/e3-ui/internal";
import type { SchematicDrawn } from "./drawn";

/** An Option's value, or `undefined` — East's `match`: this module loads no renderer. */
const getSomeorUndefined = <T,>(opt: option<T>): T | undefined => match(opt, { some: (value) => value }, undefined);

/** A layer, decoded. */
export type SchematicLayerValue = ValueTypeOf<typeof Schematic.Types.Layer>;

/** What the layers do to the drawing, by each entity's id. */
export interface SchematicLayerState {
    /** The entities a hidden layer holds: they never draw. */
    readonly hidden: ReadonlySet<string>;
    /** The entities a locked layer holds: they never select. */
    readonly locked: ReadonlySet<string>;
    /** Each dimmed entity's opacity. */
    readonly alpha: ReadonlyMap<string, number>;
}

/** No layer does anything: the drawing of a Schematic with none. */
export const NO_LAYER_STATE: SchematicLayerState = { hidden: new Set(), locked: new Set(), alpha: new Map() };

/**
 * What the layers do to a drawing (see the module docs).
 *
 * @param layers - The layers, in their order
 * @param drawn - What the canvas draws
 * @returns Each entity hidden, locked or dimmed by its layer
 */
export function layerState(layers: readonly SchematicLayerValue[], drawn: SchematicDrawn): SchematicLayerState {
    if (layers.length === 0) return NO_LAYER_STATE;
    const byKey = new Map(layers.map((layer) => [layer.key, layer] as const));
    const hidden = new Set<string>();
    const locked = new Set<string>();
    const alpha = new Map<string, number>();
    const place = (id: string, on: option<string>) => {
        const key = getSomeorUndefined(on);
        const layer = key === undefined ? undefined : byKey.get(key);
        if (layer === undefined) return;
        if (getSomeorUndefined(layer.visible) === false) {
            hidden.add(id);
            return;
        }
        if (getSomeorUndefined(layer.locked) === true) locked.add(id);
        const opacity = getSomeorUndefined(layer.opacity);
        if (opacity !== undefined && opacity < 1) alpha.set(id, opacity);
    };
    for (const item of drawn.items) place(item.key, item.layer);
    for (const zone of drawn.zones) place(zone.key, zone.layer);
    for (const link of drawn.links) place(link.key, link.layer);
    for (const net of drawn.nets) place(net.key, net.layer);
    return { hidden, locked, alpha };
}
