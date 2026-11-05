/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

/**
 * Zoom out, Zoom in and Fit (#1393, #1519): icon buttons, one strip of the
 * `seg` recipe, for a builder's toolbar and its View — the Schematic's and the
 * Flowchart's. Each is titled with its name; Zoom out is off at Fit, Zoom in
 * at the zoom's limit, and Fit can be clicked at any zoom. Each click of
 * either zooms by {@link ZOOM_STEP}: where it zooms about, and how far, is the
 * builder's.
 *
 * @packageDocumentation
 */

import { Box, chakra, useSlotRecipe, type SystemStyleObject } from "@chakra-ui/react";
import { FontAwesomeIcon } from "@fortawesome/react-fontawesome";
import { faExpand, faMinus, faPlus } from "@fortawesome/free-solid-svg-icons";

type Styles = Record<string, SystemStyleObject>;

/** How far a click of Zoom out or Zoom in zooms: ×1.5, or ÷1.5. */
export const ZOOM_STEP = 1.5;

/** Where a zoom stands: at Fit, where Zoom out does nothing, and at its limit, where Zoom in does nothing. */
export interface ZoomRange {
    /** Whether it stands at Fit. */
    readonly atFit: boolean;
    /** Whether it stands at its limit. */
    readonly atLimit: boolean;
}

/** What the strip says: a builder's message table holds each. */
export interface ZoomWords {
    /** The strip's accessible name: `Zoom`. */
    zoomLabel(): string;
    /** `Zoom out`. */
    zoomOut(): string;
    /** `Zoom in`. */
    zoomIn(): string;
    /** `Fit`: the whole drawing in view. */
    fit(): string;
}

/** Props of {@link ZoomStrip}. */
export interface ZoomStripProps {
    /** The builder it stands in, as `data-<scope>-zoom` names it: `schematic`, `flowchart`. */
    readonly scope: string;
    /** What it says. */
    readonly words: ZoomWords;
    /** Where the zoom stands. */
    readonly range: ZoomRange;
    /** Zooms by a factor: {@link ZOOM_STEP}, or its inverse. */
    readonly onZoom: (factor: number) => void;
    /** Puts the whole drawing in view. */
    readonly onFit: () => void;
    /** Fills its row with equal buttons, as in a View's popover. */
    readonly fullWidth?: boolean | undefined;
}

/**
 * The zoom strip — see the module docs.
 *
 * @param props - Its builder, words, range and what each button does
 * @returns Its group of three buttons
 */
export function ZoomStrip({ scope, words, range, onZoom, onFit, fullWidth = false }: ZoomStripProps) {
    const seg = useSlotRecipe({ key: "seg" })({ fullWidth }) as Styles;
    return (
        <Box css={seg.root} role="group" aria-label={words.zoomLabel()} {...{ [`data-${scope}-zoom`]: "" }}>
            <chakra.button type="button" css={seg.item} aria-label={words.zoomOut()} title={words.zoomOut()} disabled={range.atFit}
                onClick={() => onZoom(1 / ZOOM_STEP)}>
                <FontAwesomeIcon icon={faMinus} aria-hidden="true" />
            </chakra.button>
            <chakra.button type="button" css={seg.item} aria-label={words.zoomIn()} title={words.zoomIn()} disabled={range.atLimit}
                onClick={() => onZoom(ZOOM_STEP)}>
                <FontAwesomeIcon icon={faPlus} aria-hidden="true" />
            </chakra.button>
            <chakra.button type="button" css={seg.item} aria-label={words.fit()} title={words.fit()} onClick={onFit}>
                <FontAwesomeIcon icon={faExpand} aria-hidden="true" />
            </chakra.button>
        </Box>
    );
}
