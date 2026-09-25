/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

/**
 * Drafts (#879): schema-directed lifting of a domain value into its draft, the
 * unconditional completeness check that turns a draft back into a domain
 * value, and how a draft presents against the value it began from.
 *
 * @packageDocumentation
 */
import { OptionType, equalFor, none, some, variant, type EastType, type VariantType, type ValueTypeOf } from "@elaraai/east";
import { EditingBatchReadinessType, EditingIssueType } from "@elaraai/east-ui/internal";
import { DRAFT_ISSUE_TEXT } from "./messages.js";

type Issue = ValueTypeOf<typeof EditingIssueType>;
/** A batch's readiness — every draft's issues together. */
export type BatchReadiness = ValueTypeOf<typeof EditingBatchReadinessType>;

/** What an issue refuses its entry for: something still missing, or something refused. */
export type IssueKind = "incomplete" | "invalid";

/**
 * The kind each issue was raised with. A batch's readiness holds every
 * entry's issues under ONE kind — the wire's, which patch events carry — so
 * an entry whose own issue is only incomplete would read as invalid beside
 * another's invalid one. The kind rides beside the issue, renderer-side, from
 * where it is raised to where an entry is marked for it.
 */
const issueKinds = new WeakMap<Issue, IssueKind>();

/**
 * Raise an issue of a kind — every issue a draft check or an author's check
 * raises is raised through here, so its entry is marked for its own refusal.
 *
 * @param kind - What it refuses its entry for
 * @param issue - The issue
 * @returns The issue
 */
export function raiseIssue(kind: IssueKind, issue: Issue): Issue {
    issueKinds.set(issue, kind);
    return issue;
}

/**
 * What an issue refuses its entry for — the kind it was raised with, else its
 * batch's.
 *
 * @param issue - One of `readiness`'s issues
 * @param readiness - The batch it came in
 * @returns Its kind
 */
export function kindOfIssue(issue: Issue, readiness: Exclude<BatchReadiness, { type: "ready" }>): IssueKind {
    return issueKinds.get(issue) ?? readiness.type;
}

/**
 * Lift a domain value into its draft: every field wrapped as a value; group
 * child arrays and entry variants keep their structure.
 *
 * @param type - The draft schema
 * @param value - The domain value
 * @returns The draft
 * @throws {Error} When the schema is not a draft schema
 */
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
    throw new Error("Invalid draft schema");
}

/**
 * Check every field, including hidden and read-only fields. Missing Option
 * fields become none; invalid Option fields remain invalid. No other defaults
 * are invented. A value is returned only when the complete entry is ready.
 *
 * @param type - The draft schema
 * @param draft - The draft
 * @param entry - The entry's id, for its issues
 * @returns The domain value when the draft is ready, and its readiness
 * @throws {Error} When the schema is not a draft schema
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
            (state.type === "invalid" ? invalid : missing).push(raiseIssue(state.type === "invalid" ? "invalid" : "incomplete", {
                entry, row: row === undefined ? none : some(BigInt(row)), field: field === undefined ? none : some(field),
                // The canonical English the patch events carry; a surface shows it in its words.
                message: state.type === "invalid" ? DRAFT_ISSUE_TEXT.invalid(String(state.value)) : DRAFT_ISSUE_TEXT.required,
            }));
            return undefined;
        }
        if (type.type === "Struct") return Object.fromEntries(Object.entries(type.fields).map(([key, child]) => [key, visit(child, (value as Record<string, unknown>)[key], key, row)]));
        if (type.type === "Array") return (value as unknown[]).map((v, index) => visit(type.value, v, undefined, index));
        if (type.type === "Variant") {
            const arm = value as ValueTypeOf<VariantType>;
            return variant(arm.type, visit(type.cases[arm.type]!, arm.value, field, row));
        }
        throw new Error("Invalid draft schema");
    };
    const domain = visit(type, draft);
    const readiness: BatchReadiness = invalid.length ? variant("invalid", [...invalid, ...missing]) : missing.length ? variant("incomplete", missing) : variant("ready", null);
    return { domain: readiness.type === "ready" ? domain : undefined, readiness };
}

/** How a draft shows: whether it differs, and what stands in its way. */
export interface DraftPresentation {
    /** It differs from the value it began from. */
    pending: boolean;
    /** A field could not be read, or a check refused it. */
    invalid: boolean;
    /** A field is still missing. */
    incomplete: boolean;
    /** Each field's issue, in the surface's words. */
    issues: ReadonlyMap<string, string>;
    /** It was never applied, so discarding it drops it. */
    discardable: boolean;
}

/** A draft with nothing to show. */
export const CLEAN_DRAFT: DraftPresentation = { pending: false, invalid: false, incomplete: false, issues: new Map(), discardable: false };

/** One draft to present — an entry's, or one child row of it. */
export interface DraftToPresent {
    /** The draft's schema. */
    type: EastType;
    /** The draft. */
    current: unknown;
    /** The acknowledged value it began from — `undefined` for one never applied. */
    before: unknown;
    /** The entry's id. */
    entry: string;
    /** The child row's index in its group, when the draft is a child row's (`-1` for one the group no longer holds). */
    row?: number | undefined;
    /** The batch's readiness, for the author's issues. */
    readiness?: BatchReadiness | undefined;
    /** Whether the session can take a gesture now. */
    writable: boolean;
    /** An issue's text in the surface's words. */
    text: (message: string) => string;
}

/**
 * Present a draft against the value it began from: its schema check's field
 * issues, then the batch's issues addressed to it (an entry's own, or its
 * child row's), each in the surface's words.
 *
 * @param d - The draft to present
 * @returns The presentation
 */
export function presentDraft(d: DraftToPresent): DraftPresentation {
    const checked = normalizeDraft(d.type, d.current, d.entry).readiness;
    const issues = new Map<string, string>();
    if (checked.type !== "ready") for (const issue of checked.value) {
        if (issue.field.type === "some" && issue.row.type === "none") issues.set(issue.field.value, d.text(issue.message));
    }
    const readiness = d.readiness;
    const related = readiness !== undefined && readiness.type !== "ready"
        ? readiness.value.filter(issue => issue.entry === d.entry && (d.row === undefined || issue.row.type === "some" && issue.row.value === BigInt(d.row))) : [];
    for (const issue of related) {
        if (issue.field.type === "some" && (d.row !== undefined || issue.row.type === "none") && !issues.has(issue.field.value)) issues.set(issue.field.value, d.text(issue.message));
    }
    // Each draft is marked for its OWN issues' kind, never the batch's: a row
    // whose check found it incomplete stays incomplete beside an invalid one.
    const invalid = checked.type === "invalid" || (readiness !== undefined && readiness.type !== "ready"
        && related.some(issue => kindOfIssue(issue, readiness) === "invalid"));
    return {
        pending: !equalFor(OptionType(d.type))(d.before === undefined ? none : some(d.before), some(d.current)),
        invalid, incomplete: !invalid && (checked.type === "incomplete" || related.length > 0), issues,
        discardable: d.before === undefined && d.writable,
    };
}
