/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

/** Presentation and local discard of schema-checked drafts. @packageDocumentation */
import { OptionType, equalFor, none, some, variant, type EastType } from "@elaraai/east";
import { normalizeDraft, type BatchReadiness } from "./draft-values.js";
import type { EntryVersion, SheetTransactions } from "./transactions.js";
import { SHEET_WORDS, issueText, type SheetWords } from "./words.js";

export interface DraftPresentation {
    pending: boolean;
    invalid: boolean;
    incomplete: boolean;
    issues: ReadonlyMap<string, string>;
    discardable: boolean;
}
const CLEAN: DraftPresentation = { pending: false, invalid: false, incomplete: false, issues: new Map(), discardable: false };

/**
 * A group's own draft: the entry's — or, on a sheet with loose rows between
 * its groups (#846), whose drafts are entry variants, the group arm's.
 */
function groupDraftOf(type: EastType, draft: unknown): Record<string, unknown> | undefined {
    if (draft === undefined) return undefined;
    return (type.type === "Variant" ? (draft as { value: unknown }).value : draft) as Record<string, unknown>;
}

/** Read a child by its internal wire identity, never its current screen position. */
function childOf(type: EastType, entry: EntryVersion | undefined, field: string, key: string): unknown {
    const index = entry?.wire?.lines.findIndex(line => line.key === key) ?? -1;
    const group = groupDraftOf(type, entry?.draft);
    if (index < 0 || group === undefined) return undefined;
    return (group[field] as unknown[])[index];
}

/**
 * Derive row affordances from the exact draft schema and acknowledged
 * baseline. The issues are the sheet's words (#861): the renderer's own read
 * back from their canonical English, an author's as written.
 *
 * @param session - The editing session
 * @param type - The entry's draft type — on a sheet with loose rows (#846), the variant of a group and a row
 * @param field - A group's children field
 * @param id - The entry
 * @param child - A line's key
 * @param readiness - The session's readiness, for the author's issues
 * @param words - The sheet's words
 * @returns The presentation
 */
export function draftPresentation(session: SheetTransactions, type: EastType, field: string | undefined, id: string, child?: string, readiness?: BatchReadiness, words: SheetWords = SHEET_WORDS): DraftPresentation {
    const entry = session.entries.get(id);
    if (entry?.draft === undefined) return CLEAN;
    const original = session.originals.get(id);
    let current: unknown = entry.draft;
    let before = original?.draft;
    if (child !== undefined) {
        const groupType = type.type === "Variant" ? type.cases["group"] : type;
        if (field === undefined || groupType?.type !== "Struct" || groupType.fields[field]?.type !== "Array") return CLEAN;
        current = childOf(type, entry, field, child);
        before = childOf(type, original, field, child);
        type = groupType.fields[field].value;
        if (current === undefined) return CLEAN;
    }
    const checked = normalizeDraft(type, current, id).readiness;
    const issues = new Map<string, string>();
    if (checked.type !== "ready") for (const issue of checked.value) {
        if (issue.field.type === "some" && issue.row.type === "none") issues.set(issue.field.value, issueText(issue.message, words));
    }
    const childIndex = child === undefined ? undefined : entry.wire?.lines.findIndex(line => line.key === child);
    const related = readiness !== undefined && readiness.type !== "ready"
        ? readiness.value.filter(issue => issue.entry === id && (child === undefined || issue.row.type === "some" && issue.row.value === BigInt(childIndex ?? -1))) : [];
    for (const issue of related) {
        if (issue.field.type === "some" && (child !== undefined || issue.row.type === "none") && !issues.has(issue.field.value)) issues.set(issue.field.value, issueText(issue.message, words));
    }
    const invalid = checked.type === "invalid" || related.length > 0 && readiness?.type === "invalid";
    return {
        pending: !equalFor(OptionType(type))(before === undefined ? none : some(before), some(current)),
        invalid, incomplete: !invalid && (checked.type === "incomplete" || related.length > 0), issues,
        discardable: before === undefined && session.writable,
    };
}

/**
 * Discard only a never-applied row/group or child, as one ordinary undoable gesture.
 *
 * @param session - The editing session
 * @param type - The entry's draft type — on a sheet with loose rows (#846), the variant of a group and a row
 * @param field - A group's children field
 * @param id - The entry
 * @param child - A line's key
 * @returns Whether the draft was discarded
 */
export function discardDraft(session: SheetTransactions, type: EastType, field: string | undefined, id: string, child?: string): boolean {
    if (!session.writable) return false;
    const before = session.entries.get(id);
    if (before?.draft === undefined || before.wire === undefined) return false;
    const baseline = session.originals.get(id);
    if (child === undefined) {
        if (baseline?.draft !== undefined) return false;
        return session.record([{ id, before, after: { draft: undefined, wire: undefined, place: none } }], "discard", "Discard new row");
    }
    if (field === undefined || childOf(type, baseline, field, child) !== undefined) return false;
    const index = before.wire.lines.findIndex(line => line.key === child);
    if (index < 0) return false;
    const group = groupDraftOf(type, before.draft)!;
    const children = group[field] as unknown[];
    const kept = { ...group, [field]: children.filter((_, i) => i !== index) };
    const after: EntryVersion = {
        ...before,
        draft: type.type === "Variant" ? variant("group", kept) : kept,
        wire: { ...before.wire, lines: before.wire.lines.filter((_, i) => i !== index) },
    };
    return session.record([{ id, before, after }], "discard", "Discard new row");
}
