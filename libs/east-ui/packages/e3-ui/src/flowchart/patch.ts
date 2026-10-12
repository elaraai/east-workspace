/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

/**
 * `Flowchart.patch(T, { … })` (#1244, `Flowchart Builder Spec.md` §4.3): a
 * patch over one of a flow's rows — a state, a transition, a lane or a
 * decision — every field an `Option`, the fields it leaves out `none`. It is
 * the row patch `Sheet.patch` and `Schedule.patch` build: a library card's
 * `drop` returns one, the fields a card sets where it lands, and the patch's
 * type names the row it lands on.
 *
 * @packageDocumentation
 */

import { isTypeEqual, printType, type EastType, type ExprType } from "@elaraai/east";
import { SchedulePatchTypeFor, schedulePatch, type SchedulePatchInput, type SchedulePatchOf } from "../schedule/patch.js";
import { FlowchartLaneType, FlowchartLinkType, FlowchartStateType, FlowchartTriggerType } from "./types.js";

/** A flow's row types: a state, a transition, a lane and a decision — what `Flowchart.patch` patches. */
export type FlowchartRowType = FlowchartStateType | FlowchartLinkType | FlowchartLaneType | FlowchartTriggerType;

/**
 * The TS type of `Flowchart.Types.Patch(R)`: every field of the row as an `Option`.
 *
 * @typeParam R - The row type
 */
export type FlowchartPatchOf<R extends FlowchartRowType> = SchedulePatchOf<R>;

/**
 * The literal-record input of `Flowchart.patch(R, …)`: every field of the row
 * optional, each a literal or an expression of the field's type; a field left
 * out is `none`.
 *
 * @typeParam R - The row type
 */
export type FlowchartPatchInput<R extends FlowchartRowType> = SchedulePatchInput<R>;

/** The row types a patch is over, each with the name a refusal gives it. */
const ROWS: readonly (readonly [EastType, string])[] = [
    [FlowchartStateType, "State"],
    [FlowchartLinkType, "Link"],
    [FlowchartLaneType, "Lane"],
    [FlowchartTriggerType, "Trigger"],
];

/** Refuses a type that is none of a flow's rows, naming where it was given. */
function checkRow(rowType: EastType, where: string): void {
    if (!ROWS.some(([row]) => isTypeEqual(row, rowType))) {
        throw new Error(`${where}: patches one of a flow's rows — Flowchart.Types.${ROWS.map(([, name]) => name).join(", Flowchart.Types.")} — and this is ${printType(rowType)}`);
    }
}

/**
 * `Flowchart.Types.Patch(R)`: a patch over one of a flow's rows — every field
 * of the row as an `Option`, `none` leaving the row's field as it is.
 *
 * @typeParam R - The row type
 * @param rowType - The row type: `Flowchart.Types.State`, `Link`, `Lane` or `Trigger`
 * @returns The patch type
 * @throws {Error} When the type is none of a flow's rows
 */
export function FlowchartPatchTypeFor<R extends FlowchartRowType>(rowType: R): FlowchartPatchOf<R> {
    checkRow(rowType, "Flowchart.Types.Patch");
    return SchedulePatchTypeFor(rowType);
}

/**
 * Builds a patch over one of a flow's rows — `Flowchart.patch(R, { … })`: the
 * fields it sets, every other field `none`. A library card's `drop` returns
 * one: what a state template seeds the state it adds with, what a transition
 * template sets on the transition it lands on, and what an author's card sets
 * on the row its patch's type names.
 *
 * @remarks
 * It is the row patch `Sheet.patch` builds, over a flow's own rows. A field
 * that is an `Option` takes an `Option`: `label: some("Sorted")` sets a
 * state's label, `label: none` clears it, and leaving `label` out leaves it as
 * it is.
 *
 * @typeParam R - The row type
 * @param rowType - The row type: `Flowchart.Types.State`, `Link`, `Lane` or `Trigger`
 * @param record - The fields to set, each a literal or an expression of the field's type
 * @returns An expression of `Flowchart.Types.Patch(R)`
 * @throws {Error} When the type is none of a flow's rows
 */
export function flowchartPatch<R extends FlowchartRowType>(rowType: R, record: FlowchartPatchInput<R>): ExprType<FlowchartPatchOf<R>> {
    checkRow(rowType, "Flowchart.patch");
    return schedulePatch(rowType, record);
}
