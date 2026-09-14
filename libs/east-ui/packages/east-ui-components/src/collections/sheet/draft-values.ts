/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

/** Schema-directed draft lifting and unconditional readiness checks. @packageDocumentation */
import { none, some, variant, type EastType, type VariantType, type ValueTypeOf } from "@elaraai/east";
import { SheetBatchReadinessType, SheetIssueType } from "@elaraai/east-ui/internal";

type Issue = ValueTypeOf<typeof SheetIssueType>;
export type BatchReadiness = ValueTypeOf<typeof SheetBatchReadinessType>;

/** Draft fields are wrappers; group child arrays and entry variants retain their structure. */
export function liftDraft(type: EastType, value: unknown): unknown {
    if (type.type === "Variant" && "missing" in type.cases && "value" in type.cases && "invalid" in type.cases) return variant("value", value);
    if (type.type === "Struct") {
        const record = value as Record<string, unknown>;
        return Object.fromEntries(Object.entries(type.fields).map(([key, child]) => [key, liftDraft(child, record[key])]));
    }
    if (type.type === "Array") return (value as unknown[]).map(v => liftDraft(type.value, v));
    if (type.type === "Variant") {
        const entry = value as ValueTypeOf<VariantType>;
        return variant(entry.type, liftDraft(type.cases[entry.type]!, entry.value));
    }
    throw new Error("Invalid Sheet draft schema");
}

/**
 * Check every field, including hidden and read-only fields. Missing Option
 * fields become none; invalid Option fields remain invalid. No other defaults
 * are invented. A value is returned only when the complete entry is ready.
 */
export function normalizeDraft(type: EastType, draft: unknown, entry: string): { domain: unknown; readiness: BatchReadiness } {
    const missing: Issue[] = [];
    const invalid: Issue[] = [];
    const visit = (type: EastType, value: unknown, field?: string, row?: number): unknown => {
        if (type.type === "Variant" && "missing" in type.cases && "value" in type.cases && "invalid" in type.cases) {
            const state = value as ValueTypeOf<VariantType>;
            if (state.type === "value") return state.value;
            const domain = type.cases.value!;
            if (state.type === "missing" && domain.type === "Variant" && domain.cases.none?.type === "Null" && domain.cases.some !== undefined && Object.keys(domain.cases).length === 2) return none;
            (state.type === "invalid" ? invalid : missing).push({
                entry, row: row === undefined ? none : some(BigInt(row)), field: field === undefined ? none : some(field),
                message: state.type === "invalid" ? `Invalid input: ${String(state.value)}` : "A value is required",
            });
            return undefined;
        }
        if (type.type === "Struct") return Object.fromEntries(Object.entries(type.fields).map(([key, child]) => [key, visit(child, (value as Record<string, unknown>)[key], key, row)]));
        if (type.type === "Array") return (value as unknown[]).map((v, index) => visit(type.value, v, undefined, index));
        if (type.type === "Variant") {
            const arm = value as ValueTypeOf<VariantType>;
            return variant(arm.type, visit(type.cases[arm.type]!, arm.value, field, row));
        }
        throw new Error("Invalid Sheet draft schema");
    };
    const domain = visit(type, draft);
    const readiness: BatchReadiness = invalid.length ? variant("invalid", [...invalid, ...missing]) : missing.length ? variant("incomplete", missing) : variant("ready", null);
    return { domain: readiness.type === "ready" ? domain : undefined, readiness };
}
