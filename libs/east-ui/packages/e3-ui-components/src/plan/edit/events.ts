/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */
import { useMemo } from "react";
import type { ValueTypeOf } from "@elaraai/east";
import type { PlanPayloadType } from "@elaraai/e3-ui/internal";
import { parseEventRef } from "../../shared/schedule/event-ref.js";
import { useScheduleEditing, type ScheduleChange, type ScheduleEditing, type ScheduleEditingArgs, type ScheduleRead } from "../../shared/schedule/editing.js";
export type {
    ScheduleChange as PlanEventChange, ScheduleKindSession as PlanKindSession,
    ScheduleEventDraftsValue as PlanEventDraftsValue, ScheduleKindDraftsValue as PlanKindDraftsValue,
    ScheduleGestureValue as PlanEventGestureValue,
} from "../../shared/schedule/editing.js";
type Kind = ValueTypeOf<typeof PlanPayloadType>["events"][number];
type Item = Extract<ReturnType<Kind["planEvent"]>, { type: "some" }>["value"]["item"];
/** The Plan's projected event and its full record row. */
export type PlanEventReadValue = ScheduleRead<Item>;
/** Shared editing, with the Plan's richer event projection. */
export type PlanEventEditing = ScheduleEditing<Item>;
/** The Plan's event editing inputs: the shared ones, the rows each kind's cells hold among them (`held`, #1039). */
export interface PlanEventEditingArgs extends Omit<ScheduleEditingArgs<Item>, "kinds"> {
    /** The Plan's event kinds. */
    kinds: readonly Kind[];
}

/**
 * Whether an event is locked now (#1541, U9): its kind's `locked`, over the
 * event as its kind reads it with its drafts in place. A locked event is not
 * moved, resized, changed or removed.
 *
 * @param editing - The event kinds' editing
 * @param kind - The kind's slot
 * @param id - The event's key's text
 * @returns Whether its kind's rule holds it where it is; never for an event the page does not hold, or one whose read fails
 */
export function planEventLocked(editing: PlanEventEditing | undefined, kind: string, id: string): boolean {
    if (editing === undefined) return false;
    try {
        return editing.read(kind, id)?.item.locked === true;
    } catch (err) {
        console.error(`[Plan] ${kind}'s read of ${id} failed; it is taken as not locked:`, err);
        return false;
    }
}

/**
 * Adapts the Plan's event projection to the shared record editing history:
 * each kind's events as Plan draws them. A gesture that changes or removes an
 * event its kind's `locked` holds where it is records nothing (#1541, U9):
 * the shared recorder's rule, which every builder's gestures meet, asked of
 * the row it holds. What draws a locked event says why before it gets there.
 */
export function usePlanEventEditing(args: PlanEventEditingArgs): PlanEventEditing {
    const kinds = useMemo(() => args.kinds.map(kind => ({ ...kind, event: kind.planEvent })), [args.kinds]);
    return useScheduleEditing({ ...args, kinds });
}

/**
 * Removes selected events through their record sessions as one undoable gesture.
 * Both the inspector and keyboard use the event's original record key. An
 * event its kind's `locked` holds where it is stays (#1541, U9): the others go,
 * and those that stayed are what stands selected after.
 *
 * @param keys - The selected elements' printed event references
 * @param editing - The shared event sessions, when the canvas is ready
 * @param label - A specific history label, when the caller has the event titles
 * @returns The selection that stands once the removal is recorded: the locked events, which stayed, by their keys;
 *   `undefined` where nothing was removed — every event locked among them — and the selection stands as it was
 */
export function removePlanEvents(keys: readonly string[], editing: PlanEventEditing | undefined, label?: string): readonly string[] | undefined {
    if (editing === undefined || keys.length === 0) return undefined;
    const changes: ScheduleChange[] = [];
    const stayed: string[] = [];
    for (const key of keys) {
        const ref = parseEventRef(key);
        if (!ref.success) return undefined;
        if (planEventLocked(editing, ref.value.kind, ref.value.key)) { stayed.push(key); continue; }
        changes.push({ kind: ref.value.kind, id: ref.value.key, remove: true });
    }
    if (changes.length === 0) return undefined;
    return editing.record(changes, "remove", label ?? `Delete ${changes.length} ${changes.length === 1 ? "event" : "events"}`) ? stayed : undefined;
}
