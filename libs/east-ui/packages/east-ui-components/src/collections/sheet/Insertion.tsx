/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

/** Gutter insertion controls and their keyboard-accessible companion strip. @packageDocumentation */
import { useEffect, useRef } from "react";
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
    /**
     * Where the chips sit: in the gutter's actions column unless an action
     * button occupies that column on either row the seam divides, when they
     * move to the body side of the gutter edge so nothing overlaps.
     */
    side: "gutter" | "body";
}
/**
 * Two independent actions at the row boundary; keyboard activation never
 * types into the sheet.
 *
 * The SEAM is a hit band centred on the row boundary across the gutter;
 * hovering it reveals both chips — row (plus) and group (layer-group), 24 px
 * outlined — threaded on the insertion line. They sit in the gutter's actions
 * column unless an action button is in that column on either row the seam
 * divides, when they move to the body side of the gutter edge, so they never
 * collide with the connector, the numbers or the actions. The chips stay
 * inert until the seam is hovered, so they never intercept a press on what
 * they float over; once shown they are reachable without leaving the seam.
 */
export function SheetInsertPoint({ styles, actions }: { styles: Styles; actions: InsertionActions }) {
    const point = useRef<HTMLDivElement>(null);
    const defaultKind = actions.row ? "row" : "group";
    const preview = actions.preview;
    useEffect(() => {
        const seam = point.current;
        if (!seam) return;
        const enter = () => preview?.(defaultKind);
        const leave = () => preview?.(undefined);
        seam.addEventListener("mouseenter", enter);
        seam.addEventListener("mouseleave", leave);
        return () => { seam.removeEventListener("mouseenter", enter); seam.removeEventListener("mouseleave", leave); };
    }, [preview, defaultKind]);
    const restore = () => actions.preview?.(point.current?.matches(":hover") ? defaultKind : undefined);
    const { rowWord, groupWord } = actions;
    return <Box ref={point} css={styles.insertPoint} data-slot="insertPoint" data-side={actions.side} onKeyDown={event => event.stopPropagation()}>
        <Box css={styles.insertHit} data-slot="insertHit" aria-hidden="true" />
        <Box css={styles.insertChips} data-slot="insertChips" role="group" aria-label="Insert here">
            {actions.row && <chakra.button type="button" css={styles.insertButton} data-slot="insertRow"
                aria-label={actions.ordered ? `Insert ${rowWord} before` : `Add ${rowWord}`} title={actions.ordered ? `Insert a ${rowWord} here` : `Add a ${rowWord} in key order`}
                onMouseDown={event => { event.preventDefault(); event.stopPropagation(); }}
                onMouseEnter={() => actions.preview?.("row")} onMouseLeave={restore}
                onFocus={() => actions.preview?.("row")} onBlur={restore}
                onClick={event => { event.stopPropagation(); actions.row?.(); }}><FontAwesomeIcon icon={faPlus} /></chakra.button>}
            {actions.group && <chakra.button type="button" css={styles.insertButton} data-slot="insertGroup"
                aria-label={actions.groupOrdered ? `New ${groupWord}` : `Add ${groupWord}`} title={actions.groupOrdered ? `Start a new ${groupWord} at the nearest ${groupWord} boundary` : `Add a ${groupWord} in key order`}
                onMouseDown={event => { event.preventDefault(); event.stopPropagation(); }}
                onMouseEnter={() => actions.preview?.("group")} onMouseLeave={restore}
                onFocus={() => actions.preview?.("group")} onBlur={restore}
                onClick={event => { event.stopPropagation(); actions.group?.(); }}><FontAwesomeIcon icon={faLayerGroup} /></chakra.button>}
        </Box>
    </Box>;
}
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
