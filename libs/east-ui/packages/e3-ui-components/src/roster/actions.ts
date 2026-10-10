/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

/** One command path for the grid, library, inspector and narrow cards. */
import { SortedMap, none, some, variant, type ValueTypeOf } from "@elaraai/east";
import type { RosterPatchType } from "@elaraai/e3-ui/internal";
import type { Origin } from "@elaraai/east-ui-components";
import type { RosterEditing } from "./editing.js";
import { assignmentFor, availableProposals, compareString, copyWeek, sameSlot, type Assignment, type Issue, type RosterValue, type Selection, type Slot, type Week } from "./model.js";

/** Where a place command gets its person or request. */
export type RosterSource = { type: "person" | "agency" | "assignment" | "proposal"; key: string };
export type PeopleFocus = { type: "leads" | "trainers" | "off" } | { type: "skill"; key: string } | undefined;
/** All mutation paths use these guarded commands and one session transaction. */
export interface RosterCommands {
    editing: RosterEditing;
    place(source: RosterSource, slot: Slot, checkOnly?: boolean): string | undefined;
    update(id: string, next: Assignment, origin?: Origin, checkOnly?: boolean): string | undefined;
    remove(id: string): void;
    restore(id: string): void;
    requirement(slot: Slot, target: Week["requirements"] extends Map<Slot, infer R> ? R : never): void;
    activity(id: string, activity: Assignment["activity"], checkOnly?: boolean): string | undefined;
    patch(id: string, patch: ValueTypeOf<typeof RosterPatchType>, checkOnly?: boolean): string | undefined;
    accept(key: string): string | undefined;
    reject(key: string): void;
    fix(issue: Issue): string | undefined;
    copy(previous: Week): void;
    publish(): void;
}
/** Every draft is detached before the command changes it; record state stays untouched. */
export function rosterCommands(value: RosterValue, editing: RosterEditing, start: Date, select: (selection: Selection | undefined) => void, find: (focus: PeopleFocus) => void): RosterCommands {
    const { week } = editing;
    const canEdit = () => editing.available && week.status.type === "draft";
    const unavailable = () => canEdit() ? undefined : "This week is not available to edit.";
    const validSlot = (slot: Slot) => slot.day >= 0n && slot.day < 7n && value.groups.some(g => g.key === slot.group) && value.shifts.some(s => s.key === slot.shift);
    const mint = () => { let key: string; do { key = crypto.randomUUID(); } while (week.assignments.has(key) || editing.held?.assignments.has(key)); return key; };
    const write = (label: string, origin: Origin, change: (next: Week) => void) => {
        if (!canEdit()) return false;
        const next = copyWeek(week); change(next); return editing.record(next, origin, label);
    };
    const validAssignment = (next: Assignment): string | undefined => {
        if (!validSlot(next.slot)) return "Choose a configured group, shift and day in this week.";
        if (!value.positions.some(p => p.key === next.position)) return "Choose a configured position.";
        if (!Number.isFinite(next.offset) || !Number.isFinite(next.overtime) || next.overtime < 0) return "Changed hours must be finite and overtime cannot be negative.";
        if (next.who.type === "request" && next.activity.type === "some") return "Assign an activity to a named person.";
        if (next.activity.type === "some") {
            const key = next.activity.value;
            if (!value.duties.some(a => a.key === key) && !value.groups.find(g => g.key === next.slot.group)?.skills.some(a => a.key === key)) return "Choose an activity for this group, or a shared duty.";
        }
        return undefined;
    };
    const api: RosterCommands = {
        editing,
        place(source, slot, checkOnly = false) {
            const blocked = unavailable(); if (blocked !== undefined) return blocked;
            if (!validSlot(slot)) return "Choose a configured shift in this week.";
            let id: string | undefined;
            let assignment: Assignment;
            let accepted: string | undefined;
            if (source.type === "assignment") {
                id = source.key; const held = week.assignments.get(id);
                if (held === undefined) return "This assignment is no longer present.";
                if (sameSlot(held.slot, slot)) return "Already on this shift.";
                if (held.who.type === "person" && [...week.assignments].some(([key, a]) => key !== id && a.slot.day === slot.day && a.who.type === "person" && a.who.value === held.who.value)) return "This person is already rostered that day.";
                assignment = { ...held, slot, activity: held.slot.group === slot.group ? held.activity : none };
            } else if (source.type === "agency") {
                if (!value.agencies.some(a => a.key === source.key)) return "This agency is no longer available.";
                assignment = assignmentFor(value, slot, variant("request", source.key));
            } else {
                const proposal = source.type === "proposal" ? availableProposals(value, week, start).find(p => p.key === source.key) : undefined;
                if (source.type === "proposal" && proposal === undefined) return "This proposal is no longer available.";
                const person = proposal?.person ?? source.key;
                if (!value.people.some(p => p.key === person)) return "This person is no longer available.";
                const existing = [...week.assignments].find(([, a]) => a.slot.day === slot.day && a.who.type === "person" && a.who.value === person);
                if (existing !== undefined) {
                    if (sameSlot(existing[1].slot, slot)) return "Already on this shift.";
                    id = existing[0]; assignment = { ...existing[1], slot, activity: existing[1].slot.group === slot.group ? existing[1].activity : none };
                } else {
                    const removed = [...(editing.held?.assignments ?? [])].find(([key, a]) => !week.assignments.has(key) && sameSlot(a.slot, slot) && a.who.type === "person" && a.who.value === person);
                    if (removed !== undefined) { id = removed[0]; assignment = removed[1]; }
                    else assignment = assignmentFor(value, slot, variant("person", person));
                }
                accepted = proposal?.key ?? availableProposals(value, week, start).find(p => p.person === person && sameSlot(p.slot, slot))?.key;
            }
            if (checkOnly) return undefined;
            const key = id ?? mint();
            if (write(id === undefined ? "Assign to shift" : "Move assignment", "drop", next => {
                next.assignments.set(key, assignment);
                if (accepted !== undefined) next.dismissed.add(accepted);
            })) select({ type: "assignment", key });
            return undefined;
        },
        update(id, next, origin = "typed", checkOnly = false) {
            const blocked = unavailable(); if (blocked !== undefined) return blocked;
            const before = week.assignments.get(id); if (before === undefined) return "This assignment is no longer present.";
            if (next.who.type !== before.who.type || next.who.value !== before.who.value) return "An assignment editor cannot replace its person.";
            const refusal = validAssignment(next); if (refusal !== undefined) return refusal;
            if (!sameSlot(next.slot, before.slot) && next.who.type === "person" && [...week.assignments].some(([key, a]) => key !== id && a.slot.day === next.slot.day && a.who.type === "person" && a.who.value === next.who.value)) return "This person is already rostered that day.";
            const changedHours = next.offset !== before.offset || next.overtime !== before.overtime;
            const normalized = { ...next, agreed: next.offset === 0 && next.overtime === 0 ? none : changedHours ? none : next.agreed };
            if (!checkOnly) write("Edit assignment", origin, week => week.assignments.set(id, normalized));
            return undefined;
        },
        remove(id) {
            if (write("Remove assignment", "remove", next => next.assignments.delete(id))) {
                // A saved assignment stays as a restorable tombstone until Save.
                // Keep its identity so changing layouts reveals that same row.
                select(editing.held?.assignments.has(id) ? { type: "assignment", key: id } : undefined);
            }
        },
        restore(id) {
            const original = editing.held?.assignments.get(id); if (original === undefined || week.assignments.has(id)) return;
            if (original.who.type === "person" && [...week.assignments.values()].some(a => a.slot.day === original.slot.day && a.who.type === "person" && a.who.value === original.who.value)) return;
            if (write("Restore assignment", "insert", next => next.assignments.set(id, original))) select({ type: "assignment", key: id });
        },
        requirement(slot, target) {
            if (!validSlot(slot) || target.positions < 0n || [...target.hours].some(([, hours]) => !Number.isFinite(hours) || hours < 0)) return;
            write("Edit shift targets", "typed", next => {
                next.requirements.set(slot, { positions: target.positions, hours: new SortedMap([...target.hours].filter(([, hours]) => hours > 0), compareString) });
            });
        },
        activity(id, activity, checkOnly = false) {
            const before = week.assignments.get(id); if (before === undefined) return "Choose an assignment.";
            return api.update(id, { ...before, activity }, "drop", checkOnly);
        },
        patch(id, patch, checkOnly = false) {
            const before = week.assignments.get(id); if (before?.who.type !== "person") return "Place this card on a named assignment.";
            const next = { ...before };
            if (patch.position.type === "some") next.position = patch.position.value;
            if (patch.activity.type === "some") next.activity = patch.activity.value;
            if (patch.offset.type === "some") next.offset = patch.offset.value;
            if (patch.overtime.type === "some") next.overtime = patch.overtime.value;
            if (patch.agreed.type === "some") next.agreed = patch.agreed.value;
            return api.update(id, next, "drop", checkOnly);
        },
        accept(key) {
            const proposal = availableProposals(value, week, start).find(p => p.key === key);
            return proposal === undefined ? "This proposal is no longer available." : api.place({ type: "proposal", key }, proposal.slot);
        },
        reject(key) { if (write("Reject proposal", "remove", next => next.dismissed.add(key))) select(undefined); },
        fix(issue) {
            if (issue.fix.type === "none") return;
            const fix = issue.fix.value;
            if (fix.type === "find") { find(fix.value.type === "skill" ? { type: "skill", key: fix.value.value } : { type: fix.value.type }); return; }
            if (fix.type === "accept") return api.accept(fix.value);
            if (fix.type === "request") return issue.slot.type === "some" ? api.place({ type: "agency", key: fix.value }, issue.slot.value) : undefined;
            if (issue.assignment.type !== "some") return;
            const id = issue.assignment.value; const before = week.assignments.get(id); if (before === undefined) return;
            if (fix.type === "move") return api.place({ type: "assignment", key: id }, { ...before.slot, shift: fix.value });
            if (fix.type === "start") return api.update(id, { ...before, offset: fix.value });
            return api.update(id, { ...before, agreed: some(true) });
        },
        copy(previous) {
            if (editing.held !== undefined || week.assignments.size !== 0) return;
            write("Copy previous week's roster", "insert", next => {
                for (const assignment of previous.assignments.values()) next.assignments.set(mint(), { ...assignment, offset: 0, overtime: 0, agreed: none });
            });
        },
        publish() {
            if (canEdit() && editing.record({ ...copyWeek(week), status: variant("published", { at: new Date() }) }, "typed", "Publish week")) editing.history.act("apply");
        },
    };
    return api;
}
