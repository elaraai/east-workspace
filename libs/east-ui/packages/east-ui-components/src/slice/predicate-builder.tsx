/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

import { type ValueTypeOf, variant } from "@elaraai/east";
import { Slice } from "@elaraai/east-ui/internal";
import { ClauseBuilder, type ClauseKind, type ClauseOpSpec, type ClauseSubmitValue } from "../forms/clause-builder/index.js";

/** One filterable field descriptor (from `Slice.apply.fields`). */
export type SliceFieldValue = ValueTypeOf<typeof Slice.Types.Field>;
/** A built predicate value (`Slice.Types.Predicate`). */
type PredicateValue = ValueTypeOf<typeof Slice.Types.Predicate>;

/** Operator choices per field kind — tag drives the predicate, glyph the label. */
const STRING_OPS: ReadonlyArray<ClauseOpSpec> = [
    { tag: "contains", glyph: "contains" },
    { tag: "eq", glyph: "=" },
    { tag: "neq", glyph: "≠" },
    { tag: "in", glyph: "in", input: "set" },
    { tag: "notIn", glyph: "not in", input: "set" },
    { tag: "matches", glyph: "~" },
];
// Integer supports eq/neq/in; float is ordered-only (the apply engine omits
// float equality — float `eq` is unreliable). Keep these aligned with
// `matchIntegerOp` / `matchFloatOp` in the platform impl.
const INTEGER_OPS: ReadonlyArray<ClauseOpSpec> = [
    { tag: "eq", glyph: "=" }, { tag: "neq", glyph: "≠" },
    { tag: "gt", glyph: ">" }, { tag: "gte", glyph: "≥" },
    { tag: "lt", glyph: "<" }, { tag: "lte", glyph: "≤" },
];
const FLOAT_OPS: ReadonlyArray<ClauseOpSpec> = [
    { tag: "gt", glyph: ">" }, { tag: "gte", glyph: "≥" },
    { tag: "lt", glyph: "<" }, { tag: "lte", glyph: "≤" },
];
const OPS_BY_KIND: Record<string, ReadonlyArray<ClauseOpSpec>> = {
    string:   STRING_OPS,
    integer:  INTEGER_OPS,
    float:    FLOAT_OPS,
    datetime: [{ tag: "before", glyph: "before" }, { tag: "after", glyph: "after" }],
    boolean:  [{ tag: "is", glyph: "is" }],
};

export interface SlicePredicateBuilderProps {
    fields: ReadonlyArray<SliceFieldValue>;
    /** Called with the built predicate on submit. */
    onAdd: (pred: PredicateValue) => void;
    /** Seed the form from an existing clause (edit mode) — field/op/value prefilled. */
    initial?: PredicateValue;
    /** Lock the field to the seeded one (the editor changes op / value, not field). */
    lockField?: boolean;
    /** Submit-button label (default `Add`). */
    submitLabel?: string;
}

/**
 * Slice adapter over the shared {@link ClauseBuilder}: maps `Slice.apply`
 * field descriptors and the slice operator sets in, and builds a typed
 * `Slice.Types.Predicate` value from the submitted clause. The control
 * composition (selects, typed inputs, tags input, density sizing) is the
 * shared primitive's — `Slice.Filter` and `Slice.Cohort` use this in both
 * add-clause and edit-clause flows.
 */
export function SlicePredicateBuilder({ fields, onAdd, initial, lockField, submitLabel }: SlicePredicateBuilderProps) {
    const seed = initial as { type: string; value: { fieldId: string; op: { type: string; value: unknown } } } | undefined;

    const onSubmit = (clause: ClauseSubmitValue) => {
        const opValue = clause.op === "in" || clause.op === "notIn"
            ? new Set(clause.value as string[])
            : clause.value;
        onAdd(variant(clause.kind, { fieldId: clause.fieldId, op: variant(clause.op, opValue) }) as PredicateValue);
    };

    return (
        <ClauseBuilder
            fields={fields.map(f => ({ id: f.fieldId, label: f.label, kind: f.kind as ClauseKind, hints: f.hints }))}
            opsFor={kind => OPS_BY_KIND[kind] ?? STRING_OPS}
            onSubmit={onSubmit}
            {...(seed !== undefined ? {
                initial: { fieldId: seed.value.fieldId, op: seed.value.op.type, value: seed.value.op.value },
            } : {})}
            {...(lockField !== undefined ? { lockField } : {})}
            {...(submitLabel !== undefined ? { submitLabel } : {})}
            size="sm"
        />
    );
}
