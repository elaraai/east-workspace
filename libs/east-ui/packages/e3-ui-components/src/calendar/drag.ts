/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

/** Calendar's adaptation of the shared drag grammar to Schedule commands. */
import { useRef } from "react";
import { none, some } from "@elaraai/east";
import { dropEvent, useDragTarget, type CellCoord, type DragEventValue, type DragPayload } from "@elaraai/east-ui-components";
import { initialPlacement, type CalendarCommands, type CalendarPlacement, type CalendarSource } from "./actions.js";
import { moveSpan, resizeSpan } from "../shared/time/drag.js";
import { timeScale } from "../shared/time/scale.js";
import { calendarLibraryId, templateSources } from "./library.js";
import { DAY, QUARTER, dayStart, eventKey, parseEventKey, parseResourceKey, parseTimeKey, resourceKey, timeKey, type CalendarItem, type CalendarValue } from "./model.js";

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
    caption: (coord: CellCoord, payload: DragPayload, allowed: boolean) => string;
    create: (start: Date, end: Date, resource: CalendarItem["resource"]) => void;
}
interface DragArgs {
    value: CalendarValue; key: string; commands: CalendarCommands | undefined; narrow: boolean;
    items: readonly CalendarItem[]; backlog: readonly CalendarItem[]; selection: readonly CalendarItem[];
    activeTemplate: string | undefined; onError: (message: string | undefined) => void;
}
/** No layer is registered in narrow or read-only mode. */
export function useCalendarDrag(args: DragArgs): CalendarDrag {
    const { value, key, commands, narrow, items, backlog, selection, activeTemplate, onError } = args;
    const enabled = commands !== undefined && !narrow;
    const grabbed = useRef<{ id: string; offset: number } | undefined>(undefined);
    const sources = templateSources(value);
    const sourceItem = (encoded: string): CalendarItem | undefined => {
        const parsed = parseEventKey(encoded);
        return parsed.success ? [...items, ...backlog].find(item => item.kind === parsed.value.kind && item.key === parsed.value.key)
            ?? commands?.editing.read(parsed.value.kind, parsed.value.key)?.item : undefined;
    };
    const resource = (row: string): CalendarItem["resource"] => {
        const read = parseResourceKey(row); return read.success ? some(read.value) : none;
    };
    const at = (coord: { slot: string; row: string }) => {
        const read = parseTimeKey(coord.slot); return read.success ? { start: read.value, resource: resource(coord.row) } : undefined;
    };
    const run = (event: DragEventValue, checkOnly: boolean): string | undefined => {
        if (!enabled || commands === undefined) return "Editing is unavailable";
        if (event.type === "add") {
            const drop = event.value; const target = at(drop.into);
            if (target === undefined) return "Choose a time";
            if (drop.from.library === calendarLibraryId(key, "templates")) {
                const source = sources.get(drop.from.key); if (source === undefined) return "This template is no longer available";
                const initial = initialPlacement(source, target.start);
                return commands.place(source, { ...target, end: new Date(target.start.getTime() + initial.end.getTime() - initial.start.getTime()) }, "drop", checkOnly);
            }
            if (drop.from.library === calendarLibraryId(key, "backlog")) {
                const item = sourceItem(drop.from.key); const kind = value.events.find(kind => kind.key === item?.kind);
                if (item === undefined || kind === undefined) return "This backlog event is no longer available";
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
    const libraries = value.library.map(tab => calendarLibraryId(key, tab.type === "tab" ? `tab:${tab.value.name}` : tab.type));
    useDragTarget(enabled ? { id: key, sources: libraries, kinds: { add: true, move: true, resize: true, remove: true, trash: false },
        returns: { libraries: value.library.some(tab => tab.type === "backlog") ? [calendarLibraryId(key, "backlog")] : [],
            canDrop: event => run(event, true) === undefined },
        onDrag: event => { const refusal = run(event, false); onError(refusal); return refusal === undefined; },
    } : null);
    return { surface: key, enabled, run,
        grab: (item, instant) => { grabbed.current = { id: eventKey(item), offset: item.start.type === "some" ? instant.getTime() - item.start.value.getTime() : 0 }; },
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
            return `${refusal === undefined ? "" : `${refusal} · `}${name}${at.success ? ` · ${at.value.toISOString().slice(0, 16).replace("T", " ")} UTC` : ""}`;
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
