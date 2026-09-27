/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

/**
 * Internal — a solution's constraint contract, read off the judgements
 * binding's registered East type.
 *
 * The judgements dataset is a `Dict<String, JudgementInput<C>>`
 * (`judgementInputType(C)` in `@elaraai/e3-ui`), whose `constraints` field is
 * an `Array<C>`: `C` is the solution's by-name contract variant. The lever
 * editor and the constraint chips dispatch on `C`'s cases, as East types.
 *
 * @packageDocumentation
 */

import { useMemo } from 'react';
import type { EastTypeValue } from '@elaraai/east';
import type { TreePath } from '@elaraai/e3-types';

import { getBindingTypes, getReactiveDatasetCache } from '../platform/index.js';
import type { DecisionHandleRefValue } from './handle-runtime.js';

/** A solution's constraint contract, as East types. */
export interface ConstraintContract {
    /** The contract `C` itself — a by-name `VariantType`, perhaps recursive. */
    readonly type: EastTypeValue;
    /** Each of `C`'s cases' payload types, by case name. */
    readonly payloads: ReadonlyMap<string, EastTypeValue>;
}

/** A recursive type's body, or the type itself. */
function body(type: EastTypeValue): EastTypeValue {
    return type.type === 'Recursive' && type.value.type === 'wrapper' ? type.value.value.inner as EastTypeValue : type;
}

/**
 * The constraint contract a judgements dataset's type carries.
 *
 * @param judgementsType - The judgements binding's registered East type, a
 *   `Dict<String, JudgementInput<C>>`
 * @returns The contract `C` and its cases' payload types; `undefined` when the
 *   type is not a judgements record
 */
export function constraintContractOf(judgementsType: EastTypeValue): ConstraintContract | undefined {
    const dict = body(judgementsType);
    if (dict.type !== 'Dict') return undefined;
    const record = body(dict.value.value as EastTypeValue);
    if (record.type !== 'Struct') return undefined;
    const field = (record.value as Array<{ name: string; type: EastTypeValue }>).find(f => f.name === 'constraints');
    if (field === undefined) return undefined;
    const constraints = body(field.type);
    if (constraints.type !== 'Array') return undefined;
    const contract = constraints.value as EastTypeValue;
    const cases = body(contract);
    if (cases.type !== 'Variant') return undefined;
    return {
        type: contract,
        payloads: new Map((cases.value as Array<{ name: string; type: EastTypeValue }>).map(c => [c.name, c.type])),
    };
}

/**
 * The constraint contract of a decision handle's judgements binding — what the
 * lever editor and the constraint chips dispatch on.
 *
 * @param ref - The decision handle's binding descriptors
 * @returns The contract; `undefined` until the judgements binding's type is
 *   registered
 */
export function useConstraintContract(ref: DecisionHandleRefValue | null): ConstraintContract | undefined {
    const workspace = getReactiveDatasetCache().getConfig().workspace ?? '';
    return useMemo(() => {
        if (ref === null) return undefined;
        const judgements = getBindingTypes(workspace, ref.judgements.source as TreePath);
        return judgements === undefined ? undefined : constraintContractOf(judgements.sourceType);
    }, [ref, workspace]);
}
