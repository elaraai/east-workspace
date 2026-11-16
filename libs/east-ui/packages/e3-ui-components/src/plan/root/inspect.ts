/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 *
 * What the inspector reads of the canvas's rows (#1197, `Plan Builder
 * Spec.md` PB40): what a heat, table or chart row draws in one bucket, in
 * words — the values the canvas draws there, folded to the period as the row
 * draws them (#824), each said as its own cell says it to a reader (#819) —
 * a resource's name where the canvas does not hold its landing row, its
 * row read by its key (#1199, #1541), and a row's refusals holding Save
 * (#1541, U5).
 *
 * @packageDocumentation
 */

import { StringType, equalFor, none, printFor, some, type option } from "@elaraai/east";
import { getSomeorUndefined, type EditIssue } from "@elaraai/east-ui-components";
import { windowedSourceOf } from "@elaraai/east-ui-components/internal";
import { readKeyedEntry } from "../../shared/schedule/keyed-read.js";
import { heatValueText, segmentsText, tablePartsText, weightValueText } from "../a11y.js";
import type { PlanInstantValue } from "../instant.js";
import { rowKeyOf, type PlanDerived, type PlanRootValue, type PlanRowValue } from "../model.js";
import type { RowKey } from "../plan-state.js";
import { readoutTable } from "../rows/chart-geometry.js";
import type { PlanScale } from "../scale.js";
import type { PlanPagedSourceValue } from "../use-plan-paging.js";
import type { PlanWords } from "../words.js";
import { landingRowId, type PlanLandingValue } from "./landings.js";

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
    /**
     * A resource's landing row (#1541): the row of the series an event's resource names whose path ends in its key, as
     * the canvas holds it — what the panes name the resource by.
     *
     * The same function while the rows it reads are: a pane's names are made again only as they move.
     *
     * @param ref - The resource: its series' key and its key's text
     * @returns Its row; `undefined` for one the canvas does not hold — over rows read a page at a time, one not read
     */
    readonly resource: (ref: { readonly kind: string; readonly key: string }) => PlanRowValue | undefined;
    /**
     * A resource's name where the canvas does not hold its landing row (#1199, #1541): its row read by its key
     * ({@link landingNameByKey}) — among the canvas's rows, then, for one the slice's `rows` source leaves out, among
     * every row the source narrows. Called inside a tracked evaluation, so a pane names it once the read lands.
     *
     * The same function while the rows it reads through are.
     *
     * @param ref - The resource: its series' key and its key's text
     * @returns `none` while the read is in flight; `some(none)` where no row is read for it; else `some(some(name))`
     */
    readonly resourceByKey: (ref: { readonly kind: string; readonly key: string }) => option<option<string>>;
    /**
     * A series' resources, its landing rows in the canvas's order (#1541): what the bulk edit offers.
     *
     * @param landing - The series' key
     * @returns Its rows; `undefined` over rows read a page at a time, which the canvas does not hold whole
     */
    resources(landing: string): readonly PlanRowValue[] | undefined;
    /**
     * The refusals holding Save of the entry a row came from (#1541, U5): what the session the rows save through refuses
     * of it while the Plan's `ready` refuses its drafts — the entry the first step of the row's path names, for one of
     * `data`'s own rows the canvas holds. Read as the pane draws, so it says the session's readiness now.
     *
     * @param key - The row's key
     * @returns Its refusals, in the readiness's order; none for a read-only row, an event kind's Unassigned row, one the
     *   canvas does not hold, or a Plan whose rows save through no session
     */
    refusals(key: RowKey): readonly EditIssue[];
}

/** A String key as the rows' key search takes it: its `.east` literal. */
const keyLiteral = printFor(StringType);
const stringEqual = equalFor(StringType);

/**
 * A resource's name read by its key, where the canvas does not hold its
 * landing row (#1199, #1541): over rows read a page at a time, a resource of
 * a landing at their top — a resources series there, or a case of a kinds
 * block there — is an entry of theirs, so the rows' key search finds it and a
 * one-row page reads it (the shared keyed read), and its landing row names it
 * as the canvas draws it. Rows read whole are held every one; a resource
 * nested beneath another of their rows is no entry of theirs; and rows with
 * no key search find none: no row is read for any of them. A narrowing's key
 * search finds only what it keeps, so a resource it leaves out is read from
 * every row it narrows (the root's `unnarrowed`).
 *
 * @param rows - The rows it is read from: the canvas's, or every row the slice's `rows` source narrows
 * @param landing - The resource's landing, as the payload carries it; `undefined` for a series no kind lands on
 * @param key - The resource's key's text
 * @returns `none` while the search or its page is in flight; `some(none)` where no row is read for it, or the rows hold
 *   no such resource; else `some(some(name))`
 */
export function landingNameByKey(rows: PlanRootValue["rows"], landing: PlanLandingValue | undefined, key: string): option<option<string>> {
    if (landing === undefined || !landing.top) return some(none);
    const window = windowedSourceOf(rows) as PlanPagedSourceValue | undefined;
    if (window === undefined || window.seek.type !== "some") return some(none);
    const id = rowKeyOf(landingRowId(landing.key, [key]));
    return readKeyedEntry(window, keyLiteral(key), (page) => {
        for (const block of page.rows) for (const row of block.rows) if (stringEqual(rowKeyOf(row.id), id)) return row.gutter.label;
        return undefined;
    }, "A Plan's rows read a page at a time");
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
