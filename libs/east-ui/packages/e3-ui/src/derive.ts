/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

/**
 * Derive a `DataManifest` by walking an East function's IR.
 *
 * Finds every `Data.bind(...)` platform call (the walker recurses into
 * nested `FunctionIR` bodies) and reads each call's path argument as a
 * literal `TreePath`. The IR shape for the path is fixed by how East wraps
 * the JS-side TreePath: a `NewArray` of `Variant("field", Value(String))`
 * entries — no variable indirection, no wrappers.
 *
 * @packageDocumentation
 */

import type {
    CallableFunctionExpr,
    CallableAsyncFunctionExpr,
    IR,
    NewArrayIR,
    VariantIR,
    ValueIR,
    PlatformIR,
} from '@elaraai/east';
import { variant, walkIR } from '@elaraai/east';
import type { TreePath } from '@elaraai/e3-types';
import type { DataManifest } from './manifest.js';

const DATA_BIND_NAME = 'data_bind';

/** Walk `fn`'s IR and derive its bound-path manifest. */
export function deriveManifest(
    fn: CallableFunctionExpr<any, any> | CallableAsyncFunctionExpr<any, any>,
): DataManifest {
    const paths: TreePath[] = [];
    walkIR(fn.toIR().ir, (node) => {
        if (node.type !== 'Platform') return;
        const platform = node as PlatformIR;
        if (platform.value.name !== DATA_BIND_NAME) return;
        paths.push(extractPath(platform.value.arguments[0] as IR));
    });
    return { paths: dedupePaths(paths) };
}

/** Read the literal `TreePath` out of `Data.bind`'s path-argument IR. */
function extractPath(ir: IR): TreePath {
    if (ir.type !== 'NewArray') {
        throw new Error(`Data.bind: expected NewArray for path arg, got "${ir.type}"`);
    }
    return (ir as NewArrayIR).value.values.map((segment: IR): TreePath[number] => {
        const v = segment as VariantIR;
        const lit = (v.value.value as ValueIR).value.value;
        return variant('field', lit.value as string);
    });
}

function dedupePaths(paths: TreePath[]): TreePath[] {
    const seen = new Set<string>();
    const result: TreePath[] = [];
    for (const p of paths) {
        const k = p.map(s => `${s.type}:${s.value}`).join('/');
        if (seen.has(k)) continue;
        seen.add(k);
        result.push(p);
    }
    return result;
}
