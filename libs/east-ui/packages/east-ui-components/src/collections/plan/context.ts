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
import type { PlanScale } from "./scale.js";
import type { PlanEvent } from "./plan-state.js";

/** The shared scale, provided once by the canvas. */
export const PlanScaleContext = createContext<PlanScale | null>(null);

/** The interaction dispatch channel (the one `useReducer` dispatch). */
export const PlanDispatchContext = createContext<(e: PlanEvent) => void>(() => undefined);

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
