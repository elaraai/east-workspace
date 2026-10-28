/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

/**
 * The viewer's layer choices (#1389, `Schematic Builder Spec.md` §8, SC27):
 * what the library's Layers tab shows, hides, isolates and locks, held in the
 * UI store under the Schematic's `id` (`schematicKeys(id).layers`) as an East
 * value — as the tools are (`tools.ts`) — so a remount keeps them and two
 * Schematics of one `id` share them. They are view settings, like the Plan's
 * Series and the Sheet's Columns: they write no record.
 *
 * Each layer's author defaults — its `visible` and `locked` — stand until the
 * viewer overrides them:
 *
 * - **Show or Hide** flips the layer as it shows now, isolation counted, and
 *   ends an isolation;
 * - **Isolate** shows that layer alone — an entity on no layer, or on a key no
 *   layer has, still shows — and Isolate again ends it;
 * - **Lock** flips whether the layer's entities select;
 * - **Show all** shows every layer, the ones its author hides at first among
 *   them, and ends an isolation; the locks stay as they are.
 *
 * The pure functions here turn the choices into the layers the drawing obeys
 * (`layersInForce`, which `canvas/layers.ts`' `layerState` reads), and each
 * toggle into the next choices.
 *
 * @packageDocumentation
 */

import { useCallback, useMemo, useSyncExternalStore } from "react";
import {
    BooleanType, DictType, OptionType, SortedMap, StringType, StructType, compareFor, decodeBeast2For, encodeBeast2For, equalFor, none, some,
    type ValueTypeOf,
} from "@elaraai/east";
import { StateRuntime, getSomeorUndefined } from "@elaraai/east-ui-components";
import type { SchematicLayerValue } from "./canvas/layers.js";

const stringEqual = equalFor(StringType);
const compareString = compareFor(StringType);

/**
 * The viewer's layer choices, as the UI store holds them.
 *
 * @property shown - Each layer the viewer showed or hid, by its key: over its author's `visible`
 * @property locked - Each layer the viewer locked or unlocked, by its key: over its author's `locked`
 * @property isolated - The layer shown alone; `none` while none is
 */
export const SchematicLayerViewType = StructType({
    shown: DictType(StringType, BooleanType),
    locked: DictType(StringType, BooleanType),
    isolated: OptionType(StringType),
});

/** The viewer's layer choices, decoded. */
export type SchematicLayerView = ValueTypeOf<typeof SchematicLayerViewType>;

/** No choice yet: every layer as its author has it. */
export const NO_LAYER_VIEW: SchematicLayerView = { shown: new SortedMap([], compareString), locked: new SortedMap([], compareString), isolated: none };

const encodeView = encodeBeast2For(SchematicLayerViewType);
const decodeView = decodeBeast2For(SchematicLayerViewType);

/**
 * Whether a layer shows now: the isolated one alone while one is, else the
 * viewer's choice, else its author's default — shown unless it says otherwise.
 *
 * @param layer - The layer
 * @param view - The viewer's choices
 * @returns Whether it shows
 */
export function layerShown(layer: SchematicLayerValue, view: SchematicLayerView): boolean {
    const isolated = getSomeorUndefined(view.isolated);
    if (isolated !== undefined) return stringEqual(isolated, layer.key);
    return view.shown.get(layer.key) ?? getSomeorUndefined(layer.visible) ?? true;
}

/**
 * Whether a layer is locked now: the viewer's choice, else its author's
 * default — unlocked unless it says otherwise.
 *
 * @param layer - The layer
 * @param view - The viewer's choices
 * @returns Whether its entities never select
 */
export function layerLocked(layer: SchematicLayerValue, view: SchematicLayerView): boolean {
    return view.locked.get(layer.key) ?? getSomeorUndefined(layer.locked) ?? false;
}

/**
 * The layers as the drawing obeys them: each one's `visible` and `locked` the
 * viewer's choices over its author's defaults (see the module docs).
 *
 * @param layers - The layers, in their order
 * @param view - The viewer's choices
 * @returns The layers, each as it shows and locks now; the layers themselves while the viewer has chosen nothing
 */
export function layersInForce(layers: readonly SchematicLayerValue[], view: SchematicLayerView): readonly SchematicLayerValue[] {
    if (view.shown.size === 0 && view.locked.size === 0 && view.isolated.type === "none") return layers;
    return layers.map((layer) => ({ ...layer, visible: some(layerShown(layer, view)), locked: some(layerLocked(layer, view)) }));
}

/**
 * Show or Hide: the layer flipped as it shows now, isolation counted, and the
 * isolation ended.
 *
 * @param layers - The layers
 * @param view - The viewer's choices
 * @param key - The layer's key
 * @returns The choices after it
 */
export function toggleShown(layers: readonly SchematicLayerValue[], view: SchematicLayerView, key: string): SchematicLayerView {
    const layer = layers.find((l) => stringEqual(l.key, key));
    if (layer === undefined) return view;
    const shown = new SortedMap(view.shown, compareString);
    // Ending an isolation shows every layer as its own choice has it: the isolated one, and the others.
    shown.set(key, !layerShown(layer, view));
    return { shown, locked: view.locked, isolated: none };
}

/**
 * Lock or unlock a layer, as it is locked now.
 *
 * @param layers - The layers
 * @param view - The viewer's choices
 * @param key - The layer's key
 * @returns The choices after it
 */
export function toggleLocked(layers: readonly SchematicLayerValue[], view: SchematicLayerView, key: string): SchematicLayerView {
    const layer = layers.find((l) => stringEqual(l.key, key));
    if (layer === undefined) return view;
    const locked = new SortedMap(view.locked, compareString);
    locked.set(key, !layerLocked(layer, view));
    return { shown: view.shown, locked, isolated: view.isolated };
}

/**
 * Isolate a layer, or end its isolation.
 *
 * @param view - The viewer's choices
 * @param key - The layer's key
 * @returns The choices after it
 */
export function toggleIsolated(view: SchematicLayerView, key: string): SchematicLayerView {
    const isolated = getSomeorUndefined(view.isolated);
    return { shown: view.shown, locked: view.locked, isolated: isolated !== undefined && stringEqual(isolated, key) ? none : some(key) };
}

/**
 * Show all: every layer shown, the ones its author hides at first among them,
 * the isolation ended and the locks kept.
 *
 * @param layers - The layers
 * @param view - The viewer's choices
 * @returns The choices after it
 */
export function showAll(layers: readonly SchematicLayerValue[], view: SchematicLayerView): SchematicLayerView {
    // A layer its author shows needs no choice; one its author hides is shown by one.
    const shown = new SortedMap(layers.filter((layer) => getSomeorUndefined(layer.visible) === false).map((layer) => [layer.key, true] as const), compareString);
    return { shown, locked: view.locked, isolated: none };
}

/**
 * Whether any layer is hidden now, isolation counted: what offers Show all.
 *
 * @param layers - The layers
 * @param view - The viewer's choices
 * @returns Whether one is
 */
export function anyHidden(layers: readonly SchematicLayerValue[], view: SchematicLayerView): boolean {
    return layers.some((layer) => !layerShown(layer, view));
}

/**
 * The viewer's layer choices under a key, and the write that changes them —
 * every Schematic under that key follows it (see the module docs).
 *
 * @param key - The Schematic's layers key (`schematicKeys(id).layers`)
 * @returns What the store holds — no choice until the viewer makes one — and the write
 */
export function useSchematicLayerView(key: string): [SchematicLayerView, (next: SchematicLayerView) => void] {
    const store = StateRuntime.getStore();
    const subscribe = useCallback((notify: () => void) => store.subscribe(key, notify), [store, key]);
    const snapshot = useCallback(() => store.read(key), [store, key]);
    const bytes = useSyncExternalStore(subscribe, snapshot);
    const view = useMemo((): SchematicLayerView => (bytes === undefined ? NO_LAYER_VIEW : decodeView(bytes)), [bytes]);
    const write = useCallback((next: SchematicLayerView) => { store.write(key, encodeView(next)); }, [store, key]);
    return [view, write];
}
