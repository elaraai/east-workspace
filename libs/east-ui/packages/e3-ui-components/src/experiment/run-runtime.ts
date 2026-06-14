/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

/**
 * Imperative `Func.bind` orchestration for the Experiment surface's **Run**.
 *
 * The surface receives only the function *name* in its payload
 * ({@link FuncBindingType}), not a live handle — the bound function runs after
 * the user edits the spec, so the renderer rebuilds the call handle itself. This
 * hook reconstructs the handle's signature from the bound data's row type
 * (recovered via `getBindingTypes`) plus the e3-ui-owned contract types, builds
 * a handle on the shared {@link defaultFuncRuntime}, subscribes to its tracked
 * channel, and exposes `call` / `result` / `status` / `pending` for React.
 *
 * All handles bound to the same `(workspace, name)` share one channel, so the
 * three calls (estimate / refute / dose) observe independently and re-render the
 * surface as each settles — exactly the launch/observe split `Func.bind` uses.
 *
 * @packageDocumentation
 */

import { useCallback, useMemo, useSyncExternalStore } from 'react';
import { toEastTypeValue, type EastType } from '@elaraai/east';
import { FuncBindHandleType } from '@elaraai/e3-ui/internal';
import {
    defaultFuncRuntime,
    funcChannelKey,
    getReactiveDatasetCache,
} from '../platform/index.js';

/** Lifecycle of the most recent call on a bound function's channel. */
export type FuncStatus = 'idle' | 'running' | 'succeeded' | 'failed' | 'cancelled';

/** What {@link useFuncCall} returns for one bound function. */
export interface FuncCall<R> {
    /** Launch the call, fire-and-forget (latest-wins). No-op when not ready. */
    call: (...args: unknown[]) => void;
    /** Last successful result, or `null` until the first success. */
    result: R | null;
    /** Lifecycle of the most recent call. */
    status: FuncStatus;
    /** True while a call is in flight. */
    pending: boolean;
}

type RawHandle = {
    call: (...a: unknown[]) => null;
    read: () => { type: 'some' | 'none'; value: unknown };
    status: () => { type: FuncStatus };
    pending: () => boolean;
};

const IDLE: FuncCall<never> = { call: () => {}, result: null, status: 'idle', pending: false };

/**
 * Build + observe a reactive call handle for a named workspace function.
 *
 * @typeParam R - The function's return type (decoded JS shape).
 * @param name - The bound function name, or `null` when the binding is absent
 *   (the hook degrades to an inert idle handle — safe for the rules of hooks).
 * @param inputs - The positional parameter East types (e.g. `[Array(Row), Spec]`).
 *   `null` until the row type is known.
 * @param output - The return East type.
 * @returns A {@link FuncCall} — stable `call` plus the reactive `result` /
 *   `status` / `pending` of this function's shared channel.
 */
export function useFuncCall<R>(
    name: string | null,
    inputs: EastType[] | null,
    output: EastType,
): FuncCall<R> {
    const workspace = getReactiveDatasetCache().getConfig().workspace ?? '';
    const ready = !!name && !!inputs && workspace !== '';

    // A structural key over the signature so the handle memo only rebuilds when
    // the signature actually changes (inputs/output are fresh objects each
    // render, but their type *values* are stable).
    const sigKey = useMemo(
        () => (ready ? JSON.stringify([inputs!.map(t => toEastTypeValue(t)), toEastTypeValue(output)]) : ''),
        [ready, inputs, output],
    );

    const handle = useMemo<RawHandle | null>(() => {
        if (!ready) return null;
        const handleType = toEastTypeValue(FuncBindHandleType(inputs!, output));
        return defaultFuncRuntime.buildHandle(handleType, name!) as RawHandle;
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [ready, name, workspace, sigKey]);

    const channelKey = ready ? funcChannelKey(workspace, name!) : '';
    const version = useSyncExternalStore(
        useCallback(
            (cb: () => void) => (channelKey ? defaultFuncRuntime.subscribe(channelKey, cb) : () => {}),
            [channelKey],
        ),
        useCallback(() => (channelKey ? defaultFuncRuntime.getKeyVersion(channelKey) : 0), [channelKey]),
    );

    return useMemo<FuncCall<R>>(() => {
        if (!handle) return IDLE;
        let result: R | null = null;
        let status: FuncStatus = 'idle';
        let pending = false;
        try {
            const read = handle.read();
            result = read.type === 'some' ? (read.value as R) : null;
            status = handle.status().type;
            pending = handle.pending();
        } catch {
            // Workspace not yet resolvable — treat as idle.
        }
        return { call: (...args: unknown[]) => { try { handle.call(...args); } catch { /* not ready */ } }, result, status, pending };
        // `version` drives recompute as the channel advances.
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [handle, version]);
}
