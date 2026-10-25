/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

/**
 * The Roster's views: the Shifts grid, the People grids — by week, a tile a
 * duty in each day cell; by month, a column a week and a cell seven marks
 * (#1406) — and their phones' cards, over the week as drafted.
 *
 * The People grids draw a row a person, through the shared virtual rows
 * (#1398, CL9): the week's duties are indexed once by person and day
 * ({@link peopleIndex}), a duty's person is found by its key, and a row and
 * each of its days draw again only as what they show changes — a scroll draws
 * only the rows it brings into view. Each kind of row is estimated at its
 * floor, measured from the first rows of the kind to mount (problem 12, CL8):
 * every row of the kind is at least as tall, so a row measured as it comes
 * into view only grows, below the row in view, and the rows anchor. Where the
 * rows' view rests is saved by its top row's key, and brought back as they
 * mount; ↑ and ↓ on a person's name step to the next person, or the one
 * before, selecting them and bringing their row into view. A pick in Search
 * Records gives its person's name the keyboard the same way (#1398) — their
 * row's, or on a phone their card's — where the view shows them.
 *
 * @packageDocumentation
 */
import { Fragment, createContext, memo, useCallback, useContext, useEffect, useLayoutEffect, useMemo, useRef, useState, type CSSProperties, type KeyboardEvent, type ReactNode, type RefObject } from "react";
import { Box, Button, Menu as ChakraMenu, Portal, chakra } from "@chakra-ui/react";
import { FontAwesomeIcon } from "@fortawesome/react-fontawesome";
import { faCheck, faGripVertical, faRotateLeft, faTriangleExclamation, faXmark } from "@fortawesome/free-solid-svg-icons";
import { none, variant } from "@elaraai/east";
import { LoadingFailedLine, PlaceholderShape, VirtualRows, devicePixels, useRevealed, useRowsTop } from "@elaraai/east-ui-components/internal";
import { takeKey, tickFormatOf, useDragEventChip, useDropCell, type CellCoord, type DragEventValue, type DragPayload, type Formatters } from "@elaraai/east-ui-components";
import type { PeriodRead } from "../shared/loading.js";
import { MoveGhost } from "../shared/schedule/move-ghost.js";
import { GroupHeading, useGroupCollapse } from "../shared/schedule/group-heading.js";
import { useRowAnchor, type RowAnchor } from "../shared/schedule/row-anchor.js";
import { Seg } from "../shared/schedule/segments.js";
import { ApplyPatternAction, AssignmentActions, PlaceAction, PlacePopover, RequirementAction } from "./controls.js";
import { readRosterSource } from "./identity.js";
import { isPatternCard, rosterCoord, rosterPersonWeekCoord, type RosterDrag } from "./drag.js";
import type { PatternDay, RosterCommands } from "./actions.js";
import type { RosterDutyOp, RosterOptimised } from "./optimise.js";
import {
    DAY, activityOf, costsOf, groupSkills, hourText, ownTimes, sameSlot, shiftColor, shiftHoursText, shiftOf, slotKey, weekKey, weekNumber,
    type Assignment, type Coverage, type Issue, type Pay, type Person, type PlacedProposal, type RosterDomain, type RosterSpan, type RosterStyles, type RosterValue,
    type RosterView, type Selection, type Shift, type Slot, type Week, type WeekState,
} from "./model.js";

export interface RosterViewsProps {
    value: RosterValue; week: Week; held: Week; start: Date; day: number; view: RosterView; setView: (view: RosterView) => void;
    /** The span in view (#1406, D2), and each of its weeks drafts in place: what the month draws, and what a pattern dropped on one applies to. */
    span: RosterSpan; weeks: readonly WeekState[];
    /** Opens a week in the Week period (P12, P24). */
    openWeek: (week: Date) => void;
    styles: RosterStyles; format: Formatters; narrow: boolean; coverage: ReadonlyMap<Slot, Coverage>; hours: ReadonlyMap<string, number>;
    /** Each duty's cost by the app's codes: none without `pay`. */
    pay: Pay;
    /** The duty row type's domain: what a duty unlike the record's is told by. */
    domain: RosterDomain;
    issues: readonly Issue[]; proposals: readonly PlacedProposal[]; selection: Selection | undefined; select: (next: Selection | undefined) => void;
    commands: RosterCommands; drag: RosterDrag; onError: (error: string | undefined) => void;
    /**
     * What the views draw of the week's read (#1398): the week as read; a week not read yet — its dates, people, groups
     * and shifts at once, a placeholder where its content goes, unseen until the frame's reveal says so, never "Off ·
     * assign" nor "0 / 2 positions" (CL2, CL13); or one whose read failed — its geometry, the failure said once in its
     * first row in view (CL11).
     */
    read: PeriodRead;
    /** Where the People rows' and cards' views last rested (#1398): what each comes back to as it mounts. */
    anchor?: RosterAnchor | undefined;
    /** Told where a People view rests as its scroll settles. */
    onAnchor?: ((next: Partial<RosterAnchor>) => void) | undefined;
    /**
     * What the runs of the app's optimiser left on the week's duties (#1409, R23): each duty's operation, drawn on its
     * tile and its chip alike with its provenance on hover, and the people whose hours the latest run changed.
     */
    optimised?: RosterOptimised | undefined;
    /** Whether a run's highlight is on (#1409): a removed duty's tombstone is struck, and the changed people's hours flash. */
    lit?: boolean | undefined;
    /** The person the last pick in Search Records gives the keyboard to (#1398): their name in the People view, once. */
    picked?: PeoplePick | undefined;
}

/** A pick in Search Records, handing its person the keyboard (#1398): their key, and which pick it is. */
export interface PeoplePick {
    readonly key: string;
    readonly seq: number;
}

/** Where the People views rest (#1398): the desktop rows', and the phone's cards', each by its top row's key — brought
 *  back once the rows' floors are measured, so the rows above the one brought back stand where they will. */
export interface RosterAnchor {
    readonly people?: RowAnchor | undefined;
    readonly cards?: RowAnchor | undefined;
}

/** The person whose name the keyboard last stepped to, or a pick gave it to (#1398): their row's or card's name takes the focus as it mounts. */
const PeopleFocusContext = createContext<{ readonly key: string | undefined; readonly done: () => void }>({ key: undefined, done: () => {} });

/**
 * The person a People view gives the keyboard to: whom ↑ / ↓ step to, and whom a pick in Search Records gives it to —
 * each pick once, and only a person the view shows, never one narrowed out or in a folded group; a pick made before the
 * view mounted is not taken (#1398).
 *
 * @param rows - The view's rows
 * @param picked - The last pick
 * @returns The focus the view's names read, and the step the keys take
 */
function usePeopleFocus(rows: readonly PeopleRow[], picked: PeoplePick | undefined): {
    focus: { readonly key: string | undefined; readonly done: () => void }; stepTo: (key: string) => void;
} {
    const [key, setKey] = useState<string>();
    const focus = useMemo(() => ({ key, done: () => setKey(undefined) }), [key]);
    const taken = useRef(picked?.seq);
    useEffect(() => {
        if (picked === undefined || picked.seq === taken.current) return;
        taken.current = picked.seq;
        if (rows.some(row => row.kind === "person" && row.person?.key === picked.key)) setKey(picked.key);
    }, [picked, rows]);
    return { focus, stepTo: setKey };
}

/**
 * What a chip and a People row read of the views' props, kept while what they show holds (#1398, CL9): a row, a day
 * and a chip draw again only as theirs changes. The selection is read apart ({@link SelectionContext}), so a pick
 * draws again only the chips it marks.
 */
interface ViewContext {
    readonly value: RosterValue; readonly week: Week; readonly held: Week; readonly start: Date; readonly day: number;
    readonly styles: RosterStyles; readonly format: Formatters; readonly hours: ReadonlyMap<string, number>; readonly pay: Pay;
    readonly domain: RosterDomain; readonly issues: readonly Issue[]; readonly commands: RosterCommands; readonly drag: RosterDrag;
    readonly select: (next: Selection | undefined) => void; readonly onError: (error: string | undefined) => void; readonly read: PeriodRead;
    /** The month's weeks (#1406), and what opens one of them in Week. */
    readonly weeks: readonly WeekState[]; readonly openWeek: (week: Date) => void;
    /** The People layout's display settings (D7): whether a tile shows the shift's hours always, and whether a month's marks carry letters. */
    readonly tileTimes: "always" | "different"; readonly letters: boolean;
    /** What the runs of the optimiser left on the duties (#1409), and whether the highlight is on. */
    readonly optimised: RosterOptimised | undefined; readonly lit: boolean;
}
/** The views' selection, read by what it marks. */
const SelectionContext = createContext<Selection | undefined>(undefined);

/**
 * Test-only draw probe: told of each People row and each person's day drawn, by key (#1398, CL9) — what "a row draws
 * again only as what it shows changes" is held to. `undefined` outside tests.
 */
let peopleDrawProbe: ((part: "row" | "day", key: string) => void) | undefined;
/**
 * Install (or clear) the People draw probe. Test use only.
 *
 * @param fn - Told of each row and day drawn; `undefined` clears it
 */
export function setPeopleDrawProbe(fn: ((part: "row" | "day", key: string) => void) | undefined): void { peopleDrawProbe = fn; }

/** The views' props a chip and a People row read, the same object while each of them holds. */
function useViewContext(props: RosterViewsProps): ViewContext {
    const { value, week, held, start, day, styles, format, hours, pay, domain, issues, commands, drag, select, onError, read, weeks, openWeek, optimised } = props;
    const tileTimes = value.settings.tileTimes.type, letters = value.settings.letters, lit = props.lit === true;
    return useMemo(() => ({ value, week, held, start, day, styles, format, hours, pay, domain, issues, commands, drag, select, onError, read, weeks, openWeek, tileTimes, letters, optimised, lit }),
        [value, week, held, start, day, styles, format, hours, pay, domain, issues, commands, drag, select, onError, read, weeks, openWeek, tileTimes, letters, optimised, lit]);
}

/**
 * What a run of the optimiser did to a duty, as its tile or its chip draws it (#1409, R7, R17, §9.5): its add or its
 * change while it is still the run's draft, and its remove on its tombstone for the highlight alone — the tombstone
 * is the Roster's own, restorable after it.
 *
 * @param ctx - The views' context
 * @param id - The duty's key
 * @param removed - Whether the tile or chip is the duty's tombstone
 * @param drafted - Whether the duty is a draft still: an Undo that takes the run back leaves no mark (R17)
 * @returns Its mark and its provenance; `undefined` for a duty no run touched, or one no longer drafted
 */
function dutyMark(ctx: ViewContext, id: string, removed: boolean, drafted: boolean): { op: RosterDutyOp["op"]; provenance: string } | undefined {
    const op = drafted ? ctx.optimised?.ops.get(id) : undefined;
    if (op === undefined) return undefined;
    if (op.op === "del") return removed && ctx.lit ? { op: "del", provenance: op.provenance } : undefined;
    return removed ? undefined : { op: op.op, provenance: op.provenance };
}

/**
 * A placeholder in a slot of the week's content, while the week is not read yet (#1398) — unseen at its footprint until
 * the frame's one reveal clock says so, which it reads itself (CL4); nothing where the week's read failed.
 */
function Unread({ read, kind, index }: { read: PeriodRead; kind: "chip" | "aggregate" | "number" | "label"; index: number }) {
    return read.state === "pending" ? <PlaceholderShape kind={kind} index={index} /> : null;
}

/** The failure said once, in place: the week's words and its Retry (#1398, CL11). */
function ReadFailure({ read }: { read: Extract<PeriodRead, { state: "failed" }> }) {
    return <LoadingFailedLine message={read.message} retry={{ onRetry: read.retry }} />;
}

/** Each payload's people and agencies by key, made once a payload (#1398, CL9). */
const keyedRows = new WeakMap<readonly { readonly key: string }[], ReadonlyMap<string, { readonly key: string }>>();
function keyed<T extends { readonly key: string }>(rows: readonly T[]): ReadonlyMap<string, T> {
    let map = keyedRows.get(rows);
    if (map === undefined) {
        map = new Map(rows.map(row => [row.key, row] as const));
        keyedRows.set(rows, map);
    }
    return map as ReadonlyMap<string, T>;
}
/**
 * A person of the payload, by key: found in the payload's people indexed once, never by a search of every person
 * (#1398, CL9).
 *
 * @param value - The payload
 * @param key - The person's key
 * @returns The person; `undefined` for a key the payload does not hold
 */
export function personOf(value: Pick<RosterValue, "people">, key: string): Person | undefined { return keyed(value.people).get(key); }
function agencyOf(value: Pick<RosterValue, "agencies">, key: string): RosterValue["agencies"][number] | undefined { return keyed(value.agencies).get(key); }
export function assignmentName(value: RosterValue, a: Assignment): string {
    return a.who.type === "person" ? personOf(value, a.who.value)?.name ?? a.who.value
        : `Requested · ${agencyOf(value, a.who.value)?.name ?? a.who.value}`;
}
/** A cost in the Roster's currency, through the shared money formatter: compact where it heads a column, exact where it stands alone. */
export function money(format: Formatters, value: RosterValue, amount: number, compact = true): string {
    return value.currency.type === "some" ? format.value(amount, tickFormatOf(variant("currency", { code: value.currency.value, compact }))) : format.number(amount);
}
/** Whether the Roster shows costs: only with the app's pay (§5.6). */
export function costed(value: RosterValue): boolean { return value.pay.type === "some"; }

const NO_ISSUES: readonly Issue[] = [];
/** The week's issues by the duty each names, indexed once a week's issues (#1398, CL9). */
const issuesByDuty = new WeakMap<readonly Issue[], ReadonlyMap<string, readonly Issue[]>>();
/**
 * The issues naming a duty.
 *
 * @param issues - The week's issues
 * @param id - The duty's key
 * @returns Its issues, in the week's order
 */
function dutyIssues(issues: readonly Issue[], id: string): readonly Issue[] {
    let by = issuesByDuty.get(issues);
    if (by === undefined) {
        const map = new Map<string, Issue[]>();
        for (const issue of issues) {
            if (issue.assignment.type !== "some") continue;
            const list = map.get(issue.assignment.value);
            if (list === undefined) map.set(issue.assignment.value, [issue]);
            else list.push(issue);
        }
        by = map;
        issuesByDuty.set(issues, by);
    }
    return by.get(id) ?? NO_ISSUES;
}

function visible(value: RosterValue, a: Assignment) { return a.who.type === "request" || value.visiblePeople.type === "none" || value.visiblePeople.value.has(a.who.value); }
function selectedSlot(selection: Selection | undefined, slot: Slot) { return (selection?.type === "slot" || selection?.type === "requirement") && sameSlot(selection.slot, slot); }
function matchingAssignments(props: RosterViewsProps, matches: (a: Assignment) => boolean) {
    const rows = [...props.week.assignments].filter(([, a]) => matches(a)).map(([id, a]) => ({ id, a, removed: false }));
    for (const [id, a] of props.held.assignments) if (!props.week.assignments.has(id) && matches(a)) rows.push({ id, a, removed: true });
    return rows;
}
function assignments(props: RosterViewsProps, slot: Slot) {
    const rows = matchingAssignments(props, a => sameSlot(a.slot, slot) && visible(props.value, a));
    const rank = (a: Assignment) => a.who.type === "request" ? 1000 : personOf(props.value, a.who.value)?.agency ? 999 : props.value.positions.find(p => p.key === a.position)?.lead ? props.value.positions.findIndex(p => p.key === a.position) : props.value.positions.length;
    return rows.sort((a, b) => rank(a.a) - rank(b.a));
}

/** A duty in a person's day, or a group's requests' day: the week's, or one the draft removed. */
interface DayDuty { readonly id: string; readonly a: Assignment; readonly removed: boolean }
/** A person's week, or a group's requests': each day's duties, the week's first, then those the draft removed. */
type WeekDays = readonly (readonly DayDuty[])[];
const NO_DUTIES: readonly DayDuty[] = [];
const NO_DAYS: WeekDays = Array.from({ length: 7 }, () => NO_DUTIES);
/** The week's duties as the People rows read them (#1398, CL9). */
interface PeopleIndex {
    /** Each person's week, by their key. */
    readonly person: ReadonlyMap<string, WeekDays>;
    /** Each group's agency requests' week, by the group's key. */
    readonly requests: ReadonlyMap<string, WeekDays>;
    /** Each group's agency requests in the week's order, then those the draft removed: what a phone's requests card lists. */
    readonly requestList: ReadonlyMap<string, readonly DayDuty[]>;
    /** Each person's duties in the week as drafted, by their key: what their week's cost totals. */
    readonly duties: ReadonlyMap<string, readonly string[]>;
}
/**
 * The week's duties indexed once, by person and by day — each group's requests by day — never scanned a row at a time
 * (#1398, CL9).
 *
 * @param week - The week as drafted
 * @param held - The week as the records hold it: what a draft removed shows from
 * @returns The index
 */
function peopleIndex(week: Week, held: Week): PeopleIndex {
    const person = new Map<string, DayDuty[][]>();
    const requests = new Map<string, DayDuty[][]>();
    const requestList = new Map<string, DayDuty[]>();
    const duties = new Map<string, string[]>();
    const add = (id: string, a: Assignment, removed: boolean) => {
        const day = Number(a.slot.day);
        if (day < 0 || day > 6) return;
        const into = a.who.type === "person" ? person : requests;
        const key = a.who.type === "person" ? a.who.value : a.slot.group;
        let days = into.get(key);
        if (days === undefined) {
            days = Array.from({ length: 7 }, () => []);
            into.set(key, days);
        }
        const duty = { id, a, removed };
        days[day]!.push(duty);
        if (a.who.type === "person") return;
        const list = requestList.get(key);
        if (list === undefined) requestList.set(key, [duty]);
        else list.push(duty);
    };
    for (const [id, a] of week.assignments) {
        add(id, a, false);
        if (a.who.type !== "person") continue;
        const keys = duties.get(a.who.value);
        if (keys === undefined) duties.set(a.who.value, [id]);
        else keys.push(id);
    }
    for (const [id, a] of held.assignments) if (!week.assignments.has(id)) add(id, a, true);
    return { person, requests, requestList, duties };
}

/** The same coverage bar and skill lines appear in a day cell and the inspector. */
export function CoverageView({ coverage: c, value, styles, format, compact = false }: { coverage: Coverage; value: RosterValue; styles: RosterStyles; format: Formatters; compact?: boolean }) {
    const max = Math.max(c.hours.needed, c.hours.rostered, 1);
    let left = 0;
    const parts: { kind: "permanent" | "agency" | "requested" | "open"; width: number; left: number }[] = (["permanent", "agency", "requested"] as const).map(kind => { const width = c.hours[kind]; const part = { kind, width, left }; left += width; return part; });
    if (c.hours.needed > left) parts.push({ kind: "open", left, width: c.hours.needed - left });
    if (c.hours.needed === 0 && c.hours.rostered === 0) return <Box css={styles.empty}>No work · no hours targeted</Box>;
    return <>
        <Box css={styles.coverageHead}><Box as="span" css={styles.metric}>{format.number(c.hours.needed)} h</Box><Box as="span" css={styles.detail}>needed</Box>
            <Box as="span" css={styles.metric}>{format.number(c.hours.rostered)} h</Box><Box as="span" css={styles.detail}>rostered</Box>
            <Box as="span" css={styles.delta} data-tone={c.hours.rostered < c.hours.needed ? "warning" : undefined}>{c.hours.rostered >= c.hours.needed ? "+" : ""}{format.number(c.hours.rostered - c.hours.needed)} h</Box></Box>
        <Box css={styles.coverageBar} role="img" aria-label={`${format.number(c.hours.rostered)} hours rostered of ${format.number(c.hours.needed)} needed`}>
            {parts.filter(p => p.width > 0).map(part => <Box key={part.kind} css={styles.coverageSegment} data-kind={part.kind} style={{ left: `${part.left / max * 100}%`, width: `${part.width / max * 100}%` }} />)}
            <Box css={styles.coverageTick} style={{ left: `${c.hours.needed / max * 100}%` }} />
        </Box>
        <Box css={styles.detail}>{parts.filter(p => p.kind !== "open" && p.width > 0).map(p => `${format.number(p.width)} ${p.kind === "permanent" ? "perm" : p.kind}`).join(" · ") || "Nothing rostered"} h{costed(value) && ` · ${money(format, value, c.cost)}`}</Box>
        {!compact && c.lines.map(line => { const activity = activityOf(value, line.skill); return <Box key={line.skill} css={styles.skillLine} data-tone={line.gap > 0 ? "warning" : line.assigned >= line.needed ? "success" : undefined}
            title={`${activity?.label ?? line.skill} · ${format.number(line.assigned)} h assigned of ${format.number(line.needed)} h needed${line.capacity.type === "some" ? ` · ${format.number(line.capacity.value)} h capacity` : ""}`}>
            <Box as="span" css={styles.skillCode}>{activity?.code}</Box><span>{activity?.label ?? line.skill}</span><Box as="span" css={styles.skillCode}>{line.holders.type === "some" ? `${line.holders.value}/${c.people}` : "—"}</Box><span>{format.number(line.assigned)} / {format.number(line.needed)}</span>
        </Box>; })}
    </>;
}
interface AssignmentChipProps { ctx: ViewContext; id: string; assignment: Assignment; removed: boolean; short?: boolean }
/** Keep the shared drag hooks outside the chip body: pointer motion does not repaint its contents. */
function AssignmentChip(args: AssignmentChipProps) {
    const { ctx, id, assignment: a, removed } = args;
    const { styles, value, drag } = ctx;
    const selection = useContext(SelectionContext);
    const selected = selection?.type === "assignment" && selection.key === id;
    const name = assignmentName(value, a);
    const coord = useMemo(() => ({ ...rosterCoord(drag.surface, a.slot, id), event: id }), [drag.surface, a.slot, id]);
    const ghost = useMemo(() => <MoveGhost styles={styles} label={name} />, [styles, name]);
    const enabled = drag.enabled && !removed;
    const handle = useDragEventChip(enabled ? coord : null, ghost, !enabled, name);
    const canDrop = useCallback((event: DragEventValue) => drag.run(event, true) === undefined, [drag]);
    const drop = useDropCell(enabled ? coord : null, !enabled, canDrop, undefined, { caption: drag.caption });
    const dragRef = handle?.ref;
    const attach = useCallback((element: HTMLDivElement | null) => { dragRef?.(element); drop(element); }, [dragRef, drop]);
    return <AssignmentChipBody {...args} selected={selected} handle={handle} attach={attach} />;
}
/** Chip state comes from the held week and the domain issues, never from a second draft store. */
const AssignmentChipBody = memo(function AssignmentChipBody({ ctx, id, assignment: a, removed, short = false, selected, handle, attach }: AssignmentChipProps & {
    selected: boolean; handle: ReturnType<typeof useDragEventChip>; attach: (element: HTMLDivElement | null) => void;
}) {
    const { styles, value, commands, drag } = ctx;
    const name = assignmentName(value, a);
    const enabled = drag.enabled && !removed;
    const person = a.who.type === "person" ? personOf(value, a.who.value) : undefined;
    const position = value.positions.find(p => p.key === a.position);
    const issues = removed ? NO_ISSUES : dutyIssues(ctx.issues, id);
    const activity = a.activity.type === "some" ? activityOf(value, a.activity.value) : undefined;
    const baseline = ctx.held.assignments.get(id);
    const drafted = removed || baseline === undefined || !ctx.domain.sameAssignment(baseline, a);
    const times = `${ctx.format.time(a.start)}–${ctx.format.time(a.end)}`;
    const skills = groupSkills(value, a.slot.group);
    const label = `${name} · ${times}${removed ? " · removed" : ""}`;
    // What a run of the optimiser did to the duty (#1409): its mark, and its provenance on hover.
    const mark = dutyMark(ctx, id, removed, drafted);
    return <Box {...handle} ref={attach} css={styles.assignment} tabIndex={0} role="button" aria-label={label} title={mark === undefined ? label : `${mark.provenance} · ${label}`} aria-pressed={selected}
        data-roster-assignment={id} data-layout={short ? "people" : "shifts"} data-added={baseline === undefined ? "" : undefined} data-moved={baseline !== undefined && !sameSlot(baseline.slot, a.slot) ? "" : undefined} data-density={value.settings.density.type} data-selected={selected ? "" : undefined}
        data-drafted={drafted ? "" : undefined} data-removed={removed ? "" : undefined} data-request={a.who.type === "request" ? "" : undefined} data-agency={person?.agency ? "" : undefined}
        data-op={mark?.op} data-fill={mark === undefined ? undefined : "own"}
        data-tone={issues.some(i => i.tone.type === "danger") ? "danger" : issues.some(i => i.kind.type === "breach") ? "warning" : undefined} data-draggable={enabled ? "" : undefined}
        onClick={event => { event.stopPropagation(); ctx.select({ type: "assignment", key: id }); }} onKeyDown={event => { if (event.key === "Enter") { takeKey(event); ctx.select({ type: "assignment", key: id }); } else handle?.onKeyDown?.(event); }}>
        {enabled && <Box as="span" css={styles.grip} data-roster-grip=""><FontAwesomeIcon icon={faGripVertical} /></Box>}
        <Box as="span" css={styles.badge} data-lead={position?.lead ? "" : undefined}>{a.who.type === "request" || person?.agency ? "AG" : position?.code || (person?.trainer ? "T" : "")}</Box>
        <Box css={styles.assignmentName} data-roster-assignment-name="">{short ? `${value.shifts.find(s => s.key === a.slot.shift)?.code ?? a.slot.shift}${person?.group !== a.slot.group ? ` · ${value.groups.find(g => g.key === a.slot.group)?.label ?? a.slot.group}` : ""}` : name}</Box>
        {issues.filter(i => i.flag.type === "some").map((i, n) => <Box as="span" key={n} css={styles.flag} data-tone={i.tone.type}>{i.flag.type === "some" && i.flag.value}</Box>)}
        {/* A duty's own times, where they differ from its shift's (§5.5, rule 2): just times, no name and no worth. */}
        {ownTimes(value, a, ctx.start) && <Box as="span" css={styles.flag} data-roster-times="">{times}</Box>}
        {person !== undefined && !short && <><Box as="span" css={styles.activity} data-empty={activity === undefined ? "" : undefined} title={activity?.label ?? "No activity"}>{activity?.code ?? "·"}</Box>{activity !== undefined && commands.available && !removed && <chakra.button type="button" css={styles.chipAction} data-roster-chip-action="" aria-label={`Clear activity for ${name}`} onPointerDown={e => e.stopPropagation()} onClick={e => { e.stopPropagation(); ctx.onError(commands.activity(id, none)); }}><FontAwesomeIcon icon={faXmark} /></chakra.button>}
            <Box as="span" css={styles.fit}>{value.settings.chipSkills ? `${skills.filter(s => person.skills.has(s.key)).length}/${skills.length}` : `${ctx.format.number(ctx.hours.get(person.key) ?? 0)}h`}</Box></>}
        {(commands.available || commands.locked !== undefined) && <chakra.button type="button" css={styles.chipAction} data-roster-chip-action="" aria-label={removed ? `Restore ${name}` : `Remove ${name}`}
            disabled={commands.locked !== undefined} title={commands.locked}
            onPointerDown={event => event.stopPropagation()} onClick={event => { event.stopPropagation(); if (removed) commands.restore(id); else commands.remove(id); }}><FontAwesomeIcon icon={removed ? faRotateLeft : faXmark} /></chakra.button>}
    </Box>;
});
/** No hook in the mobile branch registers a drag source or target. */
function DropSlot({ props, slot, children, compact = false }: { props: RosterViewsProps; slot: Slot; children: ReactNode; compact?: boolean }) {
    const ref = useRef<HTMLDivElement>(null);
    const [landing, setLanding] = useState<ReturnType<RosterDrag["preview"]>>();
    const drop = useDropCell(props.drag.enabled ? rosterCoord(props.drag.surface, slot) : null, !props.drag.enabled,
        event => props.drag.run(event, true) === undefined, undefined, { caption: props.drag.caption,
            onHover: (_x, _y, payload) => setLanding(props.drag.preview(rosterCoord(props.drag.surface, slot), payload, true)) });
    const attach = useCallback((element: HTMLDivElement | null) => { ref.current = element; drop(element); }, [drop]);
    // The shared target subscription can change on pointer motion; its body need not.
    return useMemo(() => <Box ref={attach} css={compact ? props.styles.weekCell : props.styles.cell} data-roster-slot={slotKey(slot)} data-selected={selectedSlot(props.selection, slot) ? "" : undefined} data-roster-landing-tone={landing?.tone} title={compact ? landing?.label : undefined}>
        {children}{!compact && landing !== undefined && <Box css={props.styles.landing} data-roster-landing="" data-tone={landing.tone}>{landing.label}</Box>}
    </Box>, [attach, compact, props, slot, landing, children]);
}
/** A desktop proposal is the mock's quiet inline chip; phones retain labelled actions. */
export function ProposalCard({ props, proposal }: { props: RosterViewsProps; proposal: PlacedProposal }) {
    const name = personOf(props.value, proposal.person)?.name ?? proposal.person;
    const { styles } = props;
    const select = () => props.select({ type: "proposal", key: proposal.key });
    const accept = () => props.onError(props.commands.accept(proposal.key));
    const reject = () => props.commands.reject(proposal.key);
    const mark = <Box as="span" css={[styles.badge, styles.proposalMark]}>Model</Box>;
    const title = <chakra.button type="button" css={[styles.assignmentName, styles.proposalName]} onClick={select}>{name}</chakra.button>;
    const selected = props.selection?.type === "proposal" && props.selection.key === proposal.key;
    // While a run of the optimiser holds the week (#1409, R2) the actions stay in place, inert.
    const locked = props.commands.locked !== undefined;
    if (props.narrow) return <Box css={styles.card} data-roster-proposal={proposal.key} data-selected={selected ? "" : undefined}>
        <Box css={styles.actions}>{mark}{title}</Box><Box css={styles.detail}>{proposal.reason}</Box>
        {(props.commands.available || locked) && <Box css={styles.actions}><Button size="xs" variant="outline" disabled={locked} title={props.commands.locked} onClick={accept}>Accept</Button>{dismissible(props.value) && <Button size="xs" variant="ghost" disabled={locked} title={props.commands.locked} onClick={reject}>Reject</Button>}</Box>}
    </Box>;
    const open = (props.coverage.get(proposal.slot)?.open ?? 0n) > 0n;
    const shift = props.value.shifts.find(s => s.key === proposal.slot.shift);
    return <Box css={[styles.assignment, styles.proposal]} data-roster-proposal={proposal.key} data-selected={selected ? "" : undefined} data-density={props.value.settings.density.type} title={`Model proposal · ${proposal.reason}`}>
        {mark}{title}<Box as="span" css={[styles.detail, styles.proposalReason]}>{open ? "fills open" : `+${props.format.number(shift?.hours ?? 0)} h`}</Box>
        {(props.commands.available || locked) && <>
            <chakra.button type="button" css={[styles.chipAction, styles.proposalAction]} data-accept="" aria-label={`Accept proposal for ${name}`} title={props.commands.locked ?? "Accept proposal"} disabled={locked} onClick={accept}><FontAwesomeIcon icon={faCheck} /></chakra.button>
            {dismissible(props.value) && <chakra.button type="button" css={[styles.chipAction, styles.proposalAction]} aria-label={`Reject proposal for ${name}`} title={props.commands.locked ?? "Reject proposal"} disabled={locked} onClick={reject}><FontAwesomeIcon icon={faXmark} /></chakra.button>}
        </>}
    </Box>;
}
/** Whether the week keeps the suggestions it rejects: without a record to keep them, a suggestion is only accepted (§5.2). */
export function dismissible(value: RosterValue): boolean { return value.periods.type === "some" && value.periods.value.dismissible; }
function SlotActions({ props, slot }: { props: RosterViewsProps; slot: Slot }) {
    // While a run of the optimiser holds the week (#1409, R2) the actions stay in place, inert.
    const locked = props.commands.locked !== undefined;
    if (!props.commands.available && !locked) return null;
    return <Box css={props.styles.actions}><PlaceAction label="Assign person" slot={slot} value={props.value} start={props.start} commands={props.commands} styles={props.styles} />
        {props.value.agencies.map(agency => <Button key={agency.key} size="xs" variant="outline" disabled={locked} title={props.commands.locked} onClick={() => props.onError(props.commands.place({ type: "agency", key: agency.key }, slot))}>Request {agency.name}</Button>)}
    </Box>;
}
function DayAssignments({ props, ctx, slot }: { props: RosterViewsProps; ctx: ViewContext; slot: Slot }) {
    const c = props.coverage.get(slot)!;
    const issues = props.issues.filter(i => i.slot.type === "some" && sameSlot(i.slot.value, slot) && (i.kind.type === "gap" || i.kind.type === "breach"));
    return <DropSlot props={props} slot={slot}>
        <chakra.button type="button" css={props.styles.cellHead} data-open={c.open > 0n ? "" : undefined} onClick={() => props.select({ type: "slot", slot })}>{String(c.filled)} / {String(c.positions)} positions{issues.length > 0 && ` · ${issues.length} issues`}</chakra.button>
        <Box css={props.styles.chips}>{assignments(props, slot).map(({ id, a, removed }) => <AssignmentChip key={id} id={id} assignment={a} removed={removed} ctx={ctx} />)}</Box>
        {props.proposals.filter(p => sameSlot(p.slot, slot) && (props.value.visiblePeople.type === "none" || props.value.visiblePeople.value.has(p.person))).map(p => <ProposalCard key={p.key} props={props} proposal={p} />)}
        {c.open > 0n && <Box css={props.styles.openPosition}>{String(c.open)} open position{c.open === 1n ? "" : "s"}</Box>}
        <Box css={props.styles.dropStrip}><SlotActions props={props} slot={slot} />{!props.value.inspector && <RequirementAction slot={slot} week={props.week} held={props.held} value={props.value} commands={props.commands} styles={props.styles} />}</Box>
    </DropSlot>;
}
/**
 * A shifts row of a week not read, or whose read failed (#1398): its head as drawn, and in each slot a placeholder where
 * its figures or its duties go, never a count it has not read — or, in the row the failure is said in, one line across
 * every slot.
 */
function UnreadSlots({ props, head, columns, group, kind, failure, cell }: {
    props: RosterViewsProps; head: ReactNode; columns: readonly { day: number; shift: RosterValue["shifts"][number] }[]; group: string;
    kind: "chip" | "number" | "aggregate"; failure: Extract<PeriodRead, { state: "failed" }> | undefined; cell: Record<string, unknown> | undefined;
}) {
    return <Box css={props.styles.row} data-roster-unread="">{head}
        {failure !== undefined ? <Box css={props.styles.readLine} data-roster-read-line=""><ReadFailure read={failure} /></Box>
            : columns.map(({ day, shift }, c) => {
                const slot = { day: BigInt(day), group, shift: shift.key };
                return <Box key={slotKey(slot)} css={cell} data-roster-slot={slotKey(slot)}><Unread read={props.read} kind={kind} index={c} /></Box>;
            })}
    </Box>;
}
function Shifts({ props, ctx }: { props: RosterViewsProps; ctx: ViewContext }) {
    const { collapsed, toggle } = useGroupCollapse(props.drag.surface);
    const days = props.view.period === "week" ? Array.from({ length: 7 }, (_, d) => d) : [props.day];
    const columns = days.flatMap(day => props.value.shifts.map(shift => ({ day, shift })));
    const style = { "--roster-columns": columns.length } as CSSProperties;
    // A week not read, or whose read failed (#1398): the days, shifts and groups, known without it, at once, and a
    // placeholder where each figure or duty goes; the failure said once, in the first open group's first row.
    const unread = props.read.state !== "held";
    const failedIn = props.read.state === "failed" ? props.value.groups.find(group => !collapsed.includes(group.key))?.key : undefined;
    const failure = props.read.state === "failed" ? props.read : undefined;
    return <Box css={props.styles.scroll} data-roster-grid="shifts"><Box css={props.styles.grid} data-period={props.view.period} style={style}>
        <Box css={props.styles.head}>
            {props.view.period === "week" && <Box css={props.styles.row}><Box css={props.styles.gutter} />{days.map(day => <chakra.button type="button" key={day} css={props.styles.shiftHead} data-roster-column-header="" style={{ gridColumn: `span ${props.value.shifts.length}` }} data-week="" data-selected={props.day === day ? "" : undefined}
                onClick={() => props.setView({ ...props.view, period: "day", date: props.start.getTime() + day * DAY })}><Box css={props.styles.shiftLabel}>{props.format.weekday(new Date(props.start.getTime() + day * DAY))} {new Date(props.start.getTime() + day * DAY).getUTCDate()}</Box></chakra.button>)}</Box>}
            <Box css={props.styles.row}><Box css={[props.styles.gutter, props.styles.headerGutter]} data-week={days.length > 1 ? "" : undefined}><Box css={props.styles.shiftLabel}>Groups</Box><Box css={props.styles.detail}>{props.value.shifts.length} shifts</Box></Box>
                {columns.map(({ day, shift }) => { const at = props.start.getTime() + day * DAY + (Number(shift.start.hour) * 60 + Number(shift.start.minute)) * 60_000; const rows = [...props.coverage].filter(([slot]) => Number(slot.day) === day && slot.shift === shift.key).map(([, c]) => c); return <chakra.button type="button" key={`${day}.${shift.key}`} css={props.styles.shiftHead} data-roster-column-header="" data-week={days.length > 1 ? "" : undefined} onClick={() => props.select({ type: "shift", key: shift.key })}>
                    <Box css={props.styles.shiftHeading}><Box css={props.styles.shiftLabel}>{days.length > 1 ? shift.code : shift.label}</Box>{days.length === 1 && <Box css={props.styles.time}>{props.format.time(new Date(at))}–{props.format.time(new Date(at + shift.hours * 3_600_000))}</Box>}</Box>{days.length === 1 && <Box css={props.styles.shiftMeta}>{unread ? <Unread read={props.read} kind="aggregate" index={0} /> : <>{props.format.number(rows.reduce((n, c) => n + c.filled, 0n))} / {props.format.number(rows.reduce((n, c) => n + c.positions, 0n))} positions · {props.format.number(rows.reduce((n, c) => n + c.hours.needed, 0))} h needed{costed(props.value) && ` · ${money(props.format, props.value, rows.reduce((n, c) => n + c.cost, 0))}`}</>}</Box>}
                </chakra.button>; })}</Box>
        </Box>
        {props.value.groups.map(group => { const coverage = [...props.coverage].filter(([slot]) => slot.group === group.key && days.includes(Number(slot.day))).map(([, c]) => c);
            const issues = props.issues.filter(i => i.slot.type === "some" && i.slot.value.group === group.key && days.includes(Number(i.slot.value.day)) && (i.kind.type === "breach" || i.kind.type === "gap"));
            const needed = coverage.reduce((n, c) => n + c.hours.needed, 0), rostered = coverage.reduce((n, c) => n + c.hours.rostered, 0);
            const requirementHead = <chakra.button type="button" css={[props.styles.gutter, props.styles.rowHead]} onClick={() => props.select({ type: "group", key: group.key })}><Box css={props.styles.eyebrow}>Requirement</Box><Box css={props.styles.title}>Work</Box><Box css={props.styles.detail}>hours by skill</Box><Box css={props.styles.detail}>{unread ? <Unread read={props.read} kind="aggregate" index={0} /> : `${props.format.number(needed)} h needed`}</Box></chakra.button>;
            const assignmentHead = <chakra.button type="button" css={[props.styles.gutter, props.styles.rowHead]} onClick={() => props.select({ type: "group", key: group.key })}><Box css={props.styles.eyebrow}>Assignment</Box><Box css={props.styles.title}>Roster</Box><Box css={props.styles.detail}>{unread ? <Unread read={props.read} kind="aggregate" index={1} /> : `${props.format.number(coverage.reduce((n, c) => n + c.people, 0n))} people`}</Box><Box css={props.styles.detail}>{unread ? null : `${props.format.number(rostered)} h`}</Box></chakra.button>;
            if (unread) {
                // The group's band and its rows' heads as drawn; a placeholder where each figure goes, and in each slot.
                const failing = failedIn === group.key ? failure : undefined;
                return <Fragment key={group.key}><GroupHeading scope="roster" group={group} styles={props.styles} collapsed={collapsed.includes(group.key)} toggle={toggle}><Box as="span" css={props.styles.groupMeta}><Unread read={props.read} kind="aggregate" index={2} /></Box></GroupHeading>
                    {!collapsed.includes(group.key) && <>
                        {props.value.settings.requirements && <UnreadSlots props={props} head={requirementHead} columns={columns} group={group.key} kind={days.length > 1 ? "number" : "aggregate"} failure={failing}
                            cell={days.length > 1 ? props.styles.weekCell : props.styles.requirement} />}
                        <UnreadSlots props={props} head={assignmentHead} columns={columns} group={group.key} kind={days.length > 1 ? "number" : "chip"}
                            failure={props.value.settings.requirements ? undefined : failing} cell={days.length > 1 ? props.styles.weekCell : props.styles.cell} />
                    </>}</Fragment>;
            }
            return <Fragment key={group.key}><GroupHeading scope="roster" group={group} styles={props.styles} collapsed={collapsed.includes(group.key)} toggle={toggle}><Box as="span" css={props.styles.groupMeta}>{props.format.number(needed)} h needed · {props.format.number(rostered)} h rostered · {rostered >= needed ? "+" : ""}{props.format.number(rostered - needed)} h{costed(props.value) && ` · ${money(props.format, props.value, coverage.reduce((n, c) => n + c.cost, 0))}`}</Box>{issues.length > 0 && <Box as="span" css={props.styles.flag} data-tone={issues.some(i => i.tone.type === "danger") ? "danger" : "warning"}>{issues.length} issues</Box>}
            </GroupHeading>{!collapsed.includes(group.key) && <>
                {props.value.settings.requirements && <Box css={props.styles.row}>{requirementHead}
                    {columns.map(({ day, shift }) => { const slot = { day: BigInt(day), group: group.key, shift: shift.key }, c = props.coverage.get(slot)!; return <chakra.button type="button" key={slotKey(slot)} css={days.length > 1 ? props.styles.weekCell : props.styles.requirement} data-roster-requirement={slotKey(slot)} onClick={() => { props.select({ type: "requirement", slot }); if (days.length > 1) props.setView({ ...props.view, period: "day", date: props.start.getTime() + day * DAY }); }}>
                        {days.length > 1 ? <><Box css={props.styles.weekValue}>{props.format.number(c.hours.needed)}</Box><Box css={props.styles.weekFill}><Box css={props.styles.weekFillValue} style={{ width: `${Math.min(c.hours.rostered / Math.max(c.hours.needed, 1), 1) * 100}%` }} /></Box><Box css={props.styles.weekValue} data-tone={c.hours.rostered < c.hours.needed ? "warning" : undefined}>{props.format.number(c.hours.rostered - c.hours.needed)}</Box></> : <CoverageView coverage={c} value={props.value} styles={props.styles} format={props.format} compact={props.value.settings.density.type === "compact"} />}
                    </chakra.button>; })}</Box>}
                <Box css={props.styles.row}>{assignmentHead}
                    {columns.map(({ day, shift }) => { const slot = { day: BigInt(day), group: group.key, shift: shift.key }, c = props.coverage.get(slot)!; return days.length === 1 ? <DayAssignments key={slotKey(slot)} props={props} ctx={ctx} slot={slot} />
                        : <DropSlot key={slotKey(slot)} props={props} slot={slot} compact><chakra.button type="button" css={props.styles.weekValue} data-tone={c.open > 0n ? "warning" : undefined} aria-label={`${group.label} ${props.format.weekday(new Date(props.start.getTime() + day * DAY))} ${shift.label}, ${c.filled} of ${c.positions} positions`} onClick={() => { props.select({ type: "slot", slot }); props.setView({ ...props.view, period: "day", date: props.start.getTime() + day * DAY }); }}>{String(c.filled)}/{String(c.positions)}</chakra.button><Box css={props.styles.weekFill}><Box css={props.styles.weekFillValue} style={{ width: `${Math.min(Number(c.filled) / Math.max(Number(c.positions), 1), 1) * 100}%` }} /></Box>{props.issues.some(i => i.slot.type === "some" && sameSlot(i.slot.value, slot)) && <Box css={props.styles.issueDot} aria-label="Shift has issues" />}</DropSlot>; })}
                </Box>
            </>}</Fragment>;
        })}
    </Box></Box>;
}
type PeopleRow = { key: string; group: RosterValue["groups"][number] } & (
    { kind: "group" } | { kind: "person"; person: RosterValue["people"][number] | undefined }
);
/** A person's row, or a group's agency requests'. */
type PersonRowValue = Extract<PeopleRow, { kind: "person" }>;
/** Shared stable rows for desktop People and its explicit-action phone cards. */
function usePeopleRows(value: RosterValue, collapsed: readonly string[]): PeopleRow[] {
    return useMemo(() => {
        const people = value.people.filter(p => value.visiblePeople.type === "none" || value.visiblePeople.value.has(p.key));
        const rank = (p: typeof people[number]) => p.agency ? 2 : value.positions.find(pos => pos.key === p.position)?.lead ? 0 : 1;
        return value.groups.flatMap(group => [
            { kind: "group" as const, key: `group:${group.key}`, group },
            ...(collapsed.includes(group.key) ? [] : [
                ...people.filter(p => p.group === group.key).sort((a, b) => rank(a) - rank(b)).map(person => ({ kind: "person" as const, key: `person:${person.key}`, group, person })),
                { kind: "person" as const, key: `requests:${group.key}`, group, person: undefined },
            ]),
        ]);
    }, [value.people, value.visiblePeople, value.positions, value.groups, collapsed]);
}
/**
 * The row a failed week says so in (#1398, CL11): the first person's — or a group's Agency requests' — at or below the
 * row at the top of the view, else the last such above it.
 *
 * @param rows - The People rows
 * @param top - The row at the top of the view; `undefined` before the rows are placed
 * @returns The row's index; `undefined` with no person row at all
 */
function firstPersonInView(rows: readonly PeopleRow[], top: number | undefined): number | undefined {
    const from = Math.max(0, top ?? 0);
    for (let i = from; i < rows.length; i++) if (rows[i]!.kind === "person") return i;
    for (let i = Math.min(from, rows.length) - 1; i >= 0; i--) if (rows[i]!.kind === "person") return i;
    return undefined;
}
/** Bring an explicitly selected person into either virtual People layout. */
function selectedPeopleRow(props: RosterViewsProps, rows: readonly PeopleRow[]): number | undefined {
    const selected = props.selection;
    const assignment = selected?.type === "assignment" ? props.week.assignments.get(selected.key) ?? props.held.assignments.get(selected.key) : undefined;
    const person = selected?.type === "person" || selected?.type === "personWeek" ? selected.key : assignment?.who.type === "person" ? assignment.who.value : undefined;
    const index = rows.findIndex(row => row.kind === "person" && (person !== undefined ? row.person?.key === person : assignment?.who.type === "request" && row.person === undefined && row.group.key === assignment.slot.group));
    return index < 0 ? undefined : index;
}

/** A kind of People row, as its estimate is measured: a group's band, a person's row, or a group's agency requests'. */
type RowKind = "group" | "person" | "requests";
/** How many rows of a kind are measured for its floor: the first to mount. */
const FLOOR_SAMPLES = 8;
/** Every People row may anchor the view: none is a placeholder whose edge moves as rows land beside it. */
const ANCHOR_EVERY_ROW = () => true;
/**
 * Each kind of row's estimate, measured from the real rows (#1398, problem 12; CL8): the kind's floor — the least a
 * mounted row of it measures, on the device-pixel grid the rows are placed on — every row of the kind at least as tall.
 * A row measured as it comes into view then only grows, below the row in view, and a row the view has passed never
 * moves it. Taken from the first rows of each kind to mount, before they paint; `initial` until then.
 *
 * @param initial - Each kind's estimate before a row of it has mounted
 * @returns The floors, whether a person's row has been measured for them yet, and what a row reports its height to as it mounts
 */
function useRowFloors(initial: Readonly<Record<RowKind, number>>): {
    floors: Readonly<Record<RowKind, number>>; measured: boolean; measure: (kind: RowKind) => (el: HTMLElement | null) => void;
} {
    const [floors, setFloors] = useState(initial);
    const [measured, setMeasured] = useState(false);
    const samples = useRef<Record<RowKind, number>>({ group: 0, person: 0, requests: 0 });
    const report = useCallback((kind: RowKind, px: number) => {
        const taken = samples.current[kind];
        if (taken >= FLOOR_SAMPLES || !(px > 0)) return;
        samples.current[kind] = taken + 1;
        // The first row of a kind measured stands for the kind; each after it lowers its floor.
        setFloors(before => (taken === 0 ? Math.abs(px - before[kind]) >= 0.25 : px < before[kind] - 0.25) ? { ...before, [kind]: px } : before);
        if (kind === "person" && taken === 0) setMeasured(true);
    }, []);
    const refs = useMemo(() => {
        const of = (kind: RowKind) => (el: HTMLElement | null) => { if (el !== null && samples.current[kind] < FLOOR_SAMPLES) report(kind, devicePixels(el.getBoundingClientRect().height)); };
        return { group: of("group"), person: of("person"), requests: of("requests") };
    }, [report]);
    const measure = useCallback((kind: RowKind) => refs[kind], [refs]);
    return { floors, measured, measure };
}

/** The People grids' estimate of each kind before one has mounted: a row one line at the density's pitch (#1406, P30), the theme's band. */
const PEOPLE_FLOORS: Readonly<Record<RowKind, number>> = { group: 38, person: 36, requests: 36 };
const SEVEN_DAYS: readonly number[] = Array.from({ length: 7 }, (_, d) => d);
/** The selected person-week, read by the rows it marks (#1406, D11): its own context, so a duty picked draws no row again. */
const PersonWeekContext = createContext<{ readonly key: string; readonly start: number } | undefined>(undefined);

/** A day's duties as a cell draws them (D5): the tombstones a draft removed, the first live duty, and how many more live ones there are. */
function dayTiles(duties: readonly DayDuty[]): { tiles: readonly DayDuty[]; more: number } {
    const live = duties.filter(duty => !duty.removed);
    return { tiles: [...duties.filter(duty => duty.removed), ...live.slice(0, 1)], more: Math.max(0, live.length - 1) };
}
/** Whether a day's duties hold a draft against the week as held: one added, moved, edited or removed (P9). */
function dayDrafted(domain: RosterDomain, held: Week, duties: readonly DayDuty[]): boolean {
    return duties.some(({ id, a, removed }) => { if (removed) return true; const baseline = held.assignments.get(id); return baseline === undefined || !domain.sameAssignment(baseline, a); });
}
/** A shift's fill and ink, as a tile's or a mark's style (D6): the theme's palette through its CSS variables, the one data binding the theme leaves to the renderer. */
function fillOf(shift: Shift | undefined): CSSProperties | undefined {
    const color = shiftColor(shift);
    return color === undefined ? undefined : { "--roster-fill": color.fill, "--roster-ink": color.ink } as CSSProperties;
}

interface TileProps { ctx: ViewContext; id: string; assignment: Assignment; removed: boolean; person: Person | undefined }
/** Keep the shared drag hooks outside the tile body: pointer motion does not repaint its contents. */
function Tile(args: TileProps) {
    const { ctx, id, assignment: a, removed } = args;
    const { styles, value, drag } = ctx;
    const selection = useContext(SelectionContext);
    const selected = selection?.type === "assignment" && selection.key === id;
    const name = assignmentName(value, a);
    const coord = useMemo(() => ({ ...rosterCoord(drag.surface, a.slot, id), event: id }), [drag.surface, a.slot, id]);
    const ghost = useMemo(() => <MoveGhost styles={styles} label={name} />, [styles, name]);
    const enabled = drag.enabled && !removed;
    const handle = useDragEventChip(enabled ? coord : null, ghost, !enabled, name);
    const canDrop = useCallback((event: DragEventValue) => drag.run(event, true) === undefined, [drag]);
    const drop = useDropCell(enabled ? coord : null, !enabled, canDrop, undefined, { caption: drag.caption });
    const dragRef = handle?.ref;
    const attach = useCallback((element: HTMLDivElement | null) => { dragRef?.(element); drop(element); }, [dragRef, drop]);
    return <TileBody {...args} selected={selected} handle={handle} attach={attach} />;
}
/**
 * A tile a duty (#1406, D5, P7): the shift's label, then its own times where they differ from the shift's, else the
 * group where it is not the person's, else the shift's hours where `tileTimes` is always; a warning mark where an issue
 * names it; its fill the shift's colour token, its words in the ink the shade takes. Tile state comes from the held
 * week and the domain issues, never from a second draft store.
 */
const TileBody = memo(function TileBody({ ctx, id, assignment: a, removed, person, selected, handle, attach }: TileProps & {
    selected: boolean; handle: ReturnType<typeof useDragEventChip>; attach: (element: HTMLDivElement | null) => void;
}) {
    const { styles, value, commands, drag, format } = ctx;
    const name = assignmentName(value, a);
    const enabled = drag.enabled && !removed;
    const shift = shiftOf(value, a.slot.shift);
    const issues = removed ? NO_ISSUES : dutyIssues(ctx.issues, id);
    const baseline = ctx.held.assignments.get(id);
    const drafted = removed || baseline === undefined || !ctx.domain.sameAssignment(baseline, a);
    const group = person !== undefined && person.group !== a.slot.group ? value.groups.find(g => g.key === a.slot.group)?.label ?? a.slot.group : undefined;
    const meta = ownTimes(value, a, ctx.start) ? { kind: "own" as const, text: `${hourText(a.start)}–${hourText(a.end)}` }
        : group !== undefined ? { kind: "group" as const, text: group.toLocaleUpperCase(format.locale) }
            : ctx.tileTimes === "always" && shift !== undefined ? { kind: "hours" as const, text: shiftHoursText(shift) } : undefined;
    const danger = issues.some(i => i.tone.type === "danger");
    const label = `${name} · ${shift?.label ?? a.slot.shift}${meta === undefined ? "" : ` · ${meta.text}`}${removed ? " · removed" : ""}`;
    // What a run of the optimiser did to the duty (#1409, R23): its mark — the tile keeps its own fill, the ring and the glow alone — and its provenance on hover.
    const mark = dutyMark(ctx, id, removed, drafted);
    const words = issues.length > 0 ? `${label} · ${issues.map(i => i.title).join(" · ")}` : label;
    return <Box {...handle} ref={attach} css={styles.tile} style={removed ? undefined : fillOf(shift)} tabIndex={0} role="button" aria-label={label} aria-pressed={selected}
        title={mark === undefined ? words : `${mark.provenance} · ${words}`} data-op={mark?.op} data-fill={mark === undefined ? undefined : "own"}
        data-roster-assignment={id} data-roster-tile="" data-layout="people" data-added={baseline === undefined ? "" : undefined} data-moved={baseline !== undefined && !sameSlot(baseline.slot, a.slot) ? "" : undefined}
        data-density={value.settings.density.type} data-selected={selected ? "" : undefined} data-drafted={drafted ? "" : undefined} data-removed={removed ? "" : undefined}
        data-request={a.who.type === "request" ? "" : undefined} data-agency={person?.agency ? "" : undefined}
        data-tone={danger ? "danger" : issues.some(i => i.kind.type === "breach") ? "warning" : undefined} data-draggable={enabled ? "" : undefined}
        onClick={event => { event.stopPropagation(); ctx.select({ type: "assignment", key: id }); }}
        onKeyDown={event => { if (event.key === "Enter") { takeKey(event); ctx.select({ type: "assignment", key: id }); } else handle?.onKeyDown?.(event); }}>
        <Box as="span" css={styles.tileLabel} data-roster-assignment-name="">{a.who.type === "request" ? `AG · ${shift?.label ?? a.slot.shift}` : shift?.label ?? a.slot.shift}</Box>
        {meta !== undefined && <Box as="span" css={styles.tileMeta} data-own={meta.kind === "own" ? "" : undefined} data-group={meta.kind === "group" ? "" : undefined} data-roster-times={meta.kind === "own" ? "" : undefined}>{meta.text}</Box>}
        {issues.length > 0 && <Box as="span" css={styles.tileWarn} data-tone={danger ? "danger" : undefined} data-roster-tile-warn="" role="img" aria-label={issues[0]!.title}><FontAwesomeIcon icon={faTriangleExclamation} /></Box>}
        {(commands.available || commands.locked !== undefined) && <chakra.button type="button" css={styles.chipAction} data-roster-chip-action="" aria-label={removed ? `Restore ${name}` : `Remove ${name}`}
            disabled={commands.locked !== undefined} title={commands.locked}
            onPointerDown={event => event.stopPropagation()} onClick={event => { event.stopPropagation(); if (removed) commands.restore(id); else commands.remove(id); }}><FontAwesomeIcon icon={removed ? faRotateLeft : faXmark} /></chakra.button>}
    </Box>;
});
/** A day's tile as a pattern hovering the row would leave it (P19): the pattern's shift dashed in the brand tone, or the day off. */
function PreviewTile({ ctx, day }: { ctx: ViewContext; day: PatternDay }) {
    const shift = day.shift === undefined ? undefined : shiftOf(ctx.value, day.shift);
    return <Box css={ctx.styles.tile} data-preview="" data-off={day.kind === "off" ? "" : undefined} data-roster-preview={day.kind} aria-hidden="true">
        <Box as="span" css={ctx.styles.tileLabel}>{day.kind === "off" ? "Off" : shift?.label ?? day.shift}</Box>
        {shift !== undefined && <Box as="span" css={ctx.styles.tileMeta}>{shiftHoursText(shift)}</Box>}
    </Box>;
}
/**
 * An off day's `+ Assign` (#1406, D9, P8): a menu of the shifts, each its label, its swatch and its times, whose choice
 * places the person on it in their home group that day, one gesture; `Elsewhere…` opens the place form for another
 * group or day. While a run of the optimiser holds the week (#1409, R2) the trigger stays in place, inert and saying
 * why, with no menu; a place form the run finds open closes, and stays closed as the run ends.
 */
function AssignMenu({ ctx, person, group, day }: { ctx: ViewContext; person: Person; group: string; day: number }) {
    const { value, styles, commands, start, format } = ctx;
    const [elsewhere, setElsewhere] = useState(false);
    const { locked } = commands;
    useEffect(() => { if (locked !== undefined) setElsewhere(false); }, [locked]);
    const date = new Date(start.getTime() + day * DAY);
    const slotFor = (shift: string): Slot => ({ day: BigInt(day), group, shift });
    const usual = person.usual.type === "some" ? person.usual.value : value.shifts[0]!.key;
    const trigger = <chakra.button type="button" css={styles.assign} data-roster-assign={`${person.key}.${day}`} data-roster-off="" aria-label={`Assign ${person.name} · ${format.weekday(date)}`}
        disabled={locked !== undefined} title={locked}>+ Assign</chakra.button>;
    if (locked !== undefined) return trigger;
    if (elsewhere) return <PlacePopover label="Elsewhere…" source={{ type: "person", key: person.key }} slot={slotFor(usual)} value={value} start={start} commands={commands} styles={styles} onClose={() => setElsewhere(false)} />;
    return <ChakraMenu.Root positioning={{ placement: "bottom-start" }} onSelect={d => {
        if (d.value === "elsewhere") { setElsewhere(true); return; }
        ctx.onError(commands.place({ type: "person", key: person.key }, slotFor(d.value)));
    }}>
        <ChakraMenu.Trigger asChild>
            {trigger}
        </ChakraMenu.Trigger>
        <Portal>
            <ChakraMenu.Positioner>
                <ChakraMenu.Content data-roster-assign-menu="">
                    <Box css={styles.assignMenuHead}>Assign · {format.weekday(date)} {format.number(date.getUTCDate())}</Box>
                    {value.shifts.map(shift => <ChakraMenu.Item key={shift.key} value={shift.key} css={styles.assignItem} data-roster-assign-shift={shift.key}>
                        <Box as="span" css={styles.swatch} style={fillOf(shift)} aria-hidden="true" /><span>{shift.label}</span><Box as="span" data-roster-shift-times="">{shiftHoursText(shift)}</Box>
                    </ChakraMenu.Item>)}
                    <ChakraMenu.Separator />
                    <ChakraMenu.Item value="elsewhere">Elsewhere…</ChakraMenu.Item>
                </ChakraMenu.Content>
            </ChakraMenu.Positioner>
        </Portal>
    </ChakraMenu.Root>;
}
/**
 * A person's day in the People grid (#1406, P6–P11): a tile per duty and `+1` for a second, or `+ Assign` on a day off,
 * drawn again only as the day's duties, its person or what the views show changes (#1398, CL9). A drop on it resolves to
 * the dragged person's same or usual shift; a pattern dropped on it lands on the person's week (§11), and while one
 * hovers the row the day previews what the pattern leaves it (P19); another person's duty is refused (P11).
 *
 * The cell is its drop hooks and its attributes alone; what it shows is {@link PersonDayBody}, its own memo. The shared
 * drag hooks subscribe to the layer, which moves on every change of the cell a drag rests over, so a hundred cells draw
 * again each time one is crossed: a subscriber's draw must cost next to nothing, and the tiles, the `+ Assign` and the
 * preview draw again only as their own props change.
 */
const PersonDay = memo(function PersonDay({ ctx, person, group, day, duties, current, weekSelected, preview, hovering, onPatternHover, onPatternLeave }: {
    ctx: ViewContext; person: Person | undefined; group: string; day: number; duties: readonly DayDuty[];
    /** Whether the day is the one the views show: the day a Shifts view steps to. */
    current: boolean;
    /** Whether the person-week is selected: the row's cells outlined (D11). */
    weekSelected: boolean;
    /** What a pattern hovering the row leaves the day, while one does. */
    preview: PatternDay | undefined; hovering: boolean;
    onPatternHover: (key: string) => void; onPatternLeave: () => void;
}) {
    const { drag, value, week, styles, start } = ctx;
    const key = person?.key ?? `requests:${group}`;
    const initial = useMemo(() => ({ day: BigInt(day), group, shift: person?.usual.type === "some" ? person.usual.value : value.shifts[0]!.key }), [day, group, person, value.shifts]);
    // A pattern lands on the person's week, whatever day of it the drag rests over; the requests row refuses it in its words.
    const personWeek = useMemo(() => rosterPersonWeekCoord(drag.surface, key, start), [drag.surface, key, start]);
    const resolve = useCallback((_x: number, _y: number, payload: DragPayload): CellCoord => {
        if (isPatternCard(payload, drag.surface)) return personWeek;
        const a = payload.kind === "event" ? week.assignments.get(payload.from.event) : undefined;
        return rosterCoord(drag.surface, a === undefined ? initial : { ...a.slot, day: BigInt(day) });
    }, [week, drag.surface, initial, day, personWeek]);
    /** Whether a dragged duty is another row's: refused, `A duty moves along its own row.` (P11). */
    const crossRow = useCallback((id: string) => {
        const a = week.assignments.get(id);
        return a !== undefined && (person === undefined ? a.who.type !== "request" : !(a.who.type === "person" && a.who.value === person.key));
    }, [week, person]);
    const accepts = useCallback((payload: DragPayload) => {
        if (payload.kind === "event") return week.assignments.has(payload.from.event);
        if (payload.kind !== "item") return false;
        if (isPatternCard(payload, drag.surface)) return true;
        const from = readRosterSource(payload.from.key);
        return from.success && (person === undefined ? from.value.type === "agency" : from.value.type === "person" && from.value.value === person.key);
    }, [week, person, drag.surface]);
    const canDrop = useCallback((event: DragEventValue) => {
        if (event.type === "move" && event.value.from.event.type === "some" && crossRow(event.value.from.event.value)) return false;
        return drag.run(event, true) === undefined;
    }, [drag, crossRow]);
    const caption = useCallback((coord: CellCoord, payload: DragPayload, allowed: boolean) =>
        payload.kind === "event" && crossRow(payload.from.event) ? "A duty moves along its own row." : drag.caption(coord, payload, allowed), [crossRow, drag]);
    const coord = useMemo(() => drag.enabled ? rosterCoord(drag.surface, initial) : null, [drag.enabled, drag.surface, initial]);
    const onHover = useCallback((_x: number, _y: number, payload: DragPayload) => { if (payload.kind === "item" && isPatternCard(payload, drag.surface)) onPatternHover(payload.from.key); }, [drag.surface, onPatternHover]);
    const ref = useDropCell(coord, !drag.enabled, canDrop, resolve, { accepts, caption, onHover, onLeave: onPatternLeave });
    const drafted = useMemo(() => dayDrafted(ctx.domain, ctx.held, duties), [ctx.domain, ctx.held, duties]);
    // While a pattern hovers the row every day shows the pattern's day dashed, and the days it changes are tinted (P19).
    const changes = preview !== undefined && preview.kind !== "keep";
    return <Box ref={ref} css={styles.dayCell} data-roster-person-day={`${key}.${day}`} data-selected={current ? "" : undefined} data-week-selected={weekSelected ? "" : undefined}
        data-drafted={drafted ? "" : undefined} data-pattern-hover={hovering ? "" : undefined} data-pattern-changes={changes ? "" : undefined} data-roster-previewing={preview !== undefined ? "" : undefined}>
        <PersonDayBody ctx={ctx} person={person} group={group} day={day} duties={duties} preview={preview} />
    </Box>;
});
/**
 * What a person's day shows: its tiles, `+1`, `+ Assign` or `Off` — and, while a pattern hovers its row, the pattern's
 * day beside them, the day's own tiles kept mounted and hidden by the cell (`data-roster-previewing`): a tile's drag
 * hooks register with the layer and with dnd-kit, and mounting and unmounting the tiles as the hover moved had every
 * droppable measured again and every subscriber drawn again, row after row.
 */
const PersonDayBody = memo(function PersonDayBody({ ctx, person, group, day, duties, preview }: {
    ctx: ViewContext; person: Person | undefined; group: string; day: number; duties: readonly DayDuty[]; preview: PatternDay | undefined;
}) {
    const { styles, commands } = ctx;
    peopleDrawProbe?.("day", `${person?.key ?? `requests:${group}`}.${day}`);
    const { tiles, more } = dayTiles(duties);
    const off = person !== undefined && !duties.some(duty => !duty.removed);
    return <>
        {preview !== undefined && <PreviewTile ctx={ctx} day={preview} />}
        {tiles.map(({ id, a, removed }) => <Tile key={id} ctx={ctx} id={id} assignment={a} removed={removed} person={person} />)}
        {more > 0 && <Box as="span" css={styles.tileMore} data-roster-more={more} title={`${more} more`}>+{more}</Box>}
        {off && (commands.available || commands.locked !== undefined ? <AssignMenu ctx={ctx} person={person} group={group} day={day} /> : <Box css={styles.detail}>Off</Box>)}
    </>;
});
/** A person's name cell (#1406, D8): the name, the Agency badge, and — by week — the week's hours against the contract over the meter. */
function NameCell({ ctx, person, rowKey, weekSelected, hours, nameRef }: {
    ctx: ViewContext; person: Person | undefined; rowKey: string; weekSelected: boolean;
    /** The hours cell; nothing in the month (P16). */
    hours: ReactNode; nameRef?: RefObject<HTMLButtonElement | null> | undefined;
}) {
    const { styles, start } = ctx;
    return <Box css={styles.peopleName} data-selected={weekSelected ? "" : undefined} data-roster-person-name="">
        <Box css={styles.nameLine}>
            <chakra.button ref={nameRef} type="button" css={styles.personName} data-roster-person-head={person?.key} aria-pressed={weekSelected}
                onClick={() => person !== undefined && ctx.select({ type: "personWeek", key: rowKey, start: start.getTime() })}><span>{person?.name ?? "Agency requests"}</span></chakra.button>
            {person?.agency && <Box as="span" css={styles.agencyBadge} data-roster-agency-badge="">Agency</Box>}
        </Box>
        {hours}
    </Box>;
}
/** A person's week's hours against their contract, over the meter, with the cost where the app gives pay (D8, P5). */
function WeekHours({ ctx, person, total, cost }: { ctx: ViewContext; person: Person; total: number; cost: number | undefined }) {
    const { styles, format, value } = ctx;
    const over = total > person.contract;
    // A run of the optimiser that changed the person's week flashes their hours and their meter (#1409, §9.5).
    return <Box css={styles.hoursCell} data-roster-week-hours="" data-tone={over ? "warning" : undefined} data-opn={ctx.lit && ctx.optimised?.people.has(person.key) === true ? "" : undefined}>
        <Box css={styles.hoursText}>{format.number(total)} / {format.number(person.contract)} h{cost !== undefined && ` · ${money(format, value, cost)}`}</Box>
        <Box css={styles.meter} data-roster-meter="" role="img" aria-label={`${format.number(total)} of ${format.number(person.contract)} hours`}><Box css={styles.meterFill} style={{ width: `${Math.min(total / Math.max(person.contract, 1), 1) * 100}%` }} /></Box>
    </Box>;
}
/** A person's week's hours while the week is not read: a placeholder where they go, beside the contract known without it. */
function UnreadHours({ ctx, person, index }: { ctx: ViewContext; person: Person | undefined; index: number }) {
    return person === undefined ? null : <Box css={ctx.styles.hoursCell}><Box css={ctx.styles.unreadValue} data-roster-week-hours="">
        <Unread read={ctx.read} kind="number" index={index} />{`/ ${ctx.format.number(person.contract)} h`}</Box></Box>;
}
/** A person's row, or a group's requests', in the People grid: its name cell and its seven days, one line (#1406, §8). */
const PersonRow = memo(function PersonRow({ ctx, row, index, rows, days, duties, measure }: {
    ctx: ViewContext; row: PersonRowValue; index: number; rows: readonly PeopleRow[]; days: WeekDays; duties: readonly string[] | undefined;
    measure: (el: HTMLElement | null) => void;
}) {
    const { styles, value, start, commands } = ctx;
    const person = row.person, key = person?.key ?? row.key;
    peopleDrawProbe?.("row", key);
    // The name the keyboard stepped to takes the focus as its row mounts — at once, or once the frame brings it into view.
    const focus = useContext(PeopleFocusContext);
    const name = useRef<HTMLButtonElement>(null);
    const stepped = person !== undefined && focus.key === person.key;
    useLayoutEffect(() => { if (stepped && name.current !== null) { name.current.focus({ preventScroll: true }); focus.done(); } }, [stepped, focus]);
    const picked = useContext(PersonWeekContext);
    const weekSelected = person !== undefined && picked !== undefined && picked.key === person.key && picked.start === start.getTime();
    // A pattern hovering the row: what it would leave each day (P19), from the same plan a drop applies.
    const [previewKey, setPreviewKey] = useState<string>();
    const onPatternHover = useCallback((next: string) => setPreviewKey(next), []);
    const onPatternLeave = useCallback(() => setPreviewKey(undefined), []);
    const plan = useMemo(() => previewKey === undefined || person === undefined ? undefined : commands.pattern(person.key, start, previewKey), [previewKey, person, commands, start]);
    const previewDays = typeof plan === "object" ? plan.days : undefined;
    const density = value.settings.density.type;
    // A week not read, or whose read failed (#1398): the people and their contracts, known without it, at once; a
    // placeholder where each day's duties go, never `+ Assign`; the failure said once, in the first person's row in
    // view, across their days.
    if (ctx.read.state === "failed") return <FailedPersonRow ctx={ctx} read={ctx.read} rowKey={key} person={person} index={index} rows={rows} measure={measure} />;
    if (ctx.read.state !== "held") return <Box ref={measure} css={styles.peopleRow} data-roster-person-row={key} data-density={density} data-roster-unread="">
        <NameCell ctx={ctx} person={person} rowKey={key} weekSelected={false} hours={<UnreadHours ctx={ctx} person={person} index={index} />} />
        {SEVEN_DAYS.map(day => <Box key={day} css={styles.dayCell} data-roster-person-day={`${key}.${day}`}><Unread read={ctx.read} kind="chip" index={index + day} /></Box>)}
    </Box>;
    const total = ctx.hours.get(key) ?? 0;
    // A person's week's cost, every code summed: theirs alone, from the app's pay.
    const cost = person === undefined || !costed(value) ? undefined : costsOf(ctx.pay, duties ?? []).total;
    return <Box ref={measure} css={styles.peopleRow} data-roster-person-row={key} data-density={density}>
        <NameCell ctx={ctx} person={person} rowKey={key} weekSelected={weekSelected} nameRef={name} hours={person === undefined ? null : <WeekHours ctx={ctx} person={person} total={total} cost={cost} />} />
        {SEVEN_DAYS.map(day => <PersonDay key={day} ctx={ctx} person={person} group={row.group.key} day={day} duties={days[day] ?? NO_DUTIES} current={ctx.day === day}
            weekSelected={weekSelected} preview={previewDays?.[day]} hovering={previewKey !== undefined} onPatternHover={onPatternHover} onPatternLeave={onPatternLeave} />)}
    </Box>;
});
/**
 * A person's row of a week whose read failed (#1398, CL11): blank, or — the first person's row in view — the failure said
 * across their days. It reads which row is at the top of the view itself, drawn again only as it becomes or stops being
 * that row (CL9).
 */
function FailedPersonRow({ ctx, read, rowKey, person, index, rows, measure }: {
    ctx: ViewContext; read: Extract<PeriodRead, { state: "failed" }>; rowKey: string; person: Person | undefined; index: number;
    rows: readonly PeopleRow[]; measure: (el: HTMLElement | null) => void;
}) {
    const says = useRowsTop(top => firstPersonInView(rows, top) === index);
    return <Box ref={measure} css={ctx.styles.peopleRow} data-roster-person-row={rowKey} data-density={ctx.value.settings.density.type} data-roster-unread="">
        <NameCell ctx={ctx} person={person} rowKey={rowKey} weekSelected={false} hours={<UnreadHours ctx={ctx} person={person} index={index} />} />
        {says ? <Box css={ctx.styles.readLine} data-days="" data-roster-read-line=""><ReadFailure read={read} /></Box>
            : SEVEN_DAYS.map(day => <Box key={day} css={ctx.styles.dayCell} data-roster-person-day={`${rowKey}.${day}`} />)}
    </Box>;
}
/**
 * ↑ / ↓ on a person's name: the next person, or the one before — the groups' bands and their agency requests passed
 * over, a folded group's people not among them — selected for the week in view, their row brought into view and their
 * name focused (#1398), as a pick in Search Records focuses its person's ({@link usePeopleFocus}).
 */
function usePeopleArrows(rows: readonly PeopleRow[], select: (next: Selection) => void, start: Date, picked: PeoplePick | undefined) {
    const { focus, stepTo } = usePeopleFocus(rows, picked);
    const onKeyDown = useCallback((event: KeyboardEvent<HTMLDivElement>) => {
        if (event.key !== "ArrowDown" && event.key !== "ArrowUp") return;
        const from = (event.target as Element).closest?.("[data-roster-person-head]")?.getAttribute("data-roster-person-head");
        if (from === null || from === undefined) return;
        // The arrow is the People grid's: it goes no further than the Roster (#1398).
        takeKey(event);
        const by = event.key === "ArrowDown" ? 1 : -1;
        for (let i = rows.findIndex(row => row.kind === "person" && row.person?.key === from) + by; i >= 0 && i < rows.length; i += by) {
            const row = rows[i]!;
            if (row.kind !== "person" || row.person === undefined) continue;
            stepTo(row.person.key);
            select({ type: "personWeek", key: row.person.key, start: start.getTime() });
            return;
        }
    }, [rows, select, stepTo, start]);
    return { focus, onKeyDown };
}
/** The People grid by week (#1406, §8): a sticky header, a group band a group, a row a person. */
function People({ props, ctx }: { props: RosterViewsProps; ctx: ViewContext }) {
    const { collapsed, toggle } = useGroupCollapse(props.drag.surface);
    const rows = usePeopleRows(props.value, collapsed);
    const index = useMemo(() => peopleIndex(props.week, props.held), [props.week, props.held]);
    const { floors, measured, measure } = useRowFloors(PEOPLE_FLOORS);
    // A new floor places every row again at it, the rows measured kept: a new key function is what has the rows' places
    // worked out again.
    const getItemKey = useCallback((i: number) => rows[i]!.key, [rows, floors]); // eslint-disable-line react-hooks/exhaustive-deps -- the floors re-key the places
    const estimateSize = useCallback((i: number) => { const row = rows[i]!; return row.kind === "group" ? floors.group : row.person === undefined ? floors.requests : floors.person; }, [rows, floors]);
    // A row drawn again only as what it shows changes: the same function while the rows, the week and the views hold (CL9).
    const renderRow = useCallback((i: number) => {
        const row = rows[i]!;
        if (row.kind === "group") return <GroupHeading scope="roster" group={row.group} styles={ctx.styles} collapsed={collapsed.includes(row.group.key)} toggle={toggle} measure={measure("group")} />;
        const days = row.person === undefined ? index.requests.get(row.group.key) : index.person.get(row.person.key);
        return <PersonRow ctx={ctx} row={row} index={i} rows={rows} days={days ?? NO_DAYS} duties={row.person === undefined ? undefined : index.duties.get(row.person.key)}
            measure={measure(row.person === undefined ? "requests" : "person")} />;
    }, [rows, ctx, collapsed, toggle, index, measure]);
    const density = props.value.settings.density.type;
    const header = <Box css={props.styles.peopleRow} data-roster-people-head="" data-density={density}>
        <Box css={props.styles.peopleName} data-head=""><Box css={props.styles.shiftLabel}>People · Week</Box><Box css={props.styles.shiftLabel}>Hours</Box></Box>
        {SEVEN_DAYS.map(day => { const date = new Date(props.start.getTime() + day * DAY); return <Box key={day} css={props.styles.shiftHead} data-roster-column-header="" data-week="" data-people="" data-selected={props.day === day ? "" : undefined}>
            <Box css={props.styles.shiftLabel}>{props.format.weekday(date)} {date.getUTCDate() === 1 ? `${props.format.number(1)} ${props.format.month(date)}` : props.format.number(date.getUTCDate())}</Box></Box>; })}
    </Box>;
    // Where the rows' view rests, by its top row's key (#1398): saved as a scroll settles, brought back as they mount.
    const { onAnchor } = props;
    const save = useCallback((at: RowAnchor) => onAnchor?.({ people: at }), [onAnchor]);
    const { restore, onAnchorChange } = useRowAnchor(rows, props.anchor?.people, save, measured);
    // ↑ / ↓ on a person's name step to the next person, selected for the week in view; a pick in Search Records focuses its person's name (#1398).
    const { focus, onKeyDown } = usePeopleArrows(rows, props.select, props.start, props.picked);
    return <Box css={props.styles.main} data-roster-grid="people" onKeyDown={onKeyDown}>
        <PeopleFocusContext.Provider value={focus}>
            <VirtualRows fillParent height={undefined} maxHeight={undefined} minWidth="var(--roster-people-width)" rootCss={props.styles.scroll}
                header={header} count={rows.length} getItemKey={getItemKey} estimateSize={estimateSize} anchorable={ANCHOR_EVERY_ROW}
                scrollToIndex={selectedPeopleRow(props, rows)} scrollAlign="auto" renderRow={renderRow}
                onAnchorChange={onAnchorChange} restoreAnchor={restore} />
        </PeopleFocusContext.Provider>
    </Box>;
}

// ── The month (#1406, §8, P12–P16) ─────────────────────────────────────────────────────────────────────────────────

/** A week column's header: `W10` and `Mar 5 – 11` over its seven days' ticks; a press opens the week in Week (P12). */
function WeekColumnHead({ ctx, week, current }: { ctx: ViewContext; week: Date; current: boolean }) {
    const { styles, format } = ctx;
    const number = weekNumber(week), range = format.range(week, new Date(week.getTime() + 6 * DAY));
    return <chakra.button type="button" css={styles.weekHead} data-roster-week-column={weekKey(week)} data-roster-column-header="" data-selected={current ? "" : undefined}
        aria-label={`Open W${format.number(number)} · ${range}`} onClick={() => ctx.openWeek(week)}>
        <Box css={styles.weekNumber}><span>W{format.number(number)}</span><Box as="span" css={styles.weekRange}>{range}</Box></Box>
        <Box css={styles.dayTicks}>{SEVEN_DAYS.map(day => { const date = new Date(week.getTime() + day * DAY); return <Box key={day} css={styles.dayTick}>
            <span>{format.weekday(date).slice(0, 1).toLocaleUpperCase(format.locale)}</span><span>{format.number(date.getUTCDate())}</span></Box>; })}</Box>
    </chakra.button>;
}
/** A day's mark in a week cell (P13): the shift's letter in its colour, an off day faint; dashed where a pattern previews it; drafted against its own week as held. */
function Mark({ ctx, held, day, duties, preview, letters }: { ctx: ViewContext; held: Week; day: number; duties: readonly DayDuty[]; preview: PatternDay | undefined; letters: boolean }) {
    const { value, styles } = ctx;
    // While a pattern hovers the cell its seven marks are the pattern's days, dashed (P15).
    if (preview !== undefined) {
        const shift = preview.shift === undefined ? undefined : shiftOf(value, preview.shift);
        return <Box as="span" css={styles.mark} data-roster-mark={day} data-preview={preview.kind} data-off={shift === undefined ? "" : undefined} style={fillOf(shift)}>{letters ? shift?.code ?? "" : ""}</Box>;
    }
    const live = duties.filter(duty => !duty.removed);
    const first = live[0] ?? duties[0];
    if (first === undefined) return <Box as="span" css={styles.mark} data-roster-mark={day} data-off="" />;
    const shift = shiftOf(value, first.a.slot.shift);
    const drafted = first.removed || (() => { const baseline = held.assignments.get(first.id); return baseline === undefined || !ctx.domain.sameAssignment(baseline, first.a); })();
    return <Box as="span" css={styles.mark} data-roster-mark={day} data-shift={first.a.slot.shift} data-removed={live.length === 0 ? "" : undefined} data-drafted={drafted ? "" : undefined}
        style={live.length === 0 ? undefined : fillOf(shift)} title={`${shift?.label ?? first.a.slot.shift}${live.length > 1 ? ` +${live.length - 1}` : ""}`}>{letters ? shift?.code ?? "" : ""}</Box>;
}
/**
 * A person's week in the month (P13–P15): seven marks, a drop target for a pattern, a click selecting the person-week;
 * tinted while a day of it is drafted; a placeholder strip while the month is not read (P26).
 */
const MonthCell = memo(function MonthCell({ ctx, person, group, held, days, letters, selected }: {
    ctx: ViewContext; person: Person | undefined; group: string; held: WeekState; days: WeekDays; letters: boolean; selected: boolean;
}) {
    const { drag, styles, commands, value } = ctx;
    const key = person?.key ?? `requests:${group}`;
    const start = held.start;
    const coord = useMemo(() => drag.enabled ? rosterPersonWeekCoord(drag.surface, key, start) : null, [drag.enabled, drag.surface, key, start]);
    const accepts = useCallback((payload: DragPayload) => isPatternCard(payload, drag.surface), [drag.surface]);
    const canDrop = useCallback((event: DragEventValue) => drag.run(event, true) === undefined, [drag]);
    const [previewKey, setPreviewKey] = useState<string>();
    const onHover = useCallback((_x: number, _y: number, payload: DragPayload) => { if (payload.kind === "item" && isPatternCard(payload, drag.surface)) setPreviewKey(payload.from.key); }, [drag.surface]);
    const onLeave = useCallback(() => setPreviewKey(undefined), []);
    const ref = useDropCell(coord, !drag.enabled, canDrop, undefined, { accepts, caption: drag.caption, onHover, onLeave });
    const plan = useMemo(() => previewKey === undefined || person === undefined ? undefined : commands.pattern(person.key, start, previewKey), [previewKey, person, commands, start]);
    const previewDays = typeof plan === "object" ? plan.days : undefined;
    const revealed = useRevealed() === true;
    const unread = ctx.read.state !== "held";
    const drafted = !unread && SEVEN_DAYS.some(day => dayDrafted(ctx.domain, held.held, days[day] ?? NO_DUTIES));
    return <chakra.button ref={ref as (el: HTMLButtonElement | null) => void} type="button" css={styles.monthCell} data-roster-person-week={`${key}.${weekKey(start)}`} data-selected={selected ? "" : undefined}
        data-drafted={drafted ? "" : undefined} data-pattern-hover={previewKey !== undefined ? "" : undefined} data-density={value.settings.density.type}
        aria-label={`${person?.name ?? "Agency requests"} · W${ctx.format.number(weekNumber(start))}`} aria-pressed={selected}
        onClick={() => person !== undefined && ctx.select({ type: "personWeek", key, start: start.getTime() })}>
        {ctx.read.state === "failed" ? null : <Box css={styles.markStrip} data-roster-mark-strip="">
            {SEVEN_DAYS.map(day => unread ? (revealed ? <Box key={day} as="span" css={styles.mark} data-roster-mark={day} data-pending="" /> : null)
                : <Mark key={day} ctx={ctx} held={held.held} day={day} duties={days[day] ?? NO_DUTIES} preview={previewDays?.[day]} letters={letters} />)}
        </Box>}
    </chakra.button>;
});
/** A person's row in the month: the name cell — the name and the badge alone (P16) — then a cell a week. */
const MonthRow = memo(function MonthRow({ ctx, row, index, rows, weeks, indexes, letters, measure }: {
    ctx: ViewContext; row: PersonRowValue; index: number; rows: readonly PeopleRow[]; weeks: readonly WeekState[]; indexes: readonly PeopleIndex[]; letters: boolean;
    measure: (el: HTMLElement | null) => void;
}) {
    const { styles, value } = ctx;
    const person = row.person, key = person?.key ?? row.key;
    peopleDrawProbe?.("row", key);
    const focus = useContext(PeopleFocusContext);
    const name = useRef<HTMLButtonElement>(null);
    const stepped = person !== undefined && focus.key === person.key;
    useLayoutEffect(() => { if (stepped && name.current !== null) { name.current.focus({ preventScroll: true }); focus.done(); } }, [stepped, focus]);
    const picked = useContext(PersonWeekContext);
    const style = { "--roster-weeks": weeks.length } as CSSProperties;
    const nameSelected = person !== undefined && picked !== undefined && picked.key === person.key && weeks.some(held => held.start.getTime() === picked.start);
    // The failure said once, across the first person's cells in view (CL11).
    const says = useRowsTop(top => ctx.read.state === "failed" && firstPersonInView(rows, top) === index);
    return <Box ref={measure} css={styles.monthRow} style={style} data-roster-person-row={key} data-density={value.settings.density.type} data-roster-unread={ctx.read.state !== "held" ? "" : undefined}>
        <NameCell ctx={ctx} person={person} rowKey={key} weekSelected={nameSelected} nameRef={name} hours={null} />
        {says && ctx.read.state === "failed" ? <Box css={styles.readLine} data-roster-read-line=""><ReadFailure read={ctx.read} /></Box>
            : weeks.map((held, i) => <MonthCell key={held.start.getTime()} ctx={ctx} person={person} group={row.group.key} held={held} letters={letters}
                days={(person === undefined ? indexes[i]!.requests.get(row.group.key) : indexes[i]!.person.get(person.key)) ?? NO_DAYS}
                selected={person !== undefined && picked !== undefined && picked.key === person.key && picked.start === held.start.getTime()} />)}
    </Box>;
});
/** An element's width, measured as it mounts and as it resizes: what the month's 13px letter rule reads (P13). */
function useWidth(): [RefObject<HTMLDivElement | null>, number] {
    const ref = useRef<HTMLDivElement>(null);
    const [width, setWidth] = useState(0);
    useLayoutEffect(() => {
        const el = ref.current;
        if (el === null) return;
        const measure = () => setWidth(el.getBoundingClientRect().width);
        measure();
        if (typeof ResizeObserver === "undefined") return;
        const observer = new ResizeObserver(measure);
        observer.observe(el);
        return () => observer.disconnect();
    }, []);
    return [ref, width];
}
/** The People grid by month (#1406, §8): a column a week touching the month, a row a person, a cell seven marks. */
function MonthGrid({ props, ctx }: { props: RosterViewsProps; ctx: ViewContext }) {
    const { collapsed, toggle } = useGroupCollapse(props.drag.surface);
    const rows = usePeopleRows(props.value, collapsed);
    const weeks = props.weeks;
    const indexes = useMemo(() => weeks.map(held => peopleIndex(held.week, held.held)), [weeks]);
    const { floors, measured, measure } = useRowFloors(PEOPLE_FLOORS);
    const getItemKey = useCallback((i: number) => rows[i]!.key, [rows, floors]); // eslint-disable-line react-hooks/exhaustive-deps -- the floors re-key the places
    const estimateSize = useCallback((i: number) => { const row = rows[i]!; return row.kind === "group" ? floors.group : row.person === undefined ? floors.requests : floors.person; }, [rows, floors]);
    // The letters show where a day is 13px or wider (P13): the grid's width less the name column, over the weeks, over seven days.
    const [root, width] = useWidth();
    const dayWidth = width === 0 ? Infinity : ((width - 168) / Math.max(weeks.length, 1) - 4) / 7 - 2;
    const letters = ctx.letters && dayWidth >= 13;
    const renderRow = useCallback((i: number) => {
        const row = rows[i]!;
        if (row.kind === "group") return <GroupHeading scope="roster" group={row.group} styles={ctx.styles} collapsed={collapsed.includes(row.group.key)} toggle={toggle} measure={measure("group")} />;
        return <MonthRow ctx={ctx} row={row} index={i} rows={rows} weeks={weeks} indexes={indexes} letters={letters} measure={measure(row.person === undefined ? "requests" : "person")} />;
    }, [rows, ctx, collapsed, toggle, weeks, indexes, letters, measure]);
    const style = { "--roster-weeks": weeks.length } as CSSProperties;
    // The selected person-week's column is marked (D11); none without a selection.
    const picked = props.selection?.type === "personWeek" ? props.selection.start : undefined;
    const header = <Box css={props.styles.monthRow} style={style} data-roster-month-head="" data-density={props.value.settings.density.type}>
        <Box css={props.styles.monthGutter}>People · Month</Box>
        {weeks.map(held => <WeekColumnHead key={held.start.getTime()} ctx={ctx} week={held.start} current={held.start.getTime() === picked} />)}
    </Box>;
    const { onAnchor } = props;
    const save = useCallback((at: RowAnchor) => onAnchor?.({ people: at }), [onAnchor]);
    const { restore, onAnchorChange } = useRowAnchor(rows, props.anchor?.people, save, measured);
    const { focus, onKeyDown } = usePeopleArrows(rows, props.select, props.start, props.picked);
    return <Box ref={root} css={props.styles.main} data-roster-grid="people-month" style={style} onKeyDown={onKeyDown}>
        <PeopleFocusContext.Provider value={focus}>
            <VirtualRows fillParent height={undefined} maxHeight={undefined} minWidth="var(--roster-people-width)" rootCss={props.styles.scroll}
                header={header} count={rows.length} getItemKey={getItemKey} estimateSize={estimateSize} anchorable={ANCHOR_EVERY_ROW}
                scrollToIndex={selectedPeopleRow(props, rows)} scrollAlign="auto" renderRow={renderRow}
                onAnchorChange={onAnchorChange} restoreAnchor={restore} />
        </PeopleFocusContext.Provider>
    </Box>;
}
/** A duty's card on a phone: its name, its times and activity, its issues and its actions. */
function AssignmentCard({ ctx, id, assignment, removed }: { ctx: ViewContext; id: string; assignment: Assignment; removed: boolean }) {
    const selection = useContext(SelectionContext);
    const baseline = ctx.held.assignments.get(id);
    const drafted = removed || baseline === undefined || !ctx.domain.sameAssignment(baseline, assignment);
    // What a run of the optimiser did to the duty (#1409, R27): its mark on the card, and its provenance on hover.
    const mark = dutyMark(ctx, id, removed, drafted);
    return <Box css={ctx.styles.card} data-roster-card={id} data-selected={selection?.type === "assignment" && selection.key === id ? "" : undefined} data-drafted={drafted ? "" : undefined}
        data-op={mark?.op} data-fill={mark === undefined ? undefined : "own"} title={mark?.provenance}>
        <chakra.button type="button" css={ctx.styles.cardHead} onClick={() => ctx.select({ type: "assignment", key: id })}><Box css={ctx.styles.cardTitle}>{assignmentName(ctx.value, assignment)}{removed && " · removed"}</Box></chakra.button>
        <Box css={ctx.styles.detail}>{`${ctx.format.time(assignment.start)}–${ctx.format.time(assignment.end)}`}{assignment.activity.type === "some" && ` · ${activityOf(ctx.value, assignment.activity.value)?.label ?? assignment.activity.value}`}</Box>
        {dutyIssues(ctx.issues, id).map((issue, i) => <Box key={i} css={ctx.styles.flag} data-tone={issue.tone.type}>{issue.title}</Box>)}
        <AssignmentActions id={id} assignment={assignment} removed={removed} value={ctx.value} start={ctx.start} commands={ctx.commands} styles={ctx.styles} />
    </Box>;
}
/** The phone's People cards' estimate of each kind before one has mounted: a person's card is its seven days, each a place action. */
const AGENDA_FLOORS: Readonly<Record<RowKind, number>> = { group: 38, person: 360, requests: 60 };
/** A person's card on a phone, or a group's requests': drawn again only as what it shows changes (#1398, CL9). */
const PersonCard = memo(function PersonCard({ ctx, row, index, rows, days, requests, measure }: {
    ctx: ViewContext; row: PersonRowValue; index: number; rows: readonly PeopleRow[]; days: WeekDays;
    /** A group's requests, in the week's order: what its card lists. */
    requests: readonly DayDuty[];
    measure: (el: HTMLElement | null) => void;
}) {
    const { styles, format, start, value, commands } = ctx;
    const person = row.person;
    // The name a pick in Search Records gave the keyboard to takes the focus as its card is drawn, as a row's name does (#1398).
    const focus = useContext(PeopleFocusContext);
    const head = useRef<HTMLButtonElement>(null);
    const given = person !== undefined && focus.key === person.key && ctx.read.state === "held";
    useLayoutEffect(() => { if (given && head.current !== null) { head.current.focus({ preventScroll: true }); focus.done(); } }, [given, focus]);
    // A week not read, or whose read failed (#1398): each person's card, their name and contract known without it, a
    // placeholder where each day's duties go, never "Off · assign"; the failure said once, in the first card in view.
    if (ctx.read.state === "failed") return <FailedPersonCard ctx={ctx} read={ctx.read} row={row} index={index} rows={rows} measure={measure} />;
    if (ctx.read.state !== "held") return <Box ref={measure} css={styles.card} data-roster-person-card={person?.key ?? row.key} data-roster-unread="">
        <UnreadCardHead ctx={ctx} person={person} index={index} />
        {person === undefined ? <Unread read={ctx.read} kind="chip" index={index} />
            : SEVEN_DAYS.map(day => <Box key={day} css={styles.agendaGroup}>
                <Box css={styles.detail}>{format.weekday(new Date(start.getTime() + day * DAY))}</Box>
                <Unread read={ctx.read} kind="chip" index={index + day} /></Box>)}
    </Box>;
    return <Box ref={measure} css={styles.card} data-roster-person-card={person?.key ?? row.key}>
        {person === undefined ? <><Box css={styles.cardHead}><Box css={styles.cardTitle}>Agency requests</Box></Box>{requests.map(({ id, a, removed }) => <AssignmentCard key={id} ctx={ctx} id={id} assignment={a} removed={removed} />)}</> : <>
            <chakra.button ref={head} type="button" css={styles.cardHead} data-roster-person-head={person.key} onClick={() => ctx.select({ type: "personWeek", key: person.key, start: start.getTime() })}>
                <Box css={styles.cardTitle} data-roster-card-hours="" data-opn={ctx.lit && ctx.optimised?.people.has(person.key) === true ? "" : undefined}>{person.name} · {format.number(ctx.hours.get(person.key) ?? 0)} / {format.number(person.contract)} h</Box></chakra.button>
            {/* A phone's `Apply pattern…` (#1406, P22): the Chooser over the patterns, its choice applied as a drop is. */}
            {value.patterns.length > 0 && <Box css={styles.actions}><ApplyPatternAction person={person} start={start} value={value} commands={commands} onError={ctx.onError} /></Box>}
            {SEVEN_DAYS.map(day => {
                const duties = days[day] ?? NO_DUTIES;
                return <Box key={day} css={styles.agendaGroup}><Box css={styles.detail}>{format.weekday(new Date(start.getTime() + day * DAY))}</Box>
                    {duties.map(({ id, a, removed }) => <AssignmentCard key={id} ctx={ctx} id={id} assignment={a} removed={removed} />)}
                    {!duties.some(duty => !duty.removed) && (commands.available || commands.locked !== undefined ? <PlaceAction label="Off · assign" source={{ type: "person", key: person.key }} slot={{ day: BigInt(day), group: row.group.key, shift: person.usual.type === "some" ? person.usual.value : value.shifts[0]!.key }} value={value} start={start} commands={commands} styles={styles} /> : <Box css={styles.detail}>Off</Box>)}
                </Box>;
            })}
        </>}
    </Box>;
});
/** A card's head while the week is not read: the person's name, and a placeholder for their hours beside their contract. */
function UnreadCardHead({ ctx, person, index }: { ctx: ViewContext; person: Person | undefined; index: number }) {
    return <Box css={ctx.styles.cardHead}><Box css={ctx.styles.cardTitle}>{person?.name ?? "Agency requests"}</Box>
        {person !== undefined && <Box css={ctx.styles.unreadValue}><Unread read={ctx.read} kind="number" index={index} />{`/ ${ctx.format.number(person.contract)} h`}</Box>}</Box>;
}
/** A person's card of a week whose read failed (#1398, CL11): the failure said in the first card in view, which it reads itself. */
function FailedPersonCard({ ctx, read, row, index, rows, measure }: {
    ctx: ViewContext; read: Extract<PeriodRead, { state: "failed" }>; row: PersonRowValue; index: number; rows: readonly PeopleRow[];
    measure: (el: HTMLElement | null) => void;
}) {
    const says = useRowsTop(top => firstPersonInView(rows, top) === index);
    return <Box ref={measure} css={ctx.styles.card} data-roster-person-card={row.person?.key ?? row.key} data-roster-unread="">
        <UnreadCardHead ctx={ctx} person={row.person} index={index} />
        {says && <ReadFailure read={read} />}
    </Box>;
}
function PeopleAgenda({ props, ctx }: { props: RosterViewsProps; ctx: ViewContext }) {
    const { collapsed, toggle } = useGroupCollapse(props.drag.surface);
    const rows = usePeopleRows(props.value, collapsed);
    const index = useMemo(() => peopleIndex(props.week, props.held), [props.week, props.held]);
    const { floors, measured, measure } = useRowFloors(AGENDA_FLOORS);
    const getItemKey = useCallback((i: number) => rows[i]!.key, [rows, floors]); // eslint-disable-line react-hooks/exhaustive-deps -- the floors re-key the places
    const estimateSize = useCallback((i: number) => { const row = rows[i]!; return row.kind === "group" ? floors.group : row.person === undefined ? floors.requests : floors.person; }, [rows, floors]);
    // A card drawn again only as what it shows changes: the same function while the rows, the week and the views hold (CL9).
    const renderRow = useCallback((i: number) => {
        const row = rows[i]!;
        if (row.kind === "group") return <GroupHeading scope="roster" group={row.group} styles={ctx.styles} collapsed={collapsed.includes(row.group.key)} toggle={toggle} measure={measure("group")} />;
        const days = row.person === undefined ? index.requests.get(row.group.key) : index.person.get(row.person.key);
        return <PersonCard ctx={ctx} row={row} index={i} rows={rows} days={days ?? NO_DAYS} requests={row.person === undefined ? index.requestList.get(row.group.key) ?? NO_DUTIES : NO_DUTIES}
            measure={measure(row.person === undefined ? "requests" : "person")} />;
    }, [rows, ctx, collapsed, toggle, index, measure]);
    // Where the cards' view rests, by its top card's key (#1398): saved as a scroll settles, brought back as they mount.
    const { onAnchor } = props;
    const save = useCallback((at: RowAnchor) => onAnchor?.({ cards: at }), [onAnchor]);
    const { restore, onAnchorChange } = useRowAnchor(rows, props.anchor?.cards, save, measured);
    // A pick in Search Records gives its person's card's name the keyboard (#1398).
    const { focus } = usePeopleFocus(rows, props.picked);
    return <Box css={props.styles.main} data-roster-agenda="people">
        <PeopleFocusContext.Provider value={focus}>
            <VirtualRows fillParent height={undefined} maxHeight={undefined} rootCss={props.styles.agenda} count={rows.length}
                getItemKey={getItemKey} estimateSize={estimateSize} anchorable={ANCHOR_EVERY_ROW} overscan={1}
                scrollToIndex={selectedPeopleRow(props, rows)} scrollAlign="auto" renderRow={renderRow}
                onAnchorChange={onAnchorChange} restoreAnchor={restore} />
        </PeopleFocusContext.Provider>
    </Box>;
}
/** Narrow cards retain explicit operations even with both BuilderFrame panes collapsed. */
function Agenda({ props, ctx }: { props: RosterViewsProps; ctx: ViewContext }) {
    const days = props.view.layout === "people" || props.view.period === "week" ? Array.from({ length: 7 }, (_, d) => d) : [props.day];
    return <Box css={props.styles.scroll} data-roster-agenda=""><Box css={props.styles.agenda}>
        {props.view.period === "day" && props.view.layout === "shifts" && <Seg fullWidth label="Day of week" scope="roster" name="agenda-days" active={String(props.day)} items={Array.from({ length: 7 }, (_, day) => ({ key: String(day), label: props.format.weekday(new Date(props.start.getTime() + day * DAY)) }))} onPick={day => props.setView({ ...props.view, date: props.start.getTime() + Number(day) * DAY })} />}
        {days.map(day => <Box key={day} css={props.styles.agendaGroup}><Box css={props.styles.groupLabel}>{props.format.weekdayDate(new Date(props.start.getTime() + day * DAY))}</Box>
            {props.value.groups.flatMap(group => props.value.shifts.map(shift => { const slot = { day: BigInt(day), group: group.key, shift: shift.key }; if (props.read.state !== "held") {
                // A week not read, or whose read failed (#1398): each slot's card and title at once, a placeholder where its
                // figures and duties go; the failure said once, in the first card.
                const first = day === days[0] && group.key === props.value.groups[0]?.key && shift.key === props.value.shifts[0]?.key;
                return <Box key={slotKey(slot)} css={props.styles.card} data-roster-agenda-slot={slotKey(slot)} data-roster-unread="">
                    <Box css={props.styles.cardHead}><Box css={props.styles.cardTitle}>{group.label} · {shift.label}</Box></Box>
                    {props.read.state === "failed" ? first && <ReadFailure read={props.read} />
                        : <><Box css={props.styles.detail}><Unread read={props.read} kind="aggregate" index={day} /></Box><Unread read={props.read} kind="chip" index={day + 1} /></>}
                </Box>;
            } const c = props.coverage.get(slot)!; return <Box key={slotKey(slot)} css={props.styles.card} data-roster-agenda-slot={slotKey(slot)}>
                <chakra.button type="button" css={props.styles.cardHead} onClick={() => props.select({ type: "slot", slot })}><Box css={props.styles.cardTitle}>{group.label} · {shift.label}</Box></chakra.button>
                <Box css={props.styles.detail}>{String(c.filled)} / {String(c.positions)} positions · {String(c.open)} open</Box>
                {props.value.settings.requirements && <CoverageView coverage={c} value={props.value} styles={props.styles} format={props.format} compact />}
                {assignments(props, slot).map(({ id, a, removed }) => <AssignmentCard key={id} ctx={ctx} id={id} assignment={a} removed={removed} />)}
                {props.proposals.filter(p => sameSlot(p.slot, slot) && (props.value.visiblePeople.type === "none" || props.value.visiblePeople.value.has(p.person))).map(p => <ProposalCard key={p.key} props={props} proposal={p} />)}
                <SlotActions props={props} slot={slot} /><RequirementAction slot={slot} week={props.week} held={props.held} value={props.value} commands={props.commands} styles={props.styles} />
            </Box>; }))}
        </Box>)}
    </Box></Box>;
}
export function RosterViews(props: RosterViewsProps) {
    const ctx = useViewContext(props);
    // A phone keeps People to the week (#1406, P31): a persisted month shows its first week, as the frame hands it.
    const view = props.narrow ? props.view.layout === "people" ? <PeopleAgenda props={props} ctx={ctx} /> : <Agenda props={props} ctx={ctx} />
        : props.view.layout === "people" ? props.view.period === "month" ? <MonthGrid props={props} ctx={ctx} /> : <People props={props} ctx={ctx} /> : <Shifts props={props} ctx={ctx} />;
    const picked = props.selection?.type === "personWeek" ? props.selection : undefined;
    const personWeek = useMemo(() => picked === undefined ? undefined : { key: picked.key, start: picked.start }, [picked]);
    return <SelectionContext.Provider value={props.selection}><PersonWeekContext.Provider value={personWeek}>{view}</PersonWeekContext.Provider></SelectionContext.Provider>;
}
