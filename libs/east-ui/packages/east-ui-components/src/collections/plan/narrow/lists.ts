/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

/**
 * The narrow layout's row walks and strip readings — which data rows a group
 * holds, and how hot its strip runs (split out of `narrow/index.tsx`, #815).
 *
 * @packageDocumentation
 */

import { type ValueTypeOf } from "@elaraai/east";
import { Plan } from "@elaraai/east-ui/internal";
import { groupStrip } from "../rows/GroupRow.js";
import type { PlanDerived, PlanRowIndex, PlanRowValue } from "../model.js";
import { appendAll } from "../reductions.js";
import type { RowKey } from "../plan-state.js";

type HeatCellsValue = ValueTypeOf<typeof Plan.Types.HeatCells>;

/** The DATA rows beneath a key, tree order, any depth (group bands skipped). */
export function dataRowsUnder(index: PlanRowIndex, key: RowKey): PlanRowValue[] {
    const out: PlanRowValue[] = [];
    const walk = (k: RowKey) => {
        for (const child of index.children.get(k) ?? []) {
            if (child.kind.type !== "group") out.push(child);
            walk(child.key);
        }
    };
    walk(key);
    return out;
}

/** Every data row of the canvas, tree order. */
export function allDataRows(index: PlanRowIndex): PlanRowValue[] {
    const out: PlanRowValue[] = [];
    for (const root of index.roots) {
        if (root.kind.type !== "group") out.push(root);
        appendAll(out, dataRowsUnder(index, root.key));
    }
    return out;
}

/** A group's strip as the band draws it collapsed — its derived strip, else
 *  its declared cells (`groupStrip`, the desktop band's own reading, so both
 *  strips show the same folded cells, #824). */
export function summaryArm(row: PlanRowValue, derived: PlanDerived): HeatCellsValue | undefined {
    if (row.kind.type !== "group") return undefined;
    return groupStrip(row.kind.value, derived.groupStrips.get(row.key));
}

/** The hottest value on a strip — what "hottest first" sorts by. */
export function peakOf(arm: HeatCellsValue | undefined): number {
    if (arm === undefined) return -Infinity;
    let peak = -Infinity;
    if (arm.type === "heat") {
        for (const c of arm.value.cells) if (c.value.type === "some" && c.value.value > peak) peak = c.value.value;
    } else if (arm.type === "weight") {
        for (const c of arm.value.cells) if (c.fraction > peak) peak = c.fraction;
    }
    return peak;
}
