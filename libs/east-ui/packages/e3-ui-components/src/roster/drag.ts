/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

/**
 * The Roster's drags on the shared drag grammar (#608, #1369): a person or an
 * agency card onto a shift, a duty along its row or between shifts, an
 * activity or an app's card onto a named duty — and a week pattern onto a
 * person's week (#1406, §11): its row in Week, its cell in Month, a `CellRef`
 * whose `row` is the person's key and whose `slot` the East-printed `{ person,
 * start }`. Every drop runs the same commands as the explicit actions; a hover
 * previews what the drop would do, and the ghost's caption says it (B53) —
 * for a pattern, `Early · Mon–Fri → A. Alder · 6 h rest`, `Already matches
 * Early · Mon–Fri`, or why it is refused.
 *
 * @packageDocumentation
 */
import { useMemo } from "react";
import { DateTimeType, SortedMap, StringType, StructType, none, parseFor, printFor, some, variant } from "@elaraai/east";
import { dropEvent, useDragTarget, type CellCoord, type DragEventValue, type DragPayload } from "@elaraai/east-ui-components";
import { rosterLibraryId } from "./library.js";
import { readRosterSource } from "./identity.js";
import {
    compareDate, compareString, parseSlot, positionFor, rosterDomain, rosterTimes, sameSlot, slotKey, type Assignment, type Context, type PlacedDuties,
    type RosterValue, type Slot, type Week, type WeekState,
} from "./model.js";
import type { RosterCommands, RosterSource } from "./actions.js";

/** A person's week, as a drop names it (#1406, §11): the person's key and the week's first day. */
export const PersonWeekRefType = StructType({ person: StringType, start: DateTimeType });
const printPersonWeek = printFor(PersonWeekRefType);
const parsePersonWeek = parseFor(PersonWeekRefType);

export function rosterCoord(surface: string, slot: Slot, event?: string): CellCoord {
    return { surface, row: slot.group, slot: slotKey(slot), ...(event === undefined ? {} : { event }) };
}
/**
 * A person-week drop target's coordinate (#1406, §11): `row` the person's key, `slot` the East-printed `{ person, start }`.
 *
 * @param surface - The Roster's surface
 * @param person - The person's key
 * @param start - The week's first day
 * @returns The coordinate
 */
export function rosterPersonWeekCoord(surface: string, person: string, start: Date): CellCoord {
    return { surface, row: person, slot: printPersonWeek({ person, start }) };
}
/**
 * A person's week, read from a drop's slot.
 *
 * @param slot - The slot's text
 * @returns The person and the week's first day; `undefined` for a slot naming a shift
 */
export function readPersonWeek(slot: string): { person: string; start: Date } | undefined {
    const read = parsePersonWeek(slot);
    return read.success ? read.value : undefined;
}
/** Whether a drag's payload is a card of the Patterns tab. */
export function isPatternCard(payload: DragPayload, storageKey: string): boolean {
    return payload.kind === "item" && payload.from.library === rosterLibraryId(storageKey, "patterns");
}
/**
 * One adapter from the shared drag grammar to the same commands as explicit actions. It is the same object while the
 * week, its commands and the configuration hold (#1398, CL9): what the grid draws with it draws again only as they
 * change.
 */
export function useRosterDrag({ value, commands, week, duties, weeks, context, storageKey, narrow, start, onError }: {
    value: RosterValue; commands: RosterCommands; week: Week; duties: PlacedDuties; weeks: readonly WeekState[]; context: Context; storageKey: string;
    narrow: boolean; start: Date; onError: (error: string | undefined) => void;
}) {
    // Drags register on a wide main while a week in view takes a gesture: the week, or any week of the month (#1406, P32).
    const enabled = !narrow && commands.editable;
    const drag = useMemo(() => rosterDrag({ value, commands, week, duties, weeks, context, storageKey, start, enabled }), [value, commands, week, duties, weeks, context, storageKey, start, enabled]);
    const { run } = drag;
    const target = useMemo(() => enabled ? { id: storageKey, sources: value.library.map(tab => rosterLibraryId(storageKey, tab.type === "tab" ? `tab:${tab.value.name}` : tab.type)),
        kinds: { add: true, move: true, resize: false, remove: false, trash: false },
        onDrag: (event: DragEventValue) => { const error = run(event, false); onError(error); return error === undefined; },
    } : null, [enabled, storageKey, value.library, run, onError]);
    useDragTarget(target);
    return drag;
}
/** The drag's verdicts over one week as it stands: what a drop runs, and what a hover over a destination previews. */
function rosterDrag({ value, commands, week, duties, weeks, context, storageKey, start, enabled }: {
    value: RosterValue; commands: RosterCommands; week: Week; duties: PlacedDuties; weeks: readonly WeekState[]; context: Context; storageKey: string; start: Date; enabled: boolean;
}) {
    const patterns = rosterLibraryId(storageKey, "patterns");
    const run = (event: DragEventValue, checkOnly: boolean): string | undefined => {
        if (!enabled) return "This week is not available to edit.";
        if (event.type === "resize" || event.type === "remove") return "Move a duty onto a shift.";
        const into = event.type === "add" ? event.value.into : event.value.to;
        // A pattern lands on a person's week, and nothing else does (#1406, §11).
        const personWeek = readPersonWeek(into.slot);
        if (event.type === "add" && event.value.from.library === patterns) {
            if (personWeek === undefined) return "Drop a pattern on a person's week.";
            return commands.applyPattern(personWeek.person, personWeek.start, event.value.from.key, checkOnly);
        }
        if (personWeek !== undefined) return event.type === "move" ? "A duty moves along its own row." : "Drop this card onto a day.";
        const parsed = parseSlot(into.slot); if (!parsed.success) return "Choose a configured shift.";
        if (event.type === "move") return event.value.from.event.type === "some"
            ? commands.place({ type: "assignment", key: event.value.from.event.value }, parsed.value, checkOnly) : "Choose a duty.";
        const from = event.value.from;
        if (from.library === rosterLibraryId(storageKey, "people")) {
            const source = readRosterSource(from.key);
            return source.success ? commands.place({ type: source.value.type, key: source.value.value }, parsed.value, checkOnly) : "This person is no longer available.";
        }
        if (into.event.type !== "some") return "Drop this card onto a named duty.";
        if (from.library === rosterLibraryId(storageKey, "activities")) return commands.activity(into.event.value, some(from.key), checkOnly);
        const tab = value.library.find(tab => tab.type === "tab" && rosterLibraryId(storageKey, `tab:${tab.value.name}`) === from.library);
        const card = tab?.type === "tab" && tab.value.drop.type === "some" ? tab.value.cards.find(card => card.key === from.key) : undefined;
        return card !== undefined && card.sets.length > 0 ? commands.sets(into.event.value, card.sets, checkOnly) : "This card has no duty action.";
    };
    type Preview = { label: string; tone: "info" | "warning" | "danger" };
    // This week/configuration is immutable. Cache discrete destinations
    // for this drag; caption and landing share the result, including its identity.
    // New data or commands start a fresh cache. Ended payloads can be GC'd.
    const previews = new WeakMap<DragPayload, Map<string, Map<string | undefined, { allowed: boolean; result: Preview }>>>();
    const domain = rosterDomain(value.duty.rowType);
    const times = rosterTimes();
    /** A duty of the week moved to a slot, as a move would leave it: its times kept against the shift's, its activity cleared off its own group. */
    const movedTo = (id: string, slot: Slot): Assignment | undefined => {
        const a = week.assignments.get(id), row = duties.rows.get(id);
        if (a === undefined || row === undefined) return undefined;
        const roles = times.move(row.roles, start, slot, context);
        if (roles.type !== "some") return undefined;
        return { ...a, slot, start: roles.value.start, end: roles.value.end, hours: roles.value.hours, activity: a.slot.group === slot.group ? a.activity : none };
    };
    /** A new duty of a person on a slot, as a placement would make it. */
    const newFor = (person: string, slot: Slot): Assignment | undefined => {
        const who = variant("person", person);
        const roles = times.newDuty(who, slot, start, positionFor(value, who), none, context);
        if (roles.type !== "some") return undefined;
        const bytes = value.duty.create(roles.value);
        if (bytes.type !== "some") return undefined;
        return { slot, who, position: roles.value.position.type === "some" ? roles.value.position.value : "", activity: none,
            start: roles.value.start, end: roles.value.end, hours: roles.value.hours, row: domain.decodeRow(bytes.value) };
    };
    /**
     * A pattern's caption over a person's week (#1406, P18, P19): why it is refused, that the week already matches it,
     * or the pattern, the person and the first warning the week as it leaves it raises.
     */
    const describePattern = (payload: Extract<DragPayload, { kind: "item" }>, coord: CellCoord): Preview => {
        const personWeek = readPersonWeek(coord.slot);
        if (personWeek === undefined) return { label: "Drop a pattern on a person's week.", tone: "danger" };
        const plan = commands.pattern(personWeek.person, personWeek.start, payload.from.key);
        if (typeof plan === "string") return { label: plan, tone: "danger" };
        if (plan.changes.length === 0) return { label: `Already matches ${plan.pattern.label}`, tone: "info" };
        // The person's week as the pattern leaves it, among the week's other duties: a breach naming one of its duties warns.
        const held = compareDate(personWeek.start, start) === 0 ? week : weeks.find(w => compareDate(w.start, personWeek.start) === 0)?.week;
        let warning: string | undefined;
        if (held !== undefined) {
            const assignments = new SortedMap([...held.assignments].filter(([key, a]) => !(a.who.type === "person" && a.who.value === personWeek.person) && !plan.removed.includes(key)), compareString);
            for (const [key, a] of plan.candidates) assignments.set(key, a);
            warning = domain.check({ ...held, assignments }, context).find(issue => issue.kind.type === "breach" && issue.assignment.type === "some" && plan.candidates.has(issue.assignment.value))?.title;
        }
        return { label: `${plan.pattern.label} → ${plan.person.name}${warning === undefined ? "" : ` · ${warning}`}`, tone: warning === undefined ? "info" : "warning" };
    };
    const describe = (coord: CellCoord, payload: DragPayload, allowed: boolean): Preview => {
        if (payload.kind === "item" && isPatternCard(payload, storageKey)) return describePattern(payload, coord);
        const event = dropEvent(payload, coord, false);
        const refusal = event === undefined ? "Choose a shift." : run(event, true);
        if (!allowed || refusal !== undefined) return { label: refusal ?? "This placement is unavailable.", tone: "danger" };
        const parsed = parseSlot(coord.slot); if (!parsed.success) return { label: "Choose a shift.", tone: "danger" };
        const label = payload.label ?? "Duty";
        let source: RosterSource | undefined;
        if (payload.kind === "event") source = { type: "assignment", key: payload.from.event };
        else if (payload.kind === "item" && payload.from.library === rosterLibraryId(storageKey, "people")) {
            const from = readRosterSource(payload.from.key); if (from.success) source = { type: from.value.type, key: from.value.value };
        }
        let id: string | undefined;
        let candidate: Assignment | undefined;
        if (source?.type === "assignment") {
            id = source.key; candidate = movedTo(id, parsed.value);
        } else if (source?.type === "person") {
            const person = source.key;
            const previous = [...week.assignments].find(([, a]) => a.who.type === "person" && a.who.value === person && a.slot.day === parsed.value.day);
            id = previous?.[0] ?? ""; while (previous === undefined && week.assignments.has(id)) id += "_";
            candidate = previous === undefined ? newFor(person, parsed.value) : movedTo(previous[0], parsed.value);
        } else if (payload.kind === "item" && coord.event !== undefined && payload.from.library === rosterLibraryId(storageKey, "activities")) {
            id = coord.event; const a = week.assignments.get(id); if (a !== undefined) candidate = { ...a, activity: some(payload.from.key) };
        }
        // Reuse the same pure check with all data that can affect THIS duty:
        // its person's whole week (rest/double booking) and the complete target
        // shift (trainer/skills). Other slots cannot change its duty's issues.
        // Share immutable rows/targets; never serialize an entire week on hover.
        const assignment = candidate;
        const assignments = assignment === undefined ? undefined : new SortedMap([...week.assignments].filter(([key, a]) => key !== id && (
            sameSlot(a.slot, assignment.slot) || a.who.type === "person" && assignment.who.type === "person" && a.who.value === assignment.who.value
        )), compareString);
        if (id !== undefined && assignment !== undefined) assignments!.set(id, assignment);
        const warning = assignments === undefined ? undefined : domain.check({ ...week, assignments }, context).find(issue => issue.kind.type === "breach" && issue.assignment.type === "some" && issue.assignment.value === id);
        const group = value.groups.find(g => g.key === parsed.value.group)?.label;
        const shift = value.shifts.find(s => s.key === parsed.value.shift)?.label;
        return { label: `${label} · ${group} ${shift}${warning === undefined ? "" : ` · ${warning.title}`}`, tone: warning === undefined ? "info" : "warning" };
    };
    const preview = (coord: CellCoord, payload: DragPayload, allowed: boolean): Preview => {
        let slots = previews.get(payload);
        if (slots === undefined) { slots = new Map(); previews.set(payload, slots); }
        let entries = slots.get(coord.slot);
        if (entries === undefined) { entries = new Map(); slots.set(coord.slot, entries); }
        // Moving/placing a person onto a nested chip has the same slot outcome.
        // Activity/custom cards, however, depend on the named target duty.
        const event = payload.kind === "item" && payload.from.library !== rosterLibraryId(storageKey, "people") && payload.from.library !== patterns ? coord.event : undefined;
        const prior = entries.get(event);
        if (prior !== undefined && prior.allowed === allowed) return prior.result;
        const result = describe(coord, payload, allowed);
        entries.set(event, { allowed, result });
        return result;
    };
    const caption = (coord: CellCoord, payload: DragPayload, allowed: boolean) => preview(coord, payload, allowed).label;
    return { enabled, surface: storageKey, run, caption, preview, start };
}
export type RosterDrag = ReturnType<typeof useRosterDrag>;
