/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

/**
 * The Table's rows (`Allocation Spec.md` §8, A41–A43), pure: one row per lane
 * slot of the day, and one more per extra bin of a batch, in e3-ui's slot
 * order — time, then lane — in four time bands. A row is its slot's or its
 * bin's, so an allocation never moves it; the Table is never narrowed.
 *
 * @packageDocumentation
 */

import { dayKey, type Day, type Slot } from "./model.js";

/** What a row holds: nothing, a bin with an event, or a reservation. */
export type TableRowKind = "free" | "bin" | "reserved";

/** One row of the Table. */
export interface TableRow {
    /** Its identity: its bin's, or its free slot's. */
    key: string;
    /** Its lane's key. */
    lane: string;
    /** Its time: its bin's, or its slot's. */
    at: Date;
    /** Its slot's time: what a drop on its event cell names. */
    slotAt: Date;
    /** The bin it shows. */
    bin: string | undefined;
    kind: TableRowKind;
}

/** One of the four time bands: its rows and what they hold. */
export interface TableBand {
    /** Its identity, what its fold is kept by. */
    key: string;
    /** `00:00–06:00`. */
    label: string;
    rows: TableRow[];
    /** Its bins with an event, its reservations and its free slots. */
    bins: number;
    reserved: number;
    free: number;
    /** What its bins hold. */
    quantity: number;
}

/** The bands' hours: 00–06 · 06–12 · 12–18 · 18–24. */
const BANDS: readonly (readonly [number, number])[] = [[0, 6], [6, 12], [12, 18], [18, 24]];
const HOUR_MS = 3_600_000;
const hour = (n: number) => `${String(n).padStart(2, "0")}:00`;

/**
 * The day's rows: a free slot's one, or one per bin it holds, by time.
 *
 * @param slots - The day's slots, in e3-ui's order
 * @param plan - The day as drafted
 * @returns The rows, in order
 */
export function tableRows(slots: readonly Slot[], plan: Day): TableRow[] {
    return slots.flatMap((slot): TableRow[] => slot.bins.length === 0
        ? [{ key: `slot:${slot.lane}|${dayKey(slot.at)}`, lane: slot.lane, at: slot.at, slotAt: slot.at, bin: undefined, kind: "free" as const }]
        : slot.bins.flatMap((id): TableRow[] => {
            const bin = plan.bins.get(id);
            return bin === undefined ? [] : [{ key: `bin:${id}`, lane: slot.lane, at: bin.at, slotAt: slot.at, bin: id,
                kind: bin.event.type === "none" ? "reserved" as const : "bin" as const }];
        }));
}

/**
 * The rows in their four time bands, by their slot's hour on the day.
 *
 * @param rows - The day's rows
 * @param plan - The day as drafted
 * @param day - The plan day
 * @returns The bands, each with its counts
 */
export function tableBands(rows: readonly TableRow[], plan: Day, day: Date): TableBand[] {
    return BANDS.map(([from, to]) => {
        const in_ = rows.filter(r => { const h = Math.floor((r.slotAt.getTime() - day.getTime()) / HOUR_MS); return h >= from && h < to; });
        const bins = in_.filter(r => r.kind === "bin");
        return {
            key: `${hour(from)}–${hour(to)}`, label: `${hour(from)}–${hour(to)}`, rows: in_,
            bins: bins.length, reserved: in_.filter(r => r.kind === "reserved").length, free: in_.filter(r => r.kind === "free").length,
            quantity: bins.reduce((sum, r) => sum + (plan.bins.get(r.bin!)?.quantity ?? 0), 0),
        };
    });
}

/**
 * A band's line (A42): `7 bins · 1 reserved · 13 free · 208 m³`, no
 * reservations said when it has none, and `· collapsed` when folded.
 *
 * @param band - The band
 * @param quantity - Its quantity, as the board writes it (`208 m³`)
 * @param collapsed - Whether it is folded
 * @returns Its line
 */
export function bandLine(band: TableBand, quantity: string, collapsed: boolean): string {
    const parts = [`${band.bins} bin${band.bins === 1 ? "" : "s"}`, band.reserved > 0 ? `${band.reserved} reserved` : "", `${band.free} free`, quantity];
    return parts.filter(p => p !== "").join(" · ") + (collapsed ? " · collapsed" : "");
}
