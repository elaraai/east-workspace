/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

/**
 * Coarse-pointer hit-area inflation (#346).
 *
 * @remarks
 * The spec's control density (26–40 px buttons, 14 px checkboxes/thumbs) is
 * deliberate on desktop and must not change visually. On touch devices every
 * interactive control still needs a ≥44 px effective target, so under the
 * `_coarse` condition (`@media (pointer: coarse)`, declared in
 * `theme/index.ts`) a transparent pseudo-element is inflated over the
 * control: pseudo-elements participate in their host's hit-testing, so taps
 * on the halo activate the control without altering layout or paint.
 *
 * Recipes spread the fragment into a slot:
 *
 * ```ts
 * import { coarseHitArea } from "../../style/hit-area.js";
 * base: { trigger: { ...coarseHitArea() } }
 * ```
 *
 * The host element must be positioned (the fragment does NOT set
 * `position` so it can be applied to slots that Zag positions absolutely);
 * pass `{ position: true }` to add `position: relative` for static hosts.
 * Use `pseudo: "_after"` when the slot already uses `_before`.
 *
 * A segment of a strip whose segments sit edge to edge — a segment strip's,
 * a switch's options — takes `{ axis: "block" }`: only its height grows, so
 * its halo never takes a tap meant for the segment beside it (#1221). An
 * ancestor that clips its overflow clips the halo too: a strip that rounds
 * its corners rounds its end segments rather than clipping them.
 */

import type { SystemStyleObject } from "@chakra-ui/react";

/** Options for {@link coarseHitArea}. */
export interface CoarseHitAreaOptions {
    /** Which pseudo-element carries the halo (default `"_before"`). */
    pseudo?: "_before" | "_after";
    /** Also set `position: relative` on the host (for static slots). */
    position?: boolean;
    /** Minimum effective size in px (default 44). */
    size?: number;
    /**
     * Which way the halo grows: `both` (the default), for a control that
     * stands alone; `block`, its height only, for a segment whose neighbours
     * sit edge to edge.
     */
    axis?: "both" | "block";
}

/**
 * Style fragment inflating a transparent tap halo to `size`×`size` px under
 * the `_coarse` condition — or to `size` px tall alone, on the `block` axis.
 * Layout and paint are unchanged; only hit-testing grows.
 *
 * @param options - pseudo-element, positioning, size and axis overrides
 * @returns a recipe-spreadable style fragment
 */
export function coarseHitArea(options?: CoarseHitAreaOptions): SystemStyleObject {
    const pseudo = options?.pseudo ?? "_before";
    const size = options?.size ?? 44;
    const block = options?.axis === "block";
    return {
        ...(options?.position ? { position: "relative" } : {}),
        _coarse: {
            [pseudo]: {
                content: '""',
                position: "absolute",
                top: "50%",
                left: "50%",
                transform: "translate(-50%, -50%)",
                width: block ? "100%" : `max(100%, ${size}px)`,
                height: `max(100%, ${size}px)`,
            },
        },
    } as SystemStyleObject;
}
