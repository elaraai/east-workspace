/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

/**
 * Formatting for injected constraints — one place that turns a
 * contract-variant value into the words a chip renders, shared by the
 * judgement facet and the journal.
 *
 * A constraint is `variant(leverCase, payload)` where the payload shape is
 * the solution's choice: an op variant (`atMost 36`), a struct
 * (`person Patel · from Mar 12 · to Mar 15`), or a bare primitive. The
 * lever's display label comes from the decision's `levers` when available,
 * falling back to the contract case name.
 */

import type { ValueTypeOf } from '@elaraai/east';
import type { LeverType } from '@elaraai/e3-ui/internal';

import type { ConstraintValue } from './handle-runtime.js';
import type { TypeNode } from './lever-editor.js';

type LeverValue = ValueTypeOf<typeof LeverType>;

/** Words for the well-known bounded-op case names. */
export const OP_WORDS: Record<string, string> = {
    eq: '=',
    neq: '≠',
    atMost: 'at most',
    atLeast: 'at least',
    between: 'between',
    before: 'before',
    after: 'after',
    in: 'in',
    notIn: 'not in',
    is: 'is',
};

function formatScalar(v: unknown): string {
    if (v instanceof Date) {
        return `${v.toLocaleString('en', { month: 'short' })} ${v.getDate()}`;
    }
    if (v instanceof Set) {
        return `{${[...v].map(formatScalar).join(', ')}}`;
    }
    if (v !== null && typeof v === 'object' && !(v as { type?: unknown }).type) {
        // struct payload: "k v · k v"
        return Object.entries(v as Record<string, unknown>)
            .map(([k, x]) => `${k} ${formatScalar(x)}`)
            .join(' · ');
    }
    return String(v);
}

/**
 * The lever's display words plus the formatted payload. Dispatch is
 * type-directed: `payloadType` is the contract case's payload type (walked
 * off the judgements binding, same as the lever editor) — the value's shape
 * is never guessed.
 */
export function formatConstraint(
    constraint: ConstraintValue,
    payloadType: TypeNode | undefined,
    levers?: readonly LeverValue[],
): { lever: string; op: string; value: string } {
    const c = constraint as unknown as { type: string; value: unknown };
    const lever = levers?.find(l => l.case === c.type)?.label ?? c.type;
    if (payloadType?.type === 'Variant') {
        // op-variant payload: "<lever> <op-word> <value>"
        const op = c.value as { type: string; value: unknown };
        const word = OP_WORDS[op.type] ?? op.type;
        const opType = payloadType.cases?.[op.type];
        if (opType?.type === 'Struct' && op.value !== null && typeof op.value === 'object') {
            const r = op.value as { min?: unknown; max?: unknown };
            if ('min' in r && 'max' in r) {
                return { lever, op: word, value: `${formatScalar(r.min)} – ${formatScalar(r.max)}` };
            }
        }
        return { lever, op: word, value: formatScalar(op.value) };
    }
    // struct / primitive payload: "<lever> · <payload>"
    return { lever, op: '·', value: formatScalar(c.value) };
}
