/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

import { useEffect, useMemo, useState, type ReactNode } from "react";
import { Box, Button, Menu as ChakraMenu, chakra, useRecipe } from "@chakra-ui/react";
import { FontAwesomeIcon } from "@fortawesome/react-fontawesome";
import { faCalendarWeek, faChevronLeft, faChevronRight, faTriangleExclamation, faSliders } from "@fortawesome/free-solid-svg-icons";
import { ChipMenu, SliceEditPopover, historyToolbarItem, useFormatters, useSliceReactivity, type EditingWords, type HistoryAction, type ToolbarItem } from "@elaraai/east-ui-components";
import { HOST_RANK, coarseHitArea, railAffordanceKinds, useSliceToolbarItems } from "@elaraai/east-ui-components/internal";
import { Seg } from "../shared/schedule/segments.js";
import { isoWeekUTC } from "../shared/time/scale.js";
import type { RosterCommands } from "./actions.js";
import { DAY, weekStart, type Issue, type RosterStyles, type RosterValue, type Week } from "./model.js";
import type { useRosterWindow } from "./window.js";

const LAYOUTS = [{ key: "shifts", label: "Shifts" }, { key: "people", label: "People" }] as const;
const PERIODS = [{ key: "day", label: "Day" }, { key: "week", label: "Week" }] as const;
const NO_DATES: readonly Date[] = [];
/** Month-at-a-time picker; only its open month asks for week status reads. */
function WeekPicker({ value, start, weeks, choose, onDates, styles, compact = false, controls, label = "Choose roster week" }: {
    value: RosterValue; start: Date; weeks: ReadonlyMap<Date, Week>; choose: (date: Date) => void; onDates: (dates: readonly Date[]) => void; styles: RosterStyles; compact?: boolean; controls?: ReactNode; label?: string;
}) {
    const format = useFormatters();
    const [open, setOpen] = useState(false);
    const [month, setMonth] = useState(() => Date.UTC(start.getUTCFullYear(), start.getUTCMonth(), 1));
    const dates = useMemo(() => {
        const first = weekStart(new Date(month), value.settings.weekStart.type === "sunday");
        const end = Date.UTC(new Date(month).getUTCFullYear(), new Date(month).getUTCMonth() + 1, 1);
        const days: Date[] = []; for (let at = first.getTime(); at < end; at += 7 * DAY) days.push(new Date(at)); return days;
    }, [month, value.settings.weekStart.type]);
    useEffect(() => { if (open) onDates(dates); }, [open, dates, onDates]);
    const shift = (step: number) => setMonth(Date.UTC(new Date(month).getUTCFullYear(), new Date(month).getUTCMonth() + step, 1));
    return <SliceEditPopover open={open} onOpenChange={next => { setOpen(next); if (!next) onDates(NO_DATES); if (next) setMonth(Date.UTC(start.getUTCFullYear(), start.getUTCMonth(), 1)); }} label={label}
        trigger={<Button size="xs" variant="ghost" aria-label={label} title={format.range(start, new Date(start.getTime() + 6 * DAY))}>W{isoWeekUTC(new Date(start.getTime() + 3 * DAY))}{!compact && ` · ${format.range(start, new Date(start.getTime() + 6 * DAY))}`}</Button>}>
        <Box css={styles.actions}><Button size="xs" variant="ghost" aria-label="Previous month" onClick={() => shift(-1)}><FontAwesomeIcon icon={faChevronLeft} /></Button>
            <Box css={styles.title}>{format.monthYear(new Date(month))}</Box><Button size="xs" variant="ghost" aria-label="Next month" onClick={() => shift(1)}><FontAwesomeIcon icon={faChevronRight} /></Button></Box>
        <Box css={styles.picker}>{dates.map(date => <chakra.button type="button" key={date.getTime()} css={styles.pickerRow} data-roster-picker-week={date.toISOString().slice(0, 10)} data-selected={date.getTime() === start.getTime() ? "" : undefined}
            onClick={() => { choose(date); setOpen(false); onDates(NO_DATES); }}><Box as="span" css={styles.pickerDot} data-state={weeks.get(date)?.status.type ?? "empty"} />
            W{isoWeekUTC(new Date(date.getTime() + 3 * DAY))} · {format.range(date, new Date(date.getTime() + 6 * DAY))}</chakra.button>)}</Box>
        <Box css={styles.detail}>Published · Draft · Not started</Box>
        {controls !== undefined && <Box css={styles.paneFoot}>{controls}</Box>}
    </SliceEditPopover>;
}
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
    const navigate = (step: number) => setView({ ...view, date: view.date + step * 7 * DAY });
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
        else if (key === "today") setView({ ...view, date: Date.now() }); else if (key === "issues") args.onIssues(); else displayChoice(key);
    }}>
        {LAYOUTS.map(item => <ChakraMenu.Item key={item.key} value={item.key}>{item.label}</ChakraMenu.Item>)}<ChakraMenu.Separator />
        {PERIODS.map(item => <ChakraMenu.Item key={item.key} value={item.key} disabled={view.layout === "people" && item.key === "day"}>{item.label}</ChakraMenu.Item>)}
        <ChakraMenu.Separator /><ChakraMenu.Item value="previous">Previous week</ChakraMenu.Item><ChakraMenu.Item value="next">Next week</ChakraMenu.Item><ChakraMenu.Item value="today">This week</ChakraMenu.Item>{value.inspector.type === "some" && <ChakraMenu.Item value="issues">{count} issues</ChakraMenu.Item>}<ChakraMenu.Separator />{displayItems}
        {commands.editing.available && commands.editing.week.status.type !== "published" && <><ChakraMenu.Separator /><ChakraMenu.Item value="publish">Publish week</ChakraMenu.Item></>}
    </ChipMenu>;
    const navigation = <Box css={styles.actions}><Button size="xs" variant="ghost" aria-label="Previous week" onClick={() => navigate(-1)}><FontAwesomeIcon icon={faChevronLeft} /></Button>
        <WeekPicker value={value} start={start} weeks={args.weeks} choose={date => setView({ ...view, date: date.getTime() })} onDates={args.onPickerDates} styles={styles} />
        <Button size="xs" variant="ghost" aria-label="Next week" onClick={() => navigate(1)}><FontAwesomeIcon icon={faChevronRight} /></Button></Box>;
    // When the frame itself is narrower than a phone viewport, one popover
    // holds both week and view controls. It folds before the shared history.
    const controls = <Box css={styles.agendaGroup}>
        <Seg label="Layout" scope="roster" name="compact-layout" items={LAYOUTS} active={view.layout} onPick={layout => setView({ ...view, layout })} />
        <Seg label="Period" scope="roster" name="compact-period" items={PERIODS.map(p => ({ ...p, disabled: view.layout === "people" && p.key === "day" }))} active={view.layout === "people" ? "week" : view.period} onPick={period} />
        <Box css={styles.actions}><Button size="xs" variant="ghost" onClick={() => navigate(-1)}>Previous week</Button><Button size="xs" variant="ghost" onClick={() => navigate(1)}>Next week</Button><Button size="xs" variant="ghost" onClick={() => setView({ ...view, date: Date.now() })}>This week</Button></Box>
        <ChipMenu label="Display" icon={faSliders} onSelect={displayChoice}>{displayItems}</ChipMenu>
        {value.inspector.type === "some" && <Button size="xs" variant="ghost" onClick={args.onIssues}>{count} issues</Button>}
        {commands.editing.available && commands.editing.week.status.type !== "published" && <Button size="xs" variant="solid" onClick={() => commands.publish()}>Publish week</Button>}
    </Box>;
    const daySelect = <Seg label="Day of week" scope="roster" name="days" active={String(args.day)} onPick={day => setView({ ...view, date: start.getTime() + Number(day) * DAY })}
        items={Array.from({ length: 7 }, (_, day) => ({ key: String(day), label: words.weekday(new Date(start.getTime() + day * DAY)) }))} />;
    return [
        ...rail,
        { key: "roster.layout", side: "start", rank: HOST_RANK + 1, bundle: "roster.view", forms: [<Seg label="Layout" scope="roster" name="layout" items={LAYOUTS} active={view.layout} onPick={layout => setView({ ...view, layout })} />, null] },
        { key: "roster.period", side: "start", rank: HOST_RANK + 1, bundle: "roster.view", forms: [<Seg label="Period" scope="roster" name="period" items={PERIODS.map(p => ({ ...p, disabled: view.layout === "people" && p.key === "day" }))} active={view.layout === "people" ? "week" : view.period} onPick={period} />, null] },
        { key: "roster.display", side: "start", rank: HOST_RANK + 1, bundle: "roster.view", forms: [<ChipMenu label="Display" icon={faSliders} onSelect={displayChoice}>{displayItems}</ChipMenu>, null] },
        { key: "roster.view", side: "start", rank: [HOST_RANK + 1, HOST_RANK + 6], bundle: ["roster.view", "roster.controls"], forms: [null, menu, null] },
        { key: "roster.navigation", side: "start", rank: [HOST_RANK + 4, HOST_RANK + 6], bundle: [undefined, "roster.controls"], forms: [navigation, <WeekPicker compact value={value} start={start} weeks={args.weeks} choose={date => setView({ ...view, date: date.getTime() })} onDates={args.onPickerDates} styles={styles} />, <WeekPicker compact label="View" controls={controls} value={value} start={start} weeks={args.weeks} choose={date => setView({ ...view, date: date.getTime() })} onDates={args.onPickerDates} styles={styles} />] },
        view.layout === "shifts" && view.period === "day" && { key: "roster.days", side: "start", rank: HOST_RANK + 2, forms: [daySelect, null] },
        { key: "roster.status", side: "start", rank: HOST_RANK, forms: [<Box css={styles.status} data-tone={status === "Published" ? "success" : "neutral"} data-roster-status="">{status}</Box>, null] },
        count > 0 && value.inspector.type === "some" && { key: "roster.issues", side: "end", rank: HOST_RANK + 3, forms: [<chakra.button type="button" css={[chip({ tone: "warn", numeric: true }), coarseHitArea({ position: true })]} onClick={args.onIssues} aria-label={`${count} roster issues`}><FontAwesomeIcon icon={faTriangleExclamation} /><span data-chip-label="">{count} issues</span></chakra.button>, null] },
        !value.settings.readOnly && commands.editing.held?.status.type !== "published" && historyToolbarItem({ session: commands.editing.history, words, editing: false, showError: false, onIssue: args.onIssues, onAction: args.onAction }),
        commands.editing.available && commands.editing.week.status.type !== "published" && { key: "roster.publish", side: "end", rank: HOST_RANK + 5, forms: [<Button size="xs" variant="solid" onClick={() => commands.publish()}>Publish</Button>, null] },
    ];
}
