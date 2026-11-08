/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

/**
 * e3-ui's Roster renderer (#1369, `Builder Interfaces Spec.md` §5, §7, §9):
 * the app's own records — its duties, its weeks and its targets, a session
 * each of one history — read a week at a time and assembled into the week the
 * grid, the cards, the library, the inspector and the toolbar draw, drafts in
 * place; the app's pay asked a person at a time; Publish saving the week, then
 * writing its status. The duties' source of the slice holds the week's window,
 * which the Roster's own navigation writes. Search Records seeks the people by
 * their keys (`find.ts`, #1398): a pick selects the person, their People row
 * brought into view — one the rail's narrowing hides once the choices that hide
 * them are cleared — and the keyboard handed to their name; where the People
 * views rest is saved, and comes back as they mount. The span in view is a
 * week, or a month's four to six (#1406): each week assembled from the span's
 * rows, the week the inspector and the commands work over the selected
 * person-week's, or a work requirement's day's (#1568), or the selected
 * duty's, else the first; a month drawing the work requirement works out each
 * of its weeks' coverage, the hours alone. With an optimiser bound, the Elara eye
 * (#1409): one run over the week in view, its result landed on the week's
 * duties as one step of the history, and what it left on them marked until
 * Apply. BuilderFrame stays an internal React detail.
 *
 * @packageDocumentation
 */
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { Box, Button, useSlotRecipe } from "@chakra-ui/react";
import { ArrayType, StringType, equalFor, isVariant, none, some, variant, type option } from "@elaraai/east";
import { RosterComponent, RosterContextType, RosterIssueType } from "@elaraai/e3-ui/internal";
import {
    BannerView, BuilderFrame, SessionBanners, fieldBreachIssue, historyShortcut, implementUIComponent, optimiseMessages, takeKey, typedInto, useContainerBelow, useDataStable,
    useFormatters, useLanding, useLandingStyles, usePersistedState, useTrackedEvaluation, type BuilderFramePanes, type EditIssue, type HistoryAction,
} from "@elaraai/east-ui-components";
import { LoadingReveal, keptRead } from "@elaraai/east-ui-components/internal";
import { rowBreaches } from "../shared/bounds.js";
import { useOptimise } from "../shared/func/use-optimise.js";
import { useOptimiseParts } from "../shared/func/optimise-parts.js";
import { periodLoading, periodLoadingLine, periodRead, retryPeriod } from "../shared/loading.js";
import { FieldAskProvider, useFieldAsks } from "../shared/schedule/field-ask.js";
import { useSourceHidden } from "../shared/schedule/hidden.js";
import { useHiddenPick } from "../shared/schedule/hidden-pick.js";
import { useGroupCollapse } from "../shared/schedule/group-heading.js";
import { publishPeriod } from "../shared/schedule/records.js";
import { refusalText, scheduleRefusals } from "../shared/schedule/refusals.js";
import { useSourceWindow } from "../shared/schedule/source-window.js";
import { publishChange, rosterCommands } from "./actions.js";
import { RosterDataReader, initialRosterData, type RosterData } from "./data.js";
import { useRosterDrag } from "./drag.js";
import { PERIODS, TARGETS, useRosterEditing, type RosterEditing } from "./editing.js";
import { useRosterFind, type FoundPerson } from "./find.js";
import { sameFind, useRosterFit, type RosterFind } from "./fit.js";
import { RosterFooter } from "./footer.js";
import { useRosterInspector, type RosterRefusal } from "./inspector.js";
import { useRosterLibrary } from "./library.js";
import { rosterMessages, type RosterWords } from "./messages.js";
import {
    DAY, NARROW_WIDTH, NO_PAY, NO_PERIOD, RosterPayCache, availableProposals, compareDate, configError, dayOfSlot, editableStatus, groupOf, NO_GROUP, placeDrafted, placeStored, placeTargets,
    rosterContext, rosterDomain, selectionWeek, slotOfPlace, spanWindow, spanWords, started, statusText, weekBefore, weekKey, weekNumber, weekOf, weekStart, type Assignment, type Coverage,
    type DraftedDuty, type Issue, type PlacedDuties, type PlacedPeriod,
    type RosterPayload, type RosterStyles, type RosterValue, type Selection, type Slot, type StoredDuty, type StoredTarget, type WeekState,
} from "./model.js";
import { landRosterOptimise, lockRosterCommands, rosterOptimiseRequest, rosterOptimiseTypes, type RosterOptimiseRequest, type RosterOptimiseResult, type RosterOptimised } from "./optimise.js";
import { useRosterToolbar } from "./toolbar.js";
import { RosterViews, assignmentName, personOf, readRosterAnchor, type PeoplePick, type RosterAnchor } from "./views.js";
import { useRosterWindow, type RosterWindow } from "./window.js";
import { rosterPart, useRosterVisibility } from "./visibility.js";
import { sourcePart } from "../shared/schedule/visibility.js";
import { useSourceShown, type SourceShown } from "../shared/schedule/source-tab.js";
import type { KeyVisibility } from "../shared/schedule/visibility.js";
export type { RosterValue } from "./model.js";

/** Props of the record-backed Roster extension. */
export interface EastChakraRosterProps { value: RosterPayload; storageKey: string }
const NO_DATES: readonly Date[] = [];
const NO_DUTY_DRAFTS: ReadonlyMap<string, DraftedDuty | undefined> = new Map();
const NO_TARGET_DRAFTS: ReadonlyMap<string, StoredTarget | undefined> = new Map();
const NO_PERIOD_DRAFTS: ReadonlyMap<string, Uint8Array | undefined> = new Map();
const NO_STORED: ReadonlyMap<string, StoredDuty> = new Map();
const NO_STORED_TARGETS: ReadonlyMap<string, StoredTarget> = new Map();
const NO_ISSUES: readonly Issue[] = [];
/** No week of the span's coverage: a month drawing no work requirement. */
const NO_SPAN_COVERAGE: readonly ReadonlyMap<Slot, Coverage>[] = [];
const sameContext = equalFor(RosterContextType);
const sameIssues = equalFor(ArrayType(RosterIssueType));
/** No People view has rested anywhere yet. */
const NO_ANCHOR: RosterAnchor = {};
/** The viewer's display settings, as storage keeps them. */
const readRosterDisplay = keptRead.record({ density: keptRead.oneOf("compact", "comfortable"), chipSkills: keptRead.boolean, requirements: keptRead.boolean });
const keyEqual = equalFor(StringType);
/**
 * The frame's root takes the focus a click on a part of it holding nothing focusable gives — a pane's empty foot, the
 * toolbar's gaps — so the keyboard is in the Roster, never the page's body, as the Calendar's is: not a tab stop.
 */
const CLICK_FOCUS: Readonly<Record<string, string>> = { tabIndex: "-1" };

/** What the frame takes from the Roster around it: the payload as read, the week, the narrowing, and the editing. */
interface FrameProps {
    source: RosterPayload; value: RosterValue; storageKey: string; window: RosterWindow;
    visibility: KeyVisibility; activities: KeyVisibility; patterns: KeyVisibility; shown: { people: SourceShown; activities: SourceShown; patterns: SourceShown };
    display: { density: "compact" | "comfortable"; chipSkills: boolean; requirements: boolean };
    setDisplay: (next: { density: "compact" | "comfortable"; chipSkills: boolean; requirements: boolean }) => void;
    /** Why the week's window could not be written to the duties' source. */
    rangeError: string | undefined;
    /** Told whether main is narrower than a phone: the window, which the frame's reads follow, holds People to a week there (P31). */
    onNarrow: (narrow: boolean) => void;
    editing: RosterEditing | undefined;
}

/** The week's own row, read: its status and what it dismissed. */
function periodOf(source: RosterPayload, bytes: Uint8Array | undefined): PlacedPeriod {
    if (bytes === undefined || source.periods.type !== "some") return NO_PERIOD;
    return { bytes, status: source.periods.value.status(bytes), dismissed: source.periods.value.dismissed(bytes) };
}

/** The sole editable wrapper: a read-only Roster never creates a record session. */
function EditableRoster(props: Omit<FrameProps, "editing">) {
    const { source } = props;
    // Each record's Save notice counts what leaves its own source's narrowing: the duties', and the targets' where the slice narrows them.
    const recordSlices = useMemo(() => [source.duty.kind.key, "targets"].flatMap(name => {
        const part = sourcePart(source.slice.type === "some" ? source.slice.value : undefined, name);
        return part === undefined ? [] : [part];
    }), [source]);
    const editing = useRosterEditing(props.value, props.storageKey, props.window.span, recordSlices);
    return <RosterFrame {...props} editing={editing} />;
}

function RosterFrame(props: FrameProps) {
    const { source, value, storageKey: key, window, visibility, activities, editing } = props;
    const { span } = window;
    const [pickerDates, setPickerDates] = useState(NO_DATES);
    const domain = rosterDomain(source.duty.rowType);
    // Every person and activity, kept while its data holds: a payload built again asks the pay nothing again.
    const context = useDataStable(useMemo(() => rosterContext(source), [source]), sameContext);
    // Each read's duties placed once: the reader asks whether the week holds any, and the frame draws them.
    const placed = useRef<{ context: unknown; by: Map<number, WeakMap<ReadonlyMap<string, StoredDuty>, PlacedDuties>> }>({ context: undefined, by: new Map() });
    const place = useCallback((duties: ReadonlyMap<string, StoredDuty>, at: Date): PlacedDuties => {
        if (!Object.is(placed.current.context, context)) placed.current = { context, by: new Map() };
        let byDuties = placed.current.by.get(at.getTime());
        if (byDuties === undefined) { byDuties = new WeakMap(); placed.current.by.set(at.getTime(), byDuties); }
        let got = byDuties.get(duties);
        if (got === undefined) { got = placeStored(domain, duties, at, context); byDuties.set(duties, got); }
        return got;
    }, [domain, context]);
    const holds = useCallback((duties: ReadonlyMap<string, StoredDuty>) => place(duties, span.start).assignments.size > 0, [place, span.start]);
    const [data, setData] = useState<RosterData>(() => initialRosterData(span));
    const current = data.ready && compareDate(data.start, span.start) === 0 && data.weeks.length === span.weeks.length;
    const periodDrafts = editing?.periods ?? NO_PERIOD_DRAFTS;
    const dutyDrafts = editing?.duties ?? NO_DUTY_DRAFTS, targetDrafts = editing?.targets ?? NO_TARGET_DRAFTS;
    // Each week of the span, assembled from the span's rows with its drafts in place (#1406): one for a week in view, a
    // month's four to six — what the month's cells draw, and what a pattern dropped on one of them applies to.
    const weekStates = useMemo((): WeekState[] => span.weeks.map(at => {
        const stored = place(current ? data.duties : NO_STORED, at);
        const drafted = placeDrafted(domain, stored, dutyDrafts, at, context);
        const heldTargets = placeTargets(current ? data.targets : NO_STORED_TARGETS, NO_TARGET_DRAFTS, at, source);
        const targets = placeTargets(current ? data.targets : NO_STORED_TARGETS, targetDrafts, at, source);
        const id = weekKey(at);
        const heldPeriod = periodOf(source, current ? data.periods.get(at) : undefined);
        const period = periodDrafts.has(id) ? periodOf(source, periodDrafts.get(id)) : heldPeriod;
        return { start: at, week: weekOf(drafted, targets, period), held: weekOf(stored, heldTargets, heldPeriod), duties: drafted, heldDuties: stored, targets, period, heldPeriod };
    }), [span.weeks, current, data.duties, data.targets, data.periods, place, domain, dutyDrafts, targetDrafts, periodDrafts, context, source]);
    const [selection, setSelection] = useState<Selection>();
    // The week the inspector, the commands and the checks work over: the selected person-week's in a month (D11), or the
    // week of the work requirement's day selected there (#1568), else the selected duty's — as drafted, else as stored: a
    // day pressed in a person's Details, in a Month with no Week, selects a duty of any of its weeks — else the span's first.
    const pickedStart = selectionWeek(selection);
    const pickedDuty = selection?.type === "assignment" ? selection.key : undefined;
    const primary = (pickedStart !== undefined ? weekStates.find(held => held.start.getTime() === pickedStart)
        : pickedDuty === undefined ? undefined
            : weekStates.find(held => held.week.assignments.has(pickedDuty)) ?? weekStates.find(held => held.held.assignments.has(pickedDuty))) ?? weekStates[0]!;
    const { start, week, held, duties: draftedDuties, heldDuties: storedDuties, targets, period, heldPeriod } = primary;
    const previous = useMemo(() => current && data.previous !== undefined ? place(data.previous, weekBefore(start)) : undefined, [current, data.previous, place, start]);
    const [tab, setTab] = useState("details");
    const [libraryTab, setLibraryTab] = useState<string>();
    // A Find fix's question: its need on its issue's slot, which the People tab shows the app's fit's answer to (#1334).
    const [find, setFind] = useState<RosterFind>();
    const [error, setError] = useState<string>();
    const root = useRef<HTMLDivElement>(null), main = useRef<HTMLDivElement>(null);
    // The frame's panes, as the Roster's own controls open them: a selection's Details, the issues chip's Issues, a Find fix's People.
    const panes = useRef<BuilderFramePanes>(null);
    const narrow = useContainerBelow(main, NARROW_WIDTH);
    const { onNarrow } = props;
    useLayoutEffect(() => { onNarrow(narrow); }, [narrow, onNarrow]);
    // The week a selection was made in (#1406, P12, P24): a span that still holds it — Week opened from the month's
    // cell, column or Details — keeps the selection; another clears it, as another week does.
    const startRef = useRef(start); startRef.current = start;
    const selectedIn = useRef<Date>(start);
    const select = useCallback((next: Selection | undefined) => {
        const named = selectionWeek(next);
        selectedIn.current = named !== undefined ? new Date(named) : startRef.current;
        setSelection(next); setTab("details"); if (next !== undefined) panes.current?.reveal("end");
    }, []);
    const spanKey = `${span.start.getTime()}:${span.weeks.length}`;
    const lastSpan = useRef(spanKey);
    // Another span: its own selection, and no find — a find is its issue's, in the week it was asked of.
    useEffect(() => {
        if (lastSpan.current === spanKey) return;
        lastSpan.current = spanKey;
        if (!span.weeks.some(week => compareDate(week, selectedIn.current) === 0)) { setSelection(undefined); setError(undefined); setFind(undefined); }
    }, [spanKey, span]);
    const recipe = useSlotRecipe({ key: "rosterBuilder" });
    const styles = useMemo(() => recipe({}) as unknown as RosterStyles, [recipe]);
    // The Roster's words: its message table — the editing session's, and what its line says of a person the rail hides.
    const format = useFormatters(), words = useMemo((): RosterWords => ({ ...format, m: rosterMessages }), [format]);
    // The app's pay, a person at a time (§5.6, B17): asked again only for the people a change touched.
    const payCache = useRef(new RosterPayCache());
    const weekPay = useMemo(() => source.pay.type === "some" ? payCache.current.run(domain, source.pay.value, week, start, context) : NO_PAY, [source.pay, domain, week, start, context]);
    const coverage = useMemo(() => domain.coverage(week, context, weekPay.pay), [domain, week, context, weekPay]);
    // What the People layout's work requirement sums (#1568): a week's coverage, or each of a month's weeks' — their hours
    // alone, so no week but the one the inspector reads asks the app's pay — while the month draws it.
    const demanded = value.settings.requirements && value.targets.type === "some";
    const spanCoverage = useMemo((): readonly ReadonlyMap<Slot, Coverage>[] => span.period !== "month" ? [coverage]
        : demanded ? weekStates.map(state => domain.coverage(state.week, context, NO_PAY.pay)) : NO_SPAN_COVERAGE, [span.period, coverage, demanded, weekStates, domain, context]);
    const hours = useMemo(() => domain.hours(week, context), [domain, week, context]);
    const builtIn = useMemo(() => domain.check(week, context), [domain, week, context]);
    // Each duty's row checked against its form's bounds (#1585), once a row's bytes: a duty breaking one wears the warn
    // ring, stored or changed, and a stored duty's breach is a warning among the week's issues, holding no Save — a
    // changed duty's is the refusal its session's readiness raises, which holds Save.
    const dutyKind = source.duty.kind.key, dutyFields = source.duty.kind.fields;
    const breachesOf = useMemo(() => rowBreaches(dutyFields, domain.rowType), [dutyFields, domain]);
    const boundedDuties = useMemo(() => {
        const out = new Set<string>();
        for (const held of weekStates) for (const [id, row] of held.duties.rows) if (breachesOf(row.bytes).length > 0) out.add(id);
        return out;
    }, [weekStates, breachesOf]);
    const bounded = useCallback((id: string) => boundedDuties.has(id), [boundedDuties]);
    const refused = scheduleRefusals(editing?.schedule.sessions ?? []);
    const storedBreaches = useDataStable([...draftedDuties.rows].flatMap(([id, row]): Issue[] => {
        const a = week.assignments.get(id);
        if (a === undefined) return [];
        // A duty in no group yet stands in no slot, and names its shift alone (#1548).
        const slot = slotOfPlace(a.place);
        const shift = value.shifts.find(s => keyEqual(s.key, a.place.shift))?.label ?? a.place.shift;
        return breachesOf(row.bytes).flatMap((breach): Issue[] => refused.some(({ kind, issue }) => keyEqual(kind, dutyKind) && keyEqual(issue.entry, id)
            && issue.field.type === "some" && keyEqual(issue.field.value, breach.key)) ? [] : [{
            kind: variant("breach", null), tone: variant("warning", null),
            title: `${assignmentName(value, a)} · ${refusalText(fieldBreachIssue(breach, { entry: id }), dutyFields)}`,
            detail: slot === undefined ? shift : `${value.groups.find(g => keyEqual(g.key, slot.group))?.label ?? slot.group} · ${shift}`,
            slot: slot === undefined ? none : some(slot), assignment: some(id), flag: none, fix: none,
        }]);
    }), sameIssues);
    const proposals = useMemo(() => availableProposals(value, week, start), [value, week, start]);
    // The app's check over the complete draft, given the pay (§5.8).
    const readCheck = useCallback(() => source.check.type === "some"
        ? source.check.value(domain.encodeCheckContext({ start, week, context, coverage, pay: weekPay.pay })) : [], [source.check, domain, start, week, context, coverage, weekPay]);
    const custom = useTrackedEvaluation(readCheck);
    // The week's issues, the same array while what they say holds: what the grid draws from them draws again only as
    // they change (#1398, CL9).
    const customIssues = custom.result.ok ? custom.result.value : NO_ISSUES;
    const allIssues: readonly Issue[] = useMemo(() => [...builtIn, ...storedBreaches, ...draftedDuties.unplaced, ...customIssues, ...proposals.map(p => ({ kind: variant("proposal", null), tone: variant("info", null),
        title: `${personOf(value, p.person)?.name ?? p.person} · proposed`, detail: p.reason, slot: some(p.slot), assignment: none, flag: none, fix: some(variant("accept", p.key)) }))],
        [builtIn, storedBreaches, draftedDuties.unplaced, customIssues, proposals, value]);
    // A week not read gives no issue: a gap of a week whose duties are not read yet is no gap (#1398, CL13).
    const { layout, period: viewPeriod } = window.view;
    const issues = useMemo(() => current ? allIssues.filter(i => layout === "people" || viewPeriod === "week" || i.slot.type === "none" || Number(i.slot.value.day) === window.day) : NO_ISSUES,
        [current, allIssues, layout, viewPeriod, window.day]);
    // The app's fit (#1334): a Find fix asks it who fits over the complete staff, and the People tab shows its answer.
    const fit = useRosterFit(value, start, week, context, coverage, find);
    const { error: fitError, retry: retryFit, pending: finding } = fit;
    const findFix = useCallback((next: RosterFind) => {
        setFind(next); setLibraryTab("people"); panes.current?.open("start");
        // Pressed again after the fit failed, a find is asked again.
        if (fitError !== undefined) retryFit();
    }, [fitError, retryFit]);
    const isFinding = useCallback((asked: RosterFind) => finding && find !== undefined && sameFind(find, asked), [finding, find]);
    // Publish (B7): Save, then once every record reads back as saved, the week's status — over its row as last saved. The
    // week is the one shown as Publish is pressed: a week stepped to while the Save settles is not the one published.
    const [publishing, setPublishing] = useState(false);
    const publishingNow = useRef(false);
    const latest = useRef({ change: () => undefined as ReturnType<typeof publishChange> });
    latest.current = { change: () => editing === undefined ? undefined : publishChange(source, editing, start, current ? data.periods.get(start) : undefined, new Date()) };
    const publish = useCallback(() => {
        if (editing === undefined || publishingNow.current) return;
        publishingNow.current = true; setPublishing(true);
        const { change } = latest.current;
        void publishPeriod(editing.history, change, changes => editing.schedule.record(changes, "typed", "Publish week"))
            .finally(() => { publishingNow.current = false; setPublishing(false); });
    }, [editing]);
    // A narrowing read while the week it filters stands in keeps the week's rows, stale (#1398, CL5): their words in the
    // third ink, their rules dashed. While the people's narrowing is read or failed, or the week stands in, its rows are
    // retained (CL8): readable, focusable and selectable, aria-disabled, and every editing gesture — a drag, a drop, an
    // action — off until it lands.
    const stale = current && (visibility.loading || activities.loading);
    const retained = stale || visibility.loading || visibility.error !== undefined;
    // Commands update the selected item without changing the user's pane/tab.
    // Only an explicit inspection click uses `select` to reveal Details. The same commands while the week, its reads and
    // its editing hold (#1398, CL9); while main is retained they refuse every gesture, its controls kept in place.
    const ready = current && !publishing && !visibility.loading && visibility.error === undefined;
    const unlocked = useMemo(() => rosterCommands({
        value, start, context, week, held, duties: draftedDuties, heldDuties: storedDuties, previous, targets, period, heldPeriod, weeks: weekStates,
        read: [data.duties, ...(data.previous === undefined ? [] : [data.previous])], readTargets: data.targets, editing, ready, retained,
    }, setSelection, findFix, publish), [value, start, context, week, held, draftedDuties, storedDuties, previous, targets, period, heldPeriod, weekStates, data.duties, data.previous,
        data.targets, editing, ready, retained, findFix, publish]);
    // The app's optimiser (#1409, #1421): one run over the week in view, its result landed on the week's duties as one
    // edit, and what it left on them until Apply — the landing and the highlight over the whole frame.
    const landing = useLanding(root);
    const landingStyles = useLandingStyles();
    const optimiseTypes = useMemo(() => rosterOptimiseTypes(domain.rowType), [domain]);
    const [optimised, setOptimised] = useState<RosterOptimised | undefined>(undefined);
    const landAfter = useRef<(run: number) => void>(() => undefined);
    const latestRun = useRef({ week, start, context, editing, optimised });
    latestRun.current = { week, start, context, editing, optimised };
    // The week, as the eye, the footer line and the banner name it (#1409): `W11`.
    const weekLabel = `W${format.number(weekNumber(start))}`;
    const run = useOptimise<RosterOptimiseRequest, RosterOptimiseResult>({
        name: source.optimise.type === "some" ? source.optimise.value.name : null,
        requestType: optimiseTypes.request, resultType: optimiseTypes.result, scope: weekKey(start), storageKey: key,
        onLanded: (result, request, n) => {
            const now = latestRun.current;
            if (now.editing === undefined) return undefined;
            const runText = format.number(n);
            const landed = landRosterOptimise({ value, domain, editing: now.editing, request, result, label: optimiseMessages.step({ run: runText }), runText,
                week: now.week, start: now.start, context: now.context, format, before: now.optimised });
            if (landed === undefined) return undefined;
            // A run that changed nothing leaves what earlier runs left (R10).
            if (landed.optimised !== undefined) { setOptimised(landed.optimised); landAfter.current(n); }
            return landed.counts;
        },
    });
    // While a run is out (R2) the week takes no gesture: every command refused with the one reason, the drags off, the history locked.
    const locked = run.running;
    const commands = useMemo(() => locked ? lockRosterCommands(unlocked, optimiseMessages.locked({ period: weekLabel })) : unlocked, [locked, unlocked, weekLabel]);
    // The eye is listed only where the week can be optimised (ruled 25 Oct 2026): never read only, never in Month —
    // a run is one week's — and never over a published week; while the week's reads are in flight it waits, disabled.
    const optimiseParts = useOptimiseParts<RosterOptimiseRequest>({
        run, landing, period: weekLabel,
        readOnly: value.settings.readOnly || editing === undefined || span.period === "month" || (current && (!editableStatus(heldPeriod.status) || !editableStatus(week.status))),
        busy: !unlocked.available,
        request: n => rosterOptimiseRequest(latestRun.current.start, latestRun.current.week, latestRun.current.context, n), landKey: week,
    });
    landAfter.current = optimiseParts.landAfter;
    // What a run left on the duties goes with the drafts (R17): once nothing is pending — Save, Discard — nothing is
    // marked. An Undo leaves nothing pending too, but its Redo brings the run's step back (R9): what the run left is
    // kept while that step is the next to redo.
    const pendingSteps = editing?.history.pending ?? 0;
    useEffect(() => {
        if (pendingSteps === 0 && editing?.history.redoOrigin !== "optimise") setOptimised(undefined);
    }, [pendingSteps, editing?.schedule.version, editing]);
    const drag = useRosterDrag({ value, commands, week, duties: draftedDuties, weeks: weekStates, context, storageKey: key, narrow, start, format, onError: setError });
    // The groups' folds, the board's and the People layout's: what a conflict's Go to opens.
    const groups = useGroupCollapse(drag.surface);
    const dutyPart = sourcePart(source.slice.type === "some" ? source.slice.value : undefined, source.duty.kind.key);
    // What the footer's loading line says (#1398, CL3): the week being read, the people's or the activities' new
    // narrowing, or why one could not be read, with Retry — the week's asking again each record the week reads.
    const retryWeek = useCallback(() => retryPeriod([{ entries: source.duty.kind.entries, part: dutyPart },
        ...(source.periods.type === "some" ? [{ entries: source.periods.value.entries }] : []),
        ...(source.targets.type === "some" ? [{ entries: source.targets.value.entries, part: sourcePart(source.slice.type === "some" ? source.slice.value : undefined, "targets") }] : [])]),
        [source, dutyPart]);
    // The span's words (#1406, P28): `12–18 Mar` for a week, `W10–W14` for a month.
    const weekWords = spanWords(format, span);
    const line = useMemo(() => periodLoadingLine(periodLoading({ loading: data.loading, error: data.error, retry: retryWeek },
        [{ noun: "people", ...visibility }, { noun: "activities", ...activities }, { noun: "patterns", ...props.patterns }]), weekWords),
        [data.loading, data.error, retryWeek, visibility, activities, props.patterns, weekWords]);
    // What the views draw of the week (#1398): the week as read; a week not read yet, its geometry at once and its
    // placeholders, unseen until the frame's one reveal clock says so (CL5, CL2, CL4: `LoadingReveal` below, which the
    // footer's line and each placeholder read where they show, so its flip renders them and never this frame); or one
    // whose read failed, its geometry and the failure said once in its first row in view (CL11) — never "Roster
    // unavailable" over the grid.
    const read = useMemo(() => periodRead({ current, error: data.error, name: weekWords, retry: retryWeek }), [current, data.error, weekWords, retryWeek]);
    // Where the People views rest (#1398): saved under the Roster's key, so each comes back to it as it mounts.
    const { state: anchor, setState: setAnchor } = usePersistedState<RosterAnchor>(`${key}.anchor`, NO_ANCHOR, readRosterAnchor);
    const onAnchor = useCallback((next: Partial<RosterAnchor>) => setAnchor(was => ({ ...was, ...next })), [setAnchor]);
    // A duty holding a conflict not yet chosen wears the warn ring: asked again as the history moves, which every choice
    // and every carry-over moves.
    const schedule = editing?.schedule;
    const scheduleVersion = schedule?.version;
    const conflicted = useCallback((id: string) => schedule?.conflicted(dutyKind, id) === true,
        // eslint-disable-next-line react-hooks/exhaustive-deps -- the sessions are mutable: the history's version says they moved
        [schedule, scheduleVersion, dutyKind]);
    const viewProps = { value, week, held, start, day: window.day, view: window.view, setView: window.setView, span, weeks: weekStates, openWeek: window.openWeek, opensDay: window.opensDay, opensWeek: window.opensWeek,
        styles, format, narrow, coverage, spanCoverage, hours, pay: weekPay.pay, domain, issues, proposals, selection, select, commands, drag, onError: setError, read, optimised,
        lit: landing.lit, conflicted, bounded };
    // Search Records (#1398): a person found by their key is selected — in the People layout their row brought into view
    // once the narrowing draws it, and a pick's person given the keyboard there, once the box has let it go: their name
    // takes the focus as ↑ / ↓ give it. One the rail's narrowing hides is shown by clearing just the choices of the
    // people's source that hide them, and given the keyboard once the narrowing they leave holds them (the shared hidden
    // pick).
    const [picked, setPicked] = useState<PeoplePick>();
    const shownPeople = value.visiblePeople;
    const pick = useHiddenPick<string>({
        onError: setError, uncleared: "The filters hiding the person could not be cleared",
        landing: {
            drawn: (key) => !visibility.loading && (shownPeople.type === "none" || shownPeople.value.has(key)),
            focus: (key) => setPicked(was => ({ key, seq: (was?.seq ?? 0) + 1 })),
        },
    });
    const peopleHidden = useSourceHidden("Roster", useMemo(() => rosterPart(source, "people"), [source]));
    const found = useRosterFind({ people: value.people, visible: value.visiblePeople, settled: !visibility.loading, groups: value.groups,
        hidden: peopleHidden, words, onPick: (person: FoundPerson) => {
            pick.pick(person.hidden, person.person.key, () => { select({ type: "person", key: person.person.key }); });
        } });
    const search = useMemo(() => (found === undefined ? undefined : pick.search(found)), [found, pick]);
    const library = useRosterLibrary({ ...viewProps, storageKey: key, tab: libraryTab, onTab: setLibraryTab,
        find: find === undefined ? undefined : { need: find.need, shown: fit.shown, busy: finding }, onClearFind: () => setFind(undefined), shown: props.shown });
    const onIssues = () => { setTab("issues"); panes.current?.open("end"); };
    const history = editing?.history;
    const { acted } = optimiseParts;
    // The history's acts: a field typed into lets go first, committing what it holds — the history's buttons take no
    // focus from it. Anything else keeps the focus, the board or a duty on it, so the next key — a Redo after an Undo —
    // reaches the frame too, never the page.
    const onAction = useCallback((action: HistoryAction) => {
        if (locked) return;
        const active = document.activeElement; if (active instanceof HTMLElement && typedInto(active)) active.blur();
        // A run's highlight ends with Undo, Apply and Discard; a Redo of its step replays its landing (R9, R16).
        acted(action, history?.redoOrigin);
        history?.act(action);
    }, [history, locked, acted]);
    // The keyboard stays on the board as what it was on goes, as the Calendar's does: Delete on the duty or the proposal the
    // focus is on — its chip, its tile, its card — and the board takes the focus, never the page's body, where the history's
    // keys, the Undo that brings it back, go unheard. A saved duty stays, its tombstone, and the focus with it.
    const keepOnBoard = (kind: "assignment" | "proposal", key: string) => {
        if (kind === "assignment" && held.assignments.has(key)) return;
        const board = main.current;
        const active = board?.ownerDocument.activeElement;
        if (board === null || !(active instanceof HTMLElement) || !board.contains(active)) return;
        const attribute = kind === "assignment" ? "data-roster-assignment" : "data-roster-proposal";
        const on = active.closest(`[${attribute}]`)?.getAttribute(attribute);
        if (on !== null && on !== undefined && keyEqual(on, key)) board.focus({ preventScroll: true });
    };
    // A duty of a week not in view, as its draft holds it — its draft removing it, as their save left it — placed in its
    // own week: what a conflict's card names it by, and where its Go to goes. Its start stands up to twelve hours from its
    // shift's on a day of its week, so the week either side of it may hold it.
    const sunday = value.settings.weekStart.type === "sunday";
    const elsewhere = (key: string): { readonly start: Date; readonly a: Assignment } | undefined => {
        let duty = dutyDrafts.get(key);
        if (duty === undefined) {
            const theirs = editing?.schedule.sessions.find((held) => held.kind === source.duty.kind.key)?.session.conflicts.get(key)?.source;
            const row = theirs?.type === "some" && isVariant(theirs.value) && theirs.value.type === "value" ? theirs.value.value : undefined;
            if (row === undefined) return undefined;
            const bytes = domain.encodeRow(row);
            duty = { bytes, roles: source.duty.read(bytes, key), row };
        }
        for (const at of [duty.roles.start.getTime() - DAY / 2, duty.roles.start.getTime() + DAY / 2]) {
            const from = weekStart(new Date(at), sunday);
            const placement = domain.placement(duty.roles, duty.row, key, from, context);
            if (placement.type === "placed") return { start: from, a: placement.value };
        }
        return undefined;
    };
    /** A session's issue's place: a duty by whose it is, a week's or a target's row as it stands. */
    const where = (kind: string) => (issue: { entry: string }) => {
        const found = dutyOf(kind, issue.entry);
        return found === undefined ? issue.entry : assignmentName(value, found.a);
    };
    // A conflict's item in the history bar's popover, named as its session's banners name its issues.
    const historyWhere = (issue: EditIssue) => {
        const key = history?.sourceOf(issue);
        const part = key === undefined ? undefined : editing?.schedule.sessions.find((held) => keyEqual(held.key, key));
        return part === undefined ? issue.entry : where(part.kind)(issue);
    };
    // A Go to into another week: its duty, selected once that week's duties are read — another week clears a selection.
    // The reader moving to a span without its week drops it.
    const [going, setGoing] = useState<{ readonly key: string; readonly week: Date }>();
    useEffect(() => {
        if (going === undefined) return;
        if (!span.weeks.some((at) => compareDate(at, going.week) === 0)) { setGoing(undefined); return; }
        if (!current) return;
        setGoing(undefined);
        select({ type: "assignment", key: going.key });
    }, [going, span, current, select]);
    /**
     * A duty of a session's, where its draft places it: in the week in view, else in its own week (`there`) — a duty its
     * draft moved out of the week is named, and gone to, where it now stands. One its draft removes, or holds where the
     * Roster can't place it, is where the record holds it. `undefined` for none of these.
     */
    const dutyOf = (kind: string | undefined, entry: string): { readonly a: Assignment; readonly there: ReturnType<typeof elsewhere> } | undefined => {
        if (kind === undefined || !keyEqual(kind, dutyKind)) return undefined;
        const here = week.assignments.get(entry);
        if (here !== undefined) return { a: here, there: undefined };
        const moved = dutyDrafts.get(entry) === undefined ? undefined : elsewhere(entry);
        if (moved !== undefined) return { a: moved.a, there: moved };
        const stored = held.assignments.get(entry);
        if (stored !== undefined) return { a: stored, there: undefined };
        const there = elsewhere(entry);
        return there === undefined ? undefined : { a: there.a, there };
    };
    // The field a refusal gone to names, asked of its duty's form: ringed there, it takes the keyboard as the form draws
    // it, and so comes into view (`../shared/schedule/field-ask.tsx`).
    const fieldAsks = useFieldAsks();
    // A duty shown on its day and selected, as its issue's click in the Issues tab does — in its own week, where it is a
    // duty of another: a conflict's Go to, a refusal pressed, and the warning button's first issue (#1525), whose field
    // (`field`) its form gives the keyboard. In Month, which draws no one duty, its week in Week (P24), the duty selected
    // once that week is read; with Week not offered the month holding its week stays, and its person's week is selected.
    // A week's or a target's, a duty the Roster can't place, or a request's in a Month with no Week, opens the Issues tab.
    const goTo = (kind: string | undefined, entry: string, field: option<string> = none) => {
        const found = dutyOf(kind, entry);
        if (found === undefined) { onIssues(); return; }
        const { a, there } = found;
        const at = there?.start ?? start;
        const date = at.getTime() + Number(a.place.day) * DAY;
        // Its group opened where it is folded: its shift's on the board — No group's band for a duty in none (#1548) — its
        // person's in the People layout.
        groups.open(groupOf(a) ?? NO_GROUP);
        const person = a.who.type === "person" ? value.people.find((p) => keyEqual(p.key, a.who.value)) : undefined;
        if (person !== undefined) groups.open(person.group);
        const month = window.view.period === "month";
        if (month && !window.opensWeek) {
            if (person === undefined) { onIssues(); return; }
            // Its day moves the month only to bring its week into view: a day of a week that starts in the month before would move it.
            if (!span.weeks.some((week) => compareDate(week, at) === 0)) window.setView({ ...window.view, date });
            select({ type: "personWeek", key: person.key, start: at.getTime() });
            return;
        }
        window.setView({ ...window.view, period: month ? "week" : window.view.period, date });
        fieldAsks.request(dutyKind, entry, field);
        if (there === undefined && !month) select({ type: "assignment", key: entry });
        else setGoing({ key: entry, week: at });
    };
    const onConflict = (issue: EditIssue) => {
        const key = history?.sourceOf(issue);
        goTo(key === undefined ? undefined : editing?.schedule.sessions.find((held) => keyEqual(held.key, key))?.kind, issue.entry);
    };
    const onIssue = (issue: EditIssue) => {
        const key = history?.sourceOf(issue);
        goTo(key === undefined ? undefined : editing?.schedule.sessions.find((held) => keyEqual(held.key, key))?.kind, issue.entry, issue.field);
    };
    // Each refusal holding Save, of every week's drafts, in the Roster's words (#1525): a duty by its person, day and shift,
    // or by its key for one the Roster can't place, and its field by its form's label.
    const refusals = refused.map(({ kind, issue }): RosterRefusal => {
        const found = dutyOf(kind, issue.entry);
        const shift = found === undefined ? undefined : value.shifts.find((s) => keyEqual(s.key, found.a.place.shift));
        return { kind, issue,
            title: found === undefined ? issue.entry
                : `${assignmentName(value, found.a)} · ${format.weekdayDate(dayOfSlot(found.there?.start ?? start, found.a.place))} · ${shift?.label ?? found.a.place.shift}`,
            text: refusalText(issue, keyEqual(kind, dutyKind) ? dutyFields : []) };
    });
    const inspector = useRosterInspector({ ...viewProps, storageKey: key, tab, onTab: setTab, find: { offered: fit.offered, finding: isFinding },
        duties: draftedDuties, heldDuties: storedDuties, targets, refusals, onRefusal: refusal => goTo(refusal.kind, refusal.issue.entry, refusal.issue.field) });
    const toolbar = useRosterToolbar({ ...window, value, styles, commands, editing, words, issues, refused: refusals.length, onIssues, onIssue, onConflict,
        where: historyWhere, onAction, onPickerDates: setPickerDates, narrow,
        optimise: optimiseParts.toolbarItem, optimiseEntry: optimiseParts.entry, locked, issuesFlash: landing.lit && optimised !== undefined,
        selectedWeek: pickedStart === undefined ? undefined : new Date(pickedStart),
        status: source.periods.type === "some" ? statusText(heldPeriod) : undefined, unread: !current, publishing, picker: data.picker,
        onDisplay: next => props.setDisplay({ ...props.display, ...next }), search });
    // Read only while no week in view can be edited: the week's status, or every week of the month's (#1406).
    const readOnly = value.settings.readOnly || (current && weekStates.every(held => !editableStatus(held.heldPeriod.status)));
    // A week not started, said of the week in view: a month shows its weeks as they are.
    const notStarted = current && span.period !== "month" && week.assignments.size === 0 && (source.periods.type === "none" || !started(period));
    const dutyName = source.duty.kind.name.toLocaleLowerCase(format.locale);
    const sessionName = (kind: string) => kind === PERIODS ? (source.periods.type === "some" && source.periods.value.every.type === "day" ? "Days" : "Weeks")
        : kind === TARGETS ? "Targets" : source.duty.kind.name;
    // Cold load (#1398, CL5): no week read yet, nor the people's or the activities' first narrowing — the frame's
    // skeleton covers it. After it nothing covers: a week step, a narrowing or a new revision leave the frame live.
    const cold = (!data.landed && data.error === undefined) || (!visibility.ready && visibility.loading) || (!activities.ready && activities.loading) || (!props.patterns.ready && props.patterns.loading);
    // After cold load a read in flight — the span, the people's, the activities' or the patterns' narrowing — leaves the frame live, main busy.
    const busy = data.loading || visibility.loading || activities.loading || props.patterns.loading;
    // The skeleton's rows at the layout's own pitch (#1398, CL5): the People rows' — 36px, 32px compact — in Week and Month
    // alike; the Shifts grid's rows grow with their chips, and a phone's cards with their days, so those take the frame's own.
    const loadingPitch = window.view.layout === "people" && !narrow ? (props.display.density === "compact" ? 32 : 36) : undefined;
    return <FieldAskProvider value={fieldAsks.asks}><Box ref={root} css={[styles.root, landingStyles.main]} data-roster-frame="" data-roster-readonly={readOnly ? "" : undefined} {...landing.attributes}>
        <RosterDataReader value={source} span={span} pickerDates={pickerDates} holds={holds} onData={setData} />
        <LoadingReveal waiting={line?.kind === "loading"}>
        <BuilderFrame storageKey={`${key}.frame`} label="Roster" loading={cold} loadingPitch={loadingPitch} busy={busy} liveFooter phonePanel start={library} end={inspector} toolbar={toolbar}
            panesRef={panes} onKeyDown={event => {
            // Each key the frame acts on goes no further than the Roster (#1398); Esc with nothing to let go of goes on.
            if (event.defaultPrevented || typedInto(event.target)) return;
            const action = historyShortcut(event);
            if (action !== undefined && history !== undefined && !value.settings.readOnly && !locked && (commands.available || history.pending > 0)) { takeKey(event); onAction(action); }
            // `[` and `]` step the span's unit: a week, or a month in Month (#1406, P2).
            else if (event.key === "[" || event.key === "]") { takeKey(event); window.step(event.key === "[" ? -1 : 1); }
            else if (event.key === "Escape" && (selection !== undefined || error !== undefined)) { takeKey(event); setSelection(undefined); setError(undefined); }
            else if ((event.key === "Delete" || event.key === "Backspace") && (selection?.type === "assignment" || selection?.type === "proposal") && commands.available) {
                takeKey(event);
                keepOnBoard(selection.type === "assignment" ? "assignment" : "proposal", selection.key);
                if (selection.type === "assignment") commands.remove(selection.key); else commands.reject(selection.key);
            }
        }} rootProps={CLICK_FOCUS} banners={<>
            {optimiseParts.banner}
            {editing?.schedule.sessions.map(held => <SessionBanners key={held.key} session={held.session} words={words} name={sessionName(held.kind)} where={where(held.kind)}
                onAction={action => editing.history.actOn(held.key, action)} />)}
            {current && heldPeriod.status.type === "published" && <BannerView status="info" title="Published week" description="Read-only view of the published roster." />}
            {current && heldPeriod.status.type === "other" && <BannerView status="info" title={`${heldPeriod.status.value} week`} description="This week is read-only." />}
            {notStarted && <BannerView status="info" title="Week not started" description={held.requirements.size > 0 ? "Targets are ready. Assign staff to start this week's roster." : "Assign staff to start this week's roster."}
                actions={previous !== undefined && previous.assignments.size > 0 && (commands.available || commands.locked !== undefined) ? <Button size="xs" variant="outline" disabled={commands.locked !== undefined} title={commands.locked} onClick={() => commands.copy()}>Copy previous week</Button> : undefined} />}
            {weekPay.failed.map(({ who, error: why }) => <BannerView key={`${who.type}:${who.value}`} status="warning"
                title={`Pay couldn't be worked out for ${who.type === "person" ? value.people.find(p => p.key === who.value)?.name ?? who.value : value.agencies.find(a => a.key === who.value)?.name ?? who.value}`}
                description={why} />)}
            {!custom.result.ok && <BannerView status="warning" title="Additional checks unavailable" description="The roster's additional checks could not run. Built-in checks are still shown." />}
            {visibility.error !== undefined && <BannerView status="error" title="Staff results unavailable" description={visibility.error} actions={<Button size="xs" variant="outline" onClick={visibility.retry}>Retry</Button>} />}
            {activities.error !== undefined && <BannerView status="error" title="Activity results unavailable" description={activities.error} actions={<Button size="xs" variant="outline" onClick={activities.retry}>Retry</Button>} />}
            {props.patterns.error !== undefined && <BannerView status="error" title="Pattern results unavailable" description={props.patterns.error} actions={<Button size="xs" variant="outline" onClick={props.patterns.retry}>Retry</Button>} />}
            {/* A find the app's fit failed to answer (R4): its message, and Retry, while the find stands. */}
            {find !== undefined && fitError !== undefined && <BannerView status="warning" title="Fits couldn't be checked" description={fitError} actions={<Button size="xs" variant="outline" onClick={retryFit}>Retry</Button>} />}
            {props.rangeError !== undefined && <BannerView status="error" title="Week unavailable" description={props.rangeError} />}
            {/* A gesture's error; a read's is said once, in the grid and on the footer's line (#1398, CL11). */}
            {error !== undefined && <Box css={styles.error} role="alert">{error}</Box>}
        </>} footer={<RosterFooter styles={styles} vocabulary={value.vocabulary} duties={dutyPart} noun={{ singular: `${dutyName} event`, plural: `${dutyName} events` }} line={line}
            optimise={{ line: optimiseParts.line, legend: optimiseParts.legend }} />}>
            {/* A failed week's main is not retained: its Retry is in it. The board is the keyboard's surface and its anchor,
                never a tab stop, as the Calendar's is: a click on a part of it that holds nothing focusable puts the keyboard
                here, where `[` and `]` step the week, and what Delete takes away leaves it here. */}
            <Box ref={main} css={styles.main} data-roster-main="" tabIndex={-1} aria-disabled={retained && read.state !== "failed" ? true : undefined}
                data-roster-stale={stale ? "" : undefined} data-roster-narrow={narrow ? "" : undefined}>
                <RosterViews {...viewProps} anchor={anchor} onAnchor={onAnchor} picked={picked} />
            </Box>
        </BuilderFrame>
        </LoadingReveal>
    </Box></FieldAskProvider>;
}

/** The Roster over the app's records: its narrowing, its week and its editing, around the frame. */
function RosterRoot({ value: source, storageKey }: EastChakraRosterProps) {
    const key = `${storageKey}.${source.id.type === "some" ? source.id.value : "roster"}`;
    const { state: display, setState: setDisplay } = usePersistedState(`${key}.display`, { density: source.settings.density.type, chipSkills: source.settings.chipSkills, requirements: source.settings.requirements }, readRosterDisplay);
    // The narrowing chooses which people, activities and patterns show, read from the slice itself (#1342); coverage, pay and checks read every one.
    const visibility = useRosterVisibility(source, "people");
    const activities = useRosterVisibility(source, "activities");
    const patterns = useRosterVisibility(source, "patterns");
    const value: RosterValue = useMemo(() => ({ ...source, visiblePeople: visibility.keys, visibleActivities: activities.keys, settings: { ...source.settings, ...display, density: variant(display.density, null) } }),
        [source, display, visibility.keys, activities.keys]);
    // What the rail shows of each Library tab's source, and how that source alone clears.
    const peopleShown = useSourceShown(visibility, rosterPart(source, "people"));
    const activitiesShown = useSourceShown(activities, rosterPart(source, "activities"));
    const patternsShown = useSourceShown(patterns, rosterPart(source, "patterns"));
    const shown = useMemo(() => ({ people: peopleShown, activities: activitiesShown, patterns: patternsShown }), [peopleShown, activitiesShown, patternsShown]);
    const [narrow, setNarrow] = useState(false);
    const window = useRosterWindow(value, key, narrow);
    // The duties' source of the slice holds the span's window — its weeks and the twelve hours either side their duties may start from
    // their shifts' — which the Roster's own navigation writes (D9), so the rail's count and a Save's notice read the window it reads.
    const span = spanWindow(window.span);
    const rangeError = useSourceWindow(source.slice.type === "some" ? source.slice.value : undefined, source.duty.kind.key, span.from, span.to,
        "The week could not be applied");
    const frame = { source, value, storageKey: key, window, visibility, activities, patterns, shown, display, setDisplay, rangeError, onNarrow: setNarrow };
    return source.settings.readOnly ? <RosterFrame {...frame} editing={undefined} /> : <EditableRoster {...frame} />;
}
/** The e3 renderer owns the frame; callers author only the Roster tag and bound data. */
export function EastChakraRoster(props: EastChakraRosterProps) {
    const error = configError(props.value);
    return error === undefined ? <RosterRoot {...props} /> : <BannerView status="error" title="Roster configuration" description={error} />;
}
implementUIComponent(RosterComponent, EastChakraRoster);
