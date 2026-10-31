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

/** A part's own corner, `none` for a square one: the halo's is 4px more. */
export type ConflictHaloCorner = "none" | "sm" | "md" | "lg";

/** A part's own border, which the halo stands outside: one width on every side, or each side's. */
export type ConflictHaloBorder = string | { readonly top?: string; readonly right?: string; readonly bottom?: string; readonly left?: string };

type Side = "top" | "right" | "bottom" | "left";

/**
 * The halo as a layer of the part's own, 4px outside it — for a part
 * positioned to hold it that lets what overflows it show. The layer is placed
 * from inside the part's border, so the part names its border, which the halo
 * stands outside.
 *
 * @param corner - The part's own corner ({@link ConflictHaloCorner})
 * @param border - The part's own border ({@link ConflictHaloBorder}); none by default
 * @returns The style
 */
export function conflictHalo(corner: ConflictHaloCorner, border: ConflictHaloBorder = {}) {
    const out = (side: Side): string => {
        const width = typeof border === "string" ? border : border[side];
        return width === undefined ? "-5px" : `calc(-5px - ${width})`;
    };
    return {
        "&[data-conflict]::before": {
            content: '""',
            position: "absolute",
            top: out("top"),
            right: out("right"),
            bottom: out("bottom"),
            left: out("left"),
            borderWidth: "1px",
            borderStyle: "solid",
            borderColor: "status.warn",
            borderRadius: corner === "none" ? "{radii.sm}" : `calc({radii.${corner}} + 4px)`,
            pointerEvents: "none",
            zIndex: "4",
        },
    } as const;
}
