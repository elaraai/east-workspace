/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

/**
 * The snap grid's canvas in a phone's frame (`Studio Mobile Spec.md`), which
 * {@link SnapGridEditor} draws by itself at 560 px and narrower: one column of
 * real tiles in row order, each under a caption with its span. The 12 columns
 * stay in the record and in each tile's span meter; nothing drags.
 *
 * - **Tap a tile** to select it: the tile bar opens under the page with what
 *   you would drag on a desktop — Move, the span stepper, Remove — and the page
 *   scrolls so the tile stays in sight above it (ST12–ST16).
 * - **Pick, then place** (ST17–ST20): Move, or a card a host hands in, draws the
 *   page as its outline, with a dashed slot wherever the tile fits
 *   ({@link placeSlots}); one tap places it. A full row has no slot, and nothing
 *   rebalances (D4).
 *
 * The bars stand in the frame's bottom panel, in the flow, so the page gives way
 * to them. Every gesture is one of the canvas's own session.
 *
 * @packageDocumentation
 */

import { memo, useContext, useLayoutEffect, useMemo, useRef, type MouseEvent, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { Box, chakra } from "@chakra-ui/react";
import { FontAwesomeIcon } from "@fortawesome/react-fontawesome";
import type { IconName } from "@fortawesome/fontawesome-svg-core";
import { faChevronDown, faMinus, faPlus, faTrashCan, faUpDownLeftRight } from "@fortawesome/free-solid-svg-icons";
import { EastChakraComponent } from "../../component";
import { getSomeorUndefined } from "../../utils";
import { useSlotStyles } from "../../theme/slot-styles.js";
import { FrameBottomPanel } from "../builder-frame/bottom-panel.js";
import { useTopViewEscape } from "../builder-frame/view-escape.js";
import type { SnapGridWords } from "./messages.js";
import { useTileGrows } from "./tile-grows.js";
import {
    SNAP_GRID_COLUMNS, MIN_SPAN, placeSlots, startColumn,
    type SnapGridDrop, type SnapGridRowModel, type SnapGridSlot, type SnapGridTile,
} from "./model.js";
import type { SnapGridEditorCell } from "./index.js";

/**
 * What a phone's canvas is placing: a card a host handed in, or a tile being
 * moved. While it stands, the canvas is its outline.
 */
export type SnapGridPlacing =
    | { readonly kind: "add"; readonly card: { readonly library: string; readonly key: string }; readonly label: string; readonly span: number; }
    | { readonly kind: "move"; readonly key: string };

/** What a host says of the page, and does, on a phone. */
export interface SnapGridPhoneOptions {
    /** The page head: its eyebrow and its name (ST8). */
    readonly eyebrow?: string | undefined;
    /** The page's name. */
    readonly title?: string | undefined;
    /** Add a component (ST13), which a host answers by opening what lists them; no control without it. */
    readonly onAdd?: (() => void) | undefined;
    /** What is being placed: the host's, so a card in its pane can start it and its pane's Move too. */
    readonly placing?: SnapGridPlacing | undefined;
    /** Starts or ends placing. */
    readonly onPlacing?: ((placing: SnapGridPlacing | undefined) => void) | undefined;
}

/** Props of {@link SnapGridPhoneCanvas}. */
export interface SnapGridPhoneCanvasProps {
    readonly rows: readonly SnapGridRowModel[];
    readonly cellOf: ReadonlyMap<string, SnapGridEditorCell>;
    /** Each tile's span as the source holds it, by its identity: a span drafted away from it is a dirty value (ST16). */
    readonly savedSpans: ReadonlyMap<string, number>;
    readonly selected: string | null;
    readonly select: (key: string | null) => void;
    readonly available: boolean;
    /** Which tiles hold a conflict not yet chosen, by identity. */
    readonly conflicted: (id: string) => boolean;
    readonly words: SnapGridWords;
    readonly storageKey: string;
    readonly renderContent: ((cell: SnapGridEditorCell) => ReactNode) | undefined;
    readonly register: (key: string, el: HTMLElement | null) => void;
    readonly options: SnapGridPhoneOptions | undefined;
    readonly placing: SnapGridPlacing | undefined;
    readonly onPlacing: (placing: SnapGridPlacing | undefined) => void;
    readonly move: (key: string, drop: SnapGridDrop, narrows?: number) => boolean;
    readonly add: (card: { library: string; key: string }, drop: SnapGridDrop, narrows?: number) => string | undefined;
    readonly resize: (key: string, span: number, joins?: string) => boolean;
    readonly remove: (key: string) => void;
}

/** A phone's tiles are all stacked. */
const ALWAYS = () => true;

/** A tile's twelve cells, its own columns lit (ST10). */
function Meter({ first, span, styles }: { first: number; span: number; styles: ReturnType<typeof useSlotStyles> }) {
    return (
        <Box as="span" css={styles.meter} aria-hidden data-span-meter="">
            {Array.from({ length: SNAP_GRID_COLUMNS }, (_, i) => (
                <Box as="span" key={i} css={styles.cell} data-on={i + 1 >= first && i + 1 < first + span ? "" : undefined} />
            ))}
        </Box>
    );
}

/** A tile's frame on a phone: its fixed height applies (ST11), unless what it holds stacked needs more (ST39). */
function PhoneFrame({ styles, fixed, children }: { styles: ReturnType<typeof useSlotStyles>; fixed: number | undefined; children: ReactNode }) {
    const { ref, height } = useTileGrows<HTMLDivElement>(fixed, ALWAYS);
    return (
        <Box ref={ref} css={styles.frame} data-snap-grid-phone-frame="" data-frame="" style={height === undefined ? undefined : { height: `${height}px` }}>
            {children}
        </Box>
    );
}

/**
 * The canvas on a phone — see the module docs.
 *
 * @param props - The rows, the selection, what is being placed, and the gestures
 * @returns The page, and its bar in the frame's bottom panel
 */
export const SnapGridPhoneCanvas = memo(function SnapGridPhoneCanvas(props: SnapGridPhoneCanvasProps) {
    const { rows, cellOf, savedSpans, selected, select, available, conflicted, words, storageKey, renderContent, register, options, placing, onPlacing, move, add, resize, remove } = props;
    const styles = useSlotStyles("snapGridPhone");
    const m = words.m;
    const panel = useContext(FrameBottomPanel);
    const scrollRef = useRef<HTMLDivElement | null>(null);
    const blocks = useRef(new Map<string, HTMLElement>());

    const moving = placing?.kind === "move" ? placing.key : undefined;
    const placedTile = useMemo(() => (moving === undefined ? undefined : rows.flatMap((r) => r.tiles).find((t) => t.key === moving)), [rows, moving]);
    const placingNow = placing !== undefined && (placing.kind === "add" || placedTile !== undefined) ? placing : undefined;
    const placingSpan = placingNow === undefined ? 0 : placingNow.kind === "add" ? placingNow.span : placedTile?.span ?? 0;
    const placingLabel = placingNow === undefined ? "" : placingNow.kind === "add" ? placingNow.label : placedTile?.label ?? "";
    const slots = useMemo(() => (placingNow === undefined ? [] : placeSlots(rows, placingSpan, moving)), [placingNow, rows, placingSpan, moving]);
    const isPlacing = placingNow !== undefined;
    useTopViewEscape(isPlacing, () => onPlacing(undefined));

    // The selected tile stays in sight above the bar that opened under it (ST12).
    useLayoutEffect(() => {
        const scroller = scrollRef.current;
        const block = selected === null ? undefined : blocks.current.get(selected);
        if (scroller === null || block === undefined) return;
        const view = scroller.getBoundingClientRect();
        const box = block.getBoundingClientRect();
        if (box.height >= view.height || box.top < view.top) scroller.scrollTop += box.top - view.top;
        else if (box.bottom > view.bottom) scroller.scrollTop += box.bottom - view.bottom;
    }, [selected, isPlacing]);

    const place = (slot: SnapGridSlot) => {
        if (placingNow === undefined) return;
        if (placingNow.kind === "move") {
            if (move(placingNow.key, slot.drop, slot.narrows)) select(placingNow.key);
        } else {
            const key = add(placingNow.card, slot.drop, slot.narrows);
            if (key !== undefined) select(key);
        }
        onPlacing(undefined);
    };
    const slotAt = (test: (drop: SnapGridDrop) => boolean) => slots.find((s) => test(s.drop));
    const slotButton = (slot: SnapGridSlot | undefined, label: string, key: string) => slot === undefined ? null : (
        <chakra.button key={key} type="button" css={styles.slot} data-place-slot={slot.drop.kind} onClick={() => place(slot)}>
            <FontAwesomeIcon icon={faPlus} aria-hidden />{label}
        </chakra.button>
    );
    const newRow = (at: number) => slotButton(slotAt((d) => d.kind === "gap" && d.at === at), m.phoneNewRow(), `gap-${at}`);
    const iconOf = (tile: SnapGridTile) => {
        const cell = cellOf.get(tile.key);
        return cell === undefined ? undefined : getSomeorUndefined(cell.icon);
    };
    const freeOf = (row: SnapGridRowModel) => SNAP_GRID_COLUMNS - row.tiles.reduce((sum, t) => sum + t.span, 0);
    const rowHead = (row: SnapGridRowModel, i: number) => {
        const free = freeOf(row);
        const head = m.phoneRow({ row: words.number(i + 1) });
        return <Box css={styles.rowHead}>{free > 0 ? `${head} · ${m.phoneFree({ n: free, count: words.number(free) })}` : head}</Box>;
    };

    // ── The page, or its outline ─────────────────────────────────────────
    const outline = placingNow !== undefined && (
        <Box css={styles.outline} data-snap-grid-outline="">
            {rows.map((row, r) => (
                <Box key={row.key} css={styles.outline}>
                    {newRow(r)}
                    {rowHead(row, r)}
                    {row.tiles.map((tile, pos) => {
                        const slot = slotAt((d) => d.kind === "join" && d.row === r && d.pos === pos);
                        const first = startColumn(row.tiles, tile.key);
                        const own = tile.key === moving;
                        const icon = own ? undefined : iconOf(tile);
                        const body = <>
                            <Box as="span" css={styles.outlineIcon} aria-hidden>
                                {own ? <FontAwesomeIcon icon={faUpDownLeftRight} /> : icon !== undefined && <FontAwesomeIcon icon={["fas", icon as IconName]} />}
                            </Box>
                            <Box as="span" css={styles.outlineName}>{tile.label}</Box>
                            <Meter first={first} span={tile.span} styles={styles} />
                            <Box as="span" css={styles.captionSpan}>{m.phoneSpan({ span: words.number(tile.span) })}</Box>
                        </>;
                        return (
                            <Box key={tile.key} css={styles.outline}>
                                {slotButton(slot, m.phoneInto({ row: words.number(r + 1), narrows: slot?.narrows === undefined ? undefined : words.number(slot.narrows) }), `into-${r}-${pos}`)}
                                {own
                                    ? <chakra.button type="button" css={styles.outlineRow} data-outline-moving="" aria-label={m.phoneMoving({ label: tile.label })} onClick={() => onPlacing(undefined)}>{body}</chakra.button>
                                    : <Box css={styles.outlineRow} data-outline-tile={tile.key}>{body}</Box>}
                            </Box>
                        );
                    })}
                    {(() => {
                        const slot = slotAt((d) => d.kind === "join" && d.row === r && d.pos === row.tiles.length);
                        return slotButton(slot, m.phoneInto({ row: words.number(r + 1), narrows: slot?.narrows === undefined ? undefined : words.number(slot.narrows) }), `into-${r}-end`);
                    })()}
                </Box>
            ))}
            {newRow(rows.length)}
        </Box>
    );
    const page = rows.map((row, r) => (
        <Box key={row.key} css={styles.row} data-phone-row={r + 1}>
            {rowHead(row, r)}
            <Box css={styles.tiles}>
                {row.tiles.map((tile) => {
                    const cell = cellOf.get(tile.key)!;
                    const isSelected = tile.key === selected;
                    const conflict = conflicted(tile.id);
                    const first = startColumn(row.tiles, tile.key);
                    const height = getSomeorUndefined(cell.height);
                    return (
                        <Box key={tile.key} ref={(el: HTMLElement | null) => { if (el === null) blocks.current.delete(tile.key); else blocks.current.set(tile.key, el); }}
                            data-tile-selected={isSelected ? "" : undefined}>
                            <Box css={styles.caption} data-tile-caption="">
                                <Box as="span" css={styles.captionName}>{tile.label}</Box>
                                {conflict
                                    ? <Box as="span" css={styles.captionConflict} data-tile-conflict=""><Box as="span" css={styles.conflictDot} aria-hidden />{m.phoneConflict()}</Box>
                                    : <>
                                        <Meter first={first} span={tile.span} styles={styles} />
                                        <Box as="span" css={styles.captionSpan}>{m.phoneSpan({ span: words.number(tile.span) })}</Box>
                                    </>}
                            </Box>
                            <Box ref={(el: HTMLElement | null) => register(tile.key, el)} css={styles.tile} role="button" tabIndex={0} aria-pressed={isSelected}
                                aria-label={m.tileName({ label: tile.label, span: words.number(tile.span), row: words.number(r + 1) })}
                                data-snap-grid-tile={tile.key} data-selected={isSelected ? "" : undefined} data-conflict={conflict ? "" : undefined}
                                onClick={(e: MouseEvent) => { e.stopPropagation(); select(isSelected ? null : tile.key); }}
                                onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); select(isSelected ? null : tile.key); } }}>
                                <PhoneFrame styles={styles} fixed={height === undefined ? undefined : Number(height)}>
                                    {renderContent !== undefined ? renderContent(cell)
                                        : cell.content !== undefined ? <EastChakraComponent value={cell.content} storageKey={`${storageKey}.${cell.key}`} />
                                            : null}
                                </PhoneFrame>
                            </Box>
                        </Box>
                    );
                })}
            </Box>
        </Box>
    ));
    const onAdd = options?.onAdd;
    const addButton = onAdd !== undefined && (
        <chakra.button type="button" css={styles.add} data-snap-grid-add="" onClick={onAdd}><FontAwesomeIcon icon={faPlus} aria-hidden />{m.phoneAdd()}</chakra.button>
    );

    // ── The bar under it ─────────────────────────────────────────────────
    const at = selected === null ? -1 : rows.findIndex((r) => r.tiles.some((t) => t.key === selected));
    const barRow = at < 0 ? undefined : rows[at];
    const barTile = barRow?.tiles.find((t) => t.key === selected);
    let bar: ReactNode = null;
    if (placingNow !== undefined) {
        bar = (
            <Box css={styles.placeBar} data-snap-grid-place-bar="">
                <Box css={styles.placeHead}>
                    <Box as="span" css={styles.placeTitle}>{placingNow.kind === "move" ? m.phoneMoving({ label: placingLabel }) : m.phoneAdding({ label: placingLabel })}</Box>
                    <chakra.button type="button" css={styles.placeCancel} data-place-cancel="" onClick={() => onPlacing(undefined)}>{m.phoneCancel()}</chakra.button>
                </Box>
                <Box css={styles.placeLine}>{placingNow.kind === "move" ? m.phoneMoveLine() : m.phoneAddLine()}</Box>
                <Box css={styles.placeCount} data-place-count="">{m.phoneSlots({ n: slots.length, count: words.number(slots.length), span: words.number(placingSpan) })}</Box>
            </Box>
        );
    } else if (barTile !== undefined && barRow !== undefined) {
        const first = startColumn(barRow.tiles, barTile.key);
        const free = freeOf(barRow);
        const saved = savedSpans.get(barTile.key);
        const joins = `span:${barTile.key}`;
        bar = (
            <Box css={styles.bar} data-snap-grid-tile-bar="">
                <Box css={styles.barHead}>
                    <Box as="span" css={styles.barTitle}>{m.phoneBarHead({ row: words.number(at + 1), label: barTile.label })}</Box>
                    <chakra.button type="button" css={styles.barClose} aria-label={m.phoneBarClose()} onClick={() => select(null)}><FontAwesomeIcon icon={faChevronDown} /></chakra.button>
                </Box>
                <chakra.button type="button" css={styles.barMove} disabled={!available} data-tile-move="" onClick={() => onPlacing({ kind: "move", key: barTile.key })}>
                    <FontAwesomeIcon icon={faUpDownLeftRight} aria-hidden />{m.phoneMove()}
                </chakra.button>
                <Box css={styles.barControls}>
                    <Box css={styles.stepper} role="group" aria-label={m.phoneSpanLabel()}>
                        <chakra.button type="button" css={styles.stepperButton} aria-label={m.phoneNarrower()} disabled={!available || barTile.span <= MIN_SPAN} data-span-minus=""
                            onClick={() => resize(barTile.key, barTile.span - 1, joins)}><FontAwesomeIcon icon={faMinus} /></chakra.button>
                        <Box as="output" css={styles.stepperValue} data-dirty={saved !== undefined && saved !== barTile.span ? "" : undefined} data-span-value="">{m.phoneSpan({ span: words.number(barTile.span) })}</Box>
                        <chakra.button type="button" css={styles.stepperButton} aria-label={m.phoneWider()} disabled={!available || free === 0} data-span-plus=""
                            onClick={() => resize(barTile.key, barTile.span + 1, joins)}><FontAwesomeIcon icon={faPlus} /></chakra.button>
                    </Box>
                    <chakra.button type="button" css={styles.barRemove} disabled={!available} data-tile-remove="" onClick={() => remove(barTile.key)}>
                        <FontAwesomeIcon icon={faTrashCan} aria-hidden />{m.phoneRemove()}
                    </chakra.button>
                </Box>
                <Box css={styles.barLine} data-tile-consequence="">
                    {m.phoneColumns({ first: words.number(first), last: words.number(first + barTile.span - 1), free, freeCount: words.number(free), row: words.number(at + 1) })}
                </Box>
            </Box>
        );
    }

    return (
        <Box css={styles.root} data-snap-grid-phone="">
            <Box ref={scrollRef} css={styles.scroll} data-snap-grid-phone-scroll="">
                {(options?.title !== undefined || options?.eyebrow !== undefined) && (
                    <Box css={styles.head}>
                        {options.eyebrow !== undefined && <Box as="span" css={styles.eyebrow}>{options.eyebrow}</Box>}
                        {options.title !== undefined && <Box as="span" css={styles.title}>{options.title}</Box>}
                    </Box>
                )}
                <Box css={styles.rows}>
                    {rows.length === 0 && placingNow === undefined && (
                        <Box css={styles.empty} data-snap-grid-empty="">
                            <Box as="span" css={styles.emptyGlyph} aria-hidden />
                            <Box as="span" css={styles.emptyTitle}>{m.phoneEmpty({ page: options?.title })}</Box>
                            <Box as="ul" css={styles.emptyList}><li>{m.phoneEmptyFirst()}</li><li>{m.phoneEmptyThen()}</li></Box>
                        </Box>
                    )}
                    {outline !== false ? outline : <>{page}{addButton}</>}
                </Box>
            </Box>
            {bar !== null && (panel !== null ? createPortal(bar, panel) : bar)}
        </Box>
    );
});
