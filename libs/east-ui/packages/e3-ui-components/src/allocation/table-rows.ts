/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

/**
 * The Table's rows (`Allocation Spec.md` §8, A41–A43), pure: one row per lane
 * slot of the day, and one more per extra bin of a batch, in e3-ui's slot
 * order — time, then lane — in the app's time bands (four by default). A row is its slot's or its
 * bin's, so an allocation never moves it. The narrowing (#1336) hides a row
 * whose lane it hides, whose every resource it hides, or whose bin's arrival
 * it hides (#1339, `rowHiding`); never reorders one.
 *
 * @packageDocumentation
 */

import { none, type option } from "@elaraai/east";
import { dayKey, parseDay, type Day, type Slot } from "./model.js";

/** What a row holds: nothing, a bin with an arrival, or a reservation. */
export type TableRowKind = "free" | "bin" | "reserved";

/** One row of the Table. */
export interface TableRow {
    /** Its identity: its bin's, or its free slot's. */
    key: string;
    /** Its lane's key. */
    lane: string;
    /** Its time: its bin's, or its slot's. */
    at: Date;
    /** Its slot's time: what a drop on its arrival cell names. */
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
    /** Its bins with an arrival, its reservations and its free slots. */
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
                kind: bin.arrival.type === "none" ? "reserved" as const : "bin" as const }];
        }));
}

/**
 * What a row's key names: its bin, or its free slot's lane and time.
 *
 * @param key - A row's key
 * @returns Its bin, or its slot; `undefined` for no row's key
 */
export function rowOfKey(key: string): { bin: string } | { lane: string; at: Date } | undefined {
    if (key.startsWith("bin:")) return { bin: key.slice("bin:".length) };
    if (!key.startsWith("slot:")) return undefined;
    const rest = key.slice("slot:".length), bar = rest.lastIndexOf("|");
    const at = bar < 0 ? undefined : parseDay(rest.slice(bar + 1));
    return at?.success === true ? { lane: rest.slice(0, bar), at: at.value } : undefined;
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

/** Which of the narrowing's sources hide a row: its lane's, its resources', its arrival's. */
export interface RowHiding {
    readonly lanes: boolean;
    readonly resources: boolean;
    readonly arrivals: boolean;
}

/**
 * What hides a row under a narrowing (#1336, #1339): its lane, where the
 * narrowing hides it; its bin's arrival, where it hides that — a reservation,
 * which has no arrival, it never hides so; and its bin's resources, where the
 * bin has parts and it hides every one of them — a free row, or a bin not yet
 * allocated, it never hides so. What Search Records says hides a bin it finds
 * is this too (`hidden.ts`, #1398).
 *
 * @param lane - The row's lane
 * @param bin - Its bin's arrival and the resources it has parts on; `undefined` for a free row
 * @param lanes - The lanes the narrowing shows; `none`, every one
 * @param resources - The resources it shows; `none`, every one
 * @param arrivals - The arrivals it shows; `none`, every one
 * @returns Which sources hide it
 */
export function rowHiding(lane: string, bin: { readonly arrival: string | undefined; readonly parts: Iterable<string> } | undefined,
    lanes: option<ReadonlySet<string>>, resources: option<ReadonlySet<string>>, arrivals: option<ReadonlySet<string>>): RowHiding {
    let parts = 0, shown = false;
    if (resources.type === "some" && bin !== undefined) for (const key of bin.parts) { parts++; shown ||= resources.value.has(key); }
    return {
        lanes: lanes.type === "some" && !lanes.value.has(lane),
        resources: parts > 0 && !shown,
        arrivals: arrivals.type === "some" && bin?.arrival !== undefined && !arrivals.value.has(bin.arrival),
    };
}

/**
 * The rows a narrowing shows (#1336, #1339): those nothing of it hides
 * ({@link rowHiding}) — a row of a shown lane, of a shown arrival or none —
 * free, or a reservation — that holds no resource (free, or not yet
 * allocated) or has a part on a shown resource. Monotone in each set: showing
 * more never hides a row.
 *
 * @param rows - The rows, in order
 * @param plan - The day as drafted
 * @param lanes - The lanes the narrowing shows; `none`, every one
 * @param resources - The resources it shows; `none`, every one
 * @param arrivals - The arrivals it shows; `none`, every one
 * @returns The rows it shows, in their order
 */
export function narrowRows(rows: readonly TableRow[], plan: Day, lanes: option<ReadonlySet<string>>, resources: option<ReadonlySet<string>>,
    arrivals: option<ReadonlySet<string>> = none): TableRow[] {
    return rows.filter(row => {
        const bin = row.bin === undefined ? undefined : plan.bins.get(row.bin);
        const hides = rowHiding(row.lane, bin === undefined ? undefined : { arrival: bin.arrival.type === "some" ? bin.arrival.value : undefined, parts: bin.parts.keys() },
            lanes, resources, arrivals);
        return !hides.lanes && !hides.resources && !hides.arrivals;
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
 * @param arrivals - The arrivals it shows; `none`, every one
 * @returns The bands, in order
 */
export function narrowBands(bands: readonly TableBand[], plan: Day, lanes: option<ReadonlySet<string>>, resources: option<ReadonlySet<string>>,
    arrivals: option<ReadonlySet<string>> = none): TableBand[] {
    if (lanes.type === "none" && resources.type === "none" && arrivals.type === "none") return [...bands];
    return bands.flatMap(band => {
        const rows = narrowRows(band.rows, plan, lanes, resources, arrivals);
        return rows.length === 0 && band.rows.length > 0 ? [] : [bandOf(band.key, band.label, rows, plan)];
    });
}

/** A row's status (A43), as its Status cell and its narrow card say it. */
export type RowStatus = "Free" | "Not linked" | "Check" | "Draft" | "Reserved" | "Committed";

/**
 * A row's status (A43): what it holds, and whether a resource of it needs a
 * look — `Free`, `Not linked`, `Check` (a resource of it over max or held into
 * its next job), `Draft`, `Reserved` or `Committed`.
 *
 * @param kind - What the row holds
 * @param linked - Whether its bin has a part on a resource
 * @param check - Whether a resource of it is over max or held into its next job
 * @param draft - Whether its bin is a draft
 * @returns Its status
 */
export function rowStatus(kind: TableRowKind, linked: boolean, check: boolean, draft: boolean): RowStatus {
    return kind === "free" ? "Free" : kind === "bin" && !linked ? "Not linked" : check ? "Check" : draft ? "Draft" : kind === "reserved" ? "Reserved" : "Committed";
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
