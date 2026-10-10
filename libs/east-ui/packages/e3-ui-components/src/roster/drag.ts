/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */
import { SortedMap, none, some, variant } from "@elaraai/east";
import { dropEvent, useDragTarget, type CellCoord, type DragEventValue, type DragPayload } from "@elaraai/east-ui-components";
import { rosterLibraryId } from "./library.js";
import { readRosterSource } from "./identity.js";
import { assignmentFor, compareString, parseSlot, rosterContext, rosterDomain, sameSlot, slotKey, type Assignment, type RosterValue, type Slot } from "./model.js";
import type { RosterCommands, RosterSource } from "./actions.js";

export function rosterCoord(surface: string, slot: Slot, event?: string): CellCoord {
    return { surface, row: slot.group, slot: slotKey(slot), ...(event === undefined ? {} : { event }) };
}
/** One adapter from the shared drag grammar to the same commands as explicit actions. */
export function useRosterDrag({ value, commands, storageKey, narrow, start, onError }: {
    value: RosterValue; commands: RosterCommands; storageKey: string; narrow: boolean; start: Date; onError: (error: string | undefined) => void;
}) {
    const enabled = !narrow && commands.editing.available && commands.editing.week.status.type === "draft";
    const run = (event: DragEventValue, checkOnly: boolean): string | undefined => {
        if (!enabled) return "This week is not available to edit.";
        if (event.type === "resize" || event.type === "remove") return "Move an assignment onto a shift.";
        const into = event.type === "add" ? event.value.into : event.value.to;
        const parsed = parseSlot(into.slot); if (!parsed.success) return "Choose a configured shift.";
        if (event.type === "move") return event.value.from.event.type === "some"
            ? commands.place({ type: "assignment", key: event.value.from.event.value }, parsed.value, checkOnly) : "Choose an assignment.";
        const from = event.value.from;
        if (from.library === rosterLibraryId(storageKey, "people")) {
            const source = readRosterSource(from.key);
            return source.success ? commands.place({ type: source.value.type, key: source.value.value }, parsed.value, checkOnly) : "This person is no longer available.";
        }
        if (into.event.type !== "some") return "Drop this card onto a named assignment.";
        if (from.library === rosterLibraryId(storageKey, "activities")) return commands.activity(into.event.value, some(from.key), checkOnly);
        const tab = value.library.find(tab => tab.type === "tab" && rosterLibraryId(storageKey, `tab:${tab.value.name}`) === from.library);
        const card = tab?.type === "tab" ? tab.value.cards.find(card => card.key === from.key) : undefined;
        return card?.patch.type === "some" ? commands.patch(into.event.value, card.patch.value, checkOnly) : "This card has no assignment action.";
    };
    useDragTarget(enabled ? { id: storageKey, sources: value.library.map(tab => rosterLibraryId(storageKey, tab.type === "tab" ? `tab:${tab.value.name}` : tab.type)),
        kinds: { add: true, move: true, resize: false, remove: false, trash: false },
        onDrag: event => { const error = run(event, false); onError(error); return error === undefined; },
    } : null);
    type Preview = { label: string; tone: "info" | "warning" | "danger" };
    // This render's week/configuration is immutable. Cache discrete destinations
    // for this drag; caption and landing share the result, including its identity.
    // Any new data/commands render starts a fresh cache. Ended payloads can be GC'd.
    const previews = new WeakMap<DragPayload, Map<string, Map<string | undefined, { allowed: boolean; result: Preview }>>>();
    const context = rosterContext(value);
    const describe = (coord: CellCoord, payload: DragPayload, allowed: boolean): Preview => {
        const event = dropEvent(payload, coord, false);
        const refusal = event === undefined ? "Choose a shift." : run(event, true);
        if (!allowed || refusal !== undefined) return { label: refusal ?? "This placement is unavailable.", tone: "danger" };
        const parsed = parseSlot(coord.slot); if (!parsed.success) return { label: "Choose a shift.", tone: "danger" };
        const label = payload.label ?? "Assignment";
        const week = commands.editing.week;
        let source: RosterSource | undefined;
        if (payload.kind === "event") source = { type: "assignment", key: payload.from.event };
        else if (payload.kind === "item" && payload.from.library === rosterLibraryId(storageKey, "people")) {
            const from = readRosterSource(payload.from.key); if (from.success) source = { type: from.value.type, key: from.value.value };
        }
        let id: string | undefined;
        let candidate: Assignment | undefined;
        if (source?.type === "assignment") {
            id = source.key; const a = week.assignments.get(id); if (a !== undefined) candidate = { ...a, slot: parsed.value, activity: a.slot.group === parsed.value.group ? a.activity : none };
        } else if (source?.type === "person") {
            const person = source.key;
            const previous = [...week.assignments].find(([, a]) => a.who.type === "person" && a.who.value === person && a.slot.day === parsed.value.day);
            id = previous?.[0] ?? ""; while (previous === undefined && week.assignments.has(id)) id += "_";
            candidate = previous === undefined ? assignmentFor(value, parsed.value, variant("person", person)) : { ...previous[1], slot: parsed.value, activity: previous[1].slot.group === parsed.value.group ? previous[1].activity : none };
        } else if (payload.kind === "item" && coord.event !== undefined && payload.from.library === rosterLibraryId(storageKey, "activities")) {
            id = coord.event; const a = week.assignments.get(id); if (a !== undefined) candidate = { ...a, activity: some(payload.from.key) };
        }
        // Reuse the same pure check with all data that can affect THIS assignment:
        // its person's whole week (rest/double booking) and the complete target
        // shift (trainer/skills). Other slots cannot change its assignment issues.
        // Share immutable rows/targets; never serialize an entire week on hover.
        const assignment = candidate;
        const assignments = assignment === undefined ? undefined : new SortedMap([...week.assignments].filter(([key, a]) => key !== id && (
            sameSlot(a.slot, assignment.slot) || a.who.type === "person" && assignment.who.type === "person" && a.who.value === assignment.who.value
        )), compareString);
        if (id !== undefined && assignment !== undefined) assignments!.set(id, assignment);
        const warning = assignments === undefined ? undefined : rosterDomain().check({ ...week, assignments }, context).find(issue => issue.kind.type === "breach" && issue.assignment.type === "some" && issue.assignment.value === id);
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
        // Activity/custom cards, however, depend on the named target assignment.
        const event = payload.kind === "item" && payload.from.library !== rosterLibraryId(storageKey, "people") ? coord.event : undefined;
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
