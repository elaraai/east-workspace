/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

/**
 * The library's Index tab (#1389, `Schematic Builder Spec.md` §8) — pure: the
 * zones nested by containment and the items inside them (`canvas/model.ts`'
 * `buildNavTree`, the tree the canvas's steps walk), laid out as the tab's
 * rows, and the zone the viewport is in.
 *
 * - **The rows.** Each zone in label order — natural, so `Cage 2` comes
 *   before `Cage 10` — with how many items it holds, its own and its nested
 *   zones'; under an open zone its items, then its nested zones; the items in
 *   no zone last. A hatched zone is an annotation, holding no items. Each row
 *   says where it stands among the rows listed beside it, which a reader hears
 *   while the rest of the list is scrolled out.
 * - **Its search** keeps the items whose label, key or kind's name holds the
 *   query, each under the zones it is in, opened; a zone with none of them
 *   leaves. A kind read by area is searched through its source (#1393, D52):
 *   each of its items listed is a match.
 * - **A zone's count** is whole only where every item it holds is in hand: a
 *   zone holding items of a kind read by area counts them only once its box
 *   is read (D52), and says no count until then.
 * - **The zone in view** is the one covering most of the viewport — of two
 *   covering as much, the smaller, so a view inside a cage is in the cage and
 *   a view of the whole hall in the hall — kept until it clearly loses, so a
 *   view on a score's edge doesn't flap. With the whole drawing in view, none
 *   is.
 *
 * @packageDocumentation
 */

import { StringType, equalFor } from "@elaraai/east";
import type { DrawnItem, DrawnZone } from "./canvas/drawn.js";
import { byLabel, type NavZone } from "./canvas/model.js";

const stringEqual = equalFor(StringType);

/** Where a row stands among the rows listed beside it, under one zone or at the top: what a reader hears while the rest scroll out. */
export interface IndexPlace {
    /** Its place, from 1. */
    readonly position: number;
    /** How many rows are listed beside it, itself among them. */
    readonly siblings: number;
}

/** One row of the Index tab: a zone, or an item inside one — or inside none. */
export type IndexRow = IndexPlace & (
    | {
        readonly kind: "zone";
        /** The zone. */
        readonly zone: DrawnZone;
        /** How deep it nests: 0 for a zone in none. */
        readonly depth: number;
        /** Whether it is open: its items and its nested zones listed under it. */
        readonly open: boolean;
        /** Whether it holds anything to open. */
        readonly branch: boolean;
        /** How many items it holds, its nested zones' among them; `undefined` while that is not whole. */
        readonly count: number | undefined;
    }
    | {
        readonly kind: "item";
        /** The item. */
        readonly item: DrawnItem;
        /** How deep it is listed: one under its zone's, 0 for an item in no zone. */
        readonly depth: number;
    });

/** What one level of the Index lists: a zone, or an item. */
type IndexEntry = { readonly kind: "zone"; readonly node: NavZone } | { readonly kind: "item"; readonly item: DrawnItem };

/** How many items a zone holds, its nested zones' among them. */
function countOf(node: NavZone): number {
    return node.items.length + node.children.reduce((n, child) => n + countOf(child), 0);
}

/** What the Index's rows take of the kinds read by area (#1393, D52). */
export interface IndexRowsOptions {
    /** The item kinds read by area, by slot: searched through their sources, each of their items listed is a match. */
    readonly searched?: ReadonlySet<string> | undefined;
    /** Whether a zone's count is whole, by its key; with none, every zone's is. */
    readonly whole?: ((zone: string) => boolean) | undefined;
}

/**
 * The Index tab's rows (see the module docs).
 *
 * @param tree - The zones nested by containment, the items inside them and those in none (`buildNavTree`)
 * @param open - The zones the viewer has open, by key
 * @param query - The tab's search; empty, none
 * @param kindName - An item kind's name, by its slot: what the search reads beside an item's label and key
 * @param locale - The app's locale, which the search lowers its text in
 * @param options - The kinds read by area, searched through their sources, and whether a zone's count is whole
 * @returns The rows, in order, each with its place among the rows listed beside it
 */
export function indexRows(tree: { readonly roots: readonly NavZone[]; readonly floor: readonly DrawnItem[] }, open: ReadonlySet<string>, query: string,
    kindName: (slot: string) => string, locale: string, options: IndexRowsOptions = {}): IndexRow[] {
    const q = query.trim().toLocaleLowerCase(locale);
    const searching = q !== "";
    const matches = (item: DrawnItem): boolean => !searching || options.searched?.has(item.ref.kind) === true
        || [item.label, item.ref.key, kindName(item.ref.kind)].some((text) => text.toLocaleLowerCase(locale).includes(q));
    // A zone's items the search keeps, its nested zones' among them.
    const kept = (node: NavZone): number => node.items.filter(matches).length + node.children.reduce((n, child) => n + kept(child), 0);
    const zonesOf = (nodes: readonly NavZone[]): IndexEntry[] => [...nodes].sort((a, b) => byLabel(a.zone, b.zone)).map((node) => ({ kind: "zone", node }));
    const itemsOf = (items: readonly DrawnItem[]): IndexEntry[] => [...items].sort(byLabel).map((item) => ({ kind: "item", item }));
    const rows: IndexRow[] = [];
    // One level's rows: the ones the search keeps, each with its place among them, an open zone's own under it.
    const level = (entries: readonly IndexEntry[], depth: number) => {
        const listed = entries.filter((entry) => (entry.kind === "item" ? matches(entry.item) : !searching || kept(entry.node) > 0));
        listed.forEach((entry, i) => {
            const place = { position: i + 1, siblings: listed.length };
            if (entry.kind === "item") {
                rows.push({ kind: "item", item: entry.item, depth, ...place });
                return;
            }
            const { node } = entry;
            const isOpen = searching || open.has(node.zone.key);
            const count = options.whole === undefined || options.whole(node.zone.key) ? countOf(node) : undefined;
            rows.push({ kind: "zone", zone: node.zone, depth, open: isOpen, branch: node.items.length > 0 || node.children.length > 0 || count === undefined, count, ...place });
            // An open zone: its own items, then its nested zones.
            if (isOpen) level([...itemsOf(node.items), ...zonesOf(node.children)], depth + 1);
        });
    };
    // The top: the zones in none, then the items in no zone.
    level([...zonesOf(tree.roots), ...itemsOf(tree.floor)], 0);
    return rows;
}

/** A box in world units. */
export interface WorldBox {
    readonly minX: number;
    readonly minY: number;
    readonly maxX: number;
    readonly maxY: number;
}

/** The view the canvas reports: its window on the world, and whether the whole drawing is in it. */
export interface IndexViewport {
    /** The window, in world units. */
    readonly box: WorldBox;
    /** Whether the camera is at its fit, the whole drawing in view: no zone is in view then. */
    readonly fitted: boolean;
}

/** A zone takes the view from none at this score; holds it at this; and a challenger must beat it by this margin. */
const ENTER = 0.3, STAY = 0.18, MARGIN = 0.15;

/**
 * The zone the viewport is in (see the module docs).
 *
 * @param zones - The zones drawn — a hatched one is an annotation, never in view
 * @param view - The canvas's view; `undefined` before it reports one
 * @param prev - The zone in view before
 * @returns The zone's key; `undefined` for none
 */
export function zoneInView(zones: readonly DrawnZone[], view: IndexViewport | undefined, prev: string | undefined): string | undefined {
    if (view === undefined || view.fitted) return undefined;
    const { box } = view;
    const viewArea = Math.max(0, box.maxX - box.minX) * Math.max(0, box.maxY - box.minY);
    if (viewArea === 0) return undefined;
    // How much of the view a zone covers.
    const scoreOf = (z: DrawnZone): number => {
        const ix = Math.max(0, Math.min(box.maxX, z.x + z.width) - Math.max(box.minX, z.x));
        const iy = Math.max(0, Math.min(box.maxY, z.y + z.height) - Math.max(box.minY, z.y));
        return (ix * iy) / viewArea;
    };
    const hosts = zones.filter((z) => z.pattern.type === "outline");
    let best: DrawnZone | undefined;
    let bestScore = 0;
    for (const z of hosts) {
        const score = scoreOf(z);
        // Of two zones covering as much of the view, the smaller: a cage before its hall.
        if (score > bestScore || (score === bestScore && best !== undefined && z.width * z.height < best.width * best.height)) { best = z; bestScore = score; }
    }
    if (prev !== undefined) {
        const holder = hosts.find((z) => stringEqual(z.key, prev));
        const held = holder === undefined ? 0 : scoreOf(holder);
        if (held >= STAY && ((best !== undefined && stringEqual(best.key, prev)) || bestScore < held + MARGIN)) return prev;
    }
    return bestScore >= ENTER ? best?.key : undefined;
}
