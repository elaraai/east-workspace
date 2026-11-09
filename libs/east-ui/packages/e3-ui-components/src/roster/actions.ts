/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

/**
 * The Roster's commands (#1369, `Builder Interfaces Spec.md` §5.5, §7): one
 * command path for the grid, the library, the inspector and the narrow cards.
 * Each reads the week as drafted, works out the rows it changes — a duty
 * through the duty kind's `write`, and `create` for a new one, its times by
 * §5.5; a period's own row — the week's, or by the day the day's (#1550) —
 * through the periods' `dismiss` and `publish`; a target through `write`, and
 * `create` for a new one — and records them across the records' sessions as
 * one step. A gesture on a day whose period takes no edits — a published week,
 * or by the day a published day — is refused, the week's other days taking
 * theirs. A new duty's or target's key is minted unique among every key the
 * Roster has read and drafted (`crypto.randomUUID()`, retried): a record read
 * whole holds every key, and a key a record read a window at a time holds
 * unread is its Save's own conflict, never an overwrite
 * (`shared/schedule/records.ts`). A duty's own form or a library card that
 * changes its shift or its team carries what it leaves as it was, as a move
 * does: its times move with the shift, so it stays on its day, and its
 * activity clears across teams. A find edits nothing: it asks the app's fit
 * (#1334). Publish runs Save, then writes the status of each period it
 * publishes once every record reads back as saved (`publishPeriod`). A pattern
 * dropped on a person's week (#1406, D4) replaces its seven days as one step,
 * `Apply pattern`: a day the pattern leaves as it is keeps its duty, a day it
 * changes runs the pattern's shift in the person's home group at the shift's
 * own times, an off day removes the person's duties that day, and a day whose
 * period takes no edits keeps its duties as they are.
 *
 * @packageDocumentation
 */

import { BlobType, OptionType, StringType, equalFor, none, some, variant, type option } from "@elaraai/east";
import { ScheduleResourceRefType } from "@elaraai/e3-ui/internal";
import type { Origin } from "@elaraai/east-ui-components";
import type { ScheduleChange } from "../shared/schedule/editing.js";
import { fieldChange, madeFromValues, mintKey, periodPublishChange } from "../shared/schedule/records.js";
import { PERIODS, TARGETS, type RosterEditing } from "./editing.js";
import type { RosterFind } from "./fit.js";
import {
    activityOf, availableProposals, compareDate, dayOfSlot, patternOf, patternProblem, periodOn, placeOf, positionFor, rosterDomain, rosterTimes, sameGroup,
    samePlace, shiftTimes, slotOfPlace, startReach, startingAt, takesEdits, weekKey, type Assignment, type Context, type Issue, type Pattern, type Person, type Place,
    type PlacedDuties, type PlacedTargets, type Requirement, type Roles, type RosterPayload, type RosterValue, type Selection, type Slot,
    type StoredDuty, type Week, type WeekPeriod, type WeekState, type Who,
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
    /** Its periods (#1550): its own, or its seven days', each its row as drafted and as stored. */
    readonly periods: readonly WeekPeriod[];
    /**
     * What Publish publishes now (#1550): the week's own period, or by the day the day in view's in the Shifts layout's
     * Day, else every day of the week — each one that takes edits.
     */
    readonly publishes: readonly WeekPeriod[];
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
    /** Whether the week takes a gesture now: a period of it editable, its reads landed, its records' sessions writable. */
    readonly available: boolean;
    /**
     * Whether a day of the week takes a gesture now (#1550): the week does, and the day's period — the week's, or the
     * day's own where the Roster publishes by the day — is editable. Each day's controls ask it.
     */
    readonly availableOn: (day: bigint) => boolean;
    /** Whether Publish can publish now: the week takes a gesture, and a period it publishes takes edits (#1550). */
    readonly publishable: boolean;
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
    /**
     * Places a person, a request, a duty or a proposal at a place: a group's shift on a day, or the shift in no group,
     * where the duty kind's group takes none (#1548).
     */
    place(source: RosterSource, place: Place, checkOnly?: boolean): string | undefined;
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
const sameActivity: (a: Roles["activity"], b: Roles["activity"]) => boolean = equalFor(OptionType(StringType));
/** A new duty the app's `values` failed to make, which the console says why. */
const NO_DUTY = "A new duty could not be made.";

/**
 * The Roster's commands over the week (see the module docs).
 *
 * @param state - The week, its rows and the editing
 * @param select - Selects what a command made, keeping the panes as they are
 * @param find - Asks the app's fit who fits a find's need
 * @param publish - Publishes what the state says Publish publishes: Save, then each period's status
 * @returns The commands
 */
export function rosterCommands(state: RosterState, select: (selection: Selection | undefined) => void, find: (asked: RosterFind) => void,
    publish: () => void): RosterCommands {
    const { value, start, context, week, editing } = state;
    const times = rosterTimes();
    const schedule = editing?.schedule;
    const duty = value.duty.kind.key;
    const available = editing !== undefined && schedule !== undefined && state.ready && !value.settings.readOnly && state.periods.some(takesEdits)
        && schedule.available(duty);
    /** Whether a day of the week's period takes edits (#1550): the week's, or the day's own. */
    const open = (day: bigint) => { const period = periodOn(state.periods, day); return period !== undefined && takesEdits(period); };
    /** Why a gesture on the week — on each day given — is refused now; `undefined` while it takes one. */
    const blocked = (...days: readonly bigint[]) => !available ? "This week is not available to edit." : state.retained === true ? "This week is still being read."
        : days.some(day => !open(day)) ? "This day is not available to edit." : undefined;
    const validSlot = (slot: Slot) => slot.day >= 0n && slot.day < 7n && value.groups.some(g => g.key === slot.group) && value.shifts.some(s => s.key === slot.shift);
    /** A place of the week: a valid slot, or a configured shift on one of its days in no group, where the duty kind's group takes none (#1548). */
    const validPlace = (place: Place) => {
        const slot = slotOfPlace(place);
        return slot !== undefined ? validSlot(slot) : value.duty.roles.noGroup && place.day >= 0n && place.day < 7n && value.shifts.some(s => s.key === place.shift);
    };
    // Every duty's key the Roster holds: read, drafted, minted by this gesture, or the record's own when it is read whole.
    const takenDuty = (minted: ReadonlySet<string>) => (key: string) => minted.has(key) || state.read.some(read => read.has(key))
        || schedule?.draftsOf(duty).has(key) === true || schedule?.held(duty, key) !== undefined;
    const takenTarget = (key: string) => state.readTargets.has(key) || schedule?.draftsOf(TARGETS).has(key) === true || schedule?.held(TARGETS, key) !== undefined;
    const record = (changes: readonly ScheduleChange[], origin: Origin, label: string) => schedule !== undefined && changes.length > 0 && schedule.record(changes, origin, label);
    const rowOf = (id: string) => state.duties.rows.get(id);
    const personDay = (person: string, day: bigint, except?: string) => [...week.assignments].find(([key, a]) =>
        key !== except && a.who.type === "person" && a.who.value === person && a.place.day === day);
    /**
     * A duty's roles, held to its shift's times and to what its place takes: its start to its day by its shift, and its
     * activity to its team, each as the write drafts it.
     */
    const validRoles = (a: Pick<Assignment, "place" | "who">, roles: Roles): string | undefined => {
        const reach = startReach(value, { ...a.place, shift: roles.shift }, start);
        if (reach === undefined) return "Choose a configured shift.";
        // Its reach is half open, as its day is: a start twelve hours after its shift's is the next day's.
        if (compareDate(roles.start, reach.from) < 0 || compareDate(roles.start, reach.to) >= 0) return "A duty starts up to 12 hours before its shift's start, or less than 12 hours after it.";
        if (compareDate(roles.end, roles.start) <= 0) return "A duty ends after it starts.";
        if (value.duty.roles.position && roles.position.type === "some" && !value.positions.some(p => p.key === roles.position.value)) return "Choose a configured position.";
        if (a.who.type === "request" && roles.activity.type === "some") return "Assign an activity to a named person.";
        if (roles.activity.type === "some") {
            const activity = activityOf(value, roles.activity.value);
            // A group's activity is its own duties': a duty in no group takes a shared one alone (#1548).
            if (activity === undefined || (activity.group.type === "some" && !sameGroup(activity.group, roles.group))) return "Choose an activity for this group, or a shared duty.";
        }
        return undefined;
    };
    /** A duty moved to a place: its times kept against the shift's start, its activity cleared once it leaves its own group. */
    const moved = (id: string, place: Place): { roles: Roles; bytes: Uint8Array } | string => {
        const row = rowOf(id);
        const a = week.assignments.get(id);
        if (row === undefined || a === undefined) return "This duty is no longer present.";
        const next = times.move(row.roles, start, place, context);
        if (next.type !== "some") return "Choose a configured shift.";
        const roles = sameGroup(a.place.group, place.group) ? next.value : { ...next.value, activity: none };
        const written = value.duty.write(row.bytes, roles);
        return written.type === "some" ? { roles, bytes: written.value } : "This duty cannot be moved there.";
    };
    /**
     * A duty's row as a write of its own form or a library card's leaves it, what the write leaves as it was carried
     * with the shift or the team it changes, as a move carries it: its times, kept where they stood against the
     * shift's start, so it stays on its day; and its activity, cleared across teams, as a move clears it. Times and an
     * activity the write gives are its own, and `validRoles` holds them to the day and the team.
     */
    const carried = (a: Pick<Assignment, "place">, row: { bytes: Uint8Array; roles: Roles }, roles: Roles, bytes: Uint8Array): { roles: Roles; bytes: Uint8Array } | string => {
        let kept = roles;
        if (roles.shift !== row.roles.shift && compareDate(roles.start, row.roles.start) === 0 && compareDate(roles.end, row.roles.end) === 0) {
            const next = times.move({ ...roles, shift: row.roles.shift }, start, { ...a.place, shift: roles.shift }, context);
            if (next.type !== "some") return "Choose a configured shift.";
            kept = { ...kept, start: next.value.start, end: next.value.end };
        }
        if (!sameGroup(roles.group, row.roles.group) && roles.activity.type === "some" && sameActivity(roles.activity, row.roles.activity)) kept = { ...kept, activity: none };
        if (Object.is(kept, roles)) return { roles, bytes };
        const written = value.duty.write(bytes, kept);
        return written.type === "some" ? { roles: kept, bytes: written.value } : "This duty cannot take that.";
    };
    /** A new duty at a place, its key minted: made by no pattern, its own fields the duty kind's `values` of it (#1526). */
    const created = (who: Who, place: Place, minted: Set<string>): { id: string; bytes: Uint8Array } | string => {
        const roles = times.newDuty(who, place, start, positionFor(value, who), none, context);
        if (roles.type !== "some") return "Choose a configured shift.";
        const bytes = madeFromValues("Roster", "a new duty", () => value.duty.create({ ...roles.value, pattern: none }));
        if (bytes === undefined) return NO_DUTY;
        if (bytes.type !== "some") return who.type === "request" ? "This roster takes no agency requests." : "This roster takes no people.";
        const id = mintKey(takenDuty(minted));
        minted.add(id);
        return { id, bytes: bytes.value };
    };
    /**
     * The own row of the period holding a day — the week's, or by the day the day's (#1550) — its dismissed suggestions
     * those it holds and the one given: `undefined` without a record to keep them in, or for a new row the periods'
     * `values` fail to make.
     */
    const dismissal = (day: bigint, key: string): ScheduleChange | undefined => {
        const period = periodOn(state.periods, day);
        if (value.periods.type !== "some" || !value.periods.value.dismissible || period === undefined) return undefined;
        const periods = value.periods.value;
        const held = period.period.bytes;
        const row = madeFromValues("Roster", "the period's row",
            () => periods.dismiss(period.start, held === undefined ? none : some(held), new Set([...period.period.dismissed, key])));
        return row === undefined ? undefined : { kind: PERIODS, id: weekKey(period.start), row };
    };
    /** Whether a week of the span takes a gesture now, as the week above is told: a period of it editable. */
    const availableIn = (held: WeekState) => editing !== undefined && schedule !== undefined && state.ready && !value.settings.readOnly
        && held.periods.some(takesEdits) && schedule.available(duty);
    /** A week of the span by its first day: the week above, or one of the span's. */
    const weekAt = (at: Date): WeekState | undefined => compareDate(at, start) === 0
        ? { start, week, held: state.held, duties: state.duties, heldDuties: state.heldDuties, targets: state.targets, periods: state.periods }
        : state.weeks?.find(held => compareDate(held.start, at) === 0);
    const proposals = () => availableProposals(value, week, start, state.periods);
    const publishable = available && state.publishes.some(takesEdits);
    const api: RosterCommands = {
        available,
        availableOn: day => available && open(day),
        publishable,
        availableIn,
        editable: available || (state.weeks ?? []).some(held => availableIn(held)),
        locked: undefined,
        place(source, place, checkOnly = false) {
            const refused = blocked(); if (refused !== undefined) return refused;
            if (!validPlace(place)) return "Choose a configured shift in this week.";
            // A day whose period takes no edits takes no duty, the week's other days theirs (#1550).
            const closed = blocked(place.day); if (closed !== undefined) return closed;
            const changes: ScheduleChange[] = [];
            const minted = new Set<string>();
            let id: string | undefined;
            let accepted: { readonly key: string; readonly day: bigint } | undefined;
            if (source.type === "assignment") {
                id = source.key;
                const held = week.assignments.get(id);
                if (held === undefined) return "This duty is no longer present.";
                // Nor does a duty leave one.
                const from = blocked(held.place.day); if (from !== undefined) return from;
                if (samePlace(held.place, place)) return "Already on this shift.";
                if (held.who.type === "person" && personDay(held.who.value, place.day, id) !== undefined) return "This person is already rostered that day.";
                const next = moved(id, place);
                if (typeof next === "string") return next;
                changes.push({ kind: duty, id, row: next.bytes });
            } else if (source.type === "agency") {
                if (!value.agencies.some(a => a.key === source.key)) return "This agency is no longer available.";
                const next = created(variant("request", source.key), place, minted);
                if (typeof next === "string") return next;
                id = next.id;
                changes.push({ kind: duty, id, row: next.bytes, created: true });
            } else {
                const proposal = source.type === "proposal" ? proposals().find(p => p.key === source.key) : undefined;
                if (source.type === "proposal" && proposal === undefined) return "This proposal is no longer available.";
                const person = proposal?.person ?? source.key;
                if (!value.people.some(p => p.key === person)) return "This person is no longer available.";
                const existing = personDay(person, place.day);
                if (existing !== undefined) {
                    if (samePlace(existing[1].place, place)) return "Already on this shift.";
                    id = existing[0];
                    const next = moved(id, place);
                    if (typeof next === "string") return next;
                    changes.push({ kind: duty, id, row: next.bytes });
                } else {
                    // A stored duty of theirs this draft removed from the place comes back as it was.
                    const removed = [...state.held.assignments].find(([key, a]) => !week.assignments.has(key) && samePlace(a.place, place)
                        && a.who.type === "person" && a.who.value === person);
                    const original = removed === undefined ? undefined : state.heldDuties.rows.get(removed[0]);
                    if (removed !== undefined && original !== undefined) {
                        id = removed[0];
                        changes.push({ kind: duty, id, row: original.bytes });
                    } else {
                        const next = created(variant("person", person), place, minted);
                        if (typeof next === "string") return next;
                        id = next.id;
                        changes.push({ kind: duty, id, row: next.bytes, created: true });
                    }
                }
                const match = proposal ?? proposals().find(p => p.person === person && samePlace(placeOf(p.slot), place));
                accepted = match === undefined ? undefined : { key: match.key, day: match.slot.day };
            }
            if (checkOnly) return undefined;
            // An accepted proposal is dismissed on its own day's period — the week's, or the day's (#1550).
            if (accepted !== undefined) {
                const dismissed = dismissal(accepted.day, accepted.key);
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
            const closed = blocked(a.place.day); if (closed !== undefined) return closed;
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
            const closed = blocked(a.place.day); if (closed !== undefined) return closed;
            // The fields the card sets, written as the kind writes them, and the duty they leave held to its roles.
            let bytes = row.bytes;
            for (const write of writes) {
                const written = value.duty.kind.write([{ id, entry: bytes, gesture: variant("field", { path: [...write.path], value: write.value }) }])[0];
                if (written === undefined || written.type !== "some") return "This card has no duty action.";
                bytes = written.value;
            }
            const read = value.duty.read(bytes, id);
            if (!sameResource(read.resource, row.roles.resource)) return "A card cannot replace the duty's person.";
            const next = carried(a, row, read, bytes); if (typeof next === "string") return next;
            const invalid = validRoles(a, next.roles); if (invalid !== undefined) return invalid;
            if (!checkOnly && !sameBytes(next.bytes, row.bytes)) record([{ kind: duty, id, row: next.bytes }], "drop", "Update duty");
            return undefined;
        },
        field(id, path, next) {
            const refused = blocked(); if (refused !== undefined) return refused;
            const a = week.assignments.get(id), row = rowOf(id);
            if (a === undefined || row === undefined) return "This duty is no longer present.";
            const closed = blocked(a.place.day); if (closed !== undefined) return closed;
            const change = fieldChange(value.duty.kind, id, path, next);
            if (change === undefined) return "This field cannot be edited.";
            record([change], "typed", "Edit duty");
            return undefined;
        },
        row(id, bytes) {
            const refused = blocked(); if (refused !== undefined) return refused;
            const a = week.assignments.get(id), row = rowOf(id);
            if (a === undefined || row === undefined) return "This duty is no longer present.";
            const closed = blocked(a.place.day); if (closed !== undefined) return closed;
            const read = value.duty.read(bytes, id);
            if (!sameResource(read.resource, row.roles.resource)) return "A duty's own form cannot replace its person.";
            const next = carried(a, row, read, bytes); if (typeof next === "string") return next;
            const invalid = validRoles(a, next.roles); if (invalid !== undefined) return invalid;
            record([{ kind: duty, id, row: next.bytes }], "typed", "Edit duty");
            return undefined;
        },
        remove(id) {
            const a = week.assignments.get(id);
            if (a === undefined || blocked(a.place.day) !== undefined) return;
            if (record([{ kind: duty, id, remove: true }], "remove", "Remove duty")) {
                // A saved duty stays as a restorable tombstone until Save, keeping its identity so another layout reveals it.
                select(state.held.assignments.has(id) ? { type: "assignment", key: id } : undefined);
            }
        },
        restore(id) {
            const original = state.held.assignments.get(id), row = state.heldDuties.rows.get(id);
            if (original === undefined || row === undefined || week.assignments.has(id) || blocked(original.place.day) !== undefined) return;
            if (original.who.type === "person" && personDay(original.who.value, original.place.day) !== undefined) return;
            if (record([{ kind: duty, id, row: row.bytes }], "insert", "Restore duty")) select({ type: "assignment", key: id });
        },
        requirement(slot, target) {
            const refused = blocked(); if (refused !== undefined) return refused;
            if (value.targets.type !== "some") return "This roster has no targets.";
            if (!validSlot(slot) || target.positions < 0n || [...target.hours].some(([, hours]) => !Number.isFinite(hours) || hours < 0)) return "Targets are zero or more.";
            const closed = blocked(slot.day); if (closed !== undefined) return closed;
            const targets = value.targets.value;
            const hours = new Map([...target.hours].filter(([, h]) => h > 0));
            const roles = { day: dayOfSlot(start, slot), group: slot.group, shift: slot.shift, positions: target.positions, hours };
            const row = state.targets.rows.get(slot);
            if (row !== undefined) {
                record([{ kind: TARGETS, id: row.key, row: targets.write(row.bytes, roles) }], "typed", "Edit shift targets");
                return undefined;
            }
            const made = madeFromValues("Roster", "a new shift's targets", () => targets.create(roles));
            if (made === undefined) return "These targets could not be made.";
            record([{ kind: TARGETS, id: mintKey(takenTarget), row: made, created: true }], "typed", "Edit shift targets");
            return undefined;
        },
        targetRow(slot, bytes) {
            const refused = blocked(); if (refused !== undefined) return refused;
            if (value.targets.type !== "some") return "This roster has no targets.";
            const closed = blocked(slot.day); if (closed !== undefined) return closed;
            const row = state.targets.rows.get(slot);
            if (row !== undefined) record([{ kind: TARGETS, id: row.key, row: bytes }], "typed", "Edit shift targets");
            else record([{ kind: TARGETS, id: mintKey(takenTarget), row: bytes, created: true }], "typed", "Edit shift targets");
            return undefined;
        },
        accept(key) {
            const proposal = proposals().find(p => p.key === key);
            return proposal === undefined ? "This proposal is no longer available." : api.place({ type: "proposal", key }, placeOf(proposal.slot));
        },
        reject(key) {
            // Dismissed on its own day's period — the week's, or the day's (#1550).
            const proposal = proposals().find(p => p.key === key);
            if (proposal === undefined || blocked(proposal.slot.day) !== undefined) return;
            const change = dismissal(proposal.slot.day, key);
            if (change !== undefined && record([change], "remove", "Reject proposal")) select(undefined);
        },
        fix(issue) {
            if (issue.fix.type === "none") return undefined;
            const fix = issue.fix.value;
            if (fix.type === "find") { if (issue.slot.type === "some") find({ need: fix.value, slot: issue.slot.value }); return undefined; }
            if (fix.type === "accept") return api.accept(fix.value);
            if (fix.type === "request") return issue.slot.type === "some" ? api.place({ type: "agency", key: fix.value }, placeOf(issue.slot.value)) : undefined;
            if (issue.assignment.type !== "some") return undefined;
            const id = issue.assignment.value, a = week.assignments.get(id);
            if (a === undefined) return undefined;
            if (fix.type === "move") return api.place({ type: "assignment", key: id }, { ...a.place, shift: fix.value });
            const later = startingAt(a, fix.value);
            return api.update(id, { start: later.start, end: later.end });
        },
        copy() {
            if (blocked() !== undefined || state.previous === undefined || week.assignments.size !== 0) return;
            const changes: ScheduleChange[] = [];
            const minted = new Set<string>();
            for (const [key, a] of state.previous.assignments) {
                const row = state.previous.rows.get(key);
                const own = shiftTimes(value, a.place, start);
                // Into the days that take edits alone: a published day keeps its own (#1550).
                if (row === undefined || own === undefined || !open(a.place.day)) continue;
                // At its shift's own times, every other field as it was.
                const written = value.duty.write(row.bytes, { ...row.roles, start: own.from, end: own.to });
                if (written.type !== "some") continue;
                const id = mintKey(takenDuty(minted));
                minted.add(id);
                changes.push({ kind: duty, id, row: written.value, created: true });
            }
            record(changes, "insert", "Copy previous week's roster");
        },
        publish() { if (publishable && value.periods.type === "some") publish(); },
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
                const current = theirs.filter(([, a]) => Number(a.place.day) === day);
                const target = pattern.days[day]!;
                // A day whose period takes no edits — a published day of a week published by the day — keeps its duties as
                // they are (#1550): the pattern leaves it.
                const period = periodOn(held.periods, day);
                if (period === undefined || !takesEdits(period)) {
                    for (const [id, a] of current) candidates.set(id, a);
                    days.push({ day, shift: current[0]?.[1].place.shift, kind: "keep" });
                    continue;
                }
                if (target.type === "none") {
                    // A day off: the person's duties that day go, restorable until Save (B56).
                    for (const [id] of current) { changes.push({ kind: duty, id, remove: true }); removed.push(id); }
                    days.push({ day, shift: undefined, kind: current.length === 0 ? "keep" : "off" });
                    continue;
                }
                const place: Place = { day: BigInt(day), group: some(who.group), shift: target.value };
                const own = shiftTimes(value, place, at);
                if (own === undefined) return "Choose a configured shift.";
                const first = current[0];
                if (first !== undefined) {
                    const [id, a] = first;
                    // The day as the pattern has it already: the shift, in the home group, at the shift's own times.
                    if (samePlace(a.place, place) && compareDate(a.start, own.from) === 0 && compareDate(a.end, own.to) === 0) {
                        candidates.set(id, a);
                        days.push({ day, shift: target.value, kind: "keep" });
                    } else {
                        // Moved to the pattern's shift at the shift's own times, its position kept, its activity kept within the group and cleared across one (B49).
                        const row = held.duties.rows.get(id);
                        if (row === undefined) return "This duty is no longer present.";
                        const next = times.move(row.roles, at, place, context);
                        if (next.type !== "some") return "Choose a configured shift.";
                        const roles: Roles = { ...next.value, start: own.from, end: own.to, activity: sameGroup(a.place.group, place.group) ? next.value.activity : none };
                        const written = value.duty.write(row.bytes, roles);
                        if (written.type !== "some") return "This duty cannot be moved there.";
                        changes.push({ kind: duty, id, row: written.value });
                        candidates.set(id, { ...a, place, start: own.from, end: own.to, hours: value.duty.read(written.value, id).hours, activity: roles.activity });
                        days.push({ day, shift: target.value, kind: "set" });
                    }
                    // A second duty that day goes: a pattern's day is one shift.
                    for (const [extra] of current.slice(1)) { changes.push({ kind: duty, id: extra, remove: true }); removed.push(extra); }
                    continue;
                }
                // A new duty on the pattern's shift, at the shift's start for its hours, in the home group, at the person's position, with no
                // activity: the pattern's, its own fields the duty kind's `values` of it (#1526).
                const roles = times.newDuty(whoRef, place, at, positionFor(value, whoRef), none, context);
                if (roles.type !== "some") return "Choose a configured shift.";
                const bytes = madeFromValues("Roster", "a new duty", () => value.duty.create({ ...roles.value, pattern: some(pattern.key) }));
                if (bytes === undefined) return NO_DUTY;
                if (bytes.type !== "some") return "This roster takes no people.";
                const id = mintKey(takenDuty(minted));
                minted.add(id);
                changes.push({ kind: duty, id, row: bytes.value, created: true });
                candidates.set(id, { place, who: whoRef, position: roles.value.position.type === "some" ? roles.value.position.value : "", activity: none,
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
 * The rows Publish writes (#1550): each period given that takes edits — the
 * week's, or by the day each day's — its status the published case, at the
 * time given, over its row as the Save left it (`periodPublishChange`). A
 * period with no row is given one made from the periods' `values` only then,
 * and one they fail to make records none of the changes, so Publish never
 * publishes a part of what it was pressed for.
 *
 * @param value - The payload: its periods
 * @param periods - The periods Publish publishes
 * @param at - When they are published
 * @returns The changes, one a period; none without periods
 */
export function publishChanges(value: RosterPayload, periods: readonly WeekPeriod[], at: Date): readonly ScheduleChange[] {
    if (value.periods.type !== "some") return [];
    const kind = value.periods.value;
    return periods.filter(takesEdits).map(period => periodPublishChange(kind, PERIODS, weekKey(period.start), period.start, at, "Roster"));
}
