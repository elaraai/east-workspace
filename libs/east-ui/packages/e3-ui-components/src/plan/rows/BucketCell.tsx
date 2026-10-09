/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

/**
 * A bucket cell (#1267): its lane caption, its tiles and its marker — the
 * tiles folded to the room the caption leaves them, their own box's (#1266).
 * A cell with more than one tile shows the tiles that fit, in their order and
 * each drawn whole, then a `+n` chip that counts the rest: a button whose
 * anchored menu lists them by name. A pick selects the tile, as its click does
 * (#1197), and opens its popover where the root declares one (#816).
 *
 * The cell keeps a tile on its run — the selected one, the one whose popover
 * is open, or the one just picked — so the tile is there to act on, its ring
 * drawn and its popover anchored to it ({@link fitTiles}): shrunk to its floor
 * beside the chip if need be, or alone while the chip waits. A focused tile
 * that folds hands the focus to the chip.
 *
 * The fold is chosen before the browser paints, from widths the cell measured
 * with every tile drawn whole beside a stand-in chip, as a docked pane's tab
 * row folds its tabs (#1210): when the cell mounts, when its tiles change,
 * when fonts arrive, and when its room changes — taken in the ResizeObserver's
 * delivery, as the shared toolbar takes one, so no frame paints a fold the
 * cell does not rest on. While it measures again the chip keeps the last fold,
 * so an open menu stays open (#1235). A context strip's cell (R2) never folds.
 *
 * A cell with no room for one tile, its padding given way (#1276), draws none
 * of them: its chip alone, across the whole cell (`data-no-room`), lists every
 * tile, and a pick does what the tile's click does — its popover, the tile
 * having no box, hangs from the chip.
 *
 * The renderer sets data attributes and nothing else: `data-tile-measure` on
 * the tiles' box while it measures, `data-folded` on a folded tile,
 * `data-tile-more` on the chip, `data-tile-more-count` on its count,
 * `data-cramped` on a chip wider than the room, which shrinks to it and draws
 * no count, and `data-no-room` on a chip a cell with no room for a tile draws
 * across itself. Its styles are the Plan recipe's.
 *
 * @packageDocumentation
 */

import {
    useCallback, useContext, useEffect, useLayoutEffect, useRef, useState, useSyncExternalStore, type MouseEvent, type ReactNode,
} from "react";
import { flushSync } from "react-dom";
import { Box, Menu as ChakraMenu, Portal, chakra } from "@chakra-ui/react";
import { usePlanGeometry } from "../context.js";
import { PlanControllerContext } from "../controller/react.js";
import { rowKeyOf } from "../row-key.js";
import type { PlanWords } from "../words.js";
import { fitTiles, type TileCellMeasure } from "./tile-fold.js";

type Styles = Record<string, Record<string, unknown>>;

/** One tile of a cell: its key, its accessible name, and the tile itself, drawn folded or not. */
export interface BucketCellTile {
    /** Its event's key — the tile's `data-event`. */
    readonly key: string;
    /** Its accessible name — what the chip's menu lists it by (#819). */
    readonly name: string;
    /** The tile, folded or not. */
    readonly draw: (folded: boolean) => ReactNode;
}

/** Props of {@link BucketCell}. */
export interface BucketCellProps {
    /** The Plan recipe's styles. */
    readonly styles: Styles;
    /** The row the cell is in, by its key — where an open popover's tile is looked for. */
    readonly rowKey: string;
    /** The cell's key — its `data-plan-cell`. */
    readonly cellKey: string;
    /** Where the cell sits: its left, width, top and height. */
    readonly place: Readonly<Record<string, string>>;
    /** Its marker's status — the ring — when it has one. */
    readonly over: string | undefined;
    /** Its lane caption, drawn first. */
    readonly caption: ReactNode;
    /** Its tiles, in order. */
    readonly tiles: readonly BucketCellTile[];
    /** Its marker's corner icon, drawn last. */
    readonly marker: ReactNode;
    /** Whether the cell folds: it holds a tile, and is not a context strip's. */
    readonly folds: boolean;
    /** The bucket's left edge, as a fraction of the window — the chip's place in the row's walk. */
    readonly frac: number;
    /** The bucket, in words — the chip's name says where it is. */
    readonly bucket: string;
    /** The cell's lane, in words, when it has one. */
    readonly lane: string | undefined;
    /** The canvas's words. */
    readonly words: PlanWords;
    /** A click on the cell itself: its row selected. */
    readonly onClick: () => void;
    /** A signature of what sizes the tiles — each one's key and what it draws; the cell measures again when it changes. */
    readonly signature: string;
}

const noSubscribe = () => () => undefined;

/**
 * A bucket cell — see the module docs.
 *
 * @param props - The cell's place, its caption, tiles and marker, whether it folds, and its words
 * @returns The cell
 */
export function BucketCell(props: BucketCellProps) {
    const { styles, rowKey, cellKey, place, over, caption, tiles, marker, folds, frac, bucket, lane, words, onClick, signature } = props;
    const geometry = usePlanGeometry();
    const boxRef = useRef<HTMLDivElement | null>(null);
    const chipRef = useRef<HTMLButtonElement | null>(null);

    // ── The tile the cell keeps (see the module docs) ──
    // Only this cell's own fact: a selection or a popover elsewhere renders nothing here.
    const controller = useContext(PlanControllerContext);
    const held = useSyncExternalStore(controller?.subscribe ?? noSubscribe, () => {
        if (controller === null) return undefined;
        const snap = controller.getSnapshot();
        const selected = tiles.find((tile) => snap.store.ui.elements.includes(tile.key));
        if (selected !== undefined) return selected.key;
        const open = snap.overlay.popover?.ref;
        return open !== undefined && open.type === "event" && rowKeyOf(open.value.row) === rowKey
            ? tiles.find((tile) => tile.key === open.value.event)?.key
            : undefined;
    });
    const [picked, setPicked] = useState<string | undefined>(undefined);
    const keptKey = held ?? picked;
    const keptIndex = keptKey === undefined ? -1 : tiles.findIndex((tile) => tile.key === keptKey);

    // ── The fold, measured before paint ──
    const [measuring, setMeasuring] = useState(folds);
    // What the cell measured, and its own width: a chip it draws across itself has that room (#1276).
    const [measure, setMeasure] = useState<(TileCellMeasure & { readonly cell: number }) | undefined>(undefined);
    // Other tiles, or a cell that folds again, measure again.
    useLayoutEffect(() => { if (folds) setMeasuring(true); }, [signature, folds]);
    // So does a change of the room, before the cell paints at it. The box is
    // as wide as the cell leaves it, whatever it holds, so folding never
    // changes what it observes.
    useLayoutEffect(() => {
        const box = boxRef.current;
        if (!folds || box === null || typeof ResizeObserver === "undefined") return undefined;
        let room = box.getBoundingClientRect().width;
        const ro = new ResizeObserver(() => {
            const now = box.getBoundingClientRect().width;
            if (Math.abs(now - room) < 0.01) return;
            room = now;
            flushSync(() => setMeasuring(true));
        });
        ro.observe(box);
        return () => ro.disconnect();
    }, [folds]);
    // Fonts arriving change the tiles' widths, not the room.
    useEffect(() => {
        const fonts = typeof document === "undefined" ? undefined : document.fonts;
        if (!folds || fonts === undefined) return undefined;
        const again = () => setMeasuring(true);
        fonts.addEventListener("loadingdone", again);
        return () => fonts.removeEventListener("loadingdone", again);
    }, [folds]);
    useLayoutEffect(() => {
        const box = boxRef.current;
        if (!folds || !measuring || box === null) return;
        const width = (el: Element | null) => (el === null ? 0 : el.getBoundingClientRect().width);
        const gap = Number.parseFloat(getComputedStyle(box).columnGap) || 0;
        // The room is the box's own width, measured, never rounded: a tile a
        // fraction too wide for it would ellipsize its label.
        const room = width(box);
        setMeasure({
            room,
            tiles: [...box.querySelectorAll(":scope > [data-event]")].map(width),
            gap,
            more: width(box.querySelector(":scope > [data-tile-more-measure]")) + gap,
            floor: Math.min(geometry.tileMinWidth, room),
            least: geometry.tileLeastWidth,
            cell: width(box.parentElement),
        });
        setMeasuring(false);
    }, [measuring, folds, signature, geometry.tileMinWidth, geometry.tileLeastWidth]);
    // The fold the last measure gave; the cell draws every tile whole while it
    // measures again, and the chip keeps that fold meanwhile, so an open menu
    // stays open (#1235).
    const measured = !folds || measure === undefined || measure.tiles.length !== tiles.length
        ? undefined
        : fitTiles(measure, keptIndex >= 0 ? keptIndex : undefined);
    const shown = measuring || measured === undefined ? undefined : new Set(measured.shown);
    const folded = measured === undefined || !measured.chip ? [] : tiles.filter((_, i) => !measured.shown.includes(i));
    // A room narrower than the chip itself cramps it: it shrinks to the room, its count off its line, its name
    // still saying what it holds — as a tile's parts go (#1266). Drawn across a cell with no room for a tile, its
    // room is the cell's (#1276).
    const noRoom = measured?.noRoom === true;
    const cramped = measure !== undefined && measure.more - measure.gap > (noRoom ? measure.cell : measure.room) + 0.01;

    // A focused tile that folds hands the focus to the chip, which holds it now.
    useLayoutEffect(() => {
        const box = boxRef.current;
        const at = typeof document === "undefined" ? null : document.activeElement;
        if (box === null || !(at instanceof HTMLElement) || at.parentElement !== box || !at.hasAttribute("data-folded")) return;
        chipRef.current?.focus({ preventScroll: true });
    });

    // ── A pick: the tile kept on the run, then focused and clicked as a viewer would ──
    // The menu hands focus back to its chip in a microtask after the pick; the
    // tile's focus and click come a frame later, so the popover it opens
    // anchors to it and keeps the focus there. The selection or the open
    // popover keeps it from then on — each in the store by the time the click
    // returns — and the cell answers before that frame paints: a tile nothing
    // keeps, a series' whose click selects its row, folds again at once, so it
    // never shows alone for a frame.
    const pick = useCallback((key: string) => {
        setPicked(key);
        requestAnimationFrame(() => {
            const tile = [...(boxRef.current?.querySelectorAll<HTMLElement>(":scope > [data-event]") ?? [])]
                .find((el) => el.getAttribute("data-event") === key);
            tile?.focus({ preventScroll: true });
            tile?.click();
            flushSync(() => setPicked(undefined));
        });
    }, []);
    // A click on the chip opens its menu; the cell's own click — its row selected — is not its.
    const stop = useCallback((e: MouseEvent) => e.stopPropagation(), []);

    return (
        <Box css={styles.cell}
            data-plan-cell={cellKey}
            data-over={over}
            {...place}
            onClick={onClick}
        >
            {caption}
            {/* The tiles, in the room the caption leaves them: a tile's floor is that room's (#1266). */}
            <Box ref={boxRef} css={styles.cellTiles} data-plan-cell-tiles=""
                data-tile-measure={folds && measuring ? "" : undefined}>
                {tiles.map((tile, i) => tile.draw(shown !== undefined && !shown.has(i)))}
                {folds && measuring && (
                    // The chip's stand-in, measured beside the tiles drawn whole: beside the
                    // chip, never in its place, so an open menu stays open (#1235).
                    <Box as="span" css={styles.tileMore} data-tile-more-measure="" aria-hidden>
                        <span data-tile-more-count="">{words.m.tileMore({ n: tiles.length, count: words.number(tiles.length) })}</span>
                    </Box>
                )}
                {folded.length > 0 && (
                    <ChakraMenu.Root positioning={{ placement: "bottom-start" }} onSelect={(detail) => pick(detail.value)}>
                        <ChakraMenu.Trigger asChild>
                            <chakra.button ref={chipRef} type="button" css={styles.tileMore} data-tile-more=""
                                data-cramped={cramped ? "" : undefined}
                                data-no-room={noRoom ? "" : undefined}
                                // In the row's walk where the tiles it folds would be (#819).
                                data-plan-frac={frac.toFixed(4)} tabIndex={-1}
                                aria-label={words.m.tileMoreLabel({ n: folded.length, count: words.number(folded.length), bucket, lane })}
                                onClick={stop}>
                                <span data-tile-more-count="">{words.m.tileMore({ n: folded.length, count: words.number(folded.length) })}</span>
                            </chakra.button>
                        </ChakraMenu.Trigger>
                        <Portal>
                            <ChakraMenu.Positioner>
                                <ChakraMenu.Content data-tile-more-menu="">
                                    {folded.map((tile) => <ChakraMenu.Item key={tile.key} value={tile.key}>{tile.name}</ChakraMenu.Item>)}
                                </ChakraMenu.Content>
                            </ChakraMenu.Positioner>
                        </Portal>
                    </ChakraMenu.Root>
                )}
            </Box>
            {marker}
        </Box>
    );
}
