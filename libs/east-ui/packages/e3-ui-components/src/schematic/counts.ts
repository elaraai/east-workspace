/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

/**
 * What the Schematic's footer counts of a drawing (#1387, `Schematic Builder
 * Spec.md` §6.3): each item kind's items drawn — placed, and on no hidden
 * layer — the zones drawn, the links drawn between two items drawn and the
 * nets drawn with a member drawn on either side, each sort only where the
 * Schematic has a kind of it. Pure: data in, data out, unit-tested in
 * `footer.test.ts`; the footer (`footer.tsx`) says them.
 *
 * @packageDocumentation
 */

import { StringType, equalFor } from "@elaraai/east";
import type { SchematicDrawn } from "./canvas/drawn.js";
import type { SchematicLayerState } from "./canvas/layers.js";

const stringEqual = equalFor(StringType);

/** One item kind, as the footer counts it. */
export interface SchematicKindCount {
    /** Its slot. */
    readonly slot: string;
    /** Its name (`Rack`). */
    readonly name: string;
    /** Its items drawn: placed, and on no hidden layer. */
    readonly drawn: number;
}

/** What the footer counts. */
export interface SchematicCounts {
    /** Each item kind's items drawn, in the order the Schematic lists them. */
    readonly kinds: readonly SchematicKindCount[];
    /** The zones drawn; `undefined` with no zone kind. */
    readonly zones: number | undefined;
    /** The links drawn — each between two items drawn; `undefined` with no link kind. */
    readonly links: number | undefined;
    /** The nets drawn — each with a member drawn on either side; `undefined` with no net kind. */
    readonly nets: number | undefined;
}

/** What the Schematic declares, as the footer counts it: its kinds, by sort. */
export interface SchematicCountedKinds {
    /** The item kinds: each its slot and its name. */
    readonly items: readonly { readonly key: string; readonly name: string }[];
    /** Whether it has zone kinds. */
    readonly zones: boolean;
    /** Whether it has link kinds. */
    readonly links: boolean;
    /** Whether it has net kinds. */
    readonly nets: boolean;
}

/**
 * What the footer counts of a drawing (see the module docs).
 *
 * @param kinds - The Schematic's kinds
 * @param drawn - What the canvas draws
 * @param layers - What its layers hide
 * @returns The counts
 */
export function schematicCounts(kinds: SchematicCountedKinds, drawn: SchematicDrawn, layers: SchematicLayerState): SchematicCounts {
    const shown = (key: string) => !layers.hidden.has(key);
    const items = drawn.items.filter((item) => shown(item.key));
    const drawnItems = new Set(items.map((item) => item.key));
    return {
        kinds: kinds.items.map((kind) => ({ slot: kind.key, name: kind.name, drawn: items.filter((item) => stringEqual(item.ref.kind, kind.key)).length })),
        zones: kinds.zones ? drawn.zones.filter((zone) => shown(zone.key)).length : undefined,
        links: kinds.links ? drawn.links.filter((link) => shown(link.key) && drawnItems.has(link.from) && drawnItems.has(link.to)).length : undefined,
        nets: kinds.nets ? drawn.nets.filter((net) => shown(net.key) && net.sources.some((m) => drawnItems.has(m))
            && net.destinations.some((m) => drawnItems.has(m))).length : undefined,
    };
}
