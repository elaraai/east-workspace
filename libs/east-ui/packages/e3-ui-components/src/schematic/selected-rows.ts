/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

/**
 * The selected rows of the kinds read by area (#1393, #1398, `Schematic
 * Builder Spec.md` §4.5, §9), read in a component of their own: what a
 * selection keeps of a row its kind's window no longer holds. A kind read by
 * area holds only its window, so a pan or a zoom takes a selected row off the
 * drawing while the row still stands where its record holds it: it stays
 * selected — the host's `onSelect` hears nothing of a camera's move — and
 * Details shows it, read by its key. It is let go only as a read proves it
 * gone — its record holds none of it, it has no position, or its kind's
 * narrowing leaves it out, asked of the row in one `within` a kind (D28) —
 * or as a layer hides or locks it (the frame's to say, by the row's layer).
 *
 * A row the window holds at the record's revision is the stored row itself:
 * kept as the window holds it, so a row the window then leaves is drawn for
 * Details at once, as it was, and read again by its key — every such row of a
 * kind in one request (`recordSliceRows`) — only once the revision moves. Its
 * narrowing is asked of it only once it is off the window, the window's own
 * rows being its narrowing's, each answer kept at the revision and the
 * narrowing. While a read or an answer is in flight, the row as last kept
 * stands in. Its drafts are the frame's: a drafted row draws, or is let go,
 * as its drafts say (`drafted.ts`).
 *
 * @packageDocumentation
 */

import { useCallback, useLayoutEffect, useRef } from "react";
import { StringType, equalFor, type ValueTypeOf } from "@elaraai/east";
import { RecordSliceWhereType, type RecordSliceBindType } from "@elaraai/east-ui/internal";
import { getSomeorUndefined, useTrackedEvaluation } from "@elaraai/east-ui-components";
import { recordSliceRevision, recordSliceRows, recordSliceWithin } from "@elaraai/east-ui-components/internal";
import { rowCodec } from "../shared/schedule/records.js";
import { sourcePart } from "../shared/schedule/visibility.js";
import { drawnItem, drawnZone, entityId, refOfId, type DrawnItem, type DrawnZone } from "./canvas/drawn.js";
import type { SchematicValue, SchematicWindowRows } from "./data.js";

/** A record Slice's narrowing, decoded. */
type Where = ValueTypeOf<typeof RecordSliceWhereType>;
/** A kind's source of the slice. */
type Part = ValueTypeOf<RecordSliceBindType>;

const sameWhere = equalFor(RecordSliceWhereType);
const stringEqual = equalFor(StringType);

/** The selected rows of the kinds read by area, as their stored rows draw them. */
export interface SchematicSelectedRows {
    /**
     * Each selected item of a kind read by area, by its id: as its stored row draws it — `null` for one a read proves
     * gone, one with no position, or one its narrowing leaves out, which the selection lets go of; absent while it is
     * first read.
     */
    readonly items: ReadonlyMap<string, DrawnItem | null>;
    /** Each selected zone of a kind read by area, by its id, as {@link SchematicSelectedRows.items}. */
    readonly zones: ReadonlyMap<string, DrawnZone | null>;
}

/** No selected row read. */
export const NO_SELECTED_ROWS: SchematicSelectedRows = { items: new Map(), zones: new Map() };

/** A row as the reader keeps it: its bytes at the revision they were read at, and the row decoded, once asked of a narrowing. */
interface Kept {
    readonly revision: string;
    readonly row: Uint8Array;
    value?: unknown;
}

/** One kind's narrowing's answers, at a revision and a narrowing. */
interface Answered {
    readonly revision: string;
    readonly where: Where;
    held: ReadonlyMap<string, boolean>;
}

/**
 * Which of some rows a narrowing holds: each answer kept at the kind's revision and narrowing, the rows not yet answered
 * asked in one request.
 *
 * @returns The answers, by key; `undefined` while the request is in flight
 */
function answersOf(kept: Map<string, Answered>, slot: string, part: Part, revision: string, where: Where,
    rows: readonly { readonly key: string; readonly row: unknown }[]): ReadonlyMap<string, boolean> | undefined {
    let answered = kept.get(slot);
    if (answered === undefined || !stringEqual(answered.revision, revision) || !sameWhere(answered.where, where)) {
        answered = { revision, where, held: new Map() };
        kept.set(slot, answered);
    }
    const held = answered.held;
    const asked = rows.filter(({ key }) => !held.has(key));
    if (asked.length === 0) return held;
    const answer = recordSliceWithin(part, where, asked);
    if (answer.type !== "some") return undefined;
    // Only the selected rows': a row let go takes its answer with it.
    const next = new Map(rows.flatMap(({ key }) => { const was = held.get(key); return was === undefined ? [] : [[key, was] as const]; }));
    asked.forEach(({ key }, i) => next.set(key, answer.value[i] === true));
    answered.held = next;
    return next;
}

/** Whether two reads say the same: each id the same entity, or the same `null`. */
function sameRows(a: SchematicSelectedRows, b: SchematicSelectedRows): boolean {
    const same = <E,>(x: ReadonlyMap<string, E | null>, y: ReadonlyMap<string, E | null>) => x.size === y.size && [...x].every(([id, e]) => y.has(id) && Object.is(y.get(id), e));
    return same(a.items, b.items) && same(a.zones, b.zones);
}

/** No kind read by area. */
const NO_AREAS: ReadonlySet<string> = new Set();

/** No row selected. */
const NO_IDS: readonly string[] = [];

/**
 * Reads the selected rows of the kinds read by area (see the module docs), handing the frame what it read only when that
 * moves.
 *
 * @param props - The payload, the kinds read by area, the selected entities' ids, the rows each kind's window holds, and
 *   where the rows go
 * @returns Nothing: it reads
 */
export function SchematicSelectedReader({ value, areas = NO_AREAS, selected = NO_IDS, windows, onRead }: {
    value: SchematicValue; areas?: ReadonlySet<string>; selected?: readonly string[]; windows: SchematicWindowRows;
    onRead: (rows: SchematicSelectedRows) => void;
}): null {
    // Each selected row as last kept, by its id; and each kind's narrowing's answers, by its slot.
    const kept = useRef(new Map<string, Kept>());
    const answers = useRef(new Map<string, Answered>());
    // What each kept row draws as, by its bytes: the same entity while they are.
    const drawn = useRef(new WeakMap<Uint8Array, DrawnItem | DrawnZone | null>());
    const read = useCallback((): SchematicSelectedRows => {
        const chrome = getSomeorUndefined(value.slice);
        const items = new Map<string, DrawnItem | null>();
        const zones = new Map<string, DrawnZone | null>();
        // A row no longer selected is let go of.
        const wanted = new Set(selected);
        for (const id of [...kept.current.keys()]) if (!wanted.has(id)) kept.current.delete(id);
        // The selected keys of each kind read by area, in the selection's order.
        const byKind = new Map<string, string[]>();
        for (const id of selected) {
            const ref = refOfId(id);
            if (ref === undefined || !areas.has(ref.kind)) continue;
            const keys = byKind.get(ref.kind);
            if (keys === undefined) byKind.set(ref.kind, [ref.key]);
            else keys.push(ref.key);
        }
        for (const [slot, keys] of byKind) {
            const item = value.items.find((kind) => stringEqual(kind.key, slot));
            const zone = item === undefined ? value.zones.find((kind) => stringEqual(kind.key, slot)) : undefined;
            const kind = item ?? zone;
            const part = sourcePart(chrome, slot);
            if (kind === undefined || part === undefined) continue;
            const codec = rowCodec(kind.rowType);
            const idOf = (key: string) => entityId({ kind: slot, key });
            // A row as its stored row draws it — the same entity while its bytes are.
            const put = (key: string, row: Uint8Array) => {
                let entity = drawn.current.get(row);
                if (entity === undefined) {
                    const ref = { kind: slot, key };
                    entity = (item !== undefined ? drawnItem(ref, item.read(row, key), undefined) : drawnZone(ref, zone!.read(row, key))) ?? null;
                    drawn.current.set(row, entity);
                }
                if (item !== undefined) items.set(idOf(key), entity as DrawnItem | null);
                else zones.set(idOf(key), entity as DrawnZone | null);
            };
            // Gone: let go of.
            const gone = (key: string) => {
                kept.current.delete(idOf(key));
                if (item !== undefined) items.set(idOf(key), null); else zones.set(idOf(key), null);
            };
            // In flight: the row as last kept stands in; one never kept is absent.
            const standIn = (key: string) => { const was = kept.current.get(idOf(key)); if (was !== undefined) put(key, was.row); };
            const revision = recordSliceRevision(part);
            if (revision.type !== "some") { keys.forEach(standIn); continue; }
            const window = windows.get(slot);
            const held = window !== undefined && stringEqual(window.revision, revision.value) ? window.rows : undefined;
            // The window holds it at the revision: the stored row itself, kept, the narrowing's as the window's every row is.
            const off: string[] = [];
            for (const key of keys) {
                const row = held?.get(key);
                if (row === undefined) { off.push(key); continue; }
                const was = kept.current.get(idOf(key));
                if (was === undefined || !Object.is(was.row, row.row) || !stringEqual(was.revision, revision.value)) kept.current.set(idOf(key), { revision: revision.value, row: row.row });
                put(key, row.row);
            }
            if (off.length === 0) continue;
            // Off the window: read by its key once the revision has moved from the one it was kept at, every such row in one request.
            const unread = off.filter((key) => { const was = kept.current.get(idOf(key)); return was === undefined || !stringEqual(was.revision, revision.value); });
            if (unread.length > 0) {
                const got = recordSliceRows(part, unread);
                if (got.type !== "some") { off.forEach(standIn); continue; }
                unread.forEach((key, i) => {
                    const row = got.value[i];
                    if (row === undefined || row.type !== "some") { gone(key); return; }
                    kept.current.set(idOf(key), { revision: revision.value, row: codec.encode(row.value), value: row.value });
                });
            }
            const present = off.filter((key) => kept.current.has(idOf(key)));
            // Asked of its narrowing, while one narrows the kind.
            const where = part.read().where;
            let narrowed: ReadonlyMap<string, boolean> | undefined;
            if (where.size > 0 && present.length > 0) {
                narrowed = answersOf(answers.current, slot, part, revision.value, where, present.map((key) => {
                    const was = kept.current.get(idOf(key))!;
                    if (was.value === undefined) was.value = codec.decode(was.row);
                    return { key, row: was.value };
                }));
                if (narrowed === undefined) { present.forEach(standIn); continue; }
            }
            for (const key of present) {
                if (narrowed?.get(key) === false) gone(key);
                else put(key, kept.current.get(idOf(key))!.row);
            }
        }
        return items.size === 0 && zones.size === 0 ? NO_SELECTED_ROWS : { items, zones };
    }, [value, areas, selected, windows]);
    const { result } = useTrackedEvaluation(read);
    const reported = useRef<SchematicSelectedRows>(NO_SELECTED_ROWS);
    useLayoutEffect(() => {
        // A read that fails reads as in flight: what was kept stands, and the frame's line says why the kind's read failed.
        if (!result.ok) return;
        const now = result.value;
        if (sameRows(reported.current, now)) return;
        reported.current = now;
        onRead(now);
    });
    return null;
}
