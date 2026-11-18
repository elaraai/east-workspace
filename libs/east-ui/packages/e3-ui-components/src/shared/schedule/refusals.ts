/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

/**
 * The refusals holding a builder's Save (#1525): the app's `ready` refusing a
 * drafted entry, each its session's, while it stands — what the Roster's and
 * the Allocation's Issues tabs list ahead of their own issues, and an entry's
 * panel shows over its form, the Plan's and the Calendar's included — and a
 * Plan's row's panel, the refusals of the session its rows save through
 * (#1541, U5; {@link sessionEntryRefusals}). Each names its field by its form's
 * label, and the field says the refusal's words under it in every builder's
 * panel — the Schematic's and the Flowchart's too, which list their refusals in
 * Issues alone ({@link entryRefusals}).
 *
 * @packageDocumentation
 */

import { StringType, equalFor } from "@elaraai/east";
import { spellOut, type FieldSpecValue } from "@elaraai/east-ui/internal";
import type { BatchReadiness, EditIssue } from "@elaraai/east-ui-components";
import type { ScheduleKindSession } from "./editing.js";

/** One refusal holding Save: whose session it is, and its issue. */
export interface ScheduleRefusal {
    /** The kind's slot, or the record's key, whose session refuses. */
    readonly kind: string;
    /** The issue: its entry's key's text, the field it names, if any, and the app's message. */
    readonly issue: EditIssue;
}

const stringEqual = equalFor(StringType);

/**
 * Every refusal holding Save, in the sessions' order: each session's drafts'
 * readiness while it refuses.
 *
 * @param sessions - Each kind's session and each record's, as the shared editing holds them
 * @returns The refusals
 */
export function scheduleRefusals(sessions: readonly ScheduleKindSession[]): ScheduleRefusal[] {
    const out: ScheduleRefusal[] = [];
    for (const held of sessions) {
        const readiness = held.session.readiness;
        if (readiness.type !== "ready") for (const issue of readiness.value) out.push({ kind: held.kind, issue });
    }
    return out;
}

/**
 * What a session refuses of one entry: its drafts' readiness's issues naming the entry, while it refuses — the app's
 * check, a bound a changed row breaks, a new row waiting for its key. An entry with any holds its session's Save; each
 * naming a field is what the entry's form says under it ({@link refusedFields}). Any session: a kind's or a record's
 * ({@link entryRefusals}), or the one a Plan's rows save through, which no kind's slot names (#1541, U5).
 *
 * @param session - The session, as anything holding its readiness; `undefined` for none
 * @param entry - The entry's key's text
 * @returns Its refusals, in the readiness's order; none while the session is ready, or for no session
 */
export function sessionEntryRefusals(session: { readonly readiness: BatchReadiness } | undefined, entry: string): EditIssue[] {
    const readiness = session?.readiness;
    return readiness === undefined || readiness.type === "ready" ? [] : readiness.value.filter((issue) => stringEqual(issue.entry, entry));
}

/**
 * What one record's session refuses of one entry ({@link sessionEntryRefusals}), the session found by its kind's slot or
 * its record's key.
 *
 * @param sessions - Each kind's session and each record's, as the shared editing holds them
 * @param kind - The record: its kind's slot, or its record's key
 * @param entry - The entry's key's text
 * @returns Its refusals, in the readiness's order; none while the session is ready, or holds no session of the record
 */
export function entryRefusals(sessions: readonly ScheduleKindSession[], kind: string, entry: string): EditIssue[] {
    return sessionEntryRefusals(sessions.find((held) => stringEqual(held.kind, kind))?.session, entry);
}

/**
 * Of the refusals holding Save ({@link scheduleRefusals}), those of one entry of one kind, in their order: what that
 * entry's panel shows over its form. Any list of them — a builder's own, each in its words, as the Roster's and the
 * Allocation's Issues tabs list them.
 *
 * @typeParam R - A refusal, as the builder holds it
 * @param refusals - The refusals holding Save
 * @param kind - The entry's kind: its slot, or its record's key
 * @param entry - The entry's key's text
 * @returns Its refusals; none for an entry nothing refuses
 */
export function refusalsOfEntry<R extends ScheduleRefusal>(refusals: readonly R[], kind: string, entry: string): R[] {
    return refusals.filter((refusal) => stringEqual(refusal.kind, kind) && stringEqual(refusal.issue.entry, entry));
}

/**
 * A field as a refusal names it: by its form's label — a nested field, a
 * case's among them, by its path joined by "." (#1585) — or, for one no form
 * draws (a role the builder draws itself), its name spelled out.
 *
 * @param specs - The entry's form, whose labels name its fields
 * @param field - The field's name, a nested one's path joined by "."
 * @returns Its words
 */
export function fieldLabelOf(specs: readonly FieldSpecValue[], field: string): string {
    return specs.find((s) => stringEqual(s.path.join("."), field))?.label ?? spellOut(field);
}

/**
 * The fields an entry's issues name, each with what its issues say of it, in their order: what the entry's form is
 * handed as its `issues` (east-ui-components' `FieldForm`), so each field it rings says its reason under it (ruled 13
 * Nov 2026) — where the keyboard lands when the issue is gone to, whatever of the banner over the form is in view.
 */
export type RefusedFields = ReadonlyMap<string, readonly string[]>;

/** No field an issue names. */
export const NO_REFUSED_FIELDS: RefusedFields = new Map();

/**
 * The fields an entry's issues name ({@link RefusedFields}): an app's refusal of a field in the app's own words, a
 * bound a changed row breaks in the bound's — which the form says once, in the field's help line. An issue naming no
 * field rings none.
 *
 * @param issues - The entry's issues: its refusals holding Save, or what its session raises of it
 * @returns Each field they name, by its key as the form keys it, and the words under it; the one empty map for none
 */
export function refusedFields(issues: readonly EditIssue[]): RefusedFields {
    let out: Map<string, string[]> | undefined;
    for (const issue of issues) {
        if (issue.field.type !== "some") continue;
        out ??= new Map();
        const said = out.get(issue.field.value);
        if (said === undefined) out.set(issue.field.value, [issue.message]);
        else said.push(issue.message);
    }
    return out ?? NO_REFUSED_FIELDS;
}

/**
 * A refusal in words: the field it names ({@link fieldLabelOf}), then the
 * app's message: `Cost centre: Choose the cost centre`. A refusal naming no
 * field is its message alone.
 *
 * @param issue - The refusal's issue
 * @param specs - The entry's form, whose labels name its fields
 * @returns The words
 */
export function refusalText(issue: EditIssue, specs: readonly FieldSpecValue[]): string {
    return issue.field.type !== "some" ? issue.message : `${fieldLabelOf(specs, issue.field.value)}: ${issue.message}`;
}

/**
 * An entry's refusals in words, as the banner over its form says them in every builder's panel: each one's words
 * ({@link refusalText}), in their order, `; ` between them.
 *
 * @param issues - The entry's refusals' issues
 * @param specs - The entry's form, whose labels name its fields; none where it has none, each field then spelled out
 * @returns The words: `Cost centre: Choose the cost centre; Due before it starts`
 */
export function refusalsText(issues: readonly EditIssue[], specs: readonly FieldSpecValue[]): string {
    return issues.map((issue) => refusalText(issue, specs)).join("; ");
}
