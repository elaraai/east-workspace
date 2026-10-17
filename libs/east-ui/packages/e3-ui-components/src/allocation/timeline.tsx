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

import { useCallback, useLayoutEffect, useMemo, useRef, useState, type CSSProperties, type KeyboardEvent, type ReactNode } from "react";
import { Box, chakra } from "@chakra-ui/react";
import { FontAwesomeIcon } from "@fortawesome/react-fontawesome";
import { faArrowDown, faArrowRight, faCircleExclamation, faLink, faLinkSlash, faTriangleExclamation } from "@fortawesome/free-solid-svg-icons";
import type { SortedMap, option } from "@elaraai/east";
import { useContainerBelow, type Formatters } from "@elaraai/east-ui-components";
import { VirtualRows, formatDatePattern } from "@elaraai/east-ui-components/internal";
import { LinksLayer, type LinkRibbon } from "../shared/links/layer.js";
import { useScrollTop } from "../shared/links/scroll.js";
import { NowLine } from "../shared/time/now-line.js";
import { TimeRulerRow, timeRulerUnits } from "../shared/time/ruler.js";
import { isoWeekUTC, timeScale, timeWords } from "../shared/time/scale.js";
import { shadeBands } from "../shared/time/shading.js";
import { familyOf, layoutLinks, type FamilyLink } from "./links.js";
import { CARD_H, HOUR_W, LABEL_W, MIN_DAY, ROW_H, SHORT_DAY, axisFraction, axisSpan, laneGrid, resourceAxis, type LaneCard, type ResourceAxis } from "./timeline-layout.js";
import {
    allocationWords, partsOf, sameParts, type AllocationStyles, type AllocationValue, type Bin, type Context, type Day, type Issue, type Load,
    type ResourceLine, type ResourceRow, type Selection, type Slot,
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
    selection: Selection | undefined;
    /** The focus (A13). */
    focus: string | undefined;
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
    const unit = context.unit;
    const grid = useMemo(() => laneGrid(value.lanes.map(lane => lane.key), slots, plan), [value.lanes, slots, plan]);
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

    // The links (A65–A68): the focus's family, through the channel; none at rest and none on hover.
    const family = useMemo(() => props.focus === undefined ? [] : familyOf(plan, held, props.focus), [plan, held, props.focus]);
    const linking = family.length > 0;
    const laneTop = useScrollTop(lanePane, linking), rowsTop = useScrollTop(rscPane, linking);
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

    const vars = { "--allocation-lanes": value.lanes.length, "--allocation-rows": grid.rows, "--allocation-days": axis.days.length } as CSSProperties;
    const flags = props.issues.length === 0 ? NO_ISSUES : props.issues;
    return <Box ref={root} css={styles.timeline} style={vars} data-allocation-timeline="">
        <Box ref={lanePane} css={styles.lanePane} data-allocation-lanes="">
            <Box css={styles.laneContent}>
                <Box css={[styles.head, styles.laneHead]}>
                    <Box data-head-caption="" css={styles.headCaption}><span>Lane</span><span>Hour</span></Box>
                    {value.lanes.map((lane, i) => {
                        const head = grid.heads[i]!;
                        const minute = head.first === undefined ? "" : formatDatePattern("mm", head.first);
                        return <Box key={lane.key} css={styles.laneHeadCell} data-allocation-lane={lane.key}>
                            <Box as="span" css={styles.laneName} title={`${lane.label} takes one bin at :${minute} past each ${value.every.type === "hours" ? "hour" : "slot"}`}>
                                {lane.label}<Box as="span" css={styles.laneOffset}>at :{minute}</Box>
                            </Box>
                            <Box as="span" css={styles.laneMeta} title={`Bins booked in this lane today${unit === "" ? "" : ` · ${unit}`}`}>
                                {plural(head.bins, "bin")} · {words.quantity(head.quantity, unit)}
                            </Box>
                        </Box>;
                    })}
                </Box>
                <Box ref={gridBox} css={styles.laneGrid} data-allocation-grid="">
                    {grid.bands.map(band => <Box key={band.slot} css={styles.laneBand} style={{ "--band-row": band.row, "--band-span": band.span } as CSSProperties} data-allocation-band={band.slot}>
                        <Box as="span" css={styles.laneHour}>{formatDatePattern(value.every.type === "hours" ? "HH" : "HH:mm", band.at)}</Box>
                    </Box>)}
                    {grid.cells.map(cell => <Box key={`${cell.lane}:${cell.slot}`} css={styles.laneCell} data-allocation-cell={`${value.lanes[cell.lane]!.key}|${cell.at.getTime()}`}
                        data-free={cell.free ? "" : undefined} style={{ "--cell-lane": cell.lane, "--cell-row": grid.bands[cell.slot]!.row, "--cell-span": grid.bands[cell.slot]!.span } as CSSProperties}
                        onClick={() => props.select(undefined)} />)}
                    {grid.cards.map(card => <Card key={card.id} card={card} props={props} lines={lines} flags={flags} lit={litLink?.bin === card.id} />)}
                </Box>
            </Box>
        </Box>
        <Box ref={channel} css={styles.channel} data-allocation-channel="">
            <Box css={styles.channelHead} title="Links run through this channel"><span /><span><FontAwesomeIcon icon={faLink} /></span></Box>
        </Box>
        <VirtualRows fillParent height={undefined} maxHeight={undefined} rootCss={styles.resourcePane} minWidth={`calc(${LABEL_W}px + ${axis.days.length * MIN_DAY}px)`}
            scrollElRef={rscPane} headerZIndex={6} count={rows.length} getItemKey={getItemKey} sizes={sizes} measureRows={false}
            header={<Box css={[styles.head, styles.resourceHead]} data-allocation-resource-head="">
                <Box data-head-caption="" css={styles.headCaption}><span>Week</span><span>Resource</span></Box>
                <Box ref={ruler} css={styles.ruler}>
                    <TimeRulerRow scale={weeks} styles={styles} band="units" owner="allocation" />
                    <TimeRulerRow scale={ticks} styles={styles} band="ticks" owner="allocation" highlight={axis.today}
                        marked={bucket => focusHold !== undefined && bucket.start.getTime() >= day.getTime() && bucket.start.getTime() < focusHold.to.getTime()} />
                </Box>
            </Box>}
            renderRow={index => {
                const resource = rows[index]!;
                return <ResourceRowView resource={resource} line={lines.get(resource.key)!} load={loads.get(resource.key)!} axis={axis} props={props}
                    focusHold={focusHold} draft={drafted.has(resource.key)} lit={litLink?.resource === resource.key} />;
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
                        title: !props.editable ? `Link of ${linkName(link)}` : selected ? "Selected · × or Delete removes the link" : "Click to select the link, then Delete · drag onto a resource row to move it",
                        onClick: () => props.selectLink({ bin: link.bin, resource: link.resource }) };
                }} />
        </Box>}
    </Box>;
}

/** A bin's card (A16, A21). */
function Card({ card, props, lines, flags, lit }: { card: LaneCard; props: TimelineProps; lines: ReadonlyMap<string, ResourceLine>; flags: readonly Issue[]; lit: boolean }) {
    const { styles, context, value } = props;
    const { id, bin } = card;
    const words = allocationWords();
    const reserved = bin.event.type === "none";
    const event = bin.event.type === "some" ? context.events.get(bin.event.value) : undefined;
    const code = reserved ? "Reserved" : event?.label ?? (bin.event.type === "some" ? bin.event.value : "");
    const parts = partsOf(bin);
    const resource = parts[0] === undefined ? undefined : context.resources.get(parts[0].key);
    const line = resource === undefined ? undefined : lines.get(resource.key);
    const committed = props.held?.bins.get(id);
    const draft = committed === undefined || !props.sameBin(committed, bin);
    const linkDraft = draft && (committed === undefined || !sameParts(committed.parts, bin.parts));
    const selected = props.selection?.type === "bin" && props.selection.id === id;
    // Outside the focus, a card dims (A13): any but the selected one and the focus's own.
    const dimming = props.selection?.type === "bin" || props.selection?.type === "resource";
    const dim = dimming && !selected && (props.focus === undefined || !bin.parts.has(props.focus));
    const lane = value.lanes.find(l => l.key === bin.lane)?.label ?? bin.lane;
    const at = `${lane} ${formatDatePattern("HH:mm", bin.at)}`;
    const qty = words.quantity(bin.quantity, context.unit);
    const to = resource === undefined ? "" : `${resource.label}${parts.length > 1 ? ` + ${parts.length - 1}` : ""}`;
    const drag = props.editable ? " · drag to another lane hour to move it" : "";
    const tip = reserved
        ? `Reserved · ${at}${resource === undefined ? "" : ` on ${resource.label}`} · no event yet${drag}`
        : `${code}${event?.meta.type === "some" ? ` · ${event.meta.value}` : ""} · ${qty} · ${at}${resource === undefined ? " · not linked" : ` on ${to}`}${drag}`;
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
        ? `Drag the connector onto a resource to allocate ${reserved ? "this reservation" : code} · click to choose one`
        : `Allocated to ${to} · drag the connector onto a resource to move it · click to choose another`;
    return <Box css={styles.card} role="button" tabIndex={0} title={tip} aria-label={tip} aria-pressed={selected}
        data-allocation-card={id} data-reserved={reserved ? "" : undefined} data-draft={draft ? "" : undefined}
        data-selected={selected ? "" : undefined} data-dim={dim ? "" : undefined} data-link-lit={lit ? "" : undefined}
        style={{ "--card-lane": card.lane, "--card-row": card.row } as CSSProperties}
        onClick={() => props.select({ type: "bin", id })} onKeyDown={onActivate(() => props.select({ type: "bin", id }))}>
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
        {props.editable && <chakra.button type="button" css={styles.connector} aria-label={connector} title={connector} data-allocation-connector={id}
            onPointerDown={event => event.stopPropagation()} onKeyDown={event => event.stopPropagation()}
            onClick={event => { event.stopPropagation(); props.choose(id); }}>
            <Box as="span" css={styles.connectorMark} data-state={resource === undefined ? "unlinked" : linkDraft ? "draft" : undefined} />
        </chakra.button>}
    </Box>;
}

/** A resource's row: its label cell and its plot (A18–A20). */
function ResourceRowView({ resource, line, load, axis, props, focusHold, draft, lit }: {
    resource: ResourceRow; line: ResourceLine; load: Load; axis: ResourceAxis; props: TimelineProps; focusHold: { from: Date; to: Date } | undefined; draft: boolean; lit: boolean;
}) {
    const { styles, context, day } = props;
    const words = allocationWords();
    const focus = props.focus === resource.key;
    const select = () => props.select({ type: "resource", key: resource.key });
    const shades = useMemo(() => shadeBands({ min: axis.from, max: axis.to }, {}), [axis]);
    const mondays = useMemo(() => axis.days.filter((d, i) => i > 0 && d.getUTCDay() === 1), [axis]);
    const hold = load.hold.type === "some" ? load.hold.value : undefined;
    const bar = (key: string, from: Date, to: Date, attrs: Record<string, string | undefined>, label: string) => {
        const at = axisSpan(axis, from, to);
        return at === undefined ? null : <Box key={key} css={styles.bar} style={at} {...attrs}><Box as="span" css={styles.barLabel}>{label}</Box></Box>;
    };
    const loadSpan = hold === undefined ? undefined : axisSpan(axis, day, hold.to);
    const overlap = line.overlap && line.next.type === "some" && hold !== undefined ? axisSpan(axis, line.next.value.start, hold.to) : undefined;
    const focusSpan = focusHold === undefined ? undefined : axisSpan(axis, day, focusHold.to);
    return <Box css={styles.resourceRow} role="button" tabIndex={0} aria-label={`${resource.label}, ${line.text}`} aria-pressed={focus}
        data-allocation-resource={resource.key} data-selected={focus ? "" : undefined} onClick={select} onKeyDown={onActivate(select)}>
        <Box css={styles.resourceLabel}>
            <Box css={styles.resourceText}>
                <Box as="span" css={styles.resourceName}>{resource.label}</Box>
                <Box as="span" css={styles.resourceLine} data-tone={line.tone.type === "neutral" ? undefined : line.tone.type} data-allocation-line="">{line.text}</Box>
            </Box>
        </Box>
        <Box css={styles.plot} data-allocation-plot="">
            {focusSpan !== undefined && <Box css={styles.span} style={focusSpan} data-allocation-span="" />}
            {shades.map((band, i) => <Box key={i} css={styles.shade} style={{ left: `${band.start * 100}%`, width: `${band.width * 100}%` }} />)}
            {mondays.map(monday => <Box key={monday.getTime()} css={styles.weekRule} style={{ left: `${axisFraction(axis, monday) * 100}%` }} />)}
            {resource.jobs.map((job, i) => bar(`job:${i}`, job.start, job.end, { "data-kind": job.start.getTime() <= day.getTime() ? "prior" : "next" }, job.label))}
            {loadSpan !== undefined && hold !== undefined && <Box css={styles.bar} style={loadSpan} data-kind="load" data-allocation-load=""
                data-draft={draft ? "" : undefined} data-over={line.over ? "" : undefined} data-focus={focus ? "" : undefined} data-link-lit={lit ? "" : undefined}>
                <Box as="span" css={styles.barLabel}>{load.fill > 0 ? words.quantity(load.fill, context.unit) : "reserved"}</Box>
            </Box>}
            {overlap !== undefined && <Box css={styles.overlap} style={overlap} data-allocation-overlap="" />}
            <NowLine styles={styles} at={axisFraction(axis, day)} data-allocation-now="" />
        </Box>
    </Box>;
}
