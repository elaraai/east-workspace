/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

import { useState } from "react";
import { Box, chakra, useRecipe, useSlotRecipe } from "@chakra-ui/react";
import { type ValueTypeOf, variant, some } from "@elaraai/east";
import { Slice } from "@elaraai/east-ui";
import {
    EastChakraStringInput,
    EastChakraIntegerInput,
    EastChakraFloatInput,
    EastChakraDateTimeInput,
    EastChakraTagsInput,
} from "../forms";

/** One filterable field descriptor (from `Slice.apply.fields`). */
export type SliceFieldValue = ValueTypeOf<typeof Slice.Types.Field>;
/** A built predicate value (`Slice.Types.Predicate`). */
type PredicateValue = ValueTypeOf<typeof Slice.Types.Predicate>;

/** Operator choices per field kind — tag drives the predicate, glyph the label. */
const STRING_OPS: ReadonlyArray<{ tag: string; glyph: string }> = [{ tag: "contains", glyph: "contains" }, { tag: "eq", glyph: "=" }, { tag: "neq", glyph: "≠" }, { tag: "in", glyph: "in" }, { tag: "notIn", glyph: "not in" }, { tag: "matches", glyph: "~" }];
// Integer supports eq/neq/in; float is ordered-only (the apply engine omits
// float equality — float `eq` is unreliable). Keep these aligned with
// `matchIntegerOp` / `matchFloatOp` in the platform impl.
const INTEGER_OPS: ReadonlyArray<{ tag: string; glyph: string }> = [{ tag: "eq", glyph: "=" }, { tag: "neq", glyph: "≠" }, { tag: "gt", glyph: ">" }, { tag: "gte", glyph: "≥" }, { tag: "lt", glyph: "<" }, { tag: "lte", glyph: "≤" }];
const FLOAT_OPS: ReadonlyArray<{ tag: string; glyph: string }> = [{ tag: "gt", glyph: ">" }, { tag: "gte", glyph: "≥" }, { tag: "lt", glyph: "<" }, { tag: "lte", glyph: "≤" }];
const OPS_BY_KIND: Record<string, ReadonlyArray<{ tag: string; glyph: string }>> = {
    string:   STRING_OPS,
    integer:  INTEGER_OPS,
    float:    FLOAT_OPS,
    datetime: [{ tag: "before", glyph: "before" }, { tag: "after", glyph: "after" }],
    boolean:  [{ tag: "is", glyph: "is" }],
};
const opsFor = (kind: string): ReadonlyArray<{ tag: string; glyph: string }> => OPS_BY_KIND[kind] ?? STRING_OPS;

/** Is this a set-valued op (`in` / `notIn`)? Authored via a `TagsInput`. */
const isSetOp = (kind: string, opTag: string) => kind === "string" && (opTag === "in" || opTag === "notIn");

/** Empty value matching the (kind, op) — the typed input owns parsing from here. */
function emptyValue(kind: string, opTag: string): unknown {
    if (kind === "integer") return 0n;
    if (kind === "float") return 0;
    if (kind === "datetime") return new Date();
    if (kind === "boolean") return false;
    if (isSetOp(kind, opTag)) return [] as string[];
    return "";
}

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
 * Inline field → operator → value form shared by `Slice.Filter` and
 * `Slice.Cohort`, in both add-clause and edit-clause flows. The value field is
 * a **typed `forms/input` renderer** chosen by the field's kind (Integer /
 * Float / DateTime / String, `TagsInput` for set ops, a select for boolean), so
 * it parses to the correct East type natively — no string parsing here. `initial`
 * seeds directly from the clause's typed `op.value`; `lockField` pins the field.
 */
export function SlicePredicateBuilder({ fields, onAdd, initial, lockField, submitLabel }: SlicePredicateBuilderProps) {
    const styles = useSlotRecipe({ key: "sliceEdit" })();
    const btn = useRecipe({ key: "button" });
    // All three builder controls share the canonical `input` chrome at one size
    // so the field / op selects and the typed value input line up.
    const controlCss = useRecipe({ key: "input" })({ size: "sm" });
    const controlStyle = some({ size: some(variant("sm", null)) });
    const seed = initial as { type: string; value: { fieldId: string; op: { type: string; value: unknown } } } | undefined;

    const [fieldId, setFieldId] = useState(seed?.value.fieldId ?? fields[0]?.fieldId ?? "");
    const field = fields.find(f => f.fieldId === fieldId) ?? fields[0];
    const kind = field?.kind ?? "string";
    const ops = opsFor(kind);
    const [opTag, setOpTag] = useState(seed?.value.op.type ?? ops[0]!.tag);
    const validOpTag = ops.some(o => o.tag === opTag) ? opTag : ops[0]!.tag;
    // The clause's `op.value` is already the decoded typed value; a set arrives
    // as a `Set` and feeds the `TagsInput` as an array.
    const [val, setVal] = useState<unknown>(
        seed !== undefined
            ? (seed.value.op.value instanceof Set ? [...seed.value.op.value] : seed.value.op.value)
            : emptyValue(kind, validOpTag),
    );

    const onFieldChange = (nextId: string) => {
        const nextKind = fields.find(f => f.fieldId === nextId)?.kind ?? "string";
        const nextOp = opsFor(nextKind)[0]!.tag;
        setFieldId(nextId);
        setOpTag(nextOp);
        setVal(emptyValue(nextKind, nextOp));
    };
    const onOpChange = (nextOp: string) => {
        setOpTag(nextOp);
        setVal(emptyValue(kind, nextOp));
    };

    const isSet = isSetOp(kind, validOpTag);

    const add = () => {
        if (field === undefined) return;
        let opValue: unknown = val;
        if (isSet) {
            const arr = (val as string[]).map(s => s.trim()).filter(Boolean);
            if (arr.length === 0) return;
            opValue = new Set(arr);
        } else if (kind === "string" && String(val).trim() === "") {
            return;
        }
        onAdd(variant(kind, { fieldId: field.fieldId, op: variant(validOpTag, opValue) }) as PredicateValue);
        if (initial === undefined) setVal(emptyValue(kind, validOpTag));
    };

    const fieldControl = lockField
        ? <Box as="span" css={styles.clauseField} aria-label="Field">{field?.label}</Box>
        : (
            <chakra.select css={controlCss} value={fieldId} onChange={e => onFieldChange(e.target.value)} aria-label="Field">
                {fields.map(f => <option key={f.fieldId} value={f.fieldId}>{f.label}</option>)}
            </chakra.select>
        );
    const opControl = (
        <chakra.select css={controlCss} value={validOpTag} onChange={e => onOpChange(e.target.value)} aria-label="Operator">
            {ops.map(o => <option key={o.tag} value={o.tag}>{o.glyph}</option>)}
        </chakra.select>
    );
    const valueControl = kind === "boolean" ? (
        <chakra.select css={controlCss} value={String(val)} onChange={e => setVal(e.target.value === "true")} aria-label="Value">
            <option value="true">true</option>
            <option value="false">false</option>
        </chakra.select>
    ) : isSet ? (
        <EastChakraTagsInput value={{ value: val as string[], placeholder: some("a, b, c"), onChange: some((v: string[]) => setVal(v)), style: controlStyle } as never} />
    ) : kind === "integer" ? (
        <EastChakraIntegerInput value={{ value: val as bigint, onChange: some((v: bigint) => setVal(v)), style: controlStyle } as never} />
    ) : kind === "float" ? (
        <EastChakraFloatInput value={{ value: val as number, onChange: some((v: number) => setVal(v)), style: controlStyle } as never} />
    ) : kind === "datetime" ? (
        <EastChakraDateTimeInput value={{ value: val as Date, onChange: some((v: Date) => setVal(v)), style: controlStyle } as never} />
    ) : (
        <EastChakraStringInput value={{ value: String(val ?? ""), onChange: some((v: string) => setVal(v)), style: controlStyle } as never} />
    );
    const addButton = <chakra.button type="button" onClick={add} css={btn({ variant: "solid", size: "xs" })}>{submitLabel ?? "Add"}</chakra.button>;

    // Set ops (`in` / `not in`) author a `TagsInput` that grows with the values;
    // give it its own full-width line so the tags never cram into a 1fr column.
    if (isSet) {
        return (
            <Box display="flex" flexDirection="column" gap="{spacing.2}" minWidth="0">
                <Box display="flex" alignItems="center" gap="{spacing.2}" minWidth="0">
                    {fieldControl}
                    {opControl}
                </Box>
                <Box width="full" minWidth="0">{valueControl}</Box>
                <Box display="flex" justifyContent="flex-end">{addButton}</Box>
            </Box>
        );
    }
    return (
        <Box css={styles.builderRow}>
            {fieldControl}
            {opControl}
            {valueControl}
            {addButton}
        </Box>
    );
}
