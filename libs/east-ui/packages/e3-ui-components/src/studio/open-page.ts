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

import type { ValueTypeOf } from "@elaraai/east";
import { StudioKeyType } from "@elaraai/e3-ui/internal";
import { storedCodec, useStoredValue } from "../shared/stored-value.js";

/** A page's key. */
export type StudioKey = ValueTypeOf<typeof StudioKeyType>;

const keyCodec = storedCodec(StudioKeyType);

/**
 * The page open in the builder the key names, and a way to open another.
 *
 * @param key - The builder's open-page key
 * @param first - The page it opens before any is written — its project's first
 * @returns The open page, and the write that opens another
 */
export function useOpenPage(key: string, first: StudioKey): [StudioKey, (next: StudioKey) => void] {
    const [open, write] = useStoredValue(keyCodec, key);
    return [open ?? first, write];
}
