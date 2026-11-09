/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

/**
 * Which of a form's fields hold a number to bounds (#1585): what every builder
 * checks its rows against — through the form's own check and words,
 * `fieldBreaches` — and where a form holds none, it checks nothing. A
 * builder's readiness raises each breach of a changed row as an issue
 * (`breachIssue`), which a builder wording its own issues knows for one
 * (`breachOf`).
 *
 * @packageDocumentation
 */

import type { FieldSpecValue } from "@elaraai/east-ui/internal";
import { fieldBreachIssue, getSomeorUndefined, type EditIssue, type FieldBreach } from "@elaraai/east-ui-components";

/**
 * Whether a field holds a number to a least or a most.
 *
 * @param spec - The field, as `Fields.specs` resolved it
 * @returns Whether its editor is a number's with a least or a most
 */
export function isBounded(spec: FieldSpecValue): boolean {
    return spec.editor.type === "number"
        && (getSomeorUndefined(spec.editor.value.min) !== undefined || getSomeorUndefined(spec.editor.value.max) !== undefined);
}

/** Each breach a builder's readiness raised, by its issue. */
const raised = new WeakMap<EditIssue, FieldBreach>();

/**
 * A changed row's breach as an issue of a builder's readiness, as
 * `fieldBreachIssue` raises it, kept for {@link breachOf}.
 *
 * @param breach - The bound broken
 * @param entry - The row's entry
 * @returns The issue
 */
export function breachIssue(breach: FieldBreach, entry: string): EditIssue {
    const issue = fieldBreachIssue(breach, { entry });
    raised.set(issue, breach);
    return issue;
}

/**
 * The breach an issue of a builder's readiness says: what a builder wording
 * its own issues names the field and the bound by.
 *
 * @param issue - The issue
 * @returns The breach; `undefined` for any other issue
 */
export function breachOf(issue: EditIssue): FieldBreach | undefined {
    return raised.get(issue);
}
