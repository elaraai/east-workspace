/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

/**
 * `Plan.eventRef(kind, key)` (#1191, `Plan Builder Spec.md` PB10): an event of
 * one of a Plan's event kinds, named for a link's end.
 *
 * Where an event draws is not known when the Plan is built: its row is the
 * resource it is on, and a draft can move it. So the ref names the event, not
 * its row: a run ref whose row is an `entry` of the kind's slot with no path
 * — a row no series makes, since every row's path holds at least its entry's
 * key — and whose run is the event's key. The canvas finds the event's
 * element where it draws.
 *
 * @packageDocumentation
 */

import { East, variant, type ExprType, type StringType, type SubtypeExprOrValue } from "@elaraai/east";
import { PlanRunRefType } from "./types.js";

/** The kind of each ref `Plan.eventRef` made, by the value it returned. */
const EVENT_REFS = new WeakMap<object, string>();

/**
 * Names an event for a link's end — `Plan.eventRef("job", "J-4642")`.
 *
 * @param kind - The event kind's slot name, as the Plan's `events` names it
 * @param key - The event's record key, as text (a String key as it is, any other key as East prints it)
 * @returns The run ref a link's `from` or `to` takes
 *
 * @remarks
 * A link of the list built in code names its ends so (`Plan.link`): the print
 * works' four are the tested example of it (`planPrintWorks`). A link kind over
 * a record names its ends by the fields that hold their events' keys instead
 * (`Plan.links`).
 */
export function createEventRef(kind: string, key: SubtypeExprOrValue<StringType>): ExprType<PlanRunRefType> {
    const ref = East.value({ row: variant("entry", { series: kind, path: [] }), run: key }, PlanRunRefType);
    EVENT_REFS.set(ref, kind);
    return ref;
}

/**
 * The kind an event ref names, when `Plan.eventRef` made it — what a Plan
 * checks its links' ends against.
 *
 * @param ref - A link end
 * @returns The kind's slot name, or `undefined` for any other value
 * @internal
 */
export function eventRefKind(ref: unknown): string | undefined {
    return typeof ref === "object" && ref !== null ? EVENT_REFS.get(ref) : undefined;
}
