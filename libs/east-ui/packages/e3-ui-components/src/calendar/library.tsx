/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

/**
 * Calendar's optional library uses the same Library cards as Plan. Each tab
 * follows its source of the slice (#1343): the Templates tab each templates
 * list's, by template key; the Backlog its kinds' own narrowing; an app's tab
 * the source it names, by its rows' keys — each counting what it shows and
 * saying so, with Clear filters, when the rail leaves it none. While its
 * period is read, the Backlog counts "…" and draws pending cards, never "No
 * backlog events" before its read (#1398, CL13).
 */
import { useState } from "react";
import { Box, Button } from "@chakra-ui/react";
import { none, some } from "@elaraai/east";
import { EastChakraLibrary, useFormatters, type BuilderFrameDock, type LibraryEmpty, type LibraryItemValue, type LibraryNarrowing } from "@elaraai/east-ui-components";
import { narrowedCount, type CountWords } from "@elaraai/east-ui-components/internal";
import { scheduleLibrary, scheduleLibraryCard } from "../shared/schedule/library.js";
import { dueGroupOf, durationMinutes } from "../shared/schedule/due.js";
import type { FollowedSources } from "../shared/schedule/follow-sources.js";
import { PendingCards } from "../shared/schedule/pending-cards.js";
import { sourceTab, sourcesTab, type SourceShown, type SourceTab } from "../shared/schedule/source-tab.js";
import { PlacementAction, type CalendarShownResources } from "./controls.js";
import type { CalendarCommands, CalendarSource } from "./actions.js";
import type { BacklogNarrowing } from "../shared/schedule/backlog.js";
import type { CalendarEventPart } from "./window.js";
import { eventKey, type CalendarItem, type CalendarKind, type CalendarStyles, type CalendarTemplate, type CalendarValue } from "./model.js";

/** Library ids also name the shared drag grammar's sources. */
export function calendarLibraryId(key: string, tab: string): string { return `${key}.library.${tab}`; }
/** The kind and source record key identify a template. */
export function templateSources(value: CalendarValue): Map<string, CalendarSource> {
    return new Map(value.events.flatMap(kind => kind.templates.map(template => [eventKey({ kind: kind.key, key: template.key }), { kind, template }] as const)));
}

/** One template's card: its id, and the template it is. */
interface TemplateEntry { id: string; kind: CalendarKind; template: CalendarTemplate }

/** The Templates tab, and the templates it shows by their card's id: what a drop or a drawn event is made from. */
export interface CalendarTemplatesTab extends SourceTab<TemplateEntry> {
    shown: ReadonlyMap<string, CalendarSource>;
}

/**
 * The Templates tab (#1343): every kind's templates, each following the source
 * its templates list names by its record key.
 *
 * @param value - The payload
 * @param followed - The sources the Calendar follows
 * @param words - The app's number formatter
 * @returns The tab, and the templates it shows
 */
export function templatesTab(value: CalendarValue, followed: FollowedSources, words: CountWords): CalendarTemplatesTab {
    const entries = value.events.flatMap(kind => kind.templates.map((template): TemplateEntry => ({ id: eventKey({ kind: kind.key, key: template.key }), kind, template })));
    const sourceOf = (kind: CalendarKind): SourceShown | undefined => kind.templatesSource.type === "some" ? followed.get(kind.templatesSource.value)?.shown : undefined;
    const sources = [...new Set(value.events.flatMap(kind => { const shown = sourceOf(kind); return shown === undefined ? [] : [shown]; }))];
    const tab = sourcesTab({ cards: entries, keyOf: entry => entry.template.key, sources, sourceOf: entry => sourceOf(entry.kind), noun: "templates", words });
    return { ...tab, shown: new Map(tab.cards.map(entry => [entry.id, { kind: entry.kind, template: entry.template }] as const)) };
}

interface LibraryArgs {
    value: CalendarValue; backlog: readonly CalendarItem[]; selection: readonly CalendarItem[]; key: string;
    /** Whether the backlog is read for the period shown: until it is, the tab counts "…" and draws pending cards. */
    backlogRead: boolean;
    narrow: boolean; now: Date; day: Date; styles: CalendarStyles; commands: CalendarCommands | undefined;
    activeTemplate: string | undefined; onTemplate: (key: string) => void;
    /** The Templates tab, as the sources narrow it. */
    templates: CalendarTemplatesTab;
    /** What the rail hides of the backlog. */
    backlogNarrowing: BacklogNarrowing<CalendarEventPart>;
    /** The sources the Calendar follows: an app's tab reads the one it names. */
    followed: FollowedSources;
    /** Each resource kind's rows the rail shows: what a placement's Chooser offers. */
    shown: CalendarShownResources;
}
/**
 * What a tab is, as its pane takes it: its cards, its count (none while it is read), what it says empty, and whether its
 * cards are read at all.
 */
interface TabFacts {
    cards: readonly LibraryItemValue[]; count: string | number | undefined; empty: LibraryEmpty | undefined; narrowing: LibraryNarrowing | undefined;
    pane: { "aria-busy"?: true; inert?: true }; pending?: boolean;
}
/** The author-listed tabs, populated from the current bound reads. */
export function useCalendarLibrary(args: LibraryArgs): BuilderFrameDock | undefined {
    const { value, backlog, backlogRead, key, narrow, day, now, styles, commands, selection, activeTemplate, onTemplate, templates, backlogNarrowing, followed, shown } = args;
    const format = useFormatters();
    const [chosen, setChosen] = useState<Record<string, string>>({});
    if (value.library.length === 0) return undefined;
    const draggable = commands !== undefined && !narrow;
    const baseCard = (id: string, label: string, meta: string, icon: string | undefined, group: string, placed: boolean): LibraryItemValue => scheduleLibraryCard({
        key: id, label, sublabel: some(meta), icon: icon === undefined ? none : some(icon), status: none, trailing: none,
        draggable, filtered: false, placed, search: some(`${label} ${meta}`), groups: new Map([["group", group]]),
    });
    const tabs = value.library.map(tab => {
        const tabKey = tab.type === "tab" ? `tab:${tab.value.name}` : tab.type;
        const label = tab.type === "tab" ? tab.value.name : tab.type === "templates" ? "Templates" : "Backlog";
        let source: CalendarSource | undefined;
        let facts: TabFacts;
        if (tab.type === "templates") {
            source = activeTemplate === undefined ? undefined : templates.shown.get(activeTemplate);
            facts = { ...templates, cards: templates.cards.map(({ id, kind, template }) => baseCard(id, template.name,
                `${kind.name} · ${durationMinutes(template.duration) / 60} h · ${kind.takes.map(key => value.resources.find(resource => resource.key === key)?.name ?? key).join(", ")}`, kind.icon,
                template.group.type === "some" ? template.group.value : kind.name, id === activeTemplate)) };
        } else if (tab.type === "backlog") {
            const selected = backlog.find(item => eventKey({ kind: item.kind, key: item.key }) === chosen[tabKey]);
            if (selected !== undefined) source = { item: selected, kind: value.events.find(kind => kind.key === selected.kind)! };
            const cards = backlog.map(item => {
                const kind = value.events.find(kind => kind.key === item.kind)!;
                const id = eventKey({ kind: item.kind, key: item.key });
                const ref = item.resource.type === "some" ? item.resource.value : undefined;
                const resource = value.resources.find(kind => kind.key === ref?.kind)?.rows.find(row => row.key === ref?.key)?.label;
                const group = dueGroupOf(item.due.type === "some" ? item.due.value : undefined, now);
                const groups = { thisWeek: "Due this week", nextWeek: "Due next week", later: "Later", none: "No date" };
                return baseCard(id, item.title, `${kind.name} · ${Number(item.minutes) / 60} h${resource === undefined ? "" : ` · ${resource}`}${item.due.type === "some" ? ` · due ${format.weekdayDate(item.due.value)}` : ""}`,
                    kind.icon, groups[group], id === chosen[tabKey]);
            });
            // The backlog is each kind's own narrowing: it shows what its kinds read, and counts the stored events their choices hide.
            const { narrowing, hidden, clear } = backlogNarrowing;
            const narrows = narrowing.length > 0;
            const held = backlog.filter(item => narrowing.some(({ kind }) => kind.key === item.kind)).length;
            facts = !backlogRead ? { cards: [], count: "…", empty: undefined, narrowing: undefined, pane: { "aria-busy": true }, pending: true }
                : { cards, empty: { title: "No backlog events" }, pane: {},
                    count: !narrows ? cards.length : hidden === undefined ? undefined : narrowedCount(format, cards.length, cards.length + hidden, true),
                    narrowing: !narrows || clear === undefined ? undefined : { empty: { title: "No backlog events match the filters", description: "Change or clear the filters to see more backlog events." },
                        onClear: clear, emptied: held === 0 } };
        } else {
            const cards = tab.value.cards.map(card => ({ ...baseCard(card.key, card.label, card.meta.type === "some" ? card.meta.value : "",
                tab.value.icon.type === "some" ? tab.value.icon.value : undefined, card.group.type === "some" ? card.group.value : "", card.key === chosen[tabKey]), draggable: draggable && tab.value.drop.type === "some" }));
            // An app's tab follows the source it names, by its rows' keys; naming none, it lists its rows whole.
            const followedSource = tab.value.source.type === "some" ? followed.get(tab.value.source.value) : undefined;
            const noun = tab.value.name.toLocaleLowerCase(format.locale);
            facts = followedSource === undefined ? { cards, count: cards.length, empty: { title: `No ${noun}` }, narrowing: undefined, pane: {} }
                : sourceTab({ cards, keyOf: card => card.key, shown: followedSource.shown, noun, words: format });
        }
        const library = scheduleLibrary({ id: calendarLibraryId(key, tabKey), items: [...facts.cards], groupOptions: [{ key: "group", label: "Group" }],
            noun: some({ singular: tab.type === "templates" ? "template" : "item", plural: tab.type === "templates" ? "templates" : "items" }),
            onCardClick: some((id: string) => { if (tab.type === "templates") onTemplate(id); else setChosen(was => ({ ...was, [tabKey]: id })); return null; }),
        });
        const author = tab.type === "tab" ? tab.value : undefined;
        const patch = author?.cards.find(card => card.key === chosen[tabKey]);
        const targetKind = author?.drop.type === "some" ? author.drop.value : undefined;
        const targets = selection.filter(item => item.kind === targetKind);
        return { key: tabKey, label, ...(facts.count === undefined ? {} : { count: facts.count }), shownCount: facts.cards.length, body: <Box css={styles.pane} {...facts.pane}>
            {facts.pending === true ? <PendingCards /> : <EastChakraLibrary value={library} storageKey={calendarLibraryId(key, tabKey)} empty={facts.empty} narrowing={facts.narrowing} />}
            {commands !== undefined && (source !== undefined || patch !== undefined) && <Box css={styles.paneFoot}>
                {source !== undefined && <PlacementAction label={"template" in source ? "Create" : "Schedule"} source={source} value={value} shown={shown} day={day} commands={commands} styles={styles} />}
                {patch !== undefined && <Button size="xs" variant="outline" disabled={targets.length === 0 || targets.some(item => !commands.editing.available(item.kind))} onClick={() => commands.patch(targets, patch.sets)}>Apply to selected events</Button>}
            </Box>}
        </Box> };
    });
    // The collapsed pane's badge: what the backlog shows — "…" while it is read — else what the first tab shows.
    const badge = value.library.some(tab => tab.type === "backlog") ? backlogRead ? backlog.length : "…" : tabs[0]?.shownCount ?? 0;
    return { label: "Library", icon: "layer-group", size: "272px", tabs: tabs.map(({ shownCount: _shown, ...tab }) => tab), persist: "local", badge: String(badge) };
}
