/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

/**
 * The Table's rows (`Allocation Spec.md` §8, A41–A43), pure: one row per lane
 * slot of the day, and one more per extra bin of a batch, in e3-ui's slot
 * order — time, then lane — in the app's time bands (four by default). A row is its slot's or its
 * bin's, so an allocation never moves it. The narrowing (#1336) hides a row
 * whose lane it hides, or whose every resource it hides; never reorders one.
 *
 * @packageDocumentation
 */

import { none, type option } from "@elaraai/east";
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

/** One of the time bands: its rows and what they hold. */
export interface TableBand {
    /** Its identity, what its fold is kept by: its hours, `00:00–06:00`. */
    key: string;
    /** Its heading: the app's label, or its hours. */
    label: string;
    rows: TableRow[];
    /** Its bins with an event, its reservations and its free slots. */
    bins: number;
    reserved: number;
    free: number;
    /** What its bins hold. */
    quantity: number;
}

/** A band as the payload gives it: its first hour, and its label. */
export interface BandStart { from: number; label: option<string> }
/** The bands with none given: 00–06 · 06–12 · 12–18 · 18–24. */
export const DEFAULT_BANDS: readonly BandStart[] = [0, 6, 12, 18].map(from => ({ from, label: none }));
const HOUR_MS = 3_600_000;
/** An hour of the day as a band's heading writes it: `07:30`, and `24:00` for midnight at its end. */
const hour = (h: number) => { const minutes = Math.round(h * 60); return `${String(Math.floor(minutes / 60)).padStart(2, "0")}:${String(minutes % 60).padStart(2, "0")}`; };

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
 * The rows in their time bands, by their slot's time on the day: each band from
 * its hour to the next band's, the last to midnight.
 *
 * @param rows - The day's rows
 * @param plan - The day as drafted
 * @param day - The plan day
 * @param bands - The bands' first hours, from 0, rising; four by default
 * @returns The bands, each with its counts
 */
export function tableBands(rows: readonly TableRow[], plan: Day, day: Date, bands: readonly BandStart[] = DEFAULT_BANDS): TableBand[] {
    return bands.map((band, i) => {
        const to = bands[i + 1]?.from ?? 24;
        const key = `${hour(band.from)}–${hour(to)}`;
        return bandOf(key, band.label.type === "some" ? band.label.value : key,
            rows.filter(r => { const h = (r.slotAt.getTime() - day.getTime()) / HOUR_MS; return h >= band.from && h < to; }), plan);
    });
}

/** A band of rows, with what they hold. */
function bandOf(key: string, label: string, rows: readonly TableRow[], plan: Day): TableBand {
    const bins = rows.filter(r => r.kind === "bin");
    return {
        key, label, rows: [...rows],
        bins: bins.length, reserved: rows.filter(r => r.kind === "reserved").length, free: rows.filter(r => r.kind === "free").length,
        quantity: bins.reduce((sum, r) => sum + (plan.bins.get(r.bin!)?.quantity ?? 0), 0),
    };
}

/**
 * The rows a narrowing shows (#1336): a row of a shown lane that holds no
 * resource — free, or not yet allocated — or has a part on a shown resource.
 * Monotone in both sets: showing more never hides a row.
 *
 * @param rows - The rows, in order
 * @param plan - The day as drafted
 * @param lanes - The lanes the narrowing shows; `none`, every one
 * @param resources - The resources it shows; `none`, every one
 * @returns The rows it shows, in their order
 */
export function narrowRows(rows: readonly TableRow[], plan: Day, lanes: option<ReadonlySet<string>>, resources: option<ReadonlySet<string>>): TableRow[] {
    return rows.filter(row => {
        if (lanes.type === "some" && !lanes.value.has(row.lane)) return false;
        const parts = resources.type === "none" || row.bin === undefined ? undefined : plan.bins.get(row.bin)?.parts;
        if (parts === undefined || parts.size === 0) return true;
        for (const key of parts.keys()) if (resources.type === "some" && resources.value.has(key)) return true;
        return false;
    });
}

/**
 * The bands as a narrowing shows them: each with its shown rows and what they
 * hold; a band the narrowing empties has no heading.
 *
 * @param bands - The day's bands
 * @param plan - The day as drafted
 * @param lanes - The lanes the narrowing shows; `none`, every one
 * @param resources - The resources it shows; `none`, every one
 * @returns The bands, in order
 */
export function narrowBands(bands: readonly TableBand[], plan: Day, lanes: option<ReadonlySet<string>>, resources: option<ReadonlySet<string>>): TableBand[] {
    if (lanes.type === "none" && resources.type === "none") return [...bands];
    return bands.flatMap(band => {
        const rows = narrowRows(band.rows, plan, lanes, resources);
        return rows.length === 0 && band.rows.length > 0 ? [] : [bandOf(band.key, band.label, rows, plan)];
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
