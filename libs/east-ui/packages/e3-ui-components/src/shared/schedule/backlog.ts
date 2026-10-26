/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

/**
 * What a builder's rail hides of its event kinds' backlog (#1343, #1344): each
 * backlog kind narrowed through its source of the slice reads its unscheduled
 * events by its source's choices but its window — a backlog event has no time
 * — so the Backlog tab counts `N of M`, what shows beside the stored events
 * those choices hide, two index counts a kind, and its Clear filters clears
 * those choices alone, each source keeping its window. The Calendar's and the
 * Plan's Backlog tabs read it.
 *
 * @packageDocumentation
 */

import { useCallback, useMemo } from "react";
import { DateTimeType, OptionType, SortedMap, StringType, compareFor, equalFor, none, printFor, some, variant, type ValueTypeOf } from "@elaraai/east";
import type { RecordSliceBindType, RecordSliceChoiceType, RecordSliceWhereType } from "@elaraai/east-ui/internal";
import { useSlicesReactivity, useTrackedEvaluation } from "@elaraai/east-ui-components";

/** One record Slice's controls. */
type Bind = ValueTypeOf<RecordSliceBindType>;

const stringEqual = equalFor(StringType);
const compareString = compareFor(StringType);
/** A backlog kind's start unset, as the record Slice writes the choice and its index keys it: the kind's backlog. */
const UNSET: ValueTypeOf<RecordSliceChoiceType> = variant("values", [printFor(OptionType(DateTimeType))(none)]);

/** An event kind narrowed through its source of the slice: the kind — its key, whether it has a backlog and its start field — and its part. */
export interface BacklogPart {
    /** The event kind. */
    readonly kind: { readonly key: string; readonly backlog: boolean; readonly schedule: { readonly start: string } };
    /** Its source's part of the slice. */
    readonly part: Bind;
}

/** What the rail hides of the backlog. */
export interface BacklogNarrowing<P extends BacklogPart = BacklogPart> {
    /** The backlog kinds whose source's choices — its window aside, which the backlog never reads — narrow their backlog. */
    readonly narrowing: readonly P[];
    /** The stored unscheduled events those choices hide; `undefined` while a count is read, or none narrows. */
    readonly hidden: number | undefined;
    /** Whether a count of what those choices hide is being read: `hidden` is `undefined` meanwhile. */
    readonly counting: boolean;
    /** Clears those choices, each source keeping its window; `undefined` while none narrows. */
    readonly clear: (() => void) | undefined;
}

/**
 * A source's choices but its start's, its start Unset: what lists its backlog.
 *
 * @param where - The source's narrowing
 * @param start - The kind's start field
 * @returns The narrowing its backlog is read under
 */
export function backlogWhere(where: ValueTypeOf<RecordSliceWhereType>, start: string): SortedMap<string, ValueTypeOf<RecordSliceChoiceType>> {
    const kept = new SortedMap([...where].filter(([field]) => !stringEqual(field, start)), compareString);
    kept.set(start, UNSET);
    return kept;
}

/**
 * A kind's start Unset alone: every unscheduled event its record holds, whatever its source's choices.
 *
 * @param start - The kind's start field
 * @returns The narrowing
 */
export function backlogWhole(start: string): SortedMap<string, ValueTypeOf<RecordSliceChoiceType>> {
    return new SortedMap([[start, UNSET]], compareString);
}

/**
 * What the rail hides of the backlog (see the module docs).
 *
 * @param eventParts - Each event kind narrowed through its source
 * @returns The narrowing kinds, what they hide and how they clear
 */
export function useBacklogNarrowing<P extends BacklogPart>(eventParts: readonly P[]): BacklogNarrowing<P> {
    const parts = useMemo(() => eventParts.filter(({ kind }) => kind.backlog), [eventParts]);
    const version = useSlicesReactivity(parts.map(({ part }) => part.key));
    const narrowing = useMemo(() => parts.filter(({ kind, part }) => [...part.read().where.keys()].some(field => !stringEqual(field, kind.schedule.start))),
        // `version` moves with each source's choices.
        // eslint-disable-next-line react-hooks/exhaustive-deps
        [parts, version]);
    const read = useCallback(() => {
        let hidden = 0n;
        for (const { kind, part } of narrowing) {
            const start = kind.schedule.start;
            const all = part.countWhere(backlogWhole(start));
            const shown = part.countWhere(backlogWhere(part.read().where, start));
            if (all.type === "none" || shown.type === "none") return none;
            hidden += all.value - shown.value;
        }
        return some(hidden);
    }, [narrowing]);
    const { result } = useTrackedEvaluation(read);
    const clear = useMemo(() => narrowing.length === 0 ? undefined : () => {
        for (const { kind, part } of narrowing) {
            const state = part.read();
            const window = new SortedMap([...state.where].filter(([field]) => stringEqual(field, kind.schedule.start)), compareString);
            part.write({ ...state, where: window, preset: none });
        }
    }, [narrowing]);
    const hidden = narrowing.length > 0 && result.ok && result.value.type === "some" ? Number(result.value.value) : undefined;
    const counting = narrowing.length > 0 && result.ok && result.value.type === "none";
    return useMemo(() => ({ narrowing, hidden, counting, clear }), [narrowing, hidden, counting, clear]);
}
