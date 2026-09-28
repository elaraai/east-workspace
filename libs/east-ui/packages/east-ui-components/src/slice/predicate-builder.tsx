/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

import {
    IntegerType,
    SortedSet,
    StringType,
    compareFor,
    isEastSet,
    isValueOf,
    parseFor,
    printFor,
    variant,
    type ValueTypeOf,
} from "@elaraai/east";
import { Slice } from "@elaraai/east-ui/internal";
import { ClauseBuilder, type ClauseKind, type ClauseOpSpec, type ClauseSubmitValue } from "../forms/clause-builder/index.js";

/** One filterable field descriptor (from `Slice.apply.fields`). */
export type SliceFieldValue = ValueTypeOf<typeof Slice.Types.Field>;
/** A built predicate value (`Slice.Types.Predicate`). */
type PredicateValue = ValueTypeOf<typeof Slice.Types.Predicate>;

const readInteger = parseFor(IntegerType);
const printInteger = printFor(IntegerType);
const compareIntegers = compareFor(IntegerType);
const compareStrings = compareFor(StringType);

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
 * - string `in`/`notIn` — `string[]` → an East `Set<String>`
 * - integer `in` — `string[]` → an East `Set<Integer>`, each entry read by
 *   East's parser; a malformed entry ("abc", "1.5", one past 64 bits) is
 *   dropped, never a crash (#166)
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
            const members = new SortedSet<bigint>(undefined, compareIntegers);
            for (const entry of entries) {
                const read = readInteger(entry);
                if (read.success) members.add(read.value);
            }
            return members.size > 0 ? members : undefined;
        }
        return new SortedSet<string>(entries, compareStrings);
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
 * builder in edit mode. Set members become the TagsInput's string entries (an
 * Integer as East prints it — `predicateOpValue` reads it back on submit), and a
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
        return isEastSet(raw)
            ? [...raw].map(member => (kind === "integer" ? printInteger(member as bigint) : member as string))
            : raw;
    }
    if (op === "between" && kind === "datetime") {
        const { from, to } = raw as { from: Date; to: Date };
        return { min: from, max: to };
    }
    return raw;
}

export function SlicePredicateBuilder({ fields, onAdd, initial, lockField, submitLabel }: SlicePredicateBuilderProps) {
    const onSubmit = (clause: ClauseSubmitValue) => {
        const opValue = predicateOpValue(clause.kind, clause.op, clause.value);
        if (opValue === undefined) return;
        const predicate = variant(clause.kind, { fieldId: clause.fieldId, op: variant(clause.op, opValue) });
        // The clause's kind and op are strings at run time, so East checks the
        // built value is a `Slice.Types.Predicate` before it leaves the builder.
        if (!isValueOf(predicate, Slice.Types.Predicate)) {
            throw new Error(`SlicePredicateBuilder: a ${clause.kind} "${clause.op}" clause built no Slice predicate`);
        }
        onAdd(predicate as PredicateValue);
    };

    return (
        <ClauseBuilder
            fields={fields.map(f => ({ id: f.fieldId, label: f.label, kind: f.kind as ClauseKind, hints: f.hints }))}
            opsFor={kind => OPS_BY_KIND[kind] ?? STRING_OPS}
            onSubmit={onSubmit}
            {...(initial !== undefined ? {
                initial: {
                    fieldId: initial.value.fieldId,
                    op: initial.value.op.type,
                    value: predicateControlValue(initial.type, initial.value.op.type, initial.value.op.value),
                },
            } : {})}
            {...(lockField !== undefined ? { lockField } : {})}
            {...(submitLabel !== undefined ? { submitLabel } : {})}
            size="sm"
        />
    );
}
