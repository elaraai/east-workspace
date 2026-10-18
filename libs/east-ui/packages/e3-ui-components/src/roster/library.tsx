/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

/**
 * Roster facts on the shared Library. Each tab follows its source of the rail
 * (#1342): People the slice's `people`, Activities its `activities`, an app's
 * tab the source it names; each counts what it shows (`People 12 of 69`), says
 * so when its source leaves it none, with Clear filters for that source, and
 * has no filter of its own — its search and its groups only. A Find fix's
 * leads, trainers or skill holders are a result in the People tab, with a chip
 * that clears it.
 */
import { useState } from "react";
import { Box, Button } from "@chakra-ui/react";
import { none, some, variant } from "@elaraai/east";
import { EastChakraLibrary, useFormatters, type BuilderFrameDock, type LibraryItemValue } from "@elaraai/east-ui-components";
import { SliceFieldChip, narrowedCount } from "@elaraai/east-ui-components/internal";
import { scheduleLibrary, scheduleLibraryCard } from "../shared/schedule/library.js";
import { sourceTab, type SourceShown } from "../shared/schedule/source-tab.js";
import { readRosterSource, rosterSourceKey } from "./identity.js";
import { PlaceAction } from "./controls.js";
import type { PeopleFocus, RosterCommands, RosterSource } from "./actions.js";
import { DAY, activityOf, type Coverage, type Person, type RosterStyles, type RosterValue, type Selection, type Slot, type Week } from "./model.js";

export function rosterLibraryId(key: string, tab: string): string { return `${key}.library.${tab}`; }
interface LibraryArgs {
    value: RosterValue; week: Week; start: Date; day: number; storageKey: string; narrow: boolean; styles: RosterStyles;
    commands: RosterCommands; selection: Selection | undefined; select: (next: Selection | undefined) => void;
    hours: ReadonlyMap<string, number>; coverage: ReadonlyMap<Slot, Coverage>;
    /** What a Find fix found, shown in the People tab until its chip clears it. */
    focus: PeopleFocus; onClearFocus: () => void;
    tab: string | undefined; onTab: (tab: string) => void;
    /** What the rail shows of each source a tab follows, and how that source alone clears. */
    shown: { people: SourceShown; activities: SourceShown };
}
/** A tab that names no source lists its rows whole. */
const WHOLE: SourceShown = { keys: none, busy: false, ready: true, clear: undefined };

/** Whether a Find fix found the person: a lead on the day, a trainer, or a holder of the skill. */
function finds(focus: NonNullable<PeopleFocus>, person: Person, lead: boolean): boolean {
    return focus.type === "skill" ? person.skills.has(focus.key) : focus.type === "leads" ? lead : person.trainer;
}

/** Optional library pane; every dataset stays the author's original bound data. */
export function useRosterLibrary(args: LibraryArgs): BuilderFrameDock | undefined {
    const { value, week, start, day, storageKey, narrow, styles, commands, selection, select, hours, coverage, focus, shown } = args;
    const format = useFormatters();
    const [chosen, setChosen] = useState<Record<string, string>>({});
    const [error, setError] = useState<string>();
    if (value.library.length === 0) return undefined;
    const rostered = new Set([...week.assignments.values()].flatMap(a => a.slot.day === BigInt(day) && a.who.type === "person" ? [a.who.value] : []));
    const draggable = !narrow && commands.editing.available && week.status.type === "draft";
    const slot = selection?.type === "slot" || selection?.type === "requirement" ? selection.slot
        : selection?.type === "assignment" ? week.assignments.get(selection.key)?.slot : undefined;
    const defaultSlot: Slot = slot ?? { day: BigInt(day), group: value.groups[0]!.key, shift: value.shifts[0]!.key };
    const make = (key: string, label: string, meta: string, group: string, icon: string | undefined): LibraryItemValue => scheduleLibraryCard({
        key, label, sublabel: some(meta), groups: new Map([["group", group]]), icon: icon === undefined ? none : some(icon),
        status: none, trailing: none, draggable, filtered: false, placed: false, search: some(`${label} ${meta} ${group}`),
    });
    const findLabel = focus === undefined ? undefined : focus.type === "skill" ? `Find · ${activityOf(value, focus.key)?.label ?? focus.key}`
        : focus.type === "leads" ? "Find · Leads" : "Find · Trainers";
    // The people the rail shows, off that day: the collapsed rail's badge.
    const shownPeople = shown.people.keys;
    const off = value.people.filter(p => (shownPeople.type === "none" || shownPeople.value.has(p.key)) && !rostered.has(p.key)).length;
    const tabs = value.library.map(tab => {
        const name = tab.type === "tab" ? `tab:${tab.value.name}` : tab.type;
        const label = tab.type === "tab" ? tab.value.name : tab.type === "people" ? "People" : "Activities";
        let cards: LibraryItemValue[];
        let follows: ReturnType<typeof sourceTab<unknown>>;
        let count: string | number;
        if (tab.type === "people") {
            const entries = value.people.map(person => {
                const assigned = [...week.assignments.values()].filter(a => a.slot.day === BigInt(day) && a.who.type === "person" && a.who.value === person.key);
                const group = value.groups.find(g => g.key === person.group);
                const position = value.positions.find(p => p.key === (assigned[0]?.position ?? person.position));
                const skills = value.activities.filter(a => a.group.type === "some" && person.skills.has(a.key));
                const place = assigned.length === 0 ? `Off ${format.weekday(new Date(start.getTime() + day * DAY))} · available` : position?.lead ? "Leads" : person.agency ? "Agency staff" : "Associates";
                const shift = assigned.map(a => value.shifts.find(s => s.key === a.slot.shift)?.label ?? a.slot.shift).join(", ");
                const card = make(rosterSourceKey("person", person.key), person.name, `${group?.label ?? person.group} · ${shift || "Off today"}${position?.code ? ` · ${position.code}` : ""}${person.trainer ? " · trainer" : ""}${person.trainee ? " · trainee" : ""}`, place, undefined);
                return { person, lead: position?.lead === true, card: { ...card, avatar: some(person.name), placed: chosen[name] === rosterSourceKey("person", person.key),
                    status: some({ label: assigned.length === 0 ? "OFF" : assigned.map(a => value.shifts.find(s => s.key === a.slot.shift)?.code ?? a.slot.shift).join(" · "), tone: variant(assigned.length === 0 ? "info" : "neutral", null), ring: false }),
                    search: some(`${person.name} ${group?.label} ${position?.label} ${person.agency ? "agency" : ""} ${person.trainer ? "trainer" : ""} ${skills.map(s => s.label).join(" ")}`),
                    dims: new Map([["hours", variant("meter", { value: hours.get(person.key) ?? 0, max: person.contract, text: some(`${format.number(hours.get(person.key) ?? 0)} / ${format.number(person.contract)} h`) })]]),
                } };
            });
            follows = sourceTab({ cards: entries, keyOf: entry => entry.person.key, shown: shown.people, noun: "people", words: format });
            // A Find fix's result, among what the rail shows.
            const found = focus === undefined ? follows.cards as typeof entries : (follows.cards as typeof entries).filter(entry => finds(focus, entry.person, entry.lead));
            count = focus === undefined ? follows.count : narrowedCount(format, found.length, entries.length, true);
            // Agency requests are actions, not staff: every one shows, whatever the rail narrows.
            cards = [...value.agencies.map(agency => ({ ...make(rosterSourceKey("agency", agency.key), agency.name, `Request · ${format.number(value.shifts.find(s => s.key === defaultSlot.shift)?.hours ?? 0)} h`, "Agency staff", "building"),
                status: some({ label: "REQ", tone: variant("neutral", null), ring: false }) })), ...found.map(entry => entry.card)];
            const groupRank = (card: LibraryItemValue) => { const group = card.groups.get("group"); return group?.startsWith("Off ") ? 0 : group === "Leads" ? 1 : group === "Associates" ? 2 : 3; };
            cards.sort((a, b) => groupRank(a) - groupRank(b));
        } else if (tab.type === "activities") {
            // Each group's skills in the groups' order, then the duties, each in the record's order.
            const rank = (group: string | undefined) => { const at = value.groups.findIndex(g => g.key === group); return at < 0 ? value.groups.length : at; };
            const activities = [...value.activities].sort((a, b) => rank(a.group.type === "some" ? a.group.value : undefined) - rank(b.group.type === "some" ? b.group.value : undefined));
            follows = sourceTab({ cards: activities, keyOf: activity => activity.key, shown: shown.activities, noun: "activities", words: format });
            count = follows.count;
            cards = (follows.cards as typeof activities).map(skill => {
                const group = skill.group.type === "some" ? value.groups.find(g => skill.group.type === "some" && g.key === skill.group.value)?.label ?? skill.group.value : "Any group";
                const lines = [...coverage].filter(([slot]) => slot.day === BigInt(day)).flatMap(([, c]) => c.lines.filter(line => line.skill === skill.key));
                const assigned = lines.reduce((n, line) => n + line.assigned, 0), needed = lines.reduce((n, line) => n + line.needed, 0);
                return { ...make(skill.key, skill.label, `${skill.code} · ${format.number(assigned)} / ${format.number(needed)} h assigned`, group, "list-check"), placed: chosen[name] === skill.key,
                    dims: new Map([["hours", variant("meter", { value: assigned, max: needed, text: none })]]) };
            });
        } else {
            const source = tab.value.source;
            const followed = source.type === "none" ? WHOLE : source.value === "people" ? shown.people : source.value === "activities" ? shown.activities : WHOLE;
            follows = sourceTab({ cards: tab.value.cards, keyOf: card => card.key, shown: followed, noun: tab.value.name.toLowerCase(), words: format });
            count = follows.count;
            cards = (follows.cards as typeof tab.value.cards).map(card => ({ ...make(card.key, card.label, card.meta.type === "some" ? card.meta.value : "", card.group.type === "some" ? card.group.value : "", tab.value.icon.type === "some" ? tab.value.icon.value : undefined), draggable: draggable && card.patch.type === "some", placed: chosen[name] === card.key }));
        }
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
        const baseLibrary = scheduleLibrary({ id: rosterLibraryId(storageKey, name), items: cards, groupOptions: [{ key: "group", label: "Group" }], noun: some({ singular: tab.type === "people" ? "person" : "activity", plural: tab.type === "people" ? "people" : "activities" }), onCardClick: some(choose) }, true);
        const library = { ...baseLibrary, ...(tab.type === "tab" ? {} : { dimOptions: [{ key: "hours", label: "Hours" }], defaultDimensions: ["hours"] }) };
        const chosenKey = chosen[name];
        const parsed = tab.type === "people" && chosenKey !== undefined ? readRosterSource(chosenKey) : undefined;
        const source: RosterSource | undefined = parsed?.success ? { type: parsed.value.type, key: parsed.value.value } : undefined;
        const target = selection?.type === "assignment" ? selection.key : undefined;
        const custom = tab.type === "tab" ? tab.value.cards.find(card => card.key === chosenKey) : undefined;
        const finding = tab.type === "people" && findLabel !== undefined;
        return { key: name, label, count, body: <Box css={styles.pane} data-roster-library={name} {...follows.pane}>
            {finding && <Box css={styles.paneFoot} data-roster-find="">
                <SliceFieldChip label={findLabel} active removeLabel="Clear find" onRemove={args.onClearFocus} onClick={args.onClearFocus} />
            </Box>}
            <EastChakraLibrary value={library} storageKey={rosterLibraryId(storageKey, name)}
                empty={finding ? { title: "No one found", description: "Clear the find to see the people the rail shows." } : follows.empty}
                narrowing={finding ? undefined : follows.narrowing} />
            <Box css={[styles.paneFoot, styles.paneHint]}>{narrow ? tab.type === "people" ? "Select a person to assign" : "Select a card, then an assignment"
                : tab.type === "people" ? `Drag onto a shift · ${format.weekdayDate(new Date(start.getTime() + day * DAY))}` : "Drag onto a person · one per shift"}</Box>
            {commands.editing.available && chosenKey !== undefined && <Box css={styles.paneFoot}>
                {source !== undefined && <PlaceAction label={source.type === "agency" ? "Request staff" : "Assign person"} source={source} slot={defaultSlot} value={value} start={start} commands={commands} styles={styles} />}
                {tab.type === "activities" && <Button size="xs" variant="outline" disabled={target === undefined} onClick={() => { if (target !== undefined) setError(commands.activity(target, some(chosenKey))); }}>Set activity on selected assignment</Button>}
                {custom?.patch.type === "some" && <Button size="xs" variant="outline" disabled={target === undefined} onClick={() => { if (target !== undefined && custom.patch.type === "some") setError(commands.patch(target, custom.patch.value)); }}>Apply to selected assignment</Button>}
                {error !== undefined && <Box role="alert" css={styles.error}>{error}</Box>}
            </Box>}
        </Box> };
    });
    return { label: "Library", icon: "layer-group", size: "272px", tabs, tab: args.tab, onTabChange: args.onTab, persist: "local", badge: off };
}
