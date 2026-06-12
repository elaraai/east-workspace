/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

/**
 * Derive a `DataManifest` by walking an East function's IR.
 *
 * Finds every `Data.bind(...)` platform call (the walker recurses into
 * nested `FunctionIR` bodies) and reads its source + (optional) patch
 * path arguments, plus every `Func.bind(...)` platform call and reads
 * its literal function name.
 *
 * Both arguments are required to be statically known JS-side
 * `TreePath`s — the public `Data.bind` factory enforces this through
 * its TS signature. Each path arrives as East-compiled structured IR:
 *
 *   - source: `NewArray` of `Variant("field", Value(string))` (the
 *     TreePath array literal)
 *   - patch:  `Variant("some"|"none", inner)` where `inner` for
 *     `some` is the same `NewArray` shape as a source path
 *
 * Anything else is a programmer error and throws.
 *
 * @packageDocumentation
 */

import type { IR, NewArrayIR, VariantIR, ValueIR, PlatformIR } from '@elaraai/east';
import { variant, walkIR, literalValueOf } from '@elaraai/east';
import type { TreePath } from '@elaraai/e3-types';
import type { DataManifest } from './manifest.js';

/** Platform-fn name we extract paths from. */
const DATA_BIND = "data_bind";

/** Platform-fn name we extract bound function names from. */
const FUNCTION_BIND = "function_bind";

/** Walk `fn`'s IR and derive its bound-path manifest. */
export function deriveManifest(
    fn: { toIR(): { ir: IR } },
): DataManifest {
    const paths: TreePath[] = [];
    const functions: string[] = [];
    walkIR(fn.toIR().ir, (node) => {
        if (node.type !== 'Platform') return;
        const platform = node as PlatformIR;
        if (platform.value.name === FUNCTION_BIND) {
            functions.push(readFunctionName(platform.value.arguments[0] as IR));
            return;
        }
        if (platform.value.name !== DATA_BIND) return;

        // arg[0] — source: always a NewArray of Variant("field", Value(string)).
        paths.push(readTreePath(platform.value.arguments[0] as IR));

        // arg[1] — patch: Option<TreePath>, encoded as a Variant IR with
        // case "some" (carrying a NewArray inner) or "none".
        const patchArg = platform.value.arguments[1] as IR;
        if (patchArg.type !== 'Variant') {
            throw new Error(
                `Data.bind: patch must be a literal Option<TreePath>; got dynamic IR (${patchArg.type}).`,
            );
        }
        const patchVariant = (patchArg as VariantIR).value;
        if (patchVariant.case === 'some') {
            paths.push(readTreePath(patchVariant.value as IR));
        } else if (patchVariant.case !== 'none') {
            throw new Error(
                `Data.bind: patch variant tag must be "some" or "none"; got "${patchVariant.case}".`,
            );
        }
    });
    return { paths: dedupePaths(paths), functions: [...new Set(functions)] };
}

/**
 * Read a literal function name from a `Value` IR node — the only shape
 * `Func.bind` produces (its TS signature requires a JS string).
 */
function readFunctionName(ir: IR): string {
    if (ir.type !== 'Value') {
        throw new Error(
            `Func.bind: the function name must be a literal string; got dynamic IR (${ir.type}). ` +
            `Pass a JS string, not a computed expression.`,
        );
    }
    const name = literalValueOf(ir as ValueIR);
    if (typeof name !== 'string') {
        throw new Error(`Func.bind: the function name must be a string literal; got ${typeof name}.`);
    }
    return name;
}

/**
 * Read a literal `TreePath` from a `NewArray` IR node. Each element is
 * a `Variant("field", Value(string))` produced by East.value-wrapping a
 * `TreePath` JS literal. Used for both the source path arg and the
 * inner of a `some(path)` patch variant.
 */
function readTreePath(ir: IR): TreePath {
    if (ir.type !== 'NewArray') {
        throw new Error(
            `Data.bind: path must be a literal TreePath; got dynamic IR (${ir.type}). ` +
            `Pass a JS TreePath (e.g. someInput.path), not a computed expression.`,
        );
    }
    return (ir as NewArrayIR).value.values.map((segIR: IR) => {
        const v = segIR as VariantIR;
        const fieldName = literalValueOf(v.value.value as ValueIR) as string;
        return variant('field', fieldName);
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
