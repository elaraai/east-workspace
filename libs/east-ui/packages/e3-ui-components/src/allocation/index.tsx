/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

/**
 * The Allocation's renderer (`Allocation Spec.md`, #1372, `Builder Interfaces
 * Spec.md` §6, §7, §9): the board in its BuilderFrame — one toolbar, the
 * banners, the panes, the footer's legend and its loading line (#1398), and
 * the cold load's cover at the board's own row pitch, the footer live under
 * it — over the
 * app's own records: its bins and its days, a session each of one history,
 * read a day at a time and assembled into the day the Timeline, the Table, the
 * cards, the Library and the Inspector draw, drafts in place; Publish saving
 * the day, then writing its status. The bins' source of the slice holds the
 * day, which the board's own navigation writes. Below 480px of main, the
 * Timeline and the Table are cards with explicit actions, and nothing takes a
 * drag (#1333). After its cold load nothing covers the board (#1398, CL5): a
 * day not read yet draws its lanes, slots and resources at once and a
 * placeholder where its bins and figures go, and one whose read failed says so
 * once, in its first row in view, with Retry (CL11). With an optimiser bound,
 * the Elara eye (#1409): one run over the day in view, its result landed on
 * the day's bins as one step of the history, and what it left on them marked
 * until Apply.
 *
 * @packageDocumentation
 */

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { SortedMap, StringType, equalFor, none, variant } from "@elaraai/east";
import { Box, Button, useSlotRecipe } from "@chakra-ui/react";
import { AllocationComponent } from "@elaraai/e3-ui/internal";
import {
    BannerView, BuilderFrame, SessionBanners, historyShortcut, implementUIComponent, optimiseMessages, takeKey, typedInto, useContainerBelow, useFormatters,
    useLanding, useLandingStyles, usePersistedState, useSliceReactivity, useTrackedEvaluation, type HistoryAction,
} from "@elaraai/east-ui-components";
import { LoadingReveal, formatDatePattern, usePickHandOff } from "@elaraai/east-ui-components/internal";
import { useOptimise } from "../shared/func/use-optimise.js";
import { useOptimiseParts } from "../shared/func/optimise-parts.js";
import { periodLoading, periodLoadingLine, periodRead, retryPeriod } from "../shared/loading.js";
import { publishPeriod } from "../shared/schedule/records.js";
import type { RowAnchor } from "../shared/schedule/row-anchor.js";
import { useSourceShown } from "../shared/schedule/source-tab.js";
import { useSourceWindow } from "../shared/schedule/source-window.js";
import { sourcePart } from "../shared/schedule/visibility.js";
import { allocationCommands, publishChange, remainderOf } from "./actions.js";
import { BinFocusContext, type BinFocus } from "./bin-focus.js";
import { AllocationCards } from "./cards.js";
import { AllocationDataReader, binChoicesOf, initialAllocationData, type AllocationData } from "./data.js";
import { bookOnto, placeAsk, useAllocationDrag, type DropScene, type LibraryGrip, type Refusal, type Target, type Verdict } from "./drag.js";
import { PERIODS, useAllocationEditing, type AllocationEditing } from "./editing.js";
import { useAllocationFind, type FoundBin } from "./find.js";
import { useAllocationFit } from "./fit.js";
import { AllocationFooter } from "./footer.js";
import { useHiddenBins, type BinShown } from "./hidden.js";
import { useAllocationInspector } from "./inspector.js";
import { binCode } from "./inspector-model.js";
import { useAllocationLibrary, type Pick, type ResourceFind } from "./library.js";
import { allocationMessages, type AllocationWords } from "./messages.js";
import {
    DAY, NARROW_WIDTH, NO_PERIOD, allocationContext, allocationDomain, allocationWords, compareDate, compareFloat, compareString, configError, dayKey, dayStart,
    editableStatus, focusOf, placeDrafted, placeStored, started, statusText, type AllocationStyles, type AllocationValue, type Day, type DraftedBin,
    type Issue, type PlacedPeriod, type Selection, type StoredBin,
} from "./model.js";
import { narrowingPart, narrowingText, useNarrowed } from "./narrowed.js";
import { NounsContext, a, other } from "./nouns.js";
import {
    allocationOptimiseRequest, allocationOptimiseTypes, landAllocationOptimise, lockAllocationCommands,
    type AllocationOptimiseRequest, type AllocationOptimiseResult, type AllocationOptimised,
} from "./optimise.js";
import { AllocationTable, RESERVE_PROBE } from "./table.js";
import { rowHiding } from "./table-rows.js";
import { AllocationTimeline, type SelectedLink, type TimelineFollow } from "./timeline.js";
import { ROW_H } from "./timeline-layout.js";
import { pickerDays, useAllocationToolbar } from "./toolbar.js";
import { useAllocationWindow, type AllocationWindow } from "./window.js";
export type { AllocationValue } from "./model.js";

/** Props of the record-backed Allocation extension. */
export interface EastChakraAllocationProps { value: AllocationValue; storageKey: string }
const NO_DATES: readonly Date[] = [];
/** The board's word for its bins in the footer's line: `Filtering bins…` (the coordinator's call, 23 Oct 2026, #1398). */
const BINS = "bins";
const NO_STORED: ReadonlyMap<string, StoredBin> = new Map();
const NO_BIN_DRAFTS: ReadonlyMap<string, DraftedBin | undefined> = new Map();
const NO_PERIOD_DRAFTS: ReadonlyMap<string, Uint8Array | undefined> = new Map();
const NO_ISSUES: Issue[] = [];
const keyEqual = equalFor(StringType);
/** The Table's view has rested nowhere yet. */
const NO_ANCHOR: { table?: RowAnchor | undefined } = {};

/** What the frame takes from the board around it: the payload, its key, the day, and the editing. */
interface FrameProps {
    value: AllocationValue; storageKey: string; window: AllocationWindow;
    /** Why the day could not be written to the bins' source. */
    rangeError: string | undefined;
    editing: AllocationEditing | undefined;
}

/** The day's own row, read: its status. */
function periodOf(value: AllocationValue, bytes: Uint8Array | undefined): PlacedPeriod {
    if (bytes === undefined || value.periods.type !== "some") return NO_PERIOD;
    return { bytes, status: value.periods.value.status(bytes) };
}

/** The sole editable wrapper: a read-only board never creates a record session. */
function EditableAllocation(props: Omit<FrameProps, "editing">) {
    const { value } = props;
    // The bins' Save notice counts what leaves their own source's narrowing.
    const recordSlices = useMemo(() => {
        const part = sourcePart(value.slice.type === "some" ? value.slice.value : undefined, value.bin.kind.key);
        return part === undefined ? [] : [part];
    }, [value]);
    const editing = useAllocationEditing(value, props.storageKey, props.window.day, recordSlices);
    return <AllocationFrame {...props} editing={editing} />;
}

function AllocationFrame({ value, storageKey: key, window, rangeError, editing }: FrameProps) {
    const domain = allocationDomain(value.bin.rowType);
    const { day } = window;
    const [pickerWeeks, setPickerWeeks] = useState(NO_DATES);
    const picker = useMemo(() => pickerDays(pickerWeeks), [pickerWeeks]);
    const [data, setData] = useState<AllocationData>(() => initialAllocationData(day));
    const current = data.ready && compareDate(data.day, day) === 0;
    // The bins' own source of the slice: its narrowing, apart from the day the board writes into it, is what a read of
    // the day it holds is filtered by (#1398).
    const binsPart = sourcePart(value.slice.type === "some" ? value.slice.value : undefined, value.bin.kind.key);
    useSliceReactivity(binsPart?.key);
    const binChoices = binChoicesOf(binsPart);
    // The day assembled from the records' rows (§9): the bins its window read, every day's drafts in place, and its own row.
    const stored = current ? data.bins : NO_STORED;
    const heldBins = useMemo(() => placeStored(domain, stored, day), [domain, stored, day]);
    // A day not read yet draws none of its bins, its drafts included: they wait in their session, and draw beside its
    // stored bins once those land — never a day of drafts alone (#1398, CL13).
    const planBins = useMemo(() => current ? placeDrafted(domain, heldBins, editing?.bins ?? NO_BIN_DRAFTS, day) : heldBins,
        [current, domain, heldBins, editing?.bins, day]);
    const dayId = dayKey(day);
    const periodDrafts = editing?.periods ?? NO_PERIOD_DRAFTS;
    const heldPeriod = useMemo(() => periodOf(value, current ? data.period : undefined), [value, current, data.period]);
    const period = useMemo(() => periodDrafts.has(dayId) ? periodOf(value, periodDrafts.get(dayId)) : heldPeriod, [periodDrafts, dayId, value, heldPeriod]);
    const plan = useMemo((): Day => ({ status: period.status, bins: planBins }), [period.status, planBins]);
    const held = useMemo((): Day => ({ status: heldPeriod.status, bins: heldBins }), [heldPeriod.status, heldBins]);
    const [selection, setSelection] = useState<Selection>();
    // A selected link (A68) is its bin's part on a resource; any other selection lets it go.
    const [link, setLink] = useState<SelectedLink>();
    // What the viewer picked in the Library (A9, A10): a selection, or a command, lets it go, as the mock's does.
    const [pick, setPick] = useState<Pick>();
    // A booking with no free slot left (A36): its banner, until the next gesture.
    const [notice, setNotice] = useState<Refusal>();
    // A refused drop's reason (A40): it adds no banner; the inspector shows it at its top until the next action.
    const [refusal, setRefusal] = useState<Refusal>();
    // The bin whose resource Chooser is open in the inspector (A8, A21, A64).
    const [chooser, setChooser] = useState<string>();
    // Find a fit (A74): the bin whose unallocated quantity the Library's Resources tab shows the fits for, until its chip clears it —
    // the tab's, not a filter, so neither a selection nor the rail lets it go.
    const [find, setFind] = useState<string>();
    // Selecting follows the selection (A12); a selection a command makes after a drop follows it softly.
    const [follow, setFollow] = useState<TimelineFollow>({ nonce: 0, soft: false });
    const select = useCallback((next: Selection | undefined, soft = false) => {
        setSelection(next);
        setLink(undefined);
        setPick(undefined);
        setNotice(undefined);
        setRefusal(undefined);
        setChooser(undefined);
        if (next !== undefined) setFollow(before => ({ nonce: before.nonce + 1, soft }));
    }, []);
    // The inspector's open tab (A55): an explicit inspection opens Details; a selection a command makes keeps it (A8).
    const { state: inspectorTab, setState: setInspectorTab } = usePersistedState<{ tab: string }>(`${key}.inspector.tab`, { tab: "details" });
    const inspect = useCallback((next: Selection | undefined, soft = false) => {
        select(next, soft);
        if (next !== undefined) setInspectorTab({ tab: "details" });
    }, [select, setInspectorTab]);
    const selectLink = useCallback((next: SelectedLink) => { inspect({ type: "bin", id: next.bin }); setLink(next); }, [inspect]);
    const [error, setError] = useState<string>();
    // The narrowing chooses which lanes, resources and arrivals show, read from the slice itself (#1336, #1339); fits, checks and totals read every one.
    const lanesShown = useNarrowed(value, "lanes", value.lanes);
    const resourcesShown = useNarrowed(value, "resources", value.resources);
    const arrivalsShown = useNarrowed(value, "arrivals", value.arrivals);
    const narrowing = [lanesShown, resourcesShown, arrivalsShown];
    // What the rail shows of each Library tab's source, and how that source alone clears (A98).
    const arrivalsSource = useSourceShown(arrivalsShown, narrowingPart(value, "arrivals"));
    const resourcesSource = useSourceShown(resourcesShown, narrowingPart(value, "resources"));
    const narrowingLoading = narrowing.some(n => n.loading), narrowingFailed = narrowing.some(n => n.error !== undefined);
    const clearFilters = value.slice.type === "some" ? value.slice.value.slice.clearAll : undefined;
    const root = useRef<HTMLDivElement>(null), main = useRef<HTMLDivElement>(null);
    const narrow = useContainerBelow(main, NARROW_WIDTH);
    const revealPane = (label: string) => root.current?.querySelector<HTMLButtonElement>(`button[aria-label="Expand ${label}"]`)?.click();
    // Another day: its own selection, pick and refusal, and no find — a find is its bin's, on the day it was asked of.
    const dayEpoch = day.getTime();
    useEffect(() => {
        setSelection(undefined); setLink(undefined); setPick(undefined); setNotice(undefined); setError(undefined); setRefusal(undefined); setChooser(undefined); setFind(undefined);
    }, [dayEpoch]);
    // Another layout closes the selected link (A7), and shows the selection there.
    useEffect(() => { setLink(undefined); setFollow(before => before.nonce === 0 ? before : { nonce: before.nonce + 1, soft: false }); }, [window.view.layout]);
    const recipe = useSlotRecipe({ key: "allocationBuilder" });
    const styles = useMemo(() => recipe({}) as unknown as AllocationStyles, [recipe]);
    // The board's words: its message table — the editing session's, and its own — in the app's locale.
    const format = useFormatters(), words = useMemo((): AllocationWords => ({ ...format, m: allocationMessages }), [format]);
    // The day, as the footer's line, the eye and the banner name it (#1398, CL3; #1409).
    const dayWords = format.weekdayDate(day);
    // What each source the rail narrows shows, as the layout shown draws a bin (#1398): the Table — on a phone its cards too —
    // hides a bin by its lane, its arrival and every one of its resources; the Timeline's lanes by its lane and its arrival;
    // a phone's Timeline, a card per resource, by its resources.
    const table = window.view.layout === "table";
    const shownKeys = useMemo((): BinShown => ({
        lanes: table || !narrow ? lanesShown.keys : none,
        resources: table || narrow ? resourcesShown.keys : none,
        arrivals: table || !narrow ? arrivalsShown.keys : none,
    }), [table, narrow, lanesShown.keys, resourcesShown.keys, arrivalsShown.keys]);
    const hiddenBins = useHiddenBins(value, shownKeys, format);
    // Search Records (#1398): a bin found by its key steps the board to its day, where — once the day is read, after the
    // step's own clearing above, and once the narrowing draws it — it is selected, and the board follows it into view, at
    // its time; a pick gives it the keyboard there, once the box has let it go: the element that stands for it in the
    // layout shown takes the focus (`bin-focus.ts`). A bin the rail's narrowing hides is drawn by clearing the choices
    // that hide it: those e3 named, else every choice of each source that hides it — a write of the rail like a chip's.
    const handOff = usePickHandOff();
    const [found, setFound] = useState<string>();
    const [binFocus, setBinFocus] = useState<string>();
    const finder = useAllocationFind({ value, domain, part: binsPart, words, hidden: hiddenBins, onPick: (bin: FoundBin) => {
        const hidden = hiddenBins.of(bin);
        if (hidden !== undefined) {
            try { hiddenBins.clear(hidden); }
            catch (reason) {
                // Not drawn, so nothing takes the keyboard: it stays where it is.
                handOff.drop();
                setError(reason instanceof Error ? reason.message : "The filters hiding the bin could not be cleared");
                return;
            }
        }
        setFound(bin.key);
        window.setView({ ...window.view, date: dayStart(bin.at).getTime() });
    } });
    const search = useMemo(() => (finder === undefined ? undefined : handOff.search(finder)), [finder, handOff]);
    useEffect(() => {
        if (found === undefined || !current) return;
        const bin = plan.bins.get(found);
        if (bin === undefined || narrowingLoading) return;
        const hides = rowHiding(bin.lane, { arrival: bin.arrival.type === "some" ? bin.arrival.value : undefined, parts: bin.parts.keys() },
            shownKeys.lanes, shownKeys.resources, shownKeys.arrivals);
        if (hides.lanes || hides.resources || hides.arrivals) return;
        inspect({ type: "bin", id: found });
        setFound(undefined);
        handOff.land(() => setBinFocus(found));
    }, [found, current, plan, inspect, narrowingLoading, shownKeys, handOff]);
    // The bin given the keyboard waits for its element only while it is the one selected (`useBinFocusTarget`), and until
    // the viewer does something else (the root's captures below).
    useEffect(() => {
        if (binFocus !== undefined && !(selection?.type === "bin" && keyEqual(selection.id, binFocus))) setBinFocus(undefined);
    }, [selection, binFocus]);
    const binFocused = useMemo<BinFocus>(() => ({ id: binFocus, done: () => setBinFocus(undefined) }), [binFocus]);
    const dropBinFocus = binFocus === undefined ? undefined : () => setBinFocus(undefined);
    // Where the Table's view rests (#1398): saved under the board's key, so the Table comes back to it as it mounts.
    const { state: anchor, setState: setAnchor } = usePersistedState<{ table?: RowAnchor | undefined }>(`${key}.anchor`, NO_ANCHOR);
    const onTableAnchor = useCallback((at: RowAnchor) => setAnchor(was => ({ ...was, table: at })), [setAnchor]);
    const context = useMemo(() => allocationContext(value), [value]);
    const loads = useMemo(() => domain.loads(day, plan, context), [domain, day, plan, context]);
    const builtIn = useMemo(() => domain.check(day, plan, context), [domain, day, plan, context]);
    const slots = useMemo(() => domain.slots(day, plan, context), [domain, day, plan, context]);
    const focus = focusOf(selection, plan);
    // The app's check, after the built-in ones wherever issues show; a check that fails leaves them shown. A day not read
    // yet has no issue: what its bins break is not known until they land (#1398, CL13).
    const readCheck = useCallback((): Issue[] => current && value.check.type === "some"
        ? value.check.value(domain.encodeCheckContext({ day, plan, context, loads })) : NO_ISSUES, [current, value.check, domain, day, plan, context, loads]);
    const custom = useTrackedEvaluation(readCheck);
    const issues = useMemo(() => current ? [...builtIn, ...(custom.result.ok ? custom.result.value : [])] : NO_ISSUES, [current, builtIn, custom.result]);
    // Publish (B7): Save, then once every record reads back as saved, the day's status — over its row as last saved.
    const [publishing, setPublishing] = useState(false);
    const publishingNow = useRef(false);
    const latest = useRef({ change: () => undefined as ReturnType<typeof publishChange> });
    latest.current = { change: () => editing === undefined ? undefined : publishChange(value, editing, day, current ? data.period : undefined, new Date()) };
    const publish = useCallback(() => {
        if (editing === undefined || publishingNow.current) return;
        publishingNow.current = true; setPublishing(true);
        void publishPeriod(editing.history, () => latest.current.change(), changes => editing.schedule.record(changes, "typed", "Publish day"))
            .finally(() => { publishingNow.current = false; setPublishing(false); });
    }, [editing]);
    // A narrowing read while the day it filters stands in — the bins' own, the lanes', the resources' or the arrivals' —
    // keeps the day's bins in their cells, stale (#1398, CL5): their words in the third ink, the cells' rules dashed. While a
    // narrowing is read or failed, what main shows is retained (CL8): readable, focusable and selectable, aria-disabled,
    // its controls in place and every gesture refused until it lands.
    const stale = current && (data.filtering || narrowingLoading);
    const retained = stale || narrowingLoading || narrowingFailed;
    // Commands update what is selected without changing the panes or their tabs.
    const unlocked = allocationCommands({ value, domain, day, plan, held, period, heldPeriod, read: stored, editing, ready: current && !publishing, retained }, select, publish);
    // The app's optimiser (#1409, #1420): one run over the day in view, its result landed on the day's bins as one edit,
    // and what it left on them until Apply — the landing and the highlight over the whole frame.
    const landing = useLanding(root);
    const landingStyles = useLandingStyles();
    const optimiseTypes = useMemo(() => allocationOptimiseTypes(domain.rowType), [domain]);
    const [optimised, setOptimised] = useState<AllocationOptimised | undefined>(undefined);
    const landAfter = useRef<(run: number) => void>(() => undefined);
    const latestRun = useRef({ plan, context, editing, optimised });
    latestRun.current = { plan, context, editing, optimised };
    const run = useOptimise<AllocationOptimiseRequest, AllocationOptimiseResult>({
        name: value.optimise.type === "some" ? value.optimise.value.name : null,
        requestType: optimiseTypes.request, resultType: optimiseTypes.result, scope: dayId, storageKey: key,
        onLanded: (result, request, n) => {
            const now = latestRun.current;
            if (now.editing === undefined) return undefined;
            const runText = format.number(n);
            const landed = landAllocationOptimise({ value, domain, editing: now.editing, request, result, label: optimiseMessages.step({ run: runText }), runText,
                plan: now.plan, context: now.context, before: now.optimised });
            if (landed === undefined) return undefined;
            // A run that changed nothing leaves what earlier runs left (R10).
            if (landed.optimised !== undefined) { setOptimised(landed.optimised); landAfter.current(n); }
            return landed.counts;
        },
    });
    // While a run is out (R2) the day takes no gesture: every command refused, the drags off, the history locked.
    const locked = run.running;
    const commands = locked ? lockAllocationCommands(unlocked) : unlocked;
    // The eye is listed only where the day can be optimised (ruled 25 Oct 2026): never read only, never over a published
    // day; while the day's reads are in flight it waits, disabled, in its place.
    const optimiseParts = useOptimiseParts<AllocationOptimiseRequest>({
        run, landing, period: dayWords,
        readOnly: value.settings.readOnly || editing === undefined || (current && (!editableStatus(heldPeriod.status) || !editableStatus(period.status))), busy: !unlocked.available,
        request: n => allocationOptimiseRequest(day, latestRun.current.plan, value.arrivals, latestRun.current.context, n), landKey: plan,
    });
    landAfter.current = optimiseParts.landAfter;
    // What a run left on the bins goes with the drafts (R17): once nothing is pending — Save, Discard — nothing is
    // marked. An Undo leaves nothing pending too, but its Redo brings the run's step back (R9): what the run left is
    // kept while that step is the next to redo.
    const pendingSteps = editing?.history.pending ?? 0;
    useEffect(() => {
        if (pendingSteps === 0 && editing?.history.redoOrigin !== "optimise") setOptimised(undefined);
    }, [pendingSteps, editing?.schedule.version, editing]);
    // The app's fit (§12): every verdict a drag or a pick shows is its answer.
    const fit = useAllocationFit(value, domain, day, plan, context);
    const { ask: askFit } = fit;
    // The day without a reservation, one per reservation for these drafts: what a fill asks the fit of (A38).
    // The drafts are the cache's key: new drafts, a new cache.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    const withouts = useMemo(() => new Map<string, Day>(), [plan]);
    const without = (bin: string) => {
        let derived = withouts.get(bin);
        if (derived === undefined) { derived = domain.copyDay(plan); derived.bins.delete(bin); withouts.set(bin, derived); }
        return derived;
    };
    // The day with a probe reservation in a free slot, its row made as a reservation's is (B13): what a free Table row's resource
    // Chooser asks the fit of (A48). The drafts are the cache's key: new drafts, a new cache.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    const reservings = useMemo(() => new Map<string, Day>(), [plan]);
    const reserving = (lane: string, at: Date) => {
        const id = `${lane}|${dayKey(at)}`;
        let derived = reservings.get(id);
        if (derived === undefined) {
            derived = domain.copyDay(plan);
            const bytes = value.bin.create({ at, lane, arrival: none, quantity: 0, kind: none, hold: variant("days", 0), parts: new SortedMap<string, number>([], compareString) }, none);
            const probe = domain.binOf(value.bin.read(bytes), domain.decodeRow(bytes), day);
            if (probe.type === "some") derived.bins.set(RESERVE_PROBE, probe.value);
            reservings.set(id, derived);
        }
        return derived;
    };
    // The day with a committed bin the drafts removed back on it, unlinked (and without a reservation it fills): what booking it
    // again asks the fit of (A51). The drafts are the cache's key: new drafts, a new cache.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    const restorings = useMemo(() => new Map<string, Day | undefined>(), [plan, held]);
    const restoring = (bin: string, reservation?: string) => {
        const at = `${bin}|${reservation ?? ""}`;
        if (restorings.has(at)) return restorings.get(at);
        let derived: Day | undefined;
        if (held.bins.has(bin) && !plan.bins.has(bin)) {
            derived = domain.copyDay(reservation === undefined ? plan : without(reservation));
            const back = domain.copyDay(held).bins.get(bin)!;
            back.parts.clear();
            derived.bins.set(bin, back);
        }
        restorings.set(at, derived);
        return derived;
    };
    // The day's first free slot, by time then lane, of the lanes that show: where booking onto a resource lands (A36).
    const firstFree = () => {
        const free = slots.find(s => s.status.type === "free" && (lanesShown.keys.type === "none" || lanesShown.keys.value.has(s.lane)));
        return free === undefined ? undefined : { lane: free.lane, at: free.at };
    };
    const nouns = value.labels;
    const scene: DropScene = { day, plan, held, context, slots, fit, commands, without, restoring, firstFree, notice: setNotice,
        laneLabel: lane => value.lanes.find(l => l.key === lane)?.label ?? lane, nouns };
    // The picked card's grip: its fits show as a drag's do, and its click books as its drop would (A11).
    const pickGrip: LibraryGrip | undefined = pick?.kind === "arrival" || pick?.kind === "removed" ? pick : undefined;
    const drag = useAllocationDrag(key, commands.canEdit() && !narrow, scene, setRefusal, pickGrip);
    // A verdict a click ran (A11, A53): its refusal shown as a drop's is, else its command.
    const runVerdict = useCallback((verdict: Verdict) => {
        if (verdict.pending) return;
        if (!verdict.allowed) { setRefusal(verdict.refusal); return; }
        setRefusal(undefined);
        verdict.run?.();
    }, []);
    const bookPicked = (target: Target) => { if (pickGrip !== undefined && commands.canEdit()) runVerdict(drag.verdict(pickGrip, target)); };
    const highlight = pick?.kind === "bins" ? pick.arrival : undefined;
    // The Library (A50–A54): its open tab kept, as the pane keeps its own.
    const { state: libraryTab, setState: setLibraryTab } = usePersistedState<{ tab: string }>(`${key}.library.tab`, { tab: "arrivals" });
    const lines = useMemo(() => new Map(value.resources.map(r => [r.key, allocationWords().line(day, r, loads.get(r.key)!, context.unit)] as const)),
        [value.resources, loads, day, context.unit]);
    // A find's question (A73, A74): the bin's unallocated quantity placed, asked of the drafts as they are and again as they change (F1).
    // A find whose bin is gone, or wholly allocated, is done.
    const findBin = find === undefined ? undefined : plan.bins.get(find);
    const findAsk = find === undefined || findBin === undefined || compareFloat(remainderOf(findBin), 0) <= 0 ? undefined : placeAsk(plan, { kind: "port", bin: find });
    const findKey = findAsk === undefined ? "" : `${find}|${findAsk.quantity}`;
    useEffect(() => { if (findAsk !== undefined) askFit(findAsk.ask); },
        // The question stands for its bin, its quantity and the drafts.
        // eslint-disable-next-line react-hooks/exhaustive-deps
        [findKey, plan, askFit]);
    useEffect(() => { if (find !== undefined && findKey === "") setFind(undefined); }, [find, findKey]);
    const findAnswer = findAsk === undefined ? undefined : fit.answer(findAsk.ask);
    // While its answer for the drafts as they are is on its way, the find's buttons read `Finding…` and its tab is busy (F2).
    const finding = useCallback((bin: string) => bin === find && findKey !== "" && findAnswer === undefined && fit.error === undefined,
        [find, findKey, findAnswer, fit.error]);
    const libraryFind: ResourceFind | undefined = find === undefined || findAsk === undefined || findBin === undefined ? undefined
        : { bin: find, label: `${binCode(context, findBin)} · ${allocationWords().quantity(findAsk.quantity, context.unit)}`, shown: findAnswer, busy: finding(find) };
    // Find a fit opens the Library's Resources tab, where its result is: with no such tab, nothing offers it.
    const findable = value.library.some(tab => tab.type === "resources");
    const onFind = (bin: string) => {
        setFind(bin); setLibraryTab({ tab: "resources" }); revealPane("Library");
        // Pressed again after the fit failed, a find is asked again.
        if (fit.error !== undefined) fit.retry();
    };
    const start = useAllocationLibrary({
        value, context, day, plan, held, loads, lines, styles, layout: window.view.layout, narrow, drag, commands, selection, pick,
        tab: libraryTab.tab, onTab: tab => setLibraryTab({ tab }), onVerdict: runVerdict,
        shown: { arrivals: arrivalsSource, resources: resourcesSource }, find: libraryFind, onClearFind: () => setFind(undefined),
        arrivalsFlash: landing.lit && optimised?.arrivalsChanged === true,
        // A9: an arrival's card picks it, again unpicks it; a selected free slot or reservation stays selected. A pick's fits are Details' (A34).
        onArrival: grip => {
            const same = pick !== undefined && pick.kind === grip.kind && (grip.kind === "arrival" ? pick.kind === "arrival" && pick.arrival === grip.arrival : pick.kind === "removed" && pick.bin === grip.bin);
            const keep = selection?.type === "slot" || (selection?.type === "bin" && plan.bins.get(selection.id)?.arrival.type === "none") ? selection : undefined;
            setSelection(keep); setLink(undefined); setNotice(undefined); setRefusal(undefined); setChooser(undefined);
            setPick(same ? undefined : grip);
            if (!same) setInspectorTab({ tab: "details" });
        },
        // A9: a resource card picks it for the selected free slot; otherwise it selects the resource, or unselects it.
        onResource: resource => {
            if (selection?.type === "slot") { setPick(pick?.kind === "resource" && pick.resource === resource ? undefined : { kind: "resource", resource }); return; }
            inspect(selection?.type === "resource" && selection.key === resource ? undefined : { type: "resource", key: resource });
        },
        // A10: an Allocated card selects the arrival's first bin, and highlights every bin of it; again, it clears.
        onAllocated: (arrival, bins) => {
            if (pick?.kind === "bins" && pick.arrival === arrival) { select(undefined); return; }
            inspect({ type: "bin", id: bins[0]! });
            if (bins.length > 1) setPick({ kind: "bins", arrival });
        },
    });
    // The Inspector (A55–A64): the end pane, its edits the same commands, its fits the same answers.
    const end = useAllocationInspector({
        value, domain, context, day, plan, held, loads, lines, slots, issues, layout: window.view.layout, selection, inspect, drag, fit, commands,
        without, reserving, shown: { lanes: lanesShown.keys, resources: resourcesShown.keys, arrivals: arrivalsShown.keys },
        refusal, dismissRefusal: () => setRefusal(undefined), chooser, setChooser, book: bookPicked, firstFree,
        tab: inspectorTab.tab, onTab: tab => setInspectorTab({ tab }), storageKey: key, onFind: findable ? onFind : undefined, finding, m: words.m,
    });
    // Nothing above the board comes or goes during a drag (A22): a failed fit's banner waits for the drop.
    const [fitError, setFitError] = useState<string>();
    useEffect(() => { if (drag.grip === undefined) setFitError(fit.error); }, [drag.grip, fit.error]);
    // The selected bin is the board's subject at rest: its connector's question is asked before a drag needs it (A23, F1).
    const selectedBin = selection?.type === "bin" ? selection.id : undefined;
    useEffect(() => {
        const asked = selectedBin === undefined ? undefined : placeAsk(plan, { kind: "port", bin: selectedBin });
        if (asked !== undefined) askFit(asked.ask);
    }, [selectedBin, plan, askFit]);
    // The issues chip opens Inspector › Issues (A64).
    const onIssues = () => { setInspectorTab({ tab: "issues" }); revealPane("Inspector"); };
    const history = editing?.history;
    const { acted } = optimiseParts;
    const onAction = useCallback((action: HistoryAction) => {
        if (locked) return;
        const active = document.activeElement; if (active instanceof HTMLElement) active.blur();
        // A run's highlight ends with Undo, Apply and Discard; a Redo of its step replays its landing (R9, R16).
        acted(action, history?.redoOrigin);
        history?.act(action);
    }, [history, locked, acted]);
    // What the footer's loading line says (#1398, CL3): the day being read; a new narrowing — the bins' own, the lanes',
    // the resources' or the arrivals' — which is the board waiting for which of its bins show, so `Filtering bins…`
    // whichever it is, the coordinator's word for them (23 Oct 2026); or why one could not be read, by its source, with
    // Retry — the day's asking again each record the day reads.
    const retryDay = useCallback(() => retryPeriod([
        { entries: value.bin.kind.entries, part: binsPart },
        ...(value.periods.type === "some" ? [{ entries: value.periods.value.entries }] : [])]), [value, binsPart]);
    const line = useMemo(() => {
        const state = periodLoading({ loading: data.loading && !data.filtering, error: data.error, retry: retryDay }, [
            { noun: BINS, ready: true, loading: data.filtering, error: undefined, retry: retryDay },
            { noun: other(nouns.lane), ...lanesShown }, { noun: other(nouns.resource), ...resourcesShown }, { noun: other(nouns.arrival), ...arrivalsShown },
        ]);
        return periodLoadingLine(state?.kind === "filtering" ? { kind: "filtering", noun: BINS } : state, dayWords);
    }, [data.loading, data.filtering, data.error, retryDay, nouns, lanesShown, resourcesShown, arrivalsShown, dayWords]);
    // What the views draw of the day (#1398): the day as read; a day not read yet, its lanes, slots and resources at once
    // and its placeholders, unseen until the frame's one reveal clock says so (CL5, CL2, CL4: `LoadingReveal` below, which
    // the footer's line and each placeholder read where they show, so its flip renders them and never this frame); or one
    // whose read failed, its geometry and the failure said once in its first row in view (CL11) — never "Allocation
    // unavailable" over the board.
    const read = useMemo(() => periodRead({ current, error: data.error, name: dayWords, retry: retryDay }), [current, data.error, dayWords, retryDay]);
    const toolbar = useAllocationToolbar({ ...window, value, styles, commands, editing, words, issues, onIssues, onAction, onPickerWeeks: setPickerWeeks,
        status: value.periods.type === "some" ? statusText(heldPeriod) : undefined, unread: !current, publishing, picker: data.picker,
        optimise: optimiseParts.toolbarItem, locked, issuesFlash: landing.lit && optimised !== undefined,
        focus: focus === undefined ? undefined : { resource: context.resources.get(focus)!, load: loads.get(focus)!, hidden: resourcesShown.keys.type === "some" && !resourcesShown.keys.value.has(focus) },
        onClearFocus: () => { setSelection(undefined); setLink(undefined); setChooser(undefined); }, nouns, search });
    const readOnly = value.settings.readOnly || (current && !editableStatus(heldPeriod.status));
    const notStarted = current && plan.bins.size === 0 && (value.periods.type === "none" || !started(period));
    // A started day with no bins, once read (#1398, CL13): said once, in the Timeline's first row in view — with how to
    // book one where the day takes edits — never before its read lands, and never as the narrowing's empty state.
    const empty = current && plan.bins.size === 0 && !notStarted
        ? { message: `No bins on ${dayWords}`, hint: commands.canEdit() ? `Drag ${a(nouns.arrival)} onto ${a(nouns.lane)} hour` : undefined } : undefined;
    /** A session's issue's place: a bin by its arrival and its slot, a day's row by its key. */
    const where = (kind: string) => (issue: { entry: string }) => {
        if (kind === PERIODS) return issue.entry;
        const bin = plan.bins.get(issue.entry) ?? held.bins.get(issue.entry);
        return bin === undefined ? issue.entry : `${binCode(context, bin)} · ${value.lanes.find(l => l.key === bin.lane)?.label ?? bin.lane} ${formatDatePattern("HH:mm", bin.at)}`;
    };
    const sessionName = (kind: string) => kind === PERIODS ? "Days" : value.bin.kind.name;
    // Cold load (#1398, CL5): no day read yet, nor a narrowing's first membership — the frame's skeleton covers it, at the
    // board's own row pitch. After it nothing covers: a day step, a narrowing or a new revision leave the frame live.
    const cold = (!data.landed && data.error === undefined) || narrowing.some(n => !n.ready && n.loading);
    // After cold load a read in flight — the day, a narrowing — leaves the frame live, main busy.
    const busy = data.loading || narrowingLoading;
    // The board's narrowing, and whether its rows are in (#1398): across a new one the Table keeps the line at the top of
    // its view where the narrowing holds it — by its key, and the px into it — and else starts at its top, as the Sheet
    // keeps its own.
    const narrowingQuery = narrowingText(value, binChoices);
    const narrowingSettled = !data.filtering && !narrowingLoading && !narrowingFailed;
    const tableNarrowing = useMemo(() => ({ query: narrowingQuery, settled: narrowingSettled }), [narrowingQuery, narrowingSettled]);
    return <NounsContext.Provider value={nouns}><BinFocusContext.Provider value={binFocused}><Box ref={root} css={[styles.root, landingStyles.main]} data-allocation-frame=""
        data-allocation-readonly={readOnly ? "" : undefined} onPointerDownCapture={dropBinFocus} onKeyDownCapture={dropBinFocus} {...landing.attributes}>
        <AllocationDataReader value={value} day={day} pickerDays={picker} choices={binChoices} onData={setData} />
        <LoadingReveal waiting={line?.kind === "loading"}>
        <BuilderFrame storageKey={`${key}.frame`} label={value.settings.title} loading={cold} loadingPitch={ROW_H} busy={busy} liveFooter toolbar={toolbar}
            start={start} end={end} onKeyDown={event => {
            // The keys, never while typing (A6); each it acts on goes no further than the board (#1398).
            if (event.defaultPrevented || typedInto(event.target)) return;
            const action = historyShortcut(event);
            if (action !== undefined && history !== undefined && !value.settings.readOnly && !locked && (commands.canEdit() || history.pending > 0)) { takeKey(event); onAction(action); }
            else if (event.key === "[" || event.key === "]") { takeKey(event); window.step(event.key === "[" ? -1 : 1); }
            // Esc closes the inspector's Chooser, else clears the pick, else the selection (A6) — none to let go of, it goes on.
            else if (event.key === "Escape" && chooser !== undefined) { takeKey(event); setChooser(undefined); }
            else if (event.key === "Escape" && pick !== undefined) { takeKey(event); setPick(undefined); }
            else if (event.key === "Escape" && (selection !== undefined || link !== undefined || notice !== undefined || error !== undefined || refusal !== undefined)) {
                takeKey(event);
                setSelection(undefined); setLink(undefined); setNotice(undefined); setError(undefined); setRefusal(undefined);
            }
            // Delete unlinks the selected link, else removes the selected bin (A6, A68).
            else if ((event.key === "Delete" || event.key === "Backspace") && link !== undefined && commands.canEdit()) { takeKey(event); commands.unlink(link.bin, link.resource); }
            else if ((event.key === "Delete" || event.key === "Backspace") && selection?.type === "bin" && commands.canEdit()) { takeKey(event); commands.remove(selection.id); }
        }} banners={<>
            {optimiseParts.banner}
            {editing?.schedule.sessions.map(part => <SessionBanners key={part.key} session={part.session} words={words} name={sessionName(part.kind)} where={where(part.kind)}
                onAction={action => editing.history.actOn(part.key, action)} />)}
            {current && heldPeriod.status.type === "published" && <BannerView status="info" title="Published day" description="Read-only view of the published plan." />}
            {current && heldPeriod.status.type === "other" && <BannerView status="info" title={`${heldPeriod.status.value} day`} description="This day is read-only." />}
            {notStarted && <BannerView status="info" title="Day not started" description={`Book ${a(nouns.arrival)} or reserve a slot to start this day's plan.`} />}
            {/* A booking onto a resource with no free slot left (A36). */}
            {notice !== undefined && <BannerView status="warning" title={notice.word} description={notice.text} dismissible onDismiss={() => setNotice(undefined)} />}
            {!custom.result.ok && <BannerView status="warning" title="Additional checks unavailable" description="The plan's additional checks could not run. Built-in checks are still shown." />}
            {lanesShown.error !== undefined && <BannerView status="error" title={`${nouns.lane.one} results unavailable`} description={lanesShown.error} actions={<Button size="xs" variant="outline" onClick={lanesShown.retry}>Retry</Button>} />}
            {resourcesShown.error !== undefined && <BannerView status="error" title={`${nouns.resource.one} results unavailable`} description={resourcesShown.error} actions={<Button size="xs" variant="outline" onClick={resourcesShown.retry}>Retry</Button>} />}
            {arrivalsShown.error !== undefined && <BannerView status="error" title={`${nouns.arrival.one} results unavailable`} description={arrivalsShown.error} actions={<Button size="xs" variant="outline" onClick={arrivalsShown.retry}>Retry</Button>} />}
            {/* A fit that failed (F3): its message, and Retry; a drop meanwhile is refused with `fits unavailable`. */}
            {fitError !== undefined && <BannerView status="error" title="Fits couldn't be checked" description={fitError} actions={<Button size="xs" variant="outline" onClick={fit.retry}>Retry</Button>} />}
            {rangeError !== undefined && <BannerView status="error" title="Day unavailable" description={rangeError} />}
            {/* A gesture's error; a read's is said once, in the board and on the footer's line (#1398, CL11). */}
            {error !== undefined && <Box css={styles.error} role="alert">{error}</Box>}
        </>} footer={<AllocationFooter styles={styles} layout={window.view.layout} line={line} optimise={{ line: optimiseParts.line, legend: optimiseParts.legend }} />}>
            <Box ref={main} css={styles.main} data-allocation-main="" data-allocation-layout={window.view.layout} data-allocation-day={dayEpoch}
                aria-disabled={retained && read.state !== "failed" ? true : undefined} data-allocation-stale={stale ? "" : undefined}
                data-allocation-narrow={narrow ? "" : undefined}>
                {/* Below 480px of main, cards with explicit actions, each one of the board's commands (A78); resizing keeps the layout, the
                    selection and the drafts, which are the frame's. */}
                {narrow ? <AllocationCards value={value} context={context} styles={styles} day={day} plan={plan} held={held}
                        sameBin={domain.sameBin} loads={loads} lines={lines} slots={slots} layout={window.view.layout} surface={drag.surface}
                        selection={selection} select={inspect} follow={follow} editable={commands.canEdit()} commands={commands} fit={fit}
                        without={without} reserving={reserving} visibleLanes={lanesShown.keys} visibleResources={resourcesShown.keys}
                        visibleArrivals={arrivalsShown.keys} clearFilters={clearFilters} read={read} optimised={optimised} lit={landing.lit}
                        bookOnto={(arrival, resource) => { setRefusal(undefined); bookOnto(scene, { kind: "arrival", arrival }, resource); }} />
                    : window.view.layout === "timeline" ? <AllocationTimeline value={value} context={context} styles={styles} format={format} day={day} plan={plan}
                        held={held} sameBin={domain.sameBin} loads={loads} slots={slots} issues={issues} visible={resourcesShown.keys} visibleLanes={lanesShown.keys}
                        visibleArrivals={arrivalsShown.keys} read={read} empty={empty} optimised={optimised} lit={landing.lit}
                        clearFilters={clearFilters} selection={selection} focus={focus} highlight={highlight} picked={pickGrip !== undefined} book={bookPicked}
                        editable={commands.canEdit()} select={inspect} choose={id => { inspect({ type: "bin", id }); setChooser(id); revealPane("Inspector"); }} follow={follow}
                        link={link} selectLink={selectLink} unlink={(bin, resource) => commands.unlink(bin, resource)} drag={drag} candidates={domain.candidates} />
                    : <AllocationTable value={value} domain={domain} context={context} styles={styles} format={format} day={day} plan={plan} held={held}
                        sameBin={domain.sameBin} loads={loads} slots={slots} selection={selection} editable={commands.canEdit()} select={inspect} follow={follow}
                        drag={drag} commands={commands} fit={fit} without={without} reserving={reserving} highlight={highlight} book={bookPicked} read={read}
                        visibleLanes={lanesShown.keys} visibleResources={resourcesShown.keys} visibleArrivals={arrivalsShown.keys} clearFilters={clearFilters}
                        anchor={anchor.table} onAnchor={onTableAnchor} narrowing={tableNarrowing} optimised={optimised} lit={landing.lit} />}
            </Box>
        </BuilderFrame>
        </LoadingReveal>
    </Box></BinFocusContext.Provider></NounsContext.Provider>;
}

/** The board over the app's records: its key, its day — written into the bins' source — and its editing, around the frame. */
function AllocationRoot({ value, storageKey }: EastChakraAllocationProps) {
    const key = `${storageKey}.${value.id.type === "some" ? value.id.value : "allocation"}`;
    const window = useAllocationWindow(value, key);
    // The bins' source of the slice holds the day, which the board's own navigation writes (D9), so the rail's count and a Save's notice
    // read the window it reads.
    const rangeError = useSourceWindow(value.slice.type === "some" ? value.slice.value : undefined, value.bin.kind.key, window.day,
        new Date(window.day.getTime() + DAY), "The day could not be applied");
    const frame = { value, storageKey: key, window, rangeError };
    return value.settings.readOnly ? <AllocationFrame {...frame} editing={undefined} /> : <EditableAllocation {...frame} />;
}

/** The e3 renderer owns the frame; callers author only the Allocation tag and its bound data. */
export function EastChakraAllocation(props: EastChakraAllocationProps) {
    const error = configError(props.value);
    return error === undefined ? <AllocationRoot {...props} /> : <BannerView status="error" title="Allocation configuration" description={error} />;
}
implementUIComponent(AllocationComponent, EastChakraAllocation);
