/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

/** Calendar's optional library uses the same Library cards as Plan. */
import { useState } from "react";
import { Box, Button } from "@chakra-ui/react";
import { none, some } from "@elaraai/east";
import { EastChakraLibrary, useFormatters, type BuilderFrameDock, type LibraryItemValue } from "@elaraai/east-ui-components";
import { scheduleLibrary, scheduleLibraryCard } from "../shared/schedule/library.js";
import { dueGroupOf, durationMinutes } from "../shared/schedule/due.js";
import { PlacementAction } from "./controls.js";
import type { CalendarCommands, CalendarSource } from "./actions.js";
import { eventKey, type CalendarItem, type CalendarStyles, type CalendarValue } from "./model.js";

/** Library ids also name the shared drag grammar's sources. */
export function calendarLibraryId(key: string, tab: string): string { return `${key}.library.${tab}`; }
/** The kind and source record key identify a template. */
export function templateSources(value: CalendarValue): Map<string, CalendarSource> {
    return new Map(value.events.flatMap(kind => kind.templates.map(template => [eventKey({ kind: kind.key, key: template.key }), { kind, template }] as const)));
}
interface LibraryArgs {
    value: CalendarValue; backlog: readonly CalendarItem[]; selection: readonly CalendarItem[]; key: string;
    narrow: boolean; now: Date; day: Date; styles: CalendarStyles; commands: CalendarCommands | undefined;
    activeTemplate: string | undefined; onTemplate: (key: string) => void;
}
/** The author-listed tabs, populated from the current bound reads. */
export function useCalendarLibrary(args: LibraryArgs): BuilderFrameDock | undefined {
    const { value, backlog, key, narrow, day, now, styles, commands, selection, activeTemplate, onTemplate } = args;
    const format = useFormatters();
    const [chosen, setChosen] = useState<Record<string, string>>({});
    if (value.library.length === 0) return undefined;
    const sources = templateSources(value);
    const draggable = commands !== undefined && !narrow;
    const baseCard = (id: string, label: string, meta: string, icon: string | undefined, group: string, placed: boolean): LibraryItemValue => scheduleLibraryCard({
        key: id, label, sublabel: some(meta), icon: icon === undefined ? none : some(icon), status: none, trailing: none,
        draggable, filtered: false, placed, search: some(`${label} ${meta}`), groups: new Map([["group", group]]),
    });
    const tabs = value.library.map(tab => {
        const tabKey = tab.type === "tab" ? `tab:${tab.value.name}` : tab.type;
        const label = tab.type === "tab" ? tab.value.name : tab.type === "templates" ? "Templates" : "Backlog";
        let source: CalendarSource | undefined;
        let cards: LibraryItemValue[];
        if (tab.type === "templates") {
            source = activeTemplate === undefined ? undefined : sources.get(activeTemplate);
            cards = [...sources].map(([id, source]) => {
                if (!("template" in source)) throw new Error("Expected a template");
                const { template, kind } = source;
                return baseCard(id, template.name, `${kind.name} · ${durationMinutes(template.duration) / 60} h · ${kind.takes.map(key => value.resources.find(resource => resource.key === key)?.name ?? key).join(", ")}`, kind.icon,
                    template.group.type === "some" ? template.group.value : kind.name, id === activeTemplate);
            });
        } else if (tab.type === "backlog") {
            const selected = backlog.find(item => eventKey({ kind: item.kind, key: item.key }) === chosen[tabKey]);
            if (selected !== undefined) source = { item: selected, kind: value.events.find(kind => kind.key === selected.kind)! };
            cards = backlog.map(item => {
                const kind = value.events.find(kind => kind.key === item.kind)!;
                const id = eventKey({ kind: item.kind, key: item.key });
                const ref = item.resource.type === "some" ? item.resource.value : undefined;
                const resource = value.resources.find(kind => kind.key === ref?.kind)?.rows.find(row => row.key === ref?.key)?.label;
                const group = dueGroupOf(item.due.type === "some" ? item.due.value : undefined, now);
                const groups = { thisWeek: "Due this week", nextWeek: "Due next week", later: "Later", none: "No date" };
                return baseCard(id, item.title, `${kind.name} · ${Number(item.minutes) / 60} h${resource === undefined ? "" : ` · ${resource}`}${item.due.type === "some" ? ` · due ${format.weekdayDate(item.due.value)}` : ""}`,
                    kind.icon, groups[group], id === chosen[tabKey]);
            });
        } else {
            cards = tab.value.cards.map(card => ({ ...baseCard(card.key, card.label, card.meta.type === "some" ? card.meta.value : "",
                tab.value.icon.type === "some" ? tab.value.icon.value : undefined, card.group.type === "some" ? card.group.value : "", card.key === chosen[tabKey]), draggable: draggable && tab.value.drop.type === "some" }));
        }
        const library = scheduleLibrary({ id: calendarLibraryId(key, tabKey), items: cards, groupOptions: [{ key: "group", label: "Group" }],
            noun: some({ singular: tab.type === "templates" ? "template" : "item", plural: tab.type === "templates" ? "templates" : "items" }),
            onCardClick: some((id: string) => { if (tab.type === "templates") onTemplate(id); else setChosen(was => ({ ...was, [tabKey]: id })); return null; }),
        });
        const author = tab.type === "tab" ? tab.value : undefined;
        const patch = author?.cards.find(card => card.key === chosen[tabKey]);
        const targetKind = author?.drop.type === "some" ? author.drop.value : undefined;
        const targets = selection.filter(item => item.kind === targetKind);
        return { key: tabKey, label, count: String(cards.length), body: <Box css={styles.pane}>
            <EastChakraLibrary value={library} storageKey={calendarLibraryId(key, tabKey)} />
            {commands !== undefined && (source !== undefined || patch !== undefined) && <Box css={styles.paneFoot}>
                {source !== undefined && <PlacementAction label={"template" in source ? "Create" : "Schedule"} source={source} value={value} day={day} commands={commands} styles={styles} />}
                {patch !== undefined && <Button size="xs" variant="outline" disabled={targets.length === 0 || targets.some(item => !commands.editing.available(item.kind))} onClick={() => commands.patch(targets, patch.sets)}>Apply to selected events</Button>}
            </Box>}
        </Box> };
    });
    return { label: "Library", icon: "layer-group", size: "272px", tabs, persist: "local", badge: String(value.library.some(tab => tab.type === "backlog") ? backlog.length : tabs[0]?.count ?? 0) };
}
