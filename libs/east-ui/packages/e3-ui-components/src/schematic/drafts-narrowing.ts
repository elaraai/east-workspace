/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

/**
 * Which drafted rows of a kind read by area its narrowing holds (#1393,
 * #1398, `Schematic Builder Spec.md` §10.3, SC23), read in a component of its
 * own, as the Calendar's shared cells reader asks it of its drafts: each
 * drafted row a gesture did not create told by the row its editing session
 * began from — what its record held when the session first read it — asked of
 * the kind's source's narrowing in one `within` a kind (D28), as the far ends
 * of the links that touch a window are. A kind read by area reads only its
 * window, so a drafted row its window doesn't hold — moved off it, or placed
 * from the Backlog — is drawn where its draft places it, and only this says
 * whether the narrowing holds it: hidden, one it leaves out waits in its
 * session, drawn nowhere; dimmed, it draws as context — as every kind's
 * drafted row does (`drafted.ts`, `narrowing.ts`). A row a gesture created is
 * neither: no stored row names it.
 *
 * Each row's answer is kept at its kind's revision and narrowing, so a gesture
 * asks only of the rows it adds; while nothing narrows a kind, the narrowing
 * holds every row, and nothing is asked. While a new narrowing's answers are
 * in flight, the last narrowing's stand in, and the reader says so (`busy`):
 * the frame keeps what it draws standing in, retained, until they land (CL8).
 * A row a gesture drafts under the narrowing that stands — drawn, so the
 * narrowing holds it — draws as the narrowing's until its answer lands.
 *
 * @packageDocumentation
 */

import { useCallback, useLayoutEffect, useRef } from "react";
import { StringType, equalFor, type ValueTypeOf } from "@elaraai/east";
import { RecordSliceWhereType, type RecordSliceBindType } from "@elaraai/east-ui/internal";
import { getSomeorUndefined, useTrackedEvaluation } from "@elaraai/east-ui-components";
import { recordSliceRevision, recordSliceWithin } from "@elaraai/east-ui-components/internal";
import { sourcePart } from "../shared/schedule/visibility.js";
import type { SchematicRef } from "./canvas/drawn.js";
import type { SchematicValue } from "./data.js";
import type { SchematicDrafts } from "./drafted.js";

/** A record Slice's narrowing, decoded. */
type Where = ValueTypeOf<typeof RecordSliceWhereType>;
/** A kind's source of the slice. */
type Part = ValueTypeOf<RecordSliceBindType>;

const sameWhere = equalFor(RecordSliceWhereType);
const stringEqual = equalFor(StringType);

/** Which drafted rows of the kinds read by area their narrowing holds. */
export interface SchematicDraftsNarrowing {
    /**
     * Each kind read by area's drafted rows a gesture did not create, by its slot then by key: whether its narrowing holds
     * each, by the row its session began from — every one, while nothing narrows it. A row whose answer is in flight is
     * absent.
     */
    readonly held: ReadonlyMap<string, ReadonlyMap<string, boolean>>;
    /** Whether a new narrowing's answers are in flight: the last narrowing's stand in meanwhile. */
    readonly busy: boolean;
}

/** No drafted row asked of any narrowing. */
export const NO_DRAFTS_NARROWING: SchematicDraftsNarrowing = { held: new Map(), busy: false };

/**
 * Whether a kind read by area's narrowing holds one of its drafted rows, as the reader answered (see the module docs).
 *
 * @param narrowing - What the reader answered
 * @param ref - The row's kind's slot and its key
 * @returns `true` held, `false` left out; `undefined` for a row not asked — one a gesture created, one of a kind read
 *   otherwise, or one whose answer is in flight
 */
export function draftHeld(narrowing: SchematicDraftsNarrowing, ref: SchematicRef): boolean | undefined {
    return narrowing.held.get(ref.kind)?.get(ref.key);
}

/** One kind's answers, at a revision and a narrowing. */
interface Answered {
    readonly revision: string;
    readonly where: Where;
    held: ReadonlyMap<string, boolean>;
}

/** What the reader keeps across reads, by each kind's slot: its answers now, and the last narrowing's every answer landed under. */
interface Kept {
    readonly now: Map<string, Answered>;
    readonly settled: Map<string, Answered>;
}

/**
 * Which of some rows a narrowing holds: each answer kept at the kind's revision and narrowing, the rows not yet answered
 * asked in one request.
 *
 * @returns The answers, by key; `undefined` while the request is in flight
 */
function answersOf(kept: Kept, slot: string, part: Part, revision: string, where: Where, rows: readonly { readonly key: string; readonly row: unknown }[]): ReadonlyMap<string, boolean> | undefined {
    let answered = kept.now.get(slot);
    if (answered === undefined || !stringEqual(answered.revision, revision) || !sameWhere(answered.where, where)) {
        answered = { revision, where, held: new Map() };
        kept.now.set(slot, answered);
    }
    const held = answered.held;
    const asked = rows.filter(({ key }) => !held.has(key));
    if (asked.length > 0) {
        const answer = recordSliceWithin(part, where, asked);
        if (answer.type !== "some") return undefined;
        // Only the drafted rows': a draft gone takes its answer with it.
        const next = new Map(rows.flatMap(({ key }) => { const was = held.get(key); return was === undefined ? [] : [[key, was] as const]; }));
        asked.forEach(({ key }, i) => next.set(key, answer.value[i] === true));
        answered.held = next;
    }
    return answered.held;
}

/** Whether two answers say the same, kind by kind and row by row. */
function sameAnswers(a: SchematicDraftsNarrowing, b: SchematicDraftsNarrowing): boolean {
    if (a.busy !== b.busy || a.held.size !== b.held.size) return false;
    for (const [slot, rows] of a.held) {
        const other = b.held.get(slot);
        if (other === undefined || other.size !== rows.size) return false;
        for (const [key, held] of rows) if (other.get(key) !== held) return false;
    }
    return true;
}

/** No kind read by area. */
const NO_AREAS: ReadonlySet<string> = new Set();

/**
 * Reads which drafted rows of the kinds read by area their narrowing holds (see the module docs), handing the frame what
 * it read only when that moves.
 *
 * @param props - The payload, the kinds read by area, the drafts, the row each drafted row's session began from — the
 *   editing's `held`: `undefined` for a row a gesture created — and where the answers go
 * @returns Nothing: it reads
 */
export function SchematicDraftsReader({ value, areas = NO_AREAS, drafts, original, onRead }: {
    value: SchematicValue; areas?: ReadonlySet<string>; drafts: SchematicDrafts; original: (slot: string, key: string) => unknown;
    onRead: (narrowing: SchematicDraftsNarrowing) => void;
}): null {
    const kept = useRef<Kept>({ now: new Map(), settled: new Map() });
    const read = useCallback((): SchematicDraftsNarrowing => {
        const chrome = getSomeorUndefined(value.slice);
        const held = new Map<string, ReadonlyMap<string, boolean>>();
        let busy = false;
        for (const kind of [...value.items, ...value.zones]) {
            const rows = drafts.items.get(kind.key) ?? drafts.zones.get(kind.key);
            const part = areas.has(kind.key) ? sourcePart(chrome, kind.key) : undefined;
            if (rows === undefined || rows.size === 0 || part === undefined) continue;
            // The row each began from: none for a row a gesture created, which is neither the narrowing's nor out of it.
            const began = [...rows.keys()].flatMap((key) => { const row = original(kind.key, key); return row === undefined ? [] : [{ key, row }]; });
            if (began.length === 0) continue;
            const where = part.read().where;
            // Nothing narrows the kind: the narrowing holds every row.
            if (where.size === 0) {
                held.set(kind.key, new Map(began.map(({ key }) => [key, true] as const)));
                continue;
            }
            const revision = recordSliceRevision(part);
            const answers = revision.type === "some" ? answersOf(kept.current, kind.key, part, revision.value, where, began) : undefined;
            if (answers !== undefined) {
                kept.current.settled.set(kind.key, kept.current.now.get(kind.key)!);
                held.set(kind.key, answers);
                continue;
            }
            // In flight: the narrowing's last answers stand in — a new narrowing's said to be read — and, under the narrowing
            // that stands, a row not yet answered draws as the narrowing's.
            const settled = kept.current.settled.get(kind.key);
            if (settled === undefined) continue;
            if (!sameWhere(settled.where, where)) busy = true;
            held.set(kind.key, settled.held);
        }
        return held.size === 0 && !busy ? NO_DRAFTS_NARROWING : { held, busy };
    }, [value, areas, drafts, original]);
    const { result } = useTrackedEvaluation(read);
    const reported = useRef<SchematicDraftsNarrowing>(NO_DRAFTS_NARROWING);
    useLayoutEffect(() => {
        // A read that fails leaves every drafted row as the narrowing's: the frame's line says why its source failed.
        const now = result.ok ? result.value : NO_DRAFTS_NARROWING;
        if (sameAnswers(reported.current, now)) return;
        reported.current = now;
        onRead(now);
    });
    return null;
}
