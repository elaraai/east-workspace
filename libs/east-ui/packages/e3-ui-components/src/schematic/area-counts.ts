/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

/**
 * What the drawing's Details counts of each kind read by area (#1393,
 * `Schematic Builder Spec.md` §9, §11.4), read in a component of its own:
 * never what its window draws, which a pan moves, but its stored rows its
 * narrowing holds that have a position, counted by its source's indexes —
 * every row its narrowing holds (`countWhere`), less those its area index's
 * unplaced clause counts under the narrowing's choices the index leads; a
 * zone kind, or an item kind every row of which has a position, the first
 * alone. No row is read. A narrowing with a choice no area index leads can't
 * count its rows with no position, so such a kind is not counted (`filters`).
 * Its drafts are the frame's to lay over the count (`counts.ts`).
 *
 * @packageDocumentation
 */

import { useCallback, useLayoutEffect, useRef } from "react";
import type { ValueTypeOf } from "@elaraai/east";
import type { RecordSliceBindType } from "@elaraai/east-ui/internal";
import { schematicAreaIndexes, schematicUnplacedPlan } from "@elaraai/e3-ui/internal";
import { getSomeorUndefined, useTrackedEvaluation } from "@elaraai/east-ui-components";
import { sourcePart } from "../shared/schedule/visibility.js";
import { COUNT_READING, counted, uncounted, type SchematicDrawingCount } from "./counts.js";
import type { SchematicValue } from "./data.js";

/** A kind's source of the slice. */
type Part = ValueTypeOf<RecordSliceBindType>;

/** Nothing counted. */
export const NO_AREA_COUNTS: ReadonlyMap<string, SchematicDrawingCount> = new Map();

/** One item kind's stored rows with a position its narrowing holds (see the module docs). */
function itemCount(kind: SchematicValue["items"][number], part: Part): SchematicDrawingCount {
    const where = part.read().where;
    const all = part.countWhere(where);
    if (!kind.backlog) return all.type === "some" ? counted(Number(all.value)) : COUNT_READING;
    const areas = schematicAreaIndexes(part.config.indexes, kind.box, "items", `Schematic.items: "${kind.name}"`);
    if (areas === undefined) return uncounted("filters");
    const plan = schematicUnplacedPlan(areas, where);
    if (plan.residual.length > 0) return uncounted("filters");
    const unplaced = part.countWhere(plan.where);
    return all.type === "some" && unplaced.type === "some" ? counted(Number(all.value - unplaced.value)) : COUNT_READING;
}

/** One zone kind's stored rows its narrowing holds. */
function zoneCount(part: Part): SchematicDrawingCount {
    const all = part.countWhere(part.read().where);
    return all.type === "some" ? counted(Number(all.value)) : COUNT_READING;
}

/** Whether two counts say the same. */
function sameCount(a: SchematicDrawingCount | undefined, b: SchematicDrawingCount): boolean {
    if (a === undefined || a.kind !== b.kind) return false;
    if (a.kind === "counted") return b.kind === "counted" && a.n === b.n;
    if (a.kind === "uncounted") return b.kind === "uncounted" && a.why === b.why;
    return true;
}

/** No kind read by area. */
const NO_AREAS: ReadonlySet<string> = new Set();

/**
 * Reads each kind read by area's count (see the module docs), handing the frame what it read only when that moves.
 *
 * @param props - The payload, the kinds read by area, and where the counts go
 * @returns Nothing: it reads
 */
export function SchematicAreaCountsReader({ value, areas = NO_AREAS, onRead }: {
    value: SchematicValue; areas?: ReadonlySet<string>; onRead: (counts: ReadonlyMap<string, SchematicDrawingCount>) => void;
}): null {
    const read = useCallback((): ReadonlyMap<string, SchematicDrawingCount> => {
        const chrome = getSomeorUndefined(value.slice);
        const out = new Map<string, SchematicDrawingCount>();
        for (const kind of value.items) {
            const part = areas.has(kind.key) ? sourcePart(chrome, kind.key) : undefined;
            if (part === undefined) continue;
            // A count whose read fails stands in flight: the frame's line says why its kind's read failed.
            try { out.set(kind.key, itemCount(kind, part)); } catch { out.set(kind.key, COUNT_READING); }
        }
        for (const kind of value.zones) {
            const part = areas.has(kind.key) ? sourcePart(chrome, kind.key) : undefined;
            if (part === undefined) continue;
            try { out.set(kind.key, zoneCount(part)); } catch { out.set(kind.key, COUNT_READING); }
        }
        return out;
    }, [value, areas]);
    const { result } = useTrackedEvaluation(read);
    const reported = useRef<ReadonlyMap<string, SchematicDrawingCount>>(NO_AREA_COUNTS);
    useLayoutEffect(() => {
        if (!result.ok) return;
        const now = result.value;
        const was = reported.current;
        if (was.size === now.size && [...now].every(([slot, count]) => sameCount(was.get(slot), count))) return;
        reported.current = now;
        onRead(now);
    });
    return null;
}
