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
 *   with its drafts in place (#1196) and read again when its record commits —
 *   the footer's counts' read (`counts.ts`), which hands the pane them —
 *   so a card scheduled leaves it and an event unscheduled joins it at once:
 *   each card its kind's icon, its
 *   title and `6 h · Press A · due Fri 16`, grouped by when it is due — Due
 *   this week, Due next week, Later, No date — counted from the week the
 *   axis's now is in, or today's (PB28). A card's resource on a paged resource
 *   kind is named once it is read by its key (#1199, `resources.ts`), its key
 *   standing in meanwhile.
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
 *   library lists no Backlog tab (PB26). Until its kinds' first read lands the
 *   Backlog tab — and the rail — counts "…", over placeholder cards: never
 *   "Backlog clear", never 0 (#1398, CL13).
 *
 * Each tab follows its source of the Plan's slice (#1344), as the Calendar's
 * do: the Events tab each templates list's, by template key; the Backlog its
 * kinds' own narrowing, counting `N of M` — what shows beside the stored
 * events their choices hide — with a Clear filters that keeps each window; an
 * author's tab the source it names, by its rows' keys. Each counts what it
 * shows, says so when the rail leaves it none, with Clear filters, and takes
 * no gesture while its source resolves. The Series tab stays as it is: show
 * and hide switches.
 *
 * Templates, backlog events, and the cards of an author's tab are drag
 * sources from the libraries `${planKeys(id).library}:events`, `…:backlog` and
 * `…:tab:<its name>`: a template's or an event's card keyed by its kind and key
 * as East prints a `Schedule.Types.EventRef`, an author's by its row's key as
 * text. A template or a backlog event drags while the canvas draws an event
 * kind's row to drop it on (#1196). An author's card lands on a row whose
 * series makes an item of a card (#1259), as a Library's card beside the Plan
 * does, by the pointer or the keyboard, and — with a `drop` — on an event of
 * its patch's kind (#1196): it drags while one of them is on the canvas.
 *
 * @packageDocumentation
 */

import { useCallback, useMemo, useState, type ReactNode } from "react";
import { Box, useSlotRecipe } from "@chakra-ui/react";
import { DateTimeType, StringType, compareFor, equalFor, none, printFor, some, type ValueTypeOf } from "@elaraai/east";
import type { PickBindType } from "@elaraai/east-ui";
import { ScheduleEventRefType, ScheduleResourceRefType, type planKeys } from "@elaraai/e3-ui/internal";
import {
    EastChakraLibrary, EastChakraPickPanel, EmptyStateView, getSomeorUndefined,
    type BuilderFrameDock, type LibraryEmpty, type LibraryNarrowing, type LibraryValue,
} from "@elaraai/east-ui-components";
import { PlaceholderCard, SliceDensityContext, narrowedCount } from "@elaraai/east-ui-components/internal";
import { scheduleLibraryCard as card, scheduleLibrary as libraryOf } from "../../shared/schedule/library.js";
import { DUE_GROUPS, dueGroupOf, durationMinutes, type DueGroup } from "../../shared/schedule/due.js";
import type { BacklogNarrowing } from "../../shared/schedule/backlog.js";
import type { FollowedSources } from "../../shared/schedule/follow-sources.js";
import { sourceTab, sourcesTab, type SourceShown, type SourceTab } from "../../shared/schedule/source-tab.js";
import type { PlanLibraryTabWord } from "../messages.js";
import type { PlanEventPart } from "../root/sources.js";
import type { PlanWords } from "../words.js";
import type { PlanBacklogEntry } from "./counts.js";
import type { PlanValue } from "./index.js";
import { usePlanResourceRows, type PlanResourceRefValue } from "./resources.js";

/** The names a Plan keeps its viewer's state under. */
type PlanKeys = ReturnType<typeof planKeys>;
/** One event kind, as the payload carries it. */
type PlanEventKindValue = PlanValue["events"][number];
/** One event as a kind's seams read it. */
type PlanEventItemValue = Extract<ReturnType<PlanEventKindValue["planUnscheduled"]>, { type: "some" }>["value"][number];
/** A resource an event is on, if it is. */
type PlanResourceOptionValue = PlanEventItemValue["resource"];
/** An author's tab, decoded. */
type PlanAuthorTabValue = Extract<PlanValue["library"][number], { type: "tab" }>["value"];
/** A pick, decoded: the canvas's own over `data`'s series, and the Series tab's. */
export type PlanPickValue = ValueTypeOf<typeof PickBindType>;

/** One template of a kind: its card in the Events tab. */
interface TemplateEntry {
    readonly kind: PlanEventKindValue;
    readonly template: PlanEventKindValue["templates"][number];
}

/** One card of an author's tab, as the payload carries it. */
type PlanAuthorCardValue = PlanAuthorTabValue["cards"][number];

const stringEqual = equalFor(StringType);
const compareDateTime = compareFor(DateTimeType);
/** A card's key: its kind and its key, as East prints a `Schedule.Types.EventRef`. */
const printRef = printFor(ScheduleEventRefType);
/** A resource among those the backlog's cards name, by its ref as East prints it. */
const printResource = printFor(ScheduleResourceRefType);

/** The library open: the Calendar's 272px (§8). */
const LIBRARY_SIZE = "272px";

/** No unscheduled event. */
const NO_BACKLOG: readonly PlanBacklogEntry[] = [];

/** The placeholder cards the Backlog tab holds until its kinds' first read lands (#1398, CL13), at a backlog card's height. */
const PENDING_CARDS = [0, 1, 2] as const;
const PENDING_CARD_PX = 64;

/** The rail hides nothing of the backlog. */
const NO_BACKLOG_NARROWING: BacklogNarrowing<PlanEventPart> = { narrowing: [], hidden: undefined, clear: undefined };

/** No source of the slice the tabs follow. */
const NONE_FOLLOWED: FollowedSources = new Map();

/** What a tab that follows no source shows: its cards whole. */
const WHOLE: SourceShown = { keys: none, busy: false, ready: true, clear: undefined };

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
    /** Whether a row of the canvas takes a card from an author's tab (#1259): its cards drag then. */
    takesCards: boolean;
    /** Every kind's unscheduled events, in the kinds' order, read with the drafts in place (#1196): the counts' read's (`counts.ts`). */
    unscheduled?: readonly PlanBacklogEntry[] | undefined;
    /** Whether the canvas draws an event kind's row to drop a template or a backlog event on (#1196): their cards drag then. */
    takesEvents?: boolean | undefined;
    /** The event kinds with an event on the canvas (#1196): an author's tab whose patch lands on one lets its cards drag. */
    patchKinds?: ReadonlySet<string> | undefined;
    /** The sources of the slice the tabs follow (#1344): each templates list's, and each an author's tab names. */
    followed?: FollowedSources | undefined;
    /** What the rail hides of the backlog (#1344): the Backlog tab's `N of M`, and its Clear filters. */
    backlogNarrowing?: BacklogNarrowing<PlanEventPart> | undefined;
}

/** No event kind has an event on the canvas. */
const NO_PATCH_KINDS: ReadonlySet<string> = new Set();

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
 * The Events tab's templates (#1344): every kind's, in the kinds' order, each
 * following the source its templates list names, by its key in that list's
 * record — the shared {@link sourcesTab}, as the Calendar's Templates tab.
 *
 * @param kinds - The event kinds
 * @param followed - What each source the tabs follow shows
 * @param words - The Plan's words
 * @returns The tab's templates, its count, its narrowed and its own empty states, and its pane's attributes
 */
function templatesTab(kinds: PlanValue["events"], followed: FollowedSources, words: PlanWords): SourceTab<TemplateEntry> {
    const entries = kinds.flatMap((kind) => kind.templates.map((template): TemplateEntry => ({ kind, template })));
    const sourceOf = (kind: PlanEventKindValue): SourceShown | undefined =>
        (kind.templatesSource.type === "some" ? followed.get(kind.templatesSource.value)?.shown : undefined);
    const sources = kinds.flatMap((kind) => { const shown = sourceOf(kind); return shown === undefined ? [] : [shown]; })
        .filter((shown, i, all) => all.indexOf(shown) === i);
    return sourcesTab({ cards: entries, keyOf: (entry) => entry.template.key, sources, sourceOf: (entry) => sourceOf(entry.kind), noun: words.m.libraryNoun({ tab: "events", n: 2 }), words });
}

/**
 * A tab's narrowing in the Plan's words (#1344): the shared narrowing, its
 * empty state said by the Plan's message table.
 *
 * @param narrowing - The tab's narrowing, as its source tab reads it
 * @param tab - The tab
 * @param name - An author's tab's name, as running text writes it
 * @param words - The Plan's words
 * @returns It, in the Plan's words; `undefined` while its sources narrow nothing
 */
function narrowingOf(narrowing: LibraryNarrowing | undefined, tab: PlanLibraryTabWord, name: string, words: PlanWords): LibraryNarrowing | undefined {
    return narrowing === undefined ? undefined
        : { ...narrowing, empty: { title: words.m.libraryNarrowed({ tab, name }), description: words.m.libraryNarrowedHint({ tab, name }) } };
}

/** A tab's body: its Library in the pane's body, busy and taking no gesture while its sources resolve. */
function tabBody(styles: Record<string, Record<string, unknown>>, tab: string, pane: SourceTab<unknown>["pane"], library: ReactNode): ReactNode {
    return <Box css={styles.libraryPane} data-plan-library={tab} {...pane}>{library}</Box>;
}

/**
 * The library pane, as `BuilderFrame` draws it — see the module docs.
 *
 * @param props - The library's tabs, the event and resource kinds, the canvas's pick, the Plan's keys, the viewer's hidden set and its setter, the backlog's now, the words, whether a row takes an author's card, the kinds' unscheduled events, whether the canvas takes the event kinds' cards, the kinds with an event on it, what each source the tabs follow shows, and what the rail hides of the backlog
 * @returns The pane — its tabs the ones `library` lists, each with its count; 272px wide; its collapsed state kept per viewer — or `undefined`, no pane, when `library` lists none
 */
export function usePlanLibrary({
    library, kinds, resources, pick, keys, hidden, onHidden, now, words, takesCards,
    unscheduled: read, takesEvents = false, patchKinds = NO_PATCH_KINDS, followed = NONE_FOLLOWED, backlogNarrowing = NO_BACKLOG_NARROWING,
}: PlanLibraryProps): BuilderFrameDock | undefined {
    const { m } = words;
    // The kinds' unscheduled events once their first read lands (#1398, CL13): until then the tab knows nothing.
    const backlogRead = read !== undefined;
    const unscheduled = read ?? NO_BACKLOG;
    const styles = useSlotRecipe({ key: "plan" })() as Record<string, Record<string, unknown>>;
    const noun = useCallback((tab: PlanLibraryTabWord) => some({ singular: m.libraryNoun({ tab, n: 1 }), plural: m.libraryNoun({ tab, n: 2 }) }), [m]);
    const empty = useCallback((tab: PlanLibraryTabWord, name: string): LibraryEmpty => ({ title: m.libraryEmpty({ tab, name }), description: m.libraryEmptyHint({ tab, name }) }), [m]);
    const listsBacklog = library.some((tab) => tab.type === "backlog");

    // Each resource kind's name, by slot.
    const resourceKinds = useMemo(() => new Map(resources.map((kind) => [kind.key, { name: kind.name }] as const)), [resources]);

    // ── Events: every kind's templates, under its name, then their group (PB27) ──
    // Each kind's list following its source of the rail (#1344).
    const templatesFollow = useMemo(() => templatesTab(kinds, followed, words), [kinds, followed, words]);
    const templates = useMemo(() => libraryOf({
        id: eventsLibrary(keys),
        items: templatesFollow.cards.map(({ kind, template }) => {
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
                // A template drags while the canvas has an event kind's row to drop it on (#1196).
                draggable: takesEvents,
                filtered: false,
                placed: false,
                search: some([template.name, group ?? "", line].join(" · ")),
                groups: new Map([["kind", m.templateGroup({ kind: kind.name, group })]]),
            });
        }),
        groupOptions: [{ key: "kind", label: m.libraryGroupBy({ tab: "events" }) }],
        noun: noun("events"),
        onCardClick: none,
    }), [keys, templatesFollow, resourceKinds, words, m, noun, takesEvents]);

    // ── Backlog: every kind's unscheduled events, by when they are due (PB28) ──
    // Read through each kind's seam with its drafts in place, with the footer's
    // counts (#1196, `counts.ts`): a card scheduled leaves, an event unscheduled
    // joins. Tracked there, so a commit to a kind's record reads it again; the
    // last read stands while one is in flight or has failed.
    // What the tab lists: the kinds' unscheduled events, while the library lists the tab.
    const listed = listsBacklog ? unscheduled : NO_BACKLOG;
    // The resources its cards are on, by name: a listed kind's at once, a paged kind's read by its key (#1199).
    const named = useMemo(() => {
        const out = new Map<string, PlanResourceRefValue>();
        for (const { item } of listed) {
            const at = getSomeorUndefined(item.resource);
            if (at !== undefined) out.set(printResource(at), at);
        }
        return [...out.values()];
    }, [listed]);
    const resourceRows = usePlanResourceRows(resources, named);
    const resourceName = useCallback((ref: PlanResourceOptionValue): string | undefined => {
        const at = getSomeorUndefined(ref);
        return at === undefined ? undefined : resourceRows(at)?.label ?? at.key;
    }, [resourceRows]);
    const backlog = useMemo(() => {
        const rank = (group: DueGroup): number => DUE_GROUPS.indexOf(group);
        const dated = listed.map((entry) => {
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
                    // An unscheduled event drags while the canvas has an event kind's row to drop it on (#1196).
                    draggable: takesEvents,
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
    }, [listed, now, keys, words, m, resourceName, noun, takesEvents]);
    // The backlog is each kind's own narrowing (#1344): it shows what its kinds read, and counts beside it the
    // stored events their choices hide — `3 of 5` — its Clear filters keeping each window.
    const backlogFollow = useMemo((): { count: string | number | undefined; narrowing: LibraryNarrowing | undefined } => {
        const { narrowing, hidden: hiddenByRail, clear } = backlogNarrowing;
        const shown = backlog.items.length;
        if (narrowing.length === 0 || clear === undefined) return { count: shown, narrowing: undefined };
        const held = listed.filter(({ kind }) => narrowing.some((part) => stringEqual(part.kind.key, kind.key))).length;
        const said: LibraryEmpty = { title: m.libraryNarrowed({ tab: "backlog", name: "" }), description: m.libraryNarrowedHint({ tab: "backlog", name: "" }) };
        return {
            count: hiddenByRail === undefined ? undefined : narrowedCount(words, shown, shown + hiddenByRail, true),
            narrowing: { empty: said, onClear: clear, emptied: held === 0 },
        };
    }, [backlogNarrowing, backlog, listed, words, m]);

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
    // A tab's cards drag while a row of the canvas takes a card (#1259), or —
    // with a `drop` — while an event of its patch's kind is on the canvas (#1196).
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
    // Each follows the source it names, by its rows' keys (#1344); one that names none lists its cards whole.
    const authorFollows = useMemo(() => new Map(authorTabs.map((tab): [string, SourceTab<PlanAuthorCardValue>] => {
        const source = getSomeorUndefined(tab.source);
        const shown = source === undefined ? WHOLE : followed.get(source)?.shown ?? WHOLE;
        const follows = sourceTab<PlanAuthorCardValue>({ cards: tab.cards, keyOf: (c) => c.key, shown, noun: tab.name.toLocaleLowerCase(words.locale), words });
        return [`tab:${tab.name}`, follows];
    })), [authorTabs, followed, words]);
    const authorLibraries = useMemo(() => new Map(authorTabs.map((tab): [string, LibraryValue] => {
        const tabKey = `tab:${tab.name}`;
        const chosen = picked.get(tabKey);
        const icon = getSomeorUndefined(tab.icon);
        return [tabKey, libraryOf({
            id: tabLibrary(keys, tab),
            items: (authorFollows.get(tabKey)?.cards ?? tab.cards).map((c) => {
                const meta = getSomeorUndefined(c.meta);
                const group = getSomeorUndefined(c.group);
                return card({
                    key: c.key,
                    label: c.label,
                    sublabel: meta === undefined ? none : some(meta),
                    icon: icon === undefined ? none : some(icon),
                    status: none,
                    trailing: none,
                    draggable: takesCards || (tab.drop.type === "some" && patchKinds.has(tab.drop.value)),
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
    })), [authorTabs, authorFollows, picked, keys, m, noun, onAuthorCard, takesCards, patchKinds]);

    return useMemo((): BuilderFrameDock | undefined => {
        // No tab listed: no pane (PB61).
        if (library.length === 0) return undefined;
        const tabs = library.map((tab) => {
            switch (tab.type) {
                case "events":
                    // Its templates the rail shows, counted, and what it says when the rail leaves it none (#1344).
                    return { key: "events", label: m.libraryTab({ tab: "events" }), count: templatesFollow.count, shown: templates.items.length,
                        body: tabBody(styles, "events", templatesFollow.pane, (
                            <EastChakraLibrary value={templates} storageKey={`${keys.library}.events`}
                                empty={templatesFollow.empty === undefined ? undefined : empty("events", "")}
                                narrowing={narrowingOf(templatesFollow.narrowing, "events", "", words)} />
                        )) };
                case "backlog":
                    // Before its kinds' first read lands: "…" over placeholder cards — never "Backlog clear" or 0 (#1398, CL13).
                    if (!backlogRead) {
                        return { key: "backlog", label: m.libraryTab({ tab: "backlog" }), count: "…", shown: undefined,
                            body: tabBody(styles, "backlog", { "aria-busy": true }, (
                                <Box css={styles.libraryPending} data-plan-backlog="pending" aria-hidden="true">
                                    {PENDING_CARDS.map((i) => <PlaceholderCard key={i} height={PENDING_CARD_PX} index={i} />)}
                                </Box>
                            )) };
                    }
                    return { key: "backlog", label: m.libraryTab({ tab: "backlog" }), count: backlogFollow.count, shown: backlog.items.length,
                        body: tabBody(styles, "backlog", {}, (
                            <EastChakraLibrary value={backlog} storageKey={`${keys.library}.backlog`} empty={empty("backlog", "")} narrowing={backlogFollow.narrowing} />
                        )) };
                case "series": {
                    const lines = seriesPick?.items.length ?? 0;
                    const nothing = empty("series", "");
                    return { key: "series", label: m.libraryTab({ tab: "series" }), count: lines, shown: lines,
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
                    const follows = authorFollows.get(tabKey)!;
                    const name = tab.value.name.toLocaleLowerCase(words.locale);
                    return { key: tabKey, label: tab.value.name, count: follows.count, shown: cards.items.length,
                        body: tabBody(styles, tabKey, follows.pane, (
                            <EastChakraLibrary value={cards} storageKey={`${keys.library}.${tabKey}`}
                                empty={follows.empty === undefined ? undefined : empty("tab", tab.value.name)}
                                narrowing={narrowingOf(follows.narrowing, "tab", name, words)} />
                        )) };
                }
            }
        });
        // Collapsed, the rail counts the backlog — or, with no Backlog tab, the first tab's cards (PB26): what each shows;
        // "…" until the backlog's first read lands.
        return {
            label: m.libraryPane(),
            icon: "layer-group",
            badge: listsBacklog ? (backlogRead ? backlog.items.length : "…") : tabs[0]!.shown,
            size: LIBRARY_SIZE,
            persist: "local",
            tabs: tabs.map(({ shown: _shown, ...pane }) => pane),
        };
    }, [library, m, words, templates, templatesFollow, backlog, backlogFollow, backlogRead, seriesPick, authorLibraries, authorFollows, keys, empty, listsBacklog, styles]);
}
