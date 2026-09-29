/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

/**
 * The SnapGrid's editing session (#990) — the session every editable collection
 * shares (`useEditSession`, #879), over the SnapGrid's rows.
 *
 * A gesture writes the rows it changes, whole — a tile's row, span or height —
 * and PLACES the rows it moves: a tile's place is the order of `data`. Every
 * placed row states its place against the order the drafts leave, restated at
 * each gesture while it stays placed, and the session applies placements
 * anchors first, so Apply leaves exactly the order the canvas shows. The
 * canvas draws the drafted rows through the same `Editing.apply` Apply runs
 * (`EditSession.applied`), so a draft looks exactly as Apply will leave it.
 *
 * @packageDocumentation
 */

import { useCallback, useMemo, useRef } from "react";
import {
    ArrayType, OptionType, decodeBeast2For, encodeBeast2For, equalFor, fromEastTypeValue, none, some, variant,
} from "@elaraai/east";
import { EditingPlacementType } from "@elaraai/east-ui/internal";
import { useEditSession, type EditingValue } from "../../editing/use-edit-session.js";
import type { EditSession, EditSessionBinding, EntryUpdate, EntryVersion, Origin, Placement } from "../../editing/session.js";
import { kindOfIssue, wholeEntryReadiness } from "../../editing/draft.js";
import type { HistoryAction } from "../../editing/HistoryBar.js";
import {
    heldSpan, landingOf, newRowKey, freshKey, placeTile, rowsOf,
    type SnapGridDrop, type SnapGridEdit, type SnapGridTile, type SnapGridWrite,
} from "./model.js";
import type { SnapGridCellValue, SnapGridValue } from "./index.js";

/** One row as the session holds it — its identity. */
export interface SnapGridEntryRef {
    /** The row's identity — its `edit.key` field. */
    readonly id: string;
}

/** A drafted tile's mark — the Sheet's (#879). */
export type SnapGridDraftMark = "pending" | "incomplete" | "invalid";

/** A row, decoded — a struct of the author's fields. */
type Entry = Record<string, unknown>;

/** What {@link useSnapGridEditing} hands the canvas. */
export interface SnapGridEditing {
    /** The session — the history item reads it. */
    session: EditSession<SnapGridEntryRef>;
    /** Whether a gesture can be drafted now: a base observed, the session writable. */
    available: boolean;
    /** The session's version — moves with every change to it. */
    version: number;
    /** The cells the canvas draws — the drafts in place. */
    cells: readonly SnapGridCellValue[];
    /** The tiles, in the drafted rows' order. */
    tiles: readonly SnapGridTile[];
    /** Whether a card lands — the author gave `edit.create`. */
    creates: boolean;
    /** Whether a tile's height is edited — `edit.height` names a field. */
    heights: boolean;
    /** Each drafted tile's mark, by its key. */
    marks: ReadonlyMap<string, SnapGridDraftMark>;
    /** Move a tile to a drop. Stable. @returns Whether it was drafted */
    move(key: string, drop: SnapGridDrop): boolean;
    /** Add a card's new row at a drop. Stable. @returns Whether it was drafted */
    add(card: { library: string; key: string }, drop: SnapGridDrop): boolean;
    /** Set a tile's span, held to its row's room. Stable. @returns Whether it was drafted */
    resize(key: string, span: number): boolean;
    /** Set a tile's height — `null` its content's own. Stable. @returns Whether it was drafted */
    height(key: string, height: number | null, span?: number): boolean;
    /** Remove a tile. Stable. @returns Whether it was drafted */
    remove(key: string): boolean;
    /** A history item action. Stable. */
    action(action: HistoryAction): void;
}

const placementEqual = equalFor(OptionType(EditingPlacementType));
const NO_MARKS: ReadonlyMap<string, SnapGridDraftMark> = new Map();
const idOfRef = (ref: SnapGridEntryRef): string => ref.id;

/**
 * The SnapGrid's editing session, its drafted cells and its gestures.
 *
 * @param value - The SnapGrid's value, its `editing` declared
 * @param storageKey - The view's key
 * @returns The session, what the canvas draws, and the gestures
 */
export function useSnapGridEditing(value: SnapGridValue, storageKey: string): SnapGridEditing {
    const editing = value.editing.type === "some" ? value.editing.value : undefined;
    if (editing === undefined) throw new Error("SnapGrid: the editing canvas needs its editing declaration");
    const fields = editing.fields;
    const codec = useMemo(() => {
        const rowsType = ArrayType(fromEastTypeValue(editing.entryType));
        return {
            encode: encodeBeast2For(editing.entryType),
            equal: equalFor(editing.entryType),
            decodeEntry: decodeBeast2For(editing.entryType),
            encodeRows: encodeBeast2For(rowsType),
            decodeRows: decodeBeast2For(rowsType),
        };
    }, [editing.entryType]);
    const idOf = useCallback((row: Entry): string => row[fields.key] as string, [fields.key]);

    // ── The source's rows — the base every batch checks ─────────────────
    const rows = useMemo(
        () => (editing.snapshot.type === "some" ? codec.decodeRows(editing.snapshot.value) as Entry[] : []),
        [editing.snapshot, codec]);
    const refs = useMemo(() => rows.map((row): SnapGridEntryRef => ({ id: idOf(row) })), [rows, idOf]);
    const positions = useMemo(() => rows.map((_row, i) => i), [rows]);

    // ── The author's check, over the rows a draft changed ───────────────
    const sessionRef = useRef<EditSession<SnapGridEntryRef> | undefined>(undefined);
    const ready = useMemo<EditSessionBinding<SnapGridEntryRef>["ready"]>(() => {
        const check = editing.ready.type === "some" ? editing.ready.value : undefined;
        return check === undefined ? undefined : wholeEntryReadiness(check, () => sessionRef.current?.originals, codec);
    }, [editing.ready, codec]);

    const { session, observed, original, available, version } = useEditSession<SnapGridEntryRef>(
        editing as unknown as EditingValue, undefined, refs, positions, storageKey, { idOf: idOfRef, ready });
    sessionRef.current = session;

    // ── The drafted rows, and the cells they draw ───────────────────────
    const drafted = useMemo((): Entry[] => {
        if (session.pending === 0) return rows;
        const applied = session.applied() as Entry[] | undefined;
        return applied ?? rows;
        // The session is mutable; its version records each change.
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [session, version, rows]);
    const cells = useMemo((): readonly SnapGridCellValue[] => {
        if (drafted === rows) return value.cells;
        try {
            return editing.derive(codec.encodeRows(drafted)) as SnapGridCellValue[];
        } catch (err) {
            console.error("[SnapGrid] the drafted tiles could not be drawn:", err);
            return value.cells;
        }
    }, [drafted, rows, value.cells, editing, codec]);
    // A cell is its row's, in the same order: `derive` maps every row to its cell.
    const tiles = useMemo((): SnapGridTile[] => cells.map((cell, i) => ({
        key: cell.key,
        id: drafted[i] !== undefined ? idOf(drafted[i]!) : cell.key,
        row: cell.row,
        span: Number(cell.span),
        height: cell.height.type === "some" ? Number(cell.height.value) : undefined,
        minHeight: cell.minHeight.type === "some" ? Number(cell.minHeight.value) : undefined,
        label: cell.label.type === "some" ? cell.label.value : cell.key,
    })), [cells, drafted, idOf]);

    // ── The marks: a tile whose row a draft changed or placed ───────────
    const marks = useMemo((): ReadonlyMap<string, SnapGridDraftMark> => {
        if (session.pending === 0) return NO_MARKS;
        const readiness = session.readiness;
        const keyOf = new Map(tiles.map((t) => [t.id, t.key]));
        const out = new Map<string, SnapGridDraftMark>();
        for (const [id, now] of session.entries) {
            const key = keyOf.get(id);
            const was = session.originals.get(id);
            if (key === undefined || now.draft === undefined) continue;
            const same = was !== undefined && was.draft !== undefined
                && codec.equal((was.draft as { value: unknown }).value, (now.draft as { value: unknown }).value)
                && placementEqual(was.place, now.place);
            if (same) continue;
            // The row's OWN issues decide its mark — never another row's.
            const own = readiness.type !== "ready" ? readiness.value.filter((issue) => issue.entry === id) : [];
            out.set(key, readiness.type === "ready" || own.length === 0 ? "pending"
                : own.some((issue) => kindOfIssue(issue, readiness) === "invalid") ? "invalid" : "incomplete");
        }
        return out;
        // The session's entries and readiness move under its version.
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [session, version, tiles, codec]);

    // ── The gestures ─────────────────────────────────────────────────────
    /**
     * Record a gesture as one transaction: every row it writes or removes,
     * the rows it places, and every row placed before whose place moved with
     * it — each stated after the row before it in the order the gesture
     * leaves.
     */
    const record = (edit: SnapGridEdit, origin: Origin, label: string, removed?: string, added?: Entry): boolean => {
        if (observed === undefined || !session.writable) return false;
        session.observeBase(observed.base);
        const byId = new Map(drafted.map((row) => [idOf(row), row] as const));
        if (added !== undefined) byId.set(idOf(added), added);
        // The rows placed before: a draft stands elsewhere than its original.
        const placed = new Set(edit.placed);
        for (const [id, now] of session.entries) {
            if (now.draft !== undefined && !placementEqual(now.place, session.originals.get(id)?.place ?? none)) placed.add(id);
        }
        const touched = new Set([...edit.writes.keys(), ...placed, ...(removed !== undefined ? [removed] : [])]);
        const updates: EntryUpdate<SnapGridEntryRef>[] = [];
        for (const id of touched) {
            // A row the source does not hold — a card's — reads as absent.
            let before: EntryVersion<SnapGridEntryRef>;
            try { before = original(id); }
            catch (err) {
                console.error("[SnapGrid] a gesture's row could not be read:", err);
                return false;
            }
            if (id === removed) {
                updates.push({ id, before, after: { draft: undefined, wire: undefined, place: none } });
                continue;
            }
            const entry = byId.get(id);
            if (entry === undefined) continue;
            // The gesture's fields, written into the whole row.
            const next = { ...entry };
            const w = edit.writes.get(id);
            if (w?.row !== undefined) next[fields.row] = w.row;
            if (w?.span !== undefined) next[fields.span] = BigInt(w.span);
            if (w?.height !== undefined && fields.height.type === "some") {
                next[fields.height.value] = w.height === null ? none : some(BigInt(w.height));
            }
            // A placed row stands after the row before it in the order the gesture leaves.
            const at = edit.order.indexOf(id);
            const place: Placement = !placed.has(id) ? before.place
                : at <= 0 ? some(variant("ordered", variant("start", null)))
                    : some(variant("ordered", variant("after", edit.order[at - 1]!)));
            updates.push({ id, before, after: { draft: variant("value", next), wire: { id }, place } });
        }
        return updates.length > 0 && session.record(updates, origin, label);
    };
    const gestures = {
        move(key: string, drop: SnapGridDrop): boolean {
            const tile = tiles.find((t) => t.key === key);
            if (tile === undefined) return false;
            const landing = landingOf(rowsOf(tiles), drop, key);
            if (landing.kind !== "place") return false;
            return record(placeTile(tiles, tile, landing.drop), "move", `Move ${tile.label}`);
        },
        add(card: { library: string; key: string }, drop: SnapGridDrop): boolean {
            if (editing.create.type !== "some") return false;
            const landing = landingOf(rowsOf(tiles), drop, undefined);
            if (landing.kind !== "place") return false;
            const rowKey = drop.kind === "join" ? rowsOf(tiles)[drop.row]!.key : newRowKey(tiles);
            const id = freshKey(card.key, new Set(tiles.map((t) => t.id)));
            let entry: Entry;
            try { entry = codec.decodeEntry(editing.create.value(card, { key: id, row: rowKey })) as Entry; }
            catch (err) {
                console.error("[SnapGrid] a dropped card's row could not be built:", err);
                return false;
            }
            // A row whose identity another row holds would be that row.
            if (tiles.some((t) => t.id === idOf(entry))) {
                console.error(`[SnapGrid] edit.create returned a row whose ${fields.key} "${idOf(entry)}" another row holds — nothing was added`);
                return false;
            }
            entry = { ...entry, [fields.row]: rowKey };
            // Its tile is its own cell's: the key and the name the author maps it to.
            let cell: SnapGridCellValue | undefined;
            try { cell = (editing.derive(codec.encodeRows([entry])) as SnapGridCellValue[])[0]; }
            catch (err) {
                console.error("[SnapGrid] a dropped card's tile could not be drawn:", err);
                return false;
            }
            const label = cell?.label.type === "some" ? cell.label.value : card.key;
            const tile: SnapGridTile = {
                key: cell?.key ?? idOf(entry), id: idOf(entry), row: rowKey, span: Number(entry[fields.span] as bigint),
                height: undefined, minHeight: undefined, label,
            };
            const edit = placeTile(tiles, tile, landing.drop);
            // The new row is written whole: the row it lands in, and its fitted span.
            edit.writes.set(tile.id, { ...edit.writes.get(tile.id), row: rowKey });
            return record(edit, "drop", `Add ${label}`, undefined, entry);
        },
        resize(key: string, span: number): boolean {
            const tile = tiles.find((t) => t.key === key);
            if (tile === undefined) return false;
            const held = heldSpan(tiles, key, span);
            if (held === tile.span) return false;
            return record({ order: tiles.map((t) => t.id), writes: new Map([[tile.id, { span: held }]]), placed: [] },
                "resize", `Resize ${tile.label}`);
        },
        height(key: string, height: number | null, span?: number): boolean {
            const tile = tiles.find((t) => t.key === key);
            if (tile === undefined || fields.height.type !== "some") return false;
            const w: SnapGridWrite = {};
            if ((tile.height ?? null) !== height) w.height = height;
            if (span !== undefined) {
                const held = heldSpan(tiles, key, span);
                if (held !== tile.span) w.span = held;
            }
            if (w.height === undefined && w.span === undefined) return false;
            return record({ order: tiles.map((t) => t.id), writes: new Map([[tile.id, w]]), placed: [] },
                "resize", `Resize ${tile.label}`);
        },
        remove(key: string): boolean {
            const tile = tiles.find((t) => t.key === key);
            if (tile === undefined) return false;
            return record({ order: tiles.map((t) => t.id).filter((id) => id !== tile.id), writes: new Map(), placed: [] },
                "remove", `Remove ${tile.label}`, tile.id);
        },
        action(action: HistoryAction): void {
            if (action === "apply") void session.apply();
            else if (action === "refresh") session.refresh();
            else session[action]();
        },
    };
    // Stable to the canvas and the drag layer: each runs the latest render's.
    const current = useRef(gestures);
    current.current = gestures;
    const move = useCallback((key: string, drop: SnapGridDrop) => current.current.move(key, drop), []);
    const add = useCallback((card: { library: string; key: string }, drop: SnapGridDrop) => current.current.add(card, drop), []);
    const resize = useCallback((key: string, span: number) => current.current.resize(key, span), []);
    const height = useCallback((key: string, h: number | null, span?: number) => current.current.height(key, h, span), []);
    const remove = useCallback((key: string) => current.current.remove(key), []);
    const action = useCallback((a: HistoryAction) => current.current.action(a), []);

    return {
        session, available, version, cells, tiles, marks,
        creates: editing.create.type === "some",
        heights: fields.height.type === "some",
        move, add, resize, height, remove, action,
    };
}
