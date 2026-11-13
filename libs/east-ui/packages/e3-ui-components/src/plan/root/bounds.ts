/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 *
 * The events whose rows break their kind's bounds (#1585): each element of one
 * wears the warn ring, stored or changed, as an event holding a conflict does,
 * and a stored one's breach is a warning beside the history's issues, holding
 * no Save — a changed one's is the refusal its session's readiness raises,
 * which holds Save. A warning names its event by its title, as the banners
 * read it, then the field by its label and the bound in its hint's own words,
 * as a refusal does. A kind whose form holds no number to a least or a most is
 * read for nothing.
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
import { DictType, OptionType, StringType, decodeBeast2For, equalFor, fromEastTypeValue, printFor, type EastType, type ValueTypeOf } from "@elaraai/east";
import { ScheduleEventRefType, planHideId, type PlanPayloadType } from "@elaraai/e3-ui/internal";
import type { FieldSpecValue } from "@elaraai/east-ui/internal";
import { fieldBreachIssue, fieldBreaches, useTrackedEvaluation, type EditIssue, type FieldBreach } from "@elaraai/east-ui-components";
import { isBounded, rowBreaches } from "../../shared/bounds.js";
import { optimiseIdOf } from "../../shared/func/optimise-diff.js";
import { scheduleWithinCap, type ScheduleCellsRead } from "../../shared/schedule/cells.js";
import { scheduleIssueName } from "../../shared/schedule/editing.js";
import { refusalText, scheduleRefusals } from "../../shared/schedule/refusals.js";
import type { PlanEventEditing } from "../edit/events.js";
import { hides } from "../frame/hidden.js";
import type { PlanEventRange } from "./events.js";

/** One event kind, as the Plan's payload carries it. */
type PlanEventKindValue = ValueTypeOf<typeof PlanPayloadType>["events"][number];

/** An element's key: its event, as East prints a `Schedule.Types.EventRef`. */
const printEventRef = printFor(ScheduleEventRefType);
const stringEqual = equalFor(StringType);
const fieldEqual = equalFor(OptionType(StringType));

/** A stored event's breach: a warning beside the history's issues, which holds no Save. */
export interface PlanBoundsWarning {
    /** The event's kind's slot. */
    readonly kind: string;
    /** The breach, as an issue of the event naming its field: what its Go to asks the event's form for. */
    readonly issue: EditIssue;
    /** Its words: the event's title, then the field's label and the bound. */
    readonly text: string;
}

/** The events whose rows break their kind's bounds: those that wear the warn ring, and the stored ones' breaches. */
export interface PlanBreaches {
    /** Every such event, stored or changed, by its elements' key. */
    readonly bounded: ReadonlySet<string>;
    /** The stored ones' breaches, in the kinds' order. */
    readonly warnings: readonly PlanBoundsWarning[];
}

/** No event whose row breaks its kind's bounds. */
export const NO_BREACHES: PlanBreaches = { bounded: new Set(), warnings: [] };

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

/** Whether two readings' warnings say the same, of the same fields of the same events. */
function sameWarnings(a: readonly PlanBoundsWarning[], b: readonly PlanBoundsWarning[]): boolean {
    return a.length === b.length && a.every((was, i) => {
        const now = b[i]!;
        return stringEqual(was.kind, now.kind) && stringEqual(was.issue.entry, now.issue.entry) && fieldEqual(was.issue.field, now.issue.field)
            && stringEqual(was.text, now.text);
    });
}

/**
 * The events whose rows break their kind's bounds, and the stored ones' breaches (see the module docs).
 *
 * @param kinds - The kinds whose forms hold a number to bounds
 * @param editing - The kinds' editing: each kind's drafts, which every read puts in place, and its session's refusals
 * @param range - The range the canvas reads its event kinds' rows over
 * @param cells - The kinds' cells and counts
 * @param hidden - The ids the viewer hides in the library's Series tab
 * @returns The events and the warnings; `undefined` while a kind's count or rows are in flight
 */
function boundedEvents(kinds: readonly BoundedKind[], editing: PlanEventEditing, range: PlanEventRange, cells: ScheduleCellsRead,
    hidden: readonly string[]): PlanBreaches | undefined {
    const bounded = new Set<string>();
    const warnings: PlanBoundsWarning[] = [];
    // A changed event's breaches are its session's refusals, which hold Save: never warnings as well.
    const refused = scheduleRefusals(editing.sessions);
    let reading = false;
    for (const { kind, bounded: fields, rowsOf, idOf, breachesOf } of kinds) {
        if (hides(hidden, planHideId.events(kind.key))) continue;
        const drafts = editing.draftsOf(kind.key);
        const breaking: { readonly id: string; readonly breaches: readonly FieldBreach[] }[] = [];
        if (cells.reads.has(kind.key)) {
            // Read by its cells — past the cap, they hold none of its events.
            for (const [id, { row }] of cells.held.get(kind.key) ?? NO_ROWS) {
                if (drafts.has(id)) continue;
                const breaches = breachesOf(row);
                if (breaches.length > 0) breaking.push({ id, breaches });
            }
            for (const id of drafts.keys()) {
                const read = editing.read(kind.key, id);
                if (read === undefined) continue;
                const breaches = breachesOf(read.row);
                if (breaches.length > 0) breaking.push({ id, breaches });
            }
        } else {
            const within = scheduleWithinCap(kind.count, range.from, range.to);
            if (within.type !== "some") { reading = true; continue; }
            if (!within.value) continue;
            const held = kind.planRows(range.from, range.to, drafts);
            if (held.type !== "some") { reading = true; continue; }
            for (const [key, row] of rowsOf(held.value)) {
                const breaches = fieldBreaches(fields, row);
                if (breaches.length > 0) breaking.push({ id: idOf(key), breaches });
            }
        }
        for (const { id, breaches } of breaking) {
            bounded.add(printEventRef({ kind: kind.key, key: id }));
            for (const breach of breaches) {
                const issue = fieldBreachIssue(breach, { entry: id });
                if (refused.some((refusal) => stringEqual(refusal.kind, kind.key) && stringEqual(refusal.issue.entry, id)
                    && fieldEqual(refusal.issue.field, issue.field))) continue;
                warnings.push({ kind: kind.key, issue, text: `${scheduleIssueName(editing, kind.key, id)} · ${refusalText(issue, kind.fields)}` });
            }
        }
    }
    return reading ? undefined : { bounded, warnings };
}

/** Props of {@link PlanBoundsReader}. */
export interface PlanBoundsReaderProps {
    /** The event kinds, as the payload carries them. */
    kinds: readonly PlanEventKindValue[];
    /** The kinds' editing: each kind's drafts, which every read puts in place, and its session's refusals. */
    editing: PlanEventEditing;
    /** The range the canvas reads its event kinds' rows over. */
    range: PlanEventRange;
    /** The kinds' cells and counts; `undefined` until the reader of the kinds' rows hands them on. */
    cells: ScheduleCellsRead | undefined;
    /** The ids the viewer hides in the library's Series tab. */
    hidden: readonly string[];
    /** Where the events and the warnings go: called only when they move, each kept while it says the same. */
    onBreaches: (breaches: PlanBreaches) => void;
}

/**
 * The events whose rows break their kind's bounds, and the stored ones'
 * breaches, read in a component of its own (see the module docs). Until the
 * kinds' cells are read, which kinds they hold is not known, and nothing is
 * read: a kind read by its cells is never read over the range. A read in
 * flight, or one that failed, hands nothing on.
 *
 * @param props - What is read, over what, and where it goes
 * @returns Nothing: it reads
 */
export function PlanBoundsReader({ kinds, editing, range, cells, hidden, onBreaches }: PlanBoundsReaderProps): null {
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
    const reported = useRef(NO_BREACHES);
    useLayoutEffect(() => {
        if (now === undefined) return;
        // Each kept while it says the same: the elements wearing the ring draw nothing again as a warning's words move.
        const was = reported.current;
        const bounded = was.bounded.size === now.bounded.size && [...now.bounded].every((key) => was.bounded.has(key)) ? was.bounded : now.bounded;
        const warnings = sameWarnings(was.warnings, now.warnings) ? was.warnings : now.warnings;
        if (bounded === was.bounded && warnings === was.warnings) return;
        reported.current = { bounded, warnings };
        onBreaches(reported.current);
    });
    return null;
}
