/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

import {
    DateTimeType, East, SortedMap, SortedSet, StringType, compareFor, decodeBeast2For, encodeBeast2For,
    equalFor, none, parseFor, printFor, variant, type TypeOf, type ValueTypeOf, type option,
} from "@elaraai/east";
import {
    RosterAssignmentType, RosterSlotType, RosterWeekType, RosterPayloadType, RosterContextType,
    RosterCoverageType, RosterIssueType, rosterCheck, rosterCoverage, rosterWeekHours,
} from "@elaraai/e3-ui/internal";
export { DAY, NARROW_WIDTH, dayStart, weekStart } from "../shared/schedule/window.js";

/** The decoded author contract. */
export type RosterPayload = ValueTypeOf<typeof RosterPayloadType>;
/**
 * The payload as the renderer reads it: with which people and activities the
 * slice shows (#1342) — `none` for every one — beside every person and
 * activity, which coverage, costs and checks read.
 */
export type RosterValue = RosterPayload & { visiblePeople: option<Set<string>>; visibleActivities: option<Set<string>> };
export type Week = ValueTypeOf<typeof RosterWeekType>;
export type Assignment = ValueTypeOf<typeof RosterAssignmentType>;
export type Slot = ValueTypeOf<typeof RosterSlotType>;
export type Context = ValueTypeOf<typeof RosterContextType>;
export type Coverage = ValueTypeOf<typeof RosterCoverageType>;
export type Issue = ValueTypeOf<typeof RosterIssueType>;
export type Person = RosterValue["people"][number];
export type Activity = RosterValue["activities"][number];
export type Proposal = RosterValue["proposals"][number];
export type RosterStyles = Record<string, Record<string, unknown>>;
/** Persisted viewer preferences; dates are epochs for local storage. */
export interface RosterView { layout: "shifts" | "people"; period: "day" | "week"; date: number }
/** The inspector's selection is separate from edits and library filtering. */
export type Selection = { type: "assignment" | "proposal" | "person"; key: string }
    | { type: "slot" | "requirement"; slot: Slot } | { type: "group"; key: string } | { type: "shift"; key: string };
export const sameSlot = equalFor(RosterSlotType);
export const slotKey = printFor(RosterSlotType);
export const parseSlot = parseFor(RosterSlotType);
export const sameAssignment: (a: Assignment, b: Assignment) => boolean = equalFor(RosterAssignmentType);
export const weekKey = printFor(DateTimeType);
export const parseWeek = parseFor(DateTimeType);
export const compareDate = compareFor(DateTimeType);
export const compareString = compareFor(StringType);
const encodeWeek = encodeBeast2For(RosterWeekType);
const decodeWeek = decodeBeast2For(RosterWeekType);
/** Copy through East's codec: struct-keyed maps and variants retain their semantics. */
export function copyWeek(week: Week): Week { return decodeWeek(encodeWeek(week)); }
/** An absent week takes forecast targets but remains unsaved until its first gesture. */
export function emptyWeek(value: RosterPayload, start: Date): Week {
    return { status: variant("draft", null), assignments: new SortedMap([], compareString),
        requirements: value.forecast.get(start) ?? new SortedMap([], compareFor(RosterSlotType)), dismissed: new SortedSet([], compareString) };
}
/** Complete staff and activities remain available to domain checks when Slice hides a row. */
export function rosterContext(value: RosterPayload): Context {
    return { people: new SortedMap(value.people.map(person => [person.key, person] as const), compareString), groups: value.groups,
        activities: value.activities, shifts: value.shifts, positions: value.positions, agencies: value.agencies, rules: value.rules, costs: value.costs };
}
/** A group's skills: the activities of that group, in the activities' order. */
export function groupSkills(value: Pick<RosterPayload, "activities">, group: string): Activity[] {
    return value.activities.filter(activity => activity.group.type === "some" && activity.group.value === group);
}
/** The duties: the activities of no group, which every group may assign. */
export function duties(value: Pick<RosterPayload, "activities">): Activity[] {
    return value.activities.filter(activity => activity.group.type === "none");
}
/**
 * What a group's assignment may hold: its skills, then the duties — those the
 * slice's `activities` source shows (#1342), and `keep` always: the
 * assignment's own, as stored and as an edit has it.
 */
export function activityChoices(value: Pick<RosterValue, "activities" | "visibleActivities">, group: string, keep: readonly string[] = []): Activity[] {
    const shown = value.visibleActivities;
    return [...groupSkills(value, group), ...duties(value)].filter(activity => shown.type === "none" || shown.value.has(activity.key) || keep.includes(activity.key));
}
/** An activity by its key. */
export function activityOf(value: RosterPayload, key: string): Activity | undefined {
    return value.activities.find(activity => activity.key === key);
}
/** Checks bound configuration without rejecting ordinary staffing warnings. */
export function configError(value: RosterPayload): string | undefined {
    if (value.groups.length === 0 || value.shifts.length === 0) return "Roster needs at least one group and one shift.";
    const unique = (rows: readonly { key: string }[]) => new Set(rows.map(row => row.key)).size === rows.length;
    for (const [name, rows] of [["people", value.people], ["groups", value.groups], ["activities", value.activities], ["shifts", value.shifts], ["positions", value.positions], ["agencies", value.agencies]] as const) {
        if (!unique(rows)) return `Roster ${name} must have unique keys.`;
    }
    if (value.shifts.some(shift => shift.hours <= 0 || !Number.isFinite(shift.hours) || shift.start.hour < 0n || shift.start.hour > 23n || shift.start.minute < 0n || shift.start.minute > 59n)) return "Roster shifts need valid start times and positive durations.";
    if (value.positions.length === 0) return "Roster needs at least one position.";
    return undefined;
}
/** Domain calculations are compiled once; the renderer does not reimplement them. */
let compiled: {
    coverage: ValueTypeOf<TypeOf<typeof rosterCoverage>>; check: ValueTypeOf<TypeOf<typeof rosterCheck>>; hours: ValueTypeOf<TypeOf<typeof rosterWeekHours>>;
} | undefined;
export function rosterDomain() {
    compiled ??= { coverage: East.compile(rosterCoverage, []), check: East.compile(rosterCheck, []), hours: East.compile(rosterWeekHours, []) };
    return compiled;
}
/** All gestures and rendered placements use one proposal-eligibility rule. */
export function availableProposals(value: RosterValue, week: Week, start: Date): Proposal[] {
    if (week.status.type === "published") return [];
    return value.proposals.filter(p => compareDate(p.week, start) === 0 && !week.dismissed.has(p.key)
        && value.people.some(person => person.key === p.person)
        && ![...week.assignments.values()].some(a => a.who.type === "person" && a.who.value === p.person && a.slot.day === p.slot.day));
}
/** Changed assignment and target counts, rather than the session's one week entry. */
export function pendingCount(held: Week | undefined, week: Week): number {
    const before = held?.assignments;
    const ids = new Set([...(before?.keys() ?? []), ...week.assignments.keys()]);
    let count = 0;
    for (const id of ids) {
        const a = before?.get(id), b = week.assignments.get(id);
        if (a === undefined || b === undefined || !sameAssignment(a, b)) count++;
    }
    const targets = new SortedMap([...(held?.requirements ?? []), ...week.requirements], compareFor(RosterSlotType));
    for (const [slot] of targets) {
        const a = held?.requirements.get(slot), b = week.requirements.get(slot);
        if (a === undefined || b === undefined || a.positions !== b.positions || a.hours.size !== b.hours.size || [...a.hours].some(([key, hours]) => b.hours.get(key) !== hours)) count++;
    }
    for (const id of week.dismissed) if (!held?.dismissed.has(id)) count++;
    return count;
}
/** Assignment times, including overnight end, use the shared time formatter at the call site. */
export function assignmentTimes(a: Assignment, value: RosterValue, start: Date): { from: Date; to: Date } | undefined {
    const shift = value.shifts.find(s => s.key === a.slot.shift); if (shift === undefined) return undefined;
    const from = new Date(start.getTime() + Number(a.slot.day) * 86_400_000 + (Number(shift.start.hour) + Number(shift.start.minute) / 60 + a.offset) * 3_600_000);
    return { from, to: new Date(from.getTime() + (shift.hours + a.overtime) * 3_600_000) };
}
/** A target absent from the record is an empty target, never synthesized staffing. */
export function requirementOf(week: Week, slot: Slot): Week["requirements"] extends Map<Slot, infer R> ? R : never {
    return week.requirements.get(slot) ?? { positions: 0n, hours: new SortedMap([], compareString) };
}
/** Default assignment fields, shared by people, agency and proposal placement. */
export function assignmentFor(value: RosterValue, slot: Slot, who: Assignment["who"]): Assignment {
    const person = who.type === "person" ? value.people.find(p => p.key === who.value) : undefined;
    const position = value.positions.some(p => p.key === person?.position) ? person!.position : (value.positions.find(p => !p.lead) ?? value.positions[0]!).key;
    return { slot, who, position, activity: none, offset: 0, overtime: 0, agreed: none };
}

/** Totals for the displayed day or week, always over complete coverage. */
export function viewTotals(value: RosterValue, coverage: ReadonlyMap<Slot, Coverage>, view: RosterView, day: number) {
    const days = view.layout === "shifts" && view.period === "day" ? 1 : 7;
    const rows = [...coverage].filter(([slot]) => days === 7 || Number(slot.day) === day).map(([, c]) => c);
    const sum = (field: (c: Coverage) => number) => rows.reduce((total, c) => total + field(c), 0);
    return { days, cost: sum(c => c.cost), filled: sum(c => Number(c.filled)), positions: sum(c => Number(c.positions)), open: sum(c => Number(c.open)),
        hours: sum(c => c.hours.rostered), needed: sum(c => c.hours.needed),
        budget: value.costs.type === "some" && value.costs.value.budget.type === "some" ? value.costs.value.budget.value * days : undefined };
}
