/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

/**
 * The Plan's row-facing contexts (`Plan Spec.md` §3): the one shared scale
 * every row positions against, and the dispatch channel row components report
 * interactions through. **No `PlotGutterProvider`** — nothing inside a Plan
 * negotiates chrome; rows are pure functions of the scale they receive.
 *
 * @packageDocumentation
 */

import { createContext, useContext } from "react";
import { type ValueTypeOf } from "@elaraai/east";
import { Plan } from "@elaraai/east-ui/internal";
import type { PlanScale } from "./scale.js";
import type { PlanEvent } from "./plan-state.js";
import { PLAN_GEOMETRY, type PlanGeometry } from "./geometry.js";

/** One decoded element ref — the generalized resolvers' subject. */
export type PlanElementRefValue = ValueTypeOf<typeof Plan.Types.ElementRef>;

/** A decoded element resolver (the root's `popover` / `hover` some-value). */
export type PlanElementResolver =
    Extract<ValueTypeOf<typeof Plan.Types.Root>["popover"], { type: "some" }>["value"];

/**
 * What an element reports its clicks to. Popovers and hover cards are not an
 * element's business: the canvas's one overlay layer opens them from the
 * element's DOM identity (#816), running the LATEST root's resolvers with the
 * element's ref — a `none` result opens no surface (`Plan Data Interface.md`
 * §3.3).
 */
export interface PlanResolvers {
    /**
     * The element-click funnel — the root's ONE `onElementClick` (#824), called
     * with the clicked element's ref: a run, a tile, a mark, a chip, a cell or
     * a link ribbon. `undefined` when the root declares none.
     */
    onElementClick?: ((ref: PlanElementRefValue) => void) | undefined;
}

/** The shared scale, provided once by the canvas. */
export const PlanScaleContext = createContext<PlanScale | null>(null);

/** The interaction dispatch channel (the canvas controller's `dispatch`). */
export const PlanDispatchContext = createContext<(e: PlanEvent) => void>(() => undefined);

/**
 * The hover-cursor controller (#609) — display-only chrome, written straight
 * to the DOM: `move` sets ONE CSS variable on the canvas body (every row's
 * hairline positions from it) and writes the ruler chip's label/position;
 * `leave` hides both. Never React state: routing a pointermove through the
 * reducer re-rendered every mounted row once per event.
 */
export interface PlanCursor {
    /** The pointer is at a window fraction over a row plot. */
    move(frac: number): void;
    /** The pointer left a row plot. */
    leave(): void;
    /**
     * Follow the hovered BUCKET (#743) — the listener hears the bucket index
     * each time the pointer crosses into another one (`-1` once it is over no
     * bucket, or gone), and at once with the current one. A chart row's
     * crosshair readout writes the DOM from it, so a hover still renders
     * nothing.
     *
     * @param listener - Called with the hovered bucket index
     * @returns Stop listening
     */
    subscribe(listener: (bucket: number) => void): () => void;
}

/** The cursor channel (inert by default — chrome simply never shows). */
export const PlanCursorContext = createContext<PlanCursor>({
    move: () => undefined,
    leave: () => undefined,
    subscribe: () => () => undefined,
});

/** The element-click channel (no funnel when the root declares no `onElementClick`). */
export const PlanResolversContext = createContext<PlanResolvers>({});

/** The canvas's geometry — the one height table for its density (#817). */
export const PlanGeometryContext = createContext<Readonly<PlanGeometry>>(PLAN_GEOMETRY.default);

/**
 * The canvas's geometry — every row and slot height, for its density.
 *
 * @returns The table (the default density outside a Plan)
 */
export function usePlanGeometry(): Readonly<PlanGeometry> {
    return useContext(PlanGeometryContext);
}

/**
 * The shared scale — throws when mounted outside a Plan (row components are
 * canvas-internal; there is no standalone mounting).
 *
 * @returns The canvas's scale
 */
export function usePlanScale(): PlanScale {
    const scale = useContext(PlanScaleContext);
    if (scale === null) throw new Error("[Plan] row rendered outside PlanScaleContext");
    return scale;
}

/**
 * The interaction dispatch channel.
 *
 * @returns The canvas's `dispatch`
 */
export function usePlanDispatch(): (e: PlanEvent) => void {
    return useContext(PlanDispatchContext);
}

/**
 * The hover-cursor controller.
 *
 * @returns The canvas's cursor channel (a no-op outside a Plan)
 */
export function usePlanCursor(): PlanCursor {
    return useContext(PlanCursorContext);
}

/**
 * What an element reports its clicks to.
 *
 * @returns The click funnel, when the root declares `onElementClick`
 */
export function usePlanResolvers(): PlanResolvers {
    return useContext(PlanResolversContext);
}
