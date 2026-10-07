/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 *
 * What the inspector reads of the canvas's rows (#1197, `Plan Builder
 * Spec.md` PB40): what a heat, table or chart row draws in one bucket, in
 * words — the values the canvas draws there, folded to the period as the row
 * draws them (#824), each said as its own cell says it to a reader (#819).
 *
 * @packageDocumentation
 */

import { getSomeorUndefined } from "@elaraai/east-ui-components";
import { heatValueText, segmentsText, tablePartsText, weightValueText } from "../a11y.js";
import type { PlanInstantValue } from "../instant.js";
import type { PlanDerived, PlanRowValue } from "../model.js";
import type { RowKey } from "../plan-state.js";
import { readoutTable } from "../rows/chart-geometry.js";
import type { PlanScale } from "../scale.js";
import type { PlanWords } from "../words.js";

/** What the inspector reads of the canvas's rows (#1197). */
export interface PlanCanvasInspect {
    /**
     * A row the canvas holds, by its key.
     *
     * @param key - The row's key
     * @returns The row, or `undefined` for one the canvas does not hold
     */
    row(key: RowKey): PlanRowValue | undefined;
    /**
     * What a heat, table or chart row draws in the bucket an instant falls in.
     *
     * @param key - The row's key
     * @param at - The instant
     * @returns Its value there, in words; `undefined` where it draws nothing there, or for a row of another kind
     */
    valueAt(key: RowKey, at: PlanInstantValue): string | undefined;
}

/**
 * What a row draws in the bucket an instant falls in, in words: a heat cell's
 * label or value, a weight bar's booked share, a composition's segments, a
 * table cell's parts, or each of a chart's data layers' last value in it.
 *
 * @param row - The row
 * @param derived - The canvas's derivations: what each row draws, folded to the period
 * @param scale - The shared scale
 * @param w - The canvas's words
 * @param at - The instant
 * @returns Its value there; `undefined` where it draws nothing there, or for a row of another kind
 */
export function rowValueAt(row: PlanRowValue, derived: PlanDerived, scale: PlanScale, w: PlanWords, at: PlanInstantValue): string | undefined {
    const bi = scale.bucketOf(at);
    if (bi < 0) return undefined;
    const kind = row.kind;
    switch (kind.type) {
        case "heat": {
            const arm = derived.heatArms.get(row.key) ?? kind.value.cells;
            switch (arm.type) {
                case "heat": {
                    const cell = arm.value.cells.find((c) => scale.bucketOf(c.at) === bi);
                    if (cell === undefined) return undefined;
                    const value = getSomeorUndefined(cell.value);
                    const format = getSomeorUndefined(arm.value.format);
                    // A cell prints its label, else its value through the row's format — as the canvas prints it.
                    const label = getSomeorUndefined(cell.label) ?? (value !== undefined && format !== undefined ? w.value(value, format) : undefined);
                    const warn = getSomeorUndefined(arm.value.scale.warnAt);
                    return heatValueText(value, label, value !== undefined && warn !== undefined && value >= warn, w);
                }
                case "weight": {
                    const cell = arm.value.cells.find((c) => scale.bucketOf(c.at) === bi);
                    return cell === undefined ? undefined : weightValueText(cell.fraction, cell.planned, w, getSomeorUndefined(arm.value.format));
                }
                case "segments": {
                    const cell = arm.value.cells.find((c) => scale.bucketOf(c.at) === bi);
                    return cell === undefined ? undefined : segmentsText(cell.segments, w, getSomeorUndefined(arm.value.format));
                }
            }
            return undefined;
        }
        case "table": {
            // Each series' parts in the bucket, in series order, each printed as the row prints it.
            const rowFormat = getSomeorUndefined(kind.value.format);
            const texts: string[] = [];
            for (const series of derived.tableSeries.get(row.key) ?? kind.value.series) {
                const format = getSomeorUndefined(series.format) ?? rowFormat;
                for (const cell of series.cells) {
                    if (scale.bucketOf(cell.at) !== bi) continue;
                    const value = getSomeorUndefined(cell.value);
                    texts.push(getSomeorUndefined(cell.text) ?? (value !== undefined ? w.value(value, format) : "—"));
                }
            }
            return texts.length === 0 ? undefined : tablePartsText(texts, w);
        }
        case "chart": {
            const texts = readoutTable(derived.charts.get(row.key) ?? kind.value, scale, w).get(bi);
            return texts === undefined ? undefined : w.m.list({ parts: texts });
        }
        default:
            return undefined;
    }
}
