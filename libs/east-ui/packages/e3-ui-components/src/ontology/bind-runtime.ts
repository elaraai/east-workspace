/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

/**
 * React-side binding integration for the Ontology editor.
 *
 * `useBindingOntology(binding)` is a thin reactive wrapper over the shared
 * `BindRuntime.buildBindHandle` — the same handle that powers every other
 * `Data.bind` consumer (including `EastChakraDiff`). It builds the handle for
 * the binding's `(sourceType, source, patch, mode)`, subscribes to the staged
 * store + reactive dataset cache so the canvas re-renders on edits, and exposes
 * the handle's `read` / `write` / `pending` / `commit` / `discard` as an
 * ontology-typed surface.
 *
 * Deliberately holds no decode/stage/commit logic of its own: mode semantics
 * (direct write-through, staged buffering, patch publish) live once, in the
 * runtime. In particular `pending` and `read` honour the handle's per-mode
 * behaviour — e.g. a direct binding never reports a staged buffer.
 *
 * @packageDocumentation
 */

import { useCallback, useMemo, useSyncExternalStore } from 'react';
import { type ValueTypeOf } from '@elaraai/east';
import type { TreePath } from '@elaraai/e3-types';
import { DiffBindingType } from '@elaraai/e3-ui';
import {
    defaultBindRuntime,
    getBindingTypes,
    getReactiveDatasetCache,
    getStagedStore,
    awaitPendingWrites,
    datasetCacheKey,
    type BindHandle,
} from '../platform/index.js';
import type { Ontology } from './types.js';

type DiffBindingValue = ValueTypeOf<typeof DiffBindingType>;

export interface UseBindingOntologyResult {
    /** Current ontology value (buffered if staged, otherwise server). `null`
     *  if the binding hasn't run yet (no registered types) or the source
     *  dataset has no value. */
    ontology: Ontology | null;
    /** True when there is an in-flight staged change. Always false for direct
     *  bindings — the handle writes through, never buffers. */
    pending: boolean;
    /** Replace the bound value. In staged mode buffers the write; in direct
     *  mode writes through immediately. */
    mutate: (next: Ontology) => void;
    /** Resolve the in-flight change. */
    commit: () => Promise<void>;
    /** Drop the in-flight change. */
    discard: () => void;
}

/**
 * Subscribe to a binding's source (and patch, if any) path on both the staged
 * store and the reactive dataset cache. Re-renders any time a version bumps.
 */
function useBindingVersion(
    workspace: string,
    sourcePath: TreePath,
    patchPath: TreePath | undefined,
): number {
    const staged = getStagedStore();
    const cache  = getReactiveDatasetCache();
    const keys = useMemo(() => {
        const ks = [datasetCacheKey(workspace, sourcePath)];
        if (patchPath) ks.push(datasetCacheKey(workspace, patchPath));
        return ks;
    }, [workspace, sourcePath, patchPath]);
    const subscribe = useCallback((cb: () => void) => {
        const unsubs = keys.flatMap(k => [staged.subscribe(k, cb), cache.subscribe(k, cb)]);
        return () => { for (const u of unsubs) u(); };
    }, [staged, cache, keys]);
    const getSnapshot = useCallback(
        () => keys.reduce((sum, k) => sum + staged.getKeyVersion(k) + cache.getKeyVersion(k), 0),
        [staged, cache, keys],
    );
    return useSyncExternalStore(subscribe, getSnapshot);
}

/**
 * Resolve a {@link DiffBindingType} value into a live ontology + the
 * commit / discard / mutate handlers, delegating to the shared bind runtime.
 *
 * Returns `ontology: null` if the binding hasn't run yet (types not
 * registered) or no source value is present.
 */
export function useBindingOntology(binding: DiffBindingValue): UseBindingOntologyResult {
    const cache = getReactiveDatasetCache();
    const workspace = cache.getConfig().workspace ?? '';
    const sourcePath = binding.source as TreePath;
    const mode = binding.mode.type;
    const patchPath = binding.patch.type === 'some' ? (binding.patch.value as TreePath) : undefined;

    // Bump on every staged buffer or server value change for source/patch.
    const version = useBindingVersion(workspace, sourcePath, patchPath);

    const handle = useMemo<BindHandle | null>(() => {
        // Only buildable once `Data.bind` has registered the binding's types.
        if (!getBindingTypes(workspace, sourcePath)) return null;
        const { sourceType } = getBindingTypes(workspace, sourcePath)!;
        return defaultBindRuntime.buildBindHandle(sourceType, sourcePath, patchPath, mode);
    }, [workspace, sourcePath, patchPath, mode]);

    const { ontology, pending } = useMemo(() => {
        if (!handle || !handle.has()) return { ontology: null, pending: false };
        try {
            return { ontology: handle.read() as Ontology, pending: handle.pending() };
        } catch {
            return { ontology: null, pending: false };
        }
        // `version` drives recompute when buffers / server values change.
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [handle, version]);

    const mutate = useCallback((next: Ontology) => {
        handle?.write(next);
    }, [handle]);

    const commit = useCallback(async (): Promise<void> => {
        handle?.commit();
        await awaitPendingWrites();
    }, [handle]);

    const discard = useCallback(() => {
        handle?.discard();
    }, [handle]);

    return { ontology, pending, mutate, commit, discard };
}
