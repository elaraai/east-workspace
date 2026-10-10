/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { StatusDisplay } from "../components/StatusDisplay.js";
import { Box, Button, useSlotRecipe } from "@chakra-ui/react";
import { none, some, variant } from "@elaraai/east";
import { RosterComponent } from "@elaraai/e3-ui/internal";
import { BannerView, BuilderFrame, SessionBanners, editingMessages, historyShortcut, implementUIComponent, typedInto, useContainerBelow, useFormatters, usePersistedState, useTrackedEvaluation, type HistoryAction } from "@elaraai/east-ui-components";
import { rosterCommands, type PeopleFocus } from "./actions.js";
import { useRosterData } from "./data.js";
import { useRosterDrag } from "./drag.js";
import { useRosterEditing } from "./editing.js";
import { RosterFooter } from "./footer.js";
import { useRosterInspector } from "./inspector.js";
import { useRosterLibrary } from "./library.js";
import { DAY, NARROW_WIDTH, availableProposals, configError, rosterContext, rosterDomain, type Issue, type RosterStyles, type RosterValue, type Selection } from "./model.js";
import { useRosterToolbar } from "./toolbar.js";
import { RosterViews } from "./views.js";
import { useRosterWindow } from "./window.js";
export type { RosterValue } from "./model.js";
/** Props of the record-backed Roster extension. */
export interface EastChakraRosterProps { value: RosterValue; storageKey: string }
const NO_DATES: readonly Date[] = [];
function RosterFrame({ value: source, storageKey }: EastChakraRosterProps) {
    const key = `${storageKey}.${source.id.type === "some" ? source.id.value : "roster"}`;
    const { state: display, setState: setDisplay } = usePersistedState(`${key}.display`, { density: source.settings.density.type, chipSkills: source.settings.chipSkills, requirements: source.settings.requirements });
    const value = useMemo(() => ({ ...source, settings: { ...source.settings, ...display, density: variant(display.density, null) } }), [source, display]);
    const window = useRosterWindow(value, key);
    const [pickerDates, setPickerDates] = useState(NO_DATES);
    const data = useRosterData(value, window.start, pickerDates);
    const editing = useRosterEditing(value, window.start, key, data);
    const [selection, setSelection] = useState<Selection>();
    const [tab, setTab] = useState("details");
    const [libraryTab, setLibraryTab] = useState<string>();
    const [focus, setFocus] = useState<PeopleFocus>();
    const [error, setError] = useState<string>();
    const root = useRef<HTMLDivElement>(null), main = useRef<HTMLDivElement>(null);
    const narrow = useContainerBelow(main, NARROW_WIDTH);
    const revealPane = (label: string) => root.current?.querySelector<HTMLButtonElement>(`button[aria-label="Expand ${label}"]`)?.click();
    const select = useCallback((next: Selection | undefined) => { setSelection(next); setTab("details"); if (next !== undefined) revealPane("Inspector"); }, []);
    const find = useCallback((next: PeopleFocus) => { setFocus(next); setLibraryTab("people"); revealPane("Library"); }, []);
    const weekEpoch = window.start.getTime();
    useEffect(() => { setSelection(undefined); setError(undefined); }, [weekEpoch]);
    const recipe = useSlotRecipe({ key: "rosterBuilder" });
    const styles = useMemo(() => recipe({}) as unknown as RosterStyles, [recipe]);
    const format = useFormatters(), words = useMemo(() => ({ ...format, m: editingMessages }), [format]);
    const context = useMemo(() => rosterContext(value), [value]);
    const domain = rosterDomain();
    const coverage = useMemo(() => domain.coverage(editing.week, context), [domain, editing.week, context]);
    const hours = useMemo(() => domain.hours(editing.week, context), [domain, editing.week, context]);
    const builtIn = useMemo(() => domain.check(editing.week, context), [domain, editing.week, context]);
    const proposals = availableProposals(value, editing.week, window.start);
    const readCheck = useCallback(() => value.check.type === "some" ? value.check.value({ start: window.start, week: editing.week, context, coverage }) : [], [value.check, window.start, editing.week, context, coverage]);
    const custom = useTrackedEvaluation(readCheck);
    const allIssues: Issue[] = [...builtIn, ...(custom.result.ok ? custom.result.value : []), ...proposals.map(p => ({ kind: variant("proposal", null), tone: variant("info", null),
        title: `${value.people.find(person => person.key === p.person)?.name ?? p.person} · proposed`, detail: p.reason, slot: some(p.slot), assignment: none, flag: none, fix: some(variant("accept", p.key)) }))];
    const issues = allIssues.filter(i => window.view.layout === "people" || window.view.period === "week" || i.slot.type === "none" || Number(i.slot.value.day) === window.day);
    // Commands update the selected item without changing the user's pane/tab.
    // Only an explicit inspection click uses `select` to reveal Details.
    const commands = rosterCommands(value, editing, window.start, setSelection, find);
    const drag = useRosterDrag({ value, commands, storageKey: key, narrow, start: window.start, onError: setError });
    const viewProps = { value, week: editing.week, held: editing.held, start: window.start, day: window.day, view: window.view, setView: window.setView,
        styles, format, narrow, coverage, hours, issues, proposals, selection, select, commands, drag, onError: setError };
    const start = useRosterLibrary({ ...viewProps, storageKey: key, focus, tab: libraryTab, onTab: setLibraryTab });
    const end = useRosterInspector({ ...viewProps, storageKey: key, tab, onTab: setTab });
    const onIssues = () => { setTab("issues"); revealPane("Inspector"); };
    const onAction = useCallback((action: HistoryAction) => { const active = document.activeElement; if (active instanceof HTMLElement) active.blur(); editing.history.act(action); }, [editing.history]);
    const toolbar = useRosterToolbar({ ...window, value, styles, commands, words, weeks: data.weeks, issues, onIssues, onAction, onPickerDates: setPickerDates, onDisplay: next => setDisplay({ ...display, ...next }) });
    const previous = data.weeks.get(new Date(window.start.getTime() - 7 * DAY));
    const published = data.weeks.get(window.start)?.status.type === "published";
    return <Box ref={root} css={styles.root} data-roster-frame="" data-roster-readonly={published || value.settings.readOnly ? "" : undefined}>
        <BuilderFrame storageKey={`${key}.frame`} label="Roster" start={start} end={end} toolbar={toolbar} onKeyDown={event => {
            if (event.defaultPrevented || typedInto(event.target)) return;
            const action = historyShortcut(event); if (action !== undefined && !value.settings.readOnly && !published) { event.preventDefault(); onAction(action); }
            else if (event.key === "[" || event.key === "]") { event.preventDefault(); window.setView({ ...window.view, date: window.view.date + (event.key === "[" ? -7 : 7) * DAY }); }
            else if (event.key === "Escape") { setSelection(undefined); setError(undefined); }
            else if ((event.key === "Delete" || event.key === "Backspace") && (selection?.type === "assignment" || selection?.type === "proposal") && editing.available) { event.preventDefault(); if (selection.type === "assignment") commands.remove(selection.key); else commands.reject(selection.key); }
        }} banners={<>
            {editing.session !== undefined && <SessionBanners session={editing.session} words={words} onAction={action => editing.history.actOn(editing.key, action)} />}
            {published && <BannerView status="info" title="Published week" description="Read-only view of the published roster." />}
            {!data.loading && editing.held === undefined && editing.week.assignments.size === 0 && <BannerView status="info" title="Week not started" description="Forecast targets are ready. Assign staff to start this week's roster."
                actions={previous !== undefined && editing.available ? <Button size="xs" variant="outline" onClick={() => commands.copy(previous)}>Copy previous week</Button> : undefined} />}
            {!custom.result.ok && <BannerView status="warning" title="Additional checks unavailable" description="The roster's additional checks could not run. Built-in checks are still shown." />}
            {(error ?? data.error) !== undefined && <Box css={styles.error} role="alert">{error ?? data.error}</Box>}
        </>} footer={<RosterFooter styles={styles} narrow={narrow} />}>
            <Box ref={main} css={styles.main} data-roster-main="" aria-busy={data.loading} data-roster-narrow={narrow ? "" : undefined}>{data.loading ? <StatusDisplay variant={data.error === undefined ? "loading" : "error"} title={data.error === undefined ? "Loading roster…" : "Roster unavailable"} {...(data.error === undefined ? {} : { message: data.error })} /> : <RosterViews {...viewProps} />}</Box>
        </BuilderFrame>
    </Box>;
}
/** The e3 renderer owns the frame; callers author only the Roster tag and bound data. */
export function EastChakraRoster(props: EastChakraRosterProps) {
    const error = configError(props.value);
    return error === undefined ? <RosterFrame {...props} /> : <BannerView status="error" title="Roster configuration" description={error} />;
}
implementUIComponent(RosterComponent, EastChakraRoster);
