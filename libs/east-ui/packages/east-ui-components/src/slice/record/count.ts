/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

/**
 * A record source's count, handed to its builder as soon as it lands (#1398,
 * problem 23, CL1). A narrowed read asks its count before its pages — a
 * period builder's window, which its navigation writes into its source's
 * range, and a paged list's rows alike — and until now only the rail's
 * summary saw it. With it a builder sizes a list at its rows' declared pitch
 * before a page has landed (the window ledger's `createLedger(total,
 * pageSize, pitch)`) and says what is loading.
 *
 * @packageDocumentation
 */

import { useCallback } from "react";
import type { ValueTypeOf } from "@elaraai/east";
import type { RecordSliceBindType } from "@elaraai/east-ui/internal";
import { useTrackedEvaluation } from "../../reactive/index.js";
import { useSliceReactivity } from "../use-slice-reactivity.js";

/** What a builder knows of a source's count. */
export interface RecordSliceCount {
    /** How many rows the source's narrowing holds, as it stands; `undefined` while it is read, or with no source. */
    readonly count: number | undefined;
    /** Why the count could not be read; `undefined` while it can. */
    readonly error: string | undefined;
}

/** No source, nothing counted. */
const NO_COUNT: RecordSliceCount = { count: undefined, error: undefined };

/**
 * A record source's count as its narrowing stands (see the module docs): the
 * rail's count, read through the same tracked channel, so it costs no request
 * of its own and lands before the source's pages. It moves as the narrowing,
 * the window or the record does.
 *
 * @param slice - The source's part of the builder's slice; `undefined` reads nothing
 * @returns Its count, once it lands, or why it could not be read
 */
export function useRecordSliceCount(slice: ValueTypeOf<RecordSliceBindType> | undefined): RecordSliceCount {
    useSliceReactivity(slice?.key);
    const read = useCallback(() => (slice === undefined ? undefined : slice.count()), [slice]);
    const { result } = useTrackedEvaluation(read);
    if (slice === undefined) return NO_COUNT;
    if (!result.ok) return { count: undefined, error: result.error instanceof Error ? result.error.message : String(result.error) };
    const counted = result.value;
    return counted === undefined || counted.type === "none" ? NO_COUNT : { count: Number(counted.value), error: undefined };
}
