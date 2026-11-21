/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

/**
 * A visual's kind as its struct (#1672): the struct a decoded view's wells
 * and options edit — which kind a view is, with its fields
 * ({@link kindStruct}), its editor ({@link kindEditor}), a field of it set
 * ({@link withKindField}), its fields' East types ({@link kindFieldTypes})
 * and its options as the form's fields ({@link optionSpecs}). Plain
 * TypeScript over decoded values, through which the inspector's renderer
 * edits.
 *
 * @packageDocumentation
 */

import { isValueOf, variant, type EastType, type StructType, type ValueTypeOf } from "@elaraai/east";
import { Fields, type FieldSpecValue } from "@elaraai/east-ui";
import { StudioChartType, StudioKpiType, StudioListType, StudioTableType, StudioViewType, type StudioView } from "./content.js";
import { studioEditors, type StudioKindEditor, type StudioKindLiteral, type StudioViewEditor } from "./editors.js";

/**
 * Whether a value is of an East type — `isValueOf`, which TypeScript then
 * reads it as.
 *
 * @param value - The value
 * @param type - The East type
 * @returns Whether the value is one of the type
 * @internal
 */
export function isOf<T extends EastType>(value: unknown, type: T): value is ValueTypeOf<T> {
    return isValueOf(value, type);
}

/**
 * The kind a decoded view is, and the struct its wells and options edit.
 *
 * @param view - The view
 * @returns Its kind and its struct
 */
export function kindStruct(view: StudioView): { readonly kind: StudioKindLiteral; readonly struct: Readonly<Record<string, unknown>> } {
    switch (view.type) {
        case "kpi": return { kind: "kpi", struct: view.value };
        case "chart": return { kind: view.value.type, struct: view.value.value };
        case "table": return { kind: view.value.type, struct: view.value.value };
        case "list": return { kind: "list", struct: view.value };
    }
}

/**
 * The editor of the kind a view is.
 *
 * @param view - The view
 * @param editors - The views' editors; {@link studioEditors} unless given
 * @returns Its kind's editor; `undefined` for a kind the editors do not hold
 */
export function kindEditor(view: StudioView, editors: readonly StudioViewEditor[] = studioEditors): StudioKindEditor | undefined {
    const at = kindStruct(view);
    for (const viewEditor of editors) {
        for (const editor of viewEditor.kinds) {
            if (editor.kind.type === at.kind) return editor;
        }
    }
    return undefined;
}

/**
 * A view with a field of its kind's struct set: an option's edit, and what a
 * well's edit writes.
 *
 * @param view - The view
 * @param field - The field of its kind's struct
 * @param value - Its new value
 * @returns The view
 * @throws {Error} When the kind has no such field, or the value does not fit it
 */
export function withKindField(view: StudioView, field: string, value: unknown): StudioView {
    const at = kindStruct(view);
    if (!(field in at.struct)) throw new Error(`Studio: "${field}" is no field of the ${at.kind}'s`);
    const struct = { ...at.struct, [field]: value };
    let next: unknown;
    switch (view.type) {
        case "kpi": case "list": next = variant(view.type, struct); break;
        case "chart": case "table": next = variant(view.type, variant(view.value.type, struct)); break;
    }
    if (!isOf(next, StudioViewType)) throw new Error(`Studio: the ${at.kind}'s "${field}" does not take that value`);
    return next;
}

/** The struct a kind's wells and options edit. */
function kindStructType(kind: StudioKindLiteral): StructType {
    switch (kind) {
        case "kpi": return StudioKpiType;
        case "list": return StudioListType;
        case "records": case "summary": case "pivot": return StudioTableType.cases[kind];
        default: return StudioChartType.cases[kind];
    }
}

/**
 * The East type of each field of a kind's struct, by name — its wells' and
 * its options'.
 *
 * @param kind - The kind
 * @returns Its struct's fields' types
 */
export function kindFieldTypes(kind: StudioKindLiteral): Readonly<Record<string, EastType>> {
    return kindStructType(kind).fields as Readonly<Record<string, EastType>>;
}

/**
 * A kind's options as the form's fields (`Fields.specs` over its struct, every
 * field but its options left out): each by its declared label, in its
 * declared order — a yes or no a box, a choice its cases in the declared
 * order with their declared words.
 *
 * @param editor - The kind's editor
 * @returns The fields, for east-ui-components' `FieldForm`
 * @throws {Error} When an option names a field the kind's struct does not have, or one it cannot draw
 */
export function optionSpecs(editor: StudioKindEditor): FieldSpecValue[] {
    const struct = kindStructType(editor.kind.type);
    const named = new Set(editor.options.map((option) => option.field));
    const hints = Object.fromEntries(editor.options.map((option) => [option.field, option.cases.length === 0
        ? undefined
        : Fields.select({ labels: Object.fromEntries(option.cases.map((c) => [c.case, c.label])) })]).filter(([, hint]) => hint !== undefined));
    const specs = Fields.specs(struct, hints, Object.keys(struct.fields).filter((field) => !named.has(field)));
    return editor.options.flatMap((option) => specs.filter((spec) => spec.path[0] === option.field).map((spec) => (
        spec.path.length === 1 ? { ...spec, label: option.label } : spec)));
}
