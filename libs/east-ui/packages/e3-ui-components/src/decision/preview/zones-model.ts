/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

/**
 * What a zones target's preview draws (`Decision Queue Spec.md` P9, P24,
 * P25): a record of areas, each in a zone at its place on a grid, as the
 * change leaves them — a tile an area, at least twelve a row, filled from its
 * zone's colour, the areas the change moves taking their new zone's fill and
 * the glow, a depot its dot — and the zones' key, each zone's count before →
 * after. Pure: the preview reads the rows, and this works out what they draw.
 *
 * @packageDocumentation
 */

import { FloatType, StringType, compareFor, equalFor } from "@elaraai/east";

/** The fewest columns the tiles take (P9): twelve a row. */
export const ZONE_COLUMNS = 12;

const compareString = compareFor(StringType);
const compareNumber = compareFor(FloatType);
const stringEqual = equalFor(StringType);

/** One area, as its record holds it and as the change leaves it. */
export interface ZoneAreaInput {
    /** Its key's text. */
    readonly key: string;
    /** Its zone as it stands; `undefined` for an area the change adds. */
    readonly before: string | undefined;
    /** Its zone as the change leaves it; `undefined` for one it removes. */
    readonly after: string | undefined;
    /** Its place on the grid: its column and its row, from zero. */
    readonly x: number;
    readonly y: number;
    /** Whether it is a depot: its dot. */
    readonly depot: boolean;
}

/** One tile of the grid. */
export type ZoneTile =
    | { readonly empty: true; readonly x: number; readonly y: number }
    | {
        readonly empty: false; readonly x: number; readonly y: number;
        /** The area's key. */
        readonly key: string;
        /** Its zone as the change leaves it, else as it stands. */
        readonly zone: string;
        /** Its zone as it stands, where the change moves it. */
        readonly from: string | undefined;
        /** Whether it is a depot. */
        readonly depot: boolean;
    };

/** A zone's count, before and after the change. */
export interface ZoneCount {
    /** The zone's key. */
    readonly zone: string;
    readonly before: number;
    readonly after: number;
}

/** The areas that move from one zone to another. */
export interface ZoneMove {
    readonly from: string;
    readonly to: string;
    /** How many. */
    readonly n: number;
}

/** What a zones preview draws. */
export interface ZonesModel {
    /** The grid's columns: at least {@link ZONE_COLUMNS}. */
    readonly columns: number;
    /** Its tiles, row by row. */
    readonly tiles: readonly ZoneTile[];
    /** Each zone's count, in the zones' order. */
    readonly counts: readonly ZoneCount[];
    /** The moves, the most areas first. */
    readonly moves: readonly ZoneMove[];
    /** How many areas there are. */
    readonly areas: number;
}

/**
 * What a zones target's preview draws (see the module docs).
 *
 * @param areas - Every area of the record
 * @param zones - The zones' keys, in their order
 * @param marked - Whether the change's areas are marked: not for areas drawn as they stand (P4, P21)
 * @returns The grid, the counts and the moves
 */
export function zonesPreview(areas: readonly ZoneAreaInput[], zones: readonly string[], marked: boolean): ZonesModel {
    const byPlace = new Map<string, ZoneAreaInput>();
    let columns = ZONE_COLUMNS, rows = 0;
    const place = (x: number, y: number) => `${x}:${y}`;
    for (const area of [...areas].sort((a, b) => compareString(a.key, b.key))) {
        const x = Math.max(0, Math.round(area.x)), y = Math.max(0, Math.round(area.y));
        columns = Math.max(columns, x + 1);
        rows = Math.max(rows, y + 1);
        if (!byPlace.has(place(x, y))) byPlace.set(place(x, y), area);
    }
    const counts = zones.map((zone): { zone: string; before: number; after: number } => ({ zone, before: 0, after: 0 }));
    const count = (zone: string | undefined, side: "before" | "after") => {
        const held = zone === undefined ? undefined : counts.find(c => stringEqual(c.zone, zone));
        if (held !== undefined) held[side] += 1;
    };
    const moves: { from: string; to: string; n: number }[] = [];
    for (const area of areas) {
        const after = marked ? area.after : area.before;
        count(area.before, "before");
        count(after, "after");
        if (area.before !== undefined && after !== undefined && !stringEqual(area.before, after)) {
            const held = moves.find(m => stringEqual(m.from, area.before!) && stringEqual(m.to, after));
            if (held !== undefined) held.n += 1;
            else moves.push({ from: area.before, to: after, n: 1 });
        }
    }
    const tiles: ZoneTile[] = [];
    for (let y = 0; y < rows; y++) {
        for (let x = 0; x < columns; x++) {
            const area = byPlace.get(place(x, y));
            const zone = area === undefined ? undefined : (marked ? area.after : area.before) ?? area.before;
            if (area === undefined || zone === undefined) { tiles.push({ empty: true, x, y }); continue; }
            const moved = marked && area.before !== undefined && area.after !== undefined && !stringEqual(area.before, area.after);
            tiles.push({ empty: false, x, y, key: area.key, zone, from: moved ? area.before : undefined, depot: area.depot });
        }
    }
    return { columns, tiles, counts, moves: moves.sort((a, b) => compareNumber(b.n, a.n)), areas: areas.length };
}
