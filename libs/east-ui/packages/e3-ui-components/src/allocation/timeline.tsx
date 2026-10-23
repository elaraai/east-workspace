/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

/**
 * The Timeline (`Allocation Spec.md` §8, §9.2–§9.3, #1326): one head row over
 * three panes — the lane grid with a card per bin, the link channel, and the
 * resources in their fixed order, each row's plot on the resource axis — and
 * the focus; during a drag, the drag's links in the focus's place — its
 * families, a link drag's new line to the pointer, an arrival's lines into
 * its best rows (A65, A69, A30). Every figure and word is e3-ui's (the slots, the
 * loads, each resource's line); the layout's indices are `timeline-layout.ts`'s,
 * and every size is the `allocationBuilder` recipe's. A day not read yet
 * draws its lanes, slot times, hours, the link channel and its resources at
 * once — each lane-hour cell washed, each lane head's figures and today's load
 * placeholders (#1398, CL2) — a day whose read failed says so once, across the
 * lane cells of the first row in view (CL11), and a started day with no bins
 * says so there too (CL13). The hour in view holds as the day's bands grow or
 * the day changes (CL8).
 *
 * @packageDocumentation
 */

import {
    createContext, memo, useCallback, useContext, useEffect, useLayoutEffect, useMemo, useRef, useState, useSyncExternalStore,
    type CSSProperties, type KeyboardEvent, type PointerEvent as ReactPointerEvent, type ReactNode, type RefObject,
} from "react";
import { Box, chakra } from "@chakra-ui/react";
import { FontAwesomeIcon } from "@fortawesome/react-fontawesome";
import {
    faArrowDown, faArrowRight, faArrowUp, faCircleExclamation, faFilter, faInbox, faLink, faLinkSlash, faTriangleExclamation, faXmark,
} from "@fortawesome/free-solid-svg-icons";
import type { SortedMap, option } from "@elaraai/east";
import { useContainerBelow, useDragEventChip, useDropCell, type Formatters } from "@elaraai/east-ui-components";
import { LoadingEmptyLine, LoadingFailedLine, LoadingWash, PlaceholderShape, VirtualRows, formatDatePattern, useRevealed } from "@elaraai/east-ui-components/internal";
import type { PeriodRead } from "../shared/loading.js";
import { LinksLayer, type LinkGripProps, type LinkLine, type LinkRibbon } from "../shared/links/layer.js";
import { useScrollTop } from "../shared/links/scroll.js";
import { NowLine } from "../shared/time/now-line.js";
import { TimeRulerRow, timeRulerUnits } from "../shared/time/ruler.js";
import { isoWeekUTC, timeScale, timeWords } from "../shared/time/scale.js";
import { shadeBands } from "../shared/time/shading.js";
import { MoveGhost } from "../shared/schedule/move-ghost.js";
import { remainderOf } from "./actions.js";
import { currentOf, dropTarget, gripCoord, laneCoord, movedLinkOf, rowCoord, type AllocationDrag, type BoardGrip, type Target } from "./drag.js";
import { cardEnd, dragFamilies, dragLine, familyOf, guideLines, layoutLinks, linkIds, type DragTarget, type FamilyLink, type LinkIds, type LinkView } from "./links.js";
import { NarrowedEmpty } from "./narrowed.js";
import { a, one, useNouns } from "./nouns.js";
import {
    CARD_H, HOUR_W, LABEL_W, MIN_DAY, ROW_H, SHORT_DAY, axisFraction, axisSpan, laneGrid, resourceAxis, type LaneBand, type LaneCard, type ResourceAxis,
} from "./timeline-layout.js";
import {
    DAY, allocationWords, compareDate, compareFloat, partsOf, sameParts, type AllocationDomain, type AllocationStyles, type AllocationValue, type Bin, type Context,
    type Day, type Fit, type Issue, type Load, type ResourceLine, type ResourceRow, type Selection, type Slot,
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
    /** The arrivals the narrowing shows, by key; `none` for every one: a bin of a hidden arrival has no card (#1339). */
    visibleArrivals: option<Set<string>>;
    /** Clears the narrowing, where nothing shows; `undefined` with no narrowing. */
    clearFilters: (() => void) | undefined;
    selection: Selection | undefined;
    /** The focus (A13). */
    focus: string | undefined;
    /** The arrival whose every bin the Library's Allocated card highlights (A10). */
    highlight: string | undefined;
    /** Whether a Library arrival is picked (A11): its free lane hours show, and a click there or on a ranked resource books it. */
    picked: boolean;
    /** Books the picked arrival where a click lands, as its drop would (A11). */
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
    /**
     * What it draws of the day's read (#1398): the day as read; a day not read yet — the day without its bins handed in
     * as `plan`, its lane-hour cells washed and its figures placeholders once the reveal says so; or one whose read
     * failed — its geometry, the failure said once across the lane cells of the first row in view.
     */
    read: PeriodRead;
    /** A started day with no bins, once read (CL13): what the first row in view says — `No bins on Wed 12 May` — and how to book one. */
    empty: { message: string; hint: string | undefined } | undefined;
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

/**
 * A lane hour: a drop target for a bin's body (A14, A37). A day not read yet washes it (#1398): where its bins go is
 * not known, so no shape of one implies a time or a place.
 */
function LaneCellView({ props, lane, at, free, wash, style }: { props: TimelineProps; lane: string; at: Date; free: boolean; wash: boolean; style: CSSProperties }) {
    const { drag, styles } = props;
    const { veto, options } = dropTarget(drag, { kind: "lane", lane, at, card: undefined });
    const ref = useDropCell(drag.enabled ? laneCoord(drag.surface, lane, at) : null, false, veto, undefined, options);
    return <Box ref={ref} css={styles.laneCell} data-allocation-cell={`${lane}|${at.getTime()}`} data-free={free ? "" : undefined} style={style}
        onClick={() => { if (props.picked && free && props.editable) props.book({ kind: "lane", lane, at, card: undefined }); else props.select(undefined); }}>
        {wash && <LoadingWash />}
        {free && <Box as="span" css={styles.lanePlaceholder} data-allocation-placeholder="" />}
    </Box>;
}

/**
 * The band at the top of the lane pane's view: under its sticky head, the first band whose rows reach below the scroll
 * — the row a failure or an empty day is said in (#1398, CL11, CL13), and the one that holds as the bands change (CL8).
 *
 * @param bands - The lane grid's bands
 * @param top - The lane pane's scroll
 * @returns The band; `undefined` with none
 */
function bandAt(bands: readonly LaneBand[], top: number): LaneBand | undefined {
    return bands.find(band => (band.row + band.span) * ROW_H > top) ?? bands[bands.length - 1];
}

/** The fits marker over the rows (A31): a drop on it goes to the #1. */
function FitsMarker({ props, marker, top }: { props: TimelineProps; marker: Marker; top: number }) {
    const { drag, styles } = props;
    const { veto, options } = dropTarget(drag, { kind: "resource", resource: marker.resource });
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
    // A day not read yet, or whose read failed (#1398): `plan` is the day without its bins, so its grid has a band one
    // row each and no card; not read yet, its lane-hour cells are washed and its figures placeholders, each unseen until
    // the frame's reveal says so, which each reads itself (CL2, CL4).
    const { read, empty } = props;
    const unread = read.state !== "held";
    const pending = read.state === "pending";
    // What the first row in view says, once: why the day could not be read (CL11), or that a started day has no bins (CL13).
    const saying = read.state === "failed" || empty !== undefined;
    const words = allocationWords();
    const nouns = useNouns();
    const unit = context.unit;
    // The lanes the narrowing shows, in their order: a hidden lane's column goes, with its cards and its slots (#1336).
    const lanes = useMemo(() => value.lanes.filter(lane => props.visibleLanes.type === "none" || props.visibleLanes.value.has(lane.key)), [value.lanes, props.visibleLanes]);
    // A bin of an arrival the narrowing hides has no card; a reservation, which has no arrival, stays (#1339).
    const { visibleArrivals } = props;
    const grid = useMemo(() => laneGrid(lanes.map(lane => lane.key), slots, plan,
        bin => visibleArrivals.type === "none" || bin.arrival.type === "none" || visibleArrivals.value.has(bin.arrival.value)), [lanes, slots, plan, visibleArrivals]);
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

    // A drag (#1328, #1330): what is dragged; for a connector's, a link's, a Library arrival's or a removed bin's — or the pick's,
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

    // The links (A65–A69): the focus's family, through the channel, none at rest and none on hover; during a drag, the drag's
    // families in its place. Every link of the day is numbered once, so a drag that starts on a focus's link draws it still.
    const ids = useMemo(() => linkIds(plan), [plan]);
    const family = useMemo(() => props.focus === undefined ? [] : familyOf(plan, held, props.focus, ids), [plan, held, props.focus, ids]);
    const linking = family.length > 0 || grip !== undefined;
    const laneTop = useScrollTop(lanePane, linking || saying), rowsTop = useScrollTop(rscPane, linking || marking);
    // The fits out of view, marked at the pane's edge over the rows; a drop on it goes to the #1 (A31).
    const [rowsView, setRowsView] = useState(0);
    useLayoutEffect(() => { if (marking && rscPane.current !== null) setRowsView(rscPane.current.clientHeight - HEAD); }, [marking]);
    const marker = marking ? fitsMarker(drag.ranks, rowIndex, rowsTop, rowsView, key => context.resources.get(key)?.label ?? key) : undefined;
    // While a drag rests on a resource — its row, the fits marker, a fit in the inspector's list — its bins outline for the
    // verdict and its run's label steps aside (A27, A29); they let go as the drag leaves it, for the channel, the head or
    // nothing. Marked on the elements as the drag's rest moves, so pointer motion repaints no card (A35).
    const rowIndexNow = useRef(rowIndex);
    rowIndexNow.current = rowIndex;
    const { rest } = drag;
    const markRest = useCallback(() => {
        const box = root.current;
        if (box === null) return;
        for (const el of box.querySelectorAll("[data-drop-target]")) el.removeAttribute("data-drop-target");
        for (const el of box.querySelectorAll("[data-run][data-pointer]")) el.removeAttribute("data-pointer");
        const at = rest.get();
        if (at === undefined || at.target.kind !== "resource") return;
        const resource = at.target.resource, index = rowIndexNow.current.get(resource);
        for (const el of box.querySelectorAll(`[data-allocation-card]`)) {
            if ((el.getAttribute("data-resources") ?? "").split(" ").includes(resource)) el.setAttribute("data-drop-target", at.allowed ? "fits" : "refused");
        }
        if (index === undefined) return;
        for (const el of box.querySelectorAll<HTMLElement>("[data-run]")) {
            if (Number(el.dataset.from) <= index && index <= Number(el.dataset.to)) el.setAttribute("data-pointer", "");
        }
    }, [rest]);
    useEffect(() => { markRest(); return rest.subscribe(markRest); }, [rest, markRest]);
    // What mounts while the drag rests — a run's label as the fit's answer lands — is marked as it mounts.
    useLayoutEffect(() => { if (grip !== undefined) markRest(); });
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
    // Each link's words, once for the day as drafted: a drag's pointer motion says no quantity again (A35).
    const linkWords = useMemo(() => {
        const out = new Map<string, Map<string, LinkWords>>();
        for (const [id, bin] of plan.bins) {
            const code = bin.arrival.type === "some" ? context.arrivals.get(bin.arrival.value)?.label ?? bin.arrival.value : "";
            out.set(id, new Map(partsOf(bin).map(part => [part.key, linkWordsOf(code, bin.arrival.type === "none" ? undefined : words.quantity(part.quantity, unit))] as const)));
        }
        return out;
    }, [plan, context.arrivals, words, unit]);
    const wordsOf = useCallback((link: FamilyLink): LinkWords => linkWords.get(link.bin)?.get(link.resource) ?? linkWordsOf("", undefined), [linkWords]);
    // The link under the pointer (A67): its bin's card and its resource's load bar ring.
    const [lit, setLit] = useState<FamilyLink>();
    // Under 36px a day, its tick shows its number only.
    const short = useContainerBelow(ruler, axis.days.length * SHORT_DAY);
    const time = useMemo(() => timeWords(props.format.locale), [props.format.locale]);
    const ticks = useMemo(() => timeScale({ window: { min: axis.from, max: axis.to }, resolution: "day", format: short ? "DD" : "dd DD", words: time })!, [axis, short, time]);
    const weeks = useMemo(() => {
        const units = timeRulerUnits(ticks, time, "week")!;
        // `W19 · May 10` for a week that starts in view, `W18` for one cut at the axis's start.
        return { ...units, buckets: units.buckets.map(b => ({ ...b, label: `${time.m.rulerWeek({ week: time.number(isoWeekUTC(b.start)) })}${b.start.getTime() >= axis.from.getTime() ? ` · ${props.format.monthDay(b.start)}` : ""}` })) };
    }, [ticks, time, axis, props.format]);

    // The hour at the top of the lane pane's view holds as the bands change (#1398, CL8): a day's bins landing grow its
    // bands below the row in view, and a step to another day keeps the hour in view. A selection's follow, after it, wins.
    const bandsWere = useRef<readonly LaneBand[] | undefined>(undefined);
    useLayoutEffect(() => {
        const pane = lanePane.current, was = bandsWere.current;
        bandsWere.current = grid.bands;
        if (pane === null || was === undefined) return;
        const top = pane.scrollTop;
        const anchor = bandAt(was, top), now = anchor === undefined ? undefined : grid.bands[anchor.slot];
        if (anchor === undefined || now === undefined || now.row === anchor.row) return;
        pane.scrollTop = now.row * ROW_H + Math.min(Math.max(0, top - anchor.row * ROW_H), (now.span - 1) * ROW_H);
    }, [grid.bands]);

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

    // A narrowing that leaves no lane or no resource leaves nothing to plan on; a board with no resources and no narrowing
    // is no narrowing's empty state (#1398, CL13): it draws its lanes, and no resource row.
    if ((lanes.length === 0 && props.visibleLanes.type === "some") || (rows.length === 0 && props.visible.type === "some")) {
        return <NarrowedEmpty styles={styles} clear={props.clearFilters} />;
    }
    const vars = { "--allocation-lanes": lanes.length, "--allocation-rows": grid.rows, "--allocation-days": axis.days.length } as CSSProperties;
    const flags = props.issues.length === 0 ? NO_ISSUES : props.issues;
    // The first row in view, where the day's failure or its emptiness is said once.
    const lineBand = saying ? bandAt(grid.bands, laneTop) : undefined;
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
                            {/* A day not read yet: its figures a placeholder; failed, blank (#1398). */}
                            <Box as="span" css={styles.laneMeta} title={`Bins booked in this ${one(nouns.lane)} today${unit === "" ? "" : ` · ${unit}`}`}
                                data-pending={unread ? "" : undefined}>
                                {unread ? pending && <PlaceholderShape kind="aggregate" index={i} /> : <>{plural(head.bins, "bin")} · {words.quantity(head.quantity, unit)}</>}
                            </Box>
                        </Box>;
                    })}
                </Box>
                <Box ref={gridBox} css={styles.laneGrid} data-allocation-grid="" data-allocation-unread={unread ? read.state : undefined}>
                    {/* The cells first, so the bands' rules draw over a cell's wash. */}
                    {grid.cells.map(cell => <LaneCellView key={`${cell.lane}:${cell.slot}`} props={props} lane={lanes[cell.lane]!.key} at={cell.at} free={cell.free && !unread}
                        wash={pending} style={{ "--cell-lane": cell.lane, "--cell-row": grid.bands[cell.slot]!.row, "--cell-span": grid.bands[cell.slot]!.span } as CSSProperties} />)}
                    {grid.bands.map(band => <Box key={band.slot} css={styles.laneBand} style={{ "--band-row": band.row, "--band-span": band.span } as CSSProperties} data-allocation-band={band.slot}>
                        <Box as="span" css={styles.laneHour}>{formatDatePattern(value.every.type === "hours" ? "HH" : "HH:mm", band.at)}</Box>
                    </Box>)}
                    {grid.cards.map(card => <Card key={card.id} card={card} props={props} lines={lines} flags={flags} lit={lit?.bin === card.id}
                        refuses={taking !== undefined && !card.bin.parts.has(taking) && takes?.bins.get(card.id)?.type === "refused"} />)}
                    {/* Said once, across the lane cells of the first row in view (#1398): why the day could not be read, with
                        Retry (CL11), or that a started day has no bins, and how to book one (CL13). */}
                    {lineBand !== undefined && <Box css={styles.readLine} style={{ "--band-row": lineBand.row } as CSSProperties} data-allocation-read-line={read.state === "failed" ? "failed" : "empty"}>
                        {read.state === "failed" ? <LoadingFailedLine message={read.message} retry={{ onRetry: read.retry }} />
                            : empty !== undefined && <LoadingEmptyLine icon={faInbox} message={empty.message} hint={empty.hint} />}
                    </Box>}
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
                    focusHold={focusHold} draft={drafted.has(resource.key)} lit={lit?.resource === resource.key}
                    verdict={verdicts?.get(resource.key)} rank={ranking && rank >= 0 ? rank + 1 : undefined} preview={previews.get(resource.key)}
                    quantity={dragged?.quantity} today={pending} />;
            }} />
        {view !== undefined && linking && <TimelineLinks props={props} family={family} ids={ids} cards={cardOf} rows={rowIndex}
            view={{ ...view, laneTop, rowsTop }} words={wordsOf} onLit={setLit} />}
        {view !== undefined && grip !== undefined && <PointerLines props={props} root={root} cards={cardOf} rows={rowIndex} view={{ ...view, laneTop, rowsTop }} />}
    </Box>;
}

/** A link's words (A67, A68): its bin's code, its quantity, its name (`LD-2232, 4 m³`) and its ghost's (`LD-2232 · 4 m³`). */
interface LinkWords { code: string; quantity: string | undefined; name: string; ghost: string }

/** A link's words from its bin's code and its quantity; a reservation's has none: `the reservation`, `Reserved`. */
function linkWordsOf(code: string, quantity: string | undefined): LinkWords {
    return quantity === undefined ? { code, quantity, name: "the reservation", ghost: "Reserved" } : { code, quantity, name: `${code}, ${quantity}`, ghost: `${code} · ${quantity}` };
}

/** A routed link of the Timeline's: the ribbon and its link. */
type TimelineRibbon = ReturnType<typeof layoutLinks>[number];
const linkOf = (ribbon: LinkRibbon): FamilyLink => (ribbon as TimelineRibbon).link;

/** What the links read of the Timeline (A65–A69). */
interface TimelineLinksProps {
    props: TimelineProps;
    /** The focus's family: what draws with no drag under way. */
    family: readonly FamilyLink[];
    ids: LinkIds;
    cards: ReadonlyMap<string, LaneCard>;
    rows: ReadonlyMap<string, number>;
    view: LinkView;
    words: (link: FamilyLink) => LinkWords;
    /** Hears the link under the pointer (A67), `undefined` for none. */
    onLit: (link: FamilyLink | undefined) => void;
}

/**
 * The links over the panes (A65–A69): the focus's family at rest — lit,
 * selected, unlinked by its ×; during a drag, the drag's families in its
 * place: the dragged bin's resource's, the link it moves faded to its `was`
 * line, and the family of the resource the drag rests on, in the drop's
 * verdict. It reads where the drag rests itself, so nothing else of the board
 * renders as the drag moves (A35). Each link's line and caption is a grip.
 */
function TimelineLinks({ props, family, ids, cards, rows, view, words, onLit }: TimelineLinksProps) {
    const { drag, styles, plan, held } = props;
    const { grip } = drag;
    const nouns = useNouns();
    const rest = useSyncExternalStore(drag.rest.subscribe, drag.rest.get, drag.rest.get);
    const current = grip === undefined ? undefined : currentOf(plan, grip);
    const moved = grip === undefined ? undefined : movedLinkOf(plan, grip);
    // The resource the drag rests on, unless it is the dragged bin's own, and the drop's verdict there; a body's drag draws its own family alone.
    let target: DragTarget | undefined;
    if (grip !== undefined && grip.kind !== "body" && rest !== undefined && rest.target.kind === "resource" && rest.target.resource !== current) {
        const verdict = drag.peek(grip, rest.target);
        target = { resource: rest.target.resource, verdict: verdict.pending ? undefined : verdict.allowed ? "fits" : "refused" };
    }
    const atRest = grip === undefined;
    const links = atRest ? family : dragFamilies(plan, held, ids, current, moved, target);
    const selected = props.link === undefined ? undefined : ids.get(props.link.bin)?.get(props.link.resource);
    const was = moved === undefined ? undefined : ids.get(moved.bin)?.get(moved.resource);
    // The selected link is drawn a px heavier, in the ink, at rest only: during a drag its caption keeps its outline alone.
    const ribbons = layoutLinks(links, cards, rows, view, link => words(link).quantity, atRest ? selected : undefined);
    const scope: GripScope = { drag, styles, words, select: link => props.selectLink({ bin: link.bin, resource: link.resource }) };
    if (ribbons.length === 0) return null;
    const isSelected = (ribbon: LinkRibbon) => selected === ribbon.id;
    return <GripContext.Provider value={scope}>
        <Box css={styles.links} data-allocation-links="" style={{ height: view.height }}>
            <LinksLayer ribbons={ribbons} width={view.channelRight} height={view.height} halo={false} lights={atRest}
                onLit={id => onLit(id === null ? undefined : links.find(link => link.id === id))}
                clip={{ left: view.gridLeft + HOUR_W, width: Math.max(0, view.channelRight - view.gridLeft - HOUR_W) }}
                selected={selected} preview={was === undefined ? undefined : { was, line: undefined }}
                onUnlink={atRest && props.editable ? id => { const link = links.find(l => l.id === id); if (link !== undefined) props.unlink(link.bin, link.resource); } : undefined}
                unlinkLabel={ribbon => `Unlink ${words(linkOf(ribbon)).code} · Delete`}
                grip={drag.enabled ? LinkGrip : undefined}
                hit={ribbon => {
                    const link = linkOf(ribbon), name = words(link).name;
                    return { "data-allocation-link": `${link.bin}|${link.resource}`, "aria-label": `${isSelected(ribbon) ? "Selected link" : "Link"} of ${name}`,
                        children: <title>{`Link of ${name} · click to select`}</title>, onClick: () => props.selectLink({ bin: link.bin, resource: link.resource }) };
                }}
                caption={ribbon => {
                    const link = linkOf(ribbon), name = words(link).name, chosen = isSelected(ribbon);
                    return { role: "button", "aria-label": `${chosen ? "Selected link" : "Link"} of ${name}`, "data-allocation-caption": `${link.bin}|${link.resource}`,
                        title: !props.editable ? `Link of ${name}` : chosen ? "Selected · × or Delete removes the link" : `Click to select the link, then Delete · drag onto ${a(nouns.resource)} row to move it`,
                        onClick: () => props.selectLink({ bin: link.bin, resource: link.resource }) };
                }} />
        </Box>
    </GripContext.Provider>;
}

/** What a link's grip reads of the board: its drags, its look, each link's words, and selecting a link. */
interface GripScope {
    drag: AllocationDrag;
    styles: AllocationStyles;
    words: (link: FamilyLink) => LinkWords;
    select: (link: FamilyLink) => void;
}
const GripContext = createContext<GripScope | null>(null);

/**
 * A link's grip (A69): its line, or its caption, picks the link's part up as
 * the board's drag of it — the shared drag's handle spread on it, its ghost
 * the part's words, `LD-2232 · 4 m³` — as a card's body or its connector does.
 * One component the layer keeps, so a drag it starts outlives the families the
 * drag draws in the focus's place. A link with a caption is one control, its
 * caption — its line holds the drag for the pointer alone — and a reservation's
 * link, which has none, its line: Enter selects the link (A68), Space picks it up.
 */
function LinkGrip({ ribbon, part, render }: LinkGripProps) {
    const scope = useContext(GripContext);
    const link = linkOf(ribbon);
    const { bin, resource } = link;
    const enabled = scope?.drag.enabled === true, surface = scope?.drag.surface ?? "";
    const at = useMemo(() => enabled ? gripCoord(surface, { kind: "link", bin, resource }) : null, [enabled, surface, bin, resource]);
    const label = scope === null ? "" : scope.words(link).ghost;
    const styles = scope?.styles;
    const ghost = useMemo(() => styles === undefined ? null : <MoveGhost styles={styles} label={label} />, [styles, label]);
    const handle = useDragEventChip(at, ghost, false, label);
    if (scope === null || handle === undefined) return <>{render({})}</>;
    const { ref, onPointerDown, onKeyDown, ...control } = handle;
    const grip: BoardGrip = { kind: "link", bin, resource };
    const pointer = { ref, "data-scope": "allocation", "data-allocation-grip": "", onPointerDown: (event: ReactPointerEvent<SVGElement>) => { scope.drag.arm(grip); onPointerDown?.(event); } };
    if (part === "line" && ribbon.label !== undefined) return <>{render(pointer)}</>;
    return <>{render({
        ...pointer, ...control,
        onKeyDown: event => {
            if (event.key === "Enter") { event.preventDefault(); scope.select(link); return; }
            if (event.key === " ") scope.drag.arm(grip);
            onKeyDown?.(event);
        },
    })}</>;
}

/** No links of its own: the layer over the panes that draws what follows the pointer. */
const NO_RIBBONS: readonly LinkRibbon[] = [];
const NO_LINES: readonly LinkLine[] = [];
const NO_CLIP = { left: 0, width: 0 };
const NO_HIT = () => ({});

/**
 * What follows the pointer through a drag (A69, A30): a link's or a
 * connector's new line from its card to the pointer, or an arrival's lines
 * from the pointer into its three best fits' rows — the only part of the board
 * drawn again as the pointer moves (A35). A keyboard's drag has no pointer to
 * follow, and draws neither.
 */
function PointerLines({ props, root, cards, rows, view }: {
    props: TimelineProps; root: RefObject<HTMLDivElement | null>; cards: ReadonlyMap<string, LaneCard>; rows: ReadonlyMap<string, number>; view: LinkView;
}) {
    const { drag, styles } = props;
    const { grip } = drag;
    const card = grip !== undefined && (grip.kind === "link" || grip.kind === "port") ? cards.get(grip.bin) : undefined;
    const ranking = grip !== undefined && (grip.kind === "arrival" || grip.kind === "removed");
    const at = useDragPointer(root, card !== undefined || ranking);
    if (at === undefined) return null;
    const line = card === undefined ? undefined : dragLine(cardEnd(card, view), at.x, at.y, view);
    const guides = ranking ? guideLines(at.x, at.y, drag.ranks, rows, view) : NO_LINES;
    if (line === undefined && guides.length === 0) return null;
    return <Box css={styles.linkLines} data-allocation-link-lines="" style={{ height: view.height }}>
        <LinksLayer ribbons={NO_RIBBONS} width={view.channelRight} height={view.height} clip={NO_CLIP} hit={NO_HIT} preview={{ was: undefined, line }} guides={guides} />
    </Box>;
}

/**
 * Where the pointer carrying a drag is, in the links' layer's px — the board's
 * box under its head — as it moves; `undefined` until it moves, or while `on`
 * is off. A pointer whose buttons are up carries no drag: a mouse moved during
 * a keyboard's drag draws nothing.
 */
function useDragPointer(root: RefObject<HTMLDivElement | null>, on: boolean): { x: number; y: number } | undefined {
    const [at, setAt] = useState<{ x: number; y: number }>();
    useEffect(() => {
        if (!on) return undefined;
        const move = (event: PointerEvent) => {
            const box = root.current;
            if (box === null || event.buttons === 0) return;
            const r = box.getBoundingClientRect();
            setAt({ x: event.clientX - r.left, y: event.clientY - r.top - HEAD });
        };
        document.addEventListener("pointermove", move, { passive: true });
        return () => { document.removeEventListener("pointermove", move); setAt(undefined); };
    }, [on, root]);
    return on ? at : undefined;
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
function Card(args: CardProps) {
    const { card, props } = args;
    const { styles, context, drag } = props;
    const { id, bin } = card;
    const words = allocationWords();
    const arrival = bin.arrival.type === "some" ? context.arrivals.get(bin.arrival.value) : undefined;
    const code = bin.arrival.type === "none" ? undefined : arrival?.label ?? bin.arrival.value;
    const label = useMemo(() => code === undefined ? "Reserved" : `${code} · ${words.quantity(bin.quantity, context.unit)}`, [code, words, bin.quantity, context.unit]);
    // The card body drags the bin between lane hours (A24); its connector drags what it carries onto a resource (A21).
    const ghost = useMemo(() => <MoveGhost styles={styles} label={label} />, [styles, label]);
    const bodyAt = useMemo(() => drag.enabled ? gripCoord(drag.surface, { kind: "body", bin: id }) : null, [drag.enabled, drag.surface, id]);
    const portAt = useMemo(() => drag.enabled ? gripCoord(drag.surface, { kind: "port", bin: id }) : null, [drag.enabled, drag.surface, id]);
    const body = useDragEventChip(bodyAt, ghost, false, label);
    const port = useDragEventChip(portAt, ghost, false, label);
    // A card is its lane hour's drop target too, and a reservation's a bin fills (A38).
    const { veto, options } = dropTarget(drag, { kind: "lane", lane: bin.lane, at: card.slotAt, card: id });
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
    const reserved = bin.arrival.type === "none";
    const arrival = bin.arrival.type === "some" ? context.arrivals.get(bin.arrival.value) : undefined;
    const code = reserved ? "Reserved" : arrival?.label ?? (bin.arrival.type === "some" ? bin.arrival.value : "");
    const parts = partsOf(bin);
    const resource = parts[0] === undefined ? undefined : context.resources.get(parts[0].key);
    const line = resource === undefined ? undefined : lines.get(resource.key);
    const committed = props.held?.bins.get(id);
    const draft = committed === undefined || !props.sameBin(committed, bin);
    const linkDraft = draft && (committed === undefined || !sameParts(committed.parts, bin.parts));
    // Selected, or one of the bins the Library's Allocated card highlights (A10).
    const selected = (props.selection?.type === "bin" && props.selection.id === id) || (props.highlight !== undefined && bin.arrival.type === "some" && bin.arrival.value === props.highlight);
    // Outside the focus, a card dims (A13): any but the selected one and the focus's own.
    const dimming = props.selection?.type === "bin" || props.selection?.type === "resource";
    const dim = dimming && !selected && (props.focus === undefined || !bin.parts.has(props.focus));
    const lane = value.lanes.find(l => l.key === bin.lane)?.label ?? bin.lane;
    const at = `${lane} ${formatDatePattern("HH:mm", bin.at)}`;
    const qty = words.quantity(bin.quantity, context.unit);
    const to = resource === undefined ? "" : `${resource.label}${parts.length > 1 ? ` + ${parts.length - 1}` : ""}`;
    // What its parts leave unallocated (A70): after where it is, in warn-text, cut with the line where the card cuts it; the tooltip says it whole.
    const remainder = reserved ? 0 : remainderOf(bin);
    const left = resource !== undefined && compareFloat(remainder, 0) > 0 ? `${words.quantity(remainder, context.unit)} unallocated` : undefined;
    const moves = props.editable ? ` · drag to another ${one(nouns.lane)} hour to move it` : "";
    const tip = reserved
        ? `Reserved · ${at}${resource === undefined ? "" : ` on ${resource.label}`} · no ${one(nouns.arrival)} yet${moves}`
        : `${code}${arrival?.meta.type === "some" ? ` · ${arrival.meta.value}` : ""} · ${qty} · ${at}${resource === undefined ? " · not linked" : ` on ${to}`}${left === undefined ? "" : ` · ${left}`}${moves}`;
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
                    : <><FontAwesomeIcon icon={faArrowRight} />{to}{left !== undefined && <> · <Box as="span" css={styles.cardLeft} data-allocation-left="">{left}</Box></>}</>}
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
    /**
     * Whether today's load is a placeholder (#1398): a day not read yet — a rect where the load starts, the plan day's,
     * unseen until the frame's reveal says so; its line meanwhile says what is known without the day's read, its min and
     * its max.
     */
    today: boolean;
}

/**
 * Today's load on a day not read yet (#1398): a placeholder rect where the load starts, the plan day's — unseen at its
 * footprint until the frame's one reveal clock says so, which it reads itself, so the clock's flip renders it alone (CL4).
 */
function PendingLoad({ styles, at }: { styles: AllocationStyles; at: CSSProperties }) {
    const hidden = useRevealed() === false ? "" : undefined;
    return <Box css={styles.bar} style={at} data-kind="pending" data-allocation-load-pending="" data-unrevealed={hidden} aria-hidden="true" />;
}

/** A resource's row (A18–A20): a drop target for a connector or a link (A39), and a body's refusal (§10) — its hook outside the row's body (A35). */
function ResourceRowView(args: ResourceRowProps) {
    const { drag } = args.props;
    const { veto, options } = dropTarget(drag, { kind: "resource", resource: args.resource.key });
    const drop = useDropCell(drag.enabled ? rowCoord(drag.surface, args.resource.key) : null, false, veto, undefined, options);
    return <ResourceRowBody {...args} drop={drop} />;
}

/** A resource's row: its label cell and its plot. */
const ResourceRowBody = memo(function ResourceRowBody({ resource, line, load, axis, props, focusHold, draft, lit, verdict, rank, preview, quantity, today, drop }: ResourceRowProps & { drop: (el: HTMLElement | null) => void }) {
    const { styles, context, day } = props;
    const words = allocationWords();
    const focus = props.focus === resource.key;
    // With an arrival picked, a click on a ranked resource books it onto it (A11, A36).
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
    const todaySpan = today ? axisSpan(axis, day, new Date(day.getTime() + DAY)) : undefined;
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
            {/* Today's load, a day not read yet: a placeholder rect where it starts (#1398). */}
            {todaySpan !== undefined && <PendingLoad styles={styles} at={todaySpan} />}
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
