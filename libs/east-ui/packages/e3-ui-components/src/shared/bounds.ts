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
 * (`breachOf`). A builder reads each row it draws through `rowBreaches`:
 * the row wears the warn ring, stored or changed, and a stored row's breach
 * is a warning that holds no Save.
 *
 * @packageDocumentation
 */

import { decodeBeast2For, type EastType } from "@elaraai/east";
import type { FieldSpecValue } from "@elaraai/east-ui/internal";
import { fieldBreachIssue, fieldBreaches, getSomeorUndefined, type EditIssue, type FieldBreach } from "@elaraai/east-ui-components";

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

/** No breach: a row its form's bounds hold, or a form holding none. */
const NO_BREACHES: readonly FieldBreach[] = [];

/**
 * A form's check over its rows as bytes: each row decoded once and checked against the form's bounded fields, kept while
 * its bytes are the same object. A form holding no bounded field decodes nothing.
 *
 * @param specs - The row's form, as `Fields.specs` resolved it
 * @param rowType - The row's type
 * @returns Each row's breaches, by its bytes
 */
export function rowBreaches(specs: readonly FieldSpecValue[], rowType: EastType): (bytes: Uint8Array) => readonly FieldBreach[] {
    const bounded = specs.filter(isBounded);
    if (bounded.length === 0) return () => NO_BREACHES;
    const decode = decodeBeast2For(rowType) as (bytes: Uint8Array) => unknown;
    const kept = new WeakMap<Uint8Array, readonly FieldBreach[]>();
    return (bytes) => {
        let found = kept.get(bytes);
        if (found === undefined) {
            found = fieldBreaches(bounded, decode(bytes));
            kept.set(bytes, found);
        }
        return found;
    };
}
