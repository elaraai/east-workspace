/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

/**
 * A well of a decoded view (#1672, EDT-3 to EDT-5), read and written by its
 * declaration (`editors.ts`): its pills ({@link wellPills},
 * {@link withWellPills}), whether it takes a field ({@link fieldFits}) and
 * how many ({@link wellMost}) — and its pills edited: one placed, moved,
 * taken out or replaced ({@link placedInWell}, {@link movedInWell},
 * {@link removedFromWell}, {@link replacedInWell}), and the fields they
 * read ({@link pillFields}, {@link placedFields}). Plain TypeScript over
 * decoded values, through which the inspector's renderer edits.
 *
 * @packageDocumentation
 */

import { ArrayType, OptionType, StringType, isValueOf, none, some, variant, type EastType, type ValueTypeOf } from "@elaraai/east";
import {
    StudioAxisValueType,
    StudioGroupType,
    StudioValueType,
    StudioVisuals,
    type StudioAxisValue,
    type StudioGroup,
    type StudioValue,
    type StudioView,
} from "./content.js";
import { StudioPillType, type StudioKindEditor, type StudioPill, type StudioWell } from "./editors.js";
import { isOf, kindStruct, withKindField } from "./kind.js";
import type { StudioFieldType } from "./source.js";

/** A source's field, decoded. */
type StudioField = ValueTypeOf<typeof StudioFieldType>;

/** A group well with no field placed in it: what the tile lists as a well to fill. */
export const EMPTY_GROUP: StudioGroup = StudioVisuals.group("");
/** A value well's value until a field is placed in it: how many rows. */
export const COUNT: StudioValue = StudioVisuals.count();

// ============================================================================
// Reading and writing a well
// ============================================================================

/**
 * Whether a well takes a field: its kind among those the well accepts (EDT-4).
 *
 * @param held - The well
 * @param field - The source's field
 * @returns Whether the field may be placed in it
 */
export function fieldFits(held: StudioWell, field: StudioField): boolean {
    return held.accepts.length === 0 || held.accepts.some((kind) => kind.type === field.kind.type);
}

/**
 * The most pills a list well takes as a view stands: one while the field
 * that holds it to one is set (CHT-2), else its own most.
 *
 * @param view - The view
 * @param held - The well
 * @returns The most; `undefined` for any number
 */
export function wellMost(view: StudioView, held: StudioWell): number | undefined {
    if (held.one.type === "some") {
        const by = kindStruct(view)?.struct[held.one.value];
        if (isOf(by, OptionType(StringType)) && by.type === "some") return 1;
    }
    return held.most.type === "some" ? Number(held.most.value) : undefined;
}

/** The East type of a well's pills' payload. */
function payloadType(held: StudioWell): EastType {
    switch (held.holds.type) {
        case "value": return StudioValueType;
        case "axis": return StudioAxisValueType;
        case "group": return StudioGroupType;
        case "field": return StringType;
    }
}

/** What a single well holds once its pill is taken out: a group of no field, a count of the rows, no field. */
function emptied(held: StudioWell): StudioValue | StudioAxisValue | StudioGroup | string {
    switch (held.holds.type) {
        case "value": return COUNT;
        case "axis": return { value: COUNT, right: false };
        case "group": return EMPTY_GROUP;
        case "field": return "";
    }
}

/** Whether a single well's payload is no pill: a group of no field, or no field. */
function isEmptyPayload(held: StudioWell, payload: unknown): boolean {
    if (held.holds.type === "group") return isOf(payload, StudioGroupType) && payload.field === "";
    if (held.holds.type === "field") return payload === "";
    return false;
}

/**
 * A well's pills, as a view holds them: a list's in order; a single well's
 * one, or none where it is empty — an Option that is none, a group of no
 * field, no field.
 *
 * @param view - The view
 * @param held - The well, of the view's kind's editor
 * @returns Its pills
 * @throws {Error} When the view's kind has no such field, or it holds what the well does not
 */
export function wellPills(view: StudioView, held: StudioWell): StudioPill[] {
    const struct = kindStruct(view)?.struct;
    if (struct === undefined || !(held.field in struct)) throw new Error(`Studio: the ${held.label} well's field "${held.field}" is not its kind's`);
    const at = struct[held.field];
    const type = payloadType(held);
    let payloads: readonly unknown[];
    if (held.list) {
        if (!Array.isArray(at) || !isValueOf(at, ArrayType(type))) throw new Error(`Studio: the ${held.label} well's field "${held.field}" is no list of its pills`);
        payloads = at;
    } else if (held.optional) {
        const option = OptionType(type);
        if (!isOf(at, option)) throw new Error(`Studio: the ${held.label} well's field "${held.field}" is no Option of its pill`);
        payloads = at.type === "some" ? [at.value] : [];
    } else {
        payloads = isEmptyPayload(held, at) ? [] : [at];
    }
    const pills = payloads.map((payload) => variant(held.holds.type, payload));
    if (!isOf(pills, ArrayType(StudioPillType))) throw new Error(`Studio: the ${held.label} well holds what is no pill of it`);
    return pills;
}

/**
 * A view with a well's pills replaced: a list's in their order; a single
 * well's one — none, or a taken-out pill, leaving an Option none, a group of
 * no field, a count of the rows, or no field.
 *
 * @param view - The view
 * @param held - The well, of the view's kind's editor
 * @param pills - Its pills
 * @returns The view
 * @throws {Error} When a pill is not what the well holds
 */
export function withWellPills(view: StudioView, held: StudioWell, pills: readonly StudioPill[]): StudioView {
    if (pills.some((pill) => pill.type !== held.holds.type)) throw new Error(`Studio: the ${held.label} well takes ${held.holds.type} pills`);
    const payloads = pills.map((pill) => pill.value);
    const first = payloads[0];
    const value = held.list ? payloads
        : held.optional ? (first === undefined ? none : some(first))
            : first ?? emptied(held);
    return withKindField(view, held.field, value);
}

// ============================================================================
// A well's pills, edited
// ============================================================================

/** The fields a measure reads: its field, a ratio's two, a count's none. */
function measureFields(measure: StudioValue["measure"]): string[] {
    switch (measure.type) {
        case "count": return [];
        case "ratio": return [measure.value.of, measure.value.per];
        default: return [measure.value];
    }
}

/**
 * The fields a pill reads: a value's measure's — a ratio's two, a count's
 * none — a group's or a field's own, and none of an empty one.
 *
 * @param pill - The pill
 * @returns Its fields, in order
 */
export function pillFields(pill: StudioPill): string[] {
    switch (pill.type) {
        case "value": return measureFields(pill.value.measure);
        case "axis": return measureFields(pill.value.value.measure);
        case "group": return pill.value.field === "" ? [] : [pill.value.field];
        case "field": return pill.value === "" ? [] : [pill.value];
    }
}

/**
 * The fields a view's wells read, each once, in its wells' order: what the
 * Fields list checks (EDT-3).
 *
 * @param view - The view
 * @param editor - Its kind's editor
 * @returns The fields
 */
export function placedFields(view: StudioView, editor: StudioKindEditor): string[] {
    const placed: string[] = [];
    for (const held of editor.wells) {
        for (const pill of wellPills(view, held)) {
            for (const field of pillFields(pill)) {
                if (!placed.includes(field)) placed.push(field);
            }
        }
    }
    return placed;
}

/**
 * A view with a pill placed in a well (EDT-5): a single well's pill
 * replaced; a list well's appended — or put at `at` — while the list holds
 * fewer than it takes ({@link wellMost}).
 *
 * @param view - The view
 * @param held - The well, of the view's kind's editor
 * @param pill - The pill
 * @param at - Where in a list well it goes; at its end unless given
 * @returns The view; `undefined` when the list is full
 */
export function placedInWell(view: StudioView, held: StudioWell, pill: StudioPill, at?: number): StudioView | undefined {
    if (!held.list) return withWellPills(view, held, [pill]);
    const pills = wellPills(view, held);
    const most = wellMost(view, held);
    if (most !== undefined && pills.length >= most) return undefined;
    const to = at === undefined ? pills.length : Math.max(0, Math.min(at, pills.length));
    return withWellPills(view, held, [...pills.slice(0, to), pill, ...pills.slice(to)]);
}

/**
 * A view with a list well's pill moved from one place to another (EDT-5): its
 * grip, ⌥↑ and ⌥↓. A move to where it is, or from or to no place in the list,
 * leaves the view as it is.
 *
 * @param view - The view
 * @param held - The list well
 * @param from - Where the pill is
 * @param to - Where it goes
 * @returns The view
 */
export function movedInWell(view: StudioView, held: StudioWell, from: number, to: number): StudioView {
    const pills = wellPills(view, held);
    const pill = pills[from];
    if (pill === undefined || to < 0 || to >= pills.length || from === to) return view;
    const rest = pills.filter((_pill, at) => at !== from);
    return withWellPills(view, held, [...rest.slice(0, to), pill, ...rest.slice(to)]);
}

/**
 * A view with a well's pill taken out: a single well left empty — an Option
 * none, a group of no field, the rows' count, or no field.
 *
 * @param view - The view
 * @param held - The well
 * @param at - Where the pill is
 * @returns The view; as it is when no pill is there
 */
export function removedFromWell(view: StudioView, held: StudioWell, at: number): StudioView {
    const pills = wellPills(view, held);
    if (pills[at] === undefined) return view;
    return withWellPills(view, held, pills.filter((_pill, i) => i !== at));
}

/**
 * A view with a well's pill replaced: what a pill's menu edits.
 *
 * @param view - The view
 * @param held - The well
 * @param at - Where the pill is
 * @param pill - Its new pill
 * @returns The view; as it is when no pill is there
 */
export function replacedInWell(view: StudioView, held: StudioWell, at: number, pill: StudioPill): StudioView {
    const pills = wellPills(view, held);
    if (pills[at] === undefined) return view;
    return withWellPills(view, held, pills.map((was, i) => (i === at ? pill : was)));
}
