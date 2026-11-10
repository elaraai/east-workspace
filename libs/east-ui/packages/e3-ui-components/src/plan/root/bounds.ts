/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 *
 * The events whose rows break their kind's bounds (#1585): each element of one
 * wears the warn ring, stored or changed, as an event holding a conflict does.
 * A kind whose form holds no number to a least or a most is read for nothing.
 * Every event's row of a kind is read at once (`planRows`), drafts in place,
 * from the rows the canvas reads over its range — the reads its blocks make, so
 * no request of their own, and no event read by its key; a kind read by its
 * cells is read from the rows they hold, an event a draft changed read with
 * its draft in place. A kind past the cap draws none of its events, and nor
 * does a kind the viewer hides: neither is read.
 *
 * The read runs in a component of its own, {@link PlanBoundsReader}, which
 * hands the canvas the events only as they move: what it reads lands in as
 * many settles as the searches it touches, and each would otherwise render
 * the whole canvas (#1343).
 *
 * @packageDocumentation
 */

import { useCallback, useLayoutEffect, useMemo, useRef } from "react";
import { DictType, StringType, decodeBeast2For, fromEastTypeValue, printFor, type EastType, type ValueTypeOf } from "@elaraai/east";
import { ScheduleEventRefType, planHideId, type PlanPayloadType } from "@elaraai/e3-ui/internal";
import type { FieldSpecValue } from "@elaraai/east-ui/internal";
import { fieldBreaches, useTrackedEvaluation, type FieldBreach } from "@elaraai/east-ui-components";
import { isBounded, rowBreaches } from "../../shared/bounds.js";
import { optimiseIdOf } from "../../shared/func/optimise-diff.js";
import { scheduleWithinCap, type ScheduleCellsRead } from "../../shared/schedule/cells.js";
import type { PlanEventEditing } from "../edit/events.js";
import { hides } from "../frame/hidden.js";
import type { PlanEventRange } from "./events.js";

/** One event kind, as the Plan's payload carries it. */
type PlanEventKindValue = ValueTypeOf<typeof PlanPayloadType>["events"][number];

/** An element's key: its event, as East prints a `Schedule.Types.EventRef`. */
const printEventRef = printFor(ScheduleEventRefType);

/** No event whose row breaks its kind's bounds. */
export const NO_BOUNDED: ReadonlySet<string> = new Set();

/** No rows held: a kind its cells hold none of. */
const NO_ROWS: ReadonlyMap<string, { readonly row: Uint8Array }> = new Map();

/** A kind whose form holds a number to bounds, and how its rows are read against them. */
interface BoundedKind {
    readonly kind: PlanEventKindValue;
    /** Its form's fields held to bounds. */
    readonly bounded: readonly FieldSpecValue[];
    /** Its rows by key, from the bytes of its record's own Dict. */
    readonly rowsOf: (bytes: Uint8Array) => ReadonlyMap<unknown, unknown>;
    /** An event's key's text, as its session and its elements name it. */
    readonly idOf: (key: unknown) => string;
    /** One row's breaches, by its bytes. */
    readonly breachesOf: (bytes: Uint8Array) => readonly FieldBreach[];
}

/**
 * The events whose rows break their kind's bounds, by their elements' keys (see the module docs).
 *
 * @param kinds - The kinds whose forms hold a number to bounds
 * @param editing - The kinds' editing: each kind's drafts, which every read puts in place
 * @param range - The range the canvas reads its event kinds' rows over
 * @param cells - The kinds' cells and counts
 * @param hidden - The ids the viewer hides in the library's Series tab
 * @returns The elements' keys; `undefined` while a kind's count or rows are in flight
 */
function boundedEvents(kinds: readonly BoundedKind[], editing: PlanEventEditing, range: PlanEventRange, cells: ScheduleCellsRead,
    hidden: readonly string[]): ReadonlySet<string> | undefined {
    const out = new Set<string>();
    let reading = false;
    for (const { kind, bounded, rowsOf, idOf, breachesOf } of kinds) {
        if (hides(hidden, planHideId.events(kind.key))) continue;
        const drafts = editing.draftsOf(kind.key);
        if (cells.reads.has(kind.key)) {
            // Read by its cells — past the cap, they hold none of its events.
            for (const [id, { row }] of cells.held.get(kind.key) ?? NO_ROWS) {
                if (!drafts.has(id) && breachesOf(row).length > 0) out.add(printEventRef({ kind: kind.key, key: id }));
            }
            for (const id of drafts.keys()) {
                const read = editing.read(kind.key, id);
                if (read !== undefined && breachesOf(read.row).length > 0) out.add(printEventRef({ kind: kind.key, key: id }));
            }
            continue;
        }
        const within = scheduleWithinCap(kind.count, range.from, range.to);
        if (within.type !== "some") { reading = true; continue; }
        if (!within.value) continue;
        const held = kind.planRows(range.from, range.to, drafts);
        if (held.type !== "some") { reading = true; continue; }
        for (const [key, row] of rowsOf(held.value)) {
            if (fieldBreaches(bounded, row).length > 0) out.add(printEventRef({ kind: kind.key, key: idOf(key) }));
        }
    }
    return reading ? undefined : out;
}

/** Props of {@link PlanBoundsReader}. */
export interface PlanBoundsReaderProps {
    /** The event kinds, as the payload carries them. */
    kinds: readonly PlanEventKindValue[];
    /** The kinds' editing: each kind's drafts, which every read puts in place. */
    editing: PlanEventEditing;
    /** The range the canvas reads its event kinds' rows over. */
    range: PlanEventRange;
    /** The kinds' cells and counts; `undefined` until the reader of the kinds' rows hands them on. */
    cells: ScheduleCellsRead | undefined;
    /** The ids the viewer hides in the library's Series tab. */
    hidden: readonly string[];
    /** Where the events go: called only when they move. */
    onBounded: (bounded: ReadonlySet<string>) => void;
}

/**
 * The events whose rows break their kind's bounds, read in a component of its
 * own (see the module docs). Until the kinds' cells are read, which kinds they
 * hold is not known, and nothing is read: a kind read by its cells is never
 * read over the range. A read in flight, or one that failed, hands nothing on.
 *
 * @param props - What is read, over what, and where it goes
 * @returns Nothing: it reads
 */
export function PlanBoundsReader({ kinds, editing, range, cells, hidden, onBounded }: PlanBoundsReaderProps): null {
    const checked = useMemo(() => kinds.flatMap((kind): BoundedKind[] => {
        const bounded = kind.fields.filter(isBounded);
        if (bounded.length === 0) return [];
        const keyType = kind.editing.keyType.type === "some" ? fromEastTypeValue(kind.editing.keyType.value) as EastType : StringType;
        const rowType = fromEastTypeValue(kind.editing.entryType) as EastType;
        return [{
            kind, bounded, rowsOf: decodeBeast2For(DictType(keyType, rowType)) as (bytes: Uint8Array) => ReadonlyMap<unknown, unknown>,
            idOf: optimiseIdOf(keyType), breachesOf: rowBreaches(bounded, rowType),
        }];
    }), [kinds]);
    const read = useCallback(() => (cells === undefined ? undefined : boundedEvents(checked, editing, range, cells, hidden)),
        [checked, editing, range, cells, hidden]);
    const { result } = useTrackedEvaluation(read);
    const now = result.ok ? result.value : undefined;
    const reported = useRef(NO_BOUNDED);
    useLayoutEffect(() => {
        const was = reported.current;
        if (now === undefined || (was.size === now.size && [...now].every((key) => was.has(key)))) return;
        reported.current = now;
        onBounded(now);
    });
    return null;
}
