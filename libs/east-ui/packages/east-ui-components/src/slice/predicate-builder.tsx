/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

import { isEastSet, type ValueTypeOf, variant } from "@elaraai/east";
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
    { tag: "startsWith", glyph: "starts with" },
    { tag: "endsWith", glyph: "ends with" },
    { tag: "isEmpty", glyph: "is empty", input: "none" },
    { tag: "isNotEmpty", glyph: "is not empty", input: "none" },
];
// Integer supports eq/neq/ordering plus set-membership `in` (#166); float is
// ordered-only (the apply engine omits float equality — float `eq` is
// unreliable). Keep these aligned with `matchIntegerOp` / `matchFloatOp` in
// the platform impl.
const INTEGER_OPS: ReadonlyArray<ClauseOpSpec> = [
    { tag: "eq", glyph: "=" }, { tag: "neq", glyph: "≠" },
    { tag: "gt", glyph: ">" }, { tag: "gte", glyph: "≥" },
    { tag: "lt", glyph: "<" }, { tag: "lte", glyph: "≤" },
    { tag: "in", glyph: "in", input: "set" },
];
const FLOAT_OPS: ReadonlyArray<ClauseOpSpec> = [
    { tag: "gt", glyph: ">" }, { tag: "gte", glyph: "≥" },
    { tag: "lt", glyph: "<" }, { tag: "lte", glyph: "≤" },
];
// Keep datetime aligned with `matchDateTimeOp` — `between` is the range op
// the engine has always implemented; the builder now exposes it (#166).
const OPS_BY_KIND: Record<string, ReadonlyArray<ClauseOpSpec>> = {
    string:   STRING_OPS,
    integer:  INTEGER_OPS,
    float:    FLOAT_OPS,
    datetime: [
        { tag: "before", glyph: "before" },
        { tag: "after", glyph: "after" },
        { tag: "between", glyph: "between", input: "range" },
    ],
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
/**
 * Convert a raw {@link ClauseSubmitValue} value into the typed payload the
 * predicate's op variant carries, per (kind, op). The shared controls emit
 * `string[]` for set inputs and `{ min, max }` for range inputs; the East op
 * types want typed Sets and `{ from, to }` ranges:
 *
 * - string `in`/`notIn` — `string[]` → `Set<string>`
 * - integer `in` — `string[]` → `Set<bigint>` via a safe parse; a malformed
 *   entry ("abc", "1.5") is dropped, never a crash (#166)
 * - datetime `between` — `{ min, max }` Dates → `{ from, to }` (`DateTimeRangeType`)
 *
 * @param kind - the field's primitive kind
 * @param op - the operator tag
 * @param raw - the value the clause control produced
 * @returns the typed op payload, or `undefined` when nothing valid remains
 *          (an all-malformed integer set) — the caller skips the add
 */
export function predicateOpValue(kind: string, op: string, raw: unknown): unknown {
    if (op === "in" || op === "notIn") {
        const entries = raw as string[];
        if (kind === "integer") {
            const parsed = new Set<bigint>();
            for (const e of entries) {
                try { parsed.add(BigInt(e.trim())); } catch { /* drop malformed entry */ }
            }
            return parsed.size > 0 ? parsed : undefined;
        }
        return new Set(entries);
    }
    if (op === "between" && kind === "datetime") {
        const { min, max } = raw as { min: Date; max: Date };
        return { from: min, to: max };
    }
    return raw;
}

/**
 * The inverse of {@link predicateOpValue}: convert a predicate op's typed
 * payload into the shape the shared clause CONTROLS edit, for seeding the
 * builder in edit mode. Set members become the TagsInput's string entries
 * (bigints stringify — `predicateOpValue` parses them back on submit), and a
 * datetime `between`'s `{ from, to }` becomes the range pair's `{ min, max }`.
 * Without this an integer in-set seeded the validity check with bigints
 * (`s.trim is not a function` at mount) and a between seed fed the whole
 * range object to a single date field.
 *
 * @param kind - the field's primitive kind
 * @param op - the operator tag
 * @param raw - the typed payload the predicate's op variant carries
 * @returns the control-shaped seed value
 */
export function predicateControlValue(kind: string, op: string, raw: unknown): unknown {
    if (op === "in" || op === "notIn") {
        return isEastSet(raw) ? [...raw].map(v => String(v)) : raw;
    }
    if (op === "between" && kind === "datetime") {
        const { from, to } = raw as { from: Date; to: Date };
        return { min: from, max: to };
    }
    return raw;
}

export function SlicePredicateBuilder({ fields, onAdd, initial, lockField, submitLabel }: SlicePredicateBuilderProps) {
    const seed = initial as { type: string; value: { fieldId: string; op: { type: string; value: unknown } } } | undefined;

    const onSubmit = (clause: ClauseSubmitValue) => {
        const opValue = predicateOpValue(clause.kind, clause.op, clause.value);
        if (opValue === undefined) return;
        onAdd(variant(clause.kind, { fieldId: clause.fieldId, op: variant(clause.op, opValue) }) as PredicateValue);
    };

    return (
        <ClauseBuilder
            fields={fields.map(f => ({ id: f.fieldId, label: f.label, kind: f.kind as ClauseKind, hints: f.hints }))}
            opsFor={kind => OPS_BY_KIND[kind] ?? STRING_OPS}
            onSubmit={onSubmit}
            {...(seed !== undefined ? {
                initial: {
                    fieldId: seed.value.fieldId,
                    op: seed.value.op.type,
                    value: predicateControlValue(seed.type, seed.value.op.type, seed.value.op.value),
                },
            } : {})}
            {...(lockField !== undefined ? { lockField } : {})}
            {...(submitLabel !== undefined ? { submitLabel } : {})}
            size="sm"
        />
    );
}
