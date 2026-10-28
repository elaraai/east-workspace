/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

/**
 * A period builder's read ahead (#1398, CL7) as a tracked read of its own,
 * beside the period's: what `readAhead` reads (`read-ahead.ts`), read in an
 * evaluation that waits on the neighbours' reads alone. A page of a
 * neighbour's landing re-runs this read, never the period's — which would
 * build the period's read again and hand the frame a new read of a period
 * that has not moved, once a page.
 *
 * @packageDocumentation
 */

import { useCallback } from "react";
import { useTrackedEvaluation } from "@elaraai/east-ui-components";
import { readAhead } from "./read-ahead.js";

/**
 * Reads a period's neighbours ahead once the period itself has landed, as a
 * tracked read of its own. Call it in the component that reads the period,
 * after the period's own read, so a step moves both in one render: the
 * neighbour stepped to is the period's read from then on, and only the reads
 * of the periods no longer either side lose their reader.
 *
 * @param landed - Whether every read the period in view needs has landed: until then nothing is read ahead
 * @param neighbours - The periods read ahead, nearest first; memoised, so the read is not built again each render
 * @param read - Reads one neighbour's reads, as the period's own read reads its period's; memoised as well
 * @typeParam P - What names a period: its first day, or its range
 */
export function useReadAhead<P>(landed: boolean, neighbours: readonly P[], read: (period: P) => void): void {
    const evaluate = useCallback(() => {
        readAhead(landed, neighbours, read);
        return null;
    }, [landed, neighbours, read]);
    useTrackedEvaluation(evaluate);
}
