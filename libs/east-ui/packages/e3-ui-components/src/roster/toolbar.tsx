/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

import { useState, type ReactElement } from "react";
import { Box, Button, Menu as ChakraMenu, chakra, useRecipe } from "@chakra-ui/react";
import { FontAwesomeIcon } from "@fortawesome/react-fontawesome";
import { faCalendarWeek, faTriangleExclamation, faSliders } from "@fortawesome/free-solid-svg-icons";
import type { SortedMap } from "@elaraai/east";
import {
    ChipMenu, OPTIMISE_RANK, historyToolbarItem, useKeySearchToolbarItem, type EditIssue, type EditingWords, type HistoryAction, type KeySearchSource, type ToolbarItem,
} from "@elaraai/east-ui-components";
import { HOST_RANK, PlaceholderShape, coarseHitArea, useRecordSlicesToolbarItems } from "@elaraai/east-ui-components/internal";
import { ROSTER_LAYOUT_PERIODS } from "@elaraai/e3-ui/internal";
import { SEARCH_BOX_RANK } from "../shared/schedule/search-rank.js";
import { shownViews } from "../shared/views.js";
import { Seg } from "../shared/schedule/segments.js";
import { shiftCalendar } from "../shared/time/scale.js";
import { TimeNavigator } from "../shared/time/navigation.js";
import type { RosterCommands } from "./actions.js";
import type { RosterEditing } from "./editing.js";
import { DAY, byDay, monthWords, weekNumber, type Issue, type RosterPeriod, type RosterStyles, type RosterValue, type Status } from "./model.js";
import type { RosterWindow } from "./window.js";

const LAYOUTS = [{ key: "shifts", label: "Shifts" }, { key: "people", label: "People" }] as const;
/** Each layout's periods, in the Period segment's order (#1406, P1): Shifts a day or a week, People a week or a month — a week alone on a phone (P31). */
const SHIFT_PERIODS = [{ key: "day", label: "Day" }, { key: "week", label: "Week" }] as const;
const PEOPLE_PERIODS = [{ key: "week", label: "Week" }, { key: "month", label: "Month" }] as const;
const PEOPLE_NARROW_PERIODS = [{ key: "week", label: "Week" }] as const;
/** The eye's step into the View and the View's step that draws its entry (ruled 27 Oct 2026, "Into the View menu"): one bundle, applied together. */
const EYE_INTO_VIEW = "roster.optimise";
interface ToolbarArgs extends RosterWindow {
    value: RosterValue; styles: RosterStyles; commands: RosterCommands; editing: RosterEditing | undefined; words: EditingWords;
    /** Whether main is narrower than a phone: People offers Week alone (#1406, P31). */
    narrow: boolean;
    /** The selected person-week's week, which Month → Week opens (#1406, P3). */
    selectedWeek: Date | undefined;
    /** The status chip's words — the week's, or by the day the day in view's or its week's days' (#1550); `undefined` without periods. */
    status: string | undefined;
    /** What Publish publishes, in its words (#1550): the week, or by the day in Shifts' Day the day in view. */
    publishUnit: "day" | "week";
    /**
     * Whether the week is not read yet (#1398, CL1): its status, its issues and Publish keep their slots, the status a
     * placeholder — never "Not started" before its row is read — and the issues one too, each unseen at its footprint
     * until the frame's reveal says so.
     */
    unread: boolean;
    /** Whether Publish is under way. */
    publishing: boolean;
    /** The open picker's periods' statuses, by their start: its weeks', or by the day its days' (#1550). */
    picker: SortedMap<Date, Status>;
    onDisplay: (value: Partial<{ density: "compact" | "comfortable"; chipSkills: boolean; requirements: boolean }>) => void;
    issues: readonly Issue[]; onIssues: () => void; onAction: (action: HistoryAction) => void; onPickerDates: (dates: readonly Date[]) => void;
    /** How many refusals hold Save (#1525): the issues chip counts them with the breaches and the gaps. */
    refused: number;
    /** The history's warning button pressed: its first issue's duty shown and selected (#1525). */
    onIssue: (issue: EditIssue) => void;
    /** Where an issue of the history's is, in the Roster's words — its banners' — what the history item's conflicts name their items by. */
    where?: ((issue: EditIssue) => string) | undefined;
    /** A conflict's Go to: its item shown and selected. */
    onConflict?: ((issue: EditIssue) => void) | undefined;
    /** Search Records over the people's keys (#1398); `undefined` with no one to seek. */
    search?: KeySearchSource | undefined;
    /** The Elara eye (#1409): the run's toolbar item, listed between the issues item and the history item; `undefined` with no optimiser. */
    optimise?: ToolbarItem | undefined;
    /**
     * The eye's entry (ruled 27 Oct 2026, "Into the View menu"): what the View lists in the eye's place, beside the issues,
     * where the row's floor folds the eye into it; `undefined` with no eye.
     */
    optimiseEntry?: ReactElement | undefined;
    /** Whether a run of the optimiser is out (#1409, R2): the history item stays, its actions locked. */
    locked?: boolean | undefined;
    /** Whether the issues chip flashes (#1409): a run's result landed, and its highlight is on. */
    issuesFlash?: boolean | undefined;
}
/** One shared Toolbar, including the narrowing's rail and the shared editing history. */
export function useRosterToolbar(args: ToolbarArgs): ReadonlyArray<ToolbarItem | false | undefined> {
    const { value, view, setView, start, span, styles, commands, words, issues, editing } = args;
    // The layouts this Roster offers: its switch, in every form, only where there is a choice to make.
    const layouts = LAYOUTS.filter(item => args.layouts.includes(item.key));
    const switches = layouts.length > 1;
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
    // The breaches and the gaps, and the refusals holding Save (#1525).
    const count = issues.filter(issue => issue.kind.type === "breach" || issue.kind.type === "gap").length + args.refused;
    // The layout's own periods (P1), each layout keeping its own as the window does; Month → Week opens the selected
    // person-week's week (P3).
    // Those this Roster offers: its switch, in every form, only where there is a choice to make.
    const taken: readonly { readonly key: RosterPeriod; readonly label: string }[] = view.layout === "people" ? (args.narrow ? PEOPLE_NARROW_PERIODS : PEOPLE_PERIODS) : SHIFT_PERIODS;
    const offeredPeriods = shownViews(ROSTER_LAYOUT_PERIODS[view.layout], value.settings.viewPeriods);
    const periods = taken.filter(item => offeredPeriods.includes(item.key));
    // A phone's People shows its one period as it always has (P31); the author's list leaving one takes the switch away.
    const picksPeriod = offeredPeriods.length > 1;
    const period = (key: RosterPeriod) => args.setPeriod(key, args.selectedWeek);
    const unit = view.period;
    const navigate = (step: number) => setView({ ...view, date: shiftCalendar(new Date(view.date), unit, step).getTime() });
    const status = args.publishing ? "Publishing" : args.status;
    const unread = args.unread;
    // Publish: only over periods, while a period it publishes takes edits — the week, or by the day the day in view or a
    // day of the week (#1550); its slot held wherever the Roster publishes and edits at all.
    const publishable = value.periods.type === "some" && commands.publishable && !args.publishing;
    const heldPublish = value.periods.type === "some" && !value.settings.readOnly;
    const publishWords = `Publish ${args.publishUnit}`;
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
        {switches && <>{layouts.map(item => <ChakraMenu.Item key={item.key} value={item.key}>{item.label}</ChakraMenu.Item>)}<ChakraMenu.Separator /></>}
        {picksPeriod && <>{periods.map(item => <ChakraMenu.Item key={item.key} value={item.key}>{item.label}</ChakraMenu.Item>)}<ChakraMenu.Separator /></>}
        <ChakraMenu.Item value="previous">Previous {unit}</ChakraMenu.Item><ChakraMenu.Item value="next">Next {unit}</ChakraMenu.Item>{value.inspector && <ChakraMenu.Item value="issues">{count} issues</ChakraMenu.Item>}<ChakraMenu.Separator />{displayItems}
        {heldPublish && <><ChakraMenu.Separator /><ChakraMenu.Item value="publish" disabled={!publishable}>{publishWords}</ChakraMenu.Item></>}
    </ChipMenu>;
    // The Elara eye (#1409) and its entry: at the row's floor the eye goes into the View, which lists it in its place
    // (ruled 27 Oct 2026, "Into the View menu"); an eye with no entry keeps to the row.
    const eye = args.optimise !== undefined && args.optimiseEntry !== undefined ? { item: args.optimise, entry: args.optimiseEntry } : undefined;
    // When the frame itself is narrower than a phone viewport, one popover
    // holds both week and view controls. It folds before the shared history —
    // and, at the row's floor, holds the eye's entry beside the issues.
    const controls = (withEye: boolean) => <Box css={styles.agendaGroup}>
        {search?.forms[0]}
        {switches && <Seg label="Layout" scope="roster" name="compact-layout" items={layouts} active={view.layout} onPick={args.setLayout} />}
        {picksPeriod && <Seg label="Period" scope="roster" name="compact-period" items={periods} active={view.period} onPick={period} />}
        <ChipMenu label="Display" icon={faSliders} onSelect={displayChoice}>{displayItems}</ChipMenu>
        {value.inspector && <Button size="xs" variant="ghost" onClick={args.onIssues}>{count} issues</Button>}
        {withEye && eye?.entry}
        {heldPublish && <Button size="xs" variant="solid" disabled={!publishable} loading={args.publishing} aria-label={publishWords} aria-busy={args.publishing ? true : undefined}
            onClick={() => commands.publish()}>{publishWords}</Button>}
    </Box>;
    // The People layout's labels (#1406, P2): the week and its number — `Mar 12 – 18, 2028 · W11` — or the month, its weeks
    // and its range — `March 2028 · W10–W14 · Mar 5 – Apr 1`. Shifts keeps the shared navigator's own words.
    const rangeLabel = view.period === "month" ? monthWords(words, span)
        : view.layout === "people" ? `${words.range(span.start, new Date(span.start.getTime() + 6 * DAY))} · W${words.number(weekNumber(span.start))}` : undefined;
    // The picker's marks: each week's status — or where the periods are days (#1550) each day's, a week's then published
    // once its seven days are and a draft once one is started — the app's own cases a draft's mark. Where the day in view
    // is what publishes, in Shifts' Day, it opens on the days.
    const days = byDay(value);
    const dayPicked = days && view.layout === "shifts" && view.period === "day";
    const markOf = (held: Status | undefined) => held === undefined ? "empty" : held.type === "published" ? "published" : "draft";
    const weekMark = (date: Date) => {
        if (!days) return markOf(args.picker.get(date));
        const held = Array.from({ length: 7 }, (_, day) => args.picker.get(new Date(date.getTime() + day * DAY)));
        return held.every(status => status?.type === "published") ? "published" : held.some(status => status !== undefined) ? "draft" : "empty";
    };
    const dot = (mark: string) => <Box as="span" css={styles.pickerDot} data-state={mark} />;
    const navigation = (compact = false, combined = false, withEye = false) => <TimeNavigator scope="roster" date={view.date} period={unit} rangeLabel={rangeLabel}
        sunday={value.settings.weekStart.type === "sunday"} onChange={date => setView({ ...view, date })}
        compact={compact} label={combined ? "View" : dayPicked ? "Choose roster day" : "Choose roster week"} initialPanel={dayPicked ? "day" : "week"} onWeeks={args.onPickerDates}
        weekMarker={date => dot(weekMark(date))} {...(days ? { dayMarker: (date: Date) => dot(markOf(args.picker.get(date))) } : {})}
        legend="Published · Draft · Not started" controls={combined ? controls(withEye) : undefined} />;
    const daySelect = <Seg label="Day of week" scope="roster" name="days" active={String(args.day)} onPick={day => setView({ ...view, date: start.getTime() + Number(day) * DAY })}
        items={Array.from({ length: 7 }, (_, day) => ({ key: String(day), label: words.weekday(new Date(start.getTime() + day * DAY)) }))} />;
    return [
        ...rail,
        switches && { key: "roster.layout", side: "start", rank: HOST_RANK + 1, bundle: "roster.view", forms: [<Seg label="Layout" scope="roster" name="layout" items={layouts} active={view.layout} onPick={args.setLayout} />, null] },
        // The layout's own periods, in every form of the row (#1406, P1).
        picksPeriod && { key: "roster.period", side: "start", rank: HOST_RANK + 1, bundle: "roster.view", forms: [<Seg label="Period" scope="roster" name="period" items={periods} active={view.period} onPick={period} />, null] },
        { key: "roster.display", side: "start", rank: HOST_RANK + 1, bundle: "roster.view", forms: [<ChipMenu label="Display" icon={faSliders} onSelect={displayChoice}>{displayItems}</ChipMenu>, null] },
        { key: "roster.view", side: "start", rank: [HOST_RANK + 1, HOST_RANK + 6], bundle: ["roster.view", "roster.controls"], forms: [null, menu, null] },
        // The week's navigation: compact, then the View holding the week and view controls; and, with an eye, at the
        // row's floor the View holding its entry too, in the step that takes the eye from the row (a rung of the floor).
        { key: "roster.navigation", side: "start", rank: [HOST_RANK + 4, HOST_RANK + 6, OPTIMISE_RANK], bundle: [undefined, "roster.controls", EYE_INTO_VIEW],
            forms: [navigation(), navigation(true), navigation(true, true), ...(eye === undefined ? [] : [navigation(true, true, true)])] },
        view.layout === "shifts" && view.period === "day" && { key: "roster.days", side: "start", rank: HOST_RANK + 2, forms: [daySelect, null] },
        // The status, the issues and Publish keep their slots from cold load, whatever the week's read (#1398, CL1): a read
        // landing never shifts the toolbar nor folds it again. Unread, the status and the issues are placeholders.
        status !== undefined && { key: "roster.status", side: "start", rank: HOST_RANK, forms: [unread
            ? <Box css={[styles.status, styles.heldSlot]} data-roster-status="" data-pending=""><PlaceholderShape kind="enum" index={0} /></Box>
            : <Box css={styles.status} data-tone={status === "Published" ? "success" : "neutral"} data-roster-status="">{status}</Box>, null] },
        value.inspector && { key: "roster.issues", side: "end", rank: HOST_RANK + 3, forms: [unread
            ? <Box css={styles.heldSlot} data-roster-issues="" data-pending=""><PlaceholderShape kind="count" index={0} /></Box>
            : count > 0 ? <chakra.button type="button" css={[chip({ tone: "warn" }), coarseHitArea({ position: true })]} data-roster-issues="" data-opn={args.issuesFlash === true ? "" : undefined} onClick={args.onIssues} aria-label={`${count} roster issues`}><FontAwesomeIcon icon={faTriangleExclamation} /><span data-chip-label="">{count} issues</span></chakra.button>
                : <Box css={styles.heldSlot} data-roster-issues="" aria-hidden="true" />, null] },
        search !== undefined && { ...search, forms: [...search.forms, null], rank: [SEARCH_BOX_RANK, HOST_RANK + 6], bundle: [undefined, "roster.controls"] },
        // The Elara eye (#1409), between the issues item and the history item, whose actions a run out locks (R2): in the row
        // at every width the ladder and the rail's caret leave it room, and else the View's entry, never out of the toolbar.
        eye === undefined ? args.optimise : { ...eye.item, forms: [...eye.item.forms, null], rank: OPTIMISE_RANK, bundle: EYE_INTO_VIEW },
        showHistory && historyToolbarItem({ session: history, words, editing: false, showError: false, onIssue: args.onIssue, onConflict: args.onConflict, where: args.where, onAction: args.onAction, locked: args.locked === true }),
        // As tall as every control in the row (`sm`, 28px, ruled 23 Oct 2026), its slot held while the week can't publish, and
        // its spinner while it publishes, until every record reads back as saved (#1573) — named as it is, `aria-busy`: the
        // spinner hides its words.
        heldPublish && { key: "roster.publish", side: "end", rank: HOST_RANK + 5, forms: [<Button size="sm" variant="solid" disabled={!publishable} loading={args.publishing}
            aria-label="Publish" aria-busy={args.publishing ? true : undefined} onClick={() => commands.publish()}>Publish</Button>, null] },
    ];
}
