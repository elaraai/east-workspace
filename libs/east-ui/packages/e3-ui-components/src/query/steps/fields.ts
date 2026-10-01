/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

/**
 * The fields a step can name (#933): the field catalog of a rows shape, and
 * the comparisons each kind of field takes (`Query Editor Spec.md` §4.4).
 *
 * @packageDocumentation
 */

import type { EastType } from "@elaraai/east";
import { baseType, optionPayload, orMissing, unwrapRecursive, type Shape } from "./shape.js";
import type { ComparisonKind } from "./values.js";

/**
 * What kind of value a field holds, as the builder offers it: text, a whole
 * number, a number, a date, yes or no, one of some cases, a list, a record,
 * a lookup table, a calculation, or anything else.
 */
export type FieldKind = "text" | "int" | "num" | "date" | "bool" | "case" | "list" | "record" | "dict" | "fn" | "other";

/** A field a step can name, in a shape. */
export interface StepField {
    /** How a step names it: `"total"`, `"status"`, `"status.shipped.date"`. */
    readonly ref: string;
    /** The name a step gives a field made from it: `"total"`, `"status"`, `"shipped_date"`. */
    readonly name: string;
    /** What kind of value it holds. */
    readonly kind: FieldKind;
    /** The type a read of it gives here: a payload field not narrowed to its case is an option. */
    readonly type: EastType;
    /** Whether it can be missing: an option, or a payload field not narrowed to its case. */
    readonly optional: boolean;
    /** The fields jq reads it through from a row: `["total"]`, `["status", "type"]`, `["status", "value", "date"]`. */
    readonly path: readonly string[];
    /** A case field's cases. */
    readonly cases?: readonly string[];
    /** A payload field's variant field, the case whose payload has it, its name in the payload, and whether the rows are narrowed to that case. */
    readonly payload?: { readonly parent: string; readonly case: string; readonly leaf: string; readonly narrowed: boolean };
    /** A list's item type. */
    readonly element?: EastType;
}

/**
 * The kind of value a type holds.
 *
 * @param type - a field's type
 * @returns its kind, read through an option and a recursive wrapper
 */
export function kindOf(type: EastType): FieldKind {
    const base = baseType(type);
    switch (base.type) {
        case "String": return "text";
        case "Integer": return "int";
        case "Float": return "num";
        case "DateTime": return "date";
        case "Boolean": return "bool";
        case "Variant": return "case";
        case "Array": case "Set": case "Vector": return "list";
        case "Struct": return "record";
        case "Dict": return "dict";
        case "Function": case "AsyncFunction": return "fn";
        default: return "other";
    }
}

/**
 * A list's item type.
 *
 * @param type - a field's type
 * @returns the type of each item, for an array, a set or a vector
 */
function elementOf(type: EastType): EastType | undefined {
    const base = baseType(type);
    switch (base.type) {
        case "Array": return base.value as EastType;
        case "Set": return base.key as EastType;
        case "Vector": return base.element as EastType;
        default: return undefined;
    }
}

/**
 * The fields of a record, as steps name them: each field; for a variant
 * field, its case and each field of each struct case's payload.
 *
 * @param record - the record's type
 * @param narrowed - the variant fields narrowed to one case, with the case
 * @returns the fields, in the record's order, each variant's case before its payloads' fields
 */
export function fieldsOfRecord(record: EastType, narrowed: ReadonlyMap<string, string>): StepField[] {
    const struct = unwrapRecursive(record);
    if (struct.type !== "Struct") return [];
    const fields: StepField[] = [];
    for (const [name, type] of Object.entries(struct.fields as Record<string, EastType>)) {
        const optional = optionPayload(type) !== undefined;
        const base = baseType(type);
        if (base.type !== "Variant") {
            const element = elementOf(type);
            fields.push({ ref: name, name, kind: kindOf(type), type, optional, path: [name], ...(element === undefined ? {} : { element }) });
            continue;
        }
        const cases = base.cases as Record<string, EastType>;
        fields.push({ ref: name, name, kind: "case", type, optional, path: [name, "type"], cases: Object.keys(cases) });
        for (const [caseName, caseType] of Object.entries(cases)) {
            const payload = unwrapRecursive(caseType);
            if (payload.type !== "Struct") continue;
            const isNarrowed = !optional && narrowed.get(name) === caseName;
            for (const [leaf, leafType] of Object.entries(payload.fields as Record<string, EastType>)) {
                const element = elementOf(leafType);
                fields.push({
                    ref: `${name}.${caseName}.${leaf}`,
                    name: `${caseName}_${leaf}`,
                    kind: kindOf(leafType),
                    type: isNarrowed ? leafType : orMissing(leafType),
                    optional: !isNarrowed || optionPayload(leafType) !== undefined,
                    path: [name, "value", leaf],
                    payload: { parent: name, case: caseName, leaf, narrowed: isNarrowed },
                    ...(element === undefined ? {} : { element }),
                });
            }
        }
    }
    return fields;
}

/**
 * The field catalog of a shape: the fields of its rows.
 *
 * @param shape - the shape
 * @returns its rows' fields; none when it is not rows
 */
export function fieldsOf(shape: Shape): StepField[] {
    return shape.kind === "rows" && shape.row !== undefined ? fieldsOfRecord(shape.row, shape.narrowed) : [];
}

/**
 * The field a step names, in a shape.
 *
 * @param shape - the shape
 * @param ref - how the step names it
 * @returns the field, or `undefined` when the shape has none of that name
 */
export function fieldByRef(shape: Shape, ref: string): StepField | undefined {
    return fieldsOf(shape).find(f => f.ref === ref);
}

/**
 * The fields jq reads a field through, for one the shape does not have: a
 * name is read as itself, and `parent.case.leaf` as a payload's field, so the
 * check names what is wrong.
 *
 * @param ref - how a step names it
 * @returns the fields jq reads
 */
export function pathOfUnknown(ref: string): string[] {
    const parts = ref.split(".");
    return parts.length === 3 ? [parts[0]!, "value", parts[2]!] : [ref];
}

/**
 * The record each item of a list is, when the items are records.
 *
 * @param field - a list field
 * @returns its item record, or `undefined`
 */
export function itemRecordOf(field: StepField): EastType | undefined {
    if (field.element === undefined) return undefined;
    const item = unwrapRecursive(optionPayload(field.element) ?? field.element);
    return item.type === "Struct" ? item : undefined;
}

const BY_KIND: Readonly<Record<FieldKind, readonly ComparisonKind[]>> = {
    text: ["eq", "ne", "contains", "startsWith"],
    int: ["eq", "ne", "ge", "le", "gt", "lt"],
    num: ["eq", "ne", "ge", "le", "gt", "lt"],
    date: ["inYear", "inMonth", "onOrAfter", "before"],
    case: ["eq", "ne"],
    bool: ["yes", "no"],
    list: ["lengthAtLeast", "anyWhere"],
    record: [],
    dict: [],
    fn: [],
    other: [],
};

/**
 * The comparisons a field takes (`Query Editor Spec.md` §4.4): its kind's,
 * and is missing and has a value for an optional field that is not a
 * payload's; a list takes has any where only when its items are records.
 *
 * @param field - the field
 * @returns the comparisons, in the order the builder offers them
 */
export function comparisonsFor(field: StepField): ComparisonKind[] {
    let kinds = [...BY_KIND[field.kind]];
    if (field.kind === "list" && itemRecordOf(field) === undefined) kinds = kinds.filter(k => k !== "anyWhere");
    return field.optional && field.payload === undefined ? [...kinds, "missing", "present"] : kinds;
}

/**
 * The comparison a field starts with when it is picked: is in year for a
 * date, has at least for a list, is yes for yes or no, is at least for a
 * number, and is otherwise.
 *
 * @param field - the field
 * @returns the comparison
 */
export function defaultComparison(field: StepField): ComparisonKind {
    switch (field.kind) {
        case "date": return "inYear";
        case "list": return "lengthAtLeast";
        case "bool": return "yes";
        case "int": case "num": return "ge";
        default: return "eq";
    }
}
