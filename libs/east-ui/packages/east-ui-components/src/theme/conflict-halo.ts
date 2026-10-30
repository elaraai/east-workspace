/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

/**
 * The warn halo a part wears while it holds a conflict not yet chosen (the
 * conflicts design's canvas marks): 1px `--warn`, 4px outside the part, over
 * its neighbours, no fill, its corner the part's plus 4 — `--r-sm` on a cell,
 * `--r-md` on a bar, `--r-lg` on a node. A selection keeps its own look on the
 * part, the halo outside it; it goes once the conflict is chosen, and comes
 * back if Undo returns it. A part marks itself `data-conflict`.
 *
 * @packageDocumentation
 */

/** The halo's corner: a cell's, a bar's or a node's radius plus 4. */
export type ConflictHaloCorner = "sm" | "md" | "lg";

/**
 * The halo as a layer of the part's own, 5px outside its edge — for a part
 * positioned to hold it that lets what overflows it show.
 *
 * @param corner - Its corner ({@link ConflictHaloCorner})
 * @returns The style
 */
export function conflictHalo(corner: ConflictHaloCorner) {
    return {
        "&[data-conflict]::before": {
            content: '""',
            position: "absolute",
            inset: "-5px",
            borderWidth: "1px",
            borderStyle: "solid",
            borderColor: "status.warn",
            borderRadius: `{radii.${corner}}`,
            pointerEvents: "none",
            zIndex: "4",
        },
    } as const;
}

/**
 * The halo as the part's outline, 4px out — for a part that clips what
 * overflows it, its corner following the part's: what a selection drawn as an
 * outline gives way to, drawn as a ring of its own just outside the part.
 */
export const CONFLICT_HALO_OUTLINE = {
    "&[data-conflict]": { outline: "1px solid {colors.status.warn}", outlineOffset: "4px", zIndex: "2" },
} as const;
