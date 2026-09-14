/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

/** Presentation and local discard of schema-checked drafts. @packageDocumentation */
import { OptionType, equalFor, none, some, type EastType } from "@elaraai/east";
import { normalizeDraft, type BatchReadiness } from "./draft-values.js";
import type { EntryVersion, SheetTransactions } from "./transactions.js";

export interface DraftPresentation {
    pending: boolean;
    invalid: boolean;
    incomplete: boolean;
    issues: ReadonlyMap<string, string>;
    discardable: boolean;
}
const CLEAN: DraftPresentation = { pending: false, invalid: false, incomplete: false, issues: new Map(), discardable: false };

/** Read a child by its internal wire identity, never its current screen position. */
function childOf(entry: EntryVersion | undefined, field: string, key: string): unknown {
    const index = entry?.wire?.lines.findIndex(line => line.key === key) ?? -1;
    if (index < 0 || entry?.draft === undefined) return undefined;
    return ((entry.draft as Record<string, unknown>)[field] as unknown[])[index];
}

/** Derive row affordances from the exact draft schema and acknowledged baseline. */
export function draftPresentation(session: SheetTransactions, type: EastType, field: string | undefined, id: string, child?: string, readiness?: BatchReadiness): DraftPresentation {
    const entry = session.entries.get(id);
    if (entry?.draft === undefined) return CLEAN;
    const original = session.originals.get(id);
    let current: unknown = entry.draft;
    let before = original?.draft;
    if (child !== undefined) {
        if (field === undefined || type.type !== "Struct" || type.fields[field]?.type !== "Array") return CLEAN;
        current = childOf(entry, field, child);
        before = childOf(original, field, child);
        type = type.fields[field].value;
        if (current === undefined) return CLEAN;
    }
    const checked = normalizeDraft(type, current, id).readiness;
    const issues = new Map<string, string>();
    if (checked.type !== "ready") for (const issue of checked.value) {
        if (issue.field.type === "some" && issue.row.type === "none") issues.set(issue.field.value, issue.message);
    }
    const childIndex = child === undefined ? undefined : entry.wire?.lines.findIndex(line => line.key === child);
    const related = readiness !== undefined && readiness.type !== "ready"
        ? readiness.value.filter(issue => issue.entry === id && (child === undefined || issue.row.type === "some" && issue.row.value === BigInt(childIndex ?? -1))) : [];
    for (const issue of related) {
        if (issue.field.type === "some" && (child !== undefined || issue.row.type === "none") && !issues.has(issue.field.value)) issues.set(issue.field.value, issue.message);
    }
    const invalid = checked.type === "invalid" || related.length > 0 && readiness?.type === "invalid";
    return {
        pending: !equalFor(OptionType(type))(before === undefined ? none : some(before), some(current)),
        invalid, incomplete: !invalid && (checked.type === "incomplete" || related.length > 0), issues,
        discardable: before === undefined && session.writable,
    };
}

/** Discard only a never-applied row/group or child, as one ordinary undoable gesture. */
export function discardDraft(session: SheetTransactions, field: string | undefined, id: string, child?: string): boolean {
    if (!session.writable) return false;
    const before = session.entries.get(id);
    if (before?.draft === undefined || before.wire === undefined) return false;
    const baseline = session.originals.get(id);
    if (child === undefined) {
        if (baseline?.draft !== undefined) return false;
        return session.record([{ id, before, after: { draft: undefined, wire: undefined, place: none } }], "discard", "Discard new row");
    }
    if (field === undefined || childOf(baseline, field, child) !== undefined) return false;
    const index = before.wire.lines.findIndex(line => line.key === child);
    if (index < 0) return false;
    const group = before.draft as Record<string, unknown>;
    const children = group[field] as unknown[];
    const after: EntryVersion = {
        ...before,
        draft: { ...group, [field]: children.filter((_, i) => i !== index) },
        wire: { ...before.wire, lines: before.wire.lines.filter((_, i) => i !== index) },
    };
    return session.record([{ id, before, after }], "discard", "Discard new row");
}
