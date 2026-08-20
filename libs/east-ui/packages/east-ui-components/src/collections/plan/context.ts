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

/** One decoded element ref — the generalized resolvers' subject. */
export type PlanElementRefValue = ValueTypeOf<typeof Plan.Types.ElementRef>;

/** A decoded element resolver (the root's `popover` / `hover` some-value). */
export type PlanElementResolver =
    Extract<ValueTypeOf<typeof Plan.Types.Root>["popover"], { type: "some" }>["value"];

/**
 * The root's generalized element resolvers, decoded — rows invoke them
 * lazily at interaction time with the clicked/hovered element's ref; a
 * `none` result opens no surface (`Plan Data Interface.md` §3.3).
 */
export interface PlanResolvers {
    /** The click-popover resolver, when declared. */
    popover?: PlanElementResolver | undefined;
    /** The hovercard resolver, when declared. */
    hover?: PlanElementResolver | undefined;
    /**
     * The element-click funnel (#569) — routes a clicked element's ref to the
     * root's `onRunClick` / `onEventClick` / `onMarkClick` / `onChipClick` /
     * `onCellClick` by the ref's own tag (the click payloads ARE the ref
     * arms). `undefined` when the root declares none of the five.
     */
    onElementClick?: ((ref: PlanElementRefValue) => void) | undefined;
}

/** The shared scale, provided once by the canvas. */
export const PlanScaleContext = createContext<PlanScale | null>(null);

/** The interaction dispatch channel (the one `useReducer` dispatch). */
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
}

/** The cursor channel (inert by default — chrome simply never shows). */
export const PlanCursorContext = createContext<PlanCursor>({
    move: () => undefined,
    leave: () => undefined,
});

/**
 * The brush-pan controller (#616/#620) — direct transform writes, settle on
 * release. Any brush draft over an existing window is an AFFINE preview of
 * the canvas: `preview(f0, f1)` takes the draft window in fractions of the
 * APPLIED window and writes two variables on the canvas body —
 * `--plan-pan-px` (translate) and `--plan-zoom-k` (horizontal scale) — that
 * every pan layer transforms by. A same-width draft is a pure slide
 * (`k = 1`); a resize scales too (`data-plan-zooming` hides chrome a
 * translate counter cannot correct). Either way a drag step is style
 * writes — no slice write, no scale rebuild, no re-render — and the
 * release commits the real window once.
 */
export interface PlanPan {
    /**
     * Preview the draft window `[f0, f1]`, given in fractions of the applied
     * window (`preview(0, 1)` — the identity — IS the reset).
     */
    preview(f0: number, f1: number): void;
    /** Reset the preview (release / cancel / unmount). */
    clear(): void;
}

/** The pan channel (inert by default). */
export const PlanPanContext = createContext<PlanPan>({
    preview: () => undefined,
    clear: () => undefined,
});

/** The element-resolver channel (empty when the root declares none). */
export const PlanResolversContext = createContext<PlanResolvers>({});

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
 * The brush-pan controller.
 *
 * @returns The canvas's pan channel (a no-op outside a Plan)
 */
export function usePlanPan(): PlanPan {
    return useContext(PlanPanContext);
}

/**
 * The root's generalized element resolvers.
 *
 * @returns The decoded `popover` / `hover` functions (absent when undeclared)
 */
export function usePlanResolvers(): PlanResolvers {
    return useContext(PlanResolversContext);
}
