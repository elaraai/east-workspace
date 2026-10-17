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
import { Box, useSlotRecipe } from "@chakra-ui/react";
import { AllocationComponent } from "@elaraai/e3-ui/internal";
import {
    BannerView, BuilderFrame, SessionBanners, editingMessages, historyShortcut, implementUIComponent, typedInto, useContainerBelow, useFormatters,
    useTrackedEvaluation, type HistoryAction,
} from "@elaraai/east-ui-components";
import { StatusDisplay } from "../components/StatusDisplay.js";
import { allocationCommands } from "./actions.js";
import { useAllocationData } from "./data.js";
import { useAllocationEditing } from "./editing.js";
import { AllocationFooter } from "./footer.js";
import { NARROW_WIDTH, allocationContext, allocationDomain, configError, type AllocationStyles, type AllocationValue, type Issue, type Selection } from "./model.js";
import { pickerDays, useAllocationToolbar } from "./toolbar.js";
import { useAllocationWindow } from "./window.js";
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
    const [error, setError] = useState<string>();
    const root = useRef<HTMLDivElement>(null), main = useRef<HTMLDivElement>(null);
    const narrow = useContainerBelow(main, NARROW_WIDTH);
    const revealPane = (label: string) => root.current?.querySelector<HTMLButtonElement>(`button[aria-label="Expand ${label}"]`)?.click();
    // Another day: its own selection and refusal.
    const dayEpoch = window.day.getTime();
    useEffect(() => { setSelection(undefined); setError(undefined); }, [dayEpoch]);
    const recipe = useSlotRecipe({ key: "allocationBuilder" });
    const styles = useMemo(() => recipe({}) as unknown as AllocationStyles, [recipe]);
    const format = useFormatters(), words = useMemo(() => ({ ...format, m: editingMessages }), [format]);
    const context = useMemo(() => allocationContext(value), [value]);
    const plan = editing.plan;
    const loads = useMemo(() => domain.loads(window.day, plan, context), [domain, window.day, plan, context]);
    const builtIn = useMemo(() => domain.check(window.day, plan, context), [domain, window.day, plan, context]);
    // The app's check, after the built-in ones wherever issues show; a check that fails leaves them shown.
    const readCheck = useCallback((): Issue[] => value.check.type === "some"
        ? value.check.value(domain.encodeCheckContext({ day: window.day, plan, context, loads })) : [], [value.check, domain, window.day, plan, context, loads]);
    const custom = useTrackedEvaluation(readCheck);
    const issues = useMemo(() => [...builtIn, ...(custom.result.ok ? custom.result.value : [])], [builtIn, custom.result]);
    // Commands update what is selected without changing the panes or their tabs.
    const commands = allocationCommands(value, domain, editing, setSelection);
    const onIssues = () => revealPane("Inspector");
    const onAction = useCallback((action: HistoryAction) => { const active = document.activeElement; if (active instanceof HTMLElement) active.blur(); editing.history.act(action); }, [editing.history]);
    const toolbar = useAllocationToolbar({ ...window, value, styles, commands, words, days: data.days, issues, onIssues, onAction, onPickerWeeks: setPickerWeeks });
    const published = editing.held?.status.type === "published";
    const notStarted = !data.loading && data.error === undefined && editing.held === undefined && plan.bins.size === 0;
    return <Box ref={root} css={styles.root} data-allocation-frame="" data-allocation-readonly={published || value.settings.readOnly ? "" : undefined}>
        <BuilderFrame storageKey={`${key}.frame`} label={value.settings.title} loading={data.loading && data.error === undefined} toolbar={toolbar} onKeyDown={event => {
            // The keys, never while typing (A6).
            if (event.defaultPrevented || typedInto(event.target)) return;
            const action = historyShortcut(event);
            if (action !== undefined && !value.settings.readOnly && !published) { event.preventDefault(); onAction(action); }
            else if (event.key === "[" || event.key === "]") { event.preventDefault(); window.step(event.key === "[" ? -1 : 1); }
            else if (event.key === "Escape") { setSelection(undefined); setError(undefined); }
            else if ((event.key === "Delete" || event.key === "Backspace") && selection?.type === "bin" && commands.canEdit()) { event.preventDefault(); commands.remove(selection.id); }
        }} banners={<>
            {editing.session !== undefined && <SessionBanners session={editing.session} words={words} onAction={action => editing.history.actOn(editing.key, action)} />}
            {published && <BannerView status="info" title="Published day" description="Read-only view of the published plan." />}
            {notStarted && <BannerView status="info" title="Day not started" description="Book an event or reserve a slot to start this day's plan." />}
            {!custom.result.ok && <BannerView status="warning" title="Additional checks unavailable" description="The plan's additional checks could not run. Built-in checks are still shown." />}
            {(error ?? data.error) !== undefined && <Box css={styles.error} role="alert">{error ?? data.error}</Box>}
        </>} footer={<AllocationFooter styles={styles} layout={window.view.layout} narrow={narrow} />}>
            <Box ref={main} css={styles.main} data-allocation-main="" data-allocation-layout={window.view.layout} data-allocation-day={dayEpoch}
                aria-busy={data.loading && data.error === undefined} data-allocation-narrow={narrow ? "" : undefined}>
                {data.loading && data.error !== undefined ? <StatusDisplay variant="error" title="Allocation unavailable" message={data.error} /> : null}
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
