/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

import { useState } from "react";
import { Box, Button, Menu as ChakraMenu, chakra, useRecipe } from "@chakra-ui/react";
import { FontAwesomeIcon } from "@fortawesome/react-fontawesome";
import { faCalendarWeek, faTriangleExclamation, faSliders } from "@fortawesome/free-solid-svg-icons";
import type { SortedMap } from "@elaraai/east";
import {
    ChipMenu, historyToolbarItem, useKeySearchToolbarItem, type EditingWords, type HistoryAction, type KeySearchSource, type ToolbarItem,
} from "@elaraai/east-ui-components";
import { HOST_RANK, PlaceholderShape, coarseHitArea, useRecordSlicesToolbarItems } from "@elaraai/east-ui-components/internal";
import { SEARCH_BOX_RANK } from "../shared/schedule/search-rank.js";
import { Seg } from "../shared/schedule/segments.js";
import { shiftCalendar } from "../shared/time/scale.js";
import { TimeNavigator } from "../shared/time/navigation.js";
import type { RosterCommands } from "./actions.js";
import type { RosterEditing } from "./editing.js";
import { DAY, monthWords, weekNumber, type Issue, type RosterPeriod, type RosterStyles, type RosterValue, type Status } from "./model.js";
import type { RosterWindow } from "./window.js";

const LAYOUTS = [{ key: "shifts", label: "Shifts" }, { key: "people", label: "People" }] as const;
/** Each layout's periods, in the Period segment's order (#1406, P1): Shifts a day or a week, People a week or a month — a week alone on a phone (P31). */
const SHIFT_PERIODS = [{ key: "day", label: "Day" }, { key: "week", label: "Week" }] as const;
const PEOPLE_PERIODS = [{ key: "week", label: "Week" }, { key: "month", label: "Month" }] as const;
const PEOPLE_NARROW_PERIODS = [{ key: "week", label: "Week" }] as const;
interface ToolbarArgs extends RosterWindow {
    value: RosterValue; styles: RosterStyles; commands: RosterCommands; editing: RosterEditing | undefined; words: EditingWords;
    /** Whether main is narrower than a phone: People offers Week alone (#1406, P31). */
    narrow: boolean;
    /** The selected person-week's week, which Month → Week opens (#1406, P3). */
    selectedWeek: Date | undefined;
    /** The week's status chip's words; `undefined` without periods. */
    status: string | undefined;
    /**
     * Whether the week is not read yet (#1398, CL1): its status, its issues and Publish keep their slots, the status a
     * placeholder — never "Not started" before its row is read — and the issues one too, each unseen at its footprint
     * until the frame's reveal says so.
     */
    unread: boolean;
    /** Whether Publish is under way. */
    publishing: boolean;
    /** The open picker's weeks' statuses, by their start. */
    picker: SortedMap<Date, Status>;
    onDisplay: (value: Partial<{ density: "compact" | "comfortable"; chipSkills: boolean; requirements: boolean }>) => void;
    issues: readonly Issue[]; onIssues: () => void; onAction: (action: HistoryAction) => void; onPickerDates: (dates: readonly Date[]) => void;
    /** Search Records over the people's keys (#1398); `undefined` with no one to seek. */
    search?: KeySearchSource | undefined;
    /** The Elara eye (#1409): the run's toolbar item, listed between the issues item and the history item; `undefined` with no optimiser. */
    optimise?: ToolbarItem | undefined;
    /** Whether a run of the optimiser is out (#1409, R2): the history item stays, its actions locked. */
    locked?: boolean | undefined;
    /** Whether the issues chip flashes (#1409): a run's result landed, and its highlight is on. */
    issuesFlash?: boolean | undefined;
}
/** One shared Toolbar, including the narrowing's rail and the shared editing history. */
export function useRosterToolbar(args: ToolbarArgs): ReadonlyArray<ToolbarItem | false | undefined> {
    const { value, view, setView, start, span, styles, commands, words, issues, editing } = args;
    // The narrowing: one rail over the week's duties, the people and the activities, each source counted in its own noun
    // (#1342); the duties' range is the Roster's own navigation, never a chip of the rail (#1369).
    const chrome = value.slice.type === "some" ? value.slice.value : undefined;
    const duty = value.duty.kind;
    const dutyRange = chrome?.slice.parts.find(part => part.source === duty.key)?.slice.config.range;
    const rail = useRecordSlicesToolbarItems(chrome?.slice, { nouns: { [duty.key]: `${duty.name.toLocaleLowerCase(words.locale)} events`, people: "people", activities: "activities", patterns: "patterns" },
        ...(dutyRange?.type === "some" ? { excludeFields: [`${duty.key}.${dutyRange.value}`] } : {}),
        ...(chrome === undefined ? {} : { affordances: chrome.affordances.map(a => a.type) }),
        ...(chrome?.persist.type === "some" ? { persist: chrome.persist.value.type } : {}),
    });
    const chip = useRecipe({ key: "chip" });
    // Search Records (#1398): primary-key navigation over the people, at the row's end. Its box is the first thing the row
    // folds, to its icon, before the rail and the week's steps (ruled 25 Oct 2026); at the row's last step it goes into the
    // View, beside the week and the view controls.
    const search = useKeySearchToolbarItem(args.search, { side: "end", rank: SEARCH_BOX_RANK });
    const count = issues.filter(issue => issue.kind.type === "breach" || issue.kind.type === "gap").length;
    // The layout's own periods (P1), each layout keeping its own as the window does; Month → Week opens the selected
    // person-week's week (P3).
    const periods = view.layout === "people" ? (args.narrow ? PEOPLE_NARROW_PERIODS : PEOPLE_PERIODS) : SHIFT_PERIODS;
    const period = (key: RosterPeriod) => args.setPeriod(key, args.selectedWeek);
    const unit = view.period;
    const navigate = (step: number) => setView({ ...view, date: shiftCalendar(new Date(view.date), unit, step).getTime() });
    const status = args.publishing ? "Publishing" : args.status;
    const unread = args.unread;
    // Publish: only over periods, on a week that takes edits; its slot held wherever the Roster publishes and edits at all.
    const publishable = value.periods.type === "some" && commands.available && !args.publishing;
    const heldPublish = value.periods.type === "some" && !value.settings.readOnly;
    // The history: wherever the week takes edits, and wherever a draft of another week waits to be saved. A week not read
    // yet keeps it as the last week read had it, so a read landing never shifts the toolbar nor folds it again (#1398, CL1).
    const history = editing?.history;
    const historyNow = history !== undefined && !value.settings.readOnly && (commands.available || args.locked === true || history.pending > 0 || history.status !== "idle");
    const [historyHeld, setHistoryHeld] = useState(historyNow);
    if (!unread && historyHeld !== historyNow) setHistoryHeld(historyNow);
    const showHistory = history !== undefined && (historyNow || (unread && historyHeld));
    const displayChoice = (key: string) => {
        if (key === "compact" || key === "comfortable") args.onDisplay({ density: key });
        else if (key === "skills") args.onDisplay({ chipSkills: !value.settings.chipSkills });
        else if (key === "targets") args.onDisplay({ requirements: !value.settings.requirements });
    };
    const displayItems = <><ChakraMenu.Item value="compact">Compact spacing</ChakraMenu.Item><ChakraMenu.Item value="comfortable">Comfortable spacing</ChakraMenu.Item>
        <ChakraMenu.Item value="skills">{value.settings.chipSkills ? "Hide" : "Show"} chip skills</ChakraMenu.Item><ChakraMenu.Item value="targets">{value.settings.requirements ? "Hide" : "Show"} requirements</ChakraMenu.Item></>;
    const menu = <ChipMenu label="View" icon={faCalendarWeek} onSelect={key => {
        if (key === "people" || key === "shifts") args.setLayout(key);
        else if (key === "day" || key === "week" || key === "month") period(key);
        else if (key === "publish" && publishable) commands.publish();
        else if (key === "previous") navigate(-1); else if (key === "next") navigate(1);
        else if (key === "issues") args.onIssues(); else displayChoice(key);
    }}>
        {LAYOUTS.map(item => <ChakraMenu.Item key={item.key} value={item.key}>{item.label}</ChakraMenu.Item>)}
        <ChakraMenu.Separator />{periods.map(item => <ChakraMenu.Item key={item.key} value={item.key}>{item.label}</ChakraMenu.Item>)}
        <ChakraMenu.Separator /><ChakraMenu.Item value="previous">Previous {unit}</ChakraMenu.Item><ChakraMenu.Item value="next">Next {unit}</ChakraMenu.Item>{value.inspector && <ChakraMenu.Item value="issues">{count} issues</ChakraMenu.Item>}<ChakraMenu.Separator />{displayItems}
        {heldPublish && <><ChakraMenu.Separator /><ChakraMenu.Item value="publish" disabled={!publishable}>Publish week</ChakraMenu.Item></>}
    </ChipMenu>;
    // When the frame itself is narrower than a phone viewport, one popover
    // holds both week and view controls. It folds before the shared history.
    const controls = <Box css={styles.agendaGroup}>
        {search?.forms[0]}
        <Seg label="Layout" scope="roster" name="compact-layout" items={LAYOUTS} active={view.layout} onPick={args.setLayout} />
        <Seg label="Period" scope="roster" name="compact-period" items={periods} active={view.period} onPick={period} />
        <ChipMenu label="Display" icon={faSliders} onSelect={displayChoice}>{displayItems}</ChipMenu>
        {value.inspector && <Button size="xs" variant="ghost" onClick={args.onIssues}>{count} issues</Button>}
        {heldPublish && <Button size="xs" variant="solid" disabled={!publishable} onClick={() => commands.publish()}>Publish week</Button>}
    </Box>;
    // The People layout's labels (#1406, P2): the week and its number — `Mar 12 – 18, 2028 · W11` — or the month, its weeks
    // and its range — `March 2028 · W10–W14 · Mar 5 – Apr 1`. Shifts keeps the shared navigator's own words.
    const rangeLabel = view.period === "month" ? monthWords(words, span)
        : view.layout === "people" ? `${words.range(span.start, new Date(span.start.getTime() + 6 * DAY))} · W${words.number(weekNumber(span.start))}` : undefined;
    const navigation = (compact = false, combined = false) => <TimeNavigator scope="roster" date={view.date} period={unit} rangeLabel={rangeLabel}
        sunday={value.settings.weekStart.type === "sunday"} onChange={date => setView({ ...view, date })}
        compact={compact} label={combined ? "View" : "Choose roster week"} initialPanel="week" onWeeks={args.onPickerDates}
        weekMarker={date => { const held = args.picker.get(date); return <Box as="span" css={styles.pickerDot} data-state={held === undefined ? "empty" : held.type === "other" ? "draft" : held.type} />; }}
        legend="Published · Draft · Not started" controls={combined ? controls : undefined} />;
    const daySelect = <Seg label="Day of week" scope="roster" name="days" active={String(args.day)} onPick={day => setView({ ...view, date: start.getTime() + Number(day) * DAY })}
        items={Array.from({ length: 7 }, (_, day) => ({ key: String(day), label: words.weekday(new Date(start.getTime() + day * DAY)) }))} />;
    return [
        ...rail,
        { key: "roster.layout", side: "start", rank: HOST_RANK + 1, bundle: "roster.view", forms: [<Seg label="Layout" scope="roster" name="layout" items={LAYOUTS} active={view.layout} onPick={args.setLayout} />, null] },
        // The layout's own periods, in every form of the row (#1406, P1).
        { key: "roster.period", side: "start", rank: HOST_RANK + 1, bundle: "roster.view", forms: [<Seg label="Period" scope="roster" name="period" items={periods} active={view.period} onPick={period} />, null] },
        { key: "roster.display", side: "start", rank: HOST_RANK + 1, bundle: "roster.view", forms: [<ChipMenu label="Display" icon={faSliders} onSelect={displayChoice}>{displayItems}</ChipMenu>, null] },
        { key: "roster.view", side: "start", rank: [HOST_RANK + 1, HOST_RANK + 6], bundle: ["roster.view", "roster.controls"], forms: [null, menu, null] },
        { key: "roster.navigation", side: "start", rank: [HOST_RANK + 4, HOST_RANK + 6], bundle: [undefined, "roster.controls"], forms: [navigation(), navigation(true), navigation(true, true)] },
        view.layout === "shifts" && view.period === "day" && { key: "roster.days", side: "start", rank: HOST_RANK + 2, forms: [daySelect, null] },
        // The status, the issues and Publish keep their slots from cold load, whatever the week's read (#1398, CL1): a read
        // landing never shifts the toolbar nor folds it again. Unread, the status and the issues are placeholders.
        status !== undefined && { key: "roster.status", side: "start", rank: HOST_RANK, forms: [unread
            ? <Box css={[styles.status, styles.heldSlot]} data-roster-status="" data-pending=""><PlaceholderShape kind="enum" index={0} /></Box>
            : <Box css={styles.status} data-tone={status === "Published" ? "success" : "neutral"} data-roster-status="">{status}</Box>, null] },
        value.inspector && { key: "roster.issues", side: "end", rank: HOST_RANK + 3, forms: [unread
            ? <Box css={styles.heldSlot} data-roster-issues="" data-pending=""><PlaceholderShape kind="count" index={0} /></Box>
            : count > 0 ? <chakra.button type="button" css={[chip({ tone: "warn", numeric: true }), coarseHitArea({ position: true })]} data-roster-issues="" data-opn={args.issuesFlash === true ? "" : undefined} onClick={args.onIssues} aria-label={`${count} roster issues`}><FontAwesomeIcon icon={faTriangleExclamation} /><span data-chip-label="">{count} issues</span></chakra.button>
                : <Box css={styles.heldSlot} data-roster-issues="" aria-hidden="true" />, null] },
        search !== undefined && { ...search, forms: [...search.forms, null], rank: [SEARCH_BOX_RANK, HOST_RANK + 6], bundle: [undefined, "roster.controls"] },
        // The Elara eye (#1409), between the issues item and the history item, whose actions a run out locks (R2).
        args.optimise,
        showHistory && historyToolbarItem({ session: history, words, editing: false, showError: false, onIssue: args.onIssues, onAction: args.onAction, locked: args.locked === true }),
        // As tall as every control in the row (`sm`, 28px, ruled 23 Oct 2026), its slot held while the week can't publish.
        heldPublish && { key: "roster.publish", side: "end", rank: HOST_RANK + 5, forms: [<Button size="sm" variant="solid" disabled={!publishable} onClick={() => commands.publish()}>Publish</Button>, null] },
    ];
}
