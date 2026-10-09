/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

/**
 * The flow open in a flowchart (#1246, `Flowchart Builder Spec.md` FB12) —
 * the name of the flow the viewer opened last, held in the UI store under the
 * flowchart's name (`flowchartKeys(name).flow`), so a remount opens it again
 * and two flowcharts of one name open one flow together, as the query
 * builder's open query is shared by its id (`open-query.ts`).
 *
 * Which flow is open, over many flows: the one the viewer opened last, while
 * the flowchart holds it — in its flows, or as a new flow not yet applied;
 * else `flow`, the one its payload opens first, while it holds that; else its
 * first by name; else none.
 *
 * While `flow` names a flow the flowchart doesn't hold, and the viewer has
 * opened none in its place, the flowchart says so above main (FB42): the
 * flow asked for, and the one shown.
 *
 * @packageDocumentation
 */

import { useCallback, useMemo, useSyncExternalStore } from "react";
import { StringType, compareFor, decodeBeast2For, encodeBeast2For } from "@elaraai/east";
import { StateRuntime } from "@elaraai/east-ui-components";

const encodeName = encodeBeast2For(StringType);
const decodeName = decodeBeast2For(StringType);
const nameOrder = compareFor(StringType);

/**
 * The flow open, by the rule the module docs give.
 *
 * @param names - Every flow the flowchart holds: its flows, and its new flows not yet applied
 * @param holds - Whether the flowchart holds a flow of a name
 * @param opened - The flow the viewer opened last, from the UI store
 * @param first - The flow the payload opens first (`flow`)
 * @returns The open flow's name, or `undefined` when the flowchart holds none
 */
export function openFlowName(names: Iterable<string>, holds: (name: string) => boolean, opened: string | undefined, first: string | undefined): string | undefined {
    if (opened !== undefined && holds(opened)) return opened;
    if (first !== undefined && holds(first)) return first;
    let least: string | undefined;
    for (const name of names) {
        if (least === undefined || nameOrder(name, least) < 0) least = name;
    }
    return least;
}

/**
 * The flow `flow` asks for, while the flowchart doesn't hold it and the
 * viewer has opened none in its place (FB42) — what the banner names. Once
 * the viewer opens a flow, or the flowchart gains that name, there is none.
 *
 * @param holds - Whether the flowchart holds a flow of a name
 * @param opened - The flow the viewer opened last, from the UI store
 * @param first - The flow the payload opens first (`flow`)
 * @returns `first` while it is missing, else `undefined`
 */
export function missingFlow(holds: (name: string) => boolean, opened: string | undefined, first: string | undefined): string | undefined {
    if (first === undefined || holds(first)) return undefined;
    if (opened !== undefined && holds(opened)) return undefined;
    return first;
}

/**
 * The flow the viewer opened last in the flowchart a key names, and how to
 * open another — a write every flowchart under that key follows.
 *
 * @param key - The flowchart's open-flow key (`flowchartKeys(name).flow`)
 * @returns The name it opened last, or `undefined` before any; and the write that opens another
 */
export function useOpenedFlow(key: string): [string | undefined, (name: string) => void] {
    const store = StateRuntime.getStore();
    const subscribe = useCallback((notify: () => void) => store.subscribe(key, notify), [store, key]);
    const snapshot = useCallback(() => store.read(key), [store, key]);
    const bytes = useSyncExternalStore(subscribe, snapshot);
    const opened = useMemo(() => (bytes === undefined ? undefined : decodeName(bytes)), [bytes]);
    const open = useCallback((name: string) => { store.write(key, encodeName(name)); }, [store, key]);
    return [opened, open];
}
