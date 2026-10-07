/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

/**
 * The inspector pane (#1197, `Plan Builder Spec.md` §8, §9.8, PB38–PB41,
 * PB60): the Plan's end pane, when it is given one (`inspector`), showing
 * what is selected on the canvas — and, collapsed, a rail with its icon and
 * what is selected.
 *
 * - **one event** (PB38): its kind's icon and name, its title, when it runs
 *   and its status; the overlaps banner when it overlaps another (#1198,
 *   PB53), a line per event it overlaps whose click selects that event; its
 *   resource, its start and end or its instant, its lane, its state and its
 *   quantity; its kind's fields through `FieldForm`, the fields its roles
 *   read left to their own lines — or, when the kind has its own inspector,
 *   what that returns for the event in place of the form (PB60); then
 *   Duplicate and Delete;
 * - **several events** (PB39): how many, each kind's count, the list, and the
 *   bulk edit — the state, the resource and a shift in time;
 * - **a row** (PB40): a resource's name and lines, its group, its overlaps —
 *   the pairs on the resource in the window, each line selecting its pair
 *   (#1198) — its events in the window — how many, how long, how much of each
 *   unit — and its measures at the bucket a click on its plot named; an event
 *   kind's Unassigned row, the kind's events on no resource; any other row,
 *   what it draws at that bucket;
 * - **nothing** (PB41): the window's counts and three hints.
 *
 * Each event is read through its kind's own seam (`planEvent`), tracked, so a
 * commit to its record reads it again, and an event no longer there is left
 * out. The edit controls — the form's fields, the bulk edit, Duplicate and
 * Delete, and a kind's own inspector — are drawn in one disabled fieldset:
 * the event kinds take their edits with #1194.
 *
 * Styles are the `planInspector` recipe's, the form's `fieldForm`'s and the
 * buttons the shared `button`'s; the pane — its collapse control and its rail
 * — is the Dock's.
 *
 * @packageDocumentation
 */

import { memo, useCallback, useMemo, useRef, type ReactNode } from "react";
import { Box, chakra, useRecipe, useSlotRecipe, type SystemStyleObject } from "@chakra-ui/react";
import { FontAwesomeIcon } from "@fortawesome/react-fontawesome";
import type { IconName } from "@fortawesome/fontawesome-svg-core";
import {
    BlobType, NullType, OptionType, SortedMap, StringType, VariantType, compareFor, decodeBeast2For, equalFor, fromEastTypeValue,
    none, parseFor, printFor, some, toEastTypeValue, variant, type StructType,
} from "@elaraai/east";
import type { FieldSpecValue } from "@elaraai/east-ui/internal";
import { ScheduleEventRefType, ScheduleResourceRefType, type planKeys } from "@elaraai/e3-ui/internal";
import {
    BannerView, EastChakraComponent, FieldForm, getSomeorUndefined, useDataStable, useTrackedEvaluation, type BuilderFrameDock, type FieldOption,
} from "@elaraai/east-ui-components";
import { scheduleEventKey } from "../../shared/schedule/overlaps.js";
import { stateText } from "../a11y.js";
import type { PlanSnapshot } from "../controller/index.js";
import { usePlanSelector } from "../controller/react.js";
import type { PlanInstantValue } from "../instant.js";
import type { PlanStateWord } from "../messages.js";
import { rowKeyOf } from "../model.js";
import type { RowKey } from "../plan-state.js";
import { quantityText, totalsByUnit, totalsText, type PlanQuantityValue } from "../quantity.js";
import type { PlanChrome } from "../root/chrome.js";
import type { PlanScale } from "../scale.js";
import type { PlanWords } from "../words.js";
import type { PlanEventCounts } from "./counts.js";
import type { PlanValue } from "./index.js";

/** The names a Plan keeps its viewer's state under. */
type PlanKeys = ReturnType<typeof planKeys>;
/** One event kind, as the payload carries it. */
type PlanEventKindValue = PlanValue["events"][number];
/** One resource kind, as the payload carries it. */
type PlanResourceKindValue = PlanValue["resources"][number];
/** One event read by its key: as Plan draws it, and its row. */
type PlanEventReadValue = Extract<ReturnType<PlanEventKindValue["planEvent"]>, { type: "some" }>["value"];
/** One event as Plan draws it. */
type PlanEventItemValue = PlanEventReadValue["item"];
type Styles = Record<string, SystemStyleObject>;

/** The inspector open: the Calendar's 320px (§8), as the Sheet's is. */
const INSPECTOR_SIZE = "320px";

/** The drafts the kinds are read with: none yet — the event kinds' editing is #1194's. */
const NO_DRAFTS: Parameters<PlanEventKindValue["planEvent"]>[1] = new SortedMap([], compareFor(StringType));

/** The event kinds take their edits with #1194: until then a kind's own inspector's `update` writes nothing. */
const NO_UPDATE = (_edited: Uint8Array): null => null;

/** No edit reaches a kind yet: the form's edits go nowhere. */
const NO_EDIT = (): void => {};

/** A read whose kinds are still in flight: what the pane shows stands as it was. */
const READING = "reading";

/** No event selected. */
const NO_EVENTS: readonly InspectedEvent[] = [];

/** The lifecycle states a bulk edit sets, in the order the axis reads them. */
const STATES: readonly PlanStateWord[] = ["estimated", "added", "recommended", "removed", "confirmed", "in-progress", "actual", "rejected"];

/** The bulk edit's choice of a state: a case per state. */
const STATE_CHOICE = VariantType(Object.fromEntries(STATES.map((state) => [state, NullType])));

const stringEqual = equalFor(StringType);
const blobEqual = equalFor(BlobType);
const resourceEqual = equalFor(OptionType(ScheduleResourceRefType));
const parseRef = parseFor(ScheduleEventRefType);
const printResource = printFor(ScheduleResourceRefType);

/** One selected event, read: its element's key, its kind, and the event as Plan draws it, with its row. */
interface InspectedEvent {
    /** Its element's key: its event, as East prints a `Schedule.Types.EventRef`. */
    readonly key: string;
    /** Its kind. */
    readonly kind: PlanEventKindValue;
    /** The event as Plan draws it. */
    readonly item: PlanEventItemValue;
    /** Its row, as bytes at its record's entry type. */
    readonly row: Uint8Array;
}

/** What is selected on the canvas: the row, the bucket a click on it named, and the events. */
interface PlanSelection {
    readonly row: RowKey | null;
    readonly at: PlanInstantValue | null;
    readonly elements: readonly string[];
}

/** Nothing selected — the pane's selection while it shows none. */
const NOTHING: PlanSelection = { row: null, at: null, elements: [] };

const selectSelection = (s: PlanSnapshot): PlanSelection => ({ row: s.store.ui.selected, at: s.store.ui.selectedAt, elements: s.store.ui.elements });
const selectNothing = (): PlanSelection => NOTHING;
// The store keeps each part's identity while it holds.
const sameSelection = (a: PlanSelection, b: PlanSelection): boolean =>
    Object.is(a.row, b.row) && Object.is(a.at, b.at) && Object.is(a.elements, b.elements);

/** Props of {@link usePlanInspector}. */
export interface PlanInspectorProps {
    /** Whether the Plan is given its inspector pane (`inspector`). */
    shown: boolean;
    /** The event kinds: each selected event is read through its kind. */
    kinds: PlanValue["events"];
    /** The resource kinds: what an event and a row name their resource by. */
    resources: PlanValue["resources"];
    /** The canvas's chrome facts: its scale, its words, and what it reads of its rows; `undefined` with no window. */
    chrome: PlanChrome | undefined;
    /** The event kinds' counts over the window: what the pane shows when nothing is selected. */
    counts: PlanEventCounts | undefined;
    /** The names the Plan keeps its viewer's state under. */
    keys: PlanKeys;
    /** The Plan's words. */
    words: PlanWords;
}

/**
 * The selected events, read through their kinds — tracked, so a commit to a
 * kind's record reads them again; an event no longer there is left out.
 *
 * @param kinds - The event kinds
 * @param elements - The selected events, by their elements' keys
 * @returns The events, in the order they were selected — the last read's while a read is in flight or has failed
 */
function useSelectedEvents(kinds: PlanValue["events"], elements: readonly string[]): readonly InspectedEvent[] {
    const bySlot = useMemo(() => new Map(kinds.map((kind) => [kind.key, kind] as const)), [kinds]);
    const read = useCallback((): readonly InspectedEvent[] => {
        const out: InspectedEvent[] = [];
        for (const key of elements) {
            const ref = parseRef(key);
            if (!ref.success) continue;
            const kind = bySlot.get(ref.value.kind);
            const got = kind?.planEvent(ref.value.key, NO_DRAFTS);
            if (kind !== undefined && got !== undefined && got.type === "some") out.push({ key, kind, item: got.value.item, row: got.value.row });
        }
        return out;
    }, [bySlot, elements]);
    const { result } = useTrackedEvaluation(read);
    const held = useRef<readonly InspectedEvent[]>(NO_EVENTS);
    return useMemo(() => {
        if (!result.ok) {
            console.error("[Plan] the selected events could not be read:", result.error);
            return held.current;
        }
        held.current = result.value;
        return result.value;
    }, [result]);
}

/**
 * The inspector pane, as `BuilderFrame` draws it — see the module docs.
 *
 * @param props - Whether it is given, the kinds, the resources, the canvas's facts, the counts, the keys and the words
 * @returns The pane — 320px wide, its collapsed state kept per viewer, its rail saying what is selected — or `undefined`, no pane, when the Plan is given no inspector
 */
export function usePlanInspector({ shown, kinds, resources, chrome, counts, keys, words }: PlanInspectorProps): BuilderFrameDock | undefined {
    const { m } = words;
    const selection = usePlanSelector(shown ? selectSelection : selectNothing, sameSelection);
    const events = useSelectedEvents(kinds, selection.elements);
    // No `inspector`: no pane (#1197).
    if (!shown) return undefined;
    const row = selection.row !== null ? chrome?.inspect.row(selection.row) : undefined;
    // The rail's line: what is selected.
    const detail = events.length === 1 ? events[0]!.item.title
        : events.length > 1 ? m.inspectorEvents({ n: events.length, count: words.number(events.length) })
            : row?.gutter.label;
    return {
        label: m.inspectorPane(),
        icon: "sliders",
        size: INSPECTOR_SIZE,
        persist: "local",
        detail,
        body: (
            <PlanInspectorBody selection={selection} events={events} kinds={kinds} resources={resources} chrome={chrome}
                counts={counts} keys={keys} words={words} />
        ),
    };
}

/** Props of the pane's body and its views. */
interface BodyProps {
    selection: PlanSelection;
    events: readonly InspectedEvent[];
    kinds: PlanValue["events"];
    resources: PlanValue["resources"];
    chrome: PlanChrome | undefined;
    counts: PlanEventCounts | undefined;
    keys: PlanKeys;
    words: PlanWords;
}

/** The pane's body: one event, several, a row, or nothing. */
const PlanInspectorBody = memo(function PlanInspectorBody(props: BodyProps) {
    const styles = useSlotRecipe({ key: "planInspector" })() as Styles;
    const { selection, events, chrome } = props;
    // Each event its own view: what one showed never lands on the next.
    if (events.length === 1) return <OneEvent key={events[0]!.key} {...props} styles={styles} event={events[0]!} />;
    if (events.length > 1) return <SeveralEvents {...props} styles={styles} />;
    if (selection.row !== null && chrome !== undefined) {
        const row = chrome.inspect.row(selection.row);
        if (row !== undefined) return <RowView key={row.key} {...props} styles={styles} chrome={chrome} rowKey={row.key} at={selection.at} />;
    }
    return <NothingSelected styles={styles} counts={props.counts} words={props.words} />;
});

// ============================================================================
// Words
// ============================================================================

/**
 * When an event runs, as its head says it — its day and times, an instant's
 * one time, or that it waits in the backlog.
 *
 * @param item - The event
 * @param instant - Whether its kind's events are each one instant
 * @param w - The Plan's words
 * @returns `Mon, Oct 5, 2026 · 06:00–14:00`
 */
function whenText(item: PlanEventItemValue, instant: boolean, w: PlanWords): string {
    const start = getSomeorUndefined(item.start);
    const end = getSomeorUndefined(item.end);
    if (start === undefined || end === undefined) return w.m.inspectorUnscheduled();
    if (instant) return w.m.inspectorWhen({ day: w.weekdayDate(start), from: w.time(start), endDay: undefined, to: undefined });
    return spanText(start, end, w);
}

/**
 * A span as the inspector says it — its day and times, its end's day too
 * when it ends on another.
 *
 * @param start - When it starts
 * @param end - When it ends
 * @param w - The Plan's words
 * @returns `Tue, Oct 20, 2026 · 10:00–12:00`
 */
function spanText(start: Date, end: Date, w: PlanWords): string {
    const day = w.weekdayDate(start);
    const endDay = w.weekdayDate(end);
    return w.m.inspectorWhen({ day, from: w.time(start), endDay: stringEqual(endDay, day) ? undefined : endDay, to: w.time(end) });
}

// ============================================================================
// Overlaps (#1198, PB53)
// ============================================================================

/** The glyph an overlaps banner leads with. */
const OVERLAP_ICON = { prefix: "fas", name: "triangle-exclamation" } as const;

/** One line of an overlaps banner: the events it selects, when, and what. */
interface OverlapLine {
    /** The events a click selects, by their elements' keys. */
    readonly keys: readonly string[];
    /** When: the event's span, or the pair's overlap. */
    readonly when: string;
    /** What: the event's title, or the pair's. */
    readonly title: string;
}

/**
 * An overlaps banner — the shared `Banner` in its guard tone, as the
 * Calendar's inspector draws it (§8): its title, and a line per event or pair,
 * each a button that selects what it names and brings it into view.
 */
function OverlapsBanner({ styles, title, lines, onSelect }: {
    styles: Styles; title: string; lines: readonly OverlapLine[]; onSelect: (keys: readonly string[]) => void;
}) {
    return (
        <Box css={styles.overlaps} data-inspector-overlaps="">
            <BannerView status="guard" icon={OVERLAP_ICON} title={title} description={(
                <Box as="ul" css={styles.overlapList}>
                    {lines.map((line) => {
                        const at = line.keys.join(" ");
                        return (
                            <Box as="li" key={at} css={styles.overlapLine}>
                                <chakra.button type="button" css={styles.overlapItem} data-inspector-overlap={at} onClick={() => onSelect(line.keys)}>
                                    <Box as="span" css={styles.overlapWhen}>{line.when}</Box>
                                    <Box as="span" css={styles.overlapTitle}>{line.title}</Box>
                                </chakra.button>
                            </Box>
                        );
                    })}
                </Box>
            )} />
        </Box>
    );
}

/**
 * A resource by its name: its kind's row of that key, else its key.
 *
 * @param ref - The resource an event is on, if any
 * @param resources - The resource kinds
 * @param w - The Plan's words
 * @returns Its name, or `Unassigned`
 */
function resourceText(ref: PlanEventItemValue["resource"], resources: PlanValue["resources"], w: PlanWords): string {
    const at = getSomeorUndefined(ref);
    if (at === undefined) return w.m.inspectorUnassigned();
    const kind = resources.find((k) => stringEqual(k.key, at.kind));
    return kind?.rows.find((r) => stringEqual(r.key, at.key))?.label ?? at.key;
}

/** How long minutes run, in hours to one place — `26.5`. */
function hoursText(minutes: number, w: PlanWords): string {
    return w.number(Math.round(minutes / 6) / 10);
}

// ============================================================================
// One event (PB38, PB60)
// ============================================================================

/** Props of {@link OneEvent}. */
interface OneEventProps extends BodyProps {
    styles: Styles;
    event: InspectedEvent;
}

/** One fact: its label and its value. */
function Fact({ styles, label, value, fact }: { styles: Styles; label: string; value: ReactNode; fact: string }) {
    return (
        <>
            <Box as="dt" css={styles.factLabel}>{label}</Box>
            <Box as="dd" css={styles.factValue} data-fact={fact}>{value}</Box>
        </>
    );
}

/** One event: its head, its overlaps, its facts, its fields or its kind's own inspector, and its gestures. */
function OneEvent({ event, resources, keys, words, styles, counts, chrome }: OneEventProps) {
    const { m } = words;
    const button = useRecipe({ key: "button" });
    const { kind } = event;
    const item = event.item;
    const roles = kind.roles;
    // What it overlaps (#1198, PB53): its kind's events on its resource at once — a line each, which selects it.
    const peers = counts?.overlaps.peers.get(event.key) ?? [];
    const start = getSomeorUndefined(item.start);
    const end = getSomeorUndefined(item.end);
    const lane = getSomeorUndefined(item.lane);
    const quantity = getSomeorUndefined(item.quantity);
    const status = getSomeorUndefined(item.status);

    // Its row, held by its data: a read that brings the same row again draws nothing new.
    const row = useDataStable(event.row, blobEqual);
    const rowType = useMemo(() => fromEastTypeValue(kind.editing.entryType) as StructType, [kind.editing.entryType]);
    const value = useMemo(() => decodeBeast2For(rowType)(row), [rowType, row]);
    // The kind's form, but the fields its roles read: each has its own line here.
    const specs = useMemo(() => {
        const roleFields = [roles.state, roles.quantity, roles.lane].flatMap((field) => (field.type === "some" ? [field.value] : []));
        return kind.fields.filter((spec) => !roleFields.some((field) => stringEqual(field, spec.path[0]!)));
    }, [kind.fields, roles]);
    // The kind's own inspector (PB60): what it returns for the event, in place of the form.
    const author = getSomeorUndefined(kind.inspector);
    const own = useMemo(() => {
        if (author === undefined) return undefined;
        try {
            return author(row, NO_UPDATE);
        } catch (err) {
            console.error(`[Plan] ${kind.name}'s own inspector failed; its form shows instead:`, err);
            return undefined;
        }
    }, [author, row, kind.name]);

    return (
        <Box css={styles.root} data-plan-inspector="event">
            <Box css={styles.head}>
                <Box css={styles.headRow}>
                    <Box as="span" css={styles.kindTile} aria-hidden="true">
                        <FontAwesomeIcon icon={["fas", kind.icon as IconName]} />
                    </Box>
                    <Box css={styles.headText}>
                        <Box css={styles.eyebrow} data-inspector-kind="">{kind.name}</Box>
                        <Box css={styles.name} data-inspector-title="">{item.title}</Box>
                        <Box css={styles.when} data-inspector-when="">{whenText(item, kind.instant, words)}</Box>
                    </Box>
                </Box>
                {status !== undefined && (
                    <Box css={styles.marks}>
                        <Box as="span" css={styles.status} data-tone={status.tone.type} data-ring={status.ring ? "" : undefined} data-inspector-status="">
                            {status.label}
                        </Box>
                    </Box>
                )}
            </Box>
            {/* Under the head, as the Calendar's inspector has it (§8) — and out
                of the edits' fieldset, so its lines select while that is disabled. */}
            {peers.length > 0 && chrome !== undefined && (
                <OverlapsBanner styles={styles}
                    title={m.inspectorOverlaps({ n: peers.length, count: words.number(peers.length), on: resourceText(item.resource, resources, words) })}
                    lines={peers.map((peer) => ({ keys: [scheduleEventKey(peer)], when: whenText(peer, kind.instant, words), title: peer.title }))}
                    onSelect={chrome.selectEvents} />
            )}
            <Box as="dl" css={styles.facts} data-inspector-facts="">
                <Fact styles={styles} fact="resource" label={m.inspectorFact({ fact: "resource" })} value={resourceText(item.resource, resources, words)} />
                {start !== undefined && end !== undefined && (kind.instant
                    ? <Fact styles={styles} fact="at" label={m.inspectorFact({ fact: "at" })} value={words.dateTime(start)} />
                    : (
                        <>
                            <Fact styles={styles} fact="start" label={m.inspectorFact({ fact: "start" })} value={words.dateTime(start)} />
                            <Fact styles={styles} fact="end" label={m.inspectorFact({ fact: "end" })} value={words.dateTime(end)} />
                        </>
                    ))}
                {lane !== undefined && <Fact styles={styles} fact="lane" label={m.inspectorFact({ fact: "lane" })} value={lane} />}
                {roles.state.type === "some" && <Fact styles={styles} fact="state" label={m.inspectorFact({ fact: "state" })} value={stateText(item.state, words)} />}
                {quantity !== undefined && <Fact styles={styles} fact="quantity" label={m.inspectorFact({ fact: "quantity" })} value={quantityText(quantity, words)} />}
            </Box>
            <chakra.fieldset css={styles.edits} disabled data-inspector-edits="">
                {own !== undefined ? (
                    <Box css={styles.fields} data-inspector-fields="custom">
                        <Box css={styles.custom}>
                            <EastChakraComponent value={own} storageKey={`${keys.frame}.inspector.${kind.key}`} />
                        </Box>
                    </Box>
                ) : specs.length > 0 && (
                    <Box css={styles.fields} data-inspector-fields="form">
                        <FieldForm specs={specs} value={value} onChange={NO_EDIT} />
                    </Box>
                )}
                <Box css={styles.actions} data-inspector-actions="">
                    <chakra.button type="button" css={button({ variant: "outline", size: "xs" })} disabled data-inspector-action="duplicate">
                        {m.inspectorAction({ action: "duplicate" })}
                    </chakra.button>
                    <chakra.button type="button" css={button({ variant: "outline", size: "xs" })} disabled data-inspector-action="delete">
                        {m.inspectorAction({ action: "delete" })}
                    </chakra.button>
                </Box>
            </chakra.fieldset>
        </Box>
    );
}

// ============================================================================
// Several events (PB39)
// ============================================================================

/** Props of {@link SeveralEvents}. */
interface SeveralProps extends BodyProps {
    styles: Styles;
}

/** Several events: how many, each kind's count, the list, and the bulk edit. */
function SeveralEvents({ events, kinds, resources, words, styles }: SeveralProps) {
    const { m } = words;
    const button = useRecipe({ key: "button" });
    // Each kind's count, in the kinds' order.
    const counted = kinds
        .map((kind) => ({ kind, n: events.filter((e) => stringEqual(e.kind.key, kind.key)).length }))
        .filter(({ n }) => n > 0);
    const selectedKinds = counted.map(({ kind }) => kind);
    // The bulk edit's state and resource, as the form draws a choice and a reference.
    const specs = useMemo((): FieldSpecValue[] => {
        const out: FieldSpecValue[] = [];
        if (selectedKinds.some((kind) => kind.roles.state.type === "some")) {
            out.push({
                path: ["state"], label: m.inspectorFact({ fact: "state" }), help: none, group: none,
                type: toEastTypeValue(STATE_CHOICE), optional: true,
                editor: variant("select", STATES.map((state) => ({ case: state, label: m.state({ state }) }))),
            });
        }
        if (selectedKinds.some((kind) => kind.takes.length > 0)) {
            out.push({
                path: ["resource"], label: m.inspectorFact({ fact: "resource" }), help: none, group: none,
                type: toEastTypeValue(StringType), optional: true, editor: variant("reference", { of: "resource" }),
            });
        }
        return out;
    }, [selectedKinds, m]);
    // The resources the selected kinds are placed on: each its kind's rows, by name.
    const options = useMemo(() => {
        const slots = selectedKinds.flatMap((kind) => kind.takes);
        const placed = resources.filter((r: PlanResourceKindValue) => slots.some((slot) => stringEqual(slot, r.key)));
        return {
            resource: placed.flatMap((r) => r.rows.map((row): FieldOption => ({ key: printResource({ kind: r.key, key: row.key }), label: row.label }))),
        };
    }, [selectedKinds, resources]);
    return (
        <Box css={styles.root} data-plan-inspector="events">
            <Box css={styles.head}>
                <Box css={styles.summary} data-inspector-several="">{m.inspectorEvents({ n: events.length, count: words.number(events.length) })}</Box>
                <Box css={styles.marks}>
                    {counted.map(({ kind, n }) => (
                        <Box as="span" key={kind.key} css={styles.chip} data-inspector-kind-count={kind.key}>
                            {m.inspectorKindCount({ kind: kind.name, n, count: words.number(n) })}
                        </Box>
                    ))}
                </Box>
            </Box>
            <Box as="ul" css={styles.list} data-inspector-list="">
                {events.map((event) => (
                    <Box as="li" key={event.key} css={styles.listItem} data-inspector-event={event.key}>
                        <FontAwesomeIcon icon={["fas", event.kind.icon as IconName]} />
                        <Box css={styles.listText}>
                            <Box as="span" css={styles.listTitle}>{event.item.title}</Box>
                            <Box as="span" css={styles.listWhen}>{whenText(event.item, event.kind.instant, words)}</Box>
                        </Box>
                    </Box>
                ))}
            </Box>
            <chakra.fieldset css={styles.edits} disabled data-inspector-edits="">
                <Box css={styles.bulk} data-inspector-bulk="">
                    <Box css={styles.sectionHead}>{m.inspectorSection({ section: "bulk" })}</Box>
                    {specs.length > 0 && <FieldForm specs={specs} value={{}} options={options} onChange={NO_EDIT} />}
                    <Box css={styles.shift} role="group" aria-label={m.inspectorShiftLabel()} data-inspector-shift="">
                        {([[-1, "day"], [-1, "hour"], [1, "hour"], [1, "day"]] as const).map(([by, unit]) => (
                            <chakra.button key={`${by}${unit}`} type="button" css={button({ variant: "outline", size: "xs" })} disabled
                                data-inspector-action={`shift:${by}${unit}`}>
                                {m.inspectorShift({ by, unit })}
                            </chakra.button>
                        ))}
                    </Box>
                </Box>
                <Box css={styles.actions} data-inspector-actions="">
                    <chakra.button type="button" css={button({ variant: "outline", size: "xs" })} disabled data-inspector-action="duplicate">
                        {m.inspectorAction({ action: "duplicate" })}
                    </chakra.button>
                    <chakra.button type="button" css={button({ variant: "outline", size: "xs" })} disabled data-inspector-action="delete">
                        {m.inspectorAction({ action: "delete" })}
                    </chakra.button>
                </Box>
            </chakra.fieldset>
        </Box>
    );
}

// ============================================================================
// A row (PB40)
// ============================================================================

/** What a row stands for: a resource, an event kind's events on none, or neither. */
type RowTarget =
    | { readonly kind: "resource"; readonly resources: PlanResourceKindValue; readonly key: string; readonly path: readonly string[] }
    | { readonly kind: "unassigned"; readonly event: PlanEventKindValue }
    | { readonly kind: "row" };

/** The ways an event kind draws on a resource's rows. */
const DRAWS: readonly string[] = ["span", "buckets", "cards", "marks"];

/**
 * What a row on the canvas stands for, by its id — the series a Plan gives its
 * event kinds' rows (e3-ui's `event-rows.ts`): a resource kind's row of a way
 * its kinds draw (`<slot>.<draw>`) or of one of its measures (the measure's
 * key), at the resource's path; an event kind's Unassigned row
 * (`<kind>.unassigned`); or any other.
 *
 * @param series - The row's series
 * @param path - The row's path: its resource's key last
 * @param kinds - The event kinds
 * @param resources - The resource kinds
 * @returns What it stands for
 */
function targetOf(series: string, path: readonly string[], kinds: PlanValue["events"], resources: PlanValue["resources"]): RowTarget {
    const key = path[path.length - 1];
    if (key !== undefined) {
        const owner = resources.find((r) => DRAWS.some((draw) => stringEqual(series, `${r.key}.${draw}`))
            || r.measures.some((measure) => stringEqual(measure, series)));
        if (owner !== undefined) return { kind: "resource", resources: owner, key, path };
    }
    const lost = kinds.find((k) => stringEqual(series, `${k.key}.unassigned`));
    return lost !== undefined ? { kind: "unassigned", event: lost } : { kind: "row" };
}

/** A row's events in the window: how many, how long, and their quantities. */
interface WindowFacts {
    readonly events: number;
    readonly minutes: number;
    readonly quantities: readonly PlanQuantityValue[];
}

/** A `time` instant's Date; `undefined` for an instant of another arm. */
function timeOf(t: PlanScale["window"]["min"]): Date | undefined {
    return t.type === "time" ? t.value : undefined;
}

/**
 * The events in the window a row stands for — a resource's, or an event
 * kind's on no resource — read through the kinds, tracked.
 *
 * @param target - What the row stands for
 * @param kinds - The event kinds
 * @param scale - The shared scale: its window
 * @returns The facts; `undefined` for a row that stands for no events, and before the first read answers
 */
function useWindowFacts(target: RowTarget, kinds: PlanValue["events"], scale: PlanScale): WindowFacts | undefined {
    const from = timeOf(scale.window.min);
    const to = timeOf(scale.window.max);
    const read = useCallback((): WindowFacts | typeof READING | undefined => {
        if (target.kind === "row" || from === undefined || to === undefined) return undefined;
        const on = target.kind === "resource" ? some({ kind: target.resources.key, key: target.key }) : undefined;
        let events = 0;
        let minutes = 0;
        const quantities: PlanQuantityValue[] = [];
        for (const kind of kinds) {
            if (target.kind === "resource" ? !kind.takes.some((slot) => stringEqual(slot, target.resources.key)) : !stringEqual(kind.key, target.event.key)) continue;
            const items = kind.planItems(from, to, NO_DRAFTS);
            if (items.type === "none") return READING;
            for (const item of items.value) {
                if (on !== undefined ? !resourceEqual(item.resource, on) : item.resource.type !== "none") continue;
                events += 1;
                minutes += Number(item.minutes);
                const quantity = getSomeorUndefined(item.quantity);
                if (quantity !== undefined) quantities.push(quantity);
            }
        }
        return { events, minutes, quantities };
    }, [target, kinds, from, to]);
    const { result } = useTrackedEvaluation(read);
    const held = useRef<WindowFacts | undefined>(undefined);
    return useMemo(() => {
        if (!result.ok) {
            console.error("[Plan] the row's events could not be read:", result.error);
            return held.current;
        }
        if (result.value === READING) return held.current;
        held.current = result.value;
        return result.value;
    }, [result]);
}

/** Props of {@link RowView}. */
interface RowProps extends BodyProps {
    styles: Styles;
    chrome: PlanChrome;
    rowKey: RowKey;
    at: PlanInstantValue | null;
}

/** A row: a resource's name, lines and group, its overlaps, its events in the window and its measures at a bucket — or an Unassigned row's events, or what any other row draws at a bucket. */
function RowView({ rowKey, at, kinds, resources, chrome, counts, words, styles }: RowProps) {
    const { m } = words;
    const { inspect, scale } = chrome;
    const row = inspect.row(rowKey)!;
    const id = row.id.value;
    const target = useMemo(() => targetOf(id.series, id.path, kinds, resources), [id, kinds, resources]);
    const facts = useWindowFacts(target, kinds, scale);
    // Its overlaps (#1198, PB40): the pairs on its resource in the window, a line each, which selects the pair.
    const on = target.kind === "resource" ? some({ kind: target.resources.key, key: target.key }) : undefined;
    const pairs = on === undefined ? [] : (counts?.overlaps.pairs ?? []).filter((pair) => resourceEqual(pair.first.resource, on));
    const resource = target.kind === "resource" ? target.resources.rows.find((r) => stringEqual(r.key, target.key)) : undefined;
    const group = resource !== undefined ? getSomeorUndefined(resource.group) : undefined;
    const lines = resource !== undefined ? [getSomeorUndefined(resource.sub), getSomeorUndefined(resource.meta)].filter((line): line is string => line !== undefined) : [];
    const bucketIndex = at !== null ? scale.bucketOf(at) : -1;
    const bucket = bucketIndex >= 0 ? scale.buckets[bucketIndex] : undefined;
    // The measures under a resource, at its path; any other row's own value.
    const measures = target.kind === "resource"
        ? target.resources.measures.flatMap((measure) => {
            const key = rowKeyOf(variant("entry", { series: measure, path: [...target.path] }) as typeof row.id);
            const measured = inspect.row(key);
            return measured === undefined ? [] : [{ key: measure, label: measured.gutter.label, rowKey: key }];
        })
        : target.kind === "row" ? [{ key: row.key, label: row.gutter.label, rowKey: row.key }] : [];
    const title = target.kind === "resource" ? resource?.label ?? target.key
        : target.kind === "unassigned" ? m.inspectorUnassigned() : row.gutter.label;
    const eyebrow = target.kind === "resource" ? target.resources.name : target.kind === "unassigned" ? target.event.name : m.inspectorRow();
    return (
        <Box css={styles.root} data-plan-inspector="row">
            <Box css={styles.head}>
                <Box css={styles.eyebrow} data-inspector-kind="">{eyebrow}</Box>
                <Box css={styles.name} data-inspector-title="">{title}</Box>
                {lines.map((line, i) => <Box key={i} css={styles.when} data-inspector-line="">{line}</Box>)}
                {group !== undefined && (
                    <Box css={styles.marks}>
                        <Box as="span" css={styles.chip} data-inspector-group="">{group}</Box>
                    </Box>
                )}
            </Box>
            {pairs.length > 0 && (
                <OverlapsBanner styles={styles}
                    title={m.inspectorRowOverlaps({ n: pairs.length, count: words.number(pairs.length) })}
                    lines={pairs.map((pair) => ({
                        keys: [scheduleEventKey(pair.first), scheduleEventKey(pair.second)],
                        when: spanText(pair.from, pair.to, words),
                        title: m.inspectorOverlapPair({ first: pair.first.title, second: pair.second.title }),
                    }))}
                    onSelect={chrome.selectEvents} />
            )}
            {facts !== undefined && (
                <Box as="dl" css={styles.facts} data-inspector-window="">
                    <Fact styles={styles} fact="events" label={m.inspectorFact({ fact: "events" })} value={words.number(facts.events)} />
                    <Fact styles={styles} fact="hours" label={m.inspectorFact({ fact: "hours" })} value={hoursText(facts.minutes, words)} />
                    {facts.quantities.length > 0 && (
                        <Fact styles={styles} fact="quantities" label={m.inspectorFact({ fact: "quantities" })} value={totalsText(totalsByUnit(facts.quantities), words)} />
                    )}
                </Box>
            )}
            {measures.length > 0 && (
                <Box css={styles.measures} data-inspector-measures="">
                    <Box css={styles.sectionHead}>{bucket !== undefined ? m.inspectorAt({ bucket: scale.bucketText(bucket) }) : m.inspectorSection({ section: "measures" })}</Box>
                    {bucket === undefined || at === null
                        ? <Box css={styles.hint} data-inspector-no-bucket="">{m.inspectorNoBucket()}</Box>
                        : (
                            <Box as="dl" css={styles.facts} data-inspector-at="">
                                {measures.map((measure) => (
                                    <Fact key={measure.key} styles={styles} fact={`measure:${measure.key}`} label={measure.label}
                                        value={inspect.valueAt(measure.rowKey, at) ?? m.inspectorNoValue()} />
                                ))}
                            </Box>
                        )}
                </Box>
            )}
        </Box>
    );
}

// ============================================================================
// Nothing selected (PB41)
// ============================================================================

/** Nothing selected: the window's counts, and three hints. */
function NothingSelected({ styles, counts, words }: { styles: Styles; counts: PlanEventCounts | undefined; words: PlanWords }) {
    const { m } = words;
    const stats = counts === undefined ? [] : [
        { stat: "events" as const, n: counts.events, text: words.number(counts.events) },
        { stat: "hours" as const, n: counts.minutes, text: hoursText(counts.minutes, words) },
        ...(counts.backlog !== undefined ? [{ stat: "backlog" as const, n: counts.backlog, text: words.number(counts.backlog) }] : []),
    ];
    return (
        <Box css={styles.root} data-plan-inspector="none">
            {stats.length > 0 && (
                <Box css={styles.stats} data-inspector-counts="">
                    {stats.map(({ stat, n, text }) => (
                        <Box key={stat} css={styles.stat} data-count={stat}>
                            <Box as="span" css={styles.statValue}>{text}</Box>
                            <Box as="span" css={styles.statLabel}>{m.inspectorStat({ stat, n })}</Box>
                        </Box>
                    ))}
                </Box>
            )}
            <Box as="ul" css={styles.hints}>
                {([1, 2, 3] as const).map((n) => <Box as="li" key={n} css={styles.hint}>{m.inspectorHint({ n })}</Box>)}
            </Box>
        </Box>
    );
}
