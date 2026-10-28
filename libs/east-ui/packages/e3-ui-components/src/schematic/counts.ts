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
 * A kind read by area draws only its window (#1393), which a pan moves: its
 * count is never what the window draws, but its stored rows its narrowing
 * holds that have a position, counted by its source's indexes and given here
 * (`area-counts.ts`), its drafts in place — `reading`, a placeholder in its
 * place, until those counts land, never a number no read said. Where no read
 * can say it, it is not counted, and Details says why: a hidden layer may
 * hold some of its rows; or its filters can't count its rows with no
 * position. The links and the nets that may join one of its items are not
 * counted either: which of them draw, each between two items drawn, is read
 * only as the view moves.
 *
 * @packageDocumentation
 */

import { StringType, equalFor } from "@elaraai/east";
import type { ItemRoles, SchematicDrawn, SchematicRef, ZoneRoles } from "./canvas/drawn.js";
import type { SchematicLayerState } from "./canvas/layers.js";
import type { SchematicValue } from "./data.js";
import type { SortDrafts } from "./drafted.js";

const stringEqual = equalFor(StringType);

/** Why the drawing's Details counts none of a sort or a kind: a hidden layer, the ends a link or a net joins, or the filters. */
export type SchematicUncounted = "layer" | "ends" | "filters";

/**
 * A count the drawing's Details says (see the module docs): a number; one whose read is in flight — a placeholder in its
 * place; or one no read can say, and why.
 */
export type SchematicDrawingCount =
    | { readonly kind: "counted"; readonly n: number }
    | { readonly kind: "reading" }
    | { readonly kind: "uncounted"; readonly why: SchematicUncounted };

/** A count in flight. */
export const COUNT_READING: SchematicDrawingCount = { kind: "reading" };

/**
 * A count, as a number says it.
 *
 * @param n - The number
 * @returns The count
 */
export function counted(n: number): SchematicDrawingCount {
    return { kind: "counted", n };
}

/**
 * A count no read can say.
 *
 * @param why - Why
 * @returns The count
 */
export function uncounted(why: SchematicUncounted): SchematicDrawingCount {
    return { kind: "uncounted", why };
}

/** One item kind, as the drawing's Details counts it. */
export interface SchematicKindCount {
    /** Its slot. */
    readonly slot: string;
    /** Its name (`Rack`). */
    readonly name: string;
    /** Its items drawn: placed, its narrowing's and on no hidden layer — a kind read by area's counted by its source. */
    readonly drawn: SchematicDrawingCount;
}

/** What the drawing's Details counts. */
export interface SchematicCounts {
    /** Each item kind's items drawn, in the order the Schematic lists them. */
    readonly kinds: readonly SchematicKindCount[];
    /** The zones drawn; `undefined` with no zone kind. */
    readonly zones: SchematicDrawingCount | undefined;
    /** The links drawn — each between two items drawn; `undefined` with no link kind. */
    readonly links: SchematicDrawingCount | undefined;
    /** The nets drawn — each with a member drawn on either side; `undefined` with no net kind. */
    readonly nets: SchematicDrawingCount | undefined;
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
    /** The kinds read by area, by slot (#1393): each counted by its source, as given, never by what its window draws. */
    readonly areas?: ReadonlySet<string> | undefined;
    /** Whether a link kind may join an item of a kind read by area: then no link is counted. */
    readonly linksByArea?: boolean | undefined;
    /** Whether a net kind may join an item of a kind read by area: then no net is counted. */
    readonly netsByArea?: boolean | undefined;
}

/** No kind read by area. */
const NO_AREAS: ReadonlySet<string> = new Set();

/** No kind read by area counted. */
const NO_AREA_COUNTS: ReadonlyMap<string, SchematicDrawingCount> = new Map();

/** Several counts as one: a sum of numbers — in flight while any is, and none any read can say once one is not. */
function summed(counts: readonly SchematicDrawingCount[]): SchematicDrawingCount {
    let n = 0;
    let reading = false;
    for (const count of counts) {
        if (count.kind === "uncounted") return count;
        if (count.kind === "reading") reading = true;
        else n += count.n;
    }
    return reading ? COUNT_READING : counted(n);
}

/**
 * What the drawing's Details counts of a drawing (see the module docs).
 *
 * @param kinds - The Schematic's kinds
 * @param drawn - What the canvas draws
 * @param layers - What its layers hide
 * @param areaCounts - Each kind read by area's count, by its slot, its drafts in place: in flight while it has none
 * @returns The counts
 */
export function schematicCounts(kinds: SchematicCountedKinds, drawn: SchematicDrawn, layers: SchematicLayerState,
    areaCounts: ReadonlyMap<string, SchematicDrawingCount> = NO_AREA_COUNTS): SchematicCounts {
    const byArea = kinds.areas ?? NO_AREAS;
    const shown = (key: string) => !layers.hidden.has(key);
    const items = drawn.items.filter((item) => shown(item.key));
    const drawnItems = new Set(items.map((item) => item.key));
    const itemSlots = new Set(kinds.items.map((kind) => kind.key));
    const areaCount = (slot: string): SchematicDrawingCount => areaCounts.get(slot) ?? COUNT_READING;
    // The zone kinds read by area: those of the kinds read by area that are no item kind.
    const areaZones = [...byArea].filter((slot) => !itemSlots.has(slot));
    return {
        kinds: kinds.items.map((kind) => ({
            slot: kind.key, name: kind.name,
            drawn: byArea.has(kind.key) ? areaCount(kind.key) : counted(items.filter((item) => stringEqual(item.ref.kind, kind.key)).length),
        })),
        zones: kinds.zones ? summed([counted(drawn.zones.filter((zone) => shown(zone.key) && !byArea.has(zone.ref.kind)).length), ...areaZones.map(areaCount)]) : undefined,
        links: !kinds.links ? undefined : kinds.linksByArea === true ? uncounted("ends")
            : counted(drawn.links.filter((link) => shown(link.key) && drawnItems.has(link.from) && drawnItems.has(link.to)).length),
        nets: !kinds.nets ? undefined : kinds.netsByArea === true ? uncounted("ends")
            : counted(drawn.nets.filter((net) => shown(net.key) && net.sources.some((m) => drawnItems.has(m)) && net.destinations.some((m) => drawnItems.has(m))).length),
    };
}

/** A kind read by area, as its count is drafted: its slot, and its sort — an item's rows may have no position, a zone's always have one. */
export interface SchematicAreaCountedKind {
    /** Its slot. */
    readonly key: string;
    /** Its sort. */
    readonly sort: "items" | "zones";
}

/**
 * Each kind read by area's count with its drafts in place (#1393): its stored rows' count, and for each row a draft holds
 * that its narrowing holds — by the row its session began from — one more where the draft has a position and the row it
 * began from had none, one fewer the other way, and one fewer where the draft deletes a row that had one; a row a gesture
 * made, one more where it has a position, the narrowing's or not, as it draws. A count in flight, or one no read can say,
 * stays so; and while a hidden layer may hold some of a kind's rows, no read can say how many it draws.
 *
 * @param kinds - The kinds read by area
 * @param stored - Each one's stored rows' count, by its slot (`area-counts.ts`)
 * @param drafts - The item kinds' and the zone kinds' drafts
 * @param held - Whether a kind's narrowing holds a drafted row, by the row its session began from: `false` leaves it out;
 *   `undefined` — nothing narrows the kind, or its answer is in flight — counts it
 * @param began - Whether the row a deleted draft's session began from had a position; `undefined` for one a gesture made
 * @param layerHidden - Whether a layer is hidden
 * @returns Each kind's count, by its slot
 */
export function draftedAreaCounts(kinds: readonly SchematicAreaCountedKind[], stored: ReadonlyMap<string, SchematicDrawingCount>,
    drafts: { readonly items: SortDrafts<ItemRoles>; readonly zones: SortDrafts<ZoneRoles> }, held: (ref: SchematicRef) => boolean | undefined,
    began: (ref: SchematicRef) => boolean | undefined, layerHidden: boolean): ReadonlyMap<string, SchematicDrawingCount> {
    const out = new Map<string, SchematicDrawingCount>();
    for (const kind of kinds) {
        if (layerHidden) { out.set(kind.key, uncounted("layer")); continue; }
        const count = stored.get(kind.key) ?? COUNT_READING;
        if (count.kind !== "counted") { out.set(kind.key, count); continue; }
        let n = count.n;
        const placed = (roles: ItemRoles | ZoneRoles): boolean => kind.sort === "zones" || (roles as ItemRoles).position.type === "some";
        const rows: ReadonlyMap<string, { readonly roles: ItemRoles | ZoneRoles; readonly created: boolean; readonly began?: ItemRoles | ZoneRoles | undefined } | undefined> =
            (kind.sort === "items" ? drafts.items : drafts.zones).get(kind.key) ?? new Map();
        for (const [key, row] of rows) {
            const ref = { kind: kind.key, key };
            if (row?.created === true) { if (placed(row.roles)) n += 1; continue; }
            if (held(ref) === false) continue;
            const was = row === undefined ? began(ref) === true : row.began !== undefined && placed(row.began);
            const now = row !== undefined && placed(row.roles);
            n += (now ? 1 : 0) - (was ? 1 : 0);
        }
        out.set(kind.key, counted(n));
    }
    return out;
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
