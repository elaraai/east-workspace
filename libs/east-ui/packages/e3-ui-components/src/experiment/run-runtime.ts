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
import { isTypeValueEqual, toEastTypeValue, type EastType, type ValueTypeOf } from '@elaraai/east';
import { FuncBindHandleType, type FuncErrorType, type FuncStatusType } from '@elaraai/e3-ui/internal';
import { useDataStable } from '@elaraai/east-ui-components';
import {
    defaultFuncRuntime,
    funcChannelKey,
    getReactiveDatasetCache,
} from '../platform/index.js';

/** Lifecycle of the most recent call on a bound function's channel. */
export type FuncStatus = ValueTypeOf<FuncStatusType>['type'];

/** A failed call's detail (the runner's outcome + captured output tails). */
export type FuncCallError = ValueTypeOf<FuncErrorType>;

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
    /** Failure detail when the most recent call failed, else `null`. */
    error: FuncCallError | null;
}

/** A bound function's call handle, as the runtime builds it. */
type FuncHandle = ValueTypeOf<ReturnType<typeof FuncBindHandleType<EastType[], EastType>>>;

/** A bound function's signature: its parameter types (`null` until the row
 *  type is known) and its return type. */
interface Signature { inputs: EastType[] | null; output: EastType }

/** Whether two types are one East type — East's own type equality. */
function sameType(a: EastType, b: EastType): boolean {
    return isTypeValueEqual(toEastTypeValue(a), toEastTypeValue(b));
}

/** Whether two signatures name the same East types. */
function sameSignature(a: Signature, b: Signature): boolean {
    const ai = a.inputs;
    const bi = b.inputs;
    return sameType(a.output, b.output) && (ai === null || bi === null
        ? ai === bi
        : ai.length === bi.length && ai.every((t, i) => sameType(t, bi[i]!)));
}

const IDLE: FuncCall<never> = { call: () => {}, result: null, status: 'idle', pending: false, error: null };

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

    // The signature, held while it names the same East types — the inputs and
    // output are fresh objects each render, but the types they name are stable,
    // so the handle is rebuilt only when the signature really changes.
    const signature = useDataStable<Signature>({ inputs, output }, sameSignature);

    const handle = useMemo<FuncHandle | null>(() => {
        if (!ready || signature.inputs === null) return null;
        const handleType = toEastTypeValue(FuncBindHandleType(signature.inputs, signature.output));
        return defaultFuncRuntime.buildHandle(handleType, name!) as FuncHandle;
        // A new workspace is a new channel: rebuild the handle over it.
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [ready, name, workspace, signature]);

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
        let error: FuncCallError | null = null;
        try {
            const read = handle.read();
            result = read.type === 'some' ? (read.value as R) : null;
            status = handle.status().type;
            pending = handle.pending();
            const err = handle.error();
            if (err.type === 'some') error = err.value;
        } catch {
            // Workspace not yet resolvable — treat as idle.
        }
        return { call: (...args: unknown[]) => { try { handle.call(...args); } catch { /* not ready */ } }, result, status, pending, error };
        // `version` drives recompute as the channel advances.
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [handle, version]);
}
