/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

/**
 * A tile on the SnapGrid's editing canvas (#990): the placement's content in
 * its frame, a drag chip of the shared drag layer, and — selected — its resize
 * handles, its name and span over its top edge, and its bar at the other end:
 * the host's Edit (#1672), the host's own actions (#1673), Duplicate and
 * Remove. The canvas (`./editor.tsx`) lays the tiles out in their rows and
 * takes what each asks for.
 *
 * @packageDocumentation
 */

import {
    memo, useCallback, useMemo,
    type CSSProperties, type KeyboardEvent as ReactKeyboardEvent, type MouseEvent as ReactMouseEvent,
    type PointerEvent as ReactPointerEvent, type ReactNode,
} from "react";
import { Box, chakra } from "@chakra-ui/react";
import { FontAwesomeIcon } from "@fortawesome/react-fontawesome";
import type { IconDefinition } from "@fortawesome/fontawesome-svg-core";
import { faClone, faPen, faTrashCan } from "@fortawesome/free-solid-svg-icons";
import { EastChakraComponent } from "../../component";
import { useDragEventChip } from "../../dnd/drag-layer";
import type { SnapGridDraftMark } from "./use-snap-grid-editing.js";
import type { SnapGridWords } from "./messages.js";
import { ALWAYS_STACKED, useTileGrows } from "./tile-grows.js";
import { SNAP_GRID_COLUMNS, type SnapGridTile } from "./model.js";
import type { SnapGridEditorCell } from "./index.js";
import { LEAST_HEIGHT, frameHeight } from "./natural.js";
import { InsertLine, type SnapGridStyles } from "./editor-cells.js";

/** Which edge a resize handle drags. */
export type ResizeKind = "span" | "height" | "both";

/** A resize while the pointer holds its handle — what the tile draws until it lets go. */
export interface ResizePreview {
    /** The tile's key. */
    key: string;
    /** The row it sits in. */
    row: string;
    /** The span it would take. */
    span?: number | undefined;
    /** The height it would take — `null` its content's own. */
    height?: number | null | undefined;
    /** Another tile's bottom edge it snapped to, in px from the row's top. */
    guide?: number | undefined;
}

/**
 * What a host does to the selected tile, on its frame beside Edit, Duplicate
 * and Remove (#1673): an icon button, its label its name and its title.
 *
 * @property key - Its own key among the tile's actions, which marks its button (`data-snap-grid-action`)
 * @property label - Its name
 * @property icon - Its Font Awesome solid icon
 * @property onClick - What it does
 */
export interface SnapGridTileAction {
    /** Its own key among the tile's actions, which marks its button (`data-snap-grid-action`). */
    readonly key: string;
    /** Its name: the button's label and title. */
    readonly label: string;
    /** Its Font Awesome solid icon. */
    readonly icon: IconDefinition;
    /** What it does. */
    readonly onClick: () => void;
}

interface TileProps {
    tile: SnapGridTile;
    cell: SnapGridEditorCell;
    surface: string;
    /** Its first column — the drag grammar's `from.slot`. */
    start: number;
    /** Its row's number, from 1. */
    rowNumber: number;
    styles: SnapGridStyles;
    words: SnapGridWords;
    storageKey: string;
    selected: boolean;
    /** The canvas's one tab stop. */
    tabStop: boolean;
    mark: SnapGridDraftMark | undefined;
    /** It holds a conflict not yet chosen: it wears the warn ring. */
    conflict: boolean;
    /** It moves: the session takes a gesture. */
    movable: boolean;
    /** Its height is edited. */
    heights: boolean;
    /** Laid out as a phone shows the page: the full width, its height given way to what it holds, and no handles. */
    stacked: boolean;
    preview: ResizePreview | undefined;
    onSelect: (key: string) => void;
    onResizeStart: (e: ReactPointerEvent, key: string, kind: ResizeKind) => void;
    onRemove: (key: string) => void;
    /** Copies it after itself (#1672). */
    onDuplicate: (key: string) => void;
    /** The host's edit of what it shows (#1672); `undefined` draws no Edit. */
    onEdit: ((key: string) => void) | undefined;
    /** What the host does to it beside Edit, Duplicate and Remove while it is selected (#1673); none unless given. */
    actions: readonly SnapGridTileAction[] | undefined;
    register: (key: string, el: HTMLElement | null) => void;
    /** Draws the tile's content, when the host does — else its East content. */
    renderContent: ((cell: SnapGridEditorCell) => ReactNode) | undefined;
}

/** A tile on the canvas — see the module docs. */
export const SnapGridTileBox = memo(function SnapGridTileBox(p: TileProps) {
    const { tile, cell, styles, words, register } = p;
    const m = words.m;
    const key = tile.key;
    const from = useMemo(() => ({ surface: p.surface, row: tile.row, slot: String(p.start), event: key }), [p.surface, tile.row, p.start, key]);
    const ghost = useMemo(() => <Box css={styles.ghost}>{tile.label}</Box>, [styles.ghost, tile.label]);
    const drag = useDragEventChip(from, ghost, !p.movable, tile.label);
    const dragRef = drag?.ref;
    const ref = useCallback((el: HTMLElement | null) => {
        dragRef?.(el);
        register(key, el);
    }, [dragRef, register, key]);
    const span = p.preview?.span ?? tile.span;
    const height = p.preview !== undefined && p.preview.height !== undefined ? p.preview.height : tile.height;
    const style = { "--snap-grid-span": String(span) } as CSSProperties;
    // Stacked, as a phone shows the page, its height gives way to what it holds, as the page's own tile does there.
    const grows = useTileGrows<HTMLDivElement>(p.stacked ? height ?? undefined : undefined, ALWAYS_STACKED);
    // A stretched tile is as tall as its row: its height is the least it takes.
    const held = frameHeight(p.stacked ? grows.height : height, cell.align.type === "stretch");
    const { onResizeStart, onRemove, onDuplicate, onEdit, onSelect } = p;
    return (
        <Box
            {...drag}
            ref={ref}
            css={styles.tile}
            style={style}
            role={drag?.role ?? "button"}
            tabIndex={p.tabStop ? 0 : -1}
            aria-label={m.tileName({ label: tile.label, span: words.number(span), row: words.number(p.rowNumber) })}
            data-snap-grid-tile={key}
            data-align={cell.align.type}
            data-selected={p.selected ? "" : undefined}
            data-pending={p.mark === "pending" ? "" : undefined}
            data-conflict={p.conflict ? "" : undefined}
            data-incomplete={p.mark === "incomplete" ? "" : undefined}
            data-invalid={p.mark === "invalid" ? "" : undefined}
            data-draggable={drag !== undefined ? "" : undefined}
            onClick={(e: ReactMouseEvent) => { e.stopPropagation(); onSelect(key); }}
        >
            <Box ref={grows.ref} css={styles.frame} style={held.style} data-frame={cell.frame ? "" : undefined} {...(held.least ? { [LEAST_HEIGHT]: "" } : {})}>
                {p.renderContent !== undefined ? p.renderContent(cell)
                    : cell.content !== undefined ? <EastChakraComponent value={cell.content} storageKey={`${p.storageKey}.${cell.key}`} />
                        : null}
            </Box>
            {p.selected && (
                <>
                    {/* Its handles: stacked, as a phone shows the page, its span and height are the wider layout's, and it has none. */}
                    {!p.stacked && (
                        <>
                            <Box as="span" css={styles.handle} data-handle="top-left" aria-hidden />
                            <Box as="span" css={styles.handle} data-handle="top-right" aria-hidden />
                            <Box as="span" css={styles.handle} data-handle="bottom-left" aria-hidden />
                            {p.heights && (
                                <Box as="span" css={styles.handle} data-handle="both" title={m.bothHandle()} aria-hidden
                                    onPointerDown={(e: ReactPointerEvent) => onResizeStart(e, key, "both")} />
                            )}
                            <Box as="span" css={styles.handle} data-handle="span" title={m.spanHandle()} aria-hidden
                                onPointerDown={(e: ReactPointerEvent) => onResizeStart(e, key, "span")} />
                            {p.heights && (
                                <Box as="span" css={styles.handle} data-handle="height" title={m.heightHandle()} aria-hidden
                                    onPointerDown={(e: ReactPointerEvent) => onResizeStart(e, key, "height")} />
                            )}
                        </>
                    )}
                    {/* Its name and span over its top edge, and its toolbar at the other end (#1672, BLD-3); the tile's own name says both. */}
                    <Box as="span" css={styles.tileBadge} aria-hidden data-snap-grid-badge="">{m.tileBadge({ label: tile.label, span: words.number(span), of: words.number(SNAP_GRID_COLUMNS) })}</Box>
                    <Box css={styles.tileBar} data-snap-grid-tile-bar=""
                        onPointerDown={(e: ReactPointerEvent) => e.stopPropagation()}
                        onKeyDown={(e: ReactKeyboardEvent) => e.stopPropagation()}>
                        {onEdit !== undefined && (
                            <chakra.button type="button" css={styles.tileAction} aria-label={m.edit()} title={m.edit()} data-snap-grid-edit=""
                                onClick={(e: ReactMouseEvent) => { e.stopPropagation(); onEdit(key); }}>
                                <FontAwesomeIcon icon={faPen} />
                            </chakra.button>
                        )}
                        {p.actions?.map((action) => (
                            <chakra.button key={action.key} type="button" css={styles.tileAction} aria-label={action.label} title={action.label} data-snap-grid-action={action.key}
                                onClick={(e: ReactMouseEvent<HTMLButtonElement>) => {
                                    e.stopPropagation();
                                    // The focus back on its tile, as a menu hands it back to its trigger: the keys a mode the action
                                    // starts hears — Esc, say — reach the canvas and the page, never this bar, which keeps them from both.
                                    e.currentTarget.closest<HTMLElement>("[data-snap-grid-tile]")?.focus({ preventScroll: true });
                                    action.onClick();
                                }}>
                                <FontAwesomeIcon icon={action.icon} />
                            </chakra.button>
                        ))}
                        <chakra.button type="button" css={styles.tileAction} aria-label={m.duplicate()} title={m.duplicate()} data-snap-grid-duplicate=""
                            onClick={(e: ReactMouseEvent) => { e.stopPropagation(); onDuplicate(key); }}>
                            <FontAwesomeIcon icon={faClone} />
                        </chakra.button>
                        <chakra.button type="button" css={styles.tileAction} aria-label={m.remove()} title={m.remove()} data-snap-grid-remove="" data-danger=""
                            onClick={(e: ReactMouseEvent) => { e.stopPropagation(); onRemove(key); }}>
                            <FontAwesomeIcon icon={faTrashCan} />
                        </chakra.button>
                    </Box>
                </>
            )}
            <InsertLine css={styles.insertBefore} styles={styles} attr="insert" />
            <InsertLine css={styles.insertAfter} styles={styles} attr="insert" />
        </Box>
    );
});
