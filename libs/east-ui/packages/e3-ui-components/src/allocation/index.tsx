/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

/**
 * The Allocation's renderer (`Allocation Spec.md`): the board in its
 * BuilderFrame — one toolbar, the banners, the panes, the footer's legend and
 * the loading cover — over the plans record, a day at a time, each day its own
 * shared editing session (#1325). Below 480px of main, the Timeline and the
 * Table are cards with explicit actions, and nothing takes a drag (#1333).
 *
 * @packageDocumentation
 */

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { SortedMap, none, variant } from "@elaraai/east";
import { Box, Button, useSlotRecipe } from "@chakra-ui/react";
import { AllocationComponent } from "@elaraai/e3-ui/internal";
import {
    BannerView, BuilderFrame, SessionBanners, editingMessages, historyShortcut, implementUIComponent, typedInto, useContainerBelow, useFormatters,
    usePersistedState, useTrackedEvaluation, type HistoryAction,
} from "@elaraai/east-ui-components";
import { StatusDisplay } from "../components/StatusDisplay.js";
import { allocationCommands, remainderOf } from "./actions.js";
import { AllocationCards } from "./cards.js";
import { bookOnto, placeAsk, useAllocationDrag, type DropScene, type LibraryGrip, type Refusal, type Target, type Verdict } from "./drag.js";
import { useAllocationInspector } from "./inspector.js";
import { binCode } from "./inspector-model.js";
import { useAllocationLibrary, type Pick, type ResourceFind } from "./library.js";
import { useAllocationFit } from "./fit.js";
import { useAllocationData } from "./data.js";
import { useAllocationEditing } from "./editing.js";
import { AllocationFooter } from "./footer.js";
import {
    NARROW_WIDTH, allocationContext, allocationDomain, allocationWords, compareFloat, compareString, configError, dayKey, focusOf, type AllocationStyles, type AllocationValue,
    type Bin, type Day, type Issue, type Selection,
} from "./model.js";
import { AllocationTable, RESERVE_PROBE } from "./table.js";
import { AllocationTimeline, type SelectedLink, type TimelineFollow } from "./timeline.js";
import { pickerDays, useAllocationToolbar } from "./toolbar.js";
import { useAllocationWindow } from "./window.js";
import { narrowingPart, useNarrowed } from "./narrowed.js";
import { useSourceShown } from "../shared/schedule/source-tab.js";
import { NounsContext, a } from "./nouns.js";
export type { AllocationValue } from "./model.js";

/** Props of the record-backed Allocation extension. */
export interface EastChakraAllocationProps { value: AllocationValue; storageKey: string }
const NO_DATES: readonly Date[] = [];

function AllocationFrame({ value, storageKey }: EastChakraAllocationProps) {
    const key = `${storageKey}.${value.id.type === "some" ? value.id.value : "allocation"}`;
    const domain = useMemo(() => allocationDomain(value.valuesType), [value.valuesType]);
    const window = useAllocationWindow(value, key);
    const [pickerWeeks, setPickerWeeks] = useState(NO_DATES);
    const picker = useMemo(() => pickerDays(pickerWeeks), [pickerWeeks]);
    const data = useAllocationData(value, domain, window.day, picker);
    const editing = useAllocationEditing(value, domain, window.day, key, data);
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
    // The narrowing chooses which lanes, resources and events show, read from the slice itself (#1336, #1339); fits, checks and totals read every one.
    const lanesShown = useNarrowed(value, "lanes", value.lanes);
    const resourcesShown = useNarrowed(value, "resources", value.resources);
    const eventsShown = useNarrowed(value, "events", value.events);
    const narrowing = [lanesShown, resourcesShown, eventsShown];
    // What the rail shows of each Library tab's source, and how that source alone clears (A98).
    const eventsSource = useSourceShown(eventsShown, narrowingPart(value, "events"));
    const resourcesSource = useSourceShown(resourcesShown, narrowingPart(value, "resources"));
    const narrowingLoading = narrowing.some(n => n.loading), narrowingFailed = narrowing.some(n => n.error !== undefined);
    const clearFilters = value.slice.type === "some" ? value.slice.value.slice.clearAll : undefined;
    const root = useRef<HTMLDivElement>(null), main = useRef<HTMLDivElement>(null);
    const narrow = useContainerBelow(main, NARROW_WIDTH);
    const revealPane = (label: string) => root.current?.querySelector<HTMLButtonElement>(`button[aria-label="Expand ${label}"]`)?.click();
    // Another day: its own selection, pick and refusal, and no find — a find is its bin's, on the day it was asked of.
    const dayEpoch = window.day.getTime();
    useEffect(() => {
        setSelection(undefined); setLink(undefined); setPick(undefined); setNotice(undefined); setError(undefined); setRefusal(undefined); setChooser(undefined); setFind(undefined);
    }, [dayEpoch]);
    // Another layout closes the selected link (A7), and shows the selection there.
    useEffect(() => { setLink(undefined); setFollow(before => before.nonce === 0 ? before : { nonce: before.nonce + 1, soft: false }); }, [window.view.layout]);
    const recipe = useSlotRecipe({ key: "allocationBuilder" });
    const styles = useMemo(() => recipe({}) as unknown as AllocationStyles, [recipe]);
    const format = useFormatters(), words = useMemo(() => ({ ...format, m: editingMessages }), [format]);
    const context = useMemo(() => allocationContext(value), [value]);
    const plan = editing.plan;
    const loads = useMemo(() => domain.loads(window.day, plan, context), [domain, window.day, plan, context]);
    const builtIn = useMemo(() => domain.check(window.day, plan, context), [domain, window.day, plan, context]);
    const slots = useMemo(() => domain.slots(window.day, plan, context), [domain, window.day, plan, context]);
    const focus = focusOf(selection, plan);
    // The app's check, after the built-in ones wherever issues show; a check that fails leaves them shown.
    const readCheck = useCallback((): Issue[] => value.check.type === "some"
        ? value.check.value(domain.encodeCheckContext({ day: window.day, plan, context, loads })) : [], [value.check, domain, window.day, plan, context, loads]);
    const custom = useTrackedEvaluation(readCheck);
    const issues = useMemo(() => [...builtIn, ...(custom.result.ok ? custom.result.value : [])], [builtIn, custom.result]);
    // Commands update what is selected without changing the panes or their tabs.
    const commands = allocationCommands(value, domain, editing, select);
    // The app's fit (§12): every verdict a drag or a pick shows is its answer.
    const fit = useAllocationFit(value, domain, window.day, plan, context);
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
    // The day with a probe reservation in a free slot: what a free Table row's resource Chooser asks the fit of (A48).
    // eslint-disable-next-line react-hooks/exhaustive-deps
    const reservings = useMemo(() => new Map<string, Day>(), [plan]);
    const reserving = (lane: string, at: Date) => {
        const key = `${lane}|${dayKey(at)}`;
        let derived = reservings.get(key);
        if (derived === undefined) {
            derived = domain.copyDay(plan);
            derived.bins.set(RESERVE_PROBE, { lane, at, event: none, quantity: 0, kind: none, hold: variant("days", 0),
                parts: new SortedMap([], compareString), values: domain.blankValues() } as Bin);
            reservings.set(key, derived);
        }
        return derived;
    };
    // The day with a committed bin the drafts removed back on it, unlinked (and without a reservation it fills): what booking it
    // again asks the fit of (A51). The drafts are the cache's key: new drafts, a new cache.
    const held = editing.held;
    // eslint-disable-next-line react-hooks/exhaustive-deps
    const restorings = useMemo(() => new Map<string, Day | undefined>(), [plan, held]);
    const restoring = (bin: string, reservation?: string) => {
        const at = `${bin}|${reservation ?? ""}`;
        if (restorings.has(at)) return restorings.get(at);
        let derived: Day | undefined;
        const was = held?.bins.get(bin);
        if (was !== undefined && !plan.bins.has(bin)) {
            derived = domain.copyDay(reservation === undefined ? plan : without(reservation));
            const back = domain.copyDay(held!).bins.get(bin)!;
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
    const scene: DropScene = { day: window.day, plan, held, context, slots, fit, commands, without, restoring, firstFree, notice: setNotice,
        laneLabel: lane => value.lanes.find(l => l.key === lane)?.label ?? lane, nouns };
    // The picked card's grip: its fits show as a drag's do, and its click books as its drop would (A11).
    const pickGrip: LibraryGrip | undefined = pick?.kind === "event" || pick?.kind === "removed" ? pick : undefined;
    const drag = useAllocationDrag(key, commands.canEdit() && !narrow, scene, setRefusal, pickGrip);
    // A verdict a click ran (A11, A53): its refusal shown as a drop's is, else its command.
    const runVerdict = useCallback((verdict: Verdict) => {
        if (verdict.pending) return;
        if (!verdict.allowed) { setRefusal(verdict.refusal); return; }
        setRefusal(undefined);
        verdict.run?.();
    }, []);
    const bookPicked = (target: Target) => { if (pickGrip !== undefined && commands.canEdit()) runVerdict(drag.verdict(pickGrip, target)); };
    const highlight = pick?.kind === "bins" ? pick.event : undefined;
    // The Library (A50–A54): its open tab kept, as the pane keeps its own.
    const { state: libraryTab, setState: setLibraryTab } = usePersistedState<{ tab: string }>(`${key}.library.tab`, { tab: "events" });
    const lines = useMemo(() => new Map(value.resources.map(r => [r.key, allocationWords().line(window.day, r, loads.get(r.key)!, context.unit)] as const)),
        [value.resources, loads, window.day, context.unit]);
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
        value, context, day: window.day, plan, held, loads, lines, styles, layout: window.view.layout, narrow, drag, commands, selection, pick,
        tab: libraryTab.tab, onTab: tab => setLibraryTab({ tab }), onVerdict: runVerdict,
        shown: { events: eventsSource, resources: resourcesSource }, find: libraryFind, onClearFind: () => setFind(undefined),
        // A9: an event card picks it, again unpicks it; a selected free slot or reservation stays selected. A pick's fits are Details' (A34).
        onEvent: grip => {
            const same = pick !== undefined && pick.kind === grip.kind && (grip.kind === "event" ? pick.kind === "event" && pick.event === grip.event : pick.kind === "removed" && pick.bin === grip.bin);
            const keep = selection?.type === "slot" || (selection?.type === "bin" && plan.bins.get(selection.id)?.event.type === "none") ? selection : undefined;
            setSelection(keep); setLink(undefined); setNotice(undefined); setRefusal(undefined); setChooser(undefined);
            setPick(same ? undefined : grip);
            if (!same) setInspectorTab({ tab: "details" });
        },
        // A9: a resource card picks it for the selected free slot; otherwise it selects the resource, or unselects it.
        onResource: resource => {
            if (selection?.type === "slot") { setPick(pick?.kind === "resource" && pick.resource === resource ? undefined : { kind: "resource", resource }); return; }
            inspect(selection?.type === "resource" && selection.key === resource ? undefined : { type: "resource", key: resource });
        },
        // A10: an Allocated card selects the event's first bin, and highlights every bin of it; again, it clears.
        onAllocated: (event, bins) => {
            if (pick?.kind === "bins" && pick.event === event) { select(undefined); return; }
            inspect({ type: "bin", id: bins[0]! });
            if (bins.length > 1) setPick({ kind: "bins", event });
        },
    });
    // The Inspector (A55–A64): the end pane, its edits the same commands, its fits the same answers.
    const end = useAllocationInspector({
        value, domain, context, day: window.day, plan, held, loads, lines, slots, issues, layout: window.view.layout, selection, inspect, drag, fit, commands,
        without, reserving, shown: { lanes: lanesShown.keys, resources: resourcesShown.keys, events: eventsShown.keys },
        refusal, dismissRefusal: () => setRefusal(undefined), chooser, setChooser, book: bookPicked, firstFree,
        tab: inspectorTab.tab, onTab: tab => setInspectorTab({ tab }), storageKey: key, onFind: findable ? onFind : undefined, finding,
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
    const onAction = useCallback((action: HistoryAction) => { const active = document.activeElement; if (active instanceof HTMLElement) active.blur(); editing.history.act(action); }, [editing.history]);
    const toolbar = useAllocationToolbar({ ...window, value, styles, commands, words, days: data.days, issues, onIssues, onAction, onPickerWeeks: setPickerWeeks,
        focus: focus === undefined ? undefined : { resource: context.resources.get(focus)!, load: loads.get(focus)!, hidden: resourcesShown.keys.type === "some" && !resourcesShown.keys.value.has(focus) },
        onClearFocus: () => { setSelection(undefined); setLink(undefined); setChooser(undefined); }, nouns });
    const published = editing.held?.status.type === "published";
    const notStarted = !data.loading && data.error === undefined && editing.held === undefined && plan.bins.size === 0;
    return <NounsContext.Provider value={nouns}><Box ref={root} css={styles.root} data-allocation-frame="" data-allocation-readonly={published || value.settings.readOnly ? "" : undefined}>
        <BuilderFrame storageKey={`${key}.frame`} label={value.settings.title} loading={(data.loading && data.error === undefined) || narrowing.some(n => !n.ready && n.loading)} toolbar={toolbar}
            start={start} end={end} onKeyDown={event => {
            // The keys, never while typing (A6).
            if (event.defaultPrevented || typedInto(event.target)) return;
            const action = historyShortcut(event);
            if (action !== undefined && !value.settings.readOnly && !published) { event.preventDefault(); onAction(action); }
            else if (event.key === "[" || event.key === "]") { event.preventDefault(); window.step(event.key === "[" ? -1 : 1); }
            // Esc closes the inspector's Chooser, else clears the pick, else the selection (A6).
            else if (event.key === "Escape" && chooser !== undefined) setChooser(undefined);
            else if (event.key === "Escape" && pick !== undefined) setPick(undefined);
            else if (event.key === "Escape") { setSelection(undefined); setLink(undefined); setNotice(undefined); setError(undefined); setRefusal(undefined); }
            // Delete unlinks the selected link, else removes the selected bin (A6, A68).
            else if ((event.key === "Delete" || event.key === "Backspace") && link !== undefined && commands.canEdit()) { event.preventDefault(); commands.unlink(link.bin, link.resource); }
            else if ((event.key === "Delete" || event.key === "Backspace") && selection?.type === "bin" && commands.canEdit()) { event.preventDefault(); commands.remove(selection.id); }
        }} banners={<>
            {editing.session !== undefined && <SessionBanners session={editing.session} words={words} onAction={action => editing.history.actOn(editing.key, action)} />}
            {published && <BannerView status="info" title="Published day" description="Read-only view of the published plan." />}
            {notStarted && <BannerView status="info" title="Day not started" description={`Book ${a(nouns.event)} or reserve a slot to start this day's plan.`} />}
            {/* A booking onto a resource with no free slot left (A36). */}
            {notice !== undefined && <BannerView status="warning" title={notice.word} description={notice.text} dismissible onDismiss={() => setNotice(undefined)} />}
            {!custom.result.ok && <BannerView status="warning" title="Additional checks unavailable" description="The plan's additional checks could not run. Built-in checks are still shown." />}
            {lanesShown.error !== undefined && <BannerView status="error" title={`${nouns.lane.one} results unavailable`} description={lanesShown.error} actions={<Button size="xs" variant="outline" onClick={lanesShown.retry}>Retry</Button>} />}
            {resourcesShown.error !== undefined && <BannerView status="error" title={`${nouns.resource.one} results unavailable`} description={resourcesShown.error} actions={<Button size="xs" variant="outline" onClick={resourcesShown.retry}>Retry</Button>} />}
            {eventsShown.error !== undefined && <BannerView status="error" title={`${nouns.event.one} results unavailable`} description={eventsShown.error} actions={<Button size="xs" variant="outline" onClick={eventsShown.retry}>Retry</Button>} />}
            {/* A fit that failed (F3): its message, and Retry; a drop meanwhile is refused with `fits unavailable`. */}
            {fitError !== undefined && <BannerView status="error" title="Fits couldn't be checked" description={fitError} actions={<Button size="xs" variant="outline" onClick={fit.retry}>Retry</Button>} />}
            {(error ?? data.error) !== undefined && <Box css={styles.error} role="alert">{error ?? data.error}</Box>}
        </>} footer={<AllocationFooter styles={styles} layout={window.view.layout} narrow={narrow} />}>
            <Box ref={main} css={styles.main} data-allocation-main="" data-allocation-layout={window.view.layout} data-allocation-day={dayEpoch}
                aria-busy={(data.loading && data.error === undefined) || narrowingLoading} inert={narrowingLoading || narrowingFailed ? true : undefined}
                data-allocation-narrow={narrow ? "" : undefined}>
                {data.loading && data.error !== undefined ? <StatusDisplay variant="error" title="Allocation unavailable" message={data.error} />
                    // Below 480px of main, cards with explicit actions, each one of the board's commands (A78); resizing keeps the layout, the
                    // selection and the drafts, which are the frame's.
                    : narrow ? <AllocationCards value={value} context={context} styles={styles} day={window.day} plan={plan} held={editing.held}
                        sameBin={domain.sameBin} loads={loads} lines={lines} slots={slots} layout={window.view.layout} surface={drag.surface}
                        selection={selection} select={inspect} follow={follow} editable={commands.canEdit()} commands={commands} fit={fit}
                        without={without} reserving={reserving} visibleLanes={lanesShown.keys} visibleResources={resourcesShown.keys}
                        visibleEvents={eventsShown.keys} clearFilters={clearFilters}
                        bookOnto={(event, resource) => { setRefusal(undefined); bookOnto(scene, { kind: "event", event }, resource); }} />
                    : window.view.layout === "timeline" ? <AllocationTimeline value={value} context={context} styles={styles} format={format} day={window.day} plan={plan}
                        held={editing.held} sameBin={domain.sameBin} loads={loads} slots={slots} issues={issues} visible={resourcesShown.keys} visibleLanes={lanesShown.keys}
                        visibleEvents={eventsShown.keys}
                        clearFilters={clearFilters} selection={selection} focus={focus} highlight={highlight} picked={pickGrip !== undefined} book={bookPicked}
                        editable={commands.canEdit()} select={inspect} choose={id => { inspect({ type: "bin", id }); setChooser(id); revealPane("Inspector"); }} follow={follow}
                        link={link} selectLink={selectLink} unlink={(bin, resource) => commands.unlink(bin, resource)} drag={drag} candidates={domain.candidates} />
                    : <AllocationTable value={value} domain={domain} context={context} styles={styles} format={format} day={window.day} plan={plan} held={editing.held}
                        sameBin={domain.sameBin} loads={loads} slots={slots} selection={selection} editable={commands.canEdit()} select={inspect} follow={follow}
                        drag={drag} commands={commands} fit={fit} without={without} reserving={reserving} highlight={highlight} book={bookPicked}
                        visibleLanes={lanesShown.keys} visibleResources={resourcesShown.keys} visibleEvents={eventsShown.keys} clearFilters={clearFilters} />}
            </Box>
        </BuilderFrame>
    </Box></NounsContext.Provider>;
}

/** The e3 renderer owns the frame; callers author only the Allocation tag and its bound data. */
export function EastChakraAllocation(props: EastChakraAllocationProps) {
    const error = configError(props.value);
    return error === undefined ? <AllocationFrame {...props} /> : <BannerView status="error" title="Allocation configuration" description={error} />;
}
implementUIComponent(AllocationComponent, EastChakraAllocation);
