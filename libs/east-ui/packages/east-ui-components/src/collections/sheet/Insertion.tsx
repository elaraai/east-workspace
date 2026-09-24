/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

/** Gutter insertion seams, the sheet's one insertion layer, and the keyboard-accessible companion strip. @packageDocumentation */
import { forwardRef } from "react";
import { Box, chakra } from "@chakra-ui/react";
import { FontAwesomeIcon } from "@fortawesome/react-fontawesome";
import { faLayerGroup, faPlus } from "@fortawesome/free-solid-svg-icons";

type Styles = Record<string, Record<string, unknown>>;
export interface InsertionActions {
    row?: (() => void) | undefined;
    group?: (() => void) | undefined;
    ordered: boolean;
    groupOrdered: boolean;
    preview?: ((kind: "row" | "group" | undefined) => void) | undefined;
    /** What a row is called here — `line` on a grouped sheet, else `row`. */
    rowWord: string;
    /** What a group is called — the host's noun (#844). */
    groupWord: string;
}

/** Where the chips of the hovered seam sit, in the card's coordinates. */
export interface InsertSeam {
    /** The row-space index of the row below the seam. */
    r: number;
    /**
     * In the gutter's actions column, unless an action button occupies that
     * column on either row the seam divides; then on the body side of the
     * gutter edge, so nothing overlaps.
     */
    side: "gutter" | "body";
    /** The row boundary (px from the card's top). */
    top: number;
    /** Where the chips start (px from the card's left). */
    left: number;
}

/**
 * A SEAM: a hit strip centred on the row boundary across the gutter. It
 * draws nothing. Hovering it names the seam to the sheet, whose insertion
 * layer ({@link SheetInsertLayer}) then shows the chips there.
 */
export function SheetInsertPoint({ styles, side, onEnter, onLeave }: {
    styles: Styles;
    side: "gutter" | "body";
    onEnter: (hit: HTMLElement) => void;
    onLeave: (to: EventTarget | null) => void;
}) {
    return <Box css={styles.insertPoint} data-slot="insertPoint" data-side={side} aria-hidden="true"
        onMouseEnter={event => onEnter(event.currentTarget)}
        onMouseLeave={event => onLeave(event.relatedTarget)} />;
}

/**
 * The sheet's ONE insertion layer: the hovered seam's two chips — row (plus)
 * and group (layer-group), 24 px outlined — laid over the rows at the seam.
 * The layer sits above every row and under the pinned header, so no row's
 * content (a cell editor, the ring, the row above) ever covers the chips.
 * Keyboard activation never types into the sheet.
 */
export const SheetInsertLayer = forwardRef<HTMLDivElement, {
    styles: Styles;
    seam: InsertSeam;
    actions: InsertionActions;
    onLeave: (to: EventTarget | null) => void;
}>(function SheetInsertLayer({ styles, seam, actions, onLeave }, ref) {
    const defaultKind = actions.row ? "row" : "group";
    const { rowWord, groupWord } = actions;
    return <Box ref={ref} css={styles.insertLayer} data-slot="insertLayer" data-side={seam.side}
        style={{ top: `${seam.top}px`, left: `${seam.left}px` }}
        onMouseLeave={event => onLeave(event.relatedTarget)}
        onKeyDown={event => event.stopPropagation()}>
        <Box css={styles.insertChips} data-slot="insertChips" role="group" aria-label="Insert here">
            {actions.row && <chakra.button type="button" css={styles.insertButton} data-slot="insertRow"
                aria-label={actions.ordered ? `Insert ${rowWord} before` : `Add ${rowWord}`} title={actions.ordered ? `Insert a ${rowWord} here` : `Add a ${rowWord} in key order`}
                onMouseDown={event => { event.preventDefault(); event.stopPropagation(); }}
                onMouseEnter={() => actions.preview?.("row")} onMouseLeave={() => actions.preview?.(defaultKind)}
                onClick={event => { event.stopPropagation(); actions.row?.(); }}><FontAwesomeIcon icon={faPlus} /></chakra.button>}
            {actions.group && <chakra.button type="button" css={styles.insertButton} data-slot="insertGroup"
                aria-label={actions.groupOrdered ? `New ${groupWord}` : `Add ${groupWord}`} title={actions.groupOrdered ? `Start a new ${groupWord} at the nearest ${groupWord} boundary` : `Add a ${groupWord} in key order`}
                onMouseDown={event => { event.preventDefault(); event.stopPropagation(); }}
                onMouseEnter={() => actions.preview?.("group")} onMouseLeave={() => actions.preview?.(defaultKind)}
                onClick={event => { event.stopPropagation(); actions.group?.(); }}><FontAwesomeIcon icon={faLayerGroup} /></chakra.button>}
        </Box>
    </Box>;
});

/** A visible alternative to the gutter controls when whole rows are selected. */
export function SheetInsertStrip({ styles, ordered, above, below, group, groupWord = "group" }: {
    styles: Styles; ordered: boolean; above?: (() => void) | undefined; below?: (() => void) | undefined; group?: (() => void) | undefined; groupWord?: string;
}) {
    if (!above && !below && !group) return null;
    return <Box css={styles.insertStrip} role="group" aria-label="Row insertion">
        {ordered && above && <chakra.button type="button" css={styles.insertChoice} onClick={above}>Insert above</chakra.button>}
        {below && <chakra.button type="button" css={styles.insertChoice} onClick={below}>{ordered ? "Insert below" : "Add row"}</chakra.button>}
        {group && <chakra.button type="button" css={styles.insertChoice} onClick={group}>{`New ${groupWord}`}</chakra.button>}
    </Box>;
}
