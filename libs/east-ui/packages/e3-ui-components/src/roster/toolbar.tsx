/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

import { Box, Button, Menu as ChakraMenu, chakra, useRecipe } from "@chakra-ui/react";
import { FontAwesomeIcon } from "@fortawesome/react-fontawesome";
import { faCalendarWeek, faTriangleExclamation, faSliders } from "@fortawesome/free-solid-svg-icons";
import type { SortedMap } from "@elaraai/east";
import { ChipMenu, historyToolbarItem, type EditingWords, type HistoryAction, type ToolbarItem } from "@elaraai/east-ui-components";
import { HOST_RANK, coarseHitArea, useRecordSlicesToolbarItems } from "@elaraai/east-ui-components/internal";
import { Seg } from "../shared/schedule/segments.js";
import { shiftCalendar } from "../shared/time/scale.js";
import { TimeNavigator } from "../shared/time/navigation.js";
import type { RosterCommands } from "./actions.js";
import type { RosterEditing } from "./editing.js";
import { DAY, type Issue, type RosterStyles, type RosterValue, type Status } from "./model.js";
import type { RosterWindow } from "./window.js";

const LAYOUTS = [{ key: "shifts", label: "Shifts" }, { key: "people", label: "People" }] as const;
const PERIODS = [{ key: "day", label: "Day" }, { key: "week", label: "Week" }] as const;
interface ToolbarArgs extends RosterWindow {
    value: RosterValue; styles: RosterStyles; commands: RosterCommands; editing: RosterEditing | undefined; words: EditingWords;
    /** The week's status chip's words; `undefined` without periods. */
    status: string | undefined;
    /** Whether Publish is under way. */
    publishing: boolean;
    /** The open picker's weeks' statuses, by their start. */
    picker: SortedMap<Date, Status>;
    onDisplay: (value: Partial<{ density: "compact" | "comfortable"; chipSkills: boolean; requirements: boolean }>) => void;
    issues: readonly Issue[]; onIssues: () => void; onAction: (action: HistoryAction) => void; onPickerDates: (dates: readonly Date[]) => void;
}
/** One shared Toolbar, including the narrowing's rail and the shared editing history. */
export function useRosterToolbar(args: ToolbarArgs): ReadonlyArray<ToolbarItem | false | undefined> {
    const { value, view, setView, start, styles, commands, words, issues, editing } = args;
    // The narrowing: one rail over the week's duties, the people and the activities, each source counted in its own noun
    // (#1342); the duties' range is the Roster's own navigation, never a chip of the rail (#1369).
    const chrome = value.slice.type === "some" ? value.slice.value : undefined;
    const duty = value.duty.kind;
    const dutyRange = chrome?.slice.parts.find(part => part.source === duty.key)?.slice.config.range;
    const rail = useRecordSlicesToolbarItems(chrome?.slice, { nouns: { [duty.key]: `${duty.name.toLocaleLowerCase(words.locale)} events`, people: "people", activities: "activities" },
        ...(dutyRange?.type === "some" ? { excludeFields: [`${duty.key}.${dutyRange.value}`] } : {}),
        ...(chrome === undefined ? {} : { affordances: chrome.affordances.map(a => a.type) }),
        ...(chrome?.persist.type === "some" ? { persist: chrome.persist.value.type } : {}),
    });
    const chip = useRecipe({ key: "chip" });
    const count = issues.filter(issue => issue.kind.type === "breach" || issue.kind.type === "gap").length;
    const period = (key: "day" | "week") => setView({ ...view, period: key });
    const unit = view.layout === "people" ? "week" : view.period;
    const navigate = (step: number) => setView({ ...view, date: shiftCalendar(new Date(view.date), unit, step).getTime() });
    const status = args.publishing ? "Publishing" : args.status;
    // Publish: only over periods, on a week that takes edits.
    const publishable = value.periods.type === "some" && commands.available && !args.publishing;
    // The history: wherever the week takes edits, and wherever a draft of another week waits to be saved.
    const history = editing?.history;
    const showHistory = history !== undefined && !value.settings.readOnly && (commands.available || history.pending > 0 || history.status !== "idle");
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
        else if (key === "issues") args.onIssues(); else displayChoice(key);
    }}>
        {LAYOUTS.map(item => <ChakraMenu.Item key={item.key} value={item.key}>{item.label}</ChakraMenu.Item>)}
        {view.layout === "shifts" && <><ChakraMenu.Separator />{PERIODS.map(item => <ChakraMenu.Item key={item.key} value={item.key}>{item.label}</ChakraMenu.Item>)}</>}
        <ChakraMenu.Separator /><ChakraMenu.Item value="previous">Previous {unit}</ChakraMenu.Item><ChakraMenu.Item value="next">Next {unit}</ChakraMenu.Item>{value.inspector && <ChakraMenu.Item value="issues">{count} issues</ChakraMenu.Item>}<ChakraMenu.Separator />{displayItems}
        {publishable && <><ChakraMenu.Separator /><ChakraMenu.Item value="publish">Publish week</ChakraMenu.Item></>}
    </ChipMenu>;
    // When the frame itself is narrower than a phone viewport, one popover
    // holds both week and view controls. It folds before the shared history.
    const controls = <Box css={styles.agendaGroup}>
        <Seg label="Layout" scope="roster" name="compact-layout" items={LAYOUTS} active={view.layout} onPick={layout => setView({ ...view, layout })} />
        {view.layout === "shifts" && <Seg label="Period" scope="roster" name="compact-period" items={PERIODS} active={view.period} onPick={period} />}
        <ChipMenu label="Display" icon={faSliders} onSelect={displayChoice}>{displayItems}</ChipMenu>
        {value.inspector && <Button size="xs" variant="ghost" onClick={args.onIssues}>{count} issues</Button>}
        {publishable && <Button size="xs" variant="solid" onClick={() => commands.publish()}>Publish week</Button>}
    </Box>;
    const navigation = (compact = false, combined = false) => <TimeNavigator scope="roster" date={view.date} period={unit}
        sunday={value.settings.weekStart.type === "sunday"} onChange={date => setView({ ...view, date })}
        compact={compact} label={combined ? "View" : "Choose roster week"} initialPanel="week" onWeeks={args.onPickerDates}
        weekMarker={date => { const held = args.picker.get(date); return <Box as="span" css={styles.pickerDot} data-state={held === undefined ? "empty" : held.type === "other" ? "draft" : held.type} />; }}
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
        status !== undefined && { key: "roster.status", side: "start", rank: HOST_RANK, forms: [<Box css={styles.status} data-tone={status === "Published" ? "success" : "neutral"} data-roster-status="">{status}</Box>, null] },
        count > 0 && value.inspector && { key: "roster.issues", side: "end", rank: HOST_RANK + 3, forms: [<chakra.button type="button" css={[chip({ tone: "warn", numeric: true }), coarseHitArea({ position: true })]} onClick={args.onIssues} aria-label={`${count} roster issues`}><FontAwesomeIcon icon={faTriangleExclamation} /><span data-chip-label="">{count} issues</span></chakra.button>, null] },
        showHistory && historyToolbarItem({ session: history, words, editing: false, showError: false, onIssue: args.onIssues, onAction: args.onAction }),
        publishable && { key: "roster.publish", side: "end", rank: HOST_RANK + 5, forms: [<Button size="xs" variant="solid" onClick={() => commands.publish()}>Publish</Button>, null] },
    ];
}
