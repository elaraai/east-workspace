/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

/** Roster facts on the shared Library, including its search and facet engine. */
import { useEffect, useMemo, useState } from "react";
import { Box, Button } from "@chakra-ui/react";
import { none, some, variant } from "@elaraai/east";
import { EastChakraLibrary, useFormatters, type BuilderFrameDock, type LibraryItemValue } from "@elaraai/east-ui-components";
import { scheduleLibrary, scheduleLibraryCard } from "../shared/schedule/library.js";
import { Seg } from "../shared/schedule/segments.js";
import { readRosterSource, rosterSourceKey } from "./identity.js";
import { PlaceAction } from "./controls.js";
import type { PeopleFocus, RosterCommands, RosterSource } from "./actions.js";
import { DAY, type Coverage, type RosterStyles, type RosterValue, type Selection, type Slot, type Week } from "./model.js";

export function rosterLibraryId(key: string, tab: string): string { return `${key}.library.${tab}`; }
interface LibraryArgs {
    value: RosterValue; week: Week; start: Date; day: number; storageKey: string; narrow: boolean; styles: RosterStyles;
    commands: RosterCommands; selection: Selection | undefined; select: (next: Selection | undefined) => void;
    hours: ReadonlyMap<string, number>; coverage: ReadonlyMap<Slot, Coverage>; focus: PeopleFocus;
    tab: string | undefined; onTab: (tab: string) => void;
}
/** Optional library pane; every dataset stays the author's original bound data. */
export function useRosterLibrary(args: LibraryArgs): BuilderFrameDock | undefined {
    const { value, week, start, day, storageKey, narrow, styles, commands, selection, select, hours, coverage, focus } = args;
    const format = useFormatters();
    const [chosen, setChosen] = useState<Record<string, string>>({});
    const [error, setError] = useState<string>();
    const [filters, setFilters] = useState<Record<string, string[]>>({});
    const skillLabel = focus?.type === "skill" ? value.groups.flatMap(g => g.skills).find(s => s.key === focus.key)?.label ?? focus.key : undefined;
    useEffect(() => { setFilters(focus === undefined ? {} : focus.type === "skill" ? { skill: [skillLabel!] }
        : { role: [focus.type === "leads" ? "Lead" : focus.type === "trainers" ? "Trainer" : "Off"] }); }, [focus, skillLabel]);
    const facetFilter = useMemo(() => ({ values: filters, onChange: setFilters }), [filters]);
    if (value.library.length === 0) return undefined;
    const people = value.people.filter(p => value.visiblePeople.type === "none" || value.visiblePeople.value.has(p.key));
    const rostered = new Set([...week.assignments.values()].flatMap(a => a.slot.day === BigInt(day) && a.who.type === "person" ? [a.who.value] : []));
    const off = people.filter(p => !rostered.has(p.key)).length;
    const draggable = !narrow && commands.editing.available && week.status.type === "draft";
    const slot = selection?.type === "slot" || selection?.type === "requirement" ? selection.slot
        : selection?.type === "assignment" ? week.assignments.get(selection.key)?.slot : undefined;
    const defaultSlot: Slot = slot ?? { day: BigInt(day), group: value.groups[0]!.key, shift: value.shifts[0]!.key };
    const make = (key: string, label: string, meta: string, group: string, icon: string | undefined): LibraryItemValue => scheduleLibraryCard({
        key, label, sublabel: some(meta), groups: new Map([["group", group]]), icon: icon === undefined ? none : some(icon),
        status: none, trailing: none, draggable, filtered: false, placed: false, search: some(`${label} ${meta} ${group}`),
    });
    const tabs = value.library.map(tab => {
        const name = tab.type === "tab" ? `tab:${tab.value.name}` : tab.type;
        const label = tab.type === "tab" ? tab.value.name : tab.type === "people" ? "People" : "Activities";
        let cards: LibraryItemValue[];
        if (tab.type === "people") {
            cards = people.map(person => {
                const assigned = [...week.assignments.values()].filter(a => a.slot.day === BigInt(day) && a.who.type === "person" && a.who.value === person.key);
                const group = value.groups.find(g => g.key === person.group);
                const position = value.positions.find(p => p.key === (assigned[0]?.position ?? person.position));
                const skills = value.groups.flatMap(g => g.skills).filter(s => person.skills.has(s.key));
                const place = assigned.length === 0 ? `Off ${format.weekday(new Date(start.getTime() + day * DAY))} · available` : position?.lead ? "Leads" : person.agency ? "Agency staff" : "Associates";
                const shift = assigned.map(a => value.shifts.find(s => s.key === a.slot.shift)?.label ?? a.slot.shift).join(", ");
                const card = make(rosterSourceKey("person", person.key), person.name, `${group?.label ?? person.group} · ${shift || "Off today"}${position?.code ? ` · ${position.code}` : ""}${person.trainer ? " · trainer" : ""}${person.trainee ? " · trainee" : ""}`, place, undefined);
                return { ...card, avatar: some(person.name), placed: chosen[name] === rosterSourceKey("person", person.key),
                    status: some({ label: assigned.length === 0 ? "OFF" : assigned.map(a => value.shifts.find(s => s.key === a.slot.shift)?.code ?? a.slot.shift).join(" · "), tone: variant(assigned.length === 0 ? "info" : "neutral", null), ring: false }),
                    search: some(`${person.name} ${group?.label} ${position?.label} ${person.agency ? "agency" : ""} ${person.trainer ? "trainer" : ""} ${skills.map(s => s.label).join(" ")}`),
                    facets: new Map([["role", [...(position?.lead ? ["Lead"] : []), ...(person.trainer ? ["Trainer"] : []), ...(assigned.length === 0 ? ["Off"] : []), ...(person.agency ? ["Agency"] : [])]], ["skill", skills.map(s => s.label)]]),
                    dims: new Map([["hours", variant("meter", { value: hours.get(person.key) ?? 0, max: person.contract, text: some(`${format.number(hours.get(person.key) ?? 0)} / ${format.number(person.contract)} h`) })]]),
                };
            });
            cards.unshift(...value.agencies.map(agency => ({ ...make(rosterSourceKey("agency", agency.key), agency.name, `Request · ${format.number(value.shifts.find(s => s.key === defaultSlot.shift)?.hours ?? 0)} h`, "Agency staff", "building"),
                status: some({ label: "REQ", tone: variant("neutral", null), ring: false }) })));
            const groupRank = (card: LibraryItemValue) => { const group = card.groups.get("group"); return group?.startsWith("Off ") ? 0 : group === "Leads" ? 1 : group === "Associates" ? 2 : 3; };
            cards.sort((a, b) => groupRank(a) - groupRank(b));
        } else if (tab.type === "activities") {
            cards = [...value.groups.flatMap(group => group.skills.map(skill => ({ skill, group: group.label }))), ...value.duties.map(skill => ({ skill, group: "Any group" }))].map(({ skill, group }) => {
                const lines = [...coverage].filter(([slot]) => slot.day === BigInt(day)).flatMap(([, c]) => c.lines.filter(line => line.skill === skill.key));
                const assigned = lines.reduce((n, line) => n + line.assigned, 0), needed = lines.reduce((n, line) => n + line.needed, 0);
                return { ...make(skill.key, skill.label, `${skill.code} · ${format.number(assigned)} / ${format.number(needed)} h assigned`, group, "list-check"), placed: chosen[name] === skill.key,
                    dims: new Map([["hours", variant("meter", { value: assigned, max: needed, text: none })]]) };
            });
        } else cards = tab.value.cards.map(card => ({ ...make(card.key, card.label, card.meta.type === "some" ? card.meta.value : "", card.group.type === "some" ? card.group.value : "", tab.value.icon.type === "some" ? tab.value.icon.value : undefined), draggable: draggable && card.patch.type === "some", placed: chosen[name] === card.key }));
        const choose = (key: string): null => {
            setChosen(before => ({ ...before, [name]: key })); setError(undefined);
            if (tab.type === "people") {
                const source = readRosterSource(key);
                if (source.success && source.value.type === "person") {
                    const person = source.value.value;
                    const assignment = [...week.assignments].find(([, a]) => a.slot.day === BigInt(day) && a.who.type === "person" && a.who.value === person);
                    select(assignment === undefined ? { type: "person", key: person } : { type: "assignment", key: assignment[0] });
                }
            }
            return null;
        };
        const baseLibrary = scheduleLibrary({ id: rosterLibraryId(storageKey, name), items: cards, groupOptions: [{ key: "group", label: "Group" }], noun: some({ singular: tab.type === "people" ? "person" : "activity", plural: tab.type === "people" ? "people" : "activities" }), onCardClick: some(choose) });
        const library = { ...baseLibrary,
            ...(tab.type === "tab" ? {} : { dimOptions: [{ key: "hours", label: "Hours" }], defaultDimensions: ["hours"] }),
            ...(tab.type === "people" ? { filterOptions: [{ key: "role", label: "Role" }, { key: "skill", label: "Skill" }] } : {}),
        };
        const chosenKey = chosen[name];
        const parsed = tab.type === "people" && chosenKey !== undefined ? readRosterSource(chosenKey) : undefined;
        const source: RosterSource | undefined = parsed?.success ? { type: parsed.value.type, key: parsed.value.value } : undefined;
        const target = selection?.type === "assignment" ? selection.key : undefined;
        const custom = tab.type === "tab" ? tab.value.cards.find(card => card.key === chosenKey) : undefined;
        const active = filters.role?.[0] === "Lead" ? "leads" : filters.role?.[0] === "Trainer" ? "trainers" : filters.role?.[0] === "Off" ? "off" : "all";
        return { key: name, label, count: String(cards.length), body: <Box css={styles.pane}>
            {tab.type === "people" && <Box css={styles.paneFoot}><Seg label="People filter" scope="roster" name="people-filter" items={[{ key: "all", label: "All" }, { key: "leads", label: "Leads" }, { key: "trainers", label: "Trainers" }, { key: "off", label: `Off ${format.weekday(new Date(start.getTime() + day * DAY))}` }]}
                active={active} onPick={next => setFilters(next === "all" ? {} : { role: [next === "leads" ? "Lead" : next === "trainers" ? "Trainer" : "Off"] })} /></Box>}
            <EastChakraLibrary value={library} storageKey={rosterLibraryId(storageKey, name)} facetFilter={tab.type === "people" ? facetFilter : undefined} />
            <Box css={[styles.paneFoot, styles.detail]}>{narrow ? tab.type === "people" ? "Select a person to assign" : "Select a card, then an assignment"
                : tab.type === "people" ? `Drag onto a shift · ${format.weekdayDate(new Date(start.getTime() + day * DAY))}` : "Drag onto a person · one per shift"}</Box>
            {commands.editing.available && chosenKey !== undefined && <Box css={styles.paneFoot}>
                {source !== undefined && <PlaceAction label={source.type === "agency" ? "Request staff" : "Assign person"} source={source} slot={defaultSlot} value={value} start={start} commands={commands} styles={styles} />}
                {tab.type === "activities" && <Button size="xs" variant="outline" disabled={target === undefined} onClick={() => { if (target !== undefined) setError(commands.activity(target, some(chosenKey))); }}>Set activity on selected assignment</Button>}
                {custom?.patch.type === "some" && <Button size="xs" variant="outline" disabled={target === undefined} onClick={() => { if (target !== undefined && custom.patch.type === "some") setError(commands.patch(target, custom.patch.value)); }}>Apply to selected assignment</Button>}
                {error !== undefined && <Box role="alert" css={styles.error}>{error}</Box>}
            </Box>}
        </Box> };
    });
    return { label: "Library", icon: "layer-group", size: "272px", tabs, tab: args.tab, onTabChange: args.onTab, persist: "local", badge: String(off) };
}
