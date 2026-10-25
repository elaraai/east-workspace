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
 * week's status once every record reads back as saved (`publishPeriod`). A
 * pattern dropped on a person's week (#1406, D4) replaces its seven days as
 * one step, `Apply pattern`: a day the pattern leaves as it is keeps its duty,
 * a day it changes runs the pattern's shift in the person's home group at the
 * shift's own times, and an off day removes the person's duties that day.
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
    activityOf, availableProposals, compareDate, dayOfSlot, editableStatus, patternOf, patternProblem, positionFor, rosterDomain, rosterTimes, sameSlot, shiftTimes,
    startReach, startingAt, weekKey, type Assignment, type Context, type Issue, type Pattern, type Person, type PlacedDuties, type PlacedPeriod, type PlacedTargets,
    type Requirement, type Roles, type RosterPayload, type RosterValue, type Selection, type Slot, type StoredDuty, type Week, type WeekState, type Who,
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
    /** Every week of the span in view, drafts in place (#1406): what a pattern dropped on one of them applies to; the week above among them. */
    readonly weeks?: readonly WeekState[] | undefined;
    /** Every duty the Roster has read, each read's by key: what a new key is minted unique among. */
    readonly read: readonly ReadonlyMap<string, StoredDuty>[];
    /** Every target the Roster has read, by key. */
    readonly readTargets: ReadonlyMap<string, unknown>;
    /** The editing; `undefined` for a read-only Roster. */
    readonly editing: RosterEditing | undefined;
    /** Whether the week's reads have landed and the rail is not mid-read: a gesture waits for them. */
    readonly ready: boolean;
    /**
     * Whether what main shows is retained while a narrowing of it is read (#1398, CL8): readable, focusable and
     * selectable, its controls in place, and every gesture refused until it lands.
     */
    readonly retained?: boolean | undefined;
}

/** All mutation paths use these guarded commands, each one step of the history. */
export interface RosterCommands {
    /** Whether the week takes a gesture now: editable, its reads landed, its records' sessions writable. */
    readonly available: boolean;
    /** Whether a week of the span takes a gesture (#1406): the month's cells each ask of their own week. */
    readonly availableIn: (held: WeekState) => boolean;
    /** Whether any week in view takes a gesture: the week, or one of the month's — what registers drag sources and targets (P32). */
    readonly editable: boolean;
    /**
     * Why every gesture is refused while a run of the optimiser holds the week (#1409, R2) — `Elara is optimising W11`
     * — and `undefined` while none does: the week's controls stay in place, inert, never swapped for a read-only
     * week's `Off`.
     */
    readonly locked: string | undefined;
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
    /**
     * A pattern over a person's week (#1406, D4): what applying it changes — each day kept, set to a shift or taken off,
     * and the person's week as it leaves it — or why it cannot be applied, in the caption's words (P19).
     */
    pattern(person: string, start: Date, key: string): PatternPlan | string;
    /** Applies a pattern to a person's week as one step of the history, `Apply pattern` (P17); one that changes nothing applies nothing (P18). */
    applyPattern(person: string, start: Date, key: string, checkOnly?: boolean): string | undefined;
}

/** One day of a pattern applied to a person's week: left as it is, set to a shift, or taken off. */
export interface PatternDay {
    /** The day of the week, from zero. */
    readonly day: number;
    /** The shift the day runs after the pattern; `undefined` for a day off. */
    readonly shift: string | undefined;
    /** Whether the pattern leaves the day as it is, sets its shift, or takes it off. */
    readonly kind: "keep" | "set" | "off";
}

/** A pattern applied to a person's week, planned (#1406): what the drop records, and what the preview draws and checks. */
export interface PatternPlan {
    readonly pattern: Pattern;
    readonly person: Person;
    /** The week's first day. */
    readonly start: Date;
    /** Each of the seven days. */
    readonly days: readonly PatternDay[];
    /** The changes, as one step; none where the week already matches. */
    readonly changes: readonly ScheduleChange[];
    /** The person's week as the pattern leaves it, each duty by key — kept, moved, or new under a minted key: what a preview's check runs over. */
    readonly candidates: ReadonlyMap<string, Assignment>;
    /** The duties the pattern removes, by key. */
    readonly removed: readonly string[];
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
    const blocked = () => !available ? "This week is not available to edit." : state.retained === true ? "This week is still being read." : undefined;
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
    /** Whether a week of the span takes a gesture now: editable, as the week above is told, by its own status. */
    const availableIn = (held: WeekState) => editing !== undefined && schedule !== undefined && state.ready && !value.settings.readOnly
        && editableStatus(held.heldPeriod.status) && editableStatus(held.week.status) && schedule.available(duty);
    /** A week of the span by its first day: the week above, or one of the span's. */
    const weekAt = (at: Date): WeekState | undefined => compareDate(at, start) === 0
        ? { start, week, held: state.held, duties: state.duties, heldDuties: state.heldDuties, targets: state.targets, period: state.period, heldPeriod: state.heldPeriod }
        : state.weeks?.find(held => compareDate(held.start, at) === 0);
    const api: RosterCommands = {
        available,
        availableIn,
        editable: available || (state.weeks ?? []).some(held => availableIn(held)),
        locked: undefined,
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
        pattern(person, at, key) {
            const held = weekAt(at);
            const who = value.people.find(p => p.key === person);
            if (held === undefined || who === undefined) return "Drop a pattern on a person's week.";
            if (!availableIn(held)) return "This week is not available to edit.";
            if (state.retained === true) return "This week is still being read.";
            const pattern = patternOf(value, key);
            if (pattern === undefined || patternProblem(value, pattern) !== undefined) return "Choose a configured shift.";
            const domain = rosterDomain(value.duty.rowType);
            const changes: ScheduleChange[] = [];
            const candidates = new Map<string, Assignment>();
            const removed: string[] = [];
            const days: PatternDay[] = [];
            const minted = new Set<string>();
            const whoRef: Who = variant("person", person);
            // The person's duties of the week, each day's in time order.
            const theirs = [...held.week.assignments].filter(([, a]) => a.who.type === "person" && a.who.value === person)
                .sort(([, a], [, b]) => compareDate(a.start, b.start));
            for (let day = 0; day < 7; day++) {
                const current = theirs.filter(([, a]) => Number(a.slot.day) === day);
                const target = pattern.days[day]!;
                if (target.type === "none") {
                    // A day off: the person's duties that day go, restorable until Save (B56).
                    for (const [id] of current) { changes.push({ kind: duty, id, remove: true }); removed.push(id); }
                    days.push({ day, shift: undefined, kind: current.length === 0 ? "keep" : "off" });
                    continue;
                }
                const slot: Slot = { day: BigInt(day), group: who.group, shift: target.value };
                const own = shiftTimes(value, slot, at);
                if (own === undefined) return "Choose a configured shift.";
                const first = current[0];
                if (first !== undefined) {
                    const [id, a] = first;
                    // The day as the pattern has it already: the shift, in the home group, at the shift's own times.
                    if (a.slot.group === slot.group && a.slot.shift === slot.shift && compareDate(a.start, own.from) === 0 && compareDate(a.end, own.to) === 0) {
                        candidates.set(id, a);
                        days.push({ day, shift: target.value, kind: "keep" });
                    } else {
                        // Moved to the pattern's shift at the shift's own times, its position kept, its activity kept within the group and cleared across one (B49).
                        const row = held.duties.rows.get(id);
                        if (row === undefined) return "This duty is no longer present.";
                        const next = times.move(row.roles, at, slot, context);
                        if (next.type !== "some") return "Choose a configured shift.";
                        const roles: Roles = { ...next.value, start: own.from, end: own.to, activity: a.slot.group === slot.group ? next.value.activity : none };
                        const written = value.duty.write(row.bytes, roles);
                        if (written.type !== "some") return "This duty cannot be moved there.";
                        changes.push({ kind: duty, id, row: written.value });
                        candidates.set(id, { ...a, slot, start: own.from, end: own.to, hours: value.duty.read(written.value, id).hours, activity: roles.activity });
                        days.push({ day, shift: target.value, kind: "set" });
                    }
                    // A second duty that day goes: a pattern's day is one shift.
                    for (const [extra] of current.slice(1)) { changes.push({ kind: duty, id: extra, remove: true }); removed.push(extra); }
                    continue;
                }
                // A new duty on the pattern's shift, at the shift's start for its hours, in the home group, at the person's position, with no activity.
                const roles = times.newDuty(whoRef, slot, at, positionFor(value, whoRef), none, context);
                if (roles.type !== "some") return "Choose a configured shift.";
                const bytes = value.duty.create(roles.value);
                if (bytes.type !== "some") return "This roster takes no people.";
                const id = mintKey(takenDuty(minted));
                minted.add(id);
                changes.push({ kind: duty, id, row: bytes.value, created: true });
                candidates.set(id, { slot, who: whoRef, position: roles.value.position.type === "some" ? roles.value.position.value : "", activity: none,
                    start: roles.value.start, end: roles.value.end, hours: roles.value.hours, row: domain.decodeRow(bytes.value) });
                days.push({ day, shift: target.value, kind: "set" });
            }
            return { pattern, person: who, start: at, days, changes, candidates, removed };
        },
        applyPattern(person, at, key, checkOnly = false) {
            const plan = api.pattern(person, at, key);
            if (typeof plan === "string") return plan;
            if (checkOnly || plan.changes.length === 0) return undefined;
            if (record(plan.changes, "drop", "Apply pattern")) select({ type: "personWeek", key: person, start: at.getTime() });
            return undefined;
        },
    };
    // A pattern over a person's week is planned once per week state (#1406, P19): the drag layer asks the cell's veto
    // of every move the pointer makes over the row, the ghost's caption and the row's preview ask too, and the plan is
    // pure over the state — so each reads the one plan, and a drop takes it with the keys it minted. A new state is a
    // new `rosterCommands`, and so a new table.
    const plans = new Map<string, PatternPlan | string>();
    const planned = api.pattern;
    api.pattern = (person, at, key) => {
        const id = `${person}\u0000${weekKey(at)}\u0000${key}`;
        let plan = plans.get(id);
        if (plan === undefined) { plan = planned(person, at, key); plans.set(id, plan); }
        return plan;
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
