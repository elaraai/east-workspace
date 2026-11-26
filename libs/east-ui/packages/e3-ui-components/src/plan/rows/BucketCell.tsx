/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

/**
 * A bucket cell (#1267, #1735): a day of a lane, its tiles each at its slot —
 * the day whole, halves or quarters by how many it holds, from five three and
 * a `+n` in the last quarter (`bucket-slots.ts`) — and its marker. A lane's
 * caption is its gutter line's, never the cell's (#1680's review). The `+n`
 * chip is a button whose anchored menu lists the tiles it holds by name; a pick
 * selects the tile, as its click does (#1197), and opens its popover where the
 * root declares one (#816).
 *
 * The cell keeps a tile in a slot — the selected one, the one whose popover is
 * open, or the one just picked — so the tile is there to act on, its ring
 * drawn and its popover anchored to it; on a day of one slot it stands alone
 * while the chip waits. A focused tile that folds hands the focus to the chip.
 *
 * Where the tiles stand is arithmetic on the day's pitch, never a measure of
 * what they hold: the row places the cell and measures the pitch
 * (`BucketsRow`), and each slot is set inline in whole pixels. A day with no
 * room for one tile draws its lone tile as a mark across itself (#1710), or
 * several as their chip alone across it (#1276), which lists every tile; a pick
 * does what the tile's click does — its popover, the tile having no box, hangs
 * from the chip. Unmeasured (jsdom), a slot is placed by its share of the cell.
 * A context strip's tiles are marks that never fold: each its share of the day.
 *
 * The renderer sets data attributes and geometry alone: `data-folded` on a
 * folded tile, `data-tile-more` on the chip, `data-tile-more-count` on its
 * count, and `data-no-room` on a chip a cell with no room for a tile draws
 * across itself, or on the tiles' box whose lone tile draws as a mark across
 * the cell. Its styles are the Plan recipe's, each part a plain element of its
 * slot's class, made once a theme (`useSlotClass`, #1780).
 *
 * @packageDocumentation
 */

import {
    useCallback, useContext, useLayoutEffect, useRef, useState, useSyncExternalStore, type CSSProperties, type MouseEvent, type ReactNode,
} from "react";
import { flushSync } from "react-dom";
import { Menu as ChakraMenu } from "@chakra-ui/react";
import { FrameMenuLayer, useSlotClass } from "@elaraai/east-ui-components/internal";
import { usePlanGeometry } from "../context.js";
import { PlanControllerContext } from "../controller/react.js";
import { PLAN_CELL_INSET } from "../geometry.js";
import { rowKeyOf } from "../row-key.js";
import type { PlanWords } from "../words.js";
import { BUCKET_SLOT_GAP, bucketSlots } from "./bucket-slots.js";

type Styles = Record<string, Record<string, unknown>>;

/** One tile of a cell: its key, its accessible name, and the tile itself, folded or at its place in the cell. */
export interface BucketCellTile {
    /** Its event's key — the tile's `data-event`. */
    readonly key: string;
    /** Its accessible name — what the chip's menu lists it by (#819). */
    readonly name: string;
    /** The tile: folded into the chip, or at its place in the cell — none for a mark across the cell, the recipe's. */
    readonly draw: (folded: boolean, place: CSSProperties | undefined) => ReactNode;
}

/** Props of {@link BucketCell}. */
export interface BucketCellProps {
    /** The Plan recipe's styles. */
    readonly styles: Styles;
    /** The row the cell is in, by its key — where an open popover's tile is looked for. */
    readonly rowKey: string;
    /** The cell's key — its `data-plan-cell`. */
    readonly cellKey: string;
    /** Where the cell sits: the day's room in its lane, and where a tile stands down it — inline, as a gesture moves them. */
    readonly place: Readonly<CSSProperties>;
    /** Its marker's status — the ring — when it has one. */
    readonly over: string | undefined;
    /** Its tiles, in order. */
    readonly tiles: readonly BucketCellTile[];
    /** Its marker's corner icon, drawn last. */
    readonly marker: ReactNode;
    /** Whether its tiles stand in slots and fold: it holds a tile, and is not a context strip's, whose marks never fold. */
    readonly folds: boolean;
    /** The day's pitch on the plot, in px; `undefined` while its row is unmeasured. */
    readonly pitch: number | undefined;
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
}

const noSubscribe = () => () => undefined;

/** A pitch past any day's, for an unmeasured cell: its slots by its tiles' count alone, never its floor. */
const UNMEASURED = 1e9;

/**
 * A slot's place in its cell: in whole pixels from the day's start, or — unmeasured — by its share of the cell, which
 * is the day less its rule.
 *
 * @param k - The slots the day is cut into
 * @param slot - The slot
 * @param px - Its left and width in px, where the day is measured
 * @returns The place
 */
function slotPlace(k: number, slot: number, px: { readonly left: number; readonly width: number } | undefined): CSSProperties {
    // Its width, which a narrow slot's padding gives way to (`--plan-slot-w`, the recipe's).
    return px !== undefined
        ? { left: `${px.left}px`, width: `${px.width}px`, "--plan-slot-w": `${px.width}px` } as CSSProperties
        : { left: `calc(${PLAN_CELL_INSET}px + ${slot} * (100% + 1px) / ${k})`, width: `calc((100% + 1px) / ${k} - ${BUCKET_SLOT_GAP}px)` };
}

/**
 * A bucket cell — see the module docs.
 *
 * @param props - The cell's place, its tiles and marker, whether they fold, the day's pitch, and its words
 * @returns The cell
 */
export function BucketCell(props: BucketCellProps) {
    const { styles, rowKey, cellKey, place, over, tiles, marker, folds, pitch, frac, bucket, lane, words, onClick } = props;
    const geometry = usePlanGeometry();
    const slot = useSlotClass();
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

    // ── Where each tile stands ──
    const shown = new Map<number, CSSProperties>();
    let more: { readonly count: number; readonly place: CSSProperties | undefined } | undefined;
    let mark = false;
    if (!folds) {
        // A context strip's marks: every tile its share of the day.
        tiles.forEach((_, i) => shown.set(i, slotPlace(tiles.length, i, undefined)));
    } else {
        const slots = bucketSlots(pitch ?? UNMEASURED, tiles.length, keptIndex >= 0 ? keptIndex : undefined, geometry.tileMinWidth, geometry.tileLeastWidth);
        const measured = pitch !== undefined;
        if (slots.kind === "mark") mark = true;
        else if (slots.kind === "count") more = { count: slots.count, place: undefined };
        else {
            for (const tile of slots.tiles) shown.set(tile.index, slotPlace(slots.k, tile.slot, measured ? tile : undefined));
            if (slots.more !== undefined) more = { count: slots.more.count, place: slotPlace(slots.k, slots.more.slot, measured ? slots.more : undefined) };
        }
    }
    const noRoom = more !== undefined && more.place === undefined;
    const folded = more === undefined ? [] : tiles.filter((_, i) => !shown.has(i));

    // A focused tile that folds hands the focus to the chip, which holds it now.
    useLayoutEffect(() => {
        const box = boxRef.current;
        const at = typeof document === "undefined" ? null : document.activeElement;
        if (box === null || !(at instanceof HTMLElement) || at.parentElement !== box || !at.hasAttribute("data-folded")) return;
        chipRef.current?.focus({ preventScroll: true });
    });

    // ── A pick: the tile kept in a slot, then focused and clicked as a viewer would ──
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
        <div className={slot(styles.cell)}
            data-plan-cell={cellKey}
            data-over={over}
            style={place}
            onClick={onClick}
        >
            <div ref={boxRef} className={slot(styles.cellTiles)} data-plan-cell-tiles="" data-no-room={mark ? "" : undefined}>
                {tiles.map((tile, i) => (mark && i === 0 ? tile.draw(false, undefined) : tile.draw(!shown.has(i), shown.get(i))))}
                {more !== undefined && (
                    <ChakraMenu.Root positioning={{ placement: "bottom-start" }} onSelect={(detail) => pick(detail.value)}>
                        <ChakraMenu.Trigger asChild>
                            <button ref={chipRef} type="button" className={slot(styles.tileMore)} data-tile-more=""
                                data-no-room={noRoom ? "" : undefined}
                                style={more.place}
                                // In the row's walk where the tiles it folds would be (#819).
                                data-plan-frac={frac.toFixed(4)} tabIndex={-1}
                                aria-label={words.m.tileMoreLabel({ n: folded.length, count: words.number(folded.length), bucket, lane, every: folded.length === tiles.length })}
                                onClick={stop}>
                                <span data-tile-more-count=""><span data-plan-label="">{words.m.tileMore({ n: folded.length, count: words.number(folded.length) })}</span></span>
                            </button>
                        </ChakraMenu.Trigger>
                        <FrameMenuLayer label={bucket} data-tile-more-menu="">
                            {folded.map((tile) => <ChakraMenu.Item key={tile.key} value={tile.key}>{tile.name}</ChakraMenu.Item>)}
                        </FrameMenuLayer>
                    </ChakraMenu.Root>
                )}
            </div>
            {marker}
        </div>
    );
}
