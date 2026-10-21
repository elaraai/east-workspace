/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

/**
 * One command path for the Timeline, the Table, the Library, the Inspector and
 * the narrow cards (A75, #1372, `Builder Interfaces Spec.md` §6, §7): each
 * command works out the day as it leaves it, on a detached copy of the day as
 * drafted, then records the bins it changed as one step of the history — a
 * changed bin's row written through the bin kind's `write`, every field no
 * role maps as it was (B1); a bin gone removed; a new one's row the kind's
 * `create`, a booking's with its arrival's `values` or the fields' defaults, a
 * reservation's with the defaults (B13), under a key minted unique among every
 * key the board holds (B15, `shared/schedule/records.ts`). The inspector's
 * form edits the row's own fields through the kind's `write` of a field, and
 * the kind's own form writes the row whole. Publish runs Save, then writes the
 * day's status once every record reads back as saved (B7, `publishPeriod`).
 *
 * @packageDocumentation
 */

import { SortedMap, none, some, variant, type option } from "@elaraai/east";
import type { Origin } from "@elaraai/east-ui-components";
import type { ScheduleChange } from "../shared/schedule/editing.js";
import { fieldChange, mintKey, periodPublishChange } from "../shared/schedule/records.js";
import { PERIODS, type AllocationEditing } from "./editing.js";
import {
    compareFloat, compareString, dayKey, editableStatus, partsOf, rolesOf, sameRowBytes, type AllocationDomain, type AllocationValue, type Bin, type Day,
    type PlacedPeriod, type Roles, type Selection, type StoredBin,
} from "./model.js";

/**
 * What a bin's parts leave unallocated (A70): its quantity less what its parts
 * hold — all of it with no part; none for a reservation.
 *
 * @param bin - The bin
 * @returns The remainder, never below zero
 */
export function remainderOf(bin: Bin): number {
    if (bin.arrival.type === "none") return 0;
    const left = bin.quantity - [...bin.parts.values()].reduce((n, q) => n + q, 0);
    return compareFloat(left, 0) > 0 ? left : 0;
}

/** What `Split…` takes of a bin (A71): from where, how much there is, and the quantity's bounds and default. */
export interface SplitTake {
    /** The part it takes off, or `undefined` for what the parts leave unallocated. */
    from: string | undefined;
    /** What there is to take: the part, or the remainder. */
    held: number;
    /** The least and the most it takes, and what it takes unless told otherwise. */
    least: number;
    most: number;
    initial: number;
}

/**
 * What `Split…` takes of a bin (A71, #1362): with some of it unallocated, that
 * — all of it by default and at most, at least 1 of it (all of it, under 1);
 * with none, a quantity off a part — its largest, or the one named — half of
 * it by default, at least 1 (half of it, for a part under 2) and at most the
 * part less that, so both keep some. A reservation, a bin with nothing on a
 * resource and nothing left, and a part it does not have split nothing.
 *
 * @param bin - The bin
 * @param from - The part to take off when nothing is left; its largest by default
 * @returns What it takes, or `undefined` for nothing to split
 */
export function splitOf(bin: Bin, from?: string): SplitTake | undefined {
    if (bin.arrival.type === "none") return undefined;
    const remainder = remainderOf(bin);
    if (compareFloat(remainder, 0) > 0) return { from: undefined, held: remainder, least: compareFloat(remainder, 1) < 0 ? remainder : 1, most: remainder, initial: remainder };
    const key = from ?? partsOf(bin)[0]?.key;
    const part = key === undefined ? undefined : bin.parts.get(key);
    if (key === undefined || part === undefined || compareFloat(part, 0) <= 0) return undefined;
    const half = part / 2, least = compareFloat(half, 1) < 0 ? half : 1;
    return { from: key, held: part, least, most: part - least, initial: half };
}

/**
 * What a drag onto a resource carries of a bin (A39, A73): a link's part, or
 * a connector's remainder — all of it with no part — or, with nothing left
 * over, its largest part.
 *
 * @param bin - The bin
 * @param from - The link's resource, for a link's drag
 * @returns The quantity and the part it leaves, or `undefined` for a part the bin no longer has
 */
export function linkedQuantity(bin: Bin, from: string | undefined): { quantity: number; from: string | undefined } | undefined {
    if (from !== undefined) { const quantity = bin.parts.get(from); return quantity === undefined ? undefined : { quantity, from }; }
    const allocated = [...bin.parts.values()].reduce((n, q) => n + q, 0);
    if (bin.quantity - allocated > 0 || bin.parts.size === 0) return { quantity: bin.quantity - allocated, from: undefined };
    const largest = partsOf(bin)[0]!;
    return { quantity: largest.quantity, from: largest.key };
}

/** What the commands read: the day as drafted and as stored, its rows, and the editing they record through. */
export interface AllocationState {
    readonly value: AllocationValue;
    readonly domain: AllocationDomain;
    /** The plan day. */
    readonly day: Date;
    /** The day as drafted, and as the records hold it. */
    readonly plan: Day;
    readonly held: Day;
    /** The day's own row as drafted, and as stored. */
    readonly period: PlacedPeriod;
    readonly heldPeriod: PlacedPeriod;
    /** The bins the day's window read, by key: each stored bin's bytes, and what a new key is minted unique among. */
    readonly read: ReadonlyMap<string, StoredBin>;
    /** The editing; `undefined` for a read-only board. */
    readonly editing: AllocationEditing | undefined;
    /** Whether the day's reads have landed and no Publish is under way: a gesture waits for them. */
    readonly ready: boolean;
}

/** The board's commands. */
export interface AllocationCommands {
    /** Whether the day takes a gesture now: editable, its reads landed, its records' sessions writable. */
    readonly available: boolean;
    /** The same, as the board's parts ask it. */
    canEdit: () => boolean;
    /** Removes a bin (A76): a committed one stays under Removed from plan until Save; a new one is gone. */
    remove(id: string): void;
    /** Reverts a bin (A76): a committed one back as the day holds it, its row whole; a new one's arrival back to Arrivals. */
    revert(id: string): void;
    /** Unlinks one part of a bin (A68), or every part with no resource named (the inspector's Unlink, A56): what it held there is unallocated again. */
    unlink(id: string, resource?: string): void;
    /**
     * Sets a bin's quantity (A57, A75: the inspector's quantity field): a bin
     * wholly on one resource stays wholly there; a split or partly allocated
     * bin keeps its parts, its remainder changing, and never holds less than
     * they take.
     */
    setQuantity(id: string, quantity: number): boolean;
    /** Takes a bin's row as the bin kind's own form wrote it: one transaction, as every gesture is (A75). */
    row(id: string, bytes: Uint8Array): boolean;
    /** Edits one of the bin row's own fields, as the inspector's form over the kind's `fields` does. */
    field(id: string, path: readonly string[], next: unknown): boolean;
    /**
     * Splits a bin (A71, #1362): a new part on a resource it is not on, of
     * what {@link splitOf} takes — of what its parts leave unallocated, more
     * than nothing and no more than all of it; with nothing left, off a part
     * (its largest, or `from`), more than nothing and less than all of it, so
     * both keep some. One step.
     */
    split(id: string, resource: string, quantity: number, from?: string): boolean;
    /**
     * Sets one part's quantity (A71, the inspector's field in Assigned to): no
     * more than the part and the remainder together; nothing unlinks it, what
     * it held unallocated again. The bin's quantity never changes.
     */
    setPart(id: string, resource: string, quantity: number): boolean;
    /** Moves a bin to a lane slot, after the slot's bins by a minute each (A37); its resource never changes. */
    move(id: string, lane: string, at: Date): boolean;
    /**
     * Links a bin on a resource (A39): a link's part moves there (`from`), or a
     * connector's quantity goes there — its remainder, or, with none, its
     * largest part.
     */
    link(id: string, resource: string, from: string | undefined): boolean;
    /** Fills a reservation with a bin (A38): the bin takes its lane, time and resource, and the reservation goes. */
    fill(id: string, reservation: string): boolean;
    /** Books an arrival into a lane slot (A49): a new bin of it, its row's other fields the arrival's `values`, on a resource or not linked yet. */
    book(arrival: string, lane: string, at: Date, resource: string | undefined): boolean;
    /** Replaces a bin's arrival (A49): a bin of the other arrival takes its lane, time and resource; the replaced one goes back to Arrivals. */
    replace(id: string, arrival: string): boolean;
    /** Books an arrival into a reservation (A38, A49): its bin takes the reservation's lane, time and resource, and the reservation goes. */
    fillWith(reservation: string, arrival: string): boolean;
    /** Reserves a lane slot on a resource (A49): a bin with no arrival, no quantity and no hold, its row's other fields their defaults. */
    reserve(lane: string, at: Date, resource: string): boolean;
    /** Books a committed bin the drafts removed again (A51), as the day holds it, into a lane slot: on a resource, or not linked yet. */
    restore(id: string, lane: string, at: Date, resource: string | undefined): boolean;
    /** Books a committed bin the drafts removed again into a reservation (A38): it takes the reservation's lane, time and resource, and the reservation goes. */
    restoreInto(id: string, reservation: string): boolean;
    /** Returns a draft booking's arrival to Arrivals (A51): every bin of it the day does not hold yet goes. */
    unbook(arrival: string): void;
    /** Publishes the day (A4, B7): Save, then its status. */
    publish(): void;
}

/**
 * The board's commands over the day (see the module docs).
 *
 * @param state - The day, its rows and the editing
 * @param select - Sets what is selected, keeping the panes as they are
 * @param publish - Publishes the day: Save, then its status
 * @returns The commands
 */
export function allocationCommands(state: AllocationState, select: (next: Selection | undefined, soft?: boolean) => void, publish: () => void): AllocationCommands {
    const { value, domain, day, plan, held, editing } = state;
    const schedule = editing?.schedule;
    const bins = value.bin.kind.key;
    const available = editing !== undefined && schedule !== undefined && state.ready && !value.settings.readOnly
        && editableStatus(state.heldPeriod.status) && editableStatus(state.period.status) && schedule.available(bins);
    // Every bin key the board holds: read, drafted, the day's as drafted and as stored, the record's own when it is read whole, or this gesture's.
    const taken = (minted: ReadonlySet<string>) => (key: string) => minted.has(key) || state.read.has(key) || plan.bins.has(key) || held.bins.has(key)
        || schedule?.draftsOf(bins).has(key) === true || schedule?.held(bins, key) !== undefined;
    const record = (changes: readonly ScheduleChange[], origin: Origin, label: string) => schedule !== undefined && changes.length > 0 && schedule.record(changes, origin, label);
    /**
     * The rows a day as it leaves a gesture changes, from the day as drafted: each bin gone removed; each new or changed one's
     * row written through the kind's `write` over its own row, every field no role maps as it was (B1) — a bin back as the day
     * holds it its stored row whole — and one under a key the record has never held a new row.
     */
    const changesOf = (next: Day): ScheduleChange[] => {
        const changes: ScheduleChange[] = [];
        for (const id of plan.bins.keys()) if (!next.bins.has(id)) changes.push({ kind: bins, id, remove: true });
        for (const [id, bin] of next.bins) {
            const was = plan.bins.get(id);
            if (was !== undefined && domain.sameBin(was, bin)) continue;
            const stored = held.bins.get(id);
            const row = stored !== undefined && domain.sameBin(stored, bin) ? state.read.get(id)?.bytes : undefined;
            const bytes = row ?? value.bin.write(domain.encodeRow(bin.row), rolesOf(bin));
            changes.push(was === undefined && stored === undefined ? { kind: bins, id, row: bytes, created: true } : { kind: bins, id, row: bytes });
        }
        return changes;
    };
    /** One gesture, one transaction (A75): on a copy of the day as drafted, never what the board read; its bins recorded as one step. */
    const write = (label: string, origin: Origin, change: (next: Day) => void): boolean => {
        if (!available) return false;
        const next = domain.copyDay(plan);
        change(next);
        return record(changesOf(next), origin, label);
    };
    /** A new bin of the day: its row the kind's `create` of its roles and the values given, its roles as the kind reads them back; its key minted. */
    const created = (roles: Roles, values: option<Uint8Array>, minted: Set<string>): { id: string; bin: Bin } | undefined => {
        const bytes = value.bin.create(roles, values);
        const bin = domain.binOf(value.bin.read(bytes), domain.decodeRow(bytes), day);
        if (bin.type !== "some") return undefined;
        const id = mintKey(taken(minted));
        minted.add(id);
        return { id, bin: bin.value };
    };
    /** A booking of an arrival (§6.4): its key, quantity, kind and hold, on a resource or not linked yet, its row's other fields its `values`. */
    const booking = (arrival: string, lane: string, at: Date, resource: string | undefined) => {
        const of = value.arrivals.find(a => a.key === arrival);
        if (of === undefined) return undefined;
        return created({ at, lane, arrival: some(arrival), quantity: of.quantity, kind: of.kind, hold: of.hold,
            parts: new SortedMap<string, number>(resource === undefined ? [] : [[resource, of.quantity]], compareString) }, value.initial(arrival), new Set());
    };
    return {
        available, canEdit: () => available,
        remove(id) {
            if (!plan.bins.has(id)) return;
            const committed = held.bins.has(id);
            if (write(`Back to ${value.labels.arrival.other}`, "remove", next => { next.bins.delete(id); })) select(committed ? { type: "bin", id } : undefined);
        },
        revert(id) {
            if (!held.bins.has(id)) {
                if (plan.bins.has(id) && write(`Return to ${value.labels.arrival.other}`, "remove", next => { next.bins.delete(id); })) select(undefined);
                return;
            }
            if (write("Revert", "typed", next => { next.bins.set(id, domain.copyDay(held).bins.get(id)!); })) select({ type: "bin", id });
        },
        move(id, lane, at) {
            if (!plan.bins.has(id)) return false;
            const done = write("Move", "move", next => { const bin = next.bins.get(id)!; bin.lane = lane; bin.at = at; });
            // A selection a command makes follows softly: the row stays where it is when it is in view (A12).
            if (done) select({ type: "bin", id }, true);
            return done;
        },
        link(id, resource, from) {
            const bin = plan.bins.get(id);
            if (bin === undefined) return false;
            const moved = linkedQuantity(bin, from);
            if (moved === undefined || moved.from === resource) return false;
            const done = write("Link", "drop", next => {
                const parts = next.bins.get(id)!.parts;
                if (moved.from !== undefined) parts.delete(moved.from);
                parts.set(resource, (parts.get(resource) ?? 0) + moved.quantity);
            });
            if (done) select({ type: "bin", id }, true);
            return done;
        },
        fill(id, reservation) {
            const bin = plan.bins.get(id), into = plan.bins.get(reservation);
            if (bin === undefined || into === undefined || into.arrival.type !== "none") return false;
            const resource = [...into.parts.keys()][0];
            const done = write("Fill the reservation", "drop", next => {
                const moved = next.bins.get(id)!;
                moved.lane = into.lane; moved.at = into.at;
                moved.parts.clear();
                if (resource !== undefined) moved.parts.set(resource, moved.quantity);
                next.bins.delete(reservation);
            });
            if (done) select({ type: "bin", id }, true);
            return done;
        },
        book(arrival, lane, at, resource) {
            const made = booking(arrival, lane, at, resource);
            if (made === undefined) return false;
            const done = write("Book", "drop", next => { next.bins.set(made.id, made.bin); });
            if (done) select({ type: "bin", id: made.id }, true);
            return done;
        },
        replace(id, arrival) {
            const was = plan.bins.get(id);
            if (was === undefined || was.arrival.type === "none") return false;
            const made = booking(arrival, was.lane, was.at, partsOf(was)[0]?.key);
            if (made === undefined) return false;
            const done = write("Replace", "typed", next => { next.bins.delete(id); next.bins.set(made.id, made.bin); });
            if (done) select({ type: "bin", id: made.id }, true);
            return done;
        },
        fillWith(reservation, arrival) {
            const into = plan.bins.get(reservation);
            if (into === undefined || into.arrival.type !== "none") return false;
            const made = booking(arrival, into.lane, into.at, [...into.parts.keys()][0]);
            if (made === undefined) return false;
            const done = write("Book into the reservation", "drop", next => { next.bins.delete(reservation); next.bins.set(made.id, made.bin); });
            if (done) select({ type: "bin", id: made.id }, true);
            return done;
        },
        reserve(lane, at, resource) {
            // A reservation's row: no arrival, no quantity, no hold, its other fields their defaults (B13).
            const made = created({ at, lane, arrival: none, quantity: 0, kind: none, hold: variant("days", 0), parts: new SortedMap<string, number>([[resource, 0]], compareString) },
                none, new Set());
            if (made === undefined) return false;
            const done = write("Reserve", "drop", next => { next.bins.set(made.id, made.bin); });
            if (done) select({ type: "bin", id: made.id }, true);
            return done;
        },
        unlink(id, resource) {
            const bin = plan.bins.get(id);
            if (bin === undefined || (resource === undefined ? bin.parts.size === 0 : !bin.parts.has(resource))) return;
            if (write("Unlink", "remove", next => {
                const parts = next.bins.get(id)!.parts;
                if (resource === undefined) parts.clear(); else parts.delete(resource);
            })) select({ type: "bin", id });
        },
        setQuantity(id, quantity) {
            const bin = plan.bins.get(id);
            if (bin === undefined || bin.arrival.type === "none" || !Number.isFinite(quantity) || compareFloat(quantity, 0) < 0 || compareFloat(quantity, bin.quantity) === 0) return false;
            const parts = partsOf(bin);
            const whole = parts.length === 1 && compareFloat(parts[0]!.quantity, bin.quantity) === 0;
            if (!whole && compareFloat(quantity, parts.reduce((n, p) => n + p.quantity, 0)) < 0) return false;
            return write("Edit bin", "typed", next => {
                const into = next.bins.get(id)!;
                into.quantity = quantity;
                if (whole) into.parts.set(parts[0]!.key, quantity);
            });
        },
        row(id, bytes) {
            const was = plan.bins.get(id);
            if (!available || was === undefined || sameRowBytes(bytes, domain.encodeRow(was.row))) return false;
            return record([{ kind: bins, id, row: bytes }], "typed", "Edit bin");
        },
        field(id, path, next) {
            if (!available || !plan.bins.has(id)) return false;
            const change = fieldChange(value.bin.kind, id, path, next);
            return change !== undefined && record([change], "typed", "Edit bin");
        },
        split(id, resource, quantity, from) {
            const bin = plan.bins.get(id);
            const take = bin === undefined ? undefined : splitOf(bin, from);
            if (bin === undefined || take === undefined || bin.parts.has(resource) || !Number.isFinite(quantity) || compareFloat(quantity, 0) <= 0
                || (take.from === undefined ? compareFloat(quantity, take.held) > 0 : compareFloat(quantity, take.held) >= 0)) return false;
            const done = write("Split", "typed", next => {
                const parts = next.bins.get(id)!.parts;
                if (take.from !== undefined) parts.set(take.from, take.held - quantity);
                parts.set(resource, quantity);
            });
            if (done) select({ type: "bin", id }, true);
            return done;
        },
        setPart(id, resource, quantity) {
            const bin = plan.bins.get(id);
            const part = bin?.parts.get(resource);
            if (bin === undefined || part === undefined || !Number.isFinite(quantity) || compareFloat(quantity, 0) < 0
                || compareFloat(quantity, part) === 0 || compareFloat(quantity, part + remainderOf(bin)) > 0) return false;
            // Nothing on it unlinks it (A71): what it held is unallocated again.
            if (compareFloat(quantity, 0) === 0) return write("Unlink", "remove", next => { next.bins.get(id)!.parts.delete(resource); });
            return write("Edit bin", "typed", next => { next.bins.get(id)!.parts.set(resource, quantity); });
        },
        restore(id, lane, at, resource) {
            if (!held.bins.has(id) || plan.bins.has(id)) return false;
            const done = write("Book", "drop", next => {
                const bin = domain.copyDay(held).bins.get(id)!;
                bin.lane = lane; bin.at = at;
                bin.parts.clear();
                if (resource !== undefined) bin.parts.set(resource, bin.quantity);
                next.bins.set(id, bin);
            });
            if (done) select({ type: "bin", id }, true);
            return done;
        },
        restoreInto(id, reservation) {
            const into = plan.bins.get(reservation);
            if (!held.bins.has(id) || plan.bins.has(id) || into === undefined || into.arrival.type !== "none") return false;
            const resource = [...into.parts.keys()][0];
            const done = write("Book into the reservation", "drop", next => {
                const bin = domain.copyDay(held).bins.get(id)!;
                bin.lane = into.lane; bin.at = into.at;
                bin.parts.clear();
                if (resource !== undefined) bin.parts.set(resource, bin.quantity);
                next.bins.delete(reservation);
                next.bins.set(id, bin);
            });
            if (done) select({ type: "bin", id }, true);
            return done;
        },
        unbook(arrival) {
            const ids = [...plan.bins].flatMap(([id, bin]) => bin.arrival.type === "some" && bin.arrival.value === arrival && !held.bins.has(id) ? [id] : []);
            if (ids.length === 0) return;
            if (write(`Return to ${value.labels.arrival.other}`, "remove", next => { for (const id of ids) next.bins.delete(id); })) select(undefined);
        },
        publish() { if (available && value.periods.type === "some") publish(); },
    };
}

/**
 * The day's row as Publish writes it: its status the published case, at the
 * time given (`periodPublishChange`).
 *
 * @param value - The payload: its periods
 * @param editing - The editing
 * @param day - The plan day
 * @param stored - The day's row as the board read it
 * @param at - When it is published
 * @returns The change; `undefined` without periods
 */
export function publishChange(value: AllocationValue, editing: AllocationEditing, day: Date, stored: Uint8Array | undefined, at: Date): ScheduleChange | undefined {
    if (value.periods.type !== "some") return undefined;
    return periodPublishChange(value.periods.value, editing.schedule, PERIODS, dayKey(day), stored, at);
}
