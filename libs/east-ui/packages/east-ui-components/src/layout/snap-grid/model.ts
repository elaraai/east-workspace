/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

/**
 * The SnapGrid's editing model (#990) — pure: the rows the canvas lays out,
 * where a drag lands, how a span or a height snaps, and what each gesture does
 * to the tiles: the order of the rows' entries, and the fields it writes.
 *
 * A tile's place is the order of `data`: rows stack in the order their keys
 * first appear, and a row's tiles sit in the order the rows hold them. So a
 * move is a new order and a new row key, never a coordinate — and a gesture
 * moves only the tiles it touches, so every other tile keeps its order.
 *
 * @packageDocumentation
 */

/** The grid's columns. */
export const SNAP_GRID_COLUMNS = 12;
/** The least span a resize leaves a tile (L8). */
export const MIN_SPAN = 2;
/** The most tiles a row holds (L10). */
export const MAX_TILES = 6;
/** A tile joining a full row shrinks to the free columns when it keeps at least this many (L10). */
export const FIT_MIN_SPAN = 3;
/** A height drag snaps to this step, in px (L9). */
export const HEIGHT_STEP = 40;
/** ...or to another tile's bottom edge within this many px (L9). */
export const HEIGHT_SNAP = 16;
/** The greatest height a drag leaves a tile, in px (L9). */
export const MAX_HEIGHT = 960;
/** A row's top and bottom bands, where a drop makes a new row — at most this many px, and a quarter of the row. */
export const EDGE_BAND = 28;

/** One tile, as the canvas lays it out and edits it. */
export interface SnapGridTile {
    /** The cell's key — the tile's identity on the canvas. */
    key: string;
    /** Its row's identity — what the session and `Editing.apply` address it by. */
    id: string;
    /** The key of the row it sits in. */
    row: string;
    /** Its span, in columns. */
    span: number;
    /** Its height in px; `undefined` is its content's height. */
    height: number | undefined;
    /** The least height a height drag leaves it; `undefined` stops it at its content's height. */
    minHeight: number | undefined;
    /** Its name. */
    label: string;
}

/** A row of the canvas: its key and its tiles, in their order. */
export interface SnapGridRowModel {
    /** The row's key. */
    key: string;
    /** Its tiles, in their order. */
    tiles: SnapGridTile[];
}

/**
 * The tiles grouped into rows, the rows in the order their keys first appear.
 *
 * @param tiles - Every tile, in the order the rows hold them
 * @returns The rows
 */
export function rowsOf(tiles: readonly SnapGridTile[]): SnapGridRowModel[] {
    const rows: SnapGridRowModel[] = [];
    const at = new Map<string, number>();
    for (const tile of tiles) {
        let index = at.get(tile.row);
        if (index === undefined) {
            index = rows.length;
            at.set(tile.row, index);
            rows.push({ key: tile.row, tiles: [] });
        }
        rows[index]!.tiles.push(tile);
    }
    return rows;
}

/**
 * Where a drag lands: beside a tile — row `row`, before its tile at `pos`
 * (`pos` its tile count for the row's end) — or in a new row at gap `at`
 * (`0` above the first row, the row count below the last).
 */
export type SnapGridDrop =
    | { kind: "join"; row: number; pos: number }
    | { kind: "gap"; at: number };

/** What a drop comes to, for what is dragged: a place, no move at all, or a row with no room. */
export type SnapGridLanding =
    | { kind: "place"; drop: SnapGridDrop }
    | { kind: "noop" }
    | { kind: "full" };

/**
 * What a drop comes to for the tile `moving` — or for a new tile, when
 * `moving` is `undefined`.
 *
 * @param rows - The canvas's rows
 * @param drop - Where the drag rests
 * @param moving - The key of the tile being moved; `undefined` for a dropped card
 * @returns `noop` beside itself or around its own lone row, `full` for a row
 *   already holding {@link MAX_TILES} others, else the place
 */
export function landingOf(rows: readonly SnapGridRowModel[], drop: SnapGridDrop, moving: string | undefined): SnapGridLanding {
    if (drop.kind === "join") {
        const row = rows[drop.row];
        if (row === undefined) return { kind: "noop" };
        const j = moving === undefined ? -1 : row.tiles.findIndex((t) => t.key === moving);
        if (j >= 0) return drop.pos === j || drop.pos === j + 1 ? { kind: "noop" } : { kind: "place", drop };
        return row.tiles.length >= MAX_TILES ? { kind: "full" } : { kind: "place", drop };
    }
    if (moving !== undefined) {
        const r = rows.findIndex((row) => row.tiles.some((t) => t.key === moving));
        if (r >= 0 && rows[r]!.tiles.length === 1 && (drop.at === r || drop.at === r + 1)) return { kind: "noop" };
    }
    return { kind: "place", drop };
}

/** What one entry's fields become — its row, its span, its height (`null` is its content's height), its alignment. */
export interface SnapGridWrite {
    /** Its row key. */
    row?: string;
    /** Its span. */
    span?: number;
    /** Its height; `null` is its content's height. */
    height?: number | null;
    /** Where it sits in a taller row — `SnapGrid.Types.Align`'s case. */
    align?: "top" | "center" | "stretch";
}

/**
 * Where a request to put a tile in row `row`, counting from 1, lands (#996):
 * at the end of that row; in a new row after it when the row already holds
 * {@link MAX_TILES}; in a new row after the last when `row` is past it.
 *
 * @param rows - The canvas's rows
 * @param key - The tile's key
 * @param row - The row asked for, counting from 1
 * @returns The drop, or `undefined` when the tile already sits in that row
 */
export function rowDrop(rows: readonly SnapGridRowModel[], key: string, row: number): SnapGridDrop | undefined {
    const current = rows.findIndex((r) => r.tiles.some((t) => t.key === key));
    const target = Math.max(1, Math.floor(row)) - 1;
    if (target === current) return undefined;
    if (target >= rows.length) return { kind: "gap", at: rows.length };
    const into = rows[target]!;
    if (into.tiles.length >= MAX_TILES) return { kind: "gap", at: target + 1 };
    return { kind: "join", row: target, pos: into.tiles.length };
}

/** What a gesture does to the tiles. */
export interface SnapGridEdit {
    /** The rows' identities in their new order — the drafted collection's order. */
    order: string[];
    /** What each written entry's fields become, by identity. */
    writes: Map<string, SnapGridWrite>;
    /** The entries it placed — the tile it moved, or the one it added. */
    placed: string[];
}

/**
 * A key not among `taken`: `base-1`, `base-2`, … — a new row's key, a dropped
 * card's identity.
 *
 * @param base - What the key starts with
 * @param taken - The keys in use
 * @returns The first free key
 */
export function freshKey(base: string, taken: ReadonlySet<string>): string {
    for (let n = 1; ; n++) {
        const key = `${base}-${n}`;
        if (!taken.has(key)) return key;
    }
}

/**
 * The key a new row takes — the first `row-n` no row holds. A dropped card's
 * row is named before the card becomes a tile, and {@link placeTile} names a
 * moved tile's new row the same way, so the two agree.
 *
 * @param tiles - Every tile
 * @returns The key
 */
export function newRowKey(tiles: readonly SnapGridTile[]): string {
    return freshKey("row", new Set(tiles.map((t) => t.row)));
}

/**
 * The spans a row takes once a tile joins it (L10): nothing changes while its
 * spans fit in 12; otherwise the joining tile shrinks to the free columns if
 * that leaves it {@link FIT_MIN_SPAN} or more, and failing that every tile in
 * the row takes ⌊12 / n⌋, the remainder going one each from the left.
 *
 * @param row - The row's tiles, the joining one among them, in their order
 * @param joining - The joining tile's identity
 * @returns The spans that change, by identity
 */
export function fitRow(row: readonly SnapGridTile[], joining: string): Map<string, number> {
    const out = new Map<string, number>();
    const total = row.reduce((sum, t) => sum + t.span, 0);
    if (total <= SNAP_GRID_COLUMNS) return out;
    const tile = row.find((t) => t.id === joining);
    const others = total - (tile?.span ?? 0);
    if (tile !== undefined && SNAP_GRID_COLUMNS - others >= FIT_MIN_SPAN) {
        out.set(tile.id, SNAP_GRID_COLUMNS - others);
        return out;
    }
    const base = Math.floor(SNAP_GRID_COLUMNS / row.length);
    const rest = SNAP_GRID_COLUMNS - base * row.length;
    row.forEach((t, i) => {
        const span = base + (i < rest ? 1 : 0);
        if (span !== t.span) out.set(t.id, span);
    });
    return out;
}

/**
 * Put `tile` where `drop` says among `tiles` — moved, when it is one of them,
 * or added — and fit the row it joins.
 *
 * @param tiles - Every tile, in the order the rows hold them
 * @param tile - The tile placed — one of `tiles` to move it, or a new one
 * @param drop - Where it lands ({@link landingOf} gave a place)
 * @returns The new order and what it writes
 */
export function placeTile(tiles: readonly SnapGridTile[], tile: SnapGridTile, drop: SnapGridDrop): SnapGridEdit {
    const rows = rowsOf(tiles);
    const order = tiles.map((t) => t.id).filter((id) => id !== tile.id);
    const writes = new Map<string, SnapGridWrite>();
    const insert = (before: string | undefined, after: string | undefined): void => {
        const i = before !== undefined ? order.indexOf(before) : after !== undefined ? order.indexOf(after) + 1 : order.length;
        order.splice(i < 0 ? order.length : i, 0, tile.id);
    };
    if (drop.kind === "join") {
        const row = rows[drop.row]!;
        const own = row.tiles.findIndex((t) => t.id === tile.id);
        const others = row.tiles.filter((t) => t.id !== tile.id);
        // Its own row's positions count it: past itself, one fewer.
        const pos = own >= 0 && drop.pos > own ? drop.pos - 1 : drop.pos;
        if (pos < others.length) insert(others[pos]!.id, undefined);
        else insert(undefined, others[others.length - 1]?.id);
        const write: SnapGridWrite = tile.row !== row.key ? { row: row.key } : {};
        if (own < 0) {
            const joined = [...others];
            joined.splice(pos, 0, tile);
            const span = fitRow(joined, tile.id);
            for (const [id, s] of span) {
                if (id === tile.id) write.span = s;
                else writes.set(id, { span: s });
            }
        }
        writes.set(tile.id, write);
        return { order, writes, placed: [tile.id] };
    }
    // A new row: the tile keeps a row key of its own when it had one alone,
    // and takes a fresh one otherwise.
    const alone = rows.some((r) => r.key === tile.row && r.tiles.length === 1 && r.tiles[0]!.id === tile.id);
    const rowKey = alone ? tile.row : newRowKey(tiles);
    const below = rows[drop.at]?.tiles.find((t) => t.id !== tile.id);
    insert(below?.id, undefined);
    writes.set(tile.id, tile.row !== rowKey ? { row: rowKey } : {});
    return { order, writes, placed: [tile.id] };
}

/**
 * A tile's span held to what its row has room for (L8): at least
 * {@link MIN_SPAN}, at most 12 less the row's other spans.
 *
 * @param tiles - Every tile
 * @param key - The tile's key
 * @param span - The span asked for
 * @returns The span it takes
 */
export function heldSpan(tiles: readonly SnapGridTile[], key: string, span: number): number {
    const tile = tiles.find((t) => t.key === key);
    if (tile === undefined) return span;
    const others = tiles.filter((t) => t.row === tile.row && t.key !== key).reduce((sum, t) => sum + t.span, 0);
    return Math.max(MIN_SPAN, Math.min(SNAP_GRID_COLUMNS - others, Math.round(span)));
}

/**
 * The span a right-edge drag rests on (L8), from where the pointer is: its
 * columns come from the row's width, its gaps and the zoom, all in client px.
 *
 * @param pointer - The pointer's x, in client px
 * @param left - The tile's left edge, in client px
 * @param rowWidth - The row's width, in client px
 * @param gap - The gap between columns, in client px
 * @returns The span under the pointer (not yet held to the row)
 */
export function spanAt(pointer: number, left: number, rowWidth: number, gap: number): number {
    const column = (rowWidth - (SNAP_GRID_COLUMNS - 1) * gap) / SNAP_GRID_COLUMNS;
    return Math.round((pointer - left + gap) / (column + gap));
}

/** Where a bottom-edge drag rests (L9): the height, `null` for the content's own, and the edge it snapped to. */
export interface SnapGridHeightRest {
    /** The height; `null` is the content's own. */
    height: number | null;
    /** The sibling edge it snapped to, in px from the row's top — the guide's place. */
    guide: number | undefined;
}

/**
 * The height a bottom-edge drag rests on (L9): a {@link HEIGHT_STEP} step, or
 * another tile's bottom edge in the row within {@link HEIGHT_SNAP}px. A tile
 * with a least height shrinks to it and returns to its content's height near
 * that; any other stops at its content's height. Never past {@link MAX_HEIGHT}.
 *
 * @param raw - The height the pointer asks for, in px
 * @param natural - The tile's content's height, in px
 * @param minHeight - Its least height, when it has one
 * @param siblings - The other tiles' bottom edges in the row, in px from its top
 * @returns The height and the edge it snapped to
 */
export function heightAt(raw: number, natural: number, minHeight: number | undefined, siblings: readonly number[]): SnapGridHeightRest {
    const floor = minHeight ?? natural;
    const near = siblings
        .filter((v) => v >= floor - 0.5 && Math.abs(raw - v) <= HEIGHT_SNAP)
        .sort((a, b) => Math.abs(raw - a) - Math.abs(raw - b))[0];
    if (near !== undefined) return { height: Math.abs(near - natural) < 1 ? null : Math.round(near), guide: Math.round(near) };
    const snapped = Math.round(raw / HEIGHT_STEP) * HEIGHT_STEP;
    if (minHeight !== undefined) {
        return { height: Math.abs(raw - natural) < HEIGHT_SNAP ? null : Math.max(minHeight, Math.min(MAX_HEIGHT, snapped)), guide: undefined };
    }
    return { height: snapped <= natural + 8 ? null : Math.min(MAX_HEIGHT, snapped), guide: undefined };
}

/** A box, in client px. */
export interface SnapGridBox {
    left: number;
    top: number;
    width: number;
    height: number;
}

/**
 * Where a drag resting over row `row` lands (the builder's hit bands): its top
 * band is the gap above it, its bottom band the gap below, and between them
 * it lands beside the tile whose middle the pointer has not passed — at the
 * row's end past the last.
 *
 * @param row - The row's index
 * @param box - The row's box
 * @param tiles - Its tiles' boxes, in their order
 * @param x - The pointer's x
 * @param y - The pointer's y
 * @returns The drop
 */
export function dropAt(row: number, box: SnapGridBox, tiles: readonly SnapGridBox[], x: number, y: number): SnapGridDrop {
    const band = Math.min(EDGE_BAND, box.height / 4);
    if (y < box.top + band) return { kind: "gap", at: row };
    if (y > box.top + box.height - band) return { kind: "gap", at: row + 1 };
    const pos = tiles.findIndex((t) => x < t.left + t.width / 2);
    return { kind: "join", row, pos: pos < 0 ? tiles.length : pos };
}

/**
 * Where a keyboard drag may rest along a row: the boundary before each tile,
 * and after the last — each resolving, through {@link dropAt}, to that place.
 *
 * @param tiles - The row's tiles' boxes, in their order
 * @param gap - The gap between tiles, in client px
 * @returns The stops' x, in client px
 */
export function joinStops(tiles: readonly SnapGridBox[], gap: number): number[] {
    if (tiles.length === 0) return [];
    const stops = tiles.map((t) => t.left - gap / 2);
    const last = tiles[tiles.length - 1]!;
    stops.push(last.left + last.width + gap / 2);
    return stops;
}

/**
 * The column a tile starts at in its row — 1 plus the spans before it.
 *
 * @param row - Its row's tiles
 * @param key - The tile's key
 * @returns Its first column
 */
export function startColumn(row: readonly SnapGridTile[], key: string): number {
    let start = 1;
    for (const t of row) {
        if (t.key === key) return start;
        start += t.span;
    }
    return start;
}

/**
 * The tile the arrow keys move the selection to (L15): left and right step
 * through the tiles in reading order; up and down to the row above or below,
 * onto the tile whose columns lie nearest the selected one's middle.
 *
 * @param rows - The canvas's rows
 * @param key - The selected tile's key
 * @param arrow - The arrow
 * @returns The tile's key, or `undefined` when there is none that way
 */
export function neighbourOf(rows: readonly SnapGridRowModel[], key: string, arrow: "left" | "right" | "up" | "down"): string | undefined {
    const flat = rows.flatMap((r) => r.tiles);
    const i = flat.findIndex((t) => t.key === key);
    if (i < 0) return undefined;
    if (arrow === "left") return flat[i - 1]?.key;
    if (arrow === "right") return flat[i + 1]?.key;
    const r = rows.findIndex((row) => row.tiles.some((t) => t.key === key));
    const target = rows[arrow === "up" ? r - 1 : r + 1];
    if (target === undefined) return undefined;
    const tile = flat[i]!;
    const middle = startColumn(rows[r]!.tiles, key) + tile.span / 2;
    let best: { key: string; distance: number } | undefined;
    for (const t of target.tiles) {
        const distance = Math.abs(startColumn(target.tiles, t.key) + t.span / 2 - middle);
        if (best === undefined || distance < best.distance) best = { key: t.key, distance };
    }
    return best?.key;
}
