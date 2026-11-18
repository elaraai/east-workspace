/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

/**
 * A viewer's value in the UI store, under a key: what a builder keeps of the
 * viewer's own — the tool held, the page open, the layers shown — as an East
 * value, so a remount keeps it and every part reading the key follows one
 * write.
 *
 * @packageDocumentation
 */

import { useCallback, useMemo, useSyncExternalStore } from "react";
import { decodeBeast2For, encodeBeast2For, type EastType, type ValueTypeOf } from "@elaraai/east";
import { StateRuntime } from "@elaraai/east-ui-components";

/**
 * A stored value's codec: its type's encoder and decoder, made once.
 *
 * @typeParam T - The value's East type
 */
export interface StoredCodec<T extends EastType> {
    /** The value as the store holds it. */
    readonly encode: (value: ValueTypeOf<T>) => Uint8Array;
    /** The store's bytes as the value. */
    readonly decode: (bytes: Uint8Array) => ValueTypeOf<T>;
}

/**
 * The codec of a stored value's type: made once, beside the type.
 *
 * @typeParam T - The value's East type
 * @param type - The value's East type
 * @returns Its codec, for {@link useStoredValue}
 */
export function storedCodec<T extends EastType>(type: T): StoredCodec<T> {
    return {
        encode: encodeBeast2For(type) as (value: ValueTypeOf<T>) => Uint8Array,
        decode: decodeBeast2For(type) as (bytes: Uint8Array) => ValueTypeOf<T>,
    };
}

/**
 * The value the UI store holds under a key, and the write that sets it: a
 * write every reader of the key follows.
 *
 * @typeParam T - The value's East type
 * @param codec - The value's codec ({@link storedCodec})
 * @param key - The key the value is kept under
 * @returns The value held — `undefined` until one is written — and the write
 */
export function useStoredValue<T extends EastType>(codec: StoredCodec<T>, key: string): [ValueTypeOf<T> | undefined, (next: ValueTypeOf<T>) => void] {
    const store = StateRuntime.getStore();
    const subscribe = useCallback((notify: () => void) => store.subscribe(key, notify), [store, key]);
    const snapshot = useCallback(() => store.read(key), [store, key]);
    const bytes = useSyncExternalStore(subscribe, snapshot);
    const value = useMemo(() => (bytes === undefined ? undefined : codec.decode(bytes)), [bytes, codec]);
    const write = useCallback((next: ValueTypeOf<T>) => { store.write(key, codec.encode(next)); }, [store, key, codec]);
    return [value, write];
}

/**
 * Changes the value the UI store holds under a key, from what it holds: a
 * write to a key no part on the surface reads — another page's — which every
 * reader of the key follows once it is drawn.
 *
 * @typeParam T - The value's East type
 * @param codec - The value's codec ({@link storedCodec})
 * @param key - The key the value is kept under
 * @param change - The value to hold, from the value held — `undefined` until one is written
 */
export function changeStoredValue<T extends EastType>(codec: StoredCodec<T>, key: string, change: (held: ValueTypeOf<T> | undefined) => ValueTypeOf<T>): void {
    const store = StateRuntime.getStore();
    const bytes = store.read(key);
    store.write(key, codec.encode(change(bytes === undefined ? undefined : codec.decode(bytes))));
}
