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
import type { AllocationDomain, AllocationValue, Day, Selection } from "./model.js";

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
export function allocationCommands(value: AllocationValue, domain: AllocationDomain, editing: AllocationEditing, select: (next: Selection | undefined) => void): AllocationCommands {
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
        unlink(id, resource) {
            if (plan.bins.get(id)?.parts.has(resource) !== true) return;
            if (write("Unlink", "remove", next => { next.bins.get(id)!.parts.delete(resource); })) select({ type: "bin", id });
        },
        publish() {
            if (canEdit() && editing.record({ ...domain.copyDay(plan), status: variant("published", { at: new Date() }) } as Day, "typed", "Publish day")) editing.history.act("apply");
        },
    };
}
