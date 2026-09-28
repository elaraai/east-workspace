/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

/**
 * What a row IS under the canvas's state — its role under a row focus, and
 * what its caret toggles. The renderer (`root/rows.tsx`, `rows/BodyRow.tsx`)
 * and the keyboard map (`root/keyboard.ts`, #819) read the same answers, so a
 * key can never do something a click would not.
 *
 * @packageDocumentation
 */

import type { PlanFocusCtx, VisibleRow } from "../model.js";
import type { PlanEvent } from "../plan-state.js";

/**
 * A row's presentation under the canvas's row focus: `rail` (R1 — a row the
 * links focus does not gather, 11px), `ctx` (R2 — a context strip beside the
 * expanded row, 16px), `focal` (the R2 expanded row, when it has a render), or
 * `none`. Group bands are wayfinding and never compress.
 *
 * @param v - The visible row
 * @param focusCtx - The canvas's row focus, if any
 * @param hasRender - Whether the expand render resolved to a body
 * @returns The row's role
 */
export function planRowRole(v: VisibleRow, focusCtx: PlanFocusCtx | undefined, hasRender: boolean): "rail" | "ctx" | "focal" | "none" {
    if (focusCtx === undefined || v.row.kind.type === "group") return "none";
    const key = v.row.key;
    if (focusCtx.kind === "links") {
        return key !== focusCtx.key && !(focusCtx.family?.has(key) ?? false) ? "rail" : "none";
    }
    if (key !== focusCtx.key) return "ctx";
    return hasRender ? "focal" : "none";
}

/** What a row's caret toggles, and whether that is open now. */
export interface PlanRowToggle {
    /** The interaction a caret click — Space, ← / → — dispatches. */
    event: PlanEvent;
    /** Whether the section (or chart) is open. */
    open: boolean;
}

/**
 * A row's caret — a group band's section, a nesting parent's subtree (span,
 * heat, buckets and table parents), an expandable chart's spark ↔ expanded.
 * Cards and events rows, and charts that do not declare `expandable`, have
 * none.
 *
 * @param v - The visible row
 * @param hasChildren - Whether the row nests rows
 * @param chartExpanded - Whether the user expanded this chart row
 * @returns The toggle, or `undefined` for a row with no caret
 */
export function rowToggle(v: VisibleRow, hasChildren: boolean, chartExpanded: boolean): PlanRowToggle | undefined {
    const kind = v.row.kind;
    const section: PlanRowToggle = { event: { t: "group.toggle", key: v.row.key }, open: !v.collapsed };
    switch (kind.type) {
        case "group":
            return section;
        case "span": case "heat": case "buckets": case "table":
            return hasChildren ? section : undefined;
        case "chart": {
            if (!kind.value.expandable) return undefined;
            return {
                event: { t: "chart.toggle", key: v.row.key },
                open: kind.value.height.type === "expanded" || chartExpanded,
            };
        }
        case "cards": case "events":
            return undefined;
    }
}
