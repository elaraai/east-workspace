/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

/**
 * Formatting for injected constraints — one place that turns a
 * contract-variant value into the words a chip renders, shared by the
 * judgement facet and the journal.
 *
 * A constraint is `variant(leverCase, payload)`, a value of the solution's
 * contract `C`, and the contract case's East type says how its payload
 * prints: an op variant (`atMost 36`), a struct
 * (`person Patel · from Mar 12 · to Mar 15`), or a bare value. Nothing is
 * read off a value's JavaScript shape. The lever's display label comes from
 * the decision's `levers` when available, falling back to the contract case
 * name.
 */

import {
    printFor,
    type DateTimeType,
    type EastTypeValue,
    type FloatType,
    type StringType,
    type ValueTypeOf,
    type variant,
} from '@elaraai/east';
import type { LeverType } from '@elaraai/e3-ui/internal';
import { formatters, type Formatters } from '@elaraai/east-ui-components';

import type { ConstraintContract } from './contract.js';

type LeverValue = ValueTypeOf<typeof LeverType>;

/** A struct's fields or a variant's cases, as East types. */
type Members = ReadonlyArray<{ name: string; type: EastTypeValue }>;

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

/** East's printer for a type within a contract. */
type Printer = (type: EastTypeValue) => (value: unknown) => string;

const PRINTERS = new WeakMap<ConstraintContract, Printer>();

/** East's printers within a contract's own type context, so a payload type
 *  that refers back to a recursive contract prints. One per contract. */
function printerOf(contract: ConstraintContract): Printer {
    let printer = PRINTERS.get(contract);
    if (printer === undefined) {
        const context = new Map();
        printFor(contract.type, context);
        printer = (type) => printFor(type, context);
        PRINTERS.set(contract, printer);
    }
    return printer;
}

/** A payload value as chip text, through its East type, in the app's locale
 *  (#850): a date as its UTC month and day, a Float as East prints it in the
 *  locale's decimal separator, a String as itself, a Set's members and a
 *  struct's fields each through their own type, and anything else as East
 *  prints it. */
function formatValue(value: unknown, type: EastTypeValue, words: Formatters, print: Printer): string {
    switch (type.type) {
        case 'DateTime':
            return words.monthDay(value as ValueTypeOf<DateTimeType>);
        case 'Float':
            return words.float(value as ValueTypeOf<FloatType>);
        case 'String':
            return value as ValueTypeOf<StringType>;
        case 'Set': {
            const member = type.value as EastTypeValue;
            return `{${[...(value as ReadonlySet<unknown>)].map(m => formatValue(m, member, words, print)).join(', ')}}`;
        }
        case 'Struct':
            return (type.value as Members)
                .map(f => `${f.name} ${formatValue((value as Record<string, unknown>)[f.name], f.type, words, print)}`)
                .join(' · ');
        default:
            return print(type)(value);
    }
}

/**
 * The lever's display words plus the formatted payload. Dispatch is
 * type-directed: the contract — walked off the judgements binding, as the
 * lever editor's — gives the payload's East type, and the value's shape is
 * never guessed. Without the contract (its binding not yet registered) the
 * chip names the lever alone.
 *
 * @param constraint - The injected constraint, a value of the contract `C`
 * @param contract - The solution's constraint contract
 * @param levers - The decision's levers, for the display label
 * @param words - The formatters dates and numbers print through (#850); the
 *   runtime locale's when omitted
 * @returns The chip's lever, op and value words
 */
export function formatConstraint(
    constraint: variant<string, unknown>,
    contract: ConstraintContract | undefined,
    levers?: readonly LeverValue[],
    words: Formatters = formatters(),
): { lever: string; op: string; value: string } {
    const lever = levers?.find(l => l.case === constraint.type)?.label ?? constraint.type;
    const payload = contract?.payloads.get(constraint.type);
    if (contract === undefined || payload === undefined) return { lever, op: '·', value: '' };
    const print = printerOf(contract);
    if (payload.type === 'Variant') {
        // An op-variant payload: "<lever> <op word> <value>".
        const op = constraint.value as variant<string, unknown>;
        const word = OP_WORDS[op.type] ?? op.type;
        const opType = (payload.value as Members).find(c => c.name === op.type)!.type;
        if (opType.type === 'Struct') {
            const fields = opType.value as Members;
            const min = fields.find(f => f.name === 'min');
            const max = fields.find(f => f.name === 'max');
            if (min !== undefined && max !== undefined) {
                const range = op.value as Record<'min' | 'max', unknown>;
                return { lever, op: word, value: `${formatValue(range.min, min.type, words, print)} – ${formatValue(range.max, max.type, words, print)}` };
            }
        }
        return { lever, op: word, value: formatValue(op.value, opType, words, print) };
    }
    // A struct or bare payload: "<lever> · <payload>".
    return { lever, op: '·', value: formatValue(constraint.value, payload, words, print) };
}
