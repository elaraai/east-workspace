/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

/** One command path for desktop gestures and explicit agenda actions. */
import { encodeBeast2For, fromEastTypeValue, none, some, variant, type StructType } from "@elaraai/east";
import type { Origin } from "@elaraai/east-ui-components";
import type { ScheduleChange, ScheduleEditing } from "../shared/schedule/editing.js";
import { durationMinutes } from "../shared/schedule/due.js";
import { QUARTER, sameResource, type CalendarItem, type CalendarKind, type CalendarRef, type CalendarTemplate, type CalendarValue } from "./model.js";

/** A placement proposed by a form, a drop or a draw gesture. */
export interface CalendarPlacement {
    start: Date;
    end: Date;
    resource: CalendarItem["resource"];
}
/** A source to create from or to schedule/move. */
export type CalendarSource = { kind: CalendarKind; template: CalendarTemplate } | { kind: CalendarKind; item: CalendarItem };
/** The editor used by views, library and inspector. */
export interface CalendarCommands {
    editing: ScheduleEditing;
    place(source: CalendarSource, placement: CalendarPlacement, origin?: Origin, checkOnly?: boolean): string | undefined;
    move(items: readonly CalendarItem[], delta: number, resource?: CalendarItem["resource"], checkOnly?: boolean): string | undefined;
    remove(items: readonly CalendarItem[]): void;
    unschedule(items: readonly CalendarItem[], checkOnly?: boolean): string | undefined;
    duplicate(items: readonly CalendarItem[]): string | undefined;
    status(items: readonly CalendarItem[], name: string): string | undefined;
    field(item: CalendarItem, path: readonly string[], value: unknown): void;
    patch(items: readonly CalendarItem[], fields: readonly { path: readonly string[]; value: Uint8Array }[]): void;
}

/** Default placement used by both the library's form and whole-day drops. */
export function initialPlacement(source: CalendarSource, day: Date): CalendarPlacement {
    const template = "template" in source ? source.template : undefined;
    const item = "item" in source ? source.item : undefined;
    const start = item?.start.type === "some" ? item.start.value : new Date(day);
    if (item?.start.type !== "some") {
        const at = template?.at.type === "some" ? template.at.value : { hour: 9n, minute: 0n };
        start.setUTCHours(Number(at.hour), Number(at.minute), 0, 0);
    }
    const minutes = template === undefined ? Number(item?.minutes ?? 60n) : durationMinutes(template.duration);
    return { start, end: item?.end.type === "some" ? item.end.value : new Date(start.getTime() + Math.max(15, minutes) * 60_000), resource: item?.resource ?? none };
}

/** Commands write through the shared Schedule seams and one EditHistory. */
export function calendarCommands(value: CalendarValue, editing: ScheduleEditing, select: (refs: CalendarRef[]) => void, scheduled: readonly CalendarItem[] = []): CalendarCommands {
    const kindOf = (item: CalendarItem) => value.events.find(kind => kind.key === item.kind);
    const validate = (source: CalendarSource, at: CalendarPlacement): string | undefined => {
        const { kind } = source;
        if (!editing.available(kind.key)) return `${kind.name} is not ready to edit`;
        if (!Number.isFinite(at.start.getTime()) || !Number.isFinite(at.end.getTime()) || at.end.getTime() - at.start.getTime() < QUARTER) return "An event must last at least 15 minutes";
        if (at.resource.type === "some") {
            const ref = at.resource.value;
            if (!kind.takes.includes(ref.kind)) return `Needs ${kind.takes.map(key => value.resources.find(resource => resource.key === key)?.name ?? key).join(" or ")}`;
            if (!value.resources.some(resource => resource.key === ref.kind && resource.rows.some(row => row.key === ref.key))) return "This resource is no longer available";
        }
        if (value.canDrop.type === "some") {
            const from = "template" in source ? variant("template", source.template.key)
                : source.item.start.type === "none" ? variant("backlog", source.item.key) : variant("event", source.item.key);
            try {
                const refusal = value.canDrop.value({ kind: kind.key, from, ...at });
                if (refusal.type === "some") return refusal.value;
            } catch { return "The placement check failed"; }
        }
        return undefined;
    };
    const checkedWrite = (kind: CalendarKind, id: string, gesture: Extract<ScheduleChange, { gesture: unknown }>["gesture"]): string | undefined => {
        const row = gesture.type === "create" ? new Uint8Array(0) : editing.read(kind.key, id)?.row;
        if (row === undefined) return "This event is still loading or has been removed";
        try { if (kind.write([{ id, entry: row, gesture }])[0]?.type !== "some") return "This event cannot use that placement"; }
        catch { return "This event cannot use that placement"; }
        return undefined;
    };
    return {
        editing,
        place(source, given, origin = "typed", checkOnly = false) {
            const at = given.resource.type === "none" && ("template" in source || source.item.start.type === "none")
                ? { ...given, resource: firstResource(value, source.kind, given, scheduled) } : given;
            const refusal = validate(source, at); if (refusal !== undefined) return refusal;
            const creating = "template" in source;
            const id = creating ? editing.mint(source.kind.key, source.template.key, new Set()) : source.item.key;
            if (id === undefined) return "This record's key type needs an application-provided new key";
            const gesture = creating ? variant("create", { template: source.template.key, ...at }) : variant("place", at);
            const refused = checkedWrite(source.kind, id, gesture); if (refused !== undefined) return refused;
            if (!checkOnly && editing.record([{ kind: source.kind.key, id, gesture }], creating ? "insert" : origin,
                `${creating ? "Create" : "Schedule"} ${creating ? source.template.name : source.item.title}`)) select([{ kind: source.kind.key, key: id }]);
            return undefined;
        },
        move(items, delta, resource, checkOnly = false) {
            const changes: ScheduleChange[] = [];
            for (const item of items) {
                const kind = kindOf(item);
                if (kind === undefined || item.start.type !== "some" || item.end.type !== "some") return "This event is not scheduled";
                const at = { start: new Date(item.start.value.getTime() + delta), end: new Date(item.end.value.getTime() + delta), resource: resource ?? item.resource };
                const refused = validate({ kind, item }, at) ?? checkedWrite(kind, item.key, variant("place", at));
                if (refused !== undefined) return refused;
                changes.push({ kind: item.kind, id: item.key, gesture: variant("place", at) });
            }
            if (!checkOnly) editing.record(changes, "move", `Move ${items.length} events`);
            return undefined;
        },
        remove(items) { if (editing.record(items.map(item => ({ kind: item.kind, id: item.key, remove: true })), "remove", `Delete ${items.length} events`)) select([]); },
        unschedule(items, checkOnly = false) {
            for (const item of items) {
                const kind = kindOf(item);
                if (kind === undefined || !kind.backlog) return "This event kind has no backlog";
                if (!editing.available(item.kind)) return `${kind.name} is not ready to edit`;
                const refused = checkedWrite(kind, item.key, variant("unplace", null));
                if (refused !== undefined) return refused;
            }
            if (!checkOnly) editing.record(items.map(item => ({ kind: item.kind, id: item.key, gesture: variant("unplace", null) })), "move", `Return ${items.length} events to backlog`);
            return undefined;
        },
        duplicate(items) {
            const changes: ScheduleChange[] = []; const refs: CalendarRef[] = []; const minted = new Set<string>();
            for (const item of items) {
                const kind = kindOf(item); const read = editing.read(item.kind, item.key);
                const id = editing.mint(item.kind, item.key, minted);
                if (kind === undefined || read === undefined || id === undefined) return "This event cannot be duplicated yet";
                if (!editing.available(kind.key)) return `${kind.name} is not ready to edit`;
                if (item.start.type === "some" && item.end.type === "some") {
                    const at = { start: item.end.value, end: new Date(2 * item.end.value.getTime() - item.start.value.getTime()), resource: item.resource };
                    const refusal = validate({ kind, item }, at);
                    if (refusal !== undefined) return refusal;
                    if (kind.write([{ id, entry: read.row, gesture: variant("place", at) }])[0]?.type !== "some") return "This copy cannot use that placement";
                }
                minted.add(id);
                changes.push({ kind: item.kind, id, row: read.row, created: true });
                if (item.start.type === "some" && item.end.type === "some") changes.push({ kind: item.kind, id, gesture: variant("place", {
                    start: item.end.value, end: new Date(2 * item.end.value.getTime() - item.start.value.getTime()), resource: item.resource,
                }) });
                if (kind.schedule.status.type === "some" && kind.status[0] !== undefined) {
                    const rowType = fromEastTypeValue(kind.editing.entryType) as StructType;
                    const field = kind.schedule.status.value;
                    changes.push({ kind: item.kind, id, gesture: variant("field", { path: [field], value: encodeBeast2For(rowType.fields[field]!)(variant(kind.status[0].case, null) as never) }) });
                }
                refs.push({ kind: item.kind, key: id });
            }
            if (editing.record(changes, "insert", `Duplicate ${items.length} events`)) select(refs);
            return undefined;
        },
        status(items, name) {
            const changes: ScheduleChange[] = [];
            for (const item of items) {
                const kind = kindOf(item);
                if (kind === undefined || kind.schedule.status.type === "none" || !kind.status.some(status => status.case === name)) return "The selection does not share that status";
                if (!editing.available(kind.key)) return `${kind.name} is not ready to edit`;
                const path = kind.schedule.status.value;
                const rowType = fromEastTypeValue(kind.editing.entryType) as StructType;
                changes.push({ kind: kind.key, id: item.key, gesture: variant("field", { path: [path], value: encodeBeast2For(rowType.fields[path]!)(variant(name, null) as never) }) });
            }
            editing.record(changes, "typed", `Set status of ${items.length} events`);
            return undefined;
        },
        field(item, path, next) {
            const kind = kindOf(item); if (kind === undefined) return;
            const spec = kind.fields.find(field => field.path.length === path.length && field.path.every((part, i) => part === path[i]));
            const rowType = fromEastTypeValue(kind.editing.entryType) as StructType;
            const type = spec?.type ?? (path.length === 1 ? rowType.fields[path[0]!] : undefined);
            if (type === undefined) return;
            editing.record([{ kind: item.kind, id: item.key, gesture: variant("field", { path: [...path], value: encodeBeast2For(type)(next as never) }) }], "typed", `Edit ${item.title}`);
        },
        patch(items, fields) {
            const changes = items.flatMap(item => fields.map(field => ({ kind: item.kind, id: item.key,
                gesture: variant("field", { path: [...field.path], value: field.value }) })));
            editing.record(changes, "drop", `Update ${items.length} events`);
        },
    };
}

/** A creation without a resource uses the first compatible free row, then the first compatible row. */
export function firstResource(value: CalendarValue, kind: CalendarKind, at: Pick<CalendarPlacement, "start" | "end">, items: readonly CalendarItem[]): CalendarItem["resource"] {
    const resources = value.resources.filter(resource => kind.takes.includes(resource.key)).flatMap(resource => resource.rows.map(row => ({ kind: resource.key, key: row.key })));
    const free = resources.find(resource => !items.some(item => item.resource.type === "some" && sameResource(resource, item.resource.value)
        && item.start.type === "some" && item.end.type === "some" && item.start.value < at.end && item.end.value > at.start));
    const selected = free ?? resources[0];
    return selected === undefined ? none : some(selected);
}
