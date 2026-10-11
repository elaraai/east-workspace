/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

import { useMemo } from "react";
import { Box, Button, Menu as ChakraMenu, chakra, useRecipe } from "@chakra-ui/react";
import { FontAwesomeIcon } from "@fortawesome/react-fontawesome";
import { faCalendarWeek, faTriangleExclamation, faSliders } from "@fortawesome/free-solid-svg-icons";
import { ChipMenu, historyToolbarItem, useSliceReactivity, type EditingWords, type HistoryAction, type ToolbarItem } from "@elaraai/east-ui-components";
import { HOST_RANK, coarseHitArea, railAffordanceKinds, useSliceToolbarItems } from "@elaraai/east-ui-components/internal";
import { Seg } from "../shared/schedule/segments.js";
import { shiftCalendar } from "../shared/time/scale.js";
import { TimeNavigator } from "../shared/time/navigation.js";
import type { RosterCommands } from "./actions.js";
import { DAY, dayStart, type Issue, type RosterStyles, type RosterValue, type Week } from "./model.js";
import type { useRosterWindow } from "./window.js";

const LAYOUTS = [{ key: "shifts", label: "Shifts" }, { key: "people", label: "People" }] as const;
const PERIODS = [{ key: "day", label: "Day" }, { key: "week", label: "Week" }] as const;
interface ToolbarArgs extends ReturnType<typeof useRosterWindow> {
    value: RosterValue; styles: RosterStyles; commands: RosterCommands; words: EditingWords; weeks: ReadonlyMap<Date, Week>;
    onDisplay: (value: Partial<{ density: "compact" | "comfortable"; chipSkills: boolean; requirements: boolean }>) => void;
    issues: readonly Issue[]; onIssues: () => void; onAction: (action: HistoryAction) => void; onPickerDates: (dates: readonly Date[]) => void;
}
/** One shared Toolbar, including Slice's affordances and the shared editing history. */
export function useRosterToolbar(args: ToolbarArgs): ReadonlyArray<ToolbarItem | false | undefined> {
    const { value, view, setView, start, slice, affordances, styles, commands, words, issues } = args;
    const version = useSliceReactivity(slice?.key);
    const kinds = useMemo(() => slice === undefined ? [] : railAffordanceKinds(affordances, slice.read()).filter(kind => kind !== "brush" && kind !== "legend" && kind !== "resolution"),
        // eslint-disable-next-line react-hooks/exhaustive-deps
        [slice, affordances, version]);
    const rail = useSliceToolbarItems(slice, [{ key: "roster.slice", kinds }]);
    const chip = useRecipe({ key: "chip" });
    const count = issues.filter(issue => issue.kind.type === "breach" || issue.kind.type === "gap").length;
    const period = (key: "day" | "week") => setView({ ...view, period: key });
    const unit = view.layout === "people" ? "week" : view.period;
    const navigate = (step: number) => setView({ ...view, date: shiftCalendar(new Date(view.date), unit, step).getTime() });
    const status = commands.editing.held?.status.type === "published" ? "Published" : commands.editing.week.status.type === "published" ? "Publishing" : commands.editing.held === undefined ? "Not started" : "Draft";
    const displayChoice = (key: string) => {
        if (key === "compact" || key === "comfortable") args.onDisplay({ density: key });
        else if (key === "skills") args.onDisplay({ chipSkills: !value.settings.chipSkills });
        else if (key === "targets") args.onDisplay({ requirements: !value.settings.requirements });
    };
    const displayItems = <><ChakraMenu.Item value="compact">Compact spacing</ChakraMenu.Item><ChakraMenu.Item value="comfortable">Comfortable spacing</ChakraMenu.Item>
        <ChakraMenu.Item value="skills">{value.settings.chipSkills ? "Hide" : "Show"} chip skills</ChakraMenu.Item><ChakraMenu.Item value="targets">{value.settings.requirements ? "Hide" : "Show"} requirements</ChakraMenu.Item></>;
    const menu = <ChipMenu label="View" icon={faCalendarWeek} onSelect={key => {
        if (key === "people" || key === "shifts") setView({ ...view, layout: key });
        else if (key === "day" || key === "week") period(key);
        else if (key === "publish") commands.publish();
        else if (key === "previous") navigate(-1); else if (key === "next") navigate(1);
        else if (key === "today") setView({ ...view, date: dayStart(Date.now()).getTime() }); else if (key === "issues") args.onIssues(); else displayChoice(key);
    }}>
        {LAYOUTS.map(item => <ChakraMenu.Item key={item.key} value={item.key}>{item.label}</ChakraMenu.Item>)}
        {view.layout === "shifts" && <><ChakraMenu.Separator />{PERIODS.map(item => <ChakraMenu.Item key={item.key} value={item.key}>{item.label}</ChakraMenu.Item>)}</>}
        <ChakraMenu.Separator /><ChakraMenu.Item value="previous">Previous {unit}</ChakraMenu.Item><ChakraMenu.Item value="next">Next {unit}</ChakraMenu.Item><ChakraMenu.Item value="today">Today</ChakraMenu.Item>{value.inspector.type === "some" && <ChakraMenu.Item value="issues">{count} issues</ChakraMenu.Item>}<ChakraMenu.Separator />{displayItems}
        {commands.editing.available && commands.editing.week.status.type !== "published" && <><ChakraMenu.Separator /><ChakraMenu.Item value="publish">Publish week</ChakraMenu.Item></>}
    </ChipMenu>;
    // When the frame itself is narrower than a phone viewport, one popover
    // holds both week and view controls. It folds before the shared history.
    const controls = <Box css={styles.agendaGroup}>
        <Seg label="Layout" scope="roster" name="compact-layout" items={LAYOUTS} active={view.layout} onPick={layout => setView({ ...view, layout })} />
        {view.layout === "shifts" && <Seg label="Period" scope="roster" name="compact-period" items={PERIODS} active={view.period} onPick={period} />}
        <ChipMenu label="Display" icon={faSliders} onSelect={displayChoice}>{displayItems}</ChipMenu>
        {value.inspector.type === "some" && <Button size="xs" variant="ghost" onClick={args.onIssues}>{count} issues</Button>}
        {commands.editing.available && commands.editing.week.status.type !== "published" && <Button size="xs" variant="solid" onClick={() => commands.publish()}>Publish week</Button>}
    </Box>;
    const navigation = (compact = false, combined = false) => <TimeNavigator scope="roster" date={view.date} period={unit}
        sunday={value.settings.weekStart.type === "sunday"} onChange={date => setView({ ...view, date })}
        compact={compact} label={combined ? "View" : "Choose roster week"} initialPanel="week" onWeeks={args.onPickerDates}
        weekMarker={date => <Box as="span" css={styles.pickerDot} data-state={args.weeks.get(date)?.status.type ?? "empty"} />}
        legend="Published · Draft · Not started" controls={combined ? controls : undefined} />;
    const daySelect = <Seg label="Day of week" scope="roster" name="days" active={String(args.day)} onPick={day => setView({ ...view, date: start.getTime() + Number(day) * DAY })}
        items={Array.from({ length: 7 }, (_, day) => ({ key: String(day), label: words.weekday(new Date(start.getTime() + day * DAY)) }))} />;
    return [
        ...rail,
        { key: "roster.layout", side: "start", rank: HOST_RANK + 1, bundle: "roster.view", forms: [<Seg label="Layout" scope="roster" name="layout" items={LAYOUTS} active={view.layout} onPick={layout => setView({ ...view, layout })} />, null] },
        view.layout === "shifts" && { key: "roster.period", side: "start", rank: HOST_RANK + 1, bundle: "roster.view", forms: [<Seg label="Period" scope="roster" name="period" items={PERIODS} active={view.period} onPick={period} />, null] },
        { key: "roster.display", side: "start", rank: HOST_RANK + 1, bundle: "roster.view", forms: [<ChipMenu label="Display" icon={faSliders} onSelect={displayChoice}>{displayItems}</ChipMenu>, null] },
        { key: "roster.view", side: "start", rank: [HOST_RANK + 1, HOST_RANK + 6], bundle: ["roster.view", "roster.controls"], forms: [null, menu, null] },
        { key: "roster.navigation", side: "start", rank: [HOST_RANK + 4, HOST_RANK + 6], bundle: [undefined, "roster.controls"], forms: [navigation(), navigation(true), navigation(true, true)] },
        view.layout === "shifts" && view.period === "day" && { key: "roster.days", side: "start", rank: HOST_RANK + 2, forms: [daySelect, null] },
        { key: "roster.status", side: "start", rank: HOST_RANK, forms: [<Box css={styles.status} data-tone={status === "Published" ? "success" : "neutral"} data-roster-status="">{status}</Box>, null] },
        count > 0 && value.inspector.type === "some" && { key: "roster.issues", side: "end", rank: HOST_RANK + 3, forms: [<chakra.button type="button" css={[chip({ tone: "warn", numeric: true }), coarseHitArea({ position: true })]} onClick={args.onIssues} aria-label={`${count} roster issues`}><FontAwesomeIcon icon={faTriangleExclamation} /><span data-chip-label="">{count} issues</span></chakra.button>, null] },
        !value.settings.readOnly && commands.editing.held?.status.type !== "published" && historyToolbarItem({ session: commands.editing.history, words, editing: false, showError: false, onIssue: args.onIssues, onAction: args.onAction }),
        commands.editing.available && commands.editing.week.status.type !== "published" && { key: "roster.publish", side: "end", rank: HOST_RANK + 5, forms: [<Button size="xs" variant="solid" onClick={() => commands.publish()}>Publish</Button>, null] },
    ];
}
