/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

/**
 * `coarseHitArea` (#346, #1221) — a transparent halo under `_coarse`, both
 * ways for a control that stands alone, its height alone for a segment whose
 * neighbours sit edge to edge. The responsive suite measures what a tap on it
 * hits; this holds the fragment the recipes spread, and the recipes whose
 * controls sit edge to edge to its block axis — the segment strip's segments,
 * which the Plan's 49–55px segments never let a measure tell apart, and the
 * context switch's options.
 */

import { describe, test, expect } from "vitest";
import { coarseHitArea } from "./hit-area.js";
import { segSlotRecipe } from "../theme/slot-recipes/seg.js";
import { sheetSlotRecipe } from "../theme/slot-recipes/sheet.js";

/** The halo a fragment draws, by its pseudo-element. */
function halo(fragment: object, pseudo: "_before" | "_after" = "_before"): Record<string, unknown> {
    return (fragment as { _coarse: Record<string, Record<string, unknown>> })._coarse[pseudo]!;
}

describe("coarseHitArea", () => {
    test("by default a 44px square halo, centred on the control, on its ::before — the host's position its own", () => {
        const fragment = coarseHitArea();
        expect("position" in fragment).toBe(false);
        expect(halo(fragment)).toEqual({
            content: '""', position: "absolute", top: "50%", left: "50%", transform: "translate(-50%, -50%)",
            width: "max(100%, 44px)", height: "max(100%, 44px)",
        });
    });

    test("a static host is positioned for it; the halo may be another size, on the ::after", () => {
        const fragment = coarseHitArea({ position: true, pseudo: "_after", size: 32 });
        expect((fragment as { position?: string }).position).toBe("relative");
        expect(halo(fragment, "_after")).toMatchObject({ width: "max(100%, 32px)", height: "max(100%, 32px)" });
    });

    test("on the block axis only its height grows: a segment's halo keeps to its own width", () => {
        expect(halo(coarseHitArea({ axis: "block" }))).toMatchObject({ width: "100%", height: "max(100%, 44px)" });
        expect(halo(coarseHitArea({ axis: "both" }))).toMatchObject({ width: "max(100%, 44px)", height: "max(100%, 44px)" });
    });

    test("controls that sit edge to edge take it on the block axis: a segment strip's segments and the context switch's options", () => {
        const block = halo(coarseHitArea({ position: true, axis: "block" }));
        expect(halo(segSlotRecipe.base!.item!)).toEqual(block);
        expect(halo(sheetSlotRecipe.base!.contextOption!)).toEqual(block);
    });
});
