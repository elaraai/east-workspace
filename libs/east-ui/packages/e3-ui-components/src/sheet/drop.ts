/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

/**
 * The sheet's drops (#1187, `Sheet Builder Spec.md` §9.8, §10; SB38–SB40,
 * SB44, SB45, SB61): what a builder's library cards and the rows' own grips
 * do where they land, decided as data before anything is drawn or written.
 *
 * - **Where a drag rests** is a row of the row space — a flat row, a loose
 *   row, a group's line, its band, its blank line, or the blank tail — which
 *   the shared drag grammar's `CellRef` names by {@link SheetDropRowType},
 *   printed, its `slot` the seam the pointer's half picks (`before` /
 *   `after`), or `""` for the row itself, where an author's card lands.
 * - **What a drop does** ({@link planDrop}): a template inserted at the seam,
 *   as the seam's own chips insert, seeded by the template (SB39, SB40); a
 *   card's cells set on the row, or on the band (SB61); a row, a line or a
 *   group moved to the seam (SB44); nothing, where the row already stands; or
 *   refused, with the reason the ghost says in red.
 * - **Its words** ({@link dropCaption}, {@link dropName}): the place it lands
 *   — `after row 3`, `→ row 3` — or why it can't, in the sheet's words.
 *
 * Pure: no React, no DOM. The sheet's core hands it the rows as they stand
 * ({@link SheetDropContext}), and runs a plan as one transaction.
 *
 * @packageDocumentation
 */

import { NullType, StringType, StructType, VariantType, parseFor, printFor, variant, type ValueTypeOf } from "@elaraai/east";
import type { CellCoord, DragPayload, DropCellOptions, DropVeto } from "@elaraai/east-ui-components";
import { TITLE_KEY, lineId, type SheetBodyItem, type SheetColumnMeta } from "./model.js";
import { groupInsertionSide, insertsLoose, type InsertRequest, type InsertionAnchor } from "./insertion-gesture.js";
import type { SheetDropPlaceWord, SheetDropRefusalWord } from "./messages.js";
import type { SheetSeeds } from "./use-editing.js";
import type { SheetCellValue, SheetNounValue, SheetRowValue } from "./values.js";
import type { SheetWords } from "./words.js";

// ── Where a drag rests ────────────────────────────────────────────────────

/** A row of the row space a drag rests on — what a sheet's drop `CellRef` names in its `row`, printed. */
export const SheetDropRowType = VariantType({
    /** A flat row — or a loose row between the groups (#846) — by its id. */
    row: StringType,
    /** A group's line: its group's id, and its key among the group's lines. */
    line: StructType({ group: StringType, key: StringType }),
    /** A group's band, by its group's id. */
    band: StringType,
    /** A group's blank line, by its group's id: a new line at the group's end. */
    groupEnd: StringType,
    /** The blank tail under a flat sheet's rows. */
    end: NullType,
});

/** A row a drag rests on, decoded. */
export type SheetDropRow = ValueTypeOf<typeof SheetDropRowType>;

/** A drop's row as its `CellRef` carries it. */
export const printDropRow: (row: SheetDropRow) => string = printFor(SheetDropRowType);

const parseDropRow = parseFor(SheetDropRowType);

/**
 * The row a drop's `CellRef` names.
 *
 * @param text - The `CellRef`'s `row`
 * @returns The row, or `undefined` when the text names none — a coordinate another surface made
 */
export function readDropRow(text: string): SheetDropRow | undefined {
    const read = parseDropRow(text);
    return read.success ? read.value : undefined;
}

/** A seam's side of a row. */
export type SheetDropSide = "before" | "after";

// ── What is dragged ───────────────────────────────────────────────────────

/** A template the builder offers to drop (SB39, SB40): its name, whether it makes a row or a group, and the seeds its new entry takes. */
export interface SheetDropTemplate {
    /** The template's name — the card's. */
    name: string;
    /** A row (a grouped sheet's line), or a group with its lines. */
    kind: "row" | "group";
    /** `newRow`'s or `newGroup`'s seed, the template's fields over its defaults: what the new entry starts as. */
    seeds: SheetSeeds;
}

/** An author's card that drops (SB61): its label, and the cells its `drop` patch sets. */
export interface SheetDropCard {
    /** The card's label. */
    label: string;
    /** The cells the patch sets, by the column key (a band's: the band cell's). */
    sets: ReadonlyMap<string, SheetCellValue>;
}

/** What the host lets the sheet take, and from where (#1187): a builder's library and the rows' grips. */
export interface SheetDropHost {
    /** The sheet's drop target: the surface its rows register on. */
    surface: string;
    /** The templates' library, and the templates by key — `undefined` when the builder lists no Rows tab. */
    templates: { library: string; byKey: ReadonlyMap<string, SheetDropTemplate> } | undefined;
    /** Each author's tab that drops, by its library: where its cards land, and its cards by key. */
    tabs: ReadonlyMap<string, { lands: "row" | "group"; cards: ReadonlyMap<string, SheetDropCard> }>;
}

/** What is dragged, as the sheet reads it: a template, a card, or one of its own rows. */
export type SheetDropSource =
    | { kind: "template"; template: SheetDropTemplate }
    | { kind: "card"; card: SheetDropCard; lands: "row" | "group" }
    | { kind: "move"; row: SheetDropRow };

/**
 * A library card, as the sheet reads it.
 *
 * @param host - What the host offers
 * @param library - The card's library
 * @param key - The card's key
 * @returns The template or the card, or `undefined` when the host offers none by that key
 */
export function cardSource(host: SheetDropHost, library: string, key: string): SheetDropSource | undefined {
    if (host.templates !== undefined && host.templates.library === library) {
        const template = host.templates.byKey.get(key);
        return template === undefined ? undefined : { kind: "template", template };
    }
    const tab = host.tabs.get(library);
    const card = tab?.cards.get(key);
    return tab === undefined || card === undefined ? undefined : { kind: "card", card, lands: tab.lands };
}

/**
 * What a drag carries, as the sheet reads it.
 *
 * @param host - What the host offers
 * @param payload - What the drag carries
 * @returns A library card, or one of the sheet's rows; `undefined` for anything else
 */
export function payloadSource(host: SheetDropHost, payload: DragPayload): SheetDropSource | undefined {
    if (payload.kind === "item") return cardSource(host, payload.from.library, payload.from.key);
    if (payload.kind !== "event") return undefined;
    const row = readDropRow(payload.from.row);
    return row === undefined ? undefined : { kind: "move", row };
}

/**
 * The slot a drag picks over a row: the row itself for an author's card, else
 * the seam the pointer's half is nearer.
 *
 * @param host - What the host offers
 * @param payload - What the drag carries
 * @param rect - The row's box
 * @param clientY - The pointer's height
 * @returns `""`, `before` or `after`
 */
export function slotAt(host: SheetDropHost, payload: DragPayload, rect: { top: number; height: number }, clientY: number): string {
    if (payloadSource(host, payload)?.kind === "card") return "";
    return clientY < rect.top + rect.height / 2 ? "before" : "after";
}

// ── What a drop does ──────────────────────────────────────────────────────

/** What a drop reads of the sheet as it stands. */
export interface SheetDropContext {
    /** The rows on screen, in order: a flat sheet's rows, a grouped sheet's groups and loose rows. */
    rows: readonly SheetRowValue[];
    /** The body item at a row-space index. */
    rowAt: (r: number) => SheetBodyItem | undefined;
    /** The row-space index of a row, a band or a line, by its id — a line's by its synthetic id. */
    rowOf: (id: string) => number | undefined;
    /** The row-space index of a group's blank line. */
    blankLineRowOf: (group: string) => number | undefined;
    /** The row-space index of a flat sheet's first blank padding row: its tail. */
    tailRow: number | undefined;
    /** The rows of the row space. */
    rowCount: number;
    /** Whether the rows are groups (#740). */
    grouped: boolean;
    /** Whether rows stand between the groups (#846). */
    loose: boolean;
    /** Whether the source sorts its entries by key. */
    keyed: boolean;
    /** Whether a gesture may be made now: the sheet is not read only, and its session takes one. */
    writable: boolean;
    /** What the sheet's `edits` let it do. */
    can: { insertRows: boolean; insertGroups: boolean; moveRows: "none" | "within" | "between"; moveGroups: boolean };
    /** The column a card's cell lands under — on a band, its band cell — by key: whether the sheet writes it, and its header. */
    columnAt: (band: boolean, key: string) => Pick<SheetColumnMeta, "editable" | "kind" | "header"> | undefined;
    /** Where an insertion at a row's seam goes: the seam chips' own anchor. */
    anchorFor: (r: number, side: SheetDropSide) => InsertionAnchor;
}

/** A drop's place: a seam beside a row of the row space, a group's start or end, the sheet's end, or a keyed source's key order. */
export type SheetDropPlace =
    | { at: "seam"; r: number; side: SheetDropSide }
    | { at: "groupStart" | "groupEnd"; r: number }
    | { at: "sheetEnd" }
    | { at: "keyOrder"; group: boolean };

/** The seam a drop marks: a row of the row space, and the edge of it the insertion line runs along. */
export interface SheetDropMark {
    r: number;
    edge: "top" | "bottom";
}

/** Why a drop is refused where it rests. */
export type SheetDropRefusal =
    /** The row it rests on, or the one it carries, has left the sheet. It says nothing. */
    | { why: "gone" }
    | { why: "readOnly" | "insertGroup" | "ontoBand" | "noGroupMove" | "lineOut" }
    | { why: "insert" | "ontoRow" | "noMove"; line: boolean }
    | { why: "keyOrder"; group: boolean }
    | { why: "column"; header: string }
    /** A line moves only within its group: the group's band. */
    | { why: "within"; r: number };

/** What a drop does where it rests. */
export type SheetDropPlan =
    /** A template inserted where the seam's own chips would insert it, seeded by the template (SB39, SB40). */
    | { kind: "insert"; template: SheetDropTemplate; request: InsertRequest; place: SheetDropPlace; mark: SheetDropMark | undefined }
    /** A card's cells set on a row or a band (SB61). */
    | { kind: "set"; card: SheetDropCard; r: number }
    /** An entry — a flat or loose row, or a group with its lines — placed beside another, or at the end (SB44). */
    | { kind: "moveEntry"; id: string; to: { side: SheetDropSide; anchor: string } | "end"; place: SheetDropPlace; mark: SheetDropMark }
    /** A line moved within its group or into another (SB44): from its group and key, into a group at a slot of its lines as they stand. */
    | { kind: "moveLine"; from: { group: string; key: string }; to: { group: string; index: number }; place: SheetDropPlace; mark: SheetDropMark }
    /** The row is where the drop would put it: nothing moves. */
    | { kind: "stay"; place: SheetDropPlace; mark: SheetDropMark }
    | { kind: "refused"; why: SheetDropRefusal };

/** A row of the row space, and what stands there. */
interface At {
    r: number;
    item: SheetBodyItem;
}

const refused = (why: SheetDropRefusal): SheetDropPlan => ({ kind: "refused", why });
const seamMark = (r: number, side: SheetDropSide): SheetDropMark => ({ r, edge: side === "before" ? "top" : "bottom" });

/**
 * Where a drop's row stands now.
 *
 * @param row - The row
 * @param ctx - The sheet as it stands
 * @returns Its row-space index and its item, or `undefined` once it has left the sheet
 */
export function locateDrop(row: SheetDropRow, ctx: SheetDropContext): At | undefined {
    const r = row.type === "row" || row.type === "band" ? ctx.rowOf(row.value)
        : row.type === "line" ? ctx.rowOf(lineId(row.value.group, row.value.key))
            : row.type === "groupEnd" ? ctx.blankLineRowOf(row.value)
                : ctx.tailRow;
    const item = r === undefined ? undefined : ctx.rowAt(r);
    return r === undefined || item === undefined ? undefined : { r, item };
}

/**
 * The row a row-space item is, as a drop names it.
 *
 * @param item - The item
 * @returns Its drop row; `undefined` for what no drop rests on (a band of
 *   unloaded rows, a lens gap, a sub row, a proposal)
 */
export function dropRowOf(item: SheetBodyItem): SheetDropRow | undefined {
    switch (item.kind) {
        case "real": return item.group !== undefined ? variant("line", { group: item.group.row.id, key: item.group.key }) : variant("row", item.row.id);
        case "group": return variant("band", item.row.id);
        case "blank": return item.group !== undefined ? variant("groupEnd", item.group.row.id) : variant("end", null);
        default: return undefined;
    }
}

/**
 * What a drop does where it rests — see the module docs.
 *
 * @param source - What is dragged
 * @param row - The row it rests on
 * @param slot - The seam the pointer's half picks (`before` / `after`), or `""`, the row itself
 * @param ctx - The sheet as it stands
 * @returns What the drop does, or why it is refused
 */
export function planDrop(source: SheetDropSource, row: SheetDropRow, slot: string, ctx: SheetDropContext): SheetDropPlan {
    const at = locateDrop(row, ctx);
    if (at === undefined) return refused({ why: "gone" });
    if (!ctx.writable) return refused({ why: "readOnly" });
    const side: SheetDropSide = slot === "before" ? "before" : "after";
    switch (source.kind) {
        case "card": return planCard(source.card, source.lands, at, ctx);
        case "template": return source.template.kind === "group" ? planGroupTemplate(source.template, at, side, ctx) : planRowTemplate(source.template, at, side, ctx);
        case "move": return planMove(source.row, at, side, ctx);
    }
}

/**
 * What a card's ⏎ does (SB45): what a drop below the ring's row would — a
 * row template after it, a group template after its group, and a card on
 * the row itself.
 *
 * @param source - The card: a template, or an author's card
 * @param row - The ring's row
 * @param ctx - The sheet as it stands
 * @returns What the ⏎ does, or why it is refused there
 */
export function planBelow(source: SheetDropSource, row: SheetDropRow, ctx: SheetDropContext): SheetDropPlan {
    if (source.kind !== "template" || source.template.kind !== "group") return planDrop(source, row, source.kind === "card" ? "" : "after", ctx);
    const at = locateDrop(row, ctx);
    if (at === undefined) return refused({ why: "gone" });
    if (!ctx.writable) return refused({ why: "readOnly" });
    if (!ctx.grouped || !ctx.can.insertGroups) return refused({ why: "insertGroup" });
    // Below the ring's group — or the loose row it is on.
    const entry = entryOf(at, ctx);
    if (entry === undefined) return refused({ why: "gone" });
    const request: InsertRequest = { kind: "group", anchor: { entry: entry.id, side: "after" } };
    if (ctx.keyed) return { kind: "insert", template: source.template, request, place: { at: "keyOrder", group: true }, mark: undefined };
    return { kind: "insert", template: source.template, request, place: { at: "seam", r: entry.r, side: "after" }, mark: entry.after };
}

/** A card's cells set on a row, or on a band (SB61) — refused anywhere else, or where a cell it sets is read only. */
function planCard(card: SheetDropCard, lands: "row" | "group", at: At, ctx: SheetDropContext): SheetDropPlan {
    const band = at.item.kind === "group";
    if (lands === "group" ? !band : at.item.kind !== "real") return refused(lands === "group" ? { why: "ontoBand" } : { why: "ontoRow", line: ctx.grouped });
    for (const key of card.sets.keys()) {
        const meta = ctx.columnAt(band, key);
        if (meta === undefined || !meta.editable || meta.kind === "stamped") return refused({ why: "column", header: meta?.header ?? key });
    }
    return { kind: "set", card, r: at.r };
}

/**
 * A row template's insertion (SB39): where the seam's own row chip would
 * insert — beside the row it rests on by the pointer's half; at a group's
 * start on its band (a row before the group, beside loose rows, on the
 * band's top half); at its end on its blank line; at the sheet's end on the
 * blank tail. On a keyed source a new entry sits where its key sorts.
 */
function planRowTemplate(template: SheetDropTemplate, at: At, side: SheetDropSide, ctx: SheetDropContext): SheetDropPlan {
    if (!ctx.can.insertRows) return refused({ why: "insert", line: ctx.grouped });
    const { r, item } = at;
    // A band takes a line at its group's start, whatever the half — but beside loose rows its top half is a row before the group (#846).
    const anchorSide: SheetDropSide = item.kind === "group" && !(ctx.loose && side === "before") ? "after" : side;
    const anchor = ctx.anchorFor(r, anchorSide);
    const request: InsertRequest = { kind: "row", anchor };
    const entry = !ctx.grouped || (ctx.loose && insertsLoose(anchor, ctx.rows));
    if (entry && ctx.keyed) return { kind: "insert", template, request, place: { at: "keyOrder", group: false }, mark: undefined };
    if (item.kind === "blank") {
        return { kind: "insert", template, request, place: item.group !== undefined ? { at: "groupEnd", r } : { at: "sheetEnd" }, mark: { r, edge: "top" } };
    }
    if (item.kind === "group" && anchorSide === "after") return { kind: "insert", template, request, place: { at: "groupStart", r }, mark: { r, edge: "bottom" } };
    return { kind: "insert", template, request, place: { at: "seam", r, side: anchorSide }, mark: seamMark(r, anchorSide) };
}

/** A group template's insertion (SB40): at the seam between entries nearest where it rests, as the seam's group chip snaps. */
function planGroupTemplate(template: SheetDropTemplate, at: At, side: SheetDropSide, ctx: SheetDropContext): SheetDropPlan {
    if (!ctx.grouped || !ctx.can.insertGroups) return refused({ why: "insertGroup" });
    const seam = entrySeam(at, side, ctx);
    if (seam === undefined) return refused({ why: "gone" });
    const request: InsertRequest = { kind: "group", anchor: { entry: seam.id, side: seam.side } };
    if (ctx.keyed) return { kind: "insert", template, request, place: { at: "keyOrder", group: true }, mark: undefined };
    return { kind: "insert", template, request, place: { at: "seam", r: seam.r, side: seam.side }, mark: seam.mark };
}

/** A grip's move (SB44): a row's, a line's or a band's. */
function planMove(from: SheetDropRow, at: At, side: SheetDropSide, ctx: SheetDropContext): SheetDropPlan {
    const src = locateDrop(from, ctx);
    if (src === undefined) return refused({ why: "gone" });
    const item = src.item;
    if (item.kind === "group") {
        if (!ctx.can.moveGroups) return refused(ctx.keyed ? { why: "keyOrder", group: true } : { why: "noGroupMove" });
        const seam = entrySeam(at, side, ctx);
        if (seam === undefined) return refused({ why: "gone" });
        return entryMove(item.row.id, { side: seam.side, anchor: seam.id }, { at: "seam", r: seam.r, side: seam.side }, seam.mark, ctx);
    }
    if (item.kind !== "real") return refused({ why: "gone" });
    if (item.group !== undefined) return planLineMove(item.group.row.id, item.group.key, item.group.index, at, side, ctx);
    // A flat row, or a loose row between the groups (#846): an entry of its own.
    if (ctx.can.moveRows === "none") return refused({ why: "noMove", line: false });
    if (ctx.keyed) return refused({ why: "keyOrder", group: false });
    if (ctx.grouped) {
        // A loose row stays between the groups: it takes the seam between entries nearest where it rests.
        const seam = entrySeam(at, side, ctx);
        if (seam === undefined) return refused({ why: "gone" });
        return entryMove(item.row.id, { side: seam.side, anchor: seam.id }, { at: "seam", r: seam.r, side: seam.side }, seam.mark, ctx);
    }
    if (at.item.kind === "blank") return entryMove(item.row.id, "end", { at: "sheetEnd" }, { r: at.r, edge: "top" }, ctx);
    if (at.item.kind !== "real") return refused({ why: "gone" });
    return entryMove(item.row.id, { side, anchor: at.item.row.id }, { at: "seam", r: at.r, side }, seamMark(at.r, side), ctx);
}

/**
 * A line's move (SB44): beside another line by the pointer's half, at a
 * group's start on its band, at its end on its blank line — within its own
 * group only when `edits.moveRows` is `within`; never out of the groups.
 */
function planLineMove(group: string, key: string, index: number, at: At, side: SheetDropSide, ctx: SheetDropContext): SheetDropPlan {
    if (ctx.can.moveRows === "none") return refused({ why: "noMove", line: true });
    const { r, item } = at;
    let into: SheetRowValue;
    let slot: number;
    let place: SheetDropPlace;
    let mark: SheetDropMark;
    if (item.kind === "real" && item.group !== undefined) {
        into = item.group.row;
        slot = item.group.index + (side === "after" ? 1 : 0);
        place = { at: "seam", r, side };
        mark = seamMark(r, side);
    } else if (item.kind === "group") {
        into = item.row;
        slot = 0;
        place = { at: "groupStart", r };
        mark = { r, edge: "bottom" };
    } else if (item.kind === "blank" && item.group !== undefined) {
        into = item.group.row;
        slot = into.lines.length;
        place = { at: "groupEnd", r };
        mark = { r, edge: "top" };
    } else {
        // A loose row or the blank tail: a line stays in a group.
        return refused({ why: "lineOut" });
    }
    if (into.id !== group && ctx.can.moveRows === "within") return refused({ why: "within", r: ctx.rowOf(group) ?? r });
    // Its own slot, or the one just after it: it stays where it is.
    if (into.id === group && (slot === index || slot === index + 1)) return { kind: "stay", place, mark };
    return { kind: "moveLine", from: { group, key }, to: { group: into.id, index: slot }, place, mark };
}

/** An entry placed beside another, or at the end — or left where it stands, when that is already its place. */
function entryMove(id: string, to: { side: SheetDropSide; anchor: string } | "end", place: SheetDropPlace, mark: SheetDropMark, ctx: SheetDropContext): SheetDropPlan {
    const i = ctx.rows.findIndex((row) => row.id === id);
    if (to === "end") return i === ctx.rows.length - 1 ? { kind: "stay", place, mark } : { kind: "moveEntry", id, to, place, mark };
    const j = ctx.rows.findIndex((row) => row.id === to.anchor);
    if (j === i || (to.side === "before" && j === i + 1) || (to.side === "after" && j === i - 1)) return { kind: "stay", place, mark };
    return { kind: "moveEntry", id, to, place, mark };
}

/** The entry a row of the row space belongs to — a band's, a line's or a blank line's group, or a loose row — with its band's (or its own) index, and the seam below it. */
function entryOf(at: At, ctx: SheetDropContext): { id: string; r: number; after: SheetDropMark } | undefined {
    const { r, item } = at;
    if (item.kind === "real" && item.group === undefined) return { id: item.row.id, r, after: seamMark(r, "after") };
    const group = item.kind === "group" ? item.row : item.kind === "real" || item.kind === "blank" ? item.group?.row : undefined;
    if (group === undefined) return undefined;
    const band = ctx.rowOf(group.id);
    return band === undefined ? undefined : { id: group.id, r: band, after: belowGroup(band, group.id, ctx) };
}

/**
 * The seam between entries a group — dropped or moved — or a loose row lands
 * on, from where it rests: a loose row's own seam by the half; a band's top
 * half the seam above its group, and its bottom half the seam below it when
 * the group shows no lines (folded, or empty); a line, the nearer of its
 * group's two seams, as the seam's group chip snaps; the group's blank line,
 * the seam below it.
 */
function entrySeam(at: At, side: SheetDropSide, ctx: SheetDropContext): { id: string; r: number; side: SheetDropSide; mark: SheetDropMark } | undefined {
    const { r, item } = at;
    if (item.kind === "real" && item.group === undefined) return { id: item.row.id, r, side, mark: seamMark(r, side) };
    const entry = entryOf(at, ctx);
    if (entry === undefined) return undefined;
    let groupSide: SheetDropSide;
    if (item.kind === "group") groupSide = side === "after" && (item.folded || item.count === 0) ? "after" : "before";
    else if (item.kind === "blank") groupSide = "after";
    else if (item.kind === "real" && item.group !== undefined) groupSide = groupInsertionSide(item.group.row, { entry: entry.id, child: item.group.key, side });
    else return undefined;
    return { id: entry.id, r: entry.r, side: groupSide, mark: groupSide === "before" ? { r: entry.r, edge: "top" } : entry.after };
}

/** The seam below a group: the top of the row after its last line (or its blank line), else the bottom of its last. */
function belowGroup(band: number, id: string, ctx: SheetDropContext): SheetDropMark {
    let last = band;
    for (let k = band + 1; k < ctx.rowCount; k++) {
        const it = ctx.rowAt(k);
        if (it === undefined || !((it.kind === "real" || it.kind === "blank") && it.group?.row.id === id)) break;
        last = k;
    }
    return last + 1 < ctx.rowCount ? { r: last + 1, edge: "top" } : { r: last, edge: "bottom" };
}

// ── Its words ─────────────────────────────────────────────────────────────

/** A group's title, from its band's cell. */
function titleOf(group: SheetRowValue): string | undefined {
    const cell = group.cells.get(TITLE_KEY);
    return cell !== undefined && cell.type === "String" && cell.value !== "" ? cell.value : undefined;
}

/**
 * A row of the row space, in words — `row 3`, `line 2 of WO-2201 · Kitchen,
 * oak`, `order 1` — as the inspector names it.
 *
 * @param r - The row's index
 * @param ctx - The sheet as it stands
 * @param words - The sheet's words
 * @param noun - The word for a group
 * @returns The words; `""` for no row
 */
export function dropWhat(r: number, ctx: SheetDropContext, words: SheetWords, noun: SheetNounValue): string {
    const item = ctx.rowAt(r);
    const m = words.m;
    if (item === undefined) return "";
    if (item.kind === "group") return m.inspectorWhat({ what: "band", number: String(item.position + 1), title: titleOf(item.row), noun: noun.singular });
    if (item.kind === "blank" && item.group !== undefined) return m.inspectorWhat({ what: "band", number: String(item.position + 1), title: titleOf(item.group.row), noun: noun.singular });
    if ((item.kind === "real" || item.kind === "blank") && item.group !== undefined) {
        return m.inspectorWhat({ what: "line", number: String(item.group.number), title: titleOf(item.group.row), noun: noun.singular });
    }
    return m.inspectorWhat({ what: "row", number: String(item.kind === "real" || item.kind === "blank" ? item.position + 1 : r + 1), title: undefined, noun: noun.singular });
}

/** A place, as its words take it. */
function placeWord(place: SheetDropPlace, ctx: SheetDropContext, words: SheetWords, noun: SheetNounValue): SheetDropPlaceWord {
    switch (place.at) {
        case "seam": return { place: place.side, what: dropWhat(place.r, ctx, words, noun) };
        case "groupStart": return { place: "start", what: dropWhat(place.r, ctx, words, noun) };
        case "groupEnd": return { place: "end", what: dropWhat(place.r, ctx, words, noun) };
        case "sheetEnd": return { place: "sheetEnd" };
        case "keyOrder": return { place: "sorted", group: place.group, noun: noun.singular };
    }
}

/** A refusal, as its words take it — `undefined` for one that says nothing. */
function refusalWord(why: SheetDropRefusal, ctx: SheetDropContext, words: SheetWords, noun: SheetNounValue): SheetDropRefusalWord | undefined {
    switch (why.why) {
        case "gone": return undefined;
        case "readOnly": case "ontoBand": return { why: why.why };
        case "insertGroup": case "noGroupMove": return { why: why.why, nouns: noun.plural };
        case "lineOut": return { why: "lineOut", noun: noun.singular };
        case "insert": case "ontoRow": case "noMove": return { why: why.why, line: why.line };
        case "keyOrder": return { why: "keyOrder", group: why.group, nouns: noun.plural };
        case "column": return { why: "column", header: why.header };
        case "within": return { why: "within", what: dropWhat(why.r, ctx, words, noun) };
    }
}

/**
 * Why a plan is refused, as the words take it — what a card's ⏎ leaves in the
 * footer where it can't land (SB45).
 *
 * @param plan - The plan
 * @param ctx - The sheet as it stands
 * @param words - The sheet's words
 * @param noun - The word for a group
 * @returns The refusal's words; `undefined` for a plan that lands, or one refused without words
 */
export function dropRefusal(plan: SheetDropPlan, ctx: SheetDropContext, words: SheetWords, noun: SheetNounValue): SheetDropRefusalWord | undefined {
    return plan.kind === "refused" ? refusalWord(plan.why, ctx, words, noun) : undefined;
}

/**
 * What the ghost says of a plan (SB38, SB61): the place a drop lands —
 * `after row 3`, `at the start of order 2`, `→ row 3` for a card — or, red,
 * why it can't.
 *
 * @param plan - The plan
 * @param ctx - The sheet as it stands
 * @param words - The sheet's words
 * @param noun - The word for a group
 * @returns The caption; `undefined` when it says nothing
 */
export function dropCaption(plan: SheetDropPlan, ctx: SheetDropContext, words: SheetWords, noun: SheetNounValue): string | undefined {
    const m = words.m;
    switch (plan.kind) {
        case "set": return m.dropOnto({ what: dropWhat(plan.r, ctx, words, noun) });
        case "refused": {
            const word = refusalWord(plan.why, ctx, words, noun);
            return word === undefined ? undefined : m.dropRefused(word);
        }
        default: return m.dropPlace(placeWord(plan.place, ctx, words, noun));
    }
}

/**
 * Where a plan lands, as a screen reader hears the drag layer say it — `the
 * gap after row 3`, `row 3` for a card — or, refused, the row it rests on.
 *
 * @param plan - The plan
 * @param at - The row it rests on
 * @param ctx - The sheet as it stands
 * @param words - The sheet's words
 * @param noun - The word for a group
 * @returns The name
 */
export function dropName(plan: SheetDropPlan, at: number | undefined, ctx: SheetDropContext, words: SheetWords, noun: SheetNounValue): string {
    switch (plan.kind) {
        case "set": return dropWhat(plan.r, ctx, words, noun);
        case "refused": return at === undefined ? "" : dropWhat(at, ctx, words, noun);
        default: return words.m.dropPlaceName(placeWord(plan.place, ctx, words, noun));
    }
}

// ── A row's part ──────────────────────────────────────────────────────────

/**
 * What every row hands the drag layer, as a drop target and as a grip
 * (#1187): one object every row shares, held still while the sheet takes
 * drops, its functions reading the sheet as it stands.
 */
export interface SheetRowDrop {
    /** The surface the rows register on. */
    surface: string;
    /** The veto: whether the drop a candidate event makes lands. */
    canDrop: DropVeto;
    /** The slot a drag picks over a row, from its box and the pointer's height. */
    slotAt: (payload: DragPayload, rect: { top: number; height: number }, clientY: number) => string;
    /** What the ghost says over a row, and its name for the announcements. */
    options: Required<Pick<DropCellOptions, "caption" | "name">>;
    /** Told each time a drag rests over a row that takes it: the row's element, where it rests, and what is dragged — the seam line, or the row itself, lights. */
    hover: (el: HTMLElement, coord: CellCoord, payload: DragPayload) => void;
}
