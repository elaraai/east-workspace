/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 *
 * The canvas's sticky chrome — toolbar, horizon brush, ruler, pinned rows and
 * the focus bar — pinned inside the scroll viewport above the body.
 *
 * @packageDocumentation
 */

import type { ReactNode, Ref, RefObject } from "react";
import { Box } from "@chakra-ui/react";
import { type ValueTypeOf } from "@elaraai/east";
import { Pick, Slice } from "@elaraai/east-ui/internal";
import { PlanToolbar } from "../shell/Toolbar.js";
import { HorizonBrush } from "../shell/HorizonBrush.js";
import { FocusBar } from "../shell/FocusBar.js";
import { PlanRuler } from "../shell/Ruler.js";
import { hasDiagnostics, type PlanDiagnostics } from "../shell/Diagnostics.js";
import { PlanDecisionHeader } from "../shell/Review.js";
import type { PlanTransport } from "../shell/transport.js";
import type { PlanSearch } from "../use-seek.js";
import type { PlanInstantValue } from "../instant.js";
import type { PlanUiView } from "./view.js";

type Styles = Record<string, Record<string, unknown>>;
type SliceBindValue = ValueTypeOf<typeof Slice.Types.Bind>;
type PickBindValue = ValueTypeOf<typeof Pick.Types.Bind>;

export interface PlanHeaderProps {
    styles: Styles;
    gridTemplate: string;
    /** The header element — its live height feeds the expand clamp. */
    headerRef: Ref<HTMLDivElement>;
    /** Whether slice chrome is declared at all. */
    chrome: boolean;
    slice: SliceBindValue | undefined;
    affordances: ReadonlyArray<string>;
    resolution: string;
    resolutions: ReadonlyArray<string>;
    transport: PlanTransport | undefined;
    search: PlanSearch | undefined;
    pick: PickBindValue | undefined;
    diagnostics: PlanDiagnostics;
    now: PlanInstantValue | undefined;
    /** The ruler's gutter caption — the active grain's name. */
    rulerCaption: string;
    cursorChipRef: RefObject<HTMLDivElement | null>;
    /** The decision column's header label, when the canvas carries review chrome. */
    reviewLabel: string | undefined;
    /** The pinned rows, already rendered. */
    pinned: ReactNode;
    /** The active row focus. */
    focus: PlanUiView["focus"];
    /** Family sizes under a links focus. */
    linkCounts: { upstream: number; downstream: number } | undefined;
}

/** The sticky header band. */
export function PlanHeader({
    styles, gridTemplate, headerRef, chrome, slice, affordances, resolution, resolutions,
    transport, search, pick, diagnostics, now, rulerCaption, cursorChipRef, reviewLabel,
    pinned, focus, linkCounts,
}: PlanHeaderProps) {
    return (
        <Box background="bg.surface" ref={headerRef} data-plan-header>
            {/* The toolbar is SLICE chrome (§2) — the grain / resolution
                segments ride the slice rail. It ALSO carries the key search,
                which is a capability of the SOURCE: a keyed paged source
                declares `seek` whether or not a slice was ever bound, so the
                bar mounts for either reason. The series library (#590) is the
                same argument again, and the diagnostics (#811) — a canvas that
                carried on past a failure must say so, slice or no slice. */}
            {(chrome || search !== undefined || pick !== undefined || hasDiagnostics(diagnostics)) && (
                <PlanToolbar styles={styles} slice={slice} affordances={affordances}
                    resolution={resolution} resolutions={resolutions}
                    transport={transport} search={search} pick={pick} diagnostics={diagnostics} />
            )}
            {/* The brush mounts only where the slice's range domain speaks the
                axis's arm — the band decides that itself (#631). */}
            {slice !== undefined && affordances.includes("brush") && (
                <HorizonBrush styles={styles} gridTemplate={gridTemplate} slice={slice} now={now} />
            )}
            <PlanRuler styles={styles} gridTemplate={gridTemplate} caption={rulerCaption}
                cursorChipRef={cursorChipRef}
                trailing={reviewLabel !== undefined ? <PlanDecisionHeader label={reviewLabel} /> : undefined} />
            {/* Pinned rows collapse like every other row under a focus — they
                are not exempt from "collapse, never remove". */}
            {pinned}
            {/* The R1/R2 focus band — a SECTION row between the header and the
                body (`← ALL ROWS` + caption); the ruler never moves. */}
            {focus !== null && <FocusBar styles={styles} focus={focus} counts={linkCounts} />}
        </Box>
    );
}
