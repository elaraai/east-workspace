/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

/**
 * The refusals holding a builder's Save (#1525): the app's `ready` refusing a
 * drafted entry, each its session's, while it stands — what the Roster's and
 * the Allocation's Issues tabs list ahead of their own issues, and an entry's
 * panel shows over its form, the Plan's and the Calendar's included. Each names
 * its field by its form's label.
 *
 * @packageDocumentation
 */

import { StringType, equalFor } from "@elaraai/east";
import { spellOut, type FieldSpecValue } from "@elaraai/east-ui/internal";
import type { EditIssue } from "@elaraai/east-ui-components";
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
