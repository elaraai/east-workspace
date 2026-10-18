/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

/**
 * The Timeline (`Allocation Spec.md` §8, §9.2–§9.3, #1326): one head row over
 * three panes — the lane grid with a card per bin, the link channel, and the
 * resources in their fixed order, each row's plot on the resource axis — and
 * the focus. Every figure and word is e3-ui's (the slots, the loads, each
 * resource's line); the layout's indices are `timeline-layout.ts`'s, and every
 * size is the `allocationBuilder` recipe's.
 *
 * @packageDocumentation
 */

import { memo, useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, type CSSProperties, type KeyboardEvent, type ReactNode } from "react";
import { Box, chakra } from "@chakra-ui/react";
import { FontAwesomeIcon } from "@fortawesome/react-fontawesome";
import { faArrowDown, faArrowRight, faArrowUp, faCircleExclamation, faFilter, faLink, faLinkSlash, faTriangleExclamation, faXmark } from "@fortawesome/free-solid-svg-icons";
import type { SortedMap, option } from "@elaraai/east";
import { useContainerBelow, useDragEventChip, useDropCell, type DragEventValue, type DragPayload, type Formatters } from "@elaraai/east-ui-components";
import { VirtualRows, formatDatePattern } from "@elaraai/east-ui-components/internal";
import { LinksLayer, type LinkRibbon } from "../shared/links/layer.js";
import { useScrollTop } from "../shared/links/scroll.js";
import { NowLine } from "../shared/time/now-line.js";
import { TimeRulerRow, timeRulerUnits } from "../shared/time/ruler.js";
import { isoWeekUTC, timeScale, timeWords } from "../shared/time/scale.js";
import { shadeBands } from "../shared/time/shading.js";
import { MoveGhost } from "../shared/schedule/move-ghost.js";
import { gripCoord, laneCoord, rowCoord, type AllocationDrag, type Target } from "./drag.js";
import { familyOf, layoutLinks, type FamilyLink } from "./links.js";
import { NarrowedEmpty } from "./narrowed.js";
import { a, one, useNouns } from "./nouns.js";
import { CARD_H, HOUR_W, LABEL_W, MIN_DAY, ROW_H, SHORT_DAY, axisFraction, axisSpan, laneGrid, resourceAxis, type LaneCard, type ResourceAxis } from "./timeline-layout.js";
import {
    allocationWords, compareDate, partsOf, sameParts, type AllocationDomain, type AllocationStyles, type AllocationValue, type Bin, type Context, type Day, type Fit,
    type Issue, type Load, type ResourceLine, type ResourceRow, type Selection, type Slot,
} from "./model.js";

/** The panes' head, the recipe's: the rows sit under it. */
const HEAD = 48;
const NO_ISSUES: readonly Issue[] = [];

/** How a selection asks to be followed (A12): `soft` leaves the resource pane where it is when the row is in view. */
export interface TimelineFollow { nonce: number; soft: boolean }

/** A selected link (A68): its bin's part on a resource. */
export interface SelectedLink { bin: string; resource: string }

/** The Timeline's props. */
export interface TimelineProps {
    value: AllocationValue;
    context: Context;
    styles: AllocationStyles;
    format: Formatters;
    /** The plan day. */
    day: Date;
    /** The day as drafted, and as the record holds it. */
    plan: Day;
    held: Day | undefined;
    /** Whether two bins are the same: one unlike the record's is a draft. */
    sameBin: (a: Bin, b: Bin) => boolean;
    /** Every resource's load. */
    loads: SortedMap<string, Load>;
    /** The day's slots. */
    slots: readonly Slot[];
    /** Every issue: the app's flags on its bins. */
    issues: readonly Issue[];
    /** The resources the narrowing shows, by key; `none` for every one. */
    visible: option<Set<string>>;
    /** The lanes the narrowing shows, by key; `none` for every one (#1336). */
    visibleLanes: option<Set<string>>;
    /** The events the narrowing shows, by key; `none` for every one: a bin of a hidden event has no card (#1339). */
    visibleEvents: option<Set<string>>;
    /** Clears the narrowing, where nothing shows; `undefined` with no narrowing. */
    clearFilters: (() => void) | undefined;
    selection: Selection | undefined;
    /** The focus (A13). */
    focus: string | undefined;
    /** The event whose every bin the Library's Allocated card highlights (A10). */
    highlight: string | undefined;
    /** Whether a Library event is picked (A11): its free lane hours show, and a click there or on a ranked resource books it. */
    picked: boolean;
    /** Books the picked event where a click lands, as its drop would (A11). */
    book: (target: Target) => void;
    /** Whether the day takes edits. */
    editable: boolean;
    select: (next: Selection | undefined) => void;
    /** A connector clicked: its bin's resource Chooser, in the inspector (A21). */
    choose: (bin: string) => void;
    follow: TimelineFollow;
    /** The selected link (A68), and selecting one: its bin and the link. */
    link: SelectedLink | undefined;
    selectLink: (link: SelectedLink) => void;
    /** Unlinks a bin's part on a resource: the selected link's ×. */
    unlink: (bin: string, resource: string) => void;
    /** The board's drags (#1328). */
    drag: AllocationDrag;
    /** A question's candidates: what a ranked fit's preview bar shows (A28), e3-ui's own arithmetic. */
    candidates: AllocationDomain["candidates"];
}

/** A drop cell's veto and caption for a target: the board's one verdict (§10). */
function dropOptions(drag: AllocationDrag, target: Target, hover?: (allowed: boolean) => void) {
    return {
        veto: (candidate: DragEventValue) => { const grip = drag.gripOfEvent(candidate); return grip !== undefined && drag.verdict(grip, target).allowed; },
        options: {
            accepts: (payload: DragPayload) => drag.gripOfPayload(payload) !== undefined,
            caption: (_coord: unknown, payload: DragPayload, allowed: boolean) => {
                hover?.(allowed);
                const grip = drag.gripOfPayload(payload);
                if (grip === undefined) return undefined;
                const verdict = drag.verdict(grip, target);
                return { text: verdict.caption, warn: verdict.warn };
            },
        },
    };
}

/** A refusing run's label (A27): `✕ Over max · 3 resources · by 4–13 m³`, over the rows it gathers. */
interface RefusalRun { from: number; to: number; label: string; meta: string; tip: string }

/** A fit's refusal. */
type Refused = Extract<Fit, { type: "refused" }>["value"];

/**
 * The runs of contiguous rows refusing for one reason (A27), each labelled by
 * its group, how many it gathers, and the range of its measures: `by 4–13 m³`,
 * `next job Wed 19 – Thu 20`, `until Fri 14 – Sat 15`; its tooltip every row's reason.
 */
function refusalRuns(verdicts: readonly (Fit | undefined)[], words: ReturnType<typeof allocationWords>, unit: string): RefusalRun[] {
    const out: RefusalRun[] = [];
    let run: { from: number; to: number; refusals: Refused[] } | undefined;
    const close = () => {
        if (run === undefined) return;
        const n = run.to - run.from + 1, refusals = run.refusals;
        const lead = refusals.map(r => r.measure.type === "none" ? undefined : r.measure.value.lead).find(l => l !== undefined);
        const amounts = refusals.flatMap(r => r.measure.type === "amount" ? [r.measure.value.value] : []);
        const days = [...new Set(refusals.flatMap(r => r.measure.type === "day" ? [r.measure.value.at] : []).sort(compareDate).map(at => formatDatePattern("ddd D", at)))];
        let detail = "";
        if (amounts.length > 0) {
            const lo = Math.min(...amounts), hi = Math.max(...amounts);
            detail = `${lead} ${lo === hi ? words.quantity(lo, unit) : `${words.quantity(lo, "")}–${words.quantity(hi, unit)}`}`;
        } else if (days.length > 0) detail = `${lead} ${days.length > 1 ? `${days[0]} – ${days.at(-1)}` : days[0]}`;
        out.push({ from: run.from, to: run.to, label: refusals[0]!.group, meta: [n > 1 ? `${n} resources` : "", detail].filter(part => part !== "").join(" · "),
            tip: refusals.map(r => r.reason).join(" · ") });
        run = undefined;
    };
    verdicts.forEach((verdict, i) => {
        const refusal = verdict?.type === "refused" ? verdict.value : undefined;
        if (refusal !== undefined && run !== undefined && run.refusals[0]!.group === refusal.group) { run.to = i; run.refusals.push(refusal); return; }
        close();
        if (refusal !== undefined) run = { from: i, to: i, refusals: [refusal] };
    });
    close();
    return out;
}

/** The fits marker (A31): where the #1 fit lies out of view, and what it says. */
interface Marker { side: "above" | "below" | "hidden"; label: string; resource: string }

/**
 * The fits marker, when the #1 fit's row is out of the resource pane's view
 * (A31): `2 fits below · #1 K-103 · drop here`, or `#1 K-601 is hidden by
 * Filters · drop here` when the narrowing hides it.
 */
function fitsMarker(ranks: readonly string[], rowIndex: ReadonlyMap<string, number>, top: number, view: number, nameOf: (key: string) => string): Marker | undefined {
    const best = ranks[0];
    if (best === undefined || view <= 0) return undefined;
    const at = rowIndex.get(best), name = nameOf(best);
    if (at === undefined) return { side: "hidden", label: `#1 ${name} is hidden by Filters · drop here`, resource: best };
    const inView = (i: number) => i * ROW_H >= top && i * ROW_H + ROW_H <= top + view;
    if (inView(at)) return undefined;
    const below = at * ROW_H > top;
    const n = ranks.filter(key => { const i = rowIndex.get(key); return i !== undefined && !inView(i) && i * ROW_H > top === below; }).length;
    return { side: below ? "below" : "above", label: `${plural(n, "fit")} ${below ? "below" : "above"} · #1 ${name} · drop here`, resource: best };
}

/** A lane hour: a drop target for a bin's body (A14, A37). */
function LaneCellView({ props, lane, at, free, style, onRest }: { props: TimelineProps; lane: string; at: Date; free: boolean; style: CSSProperties; onRest: () => void }) {
    const { drag, styles } = props;
    const { veto, options } = dropOptions(drag, { kind: "lane", lane, at, card: undefined }, onRest);
    const ref = useDropCell(drag.enabled ? laneCoord(drag.surface, lane, at) : null, false, veto, undefined, options);
    return <Box ref={ref} css={styles.laneCell} data-allocation-cell={`${lane}|${at.getTime()}`} data-free={free ? "" : undefined} style={style}
        onClick={() => { if (props.picked && free && props.editable) props.book({ kind: "lane", lane, at, card: undefined }); else props.select(undefined); }}>
        {free && <Box as="span" css={styles.lanePlaceholder} data-allocation-placeholder="" />}
    </Box>;
}

/** The fits marker over the rows (A31): a drop on it goes to the #1. */
function FitsMarker({ props, marker, top }: { props: TimelineProps; marker: Marker; top: number }) {
    const { drag, styles } = props;
    const { veto, options } = dropOptions(drag, { kind: "resource", resource: marker.resource });
    const ref = useDropCell(drag.enabled ? rowCoord(drag.surface, marker.resource) : null, false, veto, undefined, options);
    return <Box ref={ref} css={styles.fitsMarker} data-allocation-marker={marker.side} style={{ top: `${top}px` }}>
        <FontAwesomeIcon icon={marker.side === "hidden" ? faFilter : marker.side === "below" ? faArrowDown : faArrowUp} aria-hidden="true" />{marker.label}
    </Box>;
}

/** `1 bin`, `9 bins`. */
const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? "" : "s"}`;
/**
 * Scrolls a virtualised pane to a row's offset, already on the rows' grid. Its
 * snap waits for the rows there to mount: snapping now would land on the
 * nearest row mounted before the scroll.
 */
function scrollRowsTo(pane: HTMLElement, top: number) {
    if (pane.scrollTop === top) return;
    pane.setAttribute("data-snap-suspended", "");
    pane.scrollTop = top;
    requestAnimationFrame(() => requestAnimationFrame(() => pane.removeAttribute("data-snap-suspended")));
}

/** Enter or Space acts as a click. */
const onActivate = (act: () => void) => (event: KeyboardEvent) => {
    if (event.key === "Enter" || event.key === " ") { event.preventDefault(); act(); }
};

/**
 * The Timeline (see the module docs).
 *
 * @param props - See {@link TimelineProps}
 * @returns The three panes under their head
 */
export function AllocationTimeline(props: TimelineProps) {
    const { value, context, styles, plan, day, loads, slots } = props;
    const words = allocationWords();
    const nouns = useNouns();
    const unit = context.unit;
    // The lanes the narrowing shows, in their order: a hidden lane's column goes, with its cards and its slots (#1336).
    const lanes = useMemo(() => value.lanes.filter(lane => props.visibleLanes.type === "none" || props.visibleLanes.value.has(lane.key)), [value.lanes, props.visibleLanes]);
    // A bin of an event the narrowing hides has no card; a reservation, which has no event, stays (#1339).
    const { visibleEvents } = props;
    const grid = useMemo(() => laneGrid(lanes.map(lane => lane.key), slots, plan,
        bin => visibleEvents.type === "none" || bin.event.type === "none" || visibleEvents.value.has(bin.event.value)), [lanes, slots, plan, visibleEvents]);
    const axis = useMemo(() => resourceAxis(day, Number(words.ms(value.settings.horizon.before)), Number(words.ms(value.settings.horizon.after))),
        [day, value.settings.horizon, words]);
    const lines = useMemo(() => new Map(value.resources.map(r => [r.key, words.line(day, r, loads.get(r.key)!, unit)] as const)), [value.resources, loads, day, unit, words]);
    // The rows: the resources in key order; the narrowing hides rows, never reorders them (A18).
    const rows = useMemo(() => value.resources.filter(r => props.visible.type === "none" || props.visible.value.has(r.key)), [value.resources, props.visible]);
    const rowIndex = useMemo(() => new Map(rows.map((r, i) => [r.key, i] as const)), [rows]);
    // A resource holding a draft bin draws its load as a draft.
    const { held, sameBin } = props;
    const drafted = useMemo(() => {
        const keys = new Set<string>();
        for (const [id, bin] of plan.bins) {
            const committed = held?.bins.get(id);
            if (committed === undefined || !sameBin(committed, bin)) for (const key of bin.parts.keys()) keys.add(key);
        }
        return keys;
    }, [plan, held, sameBin]);
    const sizes = useMemo(() => rows.map(() => ROW_H), [rows]);
    const getItemKey = useCallback((index: number) => rows[index]!.key, [rows]);
    // The focus's hold, banded across the plot, its days in ink (A13).
    const span = props.focus === undefined ? undefined : loads.get(props.focus)?.hold;
    const focusHold = span?.type === "some" ? span.value : undefined;

    const lanePane = useRef<HTMLDivElement | null>(null);
    const rscPane = useRef<HTMLDivElement | null>(null);
    const ruler = useRef<HTMLDivElement | null>(null);
    const root = useRef<HTMLDivElement | null>(null), gridBox = useRef<HTMLDivElement | null>(null), channel = useRef<HTMLDivElement | null>(null);
    // A drag near a pane's top or bottom scrolls it a row at a time, on the rows' grid (A25): the shared edge scroller's row step.
    useLayoutEffect(() => { rscPane.current?.setAttribute("data-edge-scroll-row", String(ROW_H)); });

    // A drag (#1328, #1330): what is dragged; for a connector's, a link's, a Library event's or a removed bin's — or the pick's,
    // with no drag under way (A11) — every resource's verdict, the fit's (A27–A29).
    const { drag } = props;
    const grip = drag.grip, subject = drag.subject;
    const ranking = subject !== undefined && subject.kind !== "body" && subject.kind !== "resource";
    const marking = ranking && grip !== undefined;
    const verdicts = ranking ? drag.answer?.resources : undefined;
    const dragged = ranking ? drag.asked : undefined;
    // A resource card's drag (A32): the bins that refuse it, and whether a free lane hour would take a reservation of it.
    const taking = grip?.kind === "resource" ? grip.resource : undefined;
    const takes = taking === undefined ? undefined : drag.answer;
    const reserveRefused = takes?.reserve.type === "some" && takes.reserve.value.type === "refused";
    // A ranked fit's preview: the load it leaves, for the hold (A28) — e3-ui's candidates, never the renderer's arithmetic.
    const answer = drag.answer;
    const previews = useMemo(() => {
        const out = new Map<string, { after: number; to: Date }>();
        if (!ranking || dragged === undefined || answer === undefined) return out;
        for (const c of props.candidates({ day, plan: dragged.of ?? plan, ask: dragged.ask, context })) out.set(c.resource.key, { after: c.after, to: c.hold.to });
        return out;
        // The answer stands for its question: a new question is a new answer.
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [ranking, answer, plan, day, context]);
    // Each run of contiguous rows refusing for one reason gathers under one label (A27).
    const runs = useMemo((): RefusalRun[] => verdicts === undefined ? [] : refusalRuns(rows.map(r => verdicts.get(r.key)), words, unit), [verdicts, rows, words, unit]);

    // The links (A65–A68): the focus's family, through the channel; none at rest and none on hover.
    const family = useMemo(() => props.focus === undefined ? [] : familyOf(plan, held, props.focus), [plan, held, props.focus]);
    const linking = family.length > 0;
    const laneTop = useScrollTop(lanePane, linking), rowsTop = useScrollTop(rscPane, linking || marking);
    // The fits out of view, marked at the pane's edge over the rows; a drop on it goes to the #1 (A31).
    const [rowsView, setRowsView] = useState(0);
    useLayoutEffect(() => { if (marking && rscPane.current !== null) setRowsView(rscPane.current.clientHeight - HEAD); }, [marking]);
    const marker = marking ? fitsMarker(drag.ranks, rowIndex, rowsTop, rowsView, key => context.resources.get(key)?.label ?? key) : undefined;
    // While a drag rests on a row, its bins outline for the verdict and its run's label steps aside (A27, A29) —
    // marked on the elements, so pointer motion repaints no card (A35).
    const hover = useCallback((resource: string | undefined, index: number | undefined, allowed: boolean) => {
        const box = root.current;
        if (box === null) return;
        for (const el of box.querySelectorAll("[data-drop-target]")) el.removeAttribute("data-drop-target");
        for (const el of box.querySelectorAll("[data-run][data-pointer]")) el.removeAttribute("data-pointer");
        if (resource === undefined || index === undefined) return;
        for (const el of box.querySelectorAll(`[data-allocation-card]`)) {
            if ((el.getAttribute("data-resources") ?? "").split(" ").includes(resource)) el.setAttribute("data-drop-target", allowed ? "fits" : "refused");
        }
        for (const el of box.querySelectorAll<HTMLElement>("[data-run]")) {
            if (Number(el.dataset.from) <= index && index <= Number(el.dataset.to)) el.setAttribute("data-pointer", "");
        }
    }, []);
    useEffect(() => { if (grip === undefined) hover(undefined, undefined, false); }, [grip, hover]);
    // Where they run: the lane grid's left edge and the channel's right edge, in the board's px, and the panes' view.
    const [view, setView] = useState<{ gridLeft: number; channelRight: number; height: number }>();
    useLayoutEffect(() => {
        const box = root.current;
        if (!linking || box === null) return undefined;
        const measure = () => {
            const at = box.getBoundingClientRect(), from = gridBox.current?.getBoundingClientRect(), to = channel.current?.getBoundingClientRect();
            if (from === undefined || to === undefined) return;
            const next = { gridLeft: from.left - at.left, channelRight: to.right - at.left, height: Math.max(0, at.height - HEAD) };
            setView(before => before !== undefined && before.gridLeft === next.gridLeft && before.channelRight === next.channelRight && before.height === next.height ? before : next);
        };
        measure();
        const observer = new ResizeObserver(measure);
        observer.observe(box);
        return () => observer.disconnect();
    }, [linking]);
    const cardOf = useMemo(() => new Map(grid.cards.map(card => [card.id, card] as const)), [grid]);
    const codeOf = (bin: string) => { const event = plan.bins.get(bin)?.event; return event?.type === "some" ? context.events.get(event.value)?.label ?? event.value : ""; };
    const selectedLink = props.link === undefined ? undefined : family.find(l => l.bin === props.link!.bin && l.resource === props.link!.resource)?.id;
    const ribbons = useMemo(() => view === undefined || !linking ? [] : layoutLinks(family, cardOf, rowIndex, { ...view, laneTop, rowsTop },
        link => words.quantity(link.quantity!, unit), selectedLink), [view, linking, family, cardOf, rowIndex, laneTop, rowsTop, words, unit, selectedLink]);
    const linkOf = (ribbon: LinkRibbon): FamilyLink => (ribbon as (typeof ribbons)[number]).link;
    const linkName = (link: FamilyLink) => link.quantity === undefined ? "the reservation" : `${codeOf(link.bin)}, ${words.quantity(link.quantity, unit)}`;
    const [lit, setLit] = useState<number | null>(null);
    const litLink = lit === null ? undefined : family[lit];
    // Under 36px a day, its tick shows its number only.
    const short = useContainerBelow(ruler, axis.days.length * SHORT_DAY);
    const time = useMemo(() => timeWords(props.format.locale), [props.format.locale]);
    const ticks = useMemo(() => timeScale({ window: { min: axis.from, max: axis.to }, resolution: "day", format: short ? "DD" : "dd DD", words: time })!, [axis, short, time]);
    const weeks = useMemo(() => {
        const units = timeRulerUnits(ticks, time, "week")!;
        // `W19 · May 10` for a week that starts in view, `W18` for one cut at the axis's start.
        return { ...units, buckets: units.buckets.map(b => ({ ...b, label: `${time.m.rulerWeek({ week: time.number(isoWeekUTC(b.start)) })}${b.start.getTime() >= axis.from.getTime() ? ` · ${props.format.monthDay(b.start)}` : ""}` })) };
    }, [ticks, time, axis, props.format]);

    // Selecting follows the selection (A12): a bin scrolls the lane grid to it, a third from the top, and the resource
    // pane so its row sits level with it, snapped to rows; a resource scrolls its row into view.
    const selectionRef = useRef(props.selection);
    selectionRef.current = props.selection;
    useLayoutEffect(() => {
        const lane = lanePane.current, rsc = rscPane.current, selection = selectionRef.current;
        if (props.follow.nonce === 0 || lane === null || rsc === null || selection === undefined) return;
        const rowsView = rsc.clientHeight - HEAD;
        if (selection.type === "resource") {
            const at = rowIndex.get(selection.key);
            if (at === undefined) return;
            const y = at * ROW_H, top = rsc.scrollTop;
            if (y < top || y + ROW_H > top + rowsView) scrollRowsTo(rsc, Math.max(0, Math.round((y - rowsView / 3) / ROW_H) * ROW_H));
            return;
        }
        if (selection.type !== "bin") return;
        const card = grid.cards.find(c => c.id === selection.id);
        if (card === undefined) return;
        const y = card.row * ROW_H + 4, laneView = lane.clientHeight - HEAD;
        if (y < lane.scrollTop || y + CARD_H > lane.scrollTop + laneView) lane.scrollTop = Math.max(0, Math.round((y - 4 - laneView / 3) / ROW_H) * ROW_H);
        const resource = partsOf(card.bin)[0]?.key, at = resource === undefined ? undefined : rowIndex.get(resource);
        if (at === undefined) return;
        if (props.follow.soft && at * ROW_H >= rsc.scrollTop && at * ROW_H + ROW_H <= rsc.scrollTop + rowsView) return;
        const level = y + CARD_H / 2 - lane.scrollTop;
        const max = rsc.scrollHeight - rsc.clientHeight;
        scrollRowsTo(rsc, Math.max(0, Math.min(Math.floor(max / ROW_H) * ROW_H, Math.round((at * ROW_H + ROW_H / 2 - level) / ROW_H) * ROW_H)));
        // The follow request is the trigger.
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [props.follow.nonce]);

    // A narrowing that leaves no lane or no resource leaves nothing to plan on.
    if (lanes.length === 0 || rows.length === 0) return <NarrowedEmpty styles={styles} clear={props.clearFilters} />;
    const vars = { "--allocation-lanes": lanes.length, "--allocation-rows": grid.rows, "--allocation-days": axis.days.length } as CSSProperties;
    const flags = props.issues.length === 0 ? NO_ISSUES : props.issues;
    return <Box ref={root} css={styles.timeline} style={vars} data-allocation-timeline="" data-allocation-drag={grip?.kind}
        data-allocation-pick={props.picked && grip === undefined ? "" : undefined} data-reserve={reserveRefused ? "refused" : undefined}>
        <Box ref={lanePane} css={styles.lanePane} data-allocation-lanes="" data-edge-scroll-row={ROW_H}>
            <Box css={styles.laneContent}>
                <Box css={[styles.head, styles.laneHead]}>
                    <Box data-head-caption="" css={styles.headCaption}><span>{nouns.lane.one}</span><span>Hour</span></Box>
                    {lanes.map((lane, i) => {
                        const head = grid.heads[i]!;
                        const minute = head.first === undefined ? "" : formatDatePattern("mm", head.first);
                        return <Box key={lane.key} css={styles.laneHeadCell} data-allocation-lane={lane.key}>
                            <Box as="span" css={styles.laneName} title={`${lane.label} takes one bin at :${minute} past each ${value.every.type === "hours" ? "hour" : "slot"}`}>
                                {lane.label}<Box as="span" css={styles.laneOffset}>at :{minute}</Box>
                            </Box>
                            <Box as="span" css={styles.laneMeta} title={`Bins booked in this ${one(nouns.lane)} today${unit === "" ? "" : ` · ${unit}`}`}>
                                {plural(head.bins, "bin")} · {words.quantity(head.quantity, unit)}
                            </Box>
                        </Box>;
                    })}
                </Box>
                <Box ref={gridBox} css={styles.laneGrid} data-allocation-grid="">
                    {grid.bands.map(band => <Box key={band.slot} css={styles.laneBand} style={{ "--band-row": band.row, "--band-span": band.span } as CSSProperties} data-allocation-band={band.slot}>
                        <Box as="span" css={styles.laneHour}>{formatDatePattern(value.every.type === "hours" ? "HH" : "HH:mm", band.at)}</Box>
                    </Box>)}
                    {grid.cells.map(cell => <LaneCellView key={`${cell.lane}:${cell.slot}`} props={props} lane={lanes[cell.lane]!.key} at={cell.at} free={cell.free}
                        style={{ "--cell-lane": cell.lane, "--cell-row": grid.bands[cell.slot]!.row, "--cell-span": grid.bands[cell.slot]!.span } as CSSProperties} onRest={() => hover(undefined, undefined, false)} />)}
                    {grid.cards.map(card => <Card key={card.id} card={card} props={props} lines={lines} flags={flags} lit={litLink?.bin === card.id} onRest={() => hover(undefined, undefined, false)}
                        refuses={taking !== undefined && !card.bin.parts.has(taking) && takes?.bins.get(card.id)?.type === "refused"} />)}
                </Box>
            </Box>
        </Box>
        <Box ref={channel} css={styles.channel} data-allocation-channel="">
            <Box css={styles.channelHead} title="Links run through this channel"><span /><span><FontAwesomeIcon icon={faLink} /></span></Box>
        </Box>
        <VirtualRows fillParent height={undefined} maxHeight={undefined} rootCss={styles.resourcePane} minWidth={`calc(${LABEL_W}px + ${axis.days.length * MIN_DAY}px)`}
            scrollElRef={rscPane} headerZIndex={6} count={rows.length} getItemKey={getItemKey} sizes={sizes} measureRows={false}
            overlay={runs.length === 0 && marker === undefined ? null : <>
                {runs.map(run => <Box key={run.from} css={styles.runLabel} title={run.tip} data-run="" data-from={run.from} data-to={run.to}
                    style={{ top: `${(run.from + run.to + 1) * ROW_H / 2 - 10}px` }}>
                    <FontAwesomeIcon icon={faXmark} aria-hidden="true" />{run.label}<Box as="span" css={styles.runMeta}>{run.meta}</Box>
                </Box>)}
                {marker !== undefined && <FitsMarker props={props} marker={marker} top={marker.side === "above" ? rowsTop + 12 : rowsTop + Math.max(0, rowsView - 40)} />}
            </>}
            header={<Box css={[styles.head, styles.resourceHead]} data-allocation-resource-head="">
                <Box data-head-caption="" css={styles.headCaption}><span>Week</span><span>{nouns.resource.one}</span></Box>
                <Box ref={ruler} css={styles.ruler}>
                    <TimeRulerRow scale={weeks} styles={styles} band="units" owner="allocation" />
                    <TimeRulerRow scale={ticks} styles={styles} band="ticks" owner="allocation" highlight={axis.today}
                        marked={bucket => focusHold !== undefined && bucket.start.getTime() >= day.getTime() && bucket.start.getTime() < focusHold.to.getTime()} />
                </Box>
            </Box>}
            renderRow={index => {
                const resource = rows[index]!;
                const rank = drag.ranks.indexOf(resource.key);
                return <ResourceRowView resource={resource} line={lines.get(resource.key)!} load={loads.get(resource.key)!} axis={axis} props={props}
                    focusHold={focusHold} draft={drafted.has(resource.key)} lit={litLink?.resource === resource.key}
                    verdict={verdicts?.get(resource.key)} rank={ranking && rank >= 0 ? rank + 1 : undefined} preview={previews.get(resource.key)}
                    quantity={dragged?.quantity} onRest={allowed => hover(resource.key, index, allowed)} />;
            }} />
        {view !== undefined && ribbons.length > 0 && <Box css={styles.links} data-allocation-links="" style={{ height: view.height }}>
            <LinksLayer ribbons={ribbons} width={view.channelRight} height={view.height} halo={false} onLit={setLit}
                clip={{ left: view.gridLeft + HOUR_W, width: Math.max(0, view.channelRight - view.gridLeft - HOUR_W) }}
                selected={selectedLink} onUnlink={props.editable ? id => { const link = family[id]; if (link !== undefined) props.unlink(link.bin, link.resource); } : undefined}
                unlinkLabel={ribbon => `Unlink ${codeOf(linkOf(ribbon).bin)} · Delete`}
                hit={ribbon => {
                    const link = linkOf(ribbon), name = `${selectedLink === ribbon.id ? "Selected link" : "Link"} of ${linkName(link)}`;
                    return { "data-allocation-link": `${link.bin}|${link.resource}`, "aria-label": name, children: <title>{`Link of ${linkName(link)} · click to select`}</title>,
                        onClick: () => props.selectLink({ bin: link.bin, resource: link.resource }) };
                }}
                caption={ribbon => {
                    const link = linkOf(ribbon), selected = selectedLink === ribbon.id;
                    return { role: "button", "aria-label": `${selected ? "Selected link" : "Link"} of ${linkName(link)}`, "data-allocation-caption": `${link.bin}|${link.resource}`,
                        title: !props.editable ? `Link of ${linkName(link)}` : selected ? "Selected · × or Delete removes the link" : `Click to select the link, then Delete · drag onto ${a(nouns.resource)} row to move it`,
                        onClick: () => props.selectLink({ bin: link.bin, resource: link.resource }) };
                }} />
        </Box>}
    </Box>;
}

interface CardProps {
    card: LaneCard; props: TimelineProps; lines: ReadonlyMap<string, ResourceLine>; flags: readonly Issue[]; lit: boolean;
    /** During a resource card's drag, whether the fit refuses this bin on it (A32). */
    refuses: boolean;
}
type DragHandle = ReturnType<typeof useDragEventChip>;

/**
 * A bin's card (A16, A21): the shared drag hooks here, outside the card's
 * body, so pointer motion repaints nothing in it (A35, the Roster's chips).
 */
function Card({ onRest, ...args }: CardProps & { onRest: () => void }) {
    const { card, props } = args;
    const { styles, context, drag } = props;
    const { id, bin } = card;
    const words = allocationWords();
    const event = bin.event.type === "some" ? context.events.get(bin.event.value) : undefined;
    const code = bin.event.type === "none" ? undefined : event?.label ?? bin.event.value;
    const label = useMemo(() => code === undefined ? "Reserved" : `${code} · ${words.quantity(bin.quantity, context.unit)}`, [code, words, bin.quantity, context.unit]);
    // The card body drags the bin between lane hours (A24); its connector drags what it carries onto a resource (A21).
    const ghost = useMemo(() => <MoveGhost styles={styles} label={label} />, [styles, label]);
    const bodyAt = useMemo(() => drag.enabled ? gripCoord(drag.surface, { kind: "body", bin: id }) : null, [drag.enabled, drag.surface, id]);
    const portAt = useMemo(() => drag.enabled ? gripCoord(drag.surface, { kind: "port", bin: id }) : null, [drag.enabled, drag.surface, id]);
    const body = useDragEventChip(bodyAt, ghost, false, label);
    const port = useDragEventChip(portAt, ghost, false, label);
    // A card is its lane hour's drop target too, and a reservation's a bin fills (A38).
    const { veto, options } = dropOptions(drag, { kind: "lane", lane: bin.lane, at: card.slotAt, card: id }, onRest);
    const drop = useDropCell(drag.enabled ? laneCoord(drag.surface, bin.lane, card.slotAt, id) : null, false, veto, undefined, options);
    const bodyRef = body?.ref;
    const attach = useCallback((el: HTMLElement | null) => { bodyRef?.(el); drop(el); }, [bodyRef, drop]);
    return <CardBody {...args} body={body} port={port} attach={attach} />;
}

/** A card's body: what it says, from the drafts and the issues. */
const CardBody = memo(function CardBody({ card, props, lines, flags, lit, refuses, body, port, attach }: CardProps & { body: DragHandle; port: DragHandle; attach: (el: HTMLElement | null) => void }) {
    const { styles, context, value, drag } = props;
    const { id, bin } = card;
    const words = allocationWords();
    const nouns = useNouns();
    const reserved = bin.event.type === "none";
    const event = bin.event.type === "some" ? context.events.get(bin.event.value) : undefined;
    const code = reserved ? "Reserved" : event?.label ?? (bin.event.type === "some" ? bin.event.value : "");
    const parts = partsOf(bin);
    const resource = parts[0] === undefined ? undefined : context.resources.get(parts[0].key);
    const line = resource === undefined ? undefined : lines.get(resource.key);
    const committed = props.held?.bins.get(id);
    const draft = committed === undefined || !props.sameBin(committed, bin);
    const linkDraft = draft && (committed === undefined || !sameParts(committed.parts, bin.parts));
    // Selected, or one of the bins the Library's Allocated card highlights (A10).
    const selected = (props.selection?.type === "bin" && props.selection.id === id) || (props.highlight !== undefined && bin.event.type === "some" && bin.event.value === props.highlight);
    // Outside the focus, a card dims (A13): any but the selected one and the focus's own.
    const dimming = props.selection?.type === "bin" || props.selection?.type === "resource";
    const dim = dimming && !selected && (props.focus === undefined || !bin.parts.has(props.focus));
    const lane = value.lanes.find(l => l.key === bin.lane)?.label ?? bin.lane;
    const at = `${lane} ${formatDatePattern("HH:mm", bin.at)}`;
    const qty = words.quantity(bin.quantity, context.unit);
    const to = resource === undefined ? "" : `${resource.label}${parts.length > 1 ? ` + ${parts.length - 1}` : ""}`;
    const moves = props.editable ? ` · drag to another ${one(nouns.lane)} hour to move it` : "";
    const tip = reserved
        ? `Reserved · ${at}${resource === undefined ? "" : ` on ${resource.label}`} · no ${one(nouns.event)} yet${moves}`
        : `${code}${event?.meta.type === "some" ? ` · ${event.meta.value}` : ""} · ${qty} · ${at}${resource === undefined ? " · not linked" : ` on ${to}`}${moves}`;
    const marks: ReactNode[] = [];
    for (const issue of flags) {
        if (issue.bin.type === "some" && issue.bin.value === id && issue.flag.type === "some") {
            marks.push(<Box key={`flag:${marks.length}`} as="span" css={styles.cardMark} data-mark="flag" title={issue.title}>{issue.flag.value}</Box>);
        }
    }
    if (line?.overlap === true && !line.over) marks.push(<Box key="overlap" as="span" css={styles.cardMark} data-mark="overlap" title="Overlaps the next job"><FontAwesomeIcon icon={faTriangleExclamation} aria-label="Overlaps the next job" /></Box>);
    if (line?.over === true) marks.push(<Box key="over" as="span" css={styles.cardMark} data-mark="over" title="Over max"><FontAwesomeIcon icon={faCircleExclamation} aria-label="Over max" /></Box>);
    if (line?.under === true && !line.over && resource !== undefined) {
        const load = props.loads.get(resource.key)!;
        const why = `${resource.label} is under its minimum: ${words.load(load.fill, resource, context.unit)}`;
        marks.push(<Box key="under" as="span" css={styles.cardMark} data-mark="under" title={why}><FontAwesomeIcon icon={faArrowDown} aria-label="Under minimum" /></Box>);
    }
    const connector = resource === undefined
        ? `Drag the connector onto ${a(nouns.resource)} to allocate ${reserved ? "this reservation" : code} · click to choose one`
        : `Allocated to ${to} · drag the connector onto ${a(nouns.resource)} to move it · click to choose another`;
    return <Box {...body} ref={attach} css={styles.card} role="button" tabIndex={0} title={tip} aria-label={tip} aria-pressed={selected}
        data-scope="allocation" data-allocation-card={id} data-resources={parts.map(p => p.key).join(" ")} data-reserved={reserved ? "" : undefined}
        data-draft={draft ? "" : undefined} data-selected={selected ? "" : undefined} data-dim={dim ? "" : undefined} data-link-lit={lit ? "" : undefined}
        data-refuses={refuses ? "" : undefined}
        data-draggable={body !== undefined ? "" : undefined} style={{ "--card-lane": card.lane, "--card-row": card.row } as CSSProperties}
        onPointerDown={event => { drag.arm({ kind: "body", bin: id }); body?.onPointerDown?.(event); }}
        onClick={() => props.select({ type: "bin", id })}
        onKeyDown={event => { if (event.key === "Enter") { event.preventDefault(); props.select({ type: "bin", id }); } else { if (event.key === " ") drag.arm({ kind: "body", bin: id }); body?.onKeyDown?.(event); } }}>
        <Box as="span" css={styles.cardTop}>
            <Box as="span" css={styles.cardCode} data-allocation-code="">{code}</Box>
            {!reserved && <Box as="span" css={styles.cardQty}>{qty}</Box>}
        </Box>
        <Box as="span" css={styles.cardLine}>
            <Box as="span" css={styles.cardTo} data-allocation-to="">
                {resource === undefined
                    ? <><FontAwesomeIcon icon={faLinkSlash} /><span data-unlinked="">not linked</span></>
                    : <><FontAwesomeIcon icon={faArrowRight} />{to}</>}
            </Box>
            {marks}
        </Box>
        {props.editable && <chakra.button type="button" {...port} css={styles.connector} aria-label={connector} title={connector} data-allocation-connector={id}
            onPointerDown={event => { event.stopPropagation(); drag.arm({ kind: "port", bin: id }); port?.onPointerDown?.(event); }}
            onKeyDown={event => { event.stopPropagation(); if (event.key === " ") { drag.arm({ kind: "port", bin: id }); port?.onKeyDown?.(event); } }}
            onClick={event => { event.stopPropagation(); props.choose(id); }}>
            <Box as="span" css={styles.connectorMark} data-state={resource === undefined ? "unlinked" : linkDraft ? "draft" : undefined} />
        </chakra.button>}
    </Box>;
});

interface ResourceRowProps {
    resource: ResourceRow; line: ResourceLine; load: Load; axis: ResourceAxis; props: TimelineProps; focusHold: { from: Date; to: Date } | undefined; draft: boolean; lit: boolean;
    /** During a connector's or a link's drag: the fit's verdict here, its rank among the three best, the load it would leave for the hold, and the quantity it carries. */
    verdict: Fit | undefined; rank: number | undefined; preview: { after: number; to: Date } | undefined; quantity: number | undefined;
}

/** A resource's row (A18–A20): a drop target for a connector or a link (A39), and a body's refusal (§10) — its hook outside the row's body (A35). */
function ResourceRowView({ onRest, ...args }: ResourceRowProps & { onRest: (allowed: boolean) => void }) {
    const { drag } = args.props;
    const { veto, options } = dropOptions(drag, { kind: "resource", resource: args.resource.key }, onRest);
    const drop = useDropCell(drag.enabled ? rowCoord(drag.surface, args.resource.key) : null, false, veto, undefined, options);
    return <ResourceRowBody {...args} drop={drop} />;
}

/** A resource's row: its label cell and its plot. */
const ResourceRowBody = memo(function ResourceRowBody({ resource, line, load, axis, props, focusHold, draft, lit, verdict, rank, preview, quantity, drop }: ResourceRowProps & { drop: (el: HTMLElement | null) => void }) {
    const { styles, context, day } = props;
    const words = allocationWords();
    const focus = props.focus === resource.key;
    // With an event picked, a click on a ranked resource books it onto it (A11, A36).
    const select = () => { if (props.picked && rank !== undefined && props.editable) props.book({ kind: "resource", resource: resource.key }); else props.select({ type: "resource", key: resource.key }); };
    const shades = useMemo(() => shadeBands({ min: axis.from, max: axis.to }, {}), [axis]);
    const mondays = useMemo(() => axis.days.filter((d, i) => i > 0 && d.getUTCDay() === 1), [axis]);
    const hold = load.hold.type === "some" ? load.hold.value : undefined;
    const bar = (key: string, from: Date, to: Date, attrs: Record<string, string | undefined>, label: string) => {
        const at = axisSpan(axis, from, to);
        return at === undefined ? null : <Box key={key} css={styles.bar} style={at} {...attrs}><Box as="span" css={styles.barLabel}>{label}</Box></Box>;
    };
    // What a refusal is about, outlined (A27): the load for an amount (`over max by 4 m³`), the job a day names (`busy until`, `next job`).
    const measure = verdict?.type === "refused" ? verdict.value.measure : undefined;
    const about = (job: { start: Date; end: Date }) => measure?.type === "day" && (compareDate(job.start, measure.value.at) === 0 || compareDate(job.end, measure.value.at) === 0);
    const loadSpan = hold === undefined ? undefined : axisSpan(axis, day, hold.to);
    const overlap = line.overlap && line.next.type === "some" && hold !== undefined ? axisSpan(axis, line.next.value.start, hold.to) : undefined;
    const focusSpan = focusHold === undefined ? undefined : axisSpan(axis, day, focusHold.to);
    const previewSpan = rank === undefined || preview === undefined ? undefined : axisSpan(axis, day, preview.to);
    return <Box ref={drop} css={styles.resourceRow} role="button" tabIndex={0} aria-label={`${resource.label}, ${line.text}`} aria-pressed={focus}
        data-allocation-resource={resource.key} data-selected={focus ? "" : undefined} data-refused={verdict?.type === "refused" ? "" : undefined}
        data-ranked={rank !== undefined ? "" : undefined} onClick={select} onKeyDown={onActivate(select)}>
        <Box css={styles.resourceLabel}>
            {rank !== undefined && <Box as="span" css={styles.rank} data-allocation-rank="">{rank}</Box>}
            <Box css={styles.resourceText}>
                <Box as="span" css={styles.resourceName}>{resource.label}</Box>
                <Box as="span" css={styles.resourceLine} data-tone={line.tone.type === "neutral" ? undefined : line.tone.type} data-allocation-line="">{line.text}</Box>
            </Box>
        </Box>
        <Box css={styles.plot} data-allocation-plot="">
            {focusSpan !== undefined && <Box css={styles.span} style={focusSpan} data-allocation-span="" />}
            {shades.map((band, i) => <Box key={i} css={styles.shade} style={{ left: `${band.start * 100}%`, width: `${band.width * 100}%` }} />)}
            {mondays.map(monday => <Box key={monday.getTime()} css={styles.weekRule} style={{ left: `${axisFraction(axis, monday) * 100}%` }} />)}
            {resource.jobs.map((job, i) => bar(`job:${i}`, job.start, job.end,
                { "data-kind": job.start.getTime() <= day.getTime() ? "prior" : "next", "data-refusal": about(job) ? "" : undefined }, job.label))}
            {loadSpan !== undefined && hold !== undefined && <Box css={styles.bar} style={loadSpan} data-kind="load" data-allocation-load=""
                data-draft={draft ? "" : undefined} data-over={line.over ? "" : undefined} data-focus={focus ? "" : undefined} data-link-lit={lit ? "" : undefined}
                data-refusal={measure?.type === "amount" ? "" : undefined}>
                <Box as="span" css={styles.barLabel}>{load.fill > 0 ? words.quantity(load.fill, context.unit) : "reserved"}</Box>
            </Box>}
            {overlap !== undefined && <Box css={styles.overlap} style={overlap} data-allocation-overlap="" />}
            {/* A ranked fit's preview: what it would hold, for the hold (A28). */}
            {previewSpan !== undefined && quantity !== undefined && <Box css={styles.bar} style={previewSpan} data-kind="preview" data-allocation-preview="">
                <Box as="span" css={styles.barLabel}>+{words.quantity(quantity, context.unit)} · {words.quantity(preview!.after, context.unit)}</Box>
            </Box>}
            <NowLine styles={styles} at={axisFraction(axis, day)} data-allocation-now="" />
            {/* Its reason, ranked or under the pointer (A29). */}
            {verdict !== undefined && <Box as="span" css={styles.reason} data-allocation-reason="" data-refused={verdict.type === "refused" ? "" : undefined}>
                {verdict.type === "refused" ? <><FontAwesomeIcon icon={faXmark} aria-label="Doesn't fit" /> {verdict.value.reason}</> : verdict.value.why}
            </Box>}
        </Box>
    </Box>;
});
