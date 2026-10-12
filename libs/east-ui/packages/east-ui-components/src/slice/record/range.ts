/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

/** The range shared by record controls, axis navigation and a horizon brush. */
import { none, variant, type ValueTypeOf } from "@elaraai/east";
import { recordChoiceWhere, type RecordSliceBindType, type RecordSliceFieldType } from "@elaraai/east-ui/internal";
import { printRecordChoice, readRecordChoice } from "./value.js";

type Bind = ValueTypeOf<RecordSliceBindType>;
type Field = ValueTypeOf<RecordSliceFieldType>;
/** Numeric geometry; dates use epoch milliseconds, as every time canvas does. */
export interface RecordSliceRange { kind: "datetime" | "integer" | "float"; min: number; max: number }

function rangeField(slice: Bind): Field | undefined {
    const id = slice.config.range;
    return id.type === "some" ? slice.config.fields.find(field => field.fieldId === id.value) : undefined;
}
function bounds(field: Field, from: string, to: string): RecordSliceRange {
    const number = (text: string): number => {
        const value = readRecordChoice(field, text);
        if (value === undefined) throw new Error("A range endpoint must be set");
        return field.kind === "datetime" ? (value as Date).getTime() : Number(value as number | bigint);
    };
    if (field.kind !== "datetime" && field.kind !== "integer" && field.kind !== "float") throw new Error("This field has no range");
    return { kind: field.kind, min: number(from), max: number(to) };
}

/** Read the active half-open range. Exact values do not imply an axis window. */
export function recordSliceWindow(slice: Bind): RecordSliceRange | undefined {
    const field = rangeField(slice);
    const choice = field === undefined ? undefined : slice.read().where.get(field.fieldId);
    return field !== undefined && choice?.type === "range" ? bounds(field, choice.value.from, choice.value.to) : undefined;
}

/** Read the inclusive boundary extent; run under the host's tracked evaluation. */
export function recordSliceDomain(slice: Bind): RecordSliceRange | undefined {
    const field = rangeField(slice);
    if (field === undefined) return undefined;
    const domain = slice.domain(field.fieldId);
    return domain.type === "some" ? bounds(field, domain.value.from, domain.value.to) : undefined;
}

/** Set a half-open window in one validated write, retaining compatible choices. */
export function setRecordSliceWindow(slice: Bind, min: number, max: number): void {
    const field = rangeField(slice);
    if (field === undefined) return;
    const literal = (value: number) => printRecordChoice(field, field.kind === "datetime" ? new Date(value)
        : field.kind === "integer" ? BigInt(Math.round(value)) : value);
    const state = slice.read();
    const where = recordChoiceWhere(slice.config.indexes, state.where, field.fieldId,
        variant("range", { from: literal(min), to: literal(max) }));
    if (where === null) throw new Error("Choose a preceding field before changing this range");
    slice.write({ ...state, where, preset: none });
}

/** Clear the range and its dependent clauses through the handle's normal path. */
export function clearRecordSliceWindow(slice: Bind): void {
    const field = rangeField(slice);
    if (field !== undefined) slice.clear(field.fieldId);
}
