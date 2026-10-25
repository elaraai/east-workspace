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
 * result is the app's fit's answer (#1334): the People tab shows the people it
 * says fit among what the rail shows, best first in its order, each card with
 * its reason, under a chip that clears it — the Roster decides no one itself.
 * The People tab's agency requests are actions, not people: they always show,
 * and what the tab says of its people shows above them. The Patterns tab
 * (#1406, P20) lists the app's week patterns under the name and icon
 * `Roster.patterns` gives, each card its name, `5 shifts · 40 h` and a strip of
 * seven marks in the shifts' colours; a card drags onto a person's week; one
 * that cannot be applied is greyed with its reason (P23); the tab follows the
 * slice's `patterns` source where there is one.
 */
import { useMemo, useState, type CSSProperties } from "react";
import { Box, Button } from "@chakra-ui/react";
import { FloatType, compareFor, none, some, variant } from "@elaraai/east";
import { EastChakraLibrary, useFormatters, type BuilderFrameDock, type LibraryCardExtras, type LibraryItemValue, type LibraryNarrowing } from "@elaraai/east-ui-components";
import { SliceFieldChip, narrowedCount } from "@elaraai/east-ui-components/internal";
import { scheduleLibrary, scheduleLibraryCard } from "../shared/schedule/library.js";
import { sourceTab, type SourceShown } from "../shared/schedule/source-tab.js";
import { readRosterSource, rosterSourceKey } from "./identity.js";
import { PlaceAction } from "./controls.js";
import type { RosterCommands, RosterSource } from "./actions.js";
import type { FitResult, Need } from "./fit.js";
import {
    DAY, activityOf, patternProblem, patternSummary, shiftColor, shiftOf, type Assignment, type Coverage, type Pattern, type Person, type RosterStyles, type RosterValue,
    type Selection, type Slot, type Week,
} from "./model.js";

/**
 * A pattern's seven marks (#1406, §8): each day's shift in its colour token, its code on it; a day off faint.
 *
 * @param props - The payload's shifts, the pattern and the Roster's styles
 * @returns The strip
 */
export function PatternStrip({ value, pattern, styles }: { value: Pick<RosterValue, "shifts">; pattern: Pattern; styles: RosterStyles }) {
    return <Box css={styles.patternStrip} data-roster-pattern-strip={pattern.key} aria-hidden="true">
        {Array.from({ length: 7 }, (_, i) => {
            const day = pattern.days[i];
            const shift = day?.type === "some" ? shiftOf(value, day.value) : undefined;
            const color = shiftColor(shift);
            return <Box key={i} as="span" css={styles.patternMark} data-off={day === undefined || day.type === "none" ? "" : undefined} data-shift={day?.type === "some" ? day.value : undefined}
                style={color === undefined ? undefined : { "--roster-fill": color.fill, "--roster-ink": color.ink } as CSSProperties}>{shift?.code ?? ""}</Box>;
        })}
    </Box>;
}

export function rosterLibraryId(key: string, tab: string): string { return `${key}.library.${tab}`; }
/** A Find fix's result in the People tab (#1334): what it looks for, the fit's answer, and whether that answer is still to land. */
export interface PeopleFind {
    /** What the find looks for: the chip's words. */
    need: Need;
    /** The fit's answer for the drafts as they are, which the tab shows; `undefined` while it is on its way, or failed. */
    shown: FitResult | undefined;
    /** Whether the find is asked and its answer for the drafts as they are has not landed: the tab is busy, showing what the rail shows. */
    busy: boolean;
}
interface LibraryArgs {
    value: RosterValue; week: Week; start: Date; day: number; storageKey: string; narrow: boolean; styles: RosterStyles;
    commands: RosterCommands; selection: Selection | undefined; select: (next: Selection | undefined) => void;
    hours: ReadonlyMap<string, number>; coverage: ReadonlyMap<Slot, Coverage>;
    /** A Find fix's result, shown in the People tab until its chip clears it. */
    find: PeopleFind | undefined; onClearFind: () => void;
    tab: string | undefined; onTab: (tab: string) => void;
    /** What the rail shows of each source a tab follows, and how that source alone clears. */
    shown: { people: SourceShown; activities: SourceShown; patterns: SourceShown };
}
/** A tab that names no source lists its rows whole. */
const WHOLE: SourceShown = { keys: none, busy: false, ready: true, clear: undefined };
const NO_ASSIGNMENTS: readonly Assignment[] = [];
/** Test-only probe: told each time the People tab's cards are made (#1398, CL9). `undefined` outside tests. */
let peopleCardsProbe: (() => void) | undefined;
/**
 * Install (or clear) the People cards probe. Test use only.
 *
 * @param fn - Told each time the cards are made; `undefined` clears it
 */
export function setRosterPeopleCardsProbe(fn: (() => void) | undefined): void { peopleCardsProbe = fn; }
/** A Library card of the Roster's: its words, its group and its icon, dragged where the Roster takes drags. */
function libraryCard(key: string, label: string, meta: string, group: string, icon: string | undefined, draggable: boolean): LibraryItemValue {
    return scheduleLibraryCard({
        key, label, sublabel: some(meta), groups: new Map([["group", group]]), icon: icon === undefined ? none : some(icon),
        status: none, trailing: none, draggable, filtered: false, placed: false, search: some(`${label} ${meta} ${group}`),
    });
}
/** What the People tab says while a Find finds no one; its chip clears it. */
const NO_ONE_FOUND = { title: "No one found", description: "Clear the find to see the people the rail shows." };
const byScore = compareFor(FloatType);

/** The people the fit's answer says fit, best first — its scores, ties kept in the tab's order: the fit ranks, never the Roster. */
function fitsOf<E extends { person: Person }>(entries: readonly E[], answer: FitResult): E[] {
    const scored = entries.flatMap(entry => {
        const verdict = answer.people.get(entry.person.key);
        return verdict?.type === "fits" ? [{ entry, score: verdict.value.score }] : [];
    });
    return scored.sort((a, b) => byScore(b.score, a.score)).map(fit => fit.entry);
}

/** A found card's line: the fit's reason, and its warning in the warning's tone; its tooltip the whole, which a narrow card cuts. */
function reasonOf(answer: FitResult, item: LibraryItemValue): LibraryCardExtras | undefined {
    const source = readRosterSource(item.key);
    const verdict = source.success && source.value.type === "person" ? answer.people.get(source.value.value) : undefined;
    if (verdict?.type !== "fits") return undefined;
    const { why, warn } = verdict.value;
    const text = warn.type === "some" ? `${why} · ${warn.value}` : why;
    return { note: warn.type === "some" ? { text, tone: "warning" } : { text }, title: text };
}

/** Optional library pane; every dataset stays the author's original bound data. */
export function useRosterLibrary(args: LibraryArgs): BuilderFrameDock | undefined {
    const { value, week, start, day, storageKey, narrow, styles, commands, selection, select, hours, coverage, find, shown } = args;
    const format = useFormatters();
    const [chosen, setChosen] = useState<Record<string, string>>({});
    const [error, setError] = useState<string>();
    // Each found card's reason, the same function while the answer stands: the Library's memo compares it.
    const answer = find?.shown;
    const reasons = useMemo(() => answer === undefined ? undefined : (item: LibraryItemValue) => reasonOf(answer, item), [answer]);
    // A card drags while a week in view takes a gesture: the week, or any of the month's (#1406, P32).
    const draggable = !narrow && commands.editable;
    // The patterns, each with why it cannot be applied and what it works (#1406): the Patterns tab's cards, and each card's strip.
    const patternEntries = useMemo(() => value.patterns.map(pattern => ({ pattern, problem: patternProblem(value, pattern), summary: patternSummary(value, pattern) })), [value]);
    const patternExtras = useMemo(() => (item: LibraryItemValue): LibraryCardExtras | undefined => {
        const entry = patternEntries.find(e => e.pattern.key === item.key);
        if (entry === undefined) return undefined;
        return { strip: <PatternStrip value={value} pattern={entry.pattern} styles={styles} />, title: entry.problem ?? `${entry.pattern.label} · drag onto a person's week`,
            note: entry.problem === undefined ? undefined : { text: entry.problem, tone: "warning" } };
    }, [patternEntries, value, styles]);
    // Each person's duties on the day, the week's duties read once (#1398, CL9).
    const today = useMemo(() => {
        const by = new Map<string, Assignment[]>();
        for (const a of week.assignments.values()) {
            if (a.slot.day !== BigInt(day) || a.who.type !== "person") continue;
            const theirs = by.get(a.who.value);
            if (theirs === undefined) by.set(a.who.value, [a]);
            else theirs.push(a);
        }
        return by;
    }, [week, day]);
    // The People tab's cards, made again only as what they show changes — never at every render of the Roster (CL9).
    const chosenPerson = chosen["people"];
    const peopleEntries = useMemo(() => { peopleCardsProbe?.(); return value.people.map(person => {
        const assigned = today.get(person.key) ?? NO_ASSIGNMENTS;
        const group = value.groups.find(g => g.key === person.group);
        const position = value.positions.find(p => p.key === (assigned[0]?.position ?? person.position));
        const skills = value.activities.filter(a => a.group.type === "some" && person.skills.has(a.key));
        const place = assigned.length === 0 ? `Off ${format.weekday(new Date(start.getTime() + day * DAY))} · available` : position?.lead ? "Leads" : person.agency ? "Agency staff" : "Associates";
        const shift = assigned.map(a => value.shifts.find(s => s.key === a.slot.shift)?.label ?? a.slot.shift).join(", ");
        const card = libraryCard(rosterSourceKey("person", person.key), person.name, `${group?.label ?? person.group} · ${shift || "Off today"}${position?.code ? ` · ${position.code}` : ""}${person.trainer ? " · trainer" : ""}${person.trainee ? " · trainee" : ""}`, place, undefined, draggable);
        return { person, card: { ...card, avatar: some(person.name), placed: chosenPerson === rosterSourceKey("person", person.key),
            status: some({ label: assigned.length === 0 ? "OFF" : assigned.map(a => value.shifts.find(s => s.key === a.slot.shift)?.code ?? a.slot.shift).join(" · "), tone: variant(assigned.length === 0 ? "info" : "neutral", null), ring: false }),
            search: some(`${person.name} ${group?.label} ${position?.label} ${person.agency ? "agency" : ""} ${person.trainer ? "trainer" : ""} ${skills.map(s => s.label).join(" ")}`),
            dims: new Map([["hours", variant("meter", { value: hours.get(person.key) ?? 0, max: person.contract, text: some(`${format.number(hours.get(person.key) ?? 0)} / ${format.number(person.contract)} h`) })]]),
        } };
    }); }, [value.people, value.groups, value.positions, value.activities, value.shifts, today, format, start, day, draggable, chosenPerson, hours]);
    if (value.library.length === 0) return undefined;
    const slot = selection?.type === "slot" || selection?.type === "requirement" ? selection.slot
        : selection?.type === "assignment" ? week.assignments.get(selection.key)?.slot : undefined;
    const defaultSlot: Slot = slot ?? { day: BigInt(day), group: value.groups[0]!.key, shift: value.shifts[0]!.key };
    const make = (key: string, label: string, meta: string, group: string, icon: string | undefined): LibraryItemValue => libraryCard(key, label, meta, group, icon, draggable);
    // What a Find fix looks for: a skill's holders, leads, or trainers.
    const need = find?.need;
    const findWhat = need === undefined ? undefined : need.type === "skill" ? activityOf(value, need.value)?.label ?? need.value
        : need.type === "leads" ? "Leads" : "Trainers";
    // The people the rail shows, off that day: the collapsed rail's badge.
    const shownPeople = shown.people.keys;
    const off = value.people.filter(p => (shownPeople.type === "none" || shownPeople.value.has(p.key)) && !today.has(p.key)).length;
    const tabs = value.library.map(tab => {
        const name = tab.type === "tab" ? `tab:${tab.value.name}` : tab.type;
        const label = tab.type === "tab" || tab.type === "patterns" ? tab.value.name : tab.type === "people" ? "People" : "Activities";
        let cards: LibraryItemValue[];
        let follows: ReturnType<typeof sourceTab<unknown>>;
        let count: string | number;
        let narrowing: LibraryNarrowing | undefined;
        let pane: ReturnType<typeof sourceTab<unknown>>["pane"];
        if (tab.type === "people") {
            const entries = peopleEntries;
            follows = sourceTab({ cards: entries, keyOf: entry => entry.person.key, shown: shown.people, noun: "people", words: format });
            // A Find fix's result: the people the fit's answer says fit, among what the rail shows, best first. Until its answer
            // for the drafts as they are lands, the tab shows what the rail shows, busy, and no verdict (F2).
            const found = answer === undefined ? follows.cards as typeof entries : fitsOf(follows.cards as typeof entries, answer);
            count = answer === undefined ? follows.count : narrowedCount(format, found.length, entries.length, true);
            // With no person to show, the tab says why above the agency requests, which stay: the rail's narrowing, with its
            // Clear filters, when it hid everyone; else a Find that found no one, which its chip clears.
            narrowing = answer === undefined || follows.narrowing?.emptied === true ? follows.narrowing : { empty: NO_ONE_FOUND, emptied: found.length === 0 };
            pane = find?.busy === true ? { ...follows.pane, "aria-busy": true } : follows.pane;
            // Agency requests are actions, not staff: every one shows, whatever the rail narrows.
            const requests = value.agencies.map(agency => ({ ...make(rosterSourceKey("agency", agency.key), agency.name, `Request · ${format.number(value.shifts.find(s => s.key === defaultSlot.shift)?.hours ?? 0)} h`, "Agency staff", "building"),
                status: some({ label: "REQ", tone: variant("neutral", null), ring: false }) }));
            if (answer !== undefined) {
                // Best first, in the fit's order: each group heads where its best card stands, and the requests come last.
                cards = [...found.map(entry => entry.card), ...requests];
            } else {
                const groupRank = (card: LibraryItemValue) => { const group = card.groups.get("group"); return group?.startsWith("Off ") ? 0 : group === "Leads" ? 1 : group === "Associates" ? 2 : 3; };
                cards = [...requests, ...found.map(entry => entry.card)].sort((a, b) => groupRank(a) - groupRank(b));
            }
        } else if (tab.type === "activities") {
            // Each group's skills in the groups' order, then the duties, each in the record's order.
            const rank = (group: string | undefined) => { const at = value.groups.findIndex(g => g.key === group); return at < 0 ? value.groups.length : at; };
            const activities = [...value.activities].sort((a, b) => rank(a.group.type === "some" ? a.group.value : undefined) - rank(b.group.type === "some" ? b.group.value : undefined));
            follows = sourceTab({ cards: activities, keyOf: activity => activity.key, shown: shown.activities, noun: "activities", words: format });
            count = follows.count;
            narrowing = follows.narrowing;
            pane = follows.pane;
            cards = (follows.cards as typeof activities).map(skill => {
                const group = skill.group.type === "some" ? value.groups.find(g => skill.group.type === "some" && g.key === skill.group.value)?.label ?? skill.group.value : "Any group";
                const lines = [...coverage].filter(([slot]) => slot.day === BigInt(day)).flatMap(([, c]) => c.lines.filter(line => line.skill === skill.key));
                const assigned = lines.reduce((n, line) => n + line.assigned, 0), needed = lines.reduce((n, line) => n + line.needed, 0);
                return { ...make(skill.key, skill.label, `${skill.code} · ${format.number(assigned)} / ${format.number(needed)} h assigned`, group, "list-check"), placed: chosen[name] === skill.key,
                    dims: new Map([["hours", variant("meter", { value: assigned, max: needed, text: none })]]) };
            });
        } else if (tab.type === "patterns") {
            // The app's week patterns (#1406, P20), in their order, under the slice's `patterns` source where there is one; a
            // pattern that cannot be applied listed greyed with its reason, dragged by no one (P23).
            const entries = patternEntries;
            follows = sourceTab({ cards: entries, keyOf: entry => entry.pattern.key, shown: shown.patterns, noun: tab.value.name.toLocaleLowerCase(format.locale), words: format });
            count = follows.count;
            narrowing = follows.narrowing;
            pane = follows.pane;
            cards = (follows.cards as typeof entries).map(({ pattern, problem, summary }) => ({
                ...make(pattern.key, pattern.label, `${format.number(summary.shifts)} shifts · ${format.number(summary.hours)} h`, "", tab.value.icon),
                draggable: draggable && problem === undefined, filtered: problem !== undefined, placed: chosen[name] === pattern.key,
                search: some(`${pattern.label} ${format.number(summary.shifts)} shifts ${format.number(summary.hours)} h`),
            }));
        } else {
            const source = tab.value.source;
            const followed = source.type === "none" ? WHOLE : source.value === "people" ? shown.people : source.value === "activities" ? shown.activities : source.value === "patterns" ? shown.patterns : WHOLE;
            follows = sourceTab({ cards: tab.value.cards, keyOf: card => card.key, shown: followed, noun: tab.value.name.toLowerCase(), words: format });
            count = follows.count;
            narrowing = follows.narrowing;
            pane = follows.pane;
            // A card drags where it sets a field of the duty it lands on.
            const lands = tab.value.drop.type === "some";
            cards = (follows.cards as typeof tab.value.cards).map(card => ({ ...make(card.key, card.label, card.meta.type === "some" ? card.meta.value : "", card.group.type === "some" ? card.group.value : "", tab.value.icon.type === "some" ? tab.value.icon.value : undefined), draggable: draggable && lands && card.sets.length > 0, placed: chosen[name] === card.key }));
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
        const noun = tab.type === "people" ? { singular: "person", plural: "people" } : tab.type === "patterns" ? { singular: "pattern", plural: "patterns" } : { singular: "activity", plural: "activities" };
        const baseLibrary = scheduleLibrary({ id: rosterLibraryId(storageKey, name), items: cards, groupOptions: tab.type === "patterns" ? [] : [{ key: "group", label: "Group" }], noun: some(noun), onCardClick: some(choose) }, true);
        const library = { ...baseLibrary, ...(tab.type === "tab" || tab.type === "patterns" ? {} : { dimOptions: [{ key: "hours", label: "Hours" }], defaultDimensions: ["hours"] }) };
        const chosenKey = chosen[name];
        const parsed = tab.type === "people" && chosenKey !== undefined ? readRosterSource(chosenKey) : undefined;
        const source: RosterSource | undefined = parsed?.success ? { type: parsed.value.type, key: parsed.value.value } : undefined;
        const target = selection?.type === "assignment" ? selection.key : undefined;
        const custom = tab.type === "tab" && tab.value.drop.type === "some" ? tab.value.cards.find(card => card.key === chosenKey) : undefined;
        const finding = tab.type === "people" && findWhat !== undefined;
        // A pane its source reads again holds its cards retained (#1398, CL8): what they place waits until it lands.
        const held = pane["aria-disabled"] === true;
        // A chosen pattern applies to the selected person's week — the selected person-week's, else the week in view (#1406).
        const patternTarget = tab.type === "patterns" && chosenKey !== undefined && (selection?.type === "personWeek" || selection?.type === "person")
            ? { person: value.people.find(p => p.key === selection.key), start: selection.type === "personWeek" ? new Date(selection.start) : start } : undefined;
        const hint = tab.type === "patterns" ? (narrow ? "Select a pattern, then Apply pattern… on a person's card" : "Drag one onto a person's week. It replaces all seven days.")
            : narrow ? tab.type === "people" ? "Select a person to assign" : "Select a card, then an assignment"
                : tab.type === "people" ? `Drag onto a shift · ${format.weekdayDate(new Date(start.getTime() + day * DAY))}` : "Drag onto a person · one per shift";
        return { key: name, label, count, body: <Box css={styles.pane} data-roster-library={name} {...pane}>
            {finding && <Box css={styles.paneFoot} data-roster-find="">
                {/* Pressed, the chip clears the find: its name says so, its face what the find looks for. */}
                <SliceFieldChip label={`Find · ${findWhat}`} aria-label={`Clear find · ${findWhat}`} active removeLabel="Clear find" onRemove={args.onClearFind} onClick={args.onClearFind} />
            </Box>}
            <EastChakraLibrary value={library} storageKey={rosterLibraryId(storageKey, name)} empty={follows.empty} narrowing={narrowing}
                extras={tab.type === "people" ? reasons : tab.type === "patterns" ? patternExtras : undefined} />
            <Box css={[styles.paneFoot, styles.paneHint]}>{hint}</Box>
            {/* The foot's actions stay in place, inert, while a run of the optimiser holds the week (#1409, R2). */}
            {(commands.available || commands.locked !== undefined) && !held && chosenKey !== undefined && <Box css={styles.paneFoot}>
                {source !== undefined && <PlaceAction label={source.type === "agency" ? "Request staff" : "Assign person"} source={source} slot={defaultSlot} value={value} start={start} commands={commands} styles={styles} />}
                {patternTarget?.person !== undefined && <Button size="xs" variant="outline" disabled={commands.locked !== undefined} title={commands.locked} onClick={() => setError(commands.applyPattern(patternTarget.person!.key, patternTarget.start, chosenKey))}>Apply to {patternTarget.person.name}</Button>}
                {tab.type === "activities" && <Button size="xs" variant="outline" disabled={target === undefined || commands.locked !== undefined} title={commands.locked} onClick={() => { if (target !== undefined) setError(commands.activity(target, some(chosenKey))); }}>Set activity on selected duty</Button>}
                {custom !== undefined && custom.sets.length > 0 && <Button size="xs" variant="outline" disabled={target === undefined || commands.locked !== undefined} title={commands.locked} onClick={() => { if (target !== undefined) setError(commands.sets(target, custom.sets)); }}>Apply to selected duty</Button>}
                {error !== undefined && <Box role="alert" css={styles.error}>{error}</Box>}
            </Box>}
        </Box> };
    });
    return { label: "Library", icon: "layer-group", size: "272px", tabs, tab: args.tab, onTabChange: args.onTab, persist: "local", badge: off };
}
