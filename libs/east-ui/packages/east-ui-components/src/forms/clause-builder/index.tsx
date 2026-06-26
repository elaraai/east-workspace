/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

/**
 * `ClauseBuilder` — the shared field → operator → value authoring row.
 *
 * One primitive behind every clause-building surface: Slice.Edit's filter /
 * cohort builders and the decision judgement panel's constraint inject. The
 * consumer supplies the field vocabulary and the per-kind operator set; the
 * builder owns control composition — the real `EastChakraSelect` for field /
 * operator / boolean, the typed `forms/input` renderers for values (so
 * parsing to the correct East type happens natively), `TagsInput` for
 * set-valued ops, and a min – max pair for range ops. Control size follows
 * the density cascade (`condensed`/`compact` → `sm`, `comfortable` → `md`)
 * unless overridden.
 *
 * `ClauseChip` renders an authored clause back as the compact
 * field · op · value chip, so authored clauses read identically everywhere.
 *
 * @packageDocumentation
 */

import { useMemo, useRef, useState, type ReactNode } from "react";
import { Box, chakra, useRecipe, useSlotRecipe } from "@chakra-ui/react";
import { some, none, variant } from "@elaraai/east";
import { useDensity } from "../../contracts/density.js";
import { EastChakraSelect } from "../select/index.js";
import { EastChakraStringInput, EastChakraIntegerInput, EastChakraFloatInput, EastChakraDateTimeInput } from "../input/index.js";
import { EastChakraTagsInput } from "../tags-input/index.js";

/** The primitive kinds a clause field can have. */
export type ClauseKind = "string" | "integer" | "float" | "datetime" | "boolean";

/** One authorable field: id (the clause's subject), display label, kind, and
 *  optional autocomplete hints for the set / string value controls (#131). */
export interface ClauseFieldSpec {
    readonly id: string;
    readonly label: string;
    readonly kind: ClauseKind;
    readonly hints?: readonly string[];
}

/** One operator choice: `tag` identifies it, `glyph` is the label, `input`
 *  picks the value control (`single` default; `set` → TagsInput; `range` →
 *  min – max pair; `none` → no value control). */
export interface ClauseOpSpec {
    readonly tag: string;
    readonly glyph: string;
    readonly input?: "single" | "set" | "range" | "none";
}

/** An authored clause handed to `onSubmit`. `value` is the typed value the
 *  control produced: `string`/`bigint`/`number`/`Date`/`boolean` for single,
 *  `string[]` for set, `{ min, max }` for range, `null` for none. */
export interface ClauseSubmitValue {
    readonly fieldId: string;
    readonly kind: ClauseKind;
    readonly op: string;
    readonly value: unknown;
}

export interface ClauseBuilderProps {
    fields: ReadonlyArray<ClauseFieldSpec>;
    /** Operator choices per kind. */
    opsFor: (kind: ClauseKind) => ReadonlyArray<ClauseOpSpec>;
    onSubmit: (clause: ClauseSubmitValue) => void;
    /** Seed the form (edit mode) — field/op/value prefilled. */
    initial?: { fieldId: string; op: string; value: unknown };
    /** Lock the field to the seeded one (edit changes op / value, not field). */
    lockField?: boolean;
    /** Submit-button label (default `Add`). */
    submitLabel?: string;
    /** Control size override; defaults from the density cascade. */
    size?: "sm" | "md";
}

const sizeVariant = (size: "sm" | "md") => some({ size: some(variant(size, null)) });

/** Fabricate a decoded `Select` payload for the shared select renderer —
 *  the same trick the typed inputs use (decoded-value shape, JS callbacks). */
function selectValue(
    val: string,
    items: ReadonlyArray<{ value: string; label: string }>,
    onChange: (v: string) => void,
    size: "sm" | "md",
): never {
    return {
        value: some(val),
        items: items.map(i => ({ value: i.value, label: i.label, disabled: none })),
        placeholder: none,
        multiple: none,
        disabled: none,
        onChange: some(onChange),
        onChangeMultiple: none,
        onOpenChange: none,
        style: sizeVariant(size),
    } as never;
}

function emptyValue(kind: ClauseKind, input: ClauseOpSpec["input"]): unknown {
    if (input === "set") return [] as string[];
    if (input === "none") return null;
    if (input === "range") {
        if (kind === "integer") return { min: 0n, max: 0n };
        if (kind === "datetime") return { min: new Date(), max: new Date() };
        return { min: 0, max: 0 };
    }
    if (kind === "integer") return 0n;
    if (kind === "float") return 0;
    if (kind === "datetime") return new Date();
    if (kind === "boolean") return false;
    return "";
}

export function ClauseBuilder({ fields, opsFor, onSubmit, initial, lockField, submitLabel, size }: ClauseBuilderProps) {
    const styles = useSlotRecipe({ key: "clauseBuilder" })();
    const btn = useRecipe({ key: "button" });
    const density = useDensity();
    const controlSize = size ?? (density === "comfortable" ? "md" : "sm");
    const inputStyle = sizeVariant(controlSize);

    const [fieldId, setFieldId] = useState(initial?.fieldId ?? fields[0]?.id ?? "");
    const field = fields.find(f => f.id === fieldId) ?? fields[0];
    const kind: ClauseKind = field?.kind ?? "string";
    const ops = opsFor(kind);
    const [opTag, setOpTag] = useState(initial?.op ?? ops[0]?.tag ?? "");
    const op = ops.find(o => o.tag === opTag) ?? ops[0];
    const input = op?.input ?? "single";

    // The value control owns its in-progress state (the interactive-state
    // pattern); the builder only collects commits in a ref. Keeping the
    // control's payload identity-stable per field/op (and remounting on
    // field/op change via `key`) means typing never round-trips through a
    // parent re-render — which would reset the control mid-edit.
    const seedValue = initial !== undefined
        ? (initial.value instanceof Set ? [...initial.value] : initial.value)
        : emptyValue(kind, input);
    const valRef = useRef<unknown>(seedValue);
    const controlKey = `${fieldId}:${op?.tag ?? ""}`;
    const prevKeyRef = useRef(controlKey);
    if (prevKeyRef.current !== controlKey) {
        prevKeyRef.current = controlKey;
        valRef.current = emptyValue(kind, input);
    }

    const onFieldChange = (nextId: string) => {
        const nextKind = fields.find(f => f.id === nextId)?.kind ?? "string";
        setFieldId(nextId);
        setOpTag(opsFor(nextKind)[0]?.tag ?? "");
    };
    const onOpChange = (nextTag: string) => {
        setOpTag(nextTag);
    };

    const submit = () => {
        if (field === undefined || op === undefined) return;
        let value: unknown = valRef.current;
        if (input === "set") {
            const arr = (value as string[]).map(s => s.trim()).filter(Boolean);
            if (arr.length === 0) return;
            value = arr;
        } else if (input === "single" && kind === "string" && String(value).trim() === "") {
            return;
        }
        onSubmit({ fieldId: field.id, kind, op: op.tag, value });
    };

    // Stable per-(field, op) payloads for the typed value controls — built
    // once per remount key, so keystroke commits never recreate them.
    const controls = useMemo(() => {
        const v = valRef.current;
        const single = (onChange: (next: unknown) => void): ReactNode => {
            switch (kind) {
                case "integer":
                    return <EastChakraIntegerInput key={controlKey} value={{ value: v as bigint, onChange: some(onChange), style: inputStyle } as never} />;
                case "float":
                    return <EastChakraFloatInput key={controlKey} value={{ value: v as number, onChange: some(onChange), style: inputStyle } as never} />;
                case "datetime":
                    return <EastChakraDateTimeInput key={controlKey} value={{ value: v as Date, onChange: some(onChange), style: inputStyle } as never} />;
                default:
                    return <EastChakraStringInput key={controlKey} value={{ value: String(v ?? ""), onChange: some(onChange), style: inputStyle } as never} />;
            }
        };
        return {
            single: single(next => { valRef.current = next; }),
            rangeMin: single(next => { valRef.current = { ...(valRef.current as object), min: next }; }),
            rangeMax: single(next => { valRef.current = { ...(valRef.current as object), max: next }; }),
        };
    }, [controlKey, kind, inputStyle]);

    const fieldControl = lockField
        ? <Box as="span" css={styles.fieldLock} aria-label="Field">{field?.label}</Box>
        : (
            <EastChakraSelect
                ariaLabel="Field"
                value={selectValue(
                    fieldId,
                    fields.map(f => ({ value: f.id, label: f.label })),
                    onFieldChange,
                    controlSize,
                )}
            />
        );

    const opControl = (
        <EastChakraSelect
            ariaLabel="Operator"
            value={selectValue(
                op?.tag ?? "",
                ops.map(o => ({ value: o.tag, label: o.glyph })),
                onOpChange,
                controlSize,
            )}
        />
    );

    const valueControl: ReactNode = input === "none" ? null
        : kind === "boolean" ? (
            <EastChakraSelect
                key={controlKey}
                ariaLabel="Value"
                value={selectValue(
                    String(valRef.current),
                    [{ value: "true", label: "true" }, { value: "false", label: "false" }],
                    v => { valRef.current = (v === "true"); },
                    controlSize,
                )}
            />
        ) : input === "set" ? (
            <EastChakraTagsInput key={controlKey} value={{ value: valRef.current as string[], placeholder: some("a, b, c"), suggestions: field?.hints !== undefined && field.hints.length > 0 ? some([...field.hints]) : none, onChange: some((v: string[]) => { valRef.current = v; }), style: inputStyle } as never} />
        ) : input === "range" ? (
            <Box display="flex" alignItems="center" gap="{spacing.2}" minWidth="0">
                {controls.rangeMin}
                <Box as="span" css={styles.rangeJoin}>–</Box>
                {controls.rangeMax}
            </Box>
        ) : controls.single;

    const submitButton = (
        <chakra.button type="button" onClick={submit} css={btn({ variant: "solid", size: "xs" })}>
            {submitLabel ?? "Add"}
        </chakra.button>
    );

    // Set ops author a TagsInput that grows with its values — stack it on its
    // own full-width line so the tags never cram into a 1fr column.
    if (input === "set") {
        return (
            <Box css={styles.rowStacked}>
                <Box display="flex" alignItems="center" gap="{spacing.2}" minWidth="0">
                    {fieldControl}
                    {opControl}
                </Box>
                <Box width="full" minWidth="0">{valueControl}</Box>
                <Box display="flex" justifyContent="flex-end">{submitButton}</Box>
            </Box>
        );
    }
    return (
        <Box css={styles.row}>
            {fieldControl}
            {opControl}
            {valueControl ?? <Box />}
            {submitButton}
        </Box>
    );
}

export interface ClauseChipProps {
    field: string;
    op: string;
    value?: string;
}

/** Render an authored clause as the compact field · op · value chip. */
export function ClauseChip({ field, op, value }: ClauseChipProps) {
    const styles = useSlotRecipe({ key: "clauseBuilder" })();
    return (
        <Box as="span" css={styles.chip}>
            <Box as="span" css={styles.chipField}>{field}</Box>
            <Box as="span" css={styles.chipOp}>{op}</Box>
            {value !== undefined && <Box as="span" css={styles.chipVal}>{value}</Box>}
        </Box>
    );
}
