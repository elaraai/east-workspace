/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

import { BooleanType, IntegerType, printFor, type ValueTypeOf } from "@elaraai/east";
import { Slice } from "@elaraai/east-ui/internal";
import { formatters, type Formatters } from "../format/index.js";

/** One filter clause, unwrapped — shared by `Slice.Filter` and `Slice.Cohort`. */
export type PredicateValue = ValueTypeOf<typeof Slice.Types.Predicate>;

const OP_GLYPH: Record<string, string> = {
    eq: "=", neq: "≠", lt: "<", lte: "≤", gt: ">", gte: "≥",
    in: "in", notIn: "not in", contains: "contains", matches: "~",
    startsWith: "starts with", endsWith: "ends with",
    isEmpty: "is empty", isNotEmpty: "is not empty",
    before: "before", after: "after", between: "between", is: "=",
};

/** Set previews show at most this many members before collapsing to `+N`. */
const SET_PREVIEW_MAX = 3;

/** East's own printers for the Integer and Boolean values a predicate carries. */
const printInteger = printFor(IntegerType);
const printBoolean = printFor(BooleanType);

/** A set's members in the set's own order: the first {@link SET_PREVIEW_MAX},
 *  then a `+N` tail — a 100-member `in` set must stay a legible chip. */
function preview<V>(members: Iterable<V>, print: (member: V) => string, f: Formatters): string {
    const all = [...members];
    const shown = all.slice(0, SET_PREVIEW_MAX).map(print).join(", ");
    return all.length <= SET_PREVIEW_MAX ? shown : `${shown} +${f.number(all.length - SET_PREVIEW_MAX)}`;
}

/**
 * The value a predicate's op carries, as chip text. The predicate's family
 * and op name the value's East type, so each prints through its own type: an
 * Integer and a Boolean as East prints them, a Float as East prints it in the
 * locale's decimal separator (#850), a date as its UTC day in the locale, a
 * string as itself. An op that carries no value (`isEmpty`) prints nothing.
 */
function formatOpValue(pred: PredicateValue, f: Formatters): string {
    switch (pred.type) {
        case "string": {
            const op = pred.value.op;
            switch (op.type) {
                case "in":
                case "notIn":
                    return preview(op.value, (member) => member, f);
                case "isEmpty":
                case "isNotEmpty":
                    return "";
                default:
                    return op.value;
            }
        }
        case "integer": {
            const op = pred.value.op;
            return op.type === "in" ? preview(op.value, printInteger, f) : printInteger(op.value);
        }
        case "float":
            return f.float(pred.value.op.value);
        case "datetime": {
            const op = pred.value.op;
            return op.type === "between"
                ? `${f.numericDate(op.value.from)} – ${f.numericDate(op.value.to)}`
                : f.numericDate(op.value);
        }
        case "boolean":
            return printBoolean(pred.value.op.value);
    }
}

/**
 * `{ fieldId, glyph, value }` parts of a predicate, for tonally-styled rendering.
 *
 * @param pred - The predicate
 * @param f - The formatters its numbers and dates print with — a component
 *   passes `useFormatters()`; the runtime's default locale when omitted
 * @returns The parts
 */
export function predicateParts(pred: PredicateValue, f: Formatters = formatters()): { fieldId: string; glyph: string; value: string } {
    const { fieldId, op } = pred.value;
    return { fieldId, glyph: OP_GLYPH[op.type] ?? op.type, value: formatOpValue(pred, f) };
}

/**
 * `{fieldId} {glyph} {value}` — e.g. `sessions ≥ 10`.
 *
 * @param pred - The predicate
 * @param f - The formatters its numbers and dates print with (see {@link predicateParts})
 * @returns The text
 */
export function formatPredicate(pred: PredicateValue, f: Formatters = formatters()): string {
    const { fieldId, glyph, value } = predicateParts(pred, f);
    return value === "" ? `${fieldId} ${glyph}` : `${fieldId} ${glyph} ${value}`;
}
