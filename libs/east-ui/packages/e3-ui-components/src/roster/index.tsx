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
 * brought into view and the keyboard handed to their name; where the People
 * views rest is saved, and comes back as they mount. BuilderFrame stays an
 * internal React detail.
 *
 * @packageDocumentation
 */
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Box, Button, useSlotRecipe } from "@chakra-ui/react";
import { equalFor, none, some, variant } from "@elaraai/east";
import { RosterComponent, RosterContextType } from "@elaraai/e3-ui/internal";
import {
    BannerView, BuilderFrame, SessionBanners, editingMessages, historyShortcut, implementUIComponent, typedInto, useContainerBelow, useDataStable, useFormatters,
    usePersistedState, useTrackedEvaluation, type HistoryAction,
} from "@elaraai/east-ui-components";
import { LoadingReveal, usePickHandOff } from "@elaraai/east-ui-components/internal";
import { periodLoading, periodLoadingLine, periodRead, retryPeriod } from "../shared/loading.js";
import { publishPeriod } from "../shared/schedule/records.js";
import { useSourceWindow } from "../shared/schedule/source-window.js";
import { DAY } from "../shared/schedule/window.js";
import { publishChange, rosterCommands } from "./actions.js";
import { RosterDataReader, initialRosterData, type RosterData } from "./data.js";
import { useRosterDrag } from "./drag.js";
import { PERIODS, TARGETS, useRosterEditing, type RosterEditing } from "./editing.js";
import { useRosterFind, type FoundPerson } from "./find.js";
import { sameFind, useRosterFit, type RosterFind } from "./fit.js";
import { RosterFooter } from "./footer.js";
import { useRosterInspector } from "./inspector.js";
import { useRosterLibrary } from "./library.js";
import {
    NARROW_WIDTH, NO_PAY, NO_PERIOD, RosterPayCache, availableProposals, compareDate, configError, editableStatus, placeDrafted, placeStored, placeTargets,
    rosterContext, rosterDomain, started, statusText, weekBefore, weekKey, weekOf, weekSpan, weekWindow, type DraftedDuty, type Issue, type PlacedDuties, type PlacedPeriod,
    type RosterPayload, type RosterStyles, type RosterValue, type Selection, type StoredDuty, type StoredTarget,
} from "./model.js";
import { useRosterToolbar } from "./toolbar.js";
import { RosterViews, assignmentName, personOf, type PeoplePick, type RosterAnchor } from "./views.js";
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
const NO_ISSUES: readonly Issue[] = [];
const sameContext = equalFor(RosterContextType);
/** No People view has rested anywhere yet. */
const NO_ANCHOR: RosterAnchor = {};

/** What the frame takes from the Roster around it: the payload as read, the week, the narrowing, and the editing. */
interface FrameProps {
    source: RosterPayload; value: RosterValue; storageKey: string; window: RosterWindow;
    visibility: KeyVisibility; activities: KeyVisibility; shown: { people: SourceShown; activities: SourceShown };
    display: { density: "compact" | "comfortable"; chipSkills: boolean; requirements: boolean };
    setDisplay: (next: { density: "compact" | "comfortable"; chipSkills: boolean; requirements: boolean }) => void;
    /** Why the week's window could not be written to the duties' source. */
    rangeError: string | undefined;
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
    const editing = useRosterEditing(props.value, props.storageKey, props.window.start, recordSlices);
    return <RosterFrame {...props} editing={editing} />;
}

function RosterFrame(props: FrameProps) {
    const { source, value, storageKey: key, window, visibility, activities, editing } = props;
    const { start } = window;
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
    const holds = useCallback((duties: ReadonlyMap<string, StoredDuty>) => place(duties, start).assignments.size > 0, [place, start]);
    const [data, setData] = useState<RosterData>(() => initialRosterData(start));
    const current = data.ready && compareDate(data.start, start) === 0;
    const storedDuties = useMemo(() => place(current ? data.duties : new Map(), start), [current, data.duties, place, start]);
    const draftedDuties = useMemo(() => placeDrafted(domain, storedDuties, editing?.duties ?? NO_DUTY_DRAFTS, start, context), [domain, storedDuties, editing?.duties, start, context]);
    const previous = useMemo(() => current && data.previous !== undefined ? place(data.previous, weekBefore(start)) : undefined, [current, data.previous, place, start]);
    const heldTargets = useMemo(() => placeTargets(current ? data.targets : new Map(), NO_TARGET_DRAFTS, start, source), [current, data.targets, start, source]);
    const targets = useMemo(() => placeTargets(current ? data.targets : new Map(), editing?.targets ?? NO_TARGET_DRAFTS, start, source), [current, data.targets, editing?.targets, start, source]);
    const weekId = weekKey(start);
    const periodDrafts = editing?.periods ?? NO_PERIOD_DRAFTS;
    const heldPeriod = useMemo(() => periodOf(source, current ? data.period : undefined), [source, current, data.period]);
    const period = useMemo(() => periodDrafts.has(weekId) ? periodOf(source, periodDrafts.get(weekId)) : heldPeriod, [periodDrafts, weekId, source, heldPeriod]);
    const week = useMemo(() => weekOf(draftedDuties, targets, period), [draftedDuties, targets, period]);
    const held = useMemo(() => weekOf(storedDuties, heldTargets, heldPeriod), [storedDuties, heldTargets, heldPeriod]);
    const [selection, setSelection] = useState<Selection>();
    const [tab, setTab] = useState("details");
    const [libraryTab, setLibraryTab] = useState<string>();
    // A Find fix's question: its need on its issue's slot, which the People tab shows the app's fit's answer to (#1334).
    const [find, setFind] = useState<RosterFind>();
    const [error, setError] = useState<string>();
    const root = useRef<HTMLDivElement>(null), main = useRef<HTMLDivElement>(null);
    const narrow = useContainerBelow(main, NARROW_WIDTH);
    const revealPane = (label: string) => root.current?.querySelector<HTMLButtonElement>(`button[aria-label="Expand ${label}"]`)?.click();
    const select = useCallback((next: Selection | undefined) => { setSelection(next); setTab("details"); if (next !== undefined) revealPane("Inspector"); }, []);
    const weekEpoch = start.getTime();
    // Another week: its own selection, and no find — a find is its issue's, in the week it was asked of.
    useEffect(() => { setSelection(undefined); setError(undefined); setFind(undefined); }, [weekEpoch]);
    const recipe = useSlotRecipe({ key: "rosterBuilder" });
    const styles = useMemo(() => recipe({}) as unknown as RosterStyles, [recipe]);
    const format = useFormatters(), words = useMemo(() => ({ ...format, m: editingMessages }), [format]);
    // The app's pay, a person at a time (§5.6, B17): asked again only for the people a change touched.
    const payCache = useRef(new RosterPayCache());
    const weekPay = useMemo(() => source.pay.type === "some" ? payCache.current.run(domain, source.pay.value, week, start, context) : NO_PAY, [source.pay, domain, week, start, context]);
    const coverage = useMemo(() => domain.coverage(week, context, weekPay.pay), [domain, week, context, weekPay]);
    const hours = useMemo(() => domain.hours(week, context), [domain, week, context]);
    const builtIn = useMemo(() => domain.check(week, context), [domain, week, context]);
    const proposals = useMemo(() => availableProposals(value, week, start), [value, week, start]);
    // The app's check over the complete draft, given the pay (§5.8).
    const readCheck = useCallback(() => source.check.type === "some"
        ? source.check.value(domain.encodeCheckContext({ start, week, context, coverage, pay: weekPay.pay })) : [], [source.check, domain, start, week, context, coverage, weekPay]);
    const custom = useTrackedEvaluation(readCheck);
    // The week's issues, the same array while what they say holds: what the grid draws from them draws again only as
    // they change (#1398, CL9).
    const customIssues = custom.result.ok ? custom.result.value : NO_ISSUES;
    const allIssues: readonly Issue[] = useMemo(() => [...builtIn, ...draftedDuties.unplaced, ...customIssues, ...proposals.map(p => ({ kind: variant("proposal", null), tone: variant("info", null),
        title: `${personOf(value, p.person)?.name ?? p.person} · proposed`, detail: p.reason, slot: some(p.slot), assignment: none, flag: none, fix: some(variant("accept", p.key)) }))],
        [builtIn, draftedDuties.unplaced, customIssues, proposals, value]);
    // A week not read gives no issue: a gap of a week whose duties are not read yet is no gap (#1398, CL13).
    const { layout, period: viewPeriod } = window.view;
    const issues = useMemo(() => current ? allIssues.filter(i => layout === "people" || viewPeriod === "week" || i.slot.type === "none" || Number(i.slot.value.day) === window.day) : NO_ISSUES,
        [current, allIssues, layout, viewPeriod, window.day]);
    // The app's fit (#1334): a Find fix asks it who fits over the complete staff, and the People tab shows its answer.
    const fit = useRosterFit(value, start, week, context, coverage, find);
    const { error: fitError, retry: retryFit, pending: finding } = fit;
    const findFix = useCallback((next: RosterFind) => {
        setFind(next); setLibraryTab("people"); revealPane("Library");
        // Pressed again after the fit failed, a find is asked again.
        if (fitError !== undefined) retryFit();
    }, [fitError, retryFit]);
    const isFinding = useCallback((asked: RosterFind) => finding && find !== undefined && sameFind(find, asked), [finding, find]);
    // Publish (B7): Save, then once every record reads back as saved, the week's status — over its row as last saved.
    const [publishing, setPublishing] = useState(false);
    const publishingNow = useRef(false);
    const latest = useRef({ change: () => undefined as ReturnType<typeof publishChange> });
    latest.current = { change: () => editing === undefined ? undefined : publishChange(source, editing, start, current ? data.period : undefined, new Date()) };
    const publish = useCallback(() => {
        if (editing === undefined || publishingNow.current) return;
        publishingNow.current = true; setPublishing(true);
        void publishPeriod(editing.history, () => latest.current.change(), changes => editing.schedule.record(changes, "typed", "Publish week"))
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
    const commands = useMemo(() => rosterCommands({
        value, start, context, week, held, duties: draftedDuties, heldDuties: storedDuties, previous, targets, period, heldPeriod,
        read: [data.duties, ...(data.previous === undefined ? [] : [data.previous])], readTargets: data.targets, editing, ready, retained,
    }, setSelection, findFix, publish), [value, start, context, week, held, draftedDuties, storedDuties, previous, targets, period, heldPeriod, data.duties, data.previous,
        data.targets, editing, ready, retained, findFix, publish]);
    const drag = useRosterDrag({ value, commands, week, duties: draftedDuties, context, storageKey: key, narrow, start, onError: setError });
    const dutyPart = sourcePart(source.slice.type === "some" ? source.slice.value : undefined, source.duty.kind.key);
    // What the footer's loading line says (#1398, CL3): the week being read, the people's or the activities' new
    // narrowing, or why one could not be read, with Retry — the week's asking again each record the week reads.
    const retryWeek = useCallback(() => retryPeriod([{ entries: source.duty.kind.entries, part: dutyPart },
        ...(source.periods.type === "some" ? [{ entries: source.periods.value.entries }] : []),
        ...(source.targets.type === "some" ? [{ entries: source.targets.value.entries, part: sourcePart(source.slice.type === "some" ? source.slice.value : undefined, "targets") }] : [])]),
        [source, dutyPart]);
    const readSpan = weekSpan(start);
    const weekWords = format.range(readSpan.from, new Date(readSpan.to.getTime() - DAY));
    const line = useMemo(() => periodLoadingLine(periodLoading({ loading: data.loading, error: data.error, retry: retryWeek },
        [{ noun: "people", ...visibility }, { noun: "activities", ...activities }]), weekWords),
        [data.loading, data.error, retryWeek, visibility, activities, weekWords]);
    // What the views draw of the week (#1398): the week as read; a week not read yet, its geometry at once and its
    // placeholders, unseen until the frame's one reveal clock says so (CL5, CL2, CL4: `LoadingReveal` below, which the
    // footer's line and each placeholder read where they show, so its flip renders them and never this frame); or one
    // whose read failed, its geometry and the failure said once in its first row in view (CL11) — never "Roster
    // unavailable" over the grid.
    const read = useMemo(() => periodRead({ current, error: data.error, name: weekWords, retry: retryWeek }), [current, data.error, weekWords, retryWeek]);
    // Where the People views rest (#1398): saved under the Roster's key, so each comes back to it as it mounts.
    const { state: anchor, setState: setAnchor } = usePersistedState<RosterAnchor>(`${key}.anchor`, NO_ANCHOR);
    const onAnchor = useCallback((next: Partial<RosterAnchor>) => setAnchor(was => ({ ...was, ...next })), [setAnchor]);
    const viewProps = { value, week, held, start, day: window.day, view: window.view, setView: window.setView,
        styles, format, narrow, coverage, hours, pay: weekPay.pay, domain, issues, proposals, selection, select, commands, drag, onError: setError, read };
    // Search Records (#1398): a person found by their key is selected — in the People layout their row brought into view,
    // and a pick's person given the keyboard there, once the box has let it go: their name takes the focus as ↑ / ↓ give it.
    const handOff = usePickHandOff();
    const [picked, setPicked] = useState<PeoplePick>();
    const found = useRosterFind({ people: value.people, visible: value.visiblePeople, groups: value.groups,
        onPick: (person: FoundPerson) => {
            select({ type: "person", key: person.person.key });
            handOff.land(() => setPicked(was => ({ key: person.person.key, seq: (was?.seq ?? 0) + 1 })));
        } });
    const search = useMemo(() => (found === undefined ? undefined : handOff.search(found)), [found, handOff]);
    const library = useRosterLibrary({ ...viewProps, storageKey: key, tab: libraryTab, onTab: setLibraryTab,
        find: find === undefined ? undefined : { need: find.need, shown: fit.shown, busy: finding }, onClearFind: () => setFind(undefined), shown: props.shown });
    const inspector = useRosterInspector({ ...viewProps, storageKey: key, tab, onTab: setTab, find: { offered: fit.offered, finding: isFinding },
        duties: draftedDuties, heldDuties: storedDuties, targets });
    const onIssues = () => { setTab("issues"); revealPane("Inspector"); };
    const history = editing?.history;
    const onAction = useCallback((action: HistoryAction) => { const active = document.activeElement; if (active instanceof HTMLElement) active.blur(); history?.act(action); }, [history]);
    const toolbar = useRosterToolbar({ ...window, value, styles, commands, editing, words, issues, onIssues, onAction, onPickerDates: setPickerDates,
        status: source.periods.type === "some" ? statusText(heldPeriod) : undefined, unread: !current, publishing, picker: data.picker,
        onDisplay: next => props.setDisplay({ ...props.display, ...next }), search });
    const readOnly = value.settings.readOnly || (current && !editableStatus(heldPeriod.status));
    const notStarted = current && week.assignments.size === 0 && (source.periods.type === "none" || !started(period));
    const dutyName = source.duty.kind.name.toLocaleLowerCase(format.locale);
    /** A session's issue's place: a duty by whose it is, a week's or a target's row as it stands. */
    const where = (kind: string) => (issue: { entry: string }) => {
        if (kind !== source.duty.kind.key) return issue.entry;
        const a = week.assignments.get(issue.entry) ?? held.assignments.get(issue.entry);
        return a === undefined ? issue.entry : assignmentName(value, a);
    };
    const sessionName = (kind: string) => kind === PERIODS ? (source.periods.type === "some" && source.periods.value.every.type === "day" ? "Days" : "Weeks")
        : kind === TARGETS ? "Targets" : source.duty.kind.name;
    // Cold load (#1398, CL5): no week read yet, nor the people's or the activities' first narrowing — the frame's
    // skeleton covers it. After it nothing covers: a week step, a narrowing or a new revision leave the frame live.
    const cold = (!data.landed && data.error === undefined) || (!visibility.ready && visibility.loading) || (!activities.ready && activities.loading);
    // After cold load a read in flight — the week, the people's or the activities' narrowing — leaves the frame live, main busy.
    const busy = data.loading || visibility.loading || activities.loading;
    return <Box ref={root} css={styles.root} data-roster-frame="" data-roster-readonly={readOnly ? "" : undefined}>
        <RosterDataReader value={source} start={start} pickerDates={pickerDates} holds={holds} onData={setData} />
        <LoadingReveal waiting={line?.kind === "loading"}>
        <BuilderFrame storageKey={`${key}.frame`} label="Roster" loading={cold} busy={busy} liveFooter start={library} end={inspector} toolbar={toolbar} onKeyDown={event => {
            if (event.defaultPrevented || typedInto(event.target)) return;
            const action = historyShortcut(event);
            if (action !== undefined && history !== undefined && !value.settings.readOnly && (commands.available || history.pending > 0)) { event.preventDefault(); onAction(action); }
            else if (event.key === "[" || event.key === "]") { event.preventDefault(); window.setView({ ...window.view, date: window.view.date + (event.key === "[" ? -7 : 7) * 86_400_000 }); }
            else if (event.key === "Escape") { setSelection(undefined); setError(undefined); }
            else if ((event.key === "Delete" || event.key === "Backspace") && (selection?.type === "assignment" || selection?.type === "proposal") && commands.available) { event.preventDefault(); if (selection.type === "assignment") commands.remove(selection.key); else commands.reject(selection.key); }
        }} banners={<>
            {editing?.schedule.sessions.map(held => <SessionBanners key={held.key} session={held.session} words={words} name={sessionName(held.kind)} where={where(held.kind)}
                onAction={action => editing.history.actOn(held.key, action)} />)}
            {current && heldPeriod.status.type === "published" && <BannerView status="info" title="Published week" description="Read-only view of the published roster." />}
            {current && heldPeriod.status.type === "other" && <BannerView status="info" title={`${heldPeriod.status.value} week`} description="This week is read-only." />}
            {notStarted && <BannerView status="info" title="Week not started" description={heldTargets.requirements.size > 0 ? "Targets are ready. Assign staff to start this week's roster." : "Assign staff to start this week's roster."}
                actions={previous !== undefined && previous.assignments.size > 0 && commands.available ? <Button size="xs" variant="outline" onClick={() => commands.copy()}>Copy previous week</Button> : undefined} />}
            {weekPay.failed.map(({ who, error: why }) => <BannerView key={`${who.type}:${who.value}`} status="warning"
                title={`Pay couldn't be worked out for ${who.type === "person" ? value.people.find(p => p.key === who.value)?.name ?? who.value : value.agencies.find(a => a.key === who.value)?.name ?? who.value}`}
                description={why} />)}
            {!custom.result.ok && <BannerView status="warning" title="Additional checks unavailable" description="The roster's additional checks could not run. Built-in checks are still shown." />}
            {visibility.error !== undefined && <BannerView status="error" title="Staff results unavailable" description={visibility.error} actions={<Button size="xs" variant="outline" onClick={visibility.retry}>Retry</Button>} />}
            {activities.error !== undefined && <BannerView status="error" title="Activity results unavailable" description={activities.error} actions={<Button size="xs" variant="outline" onClick={activities.retry}>Retry</Button>} />}
            {/* A find the app's fit failed to answer (R4): its message, and Retry, while the find stands. */}
            {find !== undefined && fitError !== undefined && <BannerView status="warning" title="Fits couldn't be checked" description={fitError} actions={<Button size="xs" variant="outline" onClick={retryFit}>Retry</Button>} />}
            {props.rangeError !== undefined && <BannerView status="error" title="Week unavailable" description={props.rangeError} />}
            {/* A gesture's error; a read's is said once, in the grid and on the footer's line (#1398, CL11). */}
            {error !== undefined && <Box css={styles.error} role="alert">{error}</Box>}
        </>} footer={<RosterFooter styles={styles} duties={dutyPart} noun={{ singular: `${dutyName} event`, plural: `${dutyName} events` }} line={line} />}>
            {/* A failed week's main is not retained: its Retry is in it. */}
            <Box ref={main} css={styles.main} data-roster-main="" aria-disabled={retained && read.state !== "failed" ? true : undefined}
                data-roster-stale={stale ? "" : undefined} data-roster-narrow={narrow ? "" : undefined}>
                <RosterViews {...viewProps} anchor={anchor} onAnchor={onAnchor} picked={picked} />
            </Box>
        </BuilderFrame>
        </LoadingReveal>
    </Box>;
}

/** The Roster over the app's records: its narrowing, its week and its editing, around the frame. */
function RosterRoot({ value: source, storageKey }: EastChakraRosterProps) {
    const key = `${storageKey}.${source.id.type === "some" ? source.id.value : "roster"}`;
    const { state: display, setState: setDisplay } = usePersistedState(`${key}.display`, { density: source.settings.density.type, chipSkills: source.settings.chipSkills, requirements: source.settings.requirements });
    // The narrowing chooses which people and activities show, read from the slice itself (#1342); coverage, pay and checks read every one.
    const visibility = useRosterVisibility(source, "people");
    const activities = useRosterVisibility(source, "activities");
    const value: RosterValue = useMemo(() => ({ ...source, visiblePeople: visibility.keys, visibleActivities: activities.keys, settings: { ...source.settings, ...display, density: variant(display.density, null) } }),
        [source, display, visibility.keys, activities.keys]);
    // What the rail shows of each Library tab's source, and how that source alone clears.
    const peopleShown = useSourceShown(visibility, rosterPart(source, "people"));
    const activitiesShown = useSourceShown(activities, rosterPart(source, "activities"));
    const shown = useMemo(() => ({ people: peopleShown, activities: activitiesShown }), [peopleShown, activitiesShown]);
    const window = useRosterWindow(value, key);
    // The duties' source of the slice holds the week's window — the week and the twelve hours either side its duties may start from
    // their shifts' — which the Roster's own navigation writes (D9), so the rail's count and a Save's notice read the window it reads.
    const span = weekWindow(window.start);
    const rangeError = useSourceWindow(source.slice.type === "some" ? source.slice.value : undefined, source.duty.kind.key, span.from, span.to,
        "The week could not be applied");
    const frame = { source, value, storageKey: key, window, visibility, activities, shown, display, setDisplay, rangeError };
    return source.settings.readOnly ? <RosterFrame {...frame} editing={undefined} /> : <EditableRoster {...frame} />;
}
/** The e3 renderer owns the frame; callers author only the Roster tag and bound data. */
export function EastChakraRoster(props: EastChakraRosterProps) {
    const error = configError(props.value);
    return error === undefined ? <RosterRoot {...props} /> : <BannerView status="error" title="Roster configuration" description={error} />;
}
implementUIComponent(RosterComponent, EastChakraRoster);
