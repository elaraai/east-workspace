/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

/**
 * The library pane (`Sheet Builder Spec.md` §7, §8, §9.7, SB32, SB33, SB36,
 * SB37, SB59, SB60): the Sheet's start pane (#1216), its tabs the ones the
 * author's `library` lists, in that order, each a `Library` with its count
 * after its name and a search — what the sheet offers to drag into its
 * rows, and the columns a viewer shows and hides. A sheet whose `library`
 * lists no tab has no pane.
 *
 * - **Rows** (`Sheet.library.rows()`) — the templates, grouped by their
 *   `group`: a card names the template and, under it, what it sets — its
 *   cells as the columns print them, in column order — or, for a group
 *   template, its band cells and how many lines it drops. Each templates
 *   list follows its source of the rail (#1345): the tab shows the cards its
 *   sources show, counts them (`3 of 8`), and says so when the rail leaves it
 *   none, with Clear filters for those sources alone.
 * - **Columns** (`Sheet.library.columns()`) — the declared columns in their
 *   order, each with its kind and an eye; a click hides it, or shows it
 *   again, dimmed while hidden. The last column shown stays.
 * - **An author's tab** (`Sheet.library.tab(…)`) — its cards, each its label
 *   and its meta under it, with the tab's icon, grouped by its `group` and
 *   searched by key, label and meta. A click selects a card, and a click on
 *   the selected card lets it go. A tab that declares a `drop` offers its
 *   cards to drag (#1187). A tab that names a source follows it as the Rows
 *   tab does; one that names none lists its cards whole.
 * - An empty tab says so (SB37), in the shared empty state; collapsed, the
 *   pane is a rail with the templates' count, or the first tab's when the
 *   library lists no Rows tab. A tab over a source takes no gesture while
 *   its source resolves.
 *
 * Template cards drag from the library `${sheetKeys(name).library}:rows` names,
 * an author's tab's from `…:tab:<its name>` ({@link templatesLibrary},
 * {@link tabLibrary}) — the libraries the sheet takes drops from (#1187). A
 * draggable card's ⏎ is the sheet's: the card, dropped below the ring's row
 * (SB45).
 *
 * @packageDocumentation
 */

import { useCallback, useMemo, useState } from "react";
import { Box } from "@chakra-ui/react";
import { StringType, StructType, decodeBeast2For, equalFor, none, printFor, some, variant } from "@elaraai/east";
import { Sheet, type sheetKeys } from "@elaraai/e3-ui/internal";
import {
    EastChakraLibrary, getSomeorUndefined, type BuilderFrameDock, type LibraryItemValue, type LibraryValue,
} from "@elaraai/east-ui-components";
import { useSlotStyles } from "@elaraai/east-ui-components/internal";
import { sourceTab, sourcesTab, type SourceShown, type SourceTab } from "../../shared/schedule/source-tab.js";
import { useSheetDropEnter } from "../index.js";
import type { SheetLibraryTabWord } from "../messages.js";
import { TITLE_KEY, cellIsBlank, cellText, indexColumns, indexGroup, type SheetColumnIndex, type SheetColumnMeta } from "../model.js";
import type { SheetCellValue } from "../values.js";
import type { SheetWords } from "../words.js";
import type { SheetValue } from "./index.js";
import type { FollowedSources } from "../../shared/schedule/follow-sources.js";

/** One template, decoded. */
type SheetTemplateValue = SheetValue["templates"][number];
/** An author's tab, decoded. */
type SheetAuthorTabValue = Extract<SheetValue["library"][number], { type: "tab" }>["value"];
/** The names the sheet keeps its viewer's state under. */
type SheetKeys = ReturnType<typeof sheetKeys>;

const stringEqual = equalFor(StringType);
const decodeRow = decodeBeast2For(Sheet.Types.Row);
/** A template's card's identity: its key in its record, beside its list's source. */
const TemplateCardKeyType = StructType({ source: StringType, key: StringType });
const printCardKey = printFor(TemplateCardKeyType);

/** What a tab that names no source shows: its cards whole. */
const WHOLE: SourceShown = { keys: none, busy: false, ready: true, clear: undefined };

/** The library open: the Calendar's 272px (§8). */
const LIBRARY_SIZE = "272px";

/** A library tab's cards fill the pane and scroll there, every card mounted. */
const FILL = some({ height: some("fill"), maxHeight: none, virtualization: some(false), columns: none, mediaPlacement: none, mediaSize: none });

/** Props of {@link useSheetLibrary}. */
export interface SheetLibraryProps {
    /** The sheet's payload: the sheet, the templates and the library's tabs. */
    value: SheetValue;
    /** The names the sheet keeps its viewer's state under. */
    keys: SheetKeys;
    /** The columns this viewer hides, by key. */
    hidden: ReadonlySet<string>;
    /** Hides a column the grid shows, or shows a hidden one again. */
    onToggleColumn: (key: string) => void;
    /** The sheet's words. */
    words: SheetWords;
    /** What each source the library follows shows (#1345). */
    followed: FollowedSources;
}

/**
 * A template's card's key (#1345): its key in its templates record, beside
 * its list's source — two lists' templates may share a key, each in its own
 * record. What the Rows tab's cards drag by, and the sheet's drops find them by.
 *
 * @param template - The template: its list's source, and its key in that list's record
 * @returns Its card's key
 */
export function templateCardKey(template: Pick<SheetTemplateValue, "source" | "key">): string {
    return printCardKey({ source: template.source, key: template.key });
}

/**
 * The Rows tab over its templates lists (#1345): each list a record of its
 * own following its own source — the shared {@link sourcesTab} — counted
 * together, its Clear filters clearing each narrowing source, and its own
 * empty words the sheet's.
 *
 * @param templates - Every template, each with the source its list follows
 * @param followed - What each source shows
 * @param words - The sheet's words
 * @returns The tab's cards, its count, its narrowed and its own empty states, and its pane's attributes
 */
function templatesTab(templates: readonly SheetTemplateValue[], followed: FollowedSources, words: SheetWords): SourceTab<SheetTemplateValue> {
    const shownOf = (source: string): SourceShown => followed.get(source)?.shown ?? WHOLE;
    const sources = templates.map((template) => template.source).filter((source, i, all) => all.findIndex((other) => stringEqual(other, source)) === i);
    const tab = sourcesTab({
        cards: templates, keyOf: (template) => template.key, sources: sources.map(shownOf), sourceOf: (template) => shownOf(template.source),
        noun: words.m.libraryNoun({ tab: "rows", n: 2 }), words,
    });
    return {
        ...tab,
        empty: tab.empty === undefined ? undefined : { title: words.m.libraryEmpty({ tab: "rows", name: "" }), description: words.m.libraryEmptyHint({ tab: "rows", name: "" }) },
    };
}

/** A card's line under its name: the texts, the blank ones left out. */
function line(texts: readonly string[]): string {
    return texts.filter((text) => text !== "").join(" · ");
}

/** A cell as its column prints it, or `""` for a blank one. */
function printed(cell: SheetCellValue | undefined, meta: SheetColumnMeta | undefined, words: SheetWords): string {
    return cell === undefined || meta === undefined || cellIsBlank(cell) ? "" : cellText(cell, meta, words);
}

/**
 * How many lines a group template drops: its seed's, as a drop would make it.
 *
 * @param template - A group template
 * @param keyed - Whether the sheet's groups sit in key order, or where they are put
 * @returns The count, or `undefined` when the seed fails
 */
function seededLines(template: SheetTemplateValue, keyed: boolean): number | undefined {
    if (template.seed.type !== "group") return undefined;
    try {
        const seeded = template.seed.value({ place: keyed ? variant("keyOrder", null) : variant("ordered", variant("end", null)) });
        return decodeRow(seeded.row).lines.length;
    } catch (err) {
        console.error(`[Sheet] group template "${template.key}" could not be seeded:`, err);
        return undefined;
    }
}

/**
 * What a template sets, as its card says it (SB33): a row template's cells as
 * the columns print them, in column order; a group template's title and band
 * cells, then the lines it drops.
 *
 * @param template - The template
 * @param columns - The declared columns
 * @param group - The band's cells, on a grouped sheet
 * @param keyed - Whether the sheet's groups sit in key order
 * @param words - The sheet's words
 * @returns The card's line
 */
function templateLine(template: SheetTemplateValue, columns: SheetColumnIndex, group: ReturnType<typeof indexGroup> | undefined, keyed: boolean, words: SheetWords): string {
    if (template.seed.type === "row") return line(columns.list.map((meta) => printed(template.cells.get(meta.key), meta, words)));
    const lines = seededLines(template, keyed);
    return line([
        printed(template.cells.get(TITLE_KEY), group?.cells.get(TITLE_KEY), words),
        ...columns.list.map((col) => printed(template.cells.get(col.key), group?.cells.get(col.key), words)),
        lines === undefined ? "" : words.m.templateLines({ n: lines, count: words.number(lines) }),
    ]);
}

/** A card with nothing but its face: no media, byline, action, facets or secondary facts. */
function card(fields: Pick<LibraryItemValue, "key" | "label" | "sublabel" | "icon" | "status" | "trailing" | "draggable" | "filtered" | "placed" | "search" | "groups">): LibraryItemValue {
    return { ...fields, media: none, avatar: none, byline: none, action: none, facets: new Map(), dims: new Map() };
}

/** The pane's tab of an author's tab: its key among the pane's tabs, and its cards' library. */
function authorTabKey(tab: SheetAuthorTabValue): string {
    return `tab:${tab.name}`;
}

/**
 * The library a sheet's templates drag from — the Rows tab's (#1187).
 *
 * @param keys - The sheet's keys
 * @returns The library's id
 */
export function templatesLibrary(keys: SheetKeys): string {
    return `${keys.library}:rows`;
}

/**
 * The library an author's tab's cards drag from (#1187).
 *
 * @param keys - The sheet's keys
 * @param tab - The author's tab
 * @returns The library's id
 */
export function tabLibrary(keys: SheetKeys, tab: SheetAuthorTabValue): string {
    return `${keys.library}:${authorTabKey(tab)}`;
}

/**
 * The library pane, as `BuilderFrame` draws it — see the module docs.
 *
 * @param props - The payload, the sheet's keys, the columns hidden and their toggle, and the words
 * @returns The pane — its tabs the ones `library` lists, each with its count; 272px wide; its collapsed state kept per viewer (SB24) — or `undefined`, no pane, when `library` lists none
 */
export function useSheetLibrary({ value, keys, hidden, onToggleColumn, words, followed }: SheetLibraryProps): BuilderFrameDock | undefined {
    const { m } = words;
    const sheet = value.sheet;
    // A tab over a source's body: it fills the tab, busy and taking no gesture while its source resolves. The sheet's
    // recipe made once for the theme (#1398, CL9): the library is drawn again with the sheet, a landing at a time.
    const styles = useSlotStyles("sheet");
    const columns = useMemo(() => indexColumns(sheet.columns), [sheet.columns]);
    const keyed = sheet.editing.keyType.type === "some";
    const titleColumn = m.titleColumn();
    const group = useMemo(() => {
        const g = getSomeorUndefined(sheet.group);
        return g === undefined ? undefined : indexGroup(g, columns, titleColumn);
    }, [sheet.group, columns, titleColumn]);

    const noun = useCallback((tab: SheetLibraryTabWord) => some({ singular: m.libraryNoun({ tab, n: 1 }), plural: m.libraryNoun({ tab, n: 2 }) }), [m]);
    const empty = useCallback((tab: SheetLibraryTabWord, name: string) => ({ title: m.libraryEmpty({ tab, name }), description: m.libraryEmptyHint({ tab, name }) }), [m]);

    // A draggable card's ⏎: the card, dropped below the ring's row (SB45).
    const enter = useSheetDropEnter();

    // ── Rows: the templates, by their group (SB33), each list following its source (#1345) ──
    const templates = value.templates;
    const rowsFollow = useMemo(() => templatesTab(templates, followed, words), [templates, followed, words]);
    const rows = useMemo((): LibraryValue => ({
        id: templatesLibrary(keys),
        hint: none,
        items: rowsFollow.cards.map((template) => {
            const category = getSomeorUndefined(template.group);
            const sets = templateLine(template, columns, group, keyed, words);
            return card({
                key: templateCardKey(template),
                label: template.name,
                sublabel: sets === "" ? none : some(sets),
                icon: none,
                status: none,
                trailing: none,
                draggable: true,
                filtered: false,
                placed: false,
                search: some(line([template.name, category ?? "", sets])),
                groups: category === undefined ? new Map() : new Map([["category", category]]),
            });
        }),
        groupOptions: [{ key: "category", label: m.libraryGroupBy({ tab: "rows" }) }],
        groupSummaries: new Map(),
        dimOptions: [],
        defaultDimensions: [],
        filterOptions: [],
        searchable: true,
        noun: noun("rows"),
        addLabel: none,
        onAdd: none,
        onCardClick: none,
        slice: none,
        style: FILL,
        variant: none,
        layout: none,
        toolbar: true,
    }), [keys, rowsFollow, columns, group, keyed, words, m, noun]);

    // ── Columns: each with its kind and an eye (SB36) ───────────────────
    const shown = columns.list.filter((col) => !hidden.has(col.key)).length;
    const onColumn = useCallback((key: string) => {
        // The last column shown stays.
        if (!hidden.has(key) && shown <= 1) return;
        onToggleColumn(key);
    }, [hidden, shown, onToggleColumn]);
    const columnCards = useMemo((): LibraryValue => ({
        id: `${keys.library}:columns`,
        hint: none,
        items: columns.list.map((col) => {
            const off = hidden.has(col.key);
            const kind = m.columnKind({ kind: col.kind });
            return card({
                key: col.key,
                label: col.header,
                sublabel: some(kind),
                icon: none,
                status: none,
                trailing: some({ icon: off ? "eye-slash" : "eye", label: m.columnEye({ hidden: off, last: !off && shown <= 1 }), tone: none }),
                draggable: false,
                filtered: off,
                placed: false,
                search: some(line([col.header, col.key, kind])),
                groups: new Map(),
            });
        }),
        groupOptions: [],
        groupSummaries: new Map(),
        dimOptions: [],
        defaultDimensions: [],
        filterOptions: [],
        searchable: true,
        noun: noun("columns"),
        addLabel: none,
        onAdd: none,
        onCardClick: some((key: string) => { onColumn(key); return null; }),
        slice: none,
        style: FILL,
        variant: none,
        layout: none,
        toolbar: true,
    }), [keys.library, columns, hidden, shown, onColumn, m, noun]);

    // ── An author's tabs: their cards, a click selecting one (SB60) ─────
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
    const authorTabs = useMemo(() => value.library.flatMap((tab) => (tab.type === "tab" ? [tab.value] : [])), [value.library]);
    // Each follows the source it names (#1345); one that names none lists its cards whole.
    const authorFollows = useMemo(() => new Map(authorTabs.map((tab) => {
        const source = getSomeorUndefined(tab.source);
        const shown = source === undefined ? WHOLE : followed.get(source)?.shown ?? WHOLE;
        return [authorTabKey(tab), sourceTab({ cards: tab.cards, keyOf: (c) => c.key, shown, noun: tab.name.toLocaleLowerCase(words.locale), words })] as const;
    })), [authorTabs, followed, words]);
    const authorLibraries = useMemo(() => new Map(authorTabs.map((tab): [string, LibraryValue] => {
        const tabKey = authorTabKey(tab);
        const chosen = picked.get(tabKey);
        const icon = getSomeorUndefined(tab.icon);
        return [tabKey, {
            id: tabLibrary(keys, tab),
            hint: none,
            items: (authorFollows.get(tabKey)?.cards ?? tab.cards).map((c) => {
                const meta = getSomeorUndefined(c.meta);
                const category = getSomeorUndefined(c.group);
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
                    search: some(line([c.key, c.label, meta ?? ""])),
                    groups: category === undefined ? new Map() : new Map([["group", category]]),
                });
            }),
            groupOptions: tab.cards.some((c) => c.group.type === "some") ? [{ key: "group", label: m.libraryGroupBy({ tab: "tab" }) }] : [],
            groupSummaries: new Map(),
            dimOptions: [],
            defaultDimensions: [],
            filterOptions: [],
            searchable: true,
            noun: noun("tab"),
            addLabel: none,
            onAdd: none,
            onCardClick: some((key: string) => { onAuthorCard(tabKey, key); return null; }),
            slice: none,
            style: FILL,
            variant: none,
            layout: none,
            toolbar: true,
        }];
    })), [authorTabs, authorFollows, picked, keys, m, noun, onAuthorCard]);

    return useMemo((): BuilderFrameDock | undefined => {
        // No tab listed: no pane (SB59).
        if (value.library.length === 0) return undefined;
        const tabs = value.library.map((tab) => {
            if (tab.type === "rows") {
                const onEnter = (key: string) => enter(templatesLibrary(keys), key);
                // Its sources' cards, counted, and while one narrows what it says when that leaves it none (#1345).
                return { key: "rows", label: m.libraryTab({ tab: "rows" }), count: rowsFollow.count,
                    body: <Box css={styles.pane} data-sheet-library="rows" {...rowsFollow.pane}>
                        <EastChakraLibrary value={rows} storageKey={`${keys.library}.rows`} empty={rowsFollow.empty} narrowing={rowsFollow.narrowing} onCardEnter={onEnter} />
                    </Box> };
            }
            if (tab.type === "columns") {
                return { key: "columns", label: m.libraryTab({ tab: "columns" }), count: columnCards.items.length,
                    body: <EastChakraLibrary value={columnCards} storageKey={`${keys.library}.columns`} empty={empty("columns", "")} /> };
            }
            const tabKey = authorTabKey(tab.value);
            const library = authorLibraries.get(tabKey)!;
            const follows = authorFollows.get(tabKey)!;
            // A tab whose cards drop takes their ⏎ too; another's cards click on it.
            const onEnter = tab.value.drop.type === "some" ? (key: string) => enter(tabLibrary(keys, tab.value), key) : undefined;
            return { key: tabKey, label: tab.value.name, count: follows.count,
                body: <Box css={styles.pane} data-sheet-library={tabKey} {...follows.pane}>
                    <EastChakraLibrary value={library} storageKey={`${keys.library}.${tabKey}`} empty={follows.empty === undefined ? undefined : empty("tab", tab.value.name)}
                        narrowing={follows.narrowing} onCardEnter={onEnter} />
                </Box> };
        });
        // Collapsed, the rail counts the templates the rail shows — or, with no Rows tab, the first tab's cards.
        const listsRows = value.library.some((tab) => tab.type === "rows");
        return {
            label: m.libraryPane(),
            icon: "layer-group",
            badge: listsRows ? rowsFollow.cards.length : tabs[0]!.count,
            size: LIBRARY_SIZE,
            persist: "local",
            tabs,
        };
    }, [value.library, m, rows, rowsFollow, columnCards, authorLibraries, authorFollows, keys, empty, enter, styles.pane]);
}
