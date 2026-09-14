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
}
/** Two independent actions at the gutter seam; keyboard activation never types into the sheet. */
export function SheetInsertPoint({ styles, actions }: { styles: Styles; actions: InsertionActions }) {
    const point = useRef<HTMLDivElement>(null);
    const defaultKind = actions.row ? "row" : "group";
    const preview = actions.preview;
    // The buttons are revealed by the whole gutter, so its hover owns the default preview too.
    useEffect(() => {
        const gutter = point.current?.closest("[data-slot=gutter]");
        if (!gutter) return;
        const enter = () => preview?.(defaultKind);
        const leave = () => preview?.(undefined);
        gutter.addEventListener("mouseenter", enter);
        gutter.addEventListener("mouseleave", leave);
        return () => { gutter.removeEventListener("mouseenter", enter); gutter.removeEventListener("mouseleave", leave); };
    }, [preview, defaultKind]);
    const restore = () => actions.preview?.(point.current?.closest("[data-slot=gutter]")?.matches(":hover") ? defaultKind : undefined);
    return <Box ref={point} css={styles.insertPoint} data-slot="insertPoint" onKeyDown={event => event.stopPropagation()}>
        {actions.row && <chakra.button type="button" css={styles.insertButton} data-slot="insertRow"
            aria-label={actions.ordered ? "Insert row before" : "Add row"} title={actions.ordered ? "Insert row before" : "Add row in key order"}
            onMouseDown={event => { event.preventDefault(); event.stopPropagation(); }}
            onMouseEnter={() => actions.preview?.("row")} onMouseLeave={restore}
            onFocus={() => actions.preview?.("row")} onBlur={restore}
            onClick={event => { event.stopPropagation(); actions.row?.(); }}><FontAwesomeIcon icon={faPlus} /></chakra.button>}
        {actions.group && <chakra.button type="button" css={styles.insertButton} data-slot="insertGroup"
            aria-label={actions.groupOrdered ? "New group" : "Add group"} title={actions.groupOrdered ? "New group at the nearest group boundary" : "Add group in key order"}
            onMouseDown={event => { event.preventDefault(); event.stopPropagation(); }}
            onMouseEnter={() => actions.preview?.("group")} onMouseLeave={restore}
            onFocus={() => actions.preview?.("group")} onBlur={restore}
            onClick={event => { event.stopPropagation(); actions.group?.(); }}>
            <Box as="span" css={styles.insertGroupIcon} aria-hidden="true"><FontAwesomeIcon icon={faLayerGroup} /><Box as="span" css={styles.insertGroupPlus}>+</Box></Box>
        </chakra.button>}
    </Box>;
}
/** A visible alternative to the gutter controls when whole rows are selected. */
export function SheetInsertStrip({ styles, ordered, above, below, group }: {
    styles: Styles; ordered: boolean; above?: (() => void) | undefined; below?: (() => void) | undefined; group?: (() => void) | undefined;
}) {
    if (!above && !below && !group) return null;
    return <Box css={styles.insertStrip} role="group" aria-label="Row insertion">
        {ordered && above && <chakra.button type="button" css={styles.insertChoice} onClick={above}>Insert above</chakra.button>}
        {below && <chakra.button type="button" css={styles.insertChoice} onClick={below}>{ordered ? "Insert below" : "Add row"}</chakra.button>}
        {group && <chakra.button type="button" css={styles.insertChoice} onClick={group}>New group</chakra.button>}
    </Box>;
}
