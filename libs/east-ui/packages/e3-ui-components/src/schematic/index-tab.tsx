/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

/**
 * The library's Index tab (#1389, `Schematic Builder Spec.md` §8): the zones
 * nested by containment and the items inside them — the drawing as the
 * canvas draws it, the drafts in place and a hidden layer's entities left
 * out — as a tree (`index-tree.ts`), each row the design system's tree row.
 *
 * - **A zone's row** — its chevron opens or closes it; a click on the row
 *   flies to the zone and selects it, and opens it; its count is the items it
 *   holds, its nested zones' among them. The zone the viewport is in is
 *   marked.
 * - **An item's row** — its dot in its colour, its label and its figure; a
 *   click flies to the item and selects it. An entity on a locked layer is
 *   flown to and never selected (SC27): the canvas decides.
 * - **The search** keeps the items whose label, key or kind's name holds it,
 *   under their zones, opened: the tab's own, never the rail's.
 * - **A kind read by area** (#1393, D52) holds only its window, so the tab
 *   reads its items itself, in a component of its own (`index-area.ts`): an
 *   open zone's by the zone's box, and the search's through the kind's
 *   source's `search` fields, its first matches listed and how many more said
 *   under the tree. A zone holding such items counts them once its box is
 *   read, and one holding more than a window reads says so.
 * - **The keys** — the tree is one tab stop, pointing at its active row
 *   (`aria-activedescendant`, as the Sheet's grid does): ↑ and ↓ move between
 *   the rows, Home and End to the first and the last, → opens a zone or goes
 *   into it, ← closes it or goes up to its zone, and Enter or Space does a
 *   row's click — each move bringing its row into view, and each key the
 *   tree acts on going no further than the Schematic (#1398).
 *
 * The rows are the shared virtual rows (`VirtualRows`): only those in view are
 * mounted, however many the drawing holds, and each says where it stands among
 * the rows beside it. Every style is the `schematic` recipe's; the search box
 * and the empty state are the Library's.
 *
 * @packageDocumentation
 */

import { useCallback, useEffect, useId, useMemo, useRef, useState, type CSSProperties, type KeyboardEvent, type MouseEvent } from "react";
import { Box, chakra, useSlotRecipe } from "@chakra-ui/react";
import { FontAwesomeIcon } from "@fortawesome/react-fontawesome";
import { faAngleRight } from "@fortawesome/free-solid-svg-icons";
import { StringType, equalFor } from "@elaraai/east";
import { SCHEMATIC_WINDOW_READ_ROWS } from "@elaraai/e3-ui/internal";
import { getSomeorUndefined, takeKey, useSlicesReactivity, useTrackedEvaluation } from "@elaraai/east-ui-components";
import { LibraryEmptyState, LibrarySearchBox, SEARCH_DELAY_MS, VirtualRows } from "@elaraai/east-ui-components/internal";
import { READING } from "./area.js";
import type { DrawnItem, DrawnZone } from "./canvas/drawn.js";
import { buildNavTree } from "./canvas/model.js";
import { itemTint, tintAttributes } from "./canvas/tints.js";
import { NO_INDEX_AREA, type IndexAreaKind, type IndexAreaRead, type SchematicIndexArea } from "./index-area.js";
import { indexRows, type IndexRow } from "./index-tree.js";
import type { SchematicWords } from "./messages.js";

/** The recipe's slots, as the shared virtual rows take their root's: the Roster's and the Allocation's are typed so too. */
type Styles = Record<string, Record<string, unknown>>;

const stringEqual = equalFor(StringType);

/** A row's key: its entity's id on the canvas. */
const rowKey = (row: IndexRow): string => (row.kind === "zone" ? row.zone.key : row.item.key);

/** A row's indent, its geometry: the recipe lays it out 24px a level. */
const depthStyle = (depth: number): CSSProperties => ({ "--index-depth": String(depth) }) as CSSProperties;

/** A row's height until it is measured: the design system's tree row (a touch screen's taller row is measured). */
const ROW_ESTIMATE = 36;

/** A chevron's press keeps the focus where it is: on the tree, which points at its rows. */
const keepFocus = (e: MouseEvent) => e.preventDefault();

/** The item kinds read by area, as the Index reads them (#1393, D52). */
export interface SchematicIndexAreaProps {
    /** The kinds, each with its source of the slice and its area indexes. */
    readonly kinds: readonly IndexAreaKind[];
    /** Its reads, kept across renders. */
    readonly reader: SchematicIndexArea;
    /** The layers hidden, by key: the Index lists none of the items on them. */
    readonly hiddenLayers: ReadonlySet<string>;
}

/** Props of {@link SchematicIndexTab}. */
export interface SchematicIndexTabProps {
    /** The zones the canvas draws: a hidden layer's left out. */
    readonly zones: readonly DrawnZone[];
    /** The items the canvas draws: a hidden layer's left out. */
    readonly items: readonly DrawnItem[];
    /** An item kind's name, by its slot: what the search reads beside an item's label and key. */
    readonly kindName: (slot: string) => string;
    /** The zone the viewport is in, by its id; `undefined` for none. */
    readonly inView: string | undefined;
    /** What the canvas has selected, by id: its rows are marked. */
    readonly selected: ReadonlySet<string>;
    /** Flies to an item or a zone, by its id, and selects it. */
    readonly onReveal: (id: string) => void;
    /** The Schematic's words. */
    readonly words: SchematicWords;
    /** The item kinds read by area, which the tab reads itself; `undefined` with none. */
    readonly area?: SchematicIndexAreaProps | undefined;
}

/**
 * The Index's reads of the item kinds read by area (#1393, D52), in a
 * component of its own: each page and each count that lands re-runs it alone,
 * and it hands the tab what it read only as that moves — its last standing
 * while a read is in flight.
 *
 * @param props - The kinds, the zones open, the search as it reads, and where what it read goes
 * @returns Nothing: it reads
 */
function IndexAreaReader({ area, open, query, onRead }: {
    readonly area: SchematicIndexAreaProps; readonly open: readonly DrawnZone[]; readonly query: string; readonly onRead: (read: IndexAreaRead) => void;
}): null {
    const parts = useMemo(() => area.kinds.map((kind) => kind.part.key), [area.kinds]);
    useSlicesReactivity(parts);
    const read = useCallback(() => area.reader.read(area.kinds, open, query), [area, open, query]);
    const { result } = useTrackedEvaluation(read);
    const got = result.ok && result.value !== READING ? result.value : undefined;
    useEffect(() => { if (got !== undefined) onRead(got); }, [got, onRead]);
    return null;
}

/**
 * The Index tab's body — see the module docs.
 *
 * @param props - The zones and items drawn, the kinds' names, the zone in view, the selection, what a row's click does and the words
 * @returns The tab's body: its search over its tree
 */
export function SchematicIndexTab({ zones, items, kindName, inView, selected, onReveal, words, area }: SchematicIndexTabProps) {
    const styles = useSlotRecipe({ key: "schematic" })() as unknown as Styles;
    const library = useSlotRecipe({ key: "library" })() as unknown as Styles;
    const m = words.m;
    const treeId = useId();
    const [open, setOpen] = useState<ReadonlySet<string>>(() => new Set());
    const [query, setQuery] = useState("");
    const searchRef = useRef<HTMLInputElement | null>(null);
    // The kinds read by area (#1393, D52): read by the tab — the open zones' items, or the search's, a pause after its
    // last keystroke — in place of their window's.
    const areaSlots = useMemo(() => new Set(area?.kinds.map((kind) => kind.kind.key) ?? []), [area]);
    const [areaRead, setAreaRead] = useState<IndexAreaRead>(NO_INDEX_AREA);
    const [areaQuery, setAreaQuery] = useState("");
    useEffect(() => {
        const text = query.trim();
        if (text === "") { setAreaQuery(""); return undefined; }
        const timer = setTimeout(() => setAreaQuery(text), SEARCH_DELAY_MS);
        return () => clearTimeout(timer);
    }, [query]);
    const openZones = useMemo(() => zones.filter((zone) => open.has(zone.key)), [zones, open]);
    const listed = useMemo(() => (area === undefined ? items : [
        ...items.filter((item) => !areaSlots.has(item.ref.kind)),
        ...areaRead.items.filter((item) => { const layer = getSomeorUndefined(item.layer); return layer === undefined || !area.hiddenLayers.has(layer); }),
    ]), [area, items, areaSlots, areaRead]);
    const tree = useMemo(() => buildNavTree(zones, listed), [zones, listed]);
    // A zone holding items of a kind read by area counts them once its box — or an enclosing zone's — is read.
    const whole = useMemo(() => (area === undefined ? undefined : (key: string) => {
        for (let at: string | undefined = key; at !== undefined; at = tree.parentOf.get(at)) if (areaRead.read.has(at)) return true;
        return false;
    }), [area, tree, areaRead]);
    const rows = useMemo(() => indexRows(tree, open, query, kindName, words.locale, { searched: areaSlots, whole }),
        [tree, open, query, kindName, words.locale, areaSlots, whole]);
    // What the tree can't hold: the open zones too full to list a kind read by area's items, and the matches past those listed.
    const notes = useMemo(() => {
        const out: string[] = [];
        if (area === undefined) return out;
        const noun = area.kinds.length === 1 ? area.kinds[0]!.kind.name.toLocaleLowerCase(words.locale) : m.libraryNoun({ tab: "backlog", n: 1 });
        for (const zone of openZones) {
            if (!areaRead.crowded.has(zone.key)) continue;
            out.push(m.indexCrowded({ zone: zone.label, name: noun, n: SCHEMATIC_WINDOW_READ_ROWS, count: words.number(SCHEMATIC_WINDOW_READ_ROWS) }));
        }
        if (query.trim() !== "" && areaRead.more > 0) out.push(m.indexMore({ n: areaRead.more, count: words.number(areaRead.more) }));
        return out;
    }, [area, openZones, areaRead, query, m, words]);
    // The active row, the one the tree points at: the one last moved to or clicked while it is listed, else the first.
    const [active, setActive] = useState<string | undefined>(undefined);
    const found = active === undefined ? -1 : rows.findIndex((row) => stringEqual(rowKey(row), active));
    const activeIndex = found >= 0 ? found : rows.length > 0 ? 0 : undefined;
    // A key's move brings its row into view: a request for each move.
    const [shown, setShown] = useState<{ index: number; nonce: number } | undefined>(undefined);
    const rowId = useCallback((index: number) => `${treeId}-row-${index}`, [treeId]);

    const setZone = useCallback((key: string, next: boolean) => {
        setOpen((was) => {
            if (was.has(key) === next) return was;
            const out = new Set(was);
            if (next) out.add(key); else out.delete(key);
            return out;
        });
    }, []);
    // A row's click: a zone flies, is selected and opens; an item flies and is selected.
    const activate = useCallback((row: IndexRow) => {
        setActive(rowKey(row));
        if (row.kind === "zone") setZone(row.zone.key, true);
        onReveal(rowKey(row));
    }, [setZone, onReveal]);
    const moveTo = useCallback((index: number) => {
        const row = rows[index];
        if (row === undefined) return;
        setActive(rowKey(row));
        setShown((was) => ({ index, nonce: (was?.nonce ?? 0) + 1 }));
    }, [rows]);
    // Each key the tree acts on goes no further than the Schematic (#1398).
    const onKeyDown = useCallback((e: KeyboardEvent<HTMLDivElement>) => {
        if (activeIndex === undefined) return;
        const row = rows[activeIndex]!;
        const go = (to: number) => {
            if (rows[to] === undefined) return;
            takeKey(e);
            moveTo(to);
        };
        if (e.key === "ArrowDown") go(activeIndex + 1);
        else if (e.key === "ArrowUp") go(activeIndex - 1);
        else if (e.key === "Home") go(0);
        else if (e.key === "End") go(rows.length - 1);
        else if (e.key === "ArrowRight" && row.kind === "zone" && row.branch) {
            takeKey(e);
            if (!row.open) setZone(row.zone.key, true); else go(activeIndex + 1);
        } else if (e.key === "ArrowLeft") {
            takeKey(e);
            if (row.kind === "zone" && row.open && row.branch && query === "") { setZone(row.zone.key, false); return; }
            // Up to the zone it is in: the nearest row above, one level up.
            for (let i = activeIndex - 1; i >= 0; i--) {
                const above = rows[i]!;
                if (above.kind === "zone" && above.depth < row.depth) { moveTo(i); return; }
            }
        } else if (e.key === "Enter" || e.key === " ") {
            takeKey(e);
            activate(row);
        }
    }, [rows, activeIndex, moveTo, setZone, activate, query]);
    const getItemKey = useCallback((index: number) => rowKey(rows[index]!), [rows]);

    const renderRow = (index: number) => {
        const row = rows[index]!;
        const key = rowKey(row);
        const common = {
            id: rowId(index),
            role: "treeitem",
            "aria-level": row.depth + 1,
            "aria-posinset": row.position,
            "aria-setsize": row.siblings,
            "data-index-key": key,
            onClick: () => activate(row),
            style: depthStyle(row.depth),
            ...(index === activeIndex ? { "data-active": "" } : {}),
            ...(selected.has(key) ? { "data-selected": "", "aria-selected": true } : { "aria-selected": false }),
        } as const;
        if (row.kind === "zone") {
            const current = inView !== undefined && stringEqual(inView, key);
            return (
                <Box css={styles.indexRow} {...common} data-index-zone="" aria-expanded={row.branch ? row.open : undefined}
                    {...(current ? { "data-current": "", "aria-current": "location" } : {})}>
                    {/* The pointer's way to open it; the keys' is → and ←. */}
                    <chakra.button type="button" css={styles.indexChevron} tabIndex={-1} aria-hidden="true" title={m.indexToggle({ zone: row.zone.label, open: row.open })}
                        {...(row.open ? { "data-open": "" } : {})} {...(row.branch ? {} : { "data-leaf": "" })}
                        onMouseDown={keepFocus}
                        onClick={(e: MouseEvent) => { e.stopPropagation(); setActive(key); setZone(row.zone.key, !row.open); }}>
                        <FontAwesomeIcon icon={faAngleRight} />
                    </chakra.button>
                    <Box as="span" css={styles.indexName} data-index-name="">{row.zone.label}</Box>
                    {row.count !== undefined && row.count > 0 && (
                        <Box as="span" css={styles.indexCount} data-index-count="" aria-label={m.indexCount({ n: row.count, count: words.number(row.count) })}>{words.number(row.count)}</Box>
                    )}
                </Box>
            );
        }
        const metric = getSomeorUndefined(row.item.metric);
        const status = getSomeorUndefined(row.item.status);
        return (
            <Box css={styles.indexRow} {...common} data-index-item="">
                <Box as="span" css={styles.indexChevron} data-leaf="" aria-hidden="true" />
                <Box as="span" css={styles.indexDot} {...tintAttributes(itemTint(row.item))} {...(status?.ring === true ? { "data-ring": "" } : {})} aria-hidden="true" />
                <Box as="span" css={styles.indexName} data-index-name="">{row.item.label}</Box>
                {metric !== undefined && <Box as="span" css={styles.indexMetric}>{metric}</Box>}
            </Box>
        );
    };

    const reader = area === undefined ? null : <IndexAreaReader area={area} open={openZones} query={areaQuery} onRead={setAreaRead} />;
    if (zones.length === 0 && items.length === 0 && area === undefined) {
        return <Box css={styles.indexEmpty}><LibraryEmptyState said={{ title: m.libraryEmpty({ tab: "index", name: "" }), description: m.libraryEmptyHint({ tab: "index", name: "" }) }} onClear={undefined} /></Box>;
    }
    return (
        <>
            {reader}
            <Box css={styles.indexSearch}>
                <LibrarySearchBox size="mid" inputRef={searchRef} query={query} onQuery={setQuery} placeholder={m.indexSearch()} label={m.indexSearch()} />
            </Box>
            {rows.length === 0 ? (
                <Box css={styles.indexEmpty}><LibraryEmptyState said={{ title: m.indexNoMatch({ query: query.trim() }) }} onClear={undefined} /></Box>
            ) : (
                // The tree takes the focus around its rows' scroll box, never inside it: a focus — the keyboard's, or one a
                // menu hands back — scrolls nothing of the rows.
                <Box css={styles.indexTree} role="tree" aria-label={m.libraryTab({ tab: "index" })} tabIndex={0} onKeyDown={onKeyDown}
                    {...(activeIndex === undefined ? {} : { "aria-activedescendant": rowId(activeIndex) })}>
                    <VirtualRows fillParent height={undefined} maxHeight={undefined} rootCss={styles.indexRows}
                        count={rows.length} getItemKey={getItemKey} estimateSize={() => ROW_ESTIMATE}
                        scrollToIndex={shown?.index} scrollNonce={shown?.nonce} scrollAlign="auto" renderRow={renderRow} />
                </Box>
            )}
            {notes.length > 0 && (
                <Box css={library.footer} data-index-notes="">
                    {notes.map((note) => <Box key={note} as="span" css={library.hiddenNote} data-index-note="">{note}</Box>)}
                </Box>
            )}
        </>
    );
}
