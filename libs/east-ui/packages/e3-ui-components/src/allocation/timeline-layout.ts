/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

/**
 * The Timeline's layout (`Allocation Spec.md` §8, A14, A20), pure: the lane
 * grid's rows and cards from the day's slots, which e3-ui's `Allocation.slots`
 * draws up, and the resource axis's window and days. The renderer places each
 * part by these indices; its sizes are the `allocationBuilder` recipe's.
 *
 * @packageDocumentation
 */

import type { Bin, Day, Slot } from "./model.js";
import { DAY } from "./model.js";

/** A grid row's height, the recipe's: what the resource rows are virtualised and the panes scroll by. */
export const ROW_H = 36;
/** The lane grid's hour column, a lane's width, a card's inset in its lane and grid row, and its size: the recipe's, which a link leaves a card by. */
export const HOUR_W = 48;
export const LANE_W = 96;
export const CARD_INSET = 4;
export const CARD_W = 88;
export const CARD_H = 28;
/** The resource plot's narrowest day, in px; under {@link SHORT_DAY} a day's tick shows its number only. */
export const MIN_DAY = 24;
export const SHORT_DAY = 36;
/** The resource label column's width, the recipe's: the plot starts after it. */
export const LABEL_W = 152;

/** One bin's card in the lane grid. */
export interface LaneCard {
    /** The bin's id. */
    id: string;
    bin: Bin;
    /** Its lane's index. */
    lane: number;
    /** Its slot's index in the day. */
    slot: number;
    /** Its slot's time: the lane hour a drop on it names. */
    slotAt: Date;
    /** Its grid row: its slot's first row, and its place in the slot's batch. */
    row: number;
}

/** One lane slot's cell: a drop target when it is free. */
export interface LaneCell {
    lane: number;
    slot: number;
    /** The slot's time. */
    at: Date;
    free: boolean;
}

/** One slot index's band across every lane: as many rows as its largest batch, one at least. */
export interface LaneBand {
    slot: number;
    /** Its first grid row. */
    row: number;
    /** Its rows. */
    span: number;
    /** The first lane's slot time: what its label prints. */
    at: Date;
}

/** The lane grid. */
export interface LaneGrid {
    bands: LaneBand[];
    cells: LaneCell[];
    cards: LaneCard[];
    /** Every grid row. */
    rows: number;
    /** Each lane's bins with an arrival, and their quantity (A15). */
    heads: { bins: number; quantity: number; first: Date | undefined }[];
}

/**
 * The lane grid from the day's slots (A14): a band per slot index, its rows
 * its largest batch's; a cell per lane slot; a card per bin at its lane, its
 * slot's band, and its place in the batch. A bin the narrowing hides (#1339)
 * takes no card and no row of its batch, and its slot is still booked; each
 * lane's head counts every bin, hidden or not.
 *
 * @param lanes - The lanes' keys, in order
 * @param slots - The day's slots (`Allocation.slots`), in time then lane order
 * @param plan - The day's plan
 * @param shows - Whether a bin shows; every one by default
 * @returns The grid
 */
export function laneGrid(lanes: readonly string[], slots: readonly Slot[], plan: Day, shows: (bin: Bin) => boolean = () => true): LaneGrid {
    const index = new Map(lanes.map((key, i) => [key, i] as const));
    const byLane = lanes.map(() => [] as Slot[]);
    for (const slot of slots) { const i = index.get(slot.lane); if (i !== undefined) byLane[i]!.push(slot); }
    const count = Math.max(0, ...byLane.map(list => list.length));
    const bands: LaneBand[] = [];
    let row = 0;
    // The bins of a slot that show, in its batch's order.
    const shown = (slot: Slot | undefined) => slot === undefined ? [] : slot.bins.filter(id => { const bin = plan.bins.get(id); return bin !== undefined && shows(bin); });
    for (let k = 0; k < count; k++) {
        const span = Math.max(1, ...byLane.map(list => shown(list[k]).length));
        const at = byLane.find(list => list[k] !== undefined)![k]!.at;
        bands.push({ slot: k, row, span, at });
        row += span;
    }
    const cells: LaneCell[] = [], cards: LaneCard[] = [];
    const heads = lanes.map(() => ({ bins: 0, quantity: 0, first: undefined as Date | undefined }));
    byLane.forEach((list, lane) => {
        heads[lane]!.first = list[0]?.at;
        list.forEach((slot, k) => {
            cells.push({ lane, slot: k, at: slot.at, free: slot.bins.length === 0 });
            shown(slot).forEach((id, place) => cards.push({ id, bin: plan.bins.get(id)!, lane, slot: k, slotAt: slot.at, row: bands[k]!.row + place }));
            for (const id of slot.bins) {
                const bin = plan.bins.get(id);
                if (bin?.arrival.type === "some") { heads[lane]!.bins += 1; heads[lane]!.quantity += bin.quantity; }
            }
        });
    });
    return { bands, cells, cards, rows: row, heads };
}

/** The resource axis: its window around the plan day, and its days. */
export interface ResourceAxis {
    /** `[from, to)`: the horizon's days before and after the plan day. */
    from: Date;
    to: Date;
    /** Its days, at UTC midnight. */
    days: Date[];
    /** The plan day's index among them. */
    today: number;
}

/**
 * The resource axis around a plan day (A20): its horizon's whole days before
 * it, and after it from its start.
 *
 * @param day - The plan day, at UTC midnight
 * @param before - The horizon before it, in ms
 * @param after - The horizon after its start, in ms
 * @returns The axis
 */
export function resourceAxis(day: Date, before: number, after: number): ResourceAxis {
    const lead = Math.max(0, Math.round(before / DAY)), trail = Math.max(1, Math.round(after / DAY));
    const from = new Date(day.getTime() - lead * DAY), to = new Date(day.getTime() + trail * DAY);
    const days = Array.from({ length: lead + trail }, (_, i) => new Date(from.getTime() + i * DAY));
    return { from, to, days, today: lead };
}

/**
 * Where an instant falls along the axis, as a fraction of its window, clamped
 * to it.
 *
 * @param axis - The axis
 * @param at - The instant
 * @returns 0 at its start, 1 at its end
 */
export function axisFraction(axis: ResourceAxis, at: Date): number {
    const span = axis.to.getTime() - axis.from.getTime();
    return Math.max(0, Math.min(1, (at.getTime() - axis.from.getTime()) / span));
}

/** A span along the axis as a CSS left and width, or `undefined` when it falls outside it. */
export function axisSpan(axis: ResourceAxis, from: Date, to: Date): { left: string; width: string } | undefined {
    const a = axisFraction(axis, from), b = axisFraction(axis, to);
    if (b <= a) return undefined;
    return { left: `${a * 100}%`, width: `${(b - a) * 100}%` };
}
