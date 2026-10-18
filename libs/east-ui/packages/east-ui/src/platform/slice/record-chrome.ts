/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

/** Record-only chrome, separate from the frozen local Slice wire. */
import { ArrayType, East, Expr, NullType, OptionType, StructType, VariantType, isSubtype, none, some, variant, type SubtypeExprOrValue, type ExprType } from "@elaraai/east";
import { RecordSliceBindType, RecordSlicesBindType } from "./record-types.js";
import { SlicePersistType } from "./index.js";

/** Controls a record can answer without evaluating row predicates. */
export const RecordSliceAffordanceType = VariantType({
    fields: NullType, search: NullType, range: NullType, presets: NullType,
    resolution: NullType, brush: NullType, summary: NullType,
});
export type RecordSliceAffordanceType = typeof RecordSliceAffordanceType;
/** Record toolbar vocabulary; rows-only controls are intentionally absent. */
export type RecordSliceAffordance = keyof RecordSliceAffordanceType["cases"];

/**
 * Record narrowing in a component's existing toolbar.
 * @property slice - Canonical controls handle; typed data stays in the component's source.
 * @property affordances - Explicit controls the host offers.
 * @property persist - Optional store persistence.
 */
export const RecordSliceChromeType = StructType({
    slice: RecordSliceBindType,
    affordances: ArrayType(RecordSliceAffordanceType),
    persist: OptionType(SlicePersistType),
});
export type RecordSliceChromeType = typeof RecordSliceChromeType;

/** Shared authoring options for a record-aware component. */
export interface RecordSliceChromeOptions {
    /** A record Slice handle, including its typed authoring form. */
    slice: SubtypeExprOrValue<RecordSliceBindType>;
    /** Controls to mount; defaults to field chips, presets and summary. */
    affordances?: readonly RecordSliceAffordance[];
    /** Persist validated narrowing in local/session storage or the URL. */
    persist?: keyof SlicePersistType["cases"];
}

/** Recognise the new handle at authoring time, before projecting its data member. */
export function isRecordSlice(input: unknown): boolean {
    const type = Expr.type(East.value(input as SubtypeExprOrValue<RecordSliceBindType>) as Expr);
    return type.type === "Struct" && type.fields.config !== undefined && type.fields.choose !== undefined;
}

/**
 * Build canonical chrome without extending the local handle or embedding its data.
 * @param options - Bound handle, requested controls and persistence.
 * @returns The record chrome payload.
 */
export function recordSliceChrome(options: RecordSliceChromeOptions): ExprType<RecordSliceChromeType> {
    const source = East.value(options.slice);
    const type = Expr.type(source as Expr);
    if (type.type !== "Struct") throw new Error("A record Slice handle is required");
    for (const [field, expected] of Object.entries(RecordSliceBindType.fields)) {
        if (type.fields[field] === undefined || !isSubtype(type.fields[field]!, expected)) throw new Error(`Invalid record Slice member '${field}'`);
    }
    const slice = East.value(Object.fromEntries(Object.keys(RecordSliceBindType.fields).map(field => [field, (source as unknown as ExprType<StructType>)[field]])) as never, RecordSliceBindType);
    const affordances = options.affordances ?? ["fields", "presets", "summary"];
    for (const affordance of affordances) {
        if (!(affordance in RecordSliceAffordanceType.cases)) throw new Error(`Record slices do not support '${affordance}'; use indexed field choices`);
    }
    return East.value({ slice, affordances: affordances.map(value => variant(value, null)), persist: options.persist === undefined ? none : some(variant(options.persist, null)) }, RecordSliceChromeType);
}

/**
 * Narrowing over several records in a component's existing toolbar: one rail
 * for every source.
 * @property slice - The product's non-generic handle; each source's typed data stays in the component's source.
 * @property affordances - Explicit controls the host offers, for every source.
 * @property persist - Optional store persistence, for every source under its own key.
 */
export const RecordSlicesChromeType = StructType({
    slice: RecordSlicesBindType,
    affordances: ArrayType(RecordSliceAffordanceType),
    persist: OptionType(SlicePersistType),
});
export type RecordSlicesChromeType = typeof RecordSlicesChromeType;

/** Shared authoring options for a component narrowed over several records. */
export interface RecordSlicesChromeOptions {
    /** A `Slice.bindRecords` handle, including its typed authoring form. */
    slice: SubtypeExprOrValue<RecordSlicesBindType>;
    /** Controls to mount; defaults to field chips, presets and summary. */
    affordances?: readonly RecordSliceAffordance[];
    /** Persist validated narrowing in local/session storage or the URL. */
    persist?: keyof SlicePersistType["cases"];
}

/** Recognise a `Slice.bindRecords` handle at authoring time. */
export function isRecordSlices(input: unknown): boolean {
    const type = Expr.type(East.value(input as SubtypeExprOrValue<RecordSlicesBindType>) as Expr);
    return type.type === "Struct" && type.fields.parts !== undefined && type.fields.togglePreset !== undefined;
}

/**
 * Build the chrome over several records, evaluating the handle once and
 * dropping each source's typed data.
 * @param options - Bound handle, requested controls and persistence.
 * @returns The chrome payload.
 * @throws {Error} When the handle is not `Slice.bindRecords`', or an affordance is not a record one
 */
export function recordSlicesChrome(options: RecordSlicesChromeOptions): ExprType<RecordSlicesChromeType> {
    const source = East.value(options.slice);
    const type = Expr.type(source as Expr);
    if (type.type !== "Struct") throw new Error("A Slice.bindRecords handle is required");
    for (const [field, expected] of Object.entries(RecordSlicesBindType.fields)) {
        if (type.fields[field] === undefined || !isSubtype(type.fields[field]!, expected)) throw new Error(`Invalid Slice.bindRecords member '${field}'`);
    }
    const affordances = options.affordances ?? ["fields", "presets", "summary"];
    for (const affordance of affordances) {
        if (!(affordance in RecordSliceAffordanceType.cases)) throw new Error(`Record slices do not support '${affordance}'; use indexed field choices`);
    }
    const slice = East.function([], RecordSlicesBindType, $ => {
        const handle = $.const(source) as unknown as ExprType<StructType>;
        return Object.fromEntries(Object.keys(RecordSlicesBindType.fields).map(field => [field, (handle as unknown as Record<string, unknown>)[field]])) as never;
    })();
    return East.value({ slice, affordances: affordances.map(value => variant(value, null)), persist: options.persist === undefined ? none : some(variant(options.persist, null)) }, RecordSlicesChromeType);
}
