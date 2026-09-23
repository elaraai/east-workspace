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
 * What the root's element interactions offer. The resolvers themselves stay
 * with the controller, which runs the LATEST root's at interaction time with
 * the element's ref — a `none` result opens no surface (`Plan Data
 * Interface.md` §3.3) — so an element needs to know only whether there is
 * anything to open, and the context holds still while a resolver's closure
 * changes (#815).
 */
export interface PlanResolvers {
    /** Whether the root declares a click-popover resolver. */
    popover: boolean;
    /** Whether the root declares a hovercard resolver. */
    hover: boolean;
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
}

/** The cursor channel (inert by default — chrome simply never shows). */
export const PlanCursorContext = createContext<PlanCursor>({
    move: () => undefined,
    leave: () => undefined,
});

/** The element-resolver channel (nothing to open when the root declares none). */
export const PlanResolversContext = createContext<PlanResolvers>({ popover: false, hover: false });

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
 * What the root's element interactions offer.
 *
 * @returns Whether a popover / hover card can open, and the click funnel
 */
export function usePlanResolvers(): PlanResolvers {
    return useContext(PlanResolversContext);
}
