/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

/**
 * A Plan target's preview (`Decision Queue Spec.md` D7, D8, P4, P13–P25):
 * the resources a change lands on as the Plan's lanes, cropped to the hours
 * around what it touches. Each event the change touches is its kind's own
 * item, made from its row as it stands and as the change leaves it
 * (`planEvent`, given the row); the window's other events are read through
 * every kind's `planItems` — tracked, so a read landing draws them, each kind
 * counted first and read only within the builders' cap — the queue's drafts of
 * the target's record in place, each of the target's kind on the crop's lanes
 * asked of its `locked` by its row as it stands (P17); and a lane's name is
 * its resource's, as the Plan's gutter names it. What it draws is
 * {@link lanesPreview}'s. Past two lanes it draws the Plan's map (P5): every
 * resource of the kinds the change's events are on, under its row's group,
 * else its kind's name — of a kind read a window at a time, those the change
 * touches.
 *
 * @packageDocumentation
 */

import { useCallback } from "react";
import { StringType, equalFor, none, printFor, some } from "@elaraai/east";
import { ScheduleResourceRefType } from "@elaraai/e3-ui/internal";
import { useTrackedEvaluation } from "@elaraai/east-ui-components";
import { scheduleWithinCap } from "../../shared/schedule/cells.js";
import { EMPTY_SCHEDULE_DRAFTS } from "../../shared/schedule/editing.js";
import { kindPlural } from "../../shared/schedule/words.js";
import { appliedRows, standingRows, type DecisionTarget } from "../editing.js";
import { PreviewFailed, PreviewFrame, PreviewPending, guessedOf, leftBy, useHeld, type PreviewProps } from "./frame.js";
import { LanesCrop, LanesMap, lanesSentence, mapSentence, type PreviewMap } from "./lanes.js";
import { UNASSIGNED, laneEvent, laneWindow, lanesOf, lanesPreview, type LaneEvent, type LanesModel } from "./lanes-model.js";
import { CROP_LANES, lanesMap, type MapResource } from "./map-model.js";

/** A Plan target's kind, decoded. */
type PlanKind = Extract<DecisionTarget["kind"], { type: "plan" }>["value"];
/** One of its event kinds. */
type PlanEventKind = PlanKind["events"][number];
/** One of its resource kinds. */
type PlanResources = PlanKind["resources"][number];
/** One event, as the Plan draws it. */
type PlanItem = Extract<ReturnType<PlanEventKind["planEvent"]>, { type: "some" }>["value"]["item"];
/** The resource an event is on. */
type ResourceRef = Extract<PlanItem["resource"], { type: "some" }>["value"];

/** What the preview's read gives: the lanes — and past two, the map — a read in flight, or nothing it touches with a time. */
type PlanRead = { readonly state: "ready"; readonly model: LanesModel; readonly map: PreviewMap | undefined } | { readonly state: "pending" } | { readonly state: "empty" };

/** How many lanes the placeholder draws while the rows are read. */
const PENDING_LANES = 2;
const PENDING: PlanRead = { state: "pending" };
const EMPTY: PlanRead = { state: "empty" };
/** The range an event read from its own row is read over: given its row, the kind reads no window. */
const EPOCH = new Date(0);
const stringEqual = equalFor(StringType);
const printResource = printFor(ScheduleResourceRefType);
const NOT_LOCKED = (): boolean => false;

/**
 * A resource's name, as the Plan's gutter names it: its kind's row's label — a paged kind's read by its key — else its
 * key.
 *
 * @param resources - The target's resource kinds
 * @param ref - The resource
 * @returns Its name; `undefined` while a paged kind's read of it is in flight
 */
function resourceName(resources: readonly PlanResources[], ref: ResourceRef): string | undefined {
    const kind = resources.find(r => stringEqual(r.key, ref.kind));
    if (kind === undefined) return ref.key;
    const row = kind.rows.find(r => stringEqual(r.key, ref.key));
    if (row !== undefined) return row.label;
    if (kind.byKey.type !== "some") return ref.key;
    const got = kind.byKey.value(ref.key);
    if (got.type !== "some") return undefined;
    return got.value.type === "some" ? got.value.value.label : ref.key;
}

/** Props of {@link PlanPreview}. */
export interface PlanPreviewProps extends PreviewProps {
    /** The target's Plan kind. */
    readonly kind: PlanKind;
}

/**
 * A Plan target's preview (see the module docs).
 *
 * @param props - The case, its target and record, the rows its change leaves and the queue's editing ({@link PlanPreviewProps})
 * @returns The preview
 */
export function PlanPreview({ c, view, target, kind, record, rows, changed, schedule, words, styles, now, applied }: PlanPreviewProps) {
    const option = view.option;
    const read = useCallback((): PlanRead => {
        if (rows === "reading" || rows === "failed") return PENDING;
        const events = kind.events.find(k => stringEqual(k.key, kind.event));
        if (events === undefined || record === undefined) return EMPTY;
        const items = new Map<string, PlanItem>();
        // An event as a row's bytes give it: its kind's own item, made from the row, the drafts aside — none for no row, or
        // a row with no time, as a job in the backlog has — or `reading` while its kind's read of the row is in flight.
        const eventOf = (key: string, bytes: Uint8Array | undefined): LaneEvent | undefined | "reading" => {
            if (bytes === undefined) return undefined;
            const got = events.planEvent(key, EMPTY_SCHEDULE_DRAFTS, EPOCH, EPOCH, some(some(bytes)));
            if (got.type !== "some") return "reading";
            const item = got.value.item;
            if (item.resource.type === "some") items.set(printResource(item.resource.value), item);
            return laneEvent(item);
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
            // events the recommendation touches, as they stand, unmarked, on the lanes it would land them on — where the
            // recommendation lands in this target.
            const stale = rows === "stale";
            const recommended = c.options[view.recommended];
            const theirs = !stale && recommended !== undefined && target.tags.some(tag => stringEqual(tag, recommended.change.tag));
            const o = theirs ? recommended : option;
            marked = stale;
            if (o === undefined) return EMPTY;
            const standing = standingRows(schedule, record, target.touched(o.change.patch));
            if (standing.type !== "some") return PENDING;
            for (const [key, bytes] of standing.value) {
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
        const window = laneWindow([...before.values(), ...after.values(), ...landed].filter((e): e is LaneEvent => e !== undefined));
        if (window === undefined) return EMPTY;
        // The Locked mark (P17) on the target's kind's other events, where the crop draws them: two lanes at most — a map
        // marks none, so reads none.
        const lanes = lanesOf([...before.values(), ...after.values(), ...landed]);
        const pins = target.locked.type === "some" && lanes.length <= CROP_LANES ? target.locked.value : undefined;
        // Where in the context each of the target's kind's events on the crop's lanes stands: asked of `locked` below.
        const pinned: number[] = [];
        // The window's other events, every kind's, as they stand — the queue's drafts of the target's record in place —
        // each kind counted first and read only within the cap; past it, it draws none here.
        const context: LaneEvent[] = [];
        for (const k of kind.events) {
            const within = scheduleWithinCap(k.count, window.from, window.to);
            if (within.type !== "some") return PENDING;
            if (!within.value) continue;
            const own = stringEqual(k.key, events.key);
            const got = k.planItems(window.from, window.to, own ? schedule.draftsOf(record.key) : EMPTY_SCHEDULE_DRAFTS, none);
            if (got.type !== "some") return PENDING;
            for (const item of got.value) {
                if (own && (before.has(item.key) || after.has(item.key))) continue;
                const e = laneEvent(item);
                if (e === undefined) continue;
                if (own && pins !== undefined && lanes.some(lane => stringEqual(lane, e.lane))) pinned.push(context.length);
                context.push(e);
            }
        }
        // Pinned: the target's `locked` asked of each one's row as it stands, drafted or stored — every row read at once.
        if (pins !== undefined && pinned.length > 0) {
            const standing = standingRows(schedule, record, pinned.map(i => context[i]!.key));
            if (standing.type !== "some") return PENDING;
            for (const i of pinned) {
                const e = context[i]!;
                const bytes = standing.value.get(e.key);
                if (bytes !== undefined && pins(bytes, e.key)) context[i] = { ...e, locked: true };
            }
        }
        // Each lane's name, as the Plan's gutter names its resource.
        const names = new Map<string, string>();
        for (const [lane, item] of items) {
            if (item.resource.type !== "some") continue;
            const name = resourceName(kind.resources, item.resource.value);
            if (name === undefined) return PENDING;
            names.set(lane, name);
        }
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
            overlaps: slot => kind.events.find(k => stringEqual(k.key, slot))?.overlaps.type === "warn",
            pairs: "kind",
            measure: "share",
            nameOf: lane => (stringEqual(lane, UNASSIGNED) ? words.m.previewUnassigned() : names.get(lane) ?? lane),
        });
        if (model.rows.length <= CROP_LANES) return { state: "ready", model, map: undefined };
        // The map (D7, P5): every resource of the kinds the change's events are on, in their kinds' order, under its row's
        // group, else its kind's name — of a kind read a window at a time, those the change touches, by the names read.
        const on = new Set<string>();
        for (const item of items.values()) if (item.resource.type === "some") on.add(item.resource.value.kind);
        const resources: MapResource[] = [];
        let complete = true;
        const kinds = kind.resources.filter(r => on.has(r.key));
        for (const r of kinds) {
            if (r.byKey.type === "some") {
                complete = false;
                for (const [lane, item] of items) {
                    if (item.resource.type === "some" && stringEqual(item.resource.value.kind, r.key)) resources.push({ key: lane, name: names.get(lane) ?? item.resource.value.key, group: r.name });
                }
            } else {
                for (const row of r.rows) {
                    resources.push({ key: printResource({ kind: r.key, key: row.key }), name: row.label, group: row.group.type === "some" ? row.group.value : r.name });
                }
            }
        }
        const lower = (name: string) => name.toLocaleLowerCase(words.locale);
        return {
            state: "ready", model,
            map: {
                model: lanesMap(model, resources, complete),
                nouns: {
                    event: lower(events.name), events: kindPlural(lower(events.name)),
                    resources: kinds.length === 1 ? kindPlural(lower(kinds[0]!.name)) : words.m.previewResources(),
                },
            },
        };
    }, [rows, changed, option, c.options, view.recommended, record, target, schedule, kind, words]);
    const { result: live } = useTrackedEvaluation(read);
    const result = useHeld(live, applied);
    const stale = rows === "stale";
    if (rows === "failed" || !result.ok) {
        if (!result.ok) console.error(`[DecisionQueue] case ${c.key}'s preview could not read its events:`, result.error);
        return <PreviewFailed kind="plan" layout="lanes" words={words} styles={styles} />;
    }
    const got = result.value;
    if (got.state === "pending") return <PreviewPending kind="plan" layout="lanes" rows={PENDING_LANES} words={words} styles={styles} />;
    if (got.state === "empty") return <PreviewFrame kind="plan" layout="lanes" label={option?.detail ?? ""} stale={stale} applied={applied} styles={styles} />;
    const guessed = guessedOf(option?.guesses, changed);
    // A map's sentence counts what changes; with nothing marked, it names the lanes the recommendation lands on (P4), and stale
    // what the change touches (P21), as a crop's does.
    if (got.map !== undefined) {
        const label = stale || got.model.clauses.length === 0 ? lanesSentence(got.model, guessed, stale, words) : mapSentence(got.map, guessed, words);
        return <LanesMap kind="plan" map={got.map} label={label} stale={stale} applied={applied} words={words} styles={styles} />;
    }
    return <LanesCrop kind="plan" model={got.model} label={lanesSentence(got.model, guessed, stale, words)} stale={stale} applied={applied} now={now} words={words} styles={styles} />;
}
