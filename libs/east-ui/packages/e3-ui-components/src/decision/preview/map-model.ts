/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

/**
 * What a builder's map draws (`Decision Queue Spec.md` D7, P3, P5, P12, P25):
 * past two lanes, the Plan's, the Calendar's and the Allocation's preview
 * draws every resource of the kinds the change lands on as a tile, eight a
 * row under its group's label — its row's `group`, else its kind's name — at
 * most three rows, the groups the change touches first. A tile is lit where
 * the change lands or changes events, a ghost where it only takes them off,
 * ringed where it knocks one on or breaks a rule there, and plain where it
 * changes nothing; a group of more than a row shows the tiles the change
 * touches first, in their order, and one for the rest. Each tile says a short
 * name, its title the whole. Under them the when strip: a tick at each new
 * time the change gives an event. What the map counts is the lanes model's
 * tally and landings (`lanesPreview`); pure, as it is.
 *
 * @packageDocumentation
 */

import { StringType, equalFor } from "@elaraai/east";
import { laneTicks, whenWindow, type LaneBreach, type LaneLanding, type LaneWindow, type LanesModel } from "./lanes-model.js";

/** The most lanes a crop draws: past them, its kind's map (D7). */
export const CROP_LANES = 2;
/** The most tiles a map's row holds. */
const MAP_COLUMNS = 8;
/** The most rows a map draws, its when strip under them: the frame's height (P2). */
const MAP_ROWS = 3;
/** What a name's words are cut at: spaces, and the marks that join a code's parts. */
const SEPARATORS = /[\s\-_/.:·]+/u;

const stringEqual = equalFor(StringType);

/** One resource a map draws: by the key the change's events name it by, its name, and the group it is drawn under. */
export interface MapResource {
    /** Its key, as the lanes model's tally names it: a Plan's or a Calendar's resource printed, an Allocation's key. */
    readonly key: string;
    /** Its name, as its builder names it. */
    readonly name: string;
    /** The group it is drawn under: its row's group, else its kind's name. */
    readonly group: string;
}

/** How the change marks a tile: lit where it lands or changes events there, a ghost where it only takes them off. */
export type MapOp = "chg" | "from" | undefined;

/** One tile of a map: a resource, or the rest of its group's. */
export interface MapTile {
    /** Its resource's key; the group's for the rest. */
    readonly key: string;
    /** What it says: its resource's short name ({@link shortNames}); empty for the rest, which says their count. */
    readonly label: string;
    /** Its resource's name. */
    readonly name: string;
    /** How the change marks it. */
    readonly op: MapOp;
    /** How many of the change's events stand there once it is made, but those it knocks on. */
    readonly takes: number;
    /** How many of the events it knocks on stand there (P16). */
    readonly knocks: number;
    /** How many of its events it takes off there. */
    readonly loses: number;
    /** What the first of the events standing there breaks once it is made (P15). */
    readonly breach: LaneBreach | undefined;
    /** For the rest of a group: how many resources it stands for; 0 for a resource's own tile. */
    readonly more: number;
}

/** One row of a map: a group's tiles under its label. */
export interface MapRow {
    /** The group's label. */
    readonly group: string;
    /** Its tiles, in its resources' order. */
    readonly tiles: readonly MapTile[];
}

/** A tick of the when strip: a new time the change gives an event. */
export interface MapWhenTick {
    /** Where it stands, as a share of the strip's window. */
    readonly at: number;
    /** The event, and its new time. */
    readonly landing: LaneLanding;
}

/** The when strip under a map (P12). */
export interface MapWhen {
    /** Its window ({@link whenWindow}). */
    readonly window: LaneWindow;
    /** Its grid lines, as shares of the window. */
    readonly grid: readonly number[];
    /** Its ticks, in the order their times come. */
    readonly ticks: readonly MapWhenTick[];
}

/** A resource the change takes events off and lands none on, for the sentence. */
export interface MapFreed {
    /** Its name. */
    readonly name: string;
    /** How many events it loses. */
    readonly loses: number;
}

/** What a map draws, and what its sentence says. */
export interface MapModel {
    /** Its rows, at most three. */
    readonly rows: readonly MapRow[];
    /** How many resources the change touches: lands events on, knocks them on there, or takes them off. */
    readonly changed: number;
    /** How many resources the kinds hold: `undefined` where a kind is read a window at a time, its resources not all in hand. */
    readonly of: number | undefined;
    /** The resource the change lands the most events on, where it lands two or more there. */
    readonly most: { readonly name: string; readonly n: number } | undefined;
    /** The resources the change takes events off and lands none on, in the map's order. */
    readonly freed: readonly MapFreed[];
    /** Its when strip: none where the change gives no event a new time. */
    readonly when: MapWhen | undefined;
}

/**
 * Names cut to what tells them apart, for tiles of a group: the words every name opens with dropped — a name's words
 * cut at spaces and at the marks that join a code's parts — and what is left its one word, or the initials of its words
 * before its last: `Press A1` → `A1` beside `Press A2`, `K-101` → `101` beside `K-102`, `Lathe 1` → `L1` beside
 * `Press 1`.
 *
 * @param names - The names, as their builder names them
 * @returns Each one's short name, in order
 */
export function shortNames(names: readonly string[]): string[] {
    const words = names.map(name => {
        const cut = name.split(SEPARATORS).filter(word => word.length > 0);
        return cut.length === 0 ? [name] : cut;
    });
    // The words every name opens with, each name keeping one at least.
    let shared = 0;
    const first = words[0];
    while (first !== undefined && words.every(w => w.length > shared + 1 && stringEqual(w[shared]!, first[shared]!))) shared++;
    return words.map(w => {
        const rest = w.slice(shared);
        return rest.length === 1 ? rest[0]! : `${rest.slice(0, -1).map(word => word.slice(0, 1)).join("")}${rest[rest.length - 1]!}`;
    });
}

/** Whether the change touches a tile's resource. */
const touches = (tile: MapTile): boolean => tile.takes + tile.knocks + tile.loses > 0;

/** The first `room` of some items, those the change touches first, back in their order. */
function first<T>(items: readonly T[], touched: (item: T) => boolean, room: number): T[] {
    const order = items.map((_, i) => i);
    const kept = [...order.filter(i => touched(items[i]!)), ...order.filter(i => !touched(items[i]!))].slice(0, room).sort((a, b) => a - b);
    return kept.map(i => items[i]!);
}

/**
 * What a map draws (see the module docs).
 *
 * @param model - The lanes the change touches: its tally of each resource, and the new times it gives its events
 * @param resources - Every resource of the kinds the change lands on, in their kinds' order — or, of a kind read a window at a time, those it touches
 * @param complete - Whether `resources` is every resource of those kinds: not where one is read a window at a time
 * @returns The rows, their counts and the when strip
 */
export function lanesMap(model: LanesModel, resources: readonly MapResource[], complete: boolean): MapModel {
    const tileOf = (r: MapResource, label: string): MapTile => {
        const t = model.tally.get(r.key);
        const takes = t?.takes ?? 0, knocks = t?.knocks ?? 0, loses = t?.loses ?? 0;
        const op: MapOp = takes > 0 ? "chg" : loses > 0 && knocks === 0 ? "from" : undefined;
        return { key: r.key, label, name: r.name, op, takes, knocks, loses, breach: t?.breach, more: 0 };
    };
    // The groups, in the order their first resources come, each its resources' tiles.
    const groups: { readonly group: string; readonly resources: MapResource[] }[] = [];
    for (const r of resources) {
        const held = groups.find(g => stringEqual(g.group, r.group));
        if (held === undefined) groups.push({ group: r.group, resources: [r] });
        else held.resources.push(r);
    }
    const all = groups.map(g => {
        const labels = shortNames(g.resources.map(r => r.name));
        return { group: g.group, tiles: g.resources.map((r, i) => tileOf(r, labels[i]!)) };
    });
    // At most three rows, the groups the change touches first; a group past a row, its tiles the change touches first and one for the rest.
    const rows = first(all, row => row.tiles.some(touches), MAP_ROWS).map((row): MapRow => {
        if (row.tiles.length <= MAP_COLUMNS) return row;
        const shown = first(row.tiles, touches, MAP_COLUMNS - 1);
        const rest: MapTile = { key: row.group, label: "", name: row.group, op: undefined, takes: 0, knocks: 0, loses: 0, breach: undefined, more: row.tiles.length - shown.length };
        return { group: row.group, tiles: [...shown, rest] };
    });
    const tiles = all.flatMap(row => row.tiles);
    let most: { name: string; n: number } | undefined;
    for (const tile of tiles) if (tile.takes >= 2 && (most === undefined || tile.takes > most.n)) most = { name: tile.name, n: tile.takes };
    // The when strip: a tick at each new time, over whole hours around them.
    const window = whenWindow(model.landings.map(landing => landing.start));
    let when: MapWhen | undefined;
    if (window !== undefined) {
        const from = window.from.getTime(), span = window.to.getTime() - from;
        when = { window, grid: laneTicks(window).grid, ticks: model.landings.map(landing => ({ at: (landing.start.getTime() - from) / span, landing })) };
    }
    return {
        rows,
        changed: tiles.filter(touches).length,
        of: complete ? tiles.length : undefined,
        most,
        freed: tiles.filter(tile => tile.op === "from").map(tile => ({ name: tile.name, loses: tile.loses })),
        when,
    };
}
