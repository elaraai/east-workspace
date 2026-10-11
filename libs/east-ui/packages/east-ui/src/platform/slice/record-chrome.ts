/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

/** Record-only chrome, separate from the frozen local Slice wire. */
import { ArrayType, East, Expr, NullType, OptionType, StructType, VariantType, isSubtype, none, some, variant, type SubtypeExprOrValue, type ExprType } from "@elaraai/east";
import { RecordSliceBindType } from "./record-types.js";
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
