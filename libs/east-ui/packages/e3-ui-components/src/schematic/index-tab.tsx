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
 * - **The keys** — the tree is one tab stop, pointing at its active row
 *   (`aria-activedescendant`, as the Sheet's grid does): ↑ and ↓ move between
 *   the rows, Home and End to the first and the last, → opens a zone or goes
 *   into it, ← closes it or goes up to its zone, and Enter or Space does a
 *   row's click — each move bringing its row into view.
 *
 * The rows are the shared virtual rows (`VirtualRows`): only those in view are
 * mounted, however many the drawing holds, and each says where it stands among
 * the rows beside it. Every style is the `schematic` recipe's; the search box
 * and the empty state are the Library's.
 *
 * @packageDocumentation
 */

import { useCallback, useId, useMemo, useRef, useState, type CSSProperties, type KeyboardEvent, type MouseEvent } from "react";
import { Box, chakra, useSlotRecipe } from "@chakra-ui/react";
import { FontAwesomeIcon } from "@fortawesome/react-fontawesome";
import { faAngleRight } from "@fortawesome/free-solid-svg-icons";
import { StringType, equalFor } from "@elaraai/east";
import { getSomeorUndefined } from "@elaraai/east-ui-components";
import { LibraryEmptyState, LibrarySearchBox, VirtualRows } from "@elaraai/east-ui-components/internal";
import type { DrawnItem, DrawnZone } from "./canvas/drawn.js";
import { buildNavTree } from "./canvas/model.js";
import { itemTint, tintAttributes } from "./canvas/tints.js";
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
}

/**
 * The Index tab's body — see the module docs.
 *
 * @param props - The zones and items drawn, the kinds' names, the zone in view, the selection, what a row's click does and the words
 * @returns The tab's body: its search over its tree
 */
export function SchematicIndexTab({ zones, items, kindName, inView, selected, onReveal, words }: SchematicIndexTabProps) {
    const styles = useSlotRecipe({ key: "schematic" })() as unknown as Styles;
    const m = words.m;
    const treeId = useId();
    const [open, setOpen] = useState<ReadonlySet<string>>(() => new Set());
    const [query, setQuery] = useState("");
    const searchRef = useRef<HTMLInputElement | null>(null);
    const tree = useMemo(() => buildNavTree(zones, items), [zones, items]);
    const rows = useMemo(() => indexRows(tree, open, query, kindName, words.locale), [tree, open, query, kindName, words.locale]);
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
    const onKeyDown = useCallback((e: KeyboardEvent<HTMLDivElement>) => {
        if (activeIndex === undefined) return;
        const row = rows[activeIndex]!;
        const go = (to: number) => {
            if (rows[to] === undefined) return;
            e.preventDefault();
            moveTo(to);
        };
        if (e.key === "ArrowDown") go(activeIndex + 1);
        else if (e.key === "ArrowUp") go(activeIndex - 1);
        else if (e.key === "Home") go(0);
        else if (e.key === "End") go(rows.length - 1);
        else if (e.key === "ArrowRight" && row.kind === "zone" && row.branch) {
            e.preventDefault();
            if (!row.open) setZone(row.zone.key, true); else go(activeIndex + 1);
        } else if (e.key === "ArrowLeft") {
            e.preventDefault();
            if (row.kind === "zone" && row.open && row.branch && query === "") { setZone(row.zone.key, false); return; }
            // Up to the zone it is in: the nearest row above, one level up.
            for (let i = activeIndex - 1; i >= 0; i--) {
                const above = rows[i]!;
                if (above.kind === "zone" && above.depth < row.depth) { moveTo(i); return; }
            }
        } else if (e.key === "Enter" || e.key === " ") {
            e.preventDefault();
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
                    {row.count > 0 && (
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

    if (zones.length === 0 && items.length === 0) {
        return <Box css={styles.indexEmpty}><LibraryEmptyState said={{ title: m.libraryEmpty({ tab: "index", name: "" }), description: m.libraryEmptyHint({ tab: "index", name: "" }) }} onClear={undefined} /></Box>;
    }
    return (
        <>
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
        </>
    );
}
