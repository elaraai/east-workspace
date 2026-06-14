/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

/**
 * Derive a `DataManifest` by walking an East function's IR.
 *
 * Finds every `Data.bind` / `Func.bind` / `Record.bind` platform call (the
 * walker recurses into nested `FunctionIR` bodies) and reads back its
 * statically-known arguments: the dataset path + optional patch path for
 * `Data.bind`, the function name for `Func.bind`, the record name for
 * `Record.bind`.
 *
 * Every such argument is required to be a JS-side constant — the public
 * factories enforce this through their TS signatures and `East.value`.
 * `constValueOf` reconstructs the JS value from that constant IR and throws if
 * it is a computed expression rather than a literal.
 *
 * @packageDocumentation
 */

import type { IR, PlatformIR } from '@elaraai/east';
import { variant, walkIR, constValueOf } from '@elaraai/east';
import type { TreePath } from '@elaraai/e3-types';
import type { DataManifest } from './manifest.js';

/** Platform-fn name we extract paths from. */
const DATA_BIND = "data_bind";

/** Platform-fn name we extract bound function names from. */
const FUNCTION_BIND = "function_bind";

/** Platform-fn name we extract bound record names from. */
const RECORD_BIND = "record_bind";

/** Walk `fn`'s IR and derive its bound-path manifest. */
export function deriveManifest(
    fn: { toIR(): { ir: IR } },
): DataManifest {
    const paths: TreePath[] = [];
    const functions: string[] = [];
    const records: string[] = [];
    walkIR(fn.toIR().ir, (node) => {
        if (node.type !== 'Platform') return;
        const platform = node as PlatformIR;
        switch (platform.value.name) {
            case FUNCTION_BIND:
                functions.push(constValueOf(platform.value.arguments[0] as IR) as string);
                return;
            case RECORD_BIND: {
                // Bind the record's name, and preload its `.records.<name>`
                // path so the record's value is polled like any dataset.
                const name = constValueOf(platform.value.arguments[0] as IR) as string;
                records.push(name);
                paths.push([variant('field', 'records'), variant('field', name)]);
                return;
            }
            case DATA_BIND: {
                // arg[0] source TreePath; arg[1] patch option<TreePath>.
                paths.push(constValueOf(platform.value.arguments[0] as IR) as TreePath);
                const patch = constValueOf(platform.value.arguments[1] as IR) as { type: string; value: TreePath };
                if (patch.type === 'some') paths.push(patch.value);
                return;
            }
        }
    });
    return { paths: dedupePaths(paths), functions: [...new Set(functions)], records: [...new Set(records)] };
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
