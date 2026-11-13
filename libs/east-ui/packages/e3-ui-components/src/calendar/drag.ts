/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

/** Calendar's adaptation of the shared drag grammar to Schedule commands. */
import { useCallback, useMemo, useRef, type MutableRefObject } from "react";
import { SortedMap, compareFor, none, some } from "@elaraai/east";
import { DragEventType } from "@elaraai/east-ui/internal";
import { dropEvent, useDragTarget, useFormatters, type CellCoord, type DragEventValue, type DragPayload, type Formatters } from "@elaraai/east-ui-components";
import { initialPlacement, type CalendarCommands, type CalendarPlacement, type CalendarSource } from "./actions.js";
import { moveSpan, resizeSpan } from "../shared/time/drag.js";
import { timeScale } from "../shared/time/scale.js";
import { lowerWord } from "../shared/schedule/words.js";
import { calendarLibraryId } from "./library.js";
import { DAY, QUARTER, dayStart, eventKey, parseEventKey, parseResourceKey, parseTimeKey, resourceKey, timeKey, type CalendarItem, type CalendarValue } from "./model.js";

/** Two drops, as East orders them: a drag's verdicts are kept by the drop each was asked of. */
const compareDrop = compareFor(DragEventType);
/** The most verdicts an adapter keeps — the places drags have rested on since what they were asked of last changed — before it starts again. */
const VERDICTS = 4096;

/** The views hand drop coordinates to this single grammar adapter. */
export interface CalendarDrag {
    surface: string;
    grab: (item: CalendarItem, instant: Date) => void;
    adjust: (instant: Date, payload: DragPayload | undefined) => Date;
    wholeDay: (day: Date, payload?: DragPayload) => Date;
    readTime: (slot: string) => Date | undefined;
    enabled: boolean;
    run: (event: DragEventValue, checkOnly: boolean) => string | undefined;
    preview: (coord: CellCoord, payload: DragPayload) => CalendarPlacement | undefined;
    /** A drag's words where it rests: why a drop there is refused, if it is, the event's name, and the instant it lands at in the locale's date and time. */
    caption: (coord: CellCoord, payload: DragPayload, allowed: boolean) => string;
    create: (start: Date, end: Date, resource: CalendarItem["resource"]) => void;
}
interface DragArgs {
    value: CalendarValue; key: string; commands: CalendarCommands | undefined; narrow: boolean;
    items: readonly CalendarItem[]; backlog: readonly CalendarItem[]; selection: readonly CalendarItem[];
    /** The Backlog a page at a time (#1424): what a card it listed is, by its id — where a drag of it finds its event. */
    served?: { served(id: string): CalendarItem | undefined } | undefined;
    /** The templates the rail shows, by their card's id: what a drop or a drawn event is made from (#1343). */
    templates: ReadonlyMap<string, CalendarSource>;
    activeTemplate: string | undefined; onError: (message: string | undefined) => void;
}
/**
 * No layer is registered in narrow or read-only mode. The same object while its surface and whether it takes a drag hold
 * (#1398, CL9; #1594), each of its answers read from the verdicts as they stand: what the views draw with it — a row that
 * draws nothing again as a drop lands on another — asks the verdicts of now, and draws again for none of their moves.
 */
export function useCalendarDrag(args: DragArgs): CalendarDrag {
    const { value, key, commands, narrow, items, backlog, served, selection, activeTemplate, onError } = args;
    const enabled = commands !== undefined && !narrow;
    const grabbed = useRef<{ id: string; offset: number } | undefined>(undefined);
    const grab = useCallback((item: CalendarItem, instant: Date) => {
        grabbed.current = { id: eventKey(item), offset: item.start.type === "some" ? instant.getTime() - item.start.value.getTime() : 0 };
    }, []);
    const sources = args.templates;
    // The locale's date and time, which the caption says where a drag lands in, as the Calendar prints every date.
    const format = useFormatters();
    const drag = useMemo(() => calendarDrag({ value, key, commands, items, backlog, served, selection, sources, activeTemplate, onError, enabled, grabbed, grab, format }),
        [value, key, commands, items, backlog, served, selection, sources, activeTemplate, onError, enabled, grab, format]);
    const live = useRef(drag);
    live.current = drag;
    const { run } = drag;
    const target = useMemo(() => {
        if (!enabled) return null;
        const libraries = value.library.map(tab => calendarLibraryId(key, tab.type === "tab" ? `tab:${tab.value.name}` : tab.type));
        return { id: key, sources: libraries, kinds: { add: true, move: true, resize: true, remove: true, trash: false },
            returns: { libraries: value.library.some(tab => tab.type === "backlog") ? [calendarLibraryId(key, "backlog")] : [],
                canDrop: (event: DragEventValue) => run(event, true) === undefined },
            onDrag: (event: DragEventValue) => { const refusal = run(event, false); onError(refusal); return refusal === undefined; },
        };
    }, [enabled, key, value.library, run, onError]);
    useDragTarget(target);
    return useMemo((): CalendarDrag => ({ surface: key, enabled, grab,
        run: (event, checkOnly) => live.current.run(event, checkOnly),
        adjust: (instant, payload) => live.current.adjust(instant, payload),
        wholeDay: (day, payload) => live.current.wholeDay(day, payload),
        readTime: slot => live.current.readTime(slot),
        preview: (coord, payload) => live.current.preview(coord, payload),
        caption: (coord, payload, allowed) => live.current.caption(coord, payload, allowed),
        create: (start, end, resource) => live.current.create(start, end, resource),
    }), [key, enabled, grab]);
}
/**
 * The drag's verdicts over the period as it stands: what a drop runs, what a hover previews and what a press grabs.
 * What they are asked of holds while the adapter does — the events and the Backlog read, the drafts, the selection, the
 * templates — so it finds an event by its key once, and asks each place a drag rests on once (#1594).
 */
function calendarDrag({ value, key, commands, items, backlog, served, selection, sources, activeTemplate, onError, enabled, grabbed, grab, format }: {
    value: CalendarValue; key: string; commands: CalendarCommands | undefined; items: readonly CalendarItem[]; backlog: readonly CalendarItem[];
    served: DragArgs["served"]; selection: readonly CalendarItem[]; sources: ReadonlyMap<string, CalendarSource>; activeTemplate: string | undefined;
    onError: (message: string | undefined) => void; enabled: boolean; grabbed: MutableRefObject<{ id: string; offset: number } | undefined>;
    grab: CalendarDrag["grab"]; format: Formatters;
}): CalendarDrag {
    // The events and the Backlog read, each by its key, the first read of a key kept: what a drag finds the event it
    // carries by, gathered at the first it asks for — never every event walked again at each place it rests on.
    let read: Map<string, CalendarItem> | undefined;
    const sourceItem = (encoded: string): CalendarItem | undefined => {
        const parsed = parseEventKey(encoded);
        if (!parsed.success) return undefined;
        if (read === undefined) {
            read = new Map();
            for (const list of [items, backlog]) for (const item of list) { const id = eventKey(item); if (!read.has(id)) read.set(id, item); }
        }
        return read.get(eventKey(parsed.value)) ?? served?.served(encoded) ?? commands?.editing.read(parsed.value.kind, parsed.value.key)?.item;
    };
    const resource = (row: string): CalendarItem["resource"] => {
        const read = parseResourceKey(row); return read.success ? some(read.value) : none;
    };
    const at = (coord: { slot: string; row: string }) => {
        const read = parseTimeKey(coord.slot); return read.success ? { start: read.value, resource: resource(coord.row) } : undefined;
    };
    // A drag's verdicts where it rests, by the drop it would deliver there, as the Roster keeps its previews: each asked
    // once however often the pointer moves within a place, and the same verdict for the cell, the caption and what is said
    // to a screen reader. New rows, drafts, a selection or a period make a new adapter, and with it new verdicts. A drop is
    // never answered from them: it is made through the commands, which check it again.
    const verdicts = new SortedMap<DragEventValue, { readonly refusal: string | undefined }>(undefined, compareDrop);
    const run = (event: DragEventValue, checkOnly: boolean): string | undefined => {
        if (!checkOnly) return decide(event, false);
        const held = verdicts.get(event);
        if (held !== undefined) return held.refusal;
        if (verdicts.size >= VERDICTS) verdicts.clear();
        const refusal = decide(event, true);
        verdicts.set(event, { refusal });
        return refusal;
    };
    const decide = (event: DragEventValue, checkOnly: boolean): string | undefined => {
        if (!enabled || commands === undefined) return "Editing is unavailable";
        if (event.type === "add") {
            const drop = event.value; const target = at(drop.into);
            if (target === undefined) return "Choose a time";
            if (drop.from.library === calendarLibraryId(key, "templates")) {
                const source = sources.get(drop.from.key); if (source === undefined) return `This ${lowerWord(value.vocabulary.template)} is no longer available`;
                const initial = initialPlacement(source, target.start);
                return commands.place(source, { ...target, end: new Date(target.start.getTime() + initial.end.getTime() - initial.start.getTime()) }, "drop", checkOnly);
            }
            if (drop.from.library === calendarLibraryId(key, "backlog")) {
                const item = sourceItem(drop.from.key); const kind = value.events.find(kind => kind.key === item?.kind);
                if (item === undefined || kind === undefined) return `This ${lowerWord(value.vocabulary.backlog)} event is no longer available`;
                return commands.place({ kind, item }, { ...target, end: new Date(target.start.getTime() + Number(item.minutes) * 60_000) }, "drop", checkOnly);
            }
            const tab = value.library.find(tab => tab.type === "tab" && calendarLibraryId(key, `tab:${tab.value.name}`) === drop.from.library);
            const item = drop.into.event.type === "some" ? sourceItem(drop.into.event.value) : undefined;
            if (tab?.type !== "tab" || tab.value.drop.type !== "some" || item?.kind !== tab.value.drop.value) return "Drop this card on a compatible event";
            const card = tab.value.cards.find(card => card.key === drop.from.key);
            if (card === undefined) return "This card is no longer available";
            if (!commands.editing.available(item.kind)) return "This event is not ready to edit";
            if (!checkOnly) commands.patch([item], card.sets);
            return undefined;
        }
        if (event.type === "remove") {
            const item = event.value.from.event.type === "some" ? sourceItem(event.value.from.event.value) : undefined;
            if (item === undefined) return "This event is no longer available";
            return commands.unschedule([item], checkOnly);
        }
        const coord = event.type === "move" ? event.value.from : event.value.event;
        const item = coord.event.type === "some" ? sourceItem(coord.event.value) : undefined;
        if (item === undefined || item.start.type !== "some" || item.end.type !== "some") return "This event is no longer available";
        const kind = value.events.find(kind => kind.key === item.kind)!;
        const scale = timeScale({ window: { min: dayStart(item.start.value), max: new Date(dayStart(item.start.value).getTime() + DAY) }, resolution: "hour" })!;
        const span = { start: item.start.value, end: item.end.value };
        if (event.type === "resize") {
            const target = at(event.value.event); if (target === undefined) return "Choose a time";
            const edge = event.value.edge.type;
            const next = resizeSpan(scale, span, edge, (target.start.getTime() - span[edge].getTime()) / QUARTER, true);
            return commands.place({ kind, item }, { ...next, resource: item.resource }, "resize", checkOnly);
        }
        const target = at(event.value.to); if (target === undefined) return "Choose a time";
        const moving = selection.some(selected => eventKey(selected) === eventKey(item)) ? selection : [item];
        const next = moveSpan(scale, span, (target.start.getTime() - item.start.value.getTime()) / QUARTER, true);
        return commands.move(moving, next.start.getTime() - span.start.getTime(), moving.length === 1 && event.value.to.row !== "" ? target.resource : undefined, checkOnly);
    };
    return { surface: key, enabled, run, grab,
        adjust: (instant, payload) => payload?.kind === "event" && grabbed.current?.id === payload.from.event
            ? new Date(instant.getTime() - grabbed.current.offset) : instant,
        readTime: slot => { const parsed = parseTimeKey(slot); return parsed.success ? parsed.value : undefined; },
        wholeDay: (day, payload) => {
            const source = payload?.kind === "item" ? sources.get(payload.from.key) : undefined;
            if (source !== undefined) return initialPlacement(source, day).start;
            const item = payload !== undefined ? sourceItem(payload.kind === "item" ? payload.from.key : payload.from.event) : undefined;
            const time = item?.start.type === "some" ? item.start.value : undefined;
            const result = new Date(day); result.setUTCHours(time?.getUTCHours() ?? 9, time?.getUTCMinutes() ?? 0, 0, 0); return result;
        },
        preview: (coord, payload) => {
            const target = at(coord); if (target === undefined) return undefined;
            if (payload.kind === "item") {
                const template = payload.from.library === calendarLibraryId(key, "templates") ? sources.get(payload.from.key) : undefined;
                const item = payload.from.library === calendarLibraryId(key, "backlog") ? sourceItem(payload.from.key) : undefined;
                const kind = value.events.find(kind => kind.key === item?.kind);
                const source = template ?? (item !== undefined && kind !== undefined ? { item, kind } : undefined);
                if (source === undefined) return undefined;
                const initial = initialPlacement(source, target.start);
                return { ...target, end: new Date(target.start.getTime() + initial.end.getTime() - initial.start.getTime()) };
            }
            const item = sourceItem(payload.from.event);
            if (item?.start.type !== "some" || item.end.type !== "some") return undefined;
            if (payload.kind === "edge") {
                const scale = timeScale({ window: { min: dayStart(item.start.value), max: new Date(dayStart(item.start.value).getTime() + DAY) }, resolution: "hour" })!;
                const span = { start: item.start.value, end: item.end.value };
                return { ...resizeSpan(scale, span, payload.edge, (target.start.getTime() - span[payload.edge].getTime()) / QUARTER, true), resource: item.resource };
            }
            return { ...target, end: new Date(target.start.getTime() + item.end.value.getTime() - item.start.value.getTime()) };
        },
        caption: (coord, payload, allowed) => {
            const at = parseTimeKey(coord.slot);
            const name = payload.label ?? (payload.kind === "item" ? payload.from.key : payload.from.event);
            const candidate = dropEvent(payload, coord, false);
            const refusal = allowed || candidate === undefined ? undefined : run(candidate, true);
            return `${refusal === undefined ? "" : `${refusal} · `}${name}${at.success ? ` · ${format.dateTime(at.value)}` : ""}`;
        },
        create(start, end, resource) {
            if (!enabled || commands === undefined) return;
            const active = activeTemplate === undefined ? undefined : sources.get(activeTemplate);
            const fits = (source: CalendarSource) => resource.type === "none" || source.kind.takes.includes(resource.value.kind);
            const source = active !== undefined && fits(active) ? active : [...sources.values()].find(fits);
            if (source !== undefined) onError(commands.place(source, { start, end, resource }, "insert"));
        },
    };
}
/** One canonical continuous cell coordinate. */
export function calendarCoord(surface: string, start: Date, resource: CalendarItem["resource"], event?: string): CellCoord {
    return { surface, row: resource.type === "some" ? resourceKey(resource.value) : "", slot: timeKey(start), ...(event === undefined ? {} : { event }) };
}
