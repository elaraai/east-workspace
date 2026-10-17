/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

/**
 * The board's one toolbar (§7, A1): the date, the layout, the day's status,
 * the narrowing's rail and its count (the Timeline's), the issues chip, the
 * shared history and Publish — each folding by its rank, history last, and in
 * the narrowest frame the date, the layout, Save and Publish reachable through
 * the combined View fold.
 *
 * @packageDocumentation
 */

import { useMemo } from "react";
import { Box, Button, Menu as ChakraMenu, chakra, useRecipe } from "@chakra-ui/react";
import { FontAwesomeIcon } from "@fortawesome/react-fontawesome";
import { faCalendarDay, faChartGantt, faTable, faTriangleExclamation } from "@fortawesome/free-solid-svg-icons";
import { ChipMenu, historyToolbarItem, useSliceReactivity, type EditingWords, type HistoryAction, type ToolbarItem } from "@elaraai/east-ui-components";
import { HOST_RANK, coarseHitArea, railAffordanceKinds, useRecordSliceToolbarItems, useSliceToolbarItems } from "@elaraai/east-ui-components/internal";
import { Seg } from "../shared/schedule/segments.js";
import { TimeNavigator } from "../shared/time/navigation.js";
import type { AllocationCommands } from "./actions.js";
import type { AllocationWindow } from "./window.js";
import { DAY, type AllocationStyles, type AllocationValue, type Day, type Issue } from "./model.js";

/** Table, then Timeline, as the mock orders them. */
const LAYOUTS = [{ key: "table", label: "Table", icon: faTable }, { key: "timeline", label: "Timeline", icon: faChartGantt }] as const;

/** The day's stored status, as the chip names it (A3). */
export function statusWord(held: Day | undefined, plan: Day): "Not started" | "Draft" | "Publishing" | "Published" {
    return held?.status.type === "published" ? "Published" : plan.status.type === "published" ? "Publishing" : held === undefined ? "Not started" : "Draft";
}

/** `1 issue`, `3 issues`. */
const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? "" : "s"}`;

/**
 * The issues the chip counts — warning and danger, never neutral or info
 * (A64) — and its words (A81): `2 overlaps · 1 over max · show them`, with
 * `· warnings only, Save still works` when every one is an under-min warning.
 */
export function issueSummary(issues: readonly Issue[]): { count: number; label: string; tip: string; aria: string } {
    const counted = issues.filter(i => i.tone.type === "warning" || i.tone.type === "danger");
    const n = (kind: Issue["kind"]["type"]) => counted.filter(i => i.kind.type === kind).length;
    const custom = counted.filter(i => i.kind.type === "custom");
    const parts = [
        n("unlinked") > 0 ? `${n("unlinked")} not linked` : "",
        n("unallocated") > 0 ? `${n("unallocated")} partly allocated` : "",
        n("overlap") > 0 ? plural(n("overlap"), "overlap") : "",
        n("over") > 0 ? `${n("over")} over max` : "",
        n("under") > 0 ? `${n("under")} under min` : "",
        custom.length > 0 ? `${custom.length} more` : "",
    ].filter(p => p !== "");
    const warningsOnly = counted.length > 0 && counted.every(i => i.kind.type === "under");
    return {
        count: counted.length, label: plural(counted.length, "issue"),
        tip: `${parts.join(" · ")}${warningsOnly ? " · warnings only, Save still works" : ""} · show them`,
        aria: `${plural(counted.length, "issue")}, show them`,
    };
}

interface ToolbarArgs extends AllocationWindow {
    value: AllocationValue;
    styles: AllocationStyles;
    commands: AllocationCommands;
    words: EditingWords;
    /** The days the picker read, by date: their marks. */
    days: ReadonlyMap<Date, Day>;
    issues: readonly Issue[];
    onIssues: () => void;
    onAction: (action: HistoryAction) => void;
    onPickerWeeks: (weeks: readonly Date[]) => void;
}

/** The board's toolbar items: the shared Toolbar's, ranked around `HOST_RANK`. */
export function useAllocationToolbar(args: ToolbarArgs): ReadonlyArray<ToolbarItem | false | undefined> {
    const { value, view, setView, styles, commands, words, issues } = args;
    const timeline = view.layout === "timeline";
    // The narrowing is the Timeline's: the Table is never narrowed (A41).
    const slice = value.slice.type === "some" ? value.slice.value.slice : undefined;
    const version = useSliceReactivity(slice?.key);
    const kinds = useMemo(() => slice === undefined ? [] : railAffordanceKinds(value.slice.type === "some" ? value.slice.value.affordances.map(a => a.type) : [], slice.read())
        .filter(kind => kind !== "brush" && kind !== "legend" && kind !== "resolution" && kind !== "range"),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [slice, value.slice, version]);
    const rail = useSliceToolbarItems(timeline ? slice : undefined, [{ key: "allocation.slice", kinds }]);
    const record = value.recordSlice.type === "some" && timeline ? value.recordSlice.value : undefined;
    const recordRail = useRecordSliceToolbarItems(record?.slice, { noun: "resources",
        ...(record === undefined ? {} : { affordances: record.affordances.map(a => a.type) }),
        ...(record?.persist.type === "some" ? { persist: record.persist.value.type } : {}),
    });
    const chip = useRecipe({ key: "chip" });
    const summary = issueSummary(issues);
    const status = statusWord(commands.editing.held, commands.editing.plan);
    const published = commands.editing.held?.status.type === "published";
    const canPublish = value.settings.publish && commands.canEdit();
    const layout = (key: "table" | "timeline") => setView({ ...view, layout: key });
    const layoutSeg = (name: string) => <Seg label="Layout" scope="allocation" name={name} items={LAYOUTS} active={view.layout} onPick={layout} />;
    // The narrowest frame's one popover: the layout, the issues and Publish beside the date (A1).
    const controls = <Box css={styles.controls}>
        {layoutSeg("compact-layout")}
        {value.inspector.type === "some" && summary.count > 0 && <Button size="xs" variant="ghost" onClick={args.onIssues}>{summary.label}</Button>}
        {canPublish && <Button size="xs" variant="solid" onClick={() => commands.publish()}>Publish</Button>}
    </Box>;
    const menu = <ChipMenu label="View" icon={faCalendarDay} onSelect={key => {
        if (key === "table" || key === "timeline") layout(key);
        else if (key === "previous") args.step(-1); else if (key === "next") args.step(1);
        else if (key === "issues") args.onIssues(); else if (key === "publish") commands.publish();
    }}>
        {LAYOUTS.map(item => <ChakraMenu.Item key={item.key} value={item.key}>{item.label}</ChakraMenu.Item>)}
        <ChakraMenu.Separator /><ChakraMenu.Item value="previous">Previous day</ChakraMenu.Item><ChakraMenu.Item value="next">Next day</ChakraMenu.Item>
        {value.inspector.type === "some" && summary.count > 0 && <ChakraMenu.Item value="issues">{summary.label}</ChakraMenu.Item>}
        {canPublish && <><ChakraMenu.Separator /><ChakraMenu.Item value="publish">Publish</ChakraMenu.Item></>}
    </ChipMenu>;
    const navigation = (compact = false, combined = false) => <TimeNavigator scope="allocation" date={view.date} period="day" sunday={false}
        onChange={date => setView({ ...view, date })} compact={compact} label={combined ? "View" : "Choose plan day"} initialPanel="day"
        onWeeks={args.onPickerWeeks} legend="Published · Draft · Not started"
        dayMarker={date => <Box as="span" css={styles.pickerDot} data-state={args.days.get(date)?.status.type ?? "empty"} />}
        controls={combined ? controls : undefined} />;
    return [
        ...rail, ...recordRail,
        { key: "allocation.layout", side: "start", rank: HOST_RANK + 1, bundle: "allocation.view", forms: [layoutSeg("layout"), null] },
        { key: "allocation.view", side: "start", rank: [HOST_RANK + 1, HOST_RANK + 6], bundle: ["allocation.view", "allocation.controls"], forms: [null, menu, null] },
        { key: "allocation.navigation", side: "start", rank: [HOST_RANK + 4, HOST_RANK + 6], bundle: [undefined, "allocation.controls"], forms: [navigation(), navigation(true), navigation(true, true)] },
        value.settings.publish && { key: "allocation.status", side: "start", rank: HOST_RANK, forms: [
            <Box css={styles.status} data-tone={status === "Published" ? "success" : "neutral"} data-allocation-status="" title="Plan status">{status}</Box>, null] },
        summary.count > 0 && value.inspector.type === "some" && { key: "allocation.issues", side: "end", rank: HOST_RANK + 3, forms: [
            <chakra.button type="button" css={[chip({ tone: "warn", numeric: true }), coarseHitArea({ position: true })]} onClick={args.onIssues}
                aria-label={summary.aria} title={summary.tip} data-allocation-issues="">
                <FontAwesomeIcon icon={faTriangleExclamation} /><span data-chip-label="">{summary.label}</span>
            </chakra.button>, null] },
        !value.settings.readOnly && !published && historyToolbarItem({ session: commands.editing.history, words, editing: false, showError: false, onIssue: args.onIssues, onAction: args.onAction }),
        canPublish && { key: "allocation.publish", side: "end", rank: HOST_RANK + 5, forms: [<Button size="xs" variant="solid" onClick={() => commands.publish()}>Publish</Button>, null] },
    ];
}

/** The days of the picker's open month, from the weeks it shows. */
export function pickerDays(weeks: readonly Date[]): Date[] {
    return weeks.flatMap(week => Array.from({ length: 7 }, (_, i) => new Date(week.getTime() + i * DAY)));
}
