/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

/** Record control values use East's parser and the app's shared formatters. */
import { DateTimeType, FloatType, IntegerType, StringType, BooleanType, OptionType, parseFor, printFor, some, type EastType, type ValueTypeOf, type option } from "@elaraai/east";
import type { RecordSliceFieldType, RecordSliceChoiceType } from "@elaraai/east-ui/internal";
import { tickFormatOf, type Formatters } from "../../format/index.js";

type Field = ValueTypeOf<RecordSliceFieldType>;
type Choice = ValueTypeOf<RecordSliceChoiceType>;
const TYPES: Record<string, EastType> = { datetime: DateTimeType, float: FloatType, integer: IntegerType, string: StringType, boolean: BooleanType };
const schemas = new WeakMap<Field, { read: ReturnType<typeof parseFor>; print: ReturnType<typeof printFor> }>();
function codec(field: Field) {
    let result = schemas.get(field);
    if (result !== undefined) return result;
    const inner = TYPES[field.kind];
    if (inner === undefined) throw new Error("Use a declared choice for this field");
    const type = field.optional ? OptionType(inner) : inner;
    result = { read: parseFor(type), print: printFor(type) };
    schemas.set(field, result);
    return result;
}

/** Read a canonical control value; optional values unwrap to their inner value. */
export function readRecordChoice(field: Field, text: string): unknown {
    const result = codec(field).read(text);
    if (!result.success) throw new Error(`Invalid ${field.label}`);
    if (!field.optional) return result.value;
    const value = result.value as option<unknown>;
    return value.type === "some" ? value.value : undefined;
}

/** Print a present scalar at the field's actual index-key type. */
export function printRecordChoice(field: Field, value: unknown): string {
    return codec(field).print(field.optional ? some(value) : value);
}

/** A choice label, sharing field formats with local Slice and the canvas. */
export function recordValueLabel(field: Field, text: string, words: Formatters): string {
    const declared = field.values.find(value => value.value === text);
    if (declared !== undefined && (field.kind === "enum" || field.kind === "string" || field.kind === "boolean" || declared.label === "Unset")) return declared.label;
    const value = readRecordChoice(field, text);
    if (value === undefined) return "Unset";
    const format = field.format.type === "some" ? tickFormatOf(field.format.value) : undefined;
    switch (field.kind) {
        case "string": return value as string;
        case "boolean": return value ? "Yes" : "No";
        case "datetime": return format === undefined ? words.monthDay(value as Date) : words.value((value as Date).getTime(), format);
        case "integer": return format === undefined ? words.number(value as bigint) : words.value(Number(value as bigint), format);
        case "float": return format === undefined ? words.number(value as number) : words.value(value as number, format);
        default: throw new Error("Use a declared choice for this field");
    }
}

/** Human summary of one field's active narrowing. */
export function recordChoiceLabel(field: Field, choice: Choice | undefined, words: Formatters): string {
    if (choice === undefined) return field.label;
    const show = (text: string) => recordValueLabel(field, text, words);
    const detail = choice.type === "values" ? choice.value.map(show).join(", ") : choice.type === "prefix" ? `${choice.value}…` : `${show(choice.value.from)} – ${show(choice.value.to)}`;
    return `${field.label}${field.set ? " includes" : ":"} ${detail}`;
}
