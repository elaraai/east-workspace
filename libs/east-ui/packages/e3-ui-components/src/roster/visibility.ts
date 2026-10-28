/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */
/**
 * Which people and activities show (#1342): the Roster reads each source of its
 * `Slice.bindRecords` itself through the shared source visibility, and a source
 * with nothing chosen reads no page and hides nothing. Coverage, costs, checks
 * and the editing session never see it.
 */
import type { ValueTypeOf } from "@elaraai/east";
import type { RecordSliceBindType } from "@elaraai/east-ui/internal";
import { sourcePart, useSourceVisibility, type KeyVisibility } from "../shared/schedule/visibility.js";
import type { RosterPayload } from "./model.js";

/** A narrowed source's name: what its rows are on the Roster — its people, its activities, or its week patterns (#1406). */
export type RosterNarrowed = "people" | "activities" | "patterns";

/** What a failed narrowing of each source says. */
const WORDS = {
    people: { changed: "Staff results changed; retry the narrowing.", failed: "Could not load staff results" },
    activities: { changed: "Activity results changed; retry the narrowing.", failed: "Could not load activity results" },
    patterns: { changed: "Pattern results changed; retry the narrowing.", failed: "Could not load pattern results" },
} as const;

/**
 * A source's part of the Roster's narrowing, if the slice has one.
 *
 * @param value - The payload
 * @param source - The source
 * @returns Its record Slice's controls
 */
export function rosterPart(value: RosterPayload, source: RosterNarrowed): ValueTypeOf<RecordSliceBindType> | undefined {
    return sourcePart(value.slice.type === "some" ? value.slice.value : undefined, source);
}

/**
 * Which of a source's rows show: its narrowed keys while a choice narrows it,
 * every row while none does; the previous complete membership while a new one
 * resolves.
 *
 * @param value - The payload
 * @param source - The source
 * @returns The keys to show, and the narrowing's state
 */
export function useRosterVisibility(value: RosterPayload, source: RosterNarrowed): KeyVisibility {
    return useSourceVisibility(value.slice.type === "some" ? value.slice.value : undefined, source, value.narrowed[source],
        source === "people" ? value.people : source === "activities" ? value.activities : value.patterns, WORDS[source]);
}
