/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

/**
 * Snapshot entry for e3-task-bound east-ui components. Discovers every
 * `e3-ui/test/*.examples.ts` via `import.meta.glob`, then hands rendering
 * to the shared {@link mountSnapshot} harness with a `prepare` step that
 * seeds an in-memory reactive-dataset cache from each example's `e3.input`
 * defaults (so `Data.bind(...)` reads resolve offline).
 *
 * @packageDocumentation
 */

import '@elaraai/east-ui-components/fonts';
// Side-effect import: registers the `Data.bind` platform impl + the Diff /
// Ontology renderers against the global registries. The Ontology renderer
// self-injects the xyflow stylesheet via emotion, so no separate CSS import
// is needed here.
import '@elaraai/e3-ui-components';
import { encodeBeast2For } from '@elaraai/east';
import type { DatasetDef } from '@elaraai/e3';
import type { TreePath } from '@elaraai/e3-types';
import {
    ReactiveDatasetCache,
    initializeReactiveDatasetCache,
    datasetCacheKey,
    type DatasetApi,
} from '@elaraai/e3-ui-components';
import { mountSnapshot } from '../../../scripts/snapshot-app.tsx';

const WORKSPACE = 'snapshot';

/** An export is a seedable input iff it's a `DatasetDef` with a default. */
function isSeedableInput(x: unknown): x is DatasetDef & { default: NonNullable<DatasetDef['default']> } {
    return typeof x === 'object' && x !== null
        && (x as DatasetDef).kind === 'dataset'
        && (x as DatasetDef).default !== undefined;
}

/** Seed an in-memory dataset cache from a module's exported `e3.input`s. */
async function seedCache(mod: Record<string, unknown>): Promise<void> {
    const seed = new Map<string, Uint8Array>();
    const inputPaths: TreePath[] = [];
    for (const value of Object.values(mod)) {
        if (!isSeedableInput(value)) continue;
        seed.set(datasetCacheKey(WORKSPACE, value.path), encodeBeast2For(value.type)(value.default));
        inputPaths.push(value.path);
    }

    const api: DatasetApi = {
        async get(ws, path) {
            const bytes = seed.get(datasetCacheKey(ws, path));
            if (!bytes) throw new Error(`no seed for ${datasetCacheKey(ws, path)}`);
            return { data: bytes, hash: null };
        },
        async set(ws, path, value) { seed.set(datasetCacheKey(ws, path), value); },
        async launchDataflow() { /* offline — nothing to launch */ },
        async listRoot() { return []; },
        async listAt() { return []; },
        async workspaceStatus() { return { datasets: [] }; },
    };

    const cache = new ReactiveDatasetCache({ workspace: WORKSPACE }, api);
    cache.setScheduler((notify) => queueMicrotask(notify));
    initializeReactiveDatasetCache(cache);
    await Promise.all(inputPaths.map(path => cache.preload(WORKSPACE, path)));
}

mountSnapshot({
    modules: import.meta.glob<Record<string, unknown>>('../../e3-ui/test/**/*.examples.{ts,tsx}'),
    keyOf: (fp) => fp.replace(/^.*\/e3-ui\/test\//, '').replace(/\.examples\.tsx?$/, ''),
    prepare: seedCache,
});
