/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

/**
 * Derive a `DataManifest` by walking an East function's IR.
 *
 * Finds every `Data.bind` / `Data.bindPaged` / `Func.bind` / `Record.bind`
 * platform call (the walker recurses into nested `FunctionIR` bodies) and reads
 * back its statically-known arguments: the dataset path + optional patch path
 * for `Data.bind`, the source path for `Data.bindPaged`, the function name for
 * `Func.bind`, the record name for `Record.bind`.
 *
 * Paged sources land in their own `pages` list rather than `paths`: they are
 * declared (so a `ui()` task's reads stay manifest-scoped) but deliberately not
 * preloaded or polled as whole values. A record bound with `Record.bind` is
 * preloaded and polled whole — its path in `paths` — unless it is also bound
 * with `Data.bindPaged` (#1199): a record read a window at a time is never
 * fetched whole, so it stays in `records` and `pages` alone, and its revision
 * is followed through the paged runtime's watch. Its handle's `read()` is then
 * served by nothing, which is why nothing over such a record calls it.
 *
 * Every such argument is required to be a JS-side constant — the public
 * factories enforce this through their TS signatures and `East.value`.
 * `constValueOf` reconstructs the JS value from that constant IR and throws if
 * it is a computed expression rather than a literal.
 *
 * @packageDocumentation
 */

import type { IR, OptionType, PlatformIR, ValueTypeOf } from '@elaraai/east';
import { variant, walkIR, constValueOf } from '@elaraai/east';
import type { TreePath, TreePathType } from '@elaraai/e3-types';
import type { DataManifest } from './manifest.js';

/** Platform-fn name we extract paths from. */
const DATA_BIND = "data_bind";

/** Platform-fn names we extract paged-source paths from: `Data.bindPaged`'s
 *  own, and the one a UI exported before pinned reads calls. */
const DATA_BIND_PAGED_PINNED = "data_bind_paged_pinned";
const DATA_BIND_PAGED = "data_bind_paged";

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
    const pages: TreePath[] = [];
    walkIR(fn.toIR().ir, (node) => {
        if (node.type !== 'Platform') return;
        const platform = node as PlatformIR;
        switch (platform.value.name) {
            case FUNCTION_BIND:
                functions.push(constValueOf(platform.value.arguments[0] as IR) as string);
                return;
            case RECORD_BIND: {
                // Bind the record's name; its `.records.<name>` path is
                // preloaded below, unless the record is read paged too.
                records.push(constValueOf(platform.value.arguments[0] as IR) as string);
                return;
            }
            case DATA_BIND: {
                // arg[0] source TreePath; arg[1] patch option<TreePath>.
                paths.push(constValueOf(platform.value.arguments[0] as IR) as TreePath);
                const patch = constValueOf(platform.value.arguments[1] as IR) as ValueTypeOf<OptionType<TreePathType>>;
                if (patch.type === 'some') paths.push(patch.value);
                return;
            }
            case DATA_BIND_PAGED_PINNED:
            case DATA_BIND_PAGED: {
                // arg[0] source TreePath. Paged sources are read by window, so
                // they are declared here but never preloaded as whole values.
                pages.push(constValueOf(platform.value.arguments[0] as IR) as TreePath);
                return;
            }
        }
    });
    // Each bound record's value is preloaded and polled like any dataset — but
    // a record also bound paged, which is read a window at a time (#1199).
    const paged = new Set(pages.map(pathKey));
    for (const name of new Set(records)) {
        const path: TreePath = [variant('field', 'records'), variant('field', name)];
        if (!paged.has(pathKey(path))) paths.push(path);
    }
    return {
        paths: dedupePaths(paths),
        functions: [...new Set(functions)],
        records: [...new Set(records)],
        pages: dedupePaths(pages),
    };
}

/** A path's identity, as the manifest dedupes and matches paths by. */
function pathKey(path: TreePath): string {
    return path.map(s => `${s.type}:${s.value}`).join('/');
}

function dedupePaths(paths: TreePath[]): TreePath[] {
    const seen = new Set<string>();
    const result: TreePath[] = [];
    for (const p of paths) {
        const k = pathKey(p);
        if (seen.has(k)) continue;
        seen.add(k);
        result.push(p);
    }
    return result;
}
