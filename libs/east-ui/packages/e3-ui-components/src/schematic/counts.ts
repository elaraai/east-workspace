/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

/**
 * What the inspector's Details says of the drawing with nothing selected
 * (#1387, #1391, `Schematic Builder Spec.md` §9): each item kind's items drawn
 * — placed, and on no hidden layer — the zones drawn, the links drawn between
 * two items drawn and the nets drawn with a member drawn on either side, each
 * sort only where the Schematic has a kind of it; and the kinds' records whose
 * commits say when each was last saved. Pure: data in, data out, unit-tested
 * in `counts.test.ts`; the inspector (`inspector.tsx`) says them. The footer
 * says none of it: it holds only what is live (`footer.tsx`).
 *
 * @packageDocumentation
 */

import { StringType, equalFor } from "@elaraai/east";
import type { SchematicDrawn } from "./canvas/drawn.js";
import type { SchematicLayerState } from "./canvas/layers.js";
import type { SchematicValue } from "./data.js";

const stringEqual = equalFor(StringType);

/** One item kind, as the drawing's Details counts it. */
export interface SchematicKindCount {
    /** Its slot. */
    readonly slot: string;
    /** Its name (`Rack`). */
    readonly name: string;
    /** Its items drawn: placed, and on no hidden layer. */
    readonly drawn: number;
}

/** What the drawing's Details counts. */
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

/** What the Schematic declares, as the drawing's Details counts it: its kinds, by sort. */
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
 * What the drawing's Details counts of a drawing (see the module docs).
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

/** A record's commits, newest first, as a kind's `history` reads them. */
type History = Extract<SchematicValue["items"][number]["history"], { type: "some" }>["value"];

/** A kind's record whose commits say when it was last saved: one bound with its patch door. */
export interface SchematicSavedRecord {
    /** The kind's slot. */
    readonly slot: string;
    /** The kind's name (`Rack`). */
    readonly name: string;
    /** Its record's commits, newest first. */
    readonly history: History;
}

/**
 * The kinds whose records say when they were last saved: each bound with its
 * patch door, whose commits it reads — in the Schematic's order of its sorts,
 * items, zones, links and nets.
 *
 * @param value - The payload
 * @returns Each such kind's record
 */
export function savedRecords(value: SchematicValue): SchematicSavedRecord[] {
    return [...value.items, ...value.zones, ...value.links, ...value.nets]
        .flatMap((kind) => (kind.history.type === "some" ? [{ slot: kind.key, name: kind.name, history: kind.history.value }] : []));
}
