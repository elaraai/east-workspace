/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

/**
 * An Allocation target's preview (`Decision Queue Spec.md` D7, D8, P4,
 * P13–P25): the resources a change's bins land on, a lane a resource a day,
 * and the waiting row they leave or go back to, cropped to the hours around
 * what it touches. Each bin the change touches is the board's own, read from
 * its row as it stands and as the change leaves it — its roles the bin kind's
 * `read`, placed on its day as the board places it; each day they stand on is
 * read through the bin kind's `rows` — tracked, so a read landing draws it —
 * with the queue's drafts of the bins' record in place, then laid out as it
 * stands and as the change leaves it, and every resource's load and the
 * checks, the board's and the app's, worked out over each as the board works
 * them out. What it draws is {@link allocationCrop}'s. Past two lanes it
 * draws the board's map (P5): every resource, under its group — else the
 * board's noun for its resources — the waiting row no tile.
 *
 * @packageDocumentation
 */

import { useCallback, useMemo } from "react";
import { DateTimeType, SortedMap, SortedSet, StringType, equalFor } from "@elaraai/east";
import { useTrackedEvaluation } from "@elaraai/east-ui-components";
import { DAY, allocationContext, allocationDomain, allocationWords, compareDate, compareString, dayStart, emptyDay, type Bin, type Issue } from "../../allocation/model.js";
import { lower, other } from "../../allocation/nouns.js";
import { kindPlural } from "../../shared/schedule/words.js";
import { appliedRows, draftedRows, standingRows, type DecisionTarget } from "../editing.js";
import { allocationCrop, type AllocationCropBin, type AllocationCropDay, type AllocationCropPlan } from "./allocation-model.js";
import { PreviewFailed, PreviewFrame, PreviewPending, guessedOf, leftBy, sharedOf, type PreviewProps } from "./frame.js";
import { LanesCrop, LanesMap, dayText, lanesSentence, mapSentence, type PreviewMap } from "./lanes.js";
import type { LanesModel } from "./lanes-model.js";
import { CROP_LANES, lanesMap } from "./map-model.js";

/** An Allocation target's kind, decoded. */
type AllocationKind = Extract<DecisionTarget["kind"], { type: "allocation" }>["value"];

/** What the preview's read gives: the lanes — and past two, the map — a read in flight, or nothing it touches with a time. */
type AllocationRead = { readonly state: "ready"; readonly model: LanesModel; readonly map: PreviewMap | undefined } | { readonly state: "pending" } | { readonly state: "empty" };

/** How many lanes the placeholder draws while the rows are read: a resource and the waiting row. */
const PENDING_LANES = 2;
const PENDING: AllocationRead = { state: "pending" };
const EMPTY: AllocationRead = { state: "empty" };
const sameDate = equalFor(DateTimeType);
const stringEqual = equalFor(StringType);
const NOT_LOCKED = (): boolean => false;

/** Props of {@link AllocationPreview}. */
export interface AllocationPreviewProps extends PreviewProps {
    /** The target's Allocation kind. */
    readonly kind: AllocationKind;
}

/**
 * An Allocation target's preview (see the module docs).
 *
 * @param props - The case, its target and record, the rows its change leaves and the queue's editing ({@link AllocationPreviewProps})
 * @returns The preview
 */
export function AllocationPreview({ c, view, target, kind, record, rows, changed, schedule, shared, words, styles, now }: AllocationPreviewProps) {
    const option = view.option;
    // The board's codecs and checks at the bins' row type, and every arrival and resource it reads: made once.
    const domain = useMemo(() => allocationDomain(kind.bin.rowType), [kind.bin.rowType]);
    const context = useMemo(() => allocationContext({ ...kind, arrivals: kind.arrivals.type === "some" ? kind.arrivals.value : [] }), [kind]);
    const read = useCallback((): AllocationRead => {
        if (rows === "reading" || rows === "failed") return PENDING;
        if (record === undefined) return EMPTY;
        // A bin as its row's bytes give it: its roles beside its row, on the day its time falls in, as the board reads it.
        const binOf = (bytes: Uint8Array | undefined): Bin | undefined => {
            if (bytes === undefined) return undefined;
            const roles = kind.bin.read(bytes);
            const got = domain.binOf(roles, domain.decodeRow(bytes), dayStart(roles.at));
            return got.type === "some" ? got.value : undefined;
        };
        const bins: AllocationCropBin[] = [];
        const bytesOf = new Map<string, Uint8Array>();
        const lands = new SortedMap<string, Bin>([], compareString);
        let marked = true;
        if (rows === "ready" && changed.length > 0) {
            for (const row of changed) {
                const left = leftBy(row);
                bins.push({ key: row.key, before: binOf(row.standing), after: binOf(left) });
                const bytes = row.standing ?? left;
                if (bytes !== undefined) bytesOf.set(row.key, bytes);
            }
        } else {
            // Stale (P21): the bins the proposal touched, as they stand, its own marks dashed. Changing nothing (P4): the
            // bins the recommendation touches, as they stand, unmarked, on the resources it would land them on — where
            // the recommendation lands in this target.
            const stale = rows === "stale";
            const recommended = c.options[view.recommended];
            const theirs = !stale && recommended !== undefined && target.tags.some(tag => stringEqual(tag, recommended.change.tag));
            const o = theirs ? recommended : option;
            marked = stale;
            if (o === undefined) return EMPTY;
            const standing = standingRows(schedule, record, target.touched(o.change.patch));
            if (standing.type !== "some") return PENDING;
            for (const [key, bytes] of standing.value) {
                const bin = binOf(bytes);
                bins.push({ key, before: bin, after: bin });
                if (bytes !== undefined) bytesOf.set(key, bytes);
            }
            if (theirs) {
                const applied = appliedRows(schedule, target, record, recommended);
                if (applied.state === "reading") return PENDING;
                if (applied.state === "ready") {
                    for (const [key, bytes] of applied.rows) {
                        const bin = binOf(bytes);
                        if (bin !== undefined) lands.set(key, bin);
                    }
                }
            }
        }
        // The queue's drafts of the bins' record — the verdicts drafted before this one — each where its draft puts it.
        const drafts = new Map<string, Bin | undefined>();
        for (const [key, bytes] of draftedRows(schedule, record)) drafts.set(key, binOf(bytes));
        // The days the bins stand on, and those the recommendation lands on: each read as the record holds it, the drafts
        // in place, then laid out as it stands and as the change leaves it, with the board's loads and checks and the app's.
        const daysRead = new SortedSet<Date>([], compareDate);
        for (const bin of [...bins.flatMap(b => [b.before, b.after]), ...lands.values()]) if (bin !== undefined) daysRead.add(dayStart(bin.at));
        const days: AllocationCropDay[] = [];
        for (const day of daysRead) {
            const stored = kind.bin.rows(day, new Date(day.getTime() + DAY));
            if (stored.type !== "some") return PENDING;
            const standing = new SortedMap<string, Bin>([], compareString);
            for (const [key, held] of stored.value) {
                const got = domain.binOf(held.roles, domain.decodeRow(held.row), day);
                if (got.type === "some") standing.set(key, got.value);
            }
            for (const [key, bin] of drafts) {
                standing.delete(key);
                if (bin !== undefined && sameDate(dayStart(bin.at), day)) standing.set(key, bin);
            }
            const planOf = (side: "before" | "after"): AllocationCropPlan => {
                const plan = { ...emptyDay(), bins: new SortedMap(standing, compareString) };
                for (const touched of bins) {
                    plan.bins.delete(touched.key);
                    const bin = touched[side];
                    if (bin !== undefined && sameDate(dayStart(bin.at), day)) plan.bins.set(touched.key, bin);
                }
                const loads = domain.loads(day, plan, context);
                const issues: Issue[] = [...domain.check(day, plan, context)];
                if (kind.check.type === "some") issues.push(...kind.check.value(domain.encodeCheckContext({ day, plan, context, loads })));
                return { bins: plan.bins, loads, issues };
            };
            days.push({ day, before: planOf("before"), after: planOf("after") });
        }
        const knockOn = option?.knockOn;
        const locked = target.locked.type === "some" ? target.locked.value : NOT_LOCKED;
        const { m } = words;
        const { quantity, ms } = allocationWords();
        const model = allocationCrop({
            bins, days, lands, marked, context,
            knockOn: key => knockOn?.has(key) === true,
            locked: key => {
                const bytes = bytesOf.get(key);
                return bytes !== undefined && locked(bytes, key);
            },
            shared: key => sharedOf(shared, record.key, key),
            ms: step => Number(ms(step)),
            words: {
                part: (code, q) => m.previewBin({ code: code ?? m.previewReserved({ sentence: false }), quantity: quantity(q, context.unit) }),
                what: code => code ?? m.previewReserved({ sentence: true }),
                lane: (label, day) => (day === undefined ? label : m.previewWhere({ resource: label, day: dayText(day, words) })),
                waiting: m.previewWaiting(),
            },
        });
        if (model === undefined) return EMPTY;
        if (model.rows.length <= CROP_LANES) return { state: "ready", model, map: undefined };
        // The map (D7, P5): every resource of the board, by its key as the tally names it, under its group — else the
        // board's noun for its resources, as a heading writes it; the bins and the resources in running text.
        const resources = kind.resources.map(r => ({ key: r.key, name: r.label, group: r.group.type === "some" ? r.group.value : kind.labels.resource.other }));
        const event = lower(kind.bin.kind.name);
        return {
            state: "ready", model,
            map: { model: lanesMap(model, resources, true), nouns: { event, events: kindPlural(event), resources: other(kind.labels.resource) } },
        };
    }, [rows, changed, option, c.options, view.recommended, record, target, schedule, kind, domain, context, shared, words]);
    const { result } = useTrackedEvaluation(read);
    const stale = rows === "stale";
    if (rows === "failed" || !result.ok) {
        if (!result.ok) console.error(`[DecisionQueue] case ${c.key}'s preview could not read its bins:`, result.error);
        return <PreviewFailed kind="allocation" layout="lanes" words={words} styles={styles} />;
    }
    const got = result.value;
    if (got.state === "pending") return <PreviewPending kind="allocation" layout="lanes" rows={PENDING_LANES} words={words} styles={styles} />;
    if (got.state === "empty") return <PreviewFrame kind="allocation" layout="lanes" label={option?.detail ?? ""} stale={stale} styles={styles} />;
    const guessed = guessedOf(option?.guesses, changed);
    // A map's sentence counts what changes; with nothing marked, it names the lanes the recommendation lands on (P4), and stale
    // what the change touches (P21), as a crop's does.
    if (got.map !== undefined) {
        const label = stale || got.model.clauses.length === 0 ? lanesSentence(got.model, guessed, stale, words) : mapSentence(got.map, guessed, words);
        return <LanesMap kind="allocation" map={got.map} label={label} stale={stale} words={words} styles={styles} />;
    }
    return <LanesCrop kind="allocation" model={got.model} label={lanesSentence(got.model, guessed, stale, words)} stale={stale} now={now} words={words} styles={styles} />;
}
