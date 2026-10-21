/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

/**
 * The Roster's commands (#1369, `Builder Interfaces Spec.md` §5.5, §7): one
 * command path for the grid, the library, the inspector and the narrow cards.
 * Each reads the week as drafted, works out the rows it changes — a duty
 * through the duty kind's `write`, and `create` for a new one, its times by
 * §5.5; the week's own row through the periods' `dismiss` and `publish`; a
 * target through `write`, and `create` for a new one — and records them across
 * the records' sessions as one step. A new duty's or target's key is minted
 * unique among every key the Roster has read and drafted
 * (`crypto.randomUUID()`, retried): a record read whole holds every key, and a
 * key a record read a window at a time holds unread is its Save's own
 * conflict, never an overwrite (`shared/schedule/records.ts`). A find edits
 * nothing: it asks the app's fit (#1334). Publish runs Save, then writes the
 * week's status once every record reads back as saved (`publishPeriod`).
 *
 * @packageDocumentation
 */

import { BlobType, OptionType, equalFor, none, some, variant, type option } from "@elaraai/east";
import { ScheduleResourceRefType } from "@elaraai/e3-ui/internal";
import type { Origin } from "@elaraai/east-ui-components";
import type { ScheduleChange } from "../shared/schedule/editing.js";
import { fieldChange, mintKey, periodPublishChange } from "../shared/schedule/records.js";
import { PERIODS, TARGETS, type RosterEditing } from "./editing.js";
import type { RosterFind } from "./fit.js";
import {
    activityOf, availableProposals, compareDate, dayOfSlot, editableStatus, positionFor, rosterTimes, sameSlot, shiftTimes, startReach,
    startingAt, weekKey, type Assignment, type Context, type Issue, type PlacedDuties, type PlacedPeriod, type PlacedTargets, type Requirement,
    type Roles, type RosterPayload, type RosterValue, type Selection, type Slot, type StoredDuty, type Week, type Who,
} from "./model.js";

/** Where a place command gets its person or request. */
export type RosterSource = { type: "person" | "agency" | "assignment" | "proposal"; key: string };
/** What a form changes of a duty's roles: its times, its position, its activity. */
export type RolesChange = Partial<Pick<Roles, "start" | "end" | "position" | "activity">>;
/** One field a library card's drop sets, as the kind writes it. */
export interface FieldWrite { readonly path: readonly string[]; readonly value: Uint8Array }

/** What the commands read: the week as drafted and as stored, its rows, and the editing they record through. */
export interface RosterState {
    readonly value: RosterValue;
    /** The week's first day. */
    readonly start: Date;
    /** The configuration: every person and activity. */
    readonly context: Context;
    /** The week as drafted, and as the records hold it. */
    readonly week: Week;
    readonly held: Week;
    /** Its duties as drafted, and as stored: each placed duty's row. */
    readonly duties: PlacedDuties;
    readonly heldDuties: PlacedDuties;
    /** The week before's duties, while the week holds none: what Copy previous week copies. */
    readonly previous: PlacedDuties | undefined;
    /** Its targets as drafted: each slot's row. */
    readonly targets: PlacedTargets;
    /** Its own row as drafted, and as stored. */
    readonly period: PlacedPeriod;
    readonly heldPeriod: PlacedPeriod;
    /** Every duty the Roster has read, each read's by key: what a new key is minted unique among. */
    readonly read: readonly ReadonlyMap<string, StoredDuty>[];
    /** Every target the Roster has read, by key. */
    readonly readTargets: ReadonlyMap<string, unknown>;
    /** The editing; `undefined` for a read-only Roster. */
    readonly editing: RosterEditing | undefined;
    /** Whether the week's reads have landed and the rail is not mid-read: a gesture waits for them. */
    readonly ready: boolean;
}

/** All mutation paths use these guarded commands, each one step of the history. */
export interface RosterCommands {
    /** Whether the week takes a gesture now: editable, its reads landed, its records' sessions writable. */
    readonly available: boolean;
    place(source: RosterSource, slot: Slot, checkOnly?: boolean): string | undefined;
    update(id: string, change: RolesChange, origin?: Origin, checkOnly?: boolean): string | undefined;
    activity(id: string, activity: option<string>, checkOnly?: boolean): string | undefined;
    sets(id: string, writes: readonly FieldWrite[], checkOnly?: boolean): string | undefined;
    field(id: string, path: readonly string[], next: unknown): string | undefined;
    row(id: string, bytes: Uint8Array): string | undefined;
    remove(id: string): void;
    restore(id: string): void;
    requirement(slot: Slot, target: Requirement): string | undefined;
    targetRow(slot: Slot, bytes: Uint8Array): string | undefined;
    accept(key: string): string | undefined;
    reject(key: string): void;
    fix(issue: Issue): string | undefined;
    copy(): void;
    publish(): void;
}

const sameBytes = equalFor(BlobType);
const sameResource: (a: Roles["resource"], b: Roles["resource"]) => boolean = equalFor(OptionType(ScheduleResourceRefType));

/**
 * The Roster's commands over the week (see the module docs).
 *
 * @param state - The week, its rows and the editing
 * @param select - Selects what a command made, keeping the panes as they are
 * @param find - Asks the app's fit who fits a find's need
 * @param publish - Publishes the week: Save, then its status
 * @returns The commands
 */
export function rosterCommands(state: RosterState, select: (selection: Selection | undefined) => void, find: (asked: RosterFind) => void,
    publish: () => void): RosterCommands {
    const { value, start, context, week, editing } = state;
    const times = rosterTimes();
    const schedule = editing?.schedule;
    const duty = value.duty.kind.key;
    const weekId = weekKey(start);
    const available = editing !== undefined && schedule !== undefined && state.ready && !value.settings.readOnly && editableStatus(state.heldPeriod.status)
        && editableStatus(week.status) && schedule.available(duty);
    const blocked = () => available ? undefined : "This week is not available to edit.";
    const validSlot = (slot: Slot) => slot.day >= 0n && slot.day < 7n && value.groups.some(g => g.key === slot.group) && value.shifts.some(s => s.key === slot.shift);
    // Every duty's key the Roster holds: read, drafted, minted by this gesture, or the record's own when it is read whole.
    const takenDuty = (minted: ReadonlySet<string>) => (key: string) => minted.has(key) || state.read.some(read => read.has(key))
        || schedule?.draftsOf(duty).has(key) === true || schedule?.held(duty, key) !== undefined;
    const takenTarget = (key: string) => state.readTargets.has(key) || schedule?.draftsOf(TARGETS).has(key) === true || schedule?.held(TARGETS, key) !== undefined;
    const record = (changes: readonly ScheduleChange[], origin: Origin, label: string) => schedule !== undefined && changes.length > 0 && schedule.record(changes, origin, label);
    const rowOf = (id: string) => state.duties.rows.get(id);
    const personDay = (person: string, day: bigint, except?: string) => [...week.assignments].find(([key, a]) =>
        key !== except && a.who.type === "person" && a.who.value === person && a.slot.day === day);
    /** A duty's roles, held to §5.5's times and to what its slot takes. */
    const validRoles = (a: Pick<Assignment, "slot" | "who">, roles: Roles): string | undefined => {
        const reach = startReach(value, a.slot, start);
        if (reach === undefined) return "Choose a configured shift.";
        if (compareDate(roles.start, reach.from) < 0 || compareDate(roles.start, reach.to) > 0) return "A duty starts within 12 hours of its shift's start.";
        if (compareDate(roles.end, roles.start) <= 0) return "A duty ends after it starts.";
        if (value.duty.roles.position && roles.position.type === "some" && !value.positions.some(p => p.key === roles.position.value)) return "Choose a configured position.";
        if (a.who.type === "request" && roles.activity.type === "some") return "Assign an activity to a named person.";
        if (roles.activity.type === "some") {
            const activity = activityOf(value, roles.activity.value);
            if (activity === undefined || (activity.group.type === "some" && activity.group.value !== a.slot.group)) return "Choose an activity for this group, or a shared duty.";
        }
        return undefined;
    };
    /** A duty moved to a slot: its times kept against the shift's start, its activity cleared off its own group. */
    const moved = (id: string, slot: Slot): { roles: Roles; bytes: Uint8Array } | string => {
        const row = rowOf(id);
        const a = week.assignments.get(id);
        if (row === undefined || a === undefined) return "This duty is no longer present.";
        const next = times.move(row.roles, start, slot, context);
        if (next.type !== "some") return "Choose a configured shift.";
        const roles = a.slot.group === slot.group ? next.value : { ...next.value, activity: none };
        const written = value.duty.write(row.bytes, roles);
        return written.type === "some" ? { roles, bytes: written.value } : "This duty cannot be moved there.";
    };
    /** A new duty on a slot, its key minted. */
    const created = (who: Who, slot: Slot, minted: Set<string>): { id: string; bytes: Uint8Array } | string => {
        const roles = times.newDuty(who, slot, start, positionFor(value, who), none, context);
        if (roles.type !== "some") return "Choose a configured shift.";
        const bytes = value.duty.create(roles.value);
        if (bytes.type !== "some") return who.type === "request" ? "This roster takes no agency requests." : "This roster takes no people.";
        const id = mintKey(takenDuty(minted));
        minted.add(id);
        return { id, bytes: bytes.value };
    };
    /** The week's own row, its dismissed suggestions the set given: `undefined` without a record to keep them in. */
    const dismissal = (dismissed: ReadonlySet<string>): ScheduleChange | undefined => {
        if (value.periods.type !== "some" || !value.periods.value.dismissible) return undefined;
        const held = state.period.bytes;
        const row = value.periods.value.dismiss(held === undefined ? none : some(held), new Set(dismissed));
        return { kind: PERIODS, id: weekId, row };
    };
    const api: RosterCommands = {
        available,
        place(source, slot, checkOnly = false) {
            const refused = blocked(); if (refused !== undefined) return refused;
            if (!validSlot(slot)) return "Choose a configured shift in this week.";
            const changes: ScheduleChange[] = [];
            const minted = new Set<string>();
            let id: string | undefined;
            let accepted: string | undefined;
            if (source.type === "assignment") {
                id = source.key;
                const held = week.assignments.get(id);
                if (held === undefined) return "This duty is no longer present.";
                if (sameSlot(held.slot, slot)) return "Already on this shift.";
                if (held.who.type === "person" && personDay(held.who.value, slot.day, id) !== undefined) return "This person is already rostered that day.";
                const next = moved(id, slot);
                if (typeof next === "string") return next;
                changes.push({ kind: duty, id, row: next.bytes });
            } else if (source.type === "agency") {
                if (!value.agencies.some(a => a.key === source.key)) return "This agency is no longer available.";
                const next = created(variant("request", source.key), slot, minted);
                if (typeof next === "string") return next;
                id = next.id;
                changes.push({ kind: duty, id, row: next.bytes, created: true });
            } else {
                const proposal = source.type === "proposal" ? availableProposals(value, week, start).find(p => p.key === source.key) : undefined;
                if (source.type === "proposal" && proposal === undefined) return "This proposal is no longer available.";
                const person = proposal?.person ?? source.key;
                if (!value.people.some(p => p.key === person)) return "This person is no longer available.";
                const existing = personDay(person, slot.day);
                if (existing !== undefined) {
                    if (sameSlot(existing[1].slot, slot)) return "Already on this shift.";
                    id = existing[0];
                    const next = moved(id, slot);
                    if (typeof next === "string") return next;
                    changes.push({ kind: duty, id, row: next.bytes });
                } else {
                    // A stored duty of theirs this draft removed from the slot comes back as it was.
                    const removed = [...state.held.assignments].find(([key, a]) => !week.assignments.has(key) && sameSlot(a.slot, slot)
                        && a.who.type === "person" && a.who.value === person);
                    const original = removed === undefined ? undefined : state.heldDuties.rows.get(removed[0]);
                    if (removed !== undefined && original !== undefined) {
                        id = removed[0];
                        changes.push({ kind: duty, id, row: original.bytes });
                    } else {
                        const next = created(variant("person", person), slot, minted);
                        if (typeof next === "string") return next;
                        id = next.id;
                        changes.push({ kind: duty, id, row: next.bytes, created: true });
                    }
                }
                accepted = proposal?.key ?? availableProposals(value, week, start).find(p => p.person === person && sameSlot(p.slot, slot))?.key;
            }
            if (checkOnly) return undefined;
            if (accepted !== undefined) {
                const dismissed = dismissal(new Set([...week.dismissed, accepted]));
                if (dismissed !== undefined) changes.push(dismissed);
            }
            if (record(changes, "drop", source.type === "assignment" ? "Move duty" : accepted !== undefined ? "Accept proposal" : "Assign to shift") && id !== undefined) {
                select({ type: "assignment", key: id });
            }
            return undefined;
        },
        update(id, change, origin = "typed", checkOnly = false) {
            const refused = blocked(); if (refused !== undefined) return refused;
            const a = week.assignments.get(id), row = rowOf(id);
            if (a === undefined || row === undefined) return "This duty is no longer present.";
            const roles: Roles = { ...row.roles, ...change };
            const invalid = validRoles(a, roles); if (invalid !== undefined) return invalid;
            const written = value.duty.write(row.bytes, roles);
            if (written.type !== "some") return "This duty cannot take that.";
            if (!checkOnly) record([{ kind: duty, id, row: written.value }], origin, "Edit duty");
            return undefined;
        },
        activity(id, activity, checkOnly = false) {
            if (week.assignments.get(id) === undefined) return "Choose a duty.";
            return api.update(id, { activity }, "drop", checkOnly);
        },
        sets(id, writes, checkOnly = false) {
            const refused = blocked(); if (refused !== undefined) return refused;
            const a = week.assignments.get(id), row = rowOf(id);
            if (a === undefined || row === undefined || a.who.type !== "person") return "Place this card on a named duty.";
            // The fields the card sets, written as the kind writes them, and the duty they leave held to its roles.
            let bytes = row.bytes;
            for (const write of writes) {
                const written = value.duty.kind.write([{ id, entry: bytes, gesture: variant("field", { path: [...write.path], value: write.value }) }])[0];
                if (written === undefined || written.type !== "some") return "This card has no duty action.";
                bytes = written.value;
            }
            const roles = value.duty.read(bytes, id);
            if (!sameResource(roles.resource, row.roles.resource)) return "A card cannot replace the duty's person.";
            const invalid = validRoles(a, roles); if (invalid !== undefined) return invalid;
            if (!checkOnly && !sameBytes(bytes, row.bytes)) record([{ kind: duty, id, row: bytes }], "drop", "Update duty");
            return undefined;
        },
        field(id, path, next) {
            const refused = blocked(); if (refused !== undefined) return refused;
            const row = rowOf(id); if (row === undefined) return "This duty is no longer present.";
            const change = fieldChange(value.duty.kind, id, path, next);
            if (change === undefined) return "This field cannot be edited.";
            record([change], "typed", "Edit duty");
            return undefined;
        },
        row(id, bytes) {
            const refused = blocked(); if (refused !== undefined) return refused;
            const a = week.assignments.get(id), row = rowOf(id);
            if (a === undefined || row === undefined) return "This duty is no longer present.";
            const roles = value.duty.read(bytes, id);
            if (!sameResource(roles.resource, row.roles.resource)) return "A duty's own form cannot replace its person.";
            const invalid = validRoles(a, roles); if (invalid !== undefined) return invalid;
            record([{ kind: duty, id, row: bytes }], "typed", "Edit duty");
            return undefined;
        },
        remove(id) {
            if (blocked() !== undefined || week.assignments.get(id) === undefined) return;
            if (record([{ kind: duty, id, remove: true }], "remove", "Remove duty")) {
                // A saved duty stays as a restorable tombstone until Save, keeping its identity so another layout reveals it.
                select(state.held.assignments.has(id) ? { type: "assignment", key: id } : undefined);
            }
        },
        restore(id) {
            if (blocked() !== undefined) return;
            const original = state.held.assignments.get(id), row = state.heldDuties.rows.get(id);
            if (original === undefined || row === undefined || week.assignments.has(id)) return;
            if (original.who.type === "person" && personDay(original.who.value, original.slot.day) !== undefined) return;
            if (record([{ kind: duty, id, row: row.bytes }], "insert", "Restore duty")) select({ type: "assignment", key: id });
        },
        requirement(slot, target) {
            const refused = blocked(); if (refused !== undefined) return refused;
            if (value.targets.type !== "some") return "This roster has no targets.";
            if (!validSlot(slot) || target.positions < 0n || [...target.hours].some(([, hours]) => !Number.isFinite(hours) || hours < 0)) return "Targets are zero or more.";
            const targets = value.targets.value;
            const hours = new Map([...target.hours].filter(([, h]) => h > 0));
            const roles = { day: dayOfSlot(start, slot), group: slot.group, shift: slot.shift, positions: target.positions, hours };
            const row = state.targets.rows.get(slot);
            if (row !== undefined) record([{ kind: TARGETS, id: row.key, row: targets.write(row.bytes, roles) }], "typed", "Edit shift targets");
            else record([{ kind: TARGETS, id: mintKey(takenTarget), row: targets.create(roles), created: true }], "typed", "Edit shift targets");
            return undefined;
        },
        targetRow(slot, bytes) {
            const refused = blocked(); if (refused !== undefined) return refused;
            if (value.targets.type !== "some") return "This roster has no targets.";
            const row = state.targets.rows.get(slot);
            if (row !== undefined) record([{ kind: TARGETS, id: row.key, row: bytes }], "typed", "Edit shift targets");
            else record([{ kind: TARGETS, id: mintKey(takenTarget), row: bytes, created: true }], "typed", "Edit shift targets");
            return undefined;
        },
        accept(key) {
            const proposal = availableProposals(value, week, start).find(p => p.key === key);
            return proposal === undefined ? "This proposal is no longer available." : api.place({ type: "proposal", key }, proposal.slot);
        },
        reject(key) {
            if (blocked() !== undefined) return;
            const change = dismissal(new Set([...week.dismissed, key]));
            if (change !== undefined && record([change], "remove", "Reject proposal")) select(undefined);
        },
        fix(issue) {
            if (issue.fix.type === "none") return undefined;
            const fix = issue.fix.value;
            if (fix.type === "find") { if (issue.slot.type === "some") find({ need: fix.value, slot: issue.slot.value }); return undefined; }
            if (fix.type === "accept") return api.accept(fix.value);
            if (fix.type === "request") return issue.slot.type === "some" ? api.place({ type: "agency", key: fix.value }, issue.slot.value) : undefined;
            if (issue.assignment.type !== "some") return undefined;
            const id = issue.assignment.value, a = week.assignments.get(id);
            if (a === undefined) return undefined;
            if (fix.type === "move") return api.place({ type: "assignment", key: id }, { ...a.slot, shift: fix.value });
            const later = startingAt(a, fix.value);
            return api.update(id, { start: later.start, end: later.end });
        },
        copy() {
            if (blocked() !== undefined || state.previous === undefined || week.assignments.size !== 0) return;
            const changes: ScheduleChange[] = [];
            const minted = new Set<string>();
            for (const [key, a] of state.previous.assignments) {
                const row = state.previous.rows.get(key);
                const own = shiftTimes(value, a.slot, start);
                if (row === undefined || own === undefined) continue;
                // At its shift's own times, every other field as it was.
                const written = value.duty.write(row.bytes, { ...row.roles, start: own.from, end: own.to });
                if (written.type !== "some") continue;
                const id = mintKey(takenDuty(minted));
                minted.add(id);
                changes.push({ kind: duty, id, row: written.value, created: true });
            }
            record(changes, "insert", "Copy previous week's roster");
        },
        publish() { if (available && value.periods.type === "some") publish(); },
    };
    return api;
}

/**
 * The week's row as Publish writes it: its status the published case, at the
 * time given (`periodPublishChange`).
 *
 * @param value - The payload: its periods
 * @param editing - The editing
 * @param start - The week's first day
 * @param stored - The week's row as the Roster read it
 * @param at - When it is published
 * @returns The change; `undefined` without periods
 */
export function publishChange(value: RosterPayload, editing: RosterEditing, start: Date, stored: Uint8Array | undefined, at: Date): ScheduleChange | undefined {
    if (value.periods.type !== "some") return undefined;
    return periodPublishChange(value.periods.value, editing.schedule, PERIODS, weekKey(start), stored, at);
}
