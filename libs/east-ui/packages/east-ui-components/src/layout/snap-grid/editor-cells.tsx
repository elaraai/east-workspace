/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

/**
 * The SnapGrid editing canvas's drop cells (#990): each row a continuous cell
 * that names where a drag rests — beside a tile, or a new row above or below
 * it — a gap cell above each row, and the end zone under the last; and the
 * brand line with its "+" badge, which they and the tiles draw where a drop
 * would land. The canvas (`./editor.tsx`) lays them out, marks what a drag
 * resting over one would do, and reads back where a drop lands.
 *
 * @packageDocumentation
 */

import { memo, useCallback, useMemo, useRef, type MutableRefObject, type ReactNode } from "react";
import { Box, type SystemStyleObject } from "@chakra-ui/react";
import { FontAwesomeIcon } from "@fortawesome/react-fontawesome";
import { faCaretDown, faPlus } from "@fortawesome/free-solid-svg-icons";
import { useDropCell, type DragPayload, type DropCellOptions, type DropVeto } from "../../dnd/drag-layer";
import type { SnapGridWords } from "./messages.js";
import { SNAP_GRID_COLUMNS, dropAt, joinStops, type SnapGridBox, type SnapGridDrop, type SnapGridRowModel } from "./model.js";

/** The canvas's slot styles, by slot. */
export type SnapGridStyles = Record<string, SystemStyleObject>;

/** Where a drag last rested over a row — the drop a row coordinate names, read back at the drop. */
export interface Resting {
    /** The coordinate's row key. */
    row: string;
    /** The coordinate's slot — the pointed column. */
    slot: string;
    /** Where it lands. */
    drop: SnapGridDrop;
}

/** Marks what a drag resting over a cell would do — drawn by CSS, set without a render. */
export type Hover = (el: HTMLElement | null, drop: SnapGridDrop, payload: DragPayload) => void;

/**
 * The tiles of a row element — its direct tile children, in order.
 *
 * @param row - The row's element
 * @returns Its tiles' elements
 */
export function tilesIn(row: Element): HTMLElement[] {
    return [...row.children].filter((el): el is HTMLElement => el instanceof HTMLElement && el.hasAttribute("data-snap-grid-tile"));
}

/**
 * A box, as the model reads one.
 *
 * @param el - The element
 * @returns Its box in client px
 */
export function boxOf(el: Element): SnapGridBox {
    const r = el.getBoundingClientRect();
    return { left: r.left, top: r.top, width: r.width, height: r.height };
}

/**
 * A row's gap between columns in client px — its CSS gap through the canvas's zoom.
 *
 * @param row - The row's element
 * @param box - Its box
 * @returns The gap
 */
export function clientGap(row: HTMLElement, box: SnapGridBox): number {
    const scale = row.offsetWidth > 0 ? box.width / row.offsetWidth : 1;
    return (Number.parseFloat(getComputedStyle(row).columnGap) || 0) * scale;
}

/**
 * A brand line with the "+" badge on it.
 *
 * @param props - Its slot's style, the canvas's styles, and which line it is: a tile's insert, or a gap's
 * @returns The line
 */
export function InsertLine({ css, styles, attr }: { css: SystemStyleObject | undefined; styles: SnapGridStyles; attr: "insert" | "gap" }) {
    return (
        <Box css={css} aria-hidden {...(attr === "insert" ? { "data-snap-grid-insert-line": "" } : { "data-snap-grid-gap-line": "" })}>
            <Box as="span" css={styles.rule} />
            <Box as="span" css={styles.badge}><FontAwesomeIcon icon={faPlus} /></Box>
            <Box as="span" css={styles.rule} />
        </Box>
    );
}

interface RowProps {
    row: SnapGridRowModel;
    index: number;
    surface: string;
    veto: DropVeto;
    styles: SnapGridStyles;
    words: SnapGridWords;
    resting: MutableRefObject<Resting | undefined>;
    hover: Hover;
    /** A height drag's snapped edge in this row, in px from its top. */
    guide: number | undefined;
    children: ReactNode;
}

/** A row: a continuous cell naming, where a drag rests, a place beside a tile or a new row above or below. */
export const SnapGridRowCell = memo(function SnapGridRowCell(p: RowProps) {
    const { row, index, surface, resting, words, hover } = p;
    const el = useRef<HTMLElement | null>(null);
    const coord = useMemo(() => ({ surface, row: row.key, slot: "1" }), [surface, row.key]);
    const resolve = useCallback((x: number, y: number) => {
        const node = el.current;
        if (node === null) return coord;
        const box = boxOf(node);
        const drop = dropAt(index, box, tilesIn(node).map(boxOf), x, y);
        if (drop.kind === "gap") return { surface, row: "", slot: String(drop.at) };
        const gap = clientGap(node, box);
        const column = (box.width - (SNAP_GRID_COLUMNS - 1) * gap) / SNAP_GRID_COLUMNS;
        const pointed = Math.min(SNAP_GRID_COLUMNS, Math.max(1, Math.floor((x - box.left) / (column + gap)) + 1));
        const at = { surface, row: row.key, slot: String(pointed) };
        resting.current = { row: at.row, slot: at.slot, drop };
        return at;
    }, [coord, surface, row.key, index, resting]);
    const options = useMemo<DropCellOptions>(() => ({
        // A keyboard drag rests before each tile and after the last.
        stops: () => {
            const node = el.current;
            if (node === null) return [];
            return joinStops(tilesIn(node).map(boxOf), clientGap(node, boxOf(node)));
        },
        name: (at) => {
            if (at.row === "") return words.m.newRow({ row: words.number(Number(at.slot) + 1) });
            const drop = resting.current?.drop;
            const beside = drop?.kind === "join" ? row.tiles[drop.pos] : undefined;
            return beside !== undefined
                ? words.m.besideTile({ label: beside.label, row: words.number(index + 1) })
                : words.m.rowEnd({ row: words.number(index + 1) });
        },
        onHover: (x, y, payload) => {
            const node = el.current;
            if (node === null) return;
            const drop = dropAt(index, boxOf(node), tilesIn(node).map(boxOf), x, y);
            hover(node, drop, payload);
        },
    }), [words, resting, row.tiles, index, hover]);
    const dropRef = useDropCell(coord, false, p.veto, resolve, options);
    const ref = useCallback((node: HTMLElement | null) => {
        el.current = node;
        dropRef(node);
    }, [dropRef]);
    return (
        <Box ref={ref} css={p.styles.row} data-snap-grid-row={row.key} data-snap-grid-row-index={index}>
            <InsertLine css={p.styles.edgeBefore} styles={p.styles} attr="gap" />
            <InsertLine css={p.styles.edgeAfter} styles={p.styles} attr="gap" />
            {p.guide !== undefined && <Box css={p.styles.guide} style={{ top: `${p.guide}px` }} aria-hidden data-snap-grid-guide="" />}
            {p.children}
        </Box>
    );
});

interface GapProps {
    /** The gap's index: `0` above the first row, the row count below the last. */
    index: number;
    first: boolean;
    /** The end zone — the gap below the last row. */
    end: boolean;
    surface: string;
    veto: DropVeto;
    styles: SnapGridStyles;
    words: SnapGridWords;
    hover: Hover;
}

/** A gap between rows, or the end zone below them: a drop there makes a new row. */
export const SnapGridGapCell = memo(function SnapGridGapCell(p: GapProps) {
    const { index, surface, words, hover, styles } = p;
    const el = useRef<HTMLElement | null>(null);
    const coord = useMemo(() => ({ surface, row: "", slot: String(index) }), [surface, index]);
    const options = useMemo<DropCellOptions>(() => ({
        name: () => words.m.newRow({ row: words.number(index + 1) }),
        onHover: (_x, _y, payload) => hover(el.current, { kind: "gap", at: index }, payload),
    }), [words, index, hover]);
    const dropRef = useDropCell(coord, false, p.veto, undefined, options);
    const ref = useCallback((node: HTMLElement | null) => {
        el.current = node;
        dropRef(node);
    }, [dropRef]);
    if (p.end) {
        return (
            <Box ref={ref} css={styles.endZone} data-snap-grid-end="" data-snap-grid-gap={index}>
                <Box css={styles.endZoneBox}>
                    <Box as="span" css={styles.endZoneRest}>{words.m.endZoneRest()}</Box>
                    {/* Where a drop lands, pointed at by Font Awesome's caret (#1263). */}
                    <Box as="span" css={styles.endZoneDragging}><FontAwesomeIcon icon={faCaretDown} />{words.m.endZoneDragging()}</Box>
                    <Box as="span" css={styles.endZoneTarget}><FontAwesomeIcon icon={faCaretDown} />{words.m.endZoneTarget()}</Box>
                </Box>
            </Box>
        );
    }
    return (
        <Box ref={ref} css={styles.gap} data-first={p.first ? "" : undefined} data-snap-grid-gap={index}>
            <InsertLine css={styles.gapLine} styles={styles} attr="gap" />
        </Box>
    );
});
