/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

/**
 * React context + hook for the `PlotGutter` cascade (#147).
 *
 * `<AlignedStack>` publishes one `{ left, right }` gutter; the axis/lane
 * components (Chart, Trace, Calendar, …) read it via {@link usePlotGutter} and
 * inset their data lane to `[left, W − right]` so stacked components line up on
 * a common x. A component's own `plotGutter` prop wins over the inherited value
 * — the same per-component-override-beats-cascade rule as density (see
 * `./density.tsx`).
 */

import { createContext, useContext, type ReactNode } from "react";

/** Resolved horizontal inset (CSS lengths; px for cross-component alignment). */
export interface PlotGutter {
    readonly left?: string;
    readonly right?: string;
}

const PlotGutterContext = createContext<PlotGutter | undefined>(undefined);

export interface PlotGutterProviderProps {
    readonly value: PlotGutter;
    readonly children: ReactNode;
}

export function PlotGutterProvider({ value, children }: PlotGutterProviderProps) {
    return <PlotGutterContext.Provider value={value}>{children}</PlotGutterContext.Provider>;
}

/**
 * Read the inherited plot gutter from context, or `undefined` when no
 * `<AlignedStack>` provides one — so a lane component can tell "no shared gutter"
 * (keep its own defaults) apart from an imposed value.
 */
export function usePlotGutter(): PlotGutter | undefined {
    return useContext(PlotGutterContext);
}
