/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

/**
 * What a drop on a Plan would do (#1541, U7): the one candidate its `canDrop`
 * is asked of, whichever way the drop is made — a template, a backlog card or
 * an author's card landing, an event kind's element or a data series' item
 * moved, resized or taken off the canvas.
 *
 * And what a Connect would draw (#1541, U10): the candidate its `canConnect`
 * is asked of — a link kind, and the two events the link would join.
 *
 * It lives beside the Plan's types and not among them: it names an event as
 * the schedule family does, and that family's types read the Plan's.
 *
 * @packageDocumentation
 */

import { BooleanType, FunctionType, NullType, OptionType, StringType, StructType, VariantType } from "@elaraai/east";
import { DragEdgeType, DragSinkType, LibraryRefType } from "@elaraai/east-ui";
import { ScheduleEventRefType } from "../schedule/types.js";
import { PlanInstantType, PlanRowIdType } from "./types.js";

/**
 * A data series' item: the row it is in, and its key there.
 *
 * @remarks
 * Both are printed, as a drag names them: the row's id as East prints a
 * `Plan.Types.RowId`, which parses back, and the item's key, its id in its
 * row's collection.
 *
 * @property row - The row it is in: its id's text
 * @property key - Its key there: the item's id
 */
export const PlanItemRefType = StructType({ row: StringType, key: StringType });
/** Type representing {@link PlanItemRefType}. */
export type PlanItemRefType = typeof PlanItemRefType;

/**
 * What a drop would do: what a Plan's `canDrop` is asked, where a drag rests
 * and again before its drop becomes an unsaved edit.
 *
 * @remarks
 * An event's key and an item's key are printed, as East's text of the key,
 * which parses back; the row is typed. A candidate is never stored.
 *
 * @property gesture - What the drag does: `add`, onto the canvas (`duplicate`, an alt-drag copy); `move`; `remove`, off
 *   the canvas, to the trash or back to its library; or `resize`, by the end that moved
 * @property into - The event kind, by its slot, or the data series, by its key, it lands in or leaves
 * @property from - What is dragged: a template, by its key; a library tab's card; a backlog event; an event; or a data
 *   series' item
 * @property onto - What it lands on, where it lands on one: an event, or a data series' item
 * @property row - The row it would land on, by its series and its path: for an event, its resource's own row, whichever
 *   row beside it the event draws on. `none` for a `remove`, and for an event that keeps a resource beneath a row the
 *   canvas has not read, whose place among the rows is not known
 * @property lane - The lane it would sit in, where its row has lanes
 * @property start - When it would start there, on the axis's arm; `none` for a `remove`
 * @property end - When it would end there — a point's instant again; `none` for a `remove`, and for a card whose item
 *   is made as it lands, whose end its series decides
 */
export const PlanCandidateType = StructType({
    gesture: VariantType({
        add: StructType({ duplicate: BooleanType }),
        move: NullType,
        remove: DragSinkType,
        resize: DragEdgeType,
    }),
    into: VariantType({ kind: StringType, series: StringType }),
    from: VariantType({
        template: StringType,
        card: LibraryRefType,
        backlog: ScheduleEventRefType,
        event: ScheduleEventRefType,
        item: PlanItemRefType,
    }),
    onto: OptionType(VariantType({ event: ScheduleEventRefType, item: PlanItemRefType })),
    row: OptionType(PlanRowIdType),
    lane: OptionType(StringType),
    start: OptionType(PlanInstantType),
    end: OptionType(PlanInstantType),
});
/** Type representing {@link PlanCandidateType}. */
export type PlanCandidateType = typeof PlanCandidateType;

/**
 * A Plan's drop veto: what a drop would do, to the refusal's message, said on
 * the ghost — or `none`, to let it land.
 */
export const PlanCanDropType = FunctionType([PlanCandidateType], OptionType(StringType));
/** Type representing {@link PlanCanDropType}. */
export type PlanCanDropType = typeof PlanCanDropType;

/**
 * The link a Connect would draw: what a Plan's `canConnect` is asked, where
 * the drag rests on an event and again before the link becomes an unsaved
 * edit.
 *
 * @remarks
 * Each event's key is printed, as East's text of the key, which parses back.
 * A candidate is never stored.
 *
 * @property kind - The link kind it would be a link of, by its slot in `links`
 * @property from - The event it would run from, by its kind's slot and its key's text
 * @property to - The event it would run to
 */
export const PlanConnectCandidateType = StructType({ kind: StringType, from: ScheduleEventRefType, to: ScheduleEventRefType });
/** Type representing {@link PlanConnectCandidateType}. */
export type PlanConnectCandidateType = typeof PlanConnectCandidateType;

/**
 * A Plan's connect veto: the link a Connect would draw, to the refusal's
 * message, said on the ghost — or `none`, to let it be drawn.
 */
export const PlanCanConnectType = FunctionType([PlanConnectCandidateType], OptionType(StringType));
/** Type representing {@link PlanCanConnectType}. */
export type PlanCanConnectType = typeof PlanCanConnectType;
