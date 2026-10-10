/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */
import { useMemo } from "react";
import type { ValueTypeOf } from "@elaraai/east";
import type { PlanPayloadType } from "@elaraai/e3-ui/internal";
import { useScheduleEditing, type ScheduleEditing, type ScheduleEditingArgs, type ScheduleRead } from "../../shared/schedule/editing.js";
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
}
/** Adapts the Plan's event projection to the shared record editing history. */
export function usePlanEventEditing(args: PlanEventEditingArgs): PlanEventEditing {
    const kinds = useMemo(() => args.kinds.map(kind => ({ ...kind, event: kind.planEvent })), [args.kinds]);
    return useScheduleEditing({ ...args, kinds });
}
