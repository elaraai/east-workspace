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
 * The People grids draw the work requirement over the people (#1568): under
 * each band — or once, at the list's head, where they draw no bands — an
 * eyebrow of each day's hours, by month each week's, a lane a shift with a
 * target, each day's hours rostered against needed — by month a mark a day,
 * on the person marks' columns — opening to its skill rows, and an eyebrow
 * before the people; its figures are the Shifts layout's coverage summed over
 * the span in view ({@link demandOf}).
 *
 * @packageDocumentation
 */
import { Fragment, createContext, memo, useCallback, useContext, useEffect, useLayoutEffect, useMemo, useRef, useState, type CSSProperties, type KeyboardEvent, type ReactNode, type RefObject } from "react";
import { Box, Button, Menu as ChakraMenu, chakra } from "@chakra-ui/react";
import { FontAwesomeIcon } from "@fortawesome/react-fontawesome";
import { faAngleRight, faCheck, faGripVertical, faRotateLeft, faTriangleExclamation, faXmark } from "@fortawesome/free-solid-svg-icons";
import { ArrayType, SortedMap, StringType, none, printFor, some, variant } from "@elaraai/east";
import { FrameMenuLayer, LoadingFailedLine, PlaceholderShape, VirtualRows, devicePixels, useRevealed, useRowsTop, keptRead, type StickySection } from "@elaraai/east-ui-components/internal";
import { takeKey, tickFormatOf, useDragEventChip, useDropCell, usePersistedState, type CellCoord, type DragEventValue, type DragPayload, type Formatters } from "@elaraai/east-ui-components";
import type { PeriodRead } from "../shared/loading.js";
import { MoveGhost } from "../shared/schedule/move-ghost.js";
import { GroupHeading, useGroupCollapse } from "../shared/schedule/group-heading.js";
import { readRowAnchor, useRowAnchor, type RowAnchor } from "../shared/schedule/row-anchor.js";
import { Seg } from "../shared/schedule/segments.js";
import { ApplyPatternAction, AssignmentActions, PlaceAction, PlacePopover, RequirementAction } from "./controls.js";
import { readRosterSource } from "./identity.js";
import { isPatternCard, rosterCoord, rosterPersonWeekCoord, type RosterDrag } from "./drag.js";
import type { PatternDay, RosterCommands } from "./actions.js";
import type { RosterDutyOp, RosterOptimised } from "./optimise.js";
import { barOf, demandOf, difference, differenceSaid, laneCup, laneMark, looseOf, signed, skillCup, skillMark, skillMet, stated, toneOf, type Demand, type DemandCup, type DemandFigures, type DemandLane, type DemandMark, type DemandSkill, type DemandWeek, type SkillFigures } from "./demand.js";
import {
    DAY, NO_GROUP, activityOf, compareSlot, costsOf, groupName, groupOf, groupSkills, hourText, ownTimes, placeKey, placeOf, samePlace, sameSlot, shiftColor, shiftHoursText,
    shiftLetter, shiftOf, slotKey, slotOfPlace, weekKey, weekNumber,
    type Assignment, type Coverage, type Issue, type Pay, type Person, type Place, type PlacedProposal, type RosterDomain, type RosterSpan, type RosterStyles,
    type RosterValue, type RosterView, type Selection, type Shift, type Slot, type Week, type WeekState,
} from "./model.js";

export interface RosterViewsProps {
    value: RosterValue; week: Week; held: Week; start: Date; day: number; view: RosterView; setView: (view: RosterView) => void;
    /** Whether a duty holds a conflict not yet chosen: its chip, tile and card wear the warn ring. None by default. */
    conflicted?: ((id: string) => boolean) | undefined;
    /** Whether a duty's row holds a number its field's bounds don't (#1585): its chip, tile and card wear the warn ring. None by default. */
    bounded?: ((id: string) => boolean) | undefined;
    /** The span in view (#1406, D2), and each of its weeks drafts in place: what the month draws, and what a pattern dropped on one applies to. */
    span: RosterSpan; weeks: readonly WeekState[];
    /** Opens a week in the Week period (P12, P24). */
    openWeek: (week: Date) => void;
    /** Whether the layout in view offers Day, and Week (`viewPeriods`): without it, a heading that would open it is a heading alone. */
    opensDay: boolean; opensWeek: boolean;
    styles: RosterStyles; format: Formatters; narrow: boolean; coverage: ReadonlyMap<Slot, Coverage>; hours: ReadonlyMap<string, number>;
    /**
     * Each week of the span's coverage, as `weeks` lists them (#1568): what the People layout's work requirement sums —
     * a week's `coverage`, or each of a month's weeks', its hours alone; none in a month drawing no work requirement.
     */
    spanCoverage: readonly ReadonlyMap<Slot, Coverage>[];
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

/** Where the People views rest, as storage keeps it. */
export const readRosterAnchor = keptRead.record<RosterAnchor>({ people: keptRead.optional(readRowAnchor), cards: keptRead.optional(readRowAnchor) });

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
    readonly weeks: readonly WeekState[]; readonly openWeek: (week: Date) => void; readonly opensWeek: boolean;
    /** The People layout's display settings (D7): whether a tile shows the shift's hours always, and whether a month's marks carry letters. */
    readonly tileTimes: "always" | "different"; readonly letters: boolean;
    /** Whether a duty holds a conflict not yet chosen. */
    readonly conflicted: (id: string) => boolean;
    /** Whether a duty's row holds a number its field's bounds don't. */
    readonly bounded: (id: string) => boolean;
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

/** No duty holds a conflict. */
const NO_CONFLICT = (): boolean => false;
/** No duty's row breaks its field's bounds. */
const NO_BREACH = (): boolean => false;

/** The views' props a chip and a People row read, the same object while each of them holds. */
function useViewContext(props: RosterViewsProps): ViewContext {
    const { value, week, held, start, day, styles, format, hours, pay, domain, issues, commands, drag, select, onError, read, weeks, openWeek, opensWeek, optimised } = props;
    const tileTimes = value.settings.tileTimes.type, letters = value.settings.letters, lit = props.lit === true;
    const conflicted = props.conflicted ?? NO_CONFLICT, bounded = props.bounded ?? NO_BREACH;
    return useMemo(() => ({ value, week, held, start, day, styles, format, hours, pay, domain, issues, commands, drag, select, onError, read, weeks, openWeek, opensWeek, tileTimes, letters, optimised, lit, conflicted, bounded }),
        [value, week, held, start, day, styles, format, hours, pay, domain, issues, commands, drag, select, onError, read, weeks, openWeek, opensWeek, tileTimes, letters, optimised, lit, conflicted, bounded]);
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
/** The duties standing in a place — a group's slot, or a shift's day in no group (#1548) — leads first, requests last. */
function assignments(props: RosterViewsProps, place: Place) {
    const rows = matchingAssignments(props, a => samePlace(a.place, place) && visible(props.value, a));
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
    /** Each group's agency requests' week, by the group's key — those in no group yet under {@link NO_GROUP} (#1548). */
    readonly requests: ReadonlyMap<string, WeekDays>;
    /** Each group's agency requests in the week's order, then those the draft removed: what a phone's requests card lists. */
    readonly requestList: ReadonlyMap<string, readonly DayDuty[]>;
    /** Every group's agency requests' week: the one row of them where the layout draws no bands (#1567). */
    readonly allRequests: WeekDays;
    /** Every group's agency requests in the week's order, then those the draft removed: that row's phone card's. */
    readonly allRequestList: readonly DayDuty[];
    /** Each person's duties in the week as drafted, by their key: what their week's cost totals. */
    readonly duties: ReadonlyMap<string, readonly string[]>;
}
/**
 * The week's duties indexed once, by person and by day — each group's requests by day, and every group's together —
 * never scanned a row at a time (#1398, CL9).
 *
 * @param week - The week as drafted
 * @param held - The week as the records hold it: what a draft removed shows from
 * @returns The index
 */
function peopleIndex(week: Week, held: Week): PeopleIndex {
    const person = new Map<string, DayDuty[][]>();
    const requests = new Map<string, DayDuty[][]>();
    const requestList = new Map<string, DayDuty[]>();
    const allRequests: DayDuty[][] = Array.from({ length: 7 }, () => []);
    const allRequestList: DayDuty[] = [];
    const duties = new Map<string, string[]>();
    const add = (id: string, a: Assignment, removed: boolean) => {
        const day = Number(a.place.day);
        if (day < 0 || day > 6) return;
        const into = a.who.type === "person" ? person : requests;
        const key = a.who.type === "person" ? a.who.value : groupOf(a) ?? NO_GROUP;
        let days = into.get(key);
        if (days === undefined) {
            days = Array.from({ length: 7 }, () => []);
            into.set(key, days);
        }
        const duty = { id, a, removed };
        days[day]!.push(duty);
        if (a.who.type === "person") return;
        allRequests[day]!.push(duty);
        allRequestList.push(duty);
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
    return { person, requests, requestList, allRequests, allRequestList, duties };
}
/** A row of agency requests' week: its group's, or every group's where the row stands for them all (#1567). */
function requestDays(index: PeopleIndex, group: Group | undefined): WeekDays | undefined {
    return group === undefined ? index.allRequests : index.requests.get(group.key);
}

/**
 * The same coverage bar and skill lines appear in a day cell and the inspector. A sum of several slots' coverage — a
 * shift's day across the groups — is given what its slots are short, each slot's own (K4): its difference and its bar's
 * open part say that, never their net; a slot's own is what it is short.
 */
export function CoverageView({ coverage: c, value, styles, format, compact = false, short: given }: {
    coverage: Coverage; value: RosterValue; styles: RosterStyles; format: Formatters; compact?: boolean;
    /** What the slots summed are short, each slot's own; by default, what the one slot is short. */
    short?: number;
}) {
    const short = given ?? Math.max(0, -difference(c.hours.rostered, c.hours.needed));
    const bar = barOf(c.hours, short), d = stated(c.hours.rostered, c.hours.needed, short);
    if (c.hours.needed === 0 && c.hours.rostered === 0) return <Box css={styles.empty}>No work · no hours targeted</Box>;
    return <>
        <Box css={styles.coverageHead}><Box as="span" css={styles.metric}>{format.number(c.hours.needed)} h</Box><Box as="span" css={styles.detail}>needed</Box>
            <Box as="span" css={styles.metric}>{format.number(c.hours.rostered)} h</Box><Box as="span" css={styles.detail}>rostered</Box>
            <Box as="span" css={styles.delta} data-roster-coverage-delta="" data-tone={d < 0 ? "warning" : undefined}>{signed(format.number, d, "+0")} h</Box></Box>
        <Box css={styles.coverageBar} role="img" aria-label={`${format.number(c.hours.rostered)} hours rostered of ${format.number(c.hours.needed)} needed`}>
            {bar.parts.map(part => <Box key={part.kind} css={styles.coverageSegment} data-kind={part.kind} style={{ left: `${part.left / bar.scale * 100}%`, width: `${part.width / bar.scale * 100}%` }} />)}
            <Box css={styles.coverageTick} style={{ left: `${c.hours.needed / bar.scale * 100}%` }} />
        </Box>
        <Box css={styles.detail}>{bar.parts.filter(p => p.kind !== "open").map(p => `${format.number(p.width)} ${p.kind === "permanent" ? value.vocabulary.permanentShort : p.kind === "agency" ? value.vocabulary.agencyShort : p.kind}`).join(" · ") || "Nothing rostered"} h{costed(value) && ` · ${money(format, value, c.cost)}`}</Box>
        {!compact && c.lines.map(line => { const activity = activityOf(value, line.skill); return <Box key={line.skill} css={styles.coverageLine} data-roster-coverage-line="" data-tone={line.gap > 0 ? "warning" : line.assigned >= line.needed ? "success" : undefined}
            title={`${activity?.label ?? line.skill} · ${format.number(line.assigned)} h assigned of ${format.number(line.needed)} h needed${line.capacity.type === "some" ? ` · ${format.number(line.capacity.value)} h capacity` : ""}`}>
            <Box as="span" css={styles.coverageName} data-roster-coverage-name="">{activity?.code && <Box as="span" css={styles.skillCode}>{activity.code}</Box>}{activity?.label ?? line.skill}</Box>
            <Box as="span" css={styles.coverageFigures} data-roster-coverage-figures=""><Box as="span" css={styles.skillCode}>{line.holders.type === "some" ? `${line.holders.value}/${c.people}` : "—"}</Box><span>{format.number(line.assigned)} / {format.number(line.needed)}</span></Box>
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
    const coord = useMemo(() => ({ ...rosterCoord(drag.surface, a.place, id), event: id }), [drag.surface, a.place, id]);
    const ghost = useMemo(() => <MoveGhost styles={styles} label={name} />, [styles, name]);
    const enabled = drag.enabled && !removed && ctx.commands.availableOn(a.place.day);
    const handle = useDragEventChip(enabled ? coord : null, ghost, !enabled, name);
    const canDrop = useCallback((event: DragEventValue) => drag.run(event, true) === undefined, [drag]);
    const drop = useDropCell(enabled ? coord : null, !enabled, canDrop, undefined, { caption: drag.caption, name: drag.name });
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
    const enabled = drag.enabled && !removed && ctx.commands.availableOn(a.place.day);
    const person = a.who.type === "person" ? personOf(value, a.who.value) : undefined;
    // An agency person's duty, or a request: its badge the app's short word for agency staff (#1566).
    const agency = a.who.type === "request" || person?.agency === true;
    const position = value.positions.find(p => p.key === a.position);
    const issues = removed ? NO_ISSUES : dutyIssues(ctx.issues, id);
    const activity = a.activity.type === "some" ? activityOf(value, a.activity.value) : undefined;
    const baseline = ctx.held.assignments.get(id);
    const drafted = removed || baseline === undefined || !ctx.domain.sameAssignment(baseline, a);
    const times = `${ctx.format.time(a.start)}–${ctx.format.time(a.end)}`;
    // A duty in no group yet is held to its person's home group's skills (#1548): where the shift's day takes them.
    const group = groupOf(a);
    const skills = groupSkills(value, group ?? person?.group ?? NO_GROUP);
    const label = `${name} · ${times}${removed ? " · removed" : ""}`;
    // What a run of the optimiser did to the duty (#1409): its mark, and its provenance on hover.
    const mark = dutyMark(ctx, id, removed, drafted);
    return <Box {...handle} ref={attach} css={styles.assignment} tabIndex={0} role="button" aria-label={label} title={mark === undefined ? label : `${mark.provenance} · ${label}`} aria-pressed={selected}
        data-roster-assignment={id} data-layout={short ? "people" : "shifts"} data-added={baseline === undefined ? "" : undefined} data-moved={baseline !== undefined && !samePlace(baseline.place, a.place) ? "" : undefined} data-density={value.settings.density.type} data-selected={selected ? "" : undefined}
        data-drafted={drafted ? "" : undefined} data-conflict={ctx.conflicted(id) ? "" : undefined} data-bounds={ctx.bounded(id) ? "" : undefined} data-removed={removed ? "" : undefined} data-request={a.who.type === "request" ? "" : undefined} data-agency={person?.agency ? "" : undefined}
        data-op={mark?.op} data-fill={mark === undefined ? undefined : "own"}
        data-tone={issues.some(i => i.tone.type === "danger") ? "danger" : issues.some(i => i.kind.type === "breach") ? "warning" : undefined} data-draggable={enabled ? "" : undefined}
        onClick={event => { event.stopPropagation(); ctx.select({ type: "assignment", key: id }); }} onKeyDown={event => { if (event.key === "Enter") { takeKey(event); ctx.select({ type: "assignment", key: id }); } else handle?.onKeyDown?.(event); }}>
        {enabled && <Box as="span" css={styles.grip} data-roster-grip=""><FontAwesomeIcon icon={faGripVertical} /></Box>}
        <Box as="span" css={styles.badge} data-lead={position?.lead ? "" : undefined} data-roster-agency-badge={agency ? "" : undefined}>{agency ? value.vocabulary.agencyShort : position?.code || (person?.trainer ? "T" : "")}</Box>
        <Box css={styles.assignmentName} data-roster-assignment-name="">{short ? `${value.shifts.find(s => s.key === a.place.shift)?.code ?? a.place.shift}${person?.group !== (group ?? NO_GROUP) ? ` · ${groupName(value, a.place.group)}` : ""}` : name}</Box>
        {issues.filter(i => i.flag.type === "some").map((i, n) => <Box as="span" key={n} css={styles.flag} data-tone={i.tone.type}>{i.flag.type === "some" && i.flag.value}</Box>)}
        {/* A duty's own times, where they differ from its shift's (§5.5, rule 2): just times, no name and no worth. */}
        {ownTimes(value, a, ctx.start) && <Box as="span" css={styles.flag} data-roster-times="">{times}</Box>}
        {person !== undefined && !short && <><Box as="span" css={styles.activity} data-empty={activity === undefined ? "" : undefined} title={activity?.label ?? "No activity"}>{activity?.code ?? "·"}</Box>{activity !== undefined && commands.availableOn(a.place.day) && !removed && <chakra.button type="button" css={styles.chipAction} data-roster-chip-action="" aria-label={`Clear activity for ${name}`} onPointerDown={e => e.stopPropagation()} onClick={e => { e.stopPropagation(); ctx.onError(commands.activity(id, none)); }}><FontAwesomeIcon icon={faXmark} /></chakra.button>}
            <Box as="span" css={styles.fit}>{value.settings.chipSkills ? `${skills.filter(s => person.skills.has(s.key)).length}/${skills.length}` : `${ctx.format.number(ctx.hours.get(person.key) ?? 0)}h`}</Box></>}
        {(commands.availableOn(a.place.day) || commands.locked !== undefined) && <chakra.button type="button" css={styles.chipAction} data-roster-chip-action="" aria-label={removed ? `Restore ${name}` : `Remove ${name}`}
            disabled={commands.locked !== undefined} title={commands.locked}
            onPointerDown={event => event.stopPropagation()} onClick={event => { event.stopPropagation(); if (removed) commands.restore(id); else commands.remove(id); }}><FontAwesomeIcon icon={removed ? faRotateLeft : faXmark} /></chakra.button>}
    </Box>;
});
/**
 * A cell's name for the place it stands for (#1548): a group's slot is its `data-roster-slot`, a shift's day in no group
 * its `data-roster-place` — each East's print of it.
 */
function placeData(place: Place): { "data-roster-slot"?: string; "data-roster-place"?: string } {
    const slot = slotOfPlace(place);
    return slot === undefined ? { "data-roster-place": placeKey(place) } : { "data-roster-slot": slotKey(slot) };
}
/**
 * A cell a drop lands in: a group's slot, or a shift's day in No group's band (#1548). No hook in the mobile branch
 * registers a drag source or target.
 */
function DropSlot({ props, place, children, compact = false }: { props: RosterViewsProps; place: Place; children: ReactNode; compact?: boolean }) {
    const ref = useRef<HTMLDivElement>(null);
    const [landing, setLanding] = useState<ReturnType<RosterDrag["preview"]>>();
    const drop = useDropCell(props.drag.enabled ? rosterCoord(props.drag.surface, place) : null, !props.drag.enabled,
        event => props.drag.run(event, true) === undefined, undefined, { caption: props.drag.caption, name: props.drag.name,
            onHover: (_x, _y, payload) => setLanding(props.drag.preview(rosterCoord(props.drag.surface, place), payload, true)) });
    const attach = useCallback((element: HTMLDivElement | null) => { ref.current = element; drop(element); }, [drop]);
    // A group's slot is selected as one; No group's cells select nothing.
    const slot = useMemo(() => slotOfPlace(place), [place]);
    // The shared target subscription can change on pointer motion; its body need not.
    return useMemo(() => <Box ref={attach} css={compact ? props.styles.weekCell : props.styles.cell} {...placeData(place)} data-selected={slot !== undefined && selectedSlot(props.selection, slot) ? "" : undefined} data-roster-landing-tone={landing?.tone} title={compact ? landing?.label : undefined}>
        {children}{!compact && landing !== undefined && <Box css={props.styles.landing} data-roster-landing="" data-tone={landing.tone}>{landing.label}</Box>}
    </Box>, [attach, compact, props, place, slot, landing, children]);
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
        {(props.commands.availableOn(proposal.slot.day) || locked) && <Box css={styles.actions}><Button size="xs" variant="outline" disabled={locked} title={props.commands.locked} onClick={accept}>Accept</Button>{dismissible(props.value) && <Button size="xs" variant="ghost" disabled={locked} title={props.commands.locked} onClick={reject}>Reject</Button>}</Box>}
    </Box>;
    const open = (props.coverage.get(proposal.slot)?.open ?? 0n) > 0n;
    const shift = props.value.shifts.find(s => s.key === proposal.slot.shift);
    return <Box css={[styles.assignment, styles.proposal]} data-roster-proposal={proposal.key} data-selected={selected ? "" : undefined} data-density={props.value.settings.density.type} title={`Model proposal · ${proposal.reason}`}>
        {mark}{title}<Box as="span" css={[styles.detail, styles.proposalReason]}>{open ? "fills open" : `+${props.format.number(shift?.hours ?? 0)} h`}</Box>
        {(props.commands.availableOn(proposal.slot.day) || locked) && <>
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
    if (!props.commands.availableOn(slot.day) && !locked) return null;
    const place = placeOf(slot);
    return <Box css={props.styles.actions}><PlaceAction label="Assign person" place={place} value={props.value} start={props.start} commands={props.commands} styles={props.styles} />
        {props.value.agencies.map(agency => <Button key={agency.key} size="xs" variant="outline" disabled={locked} title={props.commands.locked} onClick={() => props.onError(props.commands.place({ type: "agency", key: agency.key }, place))}>Request {agency.name}</Button>)}
    </Box>;
}
function DayAssignments({ props, ctx, slot }: { props: RosterViewsProps; ctx: ViewContext; slot: Slot }) {
    const c = props.coverage.get(slot)!;
    const issues = props.issues.filter(i => i.slot.type === "some" && sameSlot(i.slot.value, slot) && (i.kind.type === "gap" || i.kind.type === "breach"));
    const place = placeOf(slot);
    return <DropSlot props={props} place={place}>
        <chakra.button type="button" css={props.styles.cellHead} data-open={c.open > 0n ? "" : undefined} onClick={() => props.select({ type: "slot", slot })}>{String(c.filled)} / {String(c.positions)} positions{issues.length > 0 && ` · ${issues.length} issues`}</chakra.button>
        <Box css={props.styles.chips}>{assignments(props, place).map(({ id, a, removed }) => <AssignmentChip key={id} id={id} assignment={a} removed={removed} ctx={ctx} />)}</Box>
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
    props: RosterViewsProps; head: ReactNode; columns: readonly { day: number; shift: RosterValue["shifts"][number] }[];
    /** The row's group: a group's, or none for No group's band (#1548). */
    group: Place["group"];
    kind: "chip" | "number" | "aggregate"; failure: Extract<PeriodRead, { state: "failed" }> | undefined; cell: Record<string, unknown> | undefined;
}) {
    return <Box css={props.styles.row} data-roster-unread="">{head}
        {failure !== undefined ? <Box css={props.styles.readLine} data-roster-read-line=""><ReadFailure read={failure} /></Box>
            : columns.map(({ day, shift }, c) => {
                const place: Place = { day: BigInt(day), group, shift: shift.key };
                return <Box key={placeKey(place)} css={cell} {...placeData(place)}><Unread read={props.read} kind={kind} index={c} /></Box>;
            })}
    </Box>;
}
/** The columns of the Shifts layout: a shift a day in view. */
type ShiftColumns = readonly { day: number; shift: Shift }[];
/**
 * The Shifts layout's No group band (#1548): the duties of a kind that takes no group standing in none yet, a cell a
 * shift's day, after the groups — drawn whenever the kind takes no group, so a duty dragged out of its group has a place
 * to go. It holds no target and no positions: its band says the hours rostered there, and its cells have no head and no
 * actions — by day each holds its duties' chips, by week their count. A duty dropped in one stands in no group, and one
 * dragged from it into a group's slot stands in that group.
 */
function NoGroupBand({ props, ctx, days, columns, collapsed, toggle, failure }: {
    props: RosterViewsProps; ctx: ViewContext; days: readonly number[]; columns: ShiftColumns; collapsed: boolean; toggle: (group: string) => void;
    /** The failure, where the band's row is the one it is said in. */
    failure: Extract<PeriodRead, { state: "failed" }> | undefined;
}) {
    const { value, styles, format, read } = props;
    const band = useMemo(() => ({ key: NO_GROUP, label: value.vocabulary.noGroup }), [value.vocabulary.noGroup]);
    const unread = read.state !== "held";
    // The days in view's duties in no group, whoever the rail shows: what the band's hours and the week's counts count.
    const duties = [...props.week.assignments.values()].filter(a => a.place.group.type === "none" && days.includes(Number(a.place.day)));
    const rostered = duties.reduce((n, a) => n + a.hours, 0);
    const people = duties.filter(a => a.who.type === "person").length;
    const head = <Box css={[styles.gutter, styles.rowHead]} data-roster-no-group-head=""><Box css={styles.eyebrow}>Assignment</Box><Box css={styles.title}>Roster</Box>
        <Box css={styles.detail}>{unread ? <Unread read={read} kind="aggregate" index={1} /> : peopleSaid(format.number, people)}</Box><Box css={styles.detail}>{unread ? null : `${format.number(rostered)} h`}</Box></Box>;
    const week = days.length > 1;
    if (unread) return <>
        <GroupHeading scope="roster" group={band} styles={styles} collapsed={collapsed} toggle={toggle}><Box as="span" css={styles.groupMeta}><Unread read={read} kind="aggregate" index={2} /></Box></GroupHeading>
        {!collapsed && <UnreadSlots props={props} head={head} columns={columns} group={none} kind={week ? "number" : "chip"} failure={failure} cell={week ? styles.weekCell : styles.cell} />}
    </>;
    return <>
        <GroupHeading scope="roster" group={band} styles={styles} collapsed={collapsed} toggle={toggle}><Box as="span" css={styles.groupMeta}>{format.number(rostered)} h rostered</Box></GroupHeading>
        {!collapsed && <Box css={styles.row}>{head}
            {columns.map(({ day, shift }) => {
                const place: Place = { day: BigInt(day), group: none, shift: shift.key };
                if (!week) return <DropSlot key={placeKey(place)} props={props} place={place}>
                    <Box css={styles.chips}>{assignments(props, place).map(({ id, a, removed }) => <AssignmentChip key={id} id={id} assignment={a} removed={removed} ctx={ctx} />)}</Box>
                </DropSlot>;
                const count = duties.filter(a => Number(a.place.day) === day && a.place.shift === shift.key).length;
                const date = new Date(props.start.getTime() + day * DAY);
                const said = `${value.vocabulary.noGroup} ${format.weekday(date)} ${shift.label}, ${format.number(count)} ${count === 1 ? "duty" : "duties"}`;
                // A press opens the day; with Day not offered the count is a figure alone.
                return <DropSlot key={placeKey(place)} props={props} place={place} compact>{props.opensDay
                    ? <chakra.button type="button" css={styles.weekValue} aria-label={said} onClick={() => props.setView({ ...props.view, period: "day", date: date.getTime() })}>{format.number(count)}</chakra.button>
                    : <Box css={styles.weekValue}>{format.number(count)}</Box>}</DropSlot>;
            })}
        </Box>}
    </>;
}
function Shifts({ props, ctx }: { props: RosterViewsProps; ctx: ViewContext }) {
    const { collapsed, toggle } = useGroupCollapse(props.drag.surface);
    const days = props.view.period === "week" ? Array.from({ length: 7 }, (_, d) => d) : [props.day];
    const columns = days.flatMap(day => props.value.shifts.map(shift => ({ day, shift })));
    const style = { "--roster-columns": columns.length } as CSSProperties;
    // A week not read, or whose read failed (#1398): the days, shifts and groups, known without it, at once, and a
    // placeholder where each figure or duty goes; the failure said once, in the first open group's first row — No
    // group's band's, where every group is folded (#1548).
    const unread = props.read.state !== "held";
    const noGroup = props.value.duty.roles.noGroup;
    const failedIn = props.read.state === "failed" ? props.value.groups.find(group => !collapsed.includes(group.key))?.key
        ?? (noGroup && !collapsed.includes(NO_GROUP) ? NO_GROUP : undefined) : undefined;
    const failure = props.read.state === "failed" ? props.read : undefined;
    return <Box css={props.styles.scroll} data-roster-grid="shifts"><Box css={props.styles.grid} data-period={props.view.period} style={style}>
        <Box css={props.styles.head}>
            {props.view.period === "week" && <Box css={props.styles.row}><Box css={props.styles.gutter} />{days.map(day => {
                const heading = { css: props.styles.shiftHead, "data-roster-column-header": "", style: { gridColumn: `span ${props.value.shifts.length}` }, "data-week": "", "data-selected": props.day === day ? "" : undefined };
                const label = <Box css={props.styles.shiftLabel}>{props.format.weekday(new Date(props.start.getTime() + day * DAY))} {new Date(props.start.getTime() + day * DAY).getUTCDate()}</Box>;
                // A press opens the day; with Day not offered it is a heading alone.
                return props.opensDay ? <chakra.button type="button" key={day} {...heading} onClick={() => props.setView({ ...props.view, period: "day", date: props.start.getTime() + day * DAY })}>{label}</chakra.button> : <Box key={day} {...heading}>{label}</Box>;
            })}</Box>}
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
                        {props.value.settings.requirements && <UnreadSlots props={props} head={requirementHead} columns={columns} group={some(group.key)} kind={days.length > 1 ? "number" : "aggregate"} failure={failing}
                            cell={days.length > 1 ? props.styles.weekCell : props.styles.requirement} />}
                        <UnreadSlots props={props} head={assignmentHead} columns={columns} group={some(group.key)} kind={days.length > 1 ? "number" : "chip"}
                            failure={props.value.settings.requirements ? undefined : failing} cell={days.length > 1 ? props.styles.weekCell : props.styles.cell} />
                    </>}</Fragment>;
            }
            return <Fragment key={group.key}><GroupHeading scope="roster" group={group} styles={props.styles} collapsed={collapsed.includes(group.key)} toggle={toggle}><Box as="span" css={props.styles.groupMeta}>{props.format.number(needed)} h needed · {props.format.number(rostered)} h rostered · {signed(props.format.number, difference(rostered, needed), "+0")} h{costed(props.value) && ` · ${money(props.format, props.value, coverage.reduce((n, c) => n + c.cost, 0))}`}</Box>{issues.length > 0 && <Box as="span" css={props.styles.flag} data-tone={issues.some(i => i.tone.type === "danger") ? "danger" : "warning"}>{issues.length} issues</Box>}
            </GroupHeading>{!collapsed.includes(group.key) && <>
                {props.value.settings.requirements && <Box css={props.styles.row}>{requirementHead}
                    {columns.map(({ day, shift }) => { const slot = { day: BigInt(day), group: group.key, shift: shift.key }, c = props.coverage.get(slot)!; return <chakra.button type="button" key={slotKey(slot)} css={days.length > 1 ? props.styles.weekCell : props.styles.requirement} data-roster-requirement={slotKey(slot)} onClick={() => { props.select({ type: "requirement", slot }); if (days.length > 1) props.setView({ ...props.view, period: "day", date: props.start.getTime() + day * DAY }); }}>
                        {days.length > 1 ? <><Box css={props.styles.weekValue}>{props.format.number(c.hours.needed)}</Box><Box css={props.styles.weekFill}><Box css={props.styles.weekFillValue} style={{ width: `${Math.min(c.hours.rostered / Math.max(c.hours.needed, 1), 1) * 100}%` }} /></Box><Box css={props.styles.weekValue} data-tone={c.hours.rostered < c.hours.needed ? "warning" : undefined}>{props.format.number(c.hours.rostered - c.hours.needed)}</Box></> : <CoverageView coverage={c} value={props.value} styles={props.styles} format={props.format} compact={props.value.settings.density.type === "compact"} />}
                    </chakra.button>; })}</Box>}
                <Box css={props.styles.row}>{assignmentHead}
                    {columns.map(({ day, shift }) => { const slot = { day: BigInt(day), group: group.key, shift: shift.key }, c = props.coverage.get(slot)!; return days.length === 1 ? <DayAssignments key={slotKey(slot)} props={props} ctx={ctx} slot={slot} />
                        : <DropSlot key={slotKey(slot)} props={props} place={placeOf(slot)} compact><chakra.button type="button" css={props.styles.weekValue} data-tone={c.open > 0n ? "warning" : undefined} aria-label={`${group.label} ${props.format.weekday(new Date(props.start.getTime() + day * DAY))} ${shift.label}, ${c.filled} of ${c.positions} positions`} onClick={() => { props.select({ type: "slot", slot }); props.setView({ ...props.view, period: "day", date: props.start.getTime() + day * DAY }); }}>{String(c.filled)}/{String(c.positions)}</chakra.button><Box css={props.styles.weekFill}><Box css={props.styles.weekFillValue} style={{ width: `${Math.min(Number(c.filled) / Math.max(Number(c.positions), 1), 1) * 100}%` }} /></Box>{props.issues.some(i => i.slot.type === "some" && sameSlot(i.slot.value, slot)) && <Box css={props.styles.issueDot} aria-label="Shift has issues" />}</DropSlot>; })}
                </Box>
            </>}</Fragment>;
        })}
        {noGroup && <NoGroupBand props={props} ctx={ctx} days={days} columns={columns} collapsed={collapsed.includes(NO_GROUP)} toggle={toggle} failure={failedIn === NO_GROUP ? failure : undefined} />}
    </Box></Box>;
}
/** One of the Roster's groups. */
type Group = RosterValue["groups"][number];
/**
 * The bands the layouts draw a group's under: a band a group, then — where the duty kind takes no group (#1548) — No
 * group's, keyed {@link NO_GROUP} and named in the vocabulary's words.
 */
function bandsOf(groups: readonly Group[], noGroup: string | undefined): readonly Group[] {
    return noGroup === undefined ? groups : [...groups, { key: NO_GROUP, label: noGroup }];
}
/** No group's band's name, where the duty kind takes no group (#1548); `undefined` where every duty stands in one. */
function noGroupBand(value: RosterValue): string | undefined { return value.duty.roles.noGroup ? value.vocabulary.noGroup : undefined; }
/**
 * A row of the People list: a group's band; a person's row, `group` their home group — the band they are listed under,
 * where the layout draws bands; or a row of agency requests — a group's, or, where the layout draws no bands
 * (`peopleBands`, #1567), every group's in one row at the list's foot, its `group` `undefined`.
 */
type ListRow = { kind: "group"; key: string; group: Group }
    | { kind: "person"; key: string; group: Group; person: RosterValue["people"][number] }
    | { kind: "person"; key: string; group: Group | undefined; person: undefined };
/**
 * A row of the work requirement (#1568): its eyebrow under a band (`demand`, A2), a lane a shift (A3), a skill
 * row under an open lane (A4), and the eyebrow before the band's people (`assign`, A5) — a band's, its `group`, or the
 * one block over every group's at the list's head where the layout draws no bands, its `group` `undefined`.
 */
type DemandRow = { kind: "demand"; key: string; group: Group | undefined; demand: Demand }
    | { kind: "lane"; key: string; group: Group | undefined; lane: DemandLane; open: boolean }
    | { kind: "skill"; key: string; group: Group | undefined; lane: DemandLane; skill: DemandSkill }
    | { kind: "assign"; key: string; group: Group | undefined; people: number };
/** A People row: the list's, or the work requirement's. */
type PeopleRow = ListRow | DemandRow;
/**
 * A row of the work requirement on a phone (#1568): its eyebrow, which holds a card a day — the lanes have no row of
 * their own there — and the eyebrow before the people's cards.
 */
type AgendaDemandRow = Extract<DemandRow, { kind: "demand" | "assign" }>;
/** A row of a phone's People cards: the list's, or the work requirement's. */
type AgendaRow = ListRow | AgendaDemandRow;
/** A person's row, or a row of agency requests. */
type PersonRowValue = Extract<ListRow, { kind: "person" }>;
/**
 * Shared stable rows for desktop People and its explicit-action phone cards: a band a group, its people — its leads,
 * then the rest, then agency staff — and its agency requests, then No group's band holding the requests in no group
 * yet, where the duty kind takes none (#1548): it is nobody's home, so it lists no person, a person's duty in no group
 * drawn on their own row; or, without bands (#1567), every person the narrowing shows in one list ranked so, each
 * keeping their home group, then every agency request in one row.
 */
function usePeopleRows(value: RosterValue, collapsed: readonly string[]): ListRow[] {
    const noGroup = noGroupBand(value);
    return useMemo(() => {
        const people = value.people.filter(p => value.visiblePeople.type === "none" || value.visiblePeople.value.has(p.key));
        const rank = (p: typeof people[number]) => p.agency ? 2 : value.positions.find(pos => pos.key === p.position)?.lead ? 0 : 1;
        if (!value.settings.peopleBands) {
            // The people a band would list, in one list: each with a home group of the Roster's, which `+ Assign` reads.
            const groups = new Map(value.groups.map(group => [group.key, group]));
            const listed = people.flatMap(person => { const group = groups.get(person.group); return group === undefined ? [] : [{ kind: "person" as const, key: `person:${person.key}`, group, person }]; });
            return [...listed.sort((a, b) => rank(a.person) - rank(b.person)), { kind: "person" as const, key: "requests", group: undefined, person: undefined }];
        }
        return bandsOf(value.groups, noGroup).flatMap(group => [
            { kind: "group" as const, key: `group:${group.key}`, group },
            ...(collapsed.includes(group.key) ? [] : [
                ...(group.key === NO_GROUP ? [] : people.filter(p => p.group === group.key).sort((a, b) => rank(a) - rank(b)).map(person => ({ kind: "person" as const, key: `person:${person.key}`, group, person }))),
                { kind: "person" as const, key: `requests:${group.key}`, group, person: undefined },
            ]),
        ]);
    }, [value.people, value.visiblePeople, value.positions, value.groups, value.settings.peopleBands, noGroup, collapsed]);
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
    // A request is its group's row's — No group's band's, for one in no group yet (#1548) — or the one row of every group's (#1567).
    const index = rows.findIndex(row => row.kind === "person" && (person !== undefined ? row.person?.key === person
        : assignment?.who.type === "request" && row.person === undefined && (row.group === undefined || row.group.key === (groupOf(assignment) ?? NO_GROUP))));
    return index < 0 ? undefined : index;
}

/**
 * A kind of People row, as its estimate is measured: a group's band, a person's row, or a group's agency requests' —
 * and the work requirement's eyebrows, lanes and skill rows (#1568).
 */
type RowKind = "group" | "person" | "requests" | DemandRow["kind"];
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
    const samples = useRef<Record<RowKind, number>>({ group: 0, person: 0, requests: 0, demand: 0, lane: 0, skill: 0, assign: 0 });
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
        return { group: of("group"), person: of("person"), requests: of("requests"), demand: of("demand"), lane: of("lane"), skill: of("skill"), assign: of("assign") };
    }, [report]);
    const measure = useCallback((kind: RowKind) => refs[kind], [refs]);
    return { floors, measured, measure };
}

/**
 * The People grids' estimate of each kind before one has mounted: a row one line at the density's pitch (#1406, P30),
 * the theme's band, and the work requirement's 28px eyebrows (#1568).
 */
const PEOPLE_FLOORS: Readonly<Record<RowKind, number>> = { group: 38, person: 36, requests: 36, demand: 28, lane: 36, skill: 36, assign: 28 };
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

interface TileProps {
    ctx: ViewContext; id: string; assignment: Assignment; removed: boolean; person: Person | undefined;
    /**
     * The group the tile's row stands for: the person's home group, or a group's requests' group; `undefined` in the one
     * row of every group's requests (#1567). A duty in another group names it.
     */
    home: string | undefined;
}
/** Keep the shared drag hooks outside the tile body: pointer motion does not repaint its contents. */
function Tile(args: TileProps) {
    const { ctx, id, assignment: a, removed } = args;
    const { styles, value, drag } = ctx;
    const selection = useContext(SelectionContext);
    const selected = selection?.type === "assignment" && selection.key === id;
    const name = assignmentName(value, a);
    const coord = useMemo(() => ({ ...rosterCoord(drag.surface, a.place, id), event: id }), [drag.surface, a.place, id]);
    const ghost = useMemo(() => <MoveGhost styles={styles} label={name} />, [styles, name]);
    const enabled = drag.enabled && !removed && ctx.commands.availableOn(a.place.day);
    const handle = useDragEventChip(enabled ? coord : null, ghost, !enabled, name);
    const canDrop = useCallback((event: DragEventValue) => drag.run(event, true) === undefined, [drag]);
    const drop = useDropCell(enabled ? coord : null, !enabled, canDrop, undefined, { caption: drag.caption, name: drag.name });
    const dragRef = handle?.ref;
    const attach = useCallback((element: HTMLDivElement | null) => { dragRef?.(element); drop(element); }, [dragRef, drop]);
    return <TileBody {...args} selected={selected} handle={handle} attach={attach} />;
}
/**
 * A tile a duty (#1406, D5, P7): the shift's label — a request's too, its row saying it is one (#1566) — then its own
 * times where they differ from the shift's, else the group where it is not the row's — the person's home group, a
 * group's requests' group, none in the one row of every group's requests (#1567) — else the shift's hours where
 * `tileTimes` is always; a warning mark where an issue names it; its fill the shift's colour token, its words in the ink
 * the shade takes. Tile state comes from the held week and the domain issues, never from a second draft store.
 */
const TileBody = memo(function TileBody({ ctx, id, assignment: a, removed, person, home, selected, handle, attach }: TileProps & {
    selected: boolean; handle: ReturnType<typeof useDragEventChip>; attach: (element: HTMLDivElement | null) => void;
}) {
    const { styles, value, commands, drag, format } = ctx;
    const name = assignmentName(value, a);
    const enabled = drag.enabled && !removed && ctx.commands.availableOn(a.place.day);
    const shift = shiftOf(value, a.place.shift);
    const issues = removed ? NO_ISSUES : dutyIssues(ctx.issues, id);
    const baseline = ctx.held.assignments.get(id);
    const drafted = removed || baseline === undefined || !ctx.domain.sameAssignment(baseline, a);
    // A duty in no group yet names it — No group — on a person's row (#1548), as a duty in another group names that.
    const group = home !== (groupOf(a) ?? NO_GROUP) ? groupName(value, a.place.group) : undefined;
    const meta = ownTimes(value, a, ctx.start) ? { kind: "own" as const, text: `${hourText(a.start)}–${hourText(a.end)}` }
        : group !== undefined ? { kind: "group" as const, text: group.toLocaleUpperCase(format.locale) }
            : ctx.tileTimes === "always" && shift !== undefined ? { kind: "hours" as const, text: shiftHoursText(shift) } : undefined;
    const danger = issues.some(i => i.tone.type === "danger");
    const label = `${name} · ${shift?.label ?? a.place.shift}${meta === undefined ? "" : ` · ${meta.text}`}${removed ? " · removed" : ""}`;
    // What a run of the optimiser did to the duty (#1409, R23): its mark — the tile keeps its own fill, the ring and the glow alone — and its provenance on hover.
    const mark = dutyMark(ctx, id, removed, drafted);
    const words = issues.length > 0 ? `${label} · ${issues.map(i => i.title).join(" · ")}` : label;
    return <Box {...handle} ref={attach} css={styles.tile} style={removed ? undefined : fillOf(shift)} tabIndex={0} role="button" aria-label={label} aria-pressed={selected}
        title={mark === undefined ? words : `${mark.provenance} · ${words}`} data-op={mark?.op} data-fill={mark === undefined ? undefined : "own"}
        data-roster-assignment={id} data-roster-tile="" data-layout="people" data-added={baseline === undefined ? "" : undefined} data-moved={baseline !== undefined && !samePlace(baseline.place, a.place) ? "" : undefined}
        data-density={value.settings.density.type} data-selected={selected ? "" : undefined} data-drafted={drafted ? "" : undefined} data-removed={removed ? "" : undefined}
        data-conflict={ctx.conflicted(id) ? "" : undefined} data-bounds={ctx.bounded(id) ? "" : undefined} data-request={a.who.type === "request" ? "" : undefined} data-agency={person?.agency ? "" : undefined}
        data-tone={danger ? "danger" : issues.some(i => i.kind.type === "breach") ? "warning" : undefined} data-draggable={enabled ? "" : undefined}
        onClick={event => { event.stopPropagation(); ctx.select({ type: "assignment", key: id }); }}
        onKeyDown={event => { if (event.key === "Enter") { takeKey(event); ctx.select({ type: "assignment", key: id }); } else handle?.onKeyDown?.(event); }}>
        <Box as="span" css={styles.tileLabel} data-roster-assignment-name="">{shift?.label ?? a.place.shift}</Box>
        {meta !== undefined && <Box as="span" css={styles.tileMeta} data-own={meta.kind === "own" ? "" : undefined} data-group={meta.kind === "group" ? "" : undefined} data-roster-times={meta.kind === "own" ? "" : undefined}>{meta.text}</Box>}
        {issues.length > 0 && <Box as="span" css={styles.tileWarn} data-tone={danger ? "danger" : undefined} data-roster-tile-warn="" role="img" aria-label={issues[0]!.title}><FontAwesomeIcon icon={faTriangleExclamation} /></Box>}
        {(commands.availableOn(a.place.day) || commands.locked !== undefined) && <chakra.button type="button" css={styles.chipAction} data-roster-chip-action="" aria-label={removed ? `Restore ${name}` : `Remove ${name}`}
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
    const placeFor = (shift: string): Place => ({ day: BigInt(day), group: some(group), shift });
    const usual = person.usual.type === "some" ? person.usual.value : value.shifts[0]!.key;
    const trigger = <chakra.button type="button" css={styles.assign} data-roster-assign={`${person.key}.${day}`} data-roster-off="" aria-label={`Assign ${person.name} · ${format.weekday(date)}`}
        disabled={locked !== undefined} title={locked}>+ Assign</chakra.button>;
    if (locked !== undefined) return trigger;
    if (elsewhere) return <PlacePopover label="Elsewhere…" source={{ type: "person", key: person.key }} place={placeFor(usual)} value={value} start={start} commands={commands} styles={styles} onClose={() => setElsewhere(false)} />;
    return <ChakraMenu.Root positioning={{ placement: "bottom-start" }} onSelect={d => {
        if (d.value === "elsewhere") { setElsewhere(true); return; }
        ctx.onError(commands.place({ type: "person", key: person.key }, placeFor(d.value)));
    }}>
        <ChakraMenu.Trigger asChild>
            {trigger}
        </ChakraMenu.Trigger>
        <FrameMenuLayer label={`Assign · ${format.weekday(date)} ${format.number(date.getUTCDate())}`} data-roster-assign-menu="">
                    <Box css={styles.assignMenuHead}>Assign · {format.weekday(date)} {format.number(date.getUTCDate())}</Box>
                    {value.shifts.map(shift => <ChakraMenu.Item key={shift.key} value={shift.key} css={styles.assignItem} data-roster-assign-shift={shift.key}>
                        <Box as="span" css={styles.swatch} style={fillOf(shift)} aria-hidden="true" /><span>{shift.label}</span><Box as="span" data-roster-shift-times="">{shiftHoursText(shift)}</Box>
                    </ChakraMenu.Item>)}
                    <ChakraMenu.Separator />
                    <ChakraMenu.Item value="elsewhere">Elsewhere…</ChakraMenu.Item>
                </FrameMenuLayer>
    </ChakraMenu.Root>;
}
/**
 * A person's day in the People grid (#1406, P6–P11): a tile per duty and `+1` for a second, or `+ Assign` on a day off,
 * drawn again only as the day's duties, its person or what the views show changes (#1398, CL9). A drop on it resolves to
 * the dragged person's same or usual shift; a pattern dropped on it lands on the person's week (§11), and while one
 * hovers the row the day previews what the pattern leaves it (P19); another person's duty is refused (P11). The one
 * row of every group's requests (#1567) takes a request along it, in its own group, and refuses a card: it has no
 * group to place one in.
 *
 * The cell is its drop hooks and its attributes alone; what it shows is {@link PersonDayBody}, its own memo. The shared
 * drag hooks subscribe to the layer, which moves on every change of the cell a drag rests over, so a hundred cells draw
 * again each time one is crossed: a subscriber's draw must cost next to nothing, and the tiles, the `+ Assign` and the
 * preview draw again only as their own props change.
 */
const PersonDay = memo(function PersonDay({ ctx, person, rowKey, group, day, duties, current, weekSelected, preview, hovering, onPatternHover, onPatternLeave }: {
    ctx: ViewContext; person: Person | undefined;
    /** The row's key: the person's, or its requests' (`requests:<group>`, or `requests` for every group's). */
    rowKey: string;
    /** The group the row stands for: the person's home group, a group's requests' group; `undefined` for every group's requests. */
    group: string | undefined;
    day: number; duties: readonly DayDuty[];
    /** Whether the day is the one the views show: the day a Shifts view steps to. */
    current: boolean;
    /** Whether the person-week is selected: the row's cells outlined (D11). */
    weekSelected: boolean;
    /** What a pattern hovering the row leaves the day, while one does. */
    preview: PatternDay | undefined; hovering: boolean;
    onPatternHover: (key: string) => void; onPatternLeave: () => void;
}) {
    const { drag, value, week, styles, start } = ctx;
    const key = rowKey;
    // Where a card lands: the row's group — no group in No group's band's requests' row (#1548) — the person's usual
    // shift or the first; nowhere in every group's requests' row.
    const initial = useMemo((): Place | undefined => group === undefined ? undefined
        : { day: BigInt(day), group: group === NO_GROUP ? none : some(group), shift: person?.usual.type === "some" ? person.usual.value : value.shifts[0]!.key },
    [day, group, person, value.shifts]);
    // A pattern lands on the person's week, whatever day of it the drag rests over; the requests rows refuse it in its words.
    const personWeek = useMemo(() => rosterPersonWeekCoord(drag.surface, key, start), [drag.surface, key, start]);
    const resolve = useCallback((_x: number, _y: number, payload: DragPayload): CellCoord => {
        if (isPatternCard(payload, drag.surface)) return personWeek;
        const a = payload.kind === "event" ? week.assignments.get(payload.from.event) : undefined;
        // A duty moved along its row keeps its group, or none, and its shift.
        if (a !== undefined) return rosterCoord(drag.surface, { day: BigInt(day), group: a.place.group, shift: a.place.shift });
        return initial === undefined ? personWeek : rosterCoord(drag.surface, initial);
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
        // Every group's requests' row places no card: no group is the row's (#1567).
        if (event.type === "add" && initial === undefined) return false;
        return drag.run(event, true) === undefined;
    }, [drag, crossRow, initial]);
    const caption = useCallback((coord: CellCoord, payload: DragPayload, allowed: boolean) => {
        if (payload.kind === "event" && crossRow(payload.from.event)) return "A duty moves along its own row.";
        if (payload.kind === "item" && initial === undefined && !isPatternCard(payload, drag.surface)) return "Drop this card onto a group's shift.";
        return drag.caption(coord, payload, allowed);
    }, [crossRow, drag, initial]);
    const coord = useMemo(() => !drag.enabled ? null : initial === undefined ? personWeek : rosterCoord(drag.surface, initial), [drag.enabled, drag.surface, initial, personWeek]);
    const onHover = useCallback((_x: number, _y: number, payload: DragPayload) => { if (payload.kind === "item" && isPatternCard(payload, drag.surface)) onPatternHover(payload.from.key); }, [drag.surface, onPatternHover]);
    const ref = useDropCell(coord, !drag.enabled, canDrop, resolve, { accepts, caption, name: drag.name, onHover, onLeave: onPatternLeave });
    const drafted = useMemo(() => dayDrafted(ctx.domain, ctx.held, duties), [ctx.domain, ctx.held, duties]);
    // While a pattern hovers the row every day shows the pattern's day dashed, and the days it changes are tinted (P19).
    const changes = preview !== undefined && preview.kind !== "keep";
    return <Box ref={ref} css={styles.dayCell} data-roster-person-day={`${key}.${day}`} data-selected={current ? "" : undefined} data-week-selected={weekSelected ? "" : undefined}
        data-drafted={drafted ? "" : undefined} data-pattern-hover={hovering ? "" : undefined} data-pattern-changes={changes ? "" : undefined} data-roster-previewing={preview !== undefined ? "" : undefined}>
        <PersonDayBody ctx={ctx} person={person} rowKey={key} group={group} day={day} duties={duties} preview={preview} />
    </Box>;
});
/**
 * What a person's day shows: its tiles, `+1`, `+ Assign` or `Off` — and, while a pattern hovers its row, the pattern's
 * day beside them, the day's own tiles kept mounted and hidden by the cell (`data-roster-previewing`): a tile's drag
 * hooks register with the layer and with dnd-kit, and mounting and unmounting the tiles as the hover moved had every
 * droppable measured again and every subscriber drawn again, row after row.
 */
const PersonDayBody = memo(function PersonDayBody({ ctx, person, rowKey, group, day, duties, preview }: {
    ctx: ViewContext; person: Person | undefined; rowKey: string; group: string | undefined; day: number; duties: readonly DayDuty[]; preview: PatternDay | undefined;
}) {
    const { styles, commands } = ctx;
    peopleDrawProbe?.("day", `${rowKey}.${day}`);
    const { tiles, more } = dayTiles(duties);
    const off = person !== undefined && !duties.some(duty => !duty.removed);
    return <>
        {preview !== undefined && <PreviewTile ctx={ctx} day={preview} />}
        {tiles.map(({ id, a, removed }) => <Tile key={id} ctx={ctx} id={id} assignment={a} removed={removed} person={person} home={group} />)}
        {more > 0 && <Box as="span" css={styles.tileMore} data-roster-more={more} title={`${more} more`}>+{more}</Box>}
        {/* `+ Assign` places the person in their home group, with or without its band (#1567). */}
        {off && (commands.availableOn(BigInt(day)) || commands.locked !== undefined ? <AssignMenu ctx={ctx} person={person} group={person.group} day={day} /> : <Box css={styles.detail}>Off</Box>)}
    </>;
});
/** A person's name cell (#1406, D8): the name — the requests row's, the vocabulary's `requests` — the agency badge in the vocabulary's `agencyShort` (#1566), and — by week — the week's hours against the contract over the meter. */
function NameCell({ ctx, person, rowKey, weekSelected, hours, nameRef }: {
    ctx: ViewContext; person: Person | undefined; rowKey: string; weekSelected: boolean;
    /** The hours cell; nothing in the month (P16). */
    hours: ReactNode; nameRef?: RefObject<HTMLButtonElement | null> | undefined;
}) {
    const { styles, start, value } = ctx;
    return <Box css={styles.peopleName} data-selected={weekSelected ? "" : undefined} data-roster-person-name="">
        <Box css={styles.nameLine}>
            <chakra.button ref={nameRef} type="button" css={styles.personName} data-roster-person-head={person?.key} aria-pressed={weekSelected}
                onClick={() => person !== undefined && ctx.select({ type: "personWeek", key: rowKey, start: start.getTime() })}><span>{person?.name ?? value.vocabulary.requests}</span></chakra.button>
            {person?.agency && <Box as="span" css={styles.agencyBadge} data-roster-agency-badge="">{value.vocabulary.agencyShort}</Box>}
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
        {SEVEN_DAYS.map(day => <PersonDay key={day} ctx={ctx} person={person} rowKey={key} group={row.group?.key} day={day} duties={days[day] ?? NO_DUTIES} current={ctx.day === day}
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
// ── The work requirement (#1568, `People Work Requirements` 2a) ──────────────────────────────────────────────────────

/** No work requirement: `requirements` off, or a Roster with no targets. */
const NO_DEMANDS: ReadonlyMap<string | undefined, Demand> = new Map();
/** A week of the span with no coverage worked out: none of its slots. */
const NO_COVERAGE: ReadonlyMap<Slot, Coverage> = new SortedMap<Slot, Coverage>([], compareSlot);
/**
 * The work requirement of each scope the People grids draw (#1568): each band's group's, by its key, or — where the
 * layout draws no bands — every group's as one, keyed `undefined`; none while `requirements` is off or the Roster has
 * no targets; over the span in view, a week or a month's weeks. A scope's eyebrows stand whatever the span's targets —
 * a span naming none has no lane — so the first row of the list is the same from the first render on: the lanes a read
 * brings land under it, and a view at the top stays there, never pushed down by rows landing above it. While the span
 * is not read, the last read's stand in, so no lane comes or goes as the span lands, and each figure is a placeholder
 * until it has (K5, K6).
 *
 * @param props - The views' props: the payload, the span's weeks and their coverage, and the span's read
 * @returns Each scope's work requirement
 */
function useDemands(props: RosterViewsProps): ReadonlyMap<string | undefined, Demand> {
    const { value, weeks, spanCoverage, read } = props;
    const made = useMemo((): ReadonlyMap<string | undefined, Demand> => {
        if (!value.settings.requirements || value.targets.type !== "some") return NO_DEMANDS;
        // With no bands the one block counts the duties in no group yet too (#1548): rostered against each shift's day,
        // filling what its groups' slots are short; a band's group's work counts its own slots alone.
        const loose = !value.settings.peopleBands && value.duty.roles.noGroup;
        const span = weeks.map((held, w): DemandWeek => ({ requirements: held.week.requirements, coverage: spanCoverage[w] ?? NO_COVERAGE,
            loose: loose ? looseOf(value, held.week) : undefined }));
        return value.settings.peopleBands ? new Map(value.groups.map(group => [group.key, demandOf(value, span, [group.key])] as const))
            : new Map([[undefined, demandOf(value, span, value.groups.map(group => group.key), loose)]]);
    }, [value, weeks, spanCoverage]);
    const reads = read.state === "held";
    const held = useRef(made);
    useEffect(() => { if (reads) held.current = made; }, [reads, made]);
    return reads || made === NO_DEMANDS ? made : held.current;
}
/**
 * Which of the People grid's lanes are open, by their rows' keys (#1568, A4.5): the viewer's, kept as the bands' folds
 * are. Its `toggle` is the same function while the store is.
 *
 * @param surface - The Roster's surface, which its folds are kept under
 * @returns The open lanes' keys, and what opens or closes one
 */
function useOpenLanes(surface: string): { open: readonly string[]; toggle: (lane: string) => void } {
    const { state: open, setState } = usePersistedState<string[]>(`${surface}.open-lanes`, [], keptRead.array(keptRead.string));
    const toggle = useCallback((lane: string) => setState(current => current.includes(lane) ? current.filter(key => key !== lane) : [...current, lane]), [setState]);
    return { open, toggle };
}
/** A work requirement row's parts — its band's group, its shift and its skill — printed by East, so no two rows' keys are alike. */
const printParts = printFor(ArrayType(StringType));
function demandKey(kind: DemandRow["kind"], group: Group | undefined, ...parts: string[]): string {
    return `${kind}:${printParts(group === undefined ? parts : [group.key, ...parts])}`;
}
/** How many people each band lists (#1568, A1): those of its group the narrowing shows, by the group's key. */
function bandPeople(value: RosterValue): ReadonlyMap<string, number> {
    const counts = new Map<string, number>();
    for (const person of value.people) {
        if (value.visiblePeople.type === "some" && !value.visiblePeople.value.has(person.key)) continue;
        counts.set(person.group, (counts.get(person.group) ?? 0) + 1);
    }
    return counts;
}
/**
 * A count of people as a band and its assignment's eyebrow say it (#1568, A1, A5): `1 person`, `12 people`.
 *
 * @param number - The locale's number formatter
 * @param n - How many people
 * @returns The count in words
 */
function peopleSaid(number: (n: number) => string, n: number): string {
    return `${number(n)} ${n === 1 ? "person" : "people"}`;
}
/**
 * A scope's work requirement as rows (#1568): its group's — `undefined` for the one block over every group's, where the
 * layout draws no bands — its work requirement, and how many people its band lists.
 */
type DemandBlock<R> = (group: Group | undefined, demand: Demand, people: number) => readonly R[];
/**
 * The People rows with the work requirement's (#1568): under each open band its scope's block, or — where the layout
 * draws no bands — the one block at the list's head.
 *
 * @param list - The People list's rows
 * @param value - The payload
 * @param demands - Each scope's work requirement
 * @param people - How many people each band lists
 * @param block - A scope's rows: the grid's (`gridDemand`) or a phone's (`cardDemand`)
 * @returns The rows the layout draws
 */
function withDemand<R>(list: readonly ListRow[], value: RosterValue, demands: ReadonlyMap<string | undefined, Demand>, people: ReadonlyMap<string, number>,
    block: DemandBlock<R>): readonly (ListRow | R)[] {
    if (demands.size === 0) return list;
    const rows = (group: Group | undefined, count: number): readonly R[] => { const demand = demands.get(group?.key); return demand === undefined ? [] : block(group, demand, count); };
    if (!value.settings.peopleBands) return [...rows(undefined, list.filter(row => row.kind === "person" && row.person !== undefined).length), ...list];
    // An open band's rows follow it — its requests' row at least — and a folded band's do not.
    return list.flatMap((row, i): (ListRow | R)[] => row.kind !== "group" || list[i + 1] === undefined || list[i + 1]!.kind === "group" ? [row]
        : [row, ...rows(row.group, people.get(row.group.key) ?? 0)]);
}
/**
 * A scope's rows in the People grid, by week or by month (#1568): its eyebrow, its lanes — each open one's skill rows
 * under it — and the eyebrow before its people. A scope whose span names no target has its eyebrows and no lane.
 *
 * @param open - The open lanes' keys
 * @returns What makes a scope's rows
 */
function gridDemand(open: readonly string[]): DemandBlock<DemandRow> {
    return (group, demand, count) => [
        { kind: "demand", key: demandKey("demand", group), group, demand },
        ...demand.lanes.flatMap((lane): DemandRow[] => {
            const key = demandKey("lane", group, lane.shift.key), opened = open.includes(key);
            return [{ kind: "lane", key, group, lane, open: opened },
                ...(opened ? lane.skills.map((skill): DemandRow => ({ kind: "skill", key: demandKey("skill", group, lane.shift.key, skill.skill), group, lane, skill })) : [])];
        }),
        { kind: "assign", key: demandKey("assign", group), group, people: count },
    ];
}
/** A scope's rows on a phone (#1568): its eyebrow, which holds its day cards, and the eyebrow before its people's cards. */
const cardDemand: DemandBlock<AgendaDemandRow> = (group, demand, count) => [
    { kind: "demand", key: demandKey("demand", group), group, demand },
    { kind: "assign", key: demandKey("assign", group), group, people: count },
];
/**
 * The People grid's sections whose heads stick under its header (#1568, A6): a band's work requirement — the band, its
 * eyebrow, its lanes and their skill rows heading the band's rows to the next band — or, where the grid draws no bands,
 * the one block heading everyone's. The skill rows give way first: past half of main they scroll with the people.
 *
 * @param rows - The rows the grid draws
 * @returns Its sections, in order
 */
function demandSections(rows: readonly PeopleRow[]): readonly StickySection[] {
    const yields = (i: number) => rows[i]?.kind === "skill";
    const heads = (i: number) => rows[i]?.kind === "demand" || rows[i]?.kind === "lane" || rows[i]?.kind === "skill";
    const sections: StickySection[] = [];
    for (let i = 0; i < rows.length; i++) {
        const kind = rows[i]!.kind;
        // A band its work requirement follows, or the block a grid of no bands opens with.
        if (!(kind === "group" ? rows[i + 1]?.kind === "demand" : kind === "demand" && rows[i - 1]?.kind !== "group")) continue;
        let head = kind === "group" ? i + 1 : i;
        while (heads(head)) head++;
        let end = head;
        while (end < rows.length && rows[end]!.kind !== "group") end++;
        sections.push({ start: i, end, head: head - i, yields });
    }
    return sections;
}
/**
 * A band's work requirement (#1568, A1): the people it lists, then the week's hours needed, rostered and their
 * difference in the Shifts band's words, and how many of its shifts are short.
 */
function BandDemand({ ctx, demand, people }: { ctx: ViewContext; demand: Demand; people: number }) {
    const { styles, format, read } = ctx;
    const { needed, rostered, shortSlots } = demand.total;
    return <>
        <Box as="span" css={styles.groupMeta} data-count="">{peopleSaid(format.number, people)}</Box>
        <Box as="span" css={styles.groupMeta} data-roster-band-demand="">{read.state !== "held" ? <Unread read={read} kind="aggregate" index={2} />
            : <>{format.number(needed)} h needed · {format.number(rostered)} h rostered · {signed(format.number, difference(rostered, needed), "+0")} h{shortSlots > 0
                && <Box as="span" data-tone="warning"> · {format.number(shortSlots)} {shortSlots === 1 ? "shift" : "shifts"} short</Box>}</>}</Box>
    </>;
}
/** The work requirement's eyebrow (#1568, A2): the vocabulary's heading, then each day's hours rostered against needed, no valence. */
const DemandHead = memo(function DemandHead({ ctx, row, measure }: {
    ctx: ViewContext; row: Extract<DemandRow, { kind: "demand" }>; measure: (el: HTMLElement | null) => void;
}) {
    const { styles, format, read, value } = ctx;
    return <Box ref={measure} css={styles.demandRow} data-roster-demand={row.key}>
        <Box css={styles.demandName} data-roster-demand-heading="">{value.vocabulary.demand}</Box>
        {SEVEN_DAYS.map(day => { const figures = row.demand.days[day]!; return <Box key={day} css={styles.demandFigure} data-roster-demand-day={day}>
            {read.state !== "held" ? <Unread read={read} kind="number" index={day} /> : `${format.number(figures.rostered)} / ${format.number(figures.needed)} h`}</Box>; })}
    </Box>;
});
/**
 * Hours rostered — or a skill's assigned — against those needed (A3.3, A4.3): `292 / 294`, the first in the ink, a
 * skill's in the second ink, and the warning's where a skill's day is short.
 */
function Figure({ ctx, rostered, needed, skill = false, short = false }: { ctx: ViewContext; rostered: number; needed: number; skill?: boolean; short?: boolean }) {
    return <Box as="span" css={ctx.styles.laneFigure} data-skill={skill ? "" : undefined}>
        <span data-rostered="" data-tone={short ? "warning" : undefined}>{ctx.format.number(rostered)}</span><span data-needed="">/ {ctx.format.number(needed)}</span>
    </Box>;
}
/**
 * A lane's day's figures (A3.3): the hours rostered against needed and the difference they state, where there is one —
 * where any of its slots is short, what they are short, never their net (K4) — over the bar: the permanent staff's,
 * agency staff's and the requests' parts from its start, what its slots are short open dashed after them, and the
 * needed tick, scaled to the larger of the hours needed and those its parts reach (A3.4, {@link barOf}).
 */
function LaneFigures({ ctx, figures: f }: { ctx: ViewContext; figures: DemandFigures }) {
    const { styles, format } = ctx;
    const d = stated(f.rostered, f.needed, f.short), bar = barOf(f, f.short);
    return <>
        <Box as="span" css={styles.laneLine} data-roster-lane-figures=""><Figure ctx={ctx} rostered={f.rostered} needed={f.needed} /><Box as="span" css={styles.laneDiff} data-roster-lane-difference="" data-tone={toneOf(d)}>{signed(format.number, d)}</Box></Box>
        <Box as="span" css={styles.laneBar} data-roster-lane-bar="">
            {bar.parts.map(part => <Box as="span" key={part.kind} css={styles.coverageSegment} data-kind={part.kind} style={{ left: `${part.left / bar.scale * 100}%`, width: `${part.width / bar.scale * 100}%` }} />)}
            <Box as="span" css={styles.laneTick} style={{ left: `${f.needed / bar.scale * 100}%` }} />
        </Box>
    </>;
}
/**
 * A lane's day to a press (#1568, A3.8): it selects its slot, a band's group's, or the shift's day across the groups
 * where the layout draws no bands, which the inspector shows. Its label names the shift, the day and the group, then
 * the hours rostered of needed and the difference its figure states — `216 of 214 hours rostered, 2 short` where a
 * group is short as another is over (K4) — or `no target`.
 *
 * @param ctx - The views' context
 * @param group - The lane's band's group; `undefined` for the one block over every group's
 * @param lane - The lane
 * @param day - The day, from the week's start
 * @returns Whether the day is selected, what it says to a screen reader, and what selects it
 */
function useLaneDay(ctx: ViewContext, group: Group | undefined, lane: DemandLane, day: number): { selected: boolean; label: string; select: () => void } {
    const { format, read, start } = ctx;
    const selection = useContext(SelectionContext);
    const shift = lane.shift.key;
    const slot = useMemo(() => group === undefined ? undefined : { day: BigInt(day), group: group.key, shift }, [group, day, shift]);
    const selected = slot !== undefined ? selectedSlot(selection, slot) : selection?.type === "shiftDay" && selection.shift === shift && selection.day === day;
    const f = lane.days[day]!;
    const when = `${lane.shift.label} · ${format.weekday(new Date(start.getTime() + day * DAY))}${group === undefined ? "" : ` · ${group.label}`}`;
    const label = read.state !== "held" ? when : !f.target ? `${when}: no target`
        : `${when}: ${format.number(f.rostered)} of ${format.number(f.needed)} hours rostered${differenceSaid(format.number, stated(f.rostered, f.needed, f.short))}`;
    const select = () => ctx.select(slot !== undefined ? { type: "requirement", slot, start: start.getTime() } : { type: "shiftDay", shift, day, start: start.getTime() });
    return { selected, label, select };
}
/**
 * What a lane's day shows (A3.3): its figures over its bar, or — none of the day's slots with a target — `no target`, no
 * bar (A3.6); a placeholder while the week is read.
 */
function LaneDayFigures({ ctx, lane, day }: { ctx: ViewContext; lane: DemandLane; day: number }) {
    const f = lane.days[day]!;
    return ctx.read.state !== "held" ? <Unread read={ctx.read} kind="aggregate" index={day} />
        : f.target ? <LaneFigures ctx={ctx} figures={f} /> : <Box as="span" css={ctx.styles.laneNoTarget} data-roster-lane-none="">no target</Box>;
}
/** A lane's day (#1568, A3.3): its figures, a press selecting it (A3.8). */
const LaneDay = memo(function LaneDay({ ctx, rowKey, group, lane, day }: { ctx: ViewContext; rowKey: string; group: Group | undefined; lane: DemandLane; day: number }) {
    const { selected, label, select } = useLaneDay(ctx, group, lane, day);
    return <chakra.button type="button" css={ctx.styles.laneCell} data-roster-lane-day={`${rowKey}.${day}`} data-selected={selected ? "" : undefined} aria-pressed={selected} aria-label={label}
        onClick={select}>
        <LaneDayFigures ctx={ctx} lane={lane} day={day} />
    </chakra.button>;
});
/**
 * A lane (#1568, A3): a shift's row of the work requirement — its name cell the disclosure of its skill rows (A3.7),
 * holding the shift's swatch, label and hours and the week's hours rostered against needed over the difference they
 * state, what its days' slots are short where any is (K4: no day's surplus nets another's shortfall) — then a day a cell.
 */
const LaneRow = memo(function LaneRow({ ctx, row, toggle, measure }: {
    ctx: ViewContext; row: Extract<DemandRow, { kind: "lane" }>; toggle: (lane: string) => void; measure: (el: HTMLElement | null) => void;
}) {
    const { styles, format, read, value } = ctx;
    const { lane } = row;
    const d = stated(lane.total.rostered, lane.total.needed, lane.total.short);
    return <Box ref={measure} css={styles.peopleRow} data-roster-lane={row.key} data-roster-lane-group={row.group?.key} data-roster-lane-shift={lane.shift.key} data-density={value.settings.density.type}>
        <chakra.button type="button" css={[styles.laneName, styles.laneToggle]} aria-expanded={row.open} data-roster-lane-head="" onClick={() => toggle(row.key)}>
            <FontAwesomeIcon icon={faAngleRight} />
            <Box as="span" css={styles.laneSwatch} style={fillOf(lane.shift)} />
            <Box as="span" css={styles.laneLabel}>{lane.shift.label}</Box>
            <Box as="span" css={styles.laneHours}>{shiftHoursText(lane.shift)}</Box>
            <Box as="span" css={styles.laneWeek} data-roster-lane-week="">{read.state !== "held" ? <Unread read={read} kind="number" index={0} /> : <>
                <Figure ctx={ctx} rostered={lane.total.rostered} needed={lane.total.needed} />
                <Box as="span" css={styles.laneDiff} data-roster-lane-difference="" data-tone={toneOf(d)}>{signed(format.number, d)}</Box></>}</Box>
        </chakra.button>
        {SEVEN_DAYS.map(day => <LaneDay key={day} ctx={ctx} rowKey={row.key} group={row.group} lane={lane} day={day} />)}
    </Box>;
});
/**
 * A skill row's day's figures (A4.3): the hours assigned against needed, the warning's where short, the difference they
 * state — what the day's slots are short of the skill where any is, never their net (K4) — and a 3px bar filled to the
 * share of the need its slots meet ({@link skillMet}).
 */
function SkillFigures({ ctx, figures: f }: { ctx: ViewContext; figures: SkillFigures }) {
    const { styles, format } = ctx;
    const d = stated(f.assigned, f.needed, f.short);
    return <>
        <Box css={styles.laneLine}><Figure ctx={ctx} rostered={f.assigned} needed={f.needed} skill short={d < 0} /><Box as="span" css={styles.laneDiff} data-roster-lane-difference="" data-tone={toneOf(d)}>{signed(format.number, d)}</Box></Box>
        <Box css={styles.skillBar} data-roster-skill-bar=""><Box css={styles.weekFillValue} style={{ width: `${skillMet(f) * 100}%` }} /></Box>
    </>;
}
/**
 * A skill row under an open lane (#1568, A4): its code tag and name, the week's hours assigned against needed, then a day
 * a cell — empty where none of the day's slots needs the skill.
 */
const SkillRow = memo(function SkillRow({ ctx, row, measure }: { ctx: ViewContext; row: Extract<DemandRow, { kind: "skill" }>; measure: (el: HTMLElement | null) => void }) {
    const { styles, read, value } = ctx;
    const activity = activityOf(value, row.skill.skill);
    return <Box ref={measure} css={styles.peopleRow} data-roster-lane-skill={row.key} data-density={value.settings.density.type}>
        <Box css={styles.laneName} data-skill="">
            {activity?.code && <Box as="span" css={styles.skillTag}>{activity.code}</Box>}
            <Box as="span" css={styles.skillName}>{activity?.label ?? row.skill.skill}</Box>
            <Box as="span" css={styles.laneWeek}>{read.state !== "held" ? <Unread read={read} kind="number" index={1} /> : <Figure ctx={ctx} rostered={row.skill.total.assigned} needed={row.skill.total.needed} skill />}</Box>
        </Box>
        {SEVEN_DAYS.map(day => { const figures = row.skill.days[day]; return <Box key={day} css={styles.laneCell} data-roster-lane-skill-day={`${row.key}.${day}`}>
            {read.state !== "held" ? <Unread read={read} kind="number" index={day} /> : figures === undefined ? null : <SkillFigures ctx={ctx} figures={figures} />}</Box>; })}
    </Box>;
});
/** The eyebrow before a band's people (#1568, A5): `Assignment · 12 people`, the people the band lists — `1 person` for one. */
const AssignHead = memo(function AssignHead({ ctx, row, measure }: { ctx: ViewContext; row: Extract<DemandRow, { kind: "assign" }>; measure: (el: HTMLElement | null) => void }) {
    return <Box ref={measure} css={ctx.styles.assignRow} data-roster-assign-head={row.key}>
        <Box as="span" css={ctx.styles.assignLabel}>Assignment · {peopleSaid(ctx.format.number, row.people)}</Box>
    </Box>;
});

/**
 * The People grid by week (#1406, §8): a sticky header, a group band a group, a row a person — and with targets the
 * work requirement over each band's people, or over everyone where it draws no bands (#1568).
 */
function People({ props, ctx }: { props: RosterViewsProps; ctx: ViewContext }) {
    const { collapsed, toggle } = useGroupCollapse(props.drag.surface);
    const list = usePeopleRows(props.value, collapsed);
    // The work requirement's rows (#1568): each band's, or the one block over every group's, their lanes opened by the viewer.
    const demands = useDemands(props);
    const { open, toggle: toggleLane } = useOpenLanes(props.drag.surface);
    const people = useMemo(() => bandPeople(props.value), [props.value]);
    const rows = useMemo(() => withDemand(list, props.value, demands, people, gridDemand(open)), [list, props.value, demands, open, people]);
    // Each band's work requirement sticks under the header while its people scroll (A6).
    const sections = useMemo(() => demandSections(rows), [rows]);
    const index = useMemo(() => peopleIndex(props.week, props.held), [props.week, props.held]);
    const { floors, measured, measure } = useRowFloors(PEOPLE_FLOORS);
    // A new floor places every row again at it, the rows measured kept: a new key function is what has the rows' places
    // worked out again.
    const getItemKey = useCallback((i: number) => rows[i]!.key, [rows, floors]); // eslint-disable-line react-hooks/exhaustive-deps -- the floors re-key the places
    const estimateSize = useCallback((i: number) => { const row = rows[i]!; return row.kind !== "person" ? floors[row.kind] : row.person === undefined ? floors.requests : floors.person; }, [rows, floors]);
    // A row drawn again only as what it shows changes: the same function while the rows, the week and the views hold (CL9).
    const renderRow = useCallback((i: number) => {
        const row = rows[i]!;
        switch (row.kind) {
            case "group": {
                const demand = demands.get(row.group.key);
                return <GroupHeading scope="roster" group={row.group} styles={ctx.styles} collapsed={collapsed.includes(row.group.key)} toggle={toggle} measure={measure("group")}>
                    {demand !== undefined && <BandDemand ctx={ctx} demand={demand} people={people.get(row.group.key) ?? 0} />}
                </GroupHeading>;
            }
            case "demand": return <DemandHead ctx={ctx} row={row} measure={measure("demand")} />;
            case "lane": return <LaneRow ctx={ctx} row={row} toggle={toggleLane} measure={measure("lane")} />;
            case "skill": return <SkillRow ctx={ctx} row={row} measure={measure("skill")} />;
            case "assign": return <AssignHead ctx={ctx} row={row} measure={measure("assign")} />;
            case "person": {
                const days = row.person === undefined ? requestDays(index, row.group) : index.person.get(row.person.key);
                return <PersonRow ctx={ctx} row={row} index={i} rows={rows} days={days ?? NO_DAYS} duties={row.person === undefined ? undefined : index.duties.get(row.person.key)}
                    measure={measure(row.person === undefined ? "requests" : "person")} />;
            }
        }
    }, [rows, ctx, collapsed, toggle, index, measure, demands, people, toggleLane]);
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
                header={header} sections={sections} count={rows.length} getItemKey={getItemKey} estimateSize={estimateSize} anchorable={ANCHOR_EVERY_ROW}
                scrollToIndex={selectedPeopleRow(props, rows)} scrollAlign="auto" renderRow={renderRow}
                onAnchorChange={onAnchorChange} restoreAnchor={restore} />
        </PeopleFocusContext.Provider>
    </Box>;
}

// ── The month (#1406, §8, P12–P16) ─────────────────────────────────────────────────────────────────────────────────

/**
 * A week column's header: `W10` and its dates over its seven days' ticks; a press opens the week in Week (P12), and with
 * Week not offered it is a heading alone: nothing to press, no tab stop and nothing said of opening. Its
 * label holds both forms of its dates — as the shared range prints them, `Mar 5 – 11, 2028`, and their days alone, the
 * month name dropped, `5 – 11` — the one the header's fit chose in its place and the other laid out unseen beside it,
 * so the fit measures each whole ({@link useMonthHeadFit}).
 */
function WeekColumnHead({ ctx, week, current }: { ctx: ViewContext; week: Date; current: boolean }) {
    const { styles, format } = ctx;
    const last = new Date(week.getTime() + 6 * DAY);
    const number = weekNumber(week), range = format.range(week, last);
    const days = `${format.number(week.getUTCDate())} – ${format.number(last.getUTCDate())}`;
    const heading = { css: styles.weekHead, "data-roster-week-column": weekKey(week), "data-roster-column-header": "", "data-selected": current ? "" : undefined };
    const body = <>
        <Box css={styles.weekNumber} data-roster-week-label=""><span data-roster-week-number="">W{format.number(number)}</span>
            <Box as="span" css={styles.weekRange} data-roster-week-dates="full">{range}</Box><Box as="span" css={styles.weekRange} data-roster-week-dates="days">{days}</Box></Box>
        <Box css={styles.dayTicks}>{SEVEN_DAYS.map(day => { const date = new Date(week.getTime() + day * DAY); return <Box key={day} css={styles.dayTick} data-roster-day-tick="">
            <span data-roster-day-letter="">{format.weekday(date).slice(0, 1).toLocaleUpperCase(format.locale)}</span><span data-roster-day-number="">{format.number(date.getUTCDate())}</span></Box>; })}</Box>
    </>;
    return ctx.opensWeek ? <chakra.button type="button" {...heading} aria-label={`Open W${format.number(number)} · ${range}`} onClick={() => ctx.openWeek(week)}>{body}</chakra.button> : <Box {...heading}>{body}</Box>;
}
/**
 * How the month's header fits its columns (the hand retest, R3, ruled 27 Oct 2026: "Fit rule now"): each week's label
 * in the richest form every column holds whole — its dates, then its dates with the month name dropped, then its number
 * alone — and the day ticks' letters, and their numbers, only where every day holds its own whole, the 2px between two
 * ticks keeping each clear of the next, as the marks are lettered only where a day is wide enough. Nothing is cut.
 */
interface MonthHeadFit {
    /** The week labels' form: their dates, their dates' days alone, or their numbers alone. */
    readonly label: "full" | "days" | "number";
    /** Whether the ticks show their days' letters, and their numbers. */
    readonly letters: boolean;
    readonly numbers: boolean;
}
/** The header before it is measured, and where it cannot be (no layout): every word in its place. */
const MONTH_HEAD_WHOLE: MonthHeadFit = { label: "full", letters: true, numbers: true };
/** A computed length in pixels; none, 0. */
const px = (value: string) => Number.parseFloat(value) || 0;
/** An element's width with what its box cuts of its content: its words' natural width, whatever clips them; none, 0. */
const natural = (el: Element | null) => el === null ? 0 : el.getBoundingClientRect().width + Math.max(0, el.scrollWidth - el.clientWidth);
/**
 * The month's header measured as it is laid out: each week label's room against its number and each form of its dates
 * at their natural widths — the one shown, whatever its box cut of it, and the other laid out unseen — and each tick's
 * room against its letter and its number, which keep their width unseen. What it reads never moves with the fit, so a
 * measure never loops.
 *
 * @param head - The header's row
 * @returns How it fits
 */
function measureMonthHead(head: HTMLElement): MonthHeadFit {
    let full = true, days = true, letters = true, numbers = true;
    for (const label of head.querySelectorAll<HTMLElement>("[data-roster-week-label]")) {
        const css = getComputedStyle(label);
        const room = label.getBoundingClientRect().width - px(css.paddingLeft) - px(css.paddingRight) + 0.5;
        const own = natural(label.querySelector("[data-roster-week-number]")) + px(css.columnGap);
        if (own + natural(label.querySelector('[data-roster-week-dates="full"]')) > room) full = false;
        if (own + natural(label.querySelector('[data-roster-week-dates="days"]')) > room) days = false;
    }
    for (const tick of head.querySelectorAll<HTMLElement>("[data-roster-day-tick]")) {
        const room = tick.getBoundingClientRect().width + 0.5;
        if (natural(tick.querySelector("[data-roster-day-letter]")) > room) letters = false;
        if (natural(tick.querySelector("[data-roster-day-number]")) > room) numbers = false;
    }
    return { label: full ? "full" : days ? "days" : "number", letters, numbers };
}
/**
 * A row's fit as it is laid out — the month's header's ({@link MonthHeadFit}) or a work requirement's eyebrow's by month
 * ({@link DemandWeekForm}): measured after each render, as the row resizes and as fonts arrive, before the browser
 * paints. What a measure reads never moves with the fit, so it never loops.
 *
 * @typeParam T - The fit
 * @param row - The row measured
 * @param measure - Its fit, as it is laid out; a module's own function, the same at every render
 * @param same - Whether two fits are the same, so an unmoved fit draws nothing again
 * @param initial - The fit before the row is measured, and where it cannot be (no layout)
 * @returns How it fits
 */
function useLayoutFit<T>(row: RefObject<HTMLElement | null>, measure: (el: HTMLElement) => T, same: (a: T, b: T) => boolean, initial: T): T {
    const [fit, setFit] = useState(initial);
    const run = useCallback(() => {
        const el = row.current;
        if (el === null) return;
        const next = measure(el);
        setFit(was => same(was, next) ? was : next);
    }, [row, measure, same]);
    // After every render: the weeks, the figures, the locale or the density may have moved.
    useLayoutEffect(() => { run(); });
    useLayoutEffect(() => {
        const el = row.current;
        if (el === null) return undefined;
        const observer = typeof ResizeObserver === "undefined" ? undefined : new ResizeObserver(run);
        observer?.observe(el);
        const fonts = el.ownerDocument.fonts as FontFaceSet | undefined;
        fonts?.addEventListener?.("loadingdone", run);
        void fonts?.ready?.then(run, () => undefined);
        return () => {
            observer?.disconnect();
            fonts?.removeEventListener?.("loadingdone", run);
        };
    }, [row, run]);
    return fit;
}
/** Whether two of the month's header's fits are the same. */
const sameMonthHeadFit = (a: MonthHeadFit, b: MonthHeadFit) => a.label === b.label && a.letters === b.letters && a.numbers === b.numbers;
/**
 * The month's header's fit ({@link MonthHeadFit}).
 *
 * @param head - The header's row
 * @returns How it fits
 */
function useMonthHeadFit(head: RefObject<HTMLElement | null>): MonthHeadFit {
    return useLayoutFit(head, measureMonthHead, sameMonthHeadFit, MONTH_HEAD_WHOLE);
}
/**
 * A day's mark in a week cell (P13): the shift's letter — its code's first, never the whole code, which the mark would
 * cut (#1569) — in its colour, an off day faint; dashed where a pattern previews it; drafted against its own week as held.
 */
function Mark({ ctx, held, day, duties, preview, letters }: { ctx: ViewContext; held: Week; day: number; duties: readonly DayDuty[]; preview: PatternDay | undefined; letters: boolean }) {
    const { value, styles } = ctx;
    // While a pattern hovers the cell its seven marks are the pattern's days, dashed (P15).
    if (preview !== undefined) {
        const shift = preview.shift === undefined ? undefined : shiftOf(value, preview.shift);
        return <Box as="span" css={styles.mark} data-roster-mark={day} data-preview={preview.kind} data-off={shift === undefined ? "" : undefined} style={fillOf(shift)}>{letters ? shiftLetter(shift) : ""}</Box>;
    }
    const live = duties.filter(duty => !duty.removed);
    const first = live[0] ?? duties[0];
    if (first === undefined) return <Box as="span" css={styles.mark} data-roster-mark={day} data-off="" />;
    const shift = shiftOf(value, first.a.place.shift);
    const drafted = first.removed || (() => { const baseline = held.assignments.get(first.id); return baseline === undefined || !ctx.domain.sameAssignment(baseline, first.a); })();
    return <Box as="span" css={styles.mark} data-roster-mark={day} data-shift={first.a.place.shift} data-removed={live.length === 0 ? "" : undefined} data-drafted={drafted ? "" : undefined}
        style={live.length === 0 ? undefined : fillOf(shift)} title={`${shift?.label ?? first.a.place.shift}${live.length > 1 ? ` +${live.length - 1}` : ""}`}>{letters ? shiftLetter(shift) : ""}</Box>;
}
/**
 * A person's week in the month (P13–P15): seven marks, a drop target for a pattern, a click selecting the person-week;
 * tinted while a day of it is drafted; a placeholder strip while the month is not read (P26).
 */
const MonthCell = memo(function MonthCell({ ctx, person, rowKey, held, days, letters, selected }: {
    ctx: ViewContext; person: Person | undefined;
    /** The row's key: the person's, or its requests' (`requests:<group>`, or `requests` for every group's, #1567). */
    rowKey: string;
    held: WeekState; days: WeekDays; letters: boolean; selected: boolean;
}) {
    const { drag, styles, commands, value } = ctx;
    const key = rowKey;
    const start = held.start;
    const coord = useMemo(() => drag.enabled ? rosterPersonWeekCoord(drag.surface, key, start) : null, [drag.enabled, drag.surface, key, start]);
    const accepts = useCallback((payload: DragPayload) => isPatternCard(payload, drag.surface), [drag.surface]);
    const canDrop = useCallback((event: DragEventValue) => drag.run(event, true) === undefined, [drag]);
    const [previewKey, setPreviewKey] = useState<string>();
    const onHover = useCallback((_x: number, _y: number, payload: DragPayload) => { if (payload.kind === "item" && isPatternCard(payload, drag.surface)) setPreviewKey(payload.from.key); }, [drag.surface]);
    const onLeave = useCallback(() => setPreviewKey(undefined), []);
    const ref = useDropCell(coord, !drag.enabled, canDrop, undefined, { accepts, caption: drag.caption, name: drag.name, onHover, onLeave });
    const plan = useMemo(() => previewKey === undefined || person === undefined ? undefined : commands.pattern(person.key, start, previewKey), [previewKey, person, commands, start]);
    const previewDays = typeof plan === "object" ? plan.days : undefined;
    const revealed = useRevealed() === true;
    const unread = ctx.read.state !== "held";
    const drafted = !unread && SEVEN_DAYS.some(day => dayDrafted(ctx.domain, held.held, days[day] ?? NO_DUTIES));
    return <chakra.button ref={ref as (el: HTMLButtonElement | null) => void} type="button" css={styles.monthCell} data-roster-person-week={`${key}.${weekKey(start)}`} data-selected={selected ? "" : undefined}
        data-drafted={drafted ? "" : undefined} data-pattern-hover={previewKey !== undefined ? "" : undefined} data-density={value.settings.density.type}
        aria-label={`${person?.name ?? value.vocabulary.requests} · W${ctx.format.number(weekNumber(start))}`} aria-pressed={selected}
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
            : weeks.map((held, i) => <MonthCell key={held.start.getTime()} ctx={ctx} person={person} rowKey={key} held={held} letters={letters}
                days={(person === undefined ? requestDays(indexes[i]!, row.group) : indexes[i]!.person.get(person.key)) ?? NO_DAYS}
                selected={person !== undefined && picked !== undefined && picked.key === person.key && picked.start === held.start.getTime()} />)}
    </Box>;
});
/**
 * How the work requirement's eyebrow by month says each week's hours (#1568), by the month's header's fit rule (R3):
 * in the richest form every week's column holds whole — `1,352 / 1,298 h`; then the unit dropped, `1,352 / 1,298`; then
 * the hours rostered over the hours needed, `/ 1,298` under `1,352` — and none where even that does not fit. Nothing is
 * cut.
 */
type DemandWeekForm = "full" | "short" | "stacked" | "none";
/** The forms, richest first. */
const DEMAND_WEEK_FORMS = ["full", "short", "stacked"] as const;
/**
 * The eyebrow by month measured as it is laid out: each week's room against each form of its hours at their natural
 * widths — the one shown, and the others laid out unseen beside it — the richest form every week holds. A week still
 * read holds none, and decides nothing.
 *
 * @param row - The eyebrow's row
 * @returns Its form
 */
function measureDemandWeeks(row: HTMLElement): DemandWeekForm {
    const fits = new Set<DemandWeekForm>(DEMAND_WEEK_FORMS);
    for (const cell of row.querySelectorAll<HTMLElement>("[data-roster-demand-week]")) {
        if (cell.querySelector("[data-roster-demand-form]") === null) continue;
        const css = getComputedStyle(cell);
        const room = cell.getBoundingClientRect().width - px(css.borderLeftWidth) - px(css.paddingLeft) - px(css.paddingRight) + 0.5;
        for (const form of DEMAND_WEEK_FORMS) if (natural(cell.querySelector(`[data-roster-demand-form="${form}"]`)) > room) fits.delete(form);
    }
    return DEMAND_WEEK_FORMS.find(form => fits.has(form)) ?? "none";
}
/**
 * The work requirement's eyebrow by month (#1568, A2.2): the vocabulary's heading, then each week's hours rostered
 * against needed, no valence, in the form every week's column holds whole ({@link DemandWeekForm}): each form of a
 * week's hours is laid out, the one shown in its place and the others unseen beside it, so the fit measures each whole.
 */
const MonthDemandHead = memo(function MonthDemandHead({ ctx, row, weeks, measure }: {
    ctx: ViewContext; row: Extract<DemandRow, { kind: "demand" }>; weeks: readonly WeekState[]; measure: (el: HTMLElement | null) => void;
}) {
    const { styles, format, read, value } = ctx;
    const own = useRef<HTMLDivElement>(null);
    const form = useLayoutFit(own, measureDemandWeeks, Object.is, "full");
    const ref = useCallback((el: HTMLDivElement | null) => { own.current = el; measure(el); }, [measure]);
    return <Box ref={ref} css={styles.demandRow} data-period="month" data-roster-demand={row.key} data-demand-form={form}>
        <Box css={styles.demandName} data-roster-demand-heading="">{value.vocabulary.demand}</Box>
        {weeks.map((held, w) => {
            const figures = row.demand.weeks[w];
            const rostered = figures === undefined ? "" : format.number(figures.rostered), needed = figures === undefined ? "" : format.number(figures.needed);
            return <Box key={held.start.getTime()} css={styles.demandFigure} data-roster-demand-week={weekKey(held.start)}>
                {read.state !== "held" || figures === undefined ? <Unread read={read} kind="number" index={w} /> : <>
                    <span data-roster-demand-form="full">{`${rostered} / ${needed} h`}</span>
                    <span data-roster-demand-form="short">{`${rostered} / ${needed}`}</span>
                    <span data-roster-demand-form="stacked"><span>{rostered}</span><span>{`/ ${needed}`}</span></span>
                </>}
            </Box>;
        })}
    </Box>;
});
/**
 * A cup's levels by month (ruled 8 Nov 2026), as its recipe draws its parts and its figure's ink: each a share of its
 * height; none for an empty cup, whose levels are the recipe's nothing.
 *
 * @param cup - The cup's levels
 * @returns Its style
 */
function cupStyle(cup: DemandCup): CSSProperties | undefined {
    return cup.fill === 0 ? undefined
        : { "--roster-cup-permanent": `${cup.permanent * 100}%`, "--roster-cup-agency": `${cup.agency * 100}%`, "--roster-cup-fill": `${cup.fill * 100}%` } as CSSProperties;
}
/**
 * A cup's parts by month (ruled 8 Nov 2026): each part of the hours that fills it from the bottom — a lane's permanent
 * staff's, agency staff's and the agencies' requests', or a skill's hours assigned — then, on a short day, what it lacks.
 *
 * @param cup - The cup's levels
 * @param state - Its mark's state
 * @param skill - Whether it is a skill row's, filled by its hours assigned alone
 * @returns Its parts, which its recipe places by its levels
 */
function cupParts(cup: DemandCup, state: DemandMark["state"], skill: boolean): ReactNode {
    return <>
        {skill ? cup.fill > 0 && <span data-roster-cup-part="assigned" /> : <>
            {cup.permanent > 0 && <span data-roster-cup-part="permanent" />}
            {cup.agency > cup.permanent && <span data-roster-cup-part="agency" />}
            {cup.fill > cup.agency && <span data-roster-cup-part="requested" />}
        </>}
        {state === "short" && <span data-roster-cup-part="open" />}
    </>;
}
/**
 * A lane's day by month (#1568, A3.5): its mark, a cup (ruled 8 Nov 2026) filled from the bottom to its hours rostered
 * of those needed, full at them, in its parts' colours as the day's bar by week draws them — the agencies' requests on
 * top, solid — what a short day lacks open above them, dashed in the warning's edge on its wash; an empty cup with no
 * target. It says its difference where a day is wide enough and the figure fits the mark whole, never cut, and its
 * label always, after its hours, as a lane's day's does. A press selects its slot in its week (A3.8): a band's group's,
 * or the shift's day across the groups where the layout draws no bands, which the inspector then reads.
 */
const LaneMark = memo(function LaneMark({ ctx, rowKey, group, lane, week, day, figures: f, said }: {
    ctx: ViewContext; rowKey: string; group: Group | undefined; lane: DemandLane; week: Date; day: number; figures: DemandFigures;
    /** Whether the mark says its difference: a day 22px wide or wider. */
    said: boolean;
}) {
    const { styles, format } = ctx;
    const selection = useContext(SelectionContext);
    const shift = lane.shift.key, start = week.getTime();
    const slot = useMemo(() => group === undefined ? undefined : { day: BigInt(day), group: group.key, shift }, [group, day, shift]);
    // A selection names its week, the one the views then show (`start`): its day's mark in that week alone is selected.
    const selected = ctx.start.getTime() === start
        && (slot !== undefined ? selectedSlot(selection, slot) : selection?.type === "shiftDay" && selection.shift === shift && selection.day === day);
    const mark = laneMark(f), cup = laneCup(f);
    const when = `${lane.shift.label} · ${format.weekdayDate(new Date(start + day * DAY))}${group === undefined ? "" : ` · ${group.label}`}`;
    const figure = said && mark.state !== "off" ? signed(format.number, mark.difference) : "";
    return <chakra.button type="button" css={[styles.mark, styles.laneMark]} data-roster-lane-mark={`${rowKey}.${weekKey(week)}.${day}`} data-state={mark.state}
        data-selected={selected ? "" : undefined} aria-pressed={selected} style={cupStyle(cup)}
        aria-label={f.target ? `${when}: ${format.number(f.rostered)} of ${format.number(f.needed)} hours rostered${differenceSaid(format.number, mark.difference)}` : `${when}: no target`}
        onClick={() => ctx.select(slot !== undefined ? { type: "requirement", slot, start } : { type: "shiftDay", shift, day, start })}>
        {cupParts(cup, mark.state, false)}
        {figure !== "" && <span data-roster-mark-figure="">{figure}</span>}
    </chakra.button>;
});
/**
 * A lane's week by month (A3.5): its seven marks on the person marks' day columns — while the span is not read, a
 * placeholder each once the frame's reveal says so, and none where its read failed, as a person's week cell draws.
 */
const LaneWeek = memo(function LaneWeek({ ctx, row, week, w, said }: {
    ctx: ViewContext; row: Extract<DemandRow, { kind: "lane" }>; week: Date; w: number; said: boolean;
}) {
    const { styles, read } = ctx;
    const revealed = useRevealed() === true;
    return <Box css={styles.monthCell} data-roster-lane-week={`${row.key}.${weekKey(week)}`}>
        {read.state === "failed" ? null : <Box css={styles.markStrip}>
            {SEVEN_DAYS.map(day => read.state !== "held" ? (revealed ? <Box key={day} as="span" css={styles.mark} data-pending="" /> : null)
                : <LaneMark key={day} ctx={ctx} rowKey={row.key} group={row.group} lane={row.lane} week={week} day={day} figures={row.lane.days[w * 7 + day]!} said={said} />)}
        </Box>}
    </Box>;
});
/**
 * A lane by month (#1568, A3.2): its name cell — its chevron, the shift's swatch and its label, no figures (P16) — the
 * disclosure of its skill rows, then a cell a week.
 */
const MonthLaneRow = memo(function MonthLaneRow({ ctx, row, weeks, said, toggle, measure }: {
    ctx: ViewContext; row: Extract<DemandRow, { kind: "lane" }>; weeks: readonly WeekState[]; said: boolean; toggle: (lane: string) => void;
    measure: (el: HTMLElement | null) => void;
}) {
    const { styles, value } = ctx;
    const { lane } = row;
    return <Box ref={measure} css={styles.monthRow} data-roster-lane={row.key} data-roster-lane-group={row.group?.key} data-roster-lane-shift={lane.shift.key} data-density={value.settings.density.type}>
        <chakra.button type="button" css={[styles.laneName, styles.laneToggle]} aria-expanded={row.open} data-roster-lane-head="" data-period="month" onClick={() => toggle(row.key)}>
            <FontAwesomeIcon icon={faAngleRight} />
            <Box as="span" css={styles.laneSwatch} style={fillOf(lane.shift)} />
            <Box as="span" css={styles.laneLabel}>{lane.shift.label}</Box>
        </chakra.button>
        {weeks.map((held, w) => <LaneWeek key={held.start.getTime()} ctx={ctx} row={row} week={held.start} w={w} said={said} />)}
    </Box>;
});
/**
 * A skill row's week by month (A4.4): its seven marks as a lane's are, each a cup (ruled 8 Nov 2026) filled to the
 * hours assigned it of those needed, full at them, what a short day lacks open above them — an empty cup where none of
 * the day's slots needs the skill — none pressable, each its hours on hover, then the difference it states, as a
 * lane's day's label says it.
 */
const SkillWeek = memo(function SkillWeek({ ctx, row, week, w, said }: {
    ctx: ViewContext; row: Extract<DemandRow, { kind: "skill" }>; week: Date; w: number; said: boolean;
}) {
    const { styles, read, format, value } = ctx;
    const revealed = useRevealed() === true;
    const label = activityOf(value, row.skill.skill)?.label ?? row.skill.skill;
    return <Box css={styles.monthCell} data-roster-lane-skill-week={`${row.key}.${weekKey(week)}`}>
        {read.state === "failed" ? null : <Box css={styles.markStrip}>
            {SEVEN_DAYS.map(day => {
                if (read.state !== "held") return revealed ? <Box key={day} as="span" css={styles.mark} data-pending="" /> : null;
                const f = row.skill.days[w * 7 + day], mark = skillMark(f), cup = skillCup(f);
                const figure = said && mark.state !== "off" ? signed(format.number, mark.difference) : "";
                return <Box key={day} as="span" css={[styles.mark, styles.laneMark]} data-roster-lane-skill-mark={`${row.key}.${weekKey(week)}.${day}`} data-state={mark.state}
                    style={cupStyle(cup)}
                    title={f === undefined ? undefined : `${label} · ${format.weekdayDate(new Date(week.getTime() + day * DAY))}: ${format.number(f.assigned)} of ${format.number(f.needed)} hours assigned${differenceSaid(format.number, mark.difference)}`}>
                    {cupParts(cup, mark.state, true)}
                    {figure !== "" && <span data-roster-mark-figure="">{figure}</span>}
                </Box>;
            })}
        </Box>}
    </Box>;
});
/** A skill row by month (#1568, A4.2): its code tag and name, no figures (P16), then a cell a week. */
const MonthSkillRow = memo(function MonthSkillRow({ ctx, row, weeks, said, measure }: {
    ctx: ViewContext; row: Extract<DemandRow, { kind: "skill" }>; weeks: readonly WeekState[]; said: boolean; measure: (el: HTMLElement | null) => void;
}) {
    const { styles, value } = ctx;
    const activity = activityOf(value, row.skill.skill);
    return <Box ref={measure} css={styles.monthRow} data-roster-lane-skill={row.key} data-density={value.settings.density.type}>
        <Box css={styles.laneName} data-skill="">
            {activity?.code && <Box as="span" css={styles.skillTag}>{activity.code}</Box>}
            <Box as="span" css={styles.skillName}>{activity?.label ?? row.skill.skill}</Box>
        </Box>
        {weeks.map((held, w) => <SkillWeek key={held.start.getTime()} ctx={ctx} row={row} week={held.start} w={w} said={said} />)}
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
/**
 * The People grid by month (#1406, §8): a column a week touching the month, a row a person, a cell seven marks — and
 * with targets the work requirement over each band's people, or over everyone where it draws no bands, a mark a day
 * (#1568).
 */
function MonthGrid({ props, ctx }: { props: RosterViewsProps; ctx: ViewContext }) {
    const { collapsed, toggle } = useGroupCollapse(props.drag.surface);
    const list = usePeopleRows(props.value, collapsed);
    // The work requirement's rows over the month's weeks (#1568): each band's, or the one block over every group's, their lanes opened by the viewer.
    const demands = useDemands(props);
    const { open, toggle: toggleLane } = useOpenLanes(props.drag.surface);
    const people = useMemo(() => bandPeople(props.value), [props.value]);
    const rows = useMemo(() => withDemand(list, props.value, demands, people, gridDemand(open)), [list, props.value, demands, open, people]);
    // Each band's work requirement sticks under the header while its people scroll (A6).
    const sections = useMemo(() => demandSections(rows), [rows]);
    const weeks = props.weeks;
    const indexes = useMemo(() => weeks.map(held => peopleIndex(held.week, held.held)), [weeks]);
    const { floors, measured, measure } = useRowFloors(PEOPLE_FLOORS);
    const getItemKey = useCallback((i: number) => rows[i]!.key, [rows, floors]); // eslint-disable-line react-hooks/exhaustive-deps -- the floors re-key the places
    const estimateSize = useCallback((i: number) => { const row = rows[i]!; return row.kind !== "person" ? floors[row.kind] : row.person === undefined ? floors.requests : floors.person; }, [rows, floors]);
    // The letters show where a day is 13px or wider (P13), and a lane's figures where it is 22px or wider (A3.5): the
    // grid's width less the name column, over the weeks, over seven days.
    const [root, width] = useWidth();
    const dayWidth = width === 0 ? Infinity : ((width - 168) / Math.max(weeks.length, 1) - 4) / 7 - 2;
    const letters = ctx.letters && dayWidth >= 13;
    const said = dayWidth >= 22;
    const renderRow = useCallback((i: number) => {
        const row = rows[i]!;
        switch (row.kind) {
            case "group": {
                const demand = demands.get(row.group.key);
                return <GroupHeading scope="roster" group={row.group} styles={ctx.styles} collapsed={collapsed.includes(row.group.key)} toggle={toggle} measure={measure("group")}>
                    {demand !== undefined && <BandDemand ctx={ctx} demand={demand} people={people.get(row.group.key) ?? 0} />}
                </GroupHeading>;
            }
            case "demand": return <MonthDemandHead ctx={ctx} row={row} weeks={weeks} measure={measure("demand")} />;
            case "lane": return <MonthLaneRow ctx={ctx} row={row} weeks={weeks} said={said} toggle={toggleLane} measure={measure("lane")} />;
            case "skill": return <MonthSkillRow ctx={ctx} row={row} weeks={weeks} said={said} measure={measure("skill")} />;
            case "assign": return <AssignHead ctx={ctx} row={row} measure={measure("assign")} />;
            case "person": return <MonthRow ctx={ctx} row={row} index={i} rows={rows} weeks={weeks} indexes={indexes} letters={letters} measure={measure(row.person === undefined ? "requests" : "person")} />;
        }
    }, [rows, ctx, collapsed, toggle, weeks, indexes, letters, said, measure, demands, people, toggleLane]);
    const style = { "--roster-weeks": weeks.length } as CSSProperties;
    // The selected person-week's column is marked (D11); none without a selection.
    const picked = props.selection?.type === "personWeek" ? props.selection.start : undefined;
    // What the header shows of each week's label and of its days is what fits whole (R3): its recipe hides the rest.
    const head = useRef<HTMLDivElement>(null);
    const fit = useMonthHeadFit(head);
    const header = <Box ref={head} css={props.styles.monthRow} style={style} data-roster-month-head="" data-density={props.value.settings.density.type}
        data-week-label={fit.label} data-day-letters={fit.letters ? undefined : "off"} data-day-numbers={fit.numbers ? undefined : "off"}>
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
                header={header} sections={sections} count={rows.length} getItemKey={getItemKey} estimateSize={estimateSize} anchorable={ANCHOR_EVERY_ROW}
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
        data-conflict={ctx.conflicted(id) ? "" : undefined} data-bounds={ctx.bounded(id) ? "" : undefined}
        data-op={mark?.op} data-fill={mark === undefined ? undefined : "own"} title={mark?.provenance}>
        <chakra.button type="button" css={ctx.styles.cardHead} onClick={() => ctx.select({ type: "assignment", key: id })}><Box css={ctx.styles.cardTitle}>{assignmentName(ctx.value, assignment)}{removed && " · removed"}</Box></chakra.button>
        <Box css={ctx.styles.detail}>{`${ctx.format.time(assignment.start)}–${ctx.format.time(assignment.end)}`}{assignment.activity.type === "some" && ` · ${activityOf(ctx.value, assignment.activity.value)?.label ?? assignment.activity.value}`}</Box>
        {dutyIssues(ctx.issues, id).map((issue, i) => <Box key={i} css={ctx.styles.flag} data-tone={issue.tone.type}>{issue.title}</Box>)}
        <AssignmentActions id={id} assignment={assignment} removed={removed} value={ctx.value} start={ctx.start} commands={ctx.commands} styles={ctx.styles} />
    </Box>;
}
/**
 * The phone's People cards' estimate of each kind before one has mounted: a person's card is its seven days, each a
 * place action; the work requirement's eyebrow its seven day cards (#1568), each its head alone at the least.
 */
const AGENDA_FLOORS: Readonly<Record<RowKind, number>> = { group: 38, person: 360, requests: 60, demand: 560, lane: 36, skill: 36, assign: 28 };
/**
 * A person's card on a phone, or a group's requests' — or every group's, each group's under its name (#1567): drawn
 * again only as what it shows changes (#1398, CL9).
 */
const PersonCard = memo(function PersonCard({ ctx, row, index, rows, days, requests, measure }: {
    ctx: ViewContext; row: PersonRowValue; index: number; rows: readonly PeopleRow[]; days: WeekDays;
    /** The row's requests, in the week's order: what its card lists. */
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
    const card = ({ id, a, removed }: DayDuty) => <AssignmentCard key={id} ctx={ctx} id={id} assignment={a} removed={removed} />;
    return <Box ref={measure} css={styles.card} data-roster-person-card={person?.key ?? row.key}>
        {person === undefined ? <><Box css={styles.cardHead}><Box css={styles.cardTitle}>{value.vocabulary.requests}</Box></Box>
            {row.group !== undefined ? requests.map(card) : bandsOf(value.groups, noGroupBand(value)).map(group => {
                // Every group's requests in one card: each group's under its name, in the groups' order, then those in no group yet (#1548).
                const theirs = requests.filter(duty => (groupOf(duty.a) ?? NO_GROUP) === group.key);
                return theirs.length === 0 ? null : <Box key={group.key} css={styles.agendaGroup} data-roster-requests-group={group.key}><Box css={styles.detail}>{group.label}</Box>{theirs.map(card)}</Box>;
            })}</> : <>
            <chakra.button ref={head} type="button" css={styles.cardHead} data-roster-person-head={person.key} onClick={() => ctx.select({ type: "personWeek", key: person.key, start: start.getTime() })}>
                <Box css={styles.cardTitle} data-roster-card-hours="" data-opn={ctx.lit && ctx.optimised?.people.has(person.key) === true ? "" : undefined}>{person.name} · {format.number(ctx.hours.get(person.key) ?? 0)} / {format.number(person.contract)} h</Box></chakra.button>
            {/* A phone's `Apply pattern…` (#1406, P22): the Chooser over the patterns, its choice applied as a drop is. */}
            {value.patterns.length > 0 && <Box css={styles.actions}><ApplyPatternAction person={person} start={start} value={value} commands={commands} onError={ctx.onError} /></Box>}
            {SEVEN_DAYS.map(day => {
                const duties = days[day] ?? NO_DUTIES;
                return <Box key={day} css={styles.agendaGroup}><Box css={styles.detail}>{format.weekday(new Date(start.getTime() + day * DAY))}</Box>
                    {duties.map(card)}
                    {/* "Off · assign" places the person in their home group, with or without its band (#1567). */}
                    {!duties.some(duty => !duty.removed) && (commands.availableOn(BigInt(day)) || commands.locked !== undefined ? <PlaceAction label="Off · assign" source={{ type: "person", key: person.key }} place={{ day: BigInt(day), group: some(person.group), shift: person.usual.type === "some" ? person.usual.value : value.shifts[0]!.key }} value={value} start={start} commands={commands} styles={styles} /> : <Box css={styles.detail}>Off</Box>)}
                </Box>;
            })}
        </>}
    </Box>;
});
/** A card's head while the week is not read: the person's name, and a placeholder for their hours beside their contract. */
function UnreadCardHead({ ctx, person, index }: { ctx: ViewContext; person: Person | undefined; index: number }) {
    return <Box css={ctx.styles.cardHead}><Box css={ctx.styles.cardTitle}>{person?.name ?? ctx.value.vocabulary.requests}</Box>
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
/**
 * A lane's day on a phone's day card (#1568): the shift's swatch and label, then its figures over its bar — or `no
 * target` — one button that selects it as a lane's day in the grid does (A3.8).
 */
const LaneDayLine = memo(function LaneDayLine({ ctx, laneKey, group, lane, day }: {
    ctx: ViewContext; laneKey: string; group: Group | undefined; lane: DemandLane; day: number;
}) {
    const { selected, label, select } = useLaneDay(ctx, group, lane, day);
    return <chakra.button type="button" css={ctx.styles.demandShift} data-roster-lane-day={`${laneKey}.${day}`} data-roster-lane-shift={lane.shift.key}
        data-selected={selected ? "" : undefined} aria-pressed={selected} aria-label={label} onClick={select}>
        <Box as="span" css={ctx.styles.laneSwatch} style={fillOf(lane.shift)} />
        <Box as="span" css={ctx.styles.laneLabel}>{lane.shift.label}</Box>
        <LaneDayFigures ctx={ctx} lane={lane} day={day} />
    </chakra.button>;
});
/**
 * A day's card of the work requirement on a phone (#1568): its date and the day's hours rostered of needed, as the
 * grid's eyebrow says them, then a line a lane — the shift's figures that day.
 */
function DemandDayCard({ ctx, row, day }: { ctx: ViewContext; row: Extract<AgendaDemandRow, { kind: "demand" }>; day: number }) {
    const { styles, format, read, start } = ctx;
    const figures = row.demand.days[day]!;
    return <Box css={styles.card} data-roster-demand-card={`${row.key}.${day}`}>
        <Box css={styles.cardHead}>
            <Box css={styles.cardTitle}>{format.weekdayDate(new Date(start.getTime() + day * DAY))}</Box>
            <Box css={styles.detail} data-roster-demand-day={day}>
                {read.state !== "held" ? <Unread read={read} kind="number" index={day} /> : `${format.number(figures.rostered)} / ${format.number(figures.needed)} h`}</Box>
        </Box>
        {row.demand.lanes.map(lane => <LaneDayLine key={lane.shift.key} ctx={ctx} laneKey={demandKey("lane", row.group, lane.shift.key)} group={row.group} lane={lane} day={day} />)}
    </Box>;
}
/**
 * The work requirement on a phone (#1568), before a band's people's cards — or, where the layout draws no bands,
 * everyone's: its eyebrow, the vocabulary's heading and the week's hours rostered of needed, then a card a day holding
 * its shifts' figures.
 */
const DemandCards = memo(function DemandCards({ ctx, row, measure }: {
    ctx: ViewContext; row: Extract<AgendaDemandRow, { kind: "demand" }>; measure: (el: HTMLElement | null) => void;
}) {
    const { styles, format, read, value } = ctx;
    const { rostered, needed } = row.demand.total;
    return <Box ref={measure} css={styles.demandCards} data-roster-demand-cards={row.key}>
        <Box css={styles.demandCardsHead} data-roster-demand-head="">
            <Box as="span" data-roster-demand-heading="">{value.vocabulary.demand}</Box>
            <Box as="span" data-roster-demand-total="">{read.state !== "held" ? <Unread read={read} kind="number" index={0} /> : `${format.number(rostered)} / ${format.number(needed)} h`}</Box>
        </Box>
        {SEVEN_DAYS.map(day => <DemandDayCard key={day} ctx={ctx} row={row} day={day} />)}
    </Box>;
});
/**
 * The People layout on a phone (#1406, P31): a band a group, a card a person — and with targets the work requirement's
 * day cards before each band's people's cards, or before everyone's where it draws no bands (#1568).
 */
function PeopleAgenda({ props, ctx }: { props: RosterViewsProps; ctx: ViewContext }) {
    const { collapsed, toggle } = useGroupCollapse(props.drag.surface);
    const list = usePeopleRows(props.value, collapsed);
    // The work requirement's rows (#1568): each band's, or the one block over every group's, the lanes in its day cards.
    const demands = useDemands(props);
    const people = useMemo(() => bandPeople(props.value), [props.value]);
    const rows = useMemo((): readonly AgendaRow[] => withDemand(list, props.value, demands, people, cardDemand), [list, props.value, demands, people]);
    const index = useMemo(() => peopleIndex(props.week, props.held), [props.week, props.held]);
    const { floors, measured, measure } = useRowFloors(AGENDA_FLOORS);
    const getItemKey = useCallback((i: number) => rows[i]!.key, [rows, floors]); // eslint-disable-line react-hooks/exhaustive-deps -- the floors re-key the places
    const estimateSize = useCallback((i: number) => { const row = rows[i]!; return row.kind !== "person" ? floors[row.kind] : row.person === undefined ? floors.requests : floors.person; }, [rows, floors]);
    // A card drawn again only as what it shows changes: the same function while the rows, the week and the views hold (CL9).
    const renderRow = useCallback((i: number) => {
        const row = rows[i]!;
        switch (row.kind) {
            case "group": return <GroupHeading scope="roster" group={row.group} styles={ctx.styles} collapsed={collapsed.includes(row.group.key)} toggle={toggle} measure={measure("group")} />;
            case "demand": return <DemandCards ctx={ctx} row={row} measure={measure("demand")} />;
            case "assign": return <AssignHead ctx={ctx} row={row} measure={measure("assign")} />;
            case "person": {
                const days = row.person === undefined ? requestDays(index, row.group) : index.person.get(row.person.key);
                const requests = row.person !== undefined ? NO_DUTIES : row.group === undefined ? index.allRequestList : index.requestList.get(row.group.key) ?? NO_DUTIES;
                return <PersonCard ctx={ctx} row={row} index={i} rows={rows} days={days ?? NO_DAYS} requests={requests}
                    measure={measure(row.person === undefined ? "requests" : "person")} />;
            }
        }
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
        {days.map(day => <Box key={day} css={props.styles.agendaGroup}><Box css={props.styles.agendaHead} data-roster-agenda-heading="">{props.format.weekdayDate(new Date(props.start.getTime() + day * DAY))}</Box>
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
                {assignments(props, placeOf(slot)).map(({ id, a, removed }) => <AssignmentCard key={id} ctx={ctx} id={id} assignment={a} removed={removed} />)}
                {props.proposals.filter(p => sameSlot(p.slot, slot) && (props.value.visiblePeople.type === "none" || props.value.visiblePeople.value.has(p.person))).map(p => <ProposalCard key={p.key} props={props} proposal={p} />)}
                <SlotActions props={props} slot={slot} /><RequirementAction slot={slot} week={props.week} held={props.held} value={props.value} commands={props.commands} styles={props.styles} />
            </Box>; }))}
            {props.read.state === "held" && props.value.duty.roles.noGroup && props.value.shifts.map(shift => <NoGroupCard key={shift.key} props={props} ctx={ctx} day={day} shift={shift} />)}
        </Box>)}
    </Box></Box>;
}
/**
 * A shift's day's duties in no group yet, on a phone (#1548): a card after the groups' cards, drawn only where the day
 * holds some — No group has no action of its own; each duty's card moves it into a group. It says the hours rostered
 * there, whoever the rail shows.
 */
function NoGroupCard({ props, ctx, day, shift }: { props: RosterViewsProps; ctx: ViewContext; day: number; shift: Shift }) {
    const place: Place = { day: BigInt(day), group: none, shift: shift.key };
    const shown = assignments(props, place);
    const rostered = [...props.week.assignments.values()].filter(a => samePlace(a.place, place)).reduce((n, a) => n + a.hours, 0);
    if (shown.length === 0 && rostered === 0) return null;
    return <Box css={props.styles.card} data-roster-agenda-place={placeKey(place)}>
        <Box css={props.styles.cardHead}><Box css={props.styles.cardTitle}>{props.value.vocabulary.noGroup} · {shift.label}</Box></Box>
        <Box css={props.styles.detail}>{props.format.number(rostered)} h rostered</Box>
        {shown.map(({ id, a, removed }) => <AssignmentCard key={id} ctx={ctx} id={id} assignment={a} removed={removed} />)}
    </Box>;
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
