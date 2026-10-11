/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

/** One folding Toolbar: Slice, Calendar navigation, overlaps and shared history. */
import { useMemo } from "react";
import type { ValueTypeOf } from "@elaraai/east";
import type { SliceBindType } from "@elaraai/east-ui/internal";
import { Box, Button, Menu as ChakraMenu, chakra, useRecipe } from "@chakra-ui/react";
import { FontAwesomeIcon } from "@fortawesome/react-fontawesome";
import { faCalendarWeek, faTriangleExclamation } from "@fortawesome/free-solid-svg-icons";
import { ChipMenu, historyToolbarItem, useSliceReactivity, type EditingWords, type HistoryAction, type ToolbarItem } from "@elaraai/east-ui-components";
import { HOST_RANK, coarseHitArea, railAffordanceKinds, useSliceToolbarItems } from "@elaraai/east-ui-components/internal";
import { TimeNavigator } from "../shared/time/navigation.js";
import { Seg } from "../shared/schedule/segments.js";
import type { ScheduleOverlaps } from "../shared/schedule/overlaps.js";
import type { CalendarCommands } from "./actions.js";
import { dayStart, navigate, type CalendarItem, type CalendarRange, type CalendarRef, type CalendarStyles, type CalendarView } from "./model.js";

const LAYOUTS = [{ key: "calendar", label: "Calendar" }, { key: "resources", label: "Resources" }, { key: "timeline", label: "Timeline" }] as const;
const PERIODS = [{ key: "day", label: "Day" }, { key: "week", label: "Week" }, { key: "month", label: "Month" }] as const;
interface ToolbarArgs {
    view: CalendarView; setView: (view: CalendarView) => void; range: CalendarRange; now: Date; count: number;
    slice: ValueTypeOf<typeof SliceBindType> | undefined; affordances: readonly string[]; styles: CalendarStyles; commands: CalendarCommands | undefined;
    words: EditingWords; overlaps: ScheduleOverlaps<CalendarItem>; select: (refs: CalendarRef[]) => void;
    onAction: (action: HistoryAction) => void; paged: boolean;
    sunday: boolean; navigationDate: number; rangeLabel: string | undefined; onNavigate: (date: number) => void;
}
/** The control row uses shared folding ranks, popovers and coarse-pointer targets. */
export function useCalendarToolbar(args: ToolbarArgs): ReadonlyArray<ToolbarItem | false | undefined> {
    const { view, setView, now, count, slice, affordances, styles, words, commands, onAction, overlaps, select, paged } = args;
    const version = useSliceReactivity(slice?.key);
    const kinds = useMemo(() => slice === undefined ? [] : railAffordanceKinds(affordances, slice.read())
        .filter(kind => kind !== "brush" && kind !== "legend" && kind !== "resolution"),
    // Slice state can move without a new handle, as in Plan's toolbar.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [slice, affordances, version]);
    const rail = useSliceToolbarItems(slice, [{ key: "calendar.slice", kinds }]);
    const chip = useRecipe({ key: "chip" });
    const period = view.layout === "resources" ? "day" : view.period;
    const move = (step: number) => args.onNavigate(navigate({ ...view, date: args.navigationDate }, step).date);
    const firstPair = overlaps.pairs[0];
    const showOverlaps = () => {
        if (firstPair === undefined) return;
        select([firstPair.first, firstPair.second].map(item => ({ kind: item.kind, key: item.key })));
        if (firstPair.first.start.type === "some") setView({ ...view, layout: "resources", date: dayStart(firstPair.first.start.value).getTime() });
    };
    const warning = (short: boolean) => <chakra.button type="button" css={[chip({ tone: "warn", numeric: true }), coarseHitArea({ position: true })]}
        aria-label={`${overlaps.pairs.length} overlaps`} data-calendar-overlaps="" onClick={showOverlaps}><span data-chip-icon=""><FontAwesomeIcon icon={faTriangleExclamation} /></span><span data-chip-label="">{overlaps.pairs.length}{!short && " overlaps"}</span></chakra.button>;
    const viewMenu = <ChipMenu label="View" icon={faCalendarWeek} data="data-calendar-view-menu" onSelect={key => {
        const layout = LAYOUTS.find(layout => layout.key === key); const picked = PERIODS.find(period => period.key === key);
        if (layout !== undefined) setView({ ...view, layout: layout.key });
        else if (picked !== undefined && view.layout !== "resources") setView({ ...view, period: picked.key });
        else if (key === "overlaps") showOverlaps();
        else if (key === "previous" || key === "next") move(key === "previous" ? -1 : 1);
    }}>
        {LAYOUTS.map(layout => <ChakraMenu.Item value={layout.key} key={layout.key}>{layout.label}</ChakraMenu.Item>)}
        {view.layout !== "resources" && <><ChakraMenu.Separator />{PERIODS.map(p => <ChakraMenu.Item value={p.key} key={p.key}>{p.label}</ChakraMenu.Item>)}</>}
        <ChakraMenu.Separator />
        <ChakraMenu.Item value="previous">Previous {period}</ChakraMenu.Item><ChakraMenu.Item value="next">Next {period}</ChakraMenu.Item>
        {firstPair !== undefined && <ChakraMenu.Item value="overlaps">{overlaps.pairs.length} overlaps</ChakraMenu.Item>}
    </ChipMenu>;
    const controls = <>
        <Seg label="Layout" scope="calendar" name="compact-layout" items={LAYOUTS} active={view.layout} onPick={layout => setView({ ...view, layout })} />
        {view.layout !== "resources" && <Seg label="Period" scope="calendar" name="compact-period" items={PERIODS} active={period} onPick={period => setView({ ...view, period })} />}
        {firstPair !== undefined && <Button size="xs" variant="ghost" onClick={showOverlaps}>{overlaps.pairs.length} overlaps</Button>}
    </>;
    const navigation = (compact = false, combined = false) => <TimeNavigator scope="calendar" date={args.navigationDate} period={period}
        sunday={args.sunday} now={now} onChange={args.onNavigate} compact={compact} rangeLabel={args.rangeLabel}
        label={combined ? "View" : "Choose date"} controls={combined ? controls : undefined} />;
    return [
        ...rail,
        { key: "calendar.layout", side: "start", rank: HOST_RANK + 1, bundle: "calendar.view", forms: [<Seg label="Layout" scope="calendar" name="layout" items={LAYOUTS} active={view.layout} onPick={layout => setView({ ...view, layout })} />, null] },
        view.layout !== "resources" && { key: "calendar.period", side: "start", rank: HOST_RANK + 1, bundle: "calendar.view", forms: [<Seg label="Period" scope="calendar" name="period" items={PERIODS} active={period} onPick={period => setView({ ...view, period })} />, null] },
        { key: "calendar.view", side: "start", rank: [HOST_RANK + 1, HOST_RANK + 6], bundle: ["calendar.view", "calendar.controls"], forms: [null, viewMenu, null] },
        { key: "calendar.navigation", side: "start", rank: [HOST_RANK + 4, HOST_RANK + 6], bundle: [undefined, "calendar.controls"], forms: [navigation(), navigation(true), navigation(true, true)] },
        { key: "calendar.count", side: "start", rank: HOST_RANK, forms: [<Box css={styles.toolbarText} data-calendar-count="">{words.number(count)} events</Box>, null] },
        paged && { key: "calendar.scope", side: "start", forms: [<Box css={styles.toolbarText}>Loaded window</Box>, null], rank: HOST_RANK + 4 },
        firstPair !== undefined && { key: "calendar.overlaps", side: "end", rank: [HOST_RANK, HOST_RANK + 6], forms: [warning(false), warning(true), null] },
        commands !== undefined && historyToolbarItem({ session: commands.editing.history, words, editing: false, showError: false, onAction,
            onIssue: issue => { const kind = commands.editing.sessions.find(held => held.key === commands.editing.history.sourceOf(issue))?.kind; if (kind !== undefined) select([{ kind, key: issue.entry }]); } }),
    ];
}
