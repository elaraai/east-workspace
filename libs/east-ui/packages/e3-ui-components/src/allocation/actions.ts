/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

/**
 * One command path for the Timeline, the Table, the Library, the Inspector and
 * the narrow cards (A75): every gesture is one guarded transaction of the
 * day's session, on a detached copy of the day, never the record's.
 *
 * @packageDocumentation
 */

import { variant } from "@elaraai/east";
import type { Origin } from "@elaraai/east-ui-components";
import type { AllocationEditing } from "./editing.js";
import { partsOf, type AllocationDomain, type AllocationValue, type Bin, type Day, type Selection } from "./model.js";

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

/** The board's commands. */
export interface AllocationCommands {
    editing: AllocationEditing;
    /** Whether the day can be edited now. */
    canEdit: () => boolean;
    /** Removes a bin (A76): a committed one stays under Removed from plan until Save; a new one is gone. */
    remove(id: string): void;
    /** Reverts a bin (A76): a committed one back as the day holds it; a new one's event back to Events. */
    revert(id: string): void;
    /** Unlinks one part of a bin (A68): its quantity on that resource is unallocated again. */
    unlink(id: string, resource: string): void;
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
    /** Publishes the day (A4): its status and its drafts, one patch. */
    publish(): void;
}

/**
 * The board's commands over the active day's session.
 *
 * @param value - The payload
 * @param domain - The plans at the bin values
 * @param editing - The day's session
 * @param select - Sets what is selected, keeping the panes as they are
 * @returns The commands
 */
export function allocationCommands(value: AllocationValue, domain: AllocationDomain, editing: AllocationEditing, select: (next: Selection | undefined, soft?: boolean) => void): AllocationCommands {
    const { plan } = editing;
    const canEdit = () => editing.available && !value.settings.readOnly && plan.status.type === "draft";
    const write = (label: string, origin: Origin, change: (next: Day) => void) => {
        if (!canEdit()) return false;
        const next = domain.copyDay(plan); change(next); return editing.record(next, origin, label);
    };
    return {
        editing, canEdit,
        remove(id) {
            if (!plan.bins.has(id)) return;
            const committed = editing.held?.bins.has(id) === true;
            if (write("Back to Events", "remove", next => { next.bins.delete(id); })) select(committed ? { type: "bin", id } : undefined);
        },
        revert(id) {
            if (editing.held?.bins.has(id) !== true) {
                if (plan.bins.has(id) && write("Return to Events", "remove", next => { next.bins.delete(id); })) select(undefined);
                return;
            }
            if (write("Revert", "typed", next => { next.bins.set(id, domain.copyDay(editing.held!).bins.get(id)!); })) select({ type: "bin", id });
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
            const bin = plan.bins.get(id), held = plan.bins.get(reservation);
            if (bin === undefined || held === undefined || held.event.type !== "none") return false;
            const resource = [...held.parts.keys()][0];
            const done = write("Fill the reservation", "drop", next => {
                const into = next.bins.get(id)!;
                into.lane = held.lane; into.at = held.at;
                into.parts.clear();
                if (resource !== undefined) into.parts.set(resource, into.quantity);
                next.bins.delete(reservation);
            });
            if (done) select({ type: "bin", id }, true);
            return done;
        },
        unlink(id, resource) {
            if (plan.bins.get(id)?.parts.has(resource) !== true) return;
            if (write("Unlink", "remove", next => { next.bins.get(id)!.parts.delete(resource); })) select({ type: "bin", id });
        },
        publish() {
            if (canEdit() && editing.record({ ...domain.copyDay(plan), status: variant("published", { at: new Date() }) } as Day, "typed", "Publish day")) editing.history.act("apply");
        },
    };
}
