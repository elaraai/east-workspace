/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

/**
 * LR · TD, the viewer's (#1246, `Flowchart Builder Spec.md` §4.1, FB43): the
 * orientation the viewer picked, held in the UI store under the flowchart's
 * name (`flowchartKeys(name).orientation`) as an East
 * `Flowchart.Types.Orientation`, so a remount keeps it and two flowcharts of
 * one name turn together, as the open flow is kept (`open-flow.ts`). Until
 * the viewer picks, the flowchart shows the payload's `orientation`, LR when
 * it gives none.
 *
 * @packageDocumentation
 */

import { useCallback, useMemo, useSyncExternalStore } from "react";
import { decodeBeast2For, encodeBeast2For, variant } from "@elaraai/east";
import { Flowchart } from "@elaraai/e3-ui/internal";
import { StateRuntime } from "@elaraai/east-ui-components";
import type { FlowchartOrientation } from "./toolbar.js";

const encodeOrientation = encodeBeast2For(Flowchart.Types.Orientation);
const decodeOrientation = decodeBeast2For(Flowchart.Types.Orientation);

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
    const store = StateRuntime.getStore();
    const subscribe = useCallback((notify: () => void) => store.subscribe(key, notify), [store, key]);
    const snapshot = useCallback(() => store.read(key), [store, key]);
    const bytes = useSyncExternalStore(subscribe, snapshot);
    const picked = useMemo(() => (bytes === undefined ? undefined : decodeOrientation(bytes).type), [bytes]);
    const pick = useCallback((orientation: FlowchartOrientation) => { store.write(key, encodeOrientation(ORIENTATIONS[orientation])); }, [store, key]);
    return [picked ?? initial, pick];
}
