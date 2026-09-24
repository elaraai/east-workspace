/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

import { isEastSet, type ValueTypeOf } from "@elaraai/east";
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

/** Render the typed value carried by a predicate's op variant. Set values
 *  preview the first {@link SET_PREVIEW_MAX} members then collapse the rest
 *  into a `+N` tail — a 100-member `in` set must stay a legible chip. A value
 *  is data, so a number prints bare — every digit, never grouped, with the
 *  locale's decimal separator (a year stays `2026`, never `2,026`) — and a
 *  date prints its UTC day in the locale (#850). */
function formatValue(v: unknown, f: Formatters): string {
    if (v === null || v === undefined) return "";
    if (isEastSet(v)) {
        const members = [...v].map((m) => formatValue(m, f));
        if (members.length <= SET_PREVIEW_MAX) return members.join(", ");
        return `${members.slice(0, SET_PREVIEW_MAX).join(", ")} +${f.number(members.length - SET_PREVIEW_MAX)}`;
    }
    if (v instanceof Date) return f.numericDate(v);
    if (typeof v === "bigint" || typeof v === "number") return f.bare(v);
    if (typeof v === "object") {
        const r = v as { from?: unknown; to?: unknown };
        if ("from" in r && "to" in r) return `${formatValue(r.from, f)} – ${formatValue(r.to, f)}`;
    }
    return String(v);
}

/**
 * `{ fieldId, glyph, value }` parts of a predicate, for tonally-styled rendering.
 *
 * @param pred - The predicate
 * @param f - The formatters its dates print with — a component passes
 *   `useFormatters()`; the runtime's default locale when omitted
 * @returns The parts
 */
export function predicateParts(pred: PredicateValue, f: Formatters = formatters()): { fieldId: string; glyph: string; value: string } {
    const { fieldId, op } = pred.value;
    return { fieldId, glyph: OP_GLYPH[op.type] ?? op.type, value: formatValue(op.value, f) };
}

/**
 * `{fieldId} {glyph} {value}` — e.g. `sessions ≥ 10`.
 *
 * @param pred - The predicate
 * @param f - The formatters its dates print with (see {@link predicateParts})
 * @returns The text
 */
export function formatPredicate(pred: PredicateValue, f: Formatters = formatters()): string {
    const { fieldId, glyph, value } = predicateParts(pred, f);
    return value === "" ? `${fieldId} ${glyph}` : `${fieldId} ${glyph} ${value}`;
}
