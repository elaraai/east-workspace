/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

/**
 * React-side binding integration for the Experiment surface.
 *
 * `useBindingValue<T>(binding)` is a thin reactive wrapper over the shared
 * `BindRuntime.buildBindHandle` — the same handle that powers every other
 * `Data.bind` consumer. It builds the handle for the binding's
 * `(sourceType, source, patch, mode)`, subscribes to the staged store + reactive
 * dataset cache so the surface re-renders on edits, and exposes the value plus
 * `mutate` / `commit` / `discard`.
 *
 * Generic over the bound value type and tolerant of a `null` binding (so the
 * caller can hand it an absent optional binding without violating the rules of
 * hooks). Returns `value: null` until the binding has run.
 *
 * @packageDocumentation
 */

import { useCallback, useMemo, useSyncExternalStore } from 'react';
import { type ValueTypeOf } from '@elaraai/east';
import type { TreePath } from '@elaraai/e3-types';
import { DiffBindingType } from '@elaraai/e3-ui/internal';
import {
    defaultBindRuntime,
    getBindingTypes,
    getReactiveDatasetCache,
    getStagedStore,
    awaitPendingWrites,
    datasetCacheKey,
    type BindHandle,
} from '../platform/index.js';

type DiffBindingValue = ValueTypeOf<typeof DiffBindingType>;

const EMPTY_PATH = [] as unknown as TreePath;

export interface UseBindingValueResult<T> {
    /** Current value (buffered if staged, otherwise server). `null` until the
     *  binding has run or if the binding is absent. */
    value: T | null;
    /** True when there is an in-flight staged change. */
    pending: boolean;
    /** Replace the bound value (staged buffers, direct writes through). */
    mutate: (next: T) => void;
    /** Resolve the in-flight change. */
    commit: () => Promise<void>;
    /** Drop the in-flight change. */
    discard: () => void;
}

/** Subscribe to a binding's source (+ patch) version on both stores. */
function useBindingVersion(
    workspace: string,
    sourcePath: TreePath,
    patchPath: TreePath | undefined,
): number {
    const staged = getStagedStore();
    const cache = getReactiveDatasetCache();
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
 * Resolve a {@link DiffBindingType} value (or `null`) into a live, reactive
 * value of type `T`, delegating to the shared bind runtime.
 */
export function useBindingValue<T>(binding: DiffBindingValue | null): UseBindingValueResult<T> {
    const cache = getReactiveDatasetCache();
    const workspace = cache.getConfig().workspace ?? '';
    const sourcePath = (binding ? binding.source : EMPTY_PATH) as TreePath;
    const mode = binding ? binding.mode.type : 'direct';
    const patchPath = binding && binding.patch.type === 'some'
        ? (binding.patch.value as TreePath)
        : undefined;

    const version = useBindingVersion(workspace, sourcePath, patchPath);

    const handle = useMemo<BindHandle | null>(() => {
        if (!binding) return null;
        const types = getBindingTypes(workspace, sourcePath);
        if (!types) return null;
        return defaultBindRuntime.buildBindHandle(types.sourceType, sourcePath, patchPath, mode);
    }, [binding, workspace, sourcePath, patchPath, mode]);

    const { value, pending } = useMemo(() => {
        if (!handle || !handle.has()) return { value: null as T | null, pending: false };
        try {
            return { value: handle.read() as T, pending: handle.pending() };
        } catch {
            return { value: null as T | null, pending: false };
        }
        // `version` drives recompute when buffers / server values change.
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [handle, version]);

    const mutate = useCallback((next: T) => { handle?.write(next); }, [handle]);
    const commit = useCallback(async (): Promise<void> => {
        handle?.commit();
        await awaitPendingWrites();
    }, [handle]);
    const discard = useCallback(() => { handle?.discard(); }, [handle]);

    return { value, pending, mutate, commit, discard };
}
