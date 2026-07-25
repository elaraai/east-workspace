/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

import { isEastSet, type ValueTypeOf } from "@elaraai/east";
import { Slice } from "@elaraai/east-ui/internal";

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
 *  into a `+N` tail — a 100-member `in` set must stay a legible chip. */
function formatValue(v: unknown): string {
    if (v === null || v === undefined) return "";
    if (isEastSet(v)) {
        const members = [...v].map(formatValue);
        if (members.length <= SET_PREVIEW_MAX) return members.join(", ");
        return `${members.slice(0, SET_PREVIEW_MAX).join(", ")} +${members.length - SET_PREVIEW_MAX}`;
    }
    if (v instanceof Date) return v.toLocaleDateString();
    if (typeof v === "bigint") return v.toString();
    if (typeof v === "object") {
        const r = v as { from?: unknown; to?: unknown };
        if ("from" in r && "to" in r) return `${formatValue(r.from)} – ${formatValue(r.to)}`;
    }
    return String(v);
}

/** `{ fieldId, glyph, value }` parts of a predicate, for tonally-styled rendering. */
export function predicateParts(pred: PredicateValue): { fieldId: string; glyph: string; value: string } {
    const { fieldId, op } = pred.value;
    return { fieldId, glyph: OP_GLYPH[op.type] ?? op.type, value: formatValue(op.value) };
}

/** `{fieldId} {glyph} {value}` — e.g. `sessions ≥ 10`. */
export function formatPredicate(pred: PredicateValue): string {
    const { fieldId, glyph, value } = predicateParts(pred);
    return value === "" ? `${fieldId} ${glyph}` : `${fieldId} ${glyph} ${value}`;
}
