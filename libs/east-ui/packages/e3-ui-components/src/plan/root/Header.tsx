/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 *
 * The canvas's sticky chrome — horizon brush, ruler, pinned rows and the
 * focus bar — pinned inside the scroll viewport above the body. The toolbar
 * is the frame's (#1193): the canvas draws no row of controls of its own.
 *
 * @packageDocumentation
 */

import type { ReactNode, Ref, RefObject } from "react";
import { Box } from "@chakra-ui/react";
import { HorizonBrush } from "../shell/HorizonBrush.js";
import { FocusBar } from "../shell/FocusBar.js";
import { PlanRuler } from "../shell/Ruler.js";
import type { PlanInstantValue } from "../instant.js";
import type { PlanUiView } from "./view.js";
import type { PlanWindowPart } from "./window.js";

type Styles = Record<string, Record<string, unknown>>;

export interface PlanHeaderProps {
    styles: Styles;
    gridTemplate: string;
    /** The header element — its live height feeds the expand clamp. */
    headerRef: Ref<HTMLDivElement>;
    /** The sources of the Plan's slice holding the window (#1344): the brush spans their domains. */
    windowParts: readonly PlanWindowPart[];
    /** The axis's stated window, `[from, to)` on its domain: with no source holding the window, the brush spans it and the window shown, as long again either side. */
    stated: readonly [number, number] | undefined;
    affordances: ReadonlyArray<string>;
    now: PlanInstantValue | undefined;
    /** The ruler's gutter caption — the active grain's name. */
    rulerCaption: string;
    cursorChipRef: RefObject<HTMLDivElement | null>;
    /** The pinned rows, already rendered. */
    pinned: ReactNode;
    /** The id of the pinned rows' group — the treegrid owns it (`aria-owns`,
     *  #819), so the pinned rows are its first rows though they render here.
     *  Absent when there are none. */
    pinnedId: string | undefined;
    /** The active row focus. */
    focus: PlanUiView["focus"];
    /** The focused row's name, while a focus is active. */
    focusLabel: string | undefined;
    /** Family sizes under a links focus. */
    linkCounts: { upstream: number; downstream: number } | undefined;
}

/** The sticky header band. */
export function PlanHeader({
    styles, gridTemplate, headerRef, windowParts, stated, affordances, now, rulerCaption, cursorChipRef,
    pinned, pinnedId, focus, focusLabel, linkCounts,
}: PlanHeaderProps) {
    return (
        <Box css={styles.header} ref={headerRef} data-plan-header>
            {/* The brush mounts where the slice offers it: over the sources'
                range domains, or — none holding the window — the canvas's
                own (#1344); only on the axis's arm, which the band decides
                itself (#631). */}
            {affordances.includes("brush") && (
                <HorizonBrush styles={styles} gridTemplate={gridTemplate} parts={windowParts} stated={stated} now={now} />
            )}
            <PlanRuler styles={styles} gridTemplate={gridTemplate} caption={rulerCaption}
                cursorChipRef={cursorChipRef} />
            {/* Pinned rows collapse like every other row under a focus — they
                are not exempt from "collapse, never remove". */}
            {pinnedId !== undefined && <Box role="rowgroup" id={pinnedId}>{pinned}</Box>}
            {/* The R1/R2 focus band — a SECTION row between the header and the
                body (`← All rows` + caption); the ruler never moves. */}
            {focus !== null && (
                <FocusBar styles={styles} focus={focus} label={focusLabel ?? ""} counts={linkCounts} />
            )}
        </Box>
    );
}
