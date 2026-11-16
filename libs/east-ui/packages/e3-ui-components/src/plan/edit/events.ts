/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */
import { useCallback, useMemo, useRef } from "react";
import { parseFor, type ValueTypeOf } from "@elaraai/east";
import { ScheduleEventRefType, type PlanPayloadType } from "@elaraai/e3-ui/internal";
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

/** Whether a change is to an event that stands already: a new event's first row is none, whatever its kind's `locked` reads of it. */
function changesStanding(change: ScheduleChange): boolean {
    if ("created" in change && change.created === true) return false;
    return !("gesture" in change && change.gesture.type === "create");
}

/**
 * Adapts the Plan's event projection to the shared record editing history:
 * each kind's events as Plan draws them. A gesture that changes or removes an
 * event its kind's `locked` holds where it is records nothing (#1541, U9) —
 * the one rule every gesture meets, whatever asks: a drag, the keyboard, the
 * inspector, a bulk edit, an optimiser's answer. What draws a locked event
 * says why before it gets here.
 */
export function usePlanEventEditing(args: PlanEventEditingArgs): PlanEventEditing {
    const kinds = useMemo(() => args.kinds.map(kind => ({ ...kind, event: kind.planEvent })), [args.kinds]);
    const editing = useScheduleEditing({ ...args, kinds });
    const latest = useRef(editing);
    latest.current = editing;
    const record = useCallback<PlanEventEditing["record"]>((changes, origin, label) => {
        const now = latest.current;
        if (changes.some((change) => changesStanding(change) && planEventLocked(now, change.kind, change.id))) return false;
        return now.record(changes, origin, label);
    }, []);
    return useMemo(() => ({ ...editing, record }), [editing, record]);
}

const parseEventRef = parseFor(ScheduleEventRefType);

/**
 * Removes selected events through their record sessions as one undoable gesture.
 * Both the inspector and keyboard use the event's original record key. An
 * event its kind's `locked` holds where it is stays (#1541, U9): the others go.
 *
 * @param keys - The selected elements' printed event references
 * @param editing - The shared event sessions, when the canvas is ready
 * @param label - A specific history label, when the caller has the event titles
 * @returns Whether a removal was recorded; never where every event is locked
 */
export function removePlanEvents(keys: readonly string[], editing: PlanEventEditing | undefined, label?: string): boolean {
    if (editing === undefined || keys.length === 0) return false;
    const changes: ScheduleChange[] = [];
    for (const key of keys) {
        const ref = parseEventRef(key);
        if (!ref.success) return false;
        if (planEventLocked(editing, ref.value.kind, ref.value.key)) continue;
        changes.push({ kind: ref.value.kind, id: ref.value.key, remove: true });
    }
    if (changes.length === 0) return false;
    return editing.record(changes, "remove", label ?? `Delete ${changes.length} ${changes.length === 1 ? "event" : "events"}`);
}
