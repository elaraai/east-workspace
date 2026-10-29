/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

/**
 * A Calendar target's preview (`Decision Queue Spec.md` D7, D8, P4, P13–P25):
 * the days a change lands on as lanes, a lane a day over the same hours
 * around what it touches, each lane's head the day and its overlaps before →
 * after as the Calendar counts them — every kind that warns paired on one
 * resource (`scheduleOverlaps`). Each event the change touches is its kind's
 * own item, made from its row as it stands and as the change leaves it
 * (`event`, given the row); each day's other events on the resources the
 * change touches are read through every kind's `items` over that day's hours —
 * tracked, so a read landing draws them, each kind counted first and read only
 * within the builders' cap — the queue's drafts of the target's record in
 * place. Where the change moves an event onto another resource, the sentence
 * names the resource beside the day, as the Calendar names it. What it draws
 * is {@link lanesPreview}'s. Past two days it draws the Calendar's map (P5):
 * every resource of the kinds the change's events are on, under its kind's
 * name — of the kind read a window at a time, those the change touches.
 *
 * @packageDocumentation
 */

import { useCallback } from "react";
import { StringType, equalFor, none, printFor, some } from "@elaraai/east";
import { ScheduleResourceRefType } from "@elaraai/e3-ui/internal";
import { useTrackedEvaluation } from "@elaraai/east-ui-components";
import { scheduleWithinCap } from "../../shared/schedule/cells.js";
import { EMPTY_SCHEDULE_DRAFTS } from "../../shared/schedule/editing.js";
import type { ScheduleItemValue } from "../../shared/schedule/overlaps.js";
import { kindPlural } from "../../shared/schedule/words.js";
import { appliedRows, standingRow, type DecisionTarget } from "../editing.js";
import { PreviewFailed, PreviewFrame, PreviewPending, guessedOf, leftBy, sharedOf, type PreviewProps } from "./frame.js";
import { LanesCrop, LanesMap, dayText, lanesSentence, mapSentence, type PreviewMap } from "./lanes.js";
import { UNASSIGNED, laneDay, laneDayKey, laneDayWindow, laneEvent, lanesPreview, type LaneEvent, type LanesModel } from "./lanes-model.js";
import { CROP_LANES, lanesMap, type MapResource } from "./map-model.js";

/** A Calendar target's kind, decoded. */
type CalendarKind = Extract<DecisionTarget["kind"], { type: "calendar" }>["value"];
/** The resource an event is on. */
type ResourceRef = Extract<ScheduleItemValue["resource"], { type: "some" }>["value"];

/** What the preview's read gives: the lanes — and past two, the map — a read in flight, or nothing it touches with a time. */
type CalendarRead = { readonly state: "ready"; readonly model: LanesModel; readonly map: PreviewMap | undefined } | { readonly state: "pending" } | { readonly state: "empty" };

/** How many lanes the placeholder draws while the rows are read. */
const PENDING_LANES = 2;
const PENDING: CalendarRead = { state: "pending" };
const EMPTY: CalendarRead = { state: "empty" };
/** The range an event read from its own row is read over: given its row, the kind reads no window. */
const EPOCH = new Date(0);
const stringEqual = equalFor(StringType);
const printResource = printFor(ScheduleResourceRefType);
const NOT_LOCKED = (): boolean => false;

/**
 * A resource's name, as the Calendar names it: its kind's row's label — a paged kind's read by its key — else its key.
 *
 * @param kind - The target's Calendar kind
 * @param ref - The resource
 * @returns Its name; `undefined` while a paged kind's read of it is in flight
 */
function resourceName(kind: CalendarKind, ref: ResourceRef): string | undefined {
    if (kind.paged.type === "some" && stringEqual(kind.paged.value.kind, ref.kind)) {
        const got = kind.paged.value.byKey(ref.key);
        if (got.type !== "some") return undefined;
        return got.value.type === "some" ? got.value.value.label : ref.key;
    }
    return kind.resources.find(r => stringEqual(r.key, ref.kind))?.rows.find(r => stringEqual(r.key, ref.key))?.label ?? ref.key;
}

/** Props of {@link CalendarPreview}. */
export interface CalendarPreviewProps extends PreviewProps {
    /** The target's Calendar kind. */
    readonly kind: CalendarKind;
}

/**
 * A Calendar target's preview (see the module docs).
 *
 * @param props - The case, its target and record, the rows its change leaves and the queue's editing ({@link CalendarPreviewProps})
 * @returns The preview
 */
export function CalendarPreview({ c, view, target, kind, record, rows, changed, schedule, shared, words, styles, now }: CalendarPreviewProps) {
    const option = view.option;
    const read = useCallback((): CalendarRead => {
        if (rows === "reading" || rows === "failed") return PENDING;
        const events = kind.events.find(k => stringEqual(k.key, kind.event));
        if (events === undefined || record === undefined) return EMPTY;
        // The resources the change's events are on, printed — UNASSIGNED for none — and each day lane's first instant.
        const refs = new Map<string, ResourceRef | undefined>();
        const days = new Map<string, number>();
        // An event as a row's bytes give it: its kind's own item, made from the row, the drafts aside, on its day's lane —
        // none for no row, or a row with no time, as an event in the backlog has — or `reading` while its kind's read of the
        // row is in flight.
        const eventOf = (key: string, bytes: Uint8Array | undefined): LaneEvent | undefined | "reading" => {
            if (bytes === undefined) return undefined;
            const got = events.event(key, EMPTY_SCHEDULE_DRAFTS, EPOCH, EPOCH, some(some(bytes)));
            if (got.type !== "some") return "reading";
            const item = got.value.item;
            const e = laneEvent(item);
            if (e === undefined) return undefined;
            refs.set(e.resource, item.resource.type === "some" ? item.resource.value : undefined);
            const lane = laneDayKey(e.start);
            days.set(lane, laneDay(e.start));
            return { ...e, lane };
        };
        const before = new Map<string, LaneEvent | undefined>(), after = new Map<string, LaneEvent | undefined>();
        const bytesOf = new Map<string, Uint8Array>();
        const landed: LaneEvent[] = [];
        let marked = true;
        if (rows === "ready" && changed.length > 0) {
            for (const row of changed) {
                const left = leftBy(row);
                const was = eventOf(row.key, row.standing), is = eventOf(row.key, left);
                if (was === "reading" || is === "reading") return PENDING;
                before.set(row.key, was);
                after.set(row.key, is);
                const bytes = row.standing ?? left;
                if (bytes !== undefined) bytesOf.set(row.key, bytes);
            }
        } else {
            // Stale (P21): the events the proposal touched, as they stand, its own marks dashed. Changing nothing (P4): the
            // events the recommendation touches, as they stand, unmarked, beside the days it would land them on — where the
            // recommendation lands in this target.
            const stale = rows === "stale";
            const recommended = c.options[view.recommended];
            const theirs = !stale && recommended !== undefined && target.tags.some(tag => stringEqual(tag, recommended.change.tag));
            const o = theirs ? recommended : option;
            marked = stale;
            if (o === undefined) return EMPTY;
            for (const key of target.touched(o.change.patch)) {
                const got = standingRow(schedule, record, key);
                if (got.type !== "some") return PENDING;
                const bytes = got.value.type === "some" ? got.value.value : undefined;
                const e = eventOf(key, bytes);
                if (e === "reading") return PENDING;
                before.set(key, e);
                after.set(key, e);
                if (bytes !== undefined) bytesOf.set(key, bytes);
            }
            if (theirs) {
                const applied = appliedRows(schedule, target, record, recommended);
                if (applied.state === "reading") return PENDING;
                if (applied.state === "ready") {
                    for (const [key, bytes] of applied.rows) {
                        const e = eventOf(key, bytes);
                        if (e === "reading") return PENDING;
                        if (e !== undefined) landed.push(e);
                    }
                }
            }
        }
        const window = laneDayWindow([...before.values(), ...after.values(), ...landed].filter((e): e is LaneEvent => e !== undefined));
        if (window === undefined) return EMPTY;
        // Each day's other events on the resources the change touches, every kind's, over the day's hours — the queue's
        // drafts of the target's record in place — each kind counted first and read only within the cap; past it, none is
        // drawn here. An event running into another of the days is drawn in its lane too.
        const context: LaneEvent[] = [];
        for (const [lane, day] of days) {
            const from = new Date(day + window.from.getTime()), to = new Date(day + window.to.getTime());
            for (const k of kind.events) {
                const within = scheduleWithinCap(k.count, from, to);
                if (within.type !== "some") return PENDING;
                if (!within.value) continue;
                const own = stringEqual(k.key, events.key);
                const got = k.items(from, to, own ? schedule.draftsOf(record.key) : EMPTY_SCHEDULE_DRAFTS, none);
                if (got.type !== "some") return PENDING;
                for (const item of got.value) {
                    if (own && (before.has(item.key) || after.has(item.key))) continue;
                    const e = laneEvent(item);
                    if (e !== undefined && refs.has(e.resource)) context.push({ ...e, lane });
                }
            }
        }
        // Where an event stands: its day — and, where the change moves an event onto another resource, the resource too,
        // as the Calendar names it.
        const moving = [...before].some(([key, b]) => {
            const a = after.get(key);
            return b !== undefined && a !== undefined && !stringEqual(b.resource, a.resource);
        });
        const names = new Map<string, string>();
        if (moving) {
            for (const [printed, ref] of refs) {
                if (ref === undefined) continue;
                const name = resourceName(kind, ref);
                if (name === undefined) return PENDING;
                names.set(printed, name);
            }
        }
        const { m } = words;
        const dayName = (lane: string): string => {
            const day = days.get(lane);
            return day === undefined ? lane : dayText(new Date(day), words);
        };
        const knockOn = option?.knockOn;
        const locked = target.locked.type === "some" ? target.locked.value : NOT_LOCKED;
        const model = lanesPreview({
            window, context, before, after, marked,
            lands: landed.map(e => e.lane),
            knockOn: key => knockOn?.has(key) === true,
            locked: key => {
                const bytes = bytesOf.get(key);
                return bytes !== undefined && locked(bytes, key);
            },
            shared: key => sharedOf(shared, record.key, key),
            overlaps: slot => kind.events.find(k => stringEqual(k.key, slot))?.overlaps.type === "warn",
            pairs: "all",
            measure: "overlaps",
            nameOf: dayName,
            whereOf: e => (moving
                ? m.previewWhere({ resource: stringEqual(e.resource, UNASSIGNED) ? m.previewUnassigned() : names.get(e.resource) ?? e.resource, day: dayName(e.lane) })
                : dayName(e.lane)),
            originOf: lane => days.get(lane) ?? 0,
        });
        if (model.rows.length <= CROP_LANES) return { state: "ready", model, map: undefined };
        // The map (D7, P5): every resource of the kinds the change's events are on, in their kinds' order, under its kind's
        // name — of the kind read a window at a time, whose rows are none, those the change touches, by their names.
        const on = new Set<string>();
        for (const ref of refs.values()) if (ref !== undefined) on.add(ref.kind);
        const resources: MapResource[] = [];
        let complete = true;
        const kinds = kind.resources.filter(r => on.has(r.key));
        for (const r of kinds) {
            if (kind.paged.type === "some" && stringEqual(kind.paged.value.kind, r.key)) {
                complete = false;
                for (const [printed, ref] of refs) {
                    if (ref === undefined || !stringEqual(ref.kind, r.key)) continue;
                    const name = resourceName(kind, ref);
                    if (name === undefined) return PENDING;
                    resources.push({ key: printed, name, group: r.name });
                }
            } else {
                for (const row of r.rows) resources.push({ key: printResource({ kind: r.key, key: row.key }), name: row.label, group: r.name });
            }
        }
        const lower = (name: string) => name.toLocaleLowerCase(words.locale);
        return {
            state: "ready", model,
            map: {
                model: lanesMap(model, resources, complete),
                nouns: {
                    event: lower(events.name), events: kindPlural(lower(events.name)),
                    resources: kinds.length === 1 ? kindPlural(lower(kinds[0]!.name)) : m.previewResources(),
                },
            },
        };
    }, [rows, changed, option, c.options, view.recommended, record, target, schedule, kind, shared, words]);
    const { result } = useTrackedEvaluation(read);
    const stale = rows === "stale";
    if (rows === "failed" || !result.ok) {
        if (!result.ok) console.error(`[DecisionQueue] case ${c.key}'s preview could not read its events:`, result.error);
        return <PreviewFailed kind="calendar" layout="lanes" words={words} styles={styles} />;
    }
    const got = result.value;
    if (got.state === "pending") return <PreviewPending kind="calendar" layout="lanes" rows={PENDING_LANES} words={words} styles={styles} />;
    if (got.state === "empty") return <PreviewFrame kind="calendar" layout="lanes" label={option?.detail ?? ""} stale={stale} styles={styles} />;
    const guessed = guessedOf(option?.guesses, changed);
    // A map's sentence counts what changes; with nothing marked, it names the days the recommendation lands on (P4), and stale
    // what the change touches (P21), as a crop's does.
    if (got.map !== undefined) {
        const label = stale || got.model.clauses.length === 0 ? lanesSentence(got.model, guessed, stale, words) : mapSentence(got.map, guessed, words);
        return <LanesMap kind="calendar" map={got.map} label={label} stale={stale} words={words} styles={styles} />;
    }
    return <LanesCrop kind="calendar" model={got.model} label={lanesSentence(got.model, guessed, stale, words)} stale={stale} now={now} words={words} styles={styles} />;
}
