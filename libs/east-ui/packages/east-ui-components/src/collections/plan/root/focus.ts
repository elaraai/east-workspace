/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 *
 * Row focus (R1 links / R2 expand): the links family and the rows it reveals,
 * and the focused row's developer render with its height clamp.
 *
 * @packageDocumentation
 */

import { useMemo, type ComponentProps, type RefObject } from "react";
import { getSomeorUndefined } from "../../../utils.js";
import type { EastChakraComponent } from "../../../component.js";
import { useElementHeight } from "../use-element-height.js";
import {
    deriveLinkFamily, pxOf, rowHeight, rowIdOfKey,
    type LinkFamily, type PlanDerived, type PlanFocusCtx, type PlanLinkValue, type PlanRootValue,
    type PlanRowIndex, type VisibleRow,
} from "../model.js";
import type { RowKey } from "../plan-state.js";
import type { PlanUiView } from "./view.js";

type UIValue = ComponentProps<typeof EastChakraComponent>["value"];

/** Default height of the R2 developer-render region when a row declares none. */
const EXPAND_DEFAULT_PX = 240;
/** The render never clamps below this — a region too short to hold anything
 *  is worse than one that scrolls. */
const EXPAND_FLOOR_PX = 88;

/** The focus's reach over the rows. */
export interface PlanFocus {
    /** The links focus's transitive family. */
    linkFamily: LinkFamily | undefined;
    /** The rows a links focus keeps at full height (focus + family). */
    focusVisibleKeys: ReadonlySet<RowKey> | undefined;
    /** Which row is focused, and how — what the row roles need. */
    focusCtx: PlanFocusCtx | undefined;
}

/**
 * The focus's family closure and height context.
 *
 * @param focus - The active row focus
 * @param links - The decoded link graph
 * @returns The family, the rows it keeps, and the focus context
 */
export function usePlanFocus(focus: PlanUiView["focus"], links: readonly PlanLinkValue[]): PlanFocus {
    const linkFamily = useMemo(
        () => (focus?.kind === "links" ? deriveLinkFamily(links, focus.key) : undefined),
        [focus, links],
    );
    const focusVisibleKeys = useMemo(
        () => (focus !== null && linkFamily !== undefined ? new Set([...linkFamily.all, focus.key]) : undefined),
        [focus, linkFamily],
    );
    const focusCtx = useMemo<PlanFocusCtx | undefined>(() => {
        if (focus === null) return undefined;
        return focus.kind === "links"
            ? { kind: "links", key: focus.key, family: linkFamily?.all }
            : { kind: "expand", key: focus.key };
    }, [focus, linkFamily]);
    return { linkFamily, focusVisibleKeys, focusCtx };
}

/** Where the focused row's developer render is measured against. */
export interface PlanExpandFrame {
    /** The virtualizer's scroll viewport — how much canvas there is. */
    scrollElRef: RefObject<HTMLElement | null>;
    /** The sticky chrome above the rows, inside that viewport. */
    headerRef: RefObject<HTMLElement | null>;
}

/** The R2 render and the height context the rows are measured with. */
export interface PlanExpand {
    /** Whether the root declares `expandRender` (rows grow the expand control). */
    canExpand: boolean;
    /** The focused row's developer render / gutter body, or `null`. */
    expandBody: UIValue | null;
    expandGutterBody: UIValue | null;
    /** The focus context with the render's clamped height — every `rowHeight` call's. */
    heightCtx: PlanFocusCtx | undefined;
}

/**
 * The focused row's developer render — the ROOT's `expandRender` resolver
 * called with the row's id (#822; rows only DECLARE `{ height, axis }`),
 * evaluated once per focus — and the v2 clamp on its height.
 *
 * @param value - The latest root (its resolvers)
 * @param focus - The active row focus
 * @param focusCtx - Which row is focused
 * @param rows - The row index, the visible rows and the derivations the clamp sums
 * @param dense - The declared density
 * @param chartsExpanded - The user's expanded chart rows
 * @param frame - The elements the clamp measures
 * @param live - Whether the canvas layout is showing (the narrow cards size their own render)
 * @returns The render and the height context
 */
export function usePlanExpand(
    value: PlanRootValue,
    focus: PlanUiView["focus"],
    focusCtx: PlanFocusCtx | undefined,
    rows: { index: PlanRowIndex; visible: readonly VisibleRow[]; derived: PlanDerived },
    dense: boolean,
    chartsExpanded: ReadonlySet<RowKey>,
    frame: PlanExpandFrame,
    live: boolean,
): PlanExpand {
    const expandRenderFn = useMemo(() => getSomeorUndefined(value.expandRender), [value.expandRender]);
    const expandGutterFn = useMemo(() => getSomeorUndefined(value.expandGutter), [value.expandGutter]);
    const expandKey = focus?.kind === "expand" ? focus.key : undefined;
    // Keyed on the focused row's KEY, so a landing or a data commit that keeps
    // the focus does not run the resolvers again.
    const expandBody = useMemo((): UIValue | null => {
        const id = expandKey !== undefined ? rowIdOfKey(expandKey) : undefined;
        if (id === undefined || expandRenderFn === undefined) return null;
        try {
            return expandRenderFn(id);
        } catch (err) {
            console.error("[Plan] expandRender resolver failed:", err);
            return null;
        }
    }, [expandKey, expandRenderFn]);
    const expandGutterBody = useMemo((): UIValue | null => {
        const id = expandKey !== undefined ? rowIdOfKey(expandKey) : undefined;
        if (id === undefined || expandGutterFn === undefined) return null;
        try {
            return expandGutterFn(id);
        } catch (err) {
            console.error("[Plan] expandGutter resolver failed:", err);
            return null;
        }
    }, [expandKey, expandGutterFn]);

    // R2 — the focused row's own declaration. The row keeps its NORMAL
    // anatomy and height; what grows is the render region inside it.
    const expandDecl = focusCtx?.kind === "expand"
        ? getSomeorUndefined(rows.index.byKey.get(focusCtx.key)?.expand)
        : undefined;
    // The v2 clamp — `min(renderHeight, canvas − strips − chrome)`. The canvas
    // is MEASURED, not parsed: `height: "fill"` is `"100%"`, which has no pixel
    // value until layout runs. Unbounded frames have no scroll element and
    // grow to content, so there is nothing to clamp against and the declared
    // height stands. Both readings are live while an expand focus is open on
    // the canvas layout.
    const expandActive = focus?.kind === "expand" && live;
    const viewportPx = useElementHeight(frame.scrollElRef, expandActive);
    const headerPx = useElementHeight(frame.headerRef, expandActive);
    // The clamp feeds `focusCtx.renderPx`, which `rowHeight` adds to the focal
    // row — so it is computed WITHOUT it (which would be circular). Strip
    // heights are constant per row, so summing them needs no focus context.
    const { visible, derived } = rows;
    const expandRenderPx = useMemo(() => {
        if (expandDecl === undefined || expandKey === undefined) return 0;
        // `pxOf`, not `parseFloat` — a percentage must fall back to the
        // default, never silently become that many pixels (the #615 rule).
        const declared = expandDecl.height.type === "some" ? pxOf(expandDecl.height.value) : undefined;
        const want = declared ?? EXPAND_DEFAULT_PX;
        if (viewportPx === undefined) return want;
        // Everything the render must NOT push out: the strips, the focal row's
        // own band, and the chrome pinned above them.
        const bare = { kind: "expand" as const, key: expandKey };
        const rowsPx = visible.reduce((sum, v) => sum + rowHeight(v, dense, chartsExpanded, bare, derived), 0);
        return Math.max(EXPAND_FLOOR_PX, Math.min(want, viewportPx - rowsPx - (headerPx ?? 0)));
    }, [expandDecl, expandKey, viewportPx, headerPx, visible, dense, chartsExpanded, derived]);
    // `focusCtx` says WHICH row is focused (all the row roles need); this adds
    // how tall its render is, which only the measurements need — keeping them
    // apart is what lets the clamp be computed after `focusCtx`.
    const heightCtx = useMemo<PlanFocusCtx | undefined>(
        () => (focusCtx?.kind === "expand" ? { ...focusCtx, renderPx: expandRenderPx } : focusCtx),
        [focusCtx, expandRenderPx]);
    return { canExpand: expandRenderFn !== undefined, expandBody, expandGutterBody, heightCtx };
}
