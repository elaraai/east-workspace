/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

/**
 * The page open in a builder (#1000) — held in the UI store under the
 * builder's key (`builderKeys(id).page`), where `State.bind` keeps its State,
 * so a builder and a page library with the same `id` open one page together.
 *
 * @packageDocumentation
 */

import { useCallback, useMemo, useSyncExternalStore } from "react";
import { decodeBeast2For, encodeBeast2For, type ValueTypeOf } from "@elaraai/east";
import { StudioKeyType } from "@elaraai/e3-ui/internal";
import { StateRuntime } from "@elaraai/east-ui-components";

/** A page's key. */
export type StudioKey = ValueTypeOf<typeof StudioKeyType>;

const encodeKey = encodeBeast2For(StudioKeyType);
const decodeKey = decodeBeast2For(StudioKeyType);

/**
 * The page open in the builder the key names, and a way to open another.
 *
 * @param key - The builder's open-page key
 * @param first - The page it opens before any is written — its project's first
 * @returns The open page, and the write that opens another
 */
export function useOpenPage(key: string, first: StudioKey): [StudioKey, (next: StudioKey) => void] {
    const store = StateRuntime.getStore();
    const subscribe = useCallback((notify: () => void) => store.subscribe(key, notify), [store, key]);
    const snapshot = useCallback(() => store.read(key), [store, key]);
    const bytes = useSyncExternalStore(subscribe, snapshot);
    const open = useMemo(() => (bytes === undefined ? first : decodeKey(bytes)), [bytes, first]);
    const write = useCallback((next: StudioKey) => { store.write(key, encodeKey(next)); }, [store, key]);
    return [open, write];
}
