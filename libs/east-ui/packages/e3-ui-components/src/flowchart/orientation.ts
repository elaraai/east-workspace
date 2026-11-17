/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

/**
 * LR · TD, the viewer's (#1246, `Flowchart Builder Spec.md` §4.1, FB43): the
 * orientation the viewer picked, held in the UI store under the flowchart's
 * name (`flowchartKeys(name).orientation`) as an East
 * `Flowchart.Types.Orientation`, so a remount keeps it and two flowcharts of
 * one name turn together. Until the viewer picks, the flowchart shows the
 * payload's `orientation`, LR when it gives none.
 *
 * @packageDocumentation
 */

import { useCallback } from "react";
import { variant } from "@elaraai/east";
import { Flowchart } from "@elaraai/e3-ui/internal";
import { storedCodec, useStoredValue } from "../shared/stored-value.js";
import type { FlowchartOrientation } from "./toolbar.js";

const orientationCodec = storedCodec(Flowchart.Types.Orientation);

/** Each orientation as the East value the store holds. */
const ORIENTATIONS = { LR: variant("LR", null), TD: variant("TD", null) } as const;

/**
 * The orientation the viewer picked in the flowchart a key names — or, until
 * they pick, the one the payload gives — and how to pick another: a write
 * every flowchart under that key follows.
 *
 * @param key - The flowchart's orientation key (`flowchartKeys(name).orientation`)
 * @param initial - The payload's `orientation`, LR when it gives none: shown until the viewer picks
 * @returns The orientation shown, and the write that picks another
 */
export function useViewerOrientation(key: string, initial: FlowchartOrientation): [FlowchartOrientation, (orientation: FlowchartOrientation) => void] {
    const [stored, write] = useStoredValue(orientationCodec, key);
    const pick = useCallback((orientation: FlowchartOrientation) => { write(ORIENTATIONS[orientation]); }, [write]);
    return [stored?.type ?? initial, pick];
}
