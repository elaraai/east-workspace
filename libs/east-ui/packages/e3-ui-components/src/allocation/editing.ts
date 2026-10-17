/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

import { useMemo } from "react";
import { DateTimeType, isVariant, none, some, toEastTypeValue, variant } from "@elaraai/east";
import { Editing } from "@elaraai/east-ui";
import { useEditHistory, type EditHistoryState, type EditHistorySource, type EditSession, type EditingValue, type EntryVersion, type Origin } from "@elaraai/east-ui-components";
import { readWindowDay, type AllocationData } from "./data.js";
import { dayKey, emptyDay, parseDay, type AllocationDomain, type AllocationValue, type Day } from "./model.js";

const PLACE = some(variant("keyOrder", null));
const ABSENT: EntryVersion<Day> = { draft: undefined, wire: undefined, place: none };
/** A whole-day draft; the shared session owns history, conflicts and request recovery. */
function draftDay(entry: EntryVersion<Day> | undefined): Day | undefined {
    return entry !== undefined && isVariant(entry.draft) && entry.draft.type === "value" ? entry.draft.value as Day : undefined;
}

/** The active day's session, as the board edits through it. */
export interface AllocationEditing extends Omit<EditHistoryState<Day>, "held" | "available"> {
    key: string;
    session: EditSession<Day> | undefined;
    /** The day as drafted. */
    plan: Day;
    /** The day as the record holds it; `undefined` while it has no entry (Not started). */
    held: Day | undefined;
    /** Whether the day can be edited now. */
    available: boolean;
    /** One gesture, one transaction (A75): the day as it leaves it. */
    record: (next: Day, origin: Origin, label: string) => boolean;
}

/**
 * Each day keeps its own shared session under its view key (A5): the
 * record's write gate is shared across days, and Save sends only the active
 * day's batch, one checked patch (A77).
 */
export function useAllocationEditing(value: AllocationValue, domain: AllocationDomain, day: Date, storageKey: string, data: AllocationData): AllocationEditing {
    const id = dayKey(day);
    const sources = useMemo((): EditHistorySource<Day>[] => {
        const editing: EditingValue = {
            sourceId: value.sourceId, entryType: toEastTypeValue(domain.dayType), draftType: toEastTypeValue(Editing.Types.DraftField(domain.dayType)),
            keyType: some(toEastTypeValue(DateTimeType)), idField: none, children: none,
            snapshot: data.snapshot === undefined ? none : some(domain.encodeDays(data.snapshot)),
            readEntry: () => none, onPatch: none, mode: variant("batch", null),
            // The batch crosses as bytes at ChangeSet(Day(V), DateTime), the payload's apply's own.
            onApply: some(variant("async", async bytes => value.apply(bytes))),
        };
        if (data.snapshot !== undefined) return [{ editing }];
        const window = value.window.type === "some" ? value.window.value : undefined;
        return [{ editing, paged: {
            revision: () => window?.revision() ?? none,
            refresh: revision => window?.refresh(revision),
            entry: entry => {
                const date = parseDay(entry);
                return window === undefined || !date.success ? none : readWindowDay(window, domain, date.value);
            },
        } }];
    }, [value, domain, data.snapshot]);
    const state = useEditHistory<Day>(sources, `${storageKey}.day.${id}`);
    const key = state.keys[0]!;
    const session = state.history.session(key);
    const held = data.days.get(day);
    const original = draftDay(session?.originals.get(id)) ?? held;
    const plan = draftDay(session?.entries.get(id)) ?? held ?? emptyDay();
    const available = !value.settings.readOnly && held?.status.type !== "published" && !data.loading && state.available(key);
    const record = (next: Day, origin: Origin, label: string): boolean => {
        if (!available || plan.status.type === "published") return false;
        const before = session?.entries.get(id) ?? (held === undefined ? ABSENT : { draft: variant("value", held), wire: held, place: PLACE });
        return state.history.record([{ key, updates: [{ id, before, after: { draft: variant("value", next), wire: next, place: PLACE } }] }], origin, label);
    };
    return { ...state, key, session, plan, held: original, available, record };
}
