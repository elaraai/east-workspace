/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

/**
 * The Allocation's renderer (`Allocation Spec.md`): the board in its
 * BuilderFrame — one toolbar, the banners, the panes, the footer's legend and
 * the loading cover — over the plans record, a day at a time, each day its own
 * shared editing session (#1325).
 *
 * @packageDocumentation
 */

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { SortedMap, none, variant } from "@elaraai/east";
import { Box, Button, useSlotRecipe } from "@chakra-ui/react";
import { AllocationComponent } from "@elaraai/e3-ui/internal";
import {
    BannerView, BuilderFrame, SessionBanners, editingMessages, historyShortcut, implementUIComponent, typedInto, useContainerBelow, useFormatters,
    useTrackedEvaluation, type HistoryAction,
} from "@elaraai/east-ui-components";
import { StatusDisplay } from "../components/StatusDisplay.js";
import { allocationCommands } from "./actions.js";
import { placeAsk, useAllocationDrag, type DropScene, type Refusal } from "./drag.js";
import { useAllocationFit } from "./fit.js";
import { useAllocationData } from "./data.js";
import { useAllocationEditing } from "./editing.js";
import { AllocationFooter } from "./footer.js";
import { NARROW_WIDTH, allocationContext, allocationDomain, compareString, configError, dayKey, focusOf, type AllocationStyles, type AllocationValue, type Bin, type Day, type Issue, type Selection } from "./model.js";
import { AllocationTable, RESERVE_PROBE } from "./table.js";
import { AllocationTimeline, type SelectedLink, type TimelineFollow } from "./timeline.js";
import { pickerDays, useAllocationToolbar } from "./toolbar.js";
import { useAllocationWindow } from "./window.js";
import { useKeyVisibility } from "../shared/schedule/visibility.js";
export type { AllocationValue } from "./model.js";

/** Props of the record-backed Allocation extension. */
export interface EastChakraAllocationProps { value: AllocationValue; storageKey: string }
const NO_DATES: readonly Date[] = [];
const VISIBILITY_WORDS = { changed: "Resource results changed; retry the narrowing.", failed: "Could not load resource results" };

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
    // Selecting follows the selection (A12); a selection a command makes after a drop follows it softly.
    const [follow, setFollow] = useState<TimelineFollow>({ nonce: 0, soft: false });
    const select = useCallback((next: Selection | undefined, soft = false) => {
        setSelection(next);
        setLink(undefined);
        if (next !== undefined) setFollow(before => ({ nonce: before.nonce + 1, soft }));
    }, []);
    const selectLink = useCallback((next: SelectedLink) => { select({ type: "bin", id: next.bin }); setLink(next); }, [select]);
    const [error, setError] = useState<string>();
    // A refused drop's reason (A40): it adds no banner; the inspector (#1331) shows it at its top until the next action.
    const [_refusal, setRefusal] = useState<Refusal>();
    // The narrowing chooses which rows the Timeline shows; fits, checks and totals read every resource.
    const visibility = useKeyVisibility({ visibleSource: value.visibleSource, visible: value.visibleResources, rows: value.resources, recordSlice: value.recordSlice }, VISIBILITY_WORDS);
    const root = useRef<HTMLDivElement>(null), main = useRef<HTMLDivElement>(null);
    const narrow = useContainerBelow(main, NARROW_WIDTH);
    const revealPane = (label: string) => root.current?.querySelector<HTMLButtonElement>(`button[aria-label="Expand ${label}"]`)?.click();
    // Another day: its own selection and refusal.
    const dayEpoch = window.day.getTime();
    useEffect(() => { setSelection(undefined); setLink(undefined); setError(undefined); setRefusal(undefined); }, [dayEpoch]);
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
    const scene: DropScene = { plan, context, slots, fit, commands, without, laneLabel: lane => value.lanes.find(l => l.key === lane)?.label ?? lane };
    const drag = useAllocationDrag(key, commands.canEdit() && !narrow, scene, setRefusal);
    // Nothing above the board comes or goes during a drag (A22): a failed fit's banner waits for the drop.
    const [fitError, setFitError] = useState<string>();
    useEffect(() => { if (drag.grip === undefined) setFitError(fit.error); }, [drag.grip, fit.error]);
    // The selected bin is the board's subject at rest: its connector's question is asked before a drag needs it (A23, F1).
    const selectedBin = selection?.type === "bin" ? selection.id : undefined;
    const { ask: askFit } = fit;
    useEffect(() => {
        const asked = selectedBin === undefined ? undefined : placeAsk(plan, { kind: "port", bin: selectedBin });
        if (asked !== undefined) askFit(asked.ask);
    }, [selectedBin, plan, askFit]);
    const onIssues = () => revealPane("Inspector");
    const onAction = useCallback((action: HistoryAction) => { const active = document.activeElement; if (active instanceof HTMLElement) active.blur(); editing.history.act(action); }, [editing.history]);
    const toolbar = useAllocationToolbar({ ...window, value, styles, commands, words, days: data.days, issues, onIssues, onAction, onPickerWeeks: setPickerWeeks,
        focus: focus === undefined ? undefined : { resource: context.resources.get(focus)!, load: loads.get(focus)!, hidden: visibility.keys.type === "some" && !visibility.keys.value.has(focus) },
        onClearFocus: () => { setSelection(undefined); setLink(undefined); } });
    const published = editing.held?.status.type === "published";
    const notStarted = !data.loading && data.error === undefined && editing.held === undefined && plan.bins.size === 0;
    return <Box ref={root} css={styles.root} data-allocation-frame="" data-allocation-readonly={published || value.settings.readOnly ? "" : undefined}>
        <BuilderFrame storageKey={`${key}.frame`} label={value.settings.title} loading={(data.loading && data.error === undefined) || (!visibility.ready && visibility.loading)} toolbar={toolbar} onKeyDown={event => {
            // The keys, never while typing (A6).
            if (event.defaultPrevented || typedInto(event.target)) return;
            const action = historyShortcut(event);
            if (action !== undefined && !value.settings.readOnly && !published) { event.preventDefault(); onAction(action); }
            else if (event.key === "[" || event.key === "]") { event.preventDefault(); window.step(event.key === "[" ? -1 : 1); }
            else if (event.key === "Escape") { setSelection(undefined); setLink(undefined); setError(undefined); setRefusal(undefined); }
            // Delete unlinks the selected link, else removes the selected bin (A6, A68).
            else if ((event.key === "Delete" || event.key === "Backspace") && link !== undefined && commands.canEdit()) { event.preventDefault(); commands.unlink(link.bin, link.resource); }
            else if ((event.key === "Delete" || event.key === "Backspace") && selection?.type === "bin" && commands.canEdit()) { event.preventDefault(); commands.remove(selection.id); }
        }} banners={<>
            {editing.session !== undefined && <SessionBanners session={editing.session} words={words} onAction={action => editing.history.actOn(editing.key, action)} />}
            {published && <BannerView status="info" title="Published day" description="Read-only view of the published plan." />}
            {notStarted && <BannerView status="info" title="Day not started" description="Book an event or reserve a slot to start this day's plan." />}
            {!custom.result.ok && <BannerView status="warning" title="Additional checks unavailable" description="The plan's additional checks could not run. Built-in checks are still shown." />}
            {visibility.error !== undefined && <BannerView status="error" title="Resource results unavailable" description={visibility.error} actions={<Button size="xs" variant="outline" onClick={visibility.retry}>Retry</Button>} />}
            {/* A fit that failed (F3): its message, and Retry; a drop meanwhile is refused with `fits unavailable`. */}
            {fitError !== undefined && <BannerView status="error" title="Fits couldn't be checked" description={fitError} actions={<Button size="xs" variant="outline" onClick={fit.retry}>Retry</Button>} />}
            {(error ?? data.error) !== undefined && <Box css={styles.error} role="alert">{error ?? data.error}</Box>}
        </>} footer={<AllocationFooter styles={styles} layout={window.view.layout} narrow={narrow} />}>
            <Box ref={main} css={styles.main} data-allocation-main="" data-allocation-layout={window.view.layout} data-allocation-day={dayEpoch}
                aria-busy={(data.loading && data.error === undefined) || visibility.loading} inert={visibility.loading || visibility.error !== undefined ? true : undefined}
                data-allocation-narrow={narrow ? "" : undefined}>
                {data.loading && data.error !== undefined ? <StatusDisplay variant="error" title="Allocation unavailable" message={data.error} />
                    : window.view.layout === "timeline" ? <AllocationTimeline value={value} context={context} styles={styles} format={format} day={window.day} plan={plan}
                        held={editing.held} sameBin={domain.sameBin} loads={loads} slots={slots} issues={issues} visible={visibility.keys} selection={selection} focus={focus}
                        editable={commands.canEdit()} select={select} choose={id => { select({ type: "bin", id }); revealPane("Inspector"); }} follow={follow}
                        link={link} selectLink={selectLink} unlink={(bin, resource) => commands.unlink(bin, resource)} drag={drag} candidates={domain.candidates} />
                    : <AllocationTable value={value} domain={domain} context={context} styles={styles} format={format} day={window.day} plan={plan} held={editing.held}
                        sameBin={domain.sameBin} loads={loads} slots={slots} selection={selection} editable={commands.canEdit()} select={select} follow={follow}
                        drag={drag} commands={commands} fit={fit} without={without} reserving={reserving} />}
            </Box>
        </BuilderFrame>
    </Box>;
}

/** The e3 renderer owns the frame; callers author only the Allocation tag and its bound data. */
export function EastChakraAllocation(props: EastChakraAllocationProps) {
    const error = configError(props.value);
    return error === undefined ? <AllocationFrame {...props} /> : <BannerView status="error" title="Allocation configuration" description={error} />;
}
implementUIComponent(AllocationComponent, EastChakraAllocation);
