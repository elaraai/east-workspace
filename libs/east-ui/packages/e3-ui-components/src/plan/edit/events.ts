/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */
import { useMemo, useRef } from "react";
import { none, parseFor, some, type ValueTypeOf } from "@elaraai/east";
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
/** The Plan's event editing inputs. */
export interface PlanEventEditingArgs extends Omit<ScheduleEditingArgs<Item>, "kinds"> {
    /** The Plan's event kinds. */
    kinds: readonly Kind[];
    /**
     * The rows each kind read by its cells holds (#1039), by the kind's slot, then by the event's key's text: where a
     * gesture, the inspector and a banner find one of its events, with no read of its own; one they do not hold is read
     * by its key, never over the window.
     */
    held?: ReadonlyMap<string, ReadonlyMap<string, { readonly row: Uint8Array }>> | undefined;
}
/** Adapts the Plan's event projection to the shared record editing history. */
export function usePlanEventEditing(args: PlanEventEditingArgs): PlanEventEditing {
    // The latest rows held: the kinds' reads read them as they run, so new cells make no new kinds.
    const held = useRef(args.held);
    held.current = args.held;
    const kinds = useMemo(() => args.kinds.map(kind => ({
        ...kind,
        event: (id: string, drafts: Parameters<Kind["planEvent"]>[1], from: Date, to: Date) => {
            const rows = held.current?.get(kind.key);
            const row = rows?.get(id);
            return kind.planEvent(id, drafts, from, to, rows === undefined ? none : some(row === undefined ? none : some(row.row)));
        },
    })), [args.kinds]);
    return useScheduleEditing({ ...args, kinds });
}

const parseEventRef = parseFor(ScheduleEventRefType);

/**
 * Removes selected events through their record sessions as one undoable gesture.
 * Both the inspector and keyboard use the event's original record key.
 *
 * @param keys - The selected elements' printed event references
 * @param editing - The shared event sessions, when the canvas is ready
 * @param label - A specific history label, when the caller has the event titles
 * @returns Whether the removal was recorded
 */
export function removePlanEvents(keys: readonly string[], editing: PlanEventEditing | undefined, label?: string): boolean {
    if (editing === undefined || keys.length === 0) return false;
    const changes: ScheduleChange[] = [];
    for (const key of keys) {
        const ref = parseEventRef(key);
        if (!ref.success) return false;
        changes.push({ kind: ref.value.kind, id: ref.value.key, remove: true });
    }
    return editing.record(changes, "remove", label ?? `Delete ${changes.length} ${changes.length === 1 ? "event" : "events"}`);
}
