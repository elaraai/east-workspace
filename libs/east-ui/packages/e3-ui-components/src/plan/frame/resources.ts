/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

/**
 * The resources the Plan's panes name (#1199): a resource by its kind and its
 * key. A kind given its resources whole lists them, and names each at once. A
 * paged kind lists none — its resources come a window at a time as the canvas
 * scrolls — so each of its resources a pane names is read by its key through
 * the kind's `byKey` (its window's key search, then a one-row page), tracked,
 * and named once the read lands; until then, and for a key the kind does not
 * have, the key stands in.
 *
 * @packageDocumentation
 */

import { useCallback, useMemo, useRef } from "react";
import { printFor, type ValueTypeOf } from "@elaraai/east";
import { ScheduleResourceRefType } from "@elaraai/e3-ui/internal";
import { useTrackedEvaluation } from "@elaraai/east-ui-components";
import type { PlanValue } from "./index.js";

/** One resource kind, as the payload carries it. */
type PlanResourceKindValue = PlanValue["resources"][number];

/** One resource, resolved: its name, its lines and its group. */
export type PlanResourceRowValue = PlanResourceKindValue["rows"][number];

/** A resource: its kind's slot, and its key's text. */
export type PlanResourceRefValue = ValueTypeOf<typeof ScheduleResourceRefType>;

/** A resource's row, by its kind and key: `undefined` while a paged kind's read of it is in flight, and for a key its kind does not have. */
export type PlanResourceLookup = (ref: PlanResourceRefValue) => PlanResourceRowValue | undefined;

/** A resource's key among those read: its ref, as East prints it. */
const printRef = printFor(ScheduleResourceRefType);
/** Nothing read by key: no paged resource named. */
const NOTHING_READ: ReadonlyMap<string, PlanResourceRowValue> = new Map();

/**
 * The resources a pane names, by their kind and key — see the module docs.
 *
 * @param resources - The resource kinds
 * @param wanted - The resources the pane names — the same array while they hold, so their reads are not asked again
 * @returns A resource's row by its kind and key: a listed kind's at once, a paged kind's once its read lands
 */
export function usePlanResourceRows(resources: PlanValue["resources"], wanted: readonly PlanResourceRefValue[]): PlanResourceLookup {
    // A listed kind's resources by their key's text, and a paged kind's read by key.
    const listed = useMemo(
        () => new Map(resources.map((kind) => [kind.key, new Map(kind.rows.map((row) => [row.key, row] as const))] as const)),
        [resources]);
    const paged = useMemo(
        () => new Map(resources.flatMap((kind) => (kind.byKey.type === "some" ? [[kind.key, kind.byKey.value] as const] : []))),
        [resources]);
    // Each paged resource named, read by its key — tracked, so a read in flight lands here.
    const read = useCallback((): ReadonlyMap<string, PlanResourceRowValue> => {
        const out = new Map<string, PlanResourceRowValue>();
        for (const ref of wanted) {
            const byKey = paged.get(ref.kind);
            if (byKey === undefined) continue;
            const got = byKey(ref.key);
            if (got.type === "some" && got.value.type === "some") out.set(printRef(ref), got.value.value);
        }
        return out;
    }, [paged, wanted]);
    const { result } = useTrackedEvaluation(read);
    // The last reads stand while a read fails.
    const held = useRef(NOTHING_READ);
    const named = useMemo(() => {
        if (!result.ok) {
            console.error("[Plan] a resource could not be read by its key:", result.error);
            return held.current;
        }
        held.current = result.value;
        return result.value;
    }, [result]);
    return useCallback((ref: PlanResourceRefValue) => listed.get(ref.kind)?.get(ref.key) ?? named.get(printRef(ref)), [listed, named]);
}
