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
import { encodeBeast2For, FloatType, IntegerType, type EastType } from '@elaraai/east';
import type { TreePath } from '@elaraai/e3-types';

// Minimal structural shapes of the e3 SDK def objects. The snapshot only needs
// these fields for its type guards + offline seeding, so it depends on
// `@elaraai/e3-types` (TreePath) rather than the full `@elaraai/e3` SDK — whose
// real def-types (DatasetDef/FunctionDef/RecordDef/MutationDef) additionally carry
// a `Runner` the snapshot never inspects.
type DatasetDef = { kind: 'dataset'; path: TreePath; type: EastType; default?: unknown };
type FunctionDef = { kind: 'function'; name: string; inputTypes: readonly EastType[]; outputType: EastType; body: unknown };
type RecordDef = { recordKind: 'record'; name: string; type: EastType; default: unknown };
type MutationDef = { kind: 'mutation'; name: string; argTypes: readonly EastType[]; body: unknown; record: { name: string } };
import {
    ReactiveDatasetCache,
    initializeReactiveDatasetCache,
    initializeFunctionApi,
    createInMemoryFunctionApi,
    initializeRecordApi,
    createInMemoryRecordApi,
    initializePagedApi,
    createInMemoryPagedApi,
    datasetCacheKey,
    type DatasetApi,
    type InMemoryFunctionDef,
    type InMemoryRecordDef,
    type InMemoryPagedSource,
} from '@elaraai/e3-ui-components';
import { mountSnapshot } from '../../../scripts/snapshot-app.tsx';

const WORKSPACE = 'snapshot';

/** An export is a seedable input iff it's a `DatasetDef` with a default. */
function isSeedableInput(x: unknown): x is DatasetDef & { default: NonNullable<DatasetDef['default']> } {
    return typeof x === 'object' && x !== null
        && (x as DatasetDef).kind === 'dataset'
        && (x as DatasetDef).default !== undefined;
}

/** An export is a seedable function iff it's an `e3.function` def. */
function isFunctionDef(x: unknown): x is FunctionDef {
    return typeof x === 'object' && x !== null && (x as FunctionDef).kind === 'function';
}

/**
 * Compile a module's exported `e3.function`s into offline implementations.
 *
 * The showcase / snapshot can't run an e3 backend, so `Func.bind` has no server
 * to call. We stand in by compiling each function's East body to JS (East
 * functions are runnable on their own) and registering it — the function-side
 * mirror of the `e3.input` dataset seeding. One source of truth; no duplicated
 * fixture values.
 */
function seedFunctions(mod: Record<string, unknown>): InMemoryFunctionDef[] {
    const defs: InMemoryFunctionDef[] = [];
    for (const value of Object.values(mod)) {
        if (!isFunctionDef(value)) continue;
        const body = value.body as {
            compile?: (p: never[]) => (...a: unknown[]) => unknown;
            compileAsync?: (p: never[]) => (...a: unknown[]) => Promise<unknown>;
        };
        try {
            const fn = typeof body.compile === 'function' ? body.compile([]) : body.compileAsync!([]);
            defs.push({ name: value.name, inputTypes: [...value.inputTypes], outputType: value.outputType, fn });
        } catch (err) {
            console.warn(`[snapshot] could not compile function "${value.name}":`, err);
        }
    }
    return defs;
}

/** Hand-written offline impls for `Func.bind` examples whose `e3.function` defs
 *  aren't exported from their module (so {@link seedFunctions} can't find them). */
const FALLBACK_FUNCTIONS: InMemoryFunctionDef[] = [
    { name: 'forecast', inputTypes: [IntegerType, FloatType], outputType: FloatType, fn: (periods, growth) => Number(periods as bigint) * (growth as number) * 100 },
    { name: 'rebalance', inputTypes: [FloatType], outputType: FloatType, fn: (x) => 1 - (x as number) },
];

/** An export is a seedable record iff it's an `e3.record` def. A record *is a*
 *  dataset (`kind: 'dataset'`); `recordKind` is the distinguishing discriminant. */
function isRecordDef(x: unknown): x is RecordDef {
    return typeof x === 'object' && x !== null && (x as RecordDef).recordKind === 'record';
}

/** An export is a mutation iff it's an `e3.mutation` def. */
function isMutationDef(x: unknown): x is MutationDef {
    return typeof x === 'object' && x !== null && (x as MutationDef).kind === 'mutation';
}

/**
 * Compile a module's exported `e3.record`s + `e3.mutation`s into offline
 * implementations — the record-side mirror of {@link seedFunctions}. Each
 * mutation's East reducer body is compiled to JS and grouped under the record
 * it writes (matched by name), so `Record.bind` reads / mutates resolve with no
 * e3 backend.
 */
function seedRecords(mod: Record<string, unknown>): InMemoryRecordDef[] {
    const mutations = Object.values(mod).filter(isMutationDef);
    const defs: InMemoryRecordDef[] = [];
    for (const rec of Object.values(mod)) {
        if (!isRecordDef(rec)) continue;
        const recMutations: InMemoryRecordDef['mutations'] = [];
        for (const m of mutations) {
            if (m.record.name !== rec.name) continue;
            const body = m.body as { compile?: (p: never[]) => (...a: unknown[]) => unknown };
            try {
                const reduce = body.compile!([]);
                recMutations.push({ name: m.name, argTypes: [...m.argTypes], reduce });
            } catch (err) {
                console.warn(`[snapshot] could not compile mutation "${m.name}":`, err);
            }
        }
        defs.push({ name: rec.name, stateType: rec.type, initial: rec.default, mutations: recMutations });
    }
    return defs;
}

/** Seed an in-memory dataset cache from a module's exported `e3.input`s. */
async function seedCache(mod: Record<string, unknown>): Promise<void> {
    const seed = new Map<string, Uint8Array>();
    const inputPaths: TreePath[] = [];
    for (const value of Object.values(mod)) {
        if (!isSeedableInput(value)) continue;
        seed.set(datasetCacheKey(WORKSPACE, value.path), encodeBeast2For(value.type)(value.default as never));
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

    // Offline implementations for the `Func.bind` functions the example calls:
    // every exported `e3.function` compiled from its East body, plus hand-written
    // fallbacks for examples that don't export their defs.
    const fns = new Map<string, InMemoryFunctionDef>();
    for (const f of seedFunctions(mod)) fns.set(f.name, f);
    for (const f of FALLBACK_FUNCTIONS) if (!fns.has(f.name)) fns.set(f.name, f);
    initializeFunctionApi(createInMemoryFunctionApi([...fns.values()]), WORKSPACE);

    // Offline `Data.bindPaged` windows over the same seeded inputs. A paged
    // source is served BY WINDOW out of the input's own default value, so an
    // example that binds one renders (as an empty-but-live canvas when the
    // default is `[]`) instead of throwing "no workspace configured".
    const pagedSources: InMemoryPagedSource[] = [];
    for (const value of Object.values(mod)) {
        if (!isSeedableInput(value)) continue;
        if ((value.type as { type: string }).type !== 'Array') continue;
        const encode = encodeBeast2For(value.type);
        pagedSources.push({
            path: value.path,
            encode: (elements) => encode(elements as never),
            elements: [...(value.default as unknown[])],
        });
    }
    initializePagedApi(createInMemoryPagedApi(pagedSources), WORKSPACE);

    // Offline `Record.bind` impls — seeds each record's initial state into the
    // cache (so `read()` resolves) and stands in for the mutation backend.
    const recordDefs = seedRecords(mod);
    if (recordDefs.length > 0) {
        initializeRecordApi(createInMemoryRecordApi(cache, WORKSPACE, recordDefs), cache, WORKSPACE);
    }

    await Promise.all(inputPaths.map(path => cache.preload(WORKSPACE, path)));
}

mountSnapshot({
    modules: import.meta.glob<Record<string, unknown>>('../../e3-ui/test/**/*.examples.{ts,tsx}'),
    keyOf: (fp) => fp.replace(/^.*\/e3-ui\/test\//, '').replace(/\.examples\.tsx?$/, ''),
    prepare: seedCache,
});
