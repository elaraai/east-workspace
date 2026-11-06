/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

/**
 * An action column's machine as the renderer walks it (#1475,
 * `Sheet Action Column - Behaviour Spec.md` §0, §10): the cases decoded from
 * the column's kind, a row's state read off its `Action` cell, its offer —
 * its state's `next`, or `start` with nothing taken — and the gate that says
 * whether it may act now. Pure: no React.
 *
 * @packageDocumentation
 */

import { NullType, decodeBeast2For, encodeBeast2For, fromEastTypeValue, isTypeEqual, variant, type EastType, type ValueTypeOf } from "@elaraai/east";
import { getSomeorUndefined } from "@elaraai/east-ui-components";
import type { Sheet } from "@elaraai/e3-ui/internal";
import type { SheetColumnMeta } from "../model.js";
import type { SheetCellValue, SheetContextValue } from "../values.js";

/** The decoded wire kind of an action column. */
export type SheetActionKindValue = ValueTypeOf<typeof Sheet.Types.ActionKind>;
/** One decoded wire case. */
export type SheetActionCaseValue = ValueTypeOf<typeof Sheet.Types.ActionCase>;
/** How a case is asked for, decoded. */
export type SheetActionTakeValue = ValueTypeOf<typeof Sheet.Types.ActionTake>;
/** Whether a row may act now, decoded. */
export type SheetActionGateValue = ValueTypeOf<typeof Sheet.Types.ActionGate>;
/** What an action wrote beside its field, decoded: the row's cells and the band's. */
export type SheetActionUpdatesValue = ValueTypeOf<typeof Sheet.Types.ActionUpdates>;

/** One case of an action column, as the cell and its overlays read it. */
export interface ActionCase {
    /** The case's name. */
    readonly name: string;
    /** The action's verb. */
    readonly label: string;
    /** The state's word. */
    readonly state: string;
    /** The state's tone; `undefined` is neutral. */
    readonly tone: string | undefined;
    /** A Font Awesome solid icon's name. */
    readonly icon: string | undefined;
    /** The cases a row in this state may go to, in order. */
    readonly next: readonly string[];
    /** How it is asked for. */
    readonly take: SheetActionTakeValue;
    /** The case's value type. */
    readonly valueType: EastType;
    /** What the form opens with, encoded. */
    readonly initial: ((ctx: SheetContextValue) => Uint8Array) | undefined;
    /** What else taking it writes. */
    readonly updates: ((value: Uint8Array, ctx: SheetContextValue, at: Date) => SheetActionUpdatesValue) | undefined;
    /** The kind S14's grammar labels it by: a button, a choice (a menu) or a form. */
    readonly kind: "button" | "choice" | "form";
    /** Its value, encoded at its type. */
    readonly encode: (value: unknown) => Uint8Array;
    /** Its value, decoded. */
    readonly decode: (bytes: Uint8Array) => unknown;
}

/** An action column's machine. */
export interface ActionColumn {
    /** What a row with nothing taken may do. */
    readonly start: readonly string[];
    /** Every case by name. */
    readonly cases: ReadonlyMap<string, ActionCase>;
    /** The cases in the author's order. */
    readonly order: readonly ActionCase[];
    /** Whether a row may act now, over its wire context. */
    readonly gate: (ctx: SheetContextValue) => SheetActionGateValue;
    /** The rule cell holding a row's summary. */
    readonly summary: string;
    /** The rule cell holding how the row is named, if any. */
    readonly name: string | undefined;
    /** The rule cell holding the row's words beside its name, if any. */
    readonly title: string | undefined;
}

const columns = new WeakMap<object, ActionColumn>();
const NULL_BYTES = encodeBeast2For(NullType)(null);

/**
 * A column's machine, decoded once per wire column.
 *
 * @param meta - The column
 * @returns Its machine, or `undefined` for any other kind
 */
export function actionColumnOf(meta: SheetColumnMeta | undefined): ActionColumn | undefined {
    if (meta === undefined || meta.kind !== "action" || meta.raw.kind.type !== "action") return undefined;
    const known = columns.get(meta.raw);
    if (known !== undefined) return known;
    const kind = meta.raw.kind.value;
    const order = kind.cases.map((c): ActionCase => {
        const valueType = fromEastTypeValue(c.valueType) as EastType;
        const isNull = isTypeEqual(valueType, NullType);
        const encode = isNull ? () => NULL_BYTES : (encodeBeast2For(valueType) as (value: unknown) => Uint8Array);
        const decode = decodeBeast2For(valueType) as (bytes: Uint8Array) => unknown;
        return {
            name: c.case,
            label: c.label,
            state: c.state,
            tone: getSomeorUndefined(c.tone)?.type,
            icon: getSomeorUndefined(c.icon),
            next: c.next,
            take: c.take,
            valueType,
            initial: getSomeorUndefined(c.initial),
            updates: getSomeorUndefined(c.updates),
            kind: c.take.type === "button" ? "button" : c.take.type === "form" ? "form" : "choice",
            encode,
            decode,
        };
    });
    const column: ActionColumn = {
        start: kind.start,
        cases: new Map(order.map((c) => [c.name, c])),
        order,
        gate: kind.gate,
        summary: kind.summary,
        name: getSomeorUndefined(kind.name),
        title: getSomeorUndefined(kind.title),
    };
    columns.set(meta.raw, column);
    return column;
}

/**
 * The case a row is in, from its `Action` cell.
 *
 * @param cell - The cell
 * @returns The case's name, or `undefined` while nothing is taken
 */
export function caseOf(cell: SheetCellValue | undefined): string | undefined {
    return cell?.type === "Action" ? cell.value.case : undefined;
}

/**
 * The cases a row may go to by the machine alone — its state's `next`, or
 * `start` with nothing taken — in order.
 *
 * @param column - The machine
 * @param cell - The row's action cell
 * @returns The offered cases
 */
export function machineOffer(column: ActionColumn, cell: SheetCellValue | undefined): ActionCase[] {
    const at = caseOf(cell);
    const names = at === undefined ? column.start : column.cases.get(at)?.next ?? [];
    return names.flatMap((n) => { const c = column.cases.get(n); return c === undefined ? [] : [c]; });
}

/** A row's offer: the machine's, and whether the row may act now. */
export interface ActionOffer {
    /** The state the row is in, if a case is taken. */
    readonly state: ActionCase | undefined;
    /** The cases the machine offers, in order. */
    readonly offered: readonly ActionCase[];
    /** Why the row cannot act now (the column's `blocked`). */
    readonly blocked: string | undefined;
    /** The fields its draft still lacks (T6). */
    readonly incomplete: readonly string[] | undefined;
}

/**
 * A row's offer, its gate asked over its wire context. A gate that throws is
 * said as the row's blocking reason, never thrown on: a row stays drawn.
 *
 * @param column - The machine
 * @param cell - The row's action cell
 * @param ctx - The row's wire context, or `undefined` where none is built (a read-only sheet asks none)
 * @returns The offer
 */
export function offerOf(column: ActionColumn, cell: SheetCellValue | undefined, ctx: SheetContextValue | undefined): ActionOffer {
    const at = caseOf(cell);
    const state = at === undefined ? undefined : column.cases.get(at);
    const offered = machineOffer(column, cell);
    if (offered.length === 0 || ctx === undefined) return { state, offered, blocked: undefined, incomplete: undefined };
    let gate: SheetActionGateValue;
    try { gate = column.gate(ctx); } catch (error) { return { state, offered, blocked: error instanceof Error ? error.message : String(error), incomplete: undefined }; }
    if (gate.type === "blocked") return { state, offered, blocked: gate.value, incomplete: undefined };
    if (gate.type === "incomplete") return { state, offered, blocked: undefined, incomplete: gate.value };
    return { state, offered, blocked: undefined, incomplete: undefined };
}

/** Whether a row may take an offered case now. */
export function canTake(offer: ActionOffer): boolean {
    return offer.offered.length > 0 && offer.blocked === undefined && offer.incomplete === undefined;
}

/**
 * The `Action` cell a case and its value make.
 *
 * @param c - The case
 * @param bytes - Its value, encoded
 * @returns The cell
 */
export function actionCell(c: ActionCase, bytes: Uint8Array): SheetCellValue {
    return variant("Action", { case: c.name, value: bytes });
}

/** A case's label in S14's grammar: a form's verb ends in `…`; a choice's caret is drawn beside it. */
export function verbOf(c: ActionCase): string {
    return c.kind === "form" ? `${c.label}…` : c.label;
}
