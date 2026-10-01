/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

/**
 * What a step card's parts point at (#934): the slot a part opens, the input
 * it edits, what its × removes and what its add does. A card names them; the
 * slots' functions act on them.
 *
 * @packageDocumentation
 */

import type { ComparisonKind, StepKind, StepValue } from "../steps/values.js";
import type { SlotKind, TotalName } from "./messages.js";

/** A slot of a step card: what it asks for, and where. */
export interface SlotRef {
    /** What the slot asks for. */
    readonly kind: SlotKind;
    /** The step it is in; `""` for the add-step list. */
    readonly stepId: string;
    /** The condition it is in: a field, a comparison, a value or a group's match. */
    readonly condId?: string;
    /** What it is for: a total's id, a field shown's id, a model input's name. */
    readonly id?: string;
    /** The add-step list's place: before the step at this index; at the end when omitted. */
    readonly at?: number;
}

/** What an input of a step card edits. */
export type InputKind = "limit-n" | "agg-as" | "pick-as" | "fill-value" | "datepart-as" | "tab-from" | "tab-to" | "tab-step" | "tab-as";

/** An input of a step card. */
export interface InputRef {
    /** What it edits. */
    readonly kind: InputKind;
    /** The step it is in. */
    readonly stepId: string;
    /** What it is for: a total's id, a field shown's id. */
    readonly id?: string;
}

/** What a remove takes out. */
export interface RemoveRef {
    /** A condition (or a group), a total, a field shown, a field a Look up brings in. */
    readonly kind: "condition" | "total" | "pick" | "lookup-field";
    /** The step it is in. */
    readonly stepId: string;
    /** Its id; a Look up's field by its name. */
    readonly id: string;
}

/** What an add does. */
export interface ActionRef {
    /** Add a condition, a group or a total; or open a slot, as Add field does. */
    readonly kind: "add-condition" | "add-group" | "add-total" | "open";
    /** The step it is in. */
    readonly stepId: string;
    /** For a condition added to a group: the group. */
    readonly groupId?: string;
    /** For `open`: the slot. */
    readonly slot?: SlotRef;
}

/** What an item of a slot's list sets. */
export type SlotValue =
    | { readonly kind: "match"; readonly match: "all" | "any" }
    | { readonly kind: "field"; readonly ref: string }
    | { readonly kind: "all-rows" }
    | { readonly kind: "cmp"; readonly cmp: ComparisonKind }
    | { readonly kind: "value"; readonly value: StepValue }
    | { readonly kind: "dataset"; readonly name: string }
    | { readonly kind: "lookup-field"; readonly name: string }
    | { readonly kind: "total"; readonly fn: TotalName }
    | { readonly kind: "dir"; readonly dir: "asc" | "desc" }
    | { readonly kind: "part"; readonly part: "year" | "month" | "weekday" }
    | { readonly kind: "step"; readonly step: StepKind }
    | { readonly kind: "saved"; readonly name: string };

/**
 * Whether two slots are the same slot.
 *
 * @param a - a slot
 * @param b - another
 * @returns whether they ask for the same thing in the same place
 */
export function sameSlot(a: SlotRef, b: SlotRef): boolean {
    return a.kind === b.kind && a.stepId === b.stepId && a.condId === b.condId && a.id === b.id && a.at === b.at;
}
