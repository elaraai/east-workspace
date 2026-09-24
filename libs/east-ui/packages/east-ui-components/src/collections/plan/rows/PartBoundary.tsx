/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

/**
 * A render failure stays where it happened (#811).
 *
 * One boundary per PART of the canvas — a row's plot, an overlay body, the
 * expand render, the links layer. A throw while rendering one of them shows a
 * one-line fallback naming the part, and every other row, overlay and control
 * keeps working. (The only boundary used to be the Reactive's, around the
 * whole canvas: one author body that threw at render took everything with it.)
 *
 * The fallback carries `data-plan-error` naming the part — a stable id, the
 * same in every locale — and says so in the canvas's words (#820). It resets
 * when the part's input changes, so corrected data renders again without a
 * remount.
 */

import type { ReactNode } from "react";
import { Box } from "@chakra-ui/react";
import { EastErrorBoundary } from "../../../reactive/error-display.js";
import type { PlanPart } from "../messages.js";
import { usePlanWords } from "../words.js";

type Styles = Record<string, Record<string, unknown>>;

/**
 * A part's stable id — the fallback's `data-plan-error`: `row m3`, `popover`.
 *
 * @param part - The part
 * @returns Its id
 */
export function planPartId(part: PlanPart): string {
    switch (part.kind) {
        case "row": return `row ${part.key}`;
        case "group": return `group ${part.label}`;
        case "expandRender": return "expand render";
        case "expandGutter": return "expand gutter";
        case "linksLayer": return "links layer";
        case "popover": return "popover";
        case "hoverCard": return "hover card";
    }
}

export interface PlanPartBoundaryProps {
    /** The part — a row, a group's strip, an overlay body, the expand render, the links layer. */
    part: PlanPart;
    /** The part's input — when it changes, the boundary tries again. */
    resetKey: unknown;
    /** The resolved `plan` recipe styles (the `partError` slot). */
    styles: Styles;
    children: ReactNode;
}

/**
 * Contain a render failure to one part of the canvas.
 *
 * @param props - The part's name, its reset input, the recipe styles and the part
 * @returns The part, or its one-line failure
 */
export function PlanPartBoundary({ part, resetKey, styles, children }: PlanPartBoundaryProps) {
    const words = usePlanWords();
    const id = planPartId(part);
    return (
        <EastErrorBoundary
            title={`Plan ${id}`}
            resetKey={resetKey}
            fallback={({ message }) => (
                <Box css={styles.partError} data-plan-error={id} role="alert">
                    {words.m.partFailed({ part: words.m.partName({ part }), message })}
                </Box>
            )}
        >
            {children}
        </EastErrorBoundary>
    );
}
