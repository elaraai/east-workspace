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
 * A refusal in words: the field it names by its form's label — or, for one no
 * form draws (a role the builder draws itself), its name spelled out — then
 * the app's message: `Cost centre: Choose the cost centre`. A refusal naming
 * no field is its message alone.
 *
 * @param issue - The refusal's issue
 * @param specs - The entry's form, whose labels name its fields
 * @returns The words
 */
export function refusalText(issue: EditIssue, specs: readonly FieldSpecValue[]): string {
    if (issue.field.type !== "some") return issue.message;
    const field = issue.field.value;
    const spec = specs.find((s) => s.path.length === 1 && stringEqual(s.path[0]!, field));
    return `${spec?.label ?? spellOut(field)}: ${issue.message}`;
}
