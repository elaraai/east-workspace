/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

/**
 * The names the Plan's panes give the resources they show (#1199, #1541): a
 * resource by its landing row's name — the canvas's own row where it holds it;
 * else, over rows read a page at a time, its row read by its key
 * ({@link PlanCanvasInspect.resourceByKey}), tracked, so a pane names it once
 * the read lands. Until then — and for a key the rows do not hold, or a
 * resource nested beneath another of their rows, which is no entry of theirs —
 * no name is known, and the pane says its key.
 *
 * @packageDocumentation
 */

import { useCallback, useMemo, useRef } from "react";
import { parseFor, printFor, type ValueTypeOf } from "@elaraai/east";
import { ScheduleResourceRefType } from "@elaraai/e3-ui/internal";
import { getSomeorUndefined, useTrackedEvaluation } from "@elaraai/east-ui-components";
import type { PlanCanvasInspect } from "../root/inspect.js";

/** A resource: its landing series' key, and its key's text. */
export type PlanResourceRef = ValueTypeOf<typeof ScheduleResourceRefType>;

/** A resource's name by its landing and its key: `undefined` while none is known. */
export type PlanResourceNames = (ref: PlanResourceRef) => string | undefined;

/** A resource as East prints it: what its read is kept under. */
const printRef = printFor(ScheduleResourceRefType);
const parseRef = parseFor(ScheduleResourceRefType);
/** Nothing read by key. */
const NOTHING_READ: ReadonlyMap<string, string> = new Map();
/** No resource named. */
const NONE_NAMED: readonly PlanResourceRef[] = [];

/**
 * The resources some events are on, each once, in their order: what a pane names. Its callers hold the array while the
 * events are the same, so their reads are not asked again.
 *
 * @param resources - Each event's resource, if it is on one
 * @returns The resources, each once
 */
export function resourcesNamed(resources: Iterable<PlanResourceRef | undefined>): readonly PlanResourceRef[] {
    const out = new Map<string, PlanResourceRef>();
    for (const ref of resources) if (ref !== undefined) out.set(printRef(ref), ref);
    return out.size === 0 ? NONE_NAMED : [...out.values()];
}

/**
 * The one resource a view names, held while it names the same one: its read is not asked again.
 *
 * @param ref - The resource, if any
 * @returns It, alone; none for none
 */
export function useNamedResource(ref: PlanResourceRef | undefined): readonly PlanResourceRef[] {
    const text = ref === undefined ? undefined : printRef(ref);
    return useMemo(() => {
        if (text === undefined) return NONE_NAMED;
        const read = parseRef(text);
        return read.success ? [read.value] : NONE_NAMED;
    }, [text]);
}

/**
 * The names of the resources a pane shows — see the module docs.
 *
 * @param inspect - What the canvas reads of its rows; `undefined` before it has any
 * @param wanted - The resources the pane names ({@link resourcesNamed}, {@link useNamedResource})
 * @returns A resource's name: its landing row's on the canvas, else its row's once read by its key; `undefined` until then
 */
export function usePlanResourceNames(inspect: PlanCanvasInspect | undefined, wanted: readonly PlanResourceRef[]): PlanResourceNames {
    // Each resource named that the canvas does not hold, read by its key — tracked, so a read in flight lands here.
    const read = useCallback((): ReadonlyMap<string, string> => {
        if (inspect === undefined || wanted.length === 0) return NOTHING_READ;
        const out = new Map<string, string>();
        for (const ref of wanted) {
            if (inspect.resource(ref) !== undefined) continue;
            const name = getSomeorUndefined(inspect.resourceByKey(ref));
            if (name !== undefined && name.type === "some") out.set(printRef(ref), name.value);
        }
        return out;
    }, [inspect, wanted]);
    const { result } = useTrackedEvaluation(read);
    // The last names read stand while a read fails.
    const held = useRef(NOTHING_READ);
    const named = useMemo(() => {
        if (!result.ok) {
            console.error("[Plan] a resource could not be read by its key:", result.error);
            return held.current;
        }
        held.current = result.value;
        return result.value;
    }, [result]);
    return useCallback((ref: PlanResourceRef) => inspect?.resource(ref)?.gutter.label ?? named.get(printRef(ref)), [inspect, named]);
}
