/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

import { useMemo } from "react";
import { DateTimeType, decodeBeast2For, encodeBeast2For, isVariant, none, some, toEastTypeValue, variant } from "@elaraai/east";
import { Editing } from "@elaraai/east-ui";
import { RosterWeekType, RosterWeeksType } from "@elaraai/e3-ui/internal";
import { useEditHistory, type EditHistoryState, type EditSession, type EditingValue, type EditHistorySource, type EntryVersion, type Origin } from "@elaraai/east-ui-components";
import { emptyWeek, parseWeek, weekKey, type RosterValue, type Week } from "./model.js";
import { readWindowWeek, type useRosterData } from "./data.js";

const draftType = Editing.Types.DraftField(RosterWeekType);
const encodeWeeks = encodeBeast2For(RosterWeeksType);
const decodeBatch = decodeBeast2For(Editing.Types.ChangeSet(RosterWeekType, DateTimeType));
const PLACE = some(variant("keyOrder", null));
const ABSENT: EntryVersion<Week> = { draft: undefined, wire: undefined, place: none };
/** Typed whole-week draft; the shared session owns history, conflicts and request recovery. */
function draftWeek(entry: EntryVersion<Week> | undefined): Week | undefined {
    return entry !== undefined && isVariant(entry.draft) && entry.draft.type === "value" ? entry.draft.value as Week : undefined;
}
/**
 * Each week retains its shared session under its view key. They share the
 * record's write gate, while Save sends only the active week's batch.
 */
export function useRosterEditing(value: RosterValue, start: Date, storageKey: string, data: ReturnType<typeof useRosterData>): RosterEditing {
    const id = weekKey(start);
    const sources = useMemo((): EditHistorySource<Week>[] => {
        const editing: EditingValue = {
            sourceId: value.sourceId, entryType: toEastTypeValue(RosterWeekType), draftType: toEastTypeValue(draftType),
            keyType: some(toEastTypeValue(DateTimeType)), idField: none, children: none,
            snapshot: data.snapshot === undefined ? none : some(encodeWeeks(data.snapshot)),
            readEntry: () => none, onPatch: none, mode: variant("batch", null),
            onApply: some(variant("async", async bytes => value.apply(decodeBatch(bytes)))),
        };
        if (data.snapshot !== undefined) return [{ editing }];
        const window = value.window.type === "some" ? value.window.value : undefined;
        return [{ editing, paged: {
            revision: () => window?.revision() ?? none,
            refresh: revision => window?.refresh(revision),
            entry: id => {
                const date = parseWeek(id);
                return window === undefined || !date.success ? none : readWindowWeek(window, date.value);
            },
        } }];
    }, [value, data.snapshot]);
    const state = useEditHistory<Week>(sources, `${storageKey}.week.${id}`);
    const key = state.keys[0]!;
    const session = state.history.session(key);
    const held = data.weeks.get(start);
    const original = draftWeek(session?.originals.get(id)) ?? held;
    const week = draftWeek(session?.entries.get(id)) ?? held ?? emptyWeek(value, start);
    const available = !value.settings.readOnly && held?.status.type !== "published" && !data.loading && state.available(key);
    const record = (next: Week, origin: Origin, label: string): boolean => {
        if (!available || week.status.type === "published") return false;
        const before = session?.entries.get(id) ?? (held === undefined ? ABSENT : { draft: variant("value", held), wire: held, place: PLACE });
        return state.history.record([{ key, updates: [{ id, before, after: { draft: variant("value", next), wire: next, place: PLACE } }] }], origin, label);
    };
    return { ...state, key, session, week, held: original, available, record };
}
export interface RosterEditing extends Omit<EditHistoryState<Week>, "held" | "available"> {
    key: string; session: EditSession<Week> | undefined; week: Week; held: Week | undefined; available: boolean;
    record: (next: Week, origin: Origin, label: string) => boolean;
}
