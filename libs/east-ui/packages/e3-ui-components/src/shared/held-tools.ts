/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

/**
 * The tool a viewer holds on a builder's canvas, and the link kind its Connect
 * draws: the viewer's, held in the UI store under the builder's key as an East
 * value (`useStoredValue`), so a remount keeps them and two builders of one
 * `id` hold one tool. The Schematic's tools and the Plan's are each this, over
 * their own tools.
 *
 * @packageDocumentation
 */

import { useCallback, useMemo } from "react";
import { none, some, variant, type NullType, type OptionType, type StringType, type StructType, type ValueTypeOf, type VariantType } from "@elaraai/east";
import { getSomeorUndefined } from "@elaraai/east-ui-components";
import { useStoredValue, type StoredCodec } from "./stored-value.js";

/**
 * A builder's tools, as the UI store holds them: the tool, a case of its
 * variant, and the link kind Connect draws, by its slot.
 *
 * @typeParam T - The tools' names
 */
export type HeldToolsType<T extends string> = StructType<{ tool: VariantType<{ [K in T]: NullType }>; link: OptionType<StringType> }>;

/**
 * What the viewer holds: the tool, and the link kind Connect draws.
 *
 * @typeParam T - The tools' names
 */
export interface HeldTools<T extends string> {
    /** The tool held. */
    readonly tool: T;
    /** The link kind Connect draws, by its slot. */
    readonly link: string | undefined;
}

/**
 * The tools the viewer holds under a key, and how to pick another tool or link
 * kind: a write every builder under that key follows.
 *
 * @typeParam T - The tools' names
 * @param codec - The codec of the builder's tools type (`storedCodec`)
 * @param key - The builder's tools key
 * @param first - The tool held until the viewer picks one
 * @returns What the store holds — `first` and no link kind until the viewer picks — and the write that picks
 */
export function useHeldTools<T extends string>(codec: StoredCodec<HeldToolsType<T>>, key: string, first: T): [HeldTools<T>, (next: HeldTools<T>) => void] {
    const [stored, write] = useStoredValue(codec, key);
    const held = useMemo((): HeldTools<T> => {
        if (stored === undefined) return { tool: first, link: undefined };
        const { tool, link } = stored as { tool: { type: T }; link: ValueTypeOf<OptionType<StringType>> };
        return { tool: tool.type, link: getSomeorUndefined(link) };
    }, [stored, first]);
    const pick = useCallback((next: HeldTools<T>) => {
        write({ tool: variant(next.tool, null), link: next.link === undefined ? none : some(next.link) } as ValueTypeOf<HeldToolsType<T>>);
    }, [write]);
    return [held, pick];
}
