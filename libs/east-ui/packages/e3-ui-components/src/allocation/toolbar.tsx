/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

/**
 * The board's one toolbar (§7, A1): the date, the layout, the day's status,
 * the narrowing's one rail over its bins, its lanes, its resources and its
 * arrivals, and each one's count, in both layouts (#1336, #1339) — the bins'
 * day the board's own navigation, never a chip of the rail (#1372) — the
 * issues chip, the shared history and Publish — each folding by its rank,
 * history last, and in the narrowest frame the date, the layout, Save and
 * Publish reachable through the combined View fold.
 *
 * @packageDocumentation
 */

import { Box, Button, Menu as ChakraMenu, chakra, useRecipe } from "@chakra-ui/react";
import { FontAwesomeIcon } from "@fortawesome/react-fontawesome";
import { faCalendarDay, faChartGantt, faLink, faTable, faTriangleExclamation, faXmark } from "@fortawesome/free-solid-svg-icons";
import type { SortedMap } from "@elaraai/east";
import { ChipMenu, historyToolbarItem, type EditingWords, type HistoryAction, type ToolbarItem } from "@elaraai/east-ui-components";
import { HOST_RANK, coarseHitArea, useRecordSlicesToolbarItems } from "@elaraai/east-ui-components/internal";
import { Seg } from "../shared/schedule/segments.js";
import { TimeNavigator } from "../shared/time/navigation.js";
import type { AllocationCommands } from "./actions.js";
import type { AllocationEditing } from "./editing.js";
import type { AllocationWindow } from "./window.js";
import { DAY, allocationWords, type AllocationStyles, type AllocationValue, type Day, type Issue, type Load, type ResourceRow } from "./model.js";
import { other, type Nouns } from "./nouns.js";

/** Table, then Timeline, as the mock orders them. */
const LAYOUTS = [{ key: "table", label: "Table", icon: faTable }, { key: "timeline", label: "Timeline", icon: faChartGantt }] as const;

/** `1 issue`, `3 issues`. */
const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? "" : "s"}`;

/** The issues the chip, the Issues tab and the summary count: warning and danger, never neutral or info (A64). */
export function countedIssues(issues: readonly Issue[]): Issue[] {
    return issues.filter(i => i.tone.type === "warning" || i.tone.type === "danger");
}

/** What the counted issues are, each kind's count (A63, A81): `2 overlaps`, `1 over max`; the app's, `N more`. */
export function issueParts(issues: readonly Issue[]): string[] {
    const counted = countedIssues(issues);
    const n = (kind: Issue["kind"]["type"]) => counted.filter(i => i.kind.type === kind).length;
    const custom = counted.filter(i => i.kind.type === "custom");
    return [
        n("unlinked") > 0 ? `${n("unlinked")} not linked` : "",
        n("unallocated") > 0 ? `${n("unallocated")} partly allocated` : "",
        n("overlap") > 0 ? plural(n("overlap"), "overlap") : "",
        n("over") > 0 ? `${n("over")} over max` : "",
        n("under") > 0 ? `${n("under")} under min` : "",
        custom.length > 0 ? `${custom.length} more` : "",
    ].filter(p => p !== "");
}

/**
 * The issues the chip counts — warning and danger, never neutral or info
 * (A64) — and its words (A81): `2 overlaps · 1 over max · show them`, with
 * `· warnings only, Save still works` when every one is an under-min warning.
 */
export function issueSummary(issues: readonly Issue[]): { count: number; label: string; tip: string; aria: string } {
    const counted = countedIssues(issues);
    const parts = issueParts(issues);
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
    /** The editing; `undefined` for a read-only board. */
    editing: AllocationEditing | undefined;
    words: EditingWords;
    /** The day's status chip's words (A3): Not started, Draft, Published, or the app's own case; `undefined` without periods. */
    status: string | undefined;
    /** Whether Publish is under way. */
    publishing: boolean;
    /** The open picker's days' statuses, by day: their marks. */
    picker: SortedMap<Date, Day["status"]>;
    issues: readonly Issue[];
    onIssues: () => void;
    onAction: (action: HistoryAction) => void;
    onPickerWeeks: (weeks: readonly Date[]) => void;
    /** The focus (A13): its resource, its load, and whether the narrowing hides its row. */
    focus: { resource: ResourceRow; load: Load; hidden: boolean } | undefined;
    onClearFocus: () => void;
    /** The board's nouns: what the narrowing's summary counts each source in, and what heads each source's fields, folded. */
    nouns: Nouns;
}

/** The board's toolbar items: the shared Toolbar's, ranked around `HOST_RANK`. */
export function useAllocationToolbar(args: ToolbarArgs): ReadonlyArray<ToolbarItem | false | undefined> {
    const { value, view, setView, styles, commands, words, issues, editing } = args;
    const timeline = view.layout === "timeline";
    // The narrowing: one rail over the bins, the lanes, the resources and the arrivals, in both layouts, each source counted in the board's noun
    // under the slot the app names it by (#1336, #1339); the bins' range is the board's own navigation, never a chip of the rail (#1372).
    const chrome = value.slice.type === "some" ? value.slice.value : undefined;
    const bins = value.bin.kind;
    const binRange = chrome?.slice.parts.find(part => part.source === bins.key)?.slice.config.range;
    const rail = useRecordSlicesToolbarItems(chrome?.slice, {
        nouns: { [bins.key]: `${bins.name.toLocaleLowerCase(words.locale)} events`, [value.bin.lanes]: other(args.nouns.lane),
            [value.bin.parts]: other(args.nouns.resource), arrivals: other(args.nouns.arrival) },
        ...(binRange?.type === "some" ? { excludeFields: [`${bins.key}.${binRange.value}`] } : {}),
        ...(chrome === undefined ? {} : { affordances: chrome.affordances.map(a => a.type) }),
        ...(chrome?.persist.type === "some" ? { persist: chrome.persist.value.type } : {}),
    });
    const chip = useRecipe({ key: "chip" });
    const summary = issueSummary(issues);
    const status = args.publishing ? "Publishing" : args.status;
    // Publish: only over periods, on a day that takes edits.
    const canPublish = value.periods.type === "some" && commands.canEdit() && !args.publishing;
    // The history: wherever the day takes edits, and wherever a draft of another day waits to be saved.
    const history = editing?.history;
    const showHistory = history !== undefined && !value.settings.readOnly && (commands.canEdit() || history.pending > 0 || history.status !== "idle");
    const layout = (key: "table" | "timeline") => setView({ ...view, layout: key });
    const layoutSeg = (name: string) => <Seg label="Layout" scope="allocation" name={name} items={LAYOUTS} active={view.layout} onPick={layout} />;
    const focus = args.focus;
    // The narrowest frame's one popover: the layout, the focus, the issues and Publish beside the date (A1). The focus's chip comes
    // with them, so its Show all stays reachable on a phone, where no Esc is (A13, A78).
    const controls = <Box css={styles.controls}>
        {layoutSeg("compact-layout")}
        {timeline && focus !== undefined && focusChip(false)}
        {value.inspector && summary.count > 0 && <Button size="xs" variant="ghost" onClick={args.onIssues}>{summary.label}</Button>}
        {canPublish && <Button size="xs" variant="solid" onClick={() => commands.publish()}>Publish</Button>}
    </Box>;
    const menu = <ChipMenu label="View" icon={faCalendarDay} onSelect={key => {
        if (key === "table" || key === "timeline") layout(key);
        else if (key === "previous") args.step(-1); else if (key === "next") args.step(1);
        else if (key === "issues") args.onIssues(); else if (key === "publish") commands.publish();
    }}>
        {LAYOUTS.map(item => <ChakraMenu.Item key={item.key} value={item.key}>{item.label}</ChakraMenu.Item>)}
        <ChakraMenu.Separator /><ChakraMenu.Item value="previous">Previous day</ChakraMenu.Item><ChakraMenu.Item value="next">Next day</ChakraMenu.Item>
        {value.inspector && summary.count > 0 && <ChakraMenu.Item value="issues">{summary.label}</ChakraMenu.Item>}
        {canPublish && <><ChakraMenu.Separator /><ChakraMenu.Item value="publish">Publish</ChakraMenu.Item></>}
    </ChipMenu>;
    // The focus chip (A13, A81): `K-203 · 3 bins · 31 m³`, `· hidden by Filters` when its row is narrowed out; × or Esc clears it.
    function focusChip(compact: boolean) {
        if (focus === undefined) return null;
        const unit = value.bin.unit.type === "some" ? value.bin.unit.value : "";
        const meta = `${plural(Number(focus.load.bins), "bin")} · ${allocationWords().quantity(focus.load.fill, unit)}${focus.hidden ? " · hidden by Filters" : ""}`;
        return <chakra.span css={chip({ tone: "brand", numeric: true })} title="The focus: its links are drawn · Esc returns to all" data-allocation-focus=""
            aria-label={`Focus ${focus.resource.label}, ${meta}`}>
            <span data-chip-icon=""><FontAwesomeIcon icon={faLink} /></span>
            {!compact && <><span>{focus.resource.label}</span><span data-chip-meta="">{meta}</span></>}
            <chakra.button type="button" css={styles.focusClear} aria-label="Show all" title="Show all · Esc" onClick={args.onClearFocus}><FontAwesomeIcon icon={faXmark} /></chakra.button>
        </chakra.span>;
    }
    const navigation = (compact = false, combined = false) => <TimeNavigator scope="allocation" date={view.date} period="day" sunday={false}
        onChange={date => setView({ ...view, date })} compact={compact} label={combined ? "View" : "Choose plan day"} initialPanel="day"
        onWeeks={args.onPickerWeeks} legend="Published · Draft · Not started"
        dayMarker={date => { const held = args.picker.get(date); return <Box as="span" css={styles.pickerDot} data-state={held === undefined ? "empty" : held.type === "other" ? "draft" : held.type} />; }}
        controls={combined ? controls : undefined} />;
    return [
        ...rail,
        { key: "allocation.layout", side: "start", rank: HOST_RANK + 1, bundle: "allocation.view", forms: [layoutSeg("layout"), null] },
        { key: "allocation.view", side: "start", rank: [HOST_RANK + 1, HOST_RANK + 6], bundle: ["allocation.view", "allocation.controls"], forms: [null, menu, null] },
        { key: "allocation.navigation", side: "start", rank: [HOST_RANK + 4, HOST_RANK + 6], bundle: [undefined, "allocation.controls"], forms: [navigation(), navigation(true), navigation(true, true)] },
        // Its icon, then — in the narrowest frame — into the View's popover with the controls (A1): a chip that cannot fold would run the row
        // past its end at 294px.
        timeline && focus !== undefined && { key: "allocation.focus", side: "start", rank: [HOST_RANK + 2, HOST_RANK + 6], bundle: [undefined, "allocation.controls"],
            forms: [focusChip(false), focusChip(true), null] },
        status !== undefined && { key: "allocation.status", side: "start", rank: HOST_RANK, forms: [
            <Box css={styles.status} data-tone={status === "Published" ? "success" : "neutral"} data-allocation-status="" title="Plan status">{status}</Box>, null] },
        summary.count > 0 && value.inspector && { key: "allocation.issues", side: "end", rank: HOST_RANK + 3, forms: [
            <chakra.button type="button" css={[chip({ tone: "warn", numeric: true }), coarseHitArea({ position: true })]} onClick={args.onIssues}
                aria-label={summary.aria} title={summary.tip} data-allocation-issues="">
                <FontAwesomeIcon icon={faTriangleExclamation} /><span data-chip-label="">{summary.label}</span>
            </chakra.button>, null] },
        showHistory && historyToolbarItem({ session: history, words, editing: false, showError: false, onIssue: args.onIssues, onAction: args.onAction }),
        // As tall as every control in the row (`sm`, 28px, ruled 23 Oct 2026).
        canPublish && { key: "allocation.publish", side: "end", rank: HOST_RANK + 5, forms: [<Button size="sm" variant="solid" onClick={() => commands.publish()}>Publish</Button>, null] },
    ];
}

/** The days of the picker's open month, from the weeks it shows. */
export function pickerDays(weeks: readonly Date[]): Date[] {
    return weeks.flatMap(week => Array.from({ length: 7 }, (_, i) => new Date(week.getTime() + i * DAY)));
}
