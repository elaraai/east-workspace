/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

/** Gutter insertion seams, the sheet's one insertion layer, and the keyboard-accessible companion strip. @packageDocumentation */
import { forwardRef } from "react";
import { Box, chakra } from "@chakra-ui/react";
import { FontAwesomeIcon } from "@fortawesome/react-fontawesome";
import { faLayerGroup, faPlus } from "@fortawesome/free-solid-svg-icons";
import { useSheetWords } from "./words.js";

type Styles = Record<string, Record<string, unknown>>;
export interface InsertionActions {
    row?: (() => void) | undefined;
    group?: (() => void) | undefined;
    ordered: boolean;
    groupOrdered: boolean;
    preview?: ((kind: "row" | "group" | undefined) => void) | undefined;
    /** A row here is a LINE — a grouped sheet's (the sheet's words say which, #861). */
    line: boolean;
    /** What a group is called — the host's noun (#844). */
    noun: string;
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
    const { m } = useSheetWords();
    const defaultKind = actions.row ? "row" : "group";
    const { line, noun } = actions;
    return <Box ref={ref} css={styles.insertLayer} data-slot="insertLayer" data-side={seam.side}
        style={{ top: `${seam.top}px`, left: `${seam.left}px` }}
        onMouseLeave={event => onLeave(event.relatedTarget)}
        onKeyDown={event => event.stopPropagation()}>
        <Box css={styles.insertChips} data-slot="insertChips" role="group" aria-label={m.insertHere()}>
            {actions.row && <chakra.button type="button" css={styles.insertButton} data-slot="insertRow"
                aria-label={m.insertRow({ ordered: actions.ordered, line })} title={m.insertRowTitle({ ordered: actions.ordered, line })}
                onMouseDown={event => { event.preventDefault(); event.stopPropagation(); }}
                onMouseEnter={() => actions.preview?.("row")} onMouseLeave={() => actions.preview?.(defaultKind)}
                onClick={event => { event.stopPropagation(); actions.row?.(); }}><FontAwesomeIcon icon={faPlus} /></chakra.button>}
            {actions.group && <chakra.button type="button" css={styles.insertButton} data-slot="insertGroup"
                aria-label={m.insertGroup({ ordered: actions.groupOrdered, noun })} title={m.insertGroupTitle({ ordered: actions.groupOrdered, noun })}
                onMouseDown={event => { event.preventDefault(); event.stopPropagation(); }}
                onMouseEnter={() => actions.preview?.("group")} onMouseLeave={() => actions.preview?.(defaultKind)}
                onClick={event => { event.stopPropagation(); actions.group?.(); }}><FontAwesomeIcon icon={faLayerGroup} /></chakra.button>}
        </Box>
    </Box>;
});

/** A visible alternative to the gutter controls when whole rows are selected — in the sheet's words (#861). */
export function SheetInsertStrip({ styles, ordered, above, below, group, noun }: {
    styles: Styles; ordered: boolean; above?: (() => void) | undefined; below?: (() => void) | undefined; group?: (() => void) | undefined;
    /** The host's word for a group (#844); the sheet's own when it declares none. */
    noun?: string | undefined;
}) {
    const { m } = useSheetWords();
    if (!above && !below && !group) return null;
    return <Box css={styles.insertStrip} role="group" aria-label={m.insertStrip()}>
        {ordered && above && <chakra.button type="button" css={styles.insertChoice} onClick={above}>{m.insertAbove()}</chakra.button>}
        {below && <chakra.button type="button" css={styles.insertChoice} onClick={below}>{m.insertBelow({ ordered })}</chakra.button>}
        {group && <chakra.button type="button" css={styles.insertChoice} onClick={group}>{m.insertNewGroup({ noun: noun ?? m.groupNoun() })}</chakra.button>}
    </Box>;
}
