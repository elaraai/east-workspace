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
 * - **One zone open at a time** — with every zone it is in, so its path
 *   shows: opening another closes it, as the navigator did before the frame
 *   (#1389). A zone's chevron opens or closes it; a click on its row flies to
 *   the zone and selects it, and opens it — or, open, closes it. Its count is
 *   the items it holds, its nested zones' among them.
 * - **It follows the view** — the zone the viewport is in is marked, opened
 *   and scrolled to the tree's top once the camera rests, never during a fly
 *   (#1570): a zone's row clicked keeps its zone open as the camera flies
 *   there, the zone the view left marked until it lands. A zone closed while
 *   the view is in it stays closed until the view moves on — to another zone,
 *   or to Fit — and at Fit, no zone in view, the zone the view opened closes.
 * - **The open zone's row sticks** at the tree's top while its items and the
 *   zones it holds scroll under it, until the next row past them pushes it out
 *   (`indexSections` over the shared rows' `sections`); a click on it closes
 *   it. Every row anchors the list, so rows landing or folding above the view
 *   never move what it shows (#1570).
 * - **It never opens empty** — a zone opened whose items of a kind read by
 *   area are not read yet leaves the tree as it was, busy, until they land,
 *   then opens with them in one commit; a read that fails holds it no longer
 *   (#1570).
 * - **An item's row** — its dot in its colour, its status's where it has one
 *   (for a kind read by area, from its details, read beside it), its label and
 *   its figure; a click flies to the item and selects it. An entity on a
 *   locked layer is flown to and never selected (SC27): the canvas decides.
 * - **The search** keeps the items whose label, key or kind's name holds it,
 *   under their zones, opened: the tab's own, never the rail's.
 * - **A kind read by area** (#1393, D52) holds only its window, so the tab
 *   reads its items itself, in a component of its own (`index-area.ts`): an
 *   open zone's by the zone's box, and the search's through the kind's
 *   source's `search` fields, its first matches listed and how many more said
 *   under the tree. A zone holding such items counts them once its box is
 *   read, and one holding more than a window reads says so. What it read is
 *   as the record stores it, so the drafts are laid over it, as the canvas
 *   draws them: a row a draft holds is listed where its draft has it — moved,
 *   under the zone it now stands in — a row a gesture made is listed in its
 *   zone, and the search finds it as it finds a kind read whole's, and a row
 *   a draft deletes or unplaces is listed nowhere. Its items in no zone are the
 *   search's and the Backlog's alone. A row a Save landed is listed as the
 *   canvas draws it too, until the tab has read its kind since: the tab tells
 *   its host the revision it read each kind at (`onRead`).
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

import { useCallback, useEffect, useId, useLayoutEffect, useMemo, useRef, useState, type CSSProperties, type KeyboardEvent, type MouseEvent } from "react";
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
import { indexRows, indexSearchHolds, indexSections, type IndexRow } from "./index-tree.js";
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

/** Every row anchors the list: rows landing or folding above the view never move what it shows (#1570). */
const ANCHOR_EVERY_ROW = () => true;

/**
 * A zone and every zone it is in, by key.
 *
 * @param tree - The zones nested by containment: each zone's parent, by key
 * @param zone - The zone, by key; `undefined` for none
 * @returns The path, the zone first; empty for none
 */
function pathOf(tree: { readonly parentOf: ReadonlyMap<string, string> }, zone: string | undefined): ReadonlySet<string> {
    const path = new Set<string>();
    for (let at = zone; at !== undefined; at = tree.parentOf.get(at)) path.add(at);
    return path;
}

/** The item kinds read by area, as the Index reads them (#1393, D52). */
export interface SchematicIndexAreaProps {
    /** The kinds, each with its source of the slice and its area indexes. */
    readonly kinds: readonly IndexAreaKind[];
    /** Its reads, kept across renders. */
    readonly reader: SchematicIndexArea;
    /** The layers hidden, by key: the Index lists none of the items on them. */
    readonly hiddenLayers: ReadonlySet<string>;
    /**
     * The rows of those kinds a draft holds, by id: each is listed as the canvas draws it — moved, edited or made — never
     * as its record stores it, and none a draft deletes or unplaces.
     */
    readonly drafted: ReadonlySet<string>;
    /** Of them, those a gesture made: no source holds them, so the search finds them as it finds a kind read whole's. */
    readonly created: ReadonlySet<string>;
    /**
     * Hears the revision the tab read each of those kinds at, by slot, as it moves — none once the tab is gone: what a
     * Save landed of a kind is drawn until the tab has read it since (`drafted.ts`' `landedRead`).
     */
    readonly onRead?: ((revisions: ReadonlyMap<string, string>) => void) | undefined;
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

/** No kind read by the tab: what it tells its host once it is gone. */
const NO_REVISIONS: ReadonlyMap<string, string> = new Map();

/**
 * The Index's reads of the item kinds read by area (#1393, D52), in a
 * component of its own: each page and each count that lands re-runs it alone,
 * and it hands the tab what it read only as that moves — its last standing
 * while a read is in flight.
 *
 * @param props - The kinds, the zones open, the search as it reads, where what it read goes, and whom a failed read is told
 * @returns Nothing: it reads
 */
function IndexAreaReader({ area, open, query, onRead, onFailed }: {
    readonly area: SchematicIndexAreaProps; readonly open: readonly DrawnZone[]; readonly query: string; readonly onRead: (read: IndexAreaRead) => void;
    readonly onFailed: () => void;
}): null {
    const parts = useMemo(() => area.kinds.map((kind) => kind.part.key), [area.kinds]);
    useSlicesReactivity(parts);
    const read = useCallback(() => area.reader.read(area.kinds, open, query), [area, open, query]);
    const { result } = useTrackedEvaluation(read);
    const got = result.ok && result.value !== READING ? result.value : undefined;
    useEffect(() => { if (got !== undefined) onRead(got); }, [got, onRead]);
    // A read that fails holds the tree no longer: the zone opened shows what is read of it (#1570).
    const failed = !result.ok;
    useEffect(() => { if (failed) onFailed(); }, [failed, onFailed]);
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
    // The one zone open, every zone it is in open with it: a chain, never two.
    const [openZone, setOpenZone] = useState<string | undefined>(undefined);
    // The zone the tree shows open while the one opened is read — the last it showed (#1570) — and the zone opened whose
    // read failed, which the tree shows as it is read.
    const [heldZone, setHeldZone] = useState<string | undefined>(undefined);
    const [failedZone, setFailedZone] = useState<string | undefined>(undefined);
    // A zone the viewer closed: the view opens it again only once it has moved on — to another zone, or to Fit.
    const closedRef = useRef<string | undefined>(undefined);
    // The zone the view opened: Fit, no zone in view, closes it (#1570).
    const viewOpenedRef = useRef<string | undefined>(undefined);
    const [query, setQuery] = useState("");
    const searchRef = useRef<HTMLInputElement | null>(null);
    // The kinds read by area (#1393, D52): read by the tab — the open zones' items, or the search's, a pause after its
    // last keystroke — in place of their window's.
    const areaSlots = useMemo(() => new Set(area?.kinds.map((kind) => kind.kind.key) ?? []), [area]);
    const [areaRead, setAreaRead] = useState<IndexAreaRead>(NO_INDEX_AREA);
    const onAreaRead = useCallback((read: IndexAreaRead) => {
        setAreaRead(read);
        setFailedZone(undefined);
    }, []);
    const onAreaFailed = useCallback(() => setFailedZone(openZone), [openZone]);
    // The revision the tab's items were read at, kind by kind: a Save's rows are listed as landed until it moves past it.
    const onRevisions = area?.onRead;
    const revisions = areaRead.revisions;
    useEffect(() => { onRevisions?.(revisions); }, [onRevisions, revisions]);
    useEffect(() => () => onRevisions?.(NO_REVISIONS), [onRevisions]);
    const [areaQuery, setAreaQuery] = useState("");
    useEffect(() => {
        const text = query.trim();
        if (text === "") { setAreaQuery(""); return undefined; }
        const timer = setTimeout(() => setAreaQuery(text), SEARCH_DELAY_MS);
        return () => clearTimeout(timer);
    }, [query]);
    const searching = query.trim() !== "";
    const locale = words.locale;
    const listed = useMemo(() => {
        if (area === undefined) return items;
        // What the tab read of the kinds read by area, as their records store them — but a row a draft holds, listed as the
        // canvas draws it: moved or edited, a stored row the search found; made, one the search holds as a kind read whole's.
        const read = areaRead.items.filter((item) => {
            const layer = getSomeorUndefined(item.layer);
            return !area.drafted.has(item.key) && (layer === undefined || !area.hiddenLayers.has(layer));
        });
        const found = new Set(areaRead.items.map((item) => item.key));
        const drafted = items.filter((item) => areaSlots.has(item.ref.kind) && area.drafted.has(item.key)
            && (!searching || found.has(item.key) || (area.created.has(item.key) && indexSearchHolds(item, query, kindName, locale))));
        return [...items.filter((item) => !areaSlots.has(item.ref.kind)), ...read, ...drafted];
    }, [area, items, areaSlots, areaRead, searching, query, kindName, locale]);
    const tree = useMemo(() => {
        const built = buildNavTree(zones, listed);
        // A kind read by area's items in no zone are the search's and the Backlog's alone (D52).
        return area === undefined || searching ? built : { ...built, floor: built.floor.filter((item) => !areaSlots.has(item.ref.kind)) };
    }, [zones, listed, area, searching, areaSlots]);
    // The zone opened and every zone it is in: what the tab reads of the kinds read by area.
    const wanted = useMemo(() => pathOf(tree, openZone), [tree, openZone]);
    const wantedZones = useMemo(() => zones.filter((zone) => wanted.has(zone.key)), [zones, wanted]);
    // The tree opens it once what it lists of those kinds is read — each zone of its path read, or too full to list them —
    // so it never opens empty: until then it shows the zone it showed, busy (#1570).
    const settled = area === undefined || searching || openZone === undefined
        || (failedZone !== undefined && stringEqual(failedZone, openZone))
        || [...wanted].every((key) => areaRead.read.has(key) || areaRead.crowded.has(key));
    const displayed = settled ? openZone : heldZone;
    useLayoutEffect(() => { if (settled) setHeldZone(openZone); }, [settled, openZone]);
    // The zone shown open and every zone it is in.
    const open = useMemo(() => pathOf(tree, displayed), [tree, displayed]);
    const openZones = useMemo(() => zones.filter((zone) => open.has(zone.key)), [zones, open]);
    // A zone holding items of a kind read by area counts them once its box — or an enclosing zone's — is read.
    const whole = useMemo(() => (area === undefined ? undefined : (key: string) => {
        for (let at: string | undefined = key; at !== undefined; at = tree.parentOf.get(at)) if (areaRead.read.has(at)) return true;
        return false;
    }), [area, tree, areaRead]);
    const rows = useMemo(() => indexRows(tree, open, query, kindName, words.locale, { searched: areaSlots, whole }),
        [tree, open, query, kindName, words.locale, areaSlots, whole]);
    // The open zone's row heads the rows under it, sticking at the tree's top while they scroll (#1570); none while
    // searching, which opens every zone it keeps.
    const sections = useMemo(() => indexSections(rows, searching ? undefined : displayed), [rows, searching, displayed]);
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
    // A key's move brings its row into view, the least distance; the view's zone, to the tree's top: a request for each.
    const [shown, setShown] = useState<{ index: number; nonce: number; align: "auto" | "start" } | undefined>(undefined);
    const rowId = useCallback((index: number) => `${treeId}-row-${index}`, [treeId]);

    // Opening a zone closes the one open before, but for the zones it is in; closing one leaves the zone it is in open.
    const setZone = useCallback((key: string, next: boolean) => {
        if (next) {
            closedRef.current = undefined;
            setOpenZone(key);
            return;
        }
        closedRef.current = key;
        setOpenZone(tree.parentOf.get(key));
    }, [tree]);
    // The view's zone, told once the camera rests (#1570): opened and brought to the tree's top, unless the viewer closed it
    // while the view was in it. With none in view — at Fit — the zone the view opened closes, and one the viewer closed
    // opens again once the view comes back to it.
    const [followed, setFollowed] = useState<{ key: string; nonce: number } | undefined>(undefined);
    useEffect(() => {
        if (inView === undefined) {
            closedRef.current = undefined;
            const opened = viewOpenedRef.current;
            viewOpenedRef.current = undefined;
            if (opened !== undefined) setOpenZone((was) => (was !== undefined && stringEqual(was, opened) ? undefined : was));
            return;
        }
        if (closedRef.current !== undefined) {
            if (stringEqual(closedRef.current, inView)) return;
            closedRef.current = undefined;
        }
        viewOpenedRef.current = inView;
        setOpenZone(inView);
        setFollowed((was) => ({ key: inView, nonce: (was?.nonce ?? 0) + 1 }));
    }, [inView]);
    // A row's click: a zone flies, is selected and opens — or closes, open; an item flies and is selected.
    const activate = useCallback((row: IndexRow) => {
        setActive(rowKey(row));
        if (row.kind === "zone") setZone(row.zone.key, !row.open || query.trim() !== "");
        onReveal(rowKey(row));
    }, [setZone, onReveal, query]);
    const moveTo = useCallback((index: number) => {
        const row = rows[index];
        if (row === undefined) return;
        setActive(rowKey(row));
        setShown((was) => ({ index, nonce: (was?.nonce ?? 0) + 1, align: "auto" }));
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
    // The view's zone brought to the tree's top once the tree shows it open — its items read — in the commit that opens it,
    // so no frame paints it opened where the list stood (#1570); once each time the view comes to it, so the rows moving
    // after never pull the list back from where the viewer scrolled it.
    const scrolledRef = useRef(0);
    useLayoutEffect(() => {
        if (followed === undefined || scrolledRef.current === followed.nonce) return;
        if (displayed === undefined || !stringEqual(displayed, followed.key)) return;
        const index = rows.findIndex((row) => row.kind === "zone" && stringEqual(row.zone.key, followed.key));
        if (index < 0) return;
        scrolledRef.current = followed.nonce;
        setShown((was) => ({ index, nonce: (was?.nonce ?? 0) + 1, align: "start" }));
    }, [followed, rows, displayed]);

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
                <Box as="span" css={styles.indexDot} data-index-dot="" {...tintAttributes(itemTint(row.item))} {...(status?.ring === true ? { "data-ring": "" } : {})} aria-hidden="true" />
                <Box as="span" css={styles.indexName} data-index-name="">{row.item.label}</Box>
                {metric !== undefined && <Box as="span" css={styles.indexMetric} data-index-metric="">{metric}</Box>}
            </Box>
        );
    };

    const reader = area === undefined ? null : <IndexAreaReader area={area} open={wantedZones} query={areaQuery} onRead={onAreaRead} onFailed={onAreaFailed} />;
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
                    {...(activeIndex === undefined ? {} : { "aria-activedescendant": rowId(activeIndex) })} {...(settled ? {} : { "aria-busy": true })}>
                    <VirtualRows fillParent height={undefined} maxHeight={undefined} rootCss={styles.indexRows}
                        count={rows.length} getItemKey={getItemKey} estimateSize={() => ROW_ESTIMATE} anchorable={ANCHOR_EVERY_ROW} sections={sections}
                        scrollToIndex={shown?.index} scrollNonce={shown?.nonce} scrollAlign={shown?.align ?? "auto"} renderRow={renderRow} />
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
