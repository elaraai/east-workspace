/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

/**
 * The library pane (`Plan Builder Spec.md` §8, §9.6, PB26–PB30, PB61, PB62):
 * the Plan's start pane (#1195), its tabs the ones the author's `library`
 * lists, in that order, each with its count after its name and a search. A
 * Plan whose `library` lists no tab has no pane.
 *
 * - **Events** (`Plan.library.events()`) — every event kind's templates, in
 *   the kinds' order, under the kind's name and then the template's `group`:
 *   each card its kind's icon, its name, and `Print job · 6 h · presses`, its
 *   kind, how long it runs and the resource kinds it is placed on (PB27).
 * - **Backlog** (`Plan.library.backlog()`) — every event kind's unscheduled
 *   events (a kind whose times are Options), read through the kind's own seam
 *   and read again when its record commits: each card its kind's icon, its
 *   title and `6 h · Press A · due Fri 16`, grouped by when it is due — Due
 *   this week, Due next week, Later, No date — counted from the week the
 *   axis's now is in, or today's (PB28).
 * - **Series** (`Plan.library.series()`) — `Pick.Panel`'s list, frameless in
 *   the pane: each resource kind and its measures, the event kinds, `data`'s
 *   picked series and the Plan's `rows`, each with its kind's icon, its title
 *   and an eye, in the order the canvas draws them (PB29). The kinds and the
 *   rows hide in the viewer's own set, kept under the Plan's `id`; `data`'s
 *   series in their pick.
 * - **An author's tab** (`Plan.library.tab(…)`) — its cards, as the Sheet's
 *   (SB60): each its label and its meta under it, with the tab's icon,
 *   grouped by its `group` and searched by key, label and meta. A click
 *   selects a card, and a click on the selected card lets it go (PB62).
 * - An empty tab says so (PB30), in the shared empty state; collapsed, the
 *   pane is a rail with the backlog's count, or the first tab's when the
 *   library lists no Backlog tab (PB26).
 *
 * Templates, backlog events, and the cards of an author's tab with a `drop`,
 * are drag sources from the libraries `${planKeys(id).library}:events`,
 * `…:backlog` and `…:tab:<its name>`: a template's or an event's card keyed by
 * its kind and key as East prints a `Schedule.Types.EventRef`, an author's by
 * its row's key as text. What the Plan takes dropped is #1196's.
 *
 * @packageDocumentation
 */

import { useCallback, useMemo, useRef, useState } from "react";
import { DateTimeType, SortedMap, StringType, compareFor, equalFor, none, printFor, some, type ValueTypeOf } from "@elaraai/east";
import type { PickBindType } from "@elaraai/east-ui";
import { ScheduleEventRefType, type planKeys } from "@elaraai/e3-ui/internal";
import {
    EastChakraLibrary, EastChakraPickPanel, EmptyStateView, getSomeorUndefined, useTrackedEvaluation,
    type BuilderFrameDock, type LibraryItemValue, type LibraryValue,
} from "@elaraai/east-ui-components";
import { SliceDensityContext } from "@elaraai/east-ui-components/internal";
import { DUE_GROUPS, dueGroupOf, durationMinutes, type DueGroup } from "../../shared/schedule/due.js";
import type { PlanLibraryTabWord } from "../messages.js";
import type { PlanWords } from "../words.js";
import type { PlanValue } from "./index.js";

/** The names a Plan keeps its viewer's state under. */
type PlanKeys = ReturnType<typeof planKeys>;
/** One event kind, as the payload carries it. */
type PlanEventKindValue = PlanValue["events"][number];
/** One event as a kind's seams read it. */
type PlanEventItemValue = Extract<ReturnType<PlanEventKindValue["planUnscheduled"]>, { type: "some" }>["value"][number];
/** A resource an event is on, if it is. */
type PlanResourceRefValue = PlanEventItemValue["resource"];
/** An author's tab, decoded. */
type PlanAuthorTabValue = Extract<PlanValue["library"][number], { type: "tab" }>["value"];
/** A pick, decoded: the canvas's own over `data`'s series, and the Series tab's. */
export type PlanPickValue = ValueTypeOf<typeof PickBindType>;

/** One unscheduled event, with the kind it is of. */
interface BacklogEntry {
    readonly kind: PlanEventKindValue;
    readonly item: PlanEventItemValue;
}

const stringEqual = equalFor(StringType);
const compareDateTime = compareFor(DateTimeType);
/** A card's key: its kind and its key, as East prints a `Schedule.Types.EventRef`. */
const printRef = printFor(ScheduleEventRefType);

/** The library open: the Calendar's 272px (§8). */
const LIBRARY_SIZE = "272px";

/** A library tab's cards fill the pane and scroll there, every card mounted. */
const FILL = some({ height: some("fill"), maxHeight: none, virtualization: some(false), columns: none, mediaPlacement: none, mediaSize: none });

/** The drafts the backlog is read with: none yet — the event kinds' editing is #1194's. */
const NO_DRAFTS: Parameters<PlanEventKindValue["planUnscheduled"]>[0] = new SortedMap([], compareFor(StringType));

/** A read whose kinds are still in flight: the backlog stands as it was. */
const READING = "reading";

/** No unscheduled event. */
const NO_BACKLOG: readonly BacklogEntry[] = [];

/** The shared empty state's icon: an empty box, as a Library's — Font Awesome's open box (#1263). */
const EMPTY_ICON = { prefix: "fas", name: "box-open" } as const;

/** Props of {@link usePlanLibrary}. */
export interface PlanLibraryProps {
    /** The library's tabs, as the payload lists them. */
    library: PlanValue["library"];
    /** The event kinds: their templates and their backlogs. */
    kinds: PlanValue["events"];
    /** The resource kinds: what a card names a resource kind and a resource by. */
    resources: PlanValue["resources"];
    /** The canvas's own pick over `data`'s series, when they are picked. */
    pick: PlanPickValue | undefined;
    /** The names the Plan keeps its viewer's state under. */
    keys: PlanKeys;
    /** The ids this viewer hides. */
    hidden: readonly string[];
    /** Replaces the ids this viewer hides. */
    onHidden: (next: readonly string[]) => void;
    /** The moment the backlog's weeks are counted from: the axis's now, or the clock's. */
    now: Date;
    /** The Plan's words. */
    words: PlanWords;
}

/** A card with nothing but its face: no media, byline, action, facets or secondary facts. */
function card(fields: Pick<LibraryItemValue, "key" | "label" | "sublabel" | "icon" | "status" | "trailing" | "draggable" | "filtered" | "placed" | "search" | "groups">): LibraryItemValue {
    return { ...fields, media: none, avatar: none, byline: none, action: none, facets: new Map(), dims: new Map() };
}

/** A Library of a tab's cards, as every tab of the pane draws them: filling the pane, its search and grouping on its toolbar. */
function libraryOf(fields: Pick<LibraryValue, "id" | "items" | "groupOptions" | "noun" | "onCardClick">): LibraryValue {
    return {
        ...fields, hint: none, groupSummaries: new Map(), dimOptions: [], defaultDimensions: [], filterOptions: [], searchable: true,
        addLabel: none, onAdd: none, slice: none, style: FILL, variant: none, layout: none, toolbar: true,
    };
}

/**
 * How long something takes, in the Plan's words — `6 h`, `2 h 15 m`, `45 m`.
 *
 * @param minutes - Its length in whole minutes
 * @param words - The Plan's words
 * @returns The words
 */
function durationWords(minutes: number, words: PlanWords): string {
    const hours = Math.floor(minutes / 60);
    const rest = minutes % 60;
    return words.m.duration({
        hours: hours > 0 ? words.number(hours) : undefined,
        minutes: rest > 0 || hours === 0 ? words.number(rest) : undefined,
    });
}

/**
 * The library a Plan's templates drag from — the Events tab's (#1196).
 *
 * @param keys - The Plan's keys
 * @returns The library's id
 */
export function eventsLibrary(keys: PlanKeys): string {
    return `${keys.library}:events`;
}

/**
 * The library a Plan's backlog drags from — the Backlog tab's (#1196).
 *
 * @param keys - The Plan's keys
 * @returns The library's id
 */
export function backlogLibrary(keys: PlanKeys): string {
    return `${keys.library}:backlog`;
}

/**
 * The library an author's tab's cards drag from (#1196).
 *
 * @param keys - The Plan's keys
 * @param tab - The author's tab
 * @returns The library's id
 */
export function tabLibrary(keys: PlanKeys, tab: PlanAuthorTabValue): string {
    return `${keys.library}:tab:${tab.name}`;
}

/**
 * The Series tab's pick: the viewer's set and the canvas's own, as one list
 * for `Pick.Panel` — the resource kinds and their measures and the event
 * kinds, `data`'s picked series, then the Plan's rows, in the order the canvas
 * draws them. A toggle writes the canvas's pick for its series, and the
 * viewer's set for the rest; the set is read live, so two toggles in one
 * frame compose.
 *
 * @param lines - The tab's own lines: the kinds, and the Plan's rows
 * @param pick - The canvas's own pick, when `data`'s series are picked
 * @param fallback - The store key the panel listens on when there is no pick
 * @param hidden - The viewer's set
 * @param onHidden - Replaces the viewer's set
 * @returns The pick
 */
function seriesPickOf(
    lines: { kinds: PlanPickValue["items"]; rows: PlanPickValue["items"] },
    pick: PlanPickValue | undefined,
    fallback: string,
    hidden: readonly string[],
    onHidden: (next: readonly string[]) => void,
): PlanPickValue {
    const picked = new Set((pick?.items ?? []).map((item) => item.id));
    // The viewer's set as this pick last wrote it, until the next render brings it back.
    let own = hidden;
    return {
        key: pick?.key ?? fallback,
        state: {
            read: () => [...own, ...(pick?.state.read() ?? [])],
            write: (next) => {
                own = next.filter((id) => !picked.has(id));
                onHidden(own);
                if (pick !== undefined) pick.state.write(next.filter((id) => picked.has(id)));
                return null;
            },
            has: () => true,
        },
        items: [...lines.kinds, ...(pick?.items ?? []), ...lines.rows],
    };
}

/**
 * The library pane, as `BuilderFrame` draws it — see the module docs.
 *
 * @param props - The library's tabs, the event and resource kinds, the canvas's pick, the Plan's keys, the viewer's hidden set and its setter, the backlog's now, and the words
 * @returns The pane — its tabs the ones `library` lists, each with its count; 272px wide; its collapsed state kept per viewer — or `undefined`, no pane, when `library` lists none
 */
export function usePlanLibrary({ library, kinds, resources, pick, keys, hidden, onHidden, now, words }: PlanLibraryProps): BuilderFrameDock | undefined {
    const { m } = words;
    const noun = useCallback((tab: PlanLibraryTabWord) => some({ singular: m.libraryNoun({ tab, n: 1 }), plural: m.libraryNoun({ tab, n: 2 }) }), [m]);
    const empty = useCallback((tab: PlanLibraryTabWord, name: string) => ({ title: m.libraryEmpty({ tab, name }), description: m.libraryEmptyHint({ tab, name }) }), [m]);
    const listsBacklog = library.some((tab) => tab.type === "backlog");

    // Each resource kind's name, by slot, and its resources' names, by their key's text.
    const resourceKinds = useMemo(() => new Map(resources.map((kind) => [kind.key, {
        name: kind.name,
        rows: new Map(kind.rows.map((row) => [row.key, row.label])),
    }] as const)), [resources]);
    const resourceName = useCallback((ref: PlanResourceRefValue): string | undefined => {
        const at = getSomeorUndefined(ref);
        return at === undefined ? undefined : resourceKinds.get(at.kind)?.rows.get(at.key) ?? at.key;
    }, [resourceKinds]);

    // ── Events: every kind's templates, under its name, then their group (PB27) ──
    const templates = useMemo(() => libraryOf({
        id: eventsLibrary(keys),
        items: kinds.flatMap((kind) => kind.templates.map((template) => {
            const group = getSomeorUndefined(template.group);
            const takes = kind.takes.map((slot) => (resourceKinds.get(slot)?.name ?? slot).toLocaleLowerCase(words.locale));
            const line = m.templateLine({
                kind: kind.name,
                duration: kind.instant ? undefined : durationWords(durationMinutes(template.duration), words),
                resources: takes,
            });
            return card({
                key: printRef({ kind: kind.key, key: template.key }),
                label: template.name,
                sublabel: some(line),
                icon: some(kind.icon),
                status: none,
                trailing: none,
                draggable: true,
                filtered: false,
                placed: false,
                search: some([template.name, group ?? "", line].join(" · ")),
                groups: new Map([["kind", m.templateGroup({ kind: kind.name, group })]]),
            });
        })),
        groupOptions: [{ key: "kind", label: m.libraryGroupBy({ tab: "events" }) }],
        noun: noun("events"),
        onCardClick: none,
    }), [keys, kinds, resourceKinds, words, m, noun]);

    // ── Backlog: every kind's unscheduled events, by when they are due (PB28) ──
    // Read through each kind's seam, as the footer counts it: tracked, so a
    // commit to a kind's record reads it again; the last read stands while one
    // is in flight or has failed.
    const readBacklog = useCallback((): readonly BacklogEntry[] | typeof READING | undefined => {
        if (!listsBacklog) return undefined;
        const out: BacklogEntry[] = [];
        for (const kind of kinds) {
            if (!kind.backlog) continue;
            const read = kind.planUnscheduled(NO_DRAFTS);
            if (read.type === "none") return READING;
            for (const item of read.value) out.push({ kind, item });
        }
        return out;
    }, [listsBacklog, kinds]);
    const { result } = useTrackedEvaluation(readBacklog);
    const heldBacklog = useRef<readonly BacklogEntry[]>(NO_BACKLOG);
    const unscheduled = useMemo(() => {
        if (!result.ok) {
            console.error("[Plan] the backlog could not be read:", result.error);
            return heldBacklog.current;
        }
        if (result.value === READING || result.value === undefined) return heldBacklog.current;
        heldBacklog.current = result.value;
        return result.value;
    }, [result]);
    const backlog = useMemo(() => {
        const rank = (group: DueGroup): number => DUE_GROUPS.indexOf(group);
        const dated = unscheduled.map((entry) => {
            const due = getSomeorUndefined(entry.item.due);
            return { ...entry, due, group: dueGroupOf(due, now) };
        });
        // The groups in their order, each soonest due first; the rest as the kinds read them.
        const ordered = [...dated].sort((a, b) => {
            if (rank(a.group) !== rank(b.group)) return rank(a.group) < rank(b.group) ? -1 : 1;
            return a.due !== undefined && b.due !== undefined ? compareDateTime(a.due, b.due) : 0;
        });
        return libraryOf({
            id: backlogLibrary(keys),
            items: ordered.map(({ kind, item, due, group }) => {
                const line = m.backlogLine({
                    duration: durationWords(Number(item.minutes), words),
                    resource: resourceName(item.resource),
                    due: due !== undefined ? m.backlogDue({ weekday: words.weekday(due), day: words.number(due.getUTCDate()) }) : undefined,
                });
                return card({
                    key: printRef({ kind: kind.key, key: item.key }),
                    label: item.title,
                    sublabel: some(line),
                    icon: some(kind.icon),
                    status: none,
                    trailing: none,
                    draggable: true,
                    filtered: false,
                    placed: false,
                    search: some([item.title, kind.name, line].join(" · ")),
                    groups: new Map([["due", m.dueGroup({ due: group })]]),
                });
            }),
            groupOptions: [{ key: "due", label: m.libraryGroupBy({ tab: "backlog" }) }],
            noun: noun("backlog"),
            onCardClick: none,
        });
    }, [unscheduled, now, keys, words, m, resourceName, noun]);

    // ── Series: what the canvas shows that the viewer can hide (PB29) ──
    // A new set is a new pick, so the panel draws its eyes again.
    const seriesLines = useMemo(() => {
        const tab = library.find((t) => t.type === "series");
        return tab === undefined ? undefined : { kinds: tab.value.kinds, rows: tab.value.rows.map((line) => line.item) };
    }, [library]);
    const seriesPick = useMemo(
        () => (seriesLines === undefined ? undefined : seriesPickOf(seriesLines, pick, keys.series, hidden, onHidden)),
        [seriesLines, pick, keys.series, hidden, onHidden]);

    // ── An author's tabs: their cards, a click selecting one (PB62) ──────
    // The card each tab's click selected, by the tab's key.
    const [picked, setPicked] = useState<ReadonlyMap<string, string>>(() => new Map());
    const onAuthorCard = useCallback((tabKey: string, key: string) => {
        setPicked((was) => {
            const next = new Map(was);
            const chosen = was.get(tabKey);
            if (chosen !== undefined && stringEqual(chosen, key)) next.delete(tabKey);
            else next.set(tabKey, key);
            return next;
        });
    }, []);
    const authorTabs = useMemo(() => library.flatMap((tab) => (tab.type === "tab" ? [tab.value] : [])), [library]);
    const authorLibraries = useMemo(() => new Map(authorTabs.map((tab): [string, LibraryValue] => {
        const tabKey = `tab:${tab.name}`;
        const chosen = picked.get(tabKey);
        const icon = getSomeorUndefined(tab.icon);
        return [tabKey, libraryOf({
            id: tabLibrary(keys, tab),
            items: tab.cards.map((c) => {
                const meta = getSomeorUndefined(c.meta);
                const group = getSomeorUndefined(c.group);
                return card({
                    key: c.key,
                    label: c.label,
                    sublabel: meta === undefined ? none : some(meta),
                    icon: icon === undefined ? none : some(icon),
                    status: none,
                    trailing: none,
                    draggable: tab.drop.type === "some",
                    filtered: false,
                    placed: chosen !== undefined && stringEqual(chosen, c.key),
                    search: some([c.key, c.label, meta ?? ""].join(" · ")),
                    groups: group === undefined ? new Map() : new Map([["group", group]]),
                });
            }),
            groupOptions: tab.cards.some((c) => c.group.type === "some") ? [{ key: "group", label: m.libraryGroupBy({ tab: "tab" }) }] : [],
            noun: noun("tab"),
            onCardClick: some((key: string) => { onAuthorCard(tabKey, key); return null; }),
        })];
    })), [authorTabs, picked, keys, m, noun, onAuthorCard]);

    return useMemo((): BuilderFrameDock | undefined => {
        // No tab listed: no pane (PB61).
        if (library.length === 0) return undefined;
        const tabs = library.map((tab) => {
            switch (tab.type) {
                case "events":
                    return { key: "events", label: m.libraryTab({ tab: "events" }), count: words.number(templates.items.length),
                        body: <EastChakraLibrary value={templates} storageKey={`${keys.library}.events`} empty={empty("events", "")} /> };
                case "backlog":
                    return { key: "backlog", label: m.libraryTab({ tab: "backlog" }), count: words.number(backlog.items.length),
                        body: <EastChakraLibrary value={backlog} storageKey={`${keys.library}.backlog`} empty={empty("backlog", "")} /> };
                case "series": {
                    const lines = seriesPick?.items.length ?? 0;
                    const nothing = empty("series", "");
                    return { key: "series", label: m.libraryTab({ tab: "series" }), count: words.number(lines),
                        body: seriesPick === undefined || lines === 0
                            ? <EmptyStateView icon={EMPTY_ICON} title={nothing.title} description={nothing.description} />
                            : (
                                <SliceDensityContext.Provider value="editor">
                                    <EastChakraPickPanel value={{ pick: seriesPick, title: m.libraryTab({ tab: "series" }) }} />
                                </SliceDensityContext.Provider>
                            ) };
                }
                case "tab": {
                    const tabKey = `tab:${tab.value.name}`;
                    const cards = authorLibraries.get(tabKey)!;
                    return { key: tabKey, label: tab.value.name, count: words.number(cards.items.length),
                        body: <EastChakraLibrary value={cards} storageKey={`${keys.library}.${tabKey}`} empty={empty("tab", tab.value.name)} /> };
                }
            }
        });
        // Collapsed, the rail counts the backlog — or, with no Backlog tab, the first tab's cards (PB26).
        return {
            label: m.libraryPane(),
            icon: "layer-group",
            badge: listsBacklog ? words.number(backlog.items.length) : tabs[0]!.count,
            size: LIBRARY_SIZE,
            persist: "local",
            tabs,
        };
    }, [library, m, words, templates, backlog, seriesPick, authorLibraries, keys, empty, listsBacklog]);
}
