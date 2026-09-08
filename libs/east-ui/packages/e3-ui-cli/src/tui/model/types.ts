/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

/**
 * East type text for tables — `Array<Struct>`, `Dict<String, Struct>`,
 * `UIComponentType`: the top-level kind with its generic arguments' kinds
 * only, so a type fits a column.
 *
 * @packageDocumentation
 */

import type { EastTypeValue } from '@elaraai/east';

/** The kind name of a type (`Struct`, `String`, …). */
function kindOf(tv: EastTypeValue): string {
    if (tv.type === 'Variant') {
        const cases = (tv.value as { name: string }[]).map(c => c.name);
        if (cases.length === 2 && cases.includes('some') && cases.includes('none')) return 'Option';
    }
    return tv.type;
}

/**
 * The compact text of a type.
 *
 * @param tv - The type value
 * @param ui - Whether the dataset is a `ui` task's output (printed `UIComponentType`)
 * @returns The compact text
 */
export function compactType(tv: EastTypeValue, ui = false): string {
    if (ui) return 'UIComponentType';
    switch (tv.type) {
        case 'Array':
        case 'Set':
            return `${tv.type}<${kindOf(tv.value as EastTypeValue)}>`;
        case 'Dict': {
            const { key, value } = tv.value as { key: EastTypeValue; value: EastTypeValue };
            return `Dict<${kindOf(key)}, ${kindOf(value)}>`;
        }
        case 'Variant': {
            const kind = kindOf(tv);
            if (kind === 'Option') {
                const someCase = (tv.value as { name: string; type: EastTypeValue }[]).find(c => c.name === 'some');
                return someCase !== undefined ? `Option<${kindOf(someCase.type)}>` : 'Option';
            }
            return 'Variant';
        }
        case 'Recursive':
            return 'Recursive';
        default:
            return tv.type;
    }
}
